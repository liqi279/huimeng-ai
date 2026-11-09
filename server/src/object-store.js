'use strict';

/* =============================================================
 * 对象存储兼容门面（历史 API 保留）
 * -------------------------------------------------------------
 * 数据面（上传 / 读取 / 删除 / 签名 URL）已全部交给 storage 适配层
 * （server/src/storage），本文件只保留两件事：
 *   1. 旧调用方需要的 API 形状（putObject / presignGet / presignPut / status ...）
 *   2. 桶级安全配置（CORS / 防盗链），用 SigV4 直接打 OSS 的桶接口
 *
 * 换存储后端只改 STORAGE_BACKEND + 环境变量，业务代码与路由都不用动。
 * 环境变量（全部只从环境读取，仓库里没有任何默认密钥）：
 *   STORAGE_BACKEND=auto|oss|github|r2|local
 *   OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 *   OSS_ENDPOINT（可选，自定义/专有域名） / OSS_PUBLIC_BASE（可选 CDN 域名）
 *   OSS_URL_TTL（签名有效期秒，默认 3600）
 * ============================================================= */

const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const storage = require('./storage');

const LOCAL_ROOT = storage.LOCAL_ROOT;

const state = {
  ready: false,
};

/* ---------------- 兼容 API ---------------- */
function init() {
  storage.init();
  const st = storage.status();
  state.ready = st.mode === 's3';
  return state;
}

function status() {
  const st = storage.status();
  const ossStatus = st.backendStatus || {};
  return {
    /* 旧调用方只认 s3 / local 两种值：OSS 即 s3 语义 */
    mode: st.mode === 's3' ? 's3' : st.mode,
    label: st.label,
    backend: st.backend,
    endpoint: ossStatus.endpoint || config.OSS_ENDPOINT || null,
    bucket: ossStatus.bucket || config.OSS_BUCKET || null,
    warning: st.mode === 's3' ? '' : '图片未落到对象存储，Render 重启会丢失；请配置 OSS。',
    error: st.error,
  };
}

async function putObject(objectKey, buffer, mime) {
  const saved = await storage.put(objectKey, buffer, mime);
  return { storage: saved.storage, url: storage.publicUrl(objectKey) };
}

async function readObject(objectKey) {
  return storage.read(objectKey);
}

async function deleteObject(objectKey) {
  return storage.remove(objectKey);
}

/* 预签名 GET：私有桶 + 时效；配置了公开域名则直接给公开直链 */
function presignGet(objectKey, ttlSec, opts) {
  const extra = opts || {};
  const direct = storage.publicUrl(objectKey);
  if (direct) return direct;
  return storage.signatureUrl(objectKey, {
    method: 'GET',
    ttl: ttlSec || config.STORAGE_URL_TTL,
    contentDisposition: extra.responseContentDisposition,
    process: extra.process,
  });
}

/* 预签名 PUT：浏览器/本机直传大文件（如 83MB PDF），字节不经过 Render。
   contentType 必须签进去，PUT 时要带同一个 Content-Type，否则 OSS 报 SignatureDoesNotMatch。 */
function presignPut(objectKey, ttlSec, contentType) {
  return storage.signatureUrl(objectKey, {
    method: 'PUT',
    ttl: ttlSec || config.STORAGE_URL_TTL,
    contentType: contentType || '',
  });
}

