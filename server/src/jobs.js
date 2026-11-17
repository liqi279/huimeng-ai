'use strict';

/* =============================================================
 * 绘梦 · 异步生成任务表
 * -------------------------------------------------------------
 * 为什么需要它：生图是 20~60s 的长任务，浏览器/网关的单次长连接
 * 在 30s 附近会被中间层掐断。改成「提交即返回 jobId + 后台执行 +
 * 前端轮询」，任务状态落库，连接断掉也不影响结果。
 *
 * 只复用现有 MySQL（与 user_documents / call_logs 同库），
 * 表在首次写入时 CREATE TABLE IF NOT EXISTS，无需手工迁移。
 * ============================================================= */

const config = require('./config');

let mysql2 = null;
let pool = null;
let ready = null;
let dbName = '';

const TABLE = 'generate_jobs';

function safeDbName(raw) {
  const value = String(raw || '').replace(/[^A-Za-z0-9_]/g, '');
  return value || 'huimeng_library';
}

function baseOptions() {
  const connectTimeout = Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 5000);
  if (config.MYSQL_URL) {
    const u = new URL(config.MYSQL_URL);
    const opts = {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      charset: 'utf8mb4',
      connectTimeout,
    };
    const ssl = u.searchParams.get('ssl') || u.searchParams.get('sslmode');
    if (ssl && ssl !== 'disable' && ssl !== 'false') opts.ssl = { rejectUnauthorized: false };
    return opts;
  }
  return {
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    charset: 'utf8mb4',
    connectTimeout,
  };
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
  \`id\` VARCHAR(40) NOT NULL,
  \`user_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
  \`idem_key\` VARCHAR(120) NULL,
  \`payload\` LONGTEXT NULL,
  \`user_info\` LONGTEXT NULL,
  \`result\` LONGTEXT NULL,
  \`error\` LONGTEXT NULL,
  \`created_at\` BIGINT NOT NULL DEFAULT 0,
  \`updated_at\` BIGINT NOT NULL DEFAULT 0,
  \`duration_ms\` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_generate_jobs_idem\` (\`idem_key\`),
  KEY \`idx_generate_jobs_created\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function getPool() {
  if (!mysql2) mysql2 = require('mysql2/promise');
  if (!pool) pool = mysql2.createPool(Object.assign(baseOptions(), {
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
  }));
  return pool;
}

function connect() {
  if (!ready) {
    ready = (async () => {
      const p = await getPool();
      const conn = await p.getConnection();
      try {
        dbName = safeDbName((await conn.query('SELECT DATABASE() AS db'))[0][0].db);
        await conn.query(CREATE_SQL);
        /* 老表补列/补唯一键：已有部署建过不带 idem_key 的表时自动升级，
           失败（列/键已存在）忽略即可。幂等键是「一次提交只调一次上游」的保证。 */
        try { await conn.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`idem_key\` VARCHAR(120) NULL`); } catch (e) {}
        try { await conn.query(`ALTER TABLE \`${TABLE}\` ADD UNIQUE KEY \`uk_generate_jobs_idem\` (\`idem_key\`)`); } catch (e) {}
      } finally {
        conn.release();
      }
      return p;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

async function create({ id, userId, payload, user, idemKey }) {
  const p = await connect();
  const now = Date.now();
  try {
    await p.query(
      `INSERT INTO \`${TABLE}\` (id, user_id, status, idem_key, payload, user_info, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [id, userId || '', idemKey || null, JSON.stringify(payload || {}), JSON.stringify(user || null), now, now],
    );
  } catch (err) {
    /* 幂等键撞车 = 同一份提交重复到达，直接返回已有任务，不再建新任务 */
    if (err && err.code === 'ER_DUP_ENTRY' && idemKey) {
      const existing = await getByIdem(idemKey, userId);
      if (existing) return existing;
    }
    throw err;
  }
  return { id, status: 'pending', created: true };
}

/* 领取任务：只有 pending → running 这一次能成功。
   返回 false 表示别的执行实例已经领走，本次必须直接退出，
   避免同一次提交被上游调用两次（会重复扣费）。 */
async function markRunning(id) {
  const p = await connect();
  const [res] = await p.query(
    `UPDATE \`${TABLE}\` SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`,
    [Date.now(), id],
  );
  return Number(res && res.affectedRows) === 1;
}

async function complete(id, result, durationMs) {
  const p = await connect();
  await p.query(
    `UPDATE \`${TABLE}\` SET status = 'done', result = ?, error = NULL, duration_ms = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(result || null), Math.round(durationMs || 0), Date.now(), id],
  );
}

async function fail(id, error, durationMs) {
  const p = await connect();
  await p.query(
    `UPDATE \`${TABLE}\` SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(error || null), Math.round(durationMs || 0), Date.now(), id],
  );
}

async function getByIdem(idemKey, userId) {
  if (!idemKey) return null;
  const p = await connect();
  const [rows] = await p.query(`SELECT * FROM \`${TABLE}\` WHERE idem_key = ? LIMIT 1`, [String(idemKey)]);
  return shape(rows && rows[0], userId);
}

function shape(row, userId) {
  if (!row) return null;
  if (userId !== undefined && String(row.user_id || '') !== String(userId || '')) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    payload: parseJson(row.payload),
    user: parseJson(row.user_info),
    result: parseJson(row.result),
    error: parseJson(row.error),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    durationMs: Number(row.duration_ms) || 0,
  };
}

async function get(id, userId) {
  if (!id) return null;
  const p = await connect();
  const [rows] = await p.query(`SELECT * FROM \`${TABLE}\` WHERE id = ? LIMIT 1`, [String(id)]);
  return shape(rows && rows[0], userId);
}

module.exports = { create, markRunning, complete, fail, get, getByIdem };
