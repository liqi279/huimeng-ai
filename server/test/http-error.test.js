'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || 'test-only-token-secret';
const { apiErrorText } = require('../src/http');

test('replaces an upstream HTML 504 page with a short gateway error', () => {
  const html = '<!DOCTYPE html><html><body>gateway timeout</body></html>';
  const message = apiErrorText(504, html);
  assert.equal(message, '上游网关超时（HTTP 504）');
  assert.equal(message.includes('<html'), false);
});

test('keeps readable JSON API errors', () => {
  assert.equal(apiErrorText(401, JSON.stringify({ error: { message: 'invalid api key' } })), '上游接口错误（401）：invalid api key');
});
