'use strict';

/**
 * 美术设定设计 路由
 *
 * 参考日本动画现场标准：
 *   二、美术监督（美術監督）负责的 8 项交付清单
 *   三、并行独立大设定板块（角色/生物/道具/机甲/特效/服装/纹章/LOGO/宣传）
 *   四、配套协同资料（色彩设计 / 设定会审检查表）
 *
 * 分类常量：
 *   CATEGORIES = {
 *     sekai:    '世界观氛围资料',     // イメージボード + 世界観美術テキスト
 *     bg:       '背景设定',           // 平面图 / 立面图 / 透视基准线稿 / 场景版本区分
 *     prop:     '道具设定',           // プロップ設定 + 固定设施 + 载具 + 自然物 + 材质光照
 *     effect:   '作画特效设定',       // 角色招式特效（与环境特效区分）
 *     visual:   '宣传视觉设定',       // 主视觉 / PV 关键图 / 宣发立绘
 *     logo:     '文字标识设定',       // 标题 LOGO / 纹章 / 组织标识 / 色彩管理
 *   }
 *
 * 条目模型 ArtBoard：
 *   {
 *     id, projectId, category,        // 归属
 *     title, subtitle,                 // 主标题 + 日文原名（可选）
 *     section,                         // 属于哪个交付子节（如"环境器物平面图形"）
 *     tags: string[],                  // 标签：朝/昼/夕/夜/雨/霧/雪 等
 *     status: 'draft' | 'wip' | 'review' | 'final',
 *     version: 'Ver1.0',
 *     spec: {                          // 技术规格
 *       type: 'lineart' | 'painting' | 'model' | 'color' | 'layout' | 'doc',
 *       format: 'psd' | 'ai' | 'png' | 'pdf',
 *       resolution: '1920x1080',
 *       layers: [],
 *     },
 *     media: {                         // 关联媒体（URL / uploadId）
 *       thumb: '',
 *       sources: [],                  // 多版本（初稿/改修/定稿）
 *     },
 *     content: string,                 // 文字说明 / 规格书文本
 *     notes: string,                   // 审图备注 / 变更记录
 *     colorSpec: {                     // 色卡（可选）
 *       palette: [{ name, hex, role }],
 *       shadows: [{ name, hex }],
 *       highlights: [{ name, hex }],
 *     },
 *     createdAt, updatedAt,
 *   }
 *
 * 路由：
 *   GET    /art                                    → 条目列表（可按 category 过滤）
 *   POST   /art                                    → 新建条目
 *   GET    /art/:id                                → 读取完整条目
 *   PATCH  /art/:id                                → 更新
 *   DELETE /art/:id                                → 删除
 *   POST   /art/:id/upload                         → 上传关联媒体（multipart 或 dataUrl）
 *   GET    /art/categories                         → 分类字典（给前端下拉用）
 *   GET    /art/checklist                          → 设定会审检查表（SOP 模板）
 *   POST   /art/checklist                          → 保存会审检查表状态
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { wrap, assert, dataUrlToBuffer, extFromMime, randomToken } = require('../http');
const store = require('../store');

const MAX_ART_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB

// 使用 store 的原子写入 + 串行队列，保证并发安全和数据不损坏
const writeJson = store.writeJson;
const readJson = store.readJson;
const enqueue = store.enqueue;

const router = express.Router();

const ARTS_CAP = 1000;

const CATEGORIES = [
  { key: 'sekai',  name: '世界观氛围资料',     icon: '🌍', sections: [
    '氛围概念稿',
    '世界观美术规范书',
    '参考拼贴板（光影参考 / 色调 mood board）',
  ]},
  { key: 'bg',     name: '背景设定',           icon: '🏞️', sections: [
    '平面配置图',
    '立面图 / 剖视图',
    '透视基准线稿',
    '场景版本区分（朝 / 昼 / 夕 / 夜 / 雨 / 雾 / 雪）',
    '背景样板彩稿',
  ]},
  { key: 'prop',   name: '道具 / 器物设定',    icon: '🎒', sections: [
    '环境小物设定（固定陈设三视图）',
    '平面图形 / 屏幕图形设定（屏幕 UI / 架空文字 / 路牌）',
    '大型设施 · 装置设定（工厂设备 / 闸门 / 管线）',
    '常驻载具设定（停泊船只 / 静置飞行器）',
    '自然物设定（树种 / 花草 / 岩石 / 云 / 浪花）',
    '材质设定（木材 / 石材 / 金属 / 玻璃 反光规则）',
    '光环境设定（全域光源色温 / 阴影衰减）',
  ]},
  { key: 'effect', name: '作画特效设定',       icon: '✨', sections: [
    '特效关键帧序列稿（起形→扩散→消散）',
    '色阶渐变规范',
    '轨迹 · 残像规则',
    '大中小倍率版本规范（近景特写 / 远景广角）',
  ]},
  { key: 'visual', name: '宣传视觉设定',       icon: '🎨', sections: [
    '主视觉海报',
    'PV 关键图',
    '宣发用角色立绘',
    '世界观概念主视觉',
  ]},
  { key: 'logo',   name: '文字标识设定',       icon: '🔤', sections: [
    '标题 LOGO（作品 Logo / OP·ED 标题字）',
    '纹章 · 组织标识（家族纹章 / 徽章）',
    '章节标题字体',
    '色彩设计（全片色彩偏移规则表）',
    '设定会审检查表',
  ]},
];

const STATUS_OPTIONS = [
  { value: 'draft',  label: '草稿' },
  { value: 'wip',    label: '制作中' },
  { value: 'review', label: '审图中' },
  { value: 'final',  label: '定稿' },
];

const ART_TYPES = [
  { value: 'lineart', label: '线稿' },
  { value: 'painting', label: '彩稿' },
  { value: 'model', label: '设定三视图' },
  { value: 'color', label: '色卡' },
  { value: 'layout', label: 'Layout' },
  { value: 'doc', label: '文档' },
];

/* ============ 持久化 ============ */
const artsFile = path.join(store.dirs.root, 'artboards.json');
const checklistFile = path.join(store.dirs.root, 'art-checklist.json');

