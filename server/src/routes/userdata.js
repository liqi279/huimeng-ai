'use strict';

/* =============================================================
 * 绘梦 · 用户数据同步接口
 * -------------------------------------------------------------
 * GET    /api/user-data/status           当前存储类型（MySQL/文件 + 对象存储/本地盘）
 * GET    /api/user-data/usage            容量用量
 * GET    /api/user-data/bootstrap        登录后全量拉取（作品 + 文档 + 用量）
 * POST   /api/user-data/migrate          本地旧数据一次性迁移（按 id 去重，可重试）
 * GET    /api/user-data/export           导出备份 JSON
 * GET    /api/user-data/assets/:id       读取图片（短时效 token；S3 走服务端代理回源，inline 返回）
 * GET    /api/docs/:kind                 读取 desk/compile/publish/prefs
 * PUT    /api/docs/:kind                 写入（baseRev 冲突返回 409）
 * POST   /api/works/:id/asset            上传作品图片（dataUrl）
 *
 * 权限：除 assets（签名 URL）外全部 authRequired，userId 只取 token，忽略 body/query 中的 user_id。
 * ============================================================= */

const express = require('express');
const crypto = require('crypto');
const { Readable } = require('stream');
const { wrap, assert, jsonError, extFromMime } = require('../http');
const { authRequired } = require('../auth');
const userData = require('../user-data');

const router = express.Router();

function currentUserId(req) {
  assert(req.user && req.user.id, 401, '未登录');
  return req.user.id;
}

/* SCF 网关对同步响应有 6MB 上限，超限时网关返回 406 且不带 CORS 头，
   浏览器只会报「Failed to fetch」。作品里历史遗留的内联 data: 图片（rawUrl 常有 3~4MB）
   在同步响应里替换为已签名的资产代理地址，数据库内容不做任何修改。 */
const INLINE_LIMIT = 64 * 1024;
const MAX_SYNC_BYTES = 4.5 * 1024 * 1024;

function trimInlineMedia(out) {
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value !== 'string' || !value.startsWith('data:') || value.length <= INLINE_LIMIT) continue;
    if (key === 'rawUrl' && out.url) out[key] = out.url;
    else delete out[key];
  }
  return out;
}

async function wrapWork(row, req) {
  var out = Object.assign({}, row.data || {}, {
    id: row.id,
    _rev: row.rev,
    _updatedAt: row.updatedAt,
  });
  if (out._assetId) out.url = await userData.assetPublicUrl(out._assetId);
  return trimInlineMedia(out);
}

function workTimeOf(work) {
  const v = work && (work._updatedAt || work.updatedAt || work.createdAt);
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

/* ---------------- 状态 / 用量 ---------------- */
router.get('/user-data/status', authRequired, wrap(async (req, res) => {
  const userId = currentUserId(req);
  const usage = await userData.usage(userId);
  res.json({
    ok: true,
    storage: userData.status(),
    usage,
    serverTime: Date.now(),
  });
}));

router.get('/user-data/usage', authRequired, wrap(async (req, res) => {
  res.json({ ok: true, usage: await userData.usage(currentUserId(req)) });
}));

/* ---------------- 全量拉取 ---------------- */
router.get('/user-data/bootstrap', authRequired, wrap(async (req, res) => {
  const userId = currentUserId(req);
  fs7Assert(userId);

  const since = Number(req.query.since) || 0;
  const works = [];
  const deleted = [];
  let cursor = since;
  let guard = 0;
  let hasMore = true;
  while (hasMore && guard < 30) {
    const page = await userData.listChanges(userId, { since: cursor, limit: 200 });
    works.push(...await Promise.all(page.items.map(function (row) { return wrapWork(row, req); })));
    deleted.push(...page.deleted);
    cursor = page.cursor;
    hasMore = page.hasMore;
    guard += 1;
    if (!page.items.length && !page.deleted.length) break;
  }

  const docs = {};
  for (const kind of userData.DOC_KINDS) {
    docs[kind] = await userData.getDoc(userId, kind);
  }

  const payload = {
    ok: true,
    user: { id: req.user.id, username: req.user.username, role: req.user.role },
    works,
    deleted,
    docs,
    cursor,
    since,
    hasMore,
    usage: await userData.usage(userId),
    storage: userData.status(),
    serverTime: Date.now(),
  };
  let body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_SYNC_BYTES) {
    /* 兜底：仍超 6MB 网关上限时，把作品里所有内联 data: 字段再压掉，
       保留 url 代理地址；只影响本次响应，不改库。 */
    payload.works = payload.works.map(function (work) {
      const copy = Object.assign({}, work);
      trimInlineMedia(copy);
      for (const key of Object.keys(copy)) {
        if (typeof copy[key] === 'string' && copy[key].startsWith('data:')) copy[key] = copy.url || '';
      }
      return copy;
    });
    payload.trimmed = true;
    body = JSON.stringify(payload);
  }
  res.type('application/json').send(body);
}));

