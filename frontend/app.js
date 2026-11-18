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
  gptModel: 'gpt-image-2',
  bananaModel: 'gemini-3.1-flash-image'
};

/* GPT-image 官方模型 fallback 链：用户选的模型失败时自动尝试下一个 */
const GPT_IMAGE_FALLBACKS = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];

const ENGINE_META = {
  flux: { label: 'FLUX.1', pill: 'FLUX.1 · 免费', hint: '免费 · 约 10 秒', meta: 'FLUX.1', free: true },
  openai: { label: '免费模型平台', pill: '免费额度 · 第三方', hint: '免费额度 · 需平台密钥', meta: 'Third-party', free: true },
  'gpt-image': { label: 'GPT-image', pill: 'GPT-image · RayinAPI', hint: 'RayinAPI · 按量计费', meta: 'GPT-image', free: false },
  banana: { label: 'Gemini Banana', pill: 'Gemini Banana · RayinAI', hint: 'RayinAI · Gemini 2.0 多模态生图', meta: 'Gemini Banana', free: false }
};

/* FLUX 免费引擎整组已下线：渠道只保留 GPT-image，keyless 目录恒为空 */
const CATALOG_FALLBACK = {
  keyless: [],
  /* 接入管理只保留 RayinAPI：第三方平台预设已从代码中删除，不再回灌 */
  providers: [],
  loras: [],
  rayin: [
    /* GPT 图像模型（OpenAI key → /images/generations） */
    { id: 'gpt-image-2', engine: 'gpt-image', model: 'gpt-image-2', name: 'GPT Image 2', badge: 'GPT · 标准', hint: '稳定通用 · OpenAI 原生生图' },
    { id: 'gpt-image-2.5-flare', engine: 'gpt-image', model: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', badge: 'GPT · 光影增强', hint: '光影绚丽 · 氛围渲染' },
    { id: 'gpt-image-2.5-sunburst', engine: 'gpt-image', model: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', badge: 'GPT · 细节爆发', hint: '高细节 · 锐度爆发' },
  ]
};

/* 这些平台标注「免费」，实际调用需注册充值/消耗额度，不属于可直接使用的免费资源：
 * 统一从内置目录移除（保留无 Key 的 Pollinations 系列与用户自建的 RayinAPI）。
 * 本机旧记录里若指向已移除平台，读取时自然被跳过，不报错。 */
CATALOG_FALLBACK.providers = [];

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
  { id: '16:9', w: 1344, h: 768 },
  { id: '9:16', w: 768, h: 1344 },
  { id: '21:9', w: 1344, h: 576 },
  { id: '1:1', w: 1024, h: 1024 },
  { id: '4:3', w: 1024, h: 768 },
  { id: '2:3', w: 672, h: 1008 },
  { id: '3:2', w: 1008, h: 672 },
  { id: '3:4', w: 768, h: 1024 },
  { id: '4:5', w: 768, h: 960 },
  { id: '5:4', w: 960, h: 768 }
];

/* 清晰度档位：以 1024 基准为 1K，按倍率放大得到 2K / 4K */
const SCALES = [
  { id: '1k', label: '标清 1K', mult: 1 },
  { id: '2k', label: '高清 2K', mult: 2 },
  { id: '4k', label: '超清 4K', mult: 4 },
  { id: 'custom', label: '自定义', mult: 1 }
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
    window.__hmLastSaveError = null;
    return true;
  } catch (err) {
    /* 记下真实异常（QuotaExceededError / SecurityError / 其他），提示文案据此区分原因 */
    window.__hmLastSaveError = err;
    return false;
  }
}

/* 按用户隔离的 localStorage key：
   已登录 → anidream.works.v1.<userId>
   未登录 → anidream.works.v1（访客共享空间）
   确保不同账号数据互不干扰，且同账号换设备/重启后能恢复 */
function currentUserId() {
  return (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
}
function worksLsKey(userId) {
  var uid = userId || currentUserId();
  return uid ? ('anidream.works.v1.' + uid) : 'anidream.works.v1';
}
function worksBakLsKey(userId) {
  var uid = userId || currentUserId();
  return uid ? ('anidream.works.v1.' + uid + '.bak') : 'anidream.works.v1.bak';
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

/* 像素统一取 8 的倍数，保持比例且避免后端整除裁剪 */
function round8(value) {
  const n = Math.max(64, Math.min(8192, Math.round(Number(value) || 0)));
  return Math.max(64, Math.round(n / 8) * 8);
}

/* 自定义档：以长度（宽）为准，高度按当前比例换算（自动侧对齐 8 的倍数） */
function customPixels(ratio) {
  const ar = ratio.w / ratio.h;
  const w = Math.max(64, Math.min(8192, Math.round(Number(state.customW) || ratio.w)));
  return { w: w, h: round8(w / ar) };
}

/* 实际像素 = 比例基准像素 × 档位倍率（1K×1 / 2K×2 / 4K×4；自定义用宽高） */
function currentSize() {
  const ratio = currentRatio();
  const scale = currentScale();
  if (scale.id === 'custom') {
    const px = customPixels(ratio);
    return { ratio: ratio, scale: scale, w: px.w, h: px.h };
  }
  return { ratio: ratio, scale: scale, w: round8(ratio.w * scale.mult), h: round8(ratio.h * scale.mult) };
}

/* 比例按钮上显示当前档位对应的像素 */
function ratioPixelsFor(r) {
  if (state.scale === 'custom') {
    const ar = r.w / r.h;
    const w = Math.max(64, Math.min(8192, Math.round(Number(state.customW) || r.w)));
    return { w: w, h: round8(w / ar) };
  }
  const mult = currentScale().mult;
  return { w: round8(r.w * mult), h: round8(r.h * mult) };
}

/* 请求里的 scale 字段：自定义档按最长边归到 1k/2k/4k（后端白名单兼容） */
function effectiveScaleId(size) {
  if (size.scale.id !== 'custom') return size.scale.id;
  const longEdge = Math.max(size.w, size.h);
  if (longEdge > 2800) return '4k';
  if (longEdge > 1400) return '2k';
  return '1k';
}

function fileNameFor(item) {
  const date = new Date();
  const stamp = '' + date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') +
    '_' + String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0');
  return '绘梦_' + safeName(item.title || item.prompt || item.modelName || '作品') + '_' + stamp + '_' + (item.seed || Date.now());
}

/* ---------------- 初始化状态 ---------------- */
const storedPrefs = loadJSON(LS_PREFS, {}) || {};
/* 按缓存用户加载对应作品 key，未登录走访客共享 key */
var initUser = loadJSON('hm.user', null);
var initWorksKey = initUser && initUser.id ? ('anidream.works.v1.' + initUser.id) : 'anidream.works.v1';
const storedWorks = loadJSON(initWorksKey, []);
const storedApi = loadJSON(LS_API, {}) || {};
/* 历史错误模型 ID 迁移：gpt-image-1 / 伪别名 gpt-image-2-all 等 → 官方 gpt-image-2 */
if (!storedApi.gptModel || /gpt-image-2-all|gpt-image-lite|^gemini-/.test(storedApi.gptModel)) {
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
  customW: Number(storedPrefs.customW) || 0,
  customH: Number(storedPrefs.customH) || 0,
  count: [1, 2, 4].indexOf(Number(storedPrefs.count)) >= 0 ? Number(storedPrefs.count) : 1,
  steps: clamp(Number(storedPrefs.steps) || 8, 4, 12),
  seed: Number(storedPrefs.seed) || randomSeed(),
  translate: storedPrefs.translate !== false,
  engine: ENGINE_META[storedPrefs.engine] ? storedPrefs.engine : 'gpt-image',
  channelModel: typeof storedPrefs.channelModel === 'string' && storedPrefs.channelModel
    ? storedPrefs.channelModel
    : 'gpt-image-2.5-flare',            // RayinAI 图像模型 ID（gpt-image* / gemini*）
  lora: typeof storedPrefs.lora === 'string' ? storedPrefs.lora : '',   // 动漫 LoRA 风格包 ID
  videoModel: typeof storedPrefs.videoModel === 'string' && storedPrefs.videoModel
    ? storedPrefs.videoModel
    : 'sora-2',
  audioModel: typeof storedPrefs.audioModel === 'string' && storedPrefs.audioModel
    ? storedPrefs.audioModel
    : 'tts-1',
  providerId: typeof storedPrefs.providerId === 'string' ? storedPrefs.providerId : '',
  /* 首尾帧补间服务地址：随账号 prefs 同步，可跨设备沿用 */
  toonApi: typeof storedPrefs.toonApi === 'string' && storedPrefs.toonApi
    ? storedPrefs.toonApi
    : 'http://127.0.0.1:7861',
  toon2Api: typeof storedPrefs.toon2Api === 'string' && storedPrefs.toon2Api
    ? storedPrefs.toon2Api
    : 'http://127.0.0.1:7862',
  /* 接入管理只保留 RayinAPI：本地旧的非 Rayin 平台配置读取时直接丢弃，不显示也不参与推导 */
  providers: (function () {
    const saved = loadJSON(LS_PROVIDERS, {}) || {};
    const kept = {};
    Object.keys(saved).forEach(function (k) {
      if (k.indexOf('__rayin') === 0) kept[k] = saved[k];
    });
    return kept;
  })(),
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
  tabRefWeights: [70],                // 每个 tab 全局参考主体强度（0~200）
  promptNames: [''],                  // 每个口袋的自定义名称，空字符串回退为编号
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

/* 出图通道迁移（一次性）：Gemini 图像在当前 Key 分组下没有账号承接
 * （chat/completions 返回 404 not supported by any configured account），
 * 统一切到 GPT-image 的可用模型 gpt-image-2.5-flare（/images/generations）。
 * 带版本标记，之后用户在模型菜单里手动选回 Gemini 不会被反复覆盖。 */
if (storedPrefs.rayinChannel !== 'gpt-image-2-base') {
  if (state.engine === 'banana') state.engine = 'gpt-image';
  /* 默认用最省积分的基础档 gpt-image-2；历史上被自动升到 flare 的一并降回 */
  if (!state.api.gptModel || /^gemini-/.test(state.api.gptModel) || state.api.gptModel === 'gpt-image-2.5-flare') {
    state.api.gptModel = 'gpt-image-2';
  }
  if (!state.channelModel || state.channelModel === 'gpt-image-2.5-flare') state.channelModel = 'gpt-image-2';
  storedPrefs.rayinChannel = 'gpt-image-2-base';
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(Object.assign({}, storedPrefs, {
      engine: state.engine,
      channelModel: state.channelModel
    })));
  } catch (e) {}
  try { localStorage.setItem(LS_API, JSON.stringify(state.api)); } catch (e) {}
}
/* 引擎与模型名必须自洽：gpt-image 端点只认 gpt-image*，banana 只认 gemini*。
 * 历史配置里常见 engine 已切、channelModel 还是旧通道的模型名，会 404。 */
/* 「免费模型 / 免费额度平台」整组已下线：本地旧选择（flux / openai）失效时
   自动落到当前真正可用的 RayinAI 通道，不做静默失败。 */
var freeChannelStale = state.engine !== 'gpt-image' || /^flux|^sana|^kolors/i.test(String(state.channelModel || ''));
if (state.engine !== 'gpt-image') state.engine = 'gpt-image';
/* FLUX 免费引擎已下线：本地旧选择（flux / sana / kolors…）统一回退到 gpt-image + gpt-image-2 */
if (/^flux|^sana|^kolors/i.test(String(state.channelModel || ''))) {
  state.channelModel = 'gpt-image-2';
}
/* Banana / Gemini 三个模型已下架：历史选择统一回退到 gpt-image-2，不留死选项。 */
if (/^gemini/i.test(state.channelModel || '') || /^banana/i.test(state.channelModel || '')) {
  state.channelModel = 'gpt-image-2';
}
if (/^gemini/i.test(state.api.gptModel || '') || /^flux|^sana|^kolors/i.test(String(state.api.gptModel || ''))) {
  state.api.gptModel = 'gpt-image-2';
}
if (state.engine === 'gpt-image' && !/^gpt-image/i.test(state.channelModel || '')) {
  state.channelModel = state.api.gptModel || 'gpt-image-2';
}
/* 清掉存着免费引擎的旧本地配置，避免下次启动再把 flux 读回来 */
if (freeChannelStale) {
  try {
    var cleanedPrefs = Object.assign({}, storedPrefs, {
      engine: 'gpt-image',
      channelModel: state.channelModel
    });
    delete cleanedPrefs.freeModel;
    localStorage.setItem(LS_PREFS, JSON.stringify(cleanedPrefs));
  } catch (e) {}
  try { localStorage.removeItem('anidream.queue.v1'); } catch (e) {}
}

/* ========== tab 状态辅助器 ==========
 * 每个 prompt tab 独立的 refs + refWeight。
 * tabRefs[i] / tabRefWeights[i] 分别对应 state.prompts[i]。
 */
function ensureTabSlots() {
  while (state.tabRefs.length < state.prompts.length) state.tabRefs.push([]);
  while (state.tabRefWeights.length < state.prompts.length) state.tabRefWeights.push(70);
  if (!Array.isArray(state.promptNames)) state.promptNames = [];
  while (state.promptNames.length < state.prompts.length) state.promptNames.push('');
  if (state.promptNames.length > state.prompts.length) state.promptNames.length = state.prompts.length;
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
  if (typeof scheduleComposerSave === 'function') scheduleComposerSave(); /* 参考图随桌面持久化 */
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

/* 参考主体强度 → 参考图卡片边长（px）：0% = 32、70% = 80、100% = 128、200% = 256，分段线性 */
function refWeightToCellSize(v) {
  v = Math.max(0, Math.min(200, Number(v) || 0));
  if (v <= 70) return 32 + (48 / 70) * v;
  if (v <= 100) return 80 + (48 / 30) * (v - 70);
  return 128 + (128 / 100) * (v - 100);
}
/* 按钮上直接显示当前两个值，不必打开浮层 */
function updateSliderBtn() {
  var t = document.getElementById('sliderBtnText');
  if (!t) return;
  var fs = document.getElementById('fontSizeSlider');
  var rw = document.getElementById('refWeightSlider');
  var parts = [];
  if (fs) parts.push(fs.value);
  if (rw) parts.push(rw.value + '%');
  t.textContent = parts.join(' · ');
}
/* 同步 range 的已填充段（图一样式：蓝色轨道到滑块位置） */
function syncRangeFill(input) {
  if (!input) return;
  var min = Number(input.min || 0);
  var max = Number(input.max || 100);
  var val = Number(input.value || 0);
  var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill', pct.toFixed(2) + '%');
}
/* 参考区变大后把输入台整体向上撑高：提示词框尺寸不变，工具条不被裁切 */
var _refDockExtra = 0;
var _refDockTimer = 0;
function fitRefDock() {
  var dock = document.getElementById('hmDock');
  if (!dock || typeof applyDockHeight !== 'function') return;
  var h = Math.round(dock.getBoundingClientRect().height);
  if (_refDockExtra > 0) {
    h -= _refDockExtra;
    _refDockExtra = 0;
    applyDockHeight(h);
  }
  var extra = dock.scrollHeight - dock.clientHeight;
  if (extra > 0) {
    _refDockExtra = extra;
    applyDockHeight(h + extra);
  }
}
/* 把当前强度实时刷到「参考主体」区域：整块卡片（含 + 槽）等比缩放，网格随之换行重排 */
function applyRefPreviewScale(v) {
  var size = refWeightToCellSize(v).toFixed(1) + 'px';
  var grid = document.getElementById('refGrid');
  if (grid) grid.style.setProperty('--hm-ref-size', size);
  var imgs = document.querySelectorAll('#refGrid .hm-ref-cell img');
  for (var i = 0; i < imgs.length; i++) imgs[i].style.transform = '';
  if (_refDockTimer) clearTimeout(_refDockTimer);
  _refDockTimer = setTimeout(fitRefDock, 120); /* 等卡片尺寸过渡结束再量 */
}

/* 参考主体强度 UI（顶层版本：bindEvents 里那份是局部函数，顶层调用不到会 ReferenceError 导致 boot 中断） */
function applyRefWeightUI(v) {
  v = Number(v);
  if (!isFinite(v)) v = 70;
  v = Math.max(0, Math.min(200, Math.round(v)));
  var slider = document.getElementById('refWeightSlider');
  var label = document.getElementById('refWeightLabel');
  if (label) label.textContent = v + '%';
  if (slider) {
    slider.value = String(v);
    syncRangeFill(slider);
  }
  setCurrentTabRefWeight(v);
  applyRefPreviewScale(v); /* 强度变了 → 预览图同步缩放 */
  updateSliderBtn();
}

/* 滑块浮层：点按钮开合，点外面或 Esc 关闭；拖动实时生效 */
(function bindSliderPopover() {
  var btn = document.getElementById('sliderBtn');
  var pop = document.getElementById('sliderPop');
  if (!btn || !pop) return;
  function open() {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    updateSliderBtn();
  }
  function close() {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (pop.hidden) open(); else close();
  });
  document.addEventListener('click', function (ev) {
    if (pop.hidden) return;
    if (pop.contains(ev.target) || btn.contains(ev.target)) return;
    close();
  });
  document.addEventListener('keydown', function (ev) {
    if (!pop.hidden && ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  updateSliderBtn();
})();

/* ========== 每个桌面（文件夹）独立的提示词与参考图，且跨刷新保留 ========== */
const LS_COMPOSER = 'anidream.composer.v1';
var _composerKey = '__space';       /* 当前已载入的桌面 key：'__space' = 个人空间 */
var _composerSaveTimer = 0;

function composerKeyOf(folderId) { return folderId ? String(folderId) : '__space'; }

function readComposerStore() {
  var store = loadJSON(LS_COMPOSER, {});
  return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
}

function composerSnapshot() {
  if (els.promptInput) state.prompts[state.activePrompt] = els.promptInput.value || '';
  return {
    prompts: state.prompts.slice(),
    names: state.promptNames.slice(),
    refs: state.tabRefs.map(function (arr) { return (arr || []).slice(); }),
    weights: state.tabRefWeights.slice(),
    active: state.activePrompt
  };
}

function saveComposer() {
  var store = readComposerStore();
  var snap = composerSnapshot();
  var entry = {
    prompts: snap.prompts,
    names: snap.names,
    refs: snap.refs,
    weights: snap.weights,
    active: snap.active
  };
  /* 参考图 dataUrl 太大，完整对象写 IndexedDB；localStorage 只留缩略图与元数据 */
  if (window.indexedDB) {
    idbPutBlobAsync('cmp:' + _composerKey, JSON.stringify(snap.refs));
    entry.refs = snap.refs.map(function (arr) {
      return (arr || []).map(function (r) {
        return {
          name: r.name, width: r.width, height: r.height, weight: r.weight,
          thumb: r.thumb || r.preview || '', refsIdb: true
        };
      });
    });
    entry.refsIdb = true;
  }
  store[_composerKey] = entry;
  if (saveJSON(LS_COMPOSER, store)) return;
  /* 仍写不进（IDB 不可用或其它键占满）：只保提示词与缩略预览，不丢文案 */
  entry.refs = snap.refs.map(function (arr) {
    return (arr || []).map(function (r) {
      return { thumb: r.thumb || r.preview || r.dataUrl, name: r.name, width: r.width, height: r.height, weight: r.weight, refsIdb: true };
    });
  });
  saveJSON(LS_COMPOSER, store);
}

function scheduleComposerSave() {
  if (_composerSaveTimer) clearTimeout(_composerSaveTimer);
  _composerSaveTimer = setTimeout(function () { _composerSaveTimer = 0; saveComposer(); }, 350);
}

function applyComposer(data) {
  var prompts = (data && Array.isArray(data.prompts) && data.prompts.length) ? data.prompts.slice() : ['', ''];
  var refs = (data && Array.isArray(data.refs)) ? data.refs.slice() : [];
  var weights = (data && Array.isArray(data.weights)) ? data.weights.slice() : [];
  var names = (data && Array.isArray(data.names)) ? data.names.slice() : [];
  while (refs.length < prompts.length) refs.push([]);
  while (weights.length < prompts.length) weights.push(70);
  while (names.length < prompts.length) names.push('');
  state.prompts = prompts;
  state.tabPrompts = prompts;
  state.promptNames = names.slice(0, prompts.length);
  state.tabRefs = refs;
  state.tabRefWeights = weights;
  state.activePrompt = Math.min(Math.max(Number(data && data.active) || 0, 0), prompts.length - 1);
  state.refImages = (refs[0] || []).slice();
  if (els.promptInput) els.promptInput.value = prompts[state.activePrompt] || '';
  renderPromptTabs();
  renderRef();
  applyRefWeightUI(currentTabRefWeight());
  updateCharCount();

  /* 参考图本体在 IndexedDB：先渲染缩略图，异步补回完整 dataUrl 后再渲染一次 */
  if (data && data.refsIdb && window.indexedDB) {
    var loadKey = _composerKey;
    idbGetBlob('cmp:' + loadKey).then(function (raw) {
      if (loadKey !== _composerKey || !raw) return;
      try {
        var full = JSON.parse(raw);
        if (!Array.isArray(full)) return;
        while (full.length < state.prompts.length) full.push([]);
        state.tabRefs = full;
        state.refImages = (full[0] || []).slice();
        renderRef();
      } catch (e) {}
    });
  }
}

/* desk.js 在每次切换桌面时调用：先把旧桌面的内容存下来，再载入新桌面的 */
function switchComposerFolder(folderId) {
  var next = composerKeyOf(folderId);
  if (next === _composerKey) return;
  if (_composerSaveTimer) { clearTimeout(_composerSaveTimer); _composerSaveTimer = 0; }
  saveComposer();
  _composerKey = next;
  if (!els.promptInput) return; /* app 还没完成 bindEls，等 boot 时统一恢复 */
  try {
    applyComposer(readComposerStore()[next] || null);
  } catch (err) {
    console.warn('[composer] 切换桌面恢复失败，已忽略：', err);
  }
}

window.HMComposer = {
  onFolderChange: switchComposerFolder,
  save: saveComposer,
  currentKey: function () { return _composerKey; }
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
  els.lbStage = document.getElementById('lbStage');
  els.lbImage = document.getElementById('lbImage');
  els.lbZoomBar = document.getElementById('lbZoomBar');
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
    const px = ratioPixelsFor(r);
    return '<button class="ratio-btn' + (r.id === state.ratio ? ' is-active' : '') + '" data-ratio="' + r.id + '" title="' + px.w + '×' + px.h + '">' +
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
  const readout = document.getElementById('scaleSizeText');
  if (readout) readout.textContent = '当前 ' + size.w + '×' + size.h + ' · ' + size.scale.label;
  if (state.scale === 'custom') {
    const cw = document.getElementById('customWInput');
    const ch = document.getElementById('customHInput');
    if (cw && document.activeElement !== cw) cw.value = String(size.w);
    if (ch && document.activeElement !== ch) ch.value = String(size.h);
  }
}

function filteredWorks() {
  let list = state.works.slice();
  if (state.worksFilter === 'free') {
    list = list.filter(function (w) { return (w.engine || 'flux') === 'flux'; });
  } else if (state.worksFilter === 'paid') {
    list = list.filter(function (w) { return (w.engine || 'flux') !== 'flux'; });
  } else if (state.worksFilter === 'image') {
    list = list.filter(function (w) { return !w.failed && w.ok !== false && w.type !== 'video' && w.type !== 'audio'; });
  } else if (state.worksFilter === 'video') {
    list = list.filter(function (w) { return !w.failed && w.ok !== false && w.type === 'video'; });
  }
  /* 时间筛选：与筛选/排序叠加，不改变原有排序能力 */
  const tr = tm.applied;
  if (tr && (tr.start || tr.end)) {
    list = list.filter(function (w) {
      const t = Number(w.createdAt) || 0;
      if (tr.start && t < tr.start) return false;
      if (tr.end && t > tr.end) return false;
      return true;
    });
  }
  list.sort(function (a, b) {
    const da = a.createdAt || 0;
    const db = b.createdAt || 0;
    return state.worksSort === 'oldest' ? da - db : db - da;
  });
  return list;
}

/* ================= 顶栏「时间筛选」面板 ================= */
const TM_STORE_KEY = 'anidream.works.timerange.v1';
const TM_QUICK_LABEL = {
  all: '全部', today: '今日', yesterday: '昨日', '24h': '近24H',
  '7d': '近 7 天', '30d': '近 30 天', month: '本月', lastmonth: '上月',
  quarter: '本季', year: '今年', custom: '自定义'
};

const tm = {
  applied: { quick: 'all', start: 0, end: 0 },
  draft: { quick: 'all', start: 0, end: 0 },
  month: new Date(),
  field: 'start',
  bound: false
};

function tmPad(n) { return (n < 10 ? '0' : '') + n; }

function tmDayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function tmDayEnd(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

function tmToInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.getFullYear() + '-' + tmPad(d.getMonth() + 1) + '-' + tmPad(d.getDate()) +
    'T' + tmPad(d.getHours()) + ':' + tmPad(d.getMinutes()) + ':' + tmPad(d.getSeconds());
}

function tmFromInput(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

function tmQuickRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  switch (key) {
    case 'today':
      return { start: tmDayStart(now), end: tmDayEnd(now) };
    case 'yesterday': {
      const t = new Date(y, mo, d - 1);
      return { start: tmDayStart(t), end: tmDayEnd(t) };
    }
    case '24h':
      return { start: now.getTime() - 24 * 3600 * 1000, end: now.getTime() };
    case '7d':
      return { start: now.getTime() - 7 * 24 * 3600 * 1000, end: now.getTime() };
    case '30d':
      return { start: now.getTime() - 30 * 24 * 3600 * 1000, end: now.getTime() };
    case 'month':
      return { start: tmDayStart(new Date(y, mo, 1)), end: tmDayEnd(new Date(y, mo + 1, 0)) };
    case 'lastmonth':
      return { start: tmDayStart(new Date(y, mo - 1, 1)), end: tmDayEnd(new Date(y, mo, 0)) };
    case 'quarter': {
      const q = Math.floor(mo / 3) * 3;
      return { start: tmDayStart(new Date(y, q, 1)), end: tmDayEnd(new Date(y, q + 3, 0)) };
    }
    case 'year':
      return { start: tmDayStart(new Date(y, 0, 1)), end: tmDayEnd(new Date(y, 11, 31)) };
    default:
      return { start: 0, end: 0 };
  }
}

function tmText() {
  const a = tm.applied;
  if (!a.start && !a.end) return '时间筛选';
  if (a.quick && a.quick !== 'custom' && TM_QUICK_LABEL[a.quick]) return TM_QUICK_LABEL[a.quick];
  const year = new Date().getFullYear();
  const fmt = function (ms) {
    const d = new Date(ms);
    return (d.getFullYear() === year ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate();
  };
  if (a.start && a.end) return fmt(a.start) + ' - ' + fmt(a.end);
  return fmt(a.start || a.end);
}

function tmSave() {
  try { localStorage.setItem(TM_STORE_KEY, JSON.stringify(tm.applied)); } catch (e) {}
}

function tmLoad() {
  try {
    const raw = localStorage.getItem(TM_STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    tm.applied = {
      quick: typeof data.quick === 'string' ? data.quick : 'custom',
      start: Number(data.start) || 0,
      end: Number(data.end) || 0
    };
    if (tm.applied.quick === 'all') { tm.applied.start = 0; tm.applied.end = 0; }
    /* 相对区间（今日/近7天/本月…）在重新打开时按当前时间重新计算 */
    if (tm.applied.quick && tm.applied.quick !== 'custom' && tm.applied.quick !== 'all') {
      const r = tmQuickRange(tm.applied.quick);
      tm.applied.start = r.start;
      tm.applied.end = r.end;
    }
    tm.draft = { quick: tm.applied.quick, start: tm.applied.start, end: tm.applied.end };
  } catch (e) {}
}

function tmSyncWarn() {
  const bad = !!(tm.draft.start && tm.draft.end && tm.draft.start > tm.draft.end);
  const warn = document.getElementById('tmWarn');
  if (warn) warn.hidden = !bad;
  const fStart = document.querySelector('.hm-tm-field[data-field="start"]');
  const fEnd = document.querySelector('.hm-tm-field[data-field="end"]');
  if (fStart) fStart.classList.toggle('is-invalid', bad);
  if (fEnd) fEnd.classList.toggle('is-invalid', bad);
  return !bad;
}

function tmSyncFieldState() {
  document.querySelectorAll('.hm-tm-field').forEach(function (field) {
    field.classList.toggle('is-active', field.dataset.field === tm.field);
  });
  tmRenderCal();
}

function tmRenderCal() {
  const grid = document.getElementById('tmCalGrid');
  const label = document.getElementById('tmCalLabel');
  if (!grid) return;
  const now = new Date();
  const y = tm.month.getFullYear();
  const m = tm.month.getMonth();
  if (label) label.textContent = y + ' 年 ' + (m + 1) + ' 月';
  const offset = new Date(y, m, 1).getDay();
  const todayKey = tmDayStart(now);
  const sKey = tmDayStart(new Date(tm.draft.start || tmDayStart(now)));
  const eKey = tmDayStart(new Date(tm.draft.end || tmDayEnd(now)));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const dt = new Date(y, m, 1 - offset + i);
    const key = tmDayStart(dt);
    const cls = ['hm-tm-day'];
    if (dt.getMonth() !== m) cls.push('is-out');
    if (key === todayKey) cls.push('is-today');
    if (sKey <= eKey && key >= sKey && key <= eKey) {
      cls.push(key === sKey || key === eKey ? 'is-sel' : 'in-range');
    }
    html += '<button type="button" class="' + cls.join(' ') + '" data-ms="' + key + '">' + dt.getDate() + '</button>';
  }
  grid.innerHTML = html;
}

function tmSync() {
  const now = new Date();
  const showStart = tm.draft.start || tmDayStart(now);
  const showEnd = tm.draft.end || tmDayEnd(now);
  const inputStart = document.getElementById('tmStart');
  const inputEnd = document.getElementById('tmEnd');
  if (inputStart) inputStart.value = tmToInput(showStart);
  if (inputEnd) inputEnd.value = tmToInput(showEnd);
  document.querySelectorAll('#tmQuick [data-quick]').forEach(function (btn) {
    btn.classList.toggle('is-active', btn.dataset.quick === tm.draft.quick);
  });
  document.querySelectorAll('#worksSortMenu [data-sort]').forEach(function (btn) {
    btn.classList.toggle('is-active', btn.dataset.sort === state.worksSort);
  });
  document.querySelectorAll('.hm-tm-field').forEach(function (field) {
    field.classList.toggle('is-active', field.dataset.field === tm.field);
  });
  if (els.worksSortText) els.worksSortText.textContent = tmText();
  tmSyncWarn();
  tmRenderCal();
}

function tmPickDay(ms) {
  const day = new Date(ms);
  const base = tm.field === 'end' ? tm.draft.end : tm.draft.start;
  let h = 0, mi = 0, s = 0;
  if (base) {
    const b = new Date(base);
    h = b.getHours(); mi = b.getMinutes(); s = b.getSeconds();
  } else if (tm.field === 'end') {
    h = 23; mi = 59; s = 59;
  }
  tm.draft[tm.field] = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, s).getTime();
  tm.draft.quick = 'custom';
  tm.month = new Date(day.getFullYear(), day.getMonth(), 1);
  if (tm.field === 'start') tm.field = 'end';
  tmSync();
  tmCommitLive();
}

function tmCommitLive() {
  const d = tm.draft;
  if (d.start && d.end && d.start > d.end) return; /* 起止顺序不合法时先不应用 */
  tm.applied = {
    quick: d.quick,
    start: d.quick === 'all' ? 0 : d.start,
    end: d.quick === 'all' ? 0 : d.end
  };
  tmSave();
  if (els.worksSortText) els.worksSortText.textContent = tmText();
  renderWorks(); /* 选中即刷新列表，弹窗保持打开可继续调整 */
}

function tmApply() {
  if (!tmSyncWarn()) return;   /* 起始晚于结束：红字提示，不应用 */
  const d = tm.draft;
  let start = d.start;
  let end = d.end;
  if (d.quick === 'all') { start = 0; end = 0; }
  tm.applied = { quick: d.quick, start: start, end: end };
  tmSave();
  if (els.worksSortText) els.worksSortText.textContent = tmText();
  renderWorks();
  closeAllMenus();
  switchView('works');
  toast(start || end ? ('已筛选：' + tmText()) : '已显示全部时间', 'success');
}

function tmClear() {
  tm.draft = { quick: 'all', start: 0, end: 0 };
  tm.applied = { quick: 'all', start: 0, end: 0 };
  tm.field = 'start';
  tm.month = new Date();
  tmSave();
  if (els.worksSortText) els.worksSortText.textContent = '时间筛选';
  renderWorks();
  tmSync();
  closeAllMenus();
  toast('已清除时间筛选', 'info');
}

function tmBind() {
  const menu = els.worksSortMenu;
  if (!menu || tm.bound) return;
  tm.bound = true;

  const quick = document.getElementById('tmQuick');
  if (quick) {
    quick.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-quick]');
      if (!btn) return;
      const key = btn.dataset.quick;
      tm.draft.quick = key;
      if (key !== 'custom') {
        const r = tmQuickRange(key);
        tm.draft.start = r.start;
        tm.draft.end = r.end;
        const anchor = r.start || Date.now();
        const ad = new Date(anchor);
        tm.month = new Date(ad.getFullYear(), ad.getMonth(), 1);
        tm.field = 'start';
      }
      tmSync();
      tmCommitLive();
    });
  }

  const grid = document.getElementById('tmCalGrid');
  if (grid) {
    grid.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-ms]');
      if (btn) tmPickDay(Number(btn.dataset.ms));
    });
  }

  const prev = document.getElementById('tmPrev');
  const next = document.getElementById('tmNext');
  if (prev) prev.addEventListener('click', function () {
    tm.month = new Date(tm.month.getFullYear(), tm.month.getMonth() - 1, 1);
    tmRenderCal();
  });
  if (next) next.addEventListener('click', function () {
    tm.month = new Date(tm.month.getFullYear(), tm.month.getMonth() + 1, 1);
    tmRenderCal();
  });

  document.querySelectorAll('.hm-tm-field').forEach(function (field) {
    field.addEventListener('click', function (event) {
      tm.field = field.dataset.field;
      tmSyncFieldState();
      if (!event.target.closest('input')) {
        const input = document.getElementById(tm.field === 'end' ? 'tmEnd' : 'tmStart');
        if (input) { try { input.focus(); } catch (e) {} }
      }
    });
  });

  const bindInput = function (which, el) {
    if (!el) return;
    const handler = function () {
      tm.draft[which] = tmFromInput(el.value);
      tm.draft.quick = 'custom';
      tm.field = which;
      document.querySelectorAll('#tmQuick [data-quick]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.dataset.quick === 'custom');
      });
      tmSyncFieldState();
      tmSyncWarn();
    };
    el.addEventListener('change', handler);
    el.addEventListener('blur', handler);
  };
  bindInput('start', document.getElementById('tmStart'));
  bindInput('end', document.getElementById('tmEnd'));

  const applyBtn = document.getElementById('tmApply');
  const clearBtn = document.getElementById('tmClear');
  if (applyBtn) applyBtn.addEventListener('click', tmApply);
  if (clearBtn) clearBtn.addEventListener('click', tmClear);

  /* 排序能力保留（原「最新优先 / 最早优先」） */
  menu.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-sort]');
    if (!btn) return;
    state.worksSort = btn.dataset.sort;
    menu.querySelectorAll('[data-sort]').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.sort === state.worksSort);
    });
    renderWorks();
    closeAllMenus();
    switchView('works');
  });

  /* 打开面板时把「已应用」同步进草稿（非全局监听，仅本按钮） */
  if (els.worksSortBtn) {
    els.worksSortBtn.addEventListener('click', function () {
      tm.draft = { quick: tm.applied.quick, start: tm.applied.start, end: tm.applied.end };
      const anchor = tm.draft.start || Date.now();
      const ad = new Date(anchor);
      tm.month = new Date(ad.getFullYear(), ad.getMonth(), 1);
      tm.field = 'start';
      tmSync();
    });
  }

  tmSync();
}

