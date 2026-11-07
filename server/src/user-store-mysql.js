'use strict';

/* =============================================================
 * 绘梦 · 用户数据 MySQL 存储层
 * -------------------------------------------------------------
 * 账号、审批状态、用户资料、用户偏好全部落 MySQL。
 * 连接参数（优先级从高到低）：
 *   MYSQL_URL=mysql://user:pass@host:3306/huimeng_users
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD + USERS_MYSQL_DATABASE
 *
 * 设计原则：
 *   1. 有 MySQL 就用 MySQL；连不上时抛 503（明确报错），不退化成内存。
 *   2. 首次启动自动建库建表（幂等），表结构以 data/用户数据信息/huimeng_users.sql 为准。
 *   3. 首次启用时若表为空，把老的 data/runtime/users.json 迁移进表（全部 approved）。
 *   4. 每次账号变更后额外导出一份 JSON 快照到数据目录，便于备份/恢复。
 * ============================================================= */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { jsonError } = require('./http');

const USERS_BACKUP_FILE = path.join(config.DATA_DIR, 'users.export.json');
const LEGACY_USERS_FILE = path.join(config.DATA_DIR, 'users.json');
const LEGACY_MIGRATED_FILE = path.join(config.DATA_DIR, 'users.migrated.json');

let mysql2 = null;
let pool = null;
let initPromise = null;
let lastAttempt = 0;
const state = { mode: 'pending', error: null };

/* ---------------- 建表（与 SQL 脚本等价，幂等） ---------------- */
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(40) NOT NULL,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(190) NULL,
    salt VARCHAR(64) NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    role ENUM('user','admin') NOT NULL DEFAULT 'user',
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
    note VARCHAR(255) NULL,
    created_at BIGINT NOT NULL,
    approved_at BIGINT NULL,
    approved_by VARCHAR(40) NULL,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_username (username),
    UNIQUE KEY uk_email (email),
    KEY idx_status (status),
    KEY idx_role (role),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id VARCHAR(40) NOT NULL,
    display_name VARCHAR(64) NULL,
    email VARCHAR(190) NULL,
    bio VARCHAR(500) NULL,
    avatar_url VARCHAR(500) NULL,
    extra JSON NULL,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id VARCHAR(40) NOT NULL,
    theme VARCHAR(32) NULL,
    language VARCHAR(16) NULL,
    prefs JSON NULL,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_quota_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id VARCHAR(40) NOT NULL,
    delta INT NOT NULL,
    reason VARCHAR(120) NULL,
    ref_type VARCHAR(32) NULL,
    ref_id VARCHAR(64) NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_ledger_user (user_id, created_at),
    CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/* 兼容早期没有 status 等字段的 users 表 */
const EXTRA_COLUMNS = [
  ['email', 'ALTER TABLE users ADD COLUMN email VARCHAR(190) NULL'],
  ['status', "ALTER TABLE users ADD COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'"],
  ['note', 'ALTER TABLE users ADD COLUMN note VARCHAR(255) NULL'],
  ['approved_at', 'ALTER TABLE users ADD COLUMN approved_at BIGINT NULL'],
  ['approved_by', 'ALTER TABLE users ADD COLUMN approved_by VARCHAR(40) NULL'],
  ['updated_at', 'ALTER TABLE users ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0'],
  ['password_hash', 'ALTER TABLE users ADD COLUMN password_hash VARCHAR(128) NOT NULL DEFAULT \'\''],
];

/* ---------------- 连接 ---------------- */
function databaseName() {
  return config.USERS_MYSQL_DATABASE || 'huimeng_users';
}

