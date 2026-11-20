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
const { mergeDesk, mergeAndSave, applyOps } = require('../desk-merge');
const { backfillUser } = require('../desk-backfill');
const { authOptional } = require('../auth');

const router = express.Router();

/* 轻量变更探测：只读 rev / updatedAt，不取图片、不列对象、不跑列表查询。
   支持 ETag + If-None-Match，未变化直接 304（无响应体），供前端 9 秒轮询。 */
router.get('/desk/rev', authOptional, wrap(async (req, res) => {
  let rev = 0;
  let updatedAt = 0;
  if (req.user) {
    const meta = typeof userData.getDocMeta === 'function'
      ? await userData.getDocMeta(req.user.id, 'desk')
      : await userData.getDoc(req.user.id, 'desk');
    rev = Number(meta && meta.rev) || 0;
    updatedAt = Number(meta && meta.updatedAt) || 0;
  } else {
    const d = await store.getDesk(null);
    updatedAt = Number(d && d.updatedAt) || 0;
  }
  const tag = '"' + rev + '-' + updatedAt + '"';
  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  if (String(req.headers['if-none-match'] || '') === tag) {
    res.status(304).end();
    return;
  }
  res.json({ rev, updatedAt });
}));

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
    /* 访客桌面同样是多端共享的全局文件，写入前也合并一次 */
    const existing = await store.getDesk(null);
    const saved = await store.saveDesk(null, mergeDesk(existing, desk));
    res.json({ desk: saved });
    return;
  }

  const next = Object.assign({}, desk, { updatedAt: Date.now() });
  /* 所有登录用户的 desk 写入统一走 mergeAndSave：
     先与已存文档合并，再用 rev 乐观锁防并发覆盖（409 自动重读重试）。
     旧版前端提交缺 stacks 的整包快照时，也不会再抹掉别的设备的数据。 */
  const doc = await mergeAndSave(userData, req.user.id, next);
  res.json({ desk: doc.data, rev: doc.rev, updatedAt: doc.updatedAt });
}));

/* 逐项写：新建/重命名/移动/删除文件夹、叠放增删改、作品归入/移出、位置/命名。
   服务端在「当前云端文档」上逐条应用（新增幂等、删除幂等），不再整包覆盖。
   带 rev 乐观锁；冲突自动重读重试，仍冲突则 409 并返回当前云端文档供客户端重放。 */
router.post('/desk/ops', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const ops = Array.isArray(body.ops) ? body.ops : [];
  assert(ops.length > 0, 400, '缺少操作', 'ops 不能为空');

  if (!req.user) {
    const existing = await store.getDesk(null);
    const applied = applyOps(existing, ops);
    const saved = applied.changed ? await store.saveDesk(null, applied.doc) : existing;
    res.json({ desk: saved, rev: 0, updatedAt: Number(saved && saved.updatedAt) || 0 });
    return;
  }

  const userId = req.user.id;
  for (let i = 0; i < 4; i += 1) {
    const existing = await userData.getDoc(userId, 'desk');
    const applied = applyOps(existing && existing.data ? existing.data : {}, ops);
    if (!applied.changed) {
      res.json({
        desk: existing.data || {},
        rev: existing.rev || 0,
        updatedAt: existing.updatedAt || 0,
      });
      return;
    }
    applied.doc.updatedAt = Date.now();
    try {
      const saved = await userData.putDoc(
        userId, 'desk', applied.doc, existing && existing.rev ? existing.rev : null
      );
      res.json({ desk: saved.data, rev: saved.rev, updatedAt: saved.updatedAt });
      return;
    } catch (err) {
      if (err && Number(err.status) === 409) {
        if (i < 3) continue;
        const cur = await userData.getDoc(userId, 'desk');
        res.status(409).json({
          error: '数据已被其它设备修改（版本冲突）',
          desk: cur.data || {},
          rev: cur.rev || 0,
          updatedAt: cur.updatedAt || 0,
        });
        return;
      }
      throw err;
    }
  }
}));

/* 测试生图补录：把该账号最近已完成任务里的图片补成作品。
   只新增 user_works 记录，不写 folders / stacks / assigns / names / positions，
   因此桌面文档一个字节都不改（rev 不变），已有条目不可能被覆盖。
   未归入文件夹的作品本来就显示在桌面根层，前端会自动紧凑排到空位。
   幂等：作品 id = gen-<jobId>，并按图片文件名与已有作品去重，可重复调用。 */
router.post('/desk/backfill', authOptional, wrap(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: { message: '请先登录', hint: '补录需要确定图片归属的账号' } });
    return;
  }
  const report = await backfillUser(req.user.id, { limit: (req.body && req.body.limit) || 60 });
  res.json(report);
}));

module.exports = router;
