'use strict';

/* =============================================================
 * 绘梦 · 用户作品数据门面（MySQL / 文件双实现 + 对象存储）
 * -------------------------------------------------------------
 * 上层路由只依赖本文件导出的方法，不关心底层是 MySQL 还是文件。
 * 选择规则（启动时确定，避免同一用户数据被写到两处）：
 *   USER_DATA_STORE=mysql → 必须 MySQL（未就绪则抛 503）
 *   USER_DATA_STORE=file  → 强制文件
 *   USER_DATA_STORE=auto  → 账号库是 MySQL 就用 MySQL，否则文件（并告警）
 * ============================================================= */

const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const userStore = require('./user-store-mysql');
const objectStore = require('./object-store');
const mysqlImpl = require('./user-data-mysql');
const fileImpl = require('./user-data-file');
const { dataUrlToBuffer, extFromMime, jsonError } = require('./http');

const MIME_EXT_FALLBACK = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4' };

let provider = null;
let mode = 'pending';

function choose() {
  if (config.USER_DATA_STORE === 'file') return { impl: fileImpl, mode: 'file' };
  if (userStore.isReady()) return { impl: mysqlImpl, mode: 'mysql' };
  if (config.USER_DATA_STORE === 'mysql') {
    const st = userStore.state();
    throw jsonError(503, '用户数据数据库(MySQL)不可用：' + (st.error || '未连接'),
      '配置 MYSQL_URL 或 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD；或改 USER_DATA_STORE=auto 回落文件存储');
  }
  return { impl: fileImpl, mode: 'file' };
}

async function init() {
  objectStore.init();
  const picked = choose();
  provider = picked.impl;
  mode = picked.mode;
  await provider.init();
  console.log('[user-data] 当前用户数据存储：' + (mode === 'mysql' ? 'MySQL' : '文件存储（Render 重启可能丢失）') +
    '；图片存储：' + objectStore.status().label);
  return status();
}

function impl() {
  if (!provider) {
    const picked = choose();
    provider = picked.impl;
    mode = picked.mode;
  }
  return provider;
}

function status() {
  const obj = objectStore.status();
  const st = {
    dataStore: mode === 'mysql' ? 'mysql' : 'file',
    dataLabel: mode === 'mysql' ? 'MySQL' : '文件存储',
    database: mode === 'mysql' ? userStore.databaseName() : null,
    objectStore: obj.mode,
    objectLabel: obj.label,
    bucket: obj.bucket,
    endpoint: obj.endpoint,
    warnings: [],
  };
  if (mode !== 'mysql') {
    st.warnings.push('用户作品/项目数据当前为文件存储，Render 重启可能丢失；请配置 MySQL。');
  }
  if (obj.mode !== 's3') {
    st.warnings.push('作品图片当前存放在服务器本地盘，Render 重启会丢失；请配置 S3/R2/MinIO。');
  }
  return st;
}

/* ---------------- 作品 ---------------- */
function listChanges(userId, opts) { return impl().listChanges(userId, opts && opts.since, opts && opts.limit); }
function getWork(userId, id) { return impl().getWork(userId, id); }
function putWork(userId, work, baseRev) {
  return impl().putWork(userId, work, baseRev).then(async (saved) => {
    /* 超出单用户作品上限时，底层会裁掉最旧的；同步清理对象存储里的图片 */
    const trimmed = saved && saved._trimmed;
    if (Array.isArray(trimmed)) {
      for (const item of trimmed) {
        for (const key of (item.objectKeys || [])) {
          await objectStore.deleteObject(key).catch(() => {});
        }
        if (item.assetKey) await objectStore.deleteObject(item.assetKey).catch(() => {});
      }
    }
    if (saved) delete saved._trimmed;
    return saved;
  });
}
function deleteWork(userId, id, baseRev) { return impl().deleteWork(userId, id, baseRev); }
function clearWorks(userId) { return impl().clearWorks(userId); }

/* ---------------- 文档 ---------------- */
function getDoc(userId, kind) { return impl().getDoc(userId, kind); }
function putDoc(userId, kind, data, baseRev) { return impl().putDoc(userId, kind, data, baseRev); }

/* ---------------- 资产（图片二进制） ---------------- */
/* 图片 URL 必须绝对地址：前端部署在 GitHub Pages，相对 /api 会指到静态站。
   优先 PUBLIC_BASE_URL，其次按反代头推导（Render 会带 x-forwarded-proto/host）。 */
function publicBase(req) {
  if (config.PUBLIC_BASE_URL) return config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  var proto = 'https';
  var host = '';
  if (req && req.headers) {
    proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
    host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  }
  if (!host) return '/api';
  return proto + '://' + host + '/api';
}