function parseMysqlUrl(url) {
  const u = new URL(url);
  const opts = {
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    charset: 'utf8mb4',
  };
  const dbFromPath = u.pathname.replace(/^\//, '');
  if (dbFromPath) opts.database = decodeURIComponent(dbFromPath);
  const ssl = u.searchParams.get('ssl') || u.searchParams.get('sslmode');
  if (ssl && ssl !== 'disable' && ssl !== 'false') {
    opts.ssl = { rejectUnauthorized: false };
  }
  return opts;
}

function connectionOptions(withDatabase) {
  const base = config.MYSQL_URL
    ? parseMysqlUrl(config.MYSQL_URL)
    : {
        host: config.MYSQL_HOST,
        port: config.MYSQL_PORT,
        user: config.MYSQL_USER,
        password: config.MYSQL_PASSWORD,
        charset: 'utf8mb4',
      };
  if (withDatabase === false) delete base.database;
  else base.database = base.database || databaseName();
  return base;
}

function safeIdent(name) {
  return String(name).replace(/[^A-Za-z0-9_]/g, '');
}

async function ensureSchema() {
  let conn;
  try {
    conn = await mysql2.createConnection(connectionOptions(true));
  } catch (err) {
    /* 库不存在时先用无库连接创建（没有权限就抛出原始错误） */
    if (!err || err.code !== 'ER_BAD_DB_ERROR') throw err;
    const boot = await mysql2.createConnection(connectionOptions(false));
    try {
      await boot.query(
        'CREATE DATABASE IF NOT EXISTS `' + safeIdent(databaseName()) +
        '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } finally {
      await boot.end().catch(() => {});
    }
    conn = await mysql2.createConnection(connectionOptions(true));
  }

  try {
    for (const sql of SCHEMA_SQL) await conn.query(sql);

    const [cols] = await conn.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [databaseName(), 'users']
    );
    const existing = new Set(cols.map((c) => String(c.COLUMN_NAME || '').toLowerCase()));
    for (const [name, sql] of EXTRA_COLUMNS) {
      if (!existing.has(name)) await conn.query(sql).catch(() => {});
    }
  } finally {
    await conn.end().catch(() => {});
  }
}

/* ---------------- 初始化 ---------------- */
async function init() {
  if (state.mode === 'mysql') return state;
  if (initPromise) return initPromise;
  if (state.mode === 'error' && Date.now() - lastAttempt < 60000) return state;

  lastAttempt = Date.now();
  initPromise = (async () => {
    try {
      if (config.USER_STORE === 'file') {
        state.mode = 'file';
        state.error = 'USER_STORE=file（显式使用本地 JSON）';
        console.warn('[users] USER_STORE=file：账号落本地 JSON 文件，Render 重启会丢失。');
        return state;
      }
      try {
        mysql2 = require('mysql2/promise');
      } catch (err) {
        throw new Error('未安装 mysql2，请在 server/ 执行 npm install mysql2');
      }

      await ensureSchema();

      pool = mysql2.createPool(Object.assign({}, connectionOptions(true), {
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: 'utf8mb4',
      }));
      await pool.query('SELECT 1');

      state.mode = 'mysql';
      state.error = null;
      console.log('[users] MySQL 已连接：' + (config.MYSQL_URL ? 'MYSQL_URL' : (config.MYSQL_HOST + ':' + config.MYSQL_PORT)) +
        '/' + databaseName());

      await migrateLegacyUsers().catch((err) => {
        console.error('[users] 旧账号迁移失败：' + (err && err.message));
      });
      await migrateFromPg().catch((err) => {
        console.error('[users] PostgreSQL 账号迁移失败：' + (err && err.message));
      });
    } catch (err) {
      state.error = (err && err.message) ? err.message : String(err);
      if (config.USER_STORE === 'auto') {
        /* auto：不让注册/登录不可用，明确告警后回落文件存储 */
        state.mode = 'file';
        console.warn('[users] MySQL 不可用（' + state.error + '），已按 USER_STORE=auto 回落到文件存储 ' +
          LEGACY_USERS_FILE + '。⚠ Render 重启/重新部署会丢失，配置 MYSQL_URL 后可在账号管理页一键迁移入库。');
      } else {
        state.mode = 'error';
        console.error('[users] USER_STORE=mysql 但账号数据库不可用：' + state.error);
        console.error('[users] 登录/注册/审批接口将返回 503。请配置 MYSQL_URL 或 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD；' +
          '也可改成 USER_STORE=auto 临时回落文件存储。');
      }
    }
    return state;
  })();
  return initPromise;
}

function ready() {
  if (state.mode !== 'mysql' || !pool) {
    throw jsonError(503,
      '账号数据库暂不可用：' + (state.error || '未初始化'),
      '请在后端配置 MySQL（MYSQL_URL 或 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/USERS_MYSQL_DATABASE）');
  }
}

async function q(sql, params) {
  await init();
  ready();
  return pool.query(sql, params);
}

/* ---------------- 密码 / 序列化 ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return h === hash;
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
    createdAt: Number(u.created_at) || 0,
    approvedAt: u.approved_at == null ? null : Number(u.approved_at),
    approvedBy: u.approved_by || null,
    updatedAt: Number(u.updated_at) || 0,
  };
}

/* ---------------- 账号 CRUD ---------------- */
async function listUsers() {
  const [rows] = await q(
    `SELECT id, username, email, salt, password_hash, role, status, note,
            created_at, approved_at, approved_by, updated_at
     FROM users ORDER BY created_at ASC`
  );
  return rows;
}

async function listPendingUsers() {
  const [rows] = await q(
    `SELECT id, username, email, role, status, note, created_at
     FROM users WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return rows.map(sanitizeUser);
}

async function findUserByUsername(username) {
  const [rows] = await q('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await q('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function createUser(input) {
  const { username, password, role, status, email, note } = input || {};
  const name = String(username || '').trim();
  const existing = await findUserByUsername(name);
  if (existing) return { ok: false, error: '用户名已存在' };

  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const finalStatus = normalizeStatus(status);
  const user = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    username: name,
    email: email ? String(email).trim().slice(0, 190) : null,
    salt,
    hash,
    role: role === 'admin' ? 'admin' : 'user',
    status: finalStatus,
    note: note || null,
    created_at: now,
    approved_at: finalStatus === 'approved' ? now : null,
    approved_by: null,
    updated_at: now,
  };

  try {
    await q(
      `INSERT INTO users (id, username, email, salt, password_hash, role, status, note,
                          created_at, approved_at, approved_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.username, user.email, user.salt, user.hash, user.role, user.status,
       user.note, user.created_at, user.approved_at, user.approved_by, user.updated_at]
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      const dupEmail = /uk_email/.test(err.message || '');
      return { ok: false, error: dupEmail ? '邮箱已被使用' : '用户名已存在' };
    }
    throw err;
  }

  backupSoon();
  return { ok: true, user: sanitizeUser(user) };
}

