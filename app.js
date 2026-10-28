'use strict';

/* =============================================================
 * 绘梦 · AI 动漫创作平台
 * 生图引擎：Hugging Face Space / FLUX.1（免费、无水印）
 * 提示词翻译：Pollinations 免费文本接口
 * ============================================================= */

/* 免费生图通道，按顺序尝试；第一个不可用时自动切换备用 */
const ENGINES = [
  {
    id: 'flux-merged',
    label: 'FLUX.1',
    api: 'https://multimodalart-flux-1-merged.hf.space/gradio_api/call/infer',
    payload: function (job, prompt) {
      return [prompt, job.seed, false, job.width, job.height, 3.5, job.steps];
    }
  },
  {
    id: 'flux-schnell',
    label: 'FLUX.1',
    api: 'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer',
    payload: function (job, prompt) {
      return [prompt, job.seed, false, job.width, job.height, job.steps];
    }
  }
];

/* RayinAPI 接入（GPT-image / Nano Banana） */
const RAYIN_DEFAULT = {
  base: 'https://www.rayinai.com/v1',
  key: '',
  gptModel: 'gpt-image-2',
  bananaModel: 'nano-banana'
};

const ENGINE_META = {
  flux: { label: 'FLUX.1', pill: 'FLUX.1 · 免费', hint: '免费 · 约 10 秒', meta: 'FLUX.1', free: true },
  'gpt-image': { label: 'GPT-image', pill: 'GPT-image · RayinAPI', hint: 'RayinAPI · 按量计费', meta: 'GPT-image', free: false },
  banana: { label: 'Nano Banana', pill: 'Nano Banana · RayinAPI', hint: 'RayinAPI · 按量计费', meta: 'Nano Banana', free: false }
};

const TRANSLATE_API = 'https://text.pollinations.ai/';
/* 免费额度用尽时的兜底通道（图片带水印，仅在主通道不可用时使用） */
const FALLBACK_API = 'https://image.pollinations.ai/prompt/';

const LS_WORKS = 'anidream.works.v1';
const LS_PREFS = 'anidream.prefs.v1';
const LS_API = 'anidream.rayin.v1';
const MAX_WORKS = 48;

/* ---------------- 风格模型分组 ---------------- */
const GROUPS = [
  {
    id: 'anime',
    name: '二次元动漫',
    en: 'ANIME',
    color1: '#8b5cf6',
    color2: '#ec4899',
    models: [
      {
        id: 'hoshino',
        name: '星野动漫',
        glyph: '星',
        tag: '赛璐璐 · 番剧质感',
        example: '银发少女站在樱花树下，水手服，花瓣飞舞，日系赛璐璐，柔和逆光'
      },
      {
        id: 'sakura',
        name: '樱色少女',
        glyph: '桜',
        tag: '柔光 · 少女漫画',
        example: '穿水手服的少女在樱花雨中回头微笑，柔光，少女漫画风格，粉色氛围'
      },
      {
        id: 'shonen',
        name: '热血番剧',
        glyph: '烈',
        tag: '动态 · 高对比',
        example: '少年挥剑跃起，披风翻飞，冲击波与速度线，热血番剧关键帧'
      },
      {
        id: 'retro',
        name: '复古赛璐璐',
        glyph: '昭',
        tag: '90s · 胶片颗粒',
        example: '90年代动画截图，少女站在旧式车站，暖色胶片颗粒，复古赛璐璐'
      }
    ]
  },
  {
    id: 'oriental',
    name: '国风东方',
    en: 'ORIENTAL',
    color1: '#14b8a6',
    color2: '#f59e0b',
    models: [
      {
        id: 'ink',
        name: '青墨山水',
        glyph: '墨',
        tag: '水墨 · 留白意境',
        example: '水墨风格的仙侠山谷，白衣剑客御剑飞行，云雾缭绕，远山留白'
      },
      {
        id: 'hanfu',
        name: '绮罗古风',
        glyph: '绮',
        tag: '汉服 · 古典园林',
        example: '穿汉服的少女提灯走过古镇石桥，河面倒影，暖黄灯光，国风插画'
      },
      {
        id: 'xianxia',
        name: '仙侠幻境',
        glyph: '仙',
        tag: '御剑 · 云海仙境',
        example: '仙侠幻境，白衣剑客立于云海之上，飞剑环绕，金色符箓，史诗构图'
      },
      {
        id: 'dunhuang',
        name: '敦煌绮梦',
        glyph: '敦',
        tag: '壁画 · 飞天纹样',
        example: '敦煌壁画风格的飞天少女，矿物颜料，金色勾线，莲花纹样，古老丝路美学'
      }
    ]
  },
  {
    id: 'character',
    name: '角色幻想',
    en: 'CHARACTER',
    color1: '#f59e0b',
    color2: '#ef4444',
    models: [
      {
        id: 'idol',
        name: '元气偶像',
        glyph: '偶',
        tag: '舞台 · 高光闪耀',
        example: '元气偶像少女在舞台中央挥动荧光棒，聚光灯，彩色纸屑，闪亮高光'
      },
      {
        id: 'mecha',
        name: '机甲纪元',
        glyph: '機',
        tag: '机甲 · 赛博科幻',
        example: '机甲少女站在未来机库中，外骨骼装甲，霓虹驾驶舱，精密机械细节'
      },
      {
        id: 'chibi',
        name: 'Q版萌物',
        glyph: 'Q',
        tag: '贴纸 · 粗描边',
        example: 'Q版银发猫耳少女贴纸，大眼睛，马卡龙配色，白色背景，粗描边'
      },
      {
        id: 'adventurer',
        name: '奇幻旅人',
        glyph: '旅',
        tag: 'RPG · 魔法森林',
        example: '奇幻旅人背着行囊走进发光魔法森林，精灵粒子，RPG 游戏关键视觉'
      }
    ]
  },
  {
    id: 'scene',
    name: '氛围场景',
    en: 'SCENE',
    color1: '#06b6d4',
    color2: '#6366f1',
    models: [
      {
        id: 'cyber',
        name: '赛博霓虹',
        glyph: '霓',
        tag: '霓虹 · 雨夜都市',
        example: '雨夜赛博都市，机甲少女撑伞回眸，霓虹灯牌倒映在积水中，电影感构图'
      },
      {
        id: 'slice',
        name: '治愈日常',
        glyph: '治',
        tag: '暖光 · 生活感',
        example: '春日电车车厢，阳光与樱花，靠窗少女托腮发呆，清新治愈日常'
      },
      {
        id: 'gothic',
        name: '暗夜哥特',
        glyph: '夜',
        tag: '哥特 · 暗红月光',
        example: '暗黑哥特城堡中的银发吸血鬼少女，红玫瑰，冰冷月光，华丽细节'
      },
      {
        id: 'cinematic',
        name: '电影光影',
        glyph: '影',
        tag: '35mm · 电影景深',
        example: '动漫电影截图，少女站在天台边缘，逆光剪影，城市虚化背景，35mm 胶片感'
      }
    ]
  }
];

const MODEL_INDEX = GROUPS.flatMap(function (group) {
  return group.models.map(function (model) {
    return Object.assign({}, model, {
      groupId: group.id,
      groupName: group.name,
      groupEn: group.en,
      color1: group.color1,
      color2: group.color2
    });
  });
});

/* ---------------- 比例 ---------------- */
const RATIOS = [
  { id: '1:1', w: 1024, h: 1024 },
  { id: '3:4', w: 768, h: 1024 },
  { id: '4:3', w: 1024, h: 768 },
  { id: '9:16', w: 768, h: 1344 },
  { id: '16:9', w: 1344, h: 768 }
];

/* 清晰度档位：以 1024 基准为 1K，按倍率放大得到 2K / 4K */
const SCALES = [
  { id: '1k', label: '标清 1K', mult: 1 },
  { id: '2k', label: '高清 2K', mult: 2 },
  { id: '4k', label: '超清 4K', mult: 4 }
];

/* ---------------- 灵感 ---------------- */
const INSPIRATIONS = [
  '银发精灵少女在月光森林中吹奏长笛，萤火虫环绕，奇幻动漫插画',
  '雨夜天台上的少年，霓虹灯牌，湿发，蓝紫色电影光影，动漫电影感',
  '穿汉服的少女提灯走过古镇石桥，河面倒影，暖黄灯光，国风插画',
  '白色巨型机器人伫立在花海中，少女仰望，逆光，史诗感动漫场景',
  'Q版猫耳女仆端着小蛋糕，马卡龙色背景，贴纸风格，粗描边',
  '赛博朋克风格的机械狐妖，霓虹纹路，雨夜街道，高对比',
  '夏日祭典，穿浴衣的少女回头微笑，烟花绽放，暖色胶片质感',
  '水墨风格的孤舟渔翁，远山云雾，留白构图，东方禅意',
  '魔法学院图书馆，漂浮的书本，猫头鹰，暖色烛光，奇幻动画风格',
  '暗黑哥特城堡中的银发吸血鬼少女，红玫瑰，月光，华丽细节',
  '未来都市的虚拟偶像演唱会，全息投影，荧光棒海洋，动感构图',
  '春日电车车厢，阳光与樱花，靠窗少女，清新治愈日常'
];

