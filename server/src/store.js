'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const WORK_CAP = 200;
const ASSET_CAP = 200;

const dirs = {
  root: config.DATA_DIR,
  assets: path.join(config.DATA_DIR, 'assets'),
  media: path.join(config.DATA_DIR, 'media'),
};

const worksFile = path.join(config.DATA_DIR, 'works.json');
const assetsFile = path.join(config.DATA_DIR, 'assets.json');
const deskFile = path.join(config.DATA_DIR, 'desk.json');

async function ensureDirs() {
  await fsp.mkdir(dirs.root, { recursive: true });
  await fsp.mkdir(dirs.assets, { recursive: true });
  await fsp.mkdir(dirs.media, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    const value = JSON.parse(text);
    return value == null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

// Serialize every mutation so concurrent requests cannot clobber each other.
let queue = Promise.resolve();

function enqueue(task) {
  const next = queue.then(task);
  queue = next.then(() => {}, () => {});
  return next;
}

async function readList(file) {
  const value = await readJson(file, []);
  return Array.isArray(value) ? value : [];
}

async function listWorks() {
  return readList(worksFile);
}

function upsertWork(work) {
  return enqueue(async () => {
    const list = await readList(worksFile);
    const next = [work, ...list.filter((item) => item && item.id !== work.id)].slice(0, WORK_CAP);
    await writeJson(worksFile, next);
    return work;
  });
}

function removeWork(id) {
  return enqueue(async () => {
    const list = await readList(worksFile);
    const next = list.filter((item) => !item || item.id !== id);
    if (next.length === list.length) return false;
    await writeJson(worksFile, next);
    return true;
  });
}

function clearWorks() {
  return enqueue(async () => {
    await writeJson(worksFile, []);
    return true;
  });
}

async function getDesk() {
  return readJson(deskFile, { folders: [], positions: {}, assigns: {}, names: {}, updatedAt: 0 });
}

function saveDesk(desk) {
  return enqueue(async () => {
    const next = {
      folders: Array.isArray(desk && desk.folders) ? desk.folders : [],
      positions: (desk && desk.positions) || {},
      assigns: (desk && desk.assigns) || {},
      names: (desk && desk.names) || {},
      updatedAt: Date.now(),
    };
    await writeJson(deskFile, next);
    return next;
  });
}

async function listAssets() {
  return readList(assetsFile);
}

async function getAsset(id) {
  const list = await readList(assetsFile);
  return list.find((item) => item && item.id === id) || null;
}

function addAsset(asset) {
  return enqueue(async () => {
    const list = await readList(assetsFile);
    const next = [asset, ...list.filter((item) => item && item.id !== asset.id)].slice(0, ASSET_CAP);
    await writeJson(assetsFile, next);
    return asset;
  });
}

function removeAsset(id) {
  return enqueue(async () => {
    const list = await readList(assetsFile);
    const found = list.find((item) => item && item.id === id) || null;
    if (!found) return null;
    await writeJson(assetsFile, list.filter((item) => !item || item.id !== id));
    return found;
  });
}

module.exports = {
  dirs,
  caps: { works: WORK_CAP, assets: ASSET_CAP },
  ensureDirs,
  readJson,
  writeJson,
  listWorks,
  upsertWork,
  removeWork,
  clearWorks,
  getDesk,
  saveDesk,
  listAssets,
  getAsset,
  addAsset,
  removeAsset,
};
