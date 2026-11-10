#!/usr/bin/env node
'use strict';

/* =============================================================
 * 一键发布 / 回滚（含发布前快照）
 * -------------------------------------------------------------
 * 正常发布（快照 → 打包 → 上传 → 更新函数 → 自检）：
 *   node server/scripts/scf-deploy.js
 *   node server/scripts/scf-deploy.js --skip-pack     # 复用 dist 里已有 zip
 *   node server/scripts/scf-deploy.js --check-only    # 只跑五步自检
 *
 * 回滚（默认最近一次快照；也可指定 key 或文件名）：
 *   node server/scripts/scf-deploy.js --rollback
 *   node server/scripts/scf-deploy.js --rollback scf/releases/20261111-011500.zip
 *
 * 快照位置：
 *   代码包  COS  scf/releases/<yyyyMMdd-HHmmss>.zip
 *   数据库  本机 <workspace>/backup/<yyyyMMdd>/db/<库名>.sql
 *
 * 密钥只从环境变量读，不打印、不落盘：
 *   COS_SECRET_ID/COS_SECRET_KEY（或 S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY）
 * 数据库连接串从函数环境变量 MYSQL_URL 读取（内存中使用，不输出）。
 * ============================================================= */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(SERVER_ROOT, 'dist');
const ZIP = path.join(DIST, 'huimeng-scf.zip');
const WORKSPACE = path.resolve(SERVER_ROOT, '..', '..');
const BACKUP_ROOT = process.env.BACKUP_ROOT || path.join(WORKSPACE, 'backup');

const CFG = {
  bucket: process.env.COS_BUCKET || 'huimeng-1527498271',
  region: process.env.COS_REGION || 'ap-guangzhou',
  objectKey: process.env.SCF_CODE_KEY || 'scf/huimeng-scf.zip',
  releasePrefix: 'scf/releases/',
  keepReleases: Number(process.env.SCF_KEEP_RELEASES || 6),
  secretId: process.env.COS_SECRET_ID || process.env.S3_ACCESS_KEY_ID || '',
  secretKey: process.env.COS_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
  namespace: process.env.SCF_NAMESPACE || 'default',
  functionName: process.env.SCF_FUNCTION || 'huimeng-api',
  apiBase: process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com',
  frontendBase: process.env.FRONTEND_BASE || 'https://liqi279.github.io',
};

const args = process.argv.slice(2);
const skipPack = args.includes('--skip-pack');
const checkOnly = args.includes('--check-only');
const rollbackIdx = args.indexOf('--rollback');
const isRollback = rollbackIdx >= 0;
const rollbackTarget = isRollback ? (args[rollbackIdx + 1] && !args[rollbackIdx + 1].startsWith('-') ? args[rollbackIdx + 1] : '') : '';

function log(tag, msg) { console.log('[' + tag + '] ' + msg); }
function bytes(n) { return Number(n).toLocaleString('en-US') + ' B'; }
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }
function sha256hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function day() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

function cosClient() {
  const COS = require('cos-nodejs-sdk-v5');
  return new COS({ SecretId: CFG.secretId, SecretKey: CFG.secretKey });
}

/* ---------- 1. 打包 ---------- */
function pack() {
  if (skipPack && fs.existsSync(ZIP)) {
    log('pack', '跳过打包，复用 ' + ZIP);
    return;
  }
  const script = path.join(__dirname, 'package-scf.ps1');
  log('pack', '执行 ' + path.basename(script));
  const env = Object.assign({}, process.env, { PATH: path.dirname(process.execPath) + ';' + (process.env.PATH || '') });
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd: SERVER_ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000, env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) throw new Error('打包失败 exit=' + r.status + ' ' + (r.stderr || '').slice(0, 400));
  if (!fs.existsSync(ZIP)) throw new Error('打包后未找到 ' + ZIP);
}

