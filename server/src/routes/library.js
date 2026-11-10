'use strict';

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { wrap, assert, jsonError } = require('../http');
const config = require('../config');
const { authOptional, authRequired, adminOnly } = require('../auth');
const library = require('../library-store');
const objectStore = require('../object-store');

const router = express.Router();

/* 图书馆用户标识：已登录用账号 ID，未登录用 guest 或前端传来的本地标识 */
function keyOf(req) {
  if (req.user && req.user.id) return 'u_' + req.user.id;
  return library.userKey(req.get('x-library-user'));
}

/* ---------- 书籍 ---------- */
/* 书目里存的 pdfUrl/coverUrl 是绝对地址（历史数据写的是 Render 域名）。
   SCF 上 Render 已停，直接返回会把前端带去死域名，所以统一改写到当前后端。
   只改写 /api/library/file/ 这种代理地址，对象存储直链（签名 URL）原样保留。 */
function requestOrigin(req) {
  const base = config.PUBLIC_BASE_URL || (req.protocol + '://' + (req.get('host') || ''));
  return String(base).replace(/\/+$/, '').replace(/\/api$/i, '');
}

function retarget(url, origin) {
  const s = String(url || '');
  const m = /\/api\/library\/file\/.+$/.exec(s);
  return m ? origin + m[0] : url;
}

function retargetBook(item, origin) {
  if (!item || typeof item !== 'object') return item;
  const next = Object.assign({}, item);
  if (next.pdfUrl) next.pdfUrl = retarget(next.pdfUrl, origin);
  if (next.coverUrl) {
    next.coverUrl = retarget(next.coverUrl, origin);
    /* 封面改走对象存储签名直链：SCF 网关会给代理响应再补一条
       Content-Type: application/json，浏览器取第一条 → <img> 解码失败、封面空白。
       直链由 COS 直接返回单一 image/* 响应头，且桶已配 CORS。 */
    try {
      const key = keyFromUrl(next.coverUrl);
      const signed = key ? objectStore.presignGet(key, 3600) : '';
      if (signed) next.coverUrl = signed;
    } catch (err) {
      /* 存储不可用时保留原地址，不影响书目返回 */
    }
  }
  return next;
}

router.get('/library/books', authOptional, wrap(async (req, res) => {
  const q = String(req.query.q || '');
  const category = String(req.query.category || '');
  const items = await library.list(q, category);
  const origin = requestOrigin(req);
  const mapped = items.map((item) => retargetBook(item, origin));
  res.json({ items: mapped, total: mapped.length, store: await library.stats() });
}));

router.get('/library/suggest', authOptional, wrap(async (req, res) => {
  res.json(await library.suggest(String(req.query.q || '')));
}));

router.get('/library/stats', wrap(async (req, res) => {
  res.json(await library.stats());
}));

/* 手动重跑对象存储桶配置（CORS / 防盗链），仅管理员：
   改规则后无需重启服务，直接 POST 一次即可。 */
router.post('/library/admin/bucket-security', authRequired, adminOnly, wrap(async (req, res) => {
  res.json(await objectStore.ensureBucketSecurity());
}));

/* 删除对象存储里的单个对象（仅管理员）：清理废弃书籍文件用。
   key 必须以 library/ 开头，避免误删其它前缀的对象。 */
router.delete('/library/admin/object', authRequired, adminOnly, wrap(async (req, res) => {
  const key = String(req.query.key || '').trim();
  assert(key, 400, '缺少 key', '用法：DELETE /api/library/admin/object?key=library/books/xxx.pdf');
  assert(/^library\/[A-Za-z0-9._\/-]+$/.test(key) && key.indexOf('..') < 0, 400, '非法文件路径');
  await objectStore.deleteObject(key);
  res.json({ ok: true, key });
}));


/* 从书目里存的 URL 反解对象 key：
   兼容后端地址（/api/library/file/<key>）与对象存储直链（路径即 key）。 */
function keyFromUrl(url) {
  const m = /\/api\/library\/file\/(library\/[A-Za-z0-9._\/-]+)/.exec(String(url || ''));
  if (m) return m[1];
  try {
    const u = new URL(String(url || ''));
    const k = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    if (/^library\/[A-Za-z0-9._\/-]+$/.test(k) && k.indexOf('..') < 0) return k;
  } catch (err) { /* 不是合法 URL */ }
  return '';
}

/* 用一次 Range 0-0 探对象：只回几个字节，拿到总长度和类型，不搬正文。
   返回 null 表示对象存储不可达。 */