/* ---------------- 旧数据迁移（幂等） ---------------- */
router.post('/user-data/migrate', authRequired, wrap(async (req, res) => {
  const userId = currentUserId(req);
  const body = req.body || {};
  const list = Array.isArray(body.works) ? body.works.slice(0, 2000) : [];
  const docs = body.docs && typeof body.docs === 'object' ? body.docs : {};

  const result = {
    works: { created: 0, updated: 0, skipped: 0, failed: [] },
    docs: { written: [], skipped: [], failed: [] },
  };

  for (const item of list) {
    const work = item && item.work ? item.work : item;
    if (!work || typeof work.id !== 'string' || !work.id.trim()) {
      result.works.failed.push(item && item.id ? item.id : '(no-id)');
      continue;
    }
    if (JSON.stringify(work).length > 2 * 1024 * 1024) {
      result.works.failed.push(work.id);
      continue;
    }
    try {
      const existing = await userData.getWork(userId, work.id);
      const incomingTs = Number(item._updatedAt || work._updatedAt || work.updatedAt) || workTimeOf(work);
      if (!existing) {
        await userData.putWork(userId, work, null);
        result.works.created += 1;
      } else if (existing.deleted) {
        result.works.skipped += 1;
      } else if (incomingTs && incomingTs > existing.updatedAt) {
        await userData.putWork(userId, work, null);
        result.works.updated += 1;
      } else {
        result.works.skipped += 1;
      }
    } catch (err) {
      result.works.failed.push(work.id);
    }
  }

  for (const kind of userData.DOC_KINDS) {
    const incoming = docs[kind];
    if (!incoming || incoming.data == null) continue;
    try {
      const existing = await userData.getDoc(userId, kind);
      const incomingTs = Number(incoming.updatedAt) || 0;
      if (!existing.rev || incomingTs > existing.updatedAt) {
        await userData.putDoc(userId, kind, incoming.data, null);
        result.docs.written.push(kind);
      } else {
        result.docs.skipped.push(kind);
      }
    } catch (err) {
      result.docs.failed.push(kind);
    }
  }

  await userData.setState(userId, 'legacy_migrated', String(Date.now()));
  if (body.deviceId) {
    await userData.setState(userId, 'device_' + String(body.deviceId).slice(0, 32), String(Date.now()));
  }

  res.json({
    ok: true,
    migratedAt: Date.now(),
    result,
    usage: await userData.usage(userId),
    storage: userData.status(),
  });
}));

/* ---------------- 备份导出 ---------------- */
router.get('/user-data/export', authRequired, wrap(async (req, res) => {
  const userId = currentUserId(req);
  const data = await userData.exportAll(userId);
  data.storageStatus = userData.status();
  data.user = { id: userId, username: req.user.username };
  res.setHeader('Content-Disposition',
    'attachment; filename="huimeng-userdata-' + userId + '-' + Date.now() + '.json"');
  res.json(data);
}));

/* ---------------- 图片读取（签名 URL，无 Authorization） ---------------- */

/* inline 返回时用的文件名：保留对象 key 里的原扩展名；
   key 没有扩展名时按 mime 补一个，避免浏览器拿到没有类型的裸名。 */
function inlineFilename(asset) {
  const base = String(asset.objectKey || '').split('/').pop() || '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe && /\.[A-Za-z0-9]{1,8}$/.test(safe)) return safe;
  const ext = extFromMime(asset.mime) || 'bin';
  return (safe || 'asset') + '.' + ext;
}

