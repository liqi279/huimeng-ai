'use strict';

/**
 * 剧本模块路由
 *
 * 数据模型：
 *   Script {
 *     id, title, genre, logline, outline,
 *     status: 'draft' | 'writing' | 'done',
 *     characters: Character[],
 *     scenes: Scene[],
 *     createdAt, updatedAt, versions: Version[]
 *   }
 *   Character { id, name, role, gender, age, avatar, description }
 *   Scene {
 *     id, number, title, location, timeOfDay, description,
 *     shots: Shot[], characters: string[] // character ids
 *   }
 *   Shot {
 *     id, number, type, // close-up / wide / medium / aerial ...
 *     duration, description, dialogue: Dialogue[], notes
 *   }
 *   Dialogue { id, characterId, characterName, text, action, mood }
 *   Version { id, label, createdAt, snapshot: full script JSON }
 *
 * 路由：
 *   GET    /script              → 剧本列表（精简）
 *   POST   /script              → 新建剧本
 *   GET    /script/:id          → 完整剧本（含角色/场次/镜头）
 *   PATCH  /script/:id          → 更新剧本元信息 + 整体保存
 *   DELETE /script/:id          → 删除剧本
 *
 *   POST   /script/:id/characters          → 新增角色
 *   PATCH  /script/:id/characters/:cid     → 更新角色
 *   DELETE /script/:id/characters/:cid     → 删除角色
 *
 *   POST   /script/:id/scenes              → 新增场次
 *   PATCH  /script/:id/scenes/:sid         → 更新场次
 *   DELETE /script/:id/scenes/:sid         → 删除场次
 *
 *   POST   /script/:id/scenes/:sid/shots           → 新增镜头
 *   PATCH  /script/:id/scenes/:sid/shots/:shotId   → 更新镜头
 *   DELETE /script/:id/scenes/:sid/shots/:shotId   → 删除镜头
 *
 *   POST   /script/:id/scenes/:sid/shots/:shotId/dialogues       → 新增对白
 *   PATCH  /script/:id/scenes/:sid/shots/:shotId/dialogues/:did  → 更新对白
 *   DELETE /script/:id/scenes/:sid/shots/:shotId/dialogues/:did  → 删除对白
 *
 *   POST   /script/:id/versions            → 创建版本快照
 *   GET    /script/:id/versions            → 版本列表
 *   GET    /script/:id/versions/:vid       → 读取某版本快照
 *   DELETE /script/:id/versions/:vid       → 删除版本
 *   POST   /script/:id/versions/:vid/restore → 恢复到该版本
 *
 *   GET    /script/:id/export?format=fountain|txt|md  → 导出
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');

// 使用 store 的原子写入 + 串行队列
const _w = store.writeJson;
const _r = store.readJson;
const _q = store.enqueue;

const router = express.Router();

const SCRIPTS_CAP = 500;

/* ============ 持久化（原子写入 + 串行队列） ============ */
const scriptsFile = path.join(store.dirs.root, 'scripts.json');
async function loadScripts() { return _r(scriptsFile, []); }
function saveScripts(list) { return _q(() => _w(scriptsFile, list)); }
function findScript(list, id) {
  return list.find((s) => s.id === id);
}
function uid() { return crypto.randomUUID(); }

function emptyCharacter() {
  return { id: uid(), name: '', role: '', gender: '—', age: '', avatar: '', description: '' };
}
function emptyScene() {
  return { id: uid(), number: 1, title: '场次标题', location: '', timeOfDay: '', description: '', shots: [], characters: [] };
}
function emptyShot() {
  return { id: uid(), number: 1, type: 'medium', duration: 3, description: '', dialogue: [], notes: '' };
}
function emptyDialogue() {
  return { id: uid(), characterId: '', characterName: '', text: '', action: '', mood: '' };
}

function emptyScript() {
  return {
    title: '未命名剧本',
    genre: '剧情',
    logline: '',
    outline: '',
    status: 'draft',
    characters: [],
    scenes: [],
    versions: [],
  };
}