/* ---------------- 图标 ---------------- */
const ICONS = {
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l4-4m-4 4l-4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reuse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.3 4.3L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5L21 20H3L12 4.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7.8" r="1" fill="currentColor"/></svg>',
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12.3l2.8 2.8L16.3 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

/* ---------------- 工具函数 ---------------- */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function randomSeed() {
  return Math.floor(Math.random() * 900000000) + 100000;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function safeName(text) {
  return String(text || 'AI').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 36);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

function getModel(id) {
  return MODEL_INDEX.find(function (m) { return m.id === id; }) || MODEL_INDEX[0];
}

function currentRatio() {
  return RATIOS.find(function (r) { return r.id === state.ratio; }) || RATIOS[0];
}

function currentScale() {
  return SCALES.find(function (s) { return s.id === state.scale; }) || SCALES[0];
}

function currentSize() {
  const ratio = currentRatio();
  const scale = currentScale();
  return { ratio: ratio, scale: scale, w: ratio.w * scale.mult, h: ratio.h * scale.mult };
}

function fileNameFor(item) {
  const date = new Date();
  const stamp = '' + date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') +
    '_' + String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0');
  return '绘梦_' + safeName(item.modelName || 'ANIME') + '_' + stamp + '_' + (item.seed || Date.now());
}

/* ---------------- 初始化状态 ---------------- */
const storedPrefs = loadJSON(LS_PREFS, {}) || {};
const storedWorks = loadJSON(LS_WORKS, []);
const storedApi = loadJSON(LS_API, {}) || {};
/* 旧版默认模型 ID 已下线，迁移到当前可用 ID */
if (storedApi.gptModel === 'gpt-image-1') storedApi.gptModel = RAYIN_DEFAULT.gptModel;

const state = {
  view: 'create',
  modelId: MODEL_INDEX.some(function (m) { return m.id === storedPrefs.modelId; }) ? storedPrefs.modelId : MODEL_INDEX[0].id,
  ratio: RATIOS.some(function (r) { return r.id === storedPrefs.ratio; }) ? storedPrefs.ratio : '1:1',
  scale: SCALES.some(function (s) { return s.id === storedPrefs.scale; }) ? storedPrefs.scale : '1k',
  count: [1, 2, 4].indexOf(Number(storedPrefs.count)) >= 0 ? Number(storedPrefs.count) : 1,
  steps: clamp(Number(storedPrefs.steps) || 8, 4, 12),
  seed: Number(storedPrefs.seed) || randomSeed(),
  translate: storedPrefs.translate !== false,
  engine: ENGINE_META[storedPrefs.engine] ? storedPrefs.engine : 'flux',
  api: Object.assign({}, RAYIN_DEFAULT, storedApi),
  works: Array.isArray(storedWorks)
    ? storedWorks.filter(function (w) { return w && w.url; }).slice(0, MAX_WORKS)
    : [],
  generating: false,
  jobs: new Map(),
  ticker: null,
  activeItem: null,
  collapsed: new Set(),
  translationCache: new Map(),
  refImage: null,
  prompts: ['', ''],
  activePrompt: 0,
  worksSort: 'newest',
  worksFilter: 'all'
};

/* ---------------- DOM ---------------- */
const els = {};

function bindEls() {
  els.modelGroups = document.getElementById('modelGroups');
  els.modelSearch = document.getElementById('modelSearch');
  els.modelCount = document.getElementById('modelCount');
  els.stageModelName = document.getElementById('stageModelName');
  els.stageModelTag = document.getElementById('stageModelTag');
  els.stageResultCount = document.getElementById('stageResultCount');
  els.queueText = document.getElementById('queueText');
  els.emptyState = document.getElementById('emptyState');
  els.resultGrid = document.getElementById('resultGrid');
  els.viewCreate = document.getElementById('view-create');
  els.promptInput = document.getElementById('promptInput');
  els.charCount = document.getElementById('charCount');
  els.inspireBtn = document.getElementById('inspireBtn');
  els.refDrop = document.getElementById('refDrop');
  els.refInput = document.getElementById('refInput');
  els.refEmpty = document.getElementById('refEmpty');
  els.refPreview = document.getElementById('refPreview');
  els.refImage = document.getElementById('refImage');
  els.refRemove = document.getElementById('refRemove');
  els.refState = document.getElementById('refState');
  els.refNote = document.getElementById('refNote');

  els.ratioPicker = document.getElementById('ratioPicker');
  els.ratioLabel = document.getElementById('ratioLabel');
  els.scalePicker = document.getElementById('scalePicker');
  els.countPicker = document.getElementById('countPicker');
  els.seedInput = document.getElementById('seedInput');
  els.seedRandom = document.getElementById('seedRandom');
  els.stepsRange = document.getElementById('stepsRange');
  els.stepsLabel = document.getElementById('stepsLabel');
  els.translateToggle = document.getElementById('translateToggle');
  els.generateBtn = document.getElementById('generateBtn');
  els.worksBadge = document.getElementById('worksBadge');
  els.worksGrid = document.getElementById('worksGrid');
  els.worksEmpty = document.getElementById('worksEmpty');
  els.clearWorks = document.getElementById('clearWorks');
  els.lightbox = document.getElementById('lightbox');
  els.lbImage = document.getElementById('lbImage');
  els.lbPrompt = document.getElementById('lbPrompt');
  els.lbMeta = document.getElementById('lbMeta');
  els.lbDownload = document.getElementById('lbDownload');
  els.lbClose = document.getElementById('lbClose');
  els.helpBtn = document.getElementById('helpBtn');
  els.helpModal = document.getElementById('helpModal');
  els.helpClose = document.getElementById('helpClose');
  els.helpDone = document.getElementById('helpDone');
  els.toastWrap = document.getElementById('toastWrap');
  els.sidebar = document.getElementById('sidebar');
  els.sidebarScrim = document.getElementById('sidebarScrim');
  els.modelsToggle = document.getElementById('modelsToggle');
  els.engineSelect = document.getElementById('engineSelect');
  els.engineNote = document.getElementById('engineNote');
  els.enginePillText = document.getElementById('enginePillText');
  els.composerEngineNote = document.getElementById('composerEngineNote');
  els.genHint = document.getElementById('genHint');
  els.planTag = document.getElementById('planTag');
  els.composerNotice = document.getElementById('composerNotice');
  els.apiConfigBtn = document.getElementById('apiConfigBtn');
  els.apiModal = document.getElementById('apiModal');
  els.apiClose = document.getElementById('apiClose');
  els.apiBaseInput = document.getElementById('apiBaseInput');
  els.apiKeyInput = document.getElementById('apiKeyInput');
  els.gptModelInput = document.getElementById('gptModelInput');
  els.bananaModelInput = document.getElementById('bananaModelInput');
  els.apiHint = document.getElementById('apiHint');
  els.apiSave = document.getElementById('apiSave');
  els.fetchModelsBtn = document.getElementById('fetchModelsBtn');

  /* V2 布局新增控件 */
  els.composer = document.getElementById('composer');
  els.promptTabs = document.getElementById('promptTabs');
  els.addPromptTab = document.getElementById('addPromptTab');
  els.expandPrompt = document.getElementById('expandPrompt');
  els.refPickBtn = document.getElementById('refPickBtn');
  els.engineBtn = document.getElementById('engineBtn');
  els.engineMenu = document.getElementById('engineMenu');
  els.engineModelBtn = document.getElementById('engineModelBtn');
  els.ratioBtn = document.getElementById('ratioBtn');
  els.scaleBtn = document.getElementById('scaleBtn');
  els.scaleChipText = document.getElementById('scaleChipText');
  els.seedBtn = document.getElementById('seedBtn');
  els.seedPop = document.getElementById('seedPop');
  els.countValue = document.getElementById('countValue');
  els.styleChipText = document.getElementById('styleChipText');
  els.resetCanvas = document.getElementById('resetCanvas');
  els.sidebarClose = document.getElementById('sidebarClose');
  els.worksSortBtn = document.getElementById('worksSortBtn');
  els.worksSortMenu = document.getElementById('worksSortMenu');
  els.worksSortText = document.getElementById('worksSortText');
  els.worksFilterBtn = document.getElementById('worksFilterBtn');
  els.worksFilterMenu = document.getElementById('worksFilterMenu');
  els.worksFilterText = document.getElementById('worksFilterText');
  els.worksTotal = document.getElementById('worksTotal');
}

/* ---------------- 渲染 ---------------- */
function renderModels(query) {
  const q = String(query || '').trim().toLowerCase();
  let total = 0;

  const html = GROUPS.map(function (group) {
    const models = group.models.filter(function (m) {
      if (!q) return true;
      return [m.name, m.tag, m.example, group.name, group.en].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!models.length) return '';
    total += models.length;

    const isCollapsed = !q && state.collapsed.has(group.id);
    return '<section class="model-group' + (isCollapsed ? ' is-collapsed' : '') + '" data-group="' + group.id + '">' +
      '<button class="group-head" data-group-toggle="' + group.id + '" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' +
        '<span class="group-dot" style="--g1:' + group.color1 + ';--g2:' + group.color2 + '"></span>' +
        '<span class="group-name">' + group.name + '<small>' + group.en + '</small></span>' +
        '<span class="group-count">' + models.length + '</span>' +
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="group-body">' +
        models.map(function (m) {
          return '<button class="model-item' + (m.id === state.modelId ? ' is-active' : '') + '" data-model="' + m.id + '" style="--g1:' + group.color1 + ';--g2:' + group.color2 + '">' +
            '<span class="model-glyph"><span>' + m.glyph + '</span></span>' +
            '<span class="model-copy"><span class="model-name">' + m.name + '</span><span class="model-desc">' + m.tag + '</span></span>' +
            '<span class="model-check">' + ICONS.check + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</section>';
  }).join('');

  els.modelGroups.innerHTML = html || '<p class="model-empty">没有找到相关风格<br>试试「水墨」或「Q版」</p>';
  els.modelCount.textContent = total + ' 款';
}

function renderRatios() {
  els.ratioPicker.innerHTML = RATIOS.map(function (r) {
    const scale = 21 / Math.max(r.w, r.h);
    const bw = Math.max(9, Math.round(r.w * scale));
    const bh = Math.max(9, Math.round(r.h * scale));
    return '<button class="ratio-btn' + (r.id === state.ratio ? ' is-active' : '') + '" data-ratio="' + r.id + '" title="' + r.w + '×' + r.h + '">' +
      '<span class="ratio-shape" style="width:' + bw + 'px;height:' + bh + 'px"></span>' +
      '<span class="ratio-name">' + r.id + '</span>' +
    '</button>';
  }).join('');

  updateRatioLabel();
}

function updateRatioLabel() {
  const size = currentSize();
  const detail = state.engine !== 'flux'
    ? gptSizeFor({ ratioId: size.ratio.id }).replace('x', '×')
    : size.scale.label + ' · ' + size.w + '×' + size.h;
  els.ratioLabel.textContent = size.ratio.id;
  if (els.ratioBtn) els.ratioBtn.title = '画面比例 ' + size.ratio.id + ' · ' + detail;
}

function filteredWorks() {
  let list = state.works.slice();
  if (state.worksFilter === 'free') {
    list = list.filter(function (w) { return (w.engine || 'flux') === 'flux'; });
  } else if (state.worksFilter === 'paid') {
    list = list.filter(function (w) { return (w.engine || 'flux') !== 'flux'; });
  }
  list.sort(function (a, b) {
    const da = a.createdAt || 0;
    const db = b.createdAt || 0;
    return state.worksSort === 'oldest' ? da - db : db - da;
  });
  return list;
}

function renderWorks() {
  const total = state.works.length;
  els.worksBadge.textContent = String(total);
  if (els.worksTotal) els.worksTotal.textContent = String(total);
  els.stageResultCount.textContent = total + ' 张作品';

  const list = filteredWorks();

  if (!list.length) {
    els.worksGrid.innerHTML = '';
    els.worksEmpty.style.display = 'flex';
    return;
  }

  els.worksEmpty.style.display = 'none';
  els.worksGrid.innerHTML = list.map(function (work) {
    const src = work.thumb || work.url;
    return '<article class="work-card" data-work="' + work.id + '">' +
      '<img src="' + esc(src) + '" alt="' + esc(work.prompt) + '" loading="lazy">' +
      '<div class="work-overlay">' +
        '<button data-waction="download" title="下载原图">' + ICONS.download + '</button>' +
        '<button data-waction="view" title="查看大图">' + ICONS.eye + '</button>' +
        '<button data-waction="delete" title="删除">' + ICONS.trash + '</button>' +
      '</div>' +
      '<div class="work-meta"><span>' + esc(work.modelName || 'AI') + '</span><span>#' + esc(work.seed) + '</span></div>' +
    '</article>';
  }).join('');
}

function syncModelUI() {
  const model = getModel(state.modelId);
  els.stageModelName.textContent = model.name;
  els.stageModelTag.textContent = model.groupName;
  els.promptInput.placeholder = '描述你想生成的画面...';
  if (els.styleChipText) els.styleChipText.textContent = model.name;
  if (els.modelsToggle) els.modelsToggle.title = '当前风格：' + model.name + ' · 点击切换';
  document.querySelectorAll('.model-item').forEach(function (el) {
    el.classList.toggle('is-active', el.dataset.model === state.modelId);
  });
}

const COUNT_OPTIONS = [1, 2, 4];

/* 描述多标签：1 / 2 / +，每个标签保存一份草稿 */
function renderPromptTabs() {
  if (!els.promptTabs || !els.addPromptTab) return;
  els.promptTabs.querySelectorAll('.hm-tab[data-tab]').forEach(function (node) { node.remove(); });
  state.prompts.forEach(function (_, index) {
    const btn = document.createElement('button');
    btn.className = 'hm-tab' + (index === state.activePrompt ? ' is-active' : '');
    btn.dataset.tab = String(index);
    btn.textContent = String(index + 1);
    btn.setAttribute('aria-label', '描述 ' + (index + 1));
    els.promptTabs.insertBefore(btn, els.addPromptTab);
  });
  els.addPromptTab.hidden = state.prompts.length >= 5;
}

function switchPromptTab(index) {
  if (index === state.activePrompt) return;
  state.prompts[state.activePrompt] = els.promptInput.value;
  if (typeof state.prompts[index] !== 'string') state.prompts[index] = '';
  state.activePrompt = index;
  els.promptInput.value = state.prompts[index];
  renderPromptTabs();
  updateCharCount();
}

function syncSettingsUI() {
  els.seedInput.value = String(state.seed);
  els.stepsRange.value = String(state.steps);
  updateStepsUI();
  const countIndex = COUNT_OPTIONS.indexOf(state.count);
  if (els.countValue) els.countValue.textContent = String(state.count);
  els.countPicker.querySelectorAll('[data-step]').forEach(function (btn) {
    const step = Number(btn.dataset.step);
    btn.disabled = step < 0 ? countIndex <= 0 : countIndex >= COUNT_OPTIONS.length - 1;
  });
  els.scalePicker.querySelectorAll('button').forEach(function (btn) {
    btn.classList.toggle('is-active', btn.dataset.scale === state.scale);
  });
  if (els.scaleChipText) els.scaleChipText.textContent = state.scale.toUpperCase();
  if (els.seedBtn) els.seedBtn.title = '当前种子 #' + state.seed + '，点击手动指定';
  els.translateToggle.classList.toggle('is-on', state.translate);
  els.translateToggle.setAttribute('aria-checked', state.translate ? 'true' : 'false');
  renderPromptTabs();
  renderRatios();
  syncModelUI();
  syncEngineUI();
  updateCharCount();
}

function rayinCfg() {
  return state.api || RAYIN_DEFAULT;
}

function hasRayinKey() {
  return !!String(rayinCfg().key || '').trim();
}

function syncEngineUI() {
  const meta = ENGINE_META[state.engine] || ENGINE_META.flux;
  els.engineSelect.value = state.engine;
  els.enginePillText.textContent = meta.pill;
  els.composerEngineNote.textContent = meta.free ? 'FLUX.1 · 免费算力' : meta.label + ' · RayinAPI';
  if (!state.generating) els.genHint.textContent = meta.hint;
  els.planTag.textContent = meta.free ? 'FREE' : 'API';
  els.composerNotice.textContent = meta.free
    ? '免费通道 · 无水印 · 生成后可直接下载原图'
    : 'RayinAPI 按量计费 · 生成后可直接下载原图';
  document.body.dataset.engine = state.engine;

  if (meta.free) {
    els.engineNote.textContent = '免费通道，无需配置即可生成';
    els.engineNote.classList.remove('is-warn');
  } else if (hasRayinKey()) {
    els.engineNote.textContent = '密钥已配置 · 按量计费，仅保存在本机';
    els.engineNote.classList.remove('is-warn');
  } else {
    els.engineNote.textContent = '尚未配置 RayinAPI 密钥，点击右上「接入设置」';
    els.engineNote.classList.add('is-warn');
  }

  updateRatioLabel();
  syncRefNote();

  if (els.engineMenu) {
    els.engineMenu.querySelectorAll('[data-engine]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.engine === state.engine);
    });
  }
  if (els.engineModelBtn) {
    els.engineModelBtn.title = meta.label + (meta.free ? ' · 免费通道' : ' · RayinAPI 按量计费');
  }
  if (els.scaleBtn) {
    els.scaleBtn.title = meta.free ? '生成清晰度' : 'GPT-image 固定三档尺寸，清晰度由比例决定';
  }
}

/* ---------------- 参考图（图生图） ---------------- */
const REF_MAX_BYTES = 10 * 1024 * 1024;
const REF_MAX_SIDE = 1280;

function syncRefNote() {
  if (!els.refNote) return;
  const has = !!state.refImage;
  const supported = state.engine === 'gpt-image';

  if (!has) {
    els.refNote.textContent = '仅 GPT-image 引擎支持参考图（图生图）';
    els.refNote.classList.remove('is-warn');
  } else if (supported) {
    els.refNote.textContent = '已启用图生图 · 按参考图主体生成';
    els.refNote.classList.remove('is-warn');
  } else {
    els.refNote.textContent = '当前引擎不支持参考图，请切换到 GPT-image 引擎';
    els.refNote.classList.add('is-warn');
  }
}

function renderRef() {
  const ref = state.refImage;
  if (ref) {
    els.refImage.src = ref.dataUrl;
    els.refPreview.hidden = false;
    els.refEmpty.hidden = true;
    els.refDrop.classList.add('has-ref');
  } else {
    els.refImage.removeAttribute('src');
    els.refPreview.hidden = true;
    els.refEmpty.hidden = false;
    els.refDrop.classList.remove('has-ref');
  }
  els.refState.textContent = ref ? ref.width + '×' + ref.height : '未添加';
  els.refState.style.color = ref ? '#c4b5fd' : '';
  syncRefNote();
}

function clearRefImage() {
  state.refImage = null;
  els.refInput.value = '';
  renderRef();
}

function loadImageFile(file) {
  return new Promise(function (resolve, reject) {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image load failed'));
    };
    img.src = objectUrl;
  });
}

async function pickRefFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) {
    toast('参考图仅支持 PNG / JPG / WebP 格式', 'error');
    return;
  }
  if (file.size > REF_MAX_BYTES) {
    toast('参考图不能超过 10MB', 'error');
    return;
  }

  try {
    const img = await loadImageFile(file);
    const natural = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    const scale = Math.min(1, REF_MAX_SIDE / natural);
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    state.refImage = {
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      name: 'reference.jpg',
      width: width,
      height: height
    };
    els.refInput.value = '';
    renderRef();
    if (state.engine !== 'gpt-image') {
      toast('参考图已添加，请切换到 GPT-image 引擎生成', 'info');
    } else {
      toast('参考图已添加，将按图中主体生成', 'success');
    }
  } catch (err) {
    toast('参考图读取失败，请换一张图片', 'error');
  }
}

function updateStepsUI() {
  const value = state.steps;
  const label = value <= 5 ? '极速' : value <= 8 ? '标准' : '精细';
  els.stepsLabel.textContent = String(value);
  els.stepsRange.title = '精细度：' + label + ' · ' + value + ' 步';
  const p = ((value - 4) / 8) * 100;
  els.stepsRange.style.setProperty('--p', p + '%');
}

function updateCharCount() {
  const length = els.promptInput.value.length;
  els.charCount.textContent = length + ' / 1800';
  els.charCount.style.color = length > 1740 ? '#fda4af' : '';
}

function persistPrefs() {
  saveJSON(LS_PREFS, {
    modelId: state.modelId,
    ratio: state.ratio,
    scale: state.scale,
    count: state.count,
    steps: state.steps,
    seed: state.seed,
    translate: state.translate,
    engine: state.engine
  });
}

/* ---------------- 视图与侧栏 ---------------- */
function switchView(view) {
  if (view !== 'create' && view !== 'works') return;
  state.view = view;
  document.body.dataset.view = view;

  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  });

  const createView = document.getElementById('view-create');
  if (view === 'create') {
    createView.classList.add('is-active');
  } else {
    createView.classList.remove('is-active');
    renderWorks();
  }

  closeSidebar();
}

