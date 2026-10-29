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
  RAYIN_BASE: env('RAYIN_BASE', 'https://www.rayinai.com/v1'),
  RAYIN_KEY: env('RAYIN_KEY', ''),
  GPT_MODEL: env('GPT_MODEL', 'gpt-image-2'),
  BANANA_MODEL: env('BANANA_MODEL', 'nano-banana'),
  VIDEO_MODEL: env('VIDEO_MODEL', 'sora-2'),
  AUDIO_MODEL: env('AUDIO_MODEL', 'tts-1'),
  RAYIN_VIDEO_PATH: env('RAYIN_VIDEO_PATH', '/videos/generations'),
  RAYIN_VIDEO_STATUS_PATH: env('RAYIN_VIDEO_STATUS_PATH', '/videos/generations'),
  CORS_ORIGIN: env('CORS_ORIGIN', '*'),
  /* 固定 token secret —— Render 免费层每次重启清空 data/ 目录，
     所以 secret 不能只存在文件里；优先读环境变量，没有就用内置固定值
     （任何环境下只要不手动改 env，token 永远有效） */
  TOKEN_SECRET: env('TOKEN_SECRET', 'huimeng-ai-v1-permanent-secret-change-me-if-you-want-2026'),
  DATA_DIR: process.env.DATA_DIR ? path.resolve(env('DATA_DIR', '')) : path.join(serverRoot, 'data'),
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};
