'use strict';

/* =============================================================
 * 线上函数体检（只读）：GetFunction → 打印安全的配置摘要
 * -------------------------------------------------------------
 *   COS_SECRET_ID=xxx COS_SECRET_KEY=xxx node server/scripts/scf-inspect.js
 *
 * 只调用 SCF 的 GetFunction，不改任何东西。输出做了脱敏：
 *   - 环境变量只打印「是否存在 / 长度」，不打印值
 *   - MYSQL_URL 只打印 host:port 与库名，账号密码一律抹掉
 * 因为这个仓库是公开的，workflow 日志也是公开的。
 * ============================================================= */

const crypto = require('crypto');
const https = require('https');

const HOST = 'scf.tencentcloudapi.com';
const SERVICE = 'scf';
const VERSION = '2018-04-16';

const SECRET_ID = process.env.COS_SECRET_ID || '';
const SECRET_KEY = process.env.COS_SECRET_KEY || '';
const REGION = process.env.SCF_REGION || 'ap-guangzhou';
const FUNCTION_NAME = process.env.SCF_FUNCTION || 'huimeng-api';
const NAMESPACE = process.env.SCF_NAMESPACE || 'default';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}
function hmac(key, data, enc) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(enc);
}
function tc3Headers(action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST', '/', '',
    `content-type:${contentType}\nhost:${HOST}\n`,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('TC3' + SECRET_KEY, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${SECRET_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: HOST,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': VERSION,
    'X-TC-Region': REGION,
  };
}

function call(action, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const headers = Object.assign({ 'Content-Length': Buffer.byteLength(body) }, tc3Headers(action, body));
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST', hostname: HOST, path: '/', headers, timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('非 JSON 响应: ' + text.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function maskUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol + '//' + u.hostname + ':' + (u.port || '(默认端口)') + u.pathname;
  } catch (e) {
    return '<无法解析>';
  }
}

function summarizeEnv(vars) {
  const out = {};
  for (const k of Object.keys(vars || {}).sort()) {
    const v = String(vars[k] == null ? '' : vars[k]);
    if (k === 'MYSQL_URL' || k === 'DATABASE_URL') {
      out[k] = v ? 'present -> ' + maskUrl(v) : 'empty';
    } else if (/KEY|SECRET|PASS|TOKEN|URL|BASE|HOST/i.test(k)) {
      out[k] = v ? 'present(len=' + v.length + ')' : 'empty';
    } else {
      out[k] = v.length > 60 ? v.slice(0, 60) + '…' : v;
    }
  }
  return out;
}

(async () => {
  if (!SECRET_ID || !SECRET_KEY) {
    console.error('缺少 COS_SECRET_ID / COS_SECRET_KEY');
    process.exit(2);
  }
  const resp = await call('GetFunction', { FunctionName: FUNCTION_NAME, Namespace: NAMESPACE });
  const r = (resp && resp.Response) || {};
  if (r.Error) {
    console.log('GetFunction 失败：' + r.Error.Code + ' ' + r.Error.Message);
    process.exit(1);
  }
  const vpc = r.VpcConfig || {};
  const summary = {
    functionName: r.FunctionName,
    namespace: NAMESPACE,
    region: REGION,
    runtime: r.Runtime,
    handler: r.Handler,
    timeout: r.Timeout,
    memorySize: r.MemorySize,
    status: r.Status,
    modTime: r.ModTime,
    /* 关键：有没有绑 VPC。绑了 VPC 且没有 NAT 网关 = 只有内网、公网全断 */
    vpc: {
      hasVpc: Boolean(vpc.VpcId || vpc.SubnetId),
      vpcId: vpc.VpcId || '',
      subnetId: vpc.SubnetId || '',
    },
    /* 公网访问：SCF 没绑 VPC 时默认有公网出口；绑了 VPC 需要 NAT 才有 */
    publicAccess: !(vpc.VpcId || vpc.SubnetId),
    env: summarizeEnv((r.Environment && r.Environment.Variables) || {}),
    triggers: (r.Triggers || []).map((t) => ({
      type: t.Type,
      name: t.TriggerName,
      enable: t.Enable,
      qualifier: t.Qualifier,
    })),
    codeSize: r.CodeSize,
    codeSha256: r.CodeSha256,
  };
  console.log(JSON.stringify(summary, null, 2));
})();
