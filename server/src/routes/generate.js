'use strict';

const path = require('path');
const fsp = require('fs').promises;
const express = require('express');
const config = require('../config');
const store = require('../store');
const {
  jsonError,
  assert,
  wrap,
  normalizeBase,
  apiErrorText,
  fetchWithTimeout,
  fetchJson,
  readJsonResponse,
  dataUrlToBuffer,
  extFromMime,
  randomToken,
  randomSeed,
  sleep,
} = require('../http');

const router = express.Router();

const MAX_PROMPT_CHARS = 1800;
const MAX_REF_BYTES = 10 * 1024 * 1024;
const MAX_REF_COUNT = 3;
const IMAGE_TIMEOUT = 120000;
const VIDEO_TIMEOUT = 120000;
const AUDIO_TIMEOUT = 60000;

const RATIO_SIZE = {
  '1:1': [1024, 1024],
  '3:4': [768, 1024],
  '4:3': [1024, 768],
  '9:16': [768, 1344],
  '16:9': [1344, 768],
};

const FLUX_PRIMARY = 'https://image.pollinations.ai/prompt/';

function readPrompt(value, label = '提示词') {
  assert(typeof value === 'string' && value.trim().length > 0, 400, `请输入${label}`, `${label}不能为空`);
  const text = value.trim();
  assert(text.length <= MAX_PROMPT_CHARS, 400, `${label}过长`, `最多 ${MAX_PROMPT_CHARS} 字符`);
  return text;
}

function readCount(value) {
  if (value == null || value === '') return 1;
  const count = Number(value);
  assert(Number.isInteger(count) && count >= 1 && count <= 4, 400, '生成数量需为 1-4', 'count 取值范围 1 到 4');
  return count;
}

function readSteps(value) {
  if (value == null || value === '') return 8;
  const steps = Number(value);
  assert(Number.isInteger(steps) && steps >= 4 && steps <= 12, 400, '精细度需为 4-12', 'steps 取值范围 4 到 12');
  return steps;
}

function readSeed(value) {
  if (value == null || value === '') return 0;
  const seed = Number(value);
  assert(Number.isFinite(seed) && seed >= 0, 400, '种子需为非负数字');
  return Math.floor(seed);
}

function readRefImages(value) {
  if (value == null) return [];
  assert(Array.isArray(value), 400, '参考图格式不正确', 'refImages 需为 data URL 数组');
  assert(value.length <= MAX_REF_COUNT, 400, '参考图数量过多', `最多 ${MAX_REF_COUNT} 张参考图`);
  return value.map((item, index) => {
    assert(
      typeof item === 'string' && item.startsWith('data:'),
      400,
      `第 ${index + 1} 张参考图格式不正确`,
      '参考图需为 data URL',
    );
    const decoded = dataUrlToBuffer(item);
    assert(
      decoded.buffer.length <= MAX_REF_BYTES,
      413,
      `第 ${index + 1} 张参考图过大`,
      '单张参考图不能超过 10MB',
    );
    return {
      dataUrl: item,
      buffer: decoded.buffer,
      mime: decoded.mime || 'image/png',
      ext: extFromMime(decoded.mime) || 'png',
    };
  });
}

function resolveRayin(input) {
  const rayin = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    base: normalizeBase(rayin.base),
    key: typeof rayin.key === 'string' && rayin.key.trim() ? rayin.key.trim() : config.RAYIN_KEY,
    gptModel: typeof rayin.gptModel === 'string' && rayin.gptModel.trim() ? rayin.gptModel.trim() : config.GPT_MODEL,
    bananaModel: typeof rayin.bananaModel === 'string' && rayin.bananaModel.trim()
      ? rayin.bananaModel.trim()
      : config.BANANA_MODEL,
  };
}

function requireKey(key) {
  assert(key, 400, '未配置 RayinAPI Key', '在设置中填写 Key 或配置服务端 RAYIN_KEY');
}

function scaledImageSize(ratio, scale) {
  const base = RATIO_SIZE[ratio] || RATIO_SIZE['1:1'];
  const mult = scale === '4k' ? 4 : scale === '1k' ? 1 : 2;
  let width = base[0] * mult;
  let height = base[1] * mult;
  const longest = Math.max(width, height);
  if (longest > 2048) {
    const factor = 2048 / longest;
    width = Math.round(width * factor);
    height = Math.round(height * factor);
  }
  width = Math.max(64, Math.round(width / 8) * 8);
  height = Math.max(64, Math.round(height / 8) * 8);
  return { width, height };
}