/* ---------- 2. 上传新包 ---------- */
async function uploadCode() {
  const cos = cosClient();
  const size = fs.statSync(ZIP).size;
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: CFG.bucket, Region: CFG.region, Key: CFG.objectKey,
      Body: fs.createReadStream(ZIP), ContentLength: size, ContentType: 'application/zip',
    }, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const ms = Date.now() - t0;
  const head = await new Promise((resolve, reject) => {
    cos.headObject({ Bucket: CFG.bucket, Region: CFG.region, Key: CFG.objectKey }, (err, data) => {
      if (err) return reject(err);
      const h = data.headers || data;
      resolve({ size: Number(h['content-length']), etag: String(h.etag || h.ETag || '').replace(/"/g, '') });
    });
  });
  const local = fs.readFileSync(ZIP);
  const ok = head.size === local.length && head.etag === md5(local);
  log('cos', '上传 ' + CFG.objectKey + ' ' + bytes(head.size) + ' etag=' + head.etag + ' ms=' + ms + ' 校验=' + (ok ? 'OK' : 'FAIL'));
  if (!ok) throw new Error('COS 回读校验失败');
  return { ms, size: head.size, etag: head.etag };
}

/* ---------- 3. 发布前快照：代码包 ---------- */
async function snapshotCode() {
  const cos = cosClient();
  const key = CFG.releasePrefix + stamp() + '.zip';
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    cos.putObjectCopy({
      Bucket: CFG.bucket, Region: CFG.region, Key: key,
      CopySource: CFG.bucket + '.cos.' + CFG.region + '.myqcloud.com/' + CFG.objectKey,
    }, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const head = await new Promise((resolve, reject) => {
    cos.headObject({ Bucket: CFG.bucket, Region: CFG.region, Key: key }, (err, data) => {
      if (err) return reject(err);
      const h = data.headers || data;
      resolve({ size: Number(h['content-length']), etag: String(h.etag || h.ETag || '').replace(/"/g, '') });
    });
  });
  log('snapshot', '代码包 → ' + key + ' ' + bytes(head.size) + ' etag=' + head.etag + ' ms=' + (Date.now() - t0));
  return { key, size: head.size, etag: head.etag };
}

async function listReleases() {
  const cos = cosClient();
  const data = await new Promise((resolve, reject) => {
    cos.getBucket({ Bucket: CFG.bucket, Region: CFG.region, Prefix: CFG.releasePrefix, MaxKeys: 1000 }, (err, d) => (err ? reject(err) : resolve(d)));
  });
  return (data.Contents || [])
    .filter((o) => /\.zip$/i.test(o.Key))
    .map((o) => ({ key: o.Key, size: Number(o.Size), mtime: o.LastModified, etag: String(o.ETag || '').replace(/"/g, '') }))
    .sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

/* ---------- 4. TC3 调 SCF ---------- */
function tc3Request(action, bodyObj) {
  const payload = JSON.stringify(bodyObj);
  const host = 'scf.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = 'content-type:' + contentType + '\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(Buffer.from(payload))].join('\n');
  const scope = date + '/scf/tc3_request';
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256hex(Buffer.from(canonicalRequest))].join('\n');
  const kSigning = hmac(hmac(hmac('TC3' + CFG.secretKey, date), 'scf'), 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const headers = {
    Authorization: 'TC3-HMAC-SHA256 Credential=' + CFG.secretId + '/' + scope +
      ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
    'Content-Type': contentType, Host: host, 'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2018-04-16', 'X-TC-Region': CFG.region,
  };
  return new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: host, path: '/', headers, timeout: 60000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* ignore */ }
        const resp = (json && json.Response) || {};
        if (resp.Error) return reject(Object.assign(new Error(resp.Error.Code + ': ' + resp.Error.Message), { code: resp.Error.Code }));
        resolve(resp);
      });
    });
    req.on('timeout', () => req.destroy(new Error('scf api timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getFunction() {
  const r = await tc3Request('GetFunction', { FunctionName: CFG.functionName, Namespace: CFG.namespace });
  const env = {};
  for (const v of (r.Environment && r.Environment.Variables) || []) env[v.Key] = v.Value;
  return { modTime: r.ModTime || '', status: r.Status || '', env };
}

async function updateCode(objectKey) {
  const t0 = Date.now();
  log('scf', 'UpdateFunctionCode → ' + CFG.bucket + '/' + objectKey);
  const resp = await tc3Request('UpdateFunctionCode', {
    FunctionName: CFG.functionName,
    Namespace: CFG.namespace,
    CosBucketName: CFG.bucket,
    CosObjectName: '/' + objectKey.replace(/^\/+/, ''),
    CosBucketRegion: CFG.region,
  });
  log('scf', 'UpdateFunctionCode OK ms=' + (Date.now() - t0) + ' RequestId=' + (resp.RequestId || ''));
  return resp;
}

async function waitUpdated(beforeModTime, maxMs) {
  const deadline = Date.now() + (maxMs || 90000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const g = await getFunction();
      log('scf', 'poll ModTime=' + g.modTime + ' status=' + g.status);
      if (g.modTime && g.modTime !== beforeModTime) return g;
    } catch (err) {
      log('scf', 'poll 失败 ' + err.message);
    }
  }
  log('scf', '轮询超时');
  return null;
}

/* ---------- 5. 数据库快照 ---------- */
async function snapshotDb(env) {
  const url = String(env.MYSQL_URL || '');
  if (!url) {
    log('db', '函数环境变量里没有 MYSQL_URL，跳过数据库快照');
    return null;
  }
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (e) {
    log('db', '本地找不到 mysql2，跳过数据库快照');
    return null;
  }
  const u = new URL(url);
  const baseDb = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'huimeng_users';
  const dbs = Array.from(new Set([baseDb, 'huimeng_users', 'huimeng_library']));
  const dir = path.join(BACKUP_ROOT, day(), 'db');
  fs.mkdirSync(dir, { recursive: true });

  const conn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    multipleStatements: false,
    ssl: /127\.0\.0\.1|localhost/.test(u.hostname) ? undefined : { rejectUnauthorized: false },
  });

  const out = [];
  let tables = 0;
  let rows = 0;
  for (const db of dbs) {
    let list = [];
    try {
      const [r] = await conn.query('SHOW TABLES FROM `' + db + '`');
      list = r.map((x) => Object.values(x)[0]);
    } catch (e) {
      continue;
    }
    if (!list.length) continue;
    out.push('-- database: ' + db + '  tables: ' + list.length);
    out.push('CREATE DATABASE IF NOT EXISTS `' + db + '` DEFAULT CHARACTER SET utf8mb4;');
    out.push('USE `' + db + '`;');
    for (const t of list) {
      const [cr] = await conn.query('SHOW CREATE TABLE `' + db + '`.`' + t + '`');
      out.push('\n-- table: ' + t);
      out.push(cr[0]['Create Table'] + ';');
      const [rowsArr] = await conn.query('SELECT * FROM `' + db + '`.`' + t + '`');
      for (const row of rowsArr) {
        const cols = Object.keys(row).map((c) => '`' + c + '`').join(', ');
        const vals = Object.values(row).map((v) => (v === null ? 'NULL' : conn.escape(v))).join(', ');
        out.push('INSERT INTO `' + t + '` (' + cols + ') VALUES (' + vals + ');');
      }
      tables += 1;
      rows += rowsArr.length;
    }
  }
  await conn.end();
  const file = path.join(dir, 'snapshot-' + stamp() + '.sql');
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  log('db', '数据库快照 → ' + file + '（' + tables + ' 表 / ' + rows + ' 行 / ' + bytes(fs.statSync(file).size) + '）');
  return { file, tables, rows };
}

/* ---------- 6. HTTP 自检 ---------- */
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: headers || {}, timeout: 60000 }, (res) => {
      let text = '';
      res.on('data', (d) => { if (text.length < 2000000) text += d.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function selfCheck() {
  const results = [];
  const h = await httpGet(CFG.apiBase + '/api/health');
  let hj = {};
  try { hj = JSON.parse(h.text); } catch (e) { /* ignore */ }
  const ud = hj.userData || {};
  results.push(['health', h.status, 'objectLabel=' + ud.objectLabel + ' endpoint=' + ud.endpoint + ' storage=' + hj.storage + ' persistent=' + hj.persistent,
    h.status === 200 && ud.objectLabel === '腾讯云 COS' && /cos\.ap-/.test(String(ud.endpoint)) && hj.storage === 'mysql']);

  const b = await httpGet(CFG.apiBase + '/api/library/books', { Origin: 'https://liqi279.github.io' });
  let bj = {};
  try { bj = JSON.parse(b.text); } catch (e) { /* ignore */ }
  const items = bj.items || [];
  /* 书目总数随内容增长（2026-11 新增 012-020 后为 20）；少于这个数说明库没读全或降级到 file 模式 */
  const EXPECT_BOOKS = Number(process.env.EXPECT_BOOKS || 20);
  results.push(['books', b.status, 'items=' + items.length + ' mode=' + (bj.store && bj.store.mode) + ' mysqlError=' + (bj.store && bj.store.mysqlError),
    b.status === 200 && items.length === EXPECT_BOOKS && bj.store && bj.store.mode === 'mysql']);

  if (items.length) {
    const book = items[0];
    const host = new URL(book.pdfUrl).hostname;
    results.push(['pdfUrl host', 200, host, host.indexOf('onrender.com') < 0]);

    const p = await httpGet(CFG.apiBase + '/api/library/books/' + encodeURIComponent(book.id) + '/pdf-url');
    let pj = {};
    try { pj = JSON.parse(p.text); } catch (e) { /* ignore */ }
    const signed = pj.url || pj.pdfUrl || '';
    if (signed) {
      const g = await httpGet(signed, { Range: 'bytes=0-1023' });
      results.push(['pdf Range', g.status, 'type=' + g.headers['content-type'] + ' range=' + g.headers['content-range'],
        g.status === 206 && /application\/pdf/.test(String(g.headers['content-type']))]);
    }
    /* 封面现在直接是对象存储签名直链：原样请求即可（带 Origin 验证 CORS）。
       只有历史数据里仍是 /api/library/file/... 相对地址时才改写到当前后端。 */
    const rawCover = String(book.coverUrl || '');
    const coverUrl = /^https?:\/\//i.test(rawCover)
      ? rawCover
      : CFG.apiBase + rawCover;
    if (coverUrl) {
      const c = await httpGet(coverUrl, { Origin: 'https://liqi279.github.io' });
      const ct = String(c.headers['content-type'] || '');
      results.push(['cover', c.status, 'type=' + ct + ' acao=' + String(c.headers['access-control-allow-origin'] || '(none)'),
        (c.status === 200 || c.status === 206) && /image\//.test(ct)]);
    }
  }

  console.log('\n=== 五步自检 ===');
  let allOk = true;
  for (const [name, status, detail, ok] of results) {
    if (!ok) allOk = false;
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + '  status=' + status + '  ' + detail);
  }
  return allOk;
}

/* ---------- 7. 附加：前端线上指纹（只记录，无本地基线时不做“是否一致”判断） ---------- */
async function frontendProbe() {
  try {
    const r = await httpGet(CFG.frontendBase + '/');
    const sha = sha256hex(Buffer.from(r.text, 'utf8'));
    log('frontend', CFG.frontendBase + ' status=' + r.status + ' sha256=' + sha + ' bytes=' + Buffer.byteLength(r.text));
    log('frontend', '仅记录线上指纹：本工作区没有 frontend/ 源码快照，无法与本地构建比对，因此不作“一致/不一致”判断');
  } catch (err) {
    log('frontend', '探测失败（不影响发布）：' + err.message);
  }
}

/* ---------- 主流程 ---------- */
async function doRollback() {
  const t0 = Date.now();
  let key = rollbackTarget;
  if (!key) {
    const list = await listReleases();
    if (!list.length) throw new Error('没有可用快照（' + CFG.releasePrefix + ' 下无 .zip）');
    key = list[0].key;
    log('rollback', '未指定 key，使用最近快照 ' + key + ' ' + bytes(list[0].size) + ' mtime=' + list[0].mtime);
  }
  if (!/^scf\/releases\//.test(key)) key = key.replace(/^\/+/, '');
  const before = await getFunction();
  log('rollback', '当前 ModTime=' + before.modTime);
  await updateCode(key);
  const after = await waitUpdated(before.modTime, 120000);
  const ok = await selfCheck();
  console.log('\n[rollback] 目标快照=' + key + ' 耗时=' + Math.round((Date.now() - t0) / 1000) + 's 结果=' + (ok ? 'SUCCESS' : 'SELF-CHECK FAILED'));
  if (!ok) console.log('[rollback] 如自检未过，可继续退更早快照：node server/scripts/scf-deploy.js --rollback <key>');
  process.exit(ok ? 0 : 2);
}

async function doDeploy() {
  const t0 = Date.now();
  log('start', '发布开始（快照 → 打包 → 上传 → 更新函数 → 自检）');

  /* 1) 快照：先拿函数状态（含 MYSQL_URL），再备份代码包与数据库 */
  let before = null;
  try {
    before = await getFunction();
  } catch (err) {
    log('scf', 'GetFunction 失败：' + err.message);
  }
  const snap = await snapshotCode();
  try {
    await snapshotDb((before && before.env) || {});
  } catch (err) {
    log('db', '数据库快照失败：' + err.message + '（继续发布，但本次无 DB 备份）');
  }

  const list = await listReleases();
  if (list.length > CFG.keepReleases) {
    log('snapshot', '保留策略：现有 ' + list.length + ' 份快照，超过 ' + CFG.keepReleases + ' 份。可手动清理较早的：');
    for (const o of list.slice(CFG.keepReleases)) log('snapshot', '  待清理 ' + o.key + ' ' + bytes(o.size) + ' ' + o.mtime);
  }

  /* 2) 打包 + 上传 */
  pack();
  const local = fs.readFileSync(ZIP);
  log('pack', bytes(local.length) + ' md5=' + md5(local));
  await uploadCode();

  /* 3) 更新函数 + 轮询 */
  try {
    await updateCode(CFG.objectKey);
    await waitUpdated(before ? before.modTime : '', 120000);
  } catch (err) {
    console.error('\n[FAIL] 更新函数失败：' + (err.code ? err.code + ' ' : '') + err.message);
    console.error('[线上状态] 代码包已上传到 COS，但函数未切换，线上仍是旧版。');
    console.error('[回滚] node server/scripts/scf-deploy.js --rollback ' + snap.key);
    throw err;
  }

  /* 4) 自检 */
  const ok = await selfCheck();
  if (!ok) {
    console.error('\n[线上状态] 新包已生效，但五步自检未全绿。');
    console.error('[回滚] node server/scripts/scf-deploy.js --rollback ' + snap.key);
  }
  await frontendProbe();
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log('\n[summary] 快照=' + snap.key + ' 新包=' + CFG.objectKey + ' 耗时=' + secs + 's 结果=' + (ok ? 'SUCCESS' : 'SELF-CHECK FAILED'));
  process.exit(ok ? 0 : 2);
}

(async () => {
  if (!CFG.secretId || !CFG.secretKey) throw new Error('缺少 COS_SECRET_ID/COS_SECRET_KEY（或 S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY）环境变量');
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });

  if (checkOnly) {
    const ok = await selfCheck();
    log('done', '仅自检，结果=' + (ok ? 'SUCCESS' : 'FAILED'));
    process.exit(ok ? 0 : 2);
  }
  if (isRollback) return doRollback();
  return doDeploy();
})().catch((err) => {
  const code = err && err.code;
  console.error('\n[FAIL] ' + (code ? code + ' ' : '') + (err && err.message));
  if (code === 'AuthFailure.UnauthorizedOperation' || code === 'UnauthorizedOperation' || code === 'AuthFailure') {
    console.error('→ CAM 权限不足：最小策略 scf:UpdateFunctionCode + scf:GetFunction，或授予 QcloudSCFFullAccess。');
  }
  console.error('[回滚提示] node server/scripts/scf-deploy.js --rollback');
  process.exit(1);
});
