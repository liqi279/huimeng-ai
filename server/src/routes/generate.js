'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const appConfig = require('../app-config');
const catalog = require('../catalog');
const mediaStore = require('../media-store');
const userData = require('../user-data');
const jobs = require('../jobs');
const { triggerJob } = require('../scf-invoke');
const { authOptional } = require('../auth');
const {
  jsonError,
  assert,
  wrap,
  normalizeBase,
  apiErrorText,
  fetchWithTimeout,
  fetchJson,
  readJsonResponse,
  httpsJson,
  withPreSendRetry,
  isRetryableUpstream,
  dataUrlToBuffer,
  extFromMime,
  randomToken,
  randomSeed,
  sleep,
} = require('../http');

const router = express.Router();
const edgetts = require('../edgetts');
const callLog = require('../call-log');

const MAX_PROMPT_CHARS = 1800;
const MAX_REF_BYTES = 10 * 1024 * 1024;
const MAX_REF_COUNT = 10;
const IMAGE_TIMEOUT = 120000;
const VIDEO_TIMEOUT = 120000;
const AUDIO_TIMEOUT = 60000;

/* ---------------- 服务器 Key 每日额度 ----------------
   用户没带自己的 Key 时，生成走平台在 RayinAPI 的余额。
   这里按「登录 token（有则用）/ IP + 日期」计数，默认 300 次/天，只拦异常高频；
   正常用户一天几乎用不到 300 次。GEN_DAILY_LIMIT=0 可完全关闭。
   说明：计数在 SCF 实例内存中，实例回收会清零，属于「防误刷」而不是严格风控。 */
const serverKeyQuota = new Map();

function quotaIdentity(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  if (auth) return 't:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16);
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '');
  const ip = (fwd.split(',')[0] || '').trim() || req.ip || 'unknown';
  return 'ip:' + ip;
}

