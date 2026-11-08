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

/* 预签名 GET URL（私有桶 + 时效）
   opts.responseContentDisposition：写进签名查询串，OSS 会按它覆盖 Content-Disposition。
   注意：
     - 这些参数必须参与签名（本函数统一由 canonicalQuery 生成），
       外部再拼到 URL 上会直接 403 SignatureDoesNotMatch；
     - OSS 不接受 response-content-type 覆盖（400 InvalidRequest:
       Can not override response header on content-type），不要加。 */
function presignGet(objectKey, ttlSec, opts) {
  if (state.mode !== 's3') return null;
  if (config.S3_PUBLIC_BASE) {
    return config.S3_PUBLIC_BASE.replace(/\/+$/, '') + '/' + String(objectKey).split('/').map(uriEncode).join('/');
  }
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const expires = Math.max(60, Math.min(Number(ttlSec) || config.S3_URL_TTL, 604800));
  const extra = opts || {};

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': config.S3_ACCESS_KEY_ID + '/' + scope,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (extra.responseContentDisposition) {
    params['response-content-disposition'] = String(extra.responseContentDisposition);
  }
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
   字节不经过 Render，避免请求体过大和超时。
   传了 contentType 就把它签进去：PUT 时必须带同一个 Content-Type，
   否则 OSS 会拒绝（403 SignatureDoesNotMatch）；这样对象元信息不会变成 octet-stream。 */
function presignPut(objectKey, ttlSec, contentType) {
  if (state.mode !== 's3') return null;
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const expires = Math.max(60, Math.min(Number(ttlSec) || config.S3_URL_TTL, 604800));
  const type = String(contentType || '').trim();

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': config.S3_ACCESS_KEY_ID + '/' + scope,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': type ? 'content-type;host' : 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => uriEncode(k) + '=' + uriEncode(params[k])).join('&');
  const canonicalHeaders = type
    ? 'content-type:' + type + '\n' + 'host:' + host + '\n'
    : 'host:' + host + '\n';
  const canonicalRequest = [
    'PUT',
    keyPath(objectKey),
    canonicalQuery,
    canonicalHeaders,
    params['X-Amz-SignedHeaders'],
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');

  /* 必须与 presignGet 用同一套 URL 拼法（virtual-hosted 时桶名在 Host 里），
     否则签名里的 host 与实际请求 host 不一致，OSS 会直接 AccessDenied。 */
  return requestUrl(objectKey) +
    '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

/* 通用签名：headersMap 里的每个头都参与签名（键统一小写），
   用于 copy-object 这类带 x-oss-* 头的请求。 */
function signedWithHeaders(method, objectKey, headersMap, payload) {
  const host = endpointHost();
  const date = amzDate();
  const day = date.slice(0, 8);
  const scope = day + '/' + config.S3_REGION + '/s3/aws4_request';
  const payloadHash = sha256hex(payload || Buffer.alloc(0));
  const all = {};
  Object.keys(headersMap || {}).forEach((k) => { all[k.toLowerCase()] = String(headersMap[k]); });
  all.host = host;
  all['x-amz-content-sha256'] = payloadHash;
  all['x-amz-date'] = date;

  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => n + ':' + all[n].trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, keyPath(objectKey), '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(stringToSign, 'utf8').digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + config.S3_ACCESS_KEY_ID + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const headers = {};
  names.forEach((n) => { headers[n] = all[n]; });
  headers.Authorization = authorization;
  Object.assign(headers, extraCompatHeaders());
  return { url: requestUrl(objectKey), headers };
}

/* 按扩展名推断对象类型：直传与元信息修正共用，避免对象被存成 octet-stream */
const PRESIGN_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/* 同 key 自复制并替换元信息：修正历史对象被存成 application/octet-stream 的问题。
   走 OSS copyObject + x-oss-metadata-directive: REPLACE，Content-Type / Content-Disposition
   由本次请求头决定；不用重传文件本体。 */
async function fixObjectType(objectKey, contentType, contentDisposition) {
  if (state.mode !== 's3') return { ok: false, key: objectKey, skipped: '对象存储未启用' };
  const ext = path.extname(String(objectKey)).toLowerCase();
  const type = contentType || PRESIGN_MIME[ext] || 'application/octet-stream';
  const disposition = contentDisposition || 'inline';

  const attempts = [
    { copy: 'x-oss-copy-source', directive: 'x-oss-metadata-directive' },
    { copy: 'x-amz-copy-source', directive: 'x-amz-metadata-directive' },
  ];
  let last = null;
  for (const mode of attempts) {
    const map = {
      'content-type': type,
      'content-disposition': disposition,
      [mode.copy]: '/' + config.S3_BUCKET + '/' + String(objectKey).split('/').map(uriEncode).join('/'),
      [mode.directive]: 'REPLACE',
    };
    const req = signedWithHeaders('PUT', objectKey, map, null);
    let res;
    try {
      res = await fetch(req.url, { method: 'PUT', headers: req.headers });
    } catch (err) {
      last = { ok: false, key: objectKey, status: 0, error: err.message };
      continue;
    }
    const text = res.ok ? '' : await res.text().catch(() => '');
    if (res.body) await res.body.cancel().catch(() => {});
    if (res.ok) return { ok: true, key: objectKey, contentType: type };
    last = { ok: false, key: objectKey, status: res.status, ...ossErrorSummary(res.status, text) };
    /* 只有当头部别名不对时才换下一组，其余错误（鉴权/不存在）直接返回 */
    if (!/InvalidArgument|InvalidRequest|SignatureDoesNotMatch|NotImplemented/i.test(last.code || '')) break;
  }
  return last;
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

/* ---------------- 桶级配置（CORS / 防盗链） ---------------- */
/* 前端（GitHub Pages）用 pdf.js 直连 OSS 分段读取 PDF，浏览器必须先过 CORS 预检；
   桶上没有匹配规则时 OPTIONS 直接 403（x-oss-ec 0003-00000601）。
   规则固定在这里，PUT 是幂等的：启动跑一次，也可由管理员接口手动重跑。 */
const CORS_ORIGINS = [
  'https://liqi279.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const CORS_EXPOSE_HEADERS = [
  'Content-Length', 'Content-Range', 'Accept-Ranges',
  'Content-Type', 'ETag', 'Content-Disposition',
];
/* 防盗链白名单里要放行的自有前端 */
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

/* 桶级签名请求：canonical URI 是 '/'，子资源（cors / referer）放 canonical query。
   virtual-hosted 下 endpointHost() 已经是 <bucket>.<endpoint>，Host 不用改。
   只签 content-type/host/x-amz-content-sha256/x-amz-date 四个头，与现有请求一致。 */
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

/* 只保留 OSS 错误里的 Code/RequestId，绝不会带上任何凭据 */
function ossErrorSummary(status, text) {
  const code = (String(text).match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
  const requestId = (String(text).match(/<RequestId>([^<]+)<\/RequestId>/) || [])[1] || '';
  return { status, code, requestId };
}

async function putBucketCors() {
  if (state.mode !== 's3') return { ok: false, action: 'put-bucket-cors', skipped: '对象存储未启用' };
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
  if (state.mode !== 's3') return { ok: false, action: 'put-bucket-referer', skipped: '对象存储未启用' };
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
  if (state.mode !== 's3') {
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
  fixObjectType,
  putBucketCors,
  ensureBucketReferer,
  ensureBucketSecurity,
  LOCAL_ROOT,
};