tmLoad();


/* 作品卡片按类型渲染图片 / 视频 / 音频 */
function workMediaHtml(work) {
  if (work.failed || work.ok === false) {
    return '<div class="work-failed">' + ICONS.alert + '<strong>生成失败</strong><span>' + esc(work.error || '本次生成未成功') + '</span></div>';
  }

  var url = esc(work.url || work.thumb || '');
  if (work.type === 'video') {
    return '<video class="work-video" src="' + url + '" muted playsinline preload="metadata"></video>';
  }
  if (work.type === 'audio') {
    return '<div class="work-audio">♪</div>';
  }
  return '<img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy" draggable="true">';
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
      var isFailed = !!(work.failed || work.ok === false);
      return '<article class="work-card' + (isFailed ? ' is-failed' : '') + '" data-work="' + work.id + '">' +

        workMediaHtml(work) +
        '<div class="work-overlay">' +
          '<button data-waction="download" title="' + (isFailed ? '无可下载的图片' : '下载原图') + '"' + (isFailed ? ' disabled' : '') + '>' + ICONS.download + '</button>' +
          '<button data-waction="view" title="查看大图">' + ICONS.eye + '</button>' +
          '<button data-waction="ref" title="设为参考主体"' + (isFailed ? ' disabled' : '') + '>' + ICONS.reuse + '</button>' +
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

/* 描述多标签（口袋）：可增删、可重命名，数量上限按参考主体区域当前宽度动态计算 */
function promptTabAreaWidth() {
  var drop = document.getElementById('refDrop');
  var w = drop && !drop.hidden ? drop.clientWidth : 0;
  if (!w) {
    var comp = document.getElementById('composer');
    w = comp ? comp.clientWidth - 24 : 360;
  }
  return Math.max(160, Math.floor(w));
}
function promptTabMaxCount() {
  /* 单个口袋约 50px（40 最小宽 + 内边距），加号 30px，间距 4px；
     按参考主体区域可用宽度算，至少 1 个，最多 12 个。 */
  var w = promptTabAreaWidth();
  return Math.max(1, Math.min(12, Math.floor((w + 4) / 60)));
}
function promptTabLabel(index) {
  var name = (state.promptNames && state.promptNames[index]) || '';
  name = String(name).trim();
  return name || String(index + 1);
}
function renderPromptTabs() {
  if (!els.promptTabs || !els.addPromptTab) return;
  ensureTabSlots();
  /* 重建 DOM 会丢焦点：如果焦点原本在口袋上，重建后落回当前选中的口袋，
     否则「选中口袋后按 Delete」会因为 target 变成 body 而失效 */
  var keepFocus = !!(document.activeElement && document.activeElement.closest &&
    document.activeElement.closest('.hm-tab[data-tab]'));
  els.promptTabs.querySelectorAll('.hm-tab[data-tab]').forEach(function (node) { node.remove(); });
  state.prompts.forEach(function (_, index) {
    const btn = document.createElement('button');
    btn.className = 'hm-tab' + (index === state.activePrompt ? ' is-active' : '');
    btn.dataset.tab = String(index);
    btn.title = (state.promptNames[index] || '口袋 ' + (index + 1)) + '（双击重命名；选中后按 Delete / Backspace 删除）';
    btn.setAttribute('aria-label', '口袋 ' + promptTabLabel(index));
    var label = document.createElement('span');
    label.className = 'hm-tab-label';
    label.textContent = promptTabLabel(index);
    btn.appendChild(label);
    els.promptTabs.insertBefore(btn, els.addPromptTab);
  });
  els.addPromptTab.hidden = state.prompts.length >= promptTabMaxCount();
  if (keepFocus) {
    var activeTab = els.promptTabs.querySelector('.hm-tab.is-active');
    if (activeTab) activeTab.focus();
  }
}

function switchPromptTab(index) {
  if (index === state.activePrompt) return;
  state.prompts[state.activePrompt] = els.promptInput.value;
  if (typeof state.prompts[index] !== 'string') state.prompts[index] = '';
  state.activePrompt = index;
  ensureTabSlots();
  els.promptInput.value = state.prompts[index];
  if (_richEl) richRenderFromValue();
  renderPromptTabs();
  renderRef(); /* ← 切换 tab 时切换独立的 ref 网格 */
  applyRefWeightUI(currentTabRefWeight()); /* ← 同步 ref 强度 slider */
  updateCharCount();
  scheduleComposerSave();
}

/* 删除口袋：编号自动顺延，选中态落到相邻口袋；至少保留一个 */
function deletePromptTab(index) {
  ensureTabSlots();
  if (index < 0 || index >= state.prompts.length) return;
  state.prompts[state.activePrompt] = els.promptInput.value || '';
  if (state.prompts.length <= 1) {
    state.prompts = [''];
    state.promptNames = [''];
    state.tabRefs = [[]];
    state.tabRefWeights = [70];
    state.activePrompt = 0;
  } else {
    state.prompts.splice(index, 1);
    state.promptNames.splice(index, 1);
    state.tabRefs.splice(index, 1);
    state.tabRefWeights.splice(index, 1);
    if (state.activePrompt > index) state.activePrompt -= 1;
    else if (state.activePrompt === index) state.activePrompt = Math.min(index, state.prompts.length - 1);
  }
  state.tabPrompts = state.prompts;
  ensureTabSlots();
  els.promptInput.value = state.prompts[state.activePrompt] || '';
  if (_richEl) richRenderFromValue();
  renderPromptTabs();
  renderRef();
  applyRefWeightUI(currentTabRefWeight());
  updateCharCount();
  scheduleComposerSave();
}

/* 双击口袋重命名；空名字回退为编号 */
function renamePromptTab(index) {
  ensureTabSlots();
  if (index < 0 || index >= state.prompts.length) return;
  var cur = state.promptNames[index] || '';
  var input = window.prompt('口袋名称（留空则显示编号 ' + (index + 1) + '）', cur);
  if (input === null) return;
  state.promptNames[index] = String(input).trim().slice(0, 12);
  renderPromptTabs();
  scheduleComposerSave();
}

/* 新增 tab 时也要同步 refs 插槽 */
function addPromptTab() {
  if (state.prompts.length >= promptTabMaxCount()) return;
  ensureTabSlots();
  state.prompts[state.activePrompt] = els.promptInput.value;
  state.prompts.push('');
  state.promptNames.push('');
  state.tabRefs.push([]);
  state.tabRefWeights.push(70);
  state.activePrompt = state.prompts.length - 1;
  els.promptInput.value = '';
  renderPromptTabs();
  renderRef();
  applyRefWeightUI(currentTabRefWeight());
  updateCharCount();
  scheduleComposerSave();
  els.promptInput.focus();
}

/* 窗口变窄/缩放字号/拖拽 composer 后，按参考主体区域宽度重算口袋上限 */
var _promptTabResizeTimer = 0;
function schedulePromptTabLimitRefresh() {
  if (_promptTabResizeTimer) clearTimeout(_promptTabResizeTimer);
  _promptTabResizeTimer = setTimeout(function () {
    _promptTabResizeTimer = 0;
    renderPromptTabs();
  }, 120);
}
window.addEventListener('resize', schedulePromptTabLimitRefresh);
if (window.ResizeObserver) {
  var _promptTabRO = new ResizeObserver(schedulePromptTabLimitRefresh);
  var _composerEl = document.getElementById('composer');
  if (_composerEl) _promptTabRO.observe(_composerEl);
}

/* 档位图标：1K/2K 柱状，4K 与自定义用板状 */
const SCALE_ICONS = {
  bars: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17V7h5v10H4Zm7 0V4h5v13h-5Zm7 0v-6h5v6h-5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  slab: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7.5" width="18" height="9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 13.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".65"/></svg>',
  tune: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9M17 8h3M4 16h3M11 16h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="15" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="16" r="2.1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
};

function syncScaleChip() {
  if (els.scaleChipText) {
    els.scaleChipText.textContent = state.scale === 'custom' ? '自定义' : String(state.scale).toUpperCase();
  }
  const icon = document.getElementById('scaleChipIcon');
  if (icon) icon.innerHTML = state.scale === 'custom' ? SCALE_ICONS.tune : state.scale === '4k' ? SCALE_ICONS.slab : SCALE_ICONS.bars;
}

function toggleCustomRow() {
  const row = document.getElementById('scaleCustomRow');
  if (row) row.hidden = state.scale !== 'custom';
}

function syncSettingsUI() {
  els.seedInput.value = String(state.seed);
  if (els.stepsRange) els.stepsRange.value = String(state.steps);
  updateStepsUI();
  const countIndex = COUNT_OPTIONS.indexOf(state.count);
  if (els.countValue) els.countValue.textContent = String(state.count);
  els.countPicker.querySelectorAll('[data-step]').forEach(function (btn) {
    const step = Number(btn.dataset.step);
    btn.disabled = step < 0 ? countIndex <= 0 : countIndex >= COUNT_OPTIONS.length - 1;
  });
  els.scalePicker.querySelectorAll('[data-scale]').forEach(function (btn) {
    btn.classList.toggle('is-active', btn.dataset.scale === state.scale);
  });
  syncScaleChip();
  toggleCustomRow();
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
  return !!String(rayinCfg().key || '').trim() || !!rayinChannelKey(state.engine);
}

/* 「接入设置」把每个通道的 Key 存在 providers 里（__rayin__:gpt-image / __rayin__:banana），
   过去只从 state.api.key 取值，换过通道后这里为空，请求就不带 Key，
   服务端只能靠环境变量 OPENAI_KEY —— 没配时 gpt-image 直接报「未配置 RayinAPI Key」。
   这里按通道把真实 Key 找出来，随生成请求一起带给后端。 */
function rayinChannelKey(engine) {
  var api = rayinCfg();
  var provs = api && api.providers;
  if (!provs || typeof provs !== 'object') return '';
  var ids = Object.keys(provs);
  var found = '';
  var keyOf = function (p) { return p && typeof p.key === 'string' ? p.key.trim() : ''; };
  /* 与当前选择模型同名的最优先，其次按引擎匹配 */
  var picked = String(state.channelModel || '');
  ids.forEach(function (id) {
    var p = provs[id];
    if (!found && keyOf(p) && picked && String(p.model || '') === picked) found = keyOf(p);
  });
  ids.forEach(function (id) {
    var p = provs[id];
    if (!found && keyOf(p) && String(p.engine || '') === engine) found = keyOf(p);
  });
  if (!found && engine === 'gpt-image') found = keyOf(provs['__rayin__:gpt-image']);
  if (!found && engine === 'banana') found = keyOf(provs['__rayin__:banana']);
  return found;
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
  /* 新增接入唯一选项：RayinAPI（地址 + 密钥即可用） */
  els.providerSelect.innerHTML = '<option value="__rayin__">RayinAPI</option>';
  els.providerSelect.value = '__rayin__';
}

function fillProviderFields(providerId) {
  const cfg = providerConfig(providerId);
  if (els.providerBaseInput) els.providerBaseInput.value = cfg.base || '';
  if (els.providerKeyInput) els.providerKeyInput.value = cfg.key || '';
  if (els.providerModelInput) els.providerModelInput.value = cfg.model || '';
  if (els.providerKeyLink) {
    const url = (cfg.preset && cfg.preset.keyUrl) || 'https://www.rayinai.com';
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

/* 模型菜单：只渲染 RayinAI 可用模型 + 动漫 LoRA 风格。
 * 「免费模型 / 免费额度平台」整组已下线：这些条目要消耗额度或依赖第三方授权，
 * 之前由后端 /catalog 的 providers 合并回来，现在连入口一起移除。 */
function renderCatalogMenus() {
  const data = catalogData();

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
      /* FLUX 免费引擎已下线：即便后端还返回 keyless，也不采用 */
      keyless: [],
      /* 接入管理只保留 RayinAPI：后端 /catalog 里即便还带第三方平台，也不采用 */
      providers: [],
      /* Banana/Gemini 三个模型已下架：即使后端还没摘掉，也一律过滤，只留 gpt-image */
      rayin: ((data.rayin && data.rayin.length) ? data.rayin : (CATALOG_FALLBACK.rayin || []))
        .filter(function (m) { return /^gpt-image/i.test(String((m && m.model) || (m && m.id) || '')); }),
      loras: data.loras || []
    };
    renderCatalogMenus();
  } catch (err) { /* 保留内置兜底目录 */ }
}

function syncEngineUI() {
  const meta = ENGINE_META[state.engine] || ENGINE_META['gpt-image'];
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
    /* 服务端已内置 GPT / Gemini 默认密钥，前端不填也能直接生成；
       用户可在「接入设置」里填自己的 key 覆盖服务端默认值 */
    els.engineNote.textContent = '使用服务端默认密钥 · 可在「接入设置」中覆盖';
    els.engineNote.classList.remove('is-warn');
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
    els.refNote.textContent = '当前描述 · 支持多参考图 · 提示词中用 图1 图2 图3 等引用（最多 ' + REF_MAX_COUNT + ' 张）';
    els.refNote.classList.remove('is-warn');
  } else {
    els.refNote.textContent = '当前描述已添加 ' + count + ' 张参考图 · 拖动滑块可整体缩放参考图 · 用 图1~图' + count + ' 在提示词中指定';
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
  var ref = list[idx];
  if (!ref) return;
  /* 复用作品原有的查看组件（书架/结果区点开作品用的同一个 lightbox）：
     外观、工具栏、缩放、关闭方式完全一致，不再使用参考区自己的全屏预览 */
  if (typeof openLightbox === 'function') {
    openLightbox({
      type: 'image',
      url: ref.dataUrl || ref.preview || ref.thumb || '',
      thumb: ref.thumb || '',
      width: ref.width,
      height: ref.height,
      prompt: '参考图 图' + (idx + 1) + (ref.name ? ' · ' + ref.name : '')
    });
  }
  /* 侧栏隐藏沿用原状态类（lightbox 自身的 hm-lb-open 也会隐藏，这里保持兼容） */
  document.body.classList.add('hm-ref-fs-open');
}
function closeRefFullscreen() {
  _refFsIdx = -1;
  _refFsScale = 1;
  if (els.refFsImg) els.refFsImg.style.transform = 'scale(1)';
  if (els.refFullscreen) els.refFullscreen.hidden = true;
  if (els.lightbox && els.lightbox.classList.contains('is-open') && typeof closeLightbox === 'function') {
    closeLightbox();
  }
  /* 预览关闭后恢复侧边栏与把手 */
  document.body.classList.remove('hm-ref-fs-open');
}

/* ========== 调换参考图顺序 ==========
 * 移动后编号会整体变化，提示词里的 @图N 按「旧编号 → 新编号」重写，
 * 保证引用仍然指向原来那张图，而不是指向新位置上的别的图。 */
function reorderRefs(from, to) {
  var list = currentRefs();
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
  var moved = list.splice(from, 1)[0];
  list.splice(to, 0, moved);
  setCurrentRefs(list);
  var ta = els.promptInput;
  if (ta && ta.value) {
    ta.value = ta.value.replace(/@图(\d+)/g, function (m, n) {
      var oldIdx = Number(n);
      var newIdx = oldIdx;
      if (oldIdx === from + 1) newIdx = to + 1;
      else if (from < to && oldIdx > from + 1 && oldIdx <= to + 1) newIdx = oldIdx - 1;
      else if (from > to && oldIdx >= to + 1 && oldIdx < from + 1) newIdx = oldIdx + 1;
      return '@图' + newIdx;
    });
    updateCharCount();
    schedulePromptOverlay();
  }
  renderRef();
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
      /* 可键盘聚焦：focus-within 时显示中间图标，触屏也能稳定操作 */
      cell.tabIndex = 0;
      if (_refSelectedSet[idx]) cell.classList.add('is-selected');

      var check = _refSelectMode
        ? '<div class="hm-ref-check' + (_refSelectedSet[idx] ? ' is-on' : '') + '" data-check-idx="' + idx + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</div>'
        : '';

      /* 角标保持「图N」序号；上传文件名只放进悬停提示，不顶替角标 */
      var refFileName = String(ref.name || '').trim();
      var refCat = String(ref.category || ref.tag || '资产').trim() || '资产';
      cell.innerHTML =
        '<img alt="参考图 ' + (idx + 1) + '" src="' + (ref.preview || ref.dataUrl || ref.thumb) + '">' +
        '<span class="hm-ref-tag"' + (refFileName ? ' title="' + esc(refFileName) + '"' : '') + '>图片' + (idx + 1) + '</span>' +
        '<span class="hm-ref-cat">' + esc(refCat) + '</span>' +
        '<div class="hm-ref-tools">' +
          '<button type="button" class="hm-ref-tool" data-ref-act="view" title="查看大图" aria-label="查看大图">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>' +
          '</button>' +
          '<button type="button" class="hm-ref-tool" data-ref-act="mention" title="在提示词中引用" aria-label="在提示词中引用">@</button>' +
        '</div>' +
        '<button type="button" class="hm-ref-x" data-ref-act="del" title="删除这张参考图" aria-label="删除">×</button>' +
        check;

      cell.querySelectorAll('[data-ref-act]').forEach(function (btn) {
        var act = btn.dataset.refAct;
        /* 动作只执行一次，pointerdown 与 click 双通道兜底：父级拖拽逻辑可能把其中一个吃掉 */
        var run = function (ev) {
          if (ev) { ev.preventDefault(); ev.stopPropagation(); }
          var now = Date.now();
          if (btn._hmActAt && now - btn._hmActAt < 500) return;
          btn._hmActAt = now;
          if (act === 'del') removeRefAt(idx);
          else if (act === 'view') openRefFullscreen(idx);
          else if (act === 'mention') insertPromptAt('@图' + (idx + 1) + ' ');
        };
        btn.addEventListener('pointerdown', run);
        btn.addEventListener('click', run);
      });

      /* 旧版本把 preview 存成了 1:1 裁切图：加载后若比例与原图不符，
         回退到完整 dataUrl，保证宽度按原图比例、不裁切。 */
      var cellImg = cell.querySelector('img');
      if (cellImg) {
        cellImg.addEventListener('load', function () {
          var refW = Number(ref.width) || 0;
          var refH = Number(ref.height) || 0;
          if (!refW || !refH || !cellImg.naturalWidth || !cellImg.naturalHeight) return;
          var want = refW / refH;
          var got = cellImg.naturalWidth / cellImg.naturalHeight;
          if (Math.abs(got - want) > want * 0.02 && ref.dataUrl && cellImg.getAttribute('src') !== ref.dataUrl) {
            cellImg.src = ref.dataUrl;
          }
        });
      }

      /* 事件：选择模式下点击 cell = toggle 选中；否则点击 = 打开全屏。
         触屏（无 hover）第一次点只聚焦，让中间两个图标出现，再点一次才开大图。 */
      cell.addEventListener('click', function (ev) {
        if (_refSelectMode) {
          ev.stopPropagation();
          toggleRefSelected(idx);
          return;
        }
        if (window.matchMedia && window.matchMedia('(hover: none)').matches && !cell.dataset.touchArmed) {
          cell.dataset.touchArmed = '1';
          try { cell.focus(); } catch (e) {}
          return;
        }
        openRefFullscreen(idx);
      });
      cell.addEventListener('focusout', function () { delete cell.dataset.touchArmed; });

      /* 键盘 Enter / Space 也打开大图（与点击一致） */
      cell.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (_refSelectMode) toggleRefSelected(idx);
          else openRefFullscreen(idx);
        }
      });

      /* 左右拖动调整参考图顺序：松手按落点插入，编号与提示词里的 @图N 一起更新 */
      cell.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        if (ev.target.closest && ev.target.closest('[data-ref-act]')) return;
        var startX = ev.clientX;
        var dragging = false;
        function onMove(e) {
          if (!dragging && Math.abs(e.clientX - startX) < 8) return;
          if (!dragging) { dragging = true; cell.style.opacity = '.55'; }
        }
        function onUp(e) {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          if (!dragging) return;
          cell.style.opacity = '';
          var target = document.elementFromPoint(e.clientX, e.clientY);
          var tCell = target && target.closest ? target.closest('.hm-ref-cell') : null;
          if (!tCell || tCell === cell || tCell.classList.contains('hm-ref-add')) return;
          reorderRefs(Number(cell.dataset.idx), Number(tCell.dataset.idx));
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });

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
        openRefPicker();
      });
      els.refGrid.appendChild(addCell);
    }

    els.refGrid.hidden = !hasRef;
    applyRefPreviewScale(currentTabRefWeight()); /* 新建的预览图按当前强度缩放 */
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
  /* 插在 textarea 前面，保证 textarea 在 overlay 之上（它只透明显示光标/选区） */
  wrap.insertBefore(_promptOverlayEl, ta);
  _syncPromptOverlayBox();
  return _promptOverlayEl;
}

/* 把 overlay 的盒模型、字体、换行规则精确对齐 textarea 的内容盒，
   两边度量完全一致，镜像出来的文字才不会错位 */
function _syncPromptOverlayBox() {
  var ta = els.promptInput;
  var overlay = _promptOverlayEl;
  if (!ta || !overlay) return;
  var cs = window.getComputedStyle(ta);
  /* 用视口矩形换算，不依赖 offsetParent 关系：overlay 的定位包含块可能是任意祖先 */
  var r = ta.getBoundingClientRect();
  var bl = parseFloat(cs.borderLeftWidth) || 0;
  var bt = parseFloat(cs.borderTopWidth) || 0;
  var parent = overlay.offsetParent || document.body || document.documentElement;
  var pr = parent.getBoundingClientRect();
  var pcs = window.getComputedStyle(parent);
  var pbl = parseFloat(pcs.borderLeftWidth) || 0;
  var pbt = parseFloat(pcs.borderTopWidth) || 0;
  overlay.style.left = (r.left + bl - pr.left - pbl + (parent.scrollLeft || 0)) + 'px';
  overlay.style.top = (r.top + bt - pr.top - pbt + (parent.scrollTop || 0)) + 'px';
  overlay.style.width = ta.clientWidth + 'px';
  overlay.style.height = ta.clientHeight + 'px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.padding = cs.padding;
  overlay.style.margin = '0';
  overlay.style.fontFamily = cs.fontFamily;
  overlay.style.fontSize = cs.fontSize;
  overlay.style.fontWeight = cs.fontWeight;
  overlay.style.lineHeight = cs.lineHeight;
  overlay.style.letterSpacing = cs.letterSpacing;
  overlay.style.whiteSpace = cs.whiteSpace;
  overlay.style.wordBreak = cs.wordBreak;
  overlay.style.overflowWrap = cs.overflowWrap;
  overlay.style.textAlign = cs.textAlign;
  overlay.scrollTop = ta.scrollTop;
  overlay.scrollLeft = ta.scrollLeft;
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
    var u = ref.thumb || ref.dataUrl || '';
    /* 深色胶囊：左侧小缩略图（绝对定位、不占宽度）+ "@N" 浅色文字，
       整体宽度与文本里的 @N 完全一致，连续多个也不会挤行 */
    /* 占位层用真实文本「@图N」定宽；视觉层绝对定位叠在占位上方：缩略图 → @ → 图N */
    return '<span class="chip"><span class="chip-ghost">@图' + (i + 1) + '</span>' +
      '<span class="chip-visual">' +
      '<span class="chip-thumb" style="background-image:url(' + u + ')"></span>' +
      '<span class="chip-at">@</span>' +
      '<span class="chip-label">图' + (i + 1) + '</span>' +
      '</span></span>';
  });
  return _chipCacheHtml;
}

/* ========== 富文本输入区（contenteditable，唯一排版来源） ==========
 * textarea 仅作隐藏数据源（发送、保存、@插入等既有逻辑全部读它），
 * 屏幕上的文字与胶囊只由这一层绘制，胶囊是参与排版的行内原子节点。 */
var _richEl = null;

function _richChipNode(n) {
  var list = currentRefs();
  var ref = list[n - 1];
  var el = document.createElement('span');
  el.className = 'rich-chip';
  el.contentEditable = 'false';
  el.dataset.ref = String(n);
  var img = '';
  if (ref) {
    var u = ref.thumb || ref.preview || ref.dataUrl || '';
    if (u) img = '<img alt="" src="' + u.replace(/"/g, '&quot;') + '">';
  }
  el.innerHTML = img + '<span>@</span><span>图' + n + '</span>';
  return el;
}

/* 把富文本节点还原成纯文本：胶囊 → @图N，换行按 br/块级 div 还原 */
function richSerializeIn(root) {
  if (!root) return '';
  var out = '';
  (function walk(node) {
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.nodeType === 3) { out += c.nodeValue.replace(/\u200b/g, ''); continue; }
      if (c.nodeType !== 1) continue;
      if (c.dataset && c.dataset.ref) { out += '@图' + c.dataset.ref; continue; }
      if (c.tagName === 'BR') { out += '\n'; continue; }
      if (c.tagName === 'DIV' || c.tagName === 'P') {
        if (out && out.charAt(out.length - 1) !== '\n') out += '\n';
        walk(c);
        continue;
      }
      walk(c);
    }
  })(root);
  return out.replace(/\n+$/, '');
}

function richSerialize() {
  return richSerializeIn(_richEl);
}

/* 用给定文本重建富文本 DOM（提示词框与全屏编辑器共用） */
function richRenderText(root, text) {
  if (!root) return;
  text = text || '';
  var frag = document.createDocumentFragment();
  var re = /@图(\d+)/g;
  var last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    frag.appendChild(_richChipNode(Number(m[1])));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  root.innerHTML = '';
  root.appendChild(frag);
  /* 外部改动后的重建：光标放到末尾，避免落点悬空 */
  if (document.activeElement === root) {
    try {
      var r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) {}
  }
}

/* 用 textarea 的值重建富文本 DOM（外部修改值后调用） */
function richRenderFromValue() {
  if (!_richEl) return;
  richRenderText(_richEl, (els.promptInput && els.promptInput.value) || '');
}

