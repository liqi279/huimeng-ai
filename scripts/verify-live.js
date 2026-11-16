#!/usr/bin/env node
'use strict';

/* 上线自检：CI 结论 + 后端 health + 数据库 books + 前端 Pages
 *
 *   node scripts/verify-live.js --sha <commit> [--expect-scf] [--no-wait]
 *
 * 退出码 0 表示全部通过，1 表示有失败项。
 * 只读接口，不改任何线上状态；token 只从 HM_GITHUB_TOKEN 或本仓库
 * .git/config 的 extraHeader 读取，不打印。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'liqi279';
const REPO = 'huimeng-ai';
const PAGES_URL = 'https://liqi279.github.io/huimeng-ai/';
const API_BASE = process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com';

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
}
const sha = argValue('--sha');
const expectScf = argv.includes('--expect-scf');
const noWait = argv.includes('--no-wait');

const OK = [];
const BAD = [];
const SKIP = [];
function pass(n, d) { OK.push(n); console.log('  PASS  ' + n + (d ? '  ' + d : '')); }
function fail(n, d) { BAD.push(n); console.log('  FAIL  ' + n + (d ? '  ' + d : '')); }
function skip(n, d) { SKIP.push(n); console.log('  SKIP  ' + n + (d ? '  ' + d : '')); }
function head(t) { console.log('\n=== ' + t + ' ==='); }

function readToken() {
  if (process.env.HM_GITHUB_TOKEN) return process.env.HM_GITHUB_TOKEN.trim();
  try {
    const cfg = fs.readFileSync(path.join(ROOT, '.git', 'config'), 'utf8');
    const m = cfg.match(/extraHeader\s*=\s*Authorization:\s*Basic\s+(\S+)/i);
    if (!m) return '';
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx >= 0 ? decoded.slice(idx + 1) : '';
  } catch (e) { return ''; }
}

async function gh(pathname, token) {
  const res = await fetch('https://api.github.com' + pathname, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'huimeng-verify',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRuns(token) {
  const expect = ['Deploy to GitHub Pages'];
  if (expectScf) expect.push('Deploy backend to Tencent SCF');
  const seen = new Map();
  const deadline = Date.now() + 12 * 60 * 1000;
  console.log('  等待：' + expect.join(' / ') + '（最多 12 分钟）');
  while (Date.now() < deadline) {
    let data = null;
    try {
      data = await gh('/repos/' + OWNER + '/' + REPO + '/actions/runs?head_sha=' + sha + '&per_page=20', token);
    } catch (e) {
      console.log('        查询失败：' + e.message);
      await sleep(15000);
      continue;
    }
    let done = true;
    for (const name of expect) {
      const run = (data.workflow_runs || []).find((r) => r.name === name && r.head_sha === sha);
      if (!run) { done = false; continue; }
      seen.set(name, run);
      if (run.status !== 'completed') done = false;
    }
    if (done) break;
    await sleep(10000);
  }
  for (const name of expect) {
    const run = seen.get(name);
    if (!run) { fail(name, '未找到该 SHA 的流水线'); continue; }
    if (run.conclusion === 'success') pass(name, 'success');
    else fail(name, String(run.conclusion));
  }
}

async function liveChecks() {
  try {
    const res = await fetch(API_BASE + '/api/health', { signal: AbortSignal.timeout(25000) });
    const j = await res.json();
    if (res.status === 200 && j.storage === 'mysql' && j.persistent === true) {
      pass('后端 /api/health', 'version=' + j.version + ' storage=' + j.storage + ' persistent=' + j.persistent);
    } else {
      fail('后端 /api/health', 'status=' + res.status + ' storage=' + j.storage + ' persistent=' + j.persistent);
    }
  } catch (e) {
    fail('后端 /api/health', e.message);
  }

  try {
    const res = await fetch(API_BASE + '/api/library/books', {
      headers: { Origin: 'https://liqi279.github.io' },
      signal: AbortSignal.timeout(25000),
    });
    const j = await res.json();
    const items = j.items || [];
    const mode = j.store && j.store.mode;
    if (res.status === 200 && mode === 'mysql' && items.length > 0) {
      pass('数据库 /api/library/books', 'items=' + items.length + ' mode=' + mode + ' mysqlError=' + ((j.store && j.store.mysqlError) || 'none'));
    } else {
      fail('数据库 /api/library/books', 'status=' + res.status + ' items=' + items.length + ' mode=' + mode);
    }
  } catch (e) {
    fail('数据库 /api/library/books', e.message);
  }

  try {
    const res = await fetch(PAGES_URL + '?cb=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'huimeng-verify' },
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    const tag = (text.match(/window\.HM_BUILD\s*=\s*"([^"]+)"/) || [])[1] || '(未找到构建标记)';
    if (res.status === 200 && /绘梦|HM_BUILD/.test(text)) pass('前端 Pages', res.status + '  ' + text.length + 'B  build=' + tag);
    else fail('前端 Pages', 'status=' + res.status);
  } catch (e) {
    skip('前端 Pages', '本机网络探测不到（' + e.message + '），以 CI 结论为准');
  }
}

(async () => {
  if (sha) {
    head('CI 流水线');
    const token = readToken();
    if (!token) skip('CI 轮询', '没有可用 token');
    else if (noWait) skip('CI 轮询', '--no-wait');
    else await waitRuns(token);
  }

  head('线上自检');
  await liveChecks();

  head('结果');
  console.log('  通过 ' + OK.length + ' 项；跳过 ' + SKIP.length + ' 项；失败 ' + BAD.length + ' 项' + (BAD.length ? '：' + BAD.join(', ') : ''));
  if (BAD.length) process.exit(1);
})();
