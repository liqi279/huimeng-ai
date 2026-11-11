#!/usr/bin/env node
'use strict';

/* =============================================================
 * 前端一键发布：GitHub Pages 一份 + 腾讯云 COS 一份
 * -------------------------------------------------------------
 *   node server/scripts/web-deploy.js                 校验一致 → 传 COS → 双侧核对
 *   node server/scripts/web-deploy.js --push-github   本地与 GitHub 不一致时，先推 GitHub 再发 COS
 *   node server/scripts/web-deploy.js --skip-github   只发腾讯云
 *   node server/scripts/web-deploy.js --check-only    只校验，不推送、不上传
 *   node server/scripts/web-deploy.js --cloudbase     发到 CloudBase 静态托管（需 CLOUDBASE_ENV_ID）
 *
 * 托管地址（COS 桶默认域名直读，实测内联打开、HTTPS、免备案）：
 *   https://<bucket>.cos.<region>.myqcloud.com/index.html
 *
 * CloudBase 静态托管（用户选定方案）：
 *   默认域名形如 https://<envId>-<appId>.tcloudbaseapp.com/index.html（也兼容 <envId>.tcloudbaseapp.com）
 *   环境变量：CLOUDBASE_ENV_ID（必填）、CLOUDBASE_DOMAIN（可选，覆盖域名）、CLOUDBASE_APPID（可选）
 *   上传依赖 @cloudbase/manager-node（hosting.uploadFiles），需子账号有 CloudBase 静态托管权限；
 *   上传后用 GET（不是 HEAD）回读字节数与 sha256，并检查 Content-Type / Content-Disposition。
 *   实测 2026-11-11：默认域名对 html/txt 都强制 Content-Disposition: attachment（浏览器变下载），
 *   换 Accept/UA、加 ?response-content-disposition=inline 均无效；官方文档要求生产环境绑已备案
 *   自定义域名才能浏览器直开。未绑域名时默认域只能当字节镜像，不能作为可打开的页面地址。
 *
 * 为什么不用 COS「静态网站托管」默认域名：实测（同一对象、显式
 * Content-Disposition: inline、.htm 后缀）仍强制返回
 * Content-Disposition: attachment，浏览器变下载，属平台策略，改 header 无效。
 * 桶默认域名直读（对象 ACL public-read）不受该策略影响。
 *
 * 首次初始化（幂等，只在缺失时写）：
 *   1) 桶 CORS 追加本站 origin（pdf.js 跨域分段读 PDF 需要）
 *   2) SCF 环境变量 CORS_ORIGINS 追加本站 origin（页面调 API 需要）
 *
 * 密钥只从环境变量读，不打印、不落盘：
 *   COS_SECRET_ID / COS_SECRET_KEY / HM_GITHUB_TOKEN
 * ============================================================= */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE = path.resolve(REPO_ROOT, '..', '..');
/* 发布源固定用工作区根目录下前端维护的那份；仓库内副本只作兜底，可用 WEB_FILE 覆盖。 */
const LOCAL_FILE = process.env.WEB_FILE ||
  [path.join(WORKSPACE, 'deploy', 'index.html'), path.join(REPO_ROOT, 'deploy', 'index.html')]
    .filter((p) => fs.existsSync(p))[0] ||
  path.join(WORKSPACE, 'deploy', 'index.html');

