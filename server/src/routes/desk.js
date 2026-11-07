'use strict';

/* =============================================================
 * 桌面/项目文件夹树接口（跨设备同步版）
 * -------------------------------------------------------------
 * GET  /desk      → { desk, rev, updatedAt }
 * PUT  /desk      → body { desk, rev }，rev 不匹配返回 409
 * 未登录沿用全局 JSON（兼容访客）。
 * ============================================================= */

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const userData = require('../user-data');
const { authOptional } = require('../auth');

const router = express.Router();

router.get('/desk', authOptional, wrap(async (req, res) => {
  if (!req.user) {
    res.json({ desk: await store.getDesk(null) });
    return;
  }
  const doc = await userData.getDoc(req.user.id, 'desk');
  res.json({
    desk: doc.data || { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 },
    rev: doc.rev,
    updatedAt: doc.updatedAt,
  });
}));

router.put('/desk', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const desk = body.desk;
  assert(desk && typeof desk === 'object' && !Array.isArray(desk), 400, '缺少桌面数据', '请求体需包含 desk 对象');

  if (!req.user) {
    const saved = await store.saveDesk(null, desk);
    res.json({ desk: saved });
    return;
  }

  const next = Object.assign({}, desk, { updatedAt: Date.now() });
  const doc = await userData.putDoc(req.user.id, 'desk', next, body.rev != null ? Number(body.rev) : null);
  res.json({ desk: doc.data, rev: doc.rev, updatedAt: doc.updatedAt });
}));

module.exports = router;