function enforceServerKeyQuota(req) {
  const limit = Number(config.GEN_DAILY_LIMIT) || 0;
  if (limit <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = quotaIdentity(req) + '|' + day;
  const used = serverKeyQuota.get(key) || 0;
  if (used >= limit) {
    throw jsonError(429, '今日免费生成额度已用完（' + limit + ' 次）',
      '额度每天自动恢复；在「接入设置」填入自己的 API Key 可不受此限制');
  }
  serverKeyQuota.set(key, used + 1);
  if (serverKeyQuota.size > 5000) {
    for (const k of Array.from(serverKeyQuota.keys())) {
      if (k.indexOf('|' + day) < 0) serverKeyQuota.delete(k);
    }
  }
}

const RATIO_SIZE = {
  '1:1': [1024, 1024],
  '3:4': [768, 1024],
  '4:3': [1024, 768],
  '9:16': [768, 1344],
  '16:9': [1344, 768],
  '21:9': [1344, 576],
  '2:3': [768, 1152],
  '3:2': [1008, 672],
  '4:5': [768, 960],
  '5:4': [960, 768],
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

/* 从「接入设置」整包里按通道取密钥。
 * 前端把各通道的 Key 存在 rayin.providers['__rayin__:gpt-image'].key，
 * 老页面不会再单独传 rayin.key；以前后端只认 rayin.key，于是即便用户在
 * 设置里填过 Key，服务端也认为没配置（线上实测返回「未配置 RayinAPI Key」）。 */
function pickChannelProvider(rayin, engine, model) {
  const providers = rayin && rayin.providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return null;
  const keyOf = (p) => (p && typeof p.key === 'string' && p.key.trim() ? p.key.trim() : '');
  const ids = Object.keys(providers);
  let hit = null;
  /* 1) 模型 ID 精确匹配（同一通道可能配了多个模型） */
  ids.forEach((id) => {
    const p = providers[id];
    if (!hit && keyOf(p) && model && String(p.model || '') === model) hit = p;
  });
  /* 2) 引擎匹配：gpt-image / banana */
  if (!hit) {
    ids.forEach((id) => {
      const p = providers[id];
      if (!hit && keyOf(p) && String(p.engine || '') === engine) hit = p;
    });
  }
  /* 3) 通道固定 id 兜底 */
  if (!hit) {
    const guess = engine === 'gpt-image' ? '__rayin__:gpt-image' : '__rayin__:banana';
    if (providers[guess] && keyOf(providers[guess])) hit = providers[guess];
  }
  if (!hit) return null;
  return {
    key: keyOf(hit),
    base: typeof hit.base === 'string' ? hit.base.trim() : '',
    model: typeof hit.model === 'string' ? hit.model.trim() : '',
  };
}

/* 云端 /docs/api 是「接入设置」的权威副本：providers 里按通道存 key，
   另有历史遗留的 rayin.key / 顶层 key。前端的 state.api 只在页面启动时读一次
   本地缓存，云端这份不会回灌到内存，所以请求里经常不带 key。
   这里由服务端直接读当前登录用户的 api 文档，把 key 补进 rayin，保证一定能取到。 */
async function withCloudRayinKey(req, rayin, engine) {
  const out = Object.assign({}, rayin && typeof rayin === 'object' ? rayin : {});
  const existing = typeof out.key === 'string' ? out.key.trim() : '';
  const keys = [];
  const push = (k) => {
    const v = typeof k === 'string' ? k.trim() : '';
    if (v && keys.indexOf(v) < 0) keys.push(v);
  };
  if (req && req.user) {
    try {
      const doc = await userData.getDoc(req.user.id, 'api');
      const data = doc && doc.data;
      if (data && typeof data === 'object') {
        const provs = data.providers && typeof data.providers === 'object' ? data.providers : null;
        if (provs) {
          const ids = Object.keys(provs);
          const keyOf = (id) => {
            const p = provs[id];
            return p && typeof p.key === 'string' ? p.key.trim() : '';
          };
          const pick = (predict) => {
            for (const id of ids) {
              const p = provs[id];
              if (p && predict(p, id)) {
                const k = keyOf(id);
                if (k) return k;
              }
            }
            return '';
          };
          push(pick((p) => String(p.engine || '') === engine));
          push(pick((p) => engine === 'gpt-image' && /^gpt-image/i.test(String(p.model || ''))));
          push(pick((p) => engine === 'banana' && /^gemini/i.test(String(p.model || ''))));
          push(engine === 'gpt-image' ? keyOf('__rayin__:gpt-image') : '');
          push(engine === 'banana' ? keyOf('__rayin__:banana') : '');
        }
        if (data.rayin && typeof data.rayin.key === 'string') push(data.rayin.key);
        if (typeof data.key === 'string') push(data.key);
        /* 所有通道的 key 都收进来当后备，兼容通道 id 改过名的历史数据 */
        if (provs) Object.keys(provs).forEach((id) => push(provs[id] && provs[id].key));
      }
    } catch (err) {
      /* 读文档失败不阻断：继续走请求里的 key / 环境变量 / app_config 兜底 */
    }
  }
  /* 云端文档是权威副本：优先用它。浏览器本地缓存可能还是轮换前的旧 key，
     旧 key 非空会把云端的新 key 挡住（线上 401 Invalid API key 就是这么来的），
     所以这里让云端 key 排第一，请求里的旧 key 降级为备用。 */
  const requestKey = existing;
  const primary = keys[0] || requestKey;
  if (primary) out.key = primary;
  const alts = [];
  if (requestKey && requestKey !== primary) alts.push(requestKey);
  keys.forEach((k) => { if (k !== primary && alts.indexOf(k) < 0) alts.push(k); });
  out.altKeys = alts;
  return out;
}

async function resolveRayin(input, engine) {
  const rayin = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  /* 两套 key 共存：
   *   openaiKey  → engine=gpt-image → /images/generations
   *   geminiKey  → engine=banana   → /chat/completions
   * 前端可传 rayin.key 覆盖（单 key 兼容老版）；否则依次取：
   * 通道密钥（rayin.providers）→ 环境变量 → app_config 表 → 内置默认。 */
  const userKey = typeof rayin.key === 'string' && rayin.key.trim() ? rayin.key.trim() : '';
  const modelHint = typeof rayin.model === 'string' && rayin.model.trim() ? rayin.model.trim() : '';
  const prov = userKey ? null : pickChannelProvider(rayin, engine || '', modelHint || (rayin.gptModel || ''));
  const needDb = !userKey && !prov;
  const fallback = needDb ? await appConfig.getGemini() : null;
  const openaiFallback = needDb ? await appConfig.getOpenAI() : null;
  let openaiKey = userKey
    || (engine === 'gpt-image' && prov && prov.key)
    || config.OPENAI_KEY
    || (openaiFallback && openaiFallback.key)
    || '';
  /* 访客 / 未配置时的平台兜底：直接取库里平台所有者那把 Key（只对 gpt-image 与 edits 生效）。
     Key 只在服务端内存流转，不进响应、不进日志。
     如果库里同时存了这个通道的 base / model，一并采用——它才是账号实际能连通的接入点。 */
  let platformBase = '';
  let platformModel = '';
  if (!openaiKey && (engine === 'gpt-image' || engine === '' || !engine)) {
    const platform = await appConfig.platformOpenAIKey();
    if (platform && platform.key) {
      openaiKey = platform.key;
      platformBase = platform.base || '';
      platformModel = platform.model || '';
    }
  }
  return {
    base: normalizeBase(
      (prov && prov.base) || rayin.base || platformBase
        || (fallback && fallback.base) || (openaiFallback && openaiFallback.base)
    ),
    openaiKey,
    geminiKey: userKey
      || (engine === 'banana' && prov && prov.key)
      || config.GEMINI_KEY
      || (fallback && fallback.key)
      || '',
    gptModel: (prov && prov.model)
      || (typeof rayin.gptModel === 'string' && rayin.gptModel.trim() ? rayin.gptModel.trim() : '')
      || platformModel
      || config.GPT_MODEL,
    bananaModel: (engine === 'banana' && prov && prov.model)
      || (typeof rayin.bananaModel === 'string' && rayin.bananaModel.trim()
        ? rayin.bananaModel.trim()
        : (fallback && fallback.model) || config.BANANA_MODEL),
    /* 云端 /docs/api 里的后备 key（主 key 被上游判 401 时依次重试） */
    altKeys: Array.isArray(rayin.altKeys) ? rayin.altKeys.filter((k) => typeof k === 'string' && k.trim()) : [],
  };
}

/* 上游对「key 无效 / 未授权」的判定：401/403，或错误文案里明确提到 key。
   只有这一类才换下一把 key 重试；超时、限流、内容审核等一律原样抛出。 */
function isKeyRejected(err) {
  const status = Number((err && err.status) || 0);
  const msg = String((err && err.message) || '');
  if (status === 401 || status === 403) return true;
  return /invalid\s*api\s*key|incorrect\s*api\s*key|无效的?令牌|api.?key.*(无效|不合法|错误)/i.test(msg);
}

/* 逐个 key 尝试；主 key 是云端权威值，备用 key 兼容浏览器旧缓存 / 轮换前的 key */
async function withKeyFallback(keys, fn) {
  const list = [];
  keys.forEach((k) => {
    const v = typeof k === 'string' ? k.trim() : '';
    if (v && list.indexOf(v) < 0) list.push(v);
  });
  let lastErr = null;
  for (let i = 0; i < list.length; i += 1) {
    try {
      return await fn(list[i]);
    } catch (err) {
      lastErr = err;
      if (!isKeyRejected(err) || i === list.length - 1) throw err;
    }
  }
  throw lastErr || new Error('未配置 RayinAPI Key');
}

function requireKey(key) {
  assert(key, 400, '未配置 RayinAPI Key',
    '已依次检查：请求 rayin.key、rayin.providers、云端 /docs/api、环境变量 OPENAI_KEY、app_config(openai.apiKey)');
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
  const base = RATIO_SIZE[ratio] || RATIO_SIZE['1:1'];
  const aspect = base[0] / base[1];
  if (aspect > 1.15) return '1536x1024';
  if (aspect < 0.87) return '1024x1536';
  return '1024x1024';
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

/* 验证远端 URL 是否返回有效图片，并决定是否需要下载本地代理
 * 策略：先 HEAD/GET 检查 content-type
 *   - 是图片：直接返回原 URL（Pollinations 等支持 CORS 的 CDN 前端可直连）
 *   - 非图片：报错（Pollinations 限流 "Free limit reached"）
 * 兼容：未来若接入不支持 CORS 的图源，可在这里加下载代理逻辑 */
async function validateImageUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, url: '' };
  if (url.startsWith('data:') || url.startsWith('/uploads/')) return { ok: true, url };

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Accept: 'image/*, */*;q=0.8' },
    }, 60000);
  } catch (err) {
    return { ok: false, url, reason: err.message };
  }
  if (!res.ok) return { ok: false, url, reason: `HTTP ${res.status}` };

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return { ok: false, url, reason: '上游返回非图片内容' };
  }

  /* 把 body 读掉释放连接（不存本地，Pollinations 等 CDN 前端可直连） */
  try { await res.arrayBuffer(); } catch (e) {}
  return { ok: true, url };
}

async function runFlux(prompt, seed, width, height, steps, options) {
  const opts = options || {};
  const encoded = encodeURIComponent(String(prompt).slice(0, 900));
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    model: opts.model || 'sana',
    nologo: 'true',
    referrer: 'huimeng-ai',
  });
  if (opts.negative) params.set('negative_prompt', String(opts.negative).slice(0, 300));
  /* Pollinations 直接返回图片，URL 本身即可访问 */
  return `${FLUX_PRIMARY}${encoded}?${params.toString()}`;
}

