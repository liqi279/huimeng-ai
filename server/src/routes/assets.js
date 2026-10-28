'use strict';

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const express = require('express');
const { wrap, assert, dataUrlToBuffer, extFromMime, randomToken } = require('../http');
const store = require('../store');

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const router = express.Router();

router.get('/assets', wrap(async (req, res) => {
  res.json({ items: await store.listAssets() });
}));

router.post('/assets', wrap(async (req, res) => {
  const body = req.body || {};
  assert(
    typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:'),
    400,
    '缺少文件数据',
    'dataUrl 需为 data:<mime>;base64,... 形式',
  );

  const decoded = dataUrlToBuffer(body.dataUrl);
  assert(decoded.buffer.length > 0, 400, '文件内容为空', '请重新选择文件');
  assert(decoded.buffer.length <= MAX_ASSET_BYTES, 413, '文件过大', '单个资产不能超过 8MB');

  const mime = decoded.mime || 'application/octet-stream';
  const kind = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
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
  };
  await store.addAsset(asset);
  res.json({ asset });
}));

router.delete('/assets/:id', wrap(async (req, res) => {
  const found = await store.removeAsset(req.params.id);
  if (found) {
    const fileName = path.basename(String(found.url || ''));
    if (fileName) await fsp.unlink(path.join(store.dirs.assets, fileName)).catch(() => {});
  }
  res.json({ ok: true, deleted: Boolean(found) });
}));

module.exports = router;
