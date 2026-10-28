'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');

const router = express.Router();

router.get('/works', wrap(async (req, res) => {
  res.json({ items: await store.listWorks() });
}));

router.post('/works', wrap(async (req, res) => {
  const body = req.body || {};
  const work = body.work;
  assert(work && typeof work === 'object' && !Array.isArray(work), 400, '缺少作品数据', '请求体需包含 work 对象');
  assert(typeof work.id === 'string' && work.id.trim(), 400, '作品缺少 id', 'work.id 必须为非空字符串');

  const saved = {
    ...work,
    id: work.id.trim(),
    createdAt: work.createdAt || new Date().toISOString(),
  };
  await store.upsertWork(saved);
  res.json({ work: saved });
}));

router.delete('/works/:id', wrap(async (req, res) => {
  await store.removeWork(req.params.id);
  res.json({ ok: true });
}));

router.delete('/works', wrap(async (req, res) => {
  await store.clearWorks();
  res.json({ ok: true });
}));

module.exports = router;