function gptSize(ratio) {
  if (ratio === '1:1') return '1024x1024';
  if (ratio === '3:4' || ratio === '9:16') return '1024x1536';
  return '1536x1024';
}

function videoSize(ratio, resolution) {
  const longSide = resolution === '2k' ? 2048 : resolution === '1080p' ? 1920 : 1280;
  const base = RATIO_SIZE[ratio] || RATIO_SIZE['16:9'];
  const aspect = base[0] / base[1];
  let width;
  let height;
  if (aspect >= 1) {
    width = longSide;
    height = Math.round(longSide / aspect);
  } else {
    height = longSide;
    width = Math.round(longSide * aspect);
  }
  width = Math.max(256, Math.round(width / 8) * 8);
  height = Math.max(256, Math.round(height / 8) * 8);
  return { width, height };
}

async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/* 下载远端图片并保存到本地 media 目录，返回同源 URL（避免跨域 403 / 防盗链） */
async function saveRemoteImage(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') || url.startsWith('/uploads/')) return url;

  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: 'image/*' } }, 60000);
  } catch (err) {
    return url; /* 下载失败则保留原 URL，让前端尝试直连 */
  }
  if (!res.ok) return url;

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return url;

  const ext = extFromMime(contentType) || 'webp';
  const fileName = `${Date.now()}-${randomToken()}.${ext}`;
  try {
    await fsp.writeFile(path.join(store.dirs.media, fileName), buffer);
  } catch (err) {
    return url;
  }
  return `/uploads/media/${fileName}`;
}

