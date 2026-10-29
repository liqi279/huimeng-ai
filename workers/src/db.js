// D1 数据访问层（替代 Express 版的 JSON 文件存储）
import { hashPassword, newUserId, randomHex, verifyPassword } from './security.js';

export const ANON_USER_ID = '__anon__';

const WORK_CAP = 200;
const ASSET_CAP = 200;

function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

function sanitizeUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

/* ---------------- 用户 ---------------- */

export async function listUsers(db) {
  const { results } = await db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC')
    .all();
  return (results || []).map(rowToUser);
}

export async function findUserById(db, id) {
  const row = await db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .bind(id)
    .first();
  return rowToUser(row);
}

export async function findUserByUsername(db, username) {
  const row = await db
    .prepare('SELECT id, username, role, created_at FROM users WHERE username = ?')
    .bind(username)
    .first();
  return rowToUser(row);
}

export async function createUser(db, { username, password, role }) {
  const name = String(username).trim();
  const existing = await findUserByUsername(db, name);
  if (existing) return { ok: false, error: '用户名已存在' };

  const { salt, hash } = await hashPassword(password);
  const id = newUserId();
  try {
    await db
      .prepare('INSERT INTO users (id, username, pass_hash, pass_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, hash, salt, role === 'admin' ? 'admin' : 'user', Date.now())
      .run();
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) return { ok: false, error: '用户名已存在' };
    throw err;
  }
  return {
    ok: true,
    user: { id, username: name, role: role === 'admin' ? 'admin' : 'user', createdAt: Date.now() },
  };
}

/* Render 版在数据丢失时会用 token 里的 uid/username 自动重建用户；D1 不需要，
   但保留同样语义，方便老 token 平滑迁移。 */
export async function reviveUser(db, uid, username, role) {
  const existing = await findUserById(db, uid);
  if (existing) return existing;
  const name = String(username || '').trim();
  if (!name) return null;
  try {
    await db
      .prepare('INSERT OR IGNORE INTO users (id, username, pass_hash, pass_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uid, name, '', randomHex(16), role === 'admin' ? 'admin' : 'user', Date.now())
      .run();
  } catch (err) {
    return null;
  }
  return findUserById(db, uid);
}

export async function authenticateUser(db, username, password) {
  const row = await db
    .prepare('SELECT id, username, role, pass_hash, pass_salt, created_at FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (!row) return null;
  const ok = await verifyPassword(password, row.pass_salt, row.pass_hash);
  if (!ok) return null;
  return rowToUser(row);
}

export async function updateUserRole(db, id, role) {
  const user = await findUserById(db, id);
  if (!user) return { ok: false, error: '用户不存在' };
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role === 'admin' ? 'admin' : 'user', id).run();
  return { ok: true, user: { ...user, role: role === 'admin' ? 'admin' : 'user' } };
}

export async function resetUserPassword(db, id, newPassword) {
  const user = await findUserById(db, id);
  if (!user) return { ok: false, error: '用户不存在' };
  const { salt, hash } = await hashPassword(newPassword);
  await db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, id).run();
  return { ok: true };
}

