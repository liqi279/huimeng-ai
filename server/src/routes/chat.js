'use strict';

/* ============================================================
 * /api/chat — LLM 聊天代理
 * 将前端请求转发到 OpenAI 兼容的 Chat Completions 接口，
 * 支持流式（SSE）。解决浏览器直接调用大模型 API 的 CORS 问题。
 * 前端传入：baseUrl / apiKey / model / messages / stream / temperature / maxTokens
 * ============================================================ */

const express = require('express');
const { jsonError, wrap, assert } = require('../http');

const router = express.Router();

function normalizeBaseUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  // 去掉末尾的 /v1 或斜杠，统一在调用时拼 /chat/completions
  u = u.replace(/\/+$/g, '');
  if (/\/v1$/i.test(u)) u = u.replace(/\/v1$/i, '');
  return u;
}

router.post('/chat', wrap(async (req, res) => {
  const body = req.body || {};
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const stream = body.stream !== false;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
  const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : 2048;

  assert(baseUrl, 400, '缺少模型服务地址', 'baseUrl 不能为空');
  assert(apiKey, 400, '缺少 API Key', 'apiKey 不能为空');
  assert(model, 400, '缺少模型名称', 'model 不能为空');
  assert(messages.length > 0, 400, '缺少对话消息', 'messages 不能为空');

  const endpoint = baseUrl + '/v1/chat/completions';

  const payload = {
    model: model,
    messages: messages.map(function (m) {
      return { role: m.role, content: m.content };
    }),
    temperature: temperature,
    max_tokens: maxTokens,
    stream: stream
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + apiKey
  };

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw jsonError(502, '连接模型服务失败', String(err && err.message || err));
  }

  if (!upstream.ok) {
    let detail = '';
    try { detail = await upstream.text(); } catch (e) {}
    throw jsonError(upstream.status, '模型服务返回错误', detail.slice(0, 500));
  }

  if (!stream) {
    const data = await upstream.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ content: text || '' });
    return;
  }

  // 流式：透传 SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('data: ')) {
          res.write(line + '\n\n');
        } else if (line) {
          res.write(line + '\n');
        }
      }
    }
    if (buffer) res.write(buffer + '\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    try { res.end(); } catch (e) {}
  }
}));

module.exports = router;
