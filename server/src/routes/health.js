'use strict';

const express = require('express');
const config = require('../config');
const store = require('../store');
const library = require('../library-store');
const userData = require('../user-data');
const { PRESETS } = require('./presets');

const router = express.Router();

router.get('/health', (req, res) => {
  let userDataStatus = null;
  try {
    userDataStatus = userData.status();
  } catch (err) {
    userDataStatus = { error: err && err.message };
  }
  /* 图书馆库状态：degraded=true 表示 MySQL 连不上、正在按退避重试，
     此时书目只来自本机种子数据，写入会被拒绝（不会静默落 /tmp）。 */
  let libraryStatus = null;
  try {
    libraryStatus = library.state();
  } catch (err) {
    libraryStatus = { error: err && err.message };
  }
  res.json({
    ok: true,
    version: '1.1.0',
    rayinConfigured: Boolean(config.RAYIN_KEY),
    engines: ['flux', 'openai', 'gpt-image', 'banana'],
    modes: ['image', 'video', 'audio'],
    /* 存储诊断：取用户数据/作品的实际落库方式。
       userData.dataStore=mysql 才代表重启不丢；file 才是落在 DATA_DIR（SCF 下 /tmp）。 */
    storage: (userDataStatus && userDataStatus.dataStore) || store.storage,
    storageReady: store.storageReady(),
    persistent: (userDataStatus && userDataStatus.dataStore === 'mysql') || store.storage === 'postgres',
    /* 用户数据（作品/项目/编集/宣发/偏好）与图片的实际存储类型 */
    userData: userDataStatus,
    library: libraryStatus,
    degraded: Boolean(libraryStatus && libraryStatus.degraded),
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
