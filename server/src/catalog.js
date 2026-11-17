'use strict';

/* =============================================================
 * 免费模型目录（2026-11-15 已按需求清空）
 * 全部走 runFlux → https://image.pollinations.ai/prompt/{prompt}
 * 实测 2026-10-30 沙箱代理下可通（HTTP 200 + content-type: image/jpeg）
 * ============================================================= */

/* KEYLESS（Pollinations 免费通道）
 * 2026-11-15 按需求清空：FLUX Anime / Kolors / SANA / FLUX.1 / FLUX Realism 下线。
 * findKeyless() 仍可安全调用（返回 null）。 */
const KEYLESS = [];

/* PROVIDERS（免费额度平台）
 * 2026-11-15 按需求清空：设置页只保留 RayinAPI / LoRA / 免密钥通道。
 * 结构保留为空数组，findProvider() 仍可安全调用（返回 null）。 */
const PROVIDERS = [];

/* RayinAI 代理 —— 两套 key，各 3 个图像模型（2026-10-30 从 API 拉取确认）
 *
 * Key 1 (OPENAI_KEY) —— GPT 图像模型，走 engine='gpt-image'
 *   → /images/generations（不支持 chat/completions）
 *
 * Key 2 (GEMINI_KEY) —— Gemini 图像模型，走 engine='banana'
 *   → /chat/completions（返回 markdown ![image](data:...base64,...)）
 *
 * 每个 entry: model 字段是传给 RayinAI 的真实 ID
 *            engine 字段决定后端走哪条生成链路 */
const RAYIN_MODELS = [
  /* ============ GPT 图像模型（Key 1 · OpenAI） ============ */
  {
    id: 'gpt-image-2',
    engine: 'gpt-image',
    keyGroup: 'openai',
    model: 'gpt-image-2',
    name: 'GPT Image 2',
    badge: 'GPT · 标准',
    hint: '稳定通用 · OpenAI 原生生图',
    desc: 'OpenAI 官方 GPT Image 2，稳定可靠，适合通用生图场景。',
    tags: ['GPT', 'OpenAI', '标准'],
  },
  {
    id: 'gpt-image-2.5-flare',
    engine: 'gpt-image',
    keyGroup: 'openai',
    model: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    badge: 'GPT · 光影增强',
    hint: '光影绚丽 · 氛围渲染',
    desc: 'GPT Image 2.5 Flare 光影增强版，擅长逆光、光效和氛围渲染。',
    tags: ['GPT', 'Flare', '光影'],
  },
  {
    id: 'gpt-image-2.5-sunburst',
    engine: 'gpt-image',
    keyGroup: 'openai',
    model: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    badge: 'GPT · 细节爆发',
    hint: '高细节 · 锐度爆发',
    desc: 'GPT Image 2.5 Sunburst 细节增强版，画面锐利、纹理丰富。',
    tags: ['GPT', 'Sunburst', '细节'],
  },
  {
    id: 'gpt-image-2.6-flare',
    engine: 'gpt-image',
    keyGroup: 'openai',
    model: 'gpt-image-2.6-flare',
    name: 'GPT Image 2.6 Flare',
    badge: 'GPT · 2.6 光影',
    hint: '新一代光影 · 氛围渲染',
    desc: 'GPT Image 2.6 Flare 光影增强版，新一代模型，擅长逆光与氛围渲染。',
    tags: ['GPT', 'Flare', '2.6'],
  },
  {
    id: 'gpt-image-2.6-sunburst',
    engine: 'gpt-image',
    keyGroup: 'openai',
    model: 'gpt-image-2.6-sunburst',
    name: 'GPT Image 2.6 Sunburst',
    badge: 'GPT · 2.6 细节',
    hint: '新一代高细节 · 锐度爆发',
    desc: 'GPT Image 2.6 Sunburst 细节增强版，新一代模型，纹理更丰富。',
    tags: ['GPT', 'Sunburst', '2.6'],
  },
];

/* 动漫 LoRA 风格包：把 LoRA 触发词写进提示词，兼容所有通道 */
const LORAS = [
  {
    id: 'cel-anime',
    name: '赛璐璐番剧',
    tag: 'LoRA · 番剧质感',
    prompt: 'anime screencap, TV anime key visual, cel shading, clean crisp lineart, flat colors, detailed eyes',
    negative: 'photographic, realistic, 3d render, blurry, low quality',
  },
  {
    id: 'kyoani-soft',
    name: '京阿尼柔光',
    tag: 'LoRA · 柔和光影',
    prompt: 'kyoto animation style, soft diffused lighting, delicate highlights, expressive detailed eyes, gentle atmosphere',
    negative: 'harsh contrast, noisy, western cartoon, 3d render',
  },
  {
    id: 'shinkai-sky',
    name: '新海诚天空',
    tag: 'LoRA · 逆光天空',
    prompt: 'makoto shinkai style, dramatic cumulus sky, lens flare, vivid saturated colors, glowing backlight, cinematic anime',
    negative: 'flat lighting, dull colors, grainy, low resolution',
  },
  {
    id: 'ghibli-hand',
    name: '吉卜力手绘',
    tag: 'LoRA · 水彩手绘',
    prompt: 'studio ghibli style, hand drawn animation, watercolor background, warm natural lighting, nostalgic gentle mood',
    negative: '3d render, photorealistic, sharp digital lines',
  },
  {
    id: 'thick-paint',
    name: '厚涂插画',
    tag: 'LoRA · 厚涂笔触',
    prompt: 'thick paint anime illustration, impasto brush strokes, painterly rendering, dramatic rim light, rich color depth',
    negative: 'flat colors, clean lineart, vector art, low detail',
  },
  {
    id: 'retro-90s',
    name: '90s 赛璐璐',
    tag: 'LoRA · 复古胶片',
    prompt: '1990s anime screenshot, retro cel animation, film grain, VHS color bleed, vintage television look',
    negative: 'modern digital art, 3d, clean hd, sharp focus',
  },
  {
    id: 'chibi-sticker',
    name: 'Q版贴纸',
    tag: 'LoRA · 盲盒潮玩',
    prompt: 'chibi character, thick outline sticker style, pastel macaron colors, big glossy eyes, white plain background',
    negative: 'realistic proportions, complex background, dark lighting',
  },
  {
    id: 'guofeng-anime',
    name: '国风动漫',
    tag: 'LoRA · 东方美学',
    prompt: 'chinese oriental anime illustration, hanfu costume, ink wash accents, gold ornament details, elegant oriental aesthetic',
    negative: 'modern streetwear, western fantasy, 3d render',
  },
];

function findProvider(id) {
  return PROVIDERS.find((item) => item.id === id) || null;
}

function findLora(id) {
  return LORAS.find((item) => item.id === id) || null;
}

function findKeyless(id) {
  return KEYLESS.find((item) => item.id === id) || null;
}

module.exports = {
  KEYLESS,
  PROVIDERS,
  RAYIN_MODELS,
  LORAS,
  findProvider,
  findLora,
  findKeyless,
};
