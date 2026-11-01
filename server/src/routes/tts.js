'use strict';

/* =============================================================
 * 工作流 TTS 路由
 *  1. 声音设计：Edge-TTS（免费，无需 Key）—— 文本 → 语音
 *  2. 语音克隆：Fish Audio（需用户自备 API Key）—— 参考音频 + 文本 → 克隆语音
 * 返回 { url: '/uploads/media/xxx.mp3', duration }
 * ============================================================= */

const path = require('path');
const fsp = require('fs').promises;
const express = require('express');
const edgetts = require('../edgetts');
const store = require('../store');
const {
  jsonError,
  assert,
  wrap,
  fetchWithTimeout,
  apiErrorText,
  dataUrlToBuffer,
  randomToken,
} = require('../http');

const router = express.Router();

const FISH_BASE = 'https://api.fish.audio/v1';
const MAX_TEXT = 2000;
const MAX_REF_BYTES = 10 * 1024 * 1024;

/* ---------- 工具 ---------- */

/* 从 data URL 提取 base64（去掉 data:audio/xxx;base64, 前缀） */
function dataUrlToBase64(dataUrl) {
  const comma = String(dataUrl).indexOf(',');
  if (comma < 0) throw jsonError(400, '参考音频格式不正确', '需为 data URL');
  return String(dataUrl).slice(comma + 1);
}

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
    throw jsonError(502, 'Edge-TTS 合成失败', err.message ? String(err.message).slice(0, 160) : '微软端点繁忙，请稍后重试');
  }

  const fileName = `${Date.now()}-${randomToken()}.mp3`;
  await fsp.writeFile(path.join(store.dirs.media, fileName), result.audio);
  const duration = Math.max(1, Math.round(text.length / 4 / 3));

  res.json({ url: `/uploads/media/${fileName}`, duration, voice, engine: 'edgetts' });
}));

/* ---------- 语音克隆：Fish Audio ---------- */

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

  const refText = String(body.referenceText || '').trim();
  /* Fish Audio zero-shot 克隆需要参考音频的对应文本；留空时用一个占位（效果会下降） */
  const refTranscript = refText || '这是一段参考音频。';

  const audioBase64 = dataUrlToBase64(refAudio);
  const speed = Number(body.speed);
  const rate = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;

  const payload = {
    text,
    references: [{ audio: audioBase64, text: refTranscript }],
    format: 'mp3',
    latency: 'normal',
  };
  if (rate !== 1) payload.speed = rate;

  let upstream;
  try {
    upstream = await fetchWithTimeout(
      `${FISH_BASE}/tts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      120000,
    );
  } catch (err) {
    throw jsonError(502, 'Fish Audio 请求失败', err.message ? String(err.message).slice(0, 160) : '网络异常，请稍后重试');
  }

  if (!upstream.ok) {
    const raw = await upstream.text();
    throw jsonError(upstream.status, 'Fish Audio 克隆失败', apiErrorText(upstream.status, raw));
  }

  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
  let audioBuffer;
  if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
    audioBuffer = Buffer.from(await upstream.arrayBuffer());
  } else {
    /* 某些情况下返回 JSON 包含 url */
    const data = JSON.parse(await upstream.text());
    const url = (data && data.url) || (data && data.data && data.data.url) || '';
    if (!url) throw jsonError(502, 'Fish Audio 未返回音频', '请检查 API Key 与参考音频');
    const media = await fetchWithTimeout(url, {}, 60000);
    if (!media.ok) throw jsonError(502, '下载音频失败', 'HTTP ' + media.status);
    audioBuffer = Buffer.from(await media.arrayBuffer());
  }

  assert(audioBuffer && audioBuffer.length > 0, 502, 'Fish Audio 返回空音频', '请检查 API Key 额度或参考音频质量');

  const fileName = `${Date.now()}-${randomToken()}.mp3`;
  await fsp.writeFile(path.join(store.dirs.media, fileName), audioBuffer);
  const duration = Math.max(1, Math.round(text.length / 4 / 3));

  res.json({ url: `/uploads/media/${fileName}`, duration, engine: 'fish-audio' });
}));

/* ---------- 声音列表（给前端下拉用） ---------- */

router.get('/voices', wrap(async (req, res) => {
  res.json({ voices: edgetts.listVoices() });
}));

module.exports = router;