/* ---------------- 桶级配置（CORS / 防盗链） ---------------- */
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
function forcePathStyle() {
  const v = config.S3_FORCE_PATH_STYLE;
  if (typeof v === 'boolean') return v;
  return !(v === 0 || String(v).toLowerCase() === '0' || String(v).toLowerCase() === 'false');
}
function keyPath(objectKey) {
  const key = String(objectKey).split('/').map(uriEncode).join('/');
  if (!forcePathStyle()) return '/' + key;
  return '/' + uriEncode(config.S3_BUCKET) + '/' + key;
}
function endpointHost() {
  const host = new URL(config.S3_ENDPOINT).host;
  if (forcePathStyle()) return host;
  const bucket = String(config.S3_BUCKET);
  if (host.indexOf(bucket + '.') === 0) return host;
  return bucket + '.' + host;
}
function extraCompatHeaders() {
  return config.S3_EXTRA_HEADER_OSS_COMPAT ? { 'x-oss-s3-compat': 'true' } : {};
}
function signingKey(day) {
  const kDate = hmac('AWS4' + config.S3_SECRET_ACCESS_KEY, day);
  const kRegion = hmac(kDate, config.S3_REGION);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/* 桶级签名请求：canonical URI 是 '/'，子资源（cors / referer）放 canonical query */
function signedBucketRequest(method, subresource, payload, contentType) {
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const body = payload || Buffer.alloc(0);
  const payloadHash = sha256hex(body);
  const type = contentType || 'application/xml';
  const canonicalQuery = uriEncode(subresource) + '=';
  const canonicalHeaders =
    'content-type:' + type + '\n' +
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + date + '\n';
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + config.S3_ACCESS_KEY_ID + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const u = new URL(config.S3_ENDPOINT);
  return {
    url: u.protocol + '//' + host + '/?' + canonicalQuery,
    headers: {
      'Content-Type': type,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      Authorization: authorization,
      ...extraCompatHeaders(),
    },
  };
}

const CORS_ORIGINS = [
  'https://liqi279.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const CORS_EXPOSE_HEADERS = [
  'Content-Length', 'Content-Range', 'Accept-Ranges',
  'Content-Type', 'ETag', 'Content-Disposition',
];
const SITE_REFERERS = ['https://liqi279.github.io/*'];

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function corsXml() {
  const origins = CORS_ORIGINS.map((o) => '<AllowedOrigin>' + xmlEscape(o) + '</AllowedOrigin>').join('');
  const expose = CORS_EXPOSE_HEADERS.map((h) => '<ExposeHeader>' + xmlEscape(h) + '</ExposeHeader>').join('');
  return '<CORSConfiguration><CORSRule>' + origins +
    '<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>' +
    '<AllowedHeader>*</AllowedHeader>' + expose +
    '<MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>';
}

function ossErrorSummary(statusCode, text) {
  const code = (String(text).match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
  const requestId = (String(text).match(/<RequestId>([^<]+)<\/RequestId>/) || [])[1] || '';
  return { status: statusCode, code, requestId };
}

async function putBucketCors() {
  if (status().mode !== 's3') return { ok: false, action: 'put-bucket-cors', skipped: '对象存储未启用' };
  const body = Buffer.from(corsXml(), 'utf8');
  const req = signedBucketRequest('PUT', 'cors', body, 'application/xml');
  const res = await fetch(req.url, { method: 'PUT', headers: req.headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, action: 'put-bucket-cors', ...ossErrorSummary(res.status, text) };
  }
  if (res.body) await res.body.cancel().catch(() => {});
  return { ok: true, action: 'put-bucket-cors', origins: CORS_ORIGINS, methods: ['GET', 'HEAD'] };
}

/* 防盗链：只在「已开启（白名单非空）」且不含自有前端时追加，不动其它条目 */
async function ensureBucketReferer() {
  if (status().mode !== 's3') return { ok: false, action: 'put-bucket-referer', skipped: '对象存储未启用' };
  const getReq = signedBucketRequest('GET', 'referer', null, 'application/xml');
  const res = await fetch(getReq.url, { method: 'GET', headers: getReq.headers });
  const text = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, action: 'put-bucket-referer', ...ossErrorSummary(res.status, text) };

  const list = [];
  const matches = text.matchAll(/<Referer>([^<]*)<\/Referer>/g);
  for (const m of matches) list.push(m[1]);
  if (!list.length) return { ok: true, action: 'put-bucket-referer', skipped: '防盗链未开启（白名单为空）' };

  const allowEmpty = !/<AllowEmptyReferer>false<\/AllowEmptyReferer>/i.test(text);
  const missing = SITE_REFERERS.filter((r) => list.indexOf(r) < 0);
  if (!missing.length) return { ok: true, action: 'put-bucket-referer', skipped: '已包含自有前端' };

  const next = list.concat(missing);
  const xml = '<RefererConfiguration>' +
    '<AllowEmptyReferer>' + (allowEmpty ? 'true' : 'false') + '</AllowEmptyReferer>' +
    '<RefererList>' + next.map((r) => '<Referer>' + xmlEscape(r) + '</Referer>').join('') + '</RefererList>' +
    '</RefererConfiguration>';
  const body = Buffer.from(xml, 'utf8');
  const putReq = signedBucketRequest('PUT', 'referer', body, 'application/xml');
  const putRes = await fetch(putReq.url, { method: 'PUT', headers: putReq.headers, body });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    return { ok: false, action: 'put-bucket-referer', ...ossErrorSummary(putRes.status, errText) };
  }
  if (putRes.body) await putRes.body.cancel().catch(() => {});
  return { ok: true, action: 'put-bucket-referer', added: missing, allowEmptyReferer: allowEmpty };
}

/* 幂等的桶安全配置：启动时跑一次；失败只记录，绝不影响服务启动 */
async function ensureBucketSecurity() {
  if (status().mode !== 's3') {
    return { ok: false, skipped: '对象存储未启用（本地盘模式无需桶配置）' };
  }
  const cors = await putBucketCors().catch((err) => ({ ok: false, action: 'put-bucket-cors', error: err.message }));
  const referer = await ensureBucketReferer().catch((err) => ({ ok: false, action: 'put-bucket-referer', error: err.message }));
  const ok = cors.ok !== false && referer.ok !== false;
  console.log('[object-store] 桶配置：CORS=' + JSON.stringify(cors) + ' 防盗链=' + JSON.stringify(referer));
  return { ok, cors, referer };
}

module.exports = {
  init,
  status,
  putObject,
  readObject,
  deleteObject,
  presignGet,
  presignPut,
  putBucketCors,
  ensureBucketReferer,
  ensureBucketSecurity,
  LOCAL_ROOT,
};
