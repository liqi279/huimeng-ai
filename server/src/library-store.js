'use strict';

/* =============================================================
 * 绘梦 · 图书馆数据层
 *
 * 优先 MySQL（data/mysql/schema.sql + data/library/books.seed.json）
 * MySQL 不可用时自动回退到 data/library/*.json 文件存储，
 * 保证「图书馆」在本地开发、GitHub Pages 静态演示、Render 上都能用。
 *
 * 环境变量见 server/src/config.js 的 LIBRARY_* / MYSQL_*。
 * ============================================================= */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const LIB_DIR = path.join(config.DATA_ROOT, 'library');
const SEED_FILE = path.join(LIB_DIR, 'books.seed.json');
const BOOKS_FILE = path.join(LIB_DIR, 'books.json');
const FAV_FILE = path.join(LIB_DIR, 'favorites.json');
const HIST_FILE = path.join(LIB_DIR, 'reading-history.json');

/* schema.sql 有两份可能位置：DATA_ROOT（Render 上是仓库 data/），
   以及代码包自带的 server/data/mysql/（SCF 里 DATA_ROOT=/tmp 不会包含它）。
   先找 DATA_ROOT，再回落到代码目录，两处都没有才跳过建表。 */
function resolveSchemaFile() {
  const candidates = [
    path.join(config.DATA_ROOT, 'mysql', 'schema.sql'),
    path.join(__dirname, '..', 'data', 'mysql', 'schema.sql'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return candidates[0];
}
const SCHEMA_FILE = resolveSchemaFile();

const info = {
  mode: 'file',
  storageLimit: config.LIBRARY_STORAGE_LIMIT,
  mysqlError: null,
  /* 降级状态：MySQL 连不上时置 true，恢复后自动清除。
     以前失败会永久缓存成 file 模式，导致书架只剩 4 本种子书且再也不会重连。 */
  degraded: false,
  initialized: false,
  retryCount: 0,
  lastAttemptAt: 0,
  nextRetryAt: 0,
  database: '',
};

let pool = null;
let initPromise = null;
let mysql2 = null;
let started = false;
/* 退避：1s / 3s / 10s / 30s / 60s，之后固定 60s；只重试、不永久放弃 */
const RETRY_DELAYS = [1000, 3000, 10000, 30000, 60000];

/* ---------------- 通用 ---------------- */
function now() { return Date.now(); }

function readJSON(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) { return fallback; }
}

async function writeJSON(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function splitTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags || '').split(/[,，、|]/).map((t) => t.trim()).filter(Boolean);
}

/* 目录（toc）：PDF 书签解析出来的章节 [{ title, page }]，page 从 1 开始。
   存 MySQL 时是一段 JSON 文本；没有目录的书返回空数组，前端按「无目录」处理。 */
function normalizeToc(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (err) { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v.map((it) => ({
    title: String((it && it.title) || '').trim().slice(0, 200),
    page: Math.max(1, Math.floor(Number(it && it.page) || 1)),
  })).filter((it) => it.title).slice(0, 500);
}

function normalizeBook(row, pages) {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    author: String(row.author || ''),
    category: String(row.category || '未分类'),
    tags: splitTags(row.tags),
    intro: String(row.intro || ''),
    accent: String(row.accent || '#7d5a3c'),
    coverUrl: String(row.cover_url || row.coverUrl || ''),
    /* 区域：ref/psd/anim/paint/concept；老数据没有该字段时为空字符串 */
    area: String(row.area || ''),
    /* PDF 只存地址，正文放对象存储；TiDB 单行默认 6MB，绝不能把 PDF 塞进表 */
    pdfUrl: String(row.pdf_url || row.pdfUrl || ''),
    /* PDF 真实页数（阅读器底部「第 X / Y 页」用），未知时为 0 */
    pageCount: Number(row.page_count == null ? row.pageCount || 0 : row.page_count),
    /* 章节目录：PDF 书签解析结果，没有就是空数组 */
    toc: normalizeToc(row.toc == null ? row.tocList : row.toc),
    sortNo: Number(row.sort_no == null ? row.sortNo || 0 : row.sort_no),
    createdAt: Number(row.created_at == null ? row.createdAt || 0 : row.created_at),
    updatedAt: Number(row.updated_at == null ? row.updatedAt || 0 : row.updated_at),
    pages: (pages || []).map((p) => ({
      pageNo: Number(p.page_no == null ? p.pageNo : p.page_no),
      title: String(p.title || ''),
      content: String(p.content || ''),
    })),
  };
}