async function probeObject(url, ext) {
  let up;
  try {
    up = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  } catch (err) {
    return null;
  }
  const status = up.status;
  const headers = up.headers;
  if (up.body) await up.body.cancel().catch(() => {});
  if (status !== 200 && status !== 206) return { status };
  const range = headers.get('content-range') || '';
  const total = Number((range.split('/')[1] || '').trim()) ||
    Number(headers.get('content-length') || 0) || 0;
  return {
    status,
    contentLength: total,
    contentType: headers.get('content-type') || MIME_BY_EXT[ext] || 'application/octet-stream',
  };
}

/* 只发通行证、不搬字节：给前端一个预签名直链，让浏览器直连 OSS（支持 Range）。
   大 PDF（200MB+）走这条，避免每段都经 Render 中转。
   前端示例：fetch('/api/library/books/<id>/pdf-url').then(r=>r.json()).then(d=>pdfjsLib.getDocument({
     url: d.url, httpHeaders: {}, withCredentials: false })) */
router.get('/library/books/:id/pdf-url', authOptional, wrap(async (req, res) => {
  const book = await library.get(req.params.id);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  const key = keyFromUrl(book.pdfUrl);
  assert(key, 404, '这本书没有 PDF 正文', 'pdfUrl 为空或不是对象存储地址');

  const filename = path.basename(key).replace(/["\\\r\n]/g, '') || 'book.pdf';
  const url = objectStore.presignGet(key, PDF_DIRECT_TTL, {
    responseContentDisposition: 'inline; filename="' + filename + '"',
  });
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');

  const info = await probeObject(url, '.pdf');
  if (!info) throw jsonError(502, '文件读取失败', '对象存储不可达');
  if (info.status === 404) throw jsonError(404, '文件不存在');
  assert(info.contentLength != null, 502, '文件读取失败', '对象存储返回 ' + info.status);

  /* 签名有效期 1 小时，响应缓存 10 分钟：仍远在有效期内，且减少重复换链 */
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.json({
    url,
    expiresIn: PDF_DIRECT_TTL,
    contentLength: info.contentLength,
    contentType: info.contentType,
  });
}));

/* 封面直链（可选通路）：带 OSS 缩略参数，书架卡片直接走 CDN 边缘，不占 Render 带宽 */
router.get('/library/books/:id/cover-url', authOptional, wrap(async (req, res) => {
  const book = await library.get(req.params.id);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  const key = keyFromUrl(book.coverUrl);
  assert(key, 404, '这本书没有封面', 'coverUrl 为空或不是对象存储地址');

  const ext = path.extname(key).toLowerCase();
  const url = objectStore.presignGet(key, PDF_DIRECT_TTL, {
    process: IMAGE_EXTS[ext] ? COVER_PROCESS : undefined,
  });
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.json({ url, expiresIn: PDF_DIRECT_TTL, contentType: IMAGE_EXTS[ext] ? 'image/jpeg' : 'application/octet-stream' });
}));

router.get('/library/books/:id', authOptional, wrap(async (req, res) => {
  const book = await library.get(req.params.id);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  const key = keyOf(req);
  res.json({
    /* 详情页与列表用同一套地址换算：老 Render 域名改写为当前后端，
       封面统一换成对象存储签名直链（否则私读桶直链 403、详情页只剩文字占位）。 */
    book: retargetBook(book, requestOrigin(req)),
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
     - PDF 读取 302 到预签名直链，浏览器直连 OSS（支持 Range），不再经 Render 中转；
     - 封面等小图仍由后端回源代理，地址稳定。 */
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
/* 封面走 OSS 侧缩略：520px 宽足够书架卡片（~100px 展示 × 2~3 倍图），q80 肉眼无损 */
const IMAGE_EXTS = { '.jpg': true, '.jpeg': true, '.png': true, '.webp': true };
const COVER_PROCESS = 'image/resize,m_lfit,w_520/quality,q_80';

router.post('/library/uploads/presign', authOptional, wrap(async (req, res) => {
  /* 管理员优先：带有效登录 token 且 role=admin 时免上传口令；
     其余情况仍只认环境变量 LIBRARY_UPLOAD_KEY（不回落到代码里的默认值）。 */
  const isAdmin = Boolean(req.user && req.user.role === 'admin');
  if (!isAdmin) {
    assert(UPLOAD_KEY, 503, '上传未启用', '请在环境变量配置 LIBRARY_UPLOAD_KEY');
    assert(req.get('x-upload-key') === UPLOAD_KEY, 403, '上传未授权', '需要正确的 x-upload-key 或管理员登录');
  }
  const body = req.body || {};
  const kind = String(body.kind || 'books');
  const prefix = UPLOAD_PREFIX[kind];
  /* 管理员可显式指定已存在的对象 key（用于覆盖修复历史对象，普通调用只能新建 key） */
  const explicitKey = String(body.key || '').trim();
  if (explicitKey) {
    assert(isAdmin, 403, '只有管理员可以覆盖已有文件', '普通上传请省略 key');
    assert(/^library\/[A-Za-z0-9._\/-]+$/.test(explicitKey) && explicitKey.indexOf('..') < 0, 400, '非法文件路径');
  }
  assert(prefix, 400, 'kind 只能是 books 或 covers');
  const name = String(body.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'file';
  /* 类型以扩展名为准（也接受 body.mime / body.contentType 显式指定），
     并把它签进 PUT URL：前端必须带同一个 Content-Type，对象元信息才不会变成 octet-stream */
  const mime = String(body.mime || body.contentType || '').trim() ||
    MIME_BY_EXT[path.extname(name).toLowerCase()] || '';
  assert(/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime), 400, '只允许 PDF 或 JPG/PNG/WEBP');
  assert(Number(body.size) > 0 && Number(body.size) <= 300 * 1024 * 1024, 400, '文件需大于 0 且不超过 300MB');

  const key = explicitKey || prefix + Date.now().toString(36) + '-' + name;
  const url = objectStore.presignPut(key, 3600, mime);
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');
  res.json({ ok: true, key, method: 'PUT', url, mime, contentType: mime, expires: 3600 });
}));

/* 回源代理：小图（封面）与所有 HEAD 走这里。体积小、地址稳定，前端无需处理跳转。
   presignGet 是按 GET 签名的，OSS 会拒绝拿它发 HEAD（502），
   所以 HEAD 也向上游发 GET，只取响应头后丢弃 body。 */
async function proxyFile(req, res, key, ext, filename) {
  const isImage = IMAGE_EXTS[ext] === true;
  /* 封面原图常见 500KB+，经 Render 中转既慢又费带宽：
     让 OSS 直接输出 520px 宽、q80 的缩略图（签名里带上 process 参数）。 */
  const url = objectStore.presignGet(key, 600, isImage ? { process: COVER_PROCESS } : undefined);
  assert(url, 503, '对象存储未启用', '请配置 S3_ENDPOINT / S3_BUCKET / 密钥');

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;

  let up;
  try {
    up = await fetch(url, { method: 'GET', headers });
  } catch (err) {
    throw jsonError(502, '文件读取失败', '对象存储不可达');
  }
  /* 桶未开图片处理时 OSS 会返回 4xx：退回原始对象，保证封面不裂 */
  if (isImage && !up.ok && up.status !== 206) {
    if (up.body) await up.body.cancel().catch(() => {});
    const plain = objectStore.presignGet(key, 600);
    if (plain && plain !== url) {
      try {
        up = await fetch(plain, { method: 'GET', headers });
      } catch (err) {
        throw jsonError(502, '文件读取失败', '对象存储不可达');
      }
    }
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
  /* 封面 URL 里带时间戳、内容不会变：长缓存 7 天，重复进书架不再回源；
     PDF 等其它文件仍保持 5 分钟私有缓存 */
  res.setHeader('Cache-Control', isImage ? 'public, max-age=604800' : 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'bytes');
  /* 跨域直出（?stream=1 给 pdf.js 的兜底通道）：分段读取必须能看到这几个头 */
  res.setHeader('Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag');
  const len = up.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const range = up.headers.get('content-range');
  if (range) res.setHeader('Content-Range', range);
  const etag = up.headers.get('etag');
  if (etag) res.setHeader('ETag', etag);

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
  /* ?stream=1：不跳转，服务端带 Range 回源并流式直出（pdf.js 的兜底通道，
     避免「跨域 + 302 跳转 + Range」在某些浏览器组合下被拦）。 */
  const useStream = String(req.query.stream || '') === '1';

  /* PDF 正文：302 到预签名直链，浏览器直连 OSS 流式拉取（支持 Range），
     83MB 不再全部经 Render 中转。签名里带 inline，保证是内嵌预览而不是下载。
     HEAD 仍走回源，保持原有 200/206 语义。 */
  if (ext === '.pdf' && req.method !== 'HEAD' && !useStream) {
    /* 只覆盖 Content-Disposition：OSS 会拒绝 response-content-type 覆盖
       （400 InvalidRequest: Can not override response header on content-type），
       而对象本身存的就是 application/pdf，不需要再覆盖类型。 */
    const direct = objectStore.presignGet(key, PDF_DIRECT_TTL, {
      responseContentDisposition: 'inline; filename="' + filename + '"',
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
      /* 重定向给浏览器缓存 5 分钟：pdf.js 分段取同一 URL 时不必每次都回接口换链接。
         安全边界：签名有效期 1 小时，缓存 300 秒内复用一定还在有效期内；
         也不能用 no-store，否则每个 Range 请求都要多一次 API 往返。 */
      res.setHeader('Cache-Control', 'private, max-age=300');
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
