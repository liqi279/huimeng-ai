'use strict';

const path = require('path');
const https = require('https');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const store = require('./store');
const userData = require('./user-data');
const mediaStore = require('./media-store');
const certUtil = require('./cert');

const healthRoutes = require('./routes/health');
const translateRoutes = require('./routes/translate');
const ocrRoutes = require('./routes/ocr');
const worksRoutes = require('./routes/works');
const deskRoutes = require('./routes/desk');
const userdataRoutes = require('./routes/userdata');
const assetsRoutes = require('./routes/assets');
const presetsRoutes = require('./routes/presets');
const catalogRoutes = require('./routes/catalog');
const rayinRoutes = require('./routes/rayin');
const generateRoutes = require('./routes/generate');
const chatRoutes = require('./routes/chat');
const ttsRoutes = require('./routes/tts');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const comfyRoutes = require('./routes/comfy');
const planRoutes = require('./routes/plan');
const scriptRoutes = require('./routes/script');
const artRoutes = require('./routes/art');
const ouaRoutes = require('./routes/oua');
const animationRoutes = require('./routes/animation');
const ollamaRoutes = require('./routes/ollama');
const libraryRoutes = require('./routes/library');
const imageProxyRoutes = require('./routes/image-proxy');
const objectStore = require('./object-store');
const storage = require('./storage');
const { wrap, jsonError } = require('./http');

const app = express();

/* storage 适配层先初始化：上传/读取全部依赖它，且必须早于任何请求 */
storage.init();

const corsOrigin = config.CORS_ORIGIN === '*'
  ? '*'
  : config.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

app.use(cors({ origin: corsOrigin, maxAge: 86400 }));

/* 允许自有前端用 iframe 内嵌 PDF / 页面：只放 frame-ancestors，
   绝不设 X-Frame-Options（DENY/SAMEORIGIN 会直接阻断嵌入）。
   需要新增来源时只改这一行。 */
const FRAME_ANCESTORS = "frame-ancestors 'self' https://liqi279.github.io";
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
  next();
});

/* Ollama 代理必须放在 express.json 之前，才能原样转发请求体（含流式 / 大体积）。
 * 前端请求 /api/ollama/* ，后端转发到本机 http://127.0.0.1:11434/* ，
 * 这样 HTTPS 页面也能通过同源代理访问本地 Ollama，避免混合内容拦截。 */
app.use('/api/ollama', ollamaRoutes);

app.use(express.json({ limit: '25mb' }));