/* Render 重启后 token 仍有效但账号记录丢失时，用 token 里的信息把账号补回来（视为已通过） */
async function reviveUser(uid, username, role) {
  const existing = await findUserById(uid);
  if (existing) return sanitizeUser(existing);
  const now = Date.now();
  const user = {
    id: uid,
    username: String(username || '').trim(),
    salt: crypto.randomBytes(16).toString('hex'),
    hash: '',
    role: role === 'admin' ? 'admin' : 'user',
    status: 'approved',
    created_at: now,
    updated_at: now,
  };
  await q(
    `INSERT IGNORE INTO users (id, username, salt, password_hash, role, status, created_at, approved_at, updated_at)
     VALUES (?, ?, ?, '', ?, 'approved', ?, ?, ?)`,
    [user.id, user.username, user.salt, user.role, user.created_at, now, now]
  ).catch(() => {});
  backupSoon();
  return sanitizeUser(user);
}

async function authenticateUser(username, password) {
  const user = await findUserByUsername(String(username || '').trim());
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.password_hash)) return null;
  return sanitizeUser(user);
}

async function updateUserRole(id, role) {
  const [res] = await q(
    'UPDATE users SET role = ?, updated_at = ? WHERE id = ?',
    [role === 'admin' ? 'admin' : 'user', Date.now(), id]
  );
  if (!res.affectedRows) return { ok: false, error: '用户不存在' };
  backupSoon();
  return { ok: true, user: sanitizeUser(await findUserById(id)) };
}

async function setUserStatus(id, status, actorId, note) {
  const target = normalizeStatus(status);
  const now = Date.now();
  const [res] = await q(
    `UPDATE users
        SET status = ?, note = ?, approved_at = ?, approved_by = ?, updated_at = ?
      WHERE id = ?`,
    [target, note || null, target === 'approved' ? now : null, target === 'approved' ? (actorId || null) : null, now, id]
  );
  if (!res.affectedRows) return { ok: false, error: '用户不存在' };
  backupSoon();
  return { ok: true, user: sanitizeUser(await findUserById(id)) };
}

async function resetUserPassword(id, newPassword) {
  const { salt, hash } = hashPassword(newPassword);
  const [res] = await q(
    'UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?',
    [salt, hash, Date.now(), id]
  );
  if (!res.affectedRows) return { ok: false, error: '用户不存在' };
  backupSoon();
  return { ok: true };
}

async function deleteUser(id) {
  const [res] = await q('DELETE FROM users WHERE id = ?', [id]);
  if (!res.affectedRows) return { ok: false, error: '用户不存在' };
  backupSoon();
  return { ok: true };
}

async function countPendingUsers() {
  const [rows] = await q("SELECT COUNT(*) AS c FROM users WHERE status = 'pending'");
  return Number(rows[0] && rows[0].c) || 0;
}

async function countAdmins() {
  const [rows] = await q("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'approved'");
  return Number(rows[0] && rows[0].c) || 0;
}

