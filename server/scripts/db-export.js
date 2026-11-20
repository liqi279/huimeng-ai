'use strict';

/* 导出 TiDB huimeng_library.books 全量书目快照，三处落地：
   1) 本机 backup/<yyyyMMdd>/library-snapshot.json
   2) COS library/_snapshots/library-snapshot-<yyyyMMdd>.json（保留最近 10 份）
   3) GitHub liqi279/huimeng-ai main: server/data/library-snapshot.json
   用法：node server/scripts/db-export.js
   依赖：mysql2 / cos-nodejs-sdk-v5（已有）；环境变量：COS_SECRET_ID / COS_SECRET_KEY / HM_GITHUB_TOKEN
   安全：连接串与密钥只在内存使用，不打印；快照只含书目元数据，不含账号/密钥/token/用户数据。
   哪一步失败单独报（PASS/FAIL），最后以退出码 2 表示存在失败步骤。 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const COS = require('cos-nodejs-sdk-v5');

const OWNER = 'liqi279';
const REPO = 'huimeng-ai';
const BRANCH = 'main';
const API_BASE = process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com';
const TOKEN = process.env.HM_GITHUB_TOKEN || '';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORK_ROOT = path.resolve(REPO_ROOT, '..', '..');
const FUNC_NAME = process.env.SCF_FUNCTION || 'huimeng-api';
const DB_NAME = process.env.DB_NAME || 'huimeng_library';
const BUCKET = process.env.COS_BUCKET || 'huimeng-1527498271';
const REGION = process.env.COS_REGION || 'ap-guangzhou';
const KEEP_SNAPSHOTS = 10;

const secretId = process.env.COS_SECRET_ID || '';
const secretKey = process.env.COS_SECRET_KEY || '';
const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

const OK = [];
const BAD = [];
function pass(step, msg) { OK.push(step); console.log('[PASS] ' + step + '  ' + msg); }
function fail(step, msg) { BAD.push(step + ': ' + msg); console.log('[FAIL] ' + step + '  ' + msg); }

function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest(); }
function sha256hex(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function gitBlobSha(buf) { return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex'); }

/* 腾讯云 TC3 签名调用 SCF OpenAPI（只读取函数环境变量里的 MYSQL_URL） */
function tc3(action, body) {
  const payload = JSON.stringify(body);
  const host = 'scf.tencentcloudapi.com';
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const ct = 'application/json; charset=utf-8';
  const sh = 'content-type;host;x-tc-action';
  const ch = 'content-type:' + ct + '\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n';
  const cr = ['POST', '/', '', ch, sh, sha256hex(Buffer.from(payload))].join('\n');
  const scope = date + '/scf/tc3_request';
  const sts = ['TC3-HMAC-SHA256', String(ts), scope, sha256hex(Buffer.from(cr))].join('\n');
  const ks = hmac(hmac(hmac('TC3' + secretKey, date), 'scf'), 'tc3_request');
  const sig = crypto.createHmac('sha256', ks).update(sts).digest('hex');
  return new Promise((resolve, reject) => {
    const r = https.request({
      method: 'POST', hostname: host, path: '/', timeout: 60000,
      headers: {
        Authorization: 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + scope +
          ', SignedHeaders=' + sh + ', Signature=' + sig,
        'Content-Type': ct, Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(ts),
        'X-TC-Version': '2018-04-16', 'X-TC-Region': REGION,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        const resp = (json && json.Response) || {};
        if (resp.Error) return reject(new Error(resp.Error.Code + ': ' + resp.Error.Message));
        resolve(resp);
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(payload);
  });
}

function gh(method, apiPath, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const r = https.request({
      method, hostname: 'api.github.com', path: apiPath,
      headers: Object.assign({
        Authorization: 'token ' + TOKEN,
        'User-Agent': 'huimeng-deploy',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }, payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      timeout: 60000,
    }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function headKey(key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: BUCKET, Region: REGION, Key: key }, (err, data) => {
      if (err) resolve(null);
      else resolve(Number(data.headers['content-length']));
    });
  });
}

function putKey(key, buf) {
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: BUCKET, Region: REGION, Key: key,
      ContentType: 'application/json; charset=utf-8', ContentLength: buf.length, Body: buf,
    }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function keyOf(url) {
  if (!url) return '';
  const s = String(url);
  const i = s.indexOf('.myqcloud.com/');
  return i >= 0 ? s.slice(i + '.myqcloud.com/'.length).split('?')[0] : s.replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
}

function parseToc(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

async function connect() {
  const r = await tc3('GetFunction', { FunctionName: FUNC_NAME, Namespace: 'default' });
  const env = {};
  for (const v of (r.Environment && r.Environment.Variables) || []) env[v.Key] = v.Value;
  if (!env.MYSQL_URL) throw new Error('函数环境里没有 MYSQL_URL');
  const u = new URL(env.MYSQL_URL);
  const opt = {
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: DB_NAME, multipleStatements: false,
  };
  if (u.searchParams.get('ssl') === 'true' || /tidbcloud/.test(u.hostname)) opt.ssl = { rejectUnauthorized: false };
  return mysql.createConnection(opt);
}

async function apiSummary() {
  return new Promise((resolve) => {
    const r = https.request({ hostname: new URL(API_BASE).hostname, path: '/api/library/books', timeout: 30000 }, (res) => {
      let t = '';
      res.on('data', (d) => { t += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(t);
          const areas = {};
          (j.items || []).forEach((b) => { areas[b.area || '(空)'] = (areas[b.area || '(空)'] || 0) + 1; });
          resolve({ total: j.total, areas, mode: j.store && j.store.mode });
        } catch (e) { resolve(null); }
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve(null));
    r.end();
  });
}

(async () => {
  if (!TOKEN) throw new Error('缺少环境变量 HM_GITHUB_TOKEN');
  if (!secretId || !secretKey) throw new Error('缺少 COS_SECRET_ID / COS_SECRET_KEY');

  /* 1. 读 TiDB */
  const c = await connect();
  const [rows] = await c.query(
    'SELECT id, title, author, intro, page_count, area, toc, sort_no, cover_url, pdf_url ' +
    'FROM books ORDER BY sort_no ASC, id ASC');
  await c.end();

  const books = [];
  for (const r of rows) {
    const pdfKey = keyOf(r.pdf_url);
    const coverKey = keyOf(r.cover_url);
    books.push({
      id: r.id,
      sortNo: r.sort_no,
      title: r.title,
      author: r.author || '',
      intro: r.intro || '',
      pageCount: r.page_count,
      area: r.area || '',
      toc: parseToc(r.toc),
      pdfKey,
      pdfBytes: await headKey(pdfKey),
      coverKey,
      coverBytes: await headKey(coverKey),
    });
  }

  const areas = {};
  books.forEach((b) => { areas[b.area || '(空)'] = (areas[b.area || '(空)'] || 0) + 1; });
  const snapshot = { generatedAt: new Date().toISOString(), source: DB_NAME + '.books', total: books.length, areas, books };
  const buf = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  const sha256 = sha256hex(buf);
  const blobSha = gitBlobSha(buf);
  const stamp = today();
  console.log('快照 bytes=' + buf.length + ' sha256=' + sha256 + ' total=' + snapshot.total +
    ' areas=' + JSON.stringify(areas) + ' gitBlob=' + blobSha.slice(0, 12));

  /* 2. 本机备份 */
  const localDir = path.join(WORK_ROOT, 'backup', stamp);
  const localFile = path.join(localDir, 'library-snapshot.json');
  try {
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(localFile, buf);
    const rb = fs.readFileSync(localFile);
    if (rb.length !== buf.length || sha256hex(rb) !== sha256) throw new Error('回读内容不一致');
    pass('本机备份', localFile + ' bytes=' + buf.length + ' sha256=' + sha256);
  } catch (e) { fail('本机备份', e.message); }

  /* 3. COS 快照 + 清理旧份（保留最近 10 份） */
  const cosKey = 'library/_snapshots/library-snapshot-' + stamp + '.json';
  try {
    await putKey(cosKey, buf);
    const size = await headKey(cosKey);
    if (size !== buf.length) throw new Error('COS 回读字节 ' + size + ' ≠ ' + buf.length);
    pass('COS 快照', 'cos://' + BUCKET + '/' + cosKey + ' bytes=' + size + ' sha256=' + sha256);
    const listed = await new Promise((resolve, reject) => {
      cos.getBucket({ Bucket: BUCKET, Region: REGION, Prefix: 'library/_snapshots/' }, (err, data) => (err ? reject(err) : resolve(data)));
    });
    const files = (listed.Contents || []).map((x) => x.Key).filter((k) => /library-snapshot-\d{8}\.json$/.test(k)).sort();
    if (files.length > KEEP_SNAPSHOTS) {
      const del = files.slice(0, files.length - KEEP_SNAPSHOTS);
      await new Promise((resolve, reject) => {
        cos.deleteMultipleObject({ Bucket: BUCKET, Region: REGION, Objects: del.map((Key) => ({ Key })) },
          (err) => (err ? reject(err) : resolve()));
      });
      console.log('       清理旧快照 ' + del.length + ' 份：' + del.map((k) => k.split('/').pop()).join(', '));
    }
  } catch (e) { fail('COS 快照', e.message); }

  /* 4. GitHub 提交 */
  const rel = 'server/data/library-snapshot.json';
  const repoFile = path.join(REPO_ROOT, rel);
  let commitSha = '(未提交)';
  try {
    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.writeFileSync(repoFile, buf);
    const get = await gh('GET', '/repos/' + OWNER + '/' + REPO + '/contents/' + rel + '?ref=' + BRANCH);
    if (get.status !== 200 && get.status !== 404) {
      throw new Error('GET → HTTP ' + get.status + ' ' + (get.json && get.json.message));
    }
    if (get.status === 200 && get.json.sha === blobSha) {
      commitSha = '(远端已一致，跳过提交)';
      pass('GitHub 快照', rel + ' 远端 blob ' + blobSha.slice(0, 12) + ' 已一致');
    } else {
      const put = await gh('PUT', '/repos/' + OWNER + '/' + REPO + '/contents/' + rel, Object.assign({
        message: 'chore(data): sync library snapshot (' + snapshot.total + ' books)',
        content: buf.toString('base64'),
        branch: BRANCH,
      }, get.status === 200 ? { sha: get.json.sha } : {}));
      if (put.status !== 200 && put.status !== 201) {
        throw new Error('PUT → HTTP ' + put.status + ' ' + (put.json && put.json.message));
      }
      commitSha = put.json.commit.sha;
      const remoteSha = put.json.content && put.json.content.sha;
      if (remoteSha !== blobSha) throw new Error('远端 blob ' + remoteSha + ' ≠ 本地 ' + blobSha);
      pass('GitHub 快照', rel + ' commit=' + commitSha.slice(0, 12) + ' blob=' + remoteSha.slice(0, 12) + '（与本地一致）');
    }
  } catch (e) { fail('GitHub 快照', e.message); }

  /* 5. 与线上接口比对 */
  try {
    const api = await apiSummary();
    if (!api) throw new Error('接口不可用');
    const same = api.total === snapshot.total && JSON.stringify(api.areas) === JSON.stringify(areas);
    if (same) pass('线上比对', 'total=' + api.total + ' areas=' + JSON.stringify(api.areas) + ' mode=' + api.mode);
    else fail('线上比对', '接口 total=' + api.total + ' areas=' + JSON.stringify(api.areas) + '，快照 total=' + snapshot.total + ' areas=' + JSON.stringify(areas));
  } catch (e) { fail('线上比对', e.message); }

  console.log('\n===== 汇总 =====');
  console.log('快照 total=' + snapshot.total + '  区域=' + JSON.stringify(areas) + '  bytes=' + buf.length + '  sha256=' + sha256);
  console.log('本机 : ' + localFile);
  console.log('COS  : cos://' + BUCKET + '/' + cosKey);
  console.log('GitHub: ' + OWNER + '/' + REPO + '@' + BRANCH + ':' + rel + '  commit=' + commitSha);
  console.log('通过 ' + OK.length + ' 步，失败 ' + BAD.length + ' 步');
  BAD.forEach((b) => console.log('  ✘ ' + b));
  if (BAD.length) process.exitCode = 2;
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
