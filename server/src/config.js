'use strict';

const path = require('path');

const serverRoot = path.resolve(__dirname, '..');

function env(name, fallback) {
  const value = process.env[name];
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

module.exports = {
  PORT: Number(env('PORT', '8787')),
  HTTPS_PORT: Number(env('HTTPS_PORT', '8443')),
  HTTPS: env('HTTPS', 'auto'), /* 'on' | 'off' | 'auto' */
  /* RayinAI 代理 —— 两套 key，共用同一个 base URL */
  RAYIN_BASE: env('RAYIN_BASE', 'https://www.rayinai.com/v1'),

  /* Key 1: OpenAI 图像模型 —— 走 /images/generations
     用户账号下可用图像模型:
     gpt-image-2 / gpt-image-2.5-flare / gpt-image-2.5-sunburst
     这 3 个模型不支持 chat/completions，只走 /images/generations */
  OPENAI_KEY: env('OPENAI_KEY', 'sk-9205aabaca73ce33821e254186977ac65181acee9d322042d595c696e6400747'),

  /* Key 2: Gemini 图像模型 —— 走 /chat/completions
     用户账号下可用图像模型:
     gemini-3-pro-image / gemini-3.1-flash-image / gemini-3.1-flash-lite-image */
  GEMINI_KEY: env('GEMINI_KEY', 'sk-e77e0766df2fe8a27a5eb19b0f4e4c97c604334e1ffeafc72bb55da70f14eb38'),

  /* 向后兼容别名 */
  RAYIN_KEY: env('RAYIN_KEY', 'sk-e77e0766df2fe8a27a5eb19b0f4e4c97c604334e1ffeafc72bb55da70f14eb38'),

  /* 默认模型（可被前端 payload.model 覆盖） */
  GPT_MODEL: env('GPT_MODEL', 'gpt-image-2.5-flare'),
  BANANA_MODEL: env('BANANA_MODEL', 'gemini-3.1-flash-image'),
  VIDEO_MODEL: env('VIDEO_MODEL', 'sora-2'),
  AUDIO_MODEL: env('AUDIO_MODEL', 'tts-1'),
  RAYIN_VIDEO_PATH: env('RAYIN_VIDEO_PATH', '/videos/generations'),
  RAYIN_VIDEO_STATUS_PATH: env('RAYIN_VIDEO_STATUS_PATH', '/videos/generations'),
  CORS_ORIGIN: env('CORS_ORIGIN', '*'),
  /* 固定 token secret —— Render 免费层每次重启清空 data/ 目录，
     所以 secret 不能只存在文件里；优先读环境变量，没有就用内置固定值
     （任何环境下只要不手动改 env，token 永远有效） */
  TOKEN_SECRET: env('TOKEN_SECRET', 'huimeng-ai-v1-permanent-secret-change-me-if-you-want-2026'),
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
  OBJECT_STORE: env('OBJECT_STORE', 'auto'), // auto | s3 | local
  S3_ENDPOINT: env('S3_ENDPOINT', ''),
  S3_REGION: env('S3_REGION', 'auto'),
  S3_BUCKET: env('S3_BUCKET', ''),
  S3_ACCESS_KEY_ID: env('S3_ACCESS_KEY_ID', ''),
  S3_SECRET_ACCESS_KEY: env('S3_SECRET_ACCESS_KEY', ''),
  S3_FORCE_PATH_STYLE: env('S3_FORCE_PATH_STYLE', '1') !== '0',
  /* 可选 CDN/公开域名（私有桶留空，走服务端签名跳转） */
  S3_PUBLIC_BASE: env('S3_PUBLIC_BASE', ''),
  /* S3 预签名跳转有效期（秒），最大 7 天 */
  S3_URL_TTL: Number(env('S3_URL_TTL', '3600')),
  /* 后端对外基地址（可选）。用于拼接图片 URL，例如
     https://huimeng-ai-backend.onrender.com/api；留空则按请求头自动推导。 */
  PUBLIC_BASE_URL: env('PUBLIC_BASE_URL', ''),

  /* 单用户容量与清理策略 */
  USER_WORK_CAP: Number(env('USER_WORK_CAP', '500')),
  USER_ASSET_MAX_BYTES: Number(env('USER_ASSET_MAX_BYTES', String(10 * 1024 * 1024))),
  USER_STORAGE_MAX_BYTES: Number(env('USER_STORAGE_MAX_BYTES', String(2 * 1024 * 1024 * 1024))),
  USER_DOC_MAX_BYTES: Number(env('USER_DOC_MAX_BYTES', String(5 * 1024 * 1024))),
  /* 删除墓碑保留天数（便于其他设备同步到删除） */
  USER_TOMBSTONE_DAYS: Number(env('USER_TOMBSTONE_DAYS', '30')),
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};
