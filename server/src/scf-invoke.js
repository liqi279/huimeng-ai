'use strict';

/* =============================================================
 * 触发自身异步执行（SCF InvocationType=Event）
 * -------------------------------------------------------------
 * 生图长任务不能挂在用户的单次 HTTP 连接上（30s 左右会被中间层掐断）。
 * 提交接口把任务落库后，用平台自带的异步调用再跑一次本函数，
 * 由那次调用承担重活，结果写回 jobs 表，前端轮询取结果。
 *
 * 只复用函数已有的环境变量（COS_SECRET_ID/COS_SECRET_KEY + COS_REGION），
 * 不引入任何新服务；缺少凭据时返回 false，调用方退化为同步执行。
 * ============================================================= */

const crypto = require('crypto');
const https = require('https');
const config = require('./config');

const HOST = 'scf.tencentcloudapi.com';
const SERVICE = 'scf';
const VERSION = '2018-04-16';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key, data, enc) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(enc);
}

function tc3Headers(action, payload, secretId, secretKey) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${contentType}\nhost:${HOST}\n`,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('TC3' + secretKey, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: HOST,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': VERSION,
    /* 被调用函数所在地域：SCF_FUNCTION 与 SCF_REGION 必须指向本函数，
       用 COS_REGION 兜底只适用于两者同地域的老部署 */
    'X-TC-Region': process.env.SCF_REGION || 'ap-guangzhou',
  };
}

function scfInvoke(payloadObj) {
  const secretId = config.COS_SECRET_ID || config.S3_ACCESS_KEY_ID || '';
  const secretKey = config.COS_SECRET_KEY || config.S3_SECRET_ACCESS_KEY || '';
  if (!secretId || !secretKey) {
    console.error('[scf-invoke] 缺少 COS_SECRET_ID/COS_SECRET_KEY，无法自我调用');
    return Promise.resolve(false);
  }
  const body = JSON.stringify({
    FunctionName: process.env.SCF_FUNCTION || 'huimeng-api',
    Namespace: process.env.SCF_NAMESPACE || 'default',
    InvocationType: 'Event',
    /* 不能传 Payload：SCF 的 Invoke 接口不认这个参数，会直接回
       UnknownParameter（实测 2026-11-17，RequestId 可查），
       于是每次「异步触发」都失败、退化成同步跑完整张图。
       数据走 ClientContext：base64 的 JSON，函数里从 context.clientContext 取。 */
    ClientContext: Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64'),
  });
  const headers = tc3Headers('Invoke', body, secretId, secretKey);
  return new Promise((resolve) => {
    const req = https.request({
      method: 'POST',
      hostname: HOST,
      path: '/',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers),
      /* 只是「派活」，正常几百毫秒就返回。给太长会让提交接口白等：
         触发失败时调用方要退化成同步执行，等待时间会叠加到用户身上。 */
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let ok = res.statusCode >= 200 && res.statusCode < 300;
        try {
          const json = JSON.parse(text);
          if (json && json.Response && json.Response.Error) {
            ok = false;
            console.error('[scf-invoke] 平台拒绝：' +
              (json.Response.Error.Code || '') + ' ' + (json.Response.Error.Message || ''));
          }
        } catch (err) {}
        if (!ok && res.statusCode >= 300) {
          console.error('[scf-invoke] HTTP ' + res.statusCode + ': ' + text.slice(0, 200));
        }
        resolve(ok);
      });
    });
    req.on('timeout', () => {
      console.error('[scf-invoke] 触发超时（5s），退化为同步执行');
      req.destroy(new Error('invoke timeout'));
    });
    req.on('error', (err) => {
      console.error('[scf-invoke] 触发失败：' + ((err && err.message) || err) + '，退化为同步执行');
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

/* 只读调用其它 SCF OpenAPI（例如 GetFunction），供体检接口复用同一套签名与凭据。
   不改线上状态；失败时 reject，由调用方决定怎么处理。 */
function callScfApi(action, payloadObj) {
  const secretId = config.COS_SECRET_ID || config.S3_ACCESS_KEY_ID || '';
  const secretKey = config.COS_SECRET_KEY || config.S3_SECRET_ACCESS_KEY || '';
  if (!secretId || !secretKey) return Promise.reject(new Error('缺少 COS_SECRET_ID/COS_SECRET_KEY'));
  const body = JSON.stringify(payloadObj || {});
  /* 签名必须带密钥：漏传会把 Credential 写成 undefined/...，
     腾讯云会报 AuthFailure.SecretIdNotFound（非常容易误判成密钥无效）。 */
  const headers = tc3Headers(action, body, secretId, secretKey);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: HOST,
      path: '/',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers),
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('非 JSON 响应: ' + text.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('SCF API 超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* SCF 事件调用时，业务负载放在 event 顶层；这里塞一个标记，入口据此分流 */
function triggerJob(jobId) {
  return scfInvoke({ __job: jobId });
}

module.exports = { triggerJob, callScfApi };
