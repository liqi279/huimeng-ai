'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { jsonError } = require('./http');
const userStore = require('./user-store-mysql');

const WORK_CAP = 200;
const ASSET_CAP = 200;

/* -------------- 用户系统 -------------- */
const usersFile = path.join(config.DATA_DIR, 'users.json');
const sessionsFile = path.join(config.DATA_DIR, 'sessions.json');
/* 按用户隔离的数据目录：data/users/<userId>/works.json + desk.json */
function userDir(userId) {
  return path.join(config.DATA_DIR, 'users', String(userId));
}
function userWorksFile(userId) {
  return path.join(userDir(userId), 'works.json');
}
function userDeskFile(userId) {
  return path.join(userDir(userId), 'desk.json');
}

/* token 签名密钥：从 config 来（优先环境变量，fallback 内置固定值）
   这样无论 Render 怎么重启/重新部署，secret 永远不变 → token 永不过期
   （token 本身 30 天有效期，但 secret 不换所以签名验证永远通过） */
const TOKEN_SECRET = config.TOKEN_SECRET;

/* pbkdf2 密码哈希 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return h === hash;
}

/* 简易 JWT-like token: base64url(payload).base64url(hmac) */
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64payload = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(`${b64header}.${b64payload}`).digest('base64url');
  return `${b64header}.${b64payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [b64h, b64p, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${b64h}.${b64p}`).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(b64p, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}
const dirs = {
  root: config.DATA_DIR,
  assets: path.join(config.DATA_DIR, 'assets'),
  media: path.join(config.DATA_DIR, 'media'),
  users: path.join(config.DATA_DIR, 'users'),
};

const worksFile = path.join(config.DATA_DIR, 'works.json');
const assetsFile = path.join(config.DATA_DIR, 'assets.json');
const projectsFile = path.join(config.DATA_DIR, 'projects.json');
const deskFile = path.join(config.DATA_DIR, 'desk.json');

async function readJson(file, fallback) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    const value = JSON.parse(text);
    return value == null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

// Serialize every mutation so concurrent requests cannot clobber each other.
let queue = Promise.resolve();

function enqueue(task) {
  const next = queue.then(task);
  queue = next.then(() => {}, () => {});
  return next;
}

async function readList(file) {
  const value = await readJson(file, []);
  return Array.isArray(value) ? value : [];
}

async function ensureDirs() {
  await fsp.mkdir(dirs.root, { recursive: true });
  await fsp.mkdir(dirs.assets, { recursive: true });
  await fsp.mkdir(dirs.media, { recursive: true });
  await fsp.mkdir(dirs.users, { recursive: true });
}

/* -------------- 用户 CRUD -------------- */
async function listUsers() {
  return readJson(usersFile, []);
}
async function findUserByUsername(username) {
  const list = await listUsers();
  return list.find((u) => u && u.username === username) || null;
}
async function findUserById(id) {
  const list = await listUsers();
  return list.find((u) => u && u.id === id) || null;
}
function createUser({ username, password, role, status, email, note }) {
  return enqueue(async () => {
    const list = await listUsers();
    if (list.some((u) => u && u.username === username)) {
      return { ok: false, error: '用户名已存在' };
    }
    const { salt, hash } = hashPassword(password);
    const finalStatus = normalizeStatus(status);
    const user = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username: String(username).trim(),
      email: email ? String(email).trim().slice(0, 190) : null,
      salt,
      hash,
      role: role === 'admin' ? 'admin' : 'user',
      status: finalStatus,
      note: note || '',
      createdAt: Date.now(),
      approvedAt: finalStatus === 'approved' ? Date.now() : null,
    };
    list.push(user);
    await writeJson(usersFile, list);
    /* 初始化用户数据目录 */
    await fsp.mkdir(userDir(user.id), { recursive: true });
    await writeJson(userWorksFile(user.id), []);
    await writeJson(userDeskFile(user.id), { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 });
    return { ok: true, user: sanitizeUser(user) };
  });
}
/* 当 Render 免费层重启清空 data/users.json 时，
   用 token payload 里的 uid + username 自动把用户重建回来。
   不设密码（token 本身就是凭证），重建后前端下次登录可正常使用。 */
