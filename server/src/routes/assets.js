'use strict';

/**
 * 资产 + 项目 合并路由
 *
 * 数据模型:
 *   Asset: { id, name, kind(image|video|audio), url, size, createdAt,
 *            type('project'|'reference'), projectId, folder }
 *   Project: { id, name, description, folders[], createdAt, updatedAt }
 *
 * 路由:
 *   GET  /assets                         → 全部资产（可 ?type=project&projectId=xxx&folder=yyy 过滤）
 *   POST /assets                         → 新增资产（dataUrl + type/projectId/folder/name）
 *   PATCH /assets/:id                    → 更新资产元数据（改文件夹、改类型等）
 *   DELETE /assets/:id                   → 删除资产
 *   GET  /projects                       → 全部项目
 *   POST /projects                       → 新建项目
 *   PATCH /projects/:id                  → 更新项目（加文件夹等）
 *   DELETE /projects/:id                 → 删除项目（其下资产保留，projectId 置空）
 */

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const express = require('express');
const { wrap, assert, dataUrlToBuffer, extFromMime, randomToken } = require('../http');
const store = require('../store');

const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 提到 50MB 支持视频
const router = express.Router();

/* ========== 资产 ========== */

router.get('/assets', wrap(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.projectId) filter.projectId = String(req.query.projectId);
  if (req.query.folder) filter.folder = String(req.query.folder);
  const items = await store.listAssets(filter);
  res.json({ items });
}));

router.post('/assets', wrap(async (req, res) => {
  const body = req.body || {};
  assert(
    typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:'),
    400, '缺少文件数据', 'dataUrl 需为 data:<mime>;base64,... 形式',
  );

  const decoded = dataUrlToBuffer(body.dataUrl);
  assert(decoded.buffer.length > 0, 400, '文件内容为空', '请重新选择文件');
  assert(decoded.buffer.length <= MAX_ASSET_BYTES, 413, '文件过大',
    `单个资产不能超过 ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)}MB`);

  const mime = decoded.mime || 'application/octet-stream';
  const kind = mime.startsWith('image/') ? 'image'
    : mime.startsWith('video/') ? 'video'
    : mime.startsWith('audio/') ? 'audio'
    : (['image', 'video', 'audio'].includes(body.kind) ? body.kind : 'image');
  const ext = extFromMime(mime) || (kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3');
  const fileName = `${Date.now()}-${randomToken()}.${ext}`;
  await fsp.writeFile(path.join(store.dirs.assets, fileName), decoded.buffer);

  const asset = {
    id: crypto.randomUUID(),
    name: (typeof body.name === 'string' && body.name.trim()) || `${kind}-${Date.now()}.${ext}`,
    kind,
    url: `/uploads/assets/${fileName}`,
    size: decoded.buffer.length,
    createdAt: new Date().toISOString(),
    // 新字段
    type: ['project', 'reference'].includes(body.type) ? body.type : 'project',
    projectId: body.projectId || null,
    folder: body.folder || null,
  };
  await store.addAsset(asset);
  res.json({ asset });
}));

router.patch('/assets/:id', wrap(async (req, res) => {
  const asset = await store.getAsset(req.params.id);
  assert(asset, 404, '资产不存在');
  const body = req.body || {};
  const allowed = ['name', 'type', 'projectId', 'folder'];
  const patch = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  const updated = { ...asset, ...patch };
  // 因为 store 没有 updateAsset，用 remove + add 模拟
  await store.removeAsset(asset.id);
  await store.addAsset(updated);
  res.json({ asset: updated });
}));

router.delete('/assets/:id', wrap(async (req, res) => {
  const found = await store.removeAsset(req.params.id);
  if (found) {
    const fileName = path.basename(String(found.url || ''));
    if (fileName) await fsp.unlink(path.join(store.dirs.assets, fileName)).catch(() => {});
  }
  res.json({ ok: true, deleted: Boolean(found) });
}));

/* ========== 项目 ========== */

router.get('/projects', wrap(async (req, res) => {
  const projects = await store.listProjects();
  // 附带每个项目的资产数量
  const allAssets = await store.listAssets();
  const enriched = projects.map((p) => {
    const count = allAssets.filter((a) => a.projectId === p.id).length;
    return { ...p, assetCount: count };
  });
  res.json({ projects: enriched });
}));

router.post('/projects', wrap(async (req, res) => {
  const body = req.body || {};
  assert(typeof body.name === 'string' && body.name.trim().length > 0, 400, '项目名不能为空');
  const project = await store.createProject({
    name: body.name,
    description: body.description || '',
    folders: body.folders || [],
  });
  res.json({ project });
}));

router.patch('/projects/:id', wrap(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.name != null) patch.name = String(body.name).trim().slice(0, 80);
  if (body.description != null) patch.description = String(body.description).slice(0, 300);
  if (Array.isArray(body.folders)) patch.folders = body.folders.slice(0, 50);
  const project = await store.updateProject(req.params.id, patch);
  assert(project, 404, '项目不存在');
  res.json({ project });
}));

router.post('/projects/:id/folders', wrap(async (req, res) => {
  const body = req.body || {};
  const folderName = String(body.name || '').trim().slice(0, 50);
  assert(folderName, 400, '文件夹名不能为空');
  const project = await store.getProject(req.params.id);
  assert(project, 404, '项目不存在');
  const folders = Array.isArray(project.folders) ? [...project.folders] : [];
  if (!folders.includes(folderName)) folders.push(folderName);
  const updated = await store.updateProject(req.params.id, { folders });
  res.json({ project: updated });
}));

router.delete('/projects/:id', wrap(async (req, res) => {
  const ok = await store.deleteProject(req.params.id);
  // 其下资产的 projectId 置空（保留文件不删）
  if (ok) {
    const all = await store.listAssets();
    for (const a of all) {
      if (a.projectId === req.params.id) {
        await store.removeAsset(a.id);
        await store.addAsset({ ...a, projectId: null });
      }
    }
  }
  res.json({ ok });
}));

module.exports = router;