async function runFlux(prompt, seed, width, height, steps) {
  const encoded = encodeURIComponent(String(prompt).slice(0, 900));
  const url = `${FLUX_PRIMARY}${encoded}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;
  /* Pollinations 直接返回图片，URL 本身即可访问；saveRemoteImage 会下载到本地 */
  return url;
}

function extractOpenAIImage(data) {
  const first = data && Array.isArray(data.data) ? data.data[0] : null;
  if (first) {
    if (typeof first.url === 'string' && first.url) return first.url;
    if (typeof first.b64_json === 'string' && first.b64_json) {
      return `data:image/png;base64,${first.b64_json}`;
    }
  }
  throw jsonError(502, '图片接口未返回图片', '请检查模型 ID 与账号权限');
}

async function generateGptImage({ base, key, model, prompt, size, ref }) {
  if (ref) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    const blob = new Blob([ref.buffer], { type: ref.mime || 'image/png' });
    form.append('image', blob, `reference.${ref.ext || 'png'}`);

    const res = await fetchWithTimeout(
      `${base}/images/edits`,
      { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
      IMAGE_TIMEOUT,
    );
    const data = await readJsonResponse(res, '请检查模型 ID、参考图与账号权限');
    return extractOpenAIImage(data);
  }

  const data = await fetchJson(
    `${base}/images/generations`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, n: 1, size }),
    },
    IMAGE_TIMEOUT,
    '请检查模型 ID 与账号权限',
  );
  return extractOpenAIImage(data);
}

function extractChatImage(message) {
  if (!message) return '';

  const content = message.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'image_url') {
        if (typeof part.image_url === 'string' && part.image_url) return part.image_url;
        if (part.image_url && typeof part.image_url.url === 'string' && part.image_url.url) {
          return part.image_url.url;
        }
      }
      if (typeof part.url === 'string' && part.url) return part.url;
    }
  }

  if (typeof content === 'string' && content) {
    const dataUrl = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrl) return dataUrl[0];
    const httpUrl = content.match(/https?:\/\/[^\s"'<>)\]]+/);
    if (httpUrl) return httpUrl[0];
  }

  if (Array.isArray(message.images) && message.images.length) {
    const first = message.images[0];
    if (typeof first === 'string' && first) return first;
    if (first && typeof first.url === 'string' && first.url) return first.url;
  }

  return '';
}

async function generateBanana({ base, key, model, prompt, ref }) {
  const content = ref
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: ref.dataUrl } },
      ]
    : prompt;

  const data = await fetchJson(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
    },
    IMAGE_TIMEOUT,
    '请检查模型 ID 与账号权限',
  );

  const message = data && data.choices && data.choices[0] ? data.choices[0].message : null;
  const url = extractChatImage(message);
  if (!url) throw jsonError(502, 'Nano Banana 未返回图片', '请检查模型 ID 与账号权限');
  return url;
}

async function generateImages(body) {
  const engine = ['flux', 'gpt-image', 'banana'].includes(body.engine) ? body.engine : 'flux';
  const prompt = readPrompt(body.prompt, '提示词');
  const ratio = RATIO_SIZE[body.ratio] ? body.ratio : '1:1';
  const scale = ['1k', '2k', '4k'].includes(body.scale) ? body.scale : '2k';
  const count = readCount(body.count);
  const steps = readSteps(body.steps);
  const seedInput = readSeed(body.seed);
  const refs = readRefImages(body.refImages);
  const rayin = resolveRayin(body.rayin);

  if (engine !== 'flux') requireKey(rayin.key);

  const { width, height } = scaledImageSize(ratio, scale);
  const size = gptSize(ratio);
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
  const seeds = Array.from({ length: count }, (_, index) => (
    seedInput ? Math.min(seedInput + index, 2147483647) : randomSeed()
  ));

  return mapLimited(seeds, 2, async (seed) => {
    let url;
    if (engine === 'flux') {
      url = await runFlux(prompt, seed, width, height, steps);
    } else if (engine === 'gpt-image') {
      url = await generateGptImage({
        base: rayin.base,
        key: rayin.key,
        model: model || rayin.gptModel,
        prompt,
        size,
        ref: refs[0],
      });
    } else {
      url = await generateBanana({
        base: rayin.base,
        key: rayin.key,
        model: rayin.bananaModel,
        prompt,
        ref: refs[0],
      });
    }
    /* 将远端图片下载到本地，避免浏览器跨域 403 / 防盗链导致图片不显示 */
    const localUrl = await saveRemoteImage(url);
    return { type: 'image', url: localUrl, width, height, seed };
  });
}

function extractVideoUrl(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return /^https?:\/\//.test(payload) ? payload : '';

  const candidates = [
    payload.data && payload.data[0] && payload.data[0].url,
    payload.data && payload.data[0] && payload.data[0].video_url,
    payload.output && payload.output.url,
    payload.video_url,
    payload.url,
    payload.data && payload.data.url,
    payload.result && payload.result.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) return candidate;
  }
  return '';
}

function extractVideoTaskId(payload) {
  if (!payload) return '';
  const candidates = [
    payload.id,
    payload.task_id,
    payload.data && payload.data[0] && payload.data[0].id,
    payload.data && payload.data[0] && payload.data[0].task_id,
    payload.data && payload.data.id,
    payload.data && payload.data.task_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

function videoUnavailable() {
  return jsonError(
    502,
    '视频模型接口不可用',
    '请检查 RAYIN_VIDEO_PATH / RAYIN_VIDEO_STATUS_PATH / VIDEO_MODEL 环境变量，并确认账号已开通视频模型',
  );
}

async function generateVideo(body) {
  const prompt = readPrompt(body.prompt, '提示词');
  const ratio = RATIO_SIZE[body.ratio] ? body.ratio : '16:9';
  const resolution = ['720p', '1080p', '2k'].includes(body.resolution) ? body.resolution : '720p';
  if (body.duration != null && body.duration !== '') {
    assert([5, 10].includes(Number(body.duration)), 400, '视频时长需为 5 或 10 秒', 'duration 仅支持 5 或 10');
  }
  const duration = Number(body.duration) === 10 ? 10 : 5;
  const seedInput = readSeed(body.seed);
  const seed = seedInput || randomSeed();
  readRefImages(body.refImages);

  const rayin = resolveRayin(body.rayin);
  requireKey(rayin.key);

  const { width, height } = videoSize(ratio, resolution);
  const size = `${width}x${height}`;
  const base = rayin.base;
  const videoPath = config.RAYIN_VIDEO_PATH.startsWith('/') ? config.RAYIN_VIDEO_PATH : `/${config.RAYIN_VIDEO_PATH}`;
  const statusPath = config.RAYIN_VIDEO_STATUS_PATH.startsWith('/')
    ? config.RAYIN_VIDEO_STATUS_PATH
    : `/${config.RAYIN_VIDEO_STATUS_PATH}`;
  const authHeaders = { Authorization: `Bearer ${rayin.key}`, 'Content-Type': 'application/json' };

  let initial;
  try {
    initial = await fetchJson(
      `${base}${videoPath}`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ model: config.VIDEO_MODEL, prompt, size, seconds: duration, seed }),
      },
      60000,
      '视频任务创建失败',
    );
  } catch (err) {
    throw videoUnavailable();
  }

  let url = extractVideoUrl(initial);
  if (!url) {
    const taskId = extractVideoTaskId(initial);
    if (!taskId) throw jsonError(502, '视频任务创建失败', '上游未返回任务 ID');

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await sleep(3000);
      let status;
      try {
        status = await fetchJson(
          `${base}${statusPath}/${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${rayin.key}`, Accept: 'application/json' } },
          30000,
          '视频状态查询失败',
        );
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw err;
        continue;
      }

      url = extractVideoUrl(status);
      if (url) break;

      const state = status && typeof status.status === 'string' ? status.status.toLowerCase() : '';
      if (status && (status.error || ['failed', 'error', 'cancelled', 'canceled'].includes(state))) {
        const reason = status.error && (status.error.message || status.error);
        throw jsonError(502, '视频生成失败', typeof reason === 'string' && reason ? reason : undefined);
      }
    }
  }

  if (!url) throw jsonError(502, '视频生成超时', '请稍后重试或更换视频模型');

  return [{ type: 'video', url, width, height, duration, seed }];
}

async function generateAudio(body) {
  const text = readPrompt(body.text, '配音文本');
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'alloy';
  const format = body.format === 'wav' ? 'wav' : 'mp3';
  const rayin = resolveRayin(body.rayin);
  requireKey(rayin.key);

  const payload = {
    model: config.AUDIO_MODEL,
    input: text,
    voice,
    response_format: format,
    speed: 1,
  };
  if (body.sampleRate != null && body.sampleRate !== '') {
    const sampleRate = Number(body.sampleRate);
    if (Number.isFinite(sampleRate) && sampleRate > 0) payload.sample_rate = Math.floor(sampleRate);
  }

  const res = await fetchWithTimeout(
    `${rayin.base}/audio/speech`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${rayin.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    AUDIO_TIMEOUT,
  );

  let url = '';
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    const raw = await res.text();
    throw jsonError(502, apiErrorText(res.status, raw), '语音合成失败');
  }

  if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    const fileName = `${Date.now()}-${randomToken()}.${format}`;
    await fsp.writeFile(path.join(store.dirs.media, fileName), buffer);
    url = `/uploads/media/${fileName}`;
  } else {
    let data;
    try {
      data = JSON.parse(await res.text());
    } catch (err) {
      throw jsonError(502, '语音接口返回异常', '请检查 AUDIO_MODEL 与账号权限');
    }
    url = (data && data.data && data.data[0] && data.data[0].url) || (data && data.url) || '';
    if (typeof url !== 'string' || !url) {
      throw jsonError(502, '语音接口未返回音频', '请检查 AUDIO_MODEL 与账号权限');
    }
  }

  const duration = Math.max(1, Math.round(text.length / 4 / 3));
  return { items: [{ type: 'audio', url, duration }] };
}

router.post('/generate', wrap(async (req, res) => {
  const body = req.body || {};
  const mode = body.mode;
  assert(['image', 'video', 'audio'].includes(mode), 400, '未知生成模式', 'mode 仅支持 image / video / audio');

  const started = Date.now();
  if (mode === 'image') {
    const items = await generateImages(body);
    res.json({ items, elapsed: Date.now() - started });
    return;
  }
  if (mode === 'video') {
    const items = await generateVideo(body);
    res.json({ items, elapsed: Date.now() - started });
    return;
  }

  const result = await generateAudio(body);
  res.json({ items: result.items, elapsed: Date.now() - started });
}));

module.exports = router;
