'use strict';

/* 翻译代理：国内直连 Google 翻译不通，由服务端出网转发。
 * 主路 translate.googleapis.com（client=gtx），失败兜底 MyMemory；
 * 只接受语言代码白名单，不拼接任何用户可控 URL，因此不是开放代理。 */

const express = require('express');
const {
  jsonError,
  wrap,
  assert,
  fetchWithTimeout,
} = require('../http');

const MAX_CHARS = 2000;          /* 单次请求最大字符数 */
const UPSTREAM_TIMEOUT = 8000;   /* 整条链路 8 秒上限 */
const ATTEMPT_MIN = 1200;        /* 单次尝试最小预算 */
const RATE_LIMIT = 30;           /* 单 IP 每窗口次数 */
const RATE_WINDOW = 60 * 1000;   /* 窗口 60 秒 */

/* 语言代码白名单：只允许这些值进入上游 URL */
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

/* 定期清理过期计数，避免 Map 无限增长（unref 不阻塞进程退出） */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of hits) {
    if (now >= rec.resetAt) hits.delete(key);
  }
}, RATE_WINDOW);
if (sweeper.unref) sweeper.unref();

function clientIp(req) {
  /* Render 前置代理会带 X-Forwarded-For；浏览器无法伪造该头，取第一段即可 */
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* MyMemory 不支持 auto，按字符集粗略判源语言（仅兜底用） */
function guessSource(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  return 'en';
}

async function googleTranslate(q, from, to, host, timeoutMs) {
  const url = 'https://' + host + '/translate_a/single?client=gtx'
    + '&sl=' + encodeURIComponent(from)
    + '&tl=' + encodeURIComponent(to)
    + '&dt=t&q=' + encodeURIComponent(q);
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://translate.google.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const text = segments
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
    .trim();
  if (!text) throw new Error('返回内容为空');
  return text;
}

async function myMemoryTranslate(q, from, to, timeoutMs) {
  const src = from === 'auto' ? guessSource(q) : from;
  if (src === to) throw new Error('源语言与目标语言相同');
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q)
    + '&langpair=' + encodeURIComponent(src + '|' + to);
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const text = data && data.responseData && typeof data.responseData.translatedText === 'string'
    ? data.responseData.translatedText.trim()
    : '';
  if (!text || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(text)) {
    throw new Error('返回内容不可用');
  }
  return text;
}

const router = express.Router();

router.post('/ocr/translate', wrap(async (req, res) => {
  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
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

  const failures = [];
  let text = '';
  const startedAt = Date.now();
  const budget = (min) => Math.max(min, UPSTREAM_TIMEOUT - (Date.now() - startedAt));

  /* 主路：Google gtx（两个入口），兜底 MyMemory；整条链路不超过 8 秒 */
  const attempts = [
    ['google:gtx', () => googleTranslate(q, from, to, 'translate.googleapis.com', budget(ATTEMPT_MIN))],
    ['google:translate', () => googleTranslate(q, from, to, 'translate.google.com', budget(ATTEMPT_MIN))],
    ['mymemory', () => myMemoryTranslate(q, from, to, budget(ATTEMPT_MIN))],
  ];
  for (const [name, run] of attempts) {
    if (Date.now() - startedAt >= UPSTREAM_TIMEOUT) {
      failures.push(name + ': 超时未尝试');
      continue;
    }
    try {
      text = await run();
      if (text) break;
    } catch (err) {
      failures.push(name + ' ' + (err && err.message));
    }
  }

  if (!text) {
    console.error('[ocr-translate] 上游全部失败：' + failures.join(' | '));
    throw jsonError(502, '翻译服务暂不可用', '上游均失败（' + failures.join('；').slice(0, 160) + '）');
  }

  res.json({ text });
}));

module.exports = router;