/* 富文本输入后：文本回写 textarea，保持既有发送/持久化链路不变 */
function richSyncToTextarea() {
  var ta = els.promptInput;
  if (!ta || !_richEl) return;
  var text = richSerialize();
  if (/@图0/.test(text)) return;
  if (text.length > 1800) {
    text = text.slice(0, 1800);
    ta.value = text;
    richRenderFromValue();
  } else {
    ta.value = text;
  }
  _chipCacheKey = '';
  _acKey = '';
  try { updateCharCount(); } catch (e) {}
  try { scheduleComposerSave(); } catch (e) {}
}

/* 在当前光标处插入引用胶囊 */
function richInsertRefChip(n) {
  if (!_richEl) return false;
  _richEl.focus();
  var sel = window.getSelection();
  var node = _richChipNode(n);
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(node);
    /* 胶囊后补一个空格，继续输入不贴着 */
    var space = document.createTextNode(' ');
    if (node.parentNode) node.parentNode.insertBefore(space, node.nextSibling);
    var nr = document.createRange();
    nr.setStart(space, 1);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
  } else {
    _richEl.appendChild(node);
    _richEl.appendChild(document.createTextNode(' '));
  }
  richSyncToTextarea();
  return true;
}

/* 手打 @图N 时即时转成胶囊（只处理光标前刚输入的完整 token） */
function richAutoConvertToken() {
  if (!_richEl || !document.activeElement) return;
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  var r = sel.getRangeAt(0);
  if (!r.collapsed) return;
  var node = r.startContainer;
  if (node.nodeType !== 3) return;
  var txt = node.nodeValue || '';
  var off = r.startOffset;
  var m = txt.slice(0, off).match(/@图(\d+)$/);
  if (!m) return;
  var n = Number(m[1]);
  if (!currentRefs()[n - 1]) return;
  var start = off - m[0].length;
  var del = document.createRange();
  del.setStart(node, start);
  del.setEnd(node, off);
  del.deleteContents();
  var chip = _richChipNode(n);
  del.insertNode(chip);
  var sp = document.createTextNode(' ');
  chip.parentNode.insertBefore(sp, chip.nextSibling);
  var nr = document.createRange();
  nr.setStart(sp, 1);
  nr.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nr);
  richSyncToTextarea();
}

function initRichPrompt() {
  var ta = els.promptInput;
  var rich = document.getElementById('promptRich');
  if (!ta || !rich) return;
  _richEl = rich;
  var wrap = ta.closest('.hm-prompt');
  if (wrap) wrap.classList.add('has-rich');
  richRenderFromValue();

  rich.addEventListener('input', function () {
    richSyncToTextarea();
    richAutoConvertToken();
    /* 手打 @ 触发自动补全（按编辑器里的真实光标） */
    try { showRefAutocomplete(); } catch (e) {}
  });
  /* 粘贴一律纯文本 */
  rich.addEventListener('paste', function (ev) {
    ev.preventDefault();
    var txt = (ev.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!txt) return;
    document.execCommand('insertText', false, txt);
    richSyncToTextarea();
  });
  rich.addEventListener('keydown', function (ev) {
    if (ev.isComposing || ev.keyCode === 229) return;  /* 中文输入法候选期间不拦截 */
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      if (els.generateBtn) els.generateBtn.click();
    }
  });
  /* 外部（@ 插入 / 删图 / 拖拽换序）改完 textarea 后，富文本跟着重建 */
  richSyncToTextarea();
}

function renderPromptOverlay() {
  /* 富文本编辑器接管排版后，旧的镜像层彻底停用 */
  if (_richEl) { richRenderFromValue(); return; }
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
  /* 有 refs：textarea 文字透明（只留光标与选区），overlay 完整镜像全部内容 */
  ta.style.color = 'transparent';
  ta.style.caretColor = '#dbe7f3';
  overlay.style.display = 'block';
  _syncPromptOverlayBox();
  overlay.scrollTop = ta.scrollTop;
  overlay.scrollLeft = ta.scrollLeft;

  var chips = _ensureChipCache(refs);
  /* 只把显式引用（@图N / @N）换成胶囊；正文里普通的「图2」保持原样，
     否则 @ 之后整段提示词会被误识别成一串 chip，输入框看起来就变样了 */
  var html = _escPromptHtml(text).replace(/(?:@图|@)(\d+)(?![0-9])/g, function (match, n) {
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
  /* 富文本编辑器接管视觉与输入；textarea 只留作数据源 */
  initRichPrompt();
  ta.addEventListener('input', schedulePromptOverlay);
  ta.addEventListener('scroll', schedulePromptOverlay);
  ta.addEventListener('paste', function () {
    schedulePromptOverlay();
  });
  /* 窗口/面板尺寸变化会改变 textarea 内容盒，镜像层跟着重新对齐 */
  window.addEventListener('resize', schedulePromptOverlay);
}

function removeRefAt(idx) {
  var arr = currentRefs().slice();
  if (idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  setCurrentRefs(arr); /* 先持久化，后面任何一步出错都不影响数据 */
  try { if (els.refInput) els.refInput.value = ''; } catch (e) {}
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
  else if (_refFsIdx > idx) _refFsIdx -= 1;
  try { hideRefHover(); } catch (e) {}
  /* 提示词里的 @图N：删掉指向这张图的引用，其余编号前移，避免指向不存在的图 */
  var ta = els.promptInput;
  if (ta && ta.value && ta.value.indexOf('@图') >= 0) {
    ta.value = ta.value.replace(/@图(\d+)\s?/g, function (m, n) {
      var k = Number(n);
      if (k === idx + 1) return '';
      if (k > idx + 1) return '@图' + (k - 1) + ' ';
      return m;
    });
    try { updateCharCount(); } catch (e) {}
    schedulePromptOverlay();
  }
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

/* 富文本编辑器里按光标插入纯文本（@图N 会在同步时变成胶囊） */
function richInsertText(text) {
  if (!_richEl) return;
  _richEl.focus();
  var sel = window.getSelection();
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0);
    r.deleteContents();
    var tn = document.createTextNode(text);
    r.insertNode(tn);
    var nr = document.createRange();
    nr.setStart(tn, text.length);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
  } else {
    _richEl.appendChild(document.createTextNode(text));
  }
  richSyncToTextarea();
  richRenderFromValue();
}

function insertPromptAt(text) {
  const ta = els.promptInput;
  if (!ta) return;
  if (_richEl) {
    richInsertText(text);
    try { updateCharCount(); } catch (e) {}
    return;
  }
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

  /* 找到光标前的 @ 字符；富文本编辑时按编辑器内的光标与文本判断 */
  var val, pos, caretRect = null;
  if (_richEl) {
    var sel0 = window.getSelection();
    if (!sel0 || !sel0.rangeCount || !_richEl.contains(sel0.anchorNode)) { hideRefAutocomplete(); return; }
    var r0 = sel0.getRangeAt(0);
    var pre = document.createRange();
    pre.setStart(_richEl, 0);
    pre.setEnd(r0.startContainer, r0.startOffset);
    val = pre.toString();
    pos = val.length;
    caretRect = r0.getBoundingClientRect();
  } else {
    val = ta.value;
    pos = ta.selectionStart;
  }
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
          '<div class="hm-ref-ac-name"><span class="hm-ref-ac-tag">图' + (item.idx + 1) + '</span></div>' +
        '</div></div>';
    }).join('');
  }

  /* 定位：富文本用实际光标矩形，textarea 用镜像 trick */
  var left, top;
  if (caretRect) {
    left = caretRect.left;
    top = caretRect.bottom || (caretRect.top + 20);
  } else {
    var rect = ta.getBoundingClientRect();
    var caretCoords = _getCaretCoords(ta);
    left = caretCoords.left;
    top = caretCoords.bottom;
  }
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
  /* 富文本：把光标前刚输入的「@query」替换成胶囊 */
  if (_richEl) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var rr = sel.getRangeAt(0);
    var node = rr.startContainer;
    if (node.nodeType === 3) {
      var t = node.nodeValue || '';
      var off = rr.startOffset;
      var at = t.slice(0, off).lastIndexOf('@');
      if (at >= 0) {
        var del = document.createRange();
        del.setStart(node, at);
        del.setEnd(node, off);
        del.deleteContents();
        var chip = _richChipNode(refIdx + 1);
        del.insertNode(chip);
        var sp = document.createTextNode(' ');
        chip.parentNode.insertBefore(sp, chip.nextSibling);
        var nr = document.createRange();
        nr.setStart(sp, 1);
        nr.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nr);
        richSyncToTextarea();
        try { updateCharCount(); } catch (e) {}
        return;
      }
    }
  }
  var pos = ta.selectionStart;
  var before = ta.value.slice(0, pos);
  var atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return;
  var val = ta.value;
  var insert = '@图' + (refIdx + 1) + ' ';
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

    /* 高清预览：长边 384px（网格最大 256px 时够清晰）。
       必须保留原图比例，不能裁成 1:1，否则网格宽度会跟着预览图变成正方形。 */
    var pScale = Math.min(1, 384 / Math.max(width, height));
    var pWidth = Math.max(1, Math.round(width * pScale));
    var pHeight = Math.max(1, Math.round(height * pScale));
    var pCanvas = document.createElement('canvas');
    pCanvas.width = pWidth;
    pCanvas.height = pHeight;
    pCanvas.getContext('2d').drawImage(canvas, 0, 0, pWidth, pHeight);

    var arr = currentRefs();
    arr.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      thumb: tCanvas.toDataURL('image/jpeg', 0.7),
      preview: pCanvas.toDataURL('image/jpeg', 0.86),
      name: file.name || ('reference_' + (arr.length + 1) + '.jpg'),
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

/* === 「桌面/作品图片 → 参考主体」统一入口 ===
 * 原生 HTML5 拖放（作品卡）与桌面卡片的指针拖拽都调用这里，
 * 最终一律走 pickRefFile()，与手动选择文件落在同一处状态（currentRefs()）。
 * dataTransfer 里只放作品 id，不放 base64。 */
/* 读取图片字节：先直连（有 CORS 头的图最快），失败再走后端 /api/image-proxy 代取。
   「作品/素材 → 参考主体」共用这一条，避免各处自写 fetch 再各弹一条跨域提示。 */
async function hmReadImageBlob(src) {
  var direct = '';
  try {
    var res = await fetch(src, { mode: 'cors' });
    if (res.ok) {
      var b = await res.blob();
      if (b && b.size) return b;
    }
    direct = '直连 HTTP ' + res.status;
  } catch (e) {
    direct = '直连被浏览器拦截';
  }
  var proxy = window.HM && window.HM.api && window.HM.api.imageProxyUrl
    ? window.HM.api.imageProxyUrl(src) : '';
  if (!proxy) throw new Error(direct);
  /* 代理改走 format=json：SCF 函数 URL 不透传二进制响应体，
     返回 { ok, contentType, bytes, dataUrl }，这里把 dataUrl 还原成 Blob。 */
  var r2 = await fetch(proxy, { mode: 'cors' });
  var raw2 = await r2.text();
  var j2 = null;
  try { j2 = raw2 ? JSON.parse(raw2) : null; } catch (e) { j2 = null; }
  if (!r2.ok) {
    var why2 = (j2 && j2.error && (j2.error.message || j2.error)) || ('HTTP ' + r2.status);
    throw new Error(direct + ' · 服务端代取失败：' + String(why2).slice(0, 160));
  }
  var dataUrl = j2 && j2.dataUrl ? String(j2.dataUrl) : '';
  if (!dataUrl || dataUrl.indexOf('data:') !== 0) {
    throw new Error(direct + ' · 服务端代取为空');
  }
  var comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error(direct + ' · 服务端代取格式异常');
  var head = dataUrl.slice(0, comma);
  var body = dataUrl.slice(comma + 1);
  var mime = (head.match(/^data:([^;]+)/i) || [])[1] || (j2 && j2.contentType) || 'image/jpeg';
  var out;
  if (/;base64/i.test(head)) {
    var bin = atob(body);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    out = new Blob([arr], { type: mime });
  } else {
    out = new Blob([decodeURIComponent(body)], { type: mime });
  }
  if (!out || !out.size) throw new Error(direct + ' · 服务端代取为空');
  return out;
}

window.HMRefDrop = {
  acceptWorkId: async function (workId) {
    var wid = String(workId || '');
    if (!wid) return false;
    var work = null;
    for (var i = 0; i < state.works.length; i++) {
      if (String(state.works[i].id) === wid) { work = state.works[i]; break; }
    }
    if (!work) { toast('找不到这张作品', 'error'); return false; }
    if (work.failed || work.ok === false) { toast('生成失败的图片不能作为参考主体', 'error'); return false; }
    if (work.type && work.type !== 'image') { toast('只能拖图片作为参考主体', 'error'); return false; }
    if (currentRefs().length >= REF_MAX_COUNT) {
      toast('当前描述已达上限，最多 ' + REF_MAX_COUNT + ' 张参考图', 'error');
      return false;
    }
    /* 同一张作品重复拖入：不重复添加（srcKey 记录来源作品 id） */
    var dup = currentRefs().some(function (r) { return r && r.srcKey === wid; });
    if (dup) { toast('这张图已在参考主体里', 'info'); return false; }
    var src = work.url || work.thumb || '';
    if (!src) { toast('这张作品没有可用的图片', 'error'); return false; }
    try {
      var blob = await hmReadImageBlob(src);
      var type = blob.type || 'image/jpeg';
      if (!/^image\//i.test(type)) type = 'image/jpeg';
      var ext = type.indexOf('png') >= 0 ? 'png' : type.indexOf('webp') >= 0 ? 'webp' : 'jpg';
      var file;
      try {
        file = new File([blob], 'work_' + wid + '.' + ext, { type: type });
      } catch (e) {
        file = blob;
        try { file.name = 'work_' + wid + '.' + ext; } catch (e2) {}
      }
      await pickRefFile(file);   /* 与手动上传同一条通路：校验/缩放/缩略图/写 currentRefs/renderRef */
      /* 标记来源，供重复拖入时判重，不影响其它字段与渲染 */
      var list = currentRefs();
      var last = list[list.length - 1];
      if (last && last.srcKey !== wid) {
        last.srcKey = wid;
        setCurrentRefs(list);
      }
      return true;
    } catch (err) {
      var why = String((err && err.message) || '网络被拦截');
      toast('这张图读不到（' + why + '）；请下载后手动上传为参考主体', 'error', 6000);
      return false;
    }
  }
};

/* 作品卡（我的作品）作为原生拖拽源：拖拽标识只放作品 id */
document.addEventListener('dragstart', function (ev) {
  var card = ev.target && ev.target.closest ? ev.target.closest('.work-card[data-work]') : null;
  if (!card) return;
  var work = null;
  for (var i = 0; i < state.works.length; i++) {
    if (String(state.works[i].id) === String(card.dataset.work)) { work = state.works[i]; break; }
  }
  if (!work || work.failed || work.ok === false || (work.type && work.type !== 'image')) {
    ev.preventDefault();
    return;
  }
  try {
    ev.dataTransfer.setData('application/x-hm-work', String(work.id));
    ev.dataTransfer.setData('text/plain', 'work:' + work.id);
    ev.dataTransfer.effectAllowed = 'copy';
  } catch (e) {}
});

function updateStepsUI() {
  const value = state.steps;
  const label = value <= 5 ? '极速' : value <= 8 ? '标准' : '精细';
  if (!els.stepsLabel || !els.stepsRange) return;
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
  /* 以现有 prefs 为底再覆盖本次字段，避免把快捷键等其它字段冲掉 */
  var base = loadJSON(LS_PREFS, {}) || {};
  saveJSON(LS_PREFS, Object.assign(base, {
    modelId: state.modelId,
    ratio: state.ratio,
    scale: state.scale,
    customW: state.customW,
    customH: state.customH,
    count: state.count,
    steps: state.steps,
    seed: state.seed,
    translate: state.translate,
    engine: state.engine,
    channelModel: state.channelModel,
    lora: state.lora,
    videoModel: state.videoModel,
    audioModel: state.audioModel,
    providerId: state.providerId,
    toonApi: state.toonApi,
    toon2Api: state.toon2Api
  }));
  if (window.HMSync && window.HMSync.pushPrefs) window.HMSync.pushPrefs();
}

/* ---------------- 视图与侧栏 ---------------- */
var VIEW_IDS = ['create', 'canvas', 'tools', 'toolopenvideo', 'tooltoon', 'tooltoon2', 'toolimage', 'toolreference', 'tooltraining', 'toolrestore', 'toolworkflow', 'assets', 'library', 'voice', 'modeling', 'director', 'edit', 'director3d', 'storyboard', 'paint', 'plan', 'script', 'art', 'layout', 'oua', 'animation', 'bg', 'history', 'admin', 'usage', 'compile', 'publish'];

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

/* ---------------- Blender Web Bridge (3D 建模) ---------------- */
var BlenderBridge = (function () {
  var ws = null;
  var nextId = 1;
  var pending = new Map();
  var streaming = false;
  var bound = false;
  var viewActive = false;
  var pingTimer = null;

  function $(id) { return document.getElementById(id); }
  function logEl() { return $('mLog'); }
  function statusEl() { return $('mStatus'); }
  function dotEl() { return $('mDot'); }

  function log(msg, isErr) {
    var el = logEl();
    if (!el) return;
    var d = document.createElement('div');
    d.textContent = msg;
    if (isErr) d.className = 'err';
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  function setStatus(txt, cls) {
    if (statusEl()) { statusEl().textContent = txt; statusEl().className = 'hm-m-status ' + (cls || ''); }
    if (dotEl()) dotEl().className = 'hm-m-dot ' + (cls || '');
  }

  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('未连接 Blender 桥接服务'));
        return;
      }
      var id = String(nextId++);
      pending.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ v: 1, type: 'request', id: id, method: method, params: params || {} }));
      setTimeout(function () {
        if (pending.delete(id)) reject(new Error('请求超时: ' + method));
      }, 8000);
    });
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    var hostVal = ($('mHost') || {}).value || '127.0.0.1:9876';
    var parts = hostVal.split(':');
    var h = parts[0] || '127.0.0.1';
    var port = parts[1] || '9876';
    var token = ($('mToken') || {}).value || '';
    var url = 'ws://' + h + ':' + port;
    setStatus('连接中…', 'conn');
    log('正在连接 ' + url + ' …');

    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus('连接失败', 'err');
      log('WebSocket 创建失败: ' + e.message, true);
      return;
    }

    ws.onopen = function () {
      setStatus('已连接', 'on');
      log('已连接 ' + url);
      startPing();
      var p = Promise.resolve();
      if (token) {
        p = p.then(function () { return rpc('auth', { token: token }); })
          .catch(function (e) { log('鉴权失败: ' + e.message, true); });
      }
      p.then(refreshInfo);
    };
    ws.onclose = function () {
      setStatus('已断开', 'err');
      streaming = false;
      if ($('mBtnStream')) $('mBtnStream').textContent = '开启实时流';
      stopPing();
      log('连接已断开');
    };
    ws.onerror = function () {
      setStatus('连接错误', 'err');
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'response' || msg.type === 'error') {
        var q = pending.get(msg.id);
        if (!q) return;
        pending.delete(msg.id);
        if (msg.type === 'error') q.reject(new Error((msg.error && msg.error.message) || '未知错误'));
        else q.resolve(msg.result || {});
      } else if (msg.type === 'event') {
        handleEvent(msg);
      }
    };
  }

  function disconnect() {
    streaming = false;
    stopPing();
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
      ws = null;
    }
  }

  function handleEvent(msg) {
    if (msg.event === 'viewport.frame' && msg.data && msg.data.data_base64) {
      var cv = $('mCanvas');
      var empty = $('mEmpty');
      if (cv) { cv.src = 'data:image/jpeg;base64,' + msg.data.data_base64; cv.hidden = false; }
      if (empty) empty.hidden = true;
    } else if (msg.event === 'log') {
      log('[Blender] ' + (msg.data && msg.data.message));
    } else if (msg.event === 'scene.updated') {
      refreshObjects();
    } else if (msg.event === 'ready') {
      log('桥接就绪' + (msg.data && msg.data.blender_version ? ' · Blender ' + msg.data.blender_version : ''));
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        rpc('ping').catch(function () {});
      }
    }, 20000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function refreshInfo() {
    return rpc('get_info').then(function (info) {
      var v = info && info.blender && info.blender.version;
      var cnt = info && info.scene && info.scene.objects_count;
      log('Blender ' + (v || '?') + ' | 对象 ' + (cnt != null ? cnt : '?'));
      return refreshObjects();
    }).catch(function (e) { log('获取信息失败: ' + e.message, true); });
  }

  function refreshObjects() {
    return rpc('object.list').then(function (r) {
      var sel = $('mObjSel');
      if (!sel) return;
      sel.innerHTML = '';
      (r.objects || []).forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.name;
        opt.textContent = o.name + ' (' + o.type + ')';
        sel.appendChild(opt);
      });
    }).catch(function (e) { log('对象列表失败: ' + e.message, true); });
  }

  /* ---------------- 平台操作模式 ---------------- */
  var platformMode = false;
  var platformTimer = null;
  var capturing = false;
  var windowGeo = null;
  var pressedButtons = {};

  function getScreenInfo() {
    return rpc('screen.info').then(function (geo) {
      windowGeo = geo;
      return geo;
    }).catch(function () { windowGeo = null; });
  }

  function captureWindow() {
    if (capturing) return;
    capturing = true;
    rpc('screen.capture', { quality: 80 }).then(function (r) {
      var img = $('mPlatformImg');
      var empty = $('mPlatformEmpty');
      if (img && r && r.data_base64) {
        var fmt = (r.format || 'jpeg').toLowerCase();
        var mime = fmt === 'bmp' ? 'image/bmp' : 'image/jpeg';
        img.src = 'data:' + mime + ';base64,' + r.data_base64;
        if (img.hidden) img.hidden = false;
        if (empty && !empty.hidden) empty.hidden = true;
      } else {
        console.warn('[Bridge] screen.capture 无画面数据:', r);
      }
    }).catch(function (e) {
      console.warn('[Bridge] screen.capture 失败:', e);
    }).then(function () {
      capturing = false;
    });
  }

  function startPlatformLoop() {
    stopPlatformLoop();
    getScreenInfo();
    platformTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) captureWindow();
    }, 120);
  }

  function stopPlatformLoop() {
    if (platformTimer) { clearInterval(platformTimer); platformTimer = null; }
  }

  function mapToWindow(clientX, clientY) {
    var img = $('mPlatformImg');
    var stage = $('mPlatformStage');
    if (!img || !stage || !img.naturalWidth) return null;
    var rect = stage.getBoundingClientRect();
    var natW = img.naturalWidth, natH = img.naturalHeight;
    var scale = Math.min(rect.width / natW, rect.height / natH);
    var dispW = natW * scale, dispH = natH * scale;
    var offX = (rect.width - dispW) / 2;
    var offY = (rect.height - dispH) / 2;
    var x = (clientX - rect.left - offX) / scale;
    var y = (clientY - rect.top - offY) / scale;
    if (x < 0 || y < 0 || x > natW || y > natH) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function sendMouse(action, x, y, button, delta) {
    var params = { action: action };
    if (x != null) params.x = x;
    if (y != null) params.y = y;
    if (button) params.button = button;
    if (delta != null) params.delta = delta;
    rpc('input.mouse', params).catch(function () {});
  }

  function sendKey(vk, action) {
    rpc('input.key', { vk: vk, action: action || 'press' }).catch(function () {});
  }

  function setMode(mode) {
    platformMode = (mode === 'platform');
    var tabs = document.querySelectorAll('.hm-m-tab');
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-mmode') === mode);
    });
    var remote = $('mRemotePanel');
    var plat = $('mPlatformPanel');
    if (remote) {
      if (platformMode) remote.setAttribute('hidden', '');
      else remote.removeAttribute('hidden');
    }
    if (plat) {
      if (platformMode) plat.removeAttribute('hidden');
      else plat.setAttribute('hidden', '');
    }

    if (platformMode) {
      startPlatformLoop();
      var stage = $('mPlatformStage');
      if (stage) { try { stage.focus(); } catch (e) {} }
    } else {
      stopPlatformLoop();
    }
  }

  function bindPlatformInput() {
    var stage = $('mPlatformStage');
    if (!stage || stage.dataset.bound) return;
    stage.dataset.bound = '1';

    var lastMoveTime = 0;
    var MOVE_THROTTLE_MS = 16; // ~60fps

    stage.addEventListener('mousedown', function (e) {
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      stage.focus();
      var p = mapToWindow(e.clientX, e.clientY);
      if (!p) { console.warn('[Bridge] mousedown: mapToWindow null'); return; }
      var btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
      pressedButtons[btn] = true;
      sendMouse('down', p.x, p.y, btn);
    });

    function onUp(e) {
      var btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
      if (pressedButtons[btn]) {
        pressedButtons[btn] = false;
        sendMouse('up', null, null, btn);
      }
    }
    stage.addEventListener('mouseup', onUp);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

    stage.addEventListener('mousemove', function (e) {
      var now = Date.now();
      if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
      lastMoveTime = now;
      var p = mapToWindow(e.clientX, e.clientY);
      if (!p) return;
      sendMouse('move', p.x, p.y);
    });

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -1 : 1;
      sendMouse('scroll', null, null, null, delta);
    }, { passive: false });
    stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    stage.addEventListener('keydown', function (e) {
      // 阻止浏览器快捷键干扰（F5、Ctrl+W 等仍由浏览器处理，尽量放行 Blender 常用键）
      var block = true;
      if (e.ctrlKey && (e.keyCode === 82 || e.keyCode === 87 || e.keyCode === 84)) block = false;
      if (e.keyCode === 116) block = false; // F5 刷新
      if (block) e.preventDefault();
      sendKey(e.keyCode, 'down');
    });
    stage.addEventListener('keyup', function (e) {
      e.preventDefault();
      sendKey(e.keyCode, 'up');
    });
  }

  function bind() {
    if (bound) return;
    bound = true;
    var btn = $('mConnect');
    if (btn) btn.onclick = connect;

    // 模式切换：远程操作 / 平台操作
    document.querySelectorAll('.hm-m-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.getAttribute('data-mmode'));
      });
    });
    bindPlatformInput();

    var bInfo = $('mBtnInfo');
    if (bInfo) bInfo.onclick = function () {
      rpc('scene.info').then(function (i) { log(JSON.stringify(i)); }).catch(function (e) { log(e.message, true); });
    };
    var bList = $('mBtnList');
    if (bList) bList.onclick = refreshObjects;
    var bOpen = $('mBtnOpen');
    if (bOpen) bOpen.onclick = function () {
      var fp = ($('mFilepath') || {}).value;
      if (!fp) { log('请输入 .blend 文件路径', true); return; }
      rpc('scene.open', { filepath: fp }).then(function (r) {
        log('已加载 ' + r.objects + ' 个对象');
        return refreshObjects();
      }).catch(function (e) { log(e.message, true); });
    };
    var bDel = $('mBtnDel');
    if (bDel) bDel.onclick = function () {
      var name = ($('mObjSel') || {}).value;
      if (!name) return;
      rpc('object.delete', { name: name }).then(refreshObjects).catch(function (e) { log(e.message, true); });
    };
    var bMove = $('mBtnMove');
    if (bMove) bMove.onclick = function () {
      var name = ($('mObjSel') || {}).value;
      if (!name) return;
      rpc('object.transform', {
        name: name, relative: true,
        location: [+$('mTx').value, +$('mTy').value, +$('mTz').value]
      }).then(function (r) { log('移动 ' + r.name + ' -> ' + JSON.stringify(r.location)); })
        .catch(function (e) { log(e.message, true); });
    };
    var bMat = $('mBtnMat');
    if (bMat) bMat.onclick = function () {
      var name = ($('mObjSel') || {}).value;
      if (!name) return;
      var hex = $('mMatColor').value;
      var c = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1];
      rpc('object.material.set', { name: name, color: c }).then(function () { log('已上色 ' + name); })
        .catch(function (e) { log(e.message, true); });
    };
    var bAdd = $('mBtnAdd');
    if (bAdd) bAdd.onclick = function () {
      var type = ($('mAddType') || {}).value;
      rpc('object.add', { type: type, location: [0, 0, 0] }).then(function (r) {
        log('已添加 ' + r.name);
        return refreshObjects();
      }).catch(function (e) { log(e.message, true); });
    };
    var bFrame = $('mBtnFrame');
    if (bFrame) bFrame.onclick = function () {
      rpc('viewport.frame', { width: 960, height: 540 }).then(function (r) {
        var cv = $('mCanvas');
        var empty = $('mEmpty');
        if (cv) { cv.src = 'data:image/jpeg;base64,' + r.data_base64; cv.hidden = false; }
        if (empty) empty.hidden = true;
        log('已抓帧');
      }).catch(function (e) { log(e.message, true); });
    };
    var bStream = $('mBtnStream');
    if (bStream) bStream.onclick = function () {
      rpc('viewport.stream', { enabled: !streaming, fps: 15, width: 960, height: 540 }).then(function (r) {
        streaming = r.streaming;
        bStream.textContent = streaming ? '关闭实时流' : '开启实时流';
        log(streaming ? '实时流已开启' : '实时流已关闭');
      }).catch(function (e) { log(e.message, true); });
    };
    var bUndo = $('mBtnUndo');
    if (bUndo) bUndo.onclick = function () { rpc('undo').catch(function (e) { log(e.message, true); }); };
    var bRedo = $('mBtnRedo');
    if (bRedo) bRedo.onclick = function () { rpc('redo').catch(function (e) { log(e.message, true); }); };
  }

  function enter() {
    viewActive = true;
    bind();
    setStatus('未连接', '');
    // 默认回到远程操作模式
    setMode('remote');
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('准备连接本地 Blender 桥接服务 …');
      connect();
    }
  }

  function leave() {
    viewActive = false;
    // 停止平台操作截图循环
    stopPlatformLoop();
    platformMode = false;
    // 离开建模视图时保持连接（切回时无需重连），但停止实时流以省资源
    if (streaming) {
      rpc('viewport.stream', { enabled: false }).catch(function () {});
      streaming = false;
      var bs = $('mBtnStream');
      if (bs) bs.textContent = '开启实时流';
    }
  }

  // 文档级事件委托：点击 [data-mmode] 标签切换模式（不依赖 bind() 时序，保证始终生效）
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-mmode]');
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    var mode = tab.getAttribute('data-mmode');
    if (mode === 'remote' || mode === 'platform') setMode(mode);
  }, true);

  var api = { enter: enter, leave: leave, connect: connect, disconnect: disconnect, setMode: setMode };
  // 显式挂载到 window，确保内联 onclick 可访问
  if (typeof window !== 'undefined') window.BlenderBridge = api;
  return api;
})();

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

  /* 后端可用性只在启动时探测一次；一次网络抖动会让整个会话都降级到浏览器直连，
     而直连用的是本地缓存的旧 Key（线上 401 Invalid API key 的来源）。
     真正生成前补探测一次，探测失败才判定后端不可用。 */
  if (window.HM && window.HM.api && !window.HM.api.online && typeof window.HM.api.ping === 'function') {
    try { await window.HM.api.ping(); } catch (err) {}
  }

  // 已连接后端时优先走服务端代理（前后端分离）
  if (window.HM && window.HM.api && window.HM.api.online) {
    try {
      const remote = await runBackendImage(job, prompt);
      const remoteElapsed = (Date.now() - job.startedAt) / 1000;
      markJobDone(job, remote.url, remote.seed, remoteElapsed);
      return;
    } catch (err) {
      /* 后端已返回明确错误（err.message 非空）→ 直接展示给用户，不 fallback */
      if (err && err.message) {
        /* 失败即止：不再自动换模型或静默重发，重试必须由用户手动点 */
        /* 如果后端没有 hint，按错误类型补一条能落地的提示（明确该改哪个字段） */
        if (!err.hint && !err.offline) {
          if (isGroupUnavailableError(err.message)) {
            /* 分组级 404：换 Gemini 名字没用，直接指向 GPT-image 配置 */
            err.hint = '这是分组 / 账号问题，不是模型名拼错：请在「接入设置」改用 GPT-image 那条配置（模型 gpt-image-2.5-flare，走 /images/generations）。';
          } else if (isModelNameError(err.message)) {
            err.hint = '这是「模型名」问题，不是尺寸问题：请在「接入设置」把模型名改成上游真实存在的图像模型 ID。';
          } else if (isSizeUnsupportedError(err.message)) {
            err.hint = '这是「尺寸」问题，不是模型名问题：请在尺寸 / 比例里换一个更小的值。';
          } else {
            err.hint = '请稍后重试或更换模型/接入设置';
          }
        }
        markJobError(job, err);
        throw err;
      }
      /* 后端纯网络错误（无 message）→ FLUX 可 fallback 到浏览器直连 */
      if (job.engine === 'flux' && err.offline) {
        /* 继续往下走浏览器免费兜底通道 */
      } else {
        markJobError(job, err);
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
    /* 云端引擎必须走后端：后端不可用时明确报「网络不可达」，
       绝不降级到浏览器直连（那边只有本地旧 Key，会报上游 401） */
    if (!window.HM || !window.HM.api || !window.HM.api.online) {
      const offlineError = new Error('无法连接后端服务，请检查网络后重试');
      offlineError.offline = true;
      offlineError.hint = '云端生成需要后端代理：请确认网络可访问后端服务，稍后重试';
      markJobError(job, offlineError);
      throw offlineError;
    }
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
    /* 数值比例（4 位小数），供只认 aspect 数值的接口计算尺寸：
       21:9=2.3333、2:3=0.6667、3:2=1.5、4:5=0.8、5:4=1.25 */
    aspect: aspectValue(job),
    aspect_ratio: aspectValue(job),
    scale: job.scaleId,
    /* 显式像素尺寸：避免后端按自有比例表把新比例回落到默认尺寸 */
    width: job.width,
    height: job.height,
    size: job.width + 'x' + job.height,
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
    /* RayinAI — 前端选的真实模型 ID 必须传给后端覆盖默认值。
     * 但通道与模型必须匹配：gpt-image 端点只认 gpt-image*，banana 只认 gemini*，
     * 否则会把旧通道的模型名发过去直接 404。 */
    var picked = String(state.channelModel || '');
    if (job.engine === 'gpt-image') {
      payload.model = /^gpt-image/i.test(picked) ? picked : (rayinCfg().gptModel || 'gpt-image-2.5-flare');
    } else {
      payload.model = /^gemini/i.test(picked) ? picked : (rayinCfg().bananaModel || 'gemini-3.1-flash-image');
    }
    if (payload.model !== picked) state.channelModel = payload.model;
    /* 通道密钥显式带上：state.api.key 为空时用 providers 里对应通道的 Key，
       避免后端只依赖环境变量而报「未配置 RayinAPI Key」 */
    var channelKey = String(rayinCfg().key || '').trim() || rayinChannelKey(job.engine);
    if (channelKey) payload.rayin = Object.assign({}, state.api, { key: channelKey });
  }

  /* 幂等键：一次「点生成」只对应一个任务/一次上游调用；
     网络重试或重复点击复用同一个 requestId，避免重复扣费 */
  payload.requestId = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* 日志要记录「真实发出的模型名」，而不是界面上的展示名 */
  job.sentModel = String(payload.model || (payload.provider && payload.provider.model) || '');

  /* 提交即返回 + 轮询取结果：上游出图常 20~60s，单次长连接被中间层在 30s
     掐断也不影响任务，后台跑完写库，前端从任务表取回。 */
  updateJobStatus(job, '已提交，等待后端接单…');
  var submitted = await window.HM.api.submitGenerateJob(payload);
  var waitTip1 = setTimeout(function () { updateJobStatus(job, '已提交，正在等待上游出图…'); }, 10000);
  var waitTip2 = setTimeout(function () { updateJobStatus(job, '上游仍在生成（最长约 5 分钟），请稍候…'); }, 45000);
  var settled;
  try {
    settled = await waitGenerateJob(submitted);
  } finally {
    clearTimeout(waitTip1);
    clearTimeout(waitTip2);
  }
  var data = settled.result;
  const item = data && data.items && data.items[0];
  if (!item || !item.url) throw new Error((settled.error && settled.error.message) || '后端未返回图片');
  if (item.width && item.height) applyActualSize(job, item.width, item.height);
  return {
    url: window.HM.api.mediaUrl ? window.HM.api.mediaUrl(item.url) : item.url,
    seed: item.seed || job.seed
  };
}

/* 轮询任务直到 done/failed。兼容两种返回：
   1) 异步排队：{id, status:'pending'} → 每 2s 查一次；
   2) 后端没拿到平台凭据时的同步兜底：直接带 result/error 返回。 */
async function waitGenerateJob(submitted) {
  if (!submitted) throw new Error('后端未返回任务号');
  if (submitted.status === 'done') return submitted;
  if (submitted.status === 'failed') throw jobError(submitted.error);
  var id = submitted.id;
  if (!id) throw new Error('后端未返回任务号');
  var deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    var st;
    try {
      st = await window.HM.api.getGenerateJob(id);
    } catch (err) {
      /* 单次查询失败（网关抖动）不代表任务失败，继续轮询 */
      if (err && err.status === 404) throw err;
      continue;
    }
    if (!st) continue;
    if (st.status === 'done') return st;
    if (st.status === 'failed') throw jobError(st.error);
  }
  throw new Error('生成超时（5 分钟未完成），请稍后重试');
}

