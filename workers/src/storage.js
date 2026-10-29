// 二进制存储：优先 R2（env.ASSETS），未绑定 R2 时落 D1 blobs 表（base64）
import { base64ToBytes, bytesToBase64 } from './util.js';
import { getBlobRow, putBlobRow, removeBlobRow } from './db.js';

function hasR2(env) {
  return Boolean(env && env.ASSETS && typeof env.ASSETS.put === 'function');
}

export async function putBlob(env, { key, data, mime, userId }) {
  const type = mime || 'application/octet-stream';
  if (hasR2(env)) {
    await env.ASSETS.put(key, data, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
      customMetadata: { userId: String(userId || '') },
    });
    return;
  }
  await putBlobRow(env.DB, { key, userId, data: bytesToBase64(data), mime: type });
}

export async function getBlob(env, key, request) {
  if (hasR2(env)) {
    const object = await env.ASSETS.get(key);
    if (!object) return null;
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=31536000');
    if (request && request.headers.get('if-none-match') === object.httpEtag) {
      return { notModified: true, headers };
    }
    return { body: object.body, headers, size: object.size };
  }

  const row = await getBlobRow(env.DB, key);
  if (!row) return null;
  const bytes = base64ToBytes(row.data);
  const headers = new Headers();
  headers.set('Content-Type', row.mime || 'application/octet-stream');
  headers.set('Content-Length', String(bytes.length));
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Access-Control-Allow-Origin', '*');
  return { body: bytes, headers, size: bytes.length };
}

export async function deleteBlob(env, key) {
  if (!key) return;
  if (hasR2(env)) {
    try {
      await env.ASSETS.delete(key);
    } catch (err) {
      // 忽略 R2 删除失败
    }
    return;
  }
  await removeBlobRow(env.DB, key);
}

export function storageMode(env) {
  return hasR2(env) ? 'r2' : 'd1';
}