/* 各家 OpenAI 兼容平台返回结构不同（data / images / output），统一提取 */
function extractAnyImage(data) {
  if (!data) return '';
  const list = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.images)
      ? data.images
      : Array.isArray(data.output)
        ? data.output
        : [];
  for (const item of list) {
    if (typeof item === 'string' && item) return item;
    if (item && typeof item.url === 'string' && item.url) return item.url;
    if (item && typeof item.b64_json === 'string' && item.b64_json) {
      return `data:image/png;base64,${item.b64_json}`;
    }
  }
  if (typeof data.url === 'string' && data.url) return data.url;
  return '';
}

/* 免费额度平台（硅基流动 / 魔搭 / Together 等 OpenAI 兼容接口） */
async function generateOpenAICompat({ base, key, model, prompt, width, height, sizeMode, negative }) {
  const payload = { model, prompt, n: 1 };
  if (sizeMode === 'wh') {
    payload.width = width;
    payload.height = height;
  } else if (sizeMode === 'image_size') {
    payload.image_size = `${width}x${height}`;
  } else {
    payload.size = `${width}x${height}`;
  }
  if (negative) payload.negative_prompt = negative;

  const data = await fetchJson(
    `${base}/images/generations`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    IMAGE_TIMEOUT,
    '请检查平台模型 ID、密钥与免费额度是否可用',
  );

  const url = extractAnyImage(data);
  if (!url) throw jsonError(502, '模型未返回图片', '该模型可能不支持文生图接口，请更换模型 ID');
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

/* GPT-image（/images/generations）默认返回 b64_json，单张约 2MB；
   直接塞进 /generate 的 JSON 会把响应撑到数 MB，SCF 函数 URL 与浏览器
   localStorage 都容易被拖垮。这里落对象存储，改成普通媒体 URL 返回；
   存储失败时保留 data URL，不阻断出图。 */
async function persistInlineImage(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('data:')) return url;
  const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match || !match[2]) return url;
  try {
    const mime = match[1] || 'image/png';
    const buffer = Buffer.from(match[3], 'base64');
    if (!buffer.length) return url;
    const ext = extFromMime(mime) || 'png';
    const saved = await mediaStore.put(
      'media',
      `${Date.now()}-${randomToken(6)}.${ext}`,
      buffer,
      mime,
    );
    /* 用 /api/uploads/... 而不是 /uploads/...：SCF 入口会给非 /api 路径补前缀，
       前端 mediaUrl 也会把 /api 开头的相对地址拼成后端绝对地址。
       该路由按请求即时签发直链，所以保存下来的 URL 不会因为签名过期变破图。 */
    return saved.url.replace(/^\/uploads\//, '/api/uploads/');
  } catch (err) {
    return url;
  }
}

/* 生图上游调用：显式 https.request（连接 15s / 响应头 100s / 整体 120s）。
   计费安全：只有「请求确定没发到上游」（DNS/建连失败）才重试一次；
   一旦请求已发出、等响应时断开，一律不重试——用户已在 RayinAI 后台看到
   「调用成功且扣费」，说明上游其实受理了，重试就是二次扣费。
   timing 由调用方传入，用于落库定位断点（收到请求 / 发出上游 / 响应头 / 完整响应体）。 */
const IMAGE_DEADLINE_MS = 240000;

async function generateGptImage({ base, key, model, prompt, size, ref, timing }) {
  const deadline = Date.now() + IMAGE_DEADLINE_MS;
  const t = timing || {};
  t.upstreamStartAt = Date.now();
  if (ref) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    const blob = new Blob([ref.buffer], { type: ref.mime || 'image/png' });
    form.append('image', blob, `reference.${ref.ext || 'png'}`);

    /* edits 不做任何重试：请求体已发出，失败可能已被上游受理计费 */
    const res = await fetchWithTimeout(
      `${base}/images/edits`,
      { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
      IMAGE_TIMEOUT,
    );
    t.upstreamEndAt = Date.now();
    t.upstreamMs = t.upstreamEndAt - t.upstreamStartAt;
    const data = await readJsonResponse(res, '请检查模型 ID、参考图与账号权限');
    return persistInlineImage(extractOpenAIImage(data));
  }

  const payload = JSON.stringify({ model, prompt, n: 1, size });
  const data = await withPreSendRetry(deadline, async () => {
    const r = await httpsJson(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: payload,
      connectTimeoutMs: 6000,
      headersTimeoutMs: 100000,
      totalTimeoutMs: IMAGE_TIMEOUT,
    });
    /* 断点时间戳：发出上游 → 收到响应头 → 收到完整响应体 */
    t.upstreamEndAt = Date.now();
    t.upstreamMs = t.upstreamEndAt - t.upstreamStartAt;
    t.headersMs = r.headersMs;
    t.bodyMs = r.elapsedMs;
    t.upstreamStatus = r.status;
    if (r.status < 200 || r.status >= 300) {
      const err = jsonError(r.status, apiErrorText(r.status, r.text), '请检查模型 ID 与账号权限');
      err.preSend = false;
      err.retryable = false;
      throw err;
    }
    try {
      return JSON.parse(r.text);
    } catch (e) {
      const err = jsonError(502, '上游返回非 JSON 响应', 'HTTP ' + r.status);
      err.preSend = false;
      err.retryable = false;
      throw err;
    }
  });
  return persistInlineImage(extractOpenAIImage(data));
}

