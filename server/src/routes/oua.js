'use strict';

/**
 * 原画（Original Animation）路由 —— 日式传统二维赛璐璐动画创作
 *
 * 两大分支：
 *   第一原画（本番原画 / ラフ原画）：
 *     负责 K 帧关键姿势 + 时间分配（タイムシート） + 运镜指示
 *     输出原画 Pose、时间分配表、Layout 对接、运镜指示
 *   第二原画（動画 / 中割り）：
 *     负责在 K 帧之间补间（中割り）+ 形状守恒 + 质量检查
 *     输出中割帧列表、运动轨迹、质量检查结果
 *
 * 核心数据模型 Shot（镜头）:
 *   shotNo   镜号（如 "1-01" 表示第 1 场第 1 镜）
 *   team     第一原画 / 第二原画
 *   first    本番原画数据（K 帧 + 时间分配 + 运镜 + Layout）
 *   second   動画数据（中割帧 + 质量检查 + 反馈）
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');

const writeJson = store.writeJson;
const readJson = store.readJson;
const enqueue = store.enqueue;

const router = express.Router();
const OUA_CAP = 2000;

/* ============ 持久化 ============ */
const ouaFile = path.join(store.dirs.root, 'oua.json');
async function loadShots() { return readJson(ouaFile, []); }
function saveShots(list) { return enqueue(() => writeJson(ouaFile, list)); }

function uid() { return crypto.randomUUID(); }

function emptyShot() {
  return {
    title: '',
    shotNo: '',             // 如 "1-01"
    sceneRef: '',           // 关联剧本场次（如 "scene_abc123"）
    team: 'first',          // 'first' | 'second'
    status: 'todo',         // todo | wip | review | final
    version: 'Ver1.0',
    // 第一原画（team === 'first' 时主要使用）
    first: {
      director: '',         // 作画监督 / 原画担当
      supervisor: '',       // 动画监督
      timeSheet: '',        // タイムシート（秒数/帧数）
      poseKeyframes: [],    // K 帧关键姿势 [{ frame, second, pose, url, note, keyType: 'layout'|'key'|'breakdown' }]
      cameraMove: '固定',   // 运镜：固定 / 左 PAN→ / 右 →PAN / 上 ↑TILT / 下 ↓TILT / 前 DOLLY IN / 后 DOLLY OUT / 回転 / 组合
      cameraDuration: '',   // 运镜时长（秒）
      layoutRef: [],        // Layout 对接参考图
      bgRef: '',            // 背景设定引用
      characterRef: [],     // 角色设定引用 [{characterId, expression, outfit}]
      actionFlow: '',       // 动作描述 / 时间分配说明
      drawingNotes: '',     // 原画绘画注意点（线条风格 / 变形 / 禁忌）
      dialoguePoint: '',    // 对白进入时间（如 0:03.5）
      sfxPoint: '',         // 音效进入时间
    },
    // 第二原画（team === 'second' 时主要使用）
    second: {
      animator: '',          // 动画师担当
      keyA_idx: -1,          // 起始 K 帧 index（指向 first.poseKeyframes）
      keyB_idx: -1,          // 结束 K 帧 index
      totalFrames: 0,        // 本镜头总动画帧数
      tweens: [],            // 中割补间帧 [{ frameNum, ratio, url, issue, fixNote }]
      shapeCheck: [],        // 形状守恒检查 [{ frameNum, status, note }]
      motionCheck: [],       // 运动轨迹检查 [{ frameNum, note }]
      feedbackStatus: 'pending', // pending | submitted | reviewing | fixing | approved
      feedbackNote: '',
      revisionCount: 0,
    },
    tags: [],
    media: { thumb: '' },
    createdAt: '',
    updatedAt: '',
  };
}

/* ============ 辅助函数 ============ */
function findShot(list, id) {
  return list.find((s) => s.id === id);
}
function mask(s) { return Object.assign({}, s); }

