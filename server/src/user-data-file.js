'use strict';

/* =============================================================
 * 绘梦 · 用户作品/项目数据「文件存储」实现
 * -------------------------------------------------------------
 * 仅在 MySQL 不可用（USER_STORE=auto 回落）时使用，接口与
 * user-data-mysql.js 完全一致，便于上层无感切换。
 *
 * 风险：data/runtime 在 Render 免费实例重启/重新部署会被清空。
 * 启动日志、/api/user-data/status、前端设置页都会明确标注。
 *
 * 写入策略：进程内串行 + 临时文件 rename（原子替换），避免并发覆盖/半截文件。
 * ============================================================= */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { jsonError } = require('./http');

const DOC_KINDS = ['desk', 'compile', 'publish', 'prefs'];

let queue = Promise.resolve();
function enqueue(task) {
  const next = queue.then(task);
  queue = next.then(() => {}, () => {});
  return next;
}

function dataDir(userId) {
  return path.join(config.DATA_DIR, 'users', String(userId));
}
function dataFile(userId) {
  return path.join(dataDir(userId), 'userdata.json');
}

async function readStore(userId) {
  try {
    const raw = JSON.parse(await fsp.readFile(dataFile(userId), 'utf8'));
    return {
      works: raw.works && typeof raw.works === 'object' ? raw.works : {},
      docs: raw.docs && typeof raw.docs === 'object' ? raw.docs : {},
      assets: raw.assets && typeof raw.assets === 'object' ? raw.assets : {},
      state: raw.state && typeof raw.state === 'object' ? raw.state : {},
    };
  } catch (e) {
    return { works: {}, docs: {}, assets: {}, state: {} };
  }
}

async function writeStore(userId, store) {
  await fsp.mkdir(dataDir(userId), { recursive: true });
  const file = dataFile(userId);
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function init() {
  return { ok: true, mode: 'file' };
}

/* ---------------- 作品 ---------------- */
async function listChanges(userId, since, limit) {
  const store = await readStore(userId);
  const sinceTs = Number(since) || 0;
  const max = Math.max(1, Math.min(Number(limit) || 200, 500));
  const all = Object.keys(store.works).map((id) => store.works[id])
    .filter((w) => w && Number(w.updatedAt) > sinceTs)
    .sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0));
  const page = all.slice(0, max);
  return {
    items: page.filter((w) => !w.deleted).map((w) => ({
      id: w.id, data: w.data || {}, rev: Number(w.rev) || 1, deleted: false,
      createdAt: Number(w.createdAt) || 0, updatedAt: Number(w.updatedAt) || 0,
      assetKey: w.assetKey || null, assetMime: w.assetMime || null, assetBytes: Number(w.assetBytes) || 0,
    })),
    deleted: page.filter((w) => w.deleted).map((w) => ({ id: w.id, rev: Number(w.rev) || 1, updatedAt: Number(w.updatedAt) || 0 })),
    cursor: page.length ? Number(page[page.length - 1].updatedAt) || sinceTs : sinceTs,
    hasMore: all.length > page.length,
  };
}

async function getWork(userId, workId) {
  const store = await readStore(userId);
  const w = store.works[workId];
  if (!w) return null;
  return {
    id: w.id, data: w.data || {}, rev: Number(w.rev) || 1, deleted: Boolean(w.deleted),
    createdAt: Number(w.createdAt) || 0, updatedAt: Number(w.updatedAt) || 0,
    assetKey: w.assetKey || null, assetMime: w.assetMime || null, assetBytes: Number(w.assetBytes) || 0,
  };
}

