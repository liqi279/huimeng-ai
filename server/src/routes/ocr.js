'use strict';

/* 翻译代理：POST /api/ocr/translate
 * 免 key 渠道降级链（参考 pot-desktop）：Bing(Edge auth) → Google(gtx/translate) → Yandex → DeepL(web)
 * 语言白名单 + 长度上限 + 单 IP 限流；整条链路 8 秒上限。 */

const express = require('express');
const { jsonError, wrap, assert, fetchWithTimeout } = require('../http');

const MAX_CHARS = 2000;
const DEADLINE_MS = 8000;
const ATTEMPT_MIN = 1200;
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const LANGS = new Set([
  'zh-CN', 'zh-TW', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it',
  'ru', 'ar', 'th', 'vi', 'id', 'ms', 'tr', 'nl', 'pl', 'uk', 'hi',
]);

const hits = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now >= rec.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (rec.n >= RATE_LIMIT) return false;
  rec.n += 1;
  return true;
}
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of hits) if (now >= rec.resetAt) hits.delete(key);
}, RATE_WINDOW);
if (sweeper.unref) sweeper.unref();

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function guessSource(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  return 'en';
}

/* ---------- Bing / Edge 免费接口 ---------- */
let bingToken = { value: '', exp: 0 };
async function bingTokenGet(timeoutMs) {
  if (bingToken.value && Date.now() < bingToken.exp) return bingToken.value;
  const res = await fetchWithTimeout('https://edge.microsoft.com/translate/auth', {
    headers: { 'User-Agent': UA, Accept: '*/*' },
  }, timeoutMs);
  if (!res.ok) throw new Error('auth HTTP ' + res.status);
  const token = (await res.text()).trim();
  if (!token) throw new Error('auth 空 token');
  bingToken = { value: token, exp: Date.now() + 8 * 60 * 1000 };
  return token;
}

function bingLang(code) {
  if (code === 'zh-CN' || code === 'zh') return 'zh-Hans';
  if (code === 'zh-TW') return 'zh-Hant';
  return code;
}

async function bingTranslate(q, from, to, timeoutMs) {
  const token = await bingTokenGet(timeoutMs);
  const src = from === 'auto' ? '' : bingLang(from);
  const url = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0'
    + (src ? '&from=' + encodeURIComponent(src) : '')
    + '&to=' + encodeURIComponent(bingLang(to));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify([{ Text: q }]),
  }, timeoutMs);
  if (!res.ok) {
    bingToken = { value: '', exp: 0 };
    throw new Error('HTTP ' + res.status);
  }
  const data = await res.json();
  const text = data && data[0] && data[0].translations && data[0].translations[0]
    ? String(data[0].translations[0].text || '').trim()
    : '';
  if (!text) throw new Error('返回内容为空');
  return text;
}

/* ---------- Google ---------- */
async function googleTranslate(q, from, to, host, timeoutMs) {
  const url = 'https://' + host + '/translate_a/single?client=gtx'
    + '&sl=' + encodeURIComponent(from) + '&tl=' + encodeURIComponent(to)
    + '&dt=t&q=' + encodeURIComponent(q);
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://translate.google.com/',
      'User-Agent': UA,
    },
  }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const segs = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const text = segs.map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : '')).join('').trim();
  if (!text) throw new Error('返回内容为空');
  return text;
}

/* ---------- Yandex ---------- */
async function yandexTranslate(q, from, to, timeoutMs) {
  const src = from === 'auto' ? 'ja' : from;
  const dst = to === 'zh-CN' ? 'zh' : to;
  const url = 'https://translate.yandex.net/api/v1/tr.json/translate?srv=android'
    + '&id=' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000)
    + '&from=' + encodeURIComponent(src) + '&to=' + encodeURIComponent(dst)
    + '&text=' + encodeURIComponent(q);
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const text = data && Array.isArray(data.text) ? data.text.join('').trim() : '';
  if (!text) throw new Error('返回内容为空 code=' + (data && data.code));
  return text;
}

