'use strict';

const crypto = require('crypto');
const https = require('https');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, hint) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
    if (hint) this.hint = hint;
  }
}

function jsonError(status, message, hint) {
  return new HttpError(status, message, hint);
}

function assert(condition, status, message, hint) {
  if (!condition) throw new HttpError(status, message, hint);
}

// Wrap async route handlers so rejected promises reach the express error handler.
function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeBase(base) {
  const value = typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  return value || config.RAYIN_BASE;
}

function apiErrorText(status, text) {
  const raw = typeof text === 'string' ? text : '';
  let message = '';
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed && (parsed.error && (parsed.error.message || parsed.error) || parsed.message);
    if (typeof candidate === 'string') message = candidate;
  } catch (err) {
    // not JSON, fall through
  }
  if (!message) message = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  return message ? `上游接口错误（${status}）：${message}` : `上游接口错误（HTTP ${status}）`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw jsonError(504, '上游请求超时', `超过 ${Math.round(timeoutMs / 1000)} 秒未响应`);
    throw jsonError(502, '上游网络请求失败', '请稍后重试');
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(res, hint) {
  const text = await res.text();
  if (!res.ok) throw jsonError(res.status, apiErrorText(res.status, text), hint);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw jsonError(502, '上游返回非 JSON 响应', hint);
  }
}

/* 显式 https.request 传输：不让 fetch/undici 的默认连接与响应头超时悄悄掐断长任务。
   三段超时分开：连接、响应头、整体；错误带 retryable 标记供上层决定是否重试。 */
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET',
]);