function openSidebar() {
  els.sidebar.classList.add('is-open');
  els.sidebar.setAttribute('aria-hidden', 'false');
  els.sidebarScrim.classList.add('is-visible');
}

function closeSidebar() {
  els.sidebar.classList.remove('is-open');
  els.sidebar.setAttribute('aria-hidden', 'true');
  els.sidebarScrim.classList.remove('is-visible');
}

/* V2 菜单：生图 / 比例 / 档位 / 种子 / 作品筛选 */
function closeAllMenus() {
  document.querySelectorAll('.hm-menu.is-open').forEach(function (menu) {
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
  });
  document.querySelectorAll('[aria-haspopup]').forEach(function (btn) {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function toggleMenu(menu, btn) {
  if (!menu) return;
  const willOpen = !menu.classList.contains('is-open');
  closeAllMenus();
  if (!willOpen) return;
  menu.classList.add('is-open');
  menu.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

/* ---------------- 模型选择 ---------------- */
function selectModel(id, options) {
  const opts = options || {};
  const model = getModel(id);
  state.modelId = model.id;
  persistPrefs();
  syncModelUI();
  if (!opts.stay) switchView('create');
  closeSidebar();
}

/* ---------------- 提示 ---------------- */
function toast(message, type) {
  const kind = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const icon = kind === 'success' ? ICONS.success : kind === 'error' ? ICONS.error : ICONS.info;
  el.innerHTML = icon + '<span>' + esc(message) + '</span>';
  els.toastWrap.appendChild(el);
  setTimeout(function () {
    el.classList.add('is-out');
    setTimeout(function () { el.remove(); }, 260);
  }, 3200);
}

function shakePrompt() {
  const wrap = els.promptInput.closest('.prompt-wrap');
  wrap.classList.remove('is-shake');
  void wrap.offsetWidth;
  wrap.classList.add('is-shake');
  setTimeout(function () { wrap.classList.remove('is-shake'); }, 500);
  els.promptInput.focus();
}

function updateQueue(text) {
  els.queueText.textContent = text;
}

function updateJobStatus(job, text) {
  const card = document.querySelector('[data-job="' + job.id + '"]');
  if (!card) return;
  const el = card.querySelector('[data-status]');
  if (el) el.textContent = text;
}

function updateAllJobStatus(text) {
  state.jobs.forEach(function (job) {
    if (job.status === 'loading') updateJobStatus(job, text);
  });
}

/* ---------------- 翻译 ---------------- */
async function translatePrompt(text) {
  if (!hasChinese(text)) return text;
  if (state.translationCache.has(text)) return state.translationCache.get(text);

  const instruction = 'You are an expert anime image prompt translator. Translate and enrich the following Chinese description into concise English Danbooru-style tags. Keep all details about character, hair, clothing, pose, scene, lighting and composition. Add "anime illustration" if no style is specified. Output ONLY comma-separated English tags, without quotes, notes or explanations.\nDescription: ' + text;
  const url = TRANSLATE_API + encodeURIComponent(instruction) + '?model=openai-fast';

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 26000);

  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) throw new Error('translate http ' + res.status);

    let out = (await res.text()).replace(/\r/g, '').trim();
    if (out.indexOf('\n') >= 0) {
      const lines = out.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      out = lines[0] || out;
    }
    out = out
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(english\s*(prompt|tags)?\s*[:：]\s*)/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);

    if (!out || hasChinese(out)) throw new Error('translation invalid');
    state.translationCache.set(text, out);
    return out;
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 构建提示词 ----------------
 * 所有引擎一律原样发送用户描述，不注入任何平台标签
 * （风格 booster / 画质修饰 / masterpiece 堆叠均已移除，避免稀释意图、与接入模型冲突）。
 */
function buildPrompt(userText) {
  return userText;
}

/* ---------------- 生图 API ---------------- */
function parseSSEBlock(block) {
  let event = 'message';
  const data = [];
  block.split('\n').forEach(function (line) {
    if (line.indexOf('event:') === 0) {
      event = line.slice(6).trim();
    } else if (line.indexOf('data:') === 0) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  });
  return { event: event, data: data.join('\n') };
}

async function waitForResult(job, eventId, api) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 240000);

  try {
    const res = await fetch(api + '/' + eventId, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) throw new Error('SSE http ' + res.status);
    if (!res.body) throw new Error('浏览器不支持流式响应');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');

      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        const rawBlock = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');

        const parsed = parseSSEBlock(rawBlock);
        if (!parsed.data && parsed.event === 'message') continue;

        if (parsed.event === 'complete') {
          try {
            result = JSON.parse(parsed.data);
          } catch (err) {
            throw new Error('生成结果解析失败');
          }
        } else if (parsed.event === 'error') {
          let message = parsed.data || '生成服务返回错误';
          try {
            const errorObj = JSON.parse(parsed.data);
            if (errorObj && errorObj.error) message = String(errorObj.error);
          } catch (err) { /* 保留原始错误文本 */ }
          throw new Error(message);
        } else if (parsed.event === 'generating' || parsed.event === 'progress') {
          updateJobStatus(job, '正在绘制…');
        }
      }
    }

    if (!result) throw new Error('未收到生成结果');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function generateOne(job, prompt) {
  job.status = 'loading';
  job.startedAt = Date.now();
  job.fullPrompt = prompt;

  updateJobStatus(job, '提交任务…');

  if (job.engine === 'gpt-image' || job.engine === 'banana') {
    const image = job.engine === 'gpt-image'
      ? await runRayinImage(job, prompt)
      : await runRayinBanana(job, prompt);
    const elapsed = (Date.now() - job.startedAt) / 1000;
    markJobDone(job, image.url, image.seed, elapsed);
    return;
  }

  let lastError = null;

  for (let i = 0; i < ENGINES.length; i += 1) {
    try {
      const image = await runEngine(ENGINES[i], job, prompt);
      const elapsed = (Date.now() - job.startedAt) / 1000;
      markJobDone(job, image.url, image.seed, elapsed);
      return;
    } catch (err) {
      lastError = err;
      if (isAbortError(err)) break;
      if (i < ENGINES.length - 1) updateJobStatus(job, '切换备用通道…');
    }
  }

  if (!isAbortError(lastError)) {
    try {
      const image = await runFallback(job, prompt);
      job.metaLabel = '备用通道';
      const elapsed = (Date.now() - job.startedAt) / 1000;
      markJobDone(job, image.url, image.seed, elapsed);
      return;
    } catch (fallbackError) {
      fallbackError.hint = fallbackError.hint || friendlyError(lastError);
      markJobError(job, fallbackError);
      throw lastError || fallbackError;
    }
  }

  throw lastError || new Error('生成失败');
}

