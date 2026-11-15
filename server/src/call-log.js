'use strict';

/* =============================================================
 * 绘梦 · 调用日志（真实落库）
 * -------------------------------------------------------------
 * 每次出图 / 视频 / 配音调用（成功或失败）都往 MySQL/TiDB 写一条，
 * 管理台通过 /api/admin/call-logs 读同一份数据，跨设备一致。
 *
 * 设计要点：
 *  - 写日志失败绝不影响主流程：record() 内部吞掉所有异常，只打 warn；
 *  - 表在首次写入时自动 CREATE TABLE IF NOT EXISTS（幂等）；
 *  - 建表 SQL 同时维护在 server/data/mysql/call-logs.sql，可重复执行。
 *  - 连接参数与 library-store 保持一致：MYSQL_URL 优先，否则 MYSQL_*。
 * ============================================================= */

const config = require('./config');

const TABLE = 'call_logs';
const MAX_PAGE_SIZE = 200;

let mysql2 = null;
let pool = null;
let initPromise = null;
let dbName = '';

function safeDbName(raw) {
  const value = String(raw || '').replace(/[^A-Za-z0-9_]/g, '');
  return value || 'huimeng_library';
}

/* 与 library-store.mysqlBaseOptions 相同的解析规则 */
function mysqlBaseOptions() {
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
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`created_at\` BIGINT NOT NULL COMMENT '毫秒时间戳',
  \`created_iso\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '可读时间',
  \`user_id\` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '用户 ID，未登录为空',
  \`username\` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '用户名快照',
  \`source\` VARCHAR(32) NOT NULL DEFAULT 'api' COMMENT '请求来源：web/api/admin/...',
  \`mode\` VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'image/video/audio',
  \`engine\` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '引擎：flux/openai/gpt-image/banana/zeling/edgetts/rayin',
  \`channel\` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '通道/供应商：rayin/zeling/edgetts/...',
  \`model\` VARCHAR(120) NOT NULL DEFAULT '' COMMENT '模型 ID',
  \`status\` VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'success/failed',
  \`http_status\` INT NOT NULL DEFAULT 0,
  \`duration_ms\` INT NOT NULL DEFAULT 0 COMMENT '耗时（毫秒）',
  \`tokens\` INT NOT NULL DEFAULT 0 COMMENT 'token 或等效消耗量，未知为 0',
  \`cost\` DECIMAL(12,6) NOT NULL DEFAULT 0 COMMENT '估算费用（元），未知为 0',
  \`error\` TEXT NULL COMMENT '失败原因',
  \`request_summary\` TEXT NULL COMMENT '请求摘要（JSON 文本）',
  \`response_summary\` TEXT NULL COMMENT '响应摘要（JSON 文本）',
  \`request_id\` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '请求追踪 ID',
  PRIMARY KEY (\`id\`),
  KEY \`idx_call_logs_created\` (\`created_at\`),
  KEY \`idx_call_logs_status\` (\`status\`),
  KEY \`idx_call_logs_model\` (\`model\`),
  KEY \`idx_call_logs_user\` (\`user_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调用日志（真实落库）'`;

async function ensure() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    mysql2 = mysql2 || require('mysql2/promise');
    const base = mysqlBaseOptions();

    /* 库名与图书馆库保持一致：MYSQL_DATABASE 优先，其次用连接串中的库 */
    dbName = safeDbName(config.MYSQL_DATABASE);
    if (config.MYSQL_URL) {
      const fromUrl = safeDbName(decodeURIComponent(new URL(config.MYSQL_URL).pathname.replace(/^\//, '')));
      if (fromUrl) dbName = fromUrl;
    }

    pool = mysql2.createPool(Object.assign({}, base, {
      database: dbName,
      waitForConnections: true,
      connectionLimit: 3,
      maxIdle: 3,
      idleTimeout: 60000,
      queueLimit: 0,
    }));

    try {
      await pool.query(CREATE_SQL);
    } catch (err) {
      /* 个别托管库不允许在连接串指定库里建表时，回落到 MYSQL_DATABASE 再试一次 */
      const fallback = safeDbName(config.MYSQL_DATABASE || 'huimeng_library');
      if (fallback !== dbName) {
        dbName = fallback;
        pool = mysql2.createPool(Object.assign({}, base, {
          database: dbName,
          waitForConnections: true,
          connectionLimit: 3,
          queueLimit: 0,
        }));
        await pool.query(CREATE_SQL);
      } else {
        throw err;
      }
    }
    console.log('[call-log] 日志表就绪：' + dbName + '.' + TABLE);
  })().catch((err) => {
    initPromise = null;
    console.error('[call-log] 初始化失败（不影响主流程）：' + (err && err.message));
    throw err;
  });
  return initPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 从 Authorization 头解析用户（不查库，失败不报错） */
function userFromRequest(req) {
  try {
    const header = (req && req.headers && req.headers.authorization) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return { id: '', username: '' };
    const store = require('./store');
    const payload = store.verifyToken(token);
    if (!payload || !payload.uid) return { id: '', username: '' };
    return { id: String(payload.uid).slice(0, 64), username: String(payload.username || '').slice(0, 128) };
  } catch (err) {
    return { id: '', username: '' };
  }
}

function clip(value, max) {
  const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
  return text.length > max ? text.slice(0, max) : text;
}

function jsonSummary(value, max) {
  if (value == null) return null;
  try {
    return clip(JSON.stringify(value), max);
  } catch (err) {
    return null;
  }
}

/* 根据生成请求推导日志上下文（路由层调用一次即可） */
function describe(req, body) {
  const b = body && typeof body === 'object' ? body : {};
  const user = userFromRequest(req);
  const mode = clip(b.mode || '', 16);
  const engine = clip(b.engine || (mode === 'video' ? 'zeling' : (mode === 'audio' ? 'edgetts' : 'flux')), 64);
  let channel = clip(b.channel || '', 64);
  if (!channel) {
    if (engine === 'edgetts' || String(b.model || '').indexOf('edgetts') >= 0) channel = 'edgetts';
    else if (engine === 'zeling' || mode === 'video') channel = 'zeling';
    else channel = 'rayin';
  }
  const model = clip(b.model || (b.provider && b.provider.model) || '', 120);
  const source = clip((req && req.headers && (req.headers['x-client'] || req.headers['x-source'])) || 'web', 32);
  const requestId = clip((req && req.headers && (req.headers['x-request-id'] || req.headers['x-trace-id'])) || '', 64);
  const promptText = b.prompt || b.text || '';
  const requestSummary = {
    mode,
    engine,
    model,
    prompt: clip(typeof promptText === 'string' ? promptText : '', 300),
    ratio: b.ratio || '',
    scale: b.scale || '',
    size: b.size || '',
    count: b.count || 0,
    duration: b.duration || 0,
    refImages: Array.isArray(b.refImages) ? b.refImages.length : 0,
    style: b.style || '',
    voice: b.voice || '',
    provider: b.provider && b.provider.model ? b.provider.model : '',
  };

  return {
    createdAt: Date.now(),
    userId: user.id,
    username: user.username,
    source: source || 'web',
    mode,
    engine,
    channel,
    model,
    requestId,
    requestSummary: jsonSummary(requestSummary, 2000),
  };
}

function summarizeItems(items) {
  if (!Array.isArray(items)) return jsonSummary(items, 1000);
  return jsonSummary({
    count: items.length,
    items: items.slice(0, 5).map((it) => ({
      type: (it && it.type) || '',
      url: clip((it && it.url) || '', 300),
      width: (it && it.width) || 0,
      height: (it && it.height) || 0,
      duration: (it && it.duration) || 0,
    })),
  }, 2000);
}

async function insert(entry) {
  await ensure();
  const row = {
    created_at: Number(entry.createdAt) || Date.now(),
    user_id: clip(entry.userId || '', 64),
    username: clip(entry.username || '', 128),
    source: clip(entry.source || 'api', 32),
    mode: clip(entry.mode || '', 16),
    engine: clip(entry.engine || '', 64),
    channel: clip(entry.channel || '', 64),
    model: clip(entry.model || '', 120),
    status: clip(entry.status || '', 16),
    http_status: Number(entry.httpStatus) || 0,
    duration_ms: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    tokens: Math.max(0, Math.round(Number(entry.tokens) || 0)),
    cost: Number.isFinite(Number(entry.cost)) ? Number(entry.cost) : 0,
    error: entry.error ? clip(String(entry.error), 4000) : null,
    request_summary: entry.requestSummary || null,
    response_summary: entry.responseSummary || null,
    request_id: clip(entry.requestId || '', 64),
  };
  await pool.query(
    'INSERT INTO `' + TABLE + '` (' +
      'created_at, user_id, username, source, mode, engine, channel, model, status, ' +
      'http_status, duration_ms, tokens, cost, error, request_summary, response_summary, request_id' +
    ') VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [row.created_at, row.user_id, row.username, row.source, row.mode, row.engine, row.channel, row.model,
      row.status, row.http_status, row.duration_ms, row.tokens, row.cost, row.error,
      row.request_summary, row.response_summary, row.request_id]
  );
  return row;
}

/* 写一条日志。永远不抛异常、最多等 timeoutMs（默认 3s），不影响主流程。 */
async function record(entry, timeoutMs) {
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 3000;
  const writing = insert(entry).catch((err) => {
    console.warn('[call-log] 写入失败（已忽略）：' + (err && err.message));
    return null;
  });
  await Promise.race([writing, sleep(limit)]);
  return writing;
}

function toInt(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/* 解析时间参数：支持毫秒时间戳或 ISO 字符串 */
function toMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

function mapRow(row) {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    time: new Date(Number(row.created_at)).toISOString(),
    userId: row.user_id || '',
    username: row.username || '',
    account: row.username || row.user_id || '匿名',
    source: row.source || '',
    mode: row.mode || '',
    engine: row.engine || '',
    channel: row.channel || '',
    model: row.model || '',
    modelKey: row.model || '',
    status: row.status || '',
    httpStatus: Number(row.http_status) || 0,
    responseCode: Number(row.http_status) || 0,
    durationMs: Number(row.duration_ms) || 0,
    duration: Math.round((Number(row.duration_ms) || 0) / 100) / 10,
    tokens: Number(row.tokens) || 0,
    cost: Number(row.cost) || 0,
    error: row.error || '',
    requestSummary: row.request_summary ? safeParse(row.request_summary) : null,
    responseSummary: row.response_summary ? safeParse(row.response_summary) : null,
    requestId: row.request_id || '',
  };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (err) { return text; }
}

/* 查询：时间范围 / 状态 / 模型 / 用户 / 关键词 + 分页，按时间倒序 */
async function query(params) {
  const p = params || {};
  await ensure();

  const where = [];
  const args = [];
  const from = toMs(p.from || p.start);
  const to = toMs(p.to || p.end);
  if (from != null) { where.push('created_at >= ?'); args.push(from); }
  if (to != null) { where.push('created_at <= ?'); args.push(to); }
  const status = String(p.status || '').trim();
  if (status) {
    /* 兼容前端中文状态：成功/失败 */
    const normalized = status === '成功' || status === 'success' ? 'success' : (status === '失败' || status === 'failed' ? 'failed' : status);
    where.push('status = ?');
    args.push(normalized);
  }
  const model = String(p.model || '').trim();
  if (model) { where.push('model = ?'); args.push(model); }
  const userId = String(p.user || p.userId || '').trim();
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  const username = String(p.username || '').trim();
  if (username) { where.push('username = ?'); args.push(username); }
  const keyword = String(p.q || '').trim();
  if (keyword) {
    where.push('(username LIKE ? OR model LIKE ? OR error LIKE ?)');
    const like = '%' + keyword + '%';
    args.push(like, like, like);
  }

  const page = Math.max(1, toInt(p.page, 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(p.pageSize || p.limit, 20)));
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM `' + TABLE + '`' + whereSql, args);
  const total = Number((countRows && countRows[0] && countRows[0].total) || 0);
  const [rows] = await pool.query(
    'SELECT * FROM `' + TABLE + '`' + whereSql + ' ORDER BY id DESC LIMIT ? OFFSET ?',
    args.concat([pageSize, (page - 1) * pageSize])
  );

  return {
    rows: rows.map(mapRow),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    filters: { from: from == null ? null : from, to: to == null ? null : to, status, model, user: userId, q: keyword },
  };
}

/* 汇总（管理台概览用）：今天调用数与估算费用 */
async function stats() {
  await ensure();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS calls, SUM(CASE WHEN status = \'success\' THEN 1 ELSE 0 END) AS successCalls, ' +
    'SUM(CASE WHEN status = \'failed\' THEN 1 ELSE 0 END) AS failedCalls, SUM(cost) AS cost, AVG(duration_ms) AS avgMs ' +
    'FROM `' + TABLE + '` WHERE created_at >= ?',
    [dayStart.getTime()]
  );
  const r = (rows && rows[0]) || {};
  return {
    date: dayStart.toISOString().slice(0, 10),
    calls: Number(r.calls) || 0,
    successCalls: Number(r.successCalls) || 0,
    failedCalls: Number(r.failedCalls) || 0,
    cost: Number(r.cost) || 0,
    avgMs: Math.round(Number(r.avgMs) || 0),
  };
}

function status() {
  return { table: TABLE, database: dbName || safeDbName(config.MYSQL_DATABASE), ready: Boolean(initPromise) };
}

module.exports = {
  TABLE,
  CREATE_SQL,
  ensure,
  describe,
  summarizeItems,
  record,
  query,
  stats,
  status,
};
