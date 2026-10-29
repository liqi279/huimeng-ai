// 通用工具：错误、上游请求、data URL、编码等（对应 Express 版 http.js）

export class HttpError extends Error {
  constructor(status, message, hint) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
    if (hint) this.hint = hint;
  }
}

export function jsonError(status, message, hint) {
  return new HttpError(status, message, hint);
}

export function assert(condition, status, message, hint) {
  if (!condition) throw new HttpError(status, message, hint);
}

export function normalizeBase(base, fallback) {
  const value = typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  return value || fallback;
}

export function apiErrorText(status, text) {
  const raw = typeof text === 'string' ? text : '';
  let message = '';
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed && ((parsed.error && (parsed.error.message || parsed.error)) || parsed.message);
    if (typeof candidate === 'string') message = candidate;
  } catch (err) {
    // 非 JSON，忽略
  }
  if (!message) message = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  return message ? `上游接口错误（${status}）：${message}` : `上游接口错误（HTTP ${status}）`;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
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

export async function readJsonResponse(res, hint) {
  const text = await res.text();
  if (!res.ok) throw jsonError(502, apiErrorText(res.status, text), hint);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw jsonError(502, '上游返回非 JSON 响应', hint);
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 30000, hint) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  return readJsonResponse(res, hint);
}

/* ---------- data URL ---------- */

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

export function extFromMime(mime) {
  return MIME_EXT[String(mime || '').toLowerCase()] || '';
}

export function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
  assert(match, 400, '文件格式不正确', '需要 data:<mime>;base64,<数据> 形式的 data URL');
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  const isBase64 = Boolean(match[2]);
  const bytes = isBase64
    ? base64ToBytes(match[3])
    : new TextEncoder().encode(decodeURIComponent(match[3]));
  return { bytes, mime, base64: isBase64 };
}

/* ---------- base64（Workers 无 Buffer，手写分块实现，避免大数组展开超限） ---------- */

const CHUNK = 0x8000;

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------- 其它 ---------- */

export function randomToken(bytes = 4) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i += 1) out += buf[i].toString(16).padStart(2, '0');
  return out;
}

export function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 1 + (buf[0] % 2147483646);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 宽容读取 JSON 请求体（无 body / 解析失败时返回 {}，与 Express 行为基本一致） */
export async function readJsonBody(c) {
  try {
    const data = await c.req.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err) {
    return {};
  }
}