async function runEngine(engine, job, prompt) {
  const res = await fetch(engine.api, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: engine.payload(job, prompt) })
  });

  if (!res.ok) throw new Error('HTTP ' + res.status);

  const call = await res.json();
  if (!call || !call.event_id) throw new Error('未获取生成任务');

  updateJobStatus(job, '排队绘制…');
  const result = await waitForResult(job, call.event_id, engine.api);

  const image = Array.isArray(result) ? result[0] : null;
  if (!image || !image.url) throw new Error('未返回图片');

  return {
    url: image.url,
    seed: Array.isArray(result) && result[1] ? result[1] : job.seed
  };
}

function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
}

/* 免费通道全部不可用时的兜底出图（Pollinations，图片带水印） */
async function runFallback(job, prompt) {
  const url = FALLBACK_API + encodeURIComponent(String(prompt).slice(0, 900)) +
    '?width=' + job.width + '&height=' + job.height +
    '&seed=' + job.seed + '&model=sana&nologo=true';

  updateJobStatus(job, '备用通道绘制…');
  await preloadImage(url);
  return { url: url, seed: job.seed };
}

function preloadImage(url) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    const timer = setTimeout(function () {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      reject(new Error('备用通道响应超时'));
    }, 120000);

    // 兜底通道不支持带 Origin 的 CORS 请求，因此不设置 crossOrigin，保证图片能显示
    img.onload = function () {
      clearTimeout(timer);
      resolve();
    };
    img.onerror = function () {
      clearTimeout(timer);
      reject(new Error('备用通道不可用'));
    };
    img.src = url;
  });
}

