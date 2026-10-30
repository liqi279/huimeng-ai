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

/* RayinAPI 接入（GPT-image / Gemini Banana）
 * 后端默认已配置用户提供的 RayinAI key + gemini-3.1-flash-image，
 * 前端可在「接入设置」里覆盖 key 和模型 ID */
const RAYIN_DEFAULT = {
  base: 'https://www.rayinai.com/v1',
  key: '',
  gptModel: 'gemini-3-pro-image',
  bananaModel: 'gemini-3.1-flash-image'
};

const ENGINE_META = {
  flux: { label: 'FLUX.1', pill: 'FLUX.1 · 免费', hint: '免费 · 约 10 秒', meta: 'FLUX.1', free: true },
  openai: { label: '免费模型平台', pill: '免费额度 · 第三方', hint: '免费额度 · 需平台密钥', meta: 'Third-party', free: true },
  'gpt-image': { label: 'GPT-image', pill: 'GPT-image · RayinAPI', hint: 'RayinAPI · 按量计费', meta: 'GPT-image', free: false },
  banana: { label: 'Gemini Banana', pill: 'Gemini Banana · RayinAI', hint: 'RayinAI · Gemini 2.0 多模态生图', meta: 'Gemini Banana', free: false }
};

/* 免费模型目录（启动时从后端 /catalog 拉取，拉不到就用内置兜底） */
const CATALOG_FALLBACK = {
  keyless: [
    { id: 'flux-anime', engine: 'flux', model: 'flux-anime', name: 'FLUX Anime', badge: '免密钥', hint: '二次元插画 · 高质量' },
    { id: 'kolors', engine: 'flux', model: 'kolors', name: 'Kolors 中文动漫', badge: '免密钥', hint: '中文提示词强 · 国风' },
    { id: 'sana', engine: 'flux', model: 'sana', name: 'SANA 动漫', badge: '免密钥', hint: '免费 · 秒级出图' },
    { id: 'flux', engine: 'flux', model: 'flux', name: 'FLUX.1', badge: '免密钥', hint: '通用大模型 · 高质量' },
    { id: 'flux-realism', engine: 'flux', model: 'flux-realism', name: 'FLUX Realism', badge: '免密钥', hint: '写实质感 · 细腻' },
  ],
  providers: [],
  loras: [],
  rayin: [
    /* GPT 图像模型（OpenAI key → /images/generations） */
    { id: 'gpt-image-2', engine: 'gpt-image', model: 'gpt-image-2', name: 'GPT Image 2', badge: 'GPT · 标准', hint: '稳定通用 · OpenAI 原生生图' },
    { id: 'gpt-image-2.5-flare', engine: 'gpt-image', model: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', badge: 'GPT · 光影增强', hint: '光影绚丽 · 氛围渲染' },
    { id: 'gpt-image-2.5-sunburst', engine: 'gpt-image', model: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', badge: 'GPT · 细节爆发', hint: '高细节 · 锐度爆发' },
    /* Gemini 图像模型（Gemini key → /chat/completions） */
    { id: 'gemini-3-pro-image', engine: 'banana', model: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image', badge: 'Gemini · Pro', hint: '最高质量 · 精细渲染' },
    { id: 'gemini-3.1-flash-image', engine: 'banana', model: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', badge: 'Gemini · Flash', hint: '速度最快 · 平衡质量' },
    { id: 'gemini-3.1-flash-lite-image', engine: 'banana', model: 'gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash Lite Image', badge: 'Gemini · Lite', hint: '最轻量 · 秒级响应' },
  ]
};

const TRANSLATE_API = 'https://text.pollinations.ai/';
/* 免费额度用尽时的兜底通道（图片带水印，仅在主通道不可用时使用） */
const FALLBACK_API = 'https://image.pollinations.ai/prompt/';

const LS_WORKS = 'anidream.works.v1';
const LS_WORKS_BAK = 'anidream.works.v1.bak';
const LS_PREFS = 'anidream.prefs.v1';
const LS_API = 'anidream.rayin.v1';
const LS_PROVIDERS = 'anidream.providers.v1';
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
/* 历史错误模型 ID 迁移：gpt-image-1 / 伪别名 gpt-image-2-all 等 → 官方 gpt-image-2 */
if (!storedApi.gptModel || /gpt-image-2-all|gpt-image-lite/.test(storedApi.gptModel)) {
  storedApi.gptModel = RAYIN_DEFAULT.gptModel;
} else if (storedApi.gptModel === 'gpt-image-1') {
  storedApi.gptModel = 'gpt-image-1';
}

/* 后端 API 客户端快捷引用（api.js 挂载在 window.HM.api） */
var api = window.HM && window.HM.api;

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
  channelModel: typeof storedPrefs.channelModel === 'string' && storedPrefs.channelModel
    ? storedPrefs.channelModel
    : 'sana',                          // 免费通道模型 ID（sana / 第三方模型 ID）
  lora: typeof storedPrefs.lora === 'string' ? storedPrefs.lora : '',   // 动漫 LoRA 风格包 ID
  videoModel: typeof storedPrefs.videoModel === 'string' && storedPrefs.videoModel
    ? storedPrefs.videoModel
    : 'sora-2',
  audioModel: typeof storedPrefs.audioModel === 'string' && storedPrefs.audioModel
    ? storedPrefs.audioModel
    : 'tts-1',
  providerId: typeof storedPrefs.providerId === 'string' && storedPrefs.providerId
    ? storedPrefs.providerId
    : 'siliconflow',
  providers: loadJSON(LS_PROVIDERS, {}) || {},
  catalog: CATALOG_FALLBACK,
  api: Object.assign({}, RAYIN_DEFAULT, storedApi),
  works: Array.isArray(storedWorks)
    ? storedWorks.filter(function (w) { return w && (w.url || w.blob); }).slice(0, MAX_WORKS)
    : [],
  generating: false,
  jobs: new Map(),
  ticker: null,
  activeItem: null,
  collapsed: new Set(),
  translationCache: new Map(),
  refImages: [],                      // 兼容旧 key（单个 tab 的遗留）
  tabRefs: [[]],                      // 每个 prompt tab 独立的参考图 [{dataUrl,width,height,weight,name}]
  tabRefWeights: [70],                // 每个 tab 全局参考主体强度
  fontSize: 13,
  refWeight: 70,
  prompts: ['', ''],
  tabPrompts: ['', ''],               // 与 prompts 保持一致（prompts 是 tabPrompts 的别名）
  activePrompt: 0,
  worksSort: 'newest',
  worksFilter: 'all',
  mode: 'image',
  duration: 5,
  voice: 'alloy',
  audioFormat: 'wav',
  sampleRate: 48000
};

/* ========== tab 状态辅助器 ==========
 * 每个 prompt tab 独立的 refs + refWeight。
 * tabRefs[i] / tabRefWeights[i] 分别对应 state.prompts[i]。
 */
function ensureTabSlots() {
  while (state.tabRefs.length < state.prompts.length) state.tabRefs.push([]);
  while (state.tabRefWeights.length < state.prompts.length) state.tabRefWeights.push(70);
}
ensureTabSlots();
/* 迁移遗留：旧版全局 state.refImages 放进 tab 0 */
if (Array.isArray(state.refImages) && state.refImages.length > 0 &&
    (!state.tabRefs[0] || state.tabRefs[0].length === 0)) {
  state.tabRefs[0] = state.refImages.map(function (r) {
    return Object.assign({ weight: 70 }, r);
  });
}
/* 当前激活 tab 的 refs */
function currentRefs() {
  ensureTabSlots();
  return state.tabRefs[state.activePrompt] || [];
}
function setCurrentRefs(arr) {
  ensureTabSlots();
  state.tabRefs[state.activePrompt] = arr || [];
  state.refImages = state.tabRefs[0].slice(); /* 兼容旧字段 */
  _acKey = ''; /* 参考图变了，补全列表与 chip 缓存失效 */
  _chipCacheKey = '';
  schedulePromptOverlay();
}
function currentTabRefWeight() {
  ensureTabSlots();
  return state.tabRefWeights[state.activePrompt] != null ? state.tabRefWeights[state.activePrompt] : 70;
}
function setCurrentTabRefWeight(v) {
  ensureTabSlots();
  state.tabRefWeights[state.activePrompt] = v;
  state.refWeight = v; /* 兼容旧字段 */
}

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
  els.refGrid = document.getElementById('refGrid');
  els.refEmpty = document.getElementById('refEmpty');
  els.refPreview = document.getElementById('refPreview'); /* 已废弃，保留兼容 */
  els.refImage = document.getElementById('refImage');
  els.refRemove = document.getElementById('refRemove');
  els.refState = document.getElementById('refState');
  els.refNote = document.getElementById('refNote');
  /* 新的参考图区域元素 */
  els.refRightBar = document.getElementById('refRightBar');
  els.refSelectBtn = document.getElementById('refSelectBtn');
  els.refClearBtn = document.getElementById('refClearBtn');
  els.refSelectToolbar = document.getElementById('refSelectToolbar');
  els.refSelectCount = document.getElementById('refSelectCount');
  els.refSelectCancel = document.getElementById('refSelectCancel');
  els.refSelectDelete = document.getElementById('refSelectDelete');
  els.refSelectClear = document.getElementById('refSelectClear');
  els.refHover = document.getElementById('refHover');
  els.refFullscreen = document.getElementById('refFullscreen');
  els.refFsImg = document.getElementById('refFsImg');
  els.refFsIdx = document.getElementById('refFsIdx');
  els.refFsClose = document.getElementById('refFsClose');
  els.refFsZoomIn = document.getElementById('refFsZoomIn');
  els.refFsZoomOut = document.getElementById('refFsZoomOut');
  els.refFsReset = document.getElementById('refFsReset');
  els.refFsDownload = document.getElementById('refFsDownload');

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
  els.modeMenu = document.getElementById('modeMenu');
  els.modelMenu = document.getElementById('modelMenu');
  els.freeModelList = document.getElementById('freeModelList');
  els.rayinModelList = document.getElementById('rayinModelList');
  els.loraList = document.getElementById('loraList');
  els.providerSelect = document.getElementById('providerSelect');
  els.providerBaseInput = document.getElementById('providerBaseInput');
  els.providerKeyInput = document.getElementById('providerKeyInput');
  els.providerModelInput = document.getElementById('providerModelInput');
  els.providerKeyLink = document.getElementById('providerKeyLink');
  els.providerSave = document.getElementById('providerSave');
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
  const detail = size.scale.label + ' · ' + size.w + '×' + size.h;
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

/* 作品卡片按类型渲染图片 / 视频 / 音频 */
function workMediaHtml(work) {
  var url = esc(work.url || work.thumb || '');
  if (work.type === 'video') {
    return '<video class="work-video" src="' + url + '" muted playsinline preload="metadata"></video>';
  }
  if (work.type === 'audio') {
    return '<div class="work-audio">♪</div>';
  }
  return '<img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy">';
}

function renderWorks() {
  const total = state.works.length;
  els.worksBadge.textContent = String(total);
  if (els.worksTotal) els.worksTotal.textContent = String(total);
  els.stageResultCount.textContent = total + ' 张作品';

  const railBadge = document.getElementById('railWorksBadge');
  if (railBadge) railBadge.textContent = String(total);

  const list = filteredWorks();

  if (!list.length) {
    els.worksGrid.innerHTML = '';
    els.worksEmpty.style.display = 'flex';
  } else {
    els.worksEmpty.style.display = 'none';
    els.worksGrid.innerHTML = list.map(function (work) {
      return '<article class="work-card" data-work="' + work.id + '">' +
        workMediaHtml(work) +
        '<div class="work-overlay">' +
          '<button data-waction="download" title="下载原图">' + ICONS.download + '</button>' +
          '<button data-waction="view" title="查看大图">' + ICONS.eye + '</button>' +
          '<button data-waction="delete" title="删除">' + ICONS.trash + '</button>' +
        '</div>' +
        '<div class="work-meta"><span>' + esc(work.modelName || 'AI') + '</span><span>' + esc(work.seed || '') + '</span></div>' +
      '</article>';
    }).join('');
  }

  if (window.HMUI && window.HMUI.onRenderWorks) window.HMUI.onRenderWorks(total);
  if (window.HMDesk && window.HMDesk.onWorksChanged) window.HMDesk.onWorksChanged();
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
  ensureTabSlots();
  els.promptInput.value = state.prompts[index];
  renderPromptTabs();
  renderRef(); /* ← 切换 tab 时切换独立的 ref 网格 */
  applyRefWeightUI(currentTabRefWeight()); /* ← 同步 ref 强度 slider */
  updateCharCount();
}

/* 新增 tab 时也要同步 refs 插槽 */
function addPromptTab() {
  if (state.prompts.length >= 5) return;
  ensureTabSlots();
  state.prompts[state.activePrompt] = els.promptInput.value;
  state.prompts.push('');
  state.tabRefs.push([]);
  state.tabRefWeights.push(70);
  state.activePrompt = state.prompts.length - 1;
  els.promptInput.value = '';
  renderPromptTabs();
  renderRef();
  applyRefWeightUI(currentTabRefWeight());
  updateCharCount();
  els.promptInput.focus();
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

/* ---------------- 免费模型目录 ---------------- */
function catalogData() {
  return state.catalog || CATALOG_FALLBACK;
}

function findChannelModel(modelId) {
  const keyless = catalogData().keyless || [];
  const hit = keyless.find(function (m) { return m.model === modelId || m.id === modelId; });
  if (hit) return hit;
  let found = null;
  (catalogData().providers || []).forEach(function (p) {
    (p.models || []).forEach(function (m) {
      if (!found && m.id === modelId) found = Object.assign({ providerId: p.id }, m);
    });
  });
  return found;
}

function findLora(id) {
  return (catalogData().loras || []).find(function (l) { return l.id === id; }) || null;
}

function providerConfig(providerId) {
  const id = providerId || state.providerId;
  const preset = (catalogData().providers || []).find(function (p) { return p.id === id; }) || null;
  const saved = (state.providers && state.providers[id]) || {};
  return {
    id: id,
    preset: preset,
    base: saved.base || (preset && preset.base) || '',
    key: saved.key || '',
    model: saved.model || (preset && preset.models && preset.models[0] ? preset.models[0].id : '')
  };
}

/* ---------------- 免费额度平台设置 ---------------- */
function normalizeProviderBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return /\/v\d+[a-z]*$/i.test(base) ? base : base + '/v1';
}

function renderProviderSelect() {
  if (!els.providerSelect) return;
  const providers = catalogData().providers || [];
  const rows = providers.map(function (p) {
    return '<option value="' + p.id + '">' + p.name + ' · 免费额度</option>';
  });
  rows.push('<option value="custom">自定义 OpenAI 兼容平台</option>');
  els.providerSelect.innerHTML = rows.join('');
  els.providerSelect.value = state.providerId;
}

function fillProviderFields(providerId) {
  const cfg = providerConfig(providerId);
  if (els.providerBaseInput) els.providerBaseInput.value = cfg.base || '';
  if (els.providerKeyInput) els.providerKeyInput.value = cfg.key || '';
  if (els.providerModelInput) els.providerModelInput.value = cfg.model || '';
  if (els.providerKeyLink) {
    const url = (cfg.preset && cfg.preset.keyUrl) || 'https://cloud.siliconflow.cn/account/ak';
    els.providerKeyLink.href = url;
    els.providerKeyLink.textContent = cfg.preset
      ? '前往 ' + cfg.preset.name + ' 获取密钥'
      : '获取密钥';
  }
}

function saveProviderConfig() {
  if (!els.providerSelect) return;
  const id = els.providerSelect.value;
  const base = normalizeProviderBase(els.providerBaseInput.value);
  const key = els.providerKeyInput.value.trim();
  const model = els.providerModelInput.value.trim();

  if (!base) { toast('请填写平台接口地址', 'error'); els.providerBaseInput.focus(); return; }
  if (!key) { toast('请填写该平台的 API Key', 'error'); els.providerKeyInput.focus(); return; }

  state.providers[id] = { base: base, key: key, model: model };
  state.providerId = id;
  if (model) state.channelModel = model;
  saveJSON(LS_PROVIDERS, state.providers);
  persistPrefs();
  syncEngineUI();
  toast('平台配置已保存，可在「生图」菜单选择该平台模型', 'success');
}

/* 当前模型显示名（胶囊 / 提示用） */
function currentModelLabel() {
  const lora = findLora(state.lora);
  let base = '';
  if (state.engine === 'flux') {
    const ch = findChannelModel(state.channelModel);
    base = ch ? ch.name : 'SANA 动漫';
  } else if (state.engine === 'openai') {
    const model = findChannelModel(state.channelModel);
    const cfg = providerConfig();
    base = model ? model.name : (cfg.preset ? cfg.preset.name : '免费模型平台');
  } else {
    base = ENGINE_META[state.engine] ? ENGINE_META[state.engine].label : 'FLUX.1';
  }
  return lora ? base + ' · ' + lora.name : base;
}

/* 视频 / 音频可选模型 */
const MEDIA_MODELS = {
  video: [['sora-2', 'Sora 2'], ['sora-2-pro', 'Sora 2 Pro'], ['veo-3', 'Veo 3']],
  audio: [['tts-1', 'TTS-1'], ['tts-1-hd', 'TTS-1 HD'], ['gpt-4o-mini-tts', 'GPT-4o mini TTS']]
};

/* 当前模式对应的模型显示名（图片 / 视频 / 音频各一套） */
function modeModelLabel(mode) {
  const m = mode || state.mode || 'image';
  if (m === 'image') return currentModelLabel();
  const list = MEDIA_MODELS[m] || [];
  const id = m === 'video' ? state.videoModel : state.audioModel;
  const hit = list.filter(function (x) { return x[0] === id; })[0];
  return hit ? hit[1] : id;
}

/* 菜单里用的短名，避免胶囊被撑长 */
function shortModelName(name) {
  return String(name || '')
    .replace(' 中文动漫', '')
    .replace('FLUX.1 schnell Free', 'FLUX Free')
    .replace('FLUX.1 schnell', 'FLUX schnell')
    .replace('FLUX.1-', 'FLUX ')
    .trim();
}

/* 模型菜单：免密钥通道 + 免费额度平台模型 + 动漫 LoRA 风格 */
function renderCatalogMenus() {
  const data = catalogData();

  if (els.freeModelList) {
    const rows = [];
    (data.keyless || []).forEach(function (m) {
      rows.push('<button data-engine="flux" data-model="' + m.model + '" title="' +
        (m.desc || m.name) + '">' + shortModelName(m.name) + '</button>');
    });
    (data.providers || []).forEach(function (p) {
      (p.models || []).forEach(function (m) {
        rows.push('<button data-engine="openai" data-provider="' + p.id + '" data-model="' + m.id +
          '" title="' + p.name + ' · ' + m.id + '">' + shortModelName(m.name) + '</button>');
      });
    });
    els.freeModelList.innerHTML = rows.join('') ||
      '<p class="hm-menu-note">后端离线，暂无在线模型目录</p>';
  }

  /* RayinAI 模型 — 从后端 rayin 数组动态渲染，每个模型独立按钮 */
  if (els.rayinModelList) {
    const rows = [];
    (data.rayin || []).forEach(function (m) {
      rows.push('<button data-engine="' + m.engine + '" data-model="' + m.model +
        '" title="' + (m.badge || '') + ' · ' + (m.hint || '') + '">' + m.name + '</button>');
    });
    els.rayinModelList.innerHTML = rows.join('') ||
      '<p class="hm-menu-note">RayinAI 暂无可用图像模型</p>';
  }

  if (els.loraList) {
    const rows = ['<button data-lora="">无</button>'];
    (data.loras || []).forEach(function (l) {
      rows.push('<button data-lora="' + l.id + '" title="' + (l.tag || 'LoRA') + '">' + l.name + '</button>');
    });
    els.loraList.innerHTML = rows.join('');
  }

  syncEngineUI();
}

async function loadCatalog() {
  if (!window.HM || !window.HM.api || !window.HM.api.online) return;
  try {
    const data = await window.HM.api.catalog();
    if (!data) return;
    state.catalog = {
      keyless: data.keyless || [],
      providers: data.providers || [],
      rayin: data.rayin || [],
      loras: data.loras || []
    };
    renderCatalogMenus();
  } catch (err) { /* 保留内置兜底目录 */ }
}

function syncEngineUI() {
  const meta = ENGINE_META[state.engine] || ENGINE_META.flux;
  els.engineSelect.value = state.engine;
  els.composerEngineNote.textContent = meta.free ? currentModelLabel() + ' · 免费' : meta.label + ' · RayinAPI';
  if (!state.generating) els.genHint.textContent = meta.hint;
  els.planTag.textContent = meta.free ? 'FREE' : 'API';
  els.composerNotice.textContent = meta.free
    ? '免费通道 · 无水印 · 生成后可直接下载原图'
    : 'RayinAPI 按量计费 · 生成后可直接下载原图';
  document.body.dataset.engine = state.engine;

  if (state.engine === 'flux') {
    els.engineNote.textContent = '免费通道，无需密钥即可生成';
    els.engineNote.classList.remove('is-warn');
  } else if (state.engine === 'openai') {
    const cfg = providerConfig();
    if (cfg.key) {
      els.engineNote.textContent = cfg.preset
        ? cfg.preset.name + ' · ' + cfg.model + ' · 密钥仅保存在本机'
        : '免费额度平台 · 密钥仅保存在本机';
      els.engineNote.classList.remove('is-warn');
    } else {
      els.engineNote.textContent = '尚未配置该平台 API Key，点击右上「接入设置」';
      els.engineNote.classList.add('is-warn');
    }
  } else if (hasRayinKey()) {
    els.engineNote.textContent = '密钥已配置 · 按量计费，仅保存在本机';
    els.engineNote.classList.remove('is-warn');
  } else {
    els.engineNote.textContent = '尚未配置 RayinAPI 密钥，点击右上「接入设置」';
    els.engineNote.classList.add('is-warn');
  }

  updateRatioLabel();
  syncRefNote();

  if (els.enginePillText) els.enginePillText.textContent = shortModelName(modeModelLabel().split(' · ')[0]);

  if (els.modelMenu) {
    els.modelMenu.querySelectorAll('[data-engine]').forEach(function (btn) {
      const sameEngine = btn.dataset.engine === state.engine;
      const sameModel = !btn.dataset.model || btn.dataset.model === state.channelModel;
      btn.classList.toggle('is-active', sameEngine && sameModel);
    });
    els.modelMenu.querySelectorAll('[data-lora]').forEach(function (btn) {
      btn.classList.toggle('is-active', (btn.dataset.lora || '') === (state.lora || ''));
    });
    els.modelMenu.querySelectorAll('[data-vmodel]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.vmodel === state.videoModel);
    });
    els.modelMenu.querySelectorAll('[data-amodel]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.amodel === state.audioModel);
    });
  }

  if (els.engineModelBtn) {
    els.engineModelBtn.title = modeModelLabel() + (meta.free ? ' · 免费通道' : ' · RayinAPI 按量计费');
  }
  if (els.scaleBtn) {
    els.scaleBtn.title = '生成清晰度：1K / 2K / 4K';
  }
}

/* ---------------- 参考图（图生图） ---------------- */
const REF_MAX_BYTES = 10 * 1024 * 1024;
const REF_MAX_SIDE = 1280;
const REF_MAX_COUNT = 10;

function syncRefNote() {
  if (!els.refNote) return;
  const count = currentRefs().length;

  if (count === 0) {
    els.refNote.textContent = '当前描述 · 支持多参考图 · 提示词中用 @1 @2 @3 等引用（最多 ' + REF_MAX_COUNT + ' 张）';
    els.refNote.classList.remove('is-warn');
  } else {
    els.refNote.textContent = '当前描述已添加 ' + count + ' 张参考图 · 每张图下方可调节主体强度 · 用 @1~@' + count + ' 在提示词中指定';
    els.refNote.classList.remove('is-warn');
  }
}

/* ========== 参考图区域状态 ========== */
var _refSelectMode = false;       /* 是否进入选择素材模式 */
var _refSelectedSet = {};         /* 已选择索引 {0:true, 2:true, ...} */
var _refFsIdx = -1;               /* 全屏查看的参考索引 */
var _refFsScale = 1;              /* 全屏缩放比例 */

function enterRefSelectMode() {
  _refSelectMode = true;
  _refSelectedSet = {};
  document.body.setAttribute('data-ref-select', '1');
  renderRef();
}
function exitRefSelectMode() {
  _refSelectMode = false;
  _refSelectedSet = {};
  document.body.removeAttribute('data-ref-select');
  renderRef();
}
function toggleRefSelected(idx) {
  if (_refSelectedSet[idx]) delete _refSelectedSet[idx];
  else _refSelectedSet[idx] = true;
  renderRef();
}
function deleteSelectedRefs() {
  var list = currentRefs();
  /* 从大到小删，避免索引错位 */
  var toDelete = Object.keys(_refSelectedSet).map(Number).sort(function (a, b) { return b - a; });
  if (!toDelete.length) return;
  toDelete.forEach(function (idx) { list.splice(idx, 1); });
  setCurrentRefs(list);
  exitRefSelectMode();
  toast('已删除 ' + toDelete.length + ' 张参考图', 'info');
}

/* ========== 全屏查看 ========== */
function openRefFullscreen(idx) {
  var list = currentRefs();
  if (!list[idx]) return;
  _refFsIdx = idx;
  _refFsScale = 1;
  if (els.refFsImg) els.refFsImg.style.transform = 'scale(1)';
  if (els.refFsImg) els.refFsImg.src = list[idx].dataUrl;
  if (els.refFsIdx) els.refFsIdx.textContent = '@' + (idx + 1);
  if (els.refFullscreen) els.refFullscreen.hidden = false;
}
function closeRefFullscreen() {
  _refFsIdx = -1;
  _refFsScale = 1;
  if (els.refFsImg) els.refFsImg.style.transform = 'scale(1)';
  if (els.refFullscreen) els.refFullscreen.hidden = true;
}

/* ========== hover 浮层 ========== */
var _refHoverIdx = -1;
var _refHoverEnterTimer = 0;
function showRefHover(idx, anchorEl) {
  var list = currentRefs();
  if (!list[idx] || _refSelectMode) return;
  _refHoverIdx = idx;
  if (!els.refHover) return;
  els.refHover.querySelector('img').src = list[idx].dataUrl;
  els.refHover.hidden = false;
  /* 位置：anchorEl 右侧或下侧，避免超出视口 */
  var r = anchorEl.getBoundingClientRect();
  var hoverW = 140, hoverH = 156;
  var top = r.bottom + 6;
  var left = r.left;
  if (top + hoverH > window.innerHeight) top = r.top - hoverH - 6;
  if (left + hoverW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - hoverW - 8);
  if (left < 8) left = 8;
  els.refHover.style.top = top + 'px';
  els.refHover.style.left = left + 'px';
}
function hideRefHover() {
  if (_refHoverEnterTimer) { clearTimeout(_refHoverEnterTimer); _refHoverEnterTimer = 0; }
  _refHoverIdx = -1;
  if (els.refHover) els.refHover.hidden = true;
}

/* ========== renderRef（完全重写） ========== */
function renderRef() {
  var list = currentRefs();
  var hasRef = list.length > 0;

  /* 渲染网格 */
  if (els.refGrid) {
    els.refGrid.innerHTML = '';
    list.forEach(function (ref, idx) {
      var cell = document.createElement('div');
      cell.className = 'hm-ref-cell';
      cell.dataset.idx = String(idx);
      if (_refSelectedSet[idx]) cell.classList.add('is-selected');

      var check = _refSelectMode
        ? '<div class="hm-ref-check' + (_refSelectedSet[idx] ? ' is-on' : '') + '" data-check-idx="' + idx + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</div>'
        : '';

      cell.innerHTML =
        '<img alt="参考图 ' + (idx + 1) + '" src="' + (ref.thumb || ref.dataUrl) + '">' +
        '<span class="hm-ref-tag">图' + (idx + 1) + '</span>' +
        check;

      /* 事件：选择模式下点击 cell = toggle 选中；否则点击 = 打开全屏 */
      cell.addEventListener('click', function (ev) {
        if (_refSelectMode) {
          ev.stopPropagation();
          toggleRefSelected(idx);
          return;
        }
        openRefFullscreen(idx);
      });

      /* hover 浮层（非选择模式才显示）：鼠标enter 延迟一点避免闪烁 */
      if (!_refSelectMode) {
        cell.addEventListener('mouseenter', function () {
          if (_refHoverEnterTimer) clearTimeout(_refHoverEnterTimer);
          _refHoverEnterTimer = setTimeout(function () {
            showRefHover(idx, cell);
          }, 120);
        });
        cell.addEventListener('mouseleave', function () {
          if (_refHoverEnterTimer) { clearTimeout(_refHoverEnterTimer); _refHoverEnterTimer = 0; }
          /* 延迟隐藏，让用户能移到浮层上 */
          setTimeout(function () {
            if (_refHoverIdx === idx && els.refHover && !els.refHover.matches(':hover')) hideRefHover();
          }, 180);
        });
      }

      els.refGrid.appendChild(cell);
    });

    /* "+" 槽位 */
    if (list.length < REF_MAX_COUNT && !_refSelectMode) {
      var addCell = document.createElement('div');
      addCell.className = 'hm-ref-cell hm-ref-add';
      addCell.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' +
        '<span>' + list.length + '/' + REF_MAX_COUNT + '</span>';
      addCell.addEventListener('click', function (ev) {
        ev.stopPropagation();
        els.refInput.click();
      });
      els.refGrid.appendChild(addCell);
    }

    els.refGrid.hidden = !hasRef;
  }

  /* 右侧工具条（有素材且非选择模式时显示） */
  if (els.refRightBar) els.refRightBar.hidden = !hasRef || _refSelectMode;

  /* 选择模式顶部工具条 */
  if (els.refSelectToolbar) {
    els.refSelectToolbar.hidden = !_refSelectMode;
    if (els.refSelectCount) {
      var selCount = Object.keys(_refSelectedSet).length;
      els.refSelectCount.textContent = '已选 ' + selCount;
    }
  }

  /* 更新 overlay chip 层 */
  renderPromptOverlay();

  /* 顶部状态文字 */
  if (els.refState) {
    if (hasRef) {
      els.refState.textContent = list.length + '/' + REF_MAX_COUNT;
      els.refState.style.color = '#c4b5fd';
    } else {
      els.refState.textContent = '未添加';
      els.refState.style.color = '';
    }
  }

  /* 空/满 状态 */
  if (els.refDrop) {
    if (hasRef) {
      els.refDrop.classList.add('has-ref');
      if (els.refEmpty) els.refEmpty.hidden = true;
    } else {
      els.refDrop.classList.remove('has-ref');
      if (els.refEmpty) els.refEmpty.hidden = false;
    }
  }

  syncRefNote();
}

/* ========== @N 富文本 chip overlay ==========
 * 保留 textarea 原生纯文本 + 光标，在上面盖一层透明 div 把 @N 替换成带图标的 chip。
 * Slack / Notion 的成熟方案，既保留 textarea 的 selection/undo 又有富文本视觉。 */
var _promptOverlayEl = null;

function _ensurePromptOverlay() {
  if (_promptOverlayEl && document.body.contains(_promptOverlayEl)) return _promptOverlayEl;
  var ta = els.promptInput;
  if (!ta) return null;
  var wrap = ta.closest('.hm-prompt');
  if (!wrap) return null;
  wrap.style.position = 'relative';

  _promptOverlayEl = document.createElement('div');
  _promptOverlayEl.className = 'hm-prompt-overlay';
  /* 字号/行高/字体必须与 textarea 完全一致（含内联样式），否则 chip 与光标错位 */
  var cs = window.getComputedStyle(ta);
  _promptOverlayEl.style.fontSize = cs.fontSize;
  _promptOverlayEl.style.lineHeight = cs.lineHeight;
  _promptOverlayEl.style.fontFamily = cs.fontFamily;
  _promptOverlayEl.style.letterSpacing = cs.letterSpacing;
  /* 插在 textarea 前面，保证 textarea 在 overlay 之上 */
  wrap.insertBefore(_promptOverlayEl, ta);
  return _promptOverlayEl;
}

/* chip 的 HTML 只在参考图变化时重建一次，避免每次输入都重新解码图片 */
var _chipCacheKey = '';
var _chipCacheHtml = [];

function _escPromptHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function _refsSignature(refs) {
  var s = '';
  for (var i = 0; i < refs.length; i++) {
    var url = refs[i].dataUrl || '';
    s += i + ':' + url.length + ':' + url.slice(-16) + ';';
  }
  return s;
}

function _ensureChipCache(refs) {
  var key = _refsSignature(refs);
  if (key === _chipCacheKey) return _chipCacheHtml;
  _chipCacheKey = key;
  _chipCacheHtml = refs.map(function (ref, i) {
    var u = ref.thumb || ref.dataUrl;
    /* chip 顺序：图标在前，@图N 在后，整体 inline-flex */
    return '<span class="chip"><span class="chip-thumb" style="background-image:url(' + u + ')"></span><span class="chip-label">@' + (i + 1) + '</span></span>';
  });
  return _chipCacheHtml;
}

function renderPromptOverlay() {
  var ta = els.promptInput;
  if (!ta) return;
  var overlay = _ensurePromptOverlay();
  if (!overlay) return;

  var refs = currentRefs();
  var text = ta.value || '';
  if (!refs.length || !text) {
    overlay.style.display = 'none';
    ta.style.color = ''; /* 恢复正常颜色 */
    return;
  }
  /* 有 refs：textarea 文字透明（只留光标），overlay 画真实文字 + chip */
  ta.style.color = 'transparent';
  ta.style.caretColor = '#dbe7f3';
  overlay.style.display = 'block';
  overlay.scrollTop = ta.scrollTop;

  var chips = _ensureChipCache(refs);
  var html = _escPromptHtml(text).replace(/@(\d+)(?![0-9])/g, function (match, n) {
    return chips[Number(n) - 1] || match;
  });
  overlay.innerHTML = html || ' ';
}

var _overlayRaf = 0;
function schedulePromptOverlay() {
  if (_overlayRaf) return;
  _overlayRaf = window.requestAnimationFrame(function () {
    _overlayRaf = 0;
    renderPromptOverlay();
  });
}

function bindPromptOverlayEvents() {
  var ta = els.promptInput;
  if (!ta) return;
  ta.addEventListener('input', schedulePromptOverlay);
  ta.addEventListener('scroll', schedulePromptOverlay);
  ta.addEventListener('paste', function () {
    schedulePromptOverlay();
  });
}

function removeRefAt(idx) {
  var arr = currentRefs();
  arr.splice(idx, 1);
  setCurrentRefs(arr);
  els.refInput.value = '';
  /* 清除选择态、关闭全屏（如果删的是当前全屏图） */
  delete _refSelectedSet[idx];
  var nextSel = {};
  Object.keys(_refSelectedSet).forEach(function (k) {
    var ki = Number(k);
    if (ki < idx) nextSel[ki] = true;
    else if (ki > idx) nextSel[ki - 1] = true;
  });
  _refSelectedSet = nextSel;
  if (_refFsIdx === idx) closeRefFullscreen();
  hideRefHover();
  renderRef();
  toast('已删除参考图 #' + (idx + 1), 'info');
}

function clearRefImages() {
  setCurrentRefs([]);
  els.refInput.value = '';
  _refSelectedSet = {};
  hideRefHover();
  closeRefFullscreen();
  renderRef();
}

function insertPromptAt(text) {
  const ta = els.promptInput;
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  ta.value = val.slice(0, start) + text + val.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  updateCharCount();
  schedulePromptOverlay(); /* 程序改值不会触发 input，手动刷新 chip overlay */
  ta.focus();
}

/* ========== @ 自动补全弹窗 ========== */
var _acEl = null, _acActiveIdx = -1, _acQuery = '', _acRange = null, _acKey = '';

function _ensureAcEl() {
  if (_acEl && document.body.contains(_acEl)) return _acEl;
  _acEl = document.createElement('div');
  _acEl.className = 'hm-ref-autocomplete';
  _acEl.hidden = true;
  /* 事件委托：列表重绘后不用重新绑定 */
  _acEl.addEventListener('mousedown', function (ev) {
    var item = ev.target.closest('.hm-ref-ac-item');
    if (!item) return;
    ev.preventDefault(); /* 不丢 input focus */
    _commitRefAc(Number(item.dataset.idx));
  });
  document.body.appendChild(_acEl);
  return _acEl;
}

function showRefAutocomplete() {
  var refs = currentRefs();
  if (!refs.length) return;
  var ta = els.promptInput;
  if (!ta) return;
  _ensureAcEl();

  /* 找到光标前的 @ 字符 */
  var val = ta.value;
  var pos = ta.selectionStart;
  var before = val.slice(0, pos);
  var atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return;
  /* @ 后面不能有空格/换行（否则不是触发 @ 输入） */
  var afterAt = before.slice(atIdx + 1);
  if (/\s/.test(afterAt)) return;

  _acQuery = afterAt.toLowerCase();
  _acRange = { start: atIdx, end: pos };

  /* 根据 query 过滤 ref */
  var filtered = refs.map(function (ref, i) {
    return { ref: ref, idx: i };
  }).filter(function (item) {
    /* query 可以是数字（@2）或名字片段 */
    if (!_acQuery) return true;
    if (/^\d+$/.test(_acQuery)) return String(item.idx + 1).indexOf(_acQuery) === 0;
    var name = (item.ref.name || '').toLowerCase();
    return name.indexOf(_acQuery) >= 0;
  });

  if (!filtered.length) { hideRefAutocomplete(); return; }

  /* 渲染弹窗：同一组参考图 + 同一 query 只重绘一次 */
  var key = _refsSignature(refs) + '|' + _acQuery;
  if (_acKey !== key) {
    _acKey = key;
    _acEl.innerHTML = filtered.map(function (item, i) {
      return '<div class="hm-ref-ac-item' + (i === 0 ? ' is-active' : '') + '" data-idx="' + item.idx + '">' +
        '<div class="hm-ref-ac-thumb"><img src="' + (item.ref.thumb || item.ref.dataUrl) + '" alt=""></div>' +
        '<div class="hm-ref-ac-info">' +
          '<div class="hm-ref-ac-name"><span class="hm-ref-ac-tag">@' + (item.idx + 1) + '</span> 主体图</div>' +
          '<div class="hm-ref-ac-meta">' + item.ref.width + '×' + item.ref.height + ' · 强度 ' +
            (item.ref.weight != null ? item.ref.weight : 70) + '%</div>' +
        '</div></div>';
    }).join('');
  }

  /* 定位：textarea 光标附近 */
  var rect = ta.getBoundingClientRect();
  var caretCoords = _getCaretCoords(ta);
  var left = caretCoords.left;
  var top = caretCoords.bottom;
  /* 边界修正 */
  var maxLeft = window.innerWidth - _acEl.offsetWidth - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  var maxTop = window.innerHeight - _acEl.offsetHeight - 8;
  if (top > maxTop) top = Math.max(8, caretCoords.top - _acEl.offsetHeight);

  _acEl.style.left = left + 'px';
  _acEl.style.top = top + 'px';
  _acEl.hidden = false;
  _acActiveIdx = 0;
}

function _commitRefAc(refIdx) {
  hideRefAutocomplete();
  var ta = els.promptInput;
  if (!ta) return;
  var pos = ta.selectionStart;
  var before = ta.value.slice(0, pos);
  var atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return;
  var val = ta.value;
  var insert = '@' + (refIdx + 1) + ' ';
  ta.value = val.slice(0, atIdx) + insert + val.slice(pos);
  var newPos = atIdx + insert.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  updateCharCount();
  schedulePromptOverlay(); /* 程序改值不会触发 input，手动刷新 chip overlay */
  ta.focus();
}

function hideRefAutocomplete() {
  if (_acEl) _acEl.hidden = true;
  _acActiveIdx = -1;
  _acRange = null;
}

/* 获取 textarea 光标屏幕坐标（用镜像 div trick） */
function _getCaretCoords(ta) {
  var pos = ta.selectionStart;
  var val = ta.value;
  var before = val.slice(0, pos);

  var mirror = document.createElement('div');
  var cs = window.getComputedStyle(ta);
  mirror.style.cssText =
    'position:fixed!important; visibility:hidden!important; top:-10000px!important; left:0!important;' +
    'width:' + ta.offsetWidth + 'px;' +
    'font:' + cs.font + ';' +
    'font-family:' + cs.fontFamily + ';' +
    'font-size:' + cs.fontSize + ';' +
    'line-height:' + cs.lineHeight + ';' +
    'padding:' + cs.padding + ';' +
    'border:' + cs.border + ';' +
    'box-sizing:border-box;' +
    'white-space:pre-wrap; overflow:hidden; word-wrap:break-word;';
  mirror.textContent = before;
  /* 末尾插入一个 span 测量光标 */
  var span = document.createElement('span');
  span.textContent = val.slice(pos) || '.';
  mirror.appendChild(span);
  document.body.appendChild(mirror);

  var mirrorRect = mirror.getBoundingClientRect();
  var spanRect = span.getBoundingClientRect();
  var taRect = ta.getBoundingClientRect();

  var result = {
    top: taRect.top + (spanRect.top - mirrorRect.top),
    left: taRect.left + (spanRect.left - mirrorRect.left),
    bottom: taRect.top + (spanRect.bottom - mirrorRect.top)
  };
  document.body.removeChild(mirror);
  return result;
}

/* 在 promptInput 上绑定 autocomplete 键盘导航 */
function bindRefAutocomplete() {
  if (!els.promptInput) return;
  var ta = els.promptInput;

  ta.addEventListener('keyup', function (ev) {
    if (_acEl && !_acEl.hidden) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' ||
          ev.key === 'Enter' || ev.key === 'Escape') {
        return; /* 弹窗自己处理 */
      }
    }
    showRefAutocomplete();
  });

  ta.addEventListener('keydown', function (ev) {
    if (!_acEl || _acEl.hidden) return;
    var items = _acEl.querySelectorAll('.hm-ref-ac-item');
    if (!items.length) return;

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      _acActiveIdx = (_acActiveIdx + 1) % items.length;
      items.forEach(function (el, i) { el.classList.toggle('is-active', i === _acActiveIdx); });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      _acActiveIdx = (_acActiveIdx - 1 + items.length) % items.length;
      items.forEach(function (el, i) { el.classList.toggle('is-active', i === _acActiveIdx); });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      var idx = Number(items[_acActiveIdx] && items[_acActiveIdx].dataset.idx);
      _commitRefAc(idx);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      hideRefAutocomplete();
    }
  });

  /* 点击外部关闭 */
  document.addEventListener('click', function (ev) {
    if (_acEl && !_acEl.hidden && ev.target !== els.promptInput && !_acEl.contains(ev.target)) {
      hideRefAutocomplete();
    }
  });

  /* window resize / scroll 时关闭 */
  window.addEventListener('resize', hideRefAutocomplete);
  window.addEventListener('scroll', hideRefAutocomplete, true);
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
  if (currentRefs().length >= REF_MAX_COUNT) {
    toast('当前描述已达上限，最多 ' + REF_MAX_COUNT + ' 张参考图', 'error');
    return;
  }
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

    /* 小缩略图：chip / 补全卡片用它，避免每次渲染都解码整张大图 */
    var tCanvas = document.createElement('canvas');
    tCanvas.width = 48;
    tCanvas.height = 48;
    var tCtx = tCanvas.getContext('2d');
    var side = Math.min(width, height);
    tCtx.drawImage(canvas, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 48, 48);

    var arr = currentRefs();
    arr.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      thumb: tCanvas.toDataURL('image/jpeg', 0.7),
      name: 'reference_' + (arr.length + 1) + '.jpg',
      width: width,
      height: height,
      weight: 70 /* 默认主体强度 70% */
    });
    setCurrentRefs(arr);
    els.refInput.value = '';
    renderRef();
    const n = arr.length;
    toast('已添加到当前描述（' + n + '/' + REF_MAX_COUNT + '）· 点击 @' + n + ' 可插入提示词', 'success');
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
    engine: state.engine,
    channelModel: state.channelModel,
    lora: state.lora,
    videoModel: state.videoModel,
    audioModel: state.audioModel,
    providerId: state.providerId
  });
}