/* ---------------- 用户资料 / 偏好 ---------------- */
async function getProfile(userId) {
  const [rows] = await q('SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1', [userId]);
  const row = rows[0] || null;
  if (!row) return { userId, displayName: '', email: '', bio: '', avatarUrl: '', extra: {}, updatedAt: 0 };
  let extra = {};
  try { extra = row.extra ? (typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra) : {}; } catch (e) {}
  return {
    userId: row.user_id,
    displayName: row.display_name || '',
    email: row.email || '',
    bio: row.bio || '',
    avatarUrl: row.avatar_url || '',
    extra: extra || {},
    updatedAt: Number(row.updated_at) || 0,
  };
}

async function updateProfile(userId, patch) {
  const current = await getProfile(userId);
  const next = {
    displayName: patch.displayName == null ? current.displayName : String(patch.displayName).slice(0, 64),
    email: patch.email == null ? current.email : String(patch.email).slice(0, 190),
    bio: patch.bio == null ? current.bio : String(patch.bio).slice(0, 500),
    avatarUrl: patch.avatarUrl == null ? current.avatarUrl : String(patch.avatarUrl).slice(0, 500),
    extra: patch.extra && typeof patch.extra === 'object' ? patch.extra : current.extra,
    updatedAt: Date.now(),
  };
  await q(
    `INSERT INTO user_profiles (user_id, display_name, email, bio, avatar_url, extra, updated_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), email = VALUES(email),
       bio = VALUES(bio), avatar_url = VALUES(avatar_url), extra = VALUES(extra), updated_at = VALUES(updated_at)`,
    [userId, next.displayName, next.email, next.bio, next.avatarUrl, JSON.stringify(next.extra || {}), next.updatedAt]
  );
  return getProfile(userId);
}

async function getPreferences(userId) {
  const [rows] = await q('SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1', [userId]);
  const row = rows[0] || null;
  let prefs = {};
  try { prefs = row && row.prefs ? (typeof row.prefs === 'string' ? JSON.parse(row.prefs) : row.prefs) : {}; } catch (e) {}
  return {
    userId,
    theme: (row && row.theme) || '',
    language: (row && row.language) || '',
    prefs: prefs || {},
    updatedAt: row ? Number(row.updated_at) || 0 : 0,
  };
}

async function updatePreferences(userId, patch) {
  const current = await getPreferences(userId);
  const next = {
    theme: patch.theme == null ? current.theme : String(patch.theme).slice(0, 32),
    language: patch.language == null ? current.language : String(patch.language).slice(0, 16),
    prefs: patch.prefs && typeof patch.prefs === 'object' ? Object.assign({}, current.prefs, patch.prefs) : current.prefs,
    updatedAt: Date.now(),
  };
  await q(
    `INSERT INTO user_preferences (user_id, theme, language, prefs, updated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE theme = VALUES(theme), language = VALUES(language),
       prefs = VALUES(prefs), updated_at = VALUES(updated_at)`,
    [userId, next.theme, next.language, JSON.stringify(next.prefs || {}), next.updatedAt]
  );
  return getPreferences(userId);
}

/* ---------------- 备份导出 ---------------- */
async function exportUsers() {
  await init();
  ready();
  const [rows] = await q(
    `SELECT id, username, email, salt, password_hash, role, status, note,
            created_at, approved_at, approved_by, updated_at
     FROM users ORDER BY created_at ASC`
  );
  return {
    exportedAt: new Date().toISOString(),
    storage: 'mysql',
    database: databaseName(),
    count: rows.length,
    users: rows,
  };
}

let backupTimer = null;
function backupSoon() {
  if (backupTimer) return;
  backupTimer = setTimeout(async () => {
    backupTimer = null;
    try {
      const snapshot = await exportUsers();
      await fsp.mkdir(config.DATA_DIR, { recursive: true });
      const tmp = USERS_BACKUP_FILE + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      await fsp.rename(tmp, USERS_BACKUP_FILE);
    } catch (err) {
      console.warn('[users] 备份导出失败：' + (err && err.message));
    }
  }, 500);
  if (backupTimer.unref) backupTimer.unref();
}

