'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const { authOptional } = require('../auth');

const router = express.Router();

/* 可选登录：有用户按用户隔离，没用户走全局（兼容老数据） */
router.get('/works', authOptional, wrap(async (req, res) => {
  res.json({ items: await store.listWorks(req.user ? req.user.id : null) });
}));

router.post('/works', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const work = body.work;
  assert(work && typeof work === 'object' && !Array.isArray(work), 400, '缺少作品数据', '请求体需包含 work 对象');
  assert(typeof work.id === 'string' && work.id.trim(), 400, '作品缺少 id', 'work.id 必须为非空字符串');

  const saved = {
    ...work,
    id: work.id.trim(),
    createdAt: work.createdAt || new Date().toISOString(),
  };
  await store.upsertWork(req.user ? req.user.id : null, saved);
  res.json({ work: saved });
}));

router.delete('/works/:id', authOptional, wrap(async (req, res) => {
  await store.removeWork(req.user ? req.user.id : null, req.params.id);
  res.json({ ok: true });
}));

router.delete('/works', authOptional, wrap(async (req, res) => {
  await store.clearWorks(req.user ? req.user.id : null);
  res.json({ ok: true });
}));

module.exports = router;
