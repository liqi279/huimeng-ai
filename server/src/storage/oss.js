'use strict';

/* =============================================================
 * storage 后端：阿里云 OSS（当前启用）
 * -------------------------------------------------------------
 * 只做三件事：上传、生成可读 URL（签名 URL / 公开域名）、删除。
 * 业务代码不直接 require 本文件，统一走 ../storage 适配层。
 *
 * 凭证只从环境变量读取，仓库里不保留任何默认值：
 *   OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 *   OSS_ENDPOINT（可选，自定义域名 / 专有域名）
 *   OSS_PUBLIC_BASE（可选，绑定的 CDN 或自定义域名；配置后读走公开直链）
 * ============================================================= */

const REQUIRED_VARS = [
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
];

const state = {
  ready: false,
  error: null,
  client: null,
  bucket: '',
  region: '',
  endpoint: '',
  publicBase: '',
};

function missingVars(cfg) {
  return REQUIRED_VARS.filter((name) => !cfg[name]);
}

/* 配置缺失时给出可直接照抄的报错，而不是等到第一次上传才 500 */
function configError(missing) {
  return 'OSS 未配置完整，缺少环境变量：' + missing.join(' / ') +
    '（在 Render → Environment 里配置；本地用 set/export 注入，勿写入仓库）';
}

function init(cfg) {
  const conf = cfg || {};
  const missing = missingVars(conf);
  state.ready = false;
  state.client = null;
  state.bucket = conf.OSS_BUCKET || '';
  state.region = conf.OSS_REGION || '';
  state.endpoint = conf.OSS_ENDPOINT || '';
  state.publicBase = String(conf.OSS_PUBLIC_BASE || '').replace(/\/+$/, '');

  if (missing.length) {
    state.error = configError(missing);
    return state;
  }

  /* 依赖延迟到真正启用时才加载：没配 OSS 的环境（纯前端部署）不需要装 SDK */
  const OSS = require('ali-oss');
  const options = {
    region: conf.OSS_REGION,
    bucket: conf.OSS_BUCKET,
    accessKeyId: conf.OSS_ACCESS_KEY_ID,
    accessKeySecret: conf.OSS_ACCESS_KEY_SECRET,
    secure: true,
  };
  /* 自定义域名 / 专有域名：走 cname 模式，签名里的 Host 与访问 Host 一致。
     若误填成标准地域域名（oss-cn-*.aliyuncs.com），补上 bucket 前缀，避免请求打到桶外。 */
  if (conf.OSS_ENDPOINT) {
    let endpoint = String(conf.OSS_ENDPOINT).trim().replace(/\/+$/, '');
    endpoint = endpoint.replace(/^(https?:\/\/)oss-([a-z0-9-]+\.aliyuncs\.com)$/i, '$1' + conf.OSS_BUCKET + '.oss-$2');
    options.endpoint = endpoint;
    options.cname = true;
  }
  state.client = new OSS(options);
  state.ready = true;
  state.error = null;
  return state;
}

function assertReady() {
  if (!state.ready || !state.client) {
    throw Object.assign(new Error(state.error || 'OSS 未初始化'), {
      status: 503,
      expose: true,
      hint: '请在服务端环境变量中配置 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET',
    });
  }
}

/* 上传：key 由调用方决定（业务层负责扩展名与批次目录） */
async function put(key, buffer, mime) {
  assertReady();
  const result = await state.client.put(key, buffer, {
    mime: mime || 'application/octet-stream',
    /* 生成物是不可变的（key 带随机名），长缓存避免重复回源 */
    headers: { 'Cache-Control': 'public, max-age=31536000' },
  });
  return { key, storage: 'oss', etag: (result && result.res && result.res.headers.etag) || '' };
}

async function read(key) {
  assertReady();
  const result = await state.client.get(key);
  return result.content;
}

async function remove(key) {
  assertReady();
  await state.client.delete(key);
  return true;
}

/* 签名 URL：GET 私有读 / PUT 直传都走服务端签名，前端永远拿不到 AccessKey。
   opts.method：'GET'（默认）| 'PUT'
   opts.ttl：有效期秒数
   opts.contentType：PUT 时必须与实际请求头一致，否则 OSS 返回 SignatureDoesNotMatch
   opts.contentDisposition：GET 时覆盖响应头（PDF 下载用） */
function signatureUrl(key, opts) {
  assertReady();
  const options = opts || {};
  const method = String(options.method || 'GET').toUpperCase();
  const ttl = Math.max(60, Math.min(Number(options.ttl) || 3600, 604800));
  const params = { method, expires: ttl };
  if (options.contentType) params['Content-Type'] = String(options.contentType);
  if (method === 'GET' && options.contentDisposition) {
    params.response = { 'content-disposition': String(options.contentDisposition) };
  }
  return state.client.signatureUrl(key, params);
}

/* 绑定 CDN / 公开域名时的直读地址；未配置返回 null（调用方改走签名 URL） */
function publicUrl(key) {
  if (!state.publicBase) return null;
  return state.publicBase + '/' + String(key).split('/').map(encodeURIComponent).join('/');
}

function status() {
  return {
    backend: 'oss',
    ready: state.ready,
    label: state.ready ? '阿里云 OSS' : 'OSS（未配置）',
    bucket: state.bucket || null,
    region: state.region || null,
    endpoint: state.endpoint || null,
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
  REQUIRED_VARS,
  configError,
};
