/**
 * animation.js —— 动画模块
 * 功能：中间帧（Tween）管理 / 生成 / 帧编辑 / 序列导出
 * 和原画 oua.js 的 second team 区分：
 *   oua 侧重「设计」（镜头 / K帧时间轴 / 中割り数量定义）
 *   animation 侧重「执行」（真正要画哪些中间帧 / 帧号 / 节奏 / 序列）
 */
const { Router } = require('express');
const path = require('path');
const crypto = require('crypto');
/* 原来从 ../http 解构 readJson/writeJson/enqueue/uid/httpError/mediaUrlFor，
   但这些函数并不在 http.js 里导出，GET /api/animation 首次读文件就 500。
   改为复用 store 的读写/串行队列（与 oua / art / plan / script 一致）；
   httpError 本来就不存在，用 jsonError 等价替代。 */
const { jsonError: httpError, extFromMime, dataUrlToBuffer } = require('../http');
const store = require('../store');
const mediaStore = require('../media-store');

const readJson = store.readJson;
const writeJson = store.writeJson;
const enqueue = store.enqueue;

function uid() { return crypto.randomUUID(); }

const router = Router();
/* 写入运行时可写目录（SCF 下为 /tmp/runtime），不能写只读的代码目录 server/data */
const ANIM_DIR = store.dirs.root;
const animFile = () => path.join(ANIM_DIR, 'animations.json');
const ANIM_CAP = 1000;

function defaultTween(prevK = '', nextK = '') {
  return {
    id: uid(),
    prevKey: prevK,         // 前一个关键帧标识（shotNo-K-12 或 图片URL）
    nextKey: nextK,         // 后一个关键帧标识
    tweenIndex: 1,          // 本中间帧在 K 帧 A-B 之间的序号
    totalBetween: 2,        // A-B 之间总共几帧中割
    frameNum: 0,            // 实际输出帧号
    second: 0,              // 在镜头时间轴上的秒数
    timing: 'linear',       // linear / ease-in / ease-out / ease-in-out / 自定义曲线
    url: '',                // 图片 URL（画好的）
    poseRef: '',            // Pose 参考图 URL
    drawingRef: '',         // Layout 对接 / 原画参考 URL
    motionRef: '',          // 运动轨迹参考
    note: '',
    status: 'todo',         // todo / wip / review / final
    issue: '',              // 问题（形状守恒/运动轨迹）
  };
}

function defaultSequence() {
  return {
    id: uid(),
    name: '',
    shotNo: '',                  // 关联原画镜号
    sceneRef: '',
    frameRate: 24,
    frameCount: 0,               // 总帧数（包括 K 帧 + 中割）
    startTime: '0:00.0',
    endTime: '0:00.0',
    kfList: [],                  // [{ key, frame, second, url, pose }]
    tweens: [],                  // defaultTween[]
    timingCurves: {},            // { 'A-B': [{x,y}] } 自定义曲线
    notes: '',
    tags: [],
    status: 'todo',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

let cache = null;
async function load() {
  if (cache) return cache;
  try { cache = await readJson(animFile()); }
  catch (e) { cache = []; await writeJson(animFile(), cache); }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}
async function save() {
  const list = cache || [];
  await enqueue(() => writeJson(animFile(), list));
}

/* ============ 辅助 ============ */
function deepMergeSeq(base, patch) {
  const merged = Object.assign({}, base, patch, {
    kfList: Array.isArray(patch.kfList) ? patch.kfList : (base.kfList || []),
    tweens: Array.isArray(patch.tweens) ? patch.tweens : (base.tweens || []),
    timingCurves: Object.assign({}, base.timingCurves || {}, patch.timingCurves || {}),
    tags: Array.isArray(patch.tags) ? patch.tags : (base.tags || []),
    updatedAt: Date.now(),
  });
  return merged;
}

/* ============ Routes ============ */

// 字典
router.get('/dict', (req, res) => {
  res.json({
    statuses: ['todo', 'wip', 'review', 'final'],
    timings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'custom'],
    frameRates: [12, 15, 24, 30, 60],
  });
});

// 列表（支持筛选）
router.get('/', async (req, res, next) => {
  try {
    const { shotNo, keyword, status } = req.query;
    let list = await load();
    if (shotNo) list = list.filter(s => (s.shotNo || '').includes(shotNo));
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(kw) ||
        (s.shotNo || '').toLowerCase().includes(kw) ||
        (s.notes || '').toLowerCase().includes(kw) ||
        (s.tags || []).some(t => t.toLowerCase().includes(kw))
      );
    }
    if (status) list = list.filter(s => s.status === status);
    list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    res.json({ items: list, total: list.length });
  } catch (e) { next(e); }
});

