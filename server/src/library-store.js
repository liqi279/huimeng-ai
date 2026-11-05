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
const SCHEMA_FILE = path.join(config.DATA_ROOT, 'mysql', 'schema.sql');

const info = {
  mode: 'file',
  storageLimit: config.LIBRARY_STORAGE_LIMIT,
  mysqlError: null,
};

let pool = null;
let initPromise = null;
let mysql2 = null;

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
async function ensureMysql() {
  if (config.LIBRARY_STORE === 'file') throw new Error('LIBRARY_STORE=file');
  try {
    mysql2 = require('mysql2/promise');
  } catch (err) {
    throw new Error('未安装 mysql2（在 server/ 执行 npm install mysql2）');
  }

  const base = {
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true,
  };

  /* 先无库连接，执行 schema.sql（含 CREATE DATABASE + 建表） */
  const boot = await mysql2.createConnection(base);
  try {
    await boot.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  } finally {
    await boot.end();
  }

  pool = mysql2.createPool(Object.assign({}, base, {
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
  }));
  await pool.query('SELECT 1');
  info.mode = 'mysql';
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (config.LIBRARY_STORE !== 'file') {
      try {
        await ensureMysql();
        return info;
      } catch (err) {
        info.mysqlError = err && err.message ? err.message : String(err);
        console.warn('[library] MySQL 不可用，回退文件存储：' + info.mysqlError);
        pool = null;
        info.mode = 'file';
      }
    } else {
      info.mode = 'file';
    }

    /* 文件模式初始化：首次从种子导入 */
    await fsp.mkdir(LIB_DIR, { recursive: true });
    if (!fs.existsSync(BOOKS_FILE)) {
      const seed = readJSON(SEED_FILE, { books: [] });
      const books = (seed.books || []).map((b, i) => normalizeSeed(b, i));
      await writeJSON(BOOKS_FILE, books);
    }
    if (!fs.existsSync(FAV_FILE)) await writeJSON(FAV_FILE, {});
    if (!fs.existsSync(HIST_FILE)) await writeJSON(HIST_FILE, {});
    return info;
  })();
  return initPromise;
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
      `INSERT INTO books (id,title,author,category,tags,intro,accent,cover_url,sort_no,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.title, data.author, data.category, data.tags.join(','), data.intro, data.accent,
        data.coverUrl, Number(t), t, t]
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
    pages: data.pages == null ? existing.pages : data.pages,
  };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE books SET title=?,author=?,category=?,tags=?,intro=?,accent=?,cover_url=?,updated_at=? WHERE id=?`,
      [merged.title, merged.author, merged.category, merged.tags.join(','), merged.intro,
        merged.accent, merged.coverUrl, now(), id]
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
    sortNo: books.length,
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
    await init();
    const data = validateBookInput(body);
    return info.mode === 'mysql' ? mysqlCreate(data) : fileCreate(data);
  },

  async update(id, body) {
    await init();
    const data = validateBookInput(Object.assign({}, body, { title: (body && body.title) || '占位' }));
    /* 更新时允许只传部分字段 */
    const patch = Object.assign({}, body || {});
    if (patch.title != null) patch.title = data.title;
    if (patch.pages != null) patch.pages = data.pages;
    if (patch.tags != null) patch.tags = data.tags;
    return info.mode === 'mysql' ? mysqlUpdate(id, patch) : fileUpdate(id, patch);
  },

  async remove(id) {
    await init();
    return info.mode === 'mysql' ? mysqlDelete(id) : fileDelete(id);
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
    pages: (b.pages || []).length,
  };
}

module.exports = store;
