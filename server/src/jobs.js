'use strict';

/* =============================================================
 * 绘梦 · 异步生成任务表
 * -------------------------------------------------------------
 * 生图是 20~60s 的长任务，浏览器/网关的单次长连接在 30s 附近会被掐断。
 * 改成「提交即返回 jobId + 后台执行 + 前端轮询」，任务状态落库，
 * 连接断掉也不影响结果。
 *
 * 连接必须复用账号库的连接池（user-store-mysql.q）：
 *   它按 MYSQL_URL 的 path 或 USERS_MYSQL_DATABASE 选中数据库。
 *   之前这里自己 createPool 且没设 database，CREATE TABLE 直接报
 *   ER_NO_DB_ERROR（1046 No database selected），提交接口必然 500。
 * ============================================================= */

const userStore = require('./user-store-mysql');

const TABLE = 'generate_jobs';

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

let ready = null;

/* 建表/补列只做一次；失败不缓存，下次请求重试 */
function ensure() {
  if (!ready) {
    ready = (async () => {
      await userStore.q(CREATE_SQL);
      /* 老表补列/补唯一键（已存在则忽略）。幂等键保证「一次提交只调一次上游」。 */
      try { await userStore.q(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`idem_key\` VARCHAR(120) NULL`); } catch (e) {}
      try { await userStore.q(`ALTER TABLE \`${TABLE}\` ADD UNIQUE KEY \`uk_generate_jobs_idem\` (\`idem_key\`)`); } catch (e) {}
      return true;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function q(sql, params) {
  await ensure();
  return userStore.q(sql, params);
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
  const now = Date.now();
  try {
    await q(
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
  const [res] = await q(
    `UPDATE \`${TABLE}\` SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`,
    [Date.now(), id],
  );
  return Number(res && res.affectedRows) === 1;
}

async function complete(id, result, durationMs) {
  await q(
    `UPDATE \`${TABLE}\` SET status = 'done', result = ?, error = NULL, duration_ms = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(result || null), Math.round(durationMs || 0), Date.now(), id],
  );
}

async function fail(id, error, durationMs) {
  await q(
    `UPDATE \`${TABLE}\` SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(error || null), Math.round(durationMs || 0), Date.now(), id],
  );
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

async function getByIdem(idemKey, userId) {
  if (!idemKey) return null;
  const [rows] = await q(`SELECT * FROM \`${TABLE}\` WHERE idem_key = ? LIMIT 1`, [String(idemKey)]);
  return shape(rows && rows[0], userId);
}

async function get(id, userId) {
  if (!id) return null;
  const [rows] = await q(`SELECT * FROM \`${TABLE}\` WHERE id = ? LIMIT 1`, [String(id)]);
  return shape(rows && rows[0], userId);
}

/* 已完成任务（供「测试图补进桌面」使用） */
async function listDone(userId, limit) {
  const n = Math.max(1, Math.min(Number(limit) || 60, 200));
  const [rows] = await q(
    `SELECT id, user_id, result, created_at FROM \`${TABLE}\`
     WHERE status = 'done' AND user_id = ? AND result IS NOT NULL
     ORDER BY created_at DESC LIMIT ${n}`,
    [String(userId || '')],
  );
  return (rows || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    result: parseJson(row.result),
    createdAt: Number(row.created_at) || 0,
  }));
}

/* 队列兜底：事件调用没能把 jobId 带进来时，worker 自己从表里领一条 pending。
   两步走：先按 created_at 取最老的几条，再靠 markRunning 的原子抢占确认，
   抢不到就换下一条。并发多个 worker 也不会把同一条任务跑两次（不会重复扣费）。 */
async function claimNextPending(limit) {
  const n = Math.max(1, Math.min(5, Number(limit) || 3));
  const [rows] = await q(
    `SELECT * FROM \`${TABLE}\` WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${n}`,
  );
  for (const row of rows || []) {
    const claimed = await markRunning(row.id);
    if (claimed) return shape(row);
  }
  return null;
}

module.exports = { create, markRunning, complete, fail, get, getByIdem, listDone, claimNextPending };