const CFG = {
  bucket: process.env.COS_BUCKET || 'huimeng-1527498271',
  region: process.env.COS_REGION || 'ap-guangzhou',
  objectKey: process.env.WEB_OBJECT_KEY || 'index.html',
  secretId: process.env.COS_SECRET_ID || '',
  secretKey: process.env.COS_SECRET_KEY || '',
  owner: process.env.GH_OWNER || 'liqi279',
  repo: process.env.GH_REPO || 'huimeng-ai',
  branch: process.env.GH_BRANCH || 'main',
  repoPath: process.env.GH_PATH || 'deploy/index.html',
  token: process.env.HM_GITHUB_TOKEN || '',
  pagesUrl: process.env.PAGES_URL || 'https://liqi279.github.io/huimeng-ai/',
  apiBase: process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com',
  namespace: process.env.SCF_NAMESPACE || 'default',
  functionName: process.env.SCF_FUNCTION || 'huimeng-api',
};
/* 站点 origin：COS 桶默认域名（不是 cos-website 静态网站域名） */
CFG.siteOrigin = 'https://' + CFG.bucket + '.cos.' + CFG.region + '.myqcloud.com';
CFG.siteUrl = CFG.siteOrigin + '/' + CFG.objectKey;
CFG.ghTimeoutMs = Number(process.env.GH_VERIFY_TIMEOUT_MS || 90000);
CFG.cloudbaseEnvId = process.env.CLOUDBASE_ENV_ID || '';
CFG.cloudbaseDomain = process.env.CLOUDBASE_DOMAIN || '';
CFG.cloudbaseAppId = process.env.CLOUDBASE_APPID || (/(\d{6,})/.exec(CFG.bucket) || [])[1] || '';

const args = process.argv.slice(2);
const skipGithub = args.includes('--skip-github');
const pushFlag = args.includes('--push-github');
const checkOnly = args.includes('--check-only');
const mirror = args.includes('--cos-mirror');
const cloudbase = args.includes('--cloudbase');

const OK = [];
const BAD = [];
function log(tag, msg) { console.log('[' + tag.padEnd(8) + '] ' + msg); }
function pass(name, detail) { OK.push(name); log('PASS', name + (detail ? '  ' + detail : '')); }
function fail(name, detail) { BAD.push(name + (detail ? ' ' + detail : '')); log('FAIL', name + (detail ? '  ' + detail : '')); }
function bytes(n) { return Number(n).toLocaleString('en-US') + ' B'; }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }
/* git blob sha：GitHub Contents 元数据里给的就是这个，可在本地算出来，无需下载远端 5MB */
function gitBlobSha(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\u0000').update(buf).digest('hex');
}
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

/* ---------------- HTTP ---------------- */
function request(urlStr, opts, redirects) {
  const u = new URL(urlStr);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: (opts && opts.method) || 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: (opts && opts.headers) || {},
      timeout: (opts && opts.timeout) || 60000,
    }, (res) => {
      const chunks = [];
      let ttfb = 0;
      res.on('data', (d) => { if (!ttfb) ttfb = Date.now() - t0; chunks.push(d); });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const loc = res.headers.location;
        if (loc && res.statusCode >= 300 && res.statusCode < 400 && (redirects || 0) < 4) {
          return resolve(request(new URL(loc, urlStr).toString(), opts, (redirects || 0) + 1));
        }
        resolve({ status: res.statusCode, headers: res.headers, body, ms: Date.now() - t0, ttfb });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + urlStr)));
    req.on('error', reject);
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

function github(method, apiPath, body) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    Authorization: 'token ' + CFG.token,
    'User-Agent': 'huimeng-web-deploy',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return request('https://api.github.com' + apiPath, { method, headers, body: payload })
    .then((r) => {
      let json = null;
      try { json = JSON.parse(r.body.toString('utf8')); } catch (e) { /* ignore */ }
      if (r.status >= 400) {
        const msg = (json && json.message) || r.body.toString('utf8').slice(0, 200);
        throw new Error('GitHub ' + method + ' ' + apiPath + ' → HTTP ' + r.status + ' ' + msg);
      }
      return json;
    });
}