async function loadArts() {
  return readJson(artsFile, []);
}
function saveArts(list) {
  // 使用 store 的原子写入（先写 .tmp 再 rename）+ 串行队列（避免并发覆盖）
  return enqueue(() => writeJson(artsFile, list));
}
async function loadChecklist() {
  const raw = await readJson(checklistFile, null);
  if (!raw) return Object.assign({}, DEFAULT_CHECKLIST, { items: {} });
  // 合并默认字段，防止老数据缺字段
  return Object.assign({}, DEFAULT_CHECKLIST, raw, {
    items: raw.items || {},
  });
}
function saveChecklist(data) {
  data.updatedAt = new Date().toISOString();
  return enqueue(() => writeJson(checklistFile, data));
}

function uid() { return crypto.randomUUID(); }

function emptyBoard() {
  return {
    title: '', subtitle: '',
    category: 'bg', section: '',
    tags: [],
    status: 'draft', version: 'Ver1.0',
    spec: { type: 'painting', format: 'psd', resolution: '', layers: [] },
    media: { thumb: '', sources: [] },
    content: '', notes: '',
    colorSpec: { palette: [], shadows: [], highlights: [] },
  };
}

/* ============ 图片上传 ============ */
router.post('/art/upload', wrap(async (req, res) => {
  const body = req.body || {};
  assert(
    typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:'),
    400, '缺少文件数据', 'dataUrl 需为 data:<mime>;base64,... 形式',
  );
  const decoded = dataUrlToBuffer(body.dataUrl);
  assert(decoded.buffer.length > 0, 400, '文件内容为空', '请重新选择文件');
  assert(decoded.buffer.length <= MAX_ART_MEDIA_BYTES, 413, '文件过大',
    `单个文件不能超过 ${Math.round(MAX_ART_MEDIA_BYTES / 1024 / 1024)}MB`);
  const mime = decoded.mime || 'image/png';
  assert(mime.startsWith('image/'), 400, '仅支持图片', `收到 MIME: ${mime}`);
  const ext = extFromMime(mime) || 'png';
  const fileName = `art-${Date.now()}-${randomToken()}.${ext}`;
  // 存到 assets 目录（已挂载 /uploads/assets 静态代理）
  await fsp.writeFile(path.join(store.dirs.assets, fileName), decoded.buffer);
  res.json({
    url: `/uploads/assets/${fileName}`,
    mime,
    size: decoded.buffer.length,
    ext,
  });
}));

