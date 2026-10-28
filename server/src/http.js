'use strict';

const crypto = require('crypto');
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
  if (!res.ok) throw jsonError(502, apiErrorText(res.status, text), hint);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw jsonError(502, '上游返回非 JSON 响应', hint);
  }
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
};
