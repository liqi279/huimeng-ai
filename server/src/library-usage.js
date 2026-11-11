'use strict';

/* =============================================================
 * 藏书阁已用空间（真实对象大小，非记录估算）
 * -------------------------------------------------------------
 * 口径：对象存储 `library/` 前缀下所有对象（书籍 PDF + 封面）的
 *       Content-Length 之和，直接 list 桶取得，不做任何估算。
 * 缓存：默认 90s TTL（LIBRARY_USAGE_TTL_MS 可调），并发请求单飞；
 *       新增/改名/删除书籍后由路由调用 invalidate() 立即失效。
 * 失败：返回 usedBytes=null，绝不抛给接口导致 500。
 * ============================================================= */

const objectStore = require('./object-store');

const PREFIX = 'library/';
const LIMIT_LABEL = '500G';
const TTL_MS = Math.max(5000, Number(process.env.LIBRARY_USAGE_TTL_MS) || 90000);

let cachedAt = 0;
let cachedBytes = null;
let lastError = null;
let inFlight = null;

function invalidate() {
  cachedAt = 0;
  cachedBytes = null;
  lastError = null;
}

function human(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  const gb = bytes / 1073741824;
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = bytes / 1048576;
  return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
}

async function load() {
  try {
    const objects = await objectStore.listPrefix(PREFIX);
    const bytes = objects.reduce((sum, o) => sum + (Number(o.size) || 0), 0);
    cachedBytes = bytes;
    lastError = null;
    console.log('[library-usage] ' + PREFIX + ' 对象数=' + objects.length + ' 合计=' + bytes + 'B');
    return { objects: objects.length, bytes };
  } catch (err) {
    cachedBytes = null;
    lastError = (err && err.message) || String(err);
    console.warn('[library-usage] 统计失败（usedBytes 将返回 null）：' + lastError);
    return { objects: 0, bytes: null };
  } finally {
    cachedAt = Date.now();
    inFlight = null;
  }
}

async function get() {
  const fresh = cachedAt && Date.now() - cachedAt < TTL_MS;
  if (fresh) {
    return { usedBytes: cachedBytes, limitLabel: LIMIT_LABEL, usedHuman: human(cachedBytes), cached: true, ageMs: Date.now() - cachedAt, error: lastError };
  }
  if (!inFlight) inFlight = load();
  const result = await inFlight;
  return { usedBytes: result.bytes, limitLabel: LIMIT_LABEL, usedHuman: human(result.bytes), cached: false, ageMs: 0, error: lastError };
}

/* 路由侧直接用：把 usedBytes/limitLabel/usedHuman 合并进 store 对象 */
async function stats() {
  const u = await get();
  return {
    usedBytes: u.usedBytes,
    limitLabel: u.limitLabel,
    usedHuman: u.usedHuman,
    usedCached: u.cached,
    usedAgeMs: u.ageMs,
    usedError: u.error || null,
  };
}

module.exports = { get, stats, invalidate, human, PREFIX, LIMIT_LABEL, TTL_MS };
