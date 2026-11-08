'use strict';

/* =============================================================
 * 绘梦 · 对象存储适配层（S3 协议）
 * -------------------------------------------------------------
 * 作品图片/视频等二进制只放对象存储，数据库只存 object key。
 * 兼容：Cloudflare R2（阶段0）、MinIO（阶段1 内网）、AWS S3、阿里云 OSS。
 *
 * 环境变量：
 *   OBJECT_STORE=auto|s3|local
 *   S3_ENDPOINT / S3_REGION / S3_BUCKET
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE=1（默认为 1；MinIO 需要）
 *     置 0/false 时改用 virtual-hosted：Host 变成 <bucket>.<endpoint host>，
 *     URL 路径不再带桶名。阿里云 OSS 只支持这种风格，必须置 0。
 *   S3_EXTRA_HEADER_OSS_COMPAT=1（可选，默认关闭）
 *     仅阿里云 OSS 需要时开启：给签名请求额外加 x-oss-s3-compat: true。
 *     走 s3.oss-*.aliyuncs.com 专属 endpoint 时一般不需要。
 *   S3_PUBLIC_BASE（可选 CDN）
 *
 * local 模式只用于开发调试：写 data/runtime/userdata，Render 重启会丢，
 * 启动日志与 /api/user-data/status 会明确告警。
 * ============================================================= */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const LOCAL_ROOT = path.join(config.DATA_DIR, 'userdata');

const state = {
  mode: 'pending',
  error: null,
  bucket: config.S3_BUCKET || null,
  endpoint: config.S3_ENDPOINT || null,
};

function wantS3() {
  if (config.OBJECT_STORE === 'local') return false;
  return Boolean(config.S3_ENDPOINT && config.S3_BUCKET &&
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
}

function init() {
  if (wantS3()) {
    state.mode = 's3';
    state.error = null;
  } else {
    state.mode = 'local';
    state.error = config.OBJECT_STORE === 's3'
      ? 'OBJECT_STORE=s3 但缺少 S3_ENDPOINT / S3_BUCKET / 密钥，已回落本地盘'
      : null;
  }
  if (state.mode === 'local') {
    console.warn('[object-store] 当前为本地盘存储（' + LOCAL_ROOT + '）。' +
      'Render 重启/重新部署会丢图片，请配置 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY（R2 或 MinIO）。');
  } else {
    console.log('[object-store] S3 对象存储已启用：' + state.endpoint + ' / ' + state.bucket + '（region=' + config.S3_REGION + '）');
  }
  return state;
}

function status() {
  return {
    mode: state.mode === 's3' ? 's3' : 'local',
    label: state.mode === 's3' ? '对象存储(S3)' : '服务器本地盘',
    endpoint: state.endpoint,
    bucket: state.bucket,
    warning: state.mode === 's3' ? ''
      : '图片存放在服务器本地盘，Render 重启会丢失；请配置 S3/R2/MinIO。',
    error: state.error,
  };
}

/* ---------------- SigV4 ---------------- */
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function uriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function amzDate() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}
/* S3_FORCE_PATH_STYLE 语义：0/false 关闭 path-style（改用 virtual-hosted）。
   config 里已转成 boolean，这里同时兼容字符串写法。 */
function forcePathStyle() {
  const v = config.S3_FORCE_PATH_STYLE;
  if (typeof v === 'boolean') return v;
  return !(v === 0 || String(v).toLowerCase() === '0' || String(v).toLowerCase() === 'false');
}
/* canonical URI 与实际请求路径必须完全一致，两处都用这个函数。 */
function keyPath(objectKey) {
  const key = String(objectKey).split('/').map(uriEncode).join('/');
  if (!forcePathStyle()) return '/' + key; // virtual-hosted：桶名在 Host 里
  return '/' + uriEncode(config.S3_BUCKET) + '/' + key;
}
function endpointHost() {
  const host = new URL(config.S3_ENDPOINT).host;
  if (forcePathStyle()) return host;
  const bucket = String(config.S3_BUCKET);
  // endpoint 已经写成桶域名时不再重复加前缀
  if (host.indexOf(bucket + '.') === 0) return host;
  return bucket + '.' + host;
}
/* 仅 OSS 需要时的兼容头；默认不加，避免影响 MinIO / R2 / AWS。 */
function extraCompatHeaders() {
  return config.S3_EXTRA_HEADER_OSS_COMPAT ? { 'x-oss-s3-compat': 'true' } : {};
}
/* 实际请求 URL：协议 + Host（virtual-hosted 时已含桶前缀）+ 路径。
   必须与 canonical URI 用同一套拼法，否则签名对不上。 */