app.use('/api', healthRoutes);
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', translateRoutes);
app.use('/api', ocrRoutes);
/* 用户数据同步路由必须在 works/desk 之前：/works/:id/asset 等更具体的路径先匹配 */
app.use('/api', userdataRoutes);
app.use('/api', worksRoutes);
app.use('/api', deskRoutes);
app.use('/api', assetsRoutes);
app.use('/api', presetsRoutes);
app.use('/api', catalogRoutes);
app.use('/api', rayinRoutes);
app.use('/api', generateRoutes);
app.use('/api', chatRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/comfy', comfyRoutes);
app.use('/api', planRoutes);
app.use('/api', scriptRoutes);
app.use('/api', artRoutes);
app.use('/api', ouaRoutes);
/* animation 路由内部用的是 '/'、'/:id'（没有 '/animation' 前缀），
   挂到 /api 会让 GET /api/animation 命中 '/:id'（被当成 id=animation）返回 404。
   与 oua/art 的「路由内自带前缀」不同，这里按实际路径单独挂载。 */
app.use('/api/animation', animationRoutes);
app.use('/api', libraryRoutes);
/* 鍥剧墖浠ｅ彇锛堝弬鑰冧富浣撳尯璺ㄥ煙鍏滃簳锛夛細蹇呴』鏃╀簬 /api 404 鍏滃簳 */
app.use('/api', imageProxyRoutes);

/* 媒体兜底读取：本地盘静态未命中时，按同名 object key 回对象存储取。
   s3 模式 302 到预签名直链；本地模式（OBJECT_STORE=local）直接回读内容。
   同时接受 /uploads/... 与 /api/uploads/...：SCF 入口会给非 /api 路径补 /api 前缀，
   所以经函数 URL 访问时实际到达的是 /api/uploads/...。 */
async function serveUpload(kind, name, res) {
  const safeName = path.basename(String(name || ''));
  if (!safeName) {
    res.status(404).json({ error: { message: '文件不存在' } });
    return;
  }
  try {
    const out = await mediaStore.send(kind, safeName);
    if (out.mode === 's3') {
      res.redirect(302, out.url);
      return;
    }
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(out.buffer);
  } catch (err) {
    res.status(404).json({ error: { message: '文件不存在', hint: `${kind}/${safeName}` } });
  }
}
app.get(/^\/uploads\/(assets|media)\/([^/]+)$/, (req, res) => (
  serveUpload(req.params[0], req.params[1], res)
));
app.get(/^\/api\/uploads\/(assets|media)\/([^/]+)$/, (req, res) => (
  serveUpload(req.params[0], req.params[1], res)
));

/* 下载代理：浏览器直连 COS 预签名直链没有 ACAO，<img> 能显示但 fetch 取不到字节。
   单个下载 → 302 到当次签发的直链（带 response-content-disposition=attachment），
   浏览器按普通下载处理，不经 SCF 回传大文件（函数 URL 回传二进制会被截断）。
   批量打包 → ?b64=1 返回 JSON+base64（SCF 对大 JSON 已验证可用）。
   ?meta=1 只做存在性探测，供前端先判失败再触发下载。 */
const DOWNLOAD_ASSET_RE = /^\/(?:api\/)?uploads\/(assets|media)\/([^/?#]+)$/;
function downloadName(raw, mime) {
  const base = path.basename(String(raw || '')).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 120);
  const name = base || 'download';
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  let ext = '';
  if (/jpe?g/i.test(mime || '')) ext = 'jpg';
  else if (/png/i.test(mime || '')) ext = 'png';
  else if (/webp/i.test(mime || '')) ext = 'webp';
  else if (/gif/i.test(mime || '')) ext = 'gif';
  else if (/mp4/i.test(mime || '')) ext = 'mp4';
  else if (/webm/i.test(mime || '')) ext = 'webm';
  else if (/mpeg|mp3/i.test(mime || '')) ext = 'mp3';
  else if (/wav/i.test(mime || '')) ext = 'wav';
  return ext ? name + '.' + ext : name;
}

/* 把 url 归一成「对象 key」或「外部字节」；命中本站/COS 一律换算成 key，重新签名/读取 */
async function resolveDownloadSource(src, req) {
  if (src.charAt(0) === '/') {
    const m = src.match(DOWNLOAD_ASSET_RE);
    if (!m) throw jsonError(400, '不支持的下载地址');
    /* 与 serveUpload → mediaStore.send 共用同一个 objectKey()，不再各写一套拼装 */
    const key = mediaStore.objectKey(m[1], decodeURIComponent(m[2]));
    return { key, mime: mediaStore.mimeByName(key) };
  }
  let target;
  try {
    target = new URL(src);
  } catch (err) {
    throw jsonError(400, '下载地址格式不正确');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw jsonError(400, '不支持的下载协议');
  }
  const host = target.hostname.toLowerCase();
  const ownHost = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (/\.myqcloud\.com$/.test(host)) {
    const key = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
    if (!key) throw jsonError(400, '下载地址缺少对象路径');
    return { key, mime: mediaStore.mimeByName(key) };
  }
  const allowed = host === ownHost
    || /\.aliyuncs\.com$/.test(host)
    || host === 'localhost'
    || /^127\./.test(host);
  if (!allowed) throw jsonError(400, '不允许的下载来源');
  const upstream = await fetch(target.toString(), { redirect: 'follow' });
  if (!upstream.ok) {
    throw jsonError(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      '原文件读取失败', 'HTTP ' + upstream.status);
  }
  return {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    mime: upstream.headers.get('content-type') || '',
  };
}

app.get('/api/download', wrap(async (req, res) => {
  const src = String(req.query.url || '').trim();
  if (!src) throw jsonError(400, '缺少 url 参数', '参数形如 ?url=<图片地址>&name=<文件名>');
  const resolved = await resolveDownloadSource(src, req);
  const name = downloadName(String(req.query.name || '') || path.basename(String(src).split('?')[0]), resolved.mime);

  if (String(req.query.meta || '') === '1') {
    let size = resolved.buffer ? resolved.buffer.length : 0;
    if (resolved.key && storage.status().mode === 's3') {
      /* 签名是按 GET 生成的，不能拿 HEAD 去探（COS 会按签名不匹配拒绝）；
         用 Range: bytes=0-0 的 GET 探测，只取 1 字节，200/206 都算存在 */
      const probe = storage.signatureUrl(resolved.key, { method: 'GET', ttl: 300 });
      const check = await fetch(probe, { headers: { Range: 'bytes=0-0' } });
      if (!check.ok) {
        throw jsonError(check.status === 404 ? 404 : 502, '原文件读取失败', 'HTTP ' + check.status);
      }
      const range = check.headers.get('content-range') || '';
      if (range.indexOf('/') >= 0) size = Number(range.split('/')[1]) || 0;
      else size = Number(check.headers.get('content-length') || 0);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, name, mime: resolved.mime, size });
    return;
  }

  if (resolved.key) {
    if (storage.status().mode === 's3') {
      if (String(req.query.b64 || '') !== '1') {
        /* 浏览器直接 302 到 COS：带下载头、不经函数回传，避免响应体被截断 */
        const url = storage.signatureUrl(resolved.key, {
          method: 'GET',
          ttl: 600,
          contentDisposition: `attachment; filename="${name}"`,
        });
        res.redirect(302, url);
        return;
      }
      resolved.buffer = await storage.read(resolved.key);
    } else {
      resolved.buffer = await storage.read(resolved.key);
    }
  }

  if (!resolved.buffer || !resolved.buffer.length) throw jsonError(404, '原文件为空或不存在');
  if (String(req.query.b64 || '') === '1') {
    /* 打包用：base64 走 JSON，单张上限 4MB（base64 后约 5.4MB，仍在函数响应限制内） */
    if (resolved.buffer.length > 4 * 1024 * 1024) {
      throw jsonError(413, '原图过大，无法打包', '请单张下载');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, name, mime: resolved.mime, size: resolved.buffer.length, data: resolved.buffer.toString('base64') });
    return;
  }
  res.setHeader('Content-Type', resolved.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(resolved.buffer);
}));

app.use('/api', (req, res) => {
  res.status(404).json({
    error: { message: '接口不存在', hint: `${req.method} ${req.originalUrl}` },
  });
});

app.use('/uploads/assets', express.static(store.dirs.assets, { index: false, maxAge: '1h' }));
app.use('/uploads/media', express.static(store.dirs.media, { index: false, maxAge: '1h' }));

app.use(express.static(config.FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.FRONTEND_DIR, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: { message: '资源不存在', hint: `${req.method} ${req.path}` },
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    res.status(413).json({ error: { message: '请求体过大', hint: 'JSON 请求体上限 25MB' } });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    res.status(400).json({ error: { message: '请求体 JSON 解析失败' } });
    return;
  }

  const status = Number(err && (err.status || err.statusCode)) || 500;
  const message = err && err.expose ? err.message : (status >= 500 ? '服务器内部错误' : (err && err.message) || '请求失败');
  const payload = { error: { message } };
  if (err && err.code) payload.error.code = err.code;
  if (err && err.hint) payload.error.hint = err.hint;
  if (status >= 500) {
    /* 500 必须可定位：给内部标识 + 一行原因（不含堆栈、不含凭据） */
    if (!payload.error.code) payload.error.code = 'INTERNAL_ERROR';
    payload.error.detail = String((err && err.message) || '').slice(0, 200);
    console.error('[server-error]', err && err.message);
  }

  res.status(status).json(payload);
});

