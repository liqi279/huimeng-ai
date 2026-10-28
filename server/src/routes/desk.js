'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const { authOptional } = require('../auth');

const router = express.Router();

router.get('/desk', authOptional, wrap(async (req, res) => {
  res.json({ desk: await store.getDesk(req.user ? req.user.id : null) });
}));

router.put('/desk', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const desk = body.desk;
  assert(desk && typeof desk === 'object' && !Array.isArray(desk), 400, '缺少桌面数据', '请求体需包含 desk 对象');
  const saved = await store.saveDesk(req.user ? req.user.id : null, desk);
  res.json({ desk: saved });
}));

module.exports = router;