const SHOT_TYPES = ['extreme-close-up', 'close-up', 'medium-close-up', 'medium', 'medium-wide', 'wide', 'extreme-wide', 'aerial', 'over-shoulder', 'two-shot', 'insert', 'tracking'];
const GENRES = ['剧情', '爱情', '悬疑', '科幻', '奇幻', '恐怖', '喜剧', '动作', '动画', '纪录片', '其他'];

/* ============ 剧本 CRUD ============ */

/** GET /script */
router.get('/script', wrap(async (req, res) => {
  const list = await loadScripts();
  const items = list.map((s) => ({
    id: s.id, title: s.title, genre: s.genre, logline: s.logline,
    status: s.status,
    characterCount: s.characters ? s.characters.length : 0,
    sceneCount: s.scenes ? s.scenes.length : 0,
    updatedAt: s.updatedAt, createdAt: s.createdAt,
  }));
  items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ items });
}));

/** POST /script */
router.post('/script', wrap(async (req, res) => {
  const body = req.body || {};
  const list = await loadScripts();
  const base = Object.assign(emptyScript(), body.script || {});
  if (body.title) base.title = String(body.title);
  if (body.genre) base.genre = String(body.genre);
  if (body.logline) base.logline = String(body.logline);

  const now = new Date().toISOString();
  const item = Object.assign({}, base, {
    id: uid(),
    characters: (base.characters || []).map((c) => Object.assign(emptyCharacter(), c, { id: c.id || uid() })),
    scenes: (base.scenes || []).map((sc) => Object.assign(emptyScene(), sc, {
      id: sc.id || uid(),
      shots: (sc.shots || []).map((sh) => Object.assign(emptyShot(), sh, {
        id: sh.id || uid(),
        dialogue: (sh.dialogue || []).map((d) => Object.assign(emptyDialogue(), d, { id: d.id || uid() })),
      })),
    })),
    versions: [],
    createdAt: now,
    updatedAt: now,
  });
  list.unshift(item);
  if (list.length > SCRIPTS_CAP) list.length = SCRIPTS_CAP;
  await saveScripts(list);
  res.json({ script: item });
}));

/** GET /script/:id */
router.get('/script/:id', wrap(async (req, res) => {
  const list = await loadScripts();
  const found = findScript(list, req.params.id);
  assert(found, 404, '剧本不存在', 'ID: ' + req.params.id);
  res.json({ script: found });
}));

/** PATCH /script/:id — 整体保存（前端传完整 script 对象） */
router.patch('/script/:id', wrap(async (req, res) => {
  const list = await loadScripts();
  const idx = list.findIndex((s) => s.id === req.params.id);
  assert(idx >= 0, 404, '剧本不存在', 'ID: ' + req.params.id);
  const body = req.body || {};
  const cur = list[idx];
  const script = body.script;
  if (script && typeof script === 'object') {
    // 整体保存
    list[idx] = Object.assign({}, cur, script, {
      id: cur.id,
      createdAt: cur.createdAt,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // 局部更新
    if (body.title !== undefined) cur.title = String(body.title);
    if (body.genre !== undefined) cur.genre = String(body.genre);
    if (body.logline !== undefined) cur.logline = String(body.logline);
    if (body.outline !== undefined) cur.outline = String(body.outline);
    if (body.status !== undefined) cur.status = String(body.status);
    cur.updatedAt = new Date().toISOString();
  }
  await saveScripts(list);
  res.json({ script: list[idx] });
}));

/** DELETE /script/:id */
router.delete('/script/:id', wrap(async (req, res) => {
  const list = await loadScripts();
  const idx = list.findIndex((s) => s.id === req.params.id);
  assert(idx >= 0, 404, '剧本不存在', 'ID: ' + req.params.id);
  list.splice(idx, 1);
  await saveScripts(list);
  res.json({ ok: true });
}));

/* ============ 角色 CRUD ============ */

/** POST /script/:id/characters */
router.post('/script/:id/characters', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const body = req.body || {};
  const c = Object.assign(emptyCharacter(), body, { id: uid() });
  s.characters = s.characters || [];
  s.characters.push(c);
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ character: c });
}));