/* 把任务表里持久化的错误类别还原成可展示的错误 */
function jobError(info) {
  var err = new Error((info && info.message) || '生成失败');
  if (info && info.hint) err.hint = info.hint;
  if (info && info.category) err.category = info.category;
  if (info && info.status) err.status = info.status;
  return err;
}


/* ---------------- 模型名自愈 ----------------
 * 上游报 Model "x" is not found 时，用这条接入配置自己的 Key 拉一次真实模型清单，
 * 只在清单里挑同类图像模型改写配置并重试；清单拉不到就只给提示，绝不凭名字猜。
 * 改写同时落到本机（anidream.api.v1）与云端 /docs/api（不只是界面显示）。 */
var IMAGE_MODEL_PREFERENCE = {
  banana: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image'],
  'gpt-image': ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1']
};

function rankImageModels(ids, engine) {
  var pool = (ids || []).filter(function (id) { return /image|imagen/i.test(String(id)); });
  var family = engine === 'banana' ? /^gemini/i : /^gpt-image/i;
  var prefer = IMAGE_MODEL_PREFERENCE[engine] || [];
  var out = [];
  prefer.forEach(function (id) { if (pool.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); });
  pool.forEach(function (id) { if (family.test(id) && out.indexOf(id) < 0) out.push(id); });
  pool.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
  return out;
}

async function fetchImageModelIds() {
  var cfg = rayinCfg();
  var base = normalizeBase(cfg.base);
  var key = String(cfg.key || '').trim();
  var ids = [];
  try {
    if (window.HM && HM.api && HM.api.models) {
      var res = await HM.api.models({ base: base, key: key });
      if (res && Array.isArray(res.ids)) ids = res.ids;
    }
  } catch (e) { ids = []; }
  if (!ids.length && key) {
    /* 后端不可用时用同一条 Key 直连（「测试连接」已证明该平台允许跨域） */
    try {
      var r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.ok) {
        var data = await r.json();
        ids = (data.data || data.models || []).map(function (m) { return m && (m.id || m.name); }).filter(Boolean);
      }
    } catch (e2) {}
  }
  return ids;
}

/* 把修正后的模型名写进本机配置 + 云端文档（先拉最新文档再合并，避免覆盖别的配置） */
function adoptImageModel(used, engine) {
  var isBanana = engine === 'banana';
  var id = isBanana ? '__rayin__:banana' : '__rayin__:gpt-image';
  state.channelModel = used;
  state.api = Object.assign({}, state.api || RAYIN_DEFAULT);
  if (isBanana) state.api.bananaModel = used;
  else state.api.gptModel = used;
  try { localStorage.setItem(LS_API, JSON.stringify(state.api)); } catch (e) {}
  try { persistPrefs(); } catch (e) {}
  var pull = (window.HMSync && window.HMSync.pullApi) ? window.HMSync.pullApi() : Promise.resolve(null);
  return pull.catch(function () { return null; }).then(function (cloud) {
    var doc = cloud || loadJSON('anidream.api.v1', {}) || {};
    doc.providers = doc.providers || {};
    doc.providers[id] = Object.assign({}, doc.providers[id] || {}, { model: used });
    if (isBanana) doc.bananaModel = used;
    else doc.gptModel = used;
    doc.updatedAt = Date.now();
    try { localStorage.setItem('anidream.api.v1', JSON.stringify(doc)); } catch (e) {}
    var push = window.HMSync && window.HMSync.pushApi;
    if (!push) return { cloud: false, reason: '云同步模块未加载' };
    return push(doc).then(function () { return { cloud: true }; });
  });
}

async function healImageModel(engine) {
  var ids = await fetchImageModelIds();
  var ranked = rankImageModels(ids, engine);
  var cfg = state.api || {};
  var current = String((engine === 'banana' ? cfg.bananaModel : cfg.gptModel) || state.channelModel || '');
  var next = ranked.filter(function (id) { return id !== current; })[0] || '';
  if (!next) return '';
  var saved = { cloud: false, reason: '未知原因' };
  try {
    saved = await adoptImageModel(next, engine);
    toast(saved && saved.cloud
      ? ('模型名已改为「' + next + '」（上游真实可用），已同步云端')
      : ('模型名已改为「' + next + '」（本机已保存；云端未同步：' + ((saved && saved.reason) || '网络异常') + '）'),
      saved && saved.cloud ? 'success' : 'error', 6000);
  } catch (err) {
    toast('模型名已在本机改为「' + next + '」，云端保存失败：' + ((err && err.message) || '网络异常'), 'error', 6000);
  }
  try { syncEngineUI(); } catch (e) {}
  return next;
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
  /* 误把具体端点当根地址（/v1/models、/v1/chat/completions…）时先剥掉，
   * 否则拼接会变成 /v1/models/models，上游会把 models 当成模型名 */
  const base = String(value || RAYIN_DEFAULT.base).trim()
    .replace(/^[`'"“”‘’\s]+|[`'"“”‘’\s]+$/g, '')
    .replace(/\/+$/, '')
    .replace(/\/(models|chat\/completions|completions|responses|images\/generations|images\/edits|images\/variations|embeddings)$/i, '')
    .replace(/\/+$/, '');
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
 * 2K / 4K 档位通过 quality 参数（medium=1K, high=2K, ultra=4K）让 RayinAPI 内部放大；
 * 其余比例按「宽高比最接近且方向一致」的白名单尺寸发送，并在界面提示实际出图尺寸 */
const GPT_SIZES = [
  { w: 1024, h: 1024, size: '1024x1024' },
  { w: 1536, h: 1024, size: '1536x1024' },
  { w: 1024, h: 1536, size: '1024x1536' }
];

function gptSizeFor(job) {
  const want = (Number(job.width) || 1024) / (Number(job.height) || 1024);
  let best = GPT_SIZES[0];
  let bestDiff = Infinity;
  GPT_SIZES.forEach(function (item) {
    const diff = Math.abs(Math.log((item.w / item.h) / want));
    if (diff < bestDiff) { bestDiff = diff; best = item; }
  });
  return best.size;
}

/* 比例数值：取实际像素宽/高，保留 4 位小数 */
function aspectValue(job) {
  const w = Number(job.width) || 0;
  const h = Number(job.height) || 0;
  if (!w || !h) return 1;
  return Number((w / h).toFixed(4));
}
/* 实际出图尺寸与所选比例不一致时：回写卡片尺寸并提示用户 */
function applyActualSize(job, w, h) {
  w = Math.round(Number(w) || 0);
  h = Math.round(Number(h) || 0);
  if (!w || !h || (w === job.width && h === job.height)) return;
  if (!job.planWidth) job.planWidth = job.width;
  if (!job.planHeight) job.planHeight = job.height;
  job.width = w;
  job.height = h;
  if (typeof toast === 'function') {
    toast('接口按固定尺寸返回 ' + w + '×' + h + '，将按所选尺寸校准', 'info');
  }
}
function gptQualityFor(job) {
  if (job.scaleId === '4k') return 'ultra';
  if (job.scaleId === '2k') return 'high';
  return 'medium';
}

async function runRayinImage(job, prompt) {
  const size = gptSizeFor(job);
  const quality = gptQualityFor(job);
  /* 不自动换模型 / 不静默重发：只用当前配置的模型（默认 gpt-image-2），失败即止，重试由用户点 */
  const userModel = rayinCfg().gptModel || RAYIN_DEFAULT.gptModel;
  const fallbacks = [userModel];

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
        if (first && first.width && first.height) { applyActualSize(job, first.width, first.height); } else { applyActualSize(job, Number(String(size).split('x')[0]), Number(String(size).split('x')[1])); }
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
        if (first && first.width && first.height) { applyActualSize(job, first.width, first.height); } else { applyActualSize(job, Number(String(size).split('x')[0]), Number(String(size).split('x')[1])); }
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

/* ---------------- 生图失败归因：模型名 vs 尺寸 ----------------
 * 上游 404「Model "x" is not found」和「尺寸不支持」是两类完全不同的错误：
 *   前者要改「接入设置 → 模型名」，后者要改「尺寸 / 比例」。
 * 这里统一识别，避免把上游原文直接甩给用户，也避免两类问题互相误导。 */
function isModelNameError(text) {
  var s = String(text || '');
  return /model\s*"?[A-Za-z0-9._:\-\/]*"?\s*(is\s*)?not\s*found/i.test(s) ||
    /model_not_found|模型不存在|无可用渠道|no available channel|model.*not.*exist/i.test(s);
}

function isGroupUnavailableError(text) {
  var s = String(text || '');
  return /not\s*supported\s*by\s*any\s*configured\s*account/i.test(s) ||
    /no\s*available\s*(account|channel)/i.test(s) ||
    /该分组|分组下|分组内/.test(s);
}

function isSizeUnsupportedError(text) {
  var s = String(text || '');
  if (!/(尺寸|分辨率|size|resolution|dimension|aspect)/i.test(s)) return false;
  return /(不支持|超出|过大|not\s*support|unsupported|invalid|too\s*(large|big)|exceed|out\s*of\s*range)/i.test(s);
}

function modelNameFromText(text) {
  var s = String(text || '');
  var m = /Model\s+"([^"]+)"/i.exec(s) ||
    /模型不存在\s*[:：]\s*([A-Za-z0-9._:\-\/]+)/.exec(s) ||
    /模型\s*"([^"]+)"/.exec(s);
  return m ? m[1] : '';
}

function sizeFromText(text) {
  var m = /(\d{2,5})\s*[x×*]\s*(\d{2,5})/i.exec(String(text || ''));
  return m ? (m[1] + '×' + m[2]) : '';
}

function errorText(err) {
  /* 优先后端透传的中文主错误 err.message，否则再走 friendlyError 规则 */
  var message = (err && err.message) ? String(err.message) : friendlyError(err);
  var code = (err && err.code) || '';
  var status = Number((err && err.status) || 0);
  /* 401 分两类：上游 Key 被拒 / 本站登录失效，不能混成同一句 */
  if (status === 401) {
    if (/上游|invalid\s*api\s*key|incorrect\s*api\s*key/i.test(message)) {
      return '上游 API Key 无效或未授权（HTTP 401）';
    }
    if (code === 'TOKEN_INVALID' || /登录|令牌|token/i.test(message)) {
      return '登录状态已失效（HTTP 401）';
    }
    return '未授权（HTTP 401）';
  }
  if (code === 'group_unavailable' || isGroupUnavailableError(message)) {
    var blocked = modelNameFromText(message);
    return '该分组不支持 Gemini 图像' + (blocked ? '：' + blocked : '') + '，请改用 GPT-image 配置';
  }
  if (code === 'model_not_found' || isModelNameError(message)) {
    var name = modelNameFromText(message);
    return name ? ('模型不存在：' + name) : '模型不存在（该模型名在上游不可用）';
  }
  if (code === 'size_unsupported' || isSizeUnsupportedError(message)) {
    var size = sizeFromText(message);
    return '该模型不支持此尺寸' + (size ? '：' + size : '');
  }
  return message;
}

function errorHint(err) {
  var status = Number((err && err.status) || 0);
  var message = String((err && err.message) || '');
  var code = (err && err.code) || '';
  /* 按类别给提示：上游 Key 被拒 / 本站未登录 / 网络不可达，三者不混用 */
  if (status === 401) {
    if (/上游|invalid\s*api\s*key|incorrect\s*api\s*key/i.test(message)) {
      return '这是上游（RayinAI）判定 Key 无效，不是网络问题：请到「接入设置」重新保存 GPT-image 的 Key，保存后会写入云端 /docs/api，服务端下次生成直接读库使用。';
    }
    if (code === 'TOKEN_INVALID' || /登录|令牌|token/i.test(message)) {
      return '登录状态已失效，请重新登录后再生成（与 API Key 无关）';
    }
    return '未授权：请重新登录，或在「接入设置」核对 Key';
  }
  if (status === 403) {
    return 'Key 没有该模型的调用权限，请到「接入设置」确认账号 / 分组是否开通 gpt-image';
  }
  if (err && err.offline) {
    /* 超时 ≠ 网络不可达：平台异步触发不可用时，后端会同步跑完整张图（50~60s），
       前端提前放弃就会误报成网络问题。 */
    if (err.timeout) {
      return '后端这次处理时间较长，前端等待到上限就中断了：生图通常 20~60 秒，任务多半仍在后台执行，稍后刷新「作品」看结果，或再点一次重试（同一请求幂等，不会重复扣费）。';
    }
    return '这是网络不可达，不是 Key 问题：请检查网络后重试';
  }
  if (err && err.hint) return String(err.hint);
  var code0 = code;
  if (code0 === 'group_unavailable' || isGroupUnavailableError(message)) {
    return '这是分组 / 账号问题，不是模型名拼错：请在「接入设置」改用 GPT-image 那条配置（模型 gpt-image-2.5-flare，走 /images/generations）。';
  }
  if (code0 === 'model_not_found' || isModelNameError(message)) {
    return '这是「模型名」问题，不是尺寸问题：请在「接入设置」把这条配置的模型名改成上游真实存在的图像模型 ID。';
  }
  if (code0 === 'size_unsupported' || isSizeUnsupportedError(message)) {
    return '这是「尺寸」问题，不是模型名问题：请在尺寸 / 比例里换一个更小的值。';
  }
  return '';
}

function friendlyError(err) {
  const message = String((err && err.message) || '');
  if (/exhausted|暂满/i.test(message)) return '该模型上游额度暂满，请稍后重试或换模型';
  if (/429|quota|exceeded|ZeroGPU|limit/i.test(message)) return '免费算力额度暂满，请稍后重试';
  if (/Failed to fetch|NetworkError|network|load failed|无法连接后端/i.test(message)) return '无法连接后端服务，请检查网络后重试';
  if (/abort|timeout|超时/i.test(message)) return '生成超时，请重试';
  if (/HTTP 5\d\d/.test(message)) return '免费算力繁忙，请稍后重试';
  /* 兜底：如果 message 本身有内容（后端中文直传），原样返回 */
  if (message) return message;
  return '生成失败，请稍后重试';
}

/* ---------------- 卡片渲染 ---------------- */
function jobMediaLoading(job) {
  return '<div class="result-media media-loading" style="aspect-ratio:' + job.width + ' / ' + job.height + '">' +
    '<div class="loader-box">' +
      '<span class="loader-ring"></span>' +
      '<div><strong>正在绘制</strong><span class="load-status" data-status>排队中…</span><span class="load-time" data-time>00:00.0</span></div>' +
    '</div>' +
  '</div>';
}

/* 生成长度格式化：mm:ss.d（超过 1 小时显示 h:mm:ss） */
function formatDuration(ms) {
  var total = Math.max(0, Math.floor(ms / 100)) / 10;
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = (total % 60).toFixed(1);
  if (s.split('.')[0].length < 2) s = '0' + s;
  if (h) return h + ':' + (m < 10 ? '0' + m : m) + ':' + s;
  return (m < 10 ? '0' + m : m) + ':' + s;
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

/* ---------------- API 调用日志（真实记录，持久化到本机） ----------------
 * 每次真实调用（成功/失败）都落一条，字段与请求一一对应：
 * ts / provider / model（真实发出的模型名）/ type / status / latencyMs / errorMsg / jobId
 * 只写真实调用，不做任何示例数据；最多保留 500 条。 */
var API_LOG_KEY = 'anidream.api-logs.v1';

function apiLogRead() {
  try {
    var rows = JSON.parse(localStorage.getItem(API_LOG_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

function apiLogWrite(rows) {
  try {
    localStorage.setItem(API_LOG_KEY, JSON.stringify(rows.slice(0, 500)));
  } catch (e) {}
}

function apiLogPush(entry) {
  var e = entry || {};
  var rec = {
    ts: Number(e.ts) || Date.now(),
    provider: String(e.provider || '未知接入'),
    model: String(e.model || ''),
    type: String(e.type || 'image'),
    status: e.status === 'ok' ? 'ok' : 'fail',
    latencyMs: Math.max(0, Math.round(Number(e.latencyMs) || 0)),
    promptPreview: String(e.promptPreview || ''),
    errorMsg: String(e.errorMsg || ''),
    endpoint: String(e.endpoint || 'generate'),
    jobId: String(e.jobId || '')
  };
  var rows = apiLogRead();
  rows.unshift(rec);
  apiLogWrite(rows);
  /* 后台上报真实落库：失败静默，绝不影响出图主流程 */
  try {
    var token = localStorage.getItem('hm.token') || '';
    var base = (window.HM && window.HM.api && window.HM.api.base) ? window.HM.api.base : '';
    if (token && base) {
      fetch(base + '/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          provider: rec.provider,
          model: rec.model,
          kind: rec.type,
          status: rec.status,
          latencyMs: rec.latencyMs,
          promptPreview: rec.promptPreview,
          errorMsg: rec.errorMsg,
          jobId: rec.jobId,
          createdAt: rec.ts
        })
      }).catch(function () {});
    }
  } catch (e) {}
  return rec;
}

/* 平台/接入配置 + 真实发出的模型名 */
function apiLogContext(job) {
  var engine = (job && job.engine) || state.engine;
  var provider;
  if (engine === 'gpt-image' || engine === 'banana') {
    provider = 'RayinAI · ' + (engine === 'banana' ? 'Gemini 图像' : 'GPT-image');
  } else if (engine === 'flux') {
    provider = '免密钥通道 · Pollinations';
  } else if (engine === 'openai') {
    provider = '免费额度平台 · 自备 Key';
  } else {
    provider = '内置通道 · ' + engine;
  }
  var sent = (job && (job.sentModel || job.modelName)) || '';
  return {
    provider: provider,
    model: String(sent || (job && job.model) || ''),
    type: (job && job.type) || state.mode || 'image'
  };
}

function markJobError(job, err) {
  saveFailedWork(job, err);
  job.status = 'error';
  try {
    var logCtx = apiLogContext(job);
    apiLogPush({
      provider: logCtx.provider,
      endpoint: 'generate',
      model: logCtx.model,
      type: logCtx.type,
      promptPreview: (job.fullPrompt || '').slice(0, 60),
      status: 'fail',
      latencyMs: Math.round(Date.now() - (job.startedAt || Date.now())),
      errorMsg: (err && (err.message || err.hint || String(err))) || '',
      jobId: job.id
    });
  } catch (e) {}
  const card = document.querySelector('[data-job="' + job.id + '"]');
  if (!card) return;

  card.classList.remove('is-loading');
  card.classList.add('is-error');
  const media = card.querySelector('.result-media');
  if (media) {
    var mainText = esc(errorText(err) || '生成失败');
    var hintText = errorHint(err);
    var hintHtml = hintText ? '<div class="error-hint">' + esc(hintText) + '</div>' : '';
    media.classList.add('is-failed-media');
    media.classList.add('media-loading');
    media.innerHTML = '<div class="error-box">' +
      ICONS.alert +
      '<strong>生成失败</strong>' +
      '<div class="error-main">' + mainText + '</div>' +
      hintHtml +
      '<button data-action="retry">重试</button>' +
    '</div>';
  }
}

/* ---------------- 失败任务的结果保存 ---------------- */
function failureTextOf(err) {
  var text = '';
  try { text = errorText(err) || ''; } catch (e) { text = ''; }
  return String(text || '生成失败').slice(0, 240);
}

function failureHintOf(err) {
  var hint = '';
  try { hint = errorHint(err) || ''; } catch (e) { hint = ''; }
  return String(hint || '').slice(0, 240);
}

/* 失败也留一条结果：卡片留在结果区，同时写入 state.works 并持久化，刷新后仍在 */
function saveFailedWork(job, err) {
  if (!job || !job.id) return null;
  var text = failureTextOf(err);
  var hint = failureHintOf(err);
  job.status = 'error';
  job.ok = false;
  job.failed = true;
  job.error = text;
  job.errorHint = hint;
  job.url = job.url || '';
  job.thumb = null;

  var record = null;
  for (var i = 0; i < state.works.length; i += 1) {
    if (state.works[i] && state.works[i].id === job.id) { record = state.works[i]; break; }
  }
  if (record) {
    /* 同一条记录再次失败：原地更新，不重复插入 */
    record.ok = false;
    record.failed = true;
    record.status = 'error';
    record.error = text;
    record.errorHint = hint;
    record.url = '';
    record.thumb = null;
    record.calibrated = false;
    record.elapsed = Number(job.elapsed) || 0;
    record.closedAt = record.closedAt || Number(job.closedAt) || Date.now();
  } else {
    record = {
      id: job.id,
      type: job.type || 'image',
      url: '',
      rawUrl: '',
      thumb: null,
      ok: false,
      failed: true,
      status: 'error',
      error: text,
      errorHint: hint,
      prompt: job.prompt || '',
      enPrompt: job.promptEn || '',
      modelId: job.modelId || '',
      modelName: job.modelName || '',
      channelModel: job.channelModel || '',
      engine: job.engine || state.engine || 'flux',
      seed: job.seed || 0,
      width: job.width || 0,
      height: job.height || 0,
      ratioId: job.ratioId || '',
      scaleId: job.scaleId || '',
      steps: job.steps || 0,
      duration: job.duration || 0,
      elapsed: Number(job.elapsed) || 0,
      refImages: Array.isArray(job.refImages) ? job.refImages : null,
      createdAt: Date.now(),
      closedAt: Number(job.closedAt) || Date.now()
    };
    state.works.unshift(record);
    state.works = state.works.slice(0, MAX_WORKS);
    if (window.HMDesk && window.HMDesk.onWorkCreated) window.HMDesk.onWorkCreated(record);
  }
  saveWorks();
  renderWorks();
  return record;
}

function markJobDone(job, url, seed, elapsed) {
  job.status = 'done';
  job.url = url;
  job.seed = seed;
  job.elapsed = elapsed;

  /* API 调用日志 */
  try {
    var logCtx = apiLogContext(job);
    apiLogPush({
      provider: logCtx.provider,
      endpoint: 'generate',
      model: logCtx.model,
      type: logCtx.type,
      promptPreview: (job.fullPrompt || '').slice(0, 60),
      status: 'ok',
      latencyMs: Math.round(elapsed || (Date.now() - (job.startedAt || Date.now()))),
      jobId: job.id
    });
  } catch (e) {}

  /* 先落盘再管界面：卡片可能已被切换视图/重排移除，
     但作品不能因此不保存（这是「刷新后新图不见」的一条静默丢失路径） */
  job.rawUrl = job.rawUrl || url;
  saveWork(job);

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

  job.rawUrl = job.rawUrl || url;
  saveWork(job);
  /* 出图后按目标像素异步校准：先显示返回图，完成后无缝替换 */
  calibrateJobImage(job);
}

/* ---------------- 生成结果尺寸校准 ----------------
 * 出图服务可能只按旧比例表返回近似尺寸；这里按 job.width/height 做 cover + 居中裁切，
 * 保证展示与下载的图都是用户所选像素。原图地址保留在 job.rawUrl，失败时回退原图。 */
var SIZECAL_MAX_DIFF = 0.02;

function loadCalibrationImage(url, cors) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('calibrate-image-load-failed')); };
    img.src = url;
  });
}

/* cover 缩放后居中裁出目标像素；canvas 被跨域污染时 toDataURL 会抛错，由调用方回退 */
function drawCalibratedImage(img, targetW, targetH) {
  var nw = img.naturalWidth || img.width;
  var nh = img.naturalHeight || img.height;
  if (!nw || !nh) return null;
  var canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  var ctx = canvas.getContext('2d');
  var scale = Math.max(targetW / nw, targetH / nh);
  var dw = nw * scale;
  var dh = nh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
  return canvas.toDataURL('image/jpeg', 0.95);
}

function commitCalibratedImage(job, dataUrl) {
  if (!job.rawUrl) job.rawUrl = job.url;
  job.url = dataUrl;
  job.calibrated = true;
  if (job.planWidth && job.planHeight) { job.width = job.planWidth; job.height = job.planHeight; }

  var cardImg = document.querySelector('[data-job="' + job.id + '"] .result-media img');
  if (cardImg) cardImg.src = dataUrl;
  var cardMeta = document.querySelector('[data-job="' + job.id + '"] .result-meta span:nth-child(2)');
  if (cardMeta) cardMeta.textContent = job.width + '\u00d7' + job.height;
  var active = state.activeItem;
  if (active && active.id === job.id) {
    active.rawUrl = active.rawUrl || job.rawUrl;
    active.url = dataUrl;
    if (els.lbImage) els.lbImage.src = dataUrl;
  }

  var work = null;
  for (var i = 0; i < state.works.length; i++) {
    if (state.works[i].id === job.id) { work = state.works[i]; break; }
  }
  if (!work) return;
  work.rawUrl = job.rawUrl;
  work.url = dataUrl;
  work.width = job.width;
  work.height = job.height;
  work.calibrated = true;
  saveWorks();
  renderWorks();
  makeThumb(dataUrl).then(function (thumb) {
    if (!thumb) return;
    work.thumb = thumb;
    saveWorks();
    renderWorks();
  });
}

