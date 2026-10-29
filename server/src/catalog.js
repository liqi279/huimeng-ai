'use strict';

/* =============================================================
 * 免费模型目录
 * 1) KEYLESS：免密钥通道（Pollinations 匿名通道，当前仅放行 sana）
 * 2) PROVIDERS：免费额度平台（OpenAI 兼容 /images/generations）
 * 3) LORAS：动漫 LoRA / 风格包（提示词注入，可叠加到任意通道）
 * ============================================================= */

const KEYLESS = [
  {
    id: 'sana',
    engine: 'flux',
    model: 'sana',
    name: 'SANA 动漫',
    badge: '免密钥',
    hint: '免费 · 秒级出图',
    desc: 'Pollinations 免费通道，无需任何密钥，适合快速出草图。',
  },
];

/* 免费额度平台：注册即送额度，接口与 OpenAI /images/generations 兼容。
 * sizeMode 决定尺寸参数写法：
 *   image_size → { image_size: "1024x1024" }（硅基流动）
 *   size       → { size: "1024x1024" }（OpenAI / 魔搭）
 *   wh         → { width, height }（Together） */
const PROVIDERS = [
  {
    id: 'siliconflow',
    name: '硅基流动',
    base: 'https://api.siliconflow.cn/v1',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    sizeMode: 'image_size',
    free: true,
    models: [
      {
        id: 'Kwai-Kolors/Kolors',
        name: 'Kolors 中文动漫',
        badge: '免费',
        hint: '中文提示词理解强 · 国风动漫',
      },
      {
        id: 'black-forest-labs/FLUX.1-schnell',
        name: 'FLUX.1 schnell',
        badge: '免费',
        hint: '免费额度 · 4 步快速出图',
      },
    ],
  },
  {
    id: 'modelscope',
    name: '魔搭 ModelScope',
    base: 'https://api-inference.modelscope.cn/v1',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
    sizeMode: 'size',
    free: true,
    models: [
      {
        id: 'AI-ModelScope/FLUX.1-dev',
        name: 'FLUX.1-dev',
        badge: '免费额度',
        hint: '画质高 · 每日免费额度',
      },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    base: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    sizeMode: 'wh',
    free: true,
    models: [
      {
        id: 'black-forest-labs/FLUX.1-schnell-Free',
        name: 'FLUX.1 schnell Free',
        badge: '免费',
        hint: '官方免费模型 · 生成快',
      },
    ],
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
  LORAS,
  findProvider,
  findLora,
  findKeyless,
};
