'use strict';

/* =============================================================
 * Edge-TTS WebSocket Client v2
 * 与 Python edge-tts (rany2/edge-tts) 协议完全对齐
 * 参考：https://github.com/rany2/edge-tts/blob/master/edge_tts/protocol.py
 *
 * 完全免费 · 无 API Key · 200+ 声音 · 50+ 语言
 * WebSocket 协议：每条消息 = 4字节LE长度 + 2字节头(type+resv) + body
 * ============================================================= */

const WebSocket = require('ws');
const crypto = require('crypto');

/* 经典端点 speech.platform.bing.com 2025-10 起大量返回 403/401（微软换了签名算法）
 * 新端点 api.msedgeservices.com 完全兼容同样的 BJSON 协议 —— FluentVoice / edge-tts npm 最新版都已切换 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`;
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

/* BJSON 消息类型 */
const MESSAGE_TYPES = {
  COMMAND: 0x01,      /* JSON 命令消息 */
  AUDIO: 0x02,        /* 音频二进制 */
  TURN_END: 0x03,     /* 合成完成 */
  ERROR: 0x04,        /* 错误 */
  AUDIO_CONFIG: 0x05, /* 音频元数据（跳过） */
};

function uuid() { return crypto.randomBytes(16).toString('hex'); }

/* 构造一条 BJSON 消息 */
function buildMessage(type, body) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  /* 4 字节 length (不包含这 4 字节自身) = 2 (header) + body 长度 */
  const length = 2 + bodyBuf.length;
  const buf = Buffer.alloc(4 + length);
  buf.writeUInt32LE(length, 0);
  buf.writeUInt8(type, 4);
  buf.writeUInt8(0, 5);
  if (bodyBuf.length) bodyBuf.copy(buf, 6);
  return buf;
}

/* 从一个大 buffer 里解析所有完整消息，返回 { messages, rest } */
function parseMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 6 <= buffer.length) {
    const payloadLen = buffer.readUInt32LE(offset); /* 2 (header) + body length */
    const totalLen = 4 + payloadLen;               /* 4 (length) + 2 (header) + body */
    if (offset + totalLen > buffer.length) break;   /* 消息不完整，等下一个 chunk */
    const type = buffer.readUInt8(offset + 4);
    const reserved = buffer.readUInt8(offset + 5);
    const body = buffer.slice(offset + 6, offset + totalLen);
    messages.push({ type, reserved, body });
    offset += totalLen;
  }
  return { messages, rest: buffer.slice(offset) };
}

/* 硬编码声音表（完整列表请求 voices/list 端点需要认证，这里内置常用的） */
const VOICES = [
  { locale: 'zh-CN', name: 'zh-CN-XiaoxiaoNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-YunxiNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunjianNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-XiaoyiNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-XiaohanNeural', gender: 'Female' },
  { locale: 'zh-CN', name: 'zh-CN-XiaokunNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunyangNeural', gender: 'Male' },
  { locale: 'zh-CN', name: 'zh-CN-YunhaoNeural', gender: 'Male' },
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

/* ========== 主合成函数 ========== */
function synthesize({ text, voice = DEFAULT_VOICE, format = DEFAULT_FORMAT, rate = '+0%', volume = '+0%', pitch = '+0Hz', timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!text || String(text).trim().length === 0) {
      reject(new Error('Edge-TTS: text is empty'));
      return;
    }
    text = String(text).trim().slice(0, 5000); /* 单段最长 5000 字符 */

    const requestId = uuid();
    const ws = new WebSocket(WSS_URL, {
      protocol: 'speech.v1',
      headers: {
        /* 最新版 edge-tts npm / FluentVoice 使用的 Edge extension ID + User-Agent */
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      },
      timeout: timeout,
      handshakeTimeout: 10000,
    });

    const audioChunks = [];
    let audioSize = 0;
    let settled = false;
    let timer = null;
    let restBuffer = Buffer.alloc(0);

    function cleanup(err) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws.removeAllListeners(); } catch (e) {}
      try { ws.close(); } catch (e) {}
      if (err) reject(err);
      else {
        if (audioSize === 0) reject(new Error('Edge-TTS: no audio data received'));
        else resolve({ audio: Buffer.concat(audioChunks), format, voice, size: audioSize });
      }
    }

    ws.on('open', () => {
      /* Step 1: 发送配置 JSON（Command 消息） */
      const configJson = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: false,
                wordBoundaryEnabled: false,
              },
              outputFormat: format,
            },
          },
        },
      });
      ws.send(buildMessage(MESSAGE_TYPES.COMMAND, Buffer.from(configJson, 'utf8')));

      /* Step 2: 发送合成请求 JSON */
      const synthJson = JSON.stringify({
        requestId: requestId,
        text: text,
        voice: voice,
        rate: rate,
        volume: volume,
        pitch: pitch,
      });
      ws.send(buildMessage(MESSAGE_TYPES.COMMAND, Buffer.from(synthJson, 'utf8')));

      /* 超时保护 */
      timer = setTimeout(() => {
        cleanup(new Error('Edge-TTS: synthesize timeout after ' + timeout + 'ms'));
      }, timeout);
    });

    ws.on('message', (raw) => {
      try {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        restBuffer = Buffer.concat([restBuffer, chunk]);

        while (true) {
          const { messages, rest } = parseMessages(restBuffer);
          restBuffer = rest;

          if (messages.length === 0) break; /* 不够解析一条完整消息，等下一次 */

          for (const msg of messages) {
            if (msg.type === MESSAGE_TYPES.AUDIO) {
              /*
                Audio body 格式：
                Path:audio\r\n
                Content-Type:audio/mp3\r\n
                ...\r\n
                \r\n           <-- header 结束
                [binary data]
              */
              const bodyStr = msg.body.toString('latin1');
              const sep = bodyStr.indexOf('\r\n\r\n');
              let audioData;
              if (sep >= 0) {
                audioData = msg.body.slice(sep + 4);
              } else {
                /* 没有 header，整个 body 就是音频 */
                audioData = msg.body;
              }
              if (audioData.length > 0) {
                audioChunks.push(audioData);
                audioSize += audioData.length;
              }
            } else if (msg.type === MESSAGE_TYPES.TURN_END) {
              /* "turn.end" 消息 = 合成完成 */
              cleanup(null);
              return;
            } else if (msg.type === MESSAGE_TYPES.ERROR) {
              let errText = 'Edge-TTS error';
              try { errText = msg.body.toString('utf8').slice(0, 200); } catch (e) {}
              cleanup(new Error(errText));
              return;
            }
            /* COMMAND / AUDIO_CONFIG / 其他 → 忽略 */
          }
        }
      } catch (err) {
        /* 中间帧解析失败忽略即可 */
      }
    });

    ws.on('close', () => {
      if (!settled) {
        if (audioSize > 0) cleanup(null);
        else cleanup(new Error('Edge-TTS: connection closed without audio'));
      }
    });

    ws.on('error', (err) => {
      if (!settled) cleanup(new Error('Edge-TTS WebSocket: ' + (err.code || err.message || 'unknown')));
    });
  });
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
