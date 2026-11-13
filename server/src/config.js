'use strict';

const path = require('path');

const serverRoot = path.resolve(__dirname, '..');

function env(name, fallback) {
  const value = process.env[name];
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

/* CORS 默认白名单：线上静态站 + 本地调试端口（含本项目自带的 HTTPS 开发服务器 8443）。
   需要临时放开时，把 CORS_ORIGINS 设为 *（仅本地调试，切勿用于生产）。 */
const DEFAULT_CORS_ORIGINS = [
  'https://liqi279.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8443',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8443',
  'https://localhost:8443',
  'https://127.0.0.1:8443',
].join(',');

/* ---------- 统一 storage 适配层（当前启用阿里云 OSS） ----------
   变量优先级（同义变量同时存在时）：S3_* ＞ OSS_* ＞ 空。
   Render 上已有的就是 S3_* 这一套，OSS_* 只是同义别名，不需要改线上配置。

   后端开关：显式 STORAGE_BACKEND 优先；未设置时按旧开关 OBJECT_STORE 映射：
     OBJECT_STORE=s3  → oss   （旧语义：走对象存储）
     OBJECT_STORE=local → local
     OBJECT_STORE=auto → auto（凭证齐全走 oss，否则本地盘）
   STORAGE_BACKEND=oss 但凭证缺失：上传接口直接 503 并列出缺失变量，不静默落本地盘。

   region 解析顺序：S3_ENDPOINT 里的 oss-<region> → S3_REGION → OSS_ENDPOINT → OSS_REGION。
   凭证只从环境变量读取，仓库里不保留任何默认值。 */
function regionFromOssEndpoint(url) {
  const match = /^https?:\/\/(oss-[a-z0-9-]+)\.aliyuncs\.com\/?$/i.exec(String(url || '').trim());
  return match ? match[1].toLowerCase() : '';
}
/* ali-oss 的 region 形如 oss-cn-hangzhou；允许只写 cn-hangzhou，这里补齐前缀 */
function normalizeOssRegion(region) {
  const value = String(region || '').trim();
  if (!value || value.toLowerCase() === 'auto') return '';
  return /^oss-/i.test(value) ? value.toLowerCase() : 'oss-' + value.toLowerCase();
}

const S3_REGION_ENV = env('S3_REGION', '');
const S3_ENDPOINT_ENV = env('S3_ENDPOINT', '');
const OSS_REGION_ENV = env('OSS_REGION', '');
const OSS_ENDPOINT_ENV = env('OSS_ENDPOINT', '');

const OSS_REGION = regionFromOssEndpoint(S3_ENDPOINT_ENV) ||
  normalizeOssRegion(S3_REGION_ENV) ||
  regionFromOssEndpoint(OSS_ENDPOINT_ENV) ||
  normalizeOssRegion(OSS_REGION_ENV);
const OSS_BUCKET = env('S3_BUCKET', '') || env('OSS_BUCKET', '');
const OSS_ACCESS_KEY_ID = env('S3_ACCESS_KEY_ID', '') || env('OSS_ACCESS_KEY_ID', '');
const OSS_ACCESS_KEY_SECRET = env('S3_SECRET_ACCESS_KEY', '') || env('OSS_ACCESS_KEY_SECRET', '');
/* 自定义域名 / 专有域名（cname 模式）。S3_ENDPOINT 是地域域名，不能往这里塞 */
const OSS_ENDPOINT = OSS_ENDPOINT_ENV;
/* 可选：绑定的 CDN / 公开域名，配置后读取直接走公开直链，不再签名 */
const OSS_PUBLIC_BASE = env('S3_PUBLIC_BASE', '') || env('OSS_PUBLIC_BASE', '');
const STORAGE_URL_TTL = Number(env('S3_URL_TTL', env('OSS_URL_TTL', '3600')));
/* 桶级安全配置（CORS/防盗链）走 SigV4，需要完整 endpoint；没有显式 endpoint 时按 region 推导 */
const DERIVED_OSS_ENDPOINT = S3_ENDPOINT_ENV ||
  (OSS_REGION
    ? 'https://' + (/^oss-/i.test(OSS_REGION) ? '' : 'oss-') + OSS_REGION + '.aliyuncs.com'
    : '');
const S3_FORCE_PATH_STYLE_ENV = env('S3_FORCE_PATH_STYLE', '');

/* 旧开关 OBJECT_STORE → 新后端；显式 STORAGE_BACKEND 优先 */
const LEGACY_OBJECT_STORE = String(env('OBJECT_STORE', 'auto')).toLowerCase();
const OBJECT_STORE_BACKEND =
  ({ s3: 'oss', oss: 'oss', local: 'local', auto: 'auto' })[LEGACY_OBJECT_STORE] || 'auto';
const STORAGE_BACKEND = env('STORAGE_BACKEND', '') || OBJECT_STORE_BACKEND;

module.exports = {
  PORT: Number(env('PORT', '8787')),
  HTTPS_PORT: Number(env('HTTPS_PORT', '8443')),
  HTTPS: env('HTTPS', 'auto'), /* 'on' | 'off' | 'auto' */
  /* RayinAI 代理 —— 两套 key，共用同一个 base URL */
  RAYIN_BASE: env('RAYIN_BASE', 'https://www.rayinai.com/v1'),

  /* Key 1: OpenAI 图像模型 —— 走 /images/generations
     用户账号下可用图像模型:
     gpt-image-2 / gpt-image-2.5-flare / gpt-image-2.5-sunburst
     这 3 个模型不支持 chat/completions，只走 /images/generations
     只从环境变量读取，不在仓库里保留任何密钥明文；缺失时对应通道不可用。 */
  OPENAI_KEY: env('OPENAI_KEY', ''),

  /* Key 2: Gemini 图像模型 —— 走 /chat/completions
     用户账号下可用图像模型:
     gemini-3-pro-image / gemini-3.1-flash-image / gemini-3.1-flash-lite-image */
  GEMINI_KEY: env('GEMINI_KEY', ''),

  /* 向后兼容别名（未单独配置时沿用 GEMINI_KEY，避免两处不一致） */
  RAYIN_KEY: env('RAYIN_KEY', env('GEMINI_KEY', '')),

  /* 默认模型（可被前端 payload.model 覆盖） */
  GPT_MODEL: env('GPT_MODEL', 'gpt-image-2.5-flare'),
  BANANA_MODEL: env('BANANA_MODEL', 'gemini-3.1-flash-image'),
  VIDEO_MODEL: env('VIDEO_MODEL', 'sora-2'),
  AUDIO_MODEL: env('AUDIO_MODEL', 'tts-1'),
  RAYIN_VIDEO_PATH: env('RAYIN_VIDEO_PATH', '/videos/generations'),
  RAYIN_VIDEO_STATUS_PATH: env('RAYIN_VIDEO_STATUS_PATH', '/videos/generations'),
  /* CORS 来源白名单（逗号分隔）。
     默认只允许线上静态站 + 本地调试端口；CORS_ORIGINS 可整体覆盖，
     旧变量 CORS_ORIGIN 仍兼容（CORS_ORIGINS 优先）。设为 * 表示放开全部来源。 */
  CORS_ORIGINS: env('CORS_ORIGINS', env('CORS_ORIGIN', DEFAULT_CORS_ORIGINS)),
  CORS_ORIGIN: env('CORS_ORIGINS', env('CORS_ORIGIN', DEFAULT_CORS_ORIGINS)),
  /* token secret：只从环境变量读取，不再内置默认值。
     未配置时服务会拒绝启动（见文件末尾的校验），避免用公开的默认密钥签 token。
     注意：线上必须沿用当前已生效的 TOKEN_SECRET，否则所有人登录态失效。 */
  TOKEN_SECRET: env('TOKEN_SECRET', ''),
  /* 外部 PostgreSQL 连接串（Neon / Supabase / Render Postgres 等）。
     设置后作品/用户/桌面/资产全部存入外部数据库，Render 重启不再丢数据。
     不设置则回退到本地 JSON 文件（data/ 目录，重启会清空）。 */
  DATABASE_URL: env('DATABASE_URL', ''),
  /* 项目统一的「数据data」根目录：所有数据文件（运行时数据、MySQL、
     图书馆种子）都集中在这里，见 data/README.md */
  DATA_ROOT: process.env.DATA_ROOT
    ? path.resolve(env('DATA_ROOT', ''))
    : path.resolve(serverRoot, '..', 'data'),
  /* 运行时数据目录（用户、作品、媒体、证书等），已从 server/data 迁到 data/runtime */
  DATA_DIR: process.env.DATA_DIR
    ? path.resolve(env('DATA_DIR', ''))
    : path.resolve(serverRoot, '..', 'data', 'runtime'),
  /* ---------- 账号 / 用户数据 MySQL ---------- */
  /* auto  = 先试 MySQL，失败自动回落文件存储（默认，保证登录注册可用）
     mysql = 强制 MySQL，连不上则认证接口 503（明确报错）
     file  = 强制本地 JSON（过渡用，Render 重启会丢） */
  USER_STORE: env('USER_STORE', 'auto'),
  /* 单条连接串优先，格式：mysql://user:pass@host:3306/huimeng_users */
  MYSQL_URL: env('MYSQL_URL', ''),
  /* 账号库名（与图书馆库分开，避免混用） */
  USERS_MYSQL_DATABASE: env('USERS_MYSQL_DATABASE', 'huimeng_users'),
  /* ---------- 图书馆 MySQL ---------- */
  /* LIBRARY_STORE=mysql 时启用 MySQL；未配置或连接失败自动回退 JSON 文件存储 */
  LIBRARY_STORE: env('LIBRARY_STORE', 'auto'), // auto | mysql | file
  MYSQL_HOST: env('MYSQL_HOST', '127.0.0.1'),
  MYSQL_PORT: Number(env('MYSQL_PORT', '3306')),
  MYSQL_USER: env('MYSQL_USER', 'huimeng'),
  MYSQL_PASSWORD: env('MYSQL_PASSWORD', 'huimeng_lib_2026'),
  MYSQL_DATABASE: env('MYSQL_DATABASE', 'huimeng_library'),
  /* 表空间上限参考值（仅用于向接口/管理页展示，实际由 my.cnf 控制） */
  LIBRARY_STORAGE_LIMIT: env('LIBRARY_STORAGE_LIMIT', '500G'),

  /* ---------- 用户作品/项目数据（跨设备同步） ---------- */
  /* 结构化数据（作品元数据、项目文件夹树、编集、宣发、偏好）落 MySQL；
     MySQL 不可用时回落文件存储（USER_STORE=auto），并明确告警。
     二进制（作品图片/视频）走 S3 兼容对象存储，绝不入库、不把本地盘当唯一存储。 */
  USER_DATA_STORE: env('USER_DATA_STORE', 'auto'), // auto | mysql | file
  /* 对象存储（S3 协议）：Cloudflare R2 / MinIO / AWS S3 均可。
     OBJECT_STORE=auto 时只要 S3_ENDPOINT + S3_BUCKET + 密钥齐全就走 S3，
     否则回落本地盘（data/runtime/userdata），仅用于开发调试，Render 重启会丢。 */
  /* 统一 storage 适配层（当前启用 oss；github/r2 为预留空壳） */
  STORAGE_BACKEND,
  OSS_REGION,
  OSS_BUCKET,
  OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET,
  OSS_ENDPOINT,
  OSS_PUBLIC_BASE,
  STORAGE_URL_TTL,
  /* 封面/作品图的签名有效期与浏览器缓存头：签名越久、URL 越稳定，浏览器缓存才越容易命中。
     签名有效期上限 7 天（COS 限制）；ASSET_CACHE_CONTROL 会作为响应头随签名交给 COS 回给浏览器。 */
  ASSET_URL_TTL: Math.min(Number(env('ASSET_URL_TTL', '604800')) || 604800, 604800),
  ASSET_CACHE_CONTROL: env('ASSET_CACHE_CONTROL', 'public, max-age=604800'),
  /* 对象存储图片处理参数（可选，默认空=不处理）。
     留空的原因：桶未开通图片处理时带参数会直接 4xx，封面/作品图会裂；
     确认桶支持后再配置，例如 COS：imageMogr2/thumbnail/520x/quality/80 */
  ASSET_THUMB_QUERY: env('ASSET_THUMB_QUERY', ''),

  /* ---------- 兼容旧变量名（图书馆 PDF 直传 / 桶安全配置仍在用） ----------
     未单独配置 S3_* 时自动沿用 OSS_*，避免两套配置漏填。 */
  OBJECT_STORE: env('OBJECT_STORE', 'auto'), // auto | s3 | local
  S3_ENDPOINT: env('S3_ENDPOINT', DERIVED_OSS_ENDPOINT),
  S3_REGION: env('S3_REGION', 'auto'),
  S3_BUCKET: env('S3_BUCKET', OSS_BUCKET),
  S3_ACCESS_KEY_ID: env('S3_ACCESS_KEY_ID', OSS_ACCESS_KEY_ID),
  S3_SECRET_ACCESS_KEY: env('S3_SECRET_ACCESS_KEY', OSS_ACCESS_KEY_SECRET),
  /* 1=path-style（MinIO）；0/false=virtual-hosted（阿里云 OSS 必须）。
     未显式设置时：配了 OSS 就走 virtual-hosted，否则沿用旧的 path-style 默认。 */
  S3_FORCE_PATH_STYLE: S3_FORCE_PATH_STYLE_ENV
    ? !/^(0|false)$/i.test(S3_FORCE_PATH_STYLE_ENV)
    : !(OSS_REGION || OSS_BUCKET),
  /* 仅 OSS 需要时开启：签名请求加 x-oss-s3-compat: true（默认关闭） */
  S3_EXTRA_HEADER_OSS_COMPAT: /^(1|true)$/i.test(env('S3_EXTRA_HEADER_OSS_COMPAT', '0')),
  /* 可选 CDN/公开域名（私有桶留空，走服务端签名跳转） */
  S3_PUBLIC_BASE: OSS_PUBLIC_BASE,
  /* 预签名跳转有效期（秒），最大 7 天 */
  S3_URL_TTL: STORAGE_URL_TTL,

  /* ---------- 腾讯云 COS（STORAGE_BACKEND=cos 时生效） ----------
     只需要改 STORAGE_BACKEND=cos，其余键可复用上面的 S3_*；
     显式配置 COS_* 时优先用 COS_*。 */
  COS_SECRET_ID: env('COS_SECRET_ID', ''),
  COS_SECRET_KEY: env('COS_SECRET_KEY', ''),
  COS_BUCKET: env('COS_BUCKET', ''),
  COS_REGION: env('COS_REGION', ''),
  COS_PUBLIC_BASE: env('COS_PUBLIC_BASE', ''),
  /* 后端对外基地址（可选）。用于拼接图片 URL，例如
     https://huimeng-ai-backend.onrender.com/api；留空则按请求头自动推导。 */
  PUBLIC_BASE_URL: env('PUBLIC_BASE_URL', ''),

  /* 单用户容量与清理策略 */
  USER_WORK_CAP: Number(env('USER_WORK_CAP', '500')),
  USER_ASSET_MAX_BYTES: Number(env('USER_ASSET_MAX_BYTES', String(10 * 1024 * 1024))),
  USER_STORAGE_MAX_BYTES: Number(env('USER_STORAGE_MAX_BYTES', String(2 * 1024 * 1024 * 1024))),
  USER_DOC_MAX_BYTES: Number(env('USER_DOC_MAX_BYTES', String(5 * 1024 * 1024))),
  /* 服务器 Key 的每日生成额度（0 = 不限）。只拦异常高频，正常用户默认够用。 */
  GEN_DAILY_LIMIT: Number(env('GEN_DAILY_LIMIT', '300')),

  /* 删除墓碑保留天数（便于其他设备同步到删除） */
  USER_TOMBSTONE_DAYS: Number(env('USER_TOMBSTONE_DAYS', '30')),
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};

/* ---------- 启动期校验（加载本文件即执行） ---------- */
/* 图像 API Key 缺失只告警、不阻断启动：对应通道会因未配置而不可用。 */
if (!module.exports.OPENAI_KEY) {
  console.warn('[config] 未配置 OPENAI_KEY：OpenAI 图像通道不可用（/images/generations 将失败）。');
}
if (!module.exports.GEMINI_KEY) {
  console.warn('[config] 未配置 GEMINI_KEY：Gemini 图像通道不可用（/chat/completions 将失败）。');
}
if (!module.exports.RAYIN_KEY) {
  console.warn('[config] 未配置 RAYIN_KEY：RayinAI 代理通道不可用（可用 GEMINI_KEY 作为别名）。');
}
/* TOKEN_SECRET 缺失直接拒绝启动：没有它无法签发/校验登录 token，
   继续启动只会让所有人登录后立刻掉线，不如启动即失败、暴露问题。 */
if (!module.exports.TOKEN_SECRET) {
  console.error('[config] 未配置 TOKEN_SECRET，服务拒绝启动。');
  console.error('[config] 请设置环境变量 TOKEN_SECRET（Render → Environment），且必须沿用线上现值，否则全员掉登录。');
  throw new Error('TOKEN_SECRET 未配置：请在环境变量中设置后再启动。');
}

