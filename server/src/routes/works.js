'use strict';

/* =============================================================
 * 作品接口（跨设备同步版）
 * -------------------------------------------------------------
 * 已登录：数据落 MySQL(user_works) 或文件(userdata.json)，作品图片走对象存储。
 *   每条作品带 _rev / _updatedAt；提交时可带 rev 做乐观锁，不匹配返回 409。
 *   删除写墓碑，其它设备增量拉取时能感知删除。
 * 未登录：保持原有全局 JSON 行为（兼容访客本地使用）。
 * ============================================================= */

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const userData = require('../user-data');
const { authOptional } = require('../auth');

const router = express.Router();

const INLINE_THUMB_LIMIT = 120 * 1024;

async function wrapWork(row, req, urlMap) {
  var out = Object.assign({}, row.data || {}, {
    id: row.id,
    _rev: row.rev,
    _updatedAt: row.updatedAt,
  });
  /* 资产 URL 用对象存储签名直链（长签名，实例内复用同一 URL，浏览器可缓存）。
     urlMap 是整页一次批量查出来的；缺失时退回单条查询，避免批量失败导致图片不显示。 */
  if (out._assetId) {
    var hit = urlMap && urlMap[out._assetId];
    if (hit && hit.url) {
      out.url = hit.url;
      out.thumb = hit.thumb || '';
    } else {
      out.url = await userData.assetPublicUrl(out._assetId, req);
      out.thumb = '';
    }
  }
  /* 历史数据里可能存了内联 base64 缩略图：不再塞进响应体（单页最坏能到十几 MB）。
     只影响响应，不改数据库里的原始数据；若这条作品没有可用的原图地址，
     则保留缩略图，避免旧作品在网格里变成空白。 */
  if (typeof out.thumb === 'string' && out.thumb.indexOf('data:') === 0 &&
      out.url && out.url.indexOf('data:') !== 0) {
    out.thumb = '';
  }
  return out;
}

/* 把内联 base64 从元数据里剥离：图片进对象存储，数据库只存 url/object key。
   老前端仍会 POST 带 data: 的 work，这里兜底处理，避免把二进制写进数据库。 */
async function sanitizeForDb(userId, work, req) {
  const next = Object.assign({}, work);
  if (typeof next.url === 'string' && next.url.startsWith('data:')) {
    try {
      const asset = await userData.saveWorkAsset(userId, next.id, next.url, req);
      next.url = asset.url;
      next._assetId = asset.assetId;
      next._assetBytes = asset.bytes;
      next._inlineUploaded = true;
    } catch (err) {
      /* 图片过大/上传失败：保留缩略图，原图丢弃，避免污染数据库 */
      next.url = '';
      next._assetError = (err && err.message) || '图片上传失败';
    }
  }
  if (typeof next.thumb === 'string' && next.thumb.startsWith('data:') && next.thumb.length > INLINE_THUMB_LIMIT) {
    next.thumb = '';
  }
  if (Array.isArray(next.refImages)) {
    next.refImages = next.refImages.slice(0, 4).map((v) => (
      typeof v === 'string' && v.startsWith('data:') && v.length > 300 * 1024 ? '' : v
    )).filter(Boolean);
  }
  return next;
}

router.get('/works', authOptional, wrap(async (req, res) => {
  /* 访客：沿用全局文件存储 */
  if (!req.user) {
    res.json({ items: await store.listWorks(null) });
    return;
  }

  const userId = req.user.id;
  const since = Number(req.query.since) || 0;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
  const page = await userData.listChanges(userId, { since, limit });
  /* 整页一次批量取资产，避免每件作品一次查询（N+1）；失败时降级为逐条查询 */
  const assetIds = page.items.map(function (row) { return row.data && row.data._assetId; }).filter(Boolean);
  let urlMap = {};
  try {
    urlMap = await userData.assetsPublicUrls(assetIds, req);
  } catch (err) {
    console.warn('[works] 批量取资产失败，退回逐条签名：' + (err && err.message));
    urlMap = {};
  }
  res.json({
    items: await Promise.all(page.items.map(function (row) { return wrapWork(row, req, urlMap); })),
    deleted: page.deleted,
    cursor: page.cursor,
    hasMore: page.hasMore,
    serverTime: Date.now(),
  });
}));

router.post('/works', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const work = body.work;
  assert(work && typeof work === 'object' && !Array.isArray(work), 400, '缺少作品数据', '请求体需包含 work 对象');
  assert(typeof work.id === 'string' && work.id.trim(), 400, '作品缺少 id', 'work.id 必须为非空字符串');

  const saved = Object.assign({}, work, {
    id: work.id.trim(),
    createdAt: work.createdAt || new Date().toISOString(),
  });

  if (!req.user) {
    await store.upsertWork(null, saved);
    res.json({ work: saved });
    return;
  }

  const clean = await sanitizeForDb(req.user.id, saved, req);
  const baseRev = body.rev != null ? Number(body.rev) : (clean._rev != null ? Number(clean._rev) : null);
  const row = await userData.putWork(req.user.id, clean, baseRev);
  res.json({ work: wrapWork(row, req), rev: row.rev });
}));

router.delete('/works/:id', authOptional, wrap(async (req, res) => {
  if (!req.user) {
    await store.removeWork(null, req.params.id);
    res.json({ ok: true });
    return;
  }
  const baseRev = req.query.rev != null ? Number(req.query.rev) : null;
  const result = await userData.deleteWork(req.user.id, String(req.params.id), baseRev);
  /* 真删二进制：对象存储里的图片同步清理（墓碑留给其它设备同步删除事件） */
  try {
    if (req.query.assetId) await userData.deleteAsset(String(req.query.assetId));
    else await userData.deleteAssetByWork(req.user.id, String(req.params.id));
  } catch (err) {
    console.warn('[works] 删除作品图片失败（已保留墓碑）：' + (err && err.message));
  }
  res.json({ ok: true, rev: result && result.rev });
}));

router.delete('/works', authOptional, wrap(async (req, res) => {
  if (!req.user) {
    await store.clearWorks(null);
    res.json({ ok: true });
    return;
  }
  const removed = await userData.clearWorks(req.user.id);
  for (const item of removed) {
    await userData.deleteAssetByWork(req.user.id, item.id).catch(() => {});
  }
  res.json({ ok: true, removed: removed.length });
}));

module.exports = router;
