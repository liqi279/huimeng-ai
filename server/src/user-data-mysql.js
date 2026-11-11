'use strict';

/* =============================================================
 * 绘梦 · 用户作品/项目数据 MySQL 层
 * -------------------------------------------------------------
 * 表结构以 data/用户数据信息/huimeng_user_data.sql 为准，启动时幂等建表。
 * 与账号表同库（USERS_MYSQL_DATABASE），复用 user-store-mysql 的连接池。
 *
 * 同步模型：
 *   - 每条作品/文档带单调递增 rev + updated_at
 *   - 客户端提交 baseRev，不匹配返回 409（冲突），由前端决定覆盖或采纳服务端
 *   - 删除写墓碑（deleted=1 + rev），保证其它设备增量拉取时能感知删除
 *   - 二进制只记 object_key，正文 JSON 里只存 url（/api/user-data/assets/<id>）
 * ============================================================= */

const crypto = require('crypto');
const config = require('./config');
const userStore = require('./user-store-mysql');
const { jsonError } = require('./http');

const DOC_KINDS = ['desk', 'compile', 'publish', 'prefs', 'library', 'draft'];

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS user_works (
    user_id VARCHAR(40) NOT NULL,
    work_id VARCHAR(64) NOT NULL,
    data JSON NOT NULL,
    asset_key VARCHAR(255) NULL,
    asset_mime VARCHAR(100) NULL,
    asset_bytes BIGINT NOT NULL DEFAULT 0,
    rev BIGINT NOT NULL DEFAULT 1,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, work_id),
    KEY idx_work_updated (user_id, updated_at),
    KEY idx_work_deleted (user_id, deleted),
    CONSTRAINT fk_work_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_documents (
    user_id VARCHAR(40) NOT NULL,
    doc_kind VARCHAR(32) NOT NULL,
    data JSON NOT NULL,
    rev BIGINT NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, doc_kind),
    CONSTRAINT fk_doc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_assets (
    id VARCHAR(64) NOT NULL,
    user_id VARCHAR(40) NOT NULL,
    work_id VARCHAR(64) NULL,
    object_key VARCHAR(255) NOT NULL,
    mime VARCHAR(100) NULL,
    bytes BIGINT NOT NULL DEFAULT 0,
    sha256 CHAR(64) NULL,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_asset_user (user_id, created_at),
    KEY idx_asset_work (user_id, work_id),
    CONSTRAINT fk_asset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_sync_state (
    user_id VARCHAR(40) NOT NULL,
    state_key VARCHAR(64) NOT NULL,
    state_value VARCHAR(255) NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, state_key),
    CONSTRAINT fk_sync_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let initPromise = null;

function q(sql, params) {
  return userStore.q(sql, params);
}

async function init() {
  if (!userStore.isReady()) return { ok: false, error: '账号库未使用 MySQL，用户数据回落文件存储' };
  if (initPromise) return initPromise;
  initPromise = (async () => {
    for (const sql of SCHEMA_SQL) await q(sql);
    console.log('[user-data] MySQL 表结构已就绪（user_works / user_documents / user_assets / user_sync_state）');
    await purgeTombstones().catch(() => {});
    return { ok: true };
  })();
  return initPromise;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return null; }
}

function rowToWork(row) {
  return {
    id: row.work_id,
    data: parseJson(row.data) || {},
    rev: Number(row.rev) || 1,
    deleted: Number(row.deleted) === 1,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    assetKey: row.asset_key || null,
    assetMime: row.asset_mime || null,
    assetBytes: Number(row.asset_bytes) || 0,
  };
}