async function calibrateJobImage(job) {
  if (!job || job.calibrated) return;
  if ((job.type || 'image') !== 'image' || !job.url) return;
  var targetW = Math.round(Number(job.planWidth || job.width) || 0);
  var targetH = Math.round(Number(job.planHeight || job.height) || 0);
  if (!targetW || !targetH) return;

  var src = job.url;
  var img = null;
  try { img = await loadCalibrationImage(src, false); } catch (e) { return; }
  var nw = img.naturalWidth || 0;
  var nh = img.naturalHeight || 0;
  if (!nw || !nh) return;

  var diff = Math.abs(nw / nh - targetW / targetH) / (targetW / targetH);
  if (diff <= SIZECAL_MAX_DIFF && nw === targetW && nh === targetH) return;

  var out = null;
  try { out = drawCalibratedImage(img, targetW, targetH); } catch (e) { out = null; }
  if (!out) {
    /* 跨域取不到像素：改用匿名跨域再试一次，仍失败则保留原图 */
    try {
      var img2 = await loadCalibrationImage(src, true);
      out = drawCalibratedImage(img2, targetW, targetH);
    } catch (e2) { out = null; }
  }
  if (!out) {
    console.warn('[size-calibrate] 未能校准尺寸（跨域且无 CORS），已保留原图', src);
    toast('未能校准尺寸，已保留原图', 'info');
    return;
  }
  commitCalibratedImage(job, out);
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
/* 需要确保写入完成（迁移、参考图缓存）时用 Promise 版本 */
function idbPutBlobAsync(id, val) {
  return _blobDb().then(function (db) {
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(val, id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  });
}
function idbGetBlob(id) {
  return _blobDb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var req = db.transaction('blobs', 'readonly').objectStore('blobs').get(id);
        req.onsuccess = function () { resolve(req.result == null ? null : req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
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

/* 把 localStorage 里标记为 blob 的作品补回原图、参考图与缩略图。
   localStorage 只留元数据，图片本体全部在 IndexedDB，避免 5MB 配额溢出。 */
function hydrateWorks() {
  return idbAllBlobs().then(function (map) {
    var changed = false;
    state.works.forEach(function (w) {
      if (!w) return;
      if (!w.url && map[w.id]) { w.url = map[w.id]; changed = true; }
      if (w.refsBlob && !w.refImages && map[w.id + ':refs']) {
        try {
          var refs = JSON.parse(map[w.id + ':refs']);
          if (Array.isArray(refs)) { w.refImages = refs; changed = true; }
        } catch (e) {}
      }
      if (w.thumbBlob && !w.thumb && map[w.id + ':thumb']) {
        w.thumb = map[w.id + ':thumb'];
        changed = true;
      }
    });
    return changed;
  });
}

/* ---------------- localStorage → IndexedDB 一次性迁移 ----------------
 * 旧版本把作品原图/参考图/缩略图一起塞在 localStorage，48 张就撑爆 5MB。
 * 这里把当前用户键、.bak、.snap.* 里的作品合并去重，图片写入 IndexedDB，
 * 再回写一份只含元数据的 JSON；只有全部图片都写入成功才删旧快照。 */
var LS_IDB_MIGRATED = 'anidream.idb.migrated.v1';

function workKeyCandidates(key) {
  var out = [key, key + '.bak'];
  try {
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (k && k.indexOf(key + '.snap.') === 0) out.push(k);
    }
  } catch (e) {}
  return out;
}

/* 迁移所有账号键（含访客键），避免启动时 HMApp.user 尚未恢复而只迁错一个键 */
async function migrateWorksToIdb() {
  if (!window.indexedDB) return false;
  var keys = [];
  try {
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('anidream.works.v1') !== 0) continue;
      if (k.indexOf('.snap.') >= 0 || /\.bak$/.test(k)) continue;
      keys.push(k);
    }
  } catch (e) { return false; }
  var any = false;
  for (var j = 0; j < keys.length; j += 1) {
    try { any = (await migrateOneWorkKey(keys[j])) || any; } catch (e) {}
  }
  return any;
}

async function migrateOneWorkKey(key) {
  var bak = key + '.bak';
  try { if (localStorage.getItem(LS_IDB_MIGRATED + ':' + key) === '1') return false; } catch (e) { return false; }
  var candidates = workKeyCandidates(key);
  var snaps = candidates.filter(function (k) { return k.indexOf(key + '.snap.') === 0; }).sort();
  var ordered = snaps.concat([bak, key]);
  var map = Object.create(null), order = [];
  ordered.forEach(function (k) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) return;
    list.forEach(function (w) {
      if (!w || !w.id) return;
      var hit = map[w.id];
      if (hit) {
        Object.keys(w).forEach(function (f) {
          if (w[f] !== null && w[f] !== undefined && w[f] !== '') hit[f] = w[f];
        });
      } else {
        map[w.id] = Object.assign({}, w);
        order.push(w.id);
      }
    });
  });
  if (!order.length) {
    try { localStorage.setItem(LS_IDB_MIGRATED + ':' + key, '1'); } catch (e) {}
    return false;
  }
  var works = order.map(function (id) { return map[id]; });
  var written = { url: 0, refs: 0, thumb: 0 };
  var ok = works.length === order.length;

  /* 逐条写入 + 读回逐字节校验；任何一条不一致立即中止，旧数据原样保留 */
  async function putVerified(id, val) {
    if (!(await idbPutBlobAsync(id, val))) return false;
    var back = await idbGetBlob(id);
    return back === val;
  }

  for (var i = 0; ok && i < works.length; i += 1) {
    var w = works[i];
    if (w.url && w.url.indexOf('data:') === 0) {
      if (!(await putVerified(w.id, w.url))) { ok = false; break; }
      written.url += 1;
      w.url = ''; w.blob = true;
    }
    if (Array.isArray(w.refImages) && w.refImages.length) {
      var refsJson = JSON.stringify(w.refImages);
      if (!(await putVerified(w.id + ':refs', refsJson))) { ok = false; break; }
      written.refs += 1;
      w.refImages = null; w.refsBlob = true;
    }
    if (w.thumb && w.thumb.indexOf('data:') === 0) {
      if (!(await putVerified(w.id + ':thumb', w.thumb))) { ok = false; break; }
      written.thumb += 1;
      w.thumb = null; w.thumbBlob = true;
    }
  }
  if (!ok) return false;                       /* 图片没写全/校验失败，绝不删旧数据 */
  var compact = JSON.stringify(works);
  var check = [];
  try { check = JSON.parse(compact); } catch (e) { check = []; }
  if (!Array.isArray(check) || check.length !== works.length) return false;
  if (!saveJSON(key, works)) return false;     /* 回写失败，保留旧键 */
  try { localStorage.setItem(bak, compact); } catch (e) {}
  snaps.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  try { localStorage.setItem(LS_IDB_MIGRATED + ':' + key, '1'); } catch (e) {}
  console.log('[storage] 已迁移并校验：works=' + works.length +
    '，原图=' + written.url + '，参考图=' + written.refs + '，缩略图=' + written.thumb +
    '，localStorage 紧凑后=' + compact.length + ' B');
  return true;
}

/* 输入框参考图缓存（anidream.composer.v1）同样迁到 IndexedDB，只留缩略图 */
async function migrateComposerToIdb() {
  if (!window.indexedDB) return false;
  var store = readComposerStore();
  var keys = Object.keys(store);
  var changed = false;
  for (var i = 0; i < keys.length; i += 1) {
    var k = keys[i];
    var entry = store[k];
    if (!entry || entry.refsIdb || !Array.isArray(entry.refs)) continue;
    var full = JSON.stringify(entry.refs);
    var ok = await idbPutBlobAsync('cmp:' + k, full);
    if (!ok) continue;
    entry.refs = entry.refs.map(function (arr) {
      return (arr || []).map(function (r) {
        return {
          name: r.name, width: r.width, height: r.height, weight: r.weight,
          thumb: r.thumb || r.preview || '', refsIdb: true
        };
      });
    });
    entry.refsIdb = true;
    changed = true;
  }
  if (changed) return saveJSON(LS_COMPOSER, store);
  return false;
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
      if (!w || (!w.url && !w.blob && !w.failed && w.ok !== false)) return;
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
    ok: true,
    rawUrl: job.rawUrl || '',
    thumb: null,
    prompt: job.prompt,
    enPrompt: job.promptEn || '',
    modelId: job.modelId,
    modelName: job.modelName,
    /* 记录实际使用的免费通道模型（sana / flux-anime / kolors …），
       否则「恢复参数」只能恢复风格而恢复不了通道模型 */
    channelModel: job.channelModel || state.channelModel || '',
    engine: job.engine || 'flux',
    seed: job.seed,
    width: job.width,
    height: job.height,
    ratioId: job.ratioId,
    scaleId: job.scaleId,
    steps: job.steps,
    duration: job.duration || 0,
    elapsed: Number(job.elapsed) || 0,
    /* 保存参考主体素材，供「恢复参数」时还原参考图 */
    refImages: Array.isArray(job.refImages) ? job.refImages : null,
    createdAt: Date.now(),
    /* 任务结束（关闭）时刻：历史记录里展示「关闭 时间」 */
    closedAt: Number(job.closedAt) || Date.now()
  };

  var existingIndex = -1;
  for (var wi = 0; wi < state.works.length; wi += 1) {
    if (state.works[wi] && state.works[wi].id === work.id) { existingIndex = wi; break; }
  }
  if (existingIndex >= 0) {
    work.createdAt = state.works[existingIndex].createdAt || Date.now();
    state.works[existingIndex] = work;
  } else {
    state.works.unshift(work);
    state.works = state.works.slice(0, MAX_WORKS);
  }
  /* 若当前在某个文件夹桌面内生成，自动把作品归到该文件夹 */
  if (window.HMDesk && window.HMDesk.onWorkCreated) window.HMDesk.onWorkCreated(work);
  saveWorks();
  renderWorks();

  /* 生图成功先归档到后端：本地只留缩略图 + 资产地址，避免配额把作品挤掉 */
  if (type === 'image' && window.HMSync && HMSync.archiveWork) {
    if (job.url && job.url.indexOf('data:') === 0) work._pendingUrl = job.url;
    HMSync.archiveWork(work).then(function (r) {
      if (r && r.ok) {
        if (state.view === 'works') renderWorks();
        toast('原图已存到云端，本地只保留缩略图', 'ok', 3000);
      } else if (r && r.reason === 'upload-failed') {
        toast('原图暂只在本机：云端归档失败，已排队自动补传', 'warn', 6000);
      } else if (r && r.reason === 'offline') {
        toast('当前离线：原图先存本机，联网后自动补传到云端', 'warn', 6000);
      }
    }).catch(function () {});
  }

  if (type !== 'image') return;

  // GPT-image 常返回 base64 内联图，直接存会超出 localStorage 容量，压缩后再落盘
  if (job.url.indexOf('data:') === 0) {
    compressDataUrl(job.url, 1280, 0.86).then(function (small) {
      if (!small || work.calibrated || work._assetId) return;
      work.url = small;
      saveWorks();
      if (state.view === 'works') renderWorks();
    });
  }

  makeThumb(job.url).then(function (thumb) {
    if (work.calibrated) return;
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
  var key = worksLsKey();
  var bakKey = worksBakLsKey();
  /* 写入前先做带时间戳快照（.snap.<ts>，保留 3 份）；
     若是同步流程写入空列表，beforePersist 会直接从快照回滚，绝不落盘空数组 */
  if (window.HMSync && window.HMSync.beforePersist) window.HMSync.beforePersist(state.works);
  /* 覆盖前先备份一份，便于误清后恢复 */
  try {
    var prev = localStorage.getItem(key);
    if (prev && prev !== '[]' && prev.length > 40) localStorage.setItem(bakKey, prev);
  } catch (e) {}

  /* base64 原图写进 IndexedDB，localStorage 只留元数据（否则 5MB 配额会写失败）。
     refImages / thumb 同样是 base64，体积大；配额不足时分级降级，
     绝不允许「整条作品都写不进去」这种静默丢失。 */
  function persistMeta(dropRefs, dropThumb) {
    var canIdb = !!window.indexedDB;
    return state.works.map(function (work, index) {
      var copy = Object.assign({}, work);
      if (copy.url && copy.url.indexOf('data:') === 0) {
        idbPutBlob(copy.id, copy.url);
        copy.url = '';
        copy.blob = true;
      }
      /* 参考图与缩略图也是 base64，和原图一样迁到 IndexedDB；
         localStorage 只留 refsBlob / thumbBlob 标记。IDB 不可用时退回旧降级逻辑。 */
      if (canIdb && Array.isArray(copy.refImages) && copy.refImages.length) {
        idbPutBlob(copy.id + ':refs', JSON.stringify(copy.refImages));
        copy.refImages = null;
        copy.refsBlob = true;
      } else if (copy.refsBlob) {
        copy.refImages = null;
      }
      if (canIdb && copy.thumb && copy.thumb.indexOf('data:') === 0) {
        idbPutBlob(copy.id + ':thumb', copy.thumb);
        copy.thumb = null;
        copy.thumbBlob = true;
      } else if (copy.thumbBlob) {
        copy.thumb = null;
      }
      if (!canIdb) {
        if (dropRefs) copy.refImages = null;
        if (dropThumb || (dropRefs && index > 8)) copy.thumb = null;
      }
      return copy;
    });
  }

  if (saveJSON(key, persistMeta(false, false))) {
    syncWorksToServer();
    return;
  }

  /* 配额告急时先释放同内容的备份键（整份 JSON，等于白占一倍空间）再原样重试一次；
     另有 .snap.<ts> 快照兜底，删备份不影响恢复 */
  try {
    var err0 = window.__hmLastSaveError;
    if (err0 && err0.name === 'QuotaExceededError') {
      localStorage.removeItem(bakKey);
      /* 旧快照 / 离线队列都是可重建缓存：配额告急时先回收再重试整份作品，
         否则备份把配额占满，作品本体写不进去就只剩错误提示 */
      if (window.HMAuth && window.HMAuth.trimStorage) { try { window.HMAuth.trimStorage(); } catch (e2) {} }
      if (saveJSON(key, persistMeta(false, false))) {
        syncWorksToServer();
        return;
      }
    }
  } catch (e) {}

  /* 配额不足：先去掉参考图缓存（通常是最大头）再试 */
  if (saveJSON(key, persistMeta(true, false))) {
    toast('本机存储空间紧张：已省略参考图缓存，作品本身已保存', 'warn', 6000);
    syncWorksToServer();
    return;
  }

  /* 仍不足：连缩略图一起省略，只保作品主体 */
  if (saveJSON(key, persistMeta(true, true))) {
    toast('本机存储空间紧张：已省略缩略图缓存，作品本身已保存', 'warn', 6000);
    syncWorksToServer();
    return;
  }

  /* 彻底写不进：先把原图转存云端，再给出能区分「浏览器配额」和「磁盘」的提示 */
  if (window.__hmQuotaToastAt && Date.now() - window.__hmQuotaToastAt < 8000) {
    syncWorksToServer();
    return;
  }
  window.__hmQuotaToastAt = Date.now();
  if (window.HMSync && HMSync.archiveWork && state.works[0]) {
    HMSync.archiveWork(state.works[0]).catch(function () {});
  }
  var fallbackMsg = '本机存储空间不足：原图已转存云端，本地只保留缩略图，仍可查看与下载';
  var saveErr = window.__hmLastSaveError || {};
  var saveErrName = String(saveErr.name || '');
  /* 原来的「配额仅占 0%」来自 navigator.storage.estimate()，它的 usage 不含 localStorage，
     所以会出现「0% 却说空间不足」的自相矛盾。这里改按 localStorage 实际字节数统计。 */
  var lsBytes = 0;
  try {
    for (var li = 0; li < localStorage.length; li += 1) {
      var lk = localStorage.key(li) || '';
      lsBytes += (lk.length + (localStorage.getItem(lk) || '').length) * 2;
    }
  } catch (e) {}
  var msg;
  if (saveErrName === 'QuotaExceededError' || saveErrName === 'NS_ERROR_DOM_QUOTA_REACHED') {
    msg = '站点本地存储已满（localStorage 已占约 ' + (lsBytes / 1048576).toFixed(1) + 'MB，浏览器上限一般 5MB，与磁盘无关）：原图已改存云端，不影响查看与下载；可在浏览器「站点设置 → 清除数据」释放空间';
  } else if (saveErrName === 'SecurityError') {
    msg = '浏览器禁止本站写入本地存储（隐私模式或站点数据被禁用）：原图已改存云端，不影响查看与下载';
  } else if (saveErrName) {
    msg = '写入本地缓存失败（' + saveErrName + '）：与磁盘空间无关；原图已改存云端，不影响查看与下载';
  } else {
    msg = '写入本地缓存失败：原图已改存云端，不影响查看与下载';
  }
  toast(msg || fallbackMsg, 'error', 9000);
  syncWorksToServer();
}

/* 把本地全部作品（含 base64）上传到服务端，分批并发避免卡顿。
   Render 免费层重启会清空 data/，下次用户打开时本地存的图自动补回去。 */
var _syncingAll = false;
async function syncAllWorksToServer(serverItems) {
  if (window.HMSync && window.HMSync.afterLogin) { window.HMSync.afterLogin(); return; }
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
  /* 统一交给云同步层：图片先上传对象存储，元数据带 rev 写入数据库 */
  if (window.HMSync && window.HMSync.onWorksChanged) { window.HMSync.onWorksChanged(); return; }
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
/* 下载原图：一律经后端 /download 代理取回二进制后用 Blob 保存，页面不跳转、不打开新标签页。
   - 不再让浏览器直连 COS 预签名直链（那边没有 CORS 头，fetch 必被拦）
   - 保存的是原始字节，不做格式转换/二次压缩
   - 同名文件由浏览器自动追加 (1)/(2)，不会静默覆盖 */
/* 图片下载/打包统一走后端代理：浏览器直连 COS 预签名直链没有 CORS 头，
   <img> 能显示但 fetch 取不到字节（线上「原图读取被拦截」的根因）。
   后端 /download 回源取字节并带 Content-Disposition 返回，历史作品同样适用。 */
function proxyMediaUrl(url) {
  var src = String(url || '');
  if (!src) return src;
  if (window.HM && HM.api && typeof HM.api.downloadUrl === 'function') {
    return HM.api.downloadUrl(src);
  }
  return src;
}

/* 打包用：取回图片二进制。后端以 base64 JSON 返回（SCF 回传二进制会被截断），
   旧后端则回退到直接 fetch。 */
function fetchImageBlob(url) {
  var api = window.HM && HM.api;
  if (api && typeof api.downloadB64Url === 'function') {
    return fetch(api.downloadB64Url(url), { credentials: 'omit', cache: 'no-store' }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok || !body || !body.data) {
          throw new Error((body && body.error && body.error.message) || ('HTTP ' + r.status));
        }
        var bin = window.atob(body.data);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: body.mime || 'application/octet-stream' });
      });
    });
  }
  return fetch(proxyMediaUrl(url)).then(function (r) { return r.blob(); });
}

async function downloadImage(url, filename) {
  if (!url) {
    toast('图片地址不可用', 'error');
    return;
  }

  var target = proxyMediaUrl(url);
  try {
    /* 新后端：先 meta 探测存在性（小 JSON，可捕获失败），再让浏览器直接访问
       /download 的 302 直链（响应带 attachment，不依赖 CORS）。
       不再把大文件经 fetch 取进页面，避免 SCF 回传二进制被截断。 */
    const api = window.HM && HM.api;
    if (api && typeof api.downloadMetaUrl === 'function') {
      const metaRes = await fetch(api.downloadMetaUrl(url, filename), { credentials: 'omit', cache: 'no-store' });
      let meta = null;
      try { meta = await metaRes.json(); } catch (e) {}
      if (!metaRes.ok) {
        const metaErr = new Error((meta && meta.error && meta.error.message) || ('HTTP ' + metaRes.status));
        metaErr.status = metaRes.status;
        throw metaErr;
      }
      const a = document.createElement('a');
      a.href = api.downloadUrl(url, filename);
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('原图已开始下载', 'success');
      return;
    }
    const res = await fetch(target, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try {
        const body = await res.json();
        if (body && body.error && body.error.message) detail = String(body.error.message);
      } catch (e) {}
      const httpErr = new Error(detail);
      httpErr.status = res.status;
      throw httpErr;
    }

    const blob = await res.blob();

    /* 扩展名：优先取 MIME，其次取 URL 后缀，最后兜底 jpg；只影响文件名，不改内容 */
    let ext = '';
    const type = (blob.type || '').toLowerCase();
    if (type.indexOf('image/jpeg') === 0) ext = 'jpg';
    else if (type.indexOf('image/png') === 0) ext = 'png';
    else if (type.indexOf('image/webp') === 0) ext = 'webp';
    else if (type.indexOf('image/gif') === 0) ext = 'gif';
    else if (type.indexOf('video/mp4') === 0) ext = 'mp4';
    else if (type.indexOf('video/webm') === 0) ext = 'webm';
    else if (type.indexOf('audio/mpeg') === 0 || type.indexOf('audio/mp3') === 0) ext = 'mp3';
    else if (type.indexOf('audio/wav') === 0) ext = 'wav';
    if (!ext) {
      const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
      if (m) ext = m[1].toLowerCase();
    }
    if (!ext) ext = 'jpg';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 8000);

    toast(ext.toUpperCase() + ' 原图已开始下载', 'success');
  } catch (err) {
    /* 失败按类别提示：网络 / 权限 / 文件不存在，不再一律说「被拦截」 */
    const status = Number((err && err.status) || 0);
    const msg = String((err && err.message) || '');
    if (status === 401 || status === 403) {
      toast('下载失败：没有原图读取权限（HTTP ' + status + '）', 'error', 6000);
    } else if (status === 404) {
      toast('下载失败：原图不存在或已失效（HTTP 404）', 'error', 6000);
    } else if (err && err.offline) {
      toast('下载失败：无法连接后端服务，请检查网络后重试', 'error', 6000);
    } else if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      toast('下载失败：网络不可达，请刷新后重试', 'error', 6000);
    } else {
      toast('下载失败：' + (msg || '后端返回异常') + '，请刷新后重试', 'error', 6000);
    }
  }
}

/* ---------------- 大图预览 ---------------- */
/* ---------- Lightbox 状态 ---------- */
var lbState = { scale: 1, rotate: 0, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0, lastX: 0, lastY: 0, pointerId: null, animTimer: null, bound: false, isImage: false };

function lbApply() {
  var img = els.lbImage;
  if (!img) return;
  img.style.transform = 'translate(' + lbState.tx + 'px,' + lbState.ty + 'px) scale(' + lbState.scale + ') rotate(' + lbState.rotate + 'deg)';
  img.style.transformOrigin = 'center center';
  var label = document.getElementById('lbZoomLabel');
  if (label) label.textContent = Math.round(lbState.scale * 100) + '%';
}

function lbReset() {
  lbState.scale = 1; lbState.rotate = 0; lbState.tx = 0; lbState.ty = 0;
  lbApply();
}

function lbZoom(factor, cx, cy) {
  var prev = lbState.scale;
  var next = Math.min(10, Math.max(0.1, prev * factor));
  // 以 (cx,cy) 为锚点缩放
  if (cx != null && cy != null && els.lbStage && prev !== next) {
    var rect = els.lbStage.getBoundingClientRect();
    var px = cx - rect.left - rect.width / 2;
    var py = cy - rect.top - rect.height / 2;
    lbState.tx = px - (px - lbState.tx) * (next / prev);
    lbState.ty = py - (py - lbState.ty) * (next / prev);
    // 拖动过程中滚轮缩放：把拖动基准点移到当前指针与当前偏移，
    // 否则下一次 pointermove 会按旧的 startTx/startTy 计算，图片被“拽”回原处。
    if (lbState.dragging) {
      lbState.startTx = lbState.tx;
      lbState.startTy = lbState.ty;
      lbState.startX = lbState.lastX;
      lbState.startY = lbState.lastY;
    }
  }
  lbState.scale = next;
  lbApply();
}

function lbFit() {
  var img = els.lbImage, stage = els.lbStage;
  if (!img || !img.naturalWidth || !img.naturalHeight || !stage) return;
  var rot = lbState.rotate % 180;
  var w = rot === 0 ? img.naturalWidth : img.naturalHeight;
  var h = rot === 0 ? img.naturalHeight : img.naturalWidth;
  var sw = stage.clientWidth - 40;
  var sh = stage.clientHeight - 40;
  lbState.scale = Math.min(sw / w, sh / h, 1);
  lbState.tx = 0; lbState.ty = 0;
  lbApply();
}

function lbRotate(delta) {
  lbState.rotate = ((lbState.rotate + delta) % 360 + 360) % 360;
  lbApply();
}

