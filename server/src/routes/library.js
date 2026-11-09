'use strict';

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { wrap, assert, jsonError } = require('../http');
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

/* 手动重跑对象存储桶配置（CORS / 防盗链），仅管理员：
   改规则后无需重启服务，直接 POST 一次即可。 */
router.post('/library/admin/bucket-security', authRequired, adminOnly, wrap(async (req, res) => {
  res.json(await objectStore.ensureBucketSecurity());
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
