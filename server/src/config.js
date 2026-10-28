'use strict';

const path = require('path');

const serverRoot = path.resolve(__dirname, '..');

function env(name, fallback) {
  const value = process.env[name];
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

module.exports = {
  PORT: Number(env('PORT', '8787')),
  RAYIN_BASE: env('RAYIN_BASE', 'https://www.rayinai.com/v1'),
  RAYIN_KEY: env('RAYIN_KEY', ''),
  GPT_MODEL: env('GPT_MODEL', 'gpt-image-2'),
  BANANA_MODEL: env('BANANA_MODEL', 'nano-banana'),
  VIDEO_MODEL: env('VIDEO_MODEL', 'sora-2'),
  AUDIO_MODEL: env('AUDIO_MODEL', 'tts-1'),
  RAYIN_VIDEO_PATH: env('RAYIN_VIDEO_PATH', '/videos/generations'),
  RAYIN_VIDEO_STATUS_PATH: env('RAYIN_VIDEO_STATUS_PATH', '/videos/generations'),
  CORS_ORIGIN: env('CORS_ORIGIN', '*'),
  DATA_DIR: process.env.DATA_DIR ? path.resolve(env('DATA_DIR', '')) : path.join(serverRoot, 'data'),
  FRONTEND_DIR: process.env.FRONTEND_DIR
    ? path.resolve(env('FRONTEND_DIR', ''))
    : path.resolve(serverRoot, '..', 'frontend'),
};
