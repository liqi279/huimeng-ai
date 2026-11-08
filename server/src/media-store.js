'use strict';

/* =============================================================
 * 生成类媒体存储（上传素材 / 视频 / 音频）
 * -------------------------------------------------------------
 * 背景：早先 assets.js / art.js / animation.js / generate.js / tts.js
 * 直接往 data/runtime/media|assets 写文件，再返回 /uploads/... 路径。
 * Render 这类容器重启即清空磁盘，生成结果会丢；本模块把这些写入
 * 统一改走 object-store（S3 / OSS；未配置时由 object-store 自带回落
 * 本地盘 data/runtime/userdata）。
 *
 * 设计约束：
 *   1. 对外 URL 形状完全不变：仍是 /uploads/assets/<name>、/uploads/media/<name>，
 *      前端与历史记录里的链接都不需要改；
 *   2. object key 与 URL 路径一一对应（assets/<name>、media/<name>），
 *      便于 index.js 的 /uploads 兜底路由按同名 key 回读；
 *   3. 历史本地盘文件继续由 index.js 的 express.static 直接服务
 *      （静态中间件先命中，命中不到才轮到兜底路由）；
 *   4. 未配置对象存储（OBJECT_STORE=local）时，写读都落在本地盘，
 *      功能不受影响。
 * ============================================================= */

const path = require('path');
const fsp = require('fs').promises;
const store = require('./store');
const objectStore = require('./object-store');

const KIND_DIR = {
  assets: () => store.dirs.assets,
  media: () => store.dirs.media,
};

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

function normalizeKind(kind) {
  return kind === 'assets' ? 'assets' : 'media';
}

function mimeByName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function objectKey(kind, name) {
  return normalizeKind(kind) + '/' + path.basename(String(name || ''));
}

/* 写入：一律走 objectStore.putObject（S3 或本地盘回落）。
   返回的 url 与旧行为一致，仍是 /uploads/<kind>/<name>。 */
async function put(kind, name, buffer, mime) {
  const key = objectKey(kind, name);
  const saved = await objectStore.putObject(key, buffer, mime);
  return { url: '/uploads/' + key, objectKey: key, storage: saved.storage };
}

/* 读取：供 index.js 的 /uploads 兜底路由使用。
   s3 模式返回预签名直链（跳转），本地模式返回文件内容。 */
async function send(kind, name) {
  const key = objectKey(kind, name);
  if (objectStore.status().mode === 's3') {
    return { mode: 's3', url: objectStore.presignGet(key) };
  }
  const buffer = await objectStore.readObject(key);
  return { mode: 'local', buffer, mime: mimeByName(key) };
}

/* 删除：对象存储与历史本地盘都尝试，全部容错（文件不存在视为已删除）。 */
async function remove(kind, name) {
  const safeName = path.basename(String(name || ''));
  if (!safeName) return;
  await objectStore.deleteObject(objectKey(kind, safeName)).catch(() => {});
  await fsp.unlink(path.join(KIND_DIR[normalizeKind(kind)](), safeName)).catch(() => {});
}

/* 需要交给第三方下载时用的绝对地址（如 Fish Audio 拉参考音频）：
   s3 模式给预签名直链，本地模式给 /uploads 静态代理的完整 URL。 */
function absoluteUrl(kind, name, origin) {
  const key = objectKey(kind, name);
  if (objectStore.status().mode === 's3') return objectStore.presignGet(key);
  return String(origin || '').replace(/\/+$/, '') + '/uploads/' + key;
}

module.exports = {
  put,
  send,
  remove,
  absoluteUrl,
  mimeByName,
};