function assetPublicUrl(assetId, req) {
  return publicBase(req) + '/user-data/assets/' + encodeURIComponent(assetId) +
    '?t=' + signAssetToken(assetId);
}

function assetTokenSecret() {
  return config.TOKEN_SECRET;
}

function signAssetToken(assetId, ttlSec) {
  /* 链接会存进作品 JSON 供 <img src> 直接使用，所以给较长有效期（7 天）；
     每次 /works 或 /user-data/bootstrap 返回时会重新签发，前端缓存的旧链接过期也能自动恢复。 */
  const exp = Date.now() + Math.max(60, Number(ttlSec) || 604800) * 1000;
  const payload = String(assetId) + '.' + exp;
  const sig = crypto.createHmac('sha256', assetTokenSecret()).update(payload).digest('base64url');
  return Buffer.from(exp + '.' + sig, 'utf8').toString('base64url');
}

function verifyAssetToken(assetId, token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const dot = raw.indexOf('.');
    if (dot < 0) return false;
    const exp = Number(raw.slice(0, dot));
    const sig = raw.slice(dot + 1);
    if (!exp || exp < Date.now()) return false;
    const expect = crypto.createHmac('sha256', assetTokenSecret()).update(String(assetId) + '.' + exp).digest('base64url');
    return sig === expect;
  } catch (e) {
    return false;
  }
}

/* 保存作品图片：dataUrl → 对象存储，返回可长期使用的 url */
async function saveWorkAsset(userId, workId, dataUrl, req) {
  const decoded = dataUrlToBuffer(dataUrl);
  if (!decoded.buffer.length) throw jsonError(400, '图片内容为空');
  if (decoded.buffer.length > config.USER_ASSET_MAX_BYTES) {
    throw jsonError(413, '图片过大', '单张图片不能超过 ' + Math.round(config.USER_ASSET_MAX_BYTES / 1024 / 1024) + 'MB');
  }
  const userUsage = await impl().usage(userId);
  if (userUsage.bytes + decoded.buffer.length > config.USER_STORAGE_MAX_BYTES) {
    throw jsonError(413, '账号存储空间已满',
      '单账号上限 ' + Math.round(config.USER_STORAGE_MAX_BYTES / 1024 / 1024) + 'MB，请删除旧作品或联系管理员扩容');
  }
  const ext = extFromMime(decoded.mime) || MIME_EXT_FALLBACK[decoded.mime] || 'bin';
  const assetId = impl().newId('as');
  const objectKey = ['u', String(userId).slice(0, 40), String(workId || 'misc').slice(0, 64),
    assetId + '.' + ext].join('/');
  const sha256 = crypto.createHash('sha256').update(decoded.buffer).digest('hex');
  const put = await objectStore.putObject(objectKey, decoded.buffer, decoded.mime);
  await impl().saveAsset({
    id: assetId,
    userId,
    workId: workId || null,
    objectKey,
    mime: decoded.mime,
    bytes: decoded.buffer.length,
    sha256,
    createdAt: Date.now(),
  });
  return {
    assetId,
    objectKey,
    url: assetPublicUrl(assetId, req),
    mime: decoded.mime,
    bytes: decoded.buffer.length,
    sha256,
    storage: put.storage,
  };
}

function getAsset(assetId) { return impl().getAsset(assetId); }

async function deleteAsset(assetId) {
  const asset = await impl().getAsset(assetId);
  if (!asset) return null;
  await objectStore.deleteObject(asset.objectKey).catch((e) => {
    console.warn('[user-data] 对象存储删除失败（保留元数据墓碑）：' + (e && e.message));
  });
  await impl().removeAsset(asset.userId, assetId);
  return asset;
}

/* 按作品清理旧图（作品被覆盖/删除时） */
async function deleteAssetByWork(userId, workId) {
  const assets = await impl().listAssets(userId);
  const hit = assets.filter((a) => a.workId === workId);
  for (const a of hit) await deleteAsset(a.id);
  return hit.length;
}

function listAssets(userId) { return impl().listAssets(userId); }
function usage(userId) { return impl().usage(userId); }
function setState(userId, key, value) { return impl().setState(userId, key, value); }
function getState(userId, key) { return impl().getState(userId, key); }
function exportAll(userId) { return impl().exportAll(userId); }

module.exports = {
  init,
  status,
  DOC_KINDS: mysqlImpl.DOC_KINDS,
  listChanges,
  getWork,
  putWork,
  deleteWork,
  clearWorks,
  getDoc,
  putDoc,
  saveWorkAsset,
  getAsset,
  deleteAsset,
  deleteAssetByWork,
  listAssets,
  usage,
  setState,
  getState,
  exportAll,
  assetPublicUrl,
  signAssetToken,
  verifyAssetToken,
  objectStore,
};
