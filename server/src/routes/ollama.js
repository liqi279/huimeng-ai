'use strict';

const express = require('express');
const { Readable } = require('stream');

const router = express.Router();

/* Ollama 上游地址（可通过环境变量 OLLAMA_BASE 覆盖）。
 * 默认指向本机 11434，与桌宠 / 播放器默认设置一致。 */
const OLLAMA_BASE = String(process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').replace(/\/+$/, '');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length'
]);

function stripPrefix(originalUrl) {
  const idx = originalUrl.indexOf('/ollama');
  if (idx < 0) return '/';
  const rest = originalUrl.slice(idx + '/ollama'.length);
  return rest.startsWith('/') ? rest : '/' + rest;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

router.all('*', async (req, res) => {
  const target = OLLAMA_BASE + stripPrefix(req.originalUrl);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 推理较慢，给 5 分钟

  try {
    const body = await readBody(req);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'follow'
    });

    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      res.setHeader(key, value);
    }

    if (upstream.body == null) {
      res.end();
      return;
    }
    const readable = Readable.fromWeb(upstream.body);
    readable.pipe(res);
    readable.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: '读取 Ollama 响应失败' });
      else res.end();
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      res.status(504).json({ error: 'Ollama 响应超时（超过 5 分钟）' });
      return;
    }
    const code = err && err.code;
    const message = code === 'ECONNREFUSED'
      ? '无法连接本机 Ollama（127.0.0.1:11434）。请先在终端执行：ollama serve'
      : ('连接 Ollama 失败：' + (err && err.message || err));
    res.status(502).json({ error: message, hint: '确保本机已启动 Ollama 并监听 11434 端口' });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