/* 图书馆五区：ref 参考 / psd 源文件 / anim 动画 / paint 绘画教程 / concept 概念设定 */
const AREAS = ['ref', 'psd', 'anim', 'paint', 'concept'];

function validateBookInput(body) {
  const data = body && typeof body === 'object' ? body : {};
  const title = String(data.title || '').trim();
  if (!title) {
    const err = new Error('书名不能为空');
    err.status = 400;
    throw err;
  }
  if (title.length > 120) {
    const err = new Error('书名过长（最多 120 字）');
    err.status = 400;
    throw err;
  }
  const pages = Array.isArray(data.pages) ? data.pages : [];
  if (pages.length > 400) {
    const err = new Error('页数过多（最多 400 页）');
    err.status = 400;
    throw err;
  }
  return {
    title,
    author: String(data.author || '').trim().slice(0, 120),
    category: String(data.category || '未分类').trim().slice(0, 60),
    tags: splitTags(data.tags).slice(0, 8),
    intro: String(data.intro || '').slice(0, 2000),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(data.accent || '')) ? data.accent : '#7d5a3c',
    coverUrl: String(data.coverUrl || '').slice(0, 500),
    area: AREAS.includes(String(data.area || '')) ? String(data.area) : '',
    pdfUrl: String(data.pdfUrl || '').slice(0, 500),
    /* 真实页数：PDF 页数，0 表示未知；正文仍只放对象存储 */
    pageCount: Math.max(0, Math.min(100000, Math.floor(Number(data.pageCount) || 0))),
    /* 章节目录：只接受 [{ title, page }]，非法结构按空目录处理 */
    toc: normalizeToc(data.toc),
    /* 书架排序：越小越靠前，默认 0；用于把新书固定在该区第一架 */
    sortNo: Number.isFinite(Number(data.sortNo)) ? Number(data.sortNo) : 0,
    pages: pages.slice(0, 400).map((p, i) => ({
      pageNo: i + 1,
      title: String((p && p.title) || '第 ' + (i + 1) + ' 页').slice(0, 120),
      content: String((p && p.content) || '').slice(0, 20000),
    })),
  };
}

function makeId() {
  return 'lib-' + now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

/* =============================================================
 * MySQL 实现
 * ============================================================= */
/* 连接参数：MYSQL_URL 优先（云上只有这一条连接串），否则用 MYSQL_* 单字段。
   TiDB Cloud / 托管 MySQL 通常要求 TLS，连接串里带 ssl=true 时按需开启。 */
function mysqlBaseOptions() {
  /* 连接超时压短：降级重试是在请求里顺手做的，不能让一个请求卡太久 */
  const connectTimeout = Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 5000);
  if (config.MYSQL_URL) {
    const u = new URL(config.MYSQL_URL);
    const opts = {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      charset: 'utf8mb4',
      multipleStatements: true,
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
    multipleStatements: true,
    connectTimeout,
  };
}

/* 早期 books 表没有 area / pdf_url，启动时做一次幂等补列（TiDB 与 MySQL 通用） */
const EXTRA_BOOK_COLUMNS = [
  ['area', "ADD COLUMN area VARCHAR(16) NOT NULL DEFAULT '' COMMENT '区域：ref/psd/anim/paint/concept'"],
  ['pdf_url', "ADD COLUMN pdf_url VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'PDF 地址（正文放大文件存储，不入库）'"],
  ['page_count', "ADD COLUMN page_count INT NOT NULL DEFAULT 0 COMMENT 'PDF 真实页数，0 表示未知'"],
  ['toc', "ADD COLUMN toc LONGTEXT NULL COMMENT '章节目录 JSON：[{title,page}]'"],
];

async function ensureColumns(conn, dbName) {
  const [cols] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
    [dbName, 'books']
  );
  const have = new Set(cols.map((c) => c.COLUMN_NAME));
  for (const [name, ddl] of EXTRA_BOOK_COLUMNS) {
    if (!have.has(name)) {
      await conn.query('ALTER TABLE `' + dbName + '`.books ' + ddl);
      console.log('[library] books 表补列：' + name);
    }
  }
}