function putWork(userId, work, baseRev) {
  return enqueue(async () => {
    const store = await readStore(userId);
    const id = String(work.id).slice(0, 64);
    const current = store.works[id];
    if (current && !current.deleted && baseRev != null && Number(baseRev) !== (Number(current.rev) || 1)) {
      throw jsonError(409, '作品已被其它设备修改（版本冲突）', '请刷新后重试');
    }
    const now = Date.now();
    store.works[id] = {
      id,
      data: work,
      rev: current ? (Number(current.rev) || 1) + 1 : 1,
      deleted: false,
      createdAt: current ? Number(current.createdAt) : (Number(work.createdAt) || now),
      updatedAt: now,
      assetKey: current && current.assetKey || null,
      assetMime: current && current.assetMime || null,
      assetBytes: current && Number(current.assetBytes) || 0,
    };
    const trim = await enforceCap(store);
    await writeStore(userId, store);
    const saved = store.works[id];
    return {
      id, data: saved.data, rev: saved.rev, deleted: false,
      createdAt: saved.createdAt, updatedAt: saved.updatedAt, _trimmed: trim,
    };
  });
}

async function enforceCap(store) {
  const cap = Math.max(1, Number(config.USER_WORK_CAP) || 500);
  const alive = Object.keys(store.works)
    .filter((id) => !store.works[id].deleted)
    .sort((a, b) => (Number(store.works[b].updatedAt) || 0) - (Number(store.works[a].updatedAt) || 0));
  const removed = [];
  alive.slice(cap).forEach((id) => {
    const objectKeys = Object.keys(store.assets)
      .map((k) => store.assets[k])
      .filter((a) => a && a.workId === id && !a.deleted)
      .map((a) => a.objectKey);
    Object.keys(store.assets).forEach((k) => {
      if (store.assets[k] && store.assets[k].workId === id) delete store.assets[k];
    });
    removed.push({ id, objectKeys });
    delete store.works[id];
  });
  return removed;
}

function deleteWork(userId, workId, baseRev) {
  return enqueue(async () => {
    const store = await readStore(userId);
    const current = store.works[workId];
    if (current && !current.deleted && baseRev != null && Number(baseRev) !== (Number(current.rev) || 1)) {
      throw jsonError(409, '作品已被其它设备修改（版本冲突）', '请刷新后重试');
    }
    const now = Date.now();
    store.works[workId] = {
      id: workId,
      data: {},
      rev: current ? (Number(current.rev) || 1) + 1 : 1,
      deleted: true,
      createdAt: current ? Number(current.createdAt) : now,
      updatedAt: now,
      assetKey: current && current.assetKey || null,
    };
    await writeStore(userId, store);
    return { ok: true, rev: store.works[workId].rev, alreadyDeleted: Boolean(current && current.deleted), assetKey: current && current.assetKey || null };
  });
}

function clearWorks(userId) {
  return enqueue(async () => {
    const store = await readStore(userId);
    const out = [];
    const now = Date.now();
    Object.keys(store.works).forEach((id) => {
      const w = store.works[id];
      if (!w || w.deleted) return;
      out.push({ id, assetKey: w.assetKey || null });
      store.works[id] = Object.assign({}, w, { data: {}, deleted: true, rev: (Number(w.rev) || 1) + 1, updatedAt: now });
    });
    await writeStore(userId, store);
    return out;
  });
}

/* ---------------- 文档 ---------------- */
function assertKind(kind) {
  if (DOC_KINDS.indexOf(kind) < 0) throw jsonError(400, '不支持的数据类型：' + kind);
}

async function getDoc(userId, kind) {
  assertKind(kind);
  const store = await readStore(userId);
  const doc = store.docs[kind];
  if (!doc) return { kind, data: null, rev: 0, updatedAt: 0 };
  return { kind, data: doc.data == null ? null : doc.data, rev: Number(doc.rev) || 1, updatedAt: Number(doc.updatedAt) || 0 };
}

