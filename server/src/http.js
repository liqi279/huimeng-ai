'use strict';

const crypto = require('crypto');
const dns = require('dns');
const https = require('https');
const net = require('net');
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
   三段超时分开：连接、响应头、整体；错误带 preSend 标记供上层决定是否重试。 */

/* 只有「请求确定没有发出去」的错误才允许重试：
   这些错误发生在 DNS/建连阶段，上游根本没收到请求，重试不会重复计费。
   一旦 TCP/TLS 建好、请求体已写出，之后的任何断开（ECONNRESET/EPIPE/
   响应头超时/整体超时/5xx）都视为「上游可能已受理」，一律不重试——
   否则同一张图会被上游扣两次费（用户已在 RayinAI 后台看到成功扣费）。 */
const PRESEND_CODES = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'UPSTREAM_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

async function httpsJson(url, opts = {}) {
  const {
    method = 'POST',
    headers = {},
    body = '',
    connectTimeoutMs = 15000,
    headersTimeoutMs = 90000,
    totalTimeoutMs = 120000,
  } = opts;
  let target;
  try {
    target = new URL(url);
  } catch (err) {
    throw jsonError(400, '上游地址格式不正确', url);
  }

  /* 同一域名常有多条 A 记录，出网侧有时只对其中某条黑洞（表现为建连 15 秒无响应）。
     先解析全部 IPv4，逐个尝试；只有「建连阶段」的失败才换下一个地址，
     请求一旦发出就绝不换——避免同一张图被上游扣两次费。
     强制 IPv4：SCF 无 IPv6 出口时，优先解析到 AAAA 会一直卡到超时。 */
  let addresses = [];
  if (net.isIP(target.hostname)) {
    addresses = [target.hostname];
  } else {
    addresses = await new Promise((resolve) => {
      dns.lookup(target.hostname, { all: true, family: 4 }, (err, list) => {
        resolve(err || !list ? [] : list.map((item) => item.address));
      });
    });
  }
  if (!addresses.length) addresses = [''];
  /* 同一域名 A 记录可能很多，全试会让单次请求拖到几分钟：最多取前 6 条 */
  if (addresses.length > 6) addresses = addresses.slice(0, 6);

  let lastErr = null;
  for (let i = 0; i < addresses.length; i += 1) {
    try {
      return await httpsJsonVia(target, addresses[i], {
        method, headers, body, connectTimeoutMs, headersTimeoutMs, totalTimeoutMs,
      });
    } catch (err) {
      lastErr = err;
      if (!(err && err.preSend)) throw err;
    }
  }
  throw lastErr || jsonError(502, '上游网络请求失败', 'no-address');
}

function httpsJsonVia(target, address, {
  method, headers, body, connectTimeoutMs, headersTimeoutMs, totalTimeoutMs,
}) {
  return new Promise((resolve, reject) => {
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
    let connected = false;
    const makeTimeout = (message, hint, code, preSend) => {
      const err = jsonError(504, message, hint);
      err.retryable = Boolean(preSend);
      err.preSend = Boolean(preSend);
      err.code = code;
      err.upstreamHost = target.hostname;
      err.address = address;
      return err;
    };
    const totalTimer = setTimeout(() => {
      req.destroy(makeTimeout('上游整体超时', `超过 ${Math.round(totalTimeoutMs / 1000)} 秒`, 'UPSTREAM_TOTAL_TIMEOUT', false));
    }, Math.max(1000, totalTimeoutMs));

    const req = https.request({
      method,
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search || ''}`,
      /* 指定这一轮要连的具体 IPv4；SNI / Host 仍用原域名 */
      lookup: address
        ? ((hostname, options, cb) => cb(null, address, 4))
        : undefined,
      family: address ? 4 : undefined,
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
      connected = true;
      const headersMs = Date.now() - startedAt;
      res.setTimeout(headersTimeoutMs, () => {
        req.destroy(makeTimeout('上游响应超时',
          `${Math.round(headersTimeoutMs / 1000)} 秒内未读完响应`, 'UPSTREAM_HEADERS_TIMEOUT', false));
      });
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(null, {
        status: res.statusCode || 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        headersMs,
        elapsedMs: Date.now() - startedAt,
      }));
      res.on('error', (err) => {
        const e = jsonError(502, '上游响应读取中断', err && err.message);
        e.retryable = false;
        e.preSend = false;
        e.code = (err && err.code) || 'UPSTREAM_BODY_ERROR';
        e.elapsedMs = Date.now() - startedAt;
        e.headersMs = headersMs;
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
      if (Date.now() - startedAt >= connectTimeoutMs && !connected) {
        req.destroy(makeTimeout('上游连接超时',
          `${Math.round(connectTimeoutMs / 1000)} 秒内未建立连接`, 'UPSTREAM_CONNECT_TIMEOUT', true));
      }
    });
    req.on('error', (err) => {
      if (err && err.expose) {
        err.elapsedMs = err.elapsedMs || (Date.now() - startedAt);
        finish(err);
        return;
      }
      const code = (err && err.code) || 'UPSTREAM_NETWORK';
      const e = jsonError(502, '上游网络请求失败', (err && err.message) || code);
      /* 建连之前就失败 = 上游确定没收到请求，可安全重试；
         建连之后断开（含 30s 被中间层掐断）= 上游可能已受理，绝不重试 */
      e.preSend = !connected && PRESEND_CODES.has(code);
      e.retryable = e.preSend;
      e.code = code;
      e.upstreamHost = target.hostname;
      e.address = address;
      e.elapsedMs = Date.now() - startedAt;
      finish(e);
    });

    if (payload.length) req.write(payload);
    req.end();
  });
}

/* 只对「确定没发出去」的失败重试（见 PRESEND_CODES）。
   401/403/400/内容审核、响应超时、连接被重置、上游 5xx 一律不重试，
   避免同一张图被上游扣两次费。 */
function isRetryableUpstream(err) {
  if (!err) return false;
  return err.preSend === true;
}

async function withPreSendRetry(deadline, fn) {
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
        preSend: Boolean(err && err.preSend),
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
  withPreSendRetry,
  isRetryableUpstream,
};
