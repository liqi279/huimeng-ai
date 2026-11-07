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
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};
