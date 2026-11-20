'use strict';

/* =============================================================
 * Edge-TTS 封装（基于 node-edge-tts，已支持 Sec-MS-GEC v2 鉴权）
 * 完全免费 · 无 API Key · 200+ 声音 · 50+ 语言
 * 对外接口与旧版一致：synthesize / listVoices / resolveVoice / resolveFormat
 * ============================================================= */

const { EdgeTTS } = require('node-edge-tts');

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

const FORMATS = [
  'audio-24khz-48kbitrate-mono-mp3',
  'audio-24khz-160kbitrate-mono-mp3',
  'audio-48khz-192kbitrate-mono-mp3',
  'audio-16khz-128kbitrate-mono-mp3',
  'audio-16khz-64kbitrate-mono-mp3',
  'riff-24khz-16bit-mono-pcm',
  'riff-16khz-16bit-mono-pcm',
];

/* 内置常用声音表（与旧版一致，避免每次请求在线列表） */
const VOICES = [
  { locale: 'zh-CN', name: 'zh-CN-XiaoxiaoNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-YunxiNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunjianNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-XiaoyiNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-XiaohanNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-XiaokunNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunyangNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunhaoNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-XiaoxuanNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-YunxiNeural', gender: 'Male' },
  { locale: 'zh-TW', name: 'zh-TW-HsiaoChenNeural', gender: 'Female' },
  { locale: 'zh-TW', name: 'zh-TW-YunJheNeural', gender: 'Male' },
  { locale: 'en-US', name: 'en-US-AriaNeural', gender: 'Female' },
  { locale: 'en-US', name: 'en-US-JennyNeural', gender: 'Female' },
  { locale: 'en-US', name: 'en-US-GuyNeural', gender: 'Male' },
  { locale: 'en-US', name: 'en-US-DavisNeural', gender: 'Male' },
  { locale: 'en-US', name: 'en-US-TonyNeural', gender: 'Male' },
  { locale: 'en-GB', name: 'en-GB-SoniaNeural', gender: 'Female' },
  { locale: 'en-GB', name: 'en-GB-ThomasNeural', gender: 'Male' },
  { locale: 'ja-JP', name: 'ja-JP-NanamiNeural', gender: 'Female' },
  { locale: 'ja-JP', name: 'ja-JP-KeitaNeural', gender: 'Male' },
  { locale: 'ko-KR', name: 'ko-KR-SunHiNeural', gender: 'Female' },
  { locale: 'ko-KR', name: 'ko-KR-InJoonNeural', gender: 'Male' },
  { locale: 'fr-FR', name: 'fr-FR-DeniseNeural', gender: 'Female' },
  { locale: 'fr-FR', name: 'fr-FR-HenriNeural', gender: 'Male' },
  { locale: 'de-DE', name: 'de-DE-KatjaNeural', gender: 'Female' },
  { locale: 'de-DE', name: 'de-DE-ConradNeural', gender: 'Male' },
  { locale: 'es-ES', name: 'es-ES-ElviraNeural', gender: 'Female' },
  { locale: 'es-ES', name: 'es-ES-AlvaroNeural', gender: 'Male' },
  { locale: 'ru-RU', name: 'ru-RU-SvetlanaNeural', gender: 'Female' },
  { locale: 'ru-RU', name: 'ru-RU-DmitryNeural', gender: 'Male' },
  { locale: 'it-IT', name: 'it-IT-ElsaNeural', gender: 'Female' },
  { locale: 'it-IT', name: 'it-IT-LucaNeural', gender: 'Male' },
  { locale: 'pt-BR', name: 'pt-BR-FranciscaNeural', gender: 'Female' },
  { locale: 'pt-BR', name: 'pt-BR-AntonioNeural', gender: 'Male' },
  { locale: 'nl-NL', name: 'nl-NL-FennaNeural', gender: 'Female' },
  { locale: 'ar-SA', name: 'ar-SA-ZariyahNeural', gender: 'Female' },
  { locale: 'th-TH', name: 'th-TH-AcharaNeural', gender: 'Female' },
  { locale: 'vi-VN', name: 'vi-VN-HoaiMyNeural', gender: 'Female' },
  { locale: 'hi-IN', name: 'hi-IN-SwaraNeural', gender: 'Female' },
];

/* 从环境变量读取代理（沙箱/内网环境需要，Render 等公网环境无代理则自动直连） */
function detectProxy() {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || undefined;
}

/* ========== 主合成函数 ========== */
async function synthesize({ text, voice = DEFAULT_VOICE, format = DEFAULT_FORMAT, rate = '+0%', volume = '+0%', pitch = '+0Hz', timeout = 30000 } = {}) {
  if (!text || String(text).trim().length === 0) {
    throw new Error('Edge-TTS: text is empty');
  }
  text = String(text).trim().slice(0, 5000);

  const tts = new EdgeTTS({
    voice,
    outputFormat: format,
    rate,
    volume,
    pitch,
    timeout,
    proxy: detectProxy(),
  });

  const chunks = [];
  let size = 0;
  for await (const chunk of tts.streamAudio(text)) {
    if (Buffer.isBuffer(chunk) && chunk.length > 0) {
      chunks.push(chunk);
      size += chunk.length;
    }
  }

  if (size === 0) throw new Error('Edge-TTS: no audio data received');
  return { audio: Buffer.concat(chunks), format, voice, size };
}

/* ========== 导出工具函数 ========== */

function listVoices() {
  return VOICES.map((v) => ({
    name: v.name,
    locale: v.locale,
    language: v.locale.split('-')[0],
    gender: v.gender,
  }));
}

function resolveVoice(input) {
  if (!input) return DEFAULT_VOICE;
  const name = String(input).trim();
  const hit = VOICES.find((v) => v.name === name);
  return hit ? hit.name : DEFAULT_VOICE;
}

function resolveFormat(input) {
  if (!input) return DEFAULT_FORMAT;
  const s = String(input).toLowerCase().trim();
  if (FORMATS.includes(s)) return s;
  if (s === 'mp3') return 'audio-24khz-48kbitrate-mono-mp3';
  if (s === 'mp3-high') return 'audio-24khz-160kbitrate-mono-mp3';
  if (s === 'mp3-low') return 'audio-16khz-64kbitrate-mono-mp3';
  if (s === 'wav' || s === 'pcm') return 'riff-24khz-16bit-mono-pcm';
  return DEFAULT_FORMAT;
}

module.exports = {
  synthesize,
  listVoices,
  resolveVoice,
  resolveFormat,
  DEFAULT_VOICE,
  DEFAULT_FORMAT,
  FORMATS,
};