function bindLightboxGestures() {
  if (lbState.bound) return;
  lbState.bound = true;
  var img = els.lbImage, stage = els.lbStage;

  // 滚轮缩放：关掉过渡，缩放后仍可立即拖动
  stage.addEventListener('wheel', function (e) {
    if (!lbState.isImage) return;
    e.preventDefault();
    img.classList.add('no-anim');
    clearTimeout(lbState.animTimer);
    lbState.animTimer = setTimeout(function () {
      if (!lbState.dragging) img.classList.remove('no-anim');
    }, 200);
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    lbZoom(factor, e.clientX, e.clientY);
  }, { passive: false });

  // 拖拽平移：任意缩放比例下都可拖动（不再限制 scale > 1）
  img.addEventListener('pointerdown', function (e) {
    if (!lbState.isImage) return;
    if (lbState.dragging) return;          // 已在拖动：忽略第二根手指，避免与缩放/双指手势打架
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lbState.dragging = true;
    lbState.pointerId = e.pointerId;
    lbState.startX = e.clientX; lbState.startY = e.clientY;
    lbState.lastX = e.clientX; lbState.lastY = e.clientY;
    lbState.startTx = lbState.tx; lbState.startTy = lbState.ty;
    try { img.setPointerCapture(e.pointerId); } catch (err) {}
    img.classList.add('no-anim');
    e.preventDefault();
  });
  img.addEventListener('pointermove', function (e) {
    if (!lbState.dragging) return;
    if (e.pointerId != null && e.pointerId !== lbState.pointerId) return;
    lbState.lastX = e.clientX; lbState.lastY = e.clientY;
    lbState.tx = lbState.startTx + (e.clientX - lbState.startX);
    lbState.ty = lbState.startTy + (e.clientY - lbState.startY);
    lbApply();
  });
  function endDrag(e) {
    if (!lbState.dragging) return;
    if (e && e.pointerId != null && e.pointerId !== lbState.pointerId) return;
    lbState.dragging = false;
    lbState.pointerId = null;
    img.classList.remove('no-anim');
    try { img.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);
  img.addEventListener('dragstart', function (e) { e.preventDefault(); });

  // 按钮
  var bar = document.getElementById('lbZoomBar');
  var $ = function (id) { return document.getElementById(id); };
  if ($('lbZoomIn'))  $('lbZoomIn').onclick  = function () { lbZoom(1.2); };
  if ($('lbZoomOut')) $('lbZoomOut').onclick = function () { lbZoom(1 / 1.2); };
  if ($('lbFit'))     $('lbFit').onclick     = lbFit;
  if ($('lbReset'))   $('lbReset').onclick   = lbReset;
  if ($('lbRotL'))    $('lbRotL').onclick    = function () { lbRotate(-90); };
  if ($('lbRotR'))    $('lbRotR').onclick    = function () { lbRotate(90); };
  if ($('lbRot180'))  $('lbRot180').onclick  = function () { lbRotate(180); };

  // 键盘
  document.addEventListener('keydown', function (e) {
    if (!els.lightbox || !els.lightbox.classList.contains('is-open')) return;
    if (!lbState.isImage) return;
    var k = e.key;
    if (k === '+' || k === '=') { lbZoom(1.15); e.preventDefault(); }
    else if (k === '-' || k === '_') { lbZoom(1 / 1.15); e.preventDefault(); }
    else if (k === '0') { lbFit(); e.preventDefault(); }
    else if (k.toLowerCase() === 'r') { lbReset(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { lbRotate(-90); e.preventDefault(); }
    else if (k === 'ArrowRight') { lbRotate(90); e.preventDefault(); }
  });

  // 双击切换 1x / fit
  stage.addEventListener('dblclick', function () {
    if (!lbState.isImage) return;
    if (lbState.scale > 1.01) lbFit(); else lbZoom(1);
  });
}

/* 量出上/下两条固定栏（缩放工具栏、下载/操作栏）的占位：
   --lb-bar-h 抬高舞台底边，--lb-top-h 压低舞台顶边。
   两条栏本身是 absolute 固定定位，图片只在中间这段区域居中，所以上下留白相等。 */
function syncLbBarSpace() {
  var bar = document.querySelector('.lightbox .lb-bar');
  var h = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--lb-bar-h', (h + 36) + 'px');
  var zb = document.querySelector('.lightbox .lb-zoom-bar');
  var topH = 36;
  if (zb && !zb.hidden) {
    var r = zb.getBoundingClientRect();
    if (r.height) topH = Math.ceil(r.bottom) + 18;
  }
  document.documentElement.style.setProperty('--lb-top-h', topH + 'px');
}

function openLightbox(item) {
  state.activeItem = item;
  var type = item.type || 'image';
  els.lbStage.querySelectorAll('.lb-media-el').forEach(function (node) { node.remove(); });

  var bar = els.lbZoomBar;
  var isFailed = !!(item && (item.failed || item.ok === false));
  lbState.isImage = (type === 'image') && !isFailed;
  if (bar) bar.hidden = !lbState.isImage;

  // 重置变换
  lbState.scale = 1; lbState.rotate = 0; lbState.tx = 0; lbState.ty = 0;
  lbState.dragging = false; lbState.pointerId = null;
  clearTimeout(lbState.animTimer);
  if (els.lbImage) {
    els.lbImage.style.transform = '';
    els.lbImage.style.cursor = '';
    els.lbImage.classList.remove('no-anim');
    els.lbImage.draggable = false;
  }
  lbApply(); /* 打开即 100%：先把缩放标签/变换归位，不等图片加载 */

  if (isFailed) {
    els.lbImage.style.display = 'none';
    els.lbImage.removeAttribute('src');
    var failBox = document.createElement('div');
    failBox.className = 'lb-media-el lb-failed';
    failBox.innerHTML = '<div class="lb-failed-ico">!</div>' +
      '<strong>生成失败</strong>' +
      '<p>' + esc(item.error || '本次生成未成功') + '</p>' +
      (item.errorHint ? '<p class="lb-failed-hint">' + esc(item.errorHint) + '</p>' : '');
    els.lbStage.appendChild(failBox);
  } else if (type === 'image') {
    els.lbImage.style.display = '';
    /* 换图时先藏住：等新图解码完把变换归零再显形，
       避免「先用旧尺寸显示、加载完再跳一下居中」 */
    els.lbImage.style.visibility = 'hidden';
    els.lbImage.src = item.url || item.thumb || '';
    els.lbImage.onerror = function () {
      if (item.thumb && els.lbImage.src !== item.thumb) {
        els.lbImage.src = item.thumb;
        toast('云端原图暂不可达，已显示本地缩略图', 'warn', 5000);
      } else {
        els.lbImage.style.visibility = '';
      }
    };
    els.lbImage.onload = function () {
      lbReset(); /* 每次打开都从 100% 起，不再按窗口大小自适应缩小 */
      els.lbImage.style.visibility = '';
    };
  } else {
    els.lbImage.style.display = 'none';
    var media = document.createElement(type === 'video' ? 'video' : 'audio');
    media.className = 'lb-media-el';
    media.controls = true;
    media.autoplay = true;
    if (type === 'video') media.setAttribute('playsinline', '');
    media.src = item.url || '';
    els.lbStage.appendChild(media);
  }

  els.lbPrompt.textContent = item.prompt || '';
  /* 底部栏不再显示平台名（星野动漫）和种子编号，其余信息保留并自然顶到最左 */
  els.lbMeta.textContent = [
    type === 'video' ? '视频' : type === 'audio' ? '音频' : '',
    item.engine ? (ENGINE_META[item.engine] || {}).meta || '' : '',
    item.width && item.height ? item.width + '×' + item.height : '',
    item.duration ? item.duration + ' 秒' : '',
    item.steps ? item.steps + ' 步' : ''
  ].filter(Boolean).join(' · ');

    if (els.lbDownload) els.lbDownload.disabled = isFailed;
  els.lightbox.classList.add('is-open');
  els.lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
  /* 预览期间连侧栏按钮/把手一起隐藏，退出预览由 closeLightbox 恢复 */
  document.body.classList.add('hm-lb-open');
  syncLbBarSpace();
  if (!window.__lbBarSpaceBound) {
    window.__lbBarSpaceBound = true;
    window.addEventListener('resize', function () {
      if (els.lightbox.classList.contains('is-open')) syncLbBarSpace();
    });
  }

  bindLightboxGestures();
}

function closeLightbox() {
  els.lightbox.classList.remove('is-open');
  els.lightbox.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
  document.body.classList.remove('hm-lb-open');
  /* 参考图「查看」也走这个组件，关闭时一并清掉参考预览状态类 */
  document.body.classList.remove('hm-ref-fs-open');
  state.activeItem = null;
  // 停止视频/音频
  var media = els.lbStage.querySelector('.lb-media-el');
  if (media) try { media.pause(); } catch (err) {}
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
      if (el) el.textContent = formatDuration(now - job.startedAt);
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
  /* 并发去重：正在生成、或 800ms 内重复触发（连点 / 回车连击）都直接挡掉 */
  if (state.generating) {
    toast('正在生成中，请等当前任务结束', 'info');
    return;
  }
  const nowSubmit = Date.now();
  if (state._lastSubmitAt && nowSubmit - state._lastSubmitAt < 800) return;
  state._lastSubmitAt = nowSubmit;

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

  /* 生成前本地校验：参数不合法就不发请求，避免空跑一次扣积分 */
  const pendingRefs = currentRefs();
  for (let ri = 0; ri < pendingRefs.length; ri += 1) {
    const r = pendingRefs[ri];
    if (!r || (!r.dataUrl && !r.preview && !r.thumb)) {
      toast('第 ' + (ri + 1) + ' 张参考图还没准备好，请重新上传或移除后再试', 'error');
      return;
    }
  }
  const countNum = Number(state.count);
  if (!isFinite(countNum) || countNum < 1) {
    toast('生成数量无效，请重新设置', 'error');
    return;
  }

  /* 仅「免费额度平台(openai)」需要用户自备密钥；
     gpt-image / banana 走服务端内置的 GPT / Gemini 默认密钥，前端不填也能生成 */
  if (state.engine === 'openai') {
    const cfg = providerConfig();
    if (!cfg.key) {
      toast('请先在「接入设置」中填写该平台的 API Key', 'error');
      openApiModal();
      return;
    }
  }

  if (currentRefs().length > 0 && state.engine === 'flux') {
    /* FLUX 免费引擎走后端 Proxy，不支持多参考图，提示切 GPT-image / Banana */
    toast('FLUX 免费引擎暂不支持参考图 · 请切换 GPT-image 或 Nano Banana', 'error');
    els.refDrop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const model = getModel(state.modelId);
  const size = currentSize();
  if (!model || !model.id) {
    toast('当前风格模型无效，请重新选择', 'error');
    return;
  }
  if (!size || !(Number(size.w) > 0) || !(Number(size.h) > 0)) {
    toast('尺寸参数无效，请重新选择比例或清晰度', 'error');
    return;
  }
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
      channelModel: state.channelModel || 'gpt-image-2',
      engine: state.engine,
      metaLabel: (ENGINE_META[state.engine] || ENGINE_META.flux).meta,
      width: size.w,
      height: size.h,
      ratioId: size.ratio.id,
      scaleId: effectiveScaleId(size),
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

/* 失败记录 → 生成任务：重试时复用同一条记录，成功后原地更新 */
function workToJob(work) {
  return {
    id: work.id,
    type: work.type || 'image',
    status: 'error',
    ok: false,
    failed: true,
    error: work.error || '',
    prompt: work.prompt || '',
    promptEn: work.enPrompt || '',
    engine: work.engine || state.engine,
    modelId: work.modelId || '',
    modelName: work.modelName || '',
    channelModel: work.channelModel || '',
    seed: work.seed || 0,
    width: work.width || 0,
    height: work.height || 0,
    ratioId: work.ratioId || state.ratio,
    scaleId: work.scaleId || state.scale,
    steps: work.steps || state.steps,
    refImages: Array.isArray(work.refImages) ? work.refImages : null
  };
}

function retryWork(work) {
  if (!work) return;
  if (!(work.failed || work.ok === false)) return;
  var job = workToJob(work);
  if (!state.jobs) state.jobs = new Map();
  state.jobs.set(job.id, job);
  if (!document.querySelector('[data-job="' + job.id + '"]')) createLoadingCard(job);
  retryJob(job);
}

async function retryJob(job) {
  /* 允许和其他批次并发，不再因 state.generating 拒绝 */
  if (!job) return;

  if (job.type && job.type !== 'image') {
    toast('视频 / 音频任务请重新生成', 'info');
    return;
  }

  /* 仅「免费额度平台(openai)」需要用户自备密钥；
     gpt-image / banana 走服务端内置默认密钥，无需前端配置 */
  if (job.engine === 'openai') {
    const cfg = providerConfig();
    if (!cfg.key) {
      toast('请先在「接入设置」中填写该平台的 API Key', 'error');
      openApiModal();
      return;
    }
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
  /* 先切回图片模式：若当前停在视频/音频模式，底栏与模型列表展示的是媒体模型，
     恢复后看起来就像“模型选择不正确” */
  if (window.HMUI && typeof window.HMUI.setMode === 'function' && state.mode !== 'image') {
    window.HMUI.setMode('image');
  }
  /* 模型目录可能随版本更新更换 id：先按 id 精确匹配，再按名称回退，
     避免把 state.modelId 设成不存在的值导致生成时落到默认模型 */
  var restoredModel = MODEL_INDEX.find(function (m) { return m.id === job.modelId; });
  if (!restoredModel && job.modelName) {
    restoredModel = MODEL_INDEX.find(function (m) { return m.name === job.modelName; });
  }
  if (restoredModel) state.modelId = restoredModel.id;
  /* 通道模型（SANA / FLUX Anime / Kolors …）：仅当目录里仍存在时恢复，
     否则保持当前选择，避免恢复到已下线的模型 */
  if (job.channelModel && findChannelModel(job.channelModel)) {
    state.channelModel = job.channelModel;
  }
  /* 旧作品可能记录了已下线的免费 / 免费额度通道，恢复参数时落到当前可用通道 */
  state.engine = (job.engine === 'gpt-image' || job.engine === 'banana') ? job.engine : 'gpt-image';
  if (state.engine === 'gpt-image' && !/^gpt-image/i.test(state.channelModel || '')) {
    state.channelModel = rayinCfg().gptModel || 'gpt-image-2.5-flare';
  } else if (state.engine === 'banana' && !/^gemini/i.test(state.channelModel || '')) {
    state.channelModel = rayinCfg().bananaModel || 'gemini-3.1-flash-image';
  }
  if (job.ratioId && RATIOS.some(function (r) { return r.id === job.ratioId; })) state.ratio = job.ratioId;
  if (job.scaleId && SCALES.some(function (s) { return s.id === job.scaleId; })) state.scale = job.scaleId;
  if (typeof job.seed === 'number' && job.seed > 0) state.seed = job.seed;
  if (typeof job.steps === 'number' && job.steps > 0) state.steps = clamp(job.steps, 4, 12);
  els.promptInput.value = job.prompt || job.enPrompt || '';
  /* 触发 input 事件：同步到当前标签草稿、字数统计与本地持久化，
     否则切换标签/刷新后提示词会丢失 */
  els.promptInput.dispatchEvent(new Event('input', { bubbles: true }));
  updateCharCount();
  /* 恢复参考主体素材。
     兼容三种历史来源：
       1) 旧版直接把 base64 存在作品里：job.refImages（对象数组）或 job.refs（字符串数组）
       2) 新版把原图迁到 IndexedDB：job.id + ':refs'（作业里只留 refsBlob 标记）
       3) 输入框/口袋草稿：cmp:<key>（由 composer 自己持久化，这里不覆盖）
     顺序保持原样；单张坏数据只跳过该张并明确提示，不会把整块清空。 */
  function applyJobRefs(rawRefs) {
    var list = Array.isArray(rawRefs) ? rawRefs : [];
    var normalized = [];
    var missing = [];
    list.forEach(function (r, i) {
      var item = (typeof r === 'string') ? { dataUrl: r } : (r || {});
      var src = item.dataUrl || item.preview || item.thumb;
      if (!src) { missing.push(i + 1); return; }
      normalized.push({
        dataUrl: item.dataUrl || src,
        preview: item.preview || src,
        thumb: item.thumb || src,
        width: Number(item.width) || 1024,
        height: Number(item.height) || 1024,
        weight: typeof item.weight === 'number' ? item.weight : 70,
        name: item.name || ('参考图 ' + (i + 1))
      });
    });
    if (!normalized.length) {
      toast('该作品的参考图已失效，未能恢复', 'error');
      return;
    }
    if (typeof setCurrentRefs === 'function') setCurrentRefs(normalized);
    else { ensureTabSlots(); state.tabRefs[state.activePrompt] = normalized; state.refImages = normalized.slice(); }
    if (typeof renderRef === 'function') renderRef();
    /* 全局强度：同一组图当时是同一档，取共同值还原 slider */
    var firstWeight = normalized[0].weight;
    var sameWeight = normalized.every(function (n) { return n.weight === firstWeight; });
    if (sameWeight && typeof setCurrentTabRefWeight === 'function') {
      setCurrentTabRefWeight(firstWeight);
      if (typeof applyRefWeightUI === 'function') applyRefWeightUI(firstWeight);
    }
    /* 立刻写回当前口袋，刷新后仍在 */
    if (window.HMComposer && typeof window.HMComposer.save === 'function') window.HMComposer.save();
    if (missing.length) toast('第 ' + missing.join('、') + ' 张参考图未能恢复（原数据已丢失）', 'error', 6000);
  }

  var refs = job.refImages || job.refs;
  if (Array.isArray(refs) && refs.length > 0) {
    applyJobRefs(refs);
  } else if (window.indexedDB && job.id) {
    /* 新格式：原图在 IndexedDB 的 <workId>:refs */
    idbGetBlob(job.id + ':refs').then(function (raw) {
      var parsed = null;
      if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
      if (Array.isArray(parsed) && parsed.length) applyJobRefs(parsed);
    }).catch(function () {
      toast('参考图读取失败，请刷新后重试', 'error');
    });
  }
  /* 作品没有参考图（旧版作品未存 refImages）→ 不清空当前参考图，
     避免用户已有的参考素材被误删；@ 引用与当前参考图自然对应 */
  syncSettingsUI();
  persistPrefs();
  switchView('create');
  els.promptInput.focus();
}

/* ---------------- RayinAPI 接入设置 ---------------- */
function openApiModal() {
  els.apiBaseInput.value = rayinCfg().base || RAYIN_DEFAULT.base;
  els.apiKeyInput.value = rayinCfg().key || '';
  els.gptModelInput.value = rayinCfg().gptModel || RAYIN_DEFAULT.gptModel;
  if (els.bananaModelInput) els.bananaModelInput.value = rayinCfg().bananaModel || RAYIN_DEFAULT.bananaModel;
  els.apiHint.textContent = '密钥可留空（使用服务端默认 GPT-image 密钥），填写则用你自己的 key 覆盖。保存后即可在上方面板下拉切换模型。';
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
  /* 服务端已内置 GPT / Gemini 默认密钥，前端 key 留空即使用服务端默认值；
     用户也可填自己的 key 覆盖。base / 模型 ID 留空则用内置默认。
     关键：这里必须把 Key 真正写进云端 /docs/api（服务端 /generate 以库里的值为准），
     键名统一用 providers['__rayin__:<engine>'].key，避免再出现前端写 key、后端读不到。 */
  const key = els.apiKeyInput.value.trim();
  const base = normalizeBase(els.apiBaseInput.value) || RAYIN_DEFAULT.base;
  const gptModel = els.gptModelInput.value.trim() || RAYIN_DEFAULT.gptModel;
  const bananaModel = (els.bananaModelInput ? els.bananaModelInput.value.trim() : '') || RAYIN_DEFAULT.bananaModel;

  let prev = {};
  try { prev = loadJSON('anidream.api.v1', {}) || {}; } catch (err) { prev = {}; }
  const doc = Object.assign({}, prev);
  doc.base = base;
  doc.key = key || prev.key || '';
  doc.gptModel = gptModel;
  doc.bananaModel = bananaModel;
  doc.providers = Object.assign({}, prev.providers || {});
  const gid = '__rayin__:gpt-image';
  const bid = '__rayin__:banana';
  const prevG = doc.providers[gid] || {};
  const prevB = doc.providers[bid] || {};
  /* 留空表示「沿用已有密钥」，不要把库里已有的 Key 覆盖成空串 */
  doc.providers[gid] = Object.assign({}, prevG, {
    engine: 'gpt-image', model: gptModel, base: base, key: key || prevG.key || '',
  });
  doc.providers[bid] = Object.assign({}, prevB, {
    engine: 'banana', model: bananaModel, base: base, key: key || prevB.key || '',
  });
  doc.updatedAt = Date.now();

  state.api = Object.assign({}, prev, {
    base: base,
    key: doc.key,
    gptModel: gptModel,
    bananaModel: bananaModel,
    providers: doc.providers,
  });
  saveJSON(LS_API, state.api);
  syncEngineUI();
  closeApiModal();

  const push = window.HMSync && window.HMSync.pushApi;
  if (!push) {
    toast('已保存到本机；云同步模块未加载，刷新后可能丢失', 'error', 6000);
    return;
  }
  push(doc).then(function () {
    toast(key ? '接入信息已保存到云端 · 使用自定义密钥' : '接入信息已保存到云端', 'success');
  }).catch(function (err) {
    toast('本机已保存，云端保存失败：' + ((err && err.message) || '网络异常'), 'error', 6000);
  });
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

    if (gpt) els.gptModelInput.value = gpt;

    els.apiHint.textContent = '共 ' + ids.length + ' 个模型' +
      (gpt ? ' · GPT: ' + gpt : ' · 未找到 gpt-image');
    toast(ids.length ? '模型列表已读取' : '账号未返回模型列表', ids.length ? 'success' : 'info');
  } catch (err) {
    els.apiHint.textContent = '读取失败：' + (err.message || '网络错误') + '，请检查 Key 与 API 地址';
    toast('读取模型失败', 'error');
  } finally {
    els.fetchModelsBtn.disabled = false;
  }
}

/* ---------------- 事件绑定 ---------------- */
var DISABLED_VIEWS = {};

/* 参考主体：统一打开文件选择框。
 * 必须在用户手势里同步调用，中间不能有 await / 定时器 / 重渲染。
 * 优先 showPicker()（浏览器原生、响应更快），不支持或被拒再回退 click()。 */
var _refPickerAt = 0;
function openRefPicker() {
  if (!els.refInput) return;
  var now = Date.now();
  if (now - _refPickerAt < 700) return; /* 同一次手势里 pointerdown 与 click 都会到，只弹一次 */
  _refPickerAt = now;
  try { els.refInput.value = ''; } catch (e) {} /* 允许重复选择同一张图 */
  if (typeof els.refInput.showPicker === 'function') {
    try { els.refInput.showPicker(); return; } catch (e) { /* 手势失效/被策略拒绝 → 回退 */ }
  }
  try { els.refInput.click(); } catch (e) {}
}

function bindEvents() {
  document.addEventListener('click', function (event) {
    const viewBtn = event.target.closest('[data-view]');
    /* switchView 会把 data-view 写到 <body> 上，closest 会匹配到 body 本身，
       导致任意点击都重复触发一次 switchView（会重置视图内的 Tab/面板状态） */
    if (!viewBtn || viewBtn === document.body || viewBtn === document.documentElement) return;
    var view = viewBtn.dataset.view;
    if (DISABLED_VIEWS[view] || viewBtn.disabled) {
      var label = viewBtn.querySelector('span')?.textContent || view;
      HM.toast && HM.toast('「' + label + '」功能开发中，敬请期待', 'info');
      return;
    }
    switchView(view);
  });

  /* 顶栏「个人空间」：回到根桌面（之前被误加入置灰视图，点了没反应） */
  var personalBtn = document.querySelector('.hm-personal');
  if (personalBtn) {
    personalBtn.addEventListener('click', function () {
      if (window.HMDesk && window.HMDesk.goSpace) window.HMDesk.goSpace();
      switchView('create');
    });
  }

  if (els.modelsToggle) els.modelsToggle.addEventListener('click', openSidebar);
  els.sidebarScrim.addEventListener('click', closeSidebar);
  if (els.sidebarClose) els.sidebarClose.addEventListener('click', closeSidebar);

  if (els.refPickBtn) {
    els.refPickBtn.addEventListener('click', function () { openRefPicker(); });
  }

  if (els.promptTabs) {
    var pocketLongPressFired = false;
    els.promptTabs.addEventListener('click', function (event) {
      const addBtn = event.target.closest('#addPromptTab');
      if (addBtn) {
        addPromptTab();
        return;
      }
      if (pocketLongPressFired) { pocketLongPressFired = false; return; }
      const tab = event.target.closest('[data-tab]');
      if (tab) switchPromptTab(Number(tab.dataset.tab));
    });
    els.promptTabs.addEventListener('dblclick', function (event) {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        event.preventDefault();
        renamePromptTab(Number(tab.dataset.tab));
      }
    });

    /* 删除口袋：只在「焦点在口袋本身」时响应 Delete / Backspace。
       焦点在输入框/文本域/可编辑区时直接放行，绝不会抢走删字。 */
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      var tab = target && target.closest ? target.closest('.hm-tab[data-tab]') : null;
      if (!tab) return;
      event.preventDefault();
      var index = Number(tab.dataset.tab);
      deletePromptTab(index);
      requestAnimationFrame(function () {
        var active = els.promptTabs.querySelector('.hm-tab.is-active');
        if (active) active.focus();
      });
    });

    /* 无键盘场景（触屏 / 鼠标）：右键菜单或长按 600ms 删除 */
    function confirmDeletePocket(tab) {
      var index = Number(tab.dataset.tab);
      if (!window.confirm('删除口袋「' + promptTabLabel(index) + '」？')) return false;
      deletePromptTab(index);
      return true;
    }
    els.promptTabs.addEventListener('contextmenu', function (event) {
      var tab = event.target.closest('.hm-tab[data-tab]');
      if (!tab) return;
      event.preventDefault();
      confirmDeletePocket(tab);
    });
    var pocketPress = { timer: null, x: 0, y: 0 };
    els.promptTabs.addEventListener('pointerdown', function (event) {
      var tab = event.target.closest('.hm-tab[data-tab]');
      if (!tab || event.pointerType === 'mouse') return;
      pocketPress.x = event.clientX;
      pocketPress.y = event.clientY;
      if (pocketPress.timer) clearTimeout(pocketPress.timer);
      pocketPress.timer = setTimeout(function () {
        pocketPress.timer = null;
        pocketLongPressFired = true;
        confirmDeletePocket(tab);
      }, 600);
    });
    function cancelPocketPress() {
      if (pocketPress.timer) { clearTimeout(pocketPress.timer); pocketPress.timer = null; }
    }
    els.promptTabs.addEventListener('pointerup', cancelPocketPress);
    els.promptTabs.addEventListener('pointercancel', cancelPocketPress);
    els.promptTabs.addEventListener('pointerleave', cancelPocketPress);
    els.promptTabs.addEventListener('pointermove', function (event) {
      if (!pocketPress.timer) return;
      if (Math.abs(event.clientX - pocketPress.x) > 10 || Math.abs(event.clientY - pocketPress.y) > 10) {
        cancelPocketPress();
      }
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
    /* 弹窗内的点击常会触发重绘（如日历格子被整体替换），冒泡到 document 时
       event.target 已脱离 .hm-menu，closest() 会误判为“外部点击”而收起面板。
       这里用 composedPath()（派发瞬间固定的路径）判断，保证弹窗内操作不自动关闭。 */
    var inMenu = false;
    if (typeof event.composedPath === 'function') {
      inMenu = event.composedPath().some(function (n) {
        return n && n.classList && n.classList.contains('hm-menu');
      });
    }
    if (!inMenu && !(event.target.closest && event.target.closest('.hm-menu'))) closeAllMenus();
  });

  if (els.modelMenu) {
    els.modelMenu.addEventListener('click', function (event) {
      const vBtn = event.target.closest('[data-vmodel]');
      if (vBtn) {
        state.videoModel = vBtn.dataset.vmodel;
        persistPrefs();
        syncEngineUI();
        closeAllMenus();
        return;
      }
      const aBtn = event.target.closest('[data-amodel]');
      if (aBtn) {
        state.audioModel = aBtn.dataset.amodel;
        persistPrefs();
        syncEngineUI();
        closeAllMenus();
        return;
      }

      const loraBtn = event.target.closest('[data-lora]');
      if (loraBtn) {
        state.lora = loraBtn.dataset.lora || '';
        persistPrefs();
        syncEngineUI();
        return;
      }

      const btn = event.target.closest('[data-engine]');
      if (!btn || btn.dataset.engine !== 'gpt-image') return;
      if (btn.dataset.provider) state.providerId = btn.dataset.provider;
      if (btn.dataset.model) state.channelModel = btn.dataset.model;
      els.engineSelect.value = btn.dataset.engine;
      els.engineSelect.dispatchEvent(new Event('change'));
      closeAllMenus();
    });
  }

  els.engineSelect.addEventListener('change', function () {
    const value = els.engineSelect.value;
    /* FLUX 免费引擎已下线：渠道只认 GPT-image */
    if (value !== 'gpt-image') {
      els.engineSelect.value = 'gpt-image';
      state.engine = 'gpt-image';
      return;
    }
    state.engine = 'gpt-image';
    persistPrefs();
    syncEngineUI();

    /* gpt-image / banana 走服务端内置默认密钥，前端不填也能生成；
       仅免费额度平台(openai)需要用户自备密钥。
       切换语言模型/通道不再弹提示，避免每次切换都冒一条浮层。 */
  });

  els.apiConfigBtn.addEventListener('click', function () {
    // 标记目标顶 Tab：管理台的 onView 会据此直接渲染「API接入管理」面板，
    // 避免过去的 30ms 定时器与 onView 重置 Tab / 概览渲染之间的竞态。
    window.HM_ADMIN_TARGET = 'api';
    switchView('admin');
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

  /* 清掉浏览器自动填充/刷新恢复残留在搜索框里的文字（例如登录用户名 admin）。
     浏览器的回填可能发生在初始化之后，因此分多个时机清理；
     一旦用户自己敲过键盘，就不再清理，避免误删用户输入。 */
  function clearSearchRestore() {
    if (!els.modelSearch) return;
    if (els.modelSearch.dataset.userTyped === '1') return;
    if (els.modelSearch.value) els.modelSearch.value = '';
  }
  clearSearchRestore();
  window.addEventListener('pageshow', clearSearchRestore);
  window.addEventListener('load', function () {
    clearSearchRestore();
    setTimeout(clearSearchRestore, 300);
    setTimeout(clearSearchRestore, 1200);
  });
  els.modelSearch.addEventListener('keydown', function () {
    els.modelSearch.dataset.userTyped = '1';
  });
  els.modelSearch.addEventListener('focus', function () {
    clearSearchRestore();
    /* 浏览器也可能在获得焦点后才回填，补两次延迟清理 */
    setTimeout(clearSearchRestore, 60);
    setTimeout(clearSearchRestore, 300);
  });

  /* 输入框初始 readonly，浏览器不会对只读字段做自动填充；
     用户点击/聚焦时再解锁，保证正常输入 */
  function unlockSearch() {
    els.modelSearch.removeAttribute('readonly');
  }
  els.modelSearch.addEventListener('pointerdown', unlockSearch);
  els.modelSearch.addEventListener('focus', unlockSearch);
  els.modelSearch.addEventListener('input', function (event) {
    if (els.sidebar && els.sidebar.classList.contains('is-open')) {
      renderModels(event.target.value);
    }
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

  els.promptInput.addEventListener('input', function () {
    updateCharCount();
    scheduleComposerSave(); /* 提示词按桌面持久化 */
  });

  /* === refDrop 点击：只在空状态区域点击才打开文件选择；有素材后点击任何 cell 不会触发 ===
     pointerdown 阶段就打开（早于 click，避免后续 document 级 click 处理把弹窗拖慢），
     click 只做兜底（键盘/触屏等不走 pointerdown 的场景），openRefPicker 内部有 700ms 去重。 */
  if (els.refDrop) {
    els.refDrop.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      var target = event.target;
      if (!target || !target.closest) return;
      if (!target.closest('#refEmpty') && !target.closest('.hm-ref-add')) return;
      event.preventDefault(); /* 同一次手势不再走 click，避免二次触发/手势被吃掉 */
      openRefPicker();
    }, true);
  }
  if (els.refEmpty) {
    els.refEmpty.addEventListener('click', function () { openRefPicker(); });
    els.refEmpty.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault(); openRefPicker();
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

  /* === window 级别 drag/drop ===
   * HTML5 DnD 规则：dragover 必须持续 preventDefault() 浏览器才会派发 drop。
   * 注意：dragover 阶段 dataTransfer.files 是空的（浏览器安全限制，防止网页窥探），
   * 只有 drop 事件里才有 files —— 所以 dragover 里绝不能用 files.length 做守卫 return！ */
  var _lastDragOverRef = false;
  window.addEventListener('dragover', function (ev) {
    /* 只要有 dataTransfer（有拖拽正在进行）就 preventDefault */
    if (!ev.dataTransfer) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) {}
    /* 更新 refDrop is-over 视觉 */
    if (!els.refDrop) return;
    var rect = els.refDrop.getBoundingClientRect();
    /* 与桌面卡片拖拽保持同一 12px 容差 */
    var inside = ev.clientX >= rect.left - 12 && ev.clientX <= rect.right + 12 &&
                 ev.clientY >= rect.top - 12 && ev.clientY <= rect.bottom + 12;
    if (inside && !_lastDragOverRef) {
      els.refDrop.classList.add('is-over');
      _lastDragOverRef = true;
    } else if (!inside && _lastDragOverRef) {
      els.refDrop.classList.remove('is-over');
      _lastDragOverRef = false;
    }
  });

  window.addEventListener('dragleave', function (ev) {
    if (!els.refDrop) return;
    if (ev.clientX <= 0 || ev.clientY <= 0 ||
        ev.clientX >= window.innerWidth || ev.clientY >= window.innerHeight) {
      els.refDrop.classList.remove('is-over');
      _lastDragOverRef = false;
    }
  });

  window.addEventListener('drop', async function (ev) {
    if (!ev.dataTransfer) return;
    ev.preventDefault();
    var files = Array.from(ev.dataTransfer.files || []);
    if (!els.refDrop) return;
    var rect = els.refDrop.getBoundingClientRect();
    /* 放置区不在当前视图时（如「我的作品」页 #hmDock 是 display:none），rect 全为 0，
       以前会静默丢弃；这里明确提示，避免用户以为拖拽彻底坏了 */
    if (!rect.width || !rect.height) {
      var hasPayload = files.length > 0;
      try { hasPayload = hasPayload || !!ev.dataTransfer.getData('application/x-hm-work'); } catch (e) {}
      if (hasPayload) toast('参考主体只在创作台可用，请先回到创作台', 'info');
      els.refDrop.classList.remove('is-over');
      _lastDragOverRef = false;
      return;
    }
    /* 与桌面卡片拖拽保持同一 12px 容差 */
    var inside = ev.clientX >= rect.left - 12 && ev.clientX <= rect.right + 12 &&
                 ev.clientY >= rect.top - 12 && ev.clientY <= rect.bottom + 12;
    if (!inside) {
      els.refDrop.classList.remove('is-over');
      _lastDragOverRef = false;
      return;
    }
    els.refDrop.classList.remove('is-over');
    _lastDragOverRef = false;
    /* 桌面/作品图片拖入（HTML5 元素拖拽，dataTransfer 里没有 files）：
       取出作品 id → 走与手动上传同一条参考主体通路；其它元素拖拽直接忽略，不报错 */
    if (!files.length) {
      var raw = '';
      try {
        raw = ev.dataTransfer.getData('application/x-hm-work') || '';
        if (!raw) {
          var plain = ev.dataTransfer.getData('text/plain') || '';
          if (plain.indexOf('work:') === 0) raw = plain.slice(5);
        }
      } catch (e) {}
      if (!raw) return;
      if (window.HMRefDrop && typeof window.HMRefDrop.acceptWorkId === 'function') {
        await window.HMRefDrop.acceptWorkId(raw);
      }
      return;
    }
    /* 只保留图片 */
    var imgs = files.filter(function (f) {
      return /^image\/(png|jpe?g|webp)$/i.test(f.type || '');
    });
    if (!imgs.length) {
      toast('拖入的文件不是图片，请拖 PNG / JPG / WebP', 'error');
      return;
    }
    var remaining = REF_MAX_COUNT - currentRefs().length;
    for (var i = 0; i < Math.min(imgs.length, remaining); i++) {
      await pickRefFile(imgs[i]);
    }
    if (imgs.length > remaining) {
      toast('仅添加了前 ' + remaining + ' 张（已达上限 ' + REF_MAX_COUNT + '）', 'info');
    }
  });

  /* === 右侧工具条 === */
  if (els.refSelectBtn) els.refSelectBtn.addEventListener('click', function (ev) {
    ev.stopPropagation(); enterRefSelectMode();
  });
  /* 「全部删除」上锁：第一次点击只解锁，锁定状态下不删任何东西 */
  var _refClearUnlocked = false;
  var _refClearTimer = 0;
  function paintRefClearLock(unlocked) {
    if (!els.refClearBtn) return;
    els.refClearBtn.classList.toggle('is-unlocked', !!unlocked);
    els.refClearBtn.title = unlocked ? '已解锁，再点执行全部删除' : '全部删除（已锁定，点击解锁）';
    var span = els.refClearBtn.querySelector('span');
    var svg = els.refClearBtn.querySelector('svg');
    if (span) span.textContent = unlocked ? '再点删除' : '全部删除';
    if (svg) {
      svg.innerHTML = unlocked
        ? '<rect x="4" y="11" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
        : '<rect x="4" y="11" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    }
  }
  function refClearRelock() {
    _refClearUnlocked = false;
    if (_refClearTimer) { clearTimeout(_refClearTimer); _refClearTimer = 0; }
    paintRefClearLock(false);
  }
  paintRefClearLock(false);
  if (els.refClearBtn) {
    els.refClearBtn.addEventListener('mouseleave', refClearRelock);
    els.refClearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!currentRefs().length) return;
      /* 锁定状态：只解锁，不执行删除、不弹确认 */
      if (!_refClearUnlocked) {
        _refClearUnlocked = true;
        paintRefClearLock(true);
        toast('已解锁，再点一次执行全部删除', 'info');
        if (_refClearTimer) clearTimeout(_refClearTimer);
        _refClearTimer = setTimeout(refClearRelock, 5000);
        return;
      }
      clearRefImages();
      toast('已清空所有参考图', 'info');
      refClearRelock();
    });
  }

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

  /* === 全屏查看控制 === */
  if (els.refFsClose) els.refFsClose.addEventListener('click', closeRefFullscreen);
  /* 点击全屏背景（非图片/按钮区域）也能关闭 */
  if (els.refFullscreen) els.refFullscreen.addEventListener('click', function (ev) {
    if (ev.target === els.refFullscreen) closeRefFullscreen();
  });
  /* Esc 键关闭 */
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && els.refFullscreen && !els.refFullscreen.hidden) {
      closeRefFullscreen();
    }
  });
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
      v = Math.max(10, Math.min(22, Number(v) || 13));
      /* 富文本输入区（提示词框 + 全屏编辑器）共用 --hm-prompt-fs：
         只改隐藏 textarea 的话，可见的 contenteditable 不会变 —— 之前字号滑块「没反应」就是这个原因 */
      document.documentElement.style.setProperty('--hm-prompt-fs', v + 'px');
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
      /* 全屏编辑器里的隐藏 textarea 也跟随（富文本区由变量驱动） */
      var edInput = document.getElementById('promptEditorInput');
      if (edInput) {
        edInput.style.fontSize = v + 'px';
        edInput.style.lineHeight = lh;
      }
      if (fsLabel) fsLabel.textContent = String(v);
      syncRangeFill(fsSlider);
      updateSliderBtn();
    }
    fsSlider.addEventListener('input', function () {
      state.fontSize = Number(fsSlider.value);
      applyFontSize(state.fontSize);
      persistPrefs();
    });
    /* 初始化 */
    if (state.fontSize) fsSlider.value = String(state.fontSize);
    applyFontSize(state.fontSize || 13);

    /* Ctrl / ⌘ + 滚轮：在提示词框或全屏编辑器上调字号
       （普通滚轮保留给长文本滚动，不抢滚动） */
    var lastFontWheel = 0;
    function onFontWheel(event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      var now = Date.now();
      if (now - lastFontWheel < 90) return;
      lastFontWheel = now;
      var min = Number(fsSlider.min || 10);
      var max = Number(fsSlider.max || 22);
      var next = Number(fsSlider.value) + (event.deltaY < 0 ? 1 : -1);
      next = Math.max(min, Math.min(max, next));
      if (next === Number(fsSlider.value)) return;
      fsSlider.value = String(next);
      state.fontSize = next;
      applyFontSize(next);
      persistPrefs();
    }
    ['promptRich', 'promptEditorRich'].forEach(function (id) {
      var box = document.getElementById(id);
      if (box) box.addEventListener('wheel', onFontWheel, { passive: false });
    });
  }

  /* 参考主体强度 slider —— 每个 tab 独立（UI/预览同步走顶层 applyRefWeightUI） */
  var rwSlider = document.getElementById('refWeightSlider');
  if (rwSlider) {
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
    if (btn.dataset.scale === 'custom') {
      /* 切到自定义：用当前比例 + 当前档位像素预填 */
      const prev = currentSize();
      state.customW = prev.w;
      state.customH = prev.h;
    }
    state.scale = btn.dataset.scale;
    els.scalePicker.querySelectorAll('[data-scale]').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.scale === state.scale);
    });
    syncScaleChip();
    toggleCustomRow();
    updateRatioLabel();
    persistPrefs();
    renderRatios();
    /* 自定义档留在菜单里填宽高，其余档位点击即收起 */
    if (state.scale !== 'custom') closeAllMenus();
  });

  const customWInput = document.getElementById('customWInput');
  const customHInput = document.getElementById('customHInput');

  function clampSide(value) {
    return Math.max(64, Math.min(8192, Math.round(Number(value) || 0)));
  }

  function applyCustomPixels(from) {
    const ratio = currentRatio();
    const ar = ratio.w / ratio.h;
    let w;
    let h;
    if (from === 'h') {
      h = clampSide(customHInput.value);
      w = round8(h * ar);
      if (Math.abs(w / ar - h) > 8 && typeof toast === 'function') {
        toast('两者与当前比例冲突，已按长度为准换算为 ' + w + '×' + round8(w / ar), 'info');
      }
      h = round8(w / ar);
    } else {
      w = clampSide(customWInput.value);
      h = round8(w / ar);
    }
    if (w % 8 !== 0 && typeof toast === 'function') {
      toast('提示：长度 ' + w + ' 不是 8 的倍数，部分接口可能自动裁剪，建议使用 8 的倍数', 'info');
    }
    state.customW = w;
    state.customH = h;
    state.scale = 'custom';
    if (customWInput) customWInput.value = String(w);
    if (customHInput) customHInput.value = String(h);
    persistPrefs();
    renderRatios();
    els.scalePicker.querySelectorAll('[data-scale]').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.scale === state.scale);
    });
    syncScaleChip();
    toggleCustomRow();
    updateRatioLabel();
  }

  if (customWInput) {
    customWInput.addEventListener('change', function () { applyCustomPixels('w'); });
    customWInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') customWInput.blur(); });
  }
  if (customHInput) {
    customHInput.addEventListener('change', function () { applyCustomPixels('h'); });
    customHInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') customHInput.blur(); });
  }

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

  if (els.stepsRange) {
    els.stepsRange.addEventListener('input', function () {
      state.steps = Number(els.stepsRange.value);
      updateStepsUI();
      persistPrefs();
    });
  }

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

    if ((job.status === 'done' || job.status === 'error') && event.target.closest('.result-media')) openLightbox(job);
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
      else if (action === 'ref') {
        /* 复用 HMDesk 已导出的 useAsRef（上方 64102 已挂到 window.HMDesk） */
        if (window.HMDesk && typeof window.HMDesk.useAsRef === 'function') window.HMDesk.useAsRef(work);
      }
      else if (action === 'delete') {
        if (window.HMSync && window.HMSync.snapshotWorks) window.HMSync.snapshotWorks('delete-one');
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
    if (!window.confirm('确定清空全部作品吗？可从「设置 → 云同步 → 恢复本地备份」找回最近 3 次快照。')) return;
    if (window.HMSync && window.HMSync.snapshotWorks) window.HMSync.snapshotWorks('clear-all');
    state.works = [];
    saveWorks();
    renderWorks();
    toast('已清空作品', 'info');
    if (window.HMSync && window.HMSync.clearAll) window.HMSync.clearAll();
  });

  /* 顶栏时间筛选面板：事件全部绑定在面板/按钮内部，不新增全局监听 */
  tmBind();

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
  /* 返回 'auth' | 'network' | 'other'
     只有服务端明确否定凭证（401/403）才是 'auth'；
     5xx / 超时 / 断网 / 结构异常一律 'network'，保留 token 稍后重试。
     旧实现用 msg.indexOf('token') 宽泛匹配，500 文案里带 token 就会把用户踢下线。 */
  if (window.HMAuth && window.HMAuth.classify) return window.HMAuth.classify(err);
  if (!err) return 'other';
  var status = Number(err.status || err.statusCode || 0);
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500 || err.offline) return 'network';
  return 'other';
}