function requestUrl(objectKey) {
  const u = new URL(config.S3_ENDPOINT);
  return u.protocol + '//' + endpointHost() + keyPath(objectKey);
}
function signingKey(day) {
  const kDate = hmac('AWS4' + config.S3_SECRET_ACCESS_KEY, day);
  const kRegion = hmac(kDate, config.S3_REGION);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/* 生成带签名的请求（用于 PUT/GET/DELETE） */
function signedRequest(method, objectKey, payload, extra) {
  const opts = extra || {};
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const payloadHash = payload ? sha256hex(payload) : sha256hex(Buffer.alloc(0));
  const contentType = opts.contentType || 'application/octet-stream';

  const canonicalHeaders =
    'content-type:' + contentType + '\n' +
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + date + '\n';
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    keyPath(objectKey),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + config.S3_ACCESS_KEY_ID + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const url = requestUrl(objectKey);
  return {
    url,
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      Authorization: authorization,
      ...extraCompatHeaders(),
    },
  };
}

/* 预签名 GET URL（私有桶 + 时效） */
function presignGet(objectKey, ttlSec) {
  if (state.mode !== 's3') return null;
  if (config.S3_PUBLIC_BASE) {
    return config.S3_PUBLIC_BASE.replace(/\/+$/, '') + '/' + String(objectKey).split('/').map(uriEncode).join('/');
  }
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const expires = Math.max(60, Math.min(Number(ttlSec) || config.S3_URL_TTL, 604800));

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': config.S3_ACCESS_KEY_ID + '/' + scope,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => uriEncode(k) + '=' + uriEncode(params[k])).join('&');
  const canonicalRequest = [
    'GET',
    keyPath(objectKey),
    canonicalQuery,
    'host:' + host + '\n',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');

  return requestUrl(objectKey) +
    '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

/* 预签名 PUT URL：用于浏览器/本机把大文件（83MB PDF）直传对象存储，
   字节不经过 Render，避免请求体过大和超时。只签 host，Content-Type 不受限。 */
function presignPut(objectKey, ttlSec) {
  if (state.mode !== 's3') return null;
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const expires = Math.max(60, Math.min(Number(ttlSec) || config.S3_URL_TTL, 604800));

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': config.S3_ACCESS_KEY_ID + '/' + scope,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => uriEncode(k) + '=' + uriEncode(params[k])).join('&');
  const canonicalRequest = [
    'PUT',
    keyPath(objectKey),
    canonicalQuery,
    'host:' + host + '\n',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');

  /* 必须与 presignGet 用同一套 URL 拼法（virtual-hosted 时桶名在 Host 里），
     否则签名里的 host 与实际请求 host 不一致，OSS 会直接 AccessDenied。 */
  return requestUrl(objectKey) +
    '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

/* ---------------- 读写 ---------------- */
function localPath(objectKey) {
  const safe = String(objectKey).split('/').filter((s) => s && s !== '.' && s !== '..').join(path.sep);
  return path.join(LOCAL_ROOT, safe);
}

async function putObject(objectKey, buffer, mime) {
  if (state.mode === 's3') {
    const req = signedRequest('PUT', objectKey, buffer, { contentType: mime || 'application/octet-stream' });
    const res = await fetch(req.url, { method: 'PUT', headers: req.headers, body: buffer });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('对象存储写入失败（HTTP ' + res.status + '）：' + text.slice(0, 200));
    }
    return { storage: 's3', url: presignGet(objectKey) };
  }
  const file = localPath(objectKey);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, file);
  return { storage: 'local', url: null };
}

async function readObject(objectKey) {
  if (state.mode === 's3') {
    const req = signedRequest('GET', objectKey, null, { contentType: 'application/octet-stream' });
    const res = await fetch(req.url, { method: 'GET', headers: req.headers });
    if (!res.ok) throw new Error('对象存储读取失败（HTTP ' + res.status + '）');
    return Buffer.from(await res.arrayBuffer());
  }
  return fsp.readFile(localPath(objectKey));
}

async function deleteObject(objectKey) {
  if (state.mode === 's3') {
    const req = signedRequest('DELETE', objectKey, null, { contentType: 'application/octet-stream' });
    const res = await fetch(req.url, { method: 'DELETE', headers: req.headers });
    if (!res.ok && res.status !== 404) throw new Error('对象存储删除失败（HTTP ' + res.status + '）');
    return true;
  }
  await fsp.unlink(localPath(objectKey)).catch(() => {});
  return true;
}

module.exports = {
  init,
  status,
  putObject,
  readObject,
  deleteObject,
  presignGet,
  presignPut,
  LOCAL_ROOT,
};