// 详情
router.get('/:id', async (req, res, next) => {
  try {
    const list = await load();
    const s = list.find(x => x.id === req.params.id);
    if (!s) throw httpError(404, 'Sequence not found');
    res.json({ sequence: s });
  } catch (e) { next(e); }
});

// 新建
router.post('/', async (req, res, next) => {
  try {
    const list = await load();
    if (list.length >= ANIM_CAP) throw httpError(400, '已达上限 ' + ANIM_CAP + ' 条');
    const base = defaultSequence();
    const merged = deepMergeSeq(base, req.body || {});
    if (!merged.name) merged.name = '序列 ' + (list.length + 1);
    list.unshift(merged);
    cache = list;
    await save();
    res.json({ sequence: merged });
  } catch (e) { next(e); }
});

// 更新（deep merge）
router.patch('/:id', async (req, res, next) => {
  try {
    const list = await load();
    const idx = list.findIndex(x => x.id === req.params.id);
    if (idx < 0) throw httpError(404, 'not found');
    const merged = deepMergeSeq(list[idx], req.body || {});
    list[idx] = merged;
    cache = list;
    await save();
    res.json({ sequence: merged });
  } catch (e) { next(e); }
});

// 删除
router.delete('/:id', async (req, res, next) => {
  try {
    const list = await load();
    const idx = list.findIndex(x => x.id === req.params.id);
    if (idx < 0) throw httpError(404, 'not found');
    const [removed] = list.splice(idx, 1);
    cache = list;
    await save();
    res.json({ removed: 1 });
  } catch (e) { next(e); }
});

// 复制
router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const list = await load();
    const src = list.find(x => x.id === req.params.id);
    if (!src) throw httpError(404, 'not found');
    if (list.length >= ANIM_CAP) throw httpError(400, '已达上限');
    const copy = Object.assign({}, src, {
      id: uid(),
      name: (src.name || '') + ' (副本)',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kfList: (src.kfList || []).map(k => Object.assign({}, k)),
      tweens: (src.tweens || []).map(t => Object.assign({}, t, { id: uid() })),
      timingCurves: Object.assign({}, src.timingCurves || {}),
      tags: (src.tags || []).slice(),
    });
    list.unshift(copy);
    cache = list;
    await save();
    res.json({ sequence: copy });
  } catch (e) { next(e); }
});

// 批量
router.post('/bulk', async (req, res, next) => {
  try {
    const list = await load();
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!items.length) throw httpError(400, 'items 为空');
    let inserted = 0, skipped = 0;
    const out = [];
    for (const raw of items.slice(0, 500)) {
      if (list.length >= ANIM_CAP) { skipped++; continue; }
      const merged = deepMergeSeq(defaultSequence(), raw || {});
      if (!merged.name) merged.name = '序列 ' + (list.length + 1);
      list.unshift(merged);
      inserted++;
      out.push({ id: merged.id, name: merged.name, shotNo: merged.shotNo });
    }
    cache = list;
    await save();
    res.json({ inserted, skipped, items: out });
  } catch (e) { next(e); }
});

/* ============ K帧 & 中间帧 子路由 ============ */

// 新增 K 帧
router.post('/:id/kf', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    seq.kfList = seq.kfList || [];
    const kf = Object.assign({ id: uid(), frame: 0, second: 0, pose: '', url: '', note: '' }, req.body || {});
    seq.kfList.push(kf);
    seq.kfList.sort((a, b) => (a.frame || 0) - (b.frame || 0));
    seq.updatedAt = Date.now();
    cache = list; await save();
    res.json({ kf });
  } catch (e) { next(e); }
});

// 新增中间帧（可选批量）
router.post('/:id/tween', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    seq.tweens = seq.tweens || [];
    const body = req.body || {};
    let items;
    if (Array.isArray(body.batch)) {
      items = body.batch.map(t => Object.assign(defaultTween(t.prevKey, t.nextKey), t, { id: uid() }));
    } else {
      items = [Object.assign(defaultTween(body.prevKey, body.nextKey), body, { id: uid() })];
    }
    seq.tweens.push(...items);
    seq.updatedAt = Date.now();
    cache = list; await save();
    res.json({ items });
  } catch (e) { next(e); }
});

