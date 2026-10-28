'use strict';

const express = require('express');
const {
  HttpError,
  jsonError,
  wrap,
  assert,
  fetchWithTimeout,
} = require('../http');

const PROMPT_PREFIX = 'Translate the following Chinese image prompt into concise English image-generation keywords. Output only the English text:\n';
const CHINESE = /[\u4e00-\u9fff]/;

const router = express.Router();

router.post('/translate', wrap(async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  assert(text, 400, '请输入需要翻译的文本', 'text 不能为空');

  const usePrompt = PROMPT_PREFIX + text;
  const url = `https://text.pollinations.ai/${encodeURIComponent(usePrompt)}`;

  let output = '';
  try {
    const response = await fetchWithTimeout(url, { headers: { Accept: 'text/plain' } }, 20000);
    const raw = await response.text();
    if (!response.ok) {
      throw jsonError(502, '翻译服务暂不可用', `Pollinations 返回 HTTP ${response.status}`);
    }
    output = raw.trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw jsonError(502, '翻译服务暂不可用', '网络异常，请稍后重试');
  }

  assert(output, 502, '翻译结果为空', '请稍后重试');
  assert(!CHINESE.test(output), 502, '翻译结果仍含中文', '请稍后重试');
  res.json({ text: output });
}));

module.exports = router;
