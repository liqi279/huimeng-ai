'use strict';

/* =============================================================
 * storage 后端：GitHub 仓库（预留，未启用）
 * -------------------------------------------------------------
 * 用户已决定继续使用阿里云 OSS，本后端只保留与 storage 适配层
 * 一致的接口空壳，不引入任何依赖、不读取任何凭证。
 * 需要启用时实现 put / read / remove / signatureUrl / publicUrl 即可，
 * 业务代码无需改动（只改 STORAGE_BACKEND=github）。
 * ============================================================= */

const BACKEND = 'github';

function notImplemented() {
  return Object.assign(new Error('storage 后端 github 尚未实现（当前启用的是 oss）'), {
    status: 501,
    expose: true,
    hint: '把 STORAGE_BACKEND 改回 oss，或先实现 server/src/storage/github.js',
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
  return { backend: BACKEND, ready: false, label: 'GitHub 仓库（未实现）', error: '未实现（预留）' };
}

module.exports = { init, put, read, remove, signatureUrl, publicUrl, status };