/* ---------------- 视图与侧栏 ---------------- */
var VIEW_IDS = ['create', 'works', 'canvas', 'tools', 'assets', 'writing', 'forum', 'history', 'admin'];

function switchView(view) {
  if (VIEW_IDS.indexOf(view) < 0) return;
  state.view = view;
  document.body.dataset.view = view;

  VIEW_IDS.forEach(function (name) {
    var node = document.getElementById('view-' + name);
    if (!node) return;
    var active = name === view;
    node.hidden = !active;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  });

  if (view === 'works') renderWorks();
  if (window.HMUI && window.HMUI.onView) window.HMUI.onView(view);
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
function toast(message, type, duration) {
  const kind = type || 'info';
  const dur = Number(duration) || 3200;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const icon = kind === 'success' ? ICONS.success : kind === 'error' ? ICONS.error : ICONS.info;
  el.innerHTML = icon + '<span>' + esc(message) + '</span>';
  els.toastWrap.appendChild(el);
  setTimeout(function () {
    el.classList.add('is-out');
    setTimeout(function () { el.remove(); }, 260);
  }, dur);
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

  // 后端在线时优先使用服务端翻译
  if (window.HM && window.HM.api && window.HM.api.online) {
    try {
      const remote = await window.HM.api.translate(text);
      if (remote && !hasChinese(remote)) {
        state.translationCache.set(text, remote);
        return remote;
      }
    } catch (err) { /* 回退到浏览器直连 */ }
  }

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
  let prompt = userText;
  const refs = currentRefs();
  const weight = currentTabRefWeight();

  if (refs.length > 0) {
    /* 根据权重 + 每张图单独的 weight 生成引导词 */
    let tail = '';
    if (weight >= 85) {
      tail = refs.length === 1
        ? ', strictly follow the reference image as the primary subject and composition, keep all key features exactly the same, only enhance artistic quality'
        : ', strictly adhere to reference @1 as the primary subject and composition, reference @2+ as style guidance, keep key features identical';
    } else if (weight >= 60) {
      tail = refs.length === 1
        ? ', use the reference image as the main visual subject, preserve the key composition and character, apply artistic interpretation'
        : ', use reference @1 as the main visual subject, reference @2+ for style inspiration, keep overall character consistent';
    } else if (weight >= 35) {
      tail = ', use the reference image(s) as loose style and subject inspiration, feel free to reinterpret creatively';
    } else {
      tail = ', the reference image(s) are loose mood and style suggestion only, creative interpretation is allowed';
    }
    prompt += tail;

    /* 每张 ref 有自己的主体强度（per-ref weight），拼进 prompt 让模型理解 */
    var perRefParts = refs.map(function (r, i) {
      var w = r.weight != null ? r.weight : 70;
      return '@' + (i + 1) + ':' + w + '%';
    }).join(' ');
    if (perRefParts) {
      prompt += ' [refs: ' + perRefParts + ']';
    }
  }

  return prompt.trim();
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

  // 已连接后端时优先走服务端代理（前后端分离）；FLUX 失败可回退浏览器直连
  if (window.HM && window.HM.api && window.HM.api.online) {
    try {
      const remote = await runBackendImage(job, prompt);
      const remoteElapsed = (Date.now() - job.startedAt) / 1000;
      markJobDone(job, remote.url, remote.seed, remoteElapsed);
      return;
    } catch (err) {
      if (job.engine !== 'flux') {
        err.hint = err.hint || ('后端生成失败：' + (err.message || '请检查接入设置'));
        throw err;
      }
    }
  }

  if (job.engine === 'openai') {
    const offlineError = new Error('免费额度模型需要后端代理，当前后端未连接');
    offlineError.hint = '请确认后端服务已启动，或在「接入设置」检查接口地址';
    markJobError(job, offlineError);
    throw offlineError;
  }

  if (job.engine === 'gpt-image' || job.engine === 'banana') {
    const image = job.engine === 'gpt-image'
      ? await runRayinImage(job, prompt)
      : await runRayinBanana(job, prompt);
    const elapsed = (Date.now() - job.startedAt) / 1000;
    markJobDone(job, image.url, image.seed, elapsed);
    return;
  }

  let lastError = null;

  /* 浏览器直连通道（后端离线时的免费兜底）：LoRA 风格在本地拼进提示词 */
  const loraPreset = findLora(state.lora);
  const localPrompt = loraPreset ? (prompt + ', ' + loraPreset.prompt) : prompt;

  for (let i = 0; i < ENGINES.length; i += 1) {
    try {
      const image = await runEngine(ENGINES[i], job, localPrompt);
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
      const image = await runFallback(job, localPrompt);
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

/* 通过 Node 后端生成单张图片（同源 /api 或 ?api= 指定的后端） */
async function runBackendImage(job, prompt) {
  updateJobStatus(job, '后端生成中…');
  const payload = {
    mode: 'image',
    engine: job.engine,
    prompt: prompt,
    ratio: job.ratioId,
    scale: job.scaleId,
    count: 1,
    steps: job.steps || 8,
    seed: job.seed,
    refImages: (job.refImages || []).map(function (r) { return r.dataUrl; }),
    rayin: state.api,
    style: state.lora || ''
  };

  if (job.engine === 'flux') {
    payload.model = state.channelModel || 'sana';
  } else if (job.engine === 'openai') {
    const cfg = providerConfig();
    payload.model = cfg.model;
    payload.provider = { id: cfg.id, base: cfg.base, key: cfg.key, model: cfg.model };
  } else if (job.engine === 'banana' || job.engine === 'gpt-image') {
    /* RayinAI — 前端选的真实模型 ID 必须传给后端覆盖默认值 */
    if (state.channelModel) payload.model = state.channelModel;
  }

  const data = await window.HM.api.generate(payload, 180000);
  const item = data && data.items && data.items[0];
  if (!item || !item.url) throw new Error('后端未返回图片');
  return {
    url: window.HM.api.mediaUrl ? window.HM.api.mediaUrl(item.url) : item.url,
    seed: item.seed || job.seed
  };
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
  if (/violat|polic|moderation|content.filter|unsafe|policy/i.test(message)) {
    return 'RayinAPI 内容审核拦截了你的提示词（' + (payload && payload.error && payload.error.code ? payload.error.code : 'content_filter') + '）。已自动替换为宽松模型 gpt-image-2-all；若仍被拦截可在提示词中避免敏感词汇，或在「接入设置」里换用 Nano Banana 引擎';
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

/* GPT-image 接口 size 仅接受固定枚举白名单，不能自定义像素；
 * 2K / 4K 档位通过 quality 参数（medium=1K, high=2K, ultra=4K）让 RayinAPI 内部放大 */
function gptSizeFor(job) {
  const ratio = job.ratioId || '1:1';
  if (ratio === '1:1') return '1024x1024';
  if (ratio === '3:4' || ratio === '9:16') return '1024x1536';
  return '1536x1024';
}

function gptQualityFor(job) {
  if (job.scaleId === '4k') return 'ultra';
  if (job.scaleId === '2k') return 'high';
  return 'medium';
}

async function runRayinImage(job, prompt) {
  const size = gptSizeFor(job);
  const quality = gptQualityFor(job);
  /* 用户设置的模型 ID 不可用时，按 fallback 链自动重试下一个官方 ID */
  const userModel = rayinCfg().gptModel || RAYIN_DEFAULT.gptModel;
  const fallbacks = [userModel].concat(GPT_IMAGE_FALLBACKS.filter(function (m) { return m !== userModel; }));

  let lastError = null;
  for (let i = 0; i < fallbacks.length; i += 1) {
    const model = fallbacks[i];
    try {
      const refs = job.refImages || [];
      const primary = refs[0];
      if (primary) {
        /* 图生图：以第一张参考图为主体，走 OpenAI 兼容的 /images/edits（multipart） */
        updateJobStatus(job, '参考图绘制…' + (i > 0 ? '（尝试 ' + model + '）' : ''));
        const blob = await dataUrlBlob(primary.dataUrl);
        const form = new FormData();
        form.append('model', model);
        form.append('image', blob, primary.name || 'reference.jpg');
        form.append('prompt', prompt);
        form.append('size', size);
        form.append('quality', quality);
        form.append('skip_moderation', 'true');
        const data = await rayinFormRequest('/images/edits', form);
        const url = pickImage(data);
        if (!url) throw new Error('接口未返回图片');
        const first = data && Array.isArray(data.data) ? data.data[0] : null;
        if (first && first.width && first.height) { job.width = first.width; job.height = first.height; }
        if (i > 0) toast('当前模型 ID 不可用，已自动切换到 ' + model, 'info');
        return { url: url, seed: job.seed };
      } else {
        updateJobStatus(job, 'GPT-image 绘制…' + (i > 0 ? '（尝试 ' + model + '）' : ''));
        const data = await rayinRequest('/images/generations', {
          model: model,
          prompt: prompt,
          n: 1,
          size: size,
          quality: quality,
          skip_moderation: true
        });
        const url = pickImage(data);
        if (!url) throw new Error('接口未返回图片');
        const first = data && Array.isArray(data.data) ? data.data[0] : null;
        if (first && first.width && first.height) { job.width = first.width; job.height = first.height; }
        if (i > 0) toast('当前模型 ID 不可用，已自动切换到 ' + model, 'info');
        return { url: url, seed: job.seed };
      }
    } catch (err) {
      lastError = err;
      /* 模型不可用（404 / model not found）才回退；其它错误（审核拦截 / 余额 / 超时）直接向上抛 */
      if (!/model.*(not.*found|not.*exist)|无可用渠道|no available/i.test(err.hint || err.message || '') &&
          String(err.message || '').indexOf('HTTP 404') < 0) {
        throw err;
      }
    }
  }
  throw lastError || new Error('GPT-image 所有候选模型均不可用');
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

  var ratio = job.width + ' / ' + job.height;
  var inner;
  if (job.type === 'video') {
    inner = '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
  } else if (job.type === 'audio') {
    inner = '<div class="hm-audio-result"><strong>语音合成完成</strong>' +
      '<audio src="' + esc(url) + '" controls preload="metadata"></audio></div>';
  } else {
    inner = '<img src="' + esc(url) + '" alt="' + esc(job.prompt) + '">';
  }

  card.innerHTML =
    '<div class="result-media" style="aspect-ratio:' + ratio + '">' +
      inner +
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
      '<div class="result-meta"><span>' + esc(job.modelName) + '</span><span>' + job.width + '×' + job.height + '</span><span>#' + esc(seed) + '</span><span>' + elapsed.toFixed(1) + 's</span></div>' +
    '</div>';

  saveWork(job);
}

/* ---------------- 本地大图仓库（IndexedDB） ----------------
 * 生成图的 base64 动辄 200KB，48 张远超 localStorage 5MB 上限，
 * 之前直接塞 localStorage 会静默写入失败 → 刷新后作品消失。
 * 现在元数据（提示词/尺寸/缩略图）走 localStorage，原图放 IndexedDB。 */
var _blobDbPromise = null;
function _blobDb() {
  if (_blobDbPromise) return _blobDbPromise;
  _blobDbPromise = new Promise(function (resolve) {
    if (!window.indexedDB) return resolve(null);
    var req = indexedDB.open('anidream', 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(null); };
  });
  return _blobDbPromise;
}

function idbPutBlob(id, url) {
  _blobDb().then(function (db) {
    if (!db) return;
    try { db.transaction('blobs', 'readwrite').objectStore('blobs').put(url, id); } catch (e) {}
  });
}
function idbDelBlob(id) {
  _blobDb().then(function (db) {
    if (!db) return;
    try { db.transaction('blobs', 'readwrite').objectStore('blobs').delete(id); } catch (e) {}
  });
}
function idbAllBlobs() {
  return _blobDb().then(function (db) {
    if (!db) return {};
    return new Promise(function (resolve) {
      var out = {};
      try {
        var req = db.transaction('blobs', 'readonly').objectStore('blobs').openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); } else resolve(out);
        };
        req.onerror = function () { resolve(out); };
      } catch (e) { resolve(out); }
    });
  });
}

/* 把 localStorage 里标记为 blob 的作品补回原图 */
function hydrateWorks() {
  return idbAllBlobs().then(function (map) {
    var changed = false;
    state.works.forEach(function (w) {
      if (!w) return;
      if (!w.url && map[w.id]) { w.url = map[w.id]; changed = true; }
    });
    return changed;
  });
}

/* ---------------- 作品库 ---------------- */
function workTime(w) {
  var v = w && w.createdAt;
  if (typeof v === 'number') return v;
  var t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

/* 服务端与本地合并：Render 免费层每次重启都会清空 data/，
   ！绝不能！用服务端的空列表覆盖用户本地缓存（这正是"刷新后图片全消失"的原因）。 */
function mergeWorks(serverItems, localItems) {
  var map = Object.create(null);
  var out = [];
  function add(list) {
    (list || []).forEach(function (w) {
      if (!w || (!w.url && !w.blob)) return;
      var id = w.id || ('w_' + workTime(w) + '_' + out.length);
      var hit = map[id];
      if (hit) {
        Object.keys(w).forEach(function (k) {
          if (w[k] !== null && w[k] !== undefined && w[k] !== '') hit[k] = w[k];
        });
        return;
      }
      var copy = Object.assign({}, w, { id: id });
      map[id] = copy;
      out.push(copy);
    });
  }
  add(serverItems);
  add(localItems);
  out.sort(function (a, b) { return workTime(b) - workTime(a); });
  return out.slice(0, MAX_WORKS);
}

/* （已废弃）旧版只传远程 URL 作品，被 syncAllWorksToServer 取代 */

function saveWork(job) {
  var type = job.type || 'image';
  const work = {
    id: job.id,
    type: type,
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
    duration: job.duration || 0,
    elapsed: Number(job.elapsed) || 0,
    createdAt: Date.now()
  };

  state.works.unshift(work);
  state.works = state.works.slice(0, MAX_WORKS);
  saveWorks();
  renderWorks();

  if (type !== 'image') return;

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
  /* 覆盖前先备份一份，便于误清后恢复 */
  try {
    var prev = localStorage.getItem(LS_WORKS);
    if (prev && prev !== '[]' && prev.length > 40) localStorage.setItem(LS_WORKS_BAK, prev);
  } catch (e) {}

  /* base64 原图写进 IndexedDB，localStorage 只留元数据（否则 5MB 配额会写失败） */
  var meta = state.works.map(function (work) {
    if (work.url && work.url.indexOf('data:') === 0) {
      idbPutBlob(work.id, work.url);
      return Object.assign({}, work, { url: '', blob: true });
    }
    return work;
  });

  if (saveJSON(LS_WORKS, meta)) {
    syncWorksToServer();
    return;
  }

  /* 还是超限：缩略图从第 9 张起丢掉再试 */
  state.works = state.works.map(function (work, index) {
    return index > 8 ? Object.assign({}, work, { thumb: null }) : work;
  });
  saveJSON(LS_WORKS, state.works.map(function (work) {
    if (work.url && work.url.indexOf('data:') === 0) {
      idbPutBlob(work.id, work.url);
      return Object.assign({}, work, { url: '', blob: true });
    }
    return work;
  }));
  syncWorksToServer();
}

/* 把本地全部作品（含 base64）上传到服务端，分批并发避免卡顿。
   Render 免费层重启会清空 data/，下次用户打开时本地存的图自动补回去。 */
var _syncingAll = false;
async function syncAllWorksToServer(serverItems) {
  if (_syncingAll) return;
  if (!(window.HMApp && window.HMApp.user && api && api.online)) return;
  _syncingAll = true;
  try {
    await hydrateWorks(); /* 先把 IndexedDB 里的原图补回 */
    var have = Object.create(null);
    (serverItems || []).forEach(function (w) { if (w && w.id) have[w.id] = 1; });

    var missing = state.works.filter(function (w) { return w && !have[w.id] && w.url; });
    if (!missing.length) return;

    /* base64 图体积大，并发 3 条，避免同时发把浏览器/后端打爆 */
    var concurrency = 3;
    var idx = 0;
    async function worker() {
      while (idx < missing.length) {
        var w = missing[idx++];
        try { await api.saveWork(w); } catch (e) { /* 静默，失败下次启动再补 */ }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    console.log('[syncAllWorksToServer] 已补传', missing.length, '张到服务端');
  } finally {
    _syncingAll = false;
  }
}

function syncWorksToServer() {
  if (!(window.HMApp && window.HMApp.user && api && api.online)) return;
  /* 这里也传 base64 —— Render 磁盘够放，base64 随作品 JSON 一起存 */
  state.works.forEach(function (w) { api.saveWork(w).catch(function () {}); });
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
    let ext = 'jpg';
    if (blob.type.indexOf('webp') >= 0) ext = 'webp';
    else if (blob.type.indexOf('png') >= 0) ext = 'png';
    else if (blob.type.indexOf('mp4') >= 0) ext = 'mp4';
    else if (blob.type.indexOf('webm') >= 0) ext = 'webm';
    else if (blob.type.indexOf('wav') >= 0) ext = 'wav';
    else if (blob.type.indexOf('mpeg') >= 0 || blob.type.indexOf('mp3') >= 0) ext = 'mp3';
    else if (/^(video|audio)\//.test(blob.type)) ext = 'bin';

    try {
      if (blob.type.indexOf('image/') === 0 && window.createImageBitmap && blob.type.indexOf('png') < 0) {
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
  var type = item.type || 'image';
  var inner = els.lightbox.querySelector('.lb-inner');
  inner.querySelectorAll('.lb-media-el').forEach(function (node) { node.remove(); });

  if (type === 'image') {
    els.lbImage.style.display = '';
    els.lbImage.src = item.url || item.thumb || '';
    els.lbImage.onerror = function () {
      if (item.thumb && els.lbImage.src !== item.thumb) els.lbImage.src = item.thumb;
    };
  } else {
    els.lbImage.style.display = 'none';
    var media = document.createElement(type === 'video' ? 'video' : 'audio');
    media.className = 'lb-media-el';
    media.controls = true;
    media.autoplay = true;
    if (type === 'video') media.setAttribute('playsinline', '');
    media.src = item.url || '';
    inner.insertBefore(media, inner.querySelector('.lb-bar'));
  }

  els.lbPrompt.textContent = item.prompt || '';
  els.lbMeta.textContent = [
    type === 'video' ? '视频' : type === 'audio' ? '音频' : '',
    item.modelName || 'AI',
    item.engine ? (ENGINE_META[item.engine] || {}).meta || '' : '',
    item.width && item.height ? item.width + '×' + item.height : '',
    item.duration ? item.duration + ' 秒' : '',
    item.seed ? 'Seed ' + item.seed : '',
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
var activeBatches = 0;
function setGenerating(flag) {
  if (flag) {
    activeBatches += 1;
  } else {
    activeBatches = Math.max(0, activeBatches - 1);
  }
  state.generating = activeBatches > 0;
  /* 不再锁死按钮 —— 支持多批次并发生成 */
  els.generateBtn.disabled = false;
  els.generateBtn.classList.toggle('is-loading', state.generating);
  const strong = els.generateBtn.querySelector('.gen-text strong');
  const small = els.generateBtn.querySelector('.gen-text small');
  if (state.generating) {
    strong.textContent = '正在绘制（' + activeBatches + ' 批）…';
    small.textContent = (state.engine === 'flux' ? '免费通道' : (ENGINE_META[state.engine] || {}).label) + ' · 点击可继续追加生成';
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

  // 视频 / 音频模式交给 V3 工作台（走后端接口）
  if (state.mode && state.mode !== 'image') {
    if (window.HMUI && window.HMUI.runMedia) window.HMUI.runMedia(state.mode);
    return;
  }

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

  if (currentRefs().length > 0 && state.engine === 'flux') {
    /* FLUX 免费引擎走后端 Proxy，不支持多参考图，提示切 GPT-image / Banana */
    toast('FLUX 免费引擎暂不支持参考图 · 请切换 GPT-image 或 Nano Banana', 'error');
    els.refDrop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const model = getModel(state.modelId);
  const size = currentSize();
  const baseSeed = clamp(Number(els.seedInput.value) || randomSeed(), 1, 2147483647);
  state.seed = baseSeed;
  persistPrefs();

  els.emptyState.style.display = 'none';
  if (!window.HMDesk) {
    els.resultGrid.innerHTML = '';
    state.jobs.clear();
  }

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
      refImages: currentRefs().slice()
    };
    jobs.push(job);
    state.jobs.set(job.id, job);
    createLoadingCard(job);
  }

  if (window.HMDesk && window.HMDesk.syncJobs) window.HMDesk.syncJobs();
  if (window.HMDesk) window.HMDesk.clearSelection();

  setGenerating(true);
  startTicker();
  updateQueue('准备生成');
  updateAllJobStatus('准备中…');

  setTimeout(function () {
    const first = els.resultGrid.querySelector('[data-job]:not(.is-done)');
    if (first && first.scrollIntoView) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  /* 允许和其他批次并发，不再因 state.generating 拒绝 */
  if (!job) return;

  if (job.type && job.type !== 'image') {
    toast('视频 / 音频任务请重新生成', 'info');
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
  if (job.type && job.type !== 'image') {
    toast('视频 / 音频暂不支持复用参数', 'info');
    return;
  }
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
  renderProviderSelect();
  fillProviderFields(state.providerId);
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
var DISABLED_VIEWS = { canvas: true, works: true, tools: true, assets: true, writing: true, forum: true };

function bindEvents() {
  document.addEventListener('click', function (event) {
    const viewBtn = event.target.closest('[data-view]');
    if (viewBtn) {
      var view = viewBtn.dataset.view;
      if (DISABLED_VIEWS[view] || viewBtn.disabled) {
        var label = viewBtn.querySelector('span')?.textContent || view;
        HM.toast && HM.toast('「' + label + '」功能开发中，敬请期待', 'info');
        return;
      }
      switchView(view);
    }
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
        addPromptTab();
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
      if (window.HMDesk && window.HMDesk.tidy) {
        window.HMDesk.tidy();
        return;
      }
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

  if (els.modelMenu) {
    els.modelMenu.addEventListener('click', function (event) {
      const vBtn = event.target.closest('[data-vmodel]');
      if (vBtn) {
        state.videoModel = vBtn.dataset.vmodel;
        persistPrefs();
        syncEngineUI();
        closeAllMenus();
        toast('视频模型：' + modeModelLabel('video'), 'success');
        return;
      }
      const aBtn = event.target.closest('[data-amodel]');
      if (aBtn) {
        state.audioModel = aBtn.dataset.amodel;
        persistPrefs();
        syncEngineUI();
        closeAllMenus();
        toast('音频模型：' + modeModelLabel('audio'), 'success');
        return;
      }

      const loraBtn = event.target.closest('[data-lora]');
      if (loraBtn) {
        state.lora = loraBtn.dataset.lora || '';
        persistPrefs();
        syncEngineUI();
        const preset = findLora(state.lora);
        toast(preset ? '已启用风格：' + preset.name : '已关闭风格增强', 'success');
        return;
      }

      const btn = event.target.closest('[data-engine]');
      if (!btn || !ENGINE_META[btn.dataset.engine]) return;
      if (btn.dataset.provider) state.providerId = btn.dataset.provider;
      if (btn.dataset.model) state.channelModel = btn.dataset.model;
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

    if (value === 'openai') {
      const cfg = providerConfig();
      if (!cfg.key) {
        toast('该模型来自免费额度平台，需先填写平台 API Key', 'info');
        openApiModal();
      } else {
        toast('已切换到 ' + currentModelLabel(), 'success');
      }
      return;
    }

    if ((value === 'gpt-image' || value === 'banana') && !hasRayinKey()) {
      toast('该模型需要 RayinAPI 密钥，先完成接入设置', 'info');
      openApiModal();
    } else {
      toast('已切换到 ' + currentModelLabel(), 'success');
    }
  });

  els.apiConfigBtn.addEventListener('click', function () {
    if (window.HMAdmin && HMAdmin.isAdmin()) {
      switchView('admin');
    } else {
      openApiModal();
    }
  });
  els.apiClose.addEventListener('click', closeApiModal);
  els.apiSave.addEventListener('click', saveRayinConfig);
  if (els.providerSave) els.providerSave.addEventListener('click', saveProviderConfig);
  if (els.providerSelect) {
    els.providerSelect.addEventListener('change', function () {
      fillProviderFields(els.providerSelect.value);
    });
  }
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

  /* === refDrop 点击：只在空状态区域点击才打开文件选择；有素材后点击任何 cell 不会触发 === */
  if (els.refEmpty) {
    els.refEmpty.addEventListener('click', function () { els.refInput.click(); });
    els.refEmpty.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault(); els.refInput.click();
      }
    });
  }

  els.refInput.addEventListener('change', async function (event) {
    var files = Array.from(event.target.files || []);
    if (!files.length) return;
    var remaining = REF_MAX_COUNT - currentRefs().length;
    if (remaining <= 0) {
      toast('当前描述已达上限，最多 ' + REF_MAX_COUNT + ' 张参考图', 'error');
      els.refInput.value = '';
      return;
    }
    for (var i = 0; i < Math.min(files.length, remaining); i++) {
      await pickRefFile(files[i]);
    }
    els.refInput.value = '';
  });

  els.refRemove.addEventListener('click', function (event) {
    event.stopPropagation();
    clearRefImages();
    toast('已清空所有参考图', 'info');
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

  els.refDrop.addEventListener('drop', async function (event) {
    event.preventDefault();
    event.stopPropagation();
    els.refDrop.classList.remove('is-over');
    var files = Array.from(event.dataTransfer && event.dataTransfer.files || []);
    var remaining = REF_MAX_COUNT - currentRefs().length;
    for (var i = 0; i < Math.min(files.length, remaining); i++) {
      await pickRefFile(files[i]);
    }
  });

  /* === 右侧工具条 === */
  if (els.refSelectBtn) els.refSelectBtn.addEventListener('click', function (ev) {
    ev.stopPropagation(); enterRefSelectMode();
  });
  if (els.refClearBtn) els.refClearBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (!currentRefs().length) return;
    if (confirm('确定要清空所有参考图吗？')) {
      clearRefImages();
      toast('已清空所有参考图', 'info');
    }
  });

  /* === 选择模式顶部工具条 === */
  if (els.refSelectCancel) els.refSelectCancel.addEventListener('click', exitRefSelectMode);
  if (els.refSelectDelete) els.refSelectDelete.addEventListener('click', function (ev) {
    ev.stopPropagation(); deleteSelectedRefs();
  });
  if (els.refSelectClear) els.refSelectClear.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (!currentRefs().length) return;
    if (confirm('确定要清空所有参考图吗？')) { clearRefImages(); exitRefSelectMode(); toast('已清空所有参考图', 'info'); }
  });

  /* === hover 浮层按钮 === */
  if (els.refHover) {
    els.refHover.addEventListener('click', function (ev) {
      var viewBtn = ev.target.closest('.hm-ref-hover-view');
      if (viewBtn) {
        ev.stopPropagation();
        if (_refHoverIdx >= 0) openRefFullscreen(_refHoverIdx);
        hideRefHover();
        return;
      }
      var atBtn = ev.target.closest('.hm-ref-hover-at');
      if (atBtn) {
        ev.stopPropagation();
        if (_refHoverIdx >= 0) insertPromptAt('@' + (_refHoverIdx + 1) + ' ');
        hideRefHover();
        return;
      }
    });
    /* 浮层自己 hover 时不要收起 */
    els.refHover.addEventListener('mouseenter', function () {
      if (_refHoverEnterTimer) { clearTimeout(_refHoverEnterTimer); _refHoverEnterTimer = 0; }
    });
    els.refHover.addEventListener('mouseleave', function () {
      hideRefHover();
    });
  }

  /* === 全屏查看控制 === */
  if (els.refFsClose) els.refFsClose.addEventListener('click', closeRefFullscreen);
  if (els.refFsZoomIn) els.refFsZoomIn.addEventListener('click', function () {
    _refFsScale = Math.min(4, +(_refFsScale + 0.25).toFixed(2));
    if (els.refFsImg) els.refFsImg.style.transform = 'scale(' + _refFsScale + ')';
  });
  if (els.refFsZoomOut) els.refFsZoomOut.addEventListener('click', function () {
    _refFsScale = Math.max(0.3, +(_refFsScale - 0.25).toFixed(2));
    if (els.refFsImg) els.refFsImg.style.transform = 'scale(' + _refFsScale + ')';
  });
  if (els.refFsReset) els.refFsReset.addEventListener('click', function () {
    _refFsScale = 1;
    if (els.refFsImg) els.refFsImg.style.transform = 'scale(1)';
  });
  if (els.refFsDownload) els.refFsDownload.addEventListener('click', function () {
    if (_refFsIdx < 0) return;
    var list = currentRefs();
    var ref = list[_refFsIdx];
    if (!ref) return;
    var a = document.createElement('a');
    a.href = ref.dataUrl;
    a.download = ref.name || ('reference_' + (_refFsIdx + 1) + '.jpg');
    a.click();
  });
  /* 全屏：ESC 关闭 + 点击图片外关闭 */
  document.addEventListener('keydown', function (ev) {
    if (els.refFullscreen && !els.refFullscreen.hidden && ev.key === 'Escape') {
      ev.preventDefault();
      closeRefFullscreen();
    }
  });
  if (els.refFullscreen) {
    els.refFullscreen.addEventListener('click', function (ev) {
      /* 点击图片或按钮之外的黑底 → 关闭 */
      if (ev.target === els.refFullscreen) closeRefFullscreen();
    });
  }

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

  /* ========== 滑动调节绑定 ========== */
  /* 字体大小 slider */
  var fsSlider = document.getElementById('fontSizeSlider');
  var fsLabel = document.getElementById('fontSizeLabel');
  if (fsSlider) {
    function applyFontSize(v) {
      /* 行高必须是像素值：早先写成无单位数字会被当成倍数（17.55 × 13px = 228px），
         导致光标和文字严重错位、首行文字被压到中间 */
      var lh = Math.round(Number(v) * 1.6 * 10) / 10 + 'px';
      if (els.promptInput) {
        els.promptInput.style.fontSize = v + 'px';
        els.promptInput.style.lineHeight = lh;
      }
      /* overlay 与 textarea 必须同字号同行高，否则 chip 会和光标错位 */
      var ov = document.querySelector('.hm-prompt-overlay');
      if (ov) {
        ov.style.fontSize = v + 'px';
        ov.style.lineHeight = lh;
      }
      if (fsLabel) fsLabel.textContent = String(v);
    }
    fsSlider.addEventListener('input', function () {
      state.fontSize = Number(fsSlider.value);
      applyFontSize(state.fontSize);
      persistPrefs();
    });
    /* 初始化 */
    applyFontSize(state.fontSize || 13);
    if (state.fontSize) fsSlider.value = String(state.fontSize);
  }

  /* 参考主体强度 slider —— 每个 tab 独立 */
  var rwSlider = document.getElementById('refWeightSlider');
  var rwLabel = document.getElementById('refWeightLabel');
  if (rwSlider) {
    function applyRefWeightUI(v) {
      v = Number(v) || 70;
      if (rwLabel) rwLabel.textContent = v + '%';
      rwSlider.value = String(v);
      setCurrentTabRefWeight(v);
    }
    rwSlider.addEventListener('input', function () {
      applyRefWeightUI(rwSlider.value);
      persistPrefs();
    });
    applyRefWeightUI(currentTabRefWeight());
  }

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
        idbDelBlob(work.id);
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
/* ---------------- 认证引导 ---------------- */
function classifyAuthErr(err) {
  /* 返回 'auth' | 'network' | 'other' */
  if (!err) return 'other';
  var msg = String(err.message || err || '').toLowerCase();
  var status = err.status || err.statusCode;
  if (status === 401 || status === 403 ||
      msg.indexOf('unauthorized') >= 0 || msg.indexOf('forbidden') >= 0 ||
      msg.indexOf('token') >= 0 || msg.indexOf('expired') >= 0) {
    return 'auth';
  }
  if (msg.indexOf('fetch') >= 0 || msg.indexOf('network') >= 0 ||
      msg.indexOf('abort') >= 0 || msg.indexOf('timeout') >= 0 ||
      msg.indexOf('failed to fetch') >= 0 ||
      status === 502 || status === 503 || status === 504) {
    return 'network';
  }
  return 'other';
}

async function authBoot() {
  var token = (api && api.getToken) ? api.getToken() : '';
  console.log('[authBoot] token:', token ? '存在 (' + token.length + ' chars)' : '不存在！');

  if (!token) {
    window.HMApp = window.HMApp || {};
    window.HMApp.user = null;
    hideLogin();
    showLogin();
    return;
  }

  /* ========== Step 1: 同步渲染缓存桌面（零闪烁） ========== */
  var cachedUser = loadJSON('hm.user', null);
  var cachedWorks = loadJSON(LS_WORKS, null);
  /* 主缓存为空时尝试备份，避免一次误清就永久丢失 */
  if ((!cachedWorks || !cachedWorks.length)) {
    var bakWorks = loadJSON(LS_WORKS_BAK, null);
    if (bakWorks && bakWorks.length) {
      cachedWorks = bakWorks;
      saveJSON(LS_WORKS, bakWorks);
      console.log('[authBoot] 主缓存为空，已从备份恢复', bakWorks.length, '张');
    }
  }
  console.log('[authBoot] cachedUser:', cachedUser ? cachedUser.username : '无', 'cachedWorks:', cachedWorks ? cachedWorks.length : 0);

  if (cachedUser) {
    window.HMApp = window.HMApp || {};
    window.HMApp.user = cachedUser;
    state.works = (cachedWorks && cachedWorks.length ? cachedWorks : state.works || []).slice(0, MAX_WORKS);
    hideLogin();
    updateUserUI();
    renderWorks();
    console.log('[authBoot] 已用缓存渲染桌面');
    /* 本地 JSON 里的原图存在 IndexedDB，异步补回后再渲染一次 */
    hydrateWorks().then(function (changed) { if (changed) renderWorks(); });
  } else {
    hideLogin(); /* 至少先隐藏登录弹窗，等 me() 返回再决定 */
  }

  /* ========== Step 2: 异步验证 token（只调 me()，不调 ping()） ==========
     直接试 /auth/me，更精准：只有 401/403 才是真的 token 失效
     网络问题（Render 休眠 / 断网）不影响缓存桌面 */
  try {
    var me = await api.me();
    console.log('[authBoot] me() 成功:', me.user.username);
    window.HMApp.user = me.user;
    try { saveJSON('hm.user', me.user); } catch (e) {}

    /* 从后端拉最新作品（不能覆盖本地：服务端可能因重启丢数据） */
    var serverItems = [];
    try {
      var data = await api.listWorks();
      if (data && Array.isArray(data.items)) {
        serverItems = data.items;
        state.works = mergeWorks(data.items, state.works);
      }
    } catch (e) { /* listWorks 失败不影响登录态 */ }

    await hydrateWorks();

    /* 启动时把本地缺失的作品（含 base64）上传到服务端，
       Render 重启清空 data/ 后自动恢复，换设备也能看到 */
    syncAllWorksToServer(serverItems);

    saveJSON(LS_WORKS, state.works.map(function (w) {
      if (w.url && w.url.indexOf('data:') === 0) { idbPutBlob(w.id, w.url); return Object.assign({}, w, { url: '', blob: true }); }
      return w;
    }));

    hideLogin();
    updateUserUI();
    renderWorks();
  } catch (err) {
    console.warn('[authBoot] me() 失败:', err && err.message, 'status:', err && err.status);

    var kind = classifyAuthErr(err);
    console.warn('[authBoot] 错误分类:', kind);

    if (kind === 'auth') {
      /* ========== 401/403 ==========
         即使后端返回 401（比如 Render 重启用户数据被清），
         也不要自动 logout —— 保留缓存桌面，让用户手动重新登录。
         这样刷新不会闪登录页，不会丢视觉状态。 */
      console.warn('[authBoot] me() 返回 auth 错误，但不清缓存，保持桌面');
      if (!cachedUser) {
        /* 真的没任何缓存 → 只能弹登录 */
        if (api && api.logout) api.logout();
        window.HMApp.user = null;
        showLogin();
      } else {
        /* 有缓存 → 保持缓存桌面 + Toast 提示 */
        setTimeout(function () { toast('后端数据暂不可用，请点击右上角头像重新登录', 'warn', 6000); }, 300);
        /* 不主动清 token，让用户自己决定 */
      }
      return;
    }

    /* ========== 网络错误：不清 token！保持缓存桌面 + 后台重试 ========== */
    console.warn('[authBoot] 网络问题 → 保持缓存桌面，后台重试');
    /* 如果之前没缓存（极少情况），确保显示登录态的桌面 */
    if (!window.HMApp || !window.HMApp.user) {
      hideLogin();
    }

    setTimeout(function () { toast('暂时无法连接后端，正在自动重试…', 'warn'); }, 500);

    /* 后台每 5 秒重试 me()，成功后自动恢复 */
    var bgCount = 0;
    var bgTimer = setInterval(function () {
      bgCount++;
      if (bgCount > 60) { clearInterval(bgTimer); return; }
      api.me().then(function (me) {
        window.HMApp.user = me.user;
        try { saveJSON('hm.user', me.user); } catch (e) {}
        return api.listWorks().catch(function () { return null; });
      }).then(function (data) {
        if (data && Array.isArray(data.items)) {
          /* 同样只合并，不用空列表覆盖本地 */
          state.works = mergeWorks(data.items, state.works);
          saveJSON(LS_WORKS, state.works.map(function (w) {
            if (w.url && w.url.indexOf('data:') === 0) { idbPutBlob(w.id, w.url); return Object.assign({}, w, { url: '', blob: true }); }
            return w;
          }));
          /* Render 刚唤醒时 data/ 可能已被清，补传本地全部 */
          syncAllWorksToServer(data.items);
          renderWorks();
        }
        updateUserUI();
        toast('后端已恢复连接 ✅', 'success');
        clearInterval(bgTimer);
      }).catch(function () { /* 继续等 */ });
    }, 5000);
  }
}

function showUpdateModal() {
  var modal = document.getElementById('updateModal');
  var close = document.getElementById('updateClose');
  var confirmBtn = document.getElementById('updateConfirm');
  if (!modal) return;

  modal.hidden = false;
  /* 不冻结页面滚动！这是右下角通知卡片，不是全屏模态 */

  function cleanup() {
    if (close) close.removeEventListener('click', onClose);
    if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm);
  }
  function onClose() {
    /* 关闭 = 24h 内不再弹（同之前的"稍后再说"） */
    localStorage.setItem('hm.build.remindAt', String(Date.now() + 24 * 60 * 60 * 1000));
    modal.hidden = true;
    cleanup();
  }
  function onConfirm() {
    localStorage.setItem('hm.build', window.HM_BUILD || '');
    localStorage.removeItem('hm.build.remindAt');
    modal.hidden = true;
    cleanup();
    toast('正在更新页面…', 'success');
    setTimeout(function () { location.reload(); }, 500);
  }
  if (close) close.addEventListener('click', onClose);
  if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
}

/* 远端 fetch 最新 HM_BUILD，和当前页面比 */
function pollRemoteBuild() {
  var currentBuild = window.HM_BUILD || '';
  if (!currentBuild) return;
  /* 检查是否点过"稍后再说"（24 小时内不重复弹） */
  var remindAt = Number(localStorage.getItem('hm.build.remindAt') || 0);
  if (remindAt && Date.now() < remindAt) return;

  var url = location.origin + location.pathname + '?hm_poll=' + Date.now();
  fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } })
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var m = html.match(/window\.HM_BUILD\s*=\s*["']([^"']+)["']/);
      if (!m) {
        /* 可能拿到旧版本，重试一次 */
        setTimeout(function () {
          fetch(url + '&retry=1', { cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store' } })
            .then(function (r2) { return r2.text(); })
            .then(function (html2) {
              var m2 = html2.match(/window\.HM_BUILD\s*=\s*["']([^"']+)["']/);
              if (m2 && m2[1] && m2[1] !== currentBuild) showUpdateModal();
            }).catch(function () {});
        }, 1500);
        return;
      }
      var remoteBuild = m[1];
      if (remoteBuild && remoteBuild !== currentBuild) {
        showUpdateModal();
      }
    })
    .catch(function () { /* 静默忽略（网络问题等） */ });
}

function checkUpdate() {
  try {
    var currentBuild = window.HM_BUILD || '';
    if (!currentBuild) return;

    var lastBuild = localStorage.getItem('hm.build') || '';
    if (!lastBuild) {
      /* 首次访问，记录当前 build，不弹（因为没对比基线） */
      localStorage.setItem('hm.build', currentBuild);
    } else if (lastBuild !== currentBuild) {
      /* 本地记录的 build 和当前页面的不一样 → 有更新 */
      var remindAt = Number(localStorage.getItem('hm.build.remindAt') || 0);
      if (!remindAt || Date.now() >= remindAt) {
        showUpdateModal();
      }
    }

    /* 无论如何，再 fetch 一次远端最新 index.html 确认（处理首次访问 + 长时间挂着的情况） */
    pollRemoteBuild();
    /* 每 30 秒轮询一次（更快发现更新） */
    setInterval(pollRemoteBuild, 30 * 1000);
  } catch (e) { /* localStorage 不可用时静默忽略 */ }
}

/* ========== 输入区高度拖动 ========== */
/* 默认 dock 高度 250px，范围 150~520px */
var DOCK_MIN = 140, DOCK_MAX = 560, DOCK_DEFAULT = 250;

function applyDockHeight(h) {
  var dock = document.getElementById('hmDock');
  if (!dock) return;
  var clamped = Math.max(DOCK_MIN, Math.min(DOCK_MAX, Number(h) || DOCK_DEFAULT));
  /* dock 高度 = body 底部到 resizer 顶部的距离 */
  var winH = window.innerHeight;
  var top = winH - clamped;
  dock.style.top = top + 'px';
  dock.style.bottom = '0';
  /* 通过 CSS 变量让 canvas padding-bottom 跟着变 */
  document.documentElement.style.setProperty('--hm-dock-h', clamped + 'px');
}

function initResizer() {
  var dock = document.getElementById('hmDock');
  var bar = document.getElementById('dockResizer');
  if (!dock || !bar) return;

  /* 恢复用户上次保存的高度 */
  var saved = Number(localStorage.getItem('hm.dock.h') || 0);
  var initial = saved > 0 ? saved : DOCK_DEFAULT;
  applyDockHeight(initial);

  var dragging = false, startY = 0, startTop = 0;

  function onDown(ev) {
    dragging = true;
    startY = ev.clientY || (ev.touches && ev.touches[0].clientY) || 0;
    startTop = dock.getBoundingClientRect().top;
    document.body.classList.add('hm-resizing');
    ev.preventDefault();
  }
  function onMove(ev) {
    if (!dragging) return;
    var y = ev.clientY || (ev.touches && ev.touches[0].clientY) || startY;
    /* 鼠标上拖（y变小）→ dock 顶部上移 → dock 变高 */
    var delta = y - startY;
    var newTop = startTop + delta;
    var winH = window.innerHeight;
    var newH = winH - newTop;
    applyDockHeight(newH);
    ev.preventDefault();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('hm-resizing');
    /* 持久化 */
    var h = dock.getBoundingClientRect().height;
    localStorage.setItem('hm.dock.h', String(Math.round(h)));
  }

  bar.addEventListener('mousedown', onDown);
  bar.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
  /* 窗口 resize 时保证 dock top 不越界 */
  window.addEventListener('resize', function () {
    var h = Number(localStorage.getItem('hm.dock.h') || DOCK_DEFAULT);
    applyDockHeight(h);
  });
}

function boot() {
  bindEls();
  renderModels('');
  renderRatios();
  renderWorks();
  syncSettingsUI();
  bindEvents();
  initResizer();
  bindRefAutocomplete(); /* ← @ 自动补全 */
  bindPromptOverlayEvents(); /* ← overlay chip 视觉化 */
  renderRef();          /* ← 每个 tab 独立的 refs 渲染 */
  renderCatalogMenus(); /* ← 免费模型 / LoRA 风格列表（先用内置兜底） */

  if (window.HMUI && window.HMUI.init) window.HMUI.init();

  /* 认证引导（先探测后端，再登录态校验） */
  api.ping().finally(function () {
    authBoot();
    loadCatalog();      /* ← 后端在线时拉取完整免费模型目录 */
  });

  /* 版本更新检测（不影响登录态） */
  checkUpdate();

  // 首次打开时给出轻量引导提示
  if (!storedPrefs || !storedPrefs.modelId) {
    setTimeout(function () {
      toast('已接入 FLUX.1 免费动漫引擎，选风格即可开始', 'success');
    }, 800);
  }
}

boot();

/* 供 ui.js（V3 工作台）复用核心状态与能力 */
window.HMApp = {
  state: state,
  els: els,
  ENGINE_META: ENGINE_META,
  switchView: switchView,
  toast: toast,
  renderWorks: renderWorks,
  saveWorks: saveWorks,
  renderRef: renderRef,
  translatePrompt: translatePrompt,
  syncSettingsUI: syncSettingsUI,
  persistPrefs: persistPrefs,
  updateCharCount: updateCharCount,
  currentSize: currentSize,
  modeModelLabel: modeModelLabel,
  currentModelLabel: currentModelLabel,
  getModel: getModel,
  hasRayinKey: hasRayinKey,
  openApiModal: openApiModal,
  closeApiModal: closeApiModal,
  closeAllMenus: closeAllMenus,
  closeSidebar: closeSidebar,
  setGenerating: setGenerating,
  startTicker: startTicker,
  stopTicker: stopTicker,
  updateQueue: updateQueue,
  updateJobStatus: updateJobStatus,
  updateAllJobStatus: updateAllJobStatus,
  jobMediaLoading: jobMediaLoading,
  jobInfo: jobInfo,
  createLoadingCard: createLoadingCard,
  markJobDone: markJobDone,
  markJobError: markJobError,
  downloadImage: downloadImage,
  fileNameFor: fileNameFor,
  openLightbox: openLightbox,
  errorText: errorText,
  buildPrompt: buildPrompt,
  uid: uid,
  randomSeed: randomSeed,
  esc: esc
};