/** PATCH /script/:id/characters/:cid */
router.patch('/script/:id/characters/:cid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const c = (s.characters || []).find((x) => x.id === req.params.cid);
  assert(c, 404, '角色不存在');
  Object.assign(c, req.body || {});
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ character: c });
}));

/** DELETE /script/:id/characters/:cid */
router.delete('/script/:id/characters/:cid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const idx = (s.characters || []).findIndex((x) => x.id === req.params.cid);
  assert(idx >= 0, 404, '角色不存在');
  s.characters.splice(idx, 1);
  // 清理场次中引用
  (s.scenes || []).forEach((sc) => {
    if (sc.characters) sc.characters = sc.characters.filter((c) => c !== req.params.cid);
    (sc.shots || []).forEach((sh) => {
      (sh.dialogue || []).forEach((d) => {
        if (d.characterId === req.params.cid) { d.characterId = ''; d.characterName = d.characterName + ' (已删除)'; }
      });
    });
  });
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ ok: true });
}));

/* ============ 场次 CRUD ============ */

/** POST /script/:id/scenes */
router.post('/script/:id/scenes', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const body = req.body || {};
  const scene = Object.assign(emptyScene(), body, { id: uid() });
  scene.number = (s.scenes && s.scenes.length > 0 ? s.scenes[s.scenes.length - 1].number + 1 : 1);
  s.scenes = s.scenes || [];
  s.scenes.push(scene);
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ scene });
}));

/** PATCH /script/:id/scenes/:sid */
router.patch('/script/:id/scenes/:sid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  Object.assign(sc, req.body || {});
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ scene: sc });
}));

/** DELETE /script/:id/scenes/:sid */
router.delete('/script/:id/scenes/:sid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const idx = (s.scenes || []).findIndex((x) => x.id === req.params.sid);
  assert(idx >= 0, 404, '场次不存在');
  s.scenes.splice(idx, 1);
  // 重新编号
  (s.scenes || []).forEach((sc, i) => { sc.number = i + 1; });
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ ok: true });
}));

/* ============ 镜头 CRUD ============ */

function findSceneShot(scene, shotId) {
  return (scene.shots || []).find((sh) => sh.id === shotId);
}

/** POST /script/:id/scenes/:sid/shots */
router.post('/script/:id/scenes/:sid/shots', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const body = req.body || {};
  const shot = Object.assign(emptyShot(), body, { id: uid() });
  shot.number = (sc.shots && sc.shots.length > 0 ? sc.shots[sc.shots.length - 1].number + 1 : 1);
  sc.shots = sc.shots || [];
  sc.shots.push(shot);
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ shot });
}));

/** PATCH /script/:id/scenes/:sid/shots/:shotId */
router.patch('/script/:id/scenes/:sid/shots/:shotId', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const sh = findSceneShot(sc, req.params.shotId);
  assert(sh, 404, '镜头不存在');
  Object.assign(sh, req.body || {});
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ shot: sh });
}));

/** DELETE /script/:id/scenes/:sid/shots/:shotId */
router.delete('/script/:id/scenes/:sid/shots/:shotId', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const idx = (sc.shots || []).findIndex((sh) => sh.id === req.params.shotId);
  assert(idx >= 0, 404, '镜头不存在');
  sc.shots.splice(idx, 1);
  (sc.shots || []).forEach((sh, i) => { sh.number = i + 1; });
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ ok: true });
}));

/* ============ 对白 CRUD ============ */

/** POST /script/:id/scenes/:sid/shots/:shotId/dialogues */
router.post('/script/:id/scenes/:sid/shots/:shotId/dialogues', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const sh = findSceneShot(sc, req.params.shotId);
  assert(sh, 404, '镜头不存在');
  const body = req.body || {};
  const d = Object.assign(emptyDialogue(), body, { id: uid() });
  sh.dialogue = sh.dialogue || [];
  sh.dialogue.push(d);
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ dialogue: d });
}));

/** PATCH /script/:id/scenes/:sid/shots/:shotId/dialogues/:did */
router.patch('/script/:id/scenes/:sid/shots/:shotId/dialogues/:did', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const sh = findSceneShot(sc, req.params.shotId);
  assert(sh, 404, '镜头不存在');
  const d = (sh.dialogue || []).find((x) => x.id === req.params.did);
  assert(d, 404, '对白不存在');
  Object.assign(d, req.body || {});
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ dialogue: d });
}));