/* PostgreSQL 里的历史 users 表（早期 DATABASE_URL 模式）→ MySQL，避免老用户登录失效 */
async function migrateFromPg() {
  if (!config.DATABASE_URL) return { migrated: 0, total: 0, skipped: true };
  const [rows] = await q('SELECT COUNT(*) AS c FROM users');
  if (Number(rows[0] && rows[0].c) > 0) return { migrated: 0, total: 0, skipped: true };

  let pg = null;
  try {
    pg = require('pg');
  } catch (err) {
    return { migrated: 0, total: 0, skipped: true, error: '未安装 pg，跳过 PostgreSQL 迁移' };
  }

  const useSsl = /sslmode=(require|prefer)/.test(config.DATABASE_URL);
  const client = new pg.Client({
    connectionString: config.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  let migrated = 0;
  let total = 0;
  try {
    const result = await client.query('SELECT id, username, salt, hash, role, created_at FROM users');
    total = result.rows.length;
    for (const u of result.rows) {
      if (!u.id || !u.username) continue;
      const createdAt = Number(u.created_at) || Date.now();
      const [res] = await q(
        `INSERT IGNORE INTO users
          (id, username, salt, password_hash, role, status, note, created_at, approved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'approved', '从 PostgreSQL 迁移', ?, ?, ?)`,
        [
          String(u.id).slice(0, 40),
          String(u.username).slice(0, 64),
          String(u.salt || ''),
          String(u.hash || ''),
          u.role === 'admin' ? 'admin' : 'user',
          createdAt,
          createdAt,
          Date.now(),
        ]
      );
      if (res && res.affectedRows) migrated++;
    }
  } finally {
    await client.end().catch(() => {});
  }
  if (migrated) {
    console.log(`[users] 已从 PostgreSQL 迁移 ${migrated} 个账号到 MySQL（状态=approved，密码不变）`);
    backupSoon();
  }
  return { migrated, total };
}

/* ---------------- 老 JSON 账号迁移 / 同步进库 ---------------- */
async function migrateLegacyUsers(force) {
  const [rows] = await q('SELECT COUNT(*) AS c FROM users');
  const existing = Number(rows[0] && rows[0].c) > 0;
  if (existing && !force) return { migrated: 0, total: 0, skipped: true };

  let legacy = null;
  try {
    legacy = JSON.parse(await fsp.readFile(LEGACY_USERS_FILE, 'utf8'));
  } catch (err) {
    return { migrated: 0, total: 0, skipped: true, error: '未找到 ' + LEGACY_USERS_FILE };
  }
  if (!Array.isArray(legacy) || !legacy.length) return { migrated: 0, total: 0 };

  let migrated = 0;
  for (const u of legacy) {
    if (!u || !u.id || !u.username) continue;
    const createdAt = Number(u.createdAt) || Date.now();
    const status = normalizeStatus(u.status);
    const [res] = await q(
      `INSERT IGNORE INTO users
        (id, username, email, salt, password_hash, role, status, note, created_at, approved_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(u.id).slice(0, 40),
        String(u.username).slice(0, 64),
        u.email ? String(u.email).slice(0, 190) : null,
        String(u.salt || ''),
        String(u.hash || u.password_hash || ''),
        u.role === 'admin' ? 'admin' : 'user',
        status,
        u.note ? String(u.note).slice(0, 255) : '从文件存储同步',
        createdAt,
        status === 'approved' ? (Number(u.approvedAt) || createdAt) : null,
        Date.now(),
      ]
    );
    if (res && res.affectedRows) migrated++;
  }

  if (migrated && !force) {
    try {
      await fsp.rename(LEGACY_USERS_FILE, LEGACY_MIGRATED_FILE);
    } catch (err) {
      try { await fsp.copyFile(LEGACY_USERS_FILE, LEGACY_MIGRATED_FILE); } catch (e) {}
    }
  }
  if (migrated) {
    console.log(`[users] 已从文件存储同步 ${migrated}/${legacy.length} 个账号到 MySQL（保留盐/哈希/状态）`);
    backupSoon();
  }
  return { migrated, total: legacy.length };
}

function currentState() {
  const mode = state.mode === 'mysql' ? 'mysql' : (state.mode === 'error' ? 'error' : 'file');
  return {
    mode,
    error: state.error,
    database: mode === 'mysql' ? databaseName() : null,
    label: mode === 'mysql' ? 'MySQL' : (mode === 'error' ? '不可用' : '文件存储'),
    warning: mode === 'mysql' ? ''
      : (mode === 'error' ? '账号数据库不可用，请检查 MySQL 配置' : '当前为文件存储，Render 重启可能丢失账号数据'),
  };
}

module.exports = {
  init,
  state: currentState,
  isReady: () => state.mode === 'mysql',
  /* 账号 */
  listUsers,
  listPendingUsers,
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
  /* 文件 → MySQL 同步 */
  migrateFromFile: () => migrateLegacyUsers(true),
  /* 资料 / 偏好 */
  getProfile,
  updateProfile,
  getPreferences,
  updatePreferences,
  /* 备份 */
  exportUsers,
};