function reviveUser(uid, username, role) {
  return enqueue(async () => {
    let list = await listUsers();
    let user = list.find((u) => u && u.id === uid);
    if (!user) {
      user = {
        id: uid,
        username: String(username).trim(),
        salt: crypto.randomBytes(16).toString('hex'),
        hash: '', /* 占位，revive 出来的用户下次登录时由 register/login 覆盖 */
        role: role === 'admin' ? 'admin' : 'user',
        status: 'approved',
        note: 'token 自动重建',
        createdAt: Date.now(),
        approvedAt: Date.now(),
      };
      list.push(user);
      await writeJson(usersFile, list);
      await fsp.mkdir(userDir(uid), { recursive: true });
      await writeJson(userWorksFile(uid), []);
      await writeJson(userDeskFile(uid), { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 });
    }
    return sanitizeUser(user);
  });
}
function normalizeStatus(value) {
  return value === 'pending' || value === 'rejected' ? value : 'approved';
}
function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    role: u.role === 'admin' ? 'admin' : 'user',
    status: normalizeStatus(u.status),
    note: u.note || '',
    createdAt: u.createdAt,
    approvedAt: u.approvedAt || null,
  };
}
async function authenticateUser(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return sanitizeUser(user);
}
function updateUserRole(id, role) {
  return enqueue(async () => {
    const list = await listUsers();
    const u = list.find((x) => x && x.id === id);
    if (!u) return { ok: false, error: '用户不存在' };
    u.role = role === 'admin' ? 'admin' : 'user';
    await writeJson(usersFile, list);
    return { ok: true, user: sanitizeUser(u) };
  });
}
function setUserStatus(id, status, actorId, note) {
  return enqueue(async () => {
    const list = await listUsers();
    const u = list.find((x) => x && x.id === id);
    if (!u) return { ok: false, error: '用户不存在' };
    u.status = normalizeStatus(status);
    u.note = note || '';
    u.approvedAt = u.status === 'approved' ? Date.now() : null;
    u.approvedBy = u.status === 'approved' ? (actorId || null) : null;
    await writeJson(usersFile, list);
    return { ok: true, user: sanitizeUser(u) };
  });
}
function countPendingUsers() {
  return listUsers().then((list) => list.filter((u) => u && normalizeStatus(u.status) === 'pending').length);
}
function countAdmins() {
  return listUsers().then((list) => list.filter((u) => u && u.role === 'admin' && normalizeStatus(u.status) === 'approved').length);
}
function resetUserPassword(id, newPassword) {
  return enqueue(async () => {
    const list = await listUsers();
    const u = list.find((x) => x && x.id === id);
    if (!u) return { ok: false, error: '用户不存在' };
    const { salt, hash } = hashPassword(newPassword);
    u.salt = salt;
    u.hash = hash;
    await writeJson(usersFile, list);
    return { ok: true };
  });
}
function deleteUser(id) {
  return enqueue(async () => {
    const list = await listUsers();
    const next = list.filter((u) => u && u.id !== id);
    if (next.length === list.length) return { ok: false, error: '用户不存在' };
    await writeJson(usersFile, next);
    /* 清理用户数据目录 */
    try { await fsp.rm(userDir(id), { recursive: true, force: true }); } catch (e) {}
    return { ok: true };
  });
}

/* -------------- 用户资料 / 偏好（file 过渡模式） -------------- */
function profileFile(userId) { return path.join(userDir(userId), 'profile.json'); }
function prefsFile(userId) { return path.join(userDir(userId), 'prefs.json'); }

