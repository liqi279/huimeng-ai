// 素材上传与 blob 访问（/assets、/api/blob/:key、/uploads/assets|media/:key）
import { Hono } from 'hono';
import { authOptional, currentUserId } from '../auth.js';
import { assert, extFromMime, parseDataUrl, randomToken, readJsonBody } from '../util.js';
import { addAsset, getAsset, listAssets, removeAsset } from '../db.js';
import { deleteBlob, getBlob, putBlob } from '../storage.js';
import { randomUUID } from '../security.js';

const MAX_ASSET_BYTES = 8 * 1024 * 1024;

const routes = new Hono();

function toAbsolute(c, path) {
  if (!path || !path.startsWith('/')) return path;
  try {
    return new URL(path, c.req.url).toString();
  } catch (err) {
    return path;
  }
}

function publicAsset(asset, c) {
  if (!asset) return null;
  const created = asset.createdAt;
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    url: toAbsolute(c, asset.url),
    size: asset.size,
    createdAt: typeof created === 'number' ? new Date(created).toISOString() : created,
  };
}

function kindFromMime(mime, fallback) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return ['image', 'video', 'audio'].includes(fallback) ? fallback : 'image';
}

routes.get('/assets', async (c) => {
  const items = await listAssets(c.env.DB);
  return c.json({ items: items.map((item) => publicAsset(item, c)) });
});

routes.post('/assets', authOptional, async (c) => {
  const body = await readJsonBody(c);
  assert(
    typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:'),
    400,
    '缺少文件数据',
    'dataUrl 需为 data:<mime>;base64,... 形式',
  );

  const decoded = parseDataUrl(body.dataUrl);
  assert(decoded.bytes.length > 0, 400, '文件内容为空', '请重新选择文件');
  assert(decoded.bytes.length <= MAX_ASSET_BYTES, 413, '文件过大', '单个资产不能超过 8MB');

  const mime = decoded.mime || 'application/octet-stream';
  const kind = kindFromMime(mime, body.kind);
  const ext = extFromMime(mime) || (kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3');
  const blobKey = `${Date.now()}-${randomToken()}.${ext}`;
  const userId = currentUserId(c);

  await putBlob(c.env, { key: blobKey, data: decoded.bytes, mime, userId });

  const asset = {
    id: randomUUID(),
    userId: userId || '__anon__',
    name: (typeof body.name === 'string' && body.name.trim()) || `${kind}-${Date.now()}.${ext}`,
    mime,
    kind,
    url: `/api/blob/${blobKey}`,
    size: decoded.bytes.length,
    blobKey,
    createdAt: Date.now(),
  };
  await addAsset(c.env.DB, asset);

  return c.json({ asset: publicAsset(asset, c) });
});

routes.delete('/assets/:id', async (c) => {
  const found = await getAsset(c.env.DB, c.req.param('id'));
  if (!found) return c.json({ ok: true, deleted: false });
  await deleteBlob(c.env, found.blobKey);
  await removeAsset(c.env.DB, found.id);
  return c.json({ ok: true, deleted: true });
});

export async function serveBlob(c) {
  const key = c.req.param('key');
  const result = await getBlob(c.env, key, c.req.raw);
  if (!result) {
    return c.json({ error: { message: '资源不存在', hint: `GET ${c.req.path}` } }, 404);
  }
  if (result.notModified) {
    return new Response(null, { status: 304, headers: result.headers });
  }
  return new Response(result.body, { status: 200, headers: result.headers });
}

routes.get('/blob/:key', serveBlob);

export default routes;