const ready = store.ensureDirs()
  .then(async () => {
    /* 账号库初始化：auto 先试 MySQL，失败回落文件；mysql 强制 MySQL，失败则认证接口 503 */
    const userState = await store.initUserStore();
    if (userState && userState.mode !== 'error') {
      try {
        const users = await store.listUsers();
        if (!users.length) {
          const adminUser = process.env.ADMIN_USER || 'admin';
          const adminPass = process.env.ADMIN_PASS || 'admin123';
          const result = await store.createUser({ username: adminUser, password: adminPass, role: 'admin', status: 'approved', note: '初始超管' });
          if (result.ok) {
            console.log(`[init] 默认超级管理员已创建：${adminUser}（密码取自 ADMIN_PASS 环境变量，请尽快修改）`);
          }
        }
      } catch (err) {
        console.error('[init] 账号初始化失败（服务继续启动，认证接口会返回错误）：', err && err.message);
      }
    } else {
      console.error('[init] 账号数据库不可用：' + ((userState && userState.error) || '未知原因') +
        ' → /api/auth/* 将返回 503。请配置 MySQL，或设置 USER_STORE=auto/file。');
    }

    /* 用户作品/项目数据存储：账号库可用 MySQL 就用 MySQL，否则回落到文件（并告警）
       图片走 S3 兼容对象存储；未配置时回落本地盘（仅开发用）。 */
    try {
      await userData.init();
    } catch (err) {
      console.error('[init] 用户数据存储初始化失败：' + (err && err.message));
    }

    /* SCF：由 serverless-http 接管请求，不能再自己 listen 端口 */
    if (!process.env.SCF_MODE) {
      app.listen(config.PORT, () => {
        console.log(`绘梦 server listening on http://localhost:${config.PORT}`);
      });
    }

    /* 对象存储桶级配置（CORS / 防盗链）不再在冷启动时执行：
       每次冷启动都写一遍桶既拖慢启动又白费请求。
       需要变更时调用 POST /api/library/admin/bucket-security（管理员）显式执行。 */
    try {
      objectStore.init();
    } catch (err) {
      console.error('[init] 桶配置初始化异常：' + (err && err.message));
    }

    /* SCF 里没有本地端口/证书，HTTPS 自签服务器一律不启动 */
    if (process.env.SCF_MODE) return;

    /* 启动 HTTPS 服务器（用于 GitHub Pages 等 HTTPS 前端跨域访问本地后端） */
    const httpsMode = String(config.HTTPS).toLowerCase();
    if (httpsMode === 'on' || (httpsMode === 'auto' && certUtil.generate())) {
      try {
        const creds = certUtil.load();
        const httpsServer = https.createServer(creds, app);
        httpsServer.on('error', (err) => {
          console.warn('[https] HTTPS 服务器启动失败：', err.message);
        });
        httpsServer.listen(config.HTTPS_PORT, () => {
          console.log(`绘梦 HTTPS server listening on https://localhost:${config.HTTPS_PORT}`);
          console.log(`  → 首次使用请在浏览器访问 https://localhost:${config.HTTPS_PORT} 信任自签证书`);
          console.log(`  → 然后在 GitHub Pages 地址后加 ?api=https://localhost:${config.HTTPS_PORT}/api`);
        });
      } catch (err) {
        console.warn('[https] HTTPS 服务器启动失败：', err.message);
      }
    } else {
      console.log('[https] 未启用 HTTPS（设置 HTTPS=on 强制启用，或安装 openssl）');
    }
  })
  .catch((err) => {
    console.error('初始化数据目录失败：', err && err.message);
    /* SCF：不能 process.exit，否则整个函数实例被标记崩溃；
       把失败透给 ready，首次请求返回 500，下次冷启动重试。 */
    if (process.env.SCF_MODE) throw err;
    process.exit(1);
  });

/* 防止 Node 因未处理的 Promise rejection 直接退出；
   真正的失败仍通过 module.exports.ready 传给首次请求（scf.js 的 waitReady）。 */
ready.catch(() => {});

module.exports = app;
module.exports.ready = ready;
