// 运行配置：Workers 环境变量优先，缺失时使用与 Express 版一致的默认值
const DEFAULT_SECRET = 'huimeng-ai-v1-permanent-secret-change-me-if-you-want-2026';

function envValue(env, name, fallback) {
  const value = env && env[name];
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

export function getConfig(env) {
  return {
    RAYIN_BASE: envValue(env, 'RAYIN_BASE', 'https://www.rayinai.com/v1'),
    RAYIN_KEY: envValue(env, 'RAYIN_KEY', ''),
    GPT_MODEL: envValue(env, 'GPT_MODEL', 'gpt-image-2'),
    BANANA_MODEL: envValue(env, 'BANANA_MODEL', 'nano-banana'),
    VIDEO_MODEL: envValue(env, 'VIDEO_MODEL', 'sora-2'),
    AUDIO_MODEL: envValue(env, 'AUDIO_MODEL', 'tts-1'),
    RAYIN_VIDEO_PATH: envValue(env, 'RAYIN_VIDEO_PATH', '/videos/generations'),
    RAYIN_VIDEO_STATUS_PATH: envValue(env, 'RAYIN_VIDEO_STATUS_PATH', '/videos/generations'),
    CORS_ORIGIN: envValue(env, 'CORS_ORIGIN', '*'),
    TOKEN_SECRET: envValue(env, 'TOKEN_SECRET', DEFAULT_SECRET),
  };
}