/* ---------------- RayinAPI（GPT-image / Nano Banana） ---------------- */
function rayinBase() {
  return normalizeBase(rayinCfg().base);
}

function normalizeBase(value) {
  const base = String(value || RAYIN_DEFAULT.base).trim().replace(/\/+$/, '');
  return /\/v\d+[a-z]*$/i.test(base) ? base : base + '/v1';
}

function apiErrorText(payload, status) {
  let message = '';
  if (payload) {
    if (typeof payload === 'string') message = payload;
    else if (payload.error) message = typeof payload.error === 'string' ? payload.error : (payload.error.message || '');
    else if (payload.message) message = String(payload.message);
  }
  message = String(message || '').replace(/\s+/g, ' ').slice(0, 160);

  if (status === 401 || /unauthorized|invalid.*(api.?key|token)|api.?key/i.test(message)) {
    return 'API Key 无效或未授权，请打开「接入设置」检查';
  }
  if (status === 402 || /余额|balance|quota|insufficient|credit/i.test(message)) {
    return 'RayinAPI 余额不足或额度用尽，请前往控制台充值';
  }
  if (status === 429) return '请求过于频繁，请稍后重试';
  if (status === 404 || /model.*(not.*found|not.*exist)|无可用渠道|no available/i.test(message)) {
    return '模型 ID 不可用，请在「接入设置」中核对：' + (message || '未找到模型');
  }
  return message || 'RayinAPI 返回错误 ' + status;
}