/** DELETE /script/:id/scenes/:sid/shots/:shotId/dialogues/:did */
router.delete('/script/:id/scenes/:sid/shots/:shotId/dialogues/:did', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const sc = (s.scenes || []).find((x) => x.id === req.params.sid);
  assert(sc, 404, '场次不存在');
  const sh = findSceneShot(sc, req.params.shotId);
  assert(sh, 404, '镜头不存在');
  const idx = (sh.dialogue || []).findIndex((x) => x.id === req.params.did);
  assert(idx >= 0, 404, '对白不存在');
  sh.dialogue.splice(idx, 1);
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ ok: true });
}));

/* ============ 版本快照 ============ */

/** POST /script/:id/versions */
router.post('/script/:id/versions', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const body = req.body || {};
  const label = String(body.label || '快照 ' + new Date().toLocaleString('zh-CN'));
  const ver = {
    id: uid(),
    label,
    createdAt: new Date().toISOString(),
    snapshot: JSON.parse(JSON.stringify(s)), // 深拷贝
  };
  s.versions = s.versions || [];
  s.versions.unshift(ver);
  // 最多 20 个版本
  if (s.versions.length > 20) s.versions.length = 20;
  await saveScripts(list);
  res.json({ version: { id: ver.id, label: ver.label, createdAt: ver.createdAt } });
}));

/** GET /script/:id/versions */
router.get('/script/:id/versions', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const versions = (s.versions || []).map((v) => ({
    id: v.id, label: v.label, createdAt: v.createdAt,
    characterCount: v.snapshot && v.snapshot.characters ? v.snapshot.characters.length : 0,
    sceneCount: v.snapshot && v.snapshot.scenes ? v.snapshot.scenes.length : 0,
  }));
  res.json({ versions });
}));

/** GET /script/:id/versions/:vid */
router.get('/script/:id/versions/:vid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const v = (s.versions || []).find((x) => x.id === req.params.vid);
  assert(v, 404, '版本不存在');
  res.json({ version: v });
}));

/** DELETE /script/:id/versions/:vid */
router.delete('/script/:id/versions/:vid', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const idx = (s.versions || []).findIndex((x) => x.id === req.params.vid);
  assert(idx >= 0, 404, '版本不存在');
  s.versions.splice(idx, 1);
  await saveScripts(list);
  res.json({ ok: true });
}));

/** POST /script/:id/versions/:vid/restore */
router.post('/script/:id/versions/:vid/restore', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const v = (s.versions || []).find((x) => x.id === req.params.vid);
  assert(v, 404, '版本不存在');
  // 先保存当前为一个自动版本
  const autoVer = {
    id: uid(), label: '恢复前自动快照',
    createdAt: new Date().toISOString(),
    snapshot: JSON.parse(JSON.stringify(s)),
  };
  s.versions.unshift(autoVer);
  if (s.versions.length > 20) s.versions.length = 20;
  // 恢复
  const snapshot = v.snapshot;
  s.title = snapshot.title;
  s.genre = snapshot.genre;
  s.logline = snapshot.logline;
  s.outline = snapshot.outline;
  s.status = snapshot.status || 'draft';
  s.characters = snapshot.characters || [];
  s.scenes = snapshot.scenes || [];
  s.updatedAt = new Date().toISOString();
  await saveScripts(list);
  res.json({ script: s, restoredFrom: v.id });
}));

/* ============ 导出 ============ */

