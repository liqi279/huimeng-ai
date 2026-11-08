'use strict';

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { wrap, assert, jsonError } = require('../http');
const { authOptional } = require('../auth');
const library = require('../library-store');
const objectStore = require('../object-store');

const router = express.Router();

/* 图书馆用户标识：已登录用账号 ID，未登录用 guest 或前端传来的本地标识 */
function keyOf(req) {
  if (req.user && req.user.id) return 'u_' + req.user.id;
  return library.userKey(req.get('x-library-user'));
}

/* ---------- 书籍 ---------- */
router.get('/library/books', authOptional, wrap(async (req, res) => {
  const q = String(req.query.q || '');
  const category = String(req.query.category || '');
  const items = await library.list(q, category);
  res.json({ items, total: items.length, store: await library.stats() });
}));

router.get('/library/suggest', authOptional, wrap(async (req, res) => {
  res.json(await library.suggest(String(req.query.q || '')));
}));

router.get('/library/stats', wrap(async (req, res) => {
  res.json(await library.stats());
}));

router.get('/library/books/:id', authOptional, wrap(async (req, res) => {
  const book = await library.get(req.params.id);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  const key = keyOf(req);
  res.json({
    book,
    favorite: await library.isFavorite(key, book.id),
    progress: await library.progress(key, book.id),
  });
}));

/* 新增书籍（body 可直接给 book 字段，也兼容 { book: {...} }） */
router.post('/library/books', authOptional, wrap(async (req, res) => {
  const body = req.body && req.body.book ? req.body.book : (req.body || {});
  const book = await library.create(body);
  res.status(201).json({ book });
}));

router.put('/library/books/:id', authOptional, wrap(async (req, res) => {
  const body = req.body && req.body.book ? req.body.book : (req.body || {});
  const book = await library.update(req.params.id, body);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  res.json({ book });
}));

router.delete('/library/books/:id', authOptional, wrap(async (req, res) => {
  const ok = await library.remove(req.params.id);
  assert(ok, 404, '书籍不存在', '请检查书籍 ID');
  res.json({ ok: true });
}));

/* ---------- 大文件直传 / 回源（对象存储） ---------- */
/* 图书馆的 PDF 正文与封面都放对象存储，MySQL 里只存 URL：
     - TiDB / MySQL 单行默认上限 6MB，83MB 的 PDF 塞进表必然失败；
     - 直传走预签名 PUT，字节不经过 Render，不会占内存也不会超时；
     - 读取由后端带签名回源（GET/HEAD + Range），地址稳定、可 inline 预览。 */
/* 上传口令只认环境变量：没配置就整体禁用上传，绝不回落到代码里的默认值 */
const UPLOAD_KEY = String(process.env.LIBRARY_UPLOAD_KEY || '');
/* PDF 直链有效期 1 小时：过期后前端重新请求 /library/file/* 换新链接 */
const PDF_DIRECT_TTL = 3600;
const UPLOAD_PREFIX = { books: 'library/books/', covers: 'library/covers/' };
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

router.post('/library/uploads/presign', wrap(async (req, res) => {
  assert(UPLOAD_KEY, 503, '上传未启用', '请在环境变量配置 LIBRARY_UPLOAD_KEY');
  assert(req.get('x-upload-key') === UPLOAD_KEY, 403, '上传未授权', '需要正确的 x-upload-key');
  const body = req.body || {};
  const kind = String(body.kind || 'books');
  const prefix = UPLOAD_PREFIX[kind];
  assert(prefix, 400, 'kind 只能是 books 或 covers');
  const name = String(body.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'file';
  const mime = String(body.mime || '');
  assert(/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime), 400, '只允许 PDF 或 JPG/PNG/WEBP');
  assert(Number(body.size) > 0 && Number(body.size) <= 300 * 1024 * 1024, 400, '文件需大于 0 且不超过 300MB');

  const key = prefix + Date.now().toString(36) + '-' + name;
  const url = objectStore.presignPut(key, 3600);
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');
  res.json({ ok: true, key, method: 'PUT', url, mime, expires: 3600 });
}));

/* 回源代理：小图（封面）与所有 HEAD 走这里。体积小、地址稳定，前端无需处理跳转。
   presignGet 是按 GET 签名的，OSS 会拒绝拿它发 HEAD（502），
   所以 HEAD 也向上游发 GET，只取响应头后丢弃 body。 */
