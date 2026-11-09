'use strict';

/* =============================================================
 * storage 后端：Cloudflare R2（预留，未启用）
 * -------------------------------------------------------------
 * 与 github.js 同理：只留同接口空壳，不引入依赖、不读取凭证。
 * R2 走 S3 协议，实现时复用 SigV4 即可，接口保持不变。
 * ============================================================= */

const BACKEND = 'r2';

function notImplemented() {
  return Object.assign(new Error('storage 后端 r2 尚未实现（当前启用的是 oss）'), {
    status: 501,
    expose: true,
    hint: '把 STORAGE_BACKEND 改回 oss，或先实现 server/src/storage/r2.js',
  });
}

function init() {
  return { backend: BACKEND, ready: false, error: '未实现（预留）' };
}

async function put() { throw notImplemented(); }
async function read() { throw notImplemented(); }
async function remove() { throw notImplemented(); }
function signatureUrl() { throw notImplemented(); }
function publicUrl() { return null; }

function status() {
  return { backend: BACKEND, ready: false, label: 'Cloudflare R2（未实现）', error: '未实现（预留）' };
}

module.exports = { init, put, read, remove, signatureUrl, publicUrl, status };