function deepMergeShot(base, patch) {
  base = base || emptyShot();
  patch = patch || {};
  const merged = Object.assign({}, base, patch);
  merged.first = Object.assign({}, base.first || {}, patch.first || {});
  merged.second = Object.assign({}, base.second || {}, patch.second || {});
  // 数组：patch 有就用 patch（客户端全量替换），否则保留 base
  ['poseKeyframes', 'layoutRef', 'characterRef', 'tweens', 'shapeCheck', 'motionCheck'].forEach(function (k) {
    merged.first[k] = Array.isArray(patch.first && patch.first[k]) ? patch.first[k] : (base.first[k] || []);
    merged.second[k] = Array.isArray(patch.second && patch.second[k]) ? patch.second[k] : (base.second[k] || []);
  });
  // characterRef 每项也需要保证结构
  merged.first.characterRef = merged.first.characterRef.map(function (r) {
    return Object.assign({ characterId: '', expression: '', outfit: '' }, r);
  });
  return merged;
}

/* ============ 列表 ============ */
router.get('/oua', wrap(async (req, res) => {
  const list = await loadShots();
  let items = list;
  const { team, status, sceneRef, shotNo, keyword } = req.query;
  if (team && team !== 'all') items = items.filter((s) => s.team === team);
  if (status && status !== 'all') items = items.filter((s) => s.status === status);
  if (sceneRef) items = items.filter((s) => (s.sceneRef || '').indexOf(sceneRef) >= 0);
  if (shotNo) items = items.filter((s) => (s.shotNo || '').indexOf(shotNo) >= 0);
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    items = items.filter((s) =>
      (s.title || '').toLowerCase().indexOf(kw) >= 0 ||
      (s.shotNo || '').toLowerCase().indexOf(kw) >= 0 ||
      (s.tags || []).some((t) => (t || '').toLowerCase().indexOf(kw) >= 0) ||
      ((s.first && s.first.actionFlow) || '').toLowerCase().indexOf(kw) >= 0
    );
  }
  items.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ items: items.map(mask), total: items.length });
}));

/* ============ 单个 ============ */
router.get('/oua/:id', wrap(async (req, res) => {
  const list = await loadShots();
  const shot = findShot(list, req.params.id);
  assert(shot, 404, '镜头不存在');
  res.json({ shot: mask(shot) });
}));

/* ============ 新建 ============ */
router.post('/oua', wrap(async (req, res) => {
  const body = req.body || {};
  const list = await loadShots();
  const now = new Date().toISOString();
  const eb = emptyShot();
  const shot = deepMergeShot(eb, body);
  shot.id = uid();
  shot.createdAt = now;
  shot.updatedAt = now;
  shot.shotNo = shot.shotNo || ('shot-' + list.length + 1);
  shot.status = shot.status || 'todo';
  shot.team = (shot.team === 'second') ? 'second' : 'first';
  shot.version = shot.version || 'Ver1.0';
  shot.tags = Array.isArray(body.tags) ? body.tags : [];
  list.unshift(shot);
  if (list.length > OUA_CAP) list.splice(OUA_CAP);
  await saveShots(list);
  res.json({ shot: mask(shot) });
}));

/* ============ 更新 ============ */
router.patch('/oua/:id', wrap(async (req, res) => {
  const list = await loadShots();
  const idx = list.findIndex((s) => s.id === req.params.id);
  assert(idx >= 0, 404, '镜头不存在');
  const body = req.body || {};
  const prev = list[idx];
  const merged = deepMergeShot(prev, body);
  merged.id = prev.id;
  merged.createdAt = prev.createdAt;
  merged.updatedAt = new Date().toISOString();
  merged.tags = Array.isArray(body.tags) ? body.tags : prev.tags;
  list[idx] = merged;
  await saveShots(list);
  res.json({ shot: mask(list[idx]) });
}));

/* ============ 删除 ============ */
router.delete('/oua/:id', wrap(async (req, res) => {
  const list = await loadShots();
  const idx = list.findIndex((s) => s.id === req.params.id);
  assert(idx >= 0, 404, '镜头不存在');
  list.splice(idx, 1);
  await saveShots(list);
  res.json({ ok: true });
}));

