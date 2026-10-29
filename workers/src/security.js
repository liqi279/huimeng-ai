// 密码哈希（PBKDF2）与 token（HMAC-SHA256），全部基于 Web Crypto，无 Node 依赖
import { getConfig } from './config.js';

// Cloudflare 免费层单次请求 CPU 限制为 10ms，100k 次 PBKDF2 会超限，
// 这里降到 10000 次（仍是 PBKDF2-SHA256）。如需更强可自建 Worker 付费计划后调高。
const ITERATIONS = 10000;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  const value = String(hex || '');
  const out = new Uint8Array(Math.floor(value.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.substr(i * 2, 2), 16) || 0;
  return out;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomHex(byteLength = 8) {
  return bytesToHex(randomBytes(byteLength));
}

export function newUserId() {
  return 'u_' + randomHex(8);
}

export function randomUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password) {
  const salt = bytesToHex(randomBytes(SALT_BYTES));
  const hash = await pbkdf2(password, salt);
  return { salt, hash };
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const computed = await pbkdf2(password, salt);
    return safeEqual(computed, String(hash));
  } catch (err) {
    return false;
  }
}

function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/* ---------- token：base64url(payload).base64url(hmac)，三段式便于前端沿用 ---------- */

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(text) {
  return base64UrlEncode(encoder.encode(text));
}

function base64UrlDecodeText(value) {
  let normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function signToken(env, payload) {
  const secret = getConfig(env).TOKEN_SECRET;
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncodeText(JSON.stringify({ ...payload, iat: Date.now() }));
  const signature = await hmac(secret, `${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = await hmac(getConfig(env).TOKEN_SECRET, `${header}.${body}`);
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(base64UrlDecodeText(body));
  } catch (err) {
    return null;
  }
}
