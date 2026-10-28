'use strict';

const express = require('express');
const config = require('../config');
const { PRESETS } = require('./presets');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    rayinConfigured: Boolean(config.RAYIN_KEY),
    engines: ['flux', 'gpt-image', 'banana'],
    modes: ['image', 'video', 'audio'],
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
      refMaxCount: 3,
      promptMaxChars: 1800,
    },
    presets: PRESETS,
  });
});

module.exports = router;