/* ============ 分类字典 ============ */
router.get('/art/categories', wrap(async (req, res) => {
  res.json({ categories: CATEGORIES, statusOptions: STATUS_OPTIONS, artTypes: ART_TYPES });
}));

/* ============ 会审检查表（SOP 模板） ============ */
const DEFAULT_CHECKLIST = {
  version: 'Ver1.0', updatedAt: null,
  // 美术监督
  sekai_board: [
    '氛围概念稿情绪彩稿（3–8 张）',
    '世界观美术规范书（时代/地域/气候/建筑规则/禁忌元素）',
    '昼夜变化规则文档',
  ],
  bg_board: [
    '场景平面图',
    '立面图 / 剖视图',
    '透视基准线稿',
    '同场景多空间分区标注',
    '场景版本区分表（朝/昼/夕/夜/雨/雾/雪）',
    '常用场景各光照版本背景样板彩稿',
    '标注主光源方向 / 阴影软硬 / 空气透视',
  ],
  prop_board: [
    '环境小物固定陈设三视图',
    '平面图形 / 屏幕图形设定（路牌/架空文字/屏幕 UI）',
    '大型设施 / 装置剖视图',
    '常驻载具设定',
    '自然物规范稿（树种/花草/岩石/云/浪花）',
    '材质设定（木材/石材/金属/玻璃 反光规则）',
    '光环境设定（色温/阴影衰减/反光反弹）',
  ],
  // 并行板块
  character_board: [
    '人设三视图（正面/侧面/背面）',
    '身高对比图',
    '表情集（喜/怒/哀/惧/吃惊/冷漠）',
    '口型集（A/I/U/E/O）',
    '基础姿势集',
    '服装分解图 / 配饰拆分图',
    '角色色指定（基础色/阴影色/高光色卡）',
  ],
  creature_board: [
    '生物三视图 / 骨骼参考',
    '体表纹理 / 斑纹 / 角质细节',
    '变形阶段稿',
    '关节活动范围标注',
    '生物色指定',
  ],
  mecha_board: [
    '外装三视图',
    '内部剖视图',
    '关节可动范围',
    '武装挂载 / 变形机构示意图',
    '装甲磨损 / 战损版本',
    '机设色指定',
  ],
  effect_board: [
    '特效关键帧序列稿（起形→扩散→消散）',
    '色阶渐变规范',
    '轨迹 / 残像规则',
    '大中小倍率版本规范',
  ],
  visual_board: [
    '主视觉海报',
    'PV 关键图',
    '宣发用角色立绘',
  ],
  logo_board: [
    '作品 Logo',
    'OP/ED 标题字',
    '章节标题字体',
    '纹章 / 组织标识（矢量，多种尺寸适配）',
  ],
  coordination: [
    '色彩设计：全片色彩偏移规则表（黄昏/夜景/水下/阴影）',
    '背景原图基准规范书（Layout 对接背景画师规范）',
    '实地采风资料（采风照片 / 建筑测绘）',
  ],
};

/* 注意：loadChecklist / saveChecklist 已移至上方「持久化」模块，
 * 使用 store.writeJson 原子写入 + enqueue 串行化，保证并发安全 */

router.get('/art/checklist', wrap(async (req, res) => {
  const data = await loadChecklist();
  res.json({ checklist: data });
}));

router.post('/art/checklist', wrap(async (req, res) => {
  const body = req.body || {};
  const cur = await loadChecklist();
  if (body.items) cur.items = Object.assign({}, cur.items, body.items);
  if (body.notes !== undefined) cur.notes = String(body.notes);
  await saveChecklist(cur);
  res.json({ checklist: cur });
}));

/* ============ ArtBoard CRUD ============ */

function mask(art) {
  return Object.assign({}, art);
}

