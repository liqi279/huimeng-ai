'use strict';

const express = require('express');
const config = require('../config');
const { wrap, assert, normalizeBase, fetchJson } = require('../http');

const router = express.Router();

router.post('/rayin/models', wrap(async (req, res) => {
  const body = req.body || {};
  const base = normalizeBase(body.base || config.RAYIN_BASE);
  const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : config.RAYIN_KEY;
  assert(key, 400, '未配置 RayinAPI Key', '在设置中填写 Key 或配置服务端 RAYIN_KEY');

  const data = await fetchJson(
    `${base}/models`,
    { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
    30000,
    '请检查 API 地址与 Key 是否正确',
  );

  const list = data && Array.isArray(data.data) ? data.data : [];
  const ids = [...new Set(list.map((item) => item && item.id).filter((id) => typeof id === 'string' && id))];
  res.json({ ids });
}));

module.exports = router;