function putDoc(userId, kind, data, baseRev) {
  assertKind(kind);
  return enqueue(async () => {
    const payload = JSON.stringify(data == null ? null : data);
    if (Buffer.byteLength(payload, 'utf8') > config.USER_DOC_MAX_BYTES) {
      throw jsonError(413, '数据过大', '单个文档不能超过 ' + Math.round(config.USER_DOC_MAX_BYTES / 1024 / 1024) + 'MB');
    }
    const store = await readStore(userId);
    const current = store.docs[kind];
    if (current && baseRev != null && Number(baseRev) !== (Number(current.rev) || 1)) {
      throw jsonError(409, '数据已被其它设备修改（版本冲突）', '请刷新后重试');
    }
    store.docs[kind] = {
      data,
      rev: current ? (Number(current.rev) || 1) + 1 : 1,
      updatedAt: Date.now(),
    };
    await writeStore(userId, store);
    return { kind, data, rev: store.docs[kind].rev, updatedAt: store.docs[kind].updatedAt };
  });
}

/* ---------------- 资产 ---------------- */
function saveAsset(asset) {
  return enqueue(async () => {
    const store = await readStore(asset.userId);
    store.assets[asset.id] = {
      id: asset.id,
      userId: asset.userId,
      workId: asset.workId || null,
      objectKey: asset.objectKey,
      mime: asset.mime || null,
      bytes: Number(asset.bytes) || 0,
      sha256: asset.sha256 || null,
      deleted: false,
      createdAt: Number(asset.createdAt) || Date.now(),
    };
    await writeStore(asset.userId, store);
    return asset;
  });
}

async function getAsset(assetId) {
  /* 文件模式下没有全局索引：遍历 data/runtime/users/<uid>/userdata.json 查找。
     这是过渡实现，切换到 MySQL 后由 user_assets 主键直接命中。 */
  const root = path.join(config.DATA_DIR, 'users');
  let dirs = [];
  try { dirs = await fsp.readdir(root); } catch (e) { return null; }
  for (const dir of dirs) {
    const store = await readStore(dir);
    const asset = store.assets[assetId];
    if (asset) return asset;
  }
  return null;
}

function removeAsset(userId, assetId) {
  return enqueue(async () => {
    const store = await readStore(userId);
    const asset = store.assets[assetId];
    if (!asset) return null;
    asset.deleted = true;
    await writeStore(userId, store);
    return asset;
  });
}

async function listAssets(userId) {
  const store = await readStore(userId);
  return Object.keys(store.assets).map((id) => store.assets[id])
    .filter((a) => a && !a.deleted && a.userId === userId);
}

async function usage(userId) {
  const store = await readStore(userId);
  const works = Object.keys(store.works).filter((id) => !store.works[id].deleted).length;
  const assets = Object.keys(store.assets).map((id) => store.assets[id]).filter((a) => a && !a.deleted);
  return {
    works,
    assets: assets.length,
    bytes: assets.reduce((sum, a) => sum + (Number(a.bytes) || 0), 0),
    workCap: config.USER_WORK_CAP,
    assetMaxBytes: config.USER_ASSET_MAX_BYTES,
    storageMaxBytes: config.USER_STORAGE_MAX_BYTES,
  };
}

function setState(userId, key, value) {
  return enqueue(async () => {
    const store = await readStore(userId);
    store.state[key] = value == null ? null : String(value).slice(0, 255);
    await writeStore(userId, store);
  });
}

async function getState(userId, key) {
  const store = await readStore(userId);
  return store.state[key] == null ? null : store.state[key];
}

async function exportAll(userId) {
  const store = await readStore(userId);
  return {
    exportedAt: new Date().toISOString(),
    storage: 'file',
    userId,
    works: Object.keys(store.works).map((id) => store.works[id]),
    docs: Object.keys(store.docs).map((kind) => ({ kind, data: store.docs[kind].data, rev: store.docs[kind].rev, updatedAt: store.docs[kind].updatedAt })),
    assets: Object.keys(store.assets).map((id) => store.assets[id]),
  };
}

module.exports = {
  mode: 'file',
  init,
  DOC_KINDS,
  listChanges,
  getWork,
  putWork,
  deleteWork,
  clearWorks,
  getDoc,
  putDoc,
  saveAsset,
  getAsset,
  removeAsset,
  listAssets,
  usage,
  setState,
  getState,
  exportAll,
  newId: (prefix) => (prefix || 'a') + '_' + crypto.randomBytes(12).toString('hex'),
};
