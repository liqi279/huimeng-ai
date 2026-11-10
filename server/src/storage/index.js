'use strict';

/* =============================================================
 * 统一 storage 适配层
 * -------------------------------------------------------------
 * 对上只暴露 4 个能力：put（上传）/ signatureUrl 或 publicUrl（可读 URL）/ remove（删除）/ status。
 * 业务代码（routes/*、media-store、user-data）只调本文件，不直接碰 SDK。
 * 未来换存储只改 STORAGE_BACKEND 与对应环境变量，业务代码不动。
 *
 * 后端：
 *   oss     阿里云 OSS（当前启用，见 ./oss.js）
 *   github  主仓库存储（预留空壳，未实现）
 *   r2      Cloudflare R2（预留空壳，未实现）
 *   local   服务器本地盘（仅开发调试；Render 重启即丢）
 *
 * STORAGE_BACKEND=auto（默认）：OSS 凭证齐全走 oss，否则回落 local 并告警；
 * STORAGE_BACKEND=oss 但凭证缺失：进入 error 态，上传接口返回 503 且提示缺哪些变量，
 * 不静默写本地盘（避免生产环境误以为已持久化）。
 * ============================================================= */

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const config = require('../config');

const oss = require('./oss');
const cos = require('./cos');
const github = require('./github');
const r2 = require('./r2');

const LOCAL_ROOT = path.join(config.DATA_DIR, 'userdata');

const BACKENDS = { oss, cos, github, r2 };

const state = {
  backend: 'local',
  mode: 'pending',      // s3 | local | error
  label: '',
  error: null,
  ready: false,
};

function localPath(key) {
  const safe = String(key).split('/').filter((s) => s && s !== '.' && s !== '..').join(path.sep);
  return path.join(LOCAL_ROOT, safe);
}

function useLocal(reason) {
  state.backend = 'local';
  state.mode = 'local';
  state.label = '服务器本地盘（仅开发调试）';
  state.ready = true;
  state.error = reason || null;
  console.warn('[storage] 当前为本地盘存储（' + LOCAL_ROOT + '）。' +
    'Render 重启/重新部署会丢图片，请配置 OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET。');
  return state;
}

function init() {
  const want = String(config.STORAGE_BACKEND || 'auto').toLowerCase();

  if (want === 'local') {
    return useLocal(null);
  }

  if (want !== 'auto' && BACKENDS[want]) {
    const impl = BACKENDS[want];
    impl.init(config);
    const implStatus = impl.status();
    state.backend = want;
    state.ready = Boolean(implStatus.ready);
    state.label = implStatus.label;
    state.error = implStatus.error || null;
    if (implStatus.ready) {
      state.mode = 's3';
      console.log('[storage] 后端已启用：' + want + ' / ' + (implStatus.bucket || '') +
        (implStatus.region ? '（' + implStatus.region + '）' : ''));
    } else {
      state.mode = 'error';
      console.error('[storage] STORAGE_BACKEND=' + want + ' 但后端不可用：' + state.error);
    }
    return state;
  }

  /* auto：OSS 凭证齐全就启用，否则回落本地盘（开发调试） */
  oss.init(config);
  const ossStatus = oss.status();
  if (ossStatus.ready) {
    state.backend = 'oss';
    state.mode = 's3';
    state.label = ossStatus.label;
    state.ready = true;
    state.error = null;
    console.log('[storage] 后端已启用：oss / ' + ossStatus.bucket + '（' + ossStatus.region + '）');
    return state;
  }
  return useLocal(ossStatus.error);
}

function impl() {
  const backend = BACKENDS[state.backend];
  if (!backend) return null;
  return backend;
}

function assertUsable() {
  if (state.mode === 'error') {
    throw Object.assign(new Error(state.error || '存储后端不可用'), {
      status: 503,
      expose: true,
      hint: '检查服务端环境变量 STORAGE_BACKEND 与 OSS_* 配置',
    });
  }
}

/* 上传 */
async function put(key, buffer, mime) {
  assertUsable();
  if (state.backend === 'local') {
    const file = localPath(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, file);
    return { key, storage: 'local' };
  }
  return impl().put(key, buffer, mime);
}

/* 读取原始字节（本地盘兜底读取 / 小文件代理） */
async function read(key) {
  assertUsable();
  if (state.backend === 'local') return fsp.readFile(localPath(key));
  return impl().read(key);
}

/* 删除：后端报错由调用方决定是否容忍，这里不吞异常 */
async function remove(key) {
  assertUsable();
  if (state.backend === 'local') {
    await fsp.unlink(localPath(key)).catch(() => {});
    return true;
  }
  return impl().remove(key);
}

/* 可读 URL：优先公开域名（CDN），否则短时效签名 URL */
function publicUrl(key) {
  if (state.backend === 'local') return null;
  if (state.mode === 'error') return null;
  const backend = impl();
  if (!backend) return null;
  return backend.publicUrl(key) || null;
}

function signatureUrl(key, opts) {
  assertUsable();
  if (state.backend === 'local') return null;
  return impl().signatureUrl(key, opts);
}

/* 给前端/第三方用的可读地址：公开域名 > 签名 URL > 本地 /uploads 相对路径 */
function readableUrl(key, opts) {
  const direct = publicUrl(key);
  if (direct) return direct;
  const signed = signatureUrl(key, Object.assign({ method: 'GET', ttl: config.STORAGE_URL_TTL }, opts || {}));
  return signed;
}

function status() {
  const backendStatus = state.backend === 'local' ? null : (impl() && impl().status());
  return {
    backend: state.backend,
    mode: state.mode,
    label: state.label,
    ready: state.ready,
    error: state.error,
    localRoot: state.backend === 'local' ? LOCAL_ROOT : null,
    backendStatus,
  };
}

module.exports = {
  init,
  put,
  read,
  remove,
  publicUrl,
  signatureUrl,
  readableUrl,
  status,
  LOCAL_ROOT,
};