/* s3 模式：服务端代理回源，把对象字节原样转给浏览器，并显式声明 inline。
   背景：阿里云 OSS 对该桶的默认域名强制加 Content-Disposition: attachment，
   这是账户级策略，桶配置和 OpenAPI 都没有开关；只要浏览器 302 落到 OSS
   默认域名，就一定会变成下载。所以这里不再跳转，由后端带签名请求取回字节，
   再以相同 Content-Type + inline 返回。
   代价：图片/音频流量经过 Render，带宽与延迟都会增加，也无法利用 OSS 边缘缓存。
   若以后绑定了已备案的自定义域名、且该域名不再被强制下载，可把这里切回
   302 预签名直链（省带宽、首字节更快）；local 分支保持原样，不做跳转。 */
async function proxyAssetFromObjectStore(req, res, asset) {
  const url = userData.objectStore.presignGet(asset.objectKey);
  if (!url) throw jsonError(502, '图片读取失败', '对象存储未启用');

  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  let upstream;
  try {
    upstream = await fetch(url, { method });
  } catch (err) {
    throw jsonError(502, '图片读取失败', '对象存储不可达');
  }

  /* 上游错误不透传（OSS 会返回 XML），统一换成本服务的 JSON 错误 */
  if (upstream.status === 404) {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    throw jsonError(404, '图片不存在或已删除');
  }
  if (!upstream.ok) {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    throw jsonError(502, '图片读取失败', '对象存储返回 ' + upstream.status);
  }

  res.status(upstream.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || asset.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="' + inlineFilename(asset) + '"');
  res.setHeader('Cache-Control', 'private, max-age=600');
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const etag = upstream.headers.get('etag');
  if (etag) res.setHeader('ETag', etag);

  if (method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }
  const readable = Readable.fromWeb(upstream.body);
  readable.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else res.end();
  });
  readable.pipe(res);
}

router.get('/user-data/assets/:id', wrap(async (req, res) => {
  const assetId = String(req.params.id || '');
  assert(assetId, 400, '缺少资产 id');
  const ok = userData.verifyAssetToken(assetId, req.query.t);
  if (!ok) throw jsonError(403, '图片链接已过期', '请刷新页面重新获取');

  const asset = await userData.getAsset(assetId);
  assert(asset && !asset.deleted, 404, '图片不存在或已删除');

  const st = userData.objectStore.status();
  if (st.mode === 's3') {
    /* 不再 302 到 OSS（默认域名会强制下载），改由后端代理回源、以 inline 返回 */
    await proxyAssetFromObjectStore(req, res, asset);
    return;
  }
  const buffer = await userData.objectStore.readObject(asset.objectKey);
  res.setHeader('Content-Type', asset.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('ETag', '"' + (asset.sha256 || crypto.createHash('sha1').update(buffer).digest('hex')) + '"');
  res.send(buffer);
}));

/* ---------------- 文档（desk / compile / publish / prefs） ---------------- */
router.get('/docs/:kind', authRequired, wrap(async (req, res) => {
  const kind = String(req.params.kind || '');
  const doc = await userData.getDoc(currentUserId(req), kind);
  res.json({ ok: true, doc });
}));

router.put('/docs/:kind', authRequired, wrap(async (req, res) => {
  const kind = String(req.params.kind || '');
  const body = req.body || {};
  const saved = await userData.putDoc(currentUserId(req), kind, body.data, body.rev);
  res.json({ ok: true, doc: saved });
}));

/* ---------------- 作品图片上传 ---------------- */
router.post('/works/:id/asset', authRequired, wrap(async (req, res) => {
  const userId = currentUserId(req);
  const workId = String(req.params.id || '').trim();
  assert(workId, 400, '缺少作品 id');
  const body = req.body || {};
  assert(typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:'),
    400, '缺少图片数据', '请求体需包含 dataUrl');
  const saved = await userData.saveWorkAsset(userId, workId, body.dataUrl, req);
  res.json({ ok: true, asset: saved, usage: await userData.usage(userId) });
}));

/* 防御：userId 必须是账号系统里的字符串 id，避免把非法值拼进路径/键 */
function fs7Assert(userId) {
  assert(typeof userId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(userId), 400, '用户标识非法');
}

module.exports = router;