async function authBoot() {
  var token = (api && api.getToken) ? api.getToken() : '';
  /* token payload 兜底：hm.user 因配额没写进去时，也能还原「我是谁」，
     避免刷新后已登录却被当成未登录弹登录框。token 无 exp，失效与否只由服务端 401 判定。 */
  var tokenUser = (token && window.HMAuth && window.HMAuth.decodeToken)
    ? window.HMAuth.decodeToken(token)
    : null;
  console.log('[authBoot] token:', token ? '存在 (' + token.length + ' chars)' : '不存在！');

  /* 只有「没有 token 且解析不出用户」才算未登录；否则先按已登录渲染 */
  if (!token && !tokenUser) {
    window.HMApp = window.HMApp || {};
    window.HMApp.user = null;
    hideLogin();
    showLogin();
    return;
  }

  /* ========== Step 1: 同步渲染缓存桌面（零闪烁） ========== */
  var cachedUser = loadJSON('hm.user', null);
  if (!cachedUser && tokenUser) {
    cachedUser = tokenUser;
    try { saveJSON('hm.user', cachedUser); } catch (e) {}
  }
  var cachedKey = cachedUser && cachedUser.id ? worksLsKey(cachedUser.id) : LS_WORKS;
  var cachedBakKey = cachedUser && cachedUser.id ? worksBakLsKey(cachedUser.id) : LS_WORKS_BAK;
  var cachedWorks = loadJSON(cachedKey, null);
  /* 主缓存为空时尝试备份，避免一次误清就永久丢失 */
  if ((!cachedWorks || !cachedWorks.length)) {
    var bakWorks = loadJSON(cachedBakKey, null);
    if (bakWorks && bakWorks.length) {
      cachedWorks = bakWorks;
      saveJSON(cachedKey, bakWorks);
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
    /* 登录即见：本地有缓存才先渲染；本地为空时不渲染空列表，
       等云端快照 + 历史键认领合并完再统一渲染，避免"先空列表再刷出来"的闪跳 */
    if (state.works.length) {
      renderWorks();
      console.log('[authBoot] 已用缓存渲染桌面');
      /* 本地 JSON 里的原图存在 IndexedDB，异步补回后再渲染一次 */
      hydrateWorks().then(function (changed) { if (changed) renderWorks(); });
    } else {
      console.log('[authBoot] 本地无缓存，等云端快照就绪后再渲染');
    }
  } else {
    hideLogin(); /* 至少先隐藏登录弹窗，等 me() 返回再决定 */
  }

  /* ========== Step 2: 异步验证 token（只调 me()，不调 ping()） ==========
     直接试 /auth/me，更精准：只有 401/403 才是真的 token 失效
     网络问题（Render 休眠 / 断网）不影响缓存桌面 */
  /* 网络请求并发起步（启动提速）：
     - api.me() 与 api.listWorks() 互不依赖（服务端都从 token 解析 uid）→ 同时发；
     - HMDesk.pullNow() 依赖 me 的 uid（desk 键按 uid 取，内部还有 deskUid 守卫）→ 必须等 me。 */
  var meP = (api && typeof api.me === 'function') ? api.me() : Promise.reject(new Error('api 未就绪'));
  /* 旧 /works 列表会把全部内联图一起返回（>6MB），SCF 函数 URL 网关会直接断连，
     浏览器报 CORS/ERR_FAILED。作品统一走 /user-data/bootstrap（已瘦身），
     这里不再发这条注定失败的请求。 */
  var worksP = Promise.resolve(null);
  try {
    var me = await meP;
    console.log('[authBoot] me() 成功:', me.user.username);
    window.HMApp.user = me.user;
    try { saveJSON('hm.user', me.user); } catch (e) {}
    /* 先用 token 里的用户信息立刻渲染右上角账号，
       不必等后面的作品/桌面加载完成（网络慢时会有几秒空白） */
    updateUserUI();
    /* 换账号/刷新后清掉搜索框残留文字（例如浏览器自动填充的 admin） */
    if (typeof window.HMResetSearchBox === 'function') { try { window.HMResetSearchBox(); } catch (e) {} }

    /* 若 me() 返回的用户与缓存用户不同（换号登录），重新加载该用户的本地作品 */
    var confirmedKey = worksLsKey(me.user.id);
    var confirmedBakKey = worksBakLsKey(me.user.id);
    if (!cachedUser || cachedUser.id !== me.user.id) {
      /* 事故修复：不再「某个 key 为空就赋 []」。
         取本地全部候选来源（用户键 / 备份 / 时间戳快照 / 历史键名）与内存的并集；
         取不到时保持 state.works 原样，交给后面的云端结果合并，绝不主动清空。 */
      var localAll = (window.HMSync && window.HMSync.collectLocalWorks)
        ? window.HMSync.collectLocalWorks(me.user.id)
        : mergeWorks([], [loadJSON(confirmedKey, null), loadJSON(confirmedBakKey, null), loadJSON(LS_WORKS, null)]);
      var memWorks = Array.isArray(state.works) ? state.works : [];
      var userWorks = mergeWorks(localAll, memWorks);
      if (userWorks.length) {
        state.works = userWorks.slice(0, MAX_WORKS);
        saveJSON(confirmedKey, state.works.map(function (w) {
          if (w.url && w.url.indexOf('data:') === 0) { idbPutBlob(w.id, w.url); return Object.assign({}, w, { url: '', blob: true }); }
          return w;
        }));
        console.log('[authBoot] 本地作品并集加载完成', state.works.length, '张');
      } else if (memWorks.length) {
        state.works = memWorks.slice(0, MAX_WORKS);
      }
    }

    /* 从后端拉最新作品（不能覆盖本地：服务端可能因重启丢数据） */
    var serverItems = [];
    try {
      /* 该请求已在上面与 me() 并发发出，这里通常已就绪，只需取结果 */
      var data = await worksP;
      if (data && Array.isArray(data.items)) {
        serverItems = data.items;
        state.works = mergeWorks(data.items, state.works);
      }
    } catch (e) { /* listWorks 失败不影响登录态 */ }

    await hydrateWorks();

    /* ===== 登录即见（顺序固定，不能颠倒）=====
       1) 云端作品快照已合并进 state.works（上面 listWorks）
       2) 云端桌面布局快照拉回（pullNow，必须在 me 之后、渲染之前）
       3) 本 origin 历史键认领（HMClaim）挪到首屏渲染后的空闲回调里执行
       4) 合并结果推回云端（syncAllWorksToServer）
       拉取失败只打日志，不影响登录态。 */
    try {
      if (window.HMDesk && typeof window.HMDesk.pullNow === 'function') await window.HMDesk.pullNow();
    } catch (e) { console.warn('[authBoot] 云端桌面拉取失败（忽略）:', e && e.message); }

    /* 启动时把本地缺失的作品（含 base64）上传到服务端，
       Render 重启清空 data/ 后自动恢复，换设备也能看到 */
    syncAllWorksToServer(serverItems);

    if (state.works.length || !localStorage.getItem(confirmedKey) || localStorage.getItem(confirmedKey) === '[]') {
      saveJSON(confirmedKey, state.works.map(function (w) {
        if (w.url && w.url.indexOf('data:') === 0) { idbPutBlob(w.id, w.url); return Object.assign({}, w, { url: '', blob: true }); }
        return w;
      }));
    } else {
      console.warn('[authBoot] 本次结果为空但本地已有作品，跳过回写，避免清空');
    }

    hideLogin();
    updateUserUI();
    renderWorks();
    /* 用户确认后，让桌面模块按当前用户 ID 重新对齐服务端数据
       （解决 desk.js init() 时 window.HMApp.user 尚未就绪、用了访客 key 的问题） */
    if (window.HMDesk) {
      if (typeof window.HMDesk.reloadForUser === 'function') window.HMDesk.reloadForUser();
      else if (typeof window.HMDesk.sync === 'function') window.HMDesk.sync();
    }

    /* ===== 历史键认领：首屏渲染之后再跑 =====
       HMClaim 是纯本地逻辑，但要同步 JSON.parse 本机全部作品（含 base64），
       放首屏之后用空闲回调执行，避免阻塞首屏；失败只打日志，不影响登录。 */
    var runClaim = function () {
      try {
        if (!window.HMClaim || typeof window.HMClaim.run !== 'function') return;
        window.HMClaim.run().then(function (claimRes) {
          if (claimRes && (claimRes.works || claimRes.desk || claimRes.keys)) {
            console.log('[authBoot] 历史键认领结果:', claimRes);
            return hydrateWorks().then(function (changed) { if (changed) renderWorks(); });
          }
        }).catch(function (e) {
          console.warn('[authBoot] 历史键认领失败（不影响登录）:', e && e.message);
        });
      } catch (e) {
        console.warn('[authBoot] 历史键认领失败（不影响登录）:', e && e.message);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runClaim, { timeout: 2500 });
    } else {
      setTimeout(runClaim, 800);
    }
  } catch (err) {
    console.warn('[authBoot] me() 失败:', err && err.message, 'status:', err && err.status);

    var kind = classifyAuthErr(err);
    console.warn('[authBoot] 错误分类:', kind);

    if (kind === 'auth') {
      /* 只有「账号确实处于待审批 / 已拒绝」才清 token 回登录页。
         线上复现：账号记录缺 status 时服务端返回 403 ACCOUNT_UNDEFINED，
         旧逻辑看到文案里有「审批」就登出 → 每次刷新都要重新登录。 */
      var blocked = (window.HMAuth && window.HMAuth.isAccountBlocked)
        ? window.HMAuth.isAccountBlocked(err)
        : /等待超级管理员审批|注册申请已被拒绝/.test(err.message || '');
      if (err && err.status === 403 && blocked) {
        toast(err.message, 'warn', 8000);
        window.HMApp.user = null;
        try { api.logout(); } catch (e) {}
        showLogin();
        return;
      }

      /* 其它 403：账号数据异常（如 ACCOUNT_UNDEFINED、账号记录缺 status），
         属于服务端问题，不能因此清空登录态；保留 token 与桌面并给出明确提示。 */
      if (err && err.status === 403) {
        console.error('[authBoot] 403 非审批拦截，保留登录态:', err.code || '(no code)', err.message);
        toast('账号数据异常（' + (err.code || 'HTTP 403') + '）：服务端账号记录不完整。已保持登录，请联系管理员把账号库迁到 MySQL。', 'warn', 12000);
        try { if (window.HMStorageNotice && window.HMStorageNotice.refresh) window.HMStorageNotice.refresh(); } catch (e) {}
        return;
      }
      /* ========== 明确的 401：唯一的自动登出路径 ==========
         401 只可能来自「签名不符 / token 缺失或无效」（token 无 exp，
         Render 重启不会让签名失效）。此时清 token 并提示重新登录；
         作品按 userId 存在本地，重新登录同一账号即可恢复，不会丢数据。 */
      if (err && err.status === 401) {
        console.warn('[authBoot] me() 返回 401，token 已失效，清理登录态（本地作品保留）');
        toast('登录状态已失效，请重新登录（本地作品已保留）', 'warn', 8000);
        window.HMApp.user = null;
        try { api.logout(); } catch (e) {}
        showLogin();
        return;
      }

      /* 其余 403（非审批）：保留缓存桌面，让用户手动重新登录 */
      console.warn('[authBoot] me() 返回 auth 错误，但不清缓存，保持桌面');
      if (!cachedUser) {
        /* 真的没任何缓存 → 只能弹登录。
           关键：不调 api.logout() 清 token！
           401 可能只是 Render 冷启动/瞬时错误，token 也许仍有效；
           即使真失效，用户重新登录成功后 setToken 会自动覆盖旧 token。
           一旦清掉 token，用户的作品/桌面数据（按 userId 隔离的 localStorage key）
           就无法被关联恢复，是"刷新后数据全没了"的根因。 */
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
    } else {
      /* 有缓存用户：哪怕后端暂时连不上，也先把账号信息显示出来 */
      updateUserUI();
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
          saveJSON(worksLsKey(), state.works.map(function (w) {
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

/* ===================== 版本更新提示（轻量轮询） ===================== */
/* 用 HEAD 比对 ETag / Last-Modified / Content-Length，不下载 5MB 整页；
   服务器不支持 HEAD 时退回 Range: bytes=0-0，只读响应头。 */
var UPDATE_POLL_MS = 60000;    /* 前台轮询间隔（60 秒；原来 2 秒会持续占用带宽/主线程） */
var UPDATE_IDLE_MS = 10000;    /* 10 秒无操作自动消失 */
var updateState = {
  baselineFp: '',   /* 首次探测到的指纹，作为「已加载版本」基准 */
  pendingFp: '',    /* 疑似新版本的指纹（待二次确认） */
  remoteFp: '',     /* 已确认的新版本指纹 */
  dismissedFp: '',  /* 已关闭/刷新过的指纹，同一版本不再反复弹 */
  timer: null,
  idleTimer: null,
  wired: false,
  bound: false
};

function updateProbeUrl(tag) {
  var u = location.origin + location.pathname;
  return u + (u.indexOf('?') < 0 ? '?' : '&') + 'hm_poll=' + Date.now() + (tag || '');
}

function updateFpOf(res) {
  if (!res || !res.headers) return '';
  var etag = res.headers.get('ETag') || '';
  var lm = res.headers.get('Last-Modified') || '';
  var len = res.headers.get('Content-Length') || '';
  return (etag || lm || len) ? (etag + '|' + lm + '|' + len) : '';
}

function probeUpdate() {
  fetch(updateProbeUrl(), {
    method: 'HEAD',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
  }).then(function (res) {
    var fp = updateFpOf(res);
    if (fp) return fp;
    throw new Error('no-validators');
  }).catch(function () {
    /* HEAD 被拒或没有校验头：改用 Range 只取首字节 */
    return fetch(updateProbeUrl('&r=1'), {
      cache: 'no-store',
      headers: { 'Range': 'bytes=0-0', 'Cache-Control': 'no-cache, no-store' }
    }).then(function (res) { return updateFpOf(res); }).catch(function () { return ''; });
  }).then(function (fp) {
    if (fp && !document.hidden) handleFp(fp);
  });
}

function handleFp(fp) {
  if (!updateState.baselineFp) {
    updateState.baselineFp = fp;
    return;
  }
  if (fp === updateState.baselineFp) {
    updateState.pendingFp = '';
    return;
  }
  if (fp === updateState.dismissedFp) return;
  if (fp === updateState.pendingFp) {
    /* 连续两次探测一致才认定有新版本 */
    updateState.remoteFp = fp;
    updateState.dismissedFp = fp;   /* 同一版本不再反复弹（关闭后也生效） */
    updateState.pendingFp = '';
    showUpdateModal();
    return;
  }
  updateState.pendingFp = fp;
  /* 400ms 后快速复检，避免 CDN 节点抖动误报 */
  setTimeout(function () { if (!document.hidden) probeUpdate(); }, 400);
}

/* 10 秒无操作自动淡出：鼠标移动/点击/滚轮/键盘/touch 都算操作并重置计时 */
var UPDATE_ACTIVITY_EVENTS = ['mousemove', 'pointerdown', 'click', 'wheel', 'keydown', 'touchstart', 'scroll'];

function updateActivity() {
  if (updateState.idleTimer) clearTimeout(updateState.idleTimer);
  updateState.idleTimer = setTimeout(function () { hideUpdateModal(false); }, UPDATE_IDLE_MS);
}

function bindUpdateAutoHide() {
  if (updateState.bound) { updateActivity(); return; }
  updateState.bound = true;
  UPDATE_ACTIVITY_EVENTS.forEach(function (name) {
    window.addEventListener(name, updateActivity, { passive: true });
  });
  updateActivity();
}

function unbindUpdateAutoHide() {
  if (!updateState.bound) return;
  updateState.bound = false;
  UPDATE_ACTIVITY_EVENTS.forEach(function (name) {
    window.removeEventListener(name, updateActivity, { passive: true });
  });
  if (updateState.idleTimer) { clearTimeout(updateState.idleTimer); updateState.idleTimer = null; }
}

function wireUpdateModal() {
  if (updateState.wired) return;
  updateState.wired = true;
  var close = document.getElementById('updateClose');
  var confirmBtn = document.getElementById('updateConfirm');
  if (close) close.addEventListener('click', function () { hideUpdateModal(true); });
  if (confirmBtn) confirmBtn.addEventListener('click', function () {
    try {
      localStorage.setItem('hm.build', window.HM_BUILD || '');
      localStorage.removeItem('hm.build.remindAt');
    } catch (e) {}
    hideUpdateModal(true);
    toast('正在更新页面…', 'success');
    /* 带版本参数强制绕过 HTML 的 10 分钟 CDN/浏览器缓存，确保拿到刚发布的新页面；
       副作用是这次刷新会重新下载整包一次 */
    var v = String(Date.now());
    var base = location.pathname + location.search.replace(/([?&])hm_v=[^&]*&?/g, '$1').replace(/[?&]$/, '');
    setTimeout(function () {
      location.replace(base + (base.indexOf('?') < 0 ? '?' : '&') + 'hm_v=' + v);
    }, 300);
  });
}

function showUpdateModal() {
  var modal = document.getElementById('updateModal');
  if (!modal || !modal.hidden) return;
  wireUpdateModal();
  modal.classList.remove('is-hiding');
  modal.hidden = false;
  /* 不冻结页面滚动！这是右下角通知卡片，不是全屏模态 */
  bindUpdateAutoHide();
}

function hideUpdateModal(fast) {
  var modal = document.getElementById('updateModal');
  if (!modal || modal.hidden) return;
  /* 同一版本不再反复弹：记住当前远端指纹 */
  updateState.dismissedFp = updateState.remoteFp || updateState.pendingFp || updateState.baselineFp;
  unbindUpdateAutoHide();
  modal.classList.add('is-hiding');
  setTimeout(function () {
    modal.hidden = true;
    modal.classList.remove('is-hiding');
  }, fast ? 180 : 320);
}

function startUpdatePolling() {
  if (updateState.timer) clearInterval(updateState.timer);
  updateState.timer = null;
  if (document.hidden) return;
  updateState.timer = setInterval(probeUpdate, UPDATE_POLL_MS);
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
      showUpdateModal();
    }

    /* 首次探测延后到 window load 之后：启动阶段带宽要留给 5MB 主包，
       不要在解析/首屏时发 HEAD；之后再按 60 秒轮询。后台暂停，回到前台立即检测。 */
    var kickUpdate = function () {
      setTimeout(function () {
        if (document.hidden) return;
        probeUpdate();
        startUpdatePolling();
      }, 800);
    };
    if (document.readyState === 'complete') kickUpdate();
    else window.addEventListener('load', kickUpdate, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (updateState.timer) { clearInterval(updateState.timer); updateState.timer = null; }
      } else {
        probeUpdate();
        startUpdatePolling();
      }
    });
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
  /* 本地存储迁移：先写入 IndexedDB 并逐条读回校验，成功后才压缩 localStorage；
     任何一步失败都保留旧 JSON。完成后补回图片再渲染，35 件作品都能打开/放大。 */
  try { migrateComposerToIdb(); } catch (e) {}
  migrateWorksToIdb().then(function (moved) {
    return hydrateWorks().then(function (changed) {
      if (moved || changed) {
        renderWorks();
        if (window.HMDesk && HMDesk.renderDesktop) HMDesk.renderDesktop();
      }
    });
  }).catch(function (err) { console.warn('[storage] 迁移失败，已保留旧数据：', err); });
  syncSettingsUI();
  bindEvents();
  initResizer();
  bindRefAutocomplete(); /* ← @ 自动补全 */
  bindPromptOverlayEvents(); /* ← overlay chip 视觉化 */
  renderRef();          /* ← 每个 tab 独立的 refs 渲染 */
  renderCatalogMenus(); /* ← 免费模型 / LoRA 风格列表（先用内置兜底） */

  /* 恢复当前桌面（个人空间或上次停留的文件夹）上次的提示词与参考图；随刷新保留 */
  try {
    var bootFolder = window.HMDesk && window.HMDesk.getActiveFolder ? window.HMDesk.getActiveFolder() : null;
    _composerKey = composerKeyOf(bootFolder);
    applyComposer(readComposerStore()[_composerKey] || null);
  } catch (err) {
    console.warn('[composer] 启动恢复失败，已忽略：', err);
  }
  window.addEventListener('beforeunload', function () { saveComposer(); });

  if (window.HMUI && window.HMUI.init) window.HMUI.init();

  /* 认证引导与后端探测并行：不再等 ping 完成（冷启动时 ping 最长 6 秒），
     登录框立刻可用；后端探测完成后异步拉取模型目录 */
  authBoot();
  api.ping().then(function () {
    loadCatalog();      /* ← 后端在线时拉取完整免费模型目录 */
  });

  /* 版本更新检测（不影响登录态） */
  checkUpdate();

  // 首次打开时给出轻量引导提示
  if (!storedPrefs || !storedPrefs.modelId) {
    setTimeout(function () {
      toast('已接入 GPT-image · 选风格即可开始', 'success');
    }, 800);
  }
}

boot();

/* 供 ui.js（V3 工作台）复用核心状态与能力。
   注意：boot() 内的 authBoot() 已同步把缓存用户写入 window.HMApp.user，
   这里整体重赋值会把它冲掉 → desk.js 的 getDeskLsKey() 会回退到访客 key，
   导致刷新后用户专属文件夹读不到。必须把已有 user 保留下来。 */
var _hmPrevUser = window.HMApp && window.HMApp.user;
window.HMApp = {
  state: state,
  els: els,
  user: _hmPrevUser,
  ENGINE_META: ENGINE_META,
  switchView: switchView,
  toast: toast,
  renderWorks: renderWorks,
  saveWorks: saveWorks,
  idbDelBlob: idbDelBlob,
  mergeWorks: mergeWorks,
  hydrateWorks: hydrateWorks,
  worksLsKey: worksLsKey,
  renderRef: renderRef,
  translatePrompt: translatePrompt,
  syncSettingsUI: syncSettingsUI,
  persistPrefs: persistPrefs,
  updateCharCount: updateCharCount,
  currentSize: currentSize,
  modeModelLabel: modeModelLabel,
  currentModelLabel: currentModelLabel,
  getModel: getModel,
  reuseJob: reuseJob,
  retryWork: retryWork,
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
  formatDuration: formatDuration,
  jobInfo: jobInfo,
  createLoadingCard: createLoadingCard,
  markJobDone: markJobDone,
  markJobError: markJobError,
  downloadImage: downloadImage,
  proxyMediaUrl: proxyMediaUrl,
  fetchImageBlob: fetchImageBlob,
  fileNameFor: fileNameFor,
  openLightbox: openLightbox,
  errorText: errorText,
  buildPrompt: buildPrompt,
  uid: uid,
  randomSeed: randomSeed,
  esc: esc
};

/* ============================================================
 * 导演台 HMDirector（Canvas 合成版）
 * - Canvas 实时合成预览（支持视频/图片、多轨道层级）
 * - 逐帧步进、按住前后按钮连续播放
 * - 轨道时间轴、胶片条缩略图、可拖拽播放头
 * ============================================================ */
window.HMDirector = (function () {
  var TRACK_COLORS = ['#4f8cff', '#52c41a', '#faad14', '#ff5c7a', '#722ed1', '#13c2c2', '#fa541c', '#2f54eb'];
  var PX_PER_SEC = 60;
  var IMG_DEFAULT_DUR = 5;   // 图片默认时长（秒）

  var tracks = [];           // [{id,name,color,clips:[{id,url,name,type,start,duration,trackStart,mediaEl}]}]
  var currentTime = 0;
  var fps = 30;
  var isPlaying = false;
  var totalDuration = 0;
  var activeClip = null;
  var generatingStrip = false;
  var canvasDirty = true;     // 画布是否需要重绘
  var lastDrawnTime = -1;     // 上次绘制的时间戳，避免重复绘制同一帧
  var stripClipId = null;     // 已生成胶片缩略图的片段ID，避免重复生成

  var el = {};
  var canvas = null, ctx = null;
  var stripCtx = null;
  var rafId = null;
  var lastTs = 0;
  var holdTimer = null;       // 按住前后帧的连续步进定时器
  var selectedClipId = null;  // 当前选中的片段ID（用于预览区缩放/移动）
  var selHandle = null;       // 当前拖动的缩放手柄 'tl'|'tr'|'bl'|'br'|'move'|null

  function $(id) { return document.getElementById(id); }

  function init() {
    canvas = $('dirCanvas');
    ctx = canvas.getContext('2d');
    el.stage = $('dirStage');
    el.empty = $('dirEmpty');
    el.playBtn = $('dirPlayBtn');
    el.playIcon = $('dirPlayIcon');
    el.prevFrame = $('dirPrevFrame');
    el.nextFrame = $('dirNextFrame');
    el.curTime = $('dirCurTime');
    el.durTime = $('dirDurTime');
    el.fpsSel = $('dirFps');
    el.stripCanvas = $('dirStripCanvas');
    el.stripRuler = $('dirStripRuler');
    el.playhead = $('dirPlayhead');
    el.filmstrip = $('dirFilmstrip');
    el.trackList = $('dirTrackList');
    el.trackRuler = $('dirTrackRuler');
    el.trackTimeLabel = $('dirTrackTimeLabel');
    el.importBtn = $('dirImportBtn');
    el.fileInput = $('dirFileInput');
    el.addTrackBtn = $('dirAddTrackBtn');
    el.exportBtn = $('dirExportBtn');
    stripCtx = el.stripCanvas.getContext('2d');

    // 自适应 canvas 尺寸
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    addTrack(); addTrack(); addTrack();

    el.importBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', onFileImport);
    el.addTrackBtn.addEventListener('click', addTrack);
    el.exportBtn.addEventListener('click', exportComposite);
    el.playBtn.addEventListener('click', togglePlay);
    el.fpsSel.addEventListener('change', function () { fps = parseInt(el.fpsSel.value, 10); el.durTime.textContent = formatTime(totalDuration); canvasDirty = true; });

    // 按住前后帧连续步进
    bindHoldButton(el.prevFrame, -1);
    bindHoldButton(el.nextFrame, 1);

    bindFilmstripDrag();
    bindCanvasInteraction();
    document.addEventListener('keydown', onKeyDown);

    startRenderLoop();
  }

  function resizeCanvas() {
    var rect = el.stage.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      // 舞台尚未布局完成，下一帧重试
      requestAnimationFrame(resizeCanvas);
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    var newW = Math.max(1, Math.floor(rect.width * dpr));
    var newH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      canvasDirty = true;
    }
  }

  /* ---------- 轨道 / 片段 ---------- */
  function addTrack() {
    var idx = tracks.length;
    tracks.push({
      id: 't' + Date.now() + '_' + idx,
      name: '轨道 ' + (idx + 1),
      color: TRACK_COLORS[idx % TRACK_COLORS.length],
      clips: []
    });
    renderTracks();
  }

  function isImageFile(f) { return /^image\//.test(f.type); }
  function isVideoFile(f) { return /^video\//.test(f.type); }

  function onFileImport(e) {
    var files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(function (f) {
      if (!isImageFile(f) && !isVideoFile(f)) return;
      var url = URL.createObjectURL(f);
      var type = isImageFile(f) ? 'image' : 'video';
      var clip = {
        id: 'c' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        url: url, name: f.name, type: type,
        start: 0, duration: type === 'image' ? IMG_DEFAULT_DUR : 0,
        trackStart: 0, trackId: null, mediaEl: null,
        scale: 1, offsetX: 0, offsetY: 0
      };
      if (type === 'video') {
        var probe = document.createElement('video');
        probe.preload = 'metadata'; probe.src = url;
        probe.addEventListener('loadedmetadata', function () {
          clip.duration = probe.duration || 5;
          probe = null;
          placeClip(clip);
        });
      } else {
        var img = new Image();
        img.onload = function () { placeClip(clip); };
        img.src = url;
      }
    });
    e.target.value = '';
  }

  function placeClip(clip) {
    // 放到第一条空轨道，否则放轨道0末尾
    var track = tracks.find(function (t) { return t.clips.length === 0; }) || tracks[0];
    if (!track) { addTrack(); track = tracks[tracks.length - 1]; }
    clip.trackStart = track.clips.reduce(function (m, c) {
      return Math.max(m, c.trackStart + c.duration);
    }, 0);
    clip.trackId = track.id;
    clip.mediaEl = createClipMedia(clip);
    track.clips.push(clip);
    recomputeTotalDuration();
    renderTracks();
    renderTrackRuler();
    stripClipId = null; // 新片段加入，需重新生成胶片
    if (!activeClip) updateComposite();
    renderFilmstrip();
    canvasDirty = true;
  }

  function createClipMedia(clip) {
    if (clip.type === 'image') {
      var img = new Image();
      img.src = clip.url;
      return img;
    }
    var v = document.createElement('video');
    v.preload = 'auto'; v.muted = true; v.playsInline = true;
    v.src = clip.url;
    v.crossOrigin = 'anonymous';
    // seek/数据加载完成后标记画布脏，确保拖动预览时帧能实时刷新
    v.addEventListener('seeked', function () { canvasDirty = true; });
    v.addEventListener('loadeddata', function () { canvasDirty = true; });
    return v;
  }

  function removeClip(clipId) {
    tracks.forEach(function (t) {
      t.clips = t.clips.filter(function (c) {
        if (c.id === clipId) { try { URL.revokeObjectURL(c.url); } catch (e) {} return false; }
        return true;
      });
    });
    recomputeTotalDuration();
    renderTracks(); renderTrackRuler();
    stripClipId = null;
    canvasDirty = true;
    updateComposite();
    renderFilmstrip();
  }

  function recomputeTotalDuration() {
    var max = 0;
    tracks.forEach(function (t) {
      t.clips.forEach(function (c) { max = Math.max(max, c.trackStart + c.duration); });
    });
    totalDuration = max;
    el.durTime.textContent = formatTime(totalDuration);
  }

  /* ---------- 渲染轨道 ---------- */
  function renderTracks() {
    el.trackList.innerHTML = '';
    var laneW = Math.max(totalDuration * PX_PER_SEC, 600);
    tracks.forEach(function (track) {
      var row = document.createElement('div');
      row.className = 'hm-dir-track';
      var label = document.createElement('div');
      label.className = 'hm-dir-track-label';
      label.innerHTML = '<b style="color:' + track.color + '">' + track.name + '</b>'
        + '<span>' + track.clips.length + ' 片段</span>';
      row.appendChild(label);

      var lane = document.createElement('div');
      lane.className = 'hm-dir-track-lane';
      lane.style.minWidth = laneW + 'px';

      track.clips.forEach(function (clip) {
        var c = document.createElement('div');
        c.className = 'hm-dir-clip';
        c.style.left = (clip.trackStart * PX_PER_SEC) + 'px';
        c.style.width = Math.max(clip.duration * PX_PER_SEC, 24) + 'px';
        c.style.background = (clip.type === 'image' ? '#2a3142' : track.color) + 'dd';
        c.dataset.clipId = clip.id;
        if (clip.id === selectedClipId) c.style.outline = '2px solid #ff5c7a';
        c.innerHTML = '<div class="hm-dir-clip-name">' + (clip.type === 'image' ? '🖼 ' : '🎬 ') + clip.name + '</div>'
          + '<div class="hm-dir-clip-handle-l" data-resize="l"></div>'
          + '<div class="hm-dir-clip-handle-r" data-resize="r"></div>';
        bindClipDrag(c, clip);
        lane.appendChild(c);
      });
      row.appendChild(lane);
      el.trackList.appendChild(row);
    });
  }

  function renderTrackRuler() {
    el.trackRuler.innerHTML = '';
    el.trackRuler.style.width = Math.max(totalDuration * PX_PER_SEC, 600) + 'px';
    var step = 1;
    if (totalDuration > 60) step = 5;
    if (totalDuration > 300) step = 30;
    for (var t = 0; t <= totalDuration + 0.001; t += step) {
      var x = t * PX_PER_SEC;
      var line = document.createElement('i');
      line.style.left = x + 'px';
      el.trackRuler.appendChild(line);
      if (t < totalDuration) {
        var sp = document.createElement('span');
        sp.textContent = formatTimeShort(t);
        sp.style.left = x + 'px';
        el.trackRuler.appendChild(sp);
      }
    }
  }

  /* ---------- 片段拖拽 ---------- */
  function bindClipDrag(cEl, clip) {
    var startX, startY, origTrackStart, origWidth, origStart, origDur, mode;
    cEl.addEventListener('mousedown', function (e) {
      var resize = e.target.getAttribute('data-resize');
      mode = resize || 'move';
      startX = e.clientX;
      startY = e.clientY;
      origTrackStart = clip.trackStart;
      origWidth = clip.duration * PX_PER_SEC;
      origStart = clip.start;
      origDur = clip.duration;
      // 选中该片段
      selectClip(clip.id);
      e.preventDefault(); e.stopPropagation();

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (mode === 'move') {
          // 水平：调整时间位置
          clip.trackStart = Math.max(0, origTrackStart + dx / PX_PER_SEC);
          cEl.style.left = (clip.trackStart * PX_PER_SEC) + 'px';
          // 垂直：拖动到其他轨道
          var trackRows = el.trackList.querySelectorAll('.hm-dir-track');
          for (var i = 0; i < trackRows.length; i++) {
            var r = trackRows[i].getBoundingClientRect();
            if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
              if (tracks[i] && clip.trackId !== tracks[i].id) {
                var origTrack = tracks.find(function (t) { return t.id === clip.trackId; });
                if (origTrack) origTrack.clips = origTrack.clips.filter(function (c) { return c.id !== clip.id; });
                tracks[i].clips.push(clip);
                clip.trackId = tracks[i].id;
                var newLane = trackRows[i].querySelector('.hm-dir-track-lane');
                if (newLane) newLane.appendChild(cEl);
              }
              break;
            }
          }
        } else if (mode === 'r') {
          var newW = Math.max(24, origWidth + dx);
          clip.duration = Math.max(0.1, newW / PX_PER_SEC);
          cEl.style.width = (clip.duration * PX_PER_SEC) + 'px';
        } else if (mode === 'l') {
          var delta = dx / PX_PER_SEC;
          var newStart = Math.max(0, origTrackStart + delta);
          var newDur = (origTrackStart + origDur) - newStart;
          if (newDur > 0.1) {
            clip.trackStart = newStart;
            clip.duration = newDur;
            cEl.style.left = (clip.trackStart * PX_PER_SEC) + 'px';
            cEl.style.width = (clip.duration * PX_PER_SEC) + 'px';
          }
        }
        recomputeTotalDuration();
        renderTrackRuler();
        updateComposite();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        renderTracks();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    cEl.addEventListener('dblclick', function (e) {
      if (e.target.getAttribute('data-resize')) return;
      if (confirm('删除片段 "' + clip.name + '" ?')) removeClip(clip.id);
    });
  }

  /* 选中片段（用于预览区缩放/移动） */
  function selectClip(clipId) {
    selectedClipId = clipId;
    canvasDirty = true;
    // 更新轨道高亮
    var nodes = el.trackList.querySelectorAll('.hm-dir-clip');
    nodes.forEach(function (n) {
      if (n.dataset.clipId === clipId) n.style.outline = '2px solid #ff5c7a';
      else n.style.outline = '';
    });
  }

  function getSelectedClip() {
    if (!selectedClipId) return null;
    for (var i = 0; i < tracks.length; i++) {
      for (var j = 0; j < tracks[i].clips.length; j++) {
        if (tracks[i].clips[j].id === selectedClipId) return tracks[i].clips[j];
      }
    }
    return null;
  }

  /* ---------- 合成：按层级找当前时间的片段（底层→顶层） ---------- */
  function findClipsAt(time) {
    // 轨道列表中越靠上的行（index 越小）图层越靠上；绘制时先画底层(index大)后画顶层(index小)
    var result = [];
    for (var i = 0; i < tracks.length; i++) {
      for (var j = 0; j < tracks[i].clips.length; j++) {
        var c = tracks[i].clips[j];
        if (time >= c.trackStart - 0.001 && time <= c.trackStart + c.duration + 0.001) {
          result.push({ clip: c, track: tracks[i], index: i });
        }
      }
    }
    // index 降序 = 从底到顶（index 大的先画在底层，index 小的后画在上层）
    result.sort(function (a, b) { return b.index - a.index; });
    return result;
  }

  function findTopClipAt(time) {
    var list = findClipsAt(time);
    return list.length ? list[list.length - 1] : null;
  }

  /* ---------- 实时渲染循环 ---------- */
  function startRenderLoop() {
    function loop(ts) {
      rafId = requestAnimationFrame(loop);
      var dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;

      if (isPlaying) {
        var top = findTopClipAt(currentTime);
        if (top) {
          var c = top.clip;
          if (c !== activeClip) {
            if (activeClip && activeClip.type === 'video' && activeClip.mediaEl) activeClip.mediaEl.pause();
            activeClip = c;
            if (c.type === 'video' && c.mediaEl) {
              c.mediaEl.currentTime = (currentTime - c.trackStart) + c.start;
              c.mediaEl.play().catch(function () {});
            }
          }
          if (c.type === 'video' && c.mediaEl) {
            // 用视频实际播放时间同步 currentTime
            var t = c.trackStart + (c.mediaEl.currentTime - c.start);
            if (t >= c.trackStart + c.duration - 0.02) {
              // 片段结束，跳到下一帧找新片段
              currentTime = c.trackStart + c.duration;
              activeClip = null;
            } else {
              currentTime = t;
            }
          } else {
            currentTime += dt;
            if (currentTime >= c.trackStart + c.duration) {
              currentTime = c.trackStart + c.duration;
              activeClip = null;
            }
          }
        } else {
          // 当前时间无片段，尝试往后找
          var next = findNextClipStart(currentTime);
          if (next != null) currentTime = next;
          else { pause(); }
        }
        if (currentTime > totalDuration) { currentTime = totalDuration; pause(); }
      }

      drawCompositedFrame();
      updatePlayhead();
      el.curTime.textContent = formatTime(currentTime);
      el.trackTimeLabel.textContent = formatTime(currentTime);
    }
    rafId = requestAnimationFrame(loop);
  }

  function findNextClipStart(from) {
    var best = Infinity;
    tracks.forEach(function (t) {
      t.clips.forEach(function (c) {
        if (c.trackStart >= from - 0.001 && c.trackStart < best) best = c.trackStart;
      });
    });
    return best === Infinity ? null : best;
  }

  /* 把所有覆盖 currentTime 的片段从底到顶画到 canvas */
  function drawCompositedFrame() {
    var w = canvas.width, h = canvas.height;
    if (w < 2 || h < 2) return; // 画布未就绪
    var clips = findClipsAt(currentTime);
    // 工程中有片段就立刻隐藏空状态层，避免它覆盖画布造成"帧消失"
    var hasAnyClip = tracks.some(function (t) { return t.clips.length > 0; });
    if (hasAnyClip) el.empty.hidden = true;
    if (clips.length === 0) {
      if (!hasAnyClip) {
        if (!el.empty.hidden) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        el.empty.hidden = false;
        lastDrawnTime = currentTime;
        return;
      }
      // 当前时间无片段但工程中有片段：保留上一帧
      return;
    }
    // 时间未变且无需重绘，跳过以避免闪烁
    if (!canvasDirty && Math.abs(currentTime - lastDrawnTime) < 0.001) return;
    // 关键：先用 getClipDrawRect 真实探测每个片段能否画出，收集可绘制项
    // （不能只看 readyState，因为 seek 时状态可能在检查与绘制之间变化）
    var drawList = [];
    var selRect = null;
    for (var i = 0; i < clips.length; i++) {
      var r = getClipDrawRect(clips[i].clip, w, h);
      if (r) {
        drawList.push({ clip: clips[i].clip, rect: r });
        if (clips[i].clip.id === selectedClipId) selRect = r;
      }
    }
    // 没有任何片段能画出来 → 保留上一帧，绝不清屏（否则会出现黑屏）
    if (drawList.length === 0) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    for (var k = 0; k < drawList.length; k++) {
      try { ctx.drawImage(drawList[k].clip.mediaEl, drawList[k].rect.x, drawList[k].rect.y, drawList[k].rect.w, drawList[k].rect.h); } catch (e) { /* 跨域等 */ }
    }
    // 绘制选中片段的缩放框与手柄
    if (selRect) {
      ctx.save();
      ctx.strokeStyle = '#ff5c7a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(selRect.x, selRect.y, selRect.w, selRect.h);
      ctx.setLineDash([]);
      var hs = 10;
      ctx.fillStyle = '#ff5c7a';
      var corners = [
        [selRect.x, selRect.y], [selRect.x + selRect.w, selRect.y],
        [selRect.x, selRect.y + selRect.h], [selRect.x + selRect.w, selRect.y + selRect.h]
      ];
      corners.forEach(function (p) {
        ctx.fillRect(p[0] - hs / 2, p[1] - hs / 2, hs, hs);
      });
      ctx.restore();
    }
    lastDrawnTime = currentTime;
    canvasDirty = false;
  }

  /* 计算片段在画布上的绘制矩形（含 scale/offset 变换） */
  function getClipDrawRect(clip, cw, ch) {
    var iw, ih;
    if (clip.type === 'image') {
      if (!clip.mediaEl || !clip.mediaEl.complete || !clip.mediaEl.naturalWidth) return null;
      iw = clip.mediaEl.naturalWidth; ih = clip.mediaEl.naturalHeight;
    } else {
      // 要求 readyState >= 3 (HAVE_FUTURE_DATA)：确保当前帧已完整解码
      // readyState=2 (HAVE_CURRENT_DATA) 在快速 seek 时可能只有部分数据，drawImage 会画出黑色
      if (!clip.mediaEl || clip.mediaEl.readyState < 3) return null;
      iw = clip.mediaEl.videoWidth; ih = clip.mediaEl.videoHeight;
    }
    if (!iw || !ih) return null;
    // 图片默认 cover 填满，视频默认 contain 留黑边
    var baseScale = clip.type === 'image' ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
    var tw = iw * baseScale, th = ih * baseScale;
    var s = clip.scale || 1;
    tw *= s; th *= s;
    var tx = (cw - tw) / 2 + (clip.offsetX || 0);
    var ty = (ch - th) / 2 + (clip.offsetY || 0);
    return { x: tx, y: ty, w: tw, h: th };
  }

  function drawClip(clip, cw, ch) {
    var rect = getClipDrawRect(clip, cw, ch);
    if (!rect) return;
    try { ctx.drawImage(clip.mediaEl, rect.x, rect.y, rect.w, rect.h); } catch (e) { /* 跨域等 */ }
  }

  /* object-fit: cover 式绘制（裁剪填满） */
  function drawCover(img, dx, dy, dw, dh) {
    var iw = img.naturalWidth || img.videoWidth;
    var ih = img.naturalHeight || img.videoHeight;
    if (!iw || !ih) return;
    var scale = Math.max(dw / iw, dh / ih);
    var sw = dw / scale, sh = dh / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /* object-fit: contain 式绘制（保持原始比例，黑边留白） */
  function drawContain(img, dx, dy, dw, dh) {
    var iw = img.naturalWidth || img.videoWidth;
    var ih = img.naturalHeight || img.videoHeight;
    if (!iw || !ih) return;
    var scale = Math.min(dw / iw, dh / ih);
    var tw = iw * scale, th = ih * scale;
    var tx = dx + (dw - tw) / 2, ty = dy + (dh - th) / 2;
    ctx.drawImage(img, tx, ty, tw, th);
  }

  /* ---------- 播放控制 ---------- */
  function togglePlay() { if (isPlaying) pause(); else play(); }

  function play() {
    if (totalDuration <= 0) return;
    // 若当前无片段，跳到第一个
    if (!findTopClipAt(currentTime)) {
      var first = findNextClipStart(0);
      if (first == null) return;
      currentTime = first;
    }
    isPlaying = true;
    activeClip = null; // 强制重新选择片段并播放
    canvasDirty = true;
    el.playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';
  }

  function pause() {
    isPlaying = false;
    el.playIcon.innerHTML = '<path d="M8 5v14l11-7L8 5Z" fill="currentColor"/>';
    if (activeClip && activeClip.type === 'video' && activeClip.mediaEl) {
      activeClip.mediaEl.pause();
    }
    activeClip = null;
  }

  function stepFrame(dir) {
    pause();
    currentTime = Math.max(0, Math.min(totalDuration, currentTime + dir * (1 / fps)));
    seekActiveMedia();
    canvasDirty = true;
  }

  /* 让当前顶层视频片段的 mediaEl 定位到 currentTime */
  function seekActiveMedia() {
    var top = findTopClipAt(currentTime);
    if (top && top.clip.type === 'video' && top.clip.mediaEl) {
      var local = (currentTime - top.clip.trackStart) + top.clip.start;
      try { top.clip.mediaEl.currentTime = Math.min(local, top.clip.duration - 0.01); } catch (e) {}
    }
  }

  function seek(time) {
    pause();
    currentTime = Math.max(0, Math.min(totalDuration, time));
    seekActiveMedia();
    canvasDirty = true;
  }

  /* 按住按钮连续步进 */
  function bindHoldButton(btn, dir) {
    var intervalId = null;
    function start() {
      stepFrame(dir);
      // 300ms 后开始连续步进
      intervalId = setInterval(function () { stepFrame(dir); }, 1000 / fps);
    }
    function stop() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); start(); });
    btn.addEventListener('mouseup', stop);
    btn.addEventListener('mouseleave', stop);
    btn.addEventListener('touchstart', function (e) { e.preventDefault(); start(); }, { passive: false });
    btn.addEventListener('touchend', stop);
  }

  /* ---------- updateComposite（保留供外部调用） ---------- */
  function updateComposite() {
    seekActiveMedia();
    drawCompositedFrame();
  }

  /* ---------- 胶片条与播放头 ---------- */
  function updatePlayhead() {
    var pct = totalDuration > 0 ? (currentTime / totalDuration) : 0;
    el.playhead.style.left = (pct * 100) + '%';
  }

  function bindFilmstripDrag() {
    var dragging = false;
    function seekFromEvent(e) {
      var rect = el.filmstrip.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      seek(pct * totalDuration);
    }
    el.filmstrip.addEventListener('mousedown', function (e) { dragging = true; seekFromEvent(e); });
    document.addEventListener('mousemove', function (e) { if (dragging) seekFromEvent(e); });
    document.addEventListener('mouseup', function () { dragging = false; });
    el.filmstrip.addEventListener('touchstart', function (e) { dragging = true; seekFromEvent(e); }, { passive: true });
    el.filmstrip.addEventListener('touchmove', function (e) { if (dragging) seekFromEvent(e); }, { passive: true });
    el.filmstrip.addEventListener('touchend', function () { dragging = false; });
  }

  /* 预览区画布交互：选中片段后可拖动角点缩放、拖动中心移动 */
  function bindCanvasInteraction() {
    var startX, startY, origScale, origOffX, origOffY;
    function canvasPos(e) {
      var rect = canvas.getBoundingClientRect();
      var cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      var cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      return { x: cx, y: cy };
    }
    function hitHandle(rect, p) {
      var hs = 12;
      var corners = {
        tl: [rect.x, rect.y], tr: [rect.x + rect.w, rect.y],
        bl: [rect.x, rect.y + rect.h], br: [rect.x + rect.w, rect.y + rect.h]
      };
      for (var k in corners) {
        var c = corners[k];
        if (Math.abs(p.x - c[0]) <= hs && Math.abs(p.y - c[1]) <= hs) return k;
      }
      if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return 'move';
      return null;
    }
    canvas.addEventListener('mousedown', function (e) {
      var clip = getSelectedClip();
      if (!clip) return;
      var rect = getClipDrawRect(clip, canvas.width, canvas.height);
      if (!rect) return;
      var p = canvasPos(e);
      var hit = hitHandle(rect, p);
      if (!hit) return;
      selHandle = hit;
      startX = e.clientX; startY = e.clientY;
      origScale = clip.scale || 1;
      origOffX = clip.offsetX || 0;
      origOffY = clip.offsetY || 0;
      e.preventDefault();
      function onMove(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (selHandle === 'move') {
          clip.offsetX = origOffX + dx * (canvas.width / canvas.getBoundingClientRect().width);
          clip.offsetY = origOffY + dy * (canvas.height / canvas.getBoundingClientRect().height);
        } else {
          // 角点缩放：以中心为基准，按距离变化比例缩放
          var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
          var origDist = Math.hypot((rect.x + rect.w / 2) - (selHandle === 'tl' || selHandle === 'bl' ? rect.x : rect.x + rect.w),
                                    (selHandle === 'tl' || selHandle === 'tr' ? rect.y : rect.y + rect.h) - cy);
          var newRect = { x: rect.x + (selHandle === 'tl' || selHandle === 'bl' ? dx : 0),
                          y: rect.y + (selHandle === 'tl' || selHandle === 'tr' ? dy : 0),
                          w: rect.w + (selHandle === 'tl' || selHandle === 'bl' ? -dx : dx),
                          h: rect.h + (selHandle === 'tl' || selHandle === 'tr' ? -dy : dy) };
          var newDist = Math.hypot(newRect.w / 2, newRect.h / 2);
          var ratio = newDist / (Math.hypot(rect.w / 2, rect.h / 2) || 1);
          clip.scale = Math.max(0.1, origScale * ratio);
        }
        canvasDirty = true;
      }
      function onUp() {
        selHandle = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function renderFilmstrip() {
    if (generatingStrip) return;
    var w = el.stripCanvas.clientWidth, h = el.stripCanvas.clientHeight;
    if (w === 0 || h === 0) { requestAnimationFrame(renderFilmstrip); return; }
    var dpr = window.devicePixelRatio || 1;
    var newW = w * dpr, newH = h * dpr;
    // 尺寸未变则不重置画布，避免闪烁
    if (el.stripCanvas.width !== newW || el.stripCanvas.height !== newH) {
      el.stripCanvas.width = newW;
      el.stripCanvas.height = newH;
      stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var srcClip = null;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].clips.length) { srcClip = tracks[i].clips[0]; break; }
    }
    if (!srcClip || srcClip.type !== 'video') { drawStripRuler(w, h); return; }
    // 同一片段已生成过缩略图则跳过，避免重复生成导致闪烁
    if (stripClipId === srcClip.id) { drawStripRuler(w, h); return; }
    stripClipId = srcClip.id;
    generatingStrip = true;
    stripCtx.fillStyle = '#0a0d14';
    stripCtx.fillRect(0, 0, w, h);
    generateStripThumbs(srcClip, w, h);
  }

  function generateStripThumbs(clip, w, h) {
    var thumbW = Math.floor(h * (16 / 9));
    var count = Math.max(1, Math.floor(w / thumbW));
    var v = document.createElement('video');
    v.preload = 'auto'; v.muted = true; v.src = clip.url;
    var idx = 0;
    v.addEventListener('loadedmetadata', function () { next(); });
    function next() {
      if (idx >= count) { drawStripRuler(w, h); generatingStrip = false; return; }
      var t = (idx / count) * clip.duration;
      v.currentTime = Math.min(t, clip.duration - 0.05);
    }
    v.addEventListener('seeked', function () {
      try { stripCtx.drawImage(v, idx * thumbW, 0, thumbW, h); } catch (e) {}
      idx++;
      setTimeout(next, 30);
    });
  }

  function drawStripRuler(w, h) {
    el.stripRuler.innerHTML = '';
    var step = totalDuration > 300 ? 30 : (totalDuration > 60 ? 5 : 1);
    for (var t = 0; t <= totalDuration + 0.001; t += step) {
      var x = (t / totalDuration) * w;
      if (x > w) break;
      var sp = document.createElement('span');
      sp.textContent = formatTimeShort(t);
      sp.style.left = x + 'px';
      el.stripRuler.appendChild(sp);
    }
  }

  /* ---------- 键盘 ---------- */
  function onKeyDown(e) {
    if (document.body.dataset.view !== 'director') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
  }

  /* ---------- 工具 ---------- */
  function formatTime(sec) {
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    var fr = Math.floor((sec - Math.floor(sec)) * fps);
    if (fr >= fps) fr = fps - 1;
    return pad(m) + ':' + pad(s) + ':' + pad(fr);
  }
  function formatTimeShort(sec) {
    sec = Math.max(0, sec);
    return pad(Math.floor(sec / 60)) + ':' + pad(Math.floor(sec % 60));
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function exportComposite() {
    if (tracks.every(function (t) { return t.clips.length === 0; })) {
      alert('请先导入视频或图片片段'); return;
    }
    alert('导出功能开发中。当前可在预览区查看多轨道合成效果。');
  }

  /* ---------- 对外 ---------- */
  function onEnter() {
    // 等待页面过渡动画完成后再测量尺寸，避免获取到 0 尺寸
    requestAnimationFrame(function () {
      resizeCanvas();
      renderTracks();
      renderTrackRuler();
      canvasDirty = true;
      updateComposite();
      renderFilmstrip();
    });
  }

  return {
    init: init, onEnter: onEnter,
    play: play, pause: pause,
    prevFrame: function () { stepFrame(-1); },
    nextFrame: function () { stepFrame(1); },
    seek: seek, addTrack: addTrack,
    renderFilmstrip: renderFilmstrip
  };
})();
