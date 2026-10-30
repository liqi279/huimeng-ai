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
  DATA_DIR: process.env.DATA_DIR ? path.resolve(env('DATA_DIR', '')) : path.join(serverRoot, 'data'),
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};