/* ---------------- 作品 ---------------- */
async function listChanges(userId, since, limit) {
  const sinceTs = Number(since) || 0;
  const max = Math.max(1, Math.min(Number(limit) || 200, 500));
  /* 未删除作品与墓碑分开取，各自 LIMIT：墓碑不再占用 items 的额度。
     src 用于区分来源行，便于分别判断某一类是否被截断。 */
  const [rows] = await q(
    `SELECT * FROM (
       (SELECT 'live' AS src, work_id, data, asset_key, asset_mime, asset_bytes, rev, deleted, created_at, updated_at
          FROM user_works WHERE user_id = ? AND updated_at > ? AND deleted = 0
         ORDER BY updated_at ASC LIMIT ?)
       UNION ALL
       (SELECT 'tomb' AS src, work_id, data, asset_key, asset_mime, asset_bytes, rev, deleted, created_at, updated_at
          FROM user_works WHERE user_id = ? AND updated_at > ? AND deleted = 1
         ORDER BY updated_at ASC LIMIT ?)
     ) t ORDER BY updated_at ASC`,
    [userId, sinceTs, max, userId, sinceTs, max]
  );
  const live = rows.filter((r) => r.src === 'live');
  const tomb = rows.filter((r) => r.src === 'tomb');
  /* 某类被 limit 截断时，游标取「各自最后一条」中较小的那个，
     保证下一次增量不会跳过另一类还没发出去的记录（墓碑重复下发无害）。 */
  const caps = [];
  if (live.length >= max) caps.push(Number(live[live.length - 1].updated_at) || sinceTs);
  if (tomb.length >= max) caps.push(Number(tomb[tomb.length - 1].updated_at) || sinceTs);
  return {
    items: live.map(rowToWork),
    deleted: tomb.map((row) => ({
      id: row.work_id, rev: Number(row.rev) || 1, updatedAt: Number(row.updated_at) || 0,
    })),
    cursor: caps.length
      ? Math.min.apply(null, caps)
      : (rows.length ? Number(rows[rows.length - 1].updated_at) || sinceTs : sinceTs),
    hasMore: caps.length > 0,
  };
}

async function getWork(userId, workId) {
  const [rows] = await q(
    'SELECT * FROM user_works WHERE user_id = ? AND work_id = ? LIMIT 1',
    [userId, workId]
  );
  return rows[0] ? rowToWork(rows[0]) : null;
}

async function putWork(userId, work, baseRev) {
  const now = Date.now();
  const workId = String(work.id).slice(0, 64);
  const current = await getWork(userId, workId);
  if (current && baseRev != null && Number(baseRev) !== current.rev && !current.deleted) {
    throw jsonError(409, '作品已被其它设备修改（版本冲突）', '请刷新后重试');
  }
  const payload = JSON.stringify(work);
  if (current) {
    await q(
      `UPDATE user_works SET data = CAST(? AS JSON), rev = rev + 1, deleted = 0, updated_at = ?
        WHERE user_id = ? AND work_id = ?`,
      [payload, now, userId, workId]
    );
  } else {
    await q(
      `INSERT INTO user_works (user_id, work_id, data, rev, deleted, created_at, updated_at)
       VALUES (?, ?, CAST(? AS JSON), 1, 0, ?, ?)`,
      [userId, workId, payload, Number(work.createdAt) || now, now]
    );
  }
  const saved = await getWork(userId, workId);
  const trim = await enforceWorkCap(userId).catch(() => ({ removed: [] }));
  if (saved) saved._trimmed = trim.removed;
  return saved;
}

async function enforceWorkCap(userId) {
  const cap = Math.max(1, Number(config.USER_WORK_CAP) || 500);
  const [rows] = await q(
    'SELECT work_id, asset_key FROM user_works WHERE user_id = ? AND deleted = 0 ORDER BY updated_at DESC',
    [userId]
  );
  if (rows.length <= cap) return { removed: [] };
  const overflow = rows.slice(cap);
  const removed = [];
  for (const row of overflow) {
    const [assets] = await q(
      'SELECT object_key FROM user_assets WHERE user_id = ? AND work_id = ? AND deleted = 0',
      [userId, row.work_id]
    );
    removed.push({
      id: row.work_id,
      assetKey: row.asset_key,
      objectKeys: assets.map((a) => a.object_key).filter(Boolean),
    });
    await q('DELETE FROM user_assets WHERE user_id = ? AND work_id = ?', [userId, row.work_id]);
    await q('DELETE FROM user_works WHERE user_id = ? AND work_id = ?', [userId, row.work_id]);
  }
  /* 超容量时清理对象存储里的图片由上层完成（见 user-data.js） */
  return { removed };
}

