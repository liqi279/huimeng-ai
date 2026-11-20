'use strict';

/* =============================================================
 * 绘梦 · 外部 PostgreSQL 数据访问层
 * 当 config.DATABASE_URL 被设置时启用，所有数据持久化到外部数据库，
 * Render 免费层重启不再丢失用户/作品/桌面/资产数据。
 * 不设置时 store.js 自动回退到本地 JSON 文件。
 * ============================================================= */
const { Pool } = require('pg');
const config = require('./config');
const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');

const WORK_CAP = 200;
const ASSET_CAP = 200;

let pool = null;
let initPromise = null;
let ready = false;

function getPool() {
  if (!pool) {
    /* Neon / Supabase 的连接串需要 sslmode=require；pg 默认不强制，
       这里显式开启 SSL（rejectUnauthorized: false 兼容自签证书） */
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

/* 启动时建表（IF NOT EXISTS，幂等） */
async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const client = await getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          salt TEXT NOT NULL,
          hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS works (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          data JSONB NOT NULL,
          created_at BIGINT NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);
        CREATE TABLE IF NOT EXISTS desk (
          user_id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at BIGINT NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          created_at BIGINT NOT NULL DEFAULT 0
        );
      `);
      console.log('[db] PostgreSQL 表结构已就绪');
      /* 若数据库为空但磁盘上还有旧版 JSON 数据，自动导入一次，
         避免“从 JSON 切到 PG”时历史数据看起来消失 */
      await migrateLegacy(client).catch((e) => console.error('[db] 旧数据迁移失败:', e.message));
      ready = true;
    } finally {
      client.release();
    }
  })();
  return initPromise;
}

/* 旧版 JSON 存储（data/ 目录）→ PostgreSQL 一次性迁移。
   仅在 DB 中 users 表为空时执行，避免覆盖已有数据。 */
async function migrateLegacy(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0] && rows[0].c > 0) return;

  const dataDir = config.DATA_DIR;
  const usersFile = path.join(dataDir, 'users.json');

  let legacyUsers = null;
  try {
    legacyUsers = JSON.parse(await fsp.readFile(usersFile, 'utf8'));
  } catch (e) { return; }
  if (!Array.isArray(legacyUsers) || !legacyUsers.length) return;

  let users = 0;
  let works = 0;
  let desks = 0;
  let assets = 0;

  for (const u of legacyUsers) {
    if (!u || !u.id || !u.username) continue;
    await client.query(
      `INSERT INTO users (id, username, salt, hash, role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.salt || '', u.hash || '', u.role === 'admin' ? 'admin' : 'user', Number(u.createdAt) || 0]
    );
    users++;

    /* 该用户的作品/桌面 */
    const wf = path.join(dataDir, 'users', String(u.id), 'works.json');
    const df = path.join(dataDir, 'users', String(u.id), 'desk.json');
    let wl = [];
    let desk = null;
    try { wl = JSON.parse(await fsp.readFile(wf, 'utf8')); } catch (e) {}
    try { desk = JSON.parse(await fsp.readFile(df, 'utf8')); } catch (e) {}
    if (Array.isArray(wl)) {
      for (const w of wl) {
        if (!w || typeof w.id !== 'string') continue;
        await client.query(
          `INSERT INTO works (id, user_id, data, created_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [w.id, u.id, w, workTime(w)]
        );
        works++;
      }
    }
    if (desk && typeof desk === 'object') {
      await client.query(
        `INSERT INTO desk (user_id, data, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id, desk, Number(desk.updatedAt) || 0]
      );
      desks++;
    }
  }

  /* 全局作品（未登录时保存的旧数据） */
  try {
    const gl = JSON.parse(await fsp.readFile(path.join(dataDir, 'works.json'), 'utf8'));
    if (Array.isArray(gl)) {
      for (const w of gl) {
        if (!w || typeof w.id !== 'string') continue;
        await client.query(
          `INSERT INTO works (id, user_id, data, created_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [w.id, null, w, workTime(w)]
        );
        works++;
      }
    }
  } catch (e) {}

  /* 资产 */
  try {
    const al = JSON.parse(await fsp.readFile(path.join(dataDir, 'assets.json'), 'utf8'));
    if (Array.isArray(al)) {
      for (const a of al) {
        if (!a || !a.id) continue;
        await client.query(
          `INSERT INTO assets (id, data, created_at) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO NOTHING`,
          [a.id, a, Number(a.createdAt) || Date.now()]
        );
        assets++;
      }
    }
  } catch (e) {}

  console.log(`[db] 已从本地 JSON 迁移：用户 ${users}、作品 ${works}、桌面 ${desks}、资产 ${assets}`);
}

/* 是否已完成建表（health 诊断用） */
function isReady() { return ready; }

/* 统一查询入口：确保建表完成后再执行 */
async function q(sql, params) {
  await init();
  return getPool().query(sql, params);
}

function workTime(w) {
  const v = w && w.createdAt;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

/* -------------- 用户 CRUD -------------- */
async function listUsers() {
  const { rows } = await q('SELECT id, username, salt, hash, role, created_at FROM users ORDER BY created_at ASC');
  return rows;
}

async function findUserByUsername(username) {
  const { rows } = await q('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await q('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function createUser({ username, password, role }) {
  const existing = await findUserByUsername(username);
  if (existing) return { ok: false, error: '用户名已存在' };
  const { salt, hash } = hashPassword(password);
  const user = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    username: String(username).trim(),
    salt,
    hash,
    role: role === 'admin' ? 'admin' : 'user',
    created_at: Date.now(),
  };
  await q(
    'INSERT INTO users (id, username, salt, hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [user.id, user.username, user.salt, user.hash, user.role, user.created_at]
  );
  return { ok: true, user: sanitizeUser(user) };
}

async function reviveUser(uid, username, role) {
  const existing = await findUserById(uid);
  if (existing) return sanitizeUser(existing);
  const user = {
    id: uid,
    username: String(username).trim(),
    salt: crypto.randomBytes(16).toString('hex'),
    hash: '',
    role: role === 'admin' ? 'admin' : 'user',
    created_at: Date.now(),
  };
  try {
    await q(
      'INSERT INTO users (id, username, salt, hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [user.id, user.username, user.salt, user.hash, user.role, user.created_at]
    );
  } catch (e) {
    /* 并发插入冲突忽略 */
  }
  return sanitizeUser(user);
}

function sanitizeUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, createdAt: u.created_at };
}

async function authenticateUser(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return sanitizeUser(user);
}

async function updateUserRole(id, role) {
  const { rowCount } = await q(
    'UPDATE users SET role = $1 WHERE id = $2',
    [role === 'admin' ? 'admin' : 'user', id]
  );
  if (!rowCount) return { ok: false, error: '用户不存在' };
  const u = await findUserById(id);
  return { ok: true, user: sanitizeUser(u) };
}

async function resetUserPassword(id, newPassword) {
  const { salt, hash } = hashPassword(newPassword);
  const { rowCount } = await q(
    'UPDATE users SET salt = $1, hash = $2 WHERE id = $3',
    [salt, hash, id]
  );
  if (!rowCount) return { ok: false, error: '用户不存在' };
  return { ok: true };
}

async function deleteUser(id) {
  const { rowCount } = await q('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) return { ok: false, error: '用户不存在' };
  /* 级联清理该用户的作品与桌面 */
  await q('DELETE FROM works WHERE user_id = $1', [id]);
  await q('DELETE FROM desk WHERE user_id = $1', [id]);
  return { ok: true };
}

/* -------------- 作品（按用户隔离）-------------- */
async function listWorks(userId) {
  const { rows } = userId
    ? await q('SELECT data FROM works WHERE user_id = $1 ORDER BY created_at DESC', [userId])
    : await q('SELECT data FROM works WHERE user_id IS NULL ORDER BY created_at DESC');
  return rows.map((r) => r.data);
}

async function upsertWork(userId, work) {
  const createdAt = workTime(work);
  await q(
    `INSERT INTO works (id, user_id, data, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at`,
    [work.id, userId, work, createdAt]
  );
  /* 超过上限时清理最旧的（用户维度） */
  if (userId) {
    await q(
      `DELETE FROM works WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM works WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
      [userId, WORK_CAP]
    );
  }
  return work;
}

async function removeWork(userId, id) {
  const { rowCount } = userId
    ? await q('DELETE FROM works WHERE id = $1 AND user_id = $2', [id, userId])
    : await q('DELETE FROM works WHERE id = $1 AND user_id IS NULL', [id]);
  return rowCount > 0;
}

async function clearWorks(userId) {
  if (userId) await q('DELETE FROM works WHERE user_id = $1', [userId]);
  else await q('DELETE FROM works WHERE user_id IS NULL');
  return true;
}

/* -------------- 桌面布局 -------------- */
async function getDesk(userId) {
  const key = userId || '__global__';
  const { rows } = await q('SELECT data FROM desk WHERE user_id = $1 LIMIT 1', [key]);
  if (rows[0]) return rows[0].data;
  return { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 };
}

async function saveDesk(userId, desk) {
  const key = userId || '__global__';
  const next = {
    folders: Array.isArray(desk && desk.folders) ? desk.folders : [],
    positions: (desk && desk.positions) || {},
    assigns: (desk && desk.assigns) || {},
    names: (desk && desk.names) || {},
    updatedAt: Date.now(),
  };
  await q(
    `INSERT INTO desk (user_id, data, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [key, next, next.updatedAt]
  );
  return next;
}

/* -------------- 资产 -------------- */
async function listAssets() {
  const { rows } = await q('SELECT data FROM assets ORDER BY created_at DESC');
  return rows.map((r) => r.data);
}

async function getAsset(id) {
  const { rows } = await q('SELECT data FROM assets WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ? rows[0].data : null;
}

async function addAsset(asset) {
  const createdAt = Number(asset.createdAt) || Date.now();
  await q(
    `INSERT INTO assets (id, data, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
    [asset.id, asset, createdAt]
  );
  /* 超上限清理最旧 */
  await q(
    `DELETE FROM assets WHERE id NOT IN (SELECT id FROM assets ORDER BY created_at DESC LIMIT $1)`,
    [ASSET_CAP]
  );
  return asset;
}

async function removeAsset(id) {
  const { rows } = await q('SELECT data FROM assets WHERE id = $1 LIMIT 1', [id]);
  if (!rows[0]) return null;
  await q('DELETE FROM assets WHERE id = $1', [id]);
  return rows[0].data;
}

/* 密码哈希（与 store.js 保持一致，独立实现避免循环依赖） */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return h === hash;
}

module.exports = {
  init,
  isReady,
  caps: { works: WORK_CAP, assets: ASSET_CAP },
  /* 用户 */
  listUsers,
  findUserByUsername,
  findUserById,
  createUser,
  reviveUser,
  authenticateUser,
  updateUserRole,
  resetUserPassword,
  deleteUser,
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
