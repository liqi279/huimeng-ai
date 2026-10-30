'use strict';

const express = require('express');
const config = require('../config');
const store = require('../store');
const { PRESETS } = require('./presets');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    rayinConfigured: Boolean(config.RAYIN_KEY),
    engines: ['flux', 'openai', 'gpt-image', 'banana'],
    modes: ['image', 'video', 'audio'],
    /* 存储诊断：postgres = 已接外部数据库（重启不丢数据）；
       json = 本地文件存储（Render 免费层重启会清空）。
       persistent 为 true 才代表数据真正持久化。 */
    storage: store.storage,
    storageReady: store.storageReady(),
    persistent: store.storage === 'postgres' && store.storageReady(),
  });
});

router.get('/config', (req, res) => {
  res.json({
    rayin: {
      base: config.RAYIN_BASE,
      hasKey: Boolean(config.RAYIN_KEY),
      gptModel: config.GPT_MODEL,
      bananaModel: config.BANANA_MODEL,
      videoModel: config.VIDEO_MODEL,
      audioModel: config.AUDIO_MODEL,
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

module.exports = router;