async function deleteWork(userId, workId, baseRev) {
  const current = await getWork(userId, workId);
  if (!current) {
    await q(
      `INSERT INTO user_works (user_id, work_id, data, rev, deleted, created_at, updated_at)
       VALUES (?, ?, CAST('{}' AS JSON), 1, 1, ?, ?)
       ON DUPLICATE KEY UPDATE rev = rev + 1, deleted = 1, updated_at = VALUES(updated_at)`,
      [userId, workId, Date.now(), Date.now()]
    );
    return { ok: true, rev: 1, alreadyDeleted: false };
  }
  if (current.deleted) return { ok: true, rev: current.rev, alreadyDeleted: true };
  if (baseRev != null && Number(baseRev) !== current.rev) {
    throw jsonError(409, '作品已被其它设备修改（版本冲突）', '请刷新后重试');
  }
  await q(
    `UPDATE user_works SET data = CAST('{}' AS JSON), deleted = 1, rev = rev + 1, updated_at = ?
      WHERE user_id = ? AND work_id = ?`,
    [Date.now(), userId, workId]
  );
  return { ok: true, rev: current.rev + 1, assetKey: current.assetKey };
}

async function clearWorks(userId) {
  const [rows] = await q(
    'SELECT work_id, asset_key FROM user_works WHERE user_id = ? AND deleted = 0',
    [userId]
  );
  for (const row of rows) {
    await deleteWork(userId, row.work_id, null);
  }
  return rows.map((r) => ({ id: r.work_id, assetKey: r.asset_key }));
}

/* ---------------- 文档（desk/compile/publish/prefs） ---------------- */
function assertKind(kind) {
  if (DOC_KINDS.indexOf(kind) < 0) throw jsonError(400, '不支持的数据类型：' + kind);
}

async function getDoc(userId, kind) {
  assertKind(kind);
  const [rows] = await q(
    'SELECT data, rev, updated_at FROM user_documents WHERE user_id = ? AND doc_kind = ? LIMIT 1',
    [userId, kind]
  );
  if (!rows[0]) return { kind, data: null, rev: 0, updatedAt: 0 };
  return {
    kind,
    data: parseJson(rows[0].data),
    rev: Number(rows[0].rev) || 1,
    updatedAt: Number(rows[0].updated_at) || 0,
  };
}

async function putDoc(userId, kind, data, baseRev) {
  assertKind(kind);
  const payload = JSON.stringify(data == null ? null : data);
  if (Buffer.byteLength(payload, 'utf8') > config.USER_DOC_MAX_BYTES) {
    throw jsonError(413, '数据过大', '单个文档不能超过 ' + Math.round(config.USER_DOC_MAX_BYTES / 1024 / 1024) + 'MB');
  }
  const current = await getDoc(userId, kind);
  if (current.rev && baseRev != null && Number(baseRev) !== current.rev) {
    throw jsonError(409, '数据已被其它设备修改（版本冲突）', '请刷新后重试');
  }
  const now = Date.now();
  await q(
    `INSERT INTO user_documents (user_id, doc_kind, data, rev, updated_at)
     VALUES (?, ?, CAST(? AS JSON), 1, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), rev = rev + 1, updated_at = VALUES(updated_at)`,
    [userId, kind, payload, now]
  );
  return getDoc(userId, kind);
}

/* ---------------- 资产元数据 ---------------- */
async function saveAsset(asset) {
  await q(
    `INSERT INTO user_assets (id, user_id, work_id, object_key, mime, bytes, sha256, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE object_key = VALUES(object_key), mime = VALUES(mime),
       bytes = VALUES(bytes), sha256 = VALUES(sha256), deleted = 0`,
    [asset.id, asset.userId, asset.workId || null, asset.objectKey, asset.mime || null,
     Number(asset.bytes) || 0, asset.sha256 || null, Number(asset.createdAt) || Date.now()]
  );
  return asset;
}