export async function deleteUser(db, id) {
  const user = await findUserById(db, id);
  if (!user) return { ok: false, error: '用户不存在' };
  await db.prepare('DELETE FROM works WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM desk WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM presets WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM assets WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM blobs WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return { ok: true };
}

export { sanitizeUser };

/* ---------------- 作品 ---------------- */

export async function listWorks(db, userId) {
  const owner = userId || ANON_USER_ID;
  const { results } = await db
    .prepare('SELECT payload FROM works WHERE user_id = ? ORDER BY created_at DESC')
    .bind(owner)
    .all();
  return (results || []).map((row) => {
    try {
      return JSON.parse(row.payload);
    } catch (err) {
      return null;
    }
  }).filter(Boolean);
}

export async function upsertWork(db, userId, work) {
  const owner = userId || ANON_USER_ID;
  await db
    .prepare('INSERT INTO works (id, user_id, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, payload = excluded.payload, created_at = excluded.created_at')
    .bind(work.id, owner, JSON.stringify(work), Date.now())
    .run();
  await db
    .prepare('DELETE FROM works WHERE user_id = ? AND id NOT IN (SELECT id FROM works WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)')
    .bind(owner, owner, WORK_CAP)
    .run();
  return work;
}

export async function removeWork(db, userId, id) {
  const owner = userId || ANON_USER_ID;
  const found = await db
    .prepare('SELECT id FROM works WHERE user_id = ? AND id = ?')
    .bind(owner, id)
    .first();
  if (!found) return false;
  await db.prepare('DELETE FROM works WHERE user_id = ? AND id = ?').bind(owner, id).run();
  return true;
}

export async function clearWorks(db, userId) {
  const owner = userId || ANON_USER_ID;
  await db.prepare('DELETE FROM works WHERE user_id = ?').bind(owner).run();
  return true;
}

/* ---------------- 桌面 ---------------- */

const EMPTY_DESK = { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 };

export async function getDesk(db, userId) {
  const owner = userId || ANON_USER_ID;
  const row = await db.prepare('SELECT payload FROM desk WHERE user_id = ?').bind(owner).first();
  if (!row) return { ...EMPTY_DESK };
  try {
    return JSON.parse(row.payload);
  } catch (err) {
    return { ...EMPTY_DESK };
  }
}

export async function saveDesk(db, userId, desk) {
  const owner = userId || ANON_USER_ID;
  const next = {
    folders: Array.isArray(desk && desk.folders) ? desk.folders : [],
    positions: (desk && desk.positions) || {},
    assigns: (desk && desk.assigns) || {},
    names: (desk && desk.names) || {},
    updatedAt: Date.now(),
  };
  await db
    .prepare('INSERT INTO desk (user_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .bind(owner, JSON.stringify(next), next.updatedAt)
    .run();
  return next;
}

/* ---------------- 资产元数据 ---------------- */

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.mime.startsWith('image/') ? 'image' : row.mime.startsWith('video/') ? 'video' : 'audio',
    url: `/api/blob/${row.blob_key}`,
    blobKey: row.blob_key,
    size: row.size,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listAssets(db) {
  const { results } = await db
    .prepare('SELECT id, name, mime, size, blob_key, created_at FROM assets ORDER BY created_at DESC')
    .all();
  return (results || []).map(rowToAsset);
}

export async function getAsset(db, id) {
  const row = await db
    .prepare('SELECT id, name, mime, size, blob_key, created_at FROM assets WHERE id = ?')
    .bind(id)
    .first();
  return rowToAsset(row);
}

export async function addAsset(db, asset) {
  await db
    .prepare('INSERT OR REPLACE INTO assets (id, user_id, name, mime, size, blob_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(asset.id, asset.userId, asset.name, asset.mime, asset.size, asset.blobKey, asset.createdAt)
    .run();
  await db
    .prepare('DELETE FROM assets WHERE id NOT IN (SELECT id FROM assets ORDER BY created_at DESC LIMIT ?)')
    .bind(ASSET_CAP)
    .run();
  return asset;
}

export async function removeAsset(db, id) {
  const found = await getAsset(db, id);
  if (!found) return null;
  await db.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();
  return found;
}

/* ---------------- blobs（无 R2 时的兜底存储） ---------------- */

export async function putBlobRow(db, { key, userId, data, mime }) {
  await db
    .prepare('INSERT OR REPLACE INTO blobs (key, user_id, data, mime, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(key, userId || ANON_USER_ID, data, mime || 'application/octet-stream', Date.now())
    .run();
}

export async function getBlobRow(db, key) {
  return db.prepare('SELECT key, data, mime FROM blobs WHERE key = ?').bind(key).first();
}

export async function removeBlobRow(db, key) {
  await db.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
}

/* ---------------- 用户自定义 presets ---------------- */

export async function listPresetRows(db, userId) {
  const { results } = await db
    .prepare('SELECT key, payload FROM presets WHERE user_id = ? ORDER BY key ASC')
    .bind(userId)
    .all();
  return (results || []).map((row) => {
    try {
      return JSON.parse(row.payload);
    } catch (err) {
      return null;
    }
  }).filter(Boolean);
}