router.get('/art', wrap(async (req, res) => {
  const list = await loadArts();
  const category = req.query.category;
  let items = list;
  if (category && category !== 'all') items = items.filter((a) => a.category === category);
  // 精简返回（不传超大媒体字段）
  const compact = items.map((a) => ({
    id: a.id, title: a.title, subtitle: a.subtitle,
    category: a.category, section: a.section, tags: a.tags,
    status: a.status, version: a.version,
    media: { thumb: a.media ? a.media.thumb : '', sourceCount: a.media ? (a.media.sources || []).length : 0 },
    spec: a.spec ? { type: a.spec.type, format: a.spec.format } : {},
    contentLen: (a.content || '').length,
    colorCount: (a.colorSpec && a.colorSpec.palette ? a.colorSpec.palette.length : 0),
    updatedAt: a.updatedAt, createdAt: a.createdAt,
  }));
  compact.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ items: compact, total: compact.length });
}));

router.post('/art', wrap(async (req, res) => {
  const body = req.body || {};
  const list = await loadArts();
  const now = new Date().toISOString();
  const item = Object.assign({}, emptyBoard(), body, {
    id: uid(),
    tags: Array.isArray(body.tags) ? body.tags : [],
    spec: Object.assign({}, emptyBoard().spec, body.spec || {}),
    media: Object.assign({}, emptyBoard().media, body.media || {}),
    colorSpec: Object.assign({}, emptyBoard().colorSpec, body.colorSpec || {}),
    createdAt: now, updatedAt: now,
  });
  list.unshift(item);
  if (list.length > ARTS_CAP) list.length = ARTS_CAP;
  await saveArts(list);
  res.json({ art: mask(item) });
}));

router.get('/art/:id', wrap(async (req, res) => {
  const list = await loadArts();
  const found = list.find((a) => a.id === req.params.id);
  assert(found, 404, '美术条目不存在');
  res.json({ art: found });
}));

router.patch('/art/:id', wrap(async (req, res) => {
  const list = await loadArts();
  const idx = list.findIndex((a) => a.id === req.params.id);
  assert(idx >= 0, 404, '美术条目不存在');
  const body = req.body || {};
  list[idx] = Object.assign({}, list[idx], body, {
    id: list[idx].id, createdAt: list[idx].createdAt,
    updatedAt: new Date().toISOString(),
    tags: Array.isArray(body.tags) ? body.tags : list[idx].tags,
    spec: body.spec ? Object.assign({}, list[idx].spec, body.spec) : list[idx].spec,
    media: body.media ? Object.assign({}, list[idx].media, body.media) : list[idx].media,
    colorSpec: body.colorSpec ? Object.assign({}, list[idx].colorSpec, body.colorSpec) : list[idx].colorSpec,
  });
  await saveArts(list);
  res.json({ art: mask(list[idx]) });
}));

router.delete('/art/:id', wrap(async (req, res) => {
  const list = await loadArts();
  const idx = list.findIndex((a) => a.id === req.params.id);
  assert(idx >= 0, 404, '美术条目不存在');
  list.splice(idx, 1);
  await saveArts(list);
  res.json({ ok: true });
}));

/* ============ 复制 ============ */
router.post('/art/:id/duplicate', wrap(async (req, res) => {
  const list = await loadArts();
  const src = list.find((a) => a.id === req.params.id);
  assert(src, 404, '美术条目不存在');
  const now = new Date().toISOString();
  const copy = Object.assign({}, src, {
    id: uid(),
    title: (src.title || '') + ' (副本)',
    createdAt: now, updatedAt: now,
    media: Object.assign({}, src.media, { sources: [] }), // 媒体不复制，避免重复存储
  });
  list.unshift(copy);
  await saveArts(list);
  res.json({ art: mask(copy) });
}));

/* ============ 批量状态更新 ============ */
router.post('/art/bulk-status', wrap(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const status = String(body.status || 'review');
  if (!ids.length) return res.json({ ok: true, count: 0 });
  const list = await loadArts();
  const now = new Date().toISOString();
  let count = 0;
  ids.forEach((id) => {
    const a = list.find((x) => x.id === id);
    if (a) { a.status = status; a.updatedAt = now; count++; }
  });
  await saveArts(list);
  res.json({ ok: true, count });
}));

module.exports = router;
