'use strict';

/* =============================================================
 * 绘梦 · 对象存储适配层（S3 协议）
 * -------------------------------------------------------------
 * 作品图片/视频等二进制只放对象存储，数据库只存 object key。
 * 兼容：Cloudflare R2（阶段0）、MinIO（阶段1 内网）、AWS S3。
 *
 * 环境变量：
 *   OBJECT_STORE=auto|s3|local
 *   S3_ENDPOINT / S3_REGION / S3_BUCKET
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE=1（MinIO 默认需要，R2 也支持）
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
function keyPath(objectKey) {
  const bucket = uriEncode(config.S3_BUCKET);
  const key = String(objectKey).split('/').map(uriEncode).join('/');
  return '/' + bucket + '/' + key;
}
function endpointHost() {
  return new URL(config.S3_ENDPOINT).host;
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

  const url = config.S3_ENDPOINT.replace(/\/+$/, '') + keyPath(objectKey);
  return {
    url,
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      Authorization: authorization,
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

  return config.S3_ENDPOINT.replace(/\/+$/, '') + keyPath(objectKey) +
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
  LOCAL_ROOT,
};