function httpsJson(url, opts = {}) {
  const {
    method = 'POST',
    headers = {},
    body = '',
    connectTimeoutMs = 15000,
    headersTimeoutMs = 90000,
    totalTimeoutMs = 120000,
  } = opts;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(jsonError(400, '上游地址格式不正确', url));
      return;
    }
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
    const startedAt = Date.now();
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      if (err) reject(err);
      else resolve(value);
    };
    const makeTimeout = (message, hint, code) => {
      const err = jsonError(504, message, hint);
      err.retryable = true;
      err.code = code;
      return err;
    };
    const totalTimer = setTimeout(() => {
      req.destroy(makeTimeout('上游整体超时', `超过 ${Math.round(totalTimeoutMs / 1000)} 秒`, 'UPSTREAM_TOTAL_TIMEOUT'));
    }, Math.max(1000, totalTimeoutMs));

    const req = https.request({
      method,
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search || ''}`,
      headers: Object.assign(
        {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'Accept-Encoding': 'identity',
        },
        headers,
      ),
      /* 连接阶段超时（建立 TCP/TLS） */
      timeout: connectTimeoutMs,
    }, (res) => {
      res.setTimeout(headersTimeoutMs, () => {
        req.destroy(makeTimeout('上游响应超时',
          `${Math.round(headersTimeoutMs / 1000)} 秒内未读完响应`, 'UPSTREAM_HEADERS_TIMEOUT'));
      });
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(null, {
        status: res.statusCode || 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        elapsedMs: Date.now() - startedAt,
      }));
      res.on('error', (err) => {
        const e = jsonError(502, '上游响应读取中断', err && err.message);
        e.retryable = true;
        e.code = (err && err.code) || 'UPSTREAM_BODY_ERROR';
        finish(e);
      });
    });

    /* 30s 空闲断链的补充防护：中间层常在链路空闲 30s 时回收连接，
       开启 TCP keepalive（15s 探测一次）让链路始终有报文，避免被判定空闲。 */
    req.on('socket', (socket) => {
      try {
        socket.setKeepAlive(true, 15000);
        socket.setNoDelay(true);
      } catch (err) {}
    });

    req.on('timeout', () => {
      /* 只覆盖「连接+首字节」阶段；整体与读响应另有定时器 */
      if (Date.now() - startedAt >= connectTimeoutMs) {
        req.destroy(makeTimeout('上游连接超时',
          `${Math.round(connectTimeoutMs / 1000)} 秒内未建立连接`, 'UPSTREAM_CONNECT_TIMEOUT'));
      }
    });
    req.on('error', (err) => {
      if (err && err.expose) {
        finish(err);
        return;
      }
      const code = (err && err.code) || 'UPSTREAM_NETWORK';
      const e = jsonError(502, '上游网络请求失败', (err && err.message) || code);
      e.retryable = NETWORK_CODES.has(code) || /socket|reset|network/i.test(String((err && err.message) || ''));
      e.code = code;
      finish(e);
    });

    if (payload.length) req.write(payload);
    req.end();
  });
}

/* 网络类失败重试一次；401/403/400/内容审核不重试。
   总预算由 deadline 控制，避免函数超时被无限拉长。 */
function isRetryableUpstream(err) {
  if (!err) return false;
  const status = Number(err.status || 0);
  if (status === 401 || status === 403 || status === 400 || status === 422) return false;
  if (err.retryable) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  return /ECONNRESET|ETIMEDOUT|socket|network|timeout|超时/i.test(String(err.message || '') + ' ' + String(err.code || ''));
}

async function withOneRetry(deadline, fn) {
  /* 每次尝试的耗时/错误码都记下来，失败时随任务一起落库：
     下次出问题能直接看到「有没有重试、两次各花多久、各自什么错误」。 */
  const attempts = [];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    try {
      const value = await fn(attempt);
      attempts.push({ attempt: attempt + 1, ok: true, elapsedMs: Date.now() - startedAt });
      return value;
    } catch (err) {
      attempts.push({
        attempt: attempt + 1,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        status: Number((err && (err.status || err.statusCode)) || 0),
        code: String((err && err.code) || ''),
        message: String((err && err.message) || '').slice(0, 200),
        retryable: isRetryableUpstream(err),
      });
      lastErr = err;
      if (attempt === 1 || !isRetryableUpstream(err)) {
        err.attempts = attempts;
        throw err;
      }
      /* 剩余预算不足 20 秒就不再重试 */
      if (Date.now() + 20000 > deadline) {
        err.attempts = attempts;
        err.retrySkipped = 'budget';
        throw err;
      }
    }
  }
  throw lastErr;
}

async function fetchJson(url, options = {}, timeoutMs = 30000, hint) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  return readJsonResponse(res, hint);
}

function pickImage(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = pickImage(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof payload === 'object') {
    const preferred = ['url', 'path', 'image_url', 'image', 'b64_json'];
    for (const key of preferred) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        if (key === 'b64_json') return `data:image/png;base64,${value.trim()}`;
        return value.trim();
      }
      if (value && typeof value === 'object') {
        const nested = pickImage(value);
        if (nested) return nested;
      }
    }
    const recursive = ['data', 'images', 'output', 'result'];
    for (const key of recursive) {
      if (key in payload) {
        const found = pickImage(payload[key]);
        if (found) return found;
      }
    }
  }
  return '';
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
  assert(match, 400, '文件格式不正确', '需要 data:<mime>;base64,<数据> 形式的 data URL');
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  const isBase64 = Boolean(match[2]);
  const buffer = isBase64
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { buffer, mime, base64: isBase64 };
}

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
};

function extFromMime(mime) {
  return MIME_EXT[String(mime || '').toLowerCase()] || '';
}

function randomToken(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomSeed() {
  return crypto.randomInt(1, 2147483647);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  HttpError,
  jsonError,
  assert,
  wrap,
  normalizeBase,
  apiErrorText,
  fetchWithTimeout,
  readJsonResponse,
  fetchJson,
  pickImage,
  dataUrlToBuffer,
  extFromMime,
  randomToken,
  randomSeed,
  sleep,
  httpsJson,
  withOneRetry,
  isRetryableUpstream,
};
