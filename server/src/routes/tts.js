'use strict';

/* =============================================================
 * 工作流 TTS 路由
 *  1. 声音设计：Edge-TTS（免费，无需 Key）—— 文本 → 语音
 *  2. 语音克隆：Fish Audio（需用户自备 API Key）—— 参考音频 + 文本 → 克隆语音
 * 返回 { url: '/uploads/media/xxx.mp3', duration }
 * ============================================================= */

const express = require('express');
const edgetts = require('../edgetts');
const mediaStore = require('../media-store');
const {
  jsonError,
  assert,
  wrap,
  fetchWithTimeout,
  apiErrorText,
  dataUrlToBuffer,
  extFromMime,
  randomToken,
} = require('../http');

const router = express.Router();

const FISH_BASE = 'https://fishaudio.org/api/open/v1';
const MAX_TEXT = 2000;
const MAX_REF_BYTES = 10 * 1024 * 1024;

/* ---------- 工具 ---------- */

/* Edge-TTS 语速：前端传 0.5~2，转成 edge-tts 的 rate 字符串（-50% ~ +100%） */
function speedToRate(speed) {
  const s = Number(speed);
  if (!Number.isFinite(s)) return '+0%';
  const pct = Math.round((s - 1) * 100);
  const clamped = Math.max(-50, Math.min(100, pct));
  return (clamped >= 0 ? '+' : '') + clamped + '%';
}

/* ---------- 声音设计：Edge-TTS ---------- */

/* 根据音色描述提示词，选择一个合适的 Edge-TTS 声音 */
function pickEdgeVoice(prompt, genderHint) {
  const p = String(prompt || '').toLowerCase();
  const zh = /[\u4e00-\u9fff]/.test(prompt || '');
  const male = /男|男声|男性|大叔|少年|中年男|老年男|male|boy/i.test(p);
  const female = /女|女声|女性|少女|萝莉|御姐|中年女|老年女|female|girl/i.test(p);
  const old = /老|老年|年迈/i.test(p);
  const young = /少|青年|年轻|活力|bright/i.test(p);

  let gender = genderHint;
  if (!gender) {
    if (male && !female) gender = 'Male';
    else if (female && !male) gender = 'Female';
  }

  if (zh) {
    if (gender === 'Male') {
      if (old) return 'zh-CN-YunjianNeural';
      if (young) return 'zh-CN-YunxiNeural';
      return 'zh-CN-YunyangNeural';
    }
    if (old) return 'zh-CN-XiaohanNeural';
    if (young) return 'zh-CN-XiaoyiNeural';
    return 'zh-CN-XiaoxiaoNeural';
  }
  if (gender === 'Male') return 'en-US-GuyNeural';
  return 'en-US-AriaNeural';
}

router.post('/design', wrap(async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || '').trim();
  assert(text.length > 0, 400, '请输入合成文本');
  assert(text.length <= MAX_TEXT, 400, `文本过长（最多 ${MAX_TEXT} 字）`);

  const prompt = String(body.prompt || '').trim();
  const voice = edgetts.resolveVoice(body.voice || pickEdgeVoice(prompt, body.gender));
  const rate = speedToRate(body.speed);
  const pitch = body.pitch ? (Number(body.pitch) >= 0 ? '+' : '') + Math.round(Number(body.pitch)) + 'Hz' : '+0Hz';

  let result;
  try {
    result = await edgetts.synthesize({
      text,
      voice,
      rate,
      pitch,
      format: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 45000,
    });
  } catch (err) {
    const detail = [err.message, err.code].filter(Boolean).join(' ').slice(0, 160);
    throw jsonError(502, 'Edge-TTS 合成失败', detail || '微软端点繁忙，请稍后重试');
  }

  const fileName = `${Date.now()}-${randomToken()}.mp3`;
  /* 写对象存储（未配置时回落本地盘），URL 仍是 /uploads/media/<name> */
  const saved = await mediaStore.put('media', fileName, result.audio, 'audio/mpeg');
  const duration = Math.max(1, Math.round(text.length / 4 / 3));

  res.json({ url: saved.url, duration, voice, engine: 'edgetts' });
}));

/* ---------- 语音克隆：Fish Audio v1 voice-clone-tts ---------- */