async function ensureMysql() {
  if (config.LIBRARY_STORE === 'file') throw new Error('LIBRARY_STORE=file');
  try {
    mysql2 = require('mysql2/promise');
  } catch (err) {
    throw new Error('未安装 mysql2（在 server/ 执行 npm install mysql2）');
  }

  const base = mysqlBaseOptions();
  let dbName = String(config.MYSQL_DATABASE || 'huimeng_library').replace(/[^A-Za-z0-9_]/g, '');
  if (!dbName) dbName = 'huimeng_library';

  /* 先无库连接：建库 → 建表 → 补列 */
  const boot = await mysql2.createConnection(base);
  try {
    try {
      await boot.query(
        'CREATE DATABASE IF NOT EXISTS `' + dbName + '` ' +
        'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } catch (err) {
      /* 托管库常不授予 CREATE DATABASE：退回连接串里的已有库 */
      if (!config.MYSQL_URL) throw err;
      const fromUrl = decodeURIComponent(new URL(config.MYSQL_URL).pathname.replace(/^\//, ''));
      if (!fromUrl) throw err;
      dbName = fromUrl.replace(/[^A-Za-z0-9_]/g, '');
      console.warn('[library] 无建库权限，books 表建到已有库：' + dbName);
    }
    await boot.query('USE `' + dbName + '`');
    /* schema.sql 自带的 CREATE DATABASE / USE 去掉，统一在选定库里执行。
       SCF 代码包里没有 data/ 目录（只有 server/），schema.sql 不存在时直接复用已有库表，
       否则会因 ENOENT 误判 MySQL 不可用并回退到空文件存储。 */
    if (fs.existsSync(SCHEMA_FILE)) {
      const schema = fs.readFileSync(SCHEMA_FILE, 'utf8')
        .replace(/^\s*CREATE\s+DATABASE[\s\S]*?;/gim, '')
        .replace(/^\s*USE\s+`?[A-Za-z0-9_]+`?\s*;/gim, '');
      await boot.query(schema);
    } else {
      console.warn('[library] 未找到 ' + SCHEMA_FILE + '，跳过建表（复用已有库表）');
    }
    await ensureColumns(boot, dbName).catch((err) => {
      console.warn('[library] 补列检查跳过：' + (err && err.message));
    });
  } finally {
    await boot.end().catch(() => {});
  }

  pool = mysql2.createPool(Object.assign({}, base, {
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    /* multipleStatements:true 只在建表连接上用 */
  }));
  await pool.query('SELECT 1');
  info.database = dbName;
  info.mode = 'mysql';
}

/* 文件存储只需初始化一次（首次从种子导入） */
let fileReady = null;
function ensureFileStore() {
  if (!fileReady) {
    fileReady = (async () => {
      await fsp.mkdir(LIB_DIR, { recursive: true });
      if (!fs.existsSync(BOOKS_FILE)) {
        const seed = readJSON(SEED_FILE, { books: [] });
        const books = (seed.books || []).map((b, i) => normalizeSeed(b, i));
        await writeJSON(BOOKS_FILE, books);
      }
      if (!fs.existsSync(FAV_FILE)) await writeJSON(FAV_FILE, {});
      if (!fs.existsSync(HIST_FILE)) await writeJSON(HIST_FILE, {});
    })();
  }
  return fileReady;
}

/* 单飞：同一时刻只跑一个连接尝试，避免并发请求一起压库 */
function attemptOnce() {
  if (!initPromise) {
    initPromise = runAttempt().finally(() => { initPromise = null; });
  }
  return initPromise;
}

async function runAttempt() {
  started = true;
  info.lastAttemptAt = now();
  try {
    if (config.LIBRARY_STORE === 'file') throw new Error('LIBRARY_STORE=file');
    await ensureMysql();
    info.degraded = false;
    info.mysqlError = null;
    info.retryCount = 0;
    info.nextRetryAt = 0;
    info.mode = 'mysql';
    info.initialized = true;
    console.log('[library] MySQL 已连接：' + info.database);
    return info;
  } catch (err) {
    info.mysqlError = err && err.message ? err.message : String(err);
    pool = null;
    info.mode = 'file';
    info.initialized = true;
    if (config.LIBRARY_STORE === 'file') {
      /* 显式配置成 file：这是目标状态，不算降级、也不重试 */
      info.degraded = false;
      info.nextRetryAt = 0;
    } else {
      info.degraded = true;
      info.retryCount += 1;
      const delay = RETRY_DELAYS[Math.min(info.retryCount - 1, RETRY_DELAYS.length - 1)];
      info.nextRetryAt = now() + delay;
      console.warn('[library] MySQL 不可用（第 ' + info.retryCount + ' 次），' + delay +
        'ms 后重试：' + info.mysqlError);
    }
    await ensureFileStore();
    return info;
  }
}

/* 读路径：首次阻塞等待结果；之后失败不再永久固化，到退避时间就在后台重试（不拖慢本次读） */
async function init() {
  if (info.mode === 'mysql') return info;
  if (!started) return attemptOnce();
  if (!initPromise && info.degraded && now() >= info.nextRetryAt) {
    attemptOnce().catch(() => {});
  }
  return info;
}

/* 写路径：降级模式下不允许静默写 /tmp。要么先确认库连上，要么明确报错。 */
async function initForWrite() {
  await init();
  if (info.mode === 'mysql') return info;
  if (config.LIBRARY_STORE === 'file') return info;
  await attemptOnce();
  if (info.mode !== 'mysql') {
    const err = new Error('数据库暂不可用，图书馆处于降级模式（' + info.mysqlError +
      '），本次写入未保存，请稍后重试');
    err.status = 503;
    err.expose = true;
    err.code = 'STORE_DEGRADED';
    err.hint = '当前为降级模式（file），书目来自本机种子数据；数据库恢复后会自动重连';
    throw err;
  }
  return info;
}

function normalizeSeed(b, i) {
  const t = now();
  return {
    id: String(b.id || makeId()),
    title: String(b.title || '无题'),
    author: String(b.author || '佚名'),
    category: String(b.category || '未分类'),
    tags: splitTags(b.tags),
    intro: String(b.intro || ''),
    accent: String(b.accent || '#7d5a3c'),
    coverUrl: '',
    area: AREAS.includes(String(b.area || '')) ? String(b.area) : '',
    pdfUrl: String(b.pdfUrl || ''),
    pageCount: Math.max(0, Math.floor(Number(b.pageCount) || 0)),
    toc: normalizeToc(b.toc),
    sortNo: i,
    createdAt: t,
    updatedAt: t,
    pages: (b.pages || []).map((p, idx) => ({
      pageNo: idx + 1,
      title: String(p.title || '第 ' + (idx + 1) + ' 页'),
      content: String(p.content || ''),
    })),
  };
}

/* ---------- MySQL 查询 ---------- */
async function mysqlList(q, category) {
  const params = [];
  let sql = 'SELECT * FROM books';
  const where = [];
  if (q) {
    const like = '%' + q + '%';
    where.push('(title LIKE ? OR author LIKE ? OR tags LIKE ? OR intro LIKE ?)');
    params.push(like, like, like, like);
  }
  if (category && category !== '全部') {
    where.push('category = ?');
    params.push(category);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY sort_no ASC, created_at ASC';
  const [rows] = await pool.query(sql, params);
  const ids = rows.map((r) => r.id);
  let pages = [];
  if (ids.length) {
    const [pr] = await pool.query(
      'SELECT book_id, page_no, title, content FROM book_pages WHERE book_id IN (?) ORDER BY page_no ASC',
      [ids]
    );
    pages = pr;
  }
  const byBook = {};
  pages.forEach((p) => { (byBook[p.book_id] = byBook[p.book_id] || []).push(p); });
  return rows.map((r) => normalizeBook(r, byBook[r.id]));
}

async function mysqlGet(id) {
  const [rows] = await pool.query('SELECT * FROM books WHERE id = ?', [id]);
  if (!rows.length) return null;
  const [pages] = await pool.query(
    'SELECT page_no, title, content FROM book_pages WHERE book_id = ? ORDER BY page_no ASC',
    [id]
  );
  return normalizeBook(rows[0], pages);
}

async function mysqlCreate(data) {
  const conn = await pool.getConnection();
  const id = makeId();
  const t = now();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO books (id,title,author,category,tags,intro,accent,cover_url,area,pdf_url,page_count,toc,sort_no,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.title, data.author, data.category, data.tags.join(','), data.intro, data.accent,
        data.coverUrl, data.area, data.pdfUrl, data.pageCount, JSON.stringify(data.toc || []), data.sortNo, t, t]
    );
    if (data.pages.length) {
      const rows = data.pages.map((p) => [id, p.pageNo, p.title, p.content]);
      await conn.query('INSERT INTO book_pages (book_id,page_no,title,content) VALUES ?', [rows]);
    }
    await conn.commit();
    return mysqlGet(id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function mysqlUpdate(id, data) {
  const existing = await mysqlGet(id);
  if (!existing) return null;
  const merged = {
    title: data.title == null ? existing.title : data.title,
    author: data.author == null ? existing.author : data.author,
    category: data.category == null ? existing.category : data.category,
    tags: data.tags == null ? existing.tags : splitTags(data.tags),
    intro: data.intro == null ? existing.intro : data.intro,
    accent: data.accent == null ? existing.accent : data.accent,
    coverUrl: data.coverUrl == null ? existing.coverUrl : data.coverUrl,
    area: data.area == null ? existing.area : data.area,
    pdfUrl: data.pdfUrl == null ? existing.pdfUrl : data.pdfUrl,
    pageCount: data.pageCount == null ? existing.pageCount : data.pageCount,
    toc: data.toc == null ? existing.toc : normalizeToc(data.toc),
    pages: data.pages == null ? existing.pages : data.pages,
  };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE books SET title=?,author=?,category=?,tags=?,intro=?,accent=?,cover_url=?,area=?,pdf_url=?,page_count=?,toc=?,updated_at=? WHERE id=?`,
      [merged.title, merged.author, merged.category, merged.tags.join(','), merged.intro,
        merged.accent, merged.coverUrl, merged.area, merged.pdfUrl, merged.pageCount,
        JSON.stringify(merged.toc || []), now(), id]
    );
    if (data.pages != null) {
      await conn.query('DELETE FROM book_pages WHERE book_id=?', [id]);
      if (merged.pages.length) {
        await conn.query('INSERT INTO book_pages (book_id,page_no,title,content) VALUES ?',
          [merged.pages.map((p, i) => [id, i + 1, p.title, p.content])]);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return mysqlGet(id);
}

async function mysqlDelete(id) {
  const [res] = await pool.query('DELETE FROM books WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

/* =============================================================
 * 文件实现
 * ============================================================= */
async function fileList(q, category) {
  const books = readJSON(BOOKS_FILE, []);
  const needle = String(q || '').trim().toLowerCase();
  return books.filter((b) => {
    if (category && category !== '全部' && b.category !== category) return false;
    if (!needle) return true;
    return [b.title, b.author, b.category, (b.tags || []).join(' '), b.intro]
      .join(' ').toLowerCase().includes(needle);
  });
}

async function fileGet(id) {
  return readJSON(BOOKS_FILE, []).find((b) => b.id === id) || null;
}

async function fileCreate(data) {
  const books = readJSON(BOOKS_FILE, []);
  const t = now();
  const book = {
    id: makeId(),
    title: data.title,
    author: data.author,
    category: data.category,
    tags: data.tags,
    intro: data.intro,
    accent: data.accent,
    coverUrl: data.coverUrl,
    area: data.area,
    pdfUrl: data.pdfUrl,
    pageCount: data.pageCount,
    toc: data.toc,
    sortNo: data.sortNo,
    createdAt: t,
    updatedAt: t,
    pages: data.pages,
  };
  books.push(book);
  await writeJSON(BOOKS_FILE, books);
  return book;
}

async function fileUpdate(id, data) {
  const books = readJSON(BOOKS_FILE, []);
  const idx = books.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const b = books[idx];
  if (data.title != null) b.title = data.title;
  if (data.author != null) b.author = data.author;
  if (data.category != null) b.category = data.category;
  if (data.tags != null) b.tags = splitTags(data.tags);
  if (data.intro != null) b.intro = data.intro;
  if (data.accent != null) b.accent = data.accent;
  if (data.coverUrl != null) b.coverUrl = data.coverUrl;
  if (data.area != null) b.area = data.area;
  if (data.pdfUrl != null) b.pdfUrl = data.pdfUrl;
  if (data.pageCount != null) b.pageCount = data.pageCount;
  if (data.toc != null) b.toc = normalizeToc(data.toc);
  if (data.sortNo != null) b.sortNo = data.sortNo;
  if (data.pages != null) b.pages = data.pages;
  b.updatedAt = now();
  await writeJSON(BOOKS_FILE, books);
  return b;
}

async function fileDelete(id) {
  const books = readJSON(BOOKS_FILE, []);
  const next = books.filter((b) => b.id !== id);
  if (next.length === books.length) return false;
  await writeJSON(BOOKS_FILE, next);
  const favs = readJSON(FAV_FILE, {});
  const hist = readJSON(HIST_FILE, {});
  Object.keys(favs).forEach((u) => { if (favs[u]) delete favs[u][id]; });
  Object.keys(hist).forEach((u) => { if (hist[u]) delete hist[u][id]; });
  await writeJSON(FAV_FILE, favs);
  await writeJSON(HIST_FILE, hist);
  return true;
}

/* =============================================================
 * 对外接口
 * ============================================================= */
function userKey(raw) {
  const v = String(raw || '').trim();
  return v ? v.slice(0, 64) : 'guest';
}

const store = {
  info,
  init,
  userKey,

  async list(q, category) {
    await init();
    return info.mode === 'mysql' ? mysqlList(q, category) : fileList(q, category);
  },

  async get(id) {
    await init();
    return info.mode === 'mysql' ? mysqlGet(id) : fileGet(id);
  },

  async create(body) {
    await initForWrite();
    const data = validateBookInput(body);
    return info.mode === 'mysql' ? mysqlCreate(data) : fileCreate(data);
  },

  async update(id, body) {
    await initForWrite();
    const data = validateBookInput(Object.assign({}, body, { title: (body && body.title) || '占位' }));
    /* 更新时允许只传部分字段 */
    const patch = Object.assign({}, body || {});
    if (patch.title != null) patch.title = data.title;
    if (patch.pages != null) patch.pages = data.pages;
    if (patch.tags != null) patch.tags = data.tags;
    return info.mode === 'mysql' ? mysqlUpdate(id, patch) : fileUpdate(id, patch);
  },

  async remove(id) {
    await initForWrite();
    return info.mode === 'mysql' ? mysqlDelete(id) : fileDelete(id);
  },

  /* 供 /api/health 同步读取的降级快照（不触发连接尝试） */
  state() {
    return {
      mode: info.mode,
      degraded: info.degraded,
      initialized: info.initialized,
      retrying: Boolean(initPromise),
      retryCount: info.retryCount,
      nextRetryInMs: info.nextRetryAt ? Math.max(0, info.nextRetryAt - now()) : 0,
      lastAttemptAt: info.lastAttemptAt,
      mysqlError: info.mysqlError,
      database: info.database || '',
    };
  },

  /* 搜索推荐：书名/作者/标签前缀匹配 + 热门词 */
  async suggest(q) {
    await init();
    const needle = String(q || '').trim();
    const books = await store.list('', '全部');
    if (!needle) {
      return { books: books.slice(0, 6).map(lite), terms: [] };
    }
    const lower = needle.toLowerCase();
    const hits = books.filter((b) =>
      [b.title, b.author, b.category, (b.tags || []).join(' ')]
        .join(' ').toLowerCase().includes(lower)
    ).slice(0, 8);
    const terms = [];
    hits.forEach((b) => {
      if (b.title.toLowerCase().includes(lower)) terms.push(b.title);
      (b.tags || []).forEach((t) => { if (t.toLowerCase().includes(lower)) terms.push(t); });
    });
    return { books: hits.map(lite), terms: Array.from(new Set(terms)).slice(0, 8) };
  },

  async favorites(key) {
    await init();
    const u = userKey(key);
    let ids = [];
    if (info.mode === 'mysql') {
      const [rows] = await pool.query(
        'SELECT book_id FROM book_favorites WHERE user_key=? ORDER BY created_at DESC', [u]
      );
      ids = rows.map((r) => r.book_id);
    } else {
      const favs = readJSON(FAV_FILE, {});
      ids = Object.keys(favs[u] || {}).sort((a, b) => favs[u][b] - favs[u][a]);
    }
    const books = (await store.list('', '全部')).filter((b) => ids.includes(b.id));
    return books;
  },

  async setFavorite(key, bookId, on) {
    await init();
    const u = userKey(key);
    const exists = await store.get(bookId);
    if (!exists) {
      const err = new Error('书籍不存在');
      err.status = 404;
      throw err;
    }
    if (info.mode === 'mysql') {
      if (on) {
        await pool.query(
          'INSERT INTO book_favorites (user_key,book_id,created_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)',
          [u, bookId, now()]
        );
      } else {
        await pool.query('DELETE FROM book_favorites WHERE user_key=? AND book_id=?', [u, bookId]);
      }
    } else {
      const favs = readJSON(FAV_FILE, {});
      favs[u] = favs[u] || {};
      if (on) favs[u][bookId] = now();
      else delete favs[u][bookId];
      await writeJSON(FAV_FILE, favs);
    }
    return { bookId, favorite: !!on };
  },

  async isFavorite(key, bookId) {
    await init();
    const u = userKey(key);
    if (info.mode === 'mysql') {
      const [rows] = await pool.query(
        'SELECT 1 FROM book_favorites WHERE user_key=? AND book_id=? LIMIT 1', [u, bookId]
      );
      return rows.length > 0;
    }
    const favs = readJSON(FAV_FILE, {});
    return !!(favs[u] && favs[u][bookId]);
  },

  async history(key) {
    await init();
    const u = userKey(key);
    let rows = [];
    if (info.mode === 'mysql') {
      const [r] = await pool.query(
        'SELECT book_id, last_page, opened_at FROM reading_history WHERE user_key=? ORDER BY opened_at DESC LIMIT 40',
        [u]
      );
      rows = r.map((x) => ({ bookId: x.book_id, lastPage: Number(x.last_page), openedAt: Number(x.opened_at) }));
    } else {
      const hist = readJSON(HIST_FILE, {});
      rows = Object.keys(hist[u] || {}).map((id) => ({
        bookId: id,
        lastPage: Number(hist[u][id].lastPage || 0),
        openedAt: Number(hist[u][id].openedAt || 0),
      })).sort((a, b) => b.openedAt - a.openedAt).slice(0, 40);
    }
    const books = await store.list('', '全部');
    const byId = {};
    books.forEach((b) => { byId[b.id] = b; });
    return rows.filter((r) => byId[r.bookId]).map((r) => ({
      bookId: r.bookId,
      lastPage: r.lastPage,
      openedAt: r.openedAt,
      book: lite(byId[r.bookId]),
    }));
  },

  async progress(key, bookId) {
    await init();
    const u = userKey(key);
    if (info.mode === 'mysql') {
      const [rows] = await pool.query(
        'SELECT last_page, opened_at FROM reading_history WHERE user_key=? AND book_id=?', [u, bookId]
      );
      return rows.length ? { lastPage: Number(rows[0].last_page), openedAt: Number(rows[0].opened_at) } : null;
    }
    const hist = readJSON(HIST_FILE, {});
    return (hist[u] && hist[u][bookId]) || null;
  },

  async saveProgress(key, bookId, lastPage) {
    await init();
    const u = userKey(key);
    const page = Math.max(0, Number(lastPage) || 0);
    const exists = await store.get(bookId);
    if (!exists) {
      const err = new Error('书籍不存在');
      err.status = 404;
      throw err;
    }
    if (info.mode === 'mysql') {
      await pool.query(
        `INSERT INTO reading_history (user_key,book_id,last_page,opened_at) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE last_page=VALUES(last_page), opened_at=VALUES(opened_at)`,
        [u, bookId, page, now()]
      );
    } else {
      const hist = readJSON(HIST_FILE, {});
      hist[u] = hist[u] || {};
      hist[u][bookId] = { lastPage: page, openedAt: now() };
      await writeJSON(HIST_FILE, hist);
    }
    return { bookId, lastPage: page, openedAt: now() };
  },

  async stats() {
    await init();
    const books = await store.list('', '全部');
    return {
      mode: info.mode,
      mysqlError: info.mysqlError,
      degraded: info.degraded,
      retryCount: info.retryCount,
      storageLimit: info.storageLimit,
      books: books.length,
      pages: books.reduce((n, b) => n + b.pages.length, 0),
      categories: Array.from(new Set(books.map((b) => b.category))).length,
    };
  },
};

function lite(b) {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    category: b.category,
    tags: b.tags,
    intro: b.intro,
    accent: b.accent,
    coverUrl: b.coverUrl,
    area: b.area || '',
    pdfUrl: b.pdfUrl || '',
    pageCount: b.pageCount || 0,
    pages: (b.pages || []).length,
  };
}

module.exports = store;