/* ---------------- COS ---------------- */
function cos() {
  const COS = require('cos-nodejs-sdk-v5');
  return new COS({ SecretId: CFG.secretId, SecretKey: CFG.secretKey });
}
const BASE = { Bucket: CFG.bucket, Region: CFG.region };
function cosCall(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](Object.assign({}, BASE, params), (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/* ---------------- SCF（TC3） ---------------- */
function tc3(action, body) {
  const payload = JSON.stringify(body);
  const host = 'scf.tencentcloudapi.com';
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const ct = 'application/json; charset=utf-8';
  const sh = 'content-type;host;x-tc-action';
  const ch = 'content-type:' + ct + '\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n';
  const cr = ['POST', '/', '', ch, sh, sha256(Buffer.from(payload))].join('\n');
  const scope = date + '/scf/tc3_request';
  const sts = ['TC3-HMAC-SHA256', String(ts), scope, sha256(Buffer.from(cr))].join('\n');
  const ks = hmac(hmac(hmac('TC3' + CFG.secretKey, date), 'scf'), 'tc3_request');
  const sig = crypto.createHmac('sha256', ks).update(sts).digest('hex');
  return request('https://' + host + '/', {
    method: 'POST',
    headers: {
      Authorization: 'TC3-HMAC-SHA256 Credential=' + CFG.secretId + '/' + scope +
        ', SignedHeaders=' + sh + ', Signature=' + sig,
      'Content-Type': ct, Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(ts),
      'X-TC-Version': '2018-04-16', 'X-TC-Region': CFG.region,
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
  }).then((r) => {
    let json = null;
    try { json = JSON.parse(r.body.toString('utf8')); } catch (e) { /* ignore */ }
    const resp = (json && json.Response) || {};
    if (resp.Error) throw new Error(resp.Error.Code + ': ' + resp.Error.Message);
    return resp;
  });
}

/* ---------------- 初始化：桶 CORS ---------------- */
async function ensureBucketCors(client, origins) {
  const targets = origins.filter(Boolean);
  const cur = await cosCall(client, 'getBucketCors', {});
  const rules = (cur.CORSRules || []).map((r) => Object.assign({}, r));
  if (!rules.length) {
    rules.push({
      AllowedOrigins: targets.slice(), AllowedMethods: ['GET', 'HEAD'],
      AllowedHeaders: ['*'], ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type', 'x-cos-request-id'],
      MaxAgeSeconds: 600,
    });
  }
  for (const origin of targets) {
    let added = false;
    for (const r of rules) {
      if (!Array.isArray(r.AllowedOrigins)) r.AllowedOrigins = [];
      if (r.AllowedOrigins.indexOf(origin) < 0) { r.AllowedOrigins.push(origin); added = true; }
    }
    if (added) {
      await cosCall(client, 'putBucketCors', {
        CORSRules: rules.map((r) => ({
          AllowedOrigins: r.AllowedOrigins,
          AllowedMethods: r.AllowedMethods || ['GET', 'HEAD'],
          AllowedHeaders: r.AllowedHeaders || ['*'],
          ExposeHeaders: r.ExposeHeaders || ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
          MaxAgeSeconds: Number(r.MaxAgeSeconds || 600),
        })),
      });
    }
  }
  const after = await cosCall(client, 'getBucketCors', {});
  const flat = (after.CORSRules || []).reduce((a, r) => a.concat(r.AllowedOrigins || []), []);
  for (const origin of targets) {
    if (flat.indexOf(origin) >= 0) pass('桶 CORS', '已包含 ' + origin + '（共 ' + flat.length + ' 条来源）');
    else fail('桶 CORS', '写入后仍未包含 ' + origin);
  }
}

/* ---------------- 初始化：后端 CORS 白名单 ---------------- */
async function ensureApiCors(origins) {
  const targets = origins.filter(Boolean);
  const fn = await tc3('GetFunction', { FunctionName: CFG.functionName, Namespace: CFG.namespace });
  const vars = ((fn.Environment && fn.Environment.Variables) || []).map((v) => ({ Key: v.Key, Value: v.Value }));
  const idx = vars.findIndex((v) => v.Key === 'CORS_ORIGINS' || v.Key === 'CORS_ORIGIN');
  let changed = false;
  let list = [];
  if (idx >= 0) {
    list = String(vars[idx].Value).split(',').map((s) => s.trim()).filter(Boolean);
    const missing = targets.filter((o) => list.indexOf(o) < 0);
    if (missing.length) { vars[idx].Value = list.concat(missing).join(','); changed = true; }
  } else {
    vars.push({ Key: 'CORS_ORIGINS', Value: targets.join(',') });
    changed = true;
  }
  if (!changed) {
    for (const origin of targets) pass('后端 CORS', 'CORS_ORIGINS 已包含 ' + origin);
    return;
  }
  await tc3('UpdateFunctionConfiguration', {
    FunctionName: CFG.functionName, Namespace: CFG.namespace, Environment: { Variables: vars },
  });
  const after = await tc3('GetFunction', { FunctionName: CFG.functionName, Namespace: CFG.namespace });
  const env = {};
  ((after.Environment && after.Environment.Variables) || []).forEach((v) => { env[v.Key] = v.Value; });
  const now = String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim());
  for (const origin of targets) {
    if (now.indexOf(origin) >= 0) pass('后端 CORS', 'CORS_ORIGINS 已更新（' + now.length + ' 条来源，含 ' + origin + '）');
    else fail('后端 CORS', '更新后仍未包含 ' + origin);
  }
}

/* ---------------- GitHub：元数据比对 / 推送 ---------------- */
async function readGithubMeta() {
  const p = '/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + CFG.repoPath + '?ref=' + CFG.branch;
  try {
    const meta = await github('GET', p);
    if (!meta || !meta.sha) return { exists: false };
    log('github', '远端 size=' + bytes(meta.size) + ' blob=' + String(meta.sha).slice(0, 12));
    return { exists: true, size: meta.size, gitSha: meta.sha };
  } catch (err) {
    if (/HTTP 404/.test(err.message)) return { exists: false };
    throw err;
  }
}

function sameAsLocal(local, meta, localGitSha) {
  return Boolean(meta && meta.exists && meta.size === local.length && meta.gitSha === localGitSha);
}

async function pushGithub(local, meta) {
  const message = 'chore(web): 发布 deploy/index.html（' + bytes(local.length) + '）';
  let commitSha;
  if (local.length > 1024 * 1024) {
    log('github', '文件 ' + bytes(local.length) + ' > 1MB，走 Git Data API');
    const ref = await github('GET', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/ref/heads/' + CFG.branch);
    const parent = ref.object.sha;
    const parentCommit = await github('GET', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/commits/' + parent);
    const blob = await github('POST', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/blobs', {
      content: local.toString('base64'), encoding: 'base64',
    });
    if (blob.sha !== gitBlobSha(local)) throw new Error('blob sha 不匹配：' + blob.sha);
    log('github', 'blob=' + String(blob.sha).slice(0, 12) + ' 与本地一致');
    const tree = await github('POST', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/trees', {
      base_tree: parentCommit.tree.sha,
      tree: [{ path: CFG.repoPath, mode: '100644', type: 'blob', sha: blob.sha }],
    });
    const commit = await github('POST', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/commits', {
      message, tree: tree.sha, parents: [parent],
    });
    await github('PATCH', '/repos/' + CFG.owner + '/' + CFG.repo + '/git/refs/heads/' + CFG.branch, {
      sha: commit.sha, force: false,
    });
    commitSha = commit.sha;
  } else {
    const put = await github('PUT', '/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + CFG.repoPath, {
      message, content: local.toString('base64'), branch: CFG.branch,
      ...(meta && meta.gitSha ? { sha: meta.gitSha } : {}),
    });
    commitSha = put.commit.sha;
  }
  pass('GitHub 推送', CFG.owner + '/' + CFG.repo + '@' + CFG.branch + ' commit=' + commitSha.slice(0, 12));
  return commitSha;
}

