// Cloudflare Workers 入口（Hono）：挂载全部 /api 路由
import { Hono } from 'hono';
import { getConfig } from './config.js';
import { serveBlob } from './routes/assets.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import translateRoutes from './routes/translate.js';
import worksRoutes from './routes/works.js';
import deskRoutes from './routes/desk.js';
import assetsRoutes from './routes/assets.js';
import presetsRoutes from './routes/presets.js';
import catalogRoutes from './routes/catalog.js';
import rayinRoutes from './routes/rayin.js';
import generateRoutes from './routes/generate.js';
import adminRoutes from './routes/admin.js';

const app = new Hono();

/* ---------- CORS（等价于 Express 的 cors({ origin })） ---------- */
app.use('*', async (c, next) => {
  const cfg = getConfig(c.env);
  const origin = c.req.header('Origin');
  if (cfg.CORS_ORIGIN === '*') {
    c.header('Access-Control-Allow-Origin', '*');
  } else {
    const allowed = cfg.CORS_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean);
    if (origin && allowed.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  }
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  c.header('Access-Control-Allow-Headers', c.req.header('Access-Control-Request-Headers') || 'Authorization,Content-Type,Accept');
  c.header('Access-Control-Max-Age', '86400');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

/* ---------- /api 路由 ---------- */
const api = new Hono();
api.route('/', healthRoutes);
api.route('/', authRoutes);
api.route('/', translateRoutes);
api.route('/', worksRoutes);
api.route('/', deskRoutes);
api.route('/', assetsRoutes);
api.route('/', presetsRoutes);
api.route('/', catalogRoutes);
api.route('/', rayinRoutes);
api.route('/', generateRoutes);
api.route('/', adminRoutes);
app.route('/api', api);

/* 兼容旧版 /uploads 静态地址（历史作品/素材 url 可能是 /uploads/assets/xxx） */
app.get('/uploads/assets/:key', serveBlob);
app.get('/uploads/media/:key', serveBlob);

app.get('/', (c) => c.json({
  name: '绘梦 AI API (Cloudflare Workers)',
  status: 'ok',
  health: '/api/health',
}));

/* ---------- 错误与 404 ---------- */
app.notFound((c) => {
  const path = c.req.path;
  if (path.startsWith('/api')) {
    return c.json({
      error: { message: '接口不存在', hint: `${c.req.method} ${path}` },
    }, 404);
  }
  return c.json({
    error: { message: '资源不存在', hint: `${c.req.method} ${path}` },
  }, 404);
});

app.onError((err, c) => {
  const status = Number(err && (err.status || err.statusCode)) || 500;
  const message = err && err.expose ? err.message : (status >= 500 ? '服务器内部错误' : (err && err.message) || '请求失败');
  const payload = { error: { message } };
  if (err && err.hint) payload.error.hint = err.hint;
  if (status >= 500) console.error('[worker-error]', err && err.stack || err && err.message);
  return c.json(payload, status);
});

export default app;