async function proxyFile(req, res, key, ext, filename) {
  const url = objectStore.presignGet(key, 600);
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;

  let up;
  try {
    up = await fetch(url, { method: 'GET', headers });
  } catch (err) {
    throw jsonError(502, '文件读取失败', '对象存储不可达');
  }
  if (up.status === 404) {
    if (up.body) await up.body.cancel().catch(() => {});
    throw jsonError(404, '文件不存在');
  }
  if (!up.ok && up.status !== 206) {
    if (up.body) await up.body.cancel().catch(() => {});
    throw jsonError(502, '文件读取失败', '对象存储返回 ' + up.status);
  }

  res.status(up.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', up.headers.get('content-type') || MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Accept-Ranges', 'bytes');
  const len = up.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const range = up.headers.get('content-range');
  if (range) res.setHeader('Content-Range', range);

  if (req.method === 'HEAD' || !up.body) {
    if (up.body) await up.body.cancel().catch(() => {});
    res.end();
    return;
  }
  const readable = Readable.fromWeb(up.body);
  readable.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else res.end();
  });
  readable.pipe(res);
}

router.get('/library/file/*', wrap(async (req, res) => {
  /* 路径即对象 key（必须以 library/ 开头，避免越权读其它前缀的对象） */
  const key = String(req.params[0] || '').replace(/^\/+/, '');
  assert(/^library\/[A-Za-z0-9._\/-]+$/.test(key) && key.indexOf('..') < 0, 400, '非法文件路径');

  const ext = path.extname(key).toLowerCase();
  const filename = path.basename(key).replace(/["\\\r\n]/g, '') || 'file';

  /* PDF 正文：302 到预签名直链，浏览器直连 OSS 流式拉取（支持 Range），
     83MB 不再全部经 Render 中转。签名里带 inline + application/pdf，
     保证是内嵌预览而不是下载。HEAD 仍走回源，保持原有 200/206 语义。 */
  if (ext === '.pdf' && req.method !== 'HEAD') {
    const direct = objectStore.presignGet(key, PDF_DIRECT_TTL, {
      responseContentDisposition: 'inline; filename="' + filename + '"',
      responseContentType: 'application/pdf',
    });
    assert(direct, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');

    /* 先探一次存在性：对象不存在时浏览器只会看到 OSS 的 XML 错误页，
       这里按 Range 0-0 取一次，保留原来的 404/502 JSON 映射。 */
    let probe = null;
    try {
      probe = await fetch(direct, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    } catch (err) {
      probe = null;
    }
    const probeStatus = probe ? probe.status : 0;
    if (probe && probe.body) await probe.body.cancel().catch(() => {});
    if (probeStatus === 404) throw jsonError(404, '文件不存在');
    if (probeStatus === 200 || probeStatus === 206) {
      /* 直链 1 小时过期，重定向本身不能缓存，否则过期后浏览器还在用旧签名 */
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, direct);
      return;
    }
    /* 直链探测失败（签名异常 / 网络）：退回回源代理，保证阅读不中断 */
    console.warn('[library] PDF 直链探测失败 status=' + probeStatus + '，退回回源代理');
  }

  await proxyFile(req, res, key, ext, filename);
}));

/* ---------- 收藏 ---------- */
router.get('/library/favorites', authOptional, wrap(async (req, res) => {
  res.json({ items: await library.favorites(keyOf(req)) });
}));

router.post('/library/favorites', authOptional, wrap(async (req, res) => {
  const bookId = String((req.body && req.body.bookId) || '');
  assert(bookId, 400, '缺少 bookId', '请求体需包含 bookId');
  res.json(await library.setFavorite(keyOf(req), bookId, true));
}));

router.delete('/library/favorites/:bookId', authOptional, wrap(async (req, res) => {
  res.json(await library.setFavorite(keyOf(req), req.params.bookId, false));
}));

/* ---------- 阅读历史 / 续读 ---------- */
router.get('/library/history', authOptional, wrap(async (req, res) => {
  res.json({ items: await library.history(keyOf(req)) });
}));

router.get('/library/progress/:bookId', authOptional, wrap(async (req, res) => {
  res.json({ progress: await library.progress(keyOf(req), req.params.bookId) });
}));

router.post('/library/progress', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const bookId = String(body.bookId || '');
  assert(bookId, 400, '缺少 bookId', '请求体需包含 bookId');
  const saved = await library.saveProgress(keyOf(req), bookId, body.lastPage);
  res.json({ progress: saved });
}));

module.exports = router;