/* ---------- DeepL web（无官方 key） ---------- */
async function deeplTranslate(q, from, to, timeoutMs) {
  const lang = to === 'zh-CN' || to === 'zh' ? 'ZH' : to === 'zh-TW' ? 'ZH-HANT' : to.toUpperCase();
  const src = from === 'auto' ? (guessSource(q) || 'JA').toUpperCase() : from.toUpperCase();
  const id = Math.floor(Math.random() * 100000) + 8300000;
  const body = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    params: {
      texts: [{ text: q, requestAlternatives: 0 }],
      splitting: 'newlines',
      lang: { source_lang: src, target_lang: lang },
      timestamp: Date.now(),
    },
    id,
  };
  const res = await fetchWithTimeout('https://www2.deepl.com/jsonrpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'zh-CN',
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const t = data && data.result && data.result.texts && data.result.texts[0]
    ? String(data.result.texts[0].text || '').trim() : '';
  if (!t) throw new Error('返回内容为空');
  return t;
}

/* ---------- 降级链 ---------- */
const CHAIN = [
  ['bing', (q, f, t, ms) => bingTranslate(q, f, t, ms)],
  ['google:gtx', (q, f, t, ms) => googleTranslate(q, f, t, 'translate.googleapis.com', ms)],
  ['google:translate', (q, f, t, ms) => googleTranslate(q, f, t, 'translate.google.com', ms)],
  ['yandex', (q, f, t, ms) => yandexTranslate(q, f, t, ms)],
  ['deepl', (q, f, t, ms) => deeplTranslate(q, f, t, ms)],
];

async function runChain(q, from, to) {
  const startedAt = Date.now();
  const budget = (min) => Math.max(min, DEADLINE_MS - (Date.now() - startedAt));
  const failures = [];
  for (const [name, run] of CHAIN) {
    if (Date.now() - startedAt >= DEADLINE_MS) {
      failures.push(name + ': 未尝试(超时)');
      continue;
    }
    try {
      const text = await run(q, from, to, budget(ATTEMPT_MIN));
      if (text) return { text, provider: name, failures };
    } catch (err) {
      failures.push(name + ' ' + (err && err.message));
    }
  }
  return { text: '', provider: '', failures };
}

const router = express.Router();

/* 临时探测端点：逐渠道返回状态码/耗时/译文，用于线上实测，交付后删除 */
router.post('/ocr/_probe', wrap(async (req, res) => {
  const q = String((req.body && req.body.q) || '').slice(0, 2000);
  assert(q, 400, 'q 不能为空');
  const out = [];
  for (const [name, run] of CHAIN) {
    const t0 = Date.now();
    try {
      const text = await run(q, 'auto', 'zh-CN', 8000);
      out.push({ name, ok: true, ms: Date.now() - t0, text });
    } catch (err) {
      out.push({ name, ok: false, ms: Date.now() - t0, error: String(err && err.message) });
    }
  }
  res.json({ results: out });
}));

router.post('/ocr/translate', wrap(async (req, res) => {
  if (!rateLimitOk(clientIp(req))) {
    throw jsonError(429, '请求过于频繁', `单 IP 每分钟最多 ${RATE_LIMIT} 次翻译请求`);
  }
  const body = req.body || {};
  assert(typeof body.q === 'string', 400, '参数 q 必须是字符串', '请求体形如 {"q":"文本"}');
  const q = body.q.trim();
  assert(q, 400, '请输入需要翻译的文本', 'q 不能为空');
  assert(q.length <= MAX_CHARS, 413, '文本过长', `单次最多 ${MAX_CHARS} 个字符`);

  const from = body.from == null || body.from === '' ? 'auto' : String(body.from);
  const to = body.to == null || body.to === '' ? 'zh-CN' : String(body.to);
  assert(from === 'auto' || LANGS.has(from), 400, '不支持的语言代码', 'from 只接受 auto 或白名单语言代码');
  assert(to !== 'auto' && LANGS.has(to), 400, '不支持的语言代码', 'to 只接受白名单语言代码');

  const { text, failures } = await runChain(q, from, to);
  if (!text) {
    console.error('[ocr-translate] 上游全部失败：' + failures.join(' | '));
    throw jsonError(502, '翻译服务暂不可用', '上游均失败（' + failures.join('；').slice(0, 180) + '）');
  }
  res.json({ text });
}));

module.exports = router;