/* ---------------- COS 上传 ---------------- */
async function uploadCos(client, local) {
  const t0 = Date.now();
  await cosCall(client, 'putObject', {
    Key: CFG.objectKey,
    Body: local,
    ContentLength: local.length,
    ContentType: 'text/html; charset=utf-8',
    /* 不要设 ContentDisposition：实测桶默认域名下，凡是带了 CD 的 html 反而被
       改写成 attachment；不带 CD 时原样输出，浏览器内联打开。 */
    CacheControl: 'no-cache',
    ACL: 'public-read',
  });
  const ms = Date.now() - t0;
  const head = await cosCall(client, 'headObject', { Key: CFG.objectKey });
  const h = head.headers || head;
  const size = Number(h['content-length']);
  const etag = String(h.etag || h.ETag || '').replace(/"/g, '');
  const ok = size === local.length && etag === md5(local);
  log('cos', '上传 ' + CFG.objectKey + ' ' + bytes(size) + ' etag=' + etag + ' ms=' + ms);
  if (ok) pass('COS 上传校验', bytes(size) + ' md5=' + etag + ' 用时 ' + ms + 'ms');
  else fail('COS 上传校验', 'size/etag 与本地不符');
}

/* ---------------- CloudBase 静态托管 ---------------- */
function cloudbaseCandidates() {
  const hosts = [];
  if (CFG.cloudbaseDomain) {
    hosts.push(CFG.cloudbaseDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
  } else {
    if (CFG.cloudbaseAppId) hosts.push(CFG.cloudbaseEnvId + '-' + CFG.cloudbaseAppId + '.tcloudbaseapp.com');
    hosts.push(CFG.cloudbaseEnvId + '.tcloudbaseapp.com');
  }
  return hosts;
}

async function deployCloudbase(local) {
  if (!CFG.cloudbaseEnvId) throw new Error('缺少 CLOUDBASE_ENV_ID（CloudBase 环境 ID）');
  let mod;
  try { mod = require('@cloudbase/manager-node'); }
  catch (e) { throw new Error('未安装 @cloudbase/manager-node，请在 server 目录执行 npm i @cloudbase/manager-node'); }
  const CloudBase = mod.default || mod;
  const app = new CloudBase({ secretId: CFG.secretId, secretKey: CFG.secretKey, envId: CFG.cloudbaseEnvId });
  const t0 = Date.now();
  await app.hosting.uploadFiles({ files: [{ localPath: LOCAL_FILE, cloudPath: CFG.objectKey }] });
  pass('CloudBase 上传', CFG.objectKey + ' ' + bytes(local.length) + ' 用时 ' + (Date.now() - t0) + 'ms');
}

async function verifyCloudbase(local) {
  const localSha = sha256(local);
  let hit = null;
  for (const host of cloudbaseCandidates()) {
    const url = 'https://' + host + '/' + CFG.objectKey;
    try {
      const r = await request(url, { headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' } });
      log('online', 'GET ' + url + ' → HTTP ' + r.status + '  CT=' + (r.headers['content-type'] || '(空)') +
        '  bytes=' + r.body.length);
      if (r.status === 200 && !hit) hit = { url, host, r };
    } catch (e) {
      log('online', 'GET ' + url + ' 失败：' + e.message);
    }
  }
  if (!hit) { fail('CloudBase 回读', '候选域名均未返回 200'); return null; }
  const { url, host, r } = hit;
  const ct = r.headers['content-type'] || '';
  const cl = r.headers['content-length'] || String(r.body.length);
  const cd = r.headers['content-disposition'] || '';
  const siteSha = sha256(r.body);
  log('online', '实际字节=' + bytes(r.body.length) + '  首字节≈' + r.ttfb + 'ms  总耗时≈' + r.ms + 'ms  (' +
    (r.body.length / 1048576 / Math.max(r.ms / 1000, 0.001)).toFixed(2) + ' MB/s)');
  if (/^text\/html/.test(ct)) pass('线上 Content-Type', ct); else fail('线上 Content-Type', ct || '(空)');
  if (!/attachment/i.test(cd)) pass('内联打开', '无 Content-Disposition: attachment'); else fail('内联打开', cd);
  if (r.body.length === local.length) pass('线上字节数', cl + ' = 本地 ' + local.length);
  else fail('线上字节数', '线上 ' + r.body.length + ' ≠ 本地 ' + local.length);
  if (siteSha === localSha) pass('线上 sha256', siteSha); else fail('线上 sha256', siteSha + ' ≠ ' + localSha);
  return { url, host, origin: 'https://' + host, ct, cl, cd, body: r.body, ms: r.ms, ttfb: r.ttfb };
}

/* ---------------- 线上实测（COS） ---------------- */
async function verifySite() {
  const r = await request(CFG.siteUrl, {
    headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
  });
  const ct = r.headers['content-type'] || '';
  const cl = r.headers['content-length'] || String(r.body.length);
  const cd = r.headers['content-disposition'] || '';
  const etag = String(r.headers.etag || '').replace(/"/g, '');
  log('online', 'GET ' + CFG.siteUrl);
  log('online', 'HTTP ' + r.status + '  Content-Type=' + ct + '  Content-Length=' + cl +
    '  Content-Disposition=' + (cd || '(无)') + '  ETag=' + etag);
  log('online', '实际字节=' + bytes(r.body.length) + '  首字节≈' + r.ttfb + 'ms  总耗时≈' + r.ms + 'ms  (' +
    (r.body.length / 1024 / 1024 / Math.max(r.ms / 1000, 0.001)).toFixed(2) + ' MB/s)');
  log('online', '首 60 字节=' + JSON.stringify(r.body.slice(0, 60).toString('utf8')));
  return { status: r.status, ct, cl, cd, body: r.body, ms: r.ms, ttfb: r.ttfb };
}

async function verifyGithubPages(local) {
  try {
    const r = await request(CFG.pagesUrl, {
      headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
      timeout: CFG.ghTimeoutMs,
    });
    if (r.status === 200 && r.body.length === local.length && sha256(r.body) === sha256(local)) {
      pass('GitHub Pages', 'HTTP 200 ' + bytes(r.body.length) + ' sha256 一致');
      return true;
    }
    fail('GitHub Pages', 'HTTP ' + r.status + ' bytes=' + r.body.length + '（Pages 构建可能尚未完成）');
  } catch (err) {
    fail('GitHub Pages', '拉取失败：' + err.message);
  }
  return false;
}

async function verifyApiCors(origin) {
  const o = origin || CFG.siteOrigin;
  const r = await request(CFG.apiBase + '/api/health', { headers: { Origin: o } });
  const acao = r.headers['access-control-allow-origin'] || '';
  if (r.status === 200 && acao === o) pass('后端 CORS 实测', 'GET /api/health → 200, ACAO=' + acao);
  else fail('后端 CORS 实测', 'HTTP ' + r.status + ' ACAO=' + (acao || '(空)'));
}

/* ---------------- main ---------------- */
(async () => {
  process.on('uncaughtException', (e) => { console.error('[UNCAUGHT] ' + (e && e.stack ? e.stack : e)); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error('[UNHANDLED] ' + (e && e.stack ? e.stack : e)); process.exit(1); });

  if (!fs.existsSync(LOCAL_FILE)) throw new Error('未找到 ' + LOCAL_FILE);
  const local = fs.readFileSync(LOCAL_FILE);
  const localSha = sha256(local);
  const localGitSha = gitBlobSha(local);
  log('local', LOCAL_FILE);
  log('local', bytes(local.length) + '  sha256=' + localSha + '  gitBlob=' + localGitSha.slice(0, 12));

  if (!CFG.secretId || !CFG.secretKey) throw new Error('缺少 COS_SECRET_ID / COS_SECRET_KEY');
  if (cloudbase && !CFG.cloudbaseEnvId) throw new Error('缺少 CLOUDBASE_ENV_ID（CloudBase 环境 ID）');
  const client = cos();

  log('setup', '检查桶 CORS / 后端 CORS 白名单（幂等）');
  await ensureBucketCors(client, [CFG.siteOrigin]);
  await ensureApiCors([CFG.siteOrigin]);

  if (!checkOnly) {
    if (!skipGithub) {
      if (!CFG.token) throw new Error('缺少 HM_GITHUB_TOKEN（或用 --skip-github）');
      log('github', '前置比对：本地 deploy/index.html ↔ ' + CFG.owner + '/' + CFG.repo + '@' + CFG.branch);
      let meta = await readGithubMeta();
      if (sameAsLocal(local, meta, localGitSha)) {
        pass('GitHub 一致性', '与本地同内容（size + git blob sha 均一致）');
      } else if (pushFlag) {
        log('github', '本地与远端不一致，按 --push-github 先推 GitHub 再发 COS');
        await pushGithub(local, meta);
        meta = await readGithubMeta();
        if (!sameAsLocal(local, meta, localGitSha)) {
          console.log('\n[ABORT] 推送后 GitHub 内容仍与本地不一致，停止上传');
          console.log('  本地: ' + bytes(local.length) + '  gitBlob=' + localGitSha);
          console.log('  远端: ' + (meta.exists ? bytes(meta.size) + '  gitBlob=' + meta.gitSha : '文件不存在'));
          process.exit(3);
        }
        pass('GitHub 一致性', '推送后与本地同内容');
      } else {
        console.log('\n[ABORT] 本地 deploy/index.html 与 GitHub ' + CFG.branch + ' 上那份不一致，停止发布');
        console.log('  本地: ' + LOCAL_FILE);
        console.log('        ' + bytes(local.length) + '  sha256=' + localSha + '  gitBlob=' + localGitSha);
        console.log('  远端: ' + CFG.owner + '/' + CFG.repo + ':' + CFG.repoPath + '@' + CFG.branch);
        console.log('        ' + (meta.exists ? bytes(meta.size) + '  gitBlob=' + meta.gitSha : '文件不存在'));
        console.log('  未上传任何内容。确认哪份是对的之后：');
        console.log('    · 以本地为准 → 加 --push-github 重跑（先推 GitHub 再发腾讯云）');
        console.log('    · 以远端为准 → 先把远端那份取回本地再重跑');
        process.exit(3);
      }
    } else {
      log('github', '已按 --skip-github 跳过 GitHub 比对与推送');
    }
    if (cloudbase) await deployCloudbase(local);
    if (mirror) await uploadCos(client, local);
    else if (!cloudbase) log('cos', '未加 --cos-mirror，跳过 COS 镜像（COS 默认域名对 html 强制下载，不能作为页面地址）');
  }

  if (cloudbase) {
    const site = await verifyCloudbase(local);
    if (site) {
      log('setup', '把 CloudBase origin 加入桶 CORS / 后端 CORS（幂等）');
      await ensureBucketCors(client, [site.origin]);
      await ensureApiCors([site.origin]);
      await verifyApiCors(site.origin);
    }
    if (!skipGithub) await verifyGithubPages(local);
    const onlineSha = site ? sha256(site.body) : '';
    console.log('\n================ 发布结果（CloudBase 静态托管） ================');
    console.log('可用页面地址（CloudBase）: ' + (site ? site.url : '(未取到可用域名)'));
    console.log('本地大小 / sha256       : ' + bytes(local.length) + ' / ' + localSha);
    if (site) {
      console.log('线上大小 / sha256       : ' + bytes(site.body.length) + ' / ' + onlineSha +
        (site.body.length === local.length && onlineSha === localSha ? '  ✔ 一致' : '  ✘ 不一致'));
      console.log('线上 Content-Type       : ' + site.ct + (site.cd ? '  (Content-Disposition=' + site.cd + ')' : '  (无 Content-Disposition，内联打开)'));
      console.log('首屏实测                : 首字节≈' + site.ttfb + 'ms，总耗时≈' + site.ms + 'ms');
    }
    console.log('通过 ' + OK.length + ' 项，失败 ' + BAD.length + ' 项');
    BAD.forEach((b) => console.log('  ✘ ' + b));
    console.log('==============================================================');
    if (BAD.length) process.exitCode = 2;
    return;
  }

  if (!mirror) {
    if (!skipGithub) await verifyGithubPages(local);
    await verifyApiCors();
    console.log('\n================ 发布结果 ================');
    console.log('可用页面地址（GitHub Pages）: ' + CFG.pagesUrl);
    console.log('本地大小 / sha256           : ' + bytes(local.length) + ' / ' + localSha);
    console.log(skipGithub
      ? 'GitHub main 内容核对        : 已按 --skip-github 跳过'
      : 'GitHub main 内容已核对      : 与本地同内容（size + git blob sha）');
    console.log('通过 ' + OK.length + ' 项，失败 ' + BAD.length + ' 项');
    BAD.forEach((b) => console.log('  ✘ ' + b));
    console.log('注意：COS 默认域名 / 函数 URL 对 .html 的 GET 都会强制');
    console.log('      Content-Disposition: attachment（平台防钓鱼策略），');
    console.log('      所以腾讯云侧只能做字节镜像，不能作为可打开的页面地址。');
    console.log('==========================================');
    if (BAD.length) process.exitCode = 2;
    return;
  }

  const site = await verifySite();
  const siteSha = sha256(site.body);
  if (/^text\/html/.test(site.ct)) pass('线上 Content-Type', site.ct); else fail('线上 Content-Type', site.ct || '(空)');
  if (!/attachment/i.test(site.cd)) pass('内联打开', '无 Content-Disposition: attachment'); else fail('内联打开', site.cd);
  if (site.body.length === local.length) pass('线上字节数', site.cl + ' = 本地 ' + local.length);
  else fail('线上字节数', '线上 ' + site.body.length + ' ≠ 本地 ' + local.length);
  if (siteSha === localSha) pass('线上 sha256', siteSha); else fail('线上 sha256', siteSha + ' ≠ ' + localSha);

  if (!skipGithub) await verifyGithubPages(local);
  await verifyApiCors();

  console.log('\n================ 发布结果 ================');
  console.log('腾讯云（COS 桶默认域名）: ' + CFG.siteUrl);
  if (!skipGithub) console.log('GitHub Pages            : ' + CFG.pagesUrl);
  console.log('本地大小 / sha256       : ' + bytes(local.length) + ' / ' + localSha);
  console.log('线上大小 / sha256       : ' + bytes(site.body.length) + ' / ' + siteSha +
    (site.body.length === local.length && siteSha === localSha ? '  ✔ 一致' : '  ✘ 不一致'));
  console.log('线上 Content-Type       : ' + site.ct + (site.cd ? '  (Content-Disposition=' + site.cd + ')' : '  (无 Content-Disposition，内联打开)'));
  console.log('首屏 5.2MB 实测         : 首字节≈' + site.ttfb + 'ms，总耗时≈' + site.ms + 'ms');
  console.log('通过 ' + OK.length + ' 项，失败 ' + BAD.length + ' 项');
  BAD.forEach((b) => console.log('  ✘ ' + b));
  console.log('==========================================');
  if (BAD.length) process.exitCode = 2;
})().catch((err) => {
  console.error('\nFAIL ' + (err && err.message ? err.message : err));
  process.exit(1);
});