function exportFountain(script) {
  const lines = [];
  lines.push('Title: ' + (script.title || '未命名'));
  lines.push('Genre: ' + (script.genre || ''));
  lines.push('Logline: ' + (script.logline || ''));
  lines.push('');
  if (script.outline) {
    lines.push('== 大纲 ==');
    lines.push(script.outline);
    lines.push('');
  }
  if (script.characters && script.characters.length > 0) {
    lines.push('== 角色 ==');
    for (const c of script.characters) {
      lines.push((c.name || '?') + (c.role ? ' (' + c.role + ')' : ''));
      if (c.description) lines.push('    ' + c.description);
    }
    lines.push('');
  }
  for (const sc of (script.scenes || [])) {
    lines.push('');
    lines.push('.' + (sc.title || '场次 ' + sc.number));
    if (sc.location) lines.push('    场景: ' + sc.location + (sc.timeOfDay ? ' · ' + sc.timeOfDay : ''));
    if (sc.description) lines.push('    ' + sc.description);
    for (const sh of (sc.shots || [])) {
      lines.push('');
      lines.push('[' + (sh.type || 'shot') + ' #' + sh.number + (sh.duration ? ' | ' + sh.duration + 's' : '') + ']');
      if (sh.description) lines.push('    ' + sh.description);
      for (const d of (sh.dialogue || [])) {
        if (d.action) lines.push('    (' + d.action + ')');
        lines.push((d.characterName || '?').toUpperCase());
        lines.push('    ' + (d.text || ''));
      }
      if (sh.notes) lines.push('    — ' + sh.notes);
    }
  }
  return lines.join('\n');
}

function exportMarkdown(script) {
  const md = [];
  md.push('# ' + (script.title || '未命名剧本'));
  md.push('');
  md.push('> 类型: ' + (script.genre || '—') + ' | 状态: ' + (script.status || 'draft'));
  md.push('');
  if (script.logline) {
    md.push('## 一句话梗概');
    md.push('');
    md.push(script.logline);
    md.push('');
  }
  if (script.outline) {
    md.push('## 大纲');
    md.push('');
    md.push(script.outline);
    md.push('');
  }
  if (script.characters && script.characters.length > 0) {
    md.push('## 角色表');
    md.push('');
    md.push('| # | 角色 | 定位 | 性别 | 年龄 | 描述 |');
    md.push('|---|------|------|------|------|------|');
    script.characters.forEach((c, i) => {
      md.push('| ' + (i + 1) + ' | ' + (c.name || '') + ' | ' + (c.role || '') + ' | ' + (c.gender || '') + ' | ' + (c.age || '') + ' | ' + (c.description || '') + ' |');
    });
    md.push('');
  }
  for (const sc of (script.scenes || [])) {
    md.push('## ' + sc.number + '. ' + (sc.title || '未命名场次'));
    md.push('');
    if (sc.location) md.push('**场景**: ' + sc.location + (sc.timeOfDay ? ' · ' + sc.timeOfDay : ''));
    if (sc.description) { md.push(''); md.push(sc.description); }
    md.push('');
    for (const sh of (sc.shots || [])) {
      md.push('### 镜头 ' + sh.number + ' — ' + (sh.type || ''));
      if (sh.duration) md.push('_时长: ' + sh.duration + '秒_');
      if (sh.description) { md.push(''); md.push(sh.description); }
      for (const d of (sh.dialogue || [])) {
        md.push('');
        if (d.action) md.push('*(' + d.action + ')*');
        md.push('**' + (d.characterName || '?') + '**: ' + (d.text || ''));
      }
      if (sh.notes) { md.push(''); md.push('_备注: ' + sh.notes + '_'); }
      md.push('');
    }
  }
  return md.join('\n');
}

/** GET /script/:id/export?format=fountain|md|txt */
router.get('/script/:id/export', wrap(async (req, res) => {
  const list = await loadScripts();
  const s = findScript(list, req.params.id);
  assert(s, 404, '剧本不存在');
  const fmt = String(req.query.format || 'fountain').toLowerCase();
  let body, mime, ext;
  if (fmt === 'md') { body = exportMarkdown(s); mime = 'text/markdown; charset=utf-8'; ext = 'md'; }
  else if (fmt === 'txt') { body = exportFountain(s); mime = 'text/plain; charset=utf-8'; ext = 'txt'; }
  else { body = exportFountain(s); mime = 'text/plain; charset=utf-8'; ext = 'fountain'; }
  const fname = encodeURIComponent((s.title || 'script') + '.' + ext);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'attachment; filename="script.' + ext + '"; filename*=UTF-8\'\'' + fname);
  res.send(body);
}));

module.exports = router;
