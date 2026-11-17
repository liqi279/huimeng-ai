'use strict';

/* 腾讯云 SCF 入口：把现有 Express 应用挂成 main_handler
 * 落盘路径：server/scf.js
 * 控制台「执行入口」填：scf.main_handler
 * 打包要求：zip 根目录直接是 scf.js + src/ + node_modules/
 */

const serverless = require('serverless-http');

/* 必须在 require('./src/index') 之前设置：config.js 加载即读取。
   SCF 只有 /tmp 可写，/var/user（代码目录）只读。 */
process.env.SCF_MODE = '1';
process.env.HTTPS = 'off';
if (!process.env.DATA_DIR) process.env.DATA_DIR = '/tmp/huimeng/runtime';
if (!process.env.DATA_ROOT) process.env.DATA_ROOT = '/tmp/huimeng/data';
if (!process.env.USER_STORE) process.env.USER_STORE = 'mysql';
if (!process.env.LIBRARY_STORE) process.env.LIBRARY_STORE = 'mysql';
if (!process.env.USER_DATA_STORE) process.env.USER_DATA_STORE = 'mysql';

const app = require('./src/index');

/* 二进制响应必须显式登记，否则 PDF / 图片会被当 UTF-8 转坏 */
const handler = serverless(app, {
  binary: [
    'application/pdf',
    'application/octet-stream',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'video/mp4',
    'video/webm',
  ],
});

const API_PREFIX = process.env.API_PREFIX || '/api';

/* 函数 URL 有的形态会带 /api 前缀，有的只把剩余路径传进来。
   这里统一补齐：已经以 /api 开头就不动，否则补上。
   这样两种形态都能落到 Express 的 /api/* 路由上。 */
function normalizeEvent(event) {
  const e = Object.assign({}, event || {});
  const raw = e.path || e.rawPath || '/';
  const path = String(raw).split('?')[0] || '/';
  if (!(path === API_PREFIX || path.indexOf(API_PREFIX + '/') === 0)) {
    e.path = API_PREFIX + (path === '/' ? '' : path);
  } else {
    e.path = path;
  }

  /* HTTP 方法兜底（不同触发器字段名不同） */
  if (!e.httpMethod) {
    const rc = e.requestContext || {};
    e.httpMethod = rc.httpMethod || (rc.http && rc.http.method) || 'GET';
  }

  /* 查询串兜底：腾讯云函数 URL 把 query 放在 queryString（对象），
     serverless-http 只读 queryStringParameters，这里搬过去。
     实测（2026-11-10，huimeng-api 函数 URL）：queryString={'x':'1'}、
     queryStringParameters={} 恒为空对象，httpMethod 已存在。 */
  const qsp = e.queryStringParameters;
  const emptyQsp = !qsp || (typeof qsp === 'object' && Object.keys(qsp).length === 0);
  if (emptyQsp && e.queryString && typeof e.queryString === 'object') {
    e.queryStringParameters = e.queryString;
  } else if (emptyQsp && typeof e.rawQueryString === 'string' && e.rawQueryString) {
    const q = {};
    new URLSearchParams(e.rawQueryString).forEach((v, k) => { q[k] = v; });
    e.queryStringParameters = q;
  }
  return e;
}

/* index.js 里 store.ensureDirs() 是异步初始化，首请求要等它完成；
   失败时清缓存，让下次冷启动重试 */
let ready = null;
function waitReady() {
  if (!ready) {
    ready = Promise.resolve(app.ready).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/* 腾讯云函数 URL 会给「没有 Content-Disposition」的响应自动补 attachment，
   浏览器直接打开 /api/health 就变成下载文件。这里对 json/text/xml 显式声明 inline；
   文件下载接口自己设置的 attachment 不受影响。
   同时把响应头名统一成 Title-Case：函数 URL 网关按大小写匹配
   Content-Type，Express 输出的全小写头会让网关误判为 JSON，
   造成「重复 Content-Type + 二进制 body 丢失」。 */
function canonicalHeaderName(name) {
  return String(name).split('-').map((part) => (
    part ? part.charAt(0).toUpperCase() + part.slice(1) : part
  )).join('-');
}

function withInlineDisposition(out) {
  if (!out || !out.headers) return out;
  const source = out.headers;
  const headers = {};
  Object.keys(source).forEach((key) => {
    headers[canonicalHeaderName(key)] = source[key];
  });
  const keys = Object.keys(headers);
  if (!keys.some((k) => k.toLowerCase() === 'content-disposition')) {
    const ctKey = keys.find((k) => k.toLowerCase() === 'content-type');
    const ct = ctKey ? String(headers[ctKey]) : '';
    if (/^(application\/json|text\/|application\/xml|application\/javascript)/i.test(ct)) {
      headers['Content-Disposition'] = 'inline';
    }
  }
  out.headers = headers;
  return out;
}

exports.main_handler = async (event, context) => {
  /* 别让 mysql2 / ali-oss 的句柄把事件循环挂住导致超时 */
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  await waitReady();

  /* 异步任务入口：提交接口通过 SCF Invoke(Event) 再调一次本函数，
     payload 形如 {"__job":"<jobId>"}。这类调用不是 HTTP 请求，
     直接跑生成任务并把结果写回 generate_jobs，然后立即返回。 */
  if (event && typeof event === 'object' && event.__job) {
    const { runJob } = require('./src/routes/generate');
    try {
      await runJob(event.__job);
    } catch (err) {
      /* 失败已由 runJob 写入任务表，这里只保证事件调用本身不抛错重试 */
      console.error('[scf] job failed', event.__job, err && err.message);
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' };
  }

  const out = await handler(normalizeEvent(event), context);
  return withInlineDisposition(out);
};
