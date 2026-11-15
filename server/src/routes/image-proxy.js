'use strict';

/* =============================================================
 * 图片代取（解决参考主体区跨域）
 * -------------------------------------------------------------
 * GET /api/image-proxy?url=<远程图片地址>
 * 服务端取回图片后原样返回，带正确 Content-Type 与 Cache-Control。
 *
 * 安全约束（防 SSRF）：
 *  - 只允许 http / https；
 *  - 端口只允许 80 / 443；
 *  - 域名解析后的所有 IP 必须是公网地址，禁止内网 / 本机 / 链路本地 / 元数据地址；
 *  - 重定向最多 3 跳，每一跳都重新校验目标地址。
 * 错误码：400 参数非法 / 403 目标地址被禁止 / 413 图片过大 /
 *        504 上游超时 / 502 上游失败或非图片内容。
 * ============================================================= */

const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const { jsonError, wrap } = require('../http');

const router = express.Router();

const TIMEOUT_MS = 15000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_CONTROL = 'public, max-age=86400';

const BLOCKED_HOST_SUFFIX = ['.local', '.internal', '.localhost'];
const BLOCKED_HOSTS = ['localhost', 'metadata.google.internal', 'metadata'];

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const value = String(ip || '').toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) return isPrivateIPv4(value.slice(7));
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  return false;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTS.indexOf(host) >= 0) return true;
  for (const suffix of BLOCKED_HOST_SUFFIX) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/* 解析并校验目标域名：解析失败或落到内网一律拒绝 */
async function assertAllowedTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw jsonError(400, 'url 参数不是合法地址', '需要 http:// 或 https:// 开头的完整图片地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw jsonError(400, '仅支持 http/https 图片地址');
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw jsonError(403, '目标端口不被允许', '仅允许 80 / 443');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw jsonError(403, '目标地址不被允许', '禁止访问本机或内网域名');
  }
  if (net.isIP(hostname)) {
    const bad = net.isIPv4(hostname) ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname);
    if (bad) throw jsonError(403, '目标地址不被允许', '禁止访问内网或保留地址');
    return parsed;
  }

  let records = [];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw jsonError(502, '目标域名解析失败', hostname);
  }
  if (!records.length) throw jsonError(502, '目标域名解析失败', hostname);
  for (const record of records) {
    const address = record && record.address;
    const bad = net.isIPv4(address) ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (bad) throw jsonError(403, '目标地址不被允许', '域名解析到内网或保留地址');
  }
  return parsed;
}

router.get('/image-proxy', wrap(async (req, res) => {
  const raw = String((req.query && req.query.url) || '').trim();
  if (!raw) throw jsonError(400, '缺少 url 参数', '示例：/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.png');

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertAllowedTarget(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'huimeng-image-proxy/1.0',
          Accept: 'image/*,*/*;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw jsonError(504, '上游图片请求超时', '超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒未响应');
      }
      throw jsonError(502, '上游图片请求失败', '请检查图片地址是否可访问');
    }
    clearTimeout(timer);

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) throw jsonError(502, '上游重定向缺少 Location');
      try {
        current = new URL(location, current).toString();
      } catch (err) {
        throw jsonError(502, '上游重定向地址非法');
      }
      continue;
    }

    if (!upstream.ok) {
      throw jsonError(502, '上游返回错误（HTTP ' + upstream.status + '）', '图片地址可能已失效或需要鉴权');
    }

    const contentType = String(upstream.headers.get('content-type') || '');
    if (!/^image\//i.test(contentType)) {
      throw jsonError(502, '上游返回的不是图片', contentType ? '实际类型：' + contentType.slice(0, 80) : '缺少 Content-Type');
    }

    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared && declared > MAX_BYTES) {
      throw jsonError(413, '图片体积过大', '上限 ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB');
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      throw jsonError(413, '图片体积过大', '上限 ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB');
    }
    if (!buffer.length) throw jsonError(502, '上游返回空内容');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Proxy-Source-Host', new URL(current).hostname);
    res.send(buffer);
    return;
  }

  throw jsonError(502, '重定向次数过多', '最多跟随 ' + MAX_REDIRECTS + ' 跳');
}));

module.exports = router;
