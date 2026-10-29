// 免费模型目录（从 Express 版 catalog.js 原样移植）
export const KEYLESS = [
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

export const PROVIDERS = [
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

export const LORAS = [
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

export function findProvider(id) {
  return PROVIDERS.find((item) => item.id === id) || null;
}

export function findLora(id) {
  return LORAS.find((item) => item.id === id) || null;
}

export function findKeyless(id) {
  return KEYLESS.find((item) => item.id === id) || null;
}