async function getProfile(userId) {
  const raw = await readJson(profileFile(userId), null);
  return {
    userId,
    displayName: (raw && raw.displayName) || '',
    email: (raw && raw.email) || '',
    bio: (raw && raw.bio) || '',
    avatarUrl: (raw && raw.avatarUrl) || '',
    extra: (raw && raw.extra) || {},
    updatedAt: (raw && raw.updatedAt) || 0,
  };
}
function updateProfile(userId, patch) {
  return enqueue(async () => {
    const current = await getProfile(userId);
    const next = {
      displayName: patch.displayName == null ? current.displayName : String(patch.displayName).slice(0, 64),
      email: patch.email == null ? current.email : String(patch.email).slice(0, 190),
      bio: patch.bio == null ? current.bio : String(patch.bio).slice(0, 500),
      avatarUrl: patch.avatarUrl == null ? current.avatarUrl : String(patch.avatarUrl).slice(0, 500),
      extra: patch.extra && typeof patch.extra === 'object' ? patch.extra : current.extra,
      updatedAt: Date.now(),
    };
    await fsp.mkdir(userDir(userId), { recursive: true });
    await writeJson(profileFile(userId), next);
    return Object.assign({ userId }, next);
  });
}
async function getPreferences(userId) {
  const raw = await readJson(prefsFile(userId), null);
  return {
    userId,
    theme: (raw && raw.theme) || '',
    language: (raw && raw.language) || '',
    prefs: (raw && raw.prefs) || {},
    updatedAt: (raw && raw.updatedAt) || 0,
  };
}
function updatePreferences(userId, patch) {
  return enqueue(async () => {
    const current = await getPreferences(userId);
    const next = {
      theme: patch.theme == null ? current.theme : String(patch.theme).slice(0, 32),
      language: patch.language == null ? current.language : String(patch.language).slice(0, 16),
      prefs: patch.prefs && typeof patch.prefs === 'object' ? Object.assign({}, current.prefs, patch.prefs) : current.prefs,
      updatedAt: Date.now(),
    };
    await fsp.mkdir(userDir(userId), { recursive: true });
    await writeJson(prefsFile(userId), next);
    return Object.assign({ userId }, next);
  });
}
async function exportUsers() {
  const list = await listUsers();
  return {
    exportedAt: new Date().toISOString(),
    storage: 'json',
    database: null,
    count: list.length,
    users: list,
  };
}

/* -------------- 按用户隔离的 works / desk -------------- */
async function listWorks(userId) {
  if (userId) return readList(userWorksFile(userId));
  return readList(worksFile);
}
function upsertWork(userId, work) {
  const file = userId ? userWorksFile(userId) : worksFile;
  return enqueue(async () => {
    const list = await readList(file);
    const next = [work, ...list.filter((item) => item && item.id !== work.id)].slice(0, WORK_CAP);
    await writeJson(file, next);
    return work;
  });
}
function removeWork(userId, id) {
  const file = userId ? userWorksFile(userId) : worksFile;
  return enqueue(async () => {
    const list = await readList(file);
    const next = list.filter((item) => !item || item.id !== id);
    if (next.length === list.length) return false;
    await writeJson(file, next);
    return true;
  });
}
function clearWorks(userId) {
  const file = userId ? userWorksFile(userId) : worksFile;
  return enqueue(async () => {
    await writeJson(file, []);
    return true;
  });
}

async function getDesk(userId) {
  const file = userId ? userDeskFile(userId) : deskFile;
  return readJson(file, { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 });
}
function saveDesk(userId, desk) {
  const file = userId ? userDeskFile(userId) : deskFile;
  return enqueue(async () => {
    if (userId) await fsp.mkdir(userDir(userId), { recursive: true });
    const next = {
      folders: Array.isArray(desk && desk.folders) ? desk.folders : [],
      positions: (desk && desk.positions) || {},
      assigns: (desk && desk.assigns) || {},
      names: (desk && desk.names) || {},
      updatedAt: Date.now(),
    };
    await writeJson(file, next);
    return next;
  });
}

async function listAssets() {
  return readList(assetsFile);
}

