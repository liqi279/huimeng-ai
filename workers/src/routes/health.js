// /api/health 与 /api/config
import { Hono } from 'hono';
import { getConfig } from '../config.js';
import { PRESETS } from '../presets.js';
import { storageMode } from '../storage.js';

const routes = new Hono();

routes.get('/health', (c) => {
  const cfg = getConfig(c.env);
  return c.json({
    ok: true,
    version: '1.0.0',
    rayinConfigured: Boolean(cfg.RAYIN_KEY),
    engines: ['flux', 'openai', 'gpt-image', 'banana'],
    modes: ['image', 'video', 'audio'],
    storage: storageMode(c.env),
  });
});

routes.get('/config', (c) => {
  const cfg = getConfig(c.env);
  return c.json({
    rayin: {
      base: cfg.RAYIN_BASE,
      hasKey: Boolean(cfg.RAYIN_KEY),
      gptModel: cfg.GPT_MODEL,
      bananaModel: cfg.BANANA_MODEL,
      videoModel: cfg.VIDEO_MODEL,
      audioModel: cfg.AUDIO_MODEL,
      voice: 'alloy',
    },
    limits: {
      refMaxBytes: 10485760,
      refMaxCount: 10,
      promptMaxChars: 1800,
    },
    presets: PRESETS,
  });
});

export default routes;
