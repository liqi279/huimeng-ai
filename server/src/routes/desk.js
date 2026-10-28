'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');

const router = express.Router();

router.get('/desk', wrap(async (req, res) => {
  res.json({ desk: await store.getDesk() });
}));

router.put('/desk', wrap(async (req, res) => {
  const body = req.body || {};
  const desk = body.desk;
  assert(desk && typeof desk === 'object' && !Array.isArray(desk), 400, '缺少桌面数据', '请求体需包含 desk 对象');
  const saved = await store.saveDesk(desk);
  res.json({ desk: saved });
}));

module.exports = router;
