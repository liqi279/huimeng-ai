'use strict';

/* =============================================================
 * storage 后端：腾讯云 COS
 * -------------------------------------------------------------
 * 与 ./oss.js 完全同接口：init / put / read / remove / signatureUrl / publicUrl / status
 * 业务代码不直接 require 本文件，统一走 ../storage 适配层。
 *
 * 为什么需要这个后端：ali-oss 只会签 OSS 风格（Authorization: OSS AK:...，
 * 签名 URL 用 OSSAccessKeyId/Expires/Signature 查询参数），COS 不接受；
 * 直接拿 ali-oss 打 COS 会 403 SignatureDoesNotMatch。
 *
 * 环境变量（COS_* 缺失时回落到同义的 S3_* / OSS_*，便于沿用现有控制台配置）：
 *   COS_SECRET_ID   ← 缺失取 S3_ACCESS_KEY_ID
 *   COS_SECRET_KEY  ← 缺失取 S3_SECRET_ACCESS_KEY
 *   COS_BUCKET      ← 缺失取 S3_BUCKET / OSS_BUCKET
 *   COS_REGION      ← 缺失取 S3_REGION / OSS_REGION（形如 ap-guangzhou）
 *   COS_PUBLIC_BASE 可选：绑定的 CDN/公开域名，配置后读取走公开直链
 * ============================================================= */

const state = {
  ready: false,
  error: null,
  client: null,
  bucket: '',
  region: '',
  publicBase: '',
};

function pick(primary, fallback) {
  return primary || fallback || '';
}

function resolve(cfg) {
  const conf = cfg || {};
  return {
    secretId: pick(conf.COS_SECRET_ID, conf.S3_ACCESS_KEY_ID),
    secretKey: pick(conf.COS_SECRET_KEY, conf.S3_SECRET_ACCESS_KEY),
    bucket: pick(conf.COS_BUCKET, pick(conf.S3_BUCKET, conf.OSS_BUCKET)),
    region: pick(conf.COS_REGION, pick(conf.S3_REGION, conf.OSS_REGION)),
    publicBase: String(pick(conf.COS_PUBLIC_BASE, '')).replace(/\/+$/, ''),
  };
}

/* region 允许写成 ap-guangzhou / cos.ap-guangzhou / oss-ap-guangzhou；'auto' 视为未填 */
function normalizeRegion(value) {
  const v = String(value || '').trim().replace(/^cos\./i, '').replace(/^oss-/i, '');
  return v.toLowerCase() === 'auto' ? '' : v;
}

function missingVars(res) {
  const missing = [];
  if (!res.secretId) missing.push('COS_SECRET_ID（或 S3_ACCESS_KEY_ID）');
  if (!res.secretKey) missing.push('COS_SECRET_KEY（或 S3_SECRET_ACCESS_KEY）');
  if (!res.bucket) missing.push('COS_BUCKET（或 S3_BUCKET）');
  if (!res.region) missing.push('COS_REGION（或 S3_REGION）');
  return missing;
}

function init(cfg) {
  const res = resolve(cfg);
  const missing = missingVars(res);
  state.ready = false;
  state.client = null;
  state.bucket = res.bucket;
  state.region = normalizeRegion(res.region);
  state.publicBase = res.publicBase;

  if (missing.length) {
    state.error = 'COS 未配置完整，缺少环境变量：' + missing.join(' / ');
    return state;
  }

  /* 依赖延迟加载：不用 COS 的环境不需要装 SDK */
  const COS = require('cos-nodejs-sdk-v5');
  state.client = new COS({
    SecretId: res.secretId,
    SecretKey: res.secretKey,
    Protocol: 'https:',
  });
  state.ready = true;
  state.error = null;
  return state;
}

function assertReady() {
  if (!state.ready || !state.client) {
    throw Object.assign(new Error(state.error || 'COS 未初始化'), {
      status: 503,
      expose: true,
      hint: '请在函数环境变量里配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION',
    });
  }
}

function put(key, buffer, mime) {
  assertReady();
  return new Promise((resolve, reject) => {
    state.client.putObject({
      Bucket: state.bucket,
      Region: state.region,
      Key: key,
      Body: buffer,
      ContentType: mime || 'application/octet-stream',
      /* 生成物 key 带随机名，不可变，长缓存 */
      CacheControl: 'public, max-age=31536000',
    }, (err, data) => {
      if (err) return reject(err);
      resolve({ key, storage: 'cos', etag: (data && data.ETag) || '' });
    });
  });
}

function read(key) {
  assertReady();
  return new Promise((resolve, reject) => {
    state.client.getObject({ Bucket: state.bucket, Region: state.region, Key: key }, (err, data) => {
      if (err) return reject(err);
      resolve(data && data.Body);
    });
  });
}

function remove(key) {
  assertReady();
  return new Promise((resolve, reject) => {
    state.client.deleteObject({ Bucket: state.bucket, Region: state.region, Key: key }, (err) => {
      if (err) return reject(err);
      resolve(true);
    });
  });
}

/* 签名 URL：GET 私有读 / PUT 直传。
   - method='GET'：可带 contentDisposition（PDF 下载）与 process（图片处理，COS 用 imageMogr2）
   - method='PUT'：contentType 必须与浏览器实际请求头一致，否则 COS 报 SignatureDoesNotMatch
   - ttl 单位秒，COS 上限 7 天 */
function signatureUrl(key, opts) {
  assertReady();
  const options = opts || {};
  const method = String(options.method || 'GET').toUpperCase();
  const ttl = Math.max(60, Math.min(Number(options.ttl) || 3600, 604800));

  const params = {
    Bucket: state.bucket,
    Region: state.region,
    Key: key,
    Sign: true,
    Expires: ttl,
    Method: method,
  };

  const query = {};
  if (method === 'GET' && options.contentDisposition) {
    query['response-content-disposition'] = String(options.contentDisposition);
  }
  if (method === 'GET' && options.process) {
    /* OSS 的 image/resize,... 语法在 COS 等价于 imageMogr2 */
    query['imageMogr2'] = String(options.process).replace(/^image\//, '');
  }
  if (Object.keys(query).length) params.Query = query;

  if (options.contentType) {
    params.Headers = { 'Content-Type': String(options.contentType) };
  }

  return state.client.getObjectUrl(params);
}

function publicUrl(key) {
  if (!state.publicBase) return null;
  return state.publicBase + '/' + String(key).split('/').map(encodeURIComponent).join('/');
}

function status() {
  return {
    backend: 'cos',
    ready: state.ready,
    label: state.ready ? '腾讯云 COS' : 'COS（未配置）',
    bucket: state.bucket || null,
    region: state.region || null,
    endpoint: state.ready ? 'https://' + state.bucket + '.cos.' + state.region + '.myqcloud.com' : null,
    publicBase: state.publicBase || null,
    error: state.error,
  };
}

module.exports = {
  init,
  put,
  read,
  remove,
  signatureUrl,
  publicUrl,
  status,
  resolve,
};