// 自动生成一组中割帧（指定两个 K 帧 + 数量 + 节奏）
router.post('/:id/generate', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    const { prevKIdx, nextKIdx, count = 2, timing = 'linear', startingAt = 'next' } = req.body || {};
    const kfs = seq.kfList || [];
    const prev = kfs[Number(prevKIdx)];
    const next = kfs[Number(nextKIdx)];
    if (!prev || !next) throw httpError(400, 'K 帧索引无效');
    if (next.frame <= prev.frame) throw httpError(400, 'next 帧号必须大于 prev');
    const gapFrames = next.frame - prev.frame;
    const gapSeconds = next.second - prev.second;
    const items = [];
    const insertAt = startingAt === 'start' ? 0 : seq.tweens.length;
    for (let i = 1; i <= count; i++) {
      const t = count === 1 ? 0.5 : i / (count + 1);
      const eased = applyEasing(t, timing);
      const frameNum = Math.round(prev.frame + eased * gapFrames);
      const second = +(prev.second + eased * gapSeconds).toFixed(2);
      items.push(Object.assign(defaultTween(prev.id, next.id), {
        tweenIndex: i, totalBetween: count,
        frameNum, second, timing,
      }));
    }
    seq.tweens.splice(insertAt, 0, ...items);
    seq.updatedAt = Date.now();
    cache = list; await save();
    res.json({ items, gapFrames, gapSeconds });
  } catch (e) { next(e); }
});

function applyEasing(t, kind) {
  switch (kind) {
    case 'ease-in': return t * t;
    case 'ease-out': return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default: return t;
  }
}

// 删除 tween
router.delete('/:id/tween/:tweenId', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    const before = (seq.tweens || []).length;
    seq.tweens = (seq.tweens || []).filter(t => t.id !== req.params.tweenId);
    const after = seq.tweens.length;
    seq.updatedAt = Date.now();
    cache = list; await save();
    res.json({ removed: before - after });
  } catch (e) { next(e); }
});

// 批量更新 tween 状态
router.post('/:id/tween-bulk-status', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    const { ids = [], status = 'todo' } = req.body || {};
    const s = new Set(ids);
    (seq.tweens || []).forEach(t => { if (s.has(t.id)) t.status = status; });
    seq.updatedAt = Date.now();
    cache = list; await save();
    res.json({ updated: ids.length });
  } catch (e) { next(e); }
});

/* ============ 图片上传（复用 art.js 的上传目录） ============ */
const MAX_BYTES = 50 * 1024 * 1024;

router.post('/upload', (req, res, next) => {
  Promise.resolve()
    .then(() => {
      const dataUrl = (req.body || {}).dataUrl;
      if (!dataUrl || typeof dataUrl !== 'string') throw httpError(400, '缺少 dataUrl');
      if (dataUrl.length > MAX_BYTES * 2) throw httpError(413, '图片太大（上限 50MB）');
      const m = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (!m) throw httpError(400, 'dataUrl 格式错误');
      const mime = m[1];
      const buf = dataUrlToBuffer(dataUrl).buffer;
      if (!mime.startsWith('image/')) throw httpError(400, '仅支持图片 MIME');
      const ext = extFromMime(mime);
      const name = 'anim-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      /* 统一写对象存储（未配置时由 objectStore 回落本地盘），URL 形状不变 */
      return mediaStore.put('assets', name, buf, mime).then((saved) => ({
        url: saved.url, mime, size: buf.length, ext,
      }));
    })
    .then(r => res.json(r))
    .catch(e => next(e));
});

/* ============ 导出（序列 JSON / CSV 帧表） ============ */
router.get('/export/:id', async (req, res, next) => {
  try {
    const list = await load();
    const seq = list.find(x => x.id === req.params.id);
    if (!seq) throw httpError(404, 'not found');
    const format = (req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      const rows = [];
      const kfs = (seq.kfList || []).map(k => Object.assign({}, k, { _kind: 'K' }));
      const tns = (seq.tweens || []).map(t => Object.assign({}, t, { _kind: 'T' }));
      rows.push(...kfs, ...tns);
      rows.sort((a, b) => (a.frame || 0) - (b.frame || 0));
      const header = '序号,类型,帧号,秒数,名称/索引,节奏,图片,姿势参考,问题,备注';
      const body = rows.map((r, i) => [
        i + 1, r._kind, r.frameNum != null ? r.frameNum : r.frame,
        r.second, r._kind === 'K' ? (r.pose || r.id) : (r.tweenIndex ? ('Tween-' + r.tweenIndex) : r.id),
        r.timing || '', r.url || '', r.poseRef || '', r.issue || '', r.note || '',
      ].map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const csv = '\ufeff' + header + '\n' + body + '\n';
      const safeName = (seq.name || 'sequence').replace(/[\\/:*?"<>|]/g, '_');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="' + safeName + '-frames.csv"');
      res.send(csv);
    } else {
      res.set('Content-Type', 'application/json');
      const safeName = (seq.name || 'sequence').replace(/[\\/:*?"<>|]/g, '_');
      res.set('Content-Disposition', 'attachment; filename="' + safeName + '.json"');
      res.json(seq);
    }
  } catch (e) { next(e); }
});

module.exports = router;