function extractChatImage(message) {
  if (!message) return '';

  const content = message.content;

  /* 1. content 为 markdown 字符串（Gemini / GPT-4o 返回 ![image](data:image/...base64,...) 格式） */
  if (typeof content === 'string') {
    /* ![image](data:image/png;base64,xxxxx) 或 ![image](https://...) */
    const m = content.match(/!\[.*?\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/i);
    if (m) return m[1];
    /* 纯 URL（一些代理会直接返回 https://... 链接） */
    const urlOnly = content.match(/(https?:\/\/[^\s)"']+\.(?:png|jpg|jpeg|webp|gif))/i);
    if (urlOnly) return urlOnly[1];
    /* data URI 直接出现 */
    const dataOnly = content.match(/(data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+)/);
    if (dataOnly) return dataOnly[1];
    return '';
  }

  /* 2. content 为数组（多模态 messages，image_url 格式） */
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
      /* 也处理数组内某个元素的 text 字段里嵌 markdown */
      if (typeof part.text === 'string') {
        const m = part.text.match(/!\[.*?\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/i);
        if (m) return m[1];
      }
    }
  }

  /* 3. message 其他字段兜底 */
  if (typeof message.url === 'string' && message.url) return message.url;
  if (typeof message.image_url === 'string' && message.image_url) return message.image_url;
  if (message.image_url && typeof message.image_url.url === 'string' && message.image_url.url) {
    return message.image_url.url;
  }
  return '';
}

/* Gemini 上游常见「账号额度耗尽」：换一个可用模型重试一次，避免整次生成直接失败 */
const BANANA_FALLBACK_ORDER = ['gemini-3.1-flash-image', 'gemini-3-pro-image'];

async function requestBanana(base, key, model, prompt, refs) {
  const content = [
    { type: 'text', text: prompt },
    ...refs.map((r) => ({ type: 'image_url', image_url: { url: r.dataUrl } })),
  ];

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
  if (!url) throw jsonError(502, 'Gemini Banana 未返回图片', '请检查模型 ID 与账号权限');
  return url;
}

async function generateBanana({ base, key, model, prompt, refs }) {
  const primary = model || 'gemini-3.1-flash-image';
  try {
    return await requestBanana(base, key, primary, prompt, refs);
  } catch (err) {
    const msg = String((err && err.message) || '');
    const unavailable = /exhausted|quota|429|503|额度|已达上限|不可用/i.test(msg);
    if (!unavailable) throw err;
    const alt = BANANA_FALLBACK_ORDER.find((m) => m !== primary);
    if (alt) {
      try {
        return await requestBanana(base, key, alt, prompt, refs);
      } catch (err2) {
        /* 换模型也失败 → 走下面的统一提示 */
      }
    }
    throw jsonError(502, '该 Gemini 模型上游额度暂满', '请稍后重试，或改用 Gemini 3.1 Flash Image / Gemini 3 Pro Image');
  }
}

/* 免费额度平台配置（密钥仅由前端保存在本机，随请求带上） */
function resolveProvider(input, modelId) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = normalizeBase(raw.base);
  const configured = catalog.findProvider(raw.id);
  return {
    id: (raw.id && String(raw.id)) || '',
    base,
    key: typeof raw.key === 'string' ? raw.key.trim() : '',
    model: (typeof raw.model === 'string' && raw.model.trim()) || modelId || '',
    sizeMode: (configured && configured.sizeMode) || 'size',
  };
}

/* 动漫 LoRA / 风格包：把触发词并入提示词，负面词单独返回 */
function applyStyle(prompt, lora) {
  if (!lora) return { prompt, negative: '' };
  const merged = `${prompt}, ${lora.prompt}`.trim();
  return {
    prompt: merged.slice(0, MAX_PROMPT_CHARS),
    negative: lora.negative || '',
  };
}

async function generateImages(body) {
  const engine = ['flux', 'openai', 'gpt-image', 'banana'].includes(body.engine) ? body.engine : 'flux';
  const prompt = readPrompt(body.prompt, '提示词');
  const ratio = RATIO_SIZE[body.ratio] ? body.ratio : '1:1';
  const scale = ['1k', '2k', '4k'].includes(body.scale) ? body.scale : '2k';
  const count = readCount(body.count);
  const steps = readSteps(body.steps);
  const seedInput = readSeed(body.seed);
  const refs = readRefImages(body.refImages);
  const rayin = await resolveRayin(body.rayin, engine);

  const lora = catalog.findLora(body.style);
  const styled = applyStyle(prompt, lora);

  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
  const provider = engine === 'openai' ? resolveProvider(body.provider, model) : null;

  if (engine === 'gpt-image') requireKey(rayin.openaiKey);
  if (engine === 'banana') requireKey(rayin.geminiKey);
  if (engine === 'openai') {
    assert(provider.key, 400, '未配置该平台的 API Key', '在「接入设置 · 免费模型平台」中填写密钥');
    assert(provider.model, 400, '未选择模型', '请选择一个模型 ID');
  }

  const { width, height } = scaledImageSize(ratio, scale);
  const size = gptSize(ratio);
  /* 主 key 取云端 /docs/api；被上游判无效时按备用 key（浏览器旧缓存等）重试 */
  const gptKeys = [rayin.openaiKey].concat(rayin.altKeys || []).slice(0, 4);
  const seeds = Array.from({ length: count }, (_, index) => (
    seedInput ? Math.min(seedInput + index, 2147483647) : randomSeed()
  ));

  return mapLimited(seeds, 2, async (seed) => {
    let url;
    let timing = null;
    if (engine === 'flux') {
      url = await runFlux(styled.prompt, seed, width, height, steps, {
        model: model || 'sana',
        negative: styled.negative,
      });
    } else if (engine === 'openai') {
      url = await generateOpenAICompat({
        base: provider.base,
        key: provider.key,
        model: provider.model,
        prompt: styled.prompt,
        width,
        height,
        sizeMode: provider.sizeMode,
        negative: styled.negative,
      });
    } else if (engine === 'gpt-image') {
      /* GPT-image → /images/generations，不支持多 reference 图 */
      const t = {};
      url = await withKeyFallback(gptKeys, (key) => generateGptImage({
        base: rayin.base,
        key,
        model: model || rayin.gptModel,
        prompt: styled.prompt,
        size,
        ref: refs[0],
        timing: t,
      }));
      timing = t;
    } else {
      /* Banana → /chat/completions，支持多图引用 */
      url = await generateBanana({
        base: rayin.base,
        key: rayin.geminiKey,
        model: model || rayin.bananaModel,
        prompt: styled.prompt,
        refs,
      });
    }
    /* 验证图片 URL 有效性（检测上游限流/404），并返回给前端直连 */
    const verified = await validateImageUrl(url);
    if (!verified.ok) {
      throw jsonError(502, '图片生成失败', verified.reason || '免费算力暂不可用或已达上限，请稍后重试');
    }
    return { type: 'image', url: verified.url, width, height, seed, timing };
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

/* 视频模型定义 — 走则灵（zeling.online）平台 /api/hz/tasks 异步任务接口。
 * model = 真实模型 ID（提交给 POST /api/hz/tasks 的 model 字段）
 * apiKey = zk- 前缀独立密钥，按模型指定；未授权模型占位（需找到真实 model ID）
 * 积分/分辨率/时长从 zeling /api/hz/models 实测结果而来
 */
const ZELING_BASE = 'https://www.zeling.online/api/hz';
const ZELING_UPLOAD_BASE = 'https://www.zeling.online';

const VIDEO_MODELS = [
  /* ==== 账号一 3045324659@qq.com · 按次生成 ==== */
  {
    id: 'vidu-q4',
    name: 'Vidu Q4',
    model: 'vidu-q4',
    minDuration: 4, maxDuration: 16,
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    fps: 24,
    billingType: 'perTask', creditsMin: 19, credits: 31,
    refHint: '图15 / 视0 / 音3 多参考，支持首尾帧；1080p 更贵',
    desc: '按次生成 · 19-31 积分/次',
    apiKey: 'zk-83e955434c5079dfc4f6f054d472f5b0',
  },
  {
    id: 'minimax_h3-768p',
    name: 'MiniMax H3',
    model: 'minimax_h3-768p',
    minDuration: 5, maxDuration: 15,
    resolutions: ['768p', '480p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    fps: 24,
    billingType: 'perTask', creditsMin: 13, credits: 15,
    refHint: '图9 / 视0 / 音3 全参模式；原生分辨率 768p',
    desc: '按次生成 · 13-15 积分/次',
    apiKey: 'zk-276f49cf4a4f2543790da21098cec361',
  },
  {
    id: 'sd-2-720p',
    name: 'Seedance 2 · 9图3音3视',
    model: 'sd-2-720p',
    minDuration: 5, maxDuration: 15,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3'],
    fps: 24,
    billingType: 'perTask', credits: 35,
    refHint: '9图+3音+3视 多模态参考，动作/风格/角色一致性强',
    desc: '按次生成 · 35 积分/次',
    apiKey: 'zk-a779d45bbdfd5a363064e305a8f9c2be',
  },
  {
    id: 'seedance-2.0-903',
    name: 'Seedance 2.0 满血',
    model: 'seedance-2.0-903',
    minDuration: 5, maxDuration: 15,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3'],
    fps: 24,
    billingType: 'perTask', credits: 34,
    refHint: '9图+0视+3音，风格迁移 / 角色一致性',
    desc: '按次生成 · 34 积分/次',
    apiKey: 'zk-ad8b695045b525614d7735185255600d',
  },
  /* ==== 账号二 18005676519@qq.com · 混合 ==== */
  {
    id: 'sd2.5-sss',
    name: 'Seedance 2.5 SSS',
    model: 'sd2.5-sss',
    minDuration: 5, maxDuration: 30,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    fps: 24,
    billingType: 'perTask', credits: 70,
    refHint: '图30 / 视10 / 音10 极多参考，Seedance 2.5 SSS 模式',
    desc: '按次生成 · 70 积分/次',
    apiKey: 'zk-adda48ef81efe9b95571906b17dad841',
  },
];

/* 音频模型定义：区分免费（Edge-TTS）和付费（RayinAPI） */
const AUDIO_MODELS = [
  { id: 'edgetts',             name: 'Edge-TTS（免费）',   source: 'edgetts',  free: true },
  { id: 'tts-1',               name: 'TTS-1',              source: 'rayin',    free: false },
  { id: 'tts-1-hd',            name: 'TTS-1 HD',           source: 'rayin',    free: false },
  { id: 'gpt-4o-mini-tts',     name: 'GPT-4o mini TTS',    source: 'rayin',    free: false },
];

/* 参考主体最大限制 */
const REF_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const REF_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
const REF_VIDEO_MAX_COUNT = 3;
const REF_AUDIO_MAX_COUNT = 3;

function pickMediaModel(value, allowed, fallback) {
  const ids = allowed.map((m) => (typeof m === 'string' ? m : m.id));
  return typeof value === 'string' && ids.includes(value) ? value : fallback;
}

function videoModel(v) {
  const found = VIDEO_MODELS.find((m) => m.id === v);
  return found ? found.id : VIDEO_MODELS[0].id;
}

function videoModelMeta(v) {
  return VIDEO_MODELS.find((m) => m.id === v) || VIDEO_MODELS[0];
}

function audioModel(v) {
  const found = AUDIO_MODELS.find((m) => m.id === v);
  return found ? found.id : AUDIO_MODELS[0].id;
}

function audioModelMeta(v) {
  return AUDIO_MODELS.find((m) => m.id === v) || AUDIO_MODELS[0];
}

function videoUnavailable() {
  return jsonError(502, '则灵视频接口不可用', '请稍后重试或更换模型');
}

/** 则灵 /api/hz/uploads：上传参考素材（公开端点，无需鉴权）
 *  上传后返回 /files/uploads/xxx.ext，需要拼上 ZELING_UPLOAD_BASE 才是完整可下载 URL
 */
async function zelingUpload(buf, kind, originalName) {
  const fname = originalName || `ref-${randomToken(6)}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`;
  const url = `${ZELING_BASE}/uploads?kind=${kind}&name=${encodeURIComponent(fname)}`;
  const r = await fetchWithTimeout(url, { method: 'POST', body: buf, headers: {} }, 30000);
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.text()).slice(0, 200); } catch {}
    throw jsonError(r.status === 413 ? 413 : 502, '上传参考素材失败', msg || `HTTP ${r.status}`);
  }
  const d = await readJsonResponse(r);
  /* d.url 形如 "/files/uploads/xxx.png" */
  return d.url.startsWith('http') ? d.url : ZELING_UPLOAD_BASE + d.url;
}

/** 解析则灵任务 URL 字段 */
function zelingMediaUrl(task) {
  if (!task) return '';
  return task.mediaUrl || task.media_url || task.videoUrl || task.video_url || task.outputUrl || '';
}

async function generateVideo(body) {
  const prompt = readPrompt(body.prompt, '提示词');
  const modelId = videoModel(body.model);
  const modelMeta = videoModelMeta(modelId);

  /* aspect_ratio：zeling 原生字段，值为 "16:9"/"9:16"/"1:1"/"4:3"/"21:9" 等 */
  const ratio = modelMeta.aspectRatios && modelMeta.aspectRatios.includes(body.ratio)
    ? body.ratio
    : (modelMeta.aspectRatios && modelMeta.aspectRatios[0]) || '16:9';

  const resolution = modelMeta.resolutions.includes(body.resolution) ? body.resolution : modelMeta.resolutions[0];

  /* 时长校验（zeling 有固定档位，前端做 5 的倍数已经够了，这里边界检查即可） */
  let duration = body.duration != null && body.duration !== '' ? Number(body.duration) : modelMeta.minDuration;
  if (!Number.isFinite(duration) || duration < modelMeta.minDuration || duration > modelMeta.maxDuration) {
    throw jsonError(400, `视频时长 ${duration} 秒超出范围`, `模型 ${modelMeta.name} 支持 ${modelMeta.minDuration}-${modelMeta.maxDuration} 秒`);
  }

  /* 参考主体校验 + 解析 */
  const refImages = readRefImages(body.refImages);
  const refVideos = Array.isArray(body.refVideos) ? body.refVideos : [];
  const refAudios = Array.isArray(body.refAudios) ? body.refAudios : [];
  for (let i = 0; i < refVideos.length; i += 1) {
    assert(typeof refVideos[i] === 'string' && refVideos[i].startsWith('data:'), 400, `参考视频 ${i + 1} 格式不正确`);
  }
  for (let i = 0; i < refAudios.length; i += 1) {
    assert(typeof refAudios[i] === 'string' && refAudios[i].startsWith('data:'), 400, `参考音频 ${i + 1} 格式不正确`);
  }

  const key = modelMeta.apiKey;
  requireKey(key);

  /* ==== 第一步：把所有参考素材上传到则灵 ==== */
  let imageRefUrls = [];
  let videoRefUrls = [];
  let audioRefUrls = [];

  if (refImages.length || refVideos.length || refAudios.length) {
    assert(
      modelMeta.refHint || true,
      200,
      undefined,
      '⚠️ 该模型参考主体数量见上方「参考提示」，若超过模型上限则灵会返回 400',
    );
  }

  for (const r of refImages) {
    const url = await zelingUpload(r.buffer, 'image', `ref-${randomToken(4)}.${r.ext}`);
    imageRefUrls.push(url);
  }
  for (const item of refVideos) {
    const dec = dataUrlToBuffer(item);
    const url = await zelingUpload(dec.buffer, 'video', `ref-${randomToken(4)}.${extFromMime(dec.mime) || 'mp4'}`);
    videoRefUrls.push(url);
  }
  for (const item of refAudios) {
    const dec = dataUrlToBuffer(item);
    const url = await zelingUpload(dec.buffer, 'audio', `ref-${randomToken(4)}.${extFromMime(dec.mime) || 'mp3'}`);
    audioRefUrls.push(url);
  }

  /* ==== 第二步：创建异步视频任务 ==== */
  const payload = {
    type: 'video',
    model: modelMeta.model || modelId,
    prompt,
    duration,
    aspect_ratio: ratio,
    resolution,
  };
  if (imageRefUrls.length) payload.image_refs = imageRefUrls;
  if (videoRefUrls.length) payload.video_refs = videoRefUrls;
  if (audioRefUrls.length) payload.audio_refs = audioRefUrls;

  let initial;
  try {
    initial = await fetchJson(
      `${ZELING_BASE}/tasks`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      60000,
      '视频任务创建失败',
    );
  } catch (err) {
    /* 把常见则灵错误码转成可读提示 */
    if (err && err.status === 409) throw jsonError(409, '积分余额不足', '请在则灵平台充值后重试');
    if (err && err.status === 403) throw jsonError(403, '该 API Key 未授权此模型', '可能是 model ID 不对或 Key 权限不够');
    if (err && err.status === 401) throw jsonError(401, 'API Key 无效', '请检查则灵平台 API Key 是否有效');
    if (err && err.status === 400) throw err;
    if (err && err.status === 404) throw jsonError(502, '则灵接口路径错误', '可能需要更新则灵 API 版本');
    /* 其他错误（网络、超时等）：保留原始提示方便排查 */
    if (err && err.message) throw jsonError(502, '则灵视频接口请求失败', err.message);
    throw videoUnavailable();
  }

  const taskId = (initial.task && (initial.task.id || initial.task.taskId)) || initial.id || initial.taskId;
  if (!taskId) throw jsonError(502, '视频任务创建失败', '上游未返回任务 ID');

  /* ==== 第三步：轮询任务状态（每 10 秒一次，最多 10 分钟） ==== */
  let url = '';
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    let statusBody;
    try {
      statusBody = await fetchJson(
        `${ZELING_BASE}/tasks/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
        30000,
        '视频状态查询失败',
      );
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      if (err.status === 404) { /* 任务不存在，等会儿再试 */ continue; }
      continue;
    }

    const task = statusBody.task || statusBody;
    const state = (task.status || '').toLowerCase();
    url = zelingMediaUrl(task);
    if (url) break;

    if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) {
      const reason = task.error && (task.error.message || task.error);
      throw jsonError(502, '视频生成失败', typeof reason === 'string' && reason ? reason : undefined);
    }
  }

  if (!url) throw jsonError(502, '视频生成超时', '请稍后重试或更换视频模型');

  /* ==== 第四步：把则灵成品转存到对象存储（未配置时回落本地盘） ==== */
  let localUrl;
  try {
    const r = await fetchWithTimeout(url, { method: 'GET', headers: {} }, 60000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const fname = `${Date.now()}-${randomToken(6)}.mp4`;
    const saved = await mediaStore.put('media', fname, buf, 'video/mp4');
    localUrl = saved.url;
  } catch (err) {
    /* 下载失败直接透传则灵直链 — 前端可直接播放（则灵直链约 24h 有效） */
    localUrl = url;
  }

  return [{
    type: 'video',
    url: localUrl,
    upstreamUrl: url, /* 保留原始直链供前端 fallback */
    width: modelMeta.resolutions.includes('1080p') && resolution === '1080p' ? 1920 : 1280,
    height: modelMeta.resolutions.includes('1080p') && resolution === '1080p' ? 1080 : 720,
    duration,
    model: modelId,
    engine: 'zeling',
  }];
}

async function generateAudio(body) {
  const text = readPrompt(body.text, '配音文本');
  const modelId = audioModel(body.model);
  const modelMeta = audioModelMeta(modelId);

  /* === 免费引擎：Edge-TTS === */
  if (modelMeta.source === 'edgetts') {
    const edVoice = edgetts.resolveVoice(body.voice);
    const edFormat = edgetts.resolveFormat(body.format);

    let audioBuffer;
    try {
      const result = await edgetts.synthesize({
        text,
        voice: edVoice,
        format: edFormat,
        timeout: 45000,
      });
      audioBuffer = result.audio;
    } catch (err) {
      /* Edge-TTS 失败时，给出友好提示；同时如果用户配置了 RayinAPI Key，可选降级 */
      const rayin = await resolveRayin(body.rayin);
      if (rayin.key) {
        try {
          audioBuffer = await generateAudioViaRayin({
            text,
            model: 'tts-1',
            voice: 'alloy',
            format: 'mp3',
            rayin,
          });
        } catch (fallbackErr) {
          throw jsonError(502, 'Edge-TTS 不可用，备用通道也失败', err.message || '免费通道当前繁忙或端点被封，请稍后重试');
        }
      } else {
        throw jsonError(502, 'Edge-TTS 免费通道暂不可用', err.message ? String(err.message).slice(0, 160) : '微软端点当前繁忙或被封锁，请稍后重试或切换付费模型');
      }
    }

    /* 保存到对象存储（未配置时由 objectStore 回落本地盘） */
    const ext = edFormat.includes('pcm') || edFormat.includes('wav') ? 'wav' : 'mp3';
    const fileName = `${Date.now()}-${randomToken()}.${ext}`;
    const saved = await mediaStore.put('media', fileName, audioBuffer, ext === 'wav' ? 'audio/wav' : 'audio/mpeg');
    const duration = Math.max(1, Math.round(text.length / 4 / 3)); /* 粗估：中文每秒 ~3 字，英文 ~4 */

    return { items: [{ type: 'audio', url: saved.url, duration }] };
  }

  /* === 付费引擎：RayinAPI === */
  const rayin = await resolveRayin(body.rayin);
  requireKey(rayin.key);
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'alloy';
  const format = body.format === 'wav' ? 'wav' : 'mp3';

  const audioBuffer = await generateAudioViaRayin({
    text,
    model: modelId,
    voice,
    format,
    rayin,
    sampleRate: body.sampleRate,
  });

  const ext = format === 'wav' ? 'wav' : 'mp3';
  const fileName = `${Date.now()}-${randomToken()}.${ext}`;
  const saved = await mediaStore.put('media', fileName, audioBuffer, format === 'wav' ? 'audio/wav' : 'audio/mpeg');
  const duration = Math.max(1, Math.round(text.length / 4 / 3));

  return { items: [{ type: 'audio', url: saved.url, duration }] };
}

/* 从 RayinAPI 获取音频二进制并保存 */
async function generateAudioViaRayin({ text, model, voice, format, rayin, sampleRate }) {
  const payload = {
    model,
    input: text,
    voice,
    response_format: format,
    speed: 1,
  };
  if (sampleRate != null && sampleRate !== '') {
    const rate = Number(sampleRate);
    if (Number.isFinite(rate) && rate > 0) payload.sample_rate = Math.floor(rate);
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

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(apiErrorText(res.status, raw));
  }

  if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
    return Buffer.from(await res.arrayBuffer());
  }

  /* 某些中转返回 JSON 包含 url */
  const data = JSON.parse(await res.text());
  const url = (data && data.data && data.data[0] && data.data[0].url) || (data && data.url) || '';
  if (!url) throw new Error('语音接口未返回音频');

  const media = await fetchWithTimeout(url, {}, 30000);
  if (!media.ok) throw new Error('下载音频文件失败: HTTP ' + media.status);
  return Buffer.from(await media.arrayBuffer());
}

/* 视频 / 音频模型目录接口 —— 前端用来动态渲染时长滑块和参考主体限制 */
router.get('/media-models', wrap(async (req, res) => {
  res.json({
    video: VIDEO_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      minDuration: m.minDuration,
      maxDuration: m.maxDuration,
      resolutions: m.resolutions,
      fps: m.fps || 24,
      billingType: m.billingType || 'perTask',
      credits: m.credits,
      creditsMin: m.creditsMin,
      creditsPerSec: m.creditsPerSec,
      creditsPerSecMin: m.creditsPerSecMin,
      desc: m.desc || '',
      refHint: m.refHint || '',
      free: m.free,
      /* 参考主体限制 */
      refLimits: {
        images: { count: 10, maxBytes: 10 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp'] },
        videos: { count: 3, maxBytes: 50 * 1024 * 1024, mime: ['video/mp4', 'video/webm', 'video/quicktime'] },
        audios: { count: 3, maxBytes: 10 * 1024 * 1024, mime: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4'] },
      },
    })),
    audio: {
      models: AUDIO_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        source: m.source,
        free: m.free,
      })),
      refLimits: {
        audios: { count: 3, maxBytes: 10 * 1024 * 1024, mime: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'] },
      },
      /* Edge-TTS 声音列表（免费引擎才用到） */
      edgeVoices: edgetts.listVoices(),
    },
  });
}));

/* 生成结果里的 /api/uploads/... 是相对地址：补成绝对地址再返回，
   避免前端在 Pages 域名下把它拼成 liqi279.github.io/api/uploads/... 而 404。 */
function requestOrigin(req) {
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  if (!host) return '';
  return proto + '://' + host;
}

function absolutizeItems(items, req) {
  if (!Array.isArray(items)) return;
  const origin = requestOrigin(req);
  if (!origin) return;
  const fix = (v) => (typeof v === 'string' && v.charAt(0) === '/' ? origin + v : v);
  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (item.url) item.url = fix(item.url);
    if (item.thumb) item.thumb = fix(item.thumb);
    if (item.poster) item.poster = fix(item.poster);
  });
}

/* 生图/视频/配音的核心处理：HTTP 路由与异步任务（SCF 事件调用）共用同一份实现 */
async function handleGenerate(req, res) {
  /* 断点定位用：请求进入本函数的时间戳（函数冷启动/网关排队都在这之前） */
  const receivedAt = Date.now();
  const body = req.body || {};
  const mode = body.mode;
  assert(['image', 'video', 'audio'].includes(mode), 400, '未知生成模式', 'mode 仅支持 image / video / audio');

  /* 前端内存里的 state.api 可能没有 Key（只在页面启动读一次本地缓存），
     先按登录用户读云端 /docs/api 补全 Key，再做「是否用服务器 Key」的额度判定 */
  body.rayin = await withCloudRayinKey(req, body.rayin, body.engine);

  /* 没带自己的 Key → 会消耗平台 Key，按天限额防刷 */
  const rayinInput = body.rayin && typeof body.rayin === 'object' && !Array.isArray(body.rayin) ? body.rayin : {};
  const userKey = typeof rayinInput.key === 'string' ? rayinInput.key.trim() : '';
  if (!userKey && (config.OPENAI_KEY || config.GEMINI_KEY || config.RAYIN_KEY)) {
    enforceServerKeyQuota(req);
  }

  const started = Date.now();
  /* 调用日志上下文：成功/失败都落一条到 MySQL（写失败不影响主流程） */
  const logBase = callLog.describe(req, body);
  try {
    let items;
    if (mode === 'image') {
      items = await generateImages(body);
    } else if (mode === 'video') {
      items = await generateVideo(body);
    } else {
      const result = await generateAudio(body);
      items = result.items;
    }
    const elapsed = Date.now() - started;
    absolutizeItems(items, req);
    await callLog.record(Object.assign({}, logBase, {
      status: 'success',
      httpStatus: 200,
      durationMs: elapsed,
      responseSummary: callLog.summarizeItems(items),
    }));
    res.json({
      items,
      elapsed,
      /* 关键断点：receivedAt（函数内收到请求）→ items[].timing（发上游/响应头/响应体）
         → respondedAt（函数返回）。与浏览器端耗时对比即可判定断在哪一层。 */
      timings: { receivedAt, respondedAt: Date.now(), elapsedMs: Date.now() - receivedAt },
    });
  } catch (err) {
    const elapsed = Date.now() - started;
    await callLog.record(Object.assign({}, logBase, {
      status: 'failed',
      httpStatus: Number(err && (err.status || err.statusCode)) || 500,
      durationMs: elapsed,
      error: (err && err.message) || '生成失败',
    }));
    throw err;
  }
}

router.post('/generate', authOptional, wrap(handleGenerate));

/* -------------------------------------------------------------
 * 异步生成任务：提交立即返回 jobId，真正的生成在 SCF 事件调用里跑，
 * 结果落 generate_jobs 表，前端轮询。用于绕开单次长连接被掐断。
 * ------------------------------------------------------------- */
function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(obj) { this.body = obj; this.statusCode = this.statusCode || 200; return this; },
    send(obj) { this.body = obj; return this; },
    end() { return this; },
  };
}

function publicHost() {
  try {
    return new URL(process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com').host;
  } catch (err) {
    return '';
  }
}

/* 事件调用入口：由 scf.js 在识别到 __job 时调用 */
async function runJob(jobId) {
  const job = await jobs.get(jobId);
  if (!job) return;
  /* 原子领取：pending → running 只有一次能成功。
     事件调用重复投递、或前端重复提交，都不会让上游被调用第二次（避免重复扣费）。 */
  const claimed = await jobs.markRunning(jobId);
  if (!claimed) return;
  const started = Date.now();
  const req = {
    user: job.user || null,
    headers: { host: publicHost() },
    body: job.payload || {},
  };
  const res = fakeResponse();
  try {
    await handleGenerate(req, res);
    const code = Number(res.statusCode) || 200;
    if (code >= 400 || !res.body || res.body.error) {
      const err = (res.body && res.body.error) || {};
      await jobs.fail(jobId, {
        status: code,
        message: err.message || '生成失败',
        hint: err.hint || '',
        category: code === 504 ? 'timeout' : (code === 502 ? 'network' : (code >= 500 ? 'upstream' : 'request')),
      }, Date.now() - started);
      return;
    }
    await jobs.complete(jobId, res.body, Date.now() - started);
    /* 以后每次生成（含测试）产出后默认进该用户个人空间桌面：
       只新增作品，不动桌面结构；失败不影响任务结果，下次补录还会兜一次。 */
    try {
      const { addJobToDesk } = require('../desk-backfill');
      if (job.userId) await addJobToDesk(job.userId, jobId, res.body, job.createdAt);
    } catch (e) {
      console.warn('[generate] 写入桌面失败: ' + (e && e.message));
    }
  } catch (err) {
    const status = Number((err && (err.status || err.statusCode)) || 500);
    await jobs.fail(jobId, {
      status,
      message: (err && err.message) || '生成失败',
      hint: (err && err.hint) || '',
      code: (err && err.code) || '',
      attempts: (err && err.attempts) || null,
      retrySkipped: (err && err.retrySkipped) || '',
      /* 只记主机名，不含任何凭据；下次失败能一眼看出打的是哪个接入点 */
      upstreamHost: (err && err.upstreamHost) || '',
      category: status === 504 ? 'timeout' : (status === 502 ? 'network' : 'upstream'),
    }, Date.now() - started);
  }
}

router.post('/generate/jobs', authOptional, wrap(async (req, res) => {
  const user = req.user ? {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
  } : null;
  const userId = user ? String(user.id) : '';
  /* 幂等键：客户端每次「点生成」生成一个 requestId，网络重试/重复点击都复用同一个。
     同一用户 + 同一 requestId 只会有一个任务、一次上游调用（不会重复扣费）。 */
  const requestId = String((req.body && (req.body.requestId || req.body.jobId)) || '').slice(0, 100);
  const idemKey = requestId ? `${userId || 'anon'}:${requestId}` : '';
  if (idemKey) {
    const existing = await jobs.getByIdem(idemKey, userId);
    if (existing) {
      res.status(existing.status === 'done' ? 200 : 202).json({
        id: existing.id,
        status: existing.status,
        result: existing.result,
        error: existing.error,
        reused: true,
      });
      return;
    }
  }

  const id = randomToken(12);
  let created;
  try {
    created = await jobs.create({
      id,
      userId,
      payload: req.body || {},
      user,
      idemKey,
    });
  } catch (err) {
    /* 任务表不可用需要可定位：给出内部标识与数据库错误码，不透传堆栈/凭据 */
    const e = jsonError(503, '任务表不可用', 'generate_jobs 建表或写入失败（' + ((err && err.code) || 'unknown') + '）');
    e.code = 'JOBS_DB_ERROR';
    throw e;
  }
  if (created && created.created === false) {
    /* 并发撞车：另一个请求刚建好同一个幂等任务，直接复用 */
    res.status(202).json({ id: created.id, status: created.status, reused: true });
    return;
  }
  const invoked = await triggerJob(id);
  if (!invoked) {
    /* 没拿到平台凭据时不能假装排队：直接同步执行并返回结果，保证功能不消失 */
    await runJob(id);
    const done = await jobs.get(id);
    res.status(done && done.status === 'done' ? 200 : 502).json({
      id,
      status: done ? done.status : 'failed',
      result: done ? done.result : null,
      error: done ? done.error : { message: '异步触发不可用，同步执行失败' },
    });
    return;
  }
  res.status(202).json({ id, status: 'pending' });
}));

/* 按幂等键取任务：提交请求被长连接掐断时，前端仍能找回结果 */
router.get('/generate/jobs/by-key/:key', authOptional, wrap(async (req, res) => {
  const userId = req.user ? String(req.user.id) : '';
  const job = await jobs.getByIdem(decodeURIComponent(req.params.key), userId);
  if (!job) {
    res.status(404).json({ error: { message: '任务不存在或已过期' } });
    return;
  }
  res.json(job);
}));

router.get('/generate/jobs/:id', authOptional, wrap(async (req, res) => {
  const userId = req.user ? String(req.user.id) : '';
  const job = await jobs.get(req.params.id, userId);
  if (!job) {
    res.status(404).json({ error: { message: '任务不存在或已过期' } });
    return;
  }
  /* 兜底：后台事件调用没能真正起来时，任务会一直停在 pending/running。
     超过 6 分钟判定为失败，并持久化错误类别，便于下次一眼定位。 */
  if ((job.status === 'pending' || job.status === 'running') && Date.now() - job.updatedAt > 360000) {
    const error = {
      status: 504,
      message: '后台任务未启动或已中断',
      hint: 'SCF 事件调用未执行（检查函数权限/并发），任务记录见 generate_jobs',
      category: 'worker',
    };
    await jobs.fail(job.id, error, Date.now() - job.createdAt);
    res.json({ id: job.id, status: 'failed', result: null, error, durationMs: Date.now() - job.createdAt });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    result: job.result,
    error: job.error,
    durationMs: job.durationMs,
    updatedAt: job.updatedAt,
  });
}));

module.exports = router;
module.exports.handleGenerate = handleGenerate;
module.exports.runJob = runJob;
