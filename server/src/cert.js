'use strict';

/* =============================================================
 * 自签证书工具：首次启动时自动生成本地 HTTPS 证书
 * 依赖系统 openssl（若不可用则跳过 HTTPS）
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const certDir = path.join(__dirname, '..', 'data', 'cert');
const certPath = path.join(certDir, 'cert.pem');
const keyPath = path.join(certDir, 'key.pem');

function exists() {
  return fs.existsSync(certPath) && fs.existsSync(keyPath);
}

function generate() {
  if (exists()) return true;
  try {
    fs.mkdirSync(certDir, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '3650', '-nodes',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'pipe' });
    return true;
  } catch (err) {
    console.warn('[cert] 自动生成 HTTPS 证书失败（可能未安装 openssl）：', err.message);
    return false;
  }
}

function load() {
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

module.exports = { certDir, certPath, keyPath, exists, generate, load };