/* ============ 复制 ============ */
router.post('/oua/:id/duplicate', wrap(async (req, res) => {
  const list = await loadShots();
  const shot = findShot(list, req.params.id);
  assert(shot, 404, '镜头不存在');
  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(shot));
  copy.id = uid();
  copy.shotNo = (copy.shotNo || '') + '-dup';
  copy.createdAt = now; copy.updatedAt = now;
  copy.status = 'todo';
  list.unshift(copy);
  if (list.length > OUA_CAP) list.splice(OUA_CAP);
  await saveShots(list);
  res.json({ shot: mask(copy) });
}));

/* ============ 批量新建 ============ */
router.post('/oua/bulk', wrap(async (req, res) => {
  const body = req.body || {};
  assert(Array.isArray(body.items) && body.items.length > 0, 400, 'items 数组为空');
  assert(body.items.length <= 500, 400, '单次最多 500 条');
  const list = await loadShots();
  const now = new Date().toISOString();
  const results = [];
  let skipped = 0;
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const eb = emptyShot();
    const entry = deepMergeShot(eb, raw);
    entry.id = uid();
    entry.createdAt = now; entry.updatedAt = now;
    entry.team = (entry.team === 'second') ? 'second' : 'first';
    entry.status = entry.status || 'todo';
    list.unshift(entry);
    results.push({ id: entry.id, shotNo: entry.shotNo, title: entry.title, team: entry.team });
  }
  if (list.length > OUA_CAP) { list.splice(OUA_CAP); skipped += (results.length - 0); }
  await saveShots(list);
  res.json({ inserted: results.length, skipped, items: results });
}));

/* ============ 导出时间分配表 CSV ============ */
router.get('/oua/export', wrap(async (req, res) => {
  const list = await loadShots();
  const { team } = req.query;
  let items = list;
  if (team && team !== 'all') items = items.filter((s) => s.team === team);
  const rows = [
    '镜号,标题,团队,状态,原画担当,动画师,时间分配,动作描述,对白点,音效点,K帧数,中割帧数',
  ];
  items.forEach(function (s) {
    const first = s.first || {};
    const second = s.second || {};
    const kCount = Array.isArray(first.poseKeyframes) ? first.poseKeyframes.length : 0;
    const tCount = Array.isArray(second.tweens) ? second.tweens.length : 0;
    rows.push([
      csvEsc(s.shotNo), csvEsc(s.title), s.team === 'second' ? '第二原画' : '第一原画',
      s.status || '', csvEsc(first.director), csvEsc(second.animator),
      csvEsc(first.timeSheet), csvEsc(first.actionFlow),
      csvEsc(first.dialoguePoint), csvEsc(first.sfxPoint),
      kCount, tCount,
    ].join(','));
  });
  const csv = rows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="oua-timesheet.csv"');
  res.send('\uFEFF' + csv); // BOM for Excel
}));

function csvEsc(v) {
  v = String(v || '');
  if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

/* ============ 字典 ============ */
router.get('/oua/dict', wrap(async (req, res) => {
  res.json({
    teams: [
      { value: 'first', label: '第一原画（本番原画 / ラフ原画）' },
      { value: 'second', label: '第二原画（動画 / 中割り）' },
    ],
    statuses: [
      { value: 'todo', label: '未开始' },
      { value: 'wip', label: '进行中' },
      { value: 'review', label: '审图中' },
      { value: 'final', label: '定稿' },
    ],
    cameraMoves: ['固定', '左 PAN→', '右 →PAN', '上 ↑TILT', '下 ↓TILT', '前 DOLLY IN', '后 DOLLY OUT', '回転', '组合'],
    keyTypes: [
      { value: 'layout', label: 'Layout' },
      { value: 'key',    label: 'K 帧 / 本番' },
      { value: 'breakdown', label: '分解帧（Breakdown）' },
      { value: 'pose',   label: 'Pose 参考' },
    ],
    feedbackStatuses: [
      { value: 'pending',   label: '待提交' },
      { value: 'submitted', label: '已提交' },
      { value: 'reviewing', label: '审图中' },
      { value: 'fixing',    label: '修正中' },
      { value: 'approved',  label: '已通过' },
    ],
  });
}));

module.exports = router;
