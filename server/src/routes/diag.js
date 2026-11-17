'use strict';

/* =============================================================
 * 只读出网探针（临时排障用，定位「上游网络请求失败」到底断在哪一层）
 * -------------------------------------------------------------
 *   GET /api/diag/net   需带请求头 x-hm-diag: 1，否则一律 404
 *
 * 不做任何写入，不回显任何密钥；只报告 DNS / TCP / TLS / HTTPS 各段的
 * 耗时与错误码，用来区分「解析不到 / 连不上 / 握手失败 / 上游拒答」。
 * ============================================================= */

const dns = require('dns');
const https = require('https');
const net = require('net');
const tls = require('tls');
const express = require('express');
const { wrap } = require('../http');

const router = express.Router();

function ms(start) { return Date.now() - start; }

function resolveAll(host) {
  const start = Date.now();
  return new Promise((resolve) => {
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err) {
        resolve({ ok: false, ms: ms(start), code: err.code || '', message: err.message || String(err) });
        return;
      }
      resolve({
        ok: true,
        ms: ms(start),
        addresses: (addrs || []).map((a) => a.address + '/' + a.family).slice(0, 20),
        count: (addrs || []).length,
      });
    });
  });
}

function tcpProbe(host, ip, port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip || host, port, family: ip && ip.indexOf(':') >= 0 ? 6 : 4 });
    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) {}
      resolve(Object.assign({ ip: ip || host, port, ms: ms(start) }, result));
    }
    socket.setTimeout(timeoutMs || 5000);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, code: 'TCP_TIMEOUT' }));
    socket.once('error', (err) => finish({ ok: false, code: err.code || '', message: err.message || String(err) }));
  });
}

function httpsProbe(host, path, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(Object.assign({ ms: ms(start) }, result));
    }
    const req = https.request({ method: 'GET', hostname: host, path: path || '/', timeout: timeoutMs || 8000 }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => finish({ ok: true, status: res.statusCode, bytes }));
    });
    req.on('timeout', () => req.destroy(new Error('https timeout')));
    req.on('error', (err) => finish({ ok: false, code: err.code || '', message: err.message || String(err) }));
    req.end();
  });
}

router.get('/diag/net', wrap(async (req, res) => {
  if (String(req.get('x-hm-diag') || '') !== '1') {
    res.status(404).json({ error: { message: 'not found' } });
    return;
  }
  const targets = [
    { host: 'www.rayinai.com', path: '/' },
    { host: 'scf.tencentcloudapi.com', path: '/' },
    { host: 'api.github.com', path: '/' },
  ];
  const out = { node: process.version, at: new Date().toISOString(), targets: {} };
  for (const t of targets) {
    const d = await resolveAll(t.host);
    const item = { dns: d };
    if (d.ok) {
      const ips = (d.addresses || []).map((a) => a.split('/')[0]).slice(0, 3);
      item.tcp = [];
      for (const ip of ips) item.tcp.push(await tcpProbe(t.host, ip, 443, 5000));
      item.https = await httpsProbe(t.host, t.path, 8000);
    }
    out.targets[t.host] = item;
  }
  res.json(out);
}));

module.exports = router;