async function getAsset(id) {
  const list = await readList(assetsFile);
  return list.find((item) => item && item.id === id) || null;
}

function addAsset(asset) {
  return enqueue(async () => {
    const list = await readList(assetsFile);
    const next = [asset, ...list.filter((item) => item && item.id !== asset.id)].slice(0, ASSET_CAP);
    await writeJson(assetsFile, next);
    return asset;
  });
}

function removeAsset(id) {
  return enqueue(async () => {
    const list = await readList(assetsFile);
    const found = list.find((item) => item && item.id === id) || null;
    if (!found) return null;
    await writeJson(assetsFile, list.filter((item) => !item || item.id !== id));
    return found;
  });
}

async function listAssets(filter = {}) {
  const list = await readList(assetsFile);
  let filtered = list.filter((item) => item && !item.deletedAt);
  if (filter.type) filtered = filtered.filter((a) => a.type === filter.type);
  if (filter.projectId) filtered = filtered.filter((a) => a.projectId === filter.projectId);
  if (filter.folder) filtered = filtered.filter((a) => a.folder === filter.folder);
  return filtered;
}

/* 项目 CRUD */
async function listProjects() {
  const list = await readJson(projectsFile, []);
  return list.filter((p) => p && !p.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function getProject(id) {
  const list = await readJson(projectsFile, []);
  return list.find((p) => p && p.id === id && !p.deletedAt) || null;
}

async function createProject(project) {
  return enqueue(async () => {
    const list = await readJson(projectsFile, []);
    const now = Date.now();
    const next = {
      id: project.id || crypto.randomUUID(),
      name: (project.name || '未命名项目').trim().slice(0, 80),
      description: (project.description || '').slice(0, 300),
      folders: Array.isArray(project.folders) ? project.folders : [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    list.unshift(next);
    await writeJson(projectsFile, list);
    return next;
  });
}

async function updateProject(id, patch) {
  return enqueue(async () => {
    const list = await readJson(projectsFile, []);
    const idx = list.findIndex((p) => p && p.id === id);
    if (idx < 0) return null;
    const updated = { ...list[idx], ...patch, id: list[idx].id, updatedAt: new Date().toISOString() };
    list[idx] = updated;
    await writeJson(projectsFile, list);
    return updated;
  });
}

async function deleteProject(id) {
  return enqueue(async () => {
    const list = await readJson(projectsFile, []);
    const idx = list.findIndex((p) => p && p.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    await writeJson(projectsFile, list);
    return true;
  });
}

/* =============================================================
 * 存储层路由：
 * - 账号 / 用户资料 / 偏好：默认 MySQL（user-store-mysql.js）
 *   USER_STORE=file 时才显式落本地 JSON（过渡用，Render 重启会丢）
 * - 作品 / 桌面 / 资产：设置了 DATABASE_URL → PostgreSQL，否则本地 JSON
 * signToken / verifyToken / dirs / ensureDirs 始终在本文件实现。
 * ============================================================= */
const USE_DB = !!config.DATABASE_URL;
const USE_MYSQL_USERS = config.USER_STORE !== 'file';

/* 文件存储实现（USER_STORE=file，或 auto 模式下 MySQL 连接失败时使用） */
const fileAccount = {
  listUsers,
  findUserByUsername,
  findUserById,
  createUser,
  reviveUser,
  authenticateUser,
  updateUserRole,
  setUserStatus,
  resetUserPassword,
  deleteUser,
  countPendingUsers,
  countAdmins,
  getProfile,
  updateProfile,
  getPreferences,
  updatePreferences,
  exportUsers,
  migrateFromFile: () => Promise.resolve({ migrated: 0, total: 0, skipped: true, error: '当前为文件存储，无需同步' }),
};

const ACCOUNT_METHODS = [
  'listUsers', 'findUserByUsername', 'findUserById', 'createUser', 'reviveUser',
  'authenticateUser', 'updateUserRole', 'setUserStatus', 'resetUserPassword', 'deleteUser',
  'countPendingUsers', 'countAdmins', 'getProfile', 'updateProfile',
  'getPreferences', 'updatePreferences', 'exportUsers', 'migrateFromFile',
];

function accountProvider() {
  if (!USE_MYSQL_USERS) return fileAccount;
  if (userStore.isReady()) return userStore;
  /* 显式指定 mysql 却没连上 → 明确报错，不静默落文件 */
  if (config.USER_STORE === 'mysql') {
    const st = userStore.state();
    if (st.mode === 'error') {
      throw jsonError(503, '账号数据库(MySQL)不可用：' + (st.error || '未连接'),
        '配置 MYSQL_URL 或 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD；或改 USER_STORE=auto 自动回落文件存储');
    }
  }
  return fileAccount;
}

const account = {};
ACCOUNT_METHODS.forEach((name) => {
  account[name] = function () {
    const provider = accountProvider();
    return provider[name].apply(provider, arguments);
  };
});

account.initUserStore = async function () {
  if (!USE_MYSQL_USERS) {
    console.warn('[users] 当前账号存储：文件存储（USER_STORE=file，Render 重启会丢失）');
    return userStore.state();
  }
  const st = await userStore.init();
  const state = userStore.state();
  console.log('[users] 当前账号存储：' + (state.mode === 'mysql'
    ? 'MySQL（' + state.database + '）'
    : (state.mode === 'error' ? '不可用（MySQL 未连接）' : '文件存储（未入库，Render 重启可能丢失）')));
  return state;
};

account.userStoreState = function () {
  if (!USE_MYSQL_USERS) {
    return { mode: 'file', label: '文件存储', database: null, warning: '当前为文件存储，Render 重启可能丢失账号数据' };
  }
  return userStore.state();
};


if (USE_DB) {
  const db = require('./db');
  /* 启动时异步建表，不阻塞服务启动 */
  db.init().catch((e) => console.error('[db] 初始化失败，将回退行为：', e.message));

  module.exports = {
    dirs,
    storage: 'postgres',
    storageReady: () => db.isReady(),
    caps: db.caps,
    ensureDirs,
    readJson,
    writeJson,
    userStorageMode: () => account.userStoreState().mode,
    ...account,
    signToken,
    verifyToken,
    /* 作品 */
    listWorks: db.listWorks,
    upsertWork: db.upsertWork,
    removeWork: db.removeWork,
    clearWorks: db.clearWorks,
    /* 桌面 */
    getDesk: db.getDesk,
    saveDesk: db.saveDesk,
    /* 资产 */
    listAssets: db.listAssets,
    getAsset: db.getAsset,
    addAsset: db.addAsset,
    removeAsset: db.removeAsset,
    /* 项目 */
    listProjects: db.listProjects || null,
    getProject: db.getProject || null,
    createProject: db.createProject || null,
    updateProject: db.updateProject || null,
    deleteProject: db.deleteProject || null,
  };
} else {
  /* 未配置外部数据库 → 作品等本地 JSON 文件存储。Render 免费层重启会清空磁盘，
     数据会全部丢失。启动时明确告警，避免问题被静默忽略。 */
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    console.warn('[storage] 未配置 DATABASE_URL，作品/桌面使用本地 JSON 存储，服务器重启将丢失！请在环境变量中设置 DATABASE_URL。');
  }
  module.exports = {
    dirs,
    storage: 'json',
    storageReady: () => true,
    caps: { works: WORK_CAP, assets: ASSET_CAP },
    ensureDirs,
    readJson,
    writeJson,
    userStorageMode: () => account.userStoreState().mode,
    ...account,
    signToken,
    verifyToken,
    /* 作品 */
    listWorks,
    upsertWork,
    removeWork,
    clearWorks,
    /* 桌面 */
    getDesk,
    saveDesk,
    /* 资产 */
    listAssets,
    getAsset,
    addAsset,
    removeAsset,
    /* 项目 */
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
  };
}