/* 推导后端公网地址（用于把参考音频 URL 交给 Fish Audio 下载） */
function publicOrigin(req) {
  const fwdProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = fwdProto || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

/* 轮询 Fish Audio 异步任务直到终态 */
async function pollFishJob(apiKey, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const statusUrl = `${FISH_BASE}/speech/voice-clone-tts/jobs/${encodeURIComponent(jobId)}`;
  while (Date.now() < deadline) {
    const r = await fetchWithTimeout(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 30000);
    if (!r.ok) {
      const raw = await r.text();
      throw jsonError(r.status, 'Fish Audio 查询任务失败', apiErrorText(r.status, raw));
    }
    const data = await r.json();
    const task = data.task || data;
    const status = String(task.status || '').toLowerCase();
    if (status === 'success') return task;
    if (status === 'fail' || status === 'partial_fail' || status === 'failed') {
      throw jsonError(502, 'Fish Audio 克隆失败', String(task.error || task.message || '任务失败').slice(0, 160));
    }
    /* pending / processing — 等待 */
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw jsonError(504, 'Fish Audio 克隆超时', '任务未在规定时间内完成，请稍后重试');
}

router.post('/clone', wrap(async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || '').trim();
  assert(text.length > 0, 400, '请输入合成文本');
  assert(text.length <= MAX_TEXT, 400, `文本过长（最多 ${MAX_TEXT} 字）`);

  const apiKey = String(body.apiKey || '').trim();
  assert(apiKey, 400, '未配置 Fish Audio API Key', '在工作流页面填写 Fish Audio API Key 后再生成');

  const refAudio = String(body.referenceAudio || '').trim();
  assert(refAudio.startsWith('data:'), 400, '请上传参考音频', '需上传一段 3~10 秒的干净人声作为克隆样本');

  const decoded = dataUrlToBuffer(refAudio);
  assert(decoded.buffer.length <= MAX_REF_BYTES, 413, '参考音频过大', '单音频不能超过 10MB');

  /* 1. 把参考音频写入对象存储，拿到可被 Fish Audio 下载的绝对 URL
        （S3 模式给预签名直链，本地模式给 /uploads 静态代理地址） */
  const refExt = extFromMime(decoded.mime) || 'mp3';
  const refName = `ref-${Date.now()}-${randomToken()}.${refExt}`;
  await mediaStore.put('media', refName, decoded.buffer, decoded.mime || 'audio/mpeg');
  const refUrl = mediaStore.absoluteUrl('media', refName, publicOrigin(req));

  const speed = Number(body.speed);
  const rate = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;

  const payload = {
    source_audio_url: refUrl,
    text,
    format: 'mp3',
    model_id: 'fishaudio-s21pro-flash',
  };
  if (rate !== 1) payload.speed = rate;

  /* 2. 创建 voice-clone 异步任务 */
  const idemKey = `clone-${Date.now()}-${randomToken()}`;
  let upstream;
  try {
    upstream = await fetchWithTimeout(
      `${FISH_BASE}/speech/voice-clone-tts/jobs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify(payload),
      },
      60000,
    );
  } catch (err) {
    throw jsonError(502, 'Fish Audio 请求失败', err.message ? String(err.message).slice(0, 160) : '网络异常，请稍后重试');
  }

  if (!upstream.ok) {
    const raw = await upstream.text();
    throw jsonError(upstream.status, 'Fish Audio 克隆失败', apiErrorText(upstream.status, raw));
  }

  const createData = await upstream.json();
  const task = createData.task || createData.job || createData;
  const jobId = task.taskId || task.jobId || task.id;
  assert(jobId, 502, 'Fish Audio 未返回任务 ID', '请检查 API Key 额度');

  /* 3. 轮询任务直到完成 */
  const done = await pollFishJob(apiKey, jobId, 180000);

  /* 4. 下载生成的音频 */
  const audioUrl = done.audioUrl || done.audio_url || done.url || (done.result && done.result.url) || '';
  assert(audioUrl, 502, 'Fish Audio 未返回音频地址', '任务完成但无输出');

  const media = await fetchWithTimeout(audioUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 60000);
  if (!media.ok) throw jsonError(502, '下载克隆音频失败', 'HTTP ' + media.status);

  const audioBuffer = Buffer.from(await media.arrayBuffer());
  assert(audioBuffer.length > 0, 502, 'Fish Audio 返回空音频', '请检查 API Key 额度或参考音频质量');

  /* 清理参考音频（可选，保留也无妨） */
  mediaStore.remove('media', refName).catch(() => {});

  const fileName = `${Date.now()}-${randomToken()}.mp3`;
  const saved = await mediaStore.put('media', fileName, audioBuffer, 'audio/mpeg');
  const duration = Math.max(1, Math.round(text.length / 4 / 3));

  res.json({ url: saved.url, duration, engine: 'fish-audio' });
}));

/* ---------- 声音列表（给前端下拉用） ---------- */

router.get('/voices', wrap(async (req, res) => {
  res.json({ voices: edgetts.listVoices() });
}));

module.exports = router;