async function rayinFetch(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 240000);
  const opts = options || {};

  try {
    const res = await fetch(rayinBase() + path, {
      method: 'POST',
      mode: 'cors',
      headers: Object.assign(
        { 'Authorization': 'Bearer ' + String(rayinCfg().key || '').trim() },
        opts.headers || {}
      ),
      body: opts.body,
      signal: controller.signal
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }

    if (!res.ok) {
      const error = new Error('HTTP ' + res.status);
      error.hint = apiErrorText(data, res.status);
      throw error;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const error = new Error('timeout');
      error.hint = '接口响应超时，请稍后重试';
      throw error;
    }
    if (!err.hint) {
      const message = String(err.message || '');
      const error = new Error(message || 'network');
      error.hint = /Failed to fetch|NetworkError|load failed/i.test(message)
        ? '无法连接 RayinAPI，请检查网络或 API 地址'
        : 'RayinAPI 调用失败：' + (message || '未知错误');
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function rayinRequest(path, body) {
  return rayinFetch(path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function rayinFormRequest(path, formData) {
  // multipart 由浏览器自动带 boundary，不能手动设置 Content-Type
  return rayinFetch(path, { body: formData });
}

/* 兼容各家中转的返回结构，尽量把图片地址取出来。
 * 注意：b64_json 优先于 url —— 中转返回的外链图床（如 tuba.ink）无 CORS，
 * 浏览器无法 fetch 下载；b64 内联图可直接转 blob 下载原图。 */
function pickImage(data) {
  if (!data) return '';
  if (typeof data.b64_json === 'string') return 'data:image/png;base64,' + data.b64_json;
  if (data.image) return data.image;
  if (data.url) return data.url;

  if (Array.isArray(data.data) && data.data.length) {
    const first = data.data[0];
    if (first && first.b64_json) return 'data:image/png;base64,' + first.b64_json;
    if (first && first.url) return first.url;
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (let i = 0; i < choices.length; i += 1) {
    const message = choices[i] && (choices[i].message || choices[i].delta);
    if (!message) continue;

    const images = message.images;
    if (Array.isArray(images) && images.length) {
      const item = images[0] || {};
      const raw = (item.image_url && (item.image_url.url || item.image_url)) || item.url || item.b64_json || '';
      if (raw) {
        return String(raw).indexOf('http') === 0 || String(raw).indexOf('data:') === 0
          ? raw
          : 'data:image/png;base64,' + raw;
      }
    }

    const content = message.content;
    if (Array.isArray(content)) {
      for (let j = 0; j < content.length; j += 1) {
        const part = content[j];
        if (!part) continue;
        if (part.type === 'image_url' && part.image_url) {
          const raw = part.image_url.url || part.image_url;
          if (raw) return raw;
        }
        if (part.type === 'image' && part.source && part.source.data) {
          return 'data:' + (part.source.media_type || 'image/png') + ';base64,' + part.source.data;
        }
        if (typeof part === 'string' && part.indexOf('data:image') === 0) return part;
      }
    }

    if (typeof content === 'string') {
      const markdown = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/);
      if (markdown) return markdown[1];
      const direct = content.match(/https?:\/\/[^\s"')\]]+\.(?:png|jpg|jpeg|webp)/i);
      if (direct) return direct[0];
      if (content.trim().indexOf('data:image') === 0) return content.trim();
    }
  }

  return '';
}

function gptSizeFor(job) {
  const ratio = job.ratioId || '1:1';
  if (ratio === '1:1') return '1024x1024';
  if (ratio === '3:4' || ratio === '9:16') return '1024x1536';
  return '1536x1024';
}

async function runRayinImage(job, prompt) {
  const model = rayinCfg().gptModel || RAYIN_DEFAULT.gptModel;
  const size = gptSizeFor(job);
  let data;

  if (job.refImage) {
    /* 图生图：以参考图主体为准，走 OpenAI 兼容的 /images/edits（multipart） */
    updateJobStatus(job, '参考图绘制…');
    const blob = await dataUrlBlob(job.refImage.dataUrl);
    const form = new FormData();
    form.append('model', model);
    form.append('image', blob, job.refImage.name || 'reference.jpg');
    form.append('prompt', prompt);
    form.append('size', size);
    data = await rayinFormRequest('/images/edits', form);
  } else {
    updateJobStatus(job, 'GPT-image 绘制…');
    data = await rayinRequest('/images/generations', {
      model: model,
      prompt: prompt,
      n: 1,
      size: size
    });
  }

  const url = pickImage(data);
  if (!url) {
    const error = new Error('no-image');
    error.hint = '接口未返回图片，请核对 GPT-image 模型 ID';
    throw error;
  }
  /* gpt-image 只有固定三档尺寸，回填实际返回像素，避免 meta 显示与实物不符 */
  const first = data && Array.isArray(data.data) ? data.data[0] : null;
  if (first && first.width && first.height) {
    job.width = first.width;
    job.height = first.height;
  }
  return { url: url, seed: job.seed };
}

async function dataUrlBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function runRayinBanana(job, prompt) {
  const model = rayinCfg().bananaModel || RAYIN_DEFAULT.bananaModel;
  updateJobStatus(job, 'Nano Banana 绘制…');

  let data;
  try {
    data = await rayinRequest('/chat/completions', {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text']
    });
  } catch (err) {
    if (!/HTTP 400/.test(String(err.message || ''))) throw err;
    // 部分中转不支持 modalities 参数，去掉后重试一次
    data = await rayinRequest('/chat/completions', {
      model: model,
      messages: [{ role: 'user', content: prompt }]
    });
  }

  const url = pickImage(data);
  if (!url) {
    const error = new Error('no-image');
    error.hint = '接口未返回图片，请核对 Nano Banana 模型 ID';
    throw error;
  }
  return { url: url, seed: job.seed };
}

function errorText(err) {
  return (err && err.hint) || friendlyError(err);
}

function friendlyError(err) {
  const message = String((err && err.message) || '');
  if (/429|quota|exceeded|ZeroGPU|limit/i.test(message)) return '免费算力额度暂满，请稍后重试';
  if (/Failed to fetch|NetworkError|network|load failed/i.test(message)) return '免费通道连接失败，请检查网络后重试';
  if (/abort|timeout|超时/i.test(message)) return '生成超时，请重试';
  if (/HTTP 5\d\d/.test(message)) return '免费算力繁忙，请稍后重试';
  return '生成失败，请稍后重试';
}

/* ---------------- 卡片渲染 ---------------- */
function jobMediaLoading(job) {
  return '<div class="result-media media-loading" style="aspect-ratio:' + job.width + ' / ' + job.height + '">' +
    '<div class="loader-box">' +
      '<span class="loader-ring"></span>' +
      '<div><strong>正在绘制</strong><span class="load-status" data-status>排队中…</span><span class="load-time" data-time>0.0s</span></div>' +
    '</div>' +
  '</div>';
}

function jobInfo(job) {
  return '<div class="result-info">' +
    '<p class="result-prompt">' + esc(job.prompt) + '</p>' +
    '<div class="result-meta"><span>' + esc(job.modelName) + '</span><span>' + job.width + '×' + job.height + '</span><span>' + esc(job.metaLabel || 'FLUX.1') + '</span></div>' +
  '</div>';
}

function createLoadingCard(job) {
  const card = document.createElement('article');
  card.className = 'result-card is-loading';
  card.dataset.job = job.id;
  card.innerHTML = jobMediaLoading(job) + jobInfo(job);
  els.resultGrid.appendChild(card);
}

function markJobError(job, err) {
  job.status = 'error';
  const card = document.querySelector('[data-job="' + job.id + '"]');
  if (!card) return;

  card.classList.remove('is-loading');
  card.classList.add('is-error');
  const media = card.querySelector('.result-media');
  if (media) {
    media.classList.add('media-loading');
    media.innerHTML = '<div class="error-box">' +
      ICONS.alert +
      '<strong>生成失败</strong>' +
      '<span>' + esc(errorText(err)) + '</span>' +
      '<button data-action="retry">重试</button>' +
    '</div>';
  }
}

function markJobDone(job, url, seed, elapsed) {
  job.status = 'done';
  job.url = url;
  job.seed = seed;
  job.elapsed = elapsed;

  const card = document.querySelector('[data-job="' + job.id + '"]');
  if (!card) return;

  card.classList.remove('is-loading', 'is-error');
  card.classList.add('is-done');
  card.innerHTML =
    '<div class="result-media" style="aspect-ratio:' + job.width + ' / ' + job.height + '">' +
      '<img src="' + esc(url) + '" alt="' + esc(job.prompt) + '">' +
      '<span class="media-badge">AI 生成</span>' +
      '<span class="media-model">' + esc(job.modelName) + '</span>' +
      '<div class="media-actions">' +
        '<button class="action-btn primary" data-action="download" title="下载原图">' + ICONS.download + '<span>下载</span></button>' +
        '<button class="action-btn" data-action="view" title="查看大图">' + ICONS.expand + '</button>' +
        '<button class="action-btn" data-action="reuse" title="复用参数">' + ICONS.reuse + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="result-info">' +
      '<p class="result-prompt">' + esc(job.prompt) + '</p>' +
      '<div class="result-meta"><span>' + esc(job.modelName) + '</span><span>' + job.width + '×' + job.height + '</span><span>#' + seed + '</span><span>' + elapsed.toFixed(1) + 's</span></div>' +
    '</div>';

  saveWork(job);
}

/* ---------------- 作品库 ---------------- */
function saveWork(job) {
  const work = {
    id: job.id,
    url: job.url,
    thumb: null,
    prompt: job.prompt,
    enPrompt: job.promptEn || '',
    modelId: job.modelId,
    modelName: job.modelName,
    engine: job.engine || 'flux',
    seed: job.seed,
    width: job.width,
    height: job.height,
    ratioId: job.ratioId,
    scaleId: job.scaleId,
    steps: job.steps,
    createdAt: Date.now()
  };

  state.works.unshift(work);
  state.works = state.works.slice(0, MAX_WORKS);
  saveWorks();
  renderWorks();

  // GPT-image 常返回 base64 内联图，直接存会超出 localStorage 容量，压缩后再落盘
  if (job.url.indexOf('data:') === 0) {
    compressDataUrl(job.url, 1280, 0.86).then(function (small) {
      if (!small) return;
      work.url = small;
      saveWorks();
      if (state.view === 'works') renderWorks();
    });
  }

  makeThumb(job.url).then(function (thumb) {
    if (!thumb) return;
    work.thumb = thumb;
    saveWorks();
    if (state.view === 'works') renderWorks();
  });
}

async function compressDataUrl(dataUrl, maxW, quality) {
  if (!window.createImageBitmap) return null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const targetW = Math.min(maxW, bitmap.width);
    const targetH = Math.round((bitmap.height * targetW) / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', quality || 0.86);
  } catch (err) {
    return null;
  }
}

function saveWorks() {
  if (saveJSON(LS_WORKS, state.works)) return;

  const stripped = state.works.map(function (work, index) {
    return index > 8 ? Object.assign({}, work, { thumb: null }) : work;
  });
  state.works = stripped;
  saveJSON(LS_WORKS, state.works);
}

async function makeThumb(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!window.createImageBitmap) return null;

    const bitmap = await createImageBitmap(blob);
    const targetW = Math.min(520, bitmap.width);
    const targetH = Math.round((bitmap.height * targetW) / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch (err) {
    return null;
  }
}

/* ---------------- 下载 ---------------- */
async function downloadImage(url, filename) {
  if (!url) {
    toast('图片地址不可用', 'error');
    return;
  }

  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const blob = await res.blob();
    let finalBlob = blob;
    let ext = blob.type.indexOf('webp') >= 0 ? 'webp' : blob.type.indexOf('png') >= 0 ? 'png' : 'jpg';

    try {
      if (window.createImageBitmap && blob.type.indexOf('png') < 0) {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const png = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
        if (png) {
          finalBlob = png;
          ext = 'png';
        }
      }
    } catch (err) { /* 保留原始格式 */ }

    const objectUrl = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 8000);

    toast((ext === 'png' ? 'PNG' : ext.toUpperCase()) + ' 原图已开始下载', 'success');
  } catch (err) {
    try {
      window.open(url, '_blank', 'noopener');
    } catch (e) { /* 忽略弹窗失败 */ }
    toast('已打开原图，可右键另存为', 'info');
  }
}

/* ---------------- 大图预览 ---------------- */
function openLightbox(item) {
  state.activeItem = item;
  els.lbImage.src = item.url || item.thumb || '';
  els.lbImage.onerror = function () {
    if (item.thumb && els.lbImage.src !== item.thumb) els.lbImage.src = item.thumb;
  };
  els.lbPrompt.textContent = item.prompt || '';
  els.lbMeta.textContent = [
    item.modelName || 'AI',
    item.engine ? (ENGINE_META[item.engine] || {}).meta || '' : '',
    item.width && item.height ? item.width + '×' + item.height : '',
    'Seed ' + item.seed,
    item.steps ? item.steps + ' 步' : ''
  ].filter(Boolean).join(' · ');

  els.lightbox.classList.add('is-open');
  els.lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeLightbox() {
  els.lightbox.classList.remove('is-open');
  els.lightbox.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
  state.activeItem = null;
}

/* ---------------- 生成流程 ---------------- */
function setGenerating(flag) {
  state.generating = flag;
  els.generateBtn.disabled = flag;
  els.generateBtn.classList.toggle('is-loading', flag);
  const strong = els.generateBtn.querySelector('.gen-text strong');
  const small = els.generateBtn.querySelector('.gen-text small');
  if (flag) {
    strong.textContent = '正在绘制…';
    small.textContent = state.engine === 'flux' ? '免费通道 · 请稍候' : (ENGINE_META[state.engine] || {}).label + ' · 请稍候';
  } else {
    strong.textContent = '开始生成';
    small.textContent = (ENGINE_META[state.engine] || ENGINE_META.flux).hint;
  }
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(function () {
    const now = Date.now();
    state.jobs.forEach(function (job) {
      if (job.status !== 'loading') return;
      const el = document.querySelector('[data-job="' + job.id + '"] [data-time]');
      if (el) el.textContent = ((now - job.startedAt) / 1000).toFixed(1) + 's';
    });
  }, 200);
}

function stopTicker() {
  if (state.ticker) {
    clearInterval(state.ticker);
    state.ticker = null;
  }
}

async function handleGenerate() {
  if (state.generating) return;

  const rawPrompt = els.promptInput.value.trim();
  if (!rawPrompt) {
    shakePrompt();
    toast('先描述一下你想要的画面', 'error');
    return;
  }

  if (state.engine !== 'flux' && !hasRayinKey()) {
    toast('请先在「接入设置」中填写 RayinAPI 密钥', 'error');
    openApiModal();
    return;
  }

  if (state.refImage && state.engine !== 'gpt-image') {
    toast('参考图仅支持 GPT-image 引擎，请先切换引擎或移除参考图', 'error');
    els.refDrop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const model = getModel(state.modelId);
  const size = currentSize();
  const baseSeed = clamp(Number(els.seedInput.value) || randomSeed(), 1, 2147483647);
  state.seed = baseSeed;
  persistPrefs();

  els.emptyState.style.display = 'none';
  els.resultGrid.innerHTML = '';
  state.jobs.clear();

  const jobs = [];
  for (let i = 0; i < state.count; i += 1) {
    const job = {
      id: uid(),
      prompt: rawPrompt,
      promptEn: '',
      modelId: model.id,
      modelName: model.name,
      engine: state.engine,
      metaLabel: (ENGINE_META[state.engine] || ENGINE_META.flux).meta,
      width: size.w,
      height: size.h,
      ratioId: size.ratio.id,
      scaleId: size.scale.id,
      steps: state.engine === 'flux' ? state.steps : 0,
      seed: baseSeed + i,
      status: 'loading',
      startedAt: Date.now(),
      fullPrompt: '',
      url: '',
      elapsed: 0,
      refImage: state.refImage
    };
    jobs.push(job);
    state.jobs.set(job.id, job);
    createLoadingCard(job);
  }

  setGenerating(true);
  startTicker();
  updateQueue('准备生成');
  updateAllJobStatus('准备中…');

  setTimeout(function () {
    const first = els.resultGrid.firstElementChild;
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 90);

  let successCount = 0;
  let translated = false;

  try {
    let userText = rawPrompt;

    if (state.engine === 'flux' && state.translate && hasChinese(rawPrompt)) {
      updateQueue('理解画面…');
      updateAllJobStatus('正在理解画面…');
      try {
        userText = await translatePrompt(rawPrompt);
        translated = true;
      } catch (err) {
        userText = rawPrompt;
        toast('智能英译暂不可用，本次使用原始描述', 'info');
      }
    }

    jobs.forEach(function (job) {
      job.promptEn = translated ? userText : '';
    });

    const fullPrompt = buildPrompt(userText);

    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      updateQueue('绘制 ' + (i + 1) + ' / ' + jobs.length);
      try {
        await generateOne(job, fullPrompt);
        successCount += 1;
      } catch (err) {
        markJobError(job, err);
      }
    }

    if (successCount > 0) {
      toast('已生成 ' + successCount + ' 张作品，可下载原图', 'success');
    } else {
      toast('本次生成失败，请稍后重试', 'error');
    }
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    setGenerating(false);
    stopTicker();
    updateQueue(successCount > 0 ? '已完成' : '空闲');
    renderWorks();
  }
}

async function retryJob(job) {
  if (state.generating) {
    toast('请等待当前任务完成', 'info');
    return;
  }

  if (job.engine && job.engine !== 'flux' && !hasRayinKey()) {
    toast('请先在「接入设置」中填写 RayinAPI 密钥', 'error');
    openApiModal();
    return;
  }

  state.generating = true;
  setGenerating(true);
  startTicker();

  const card = document.querySelector('[data-job="' + job.id + '"]');
  if (card) {
    card.classList.remove('is-error', 'is-loading');
    card.classList.add('is-loading');
    card.innerHTML = jobMediaLoading(job) + jobInfo(job);
  }

  job.status = 'loading';
  job.startedAt = Date.now();
  updateQueue('重试绘制');

  try {
    const prompt = job.fullPrompt || buildPrompt(job.promptEn || job.prompt);
    await generateOne(job, prompt);
    toast('重试成功，可下载原图', 'success');
  } catch (err) {
    markJobError(job, err);
    toast(errorText(err), 'error');
  } finally {
    state.generating = false;
    setGenerating(false);
    stopTicker();
    updateQueue('空闲');
  }
}

function reuseJob(job) {
  state.modelId = job.modelId;
  state.engine = ENGINE_META[job.engine] ? job.engine : 'flux';
  state.ratio = job.ratioId || state.ratio;
  if (job.scaleId && SCALES.some(function (s) { return s.id === job.scaleId; })) state.scale = job.scaleId;
  state.seed = job.seed;
  state.steps = job.steps || state.steps;
  els.promptInput.value = job.prompt;
  updateCharCount();
  syncSettingsUI();
  persistPrefs();
  switchView('create');
  els.promptInput.focus();
  toast('已复用该作品的参数', 'success');
}

/* ---------------- RayinAPI 接入设置 ---------------- */
function openApiModal() {
  els.apiBaseInput.value = rayinCfg().base || RAYIN_DEFAULT.base;
  els.apiKeyInput.value = rayinCfg().key || '';
  els.gptModelInput.value = rayinCfg().gptModel || RAYIN_DEFAULT.gptModel;
  els.bananaModelInput.value = rayinCfg().bananaModel || RAYIN_DEFAULT.bananaModel;
  els.apiHint.textContent = '保存后即可在上方面板下拉切换模型。';
  els.apiModal.classList.add('is-open');
  els.apiModal.setAttribute('aria-hidden', 'false');
}

function closeApiModal() {
  els.apiModal.classList.remove('is-open');
  els.apiModal.setAttribute('aria-hidden', 'true');
}

function saveRayinConfig() {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    toast('请填写 RayinAPI 密钥', 'error');
    els.apiKeyInput.focus();
    return;
  }

  state.api = {
    base: normalizeBase(els.apiBaseInput.value),
    key: key,
    gptModel: els.gptModelInput.value.trim() || RAYIN_DEFAULT.gptModel,
    bananaModel: els.bananaModelInput.value.trim() || RAYIN_DEFAULT.bananaModel
  };
  saveJSON(LS_API, state.api);
  syncEngineUI();
  closeApiModal();
  toast('接入信息已保存，可切换 GPT-image / Nano Banana', 'success');
}

async function fetchRayinModels() {
  const key = els.apiKeyInput.value.trim();
  const base = normalizeBase(els.apiBaseInput.value);
  if (!key) {
    toast('请先填写 API Key', 'error');
    els.apiKeyInput.focus();
    return;
  }

  els.fetchModelsBtn.disabled = true;
  els.apiHint.textContent = '正在读取账号模型…';

  try {
    const res = await fetch(base + '/models', { headers: { 'Authorization': 'Bearer ' + key } });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    const ids = (data.data || data.models || [])
      .map(function (m) { return m.id || m.name || m.model_name; })
      .filter(Boolean);

    const gpt = ids.find(function (id) { return /gpt-image/i.test(id); });
    const banana = ids.find(function (id) { return /nano.?banana/i.test(id); }) ||
      ids.find(function (id) { return /banana/i.test(id); }) ||
      ids.find(function (id) { return /gemini.*image/i.test(id); });

    if (gpt) els.gptModelInput.value = gpt;
    if (banana) els.bananaModelInput.value = banana;

    els.apiHint.textContent = '共 ' + ids.length + ' 个模型' +
      (gpt ? ' · GPT: ' + gpt : ' · 未找到 gpt-image') +
      (banana ? ' · Banana: ' + banana : ' · 未找到 banana');
    toast(ids.length ? '模型列表已读取' : '账号未返回模型列表', ids.length ? 'success' : 'info');
  } catch (err) {
    els.apiHint.textContent = '读取失败：' + (err.message || '网络错误') + '，请检查 Key 与 API 地址';
    toast('读取模型失败', 'error');
  } finally {
    els.fetchModelsBtn.disabled = false;
  }
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  document.addEventListener('click', function (event) {
    const viewBtn = event.target.closest('[data-view]');
    if (viewBtn) switchView(viewBtn.dataset.view);
  });

  els.modelsToggle.addEventListener('click', openSidebar);
  els.sidebarScrim.addEventListener('click', closeSidebar);
  if (els.sidebarClose) els.sidebarClose.addEventListener('click', closeSidebar);

  if (els.refPickBtn) {
    els.refPickBtn.addEventListener('click', function () { els.refInput.click(); });
  }

  if (els.promptTabs) {
    els.promptTabs.addEventListener('click', function (event) {
      const addBtn = event.target.closest('#addPromptTab');
      if (addBtn) {
        if (state.prompts.length >= 5) return;
        state.prompts[state.activePrompt] = els.promptInput.value;
        state.prompts.push('');
        state.activePrompt = state.prompts.length - 1;
        els.promptInput.value = '';
        renderPromptTabs();
        updateCharCount();
        els.promptInput.focus();
        return;
      }
      const tab = event.target.closest('[data-tab]');
      if (tab) switchPromptTab(Number(tab.dataset.tab));
    });
  }

  if (els.expandPrompt) {
    els.expandPrompt.addEventListener('click', function () {
      const expanded = els.composer.classList.toggle('is-expanded');
      els.expandPrompt.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    });
  }

  if (els.resetCanvas) {
    els.resetCanvas.addEventListener('click', function () {
      state.jobs.clear();
      els.resultGrid.innerHTML = '';
      els.emptyState.style.display = 'flex';
      els.queueText.textContent = '空闲';
      toast('画布已清空', 'info');
    });
  }

  /* 通用下拉：按钮 + 同容器内的 .hm-menu */
  document.addEventListener('click', function (event) {
    const trigger = event.target.closest('.hm-menu-wrap > button[aria-haspopup]');
    if (trigger) {
      const menu = trigger.parentElement.querySelector('.hm-menu');
      toggleMenu(menu, trigger);
      event.stopPropagation();
      return;
    }
    if (!event.target.closest('.hm-menu')) closeAllMenus();
  });

  if (els.engineModelBtn) {
    els.engineModelBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleMenu(els.engineMenu, els.engineBtn);
    });
  }
  if (els.engineMenu) {
    els.engineMenu.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-engine]');
      if (!btn || !ENGINE_META[btn.dataset.engine]) return;
      els.engineSelect.value = btn.dataset.engine;
      els.engineSelect.dispatchEvent(new Event('change'));
      closeAllMenus();
    });
  }

  els.engineSelect.addEventListener('change', function () {
    const value = els.engineSelect.value;
    if (!ENGINE_META[value]) return;
    state.engine = value;
    persistPrefs();
    syncEngineUI();
    if (value !== 'flux' && !hasRayinKey()) {
      toast('该模型需要 RayinAPI 密钥，先完成接入设置', 'info');
      openApiModal();
    } else {
      toast('已切换到 ' + ENGINE_META[value].label, 'success');
    }
  });

  els.apiConfigBtn.addEventListener('click', openApiModal);
  els.apiClose.addEventListener('click', closeApiModal);
  els.apiSave.addEventListener('click', saveRayinConfig);
  els.fetchModelsBtn.addEventListener('click', fetchRayinModels);
  els.apiModal.addEventListener('click', function (event) {
    if (event.target === els.apiModal) closeApiModal();
  });

  els.modelSearch.addEventListener('focus', openSidebar);

  els.modelSearch.addEventListener('input', function (event) {
    openSidebar();
    renderModels(event.target.value);
  });

  els.modelGroups.addEventListener('click', function (event) {
    const groupToggle = event.target.closest('[data-group-toggle]');
    if (groupToggle) {
      const groupEl = groupToggle.closest('.model-group');
      const id = groupEl.dataset.group;
      const collapsed = groupEl.classList.toggle('is-collapsed');
      groupToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (collapsed) state.collapsed.add(id);
      else state.collapsed.delete(id);
      return;
    }

    const modelItem = event.target.closest('[data-model]');
    if (modelItem) selectModel(modelItem.dataset.model);
  });

  els.promptInput.addEventListener('input', updateCharCount);

  els.refDrop.addEventListener('click', function () {
    els.refInput.click();
  });

  els.refDrop.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      els.refInput.click();
    }
  });

  els.refInput.addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0];
    pickRefFile(file);
  });

  els.refRemove.addEventListener('click', function (event) {
    event.stopPropagation();
    clearRefImage();
    toast('已移除参考图', 'info');
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    els.refDrop.addEventListener(type, function (event) {
      event.preventDefault();
      event.stopPropagation();
      els.refDrop.classList.add('is-over');
    });
  });

  els.refDrop.addEventListener('dragleave', function (event) {
    event.preventDefault();
    if (els.refDrop.contains(event.relatedTarget)) return;
    els.refDrop.classList.remove('is-over');
  });

  els.refDrop.addEventListener('drop', function (event) {
    event.preventDefault();
    event.stopPropagation();
    els.refDrop.classList.remove('is-over');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    pickRefFile(file);
  });

  els.inspireBtn.addEventListener('click', function () {
    const current = els.promptInput.value.trim();
    let next = INSPIRATIONS[Math.floor(Math.random() * INSPIRATIONS.length)];
    if (next === current && INSPIRATIONS.length > 1) {
      next = INSPIRATIONS[(INSPIRATIONS.indexOf(next) + 1) % INSPIRATIONS.length];
    }
    els.promptInput.value = next;
    updateCharCount();
    els.promptInput.focus();
    toast('灵感已注入', 'success');
  });

  els.ratioPicker.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-ratio]');
    if (!btn) return;
    state.ratio = btn.dataset.ratio;
    els.ratioPicker.querySelectorAll('.ratio-btn').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.ratio === state.ratio);
    });
    updateRatioLabel();
    persistPrefs();
    closeAllMenus();
  });

  els.scalePicker.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-scale]');
    if (!btn) return;
    if (state.engine !== 'flux') {
      toast('GPT-image 使用固定三档尺寸，清晰度由比例决定', 'info');
      closeAllMenus();
      return;
    }
    state.scale = btn.dataset.scale;
    els.scalePicker.querySelectorAll('button').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.scale === state.scale);
    });
    updateRatioLabel();
    persistPrefs();
    syncSettingsUI();
    closeAllMenus();
  });

  els.countPicker.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-step]');
    if (!btn || btn.disabled) return;
    const next = COUNT_OPTIONS.indexOf(state.count) + Number(btn.dataset.step);
    state.count = COUNT_OPTIONS[clamp(next, 0, COUNT_OPTIONS.length - 1)];
    if (els.countValue) els.countValue.textContent = String(state.count);
    els.countPicker.querySelectorAll('[data-step]').forEach(function (el) {
      const step = Number(el.dataset.step);
      const index = COUNT_OPTIONS.indexOf(state.count);
      el.disabled = step < 0 ? index <= 0 : index >= COUNT_OPTIONS.length - 1;
    });
    persistPrefs();
  });

  els.seedRandom.addEventListener('click', function () {
    state.seed = randomSeed();
    els.seedInput.value = String(state.seed);
    if (els.seedBtn) els.seedBtn.title = '当前种子 #' + state.seed;
    persistPrefs();
    toast('已换一个随机种子', 'info');
  });

  els.seedInput.addEventListener('change', function () {
    state.seed = clamp(Number(els.seedInput.value) || randomSeed(), 1, 2147483647);
    els.seedInput.value = String(state.seed);
    if (els.seedBtn) els.seedBtn.title = '当前种子 #' + state.seed;
    persistPrefs();
  });

  els.stepsRange.addEventListener('input', function () {
    state.steps = Number(els.stepsRange.value);
    updateStepsUI();
    persistPrefs();
  });

  els.translateToggle.addEventListener('click', function () {
    state.translate = !state.translate;
    els.translateToggle.classList.toggle('is-on', state.translate);
    els.translateToggle.setAttribute('aria-checked', state.translate ? 'true' : 'false');
    persistPrefs();
  });

  els.generateBtn.addEventListener('click', handleGenerate);

  els.resultGrid.addEventListener('click', function (event) {
    const card = event.target.closest('[data-job]');
    if (!card) return;
    const job = state.jobs.get(card.dataset.job);
    if (!job) return;

    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'download') downloadImage(job.url, fileNameFor(job));
      else if (action === 'view') openLightbox(job);
      else if (action === 'reuse') reuseJob(job);
      else if (action === 'retry') retryJob(job);
      return;
    }

    if (job.status === 'done' && event.target.closest('.result-media')) openLightbox(job);
  });

  els.worksGrid.addEventListener('click', function (event) {
    const card = event.target.closest('[data-work]');
    if (!card) return;
    const work = state.works.find(function (w) { return w.id === card.dataset.work; });
    if (!work) return;

    const actionEl = event.target.closest('[data-waction]');
    if (actionEl) {
      const action = actionEl.dataset.waction;
      if (action === 'download') downloadImage(work.url || work.thumb, fileNameFor(work));
      else if (action === 'view') openLightbox(work);
      else if (action === 'delete') {
        state.works = state.works.filter(function (w) { return w.id !== work.id; });
        saveWorks();
        renderWorks();
        toast('作品已删除', 'info');
      }
      return;
    }

    openLightbox(work);
  });

  els.clearWorks.addEventListener('click', function () {
    if (!state.works.length) return;
    if (!window.confirm('确定清空全部作品吗？此操作不可撤销。')) return;
    state.works = [];
    saveWorks();
    renderWorks();
    toast('已清空作品', 'info');
  });

  if (els.worksSortMenu) {
    els.worksSortMenu.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-sort]');
      if (!btn) return;
      state.worksSort = btn.dataset.sort;
      els.worksSortMenu.querySelectorAll('[data-sort]').forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.sort === state.worksSort);
      });
      renderWorks();
      closeAllMenus();
      switchView('works');
    });
  }

  if (els.worksFilterMenu) {
    els.worksFilterMenu.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-filter]');
      if (!btn) return;
      state.worksFilter = btn.dataset.filter;
      els.worksFilterMenu.querySelectorAll('[data-filter]').forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.filter === state.worksFilter);
      });
      if (els.worksFilterText) {
        els.worksFilterText.textContent = btn.textContent;
      }
      renderWorks();
      closeAllMenus();
      switchView('works');
    });
  }

  els.lbClose.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('click', function (event) {
    if (event.target === els.lightbox) closeLightbox();
  });
  els.lbDownload.addEventListener('click', function () {
    if (!state.activeItem) return;
    downloadImage(state.activeItem.url || state.activeItem.thumb, fileNameFor(state.activeItem));
  });

  els.helpBtn.addEventListener('click', function () {
    els.helpModal.classList.add('is-open');
    els.helpModal.setAttribute('aria-hidden', 'false');
  });
  els.helpClose.addEventListener('click', function () {
    els.helpModal.classList.remove('is-open');
    els.helpModal.setAttribute('aria-hidden', 'true');
  });
  els.helpDone.addEventListener('click', function () {
    els.helpModal.classList.remove('is-open');
    els.helpModal.setAttribute('aria-hidden', 'true');
    switchView('create');
  });
  els.helpModal.addEventListener('click', function (event) {
    if (event.target === els.helpModal) {
      els.helpModal.classList.remove('is-open');
      els.helpModal.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeLightbox();
      els.helpModal.classList.remove('is-open');
      els.helpModal.setAttribute('aria-hidden', 'true');
      closeApiModal();
      closeSidebar();
      closeAllMenus();
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleGenerate();
    }
  });
}

/* ---------------- 启动 ---------------- */
function boot() {
  bindEls();
  renderModels('');
  renderRatios();
  renderWorks();
  syncSettingsUI();
  bindEvents();

  // 首次打开时给出轻量引导提示
  if (!storedPrefs || !storedPrefs.modelId) {
    setTimeout(function () {
      toast('已接入 FLUX.1 免费动漫引擎，选风格即可开始', 'success');
    }, 800);
  }
}

boot();
