'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

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
function createUser({ username, password, role }) {
  return enqueue(async () => {
    const list = await listUsers();
    if (list.some((u) => u && u.username === username)) {
      return { ok: false, error: '用户名已存在' };
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username: String(username).trim(),
      salt,
      hash,
      role: role === 'admin' ? 'admin' : 'user',
      createdAt: Date.now(),
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
function sanitizeUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt };
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

module.exports = {
  dirs,
  caps: { works: WORK_CAP, assets: ASSET_CAP },
  ensureDirs,
  readJson,
  writeJson,
  /* 用户系统 */
  listUsers,
  findUserByUsername,
  findUserById,
  createUser,
  authenticateUser,
  updateUserRole,
  resetUserPassword,
  deleteUser,
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
};