async function getAsset(assetId) {
  const [rows] = await q('SELECT * FROM user_assets WHERE id = ? LIMIT 1', [assetId]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    workId: r.work_id,
    objectKey: r.object_key,
    mime: r.mime,
    bytes: Number(r.bytes) || 0,
    sha256: r.sha256,
    deleted: Number(r.deleted) === 1,
    createdAt: Number(r.created_at) || 0,
  };
}

async function removeAsset(userId, assetId) {
  const asset = await getAsset(assetId);
  if (!asset || asset.userId !== userId) return null;
  await q('UPDATE user_assets SET deleted = 1 WHERE id = ?', [assetId]);
  return asset;
}

async function listAssets(userId) {
  const [rows] = await q(
    'SELECT * FROM user_assets WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    workId: r.work_id,
    objectKey: r.object_key,
    mime: r.mime,
    bytes: Number(r.bytes) || 0,
    createdAt: Number(r.created_at) || 0,
  }));
}

async function usage(userId) {
  const [w] = await q('SELECT COUNT(*) AS c FROM user_works WHERE user_id = ? AND deleted = 0', [userId]);
  const [a] = await q(
    'SELECT COUNT(*) AS c, COALESCE(SUM(bytes),0) AS b FROM user_assets WHERE user_id = ? AND deleted = 0',
    [userId]
  );
  return {
    works: Number(w[0] && w[0].c) || 0,
    assets: Number(a[0] && a[0].c) || 0,
    bytes: Number(a[0] && a[0].b) || 0,
    workCap: config.USER_WORK_CAP,
    assetMaxBytes: config.USER_ASSET_MAX_BYTES,
    storageMaxBytes: config.USER_STORAGE_MAX_BYTES,
  };
}

/* ---------------- 同步状态 ---------------- */
async function setState(userId, key, value) {
  await q(
    `INSERT INTO user_sync_state (user_id, state_key, state_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
    [userId, key, value == null ? null : String(value).slice(0, 255), Date.now()]
  );
}

async function getState(userId, key) {
  const [rows] = await q(
    'SELECT state_value FROM user_sync_state WHERE user_id = ? AND state_key = ? LIMIT 1',
    [userId, key]
  );
  return rows[0] ? rows[0].state_value : null;
}

/* ---------------- 备份 / 清理 ---------------- */
async function exportAll(userId) {
  const [workRows] = await q('SELECT * FROM user_works WHERE user_id = ?', [userId]);
  const [docRows] = await q('SELECT * FROM user_documents WHERE user_id = ?', [userId]);
  const assets = await listAssets(userId);
  return {
    exportedAt: new Date().toISOString(),
    storage: 'mysql',
    userId,
    works: workRows.map(rowToWork),
    docs: docRows.map((r) => ({
      kind: r.doc_kind, data: parseJson(r.data), rev: Number(r.rev), updatedAt: Number(r.updated_at),
    })),
    assets,
  };
}

async function purgeTombstones() {
  const days = Math.max(1, Number(config.USER_TOMBSTONE_DAYS) || 30);
  const before = Date.now() - days * 24 * 3600 * 1000;
  await q('DELETE FROM user_works WHERE deleted = 1 AND updated_at < ?', [before]);
}

function newId(prefix) {
  return (prefix || 'a') + '_' + crypto.randomBytes(12).toString('hex');
}

module.exports = {
  mode: 'mysql',
  init,
  DOC_KINDS,
  listChanges,
  getWork,
  putWork,
  deleteWork,
  clearWorks,
  getDoc,
  putDoc,
  saveAsset,
  getAsset,
  removeAsset,
  listAssets,
  usage,
  setState,
  getState,
  exportAll,
  newId,
};
