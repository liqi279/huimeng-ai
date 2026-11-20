#!/usr/bin/env node
'use strict';

/* =============================================================
 * 图书馆入库：把一部「原画资料」的图片文件夹打成 PDF + 封面，
 * 上传到对象存储并写入书目（area=concept 即页面上的「原画资料」）。
 * -------------------------------------------------------------
 *   node server/scripts/library-import.js \
 *     --images "E:\...\白箱\原画集\xxx" \
 *     --title "白箱 · 动画线稿原画集" \
 *     --author "P.A.WORKS / 萌绘图库" \
 *     --intro "来源：[线稿集]SHIROBAKO 动画线稿原画集，共 N 页。" \
 *     [--area concept] [--base https://...] [--dry-run]
 *
 * 鉴权（二选一，按优先级）：
 *   LIBRARY_UPLOAD_KEY=xxx      —— 环境变量里的上传口令（x-upload-key）
 *   HM_ADMIN_TOKEN=xxx          —— 管理员登录后的 token（自动带 Bearer）
 *
 * 依赖：Python + Pillow（用于把图片拼成 PDF；本机已有）
 * ============================================================= */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const has = (name) => args.includes('--' + name);

const BASE = (arg('base', process.env.API_BASE) || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com').replace(/\/+$/, '');
const IMAGES = arg('images', '');
const TITLE = arg('title', '');
const AUTHOR = arg('author', '萌绘图库');
const INTRO = arg('intro', '');
const AREA = arg('area', 'concept');
const UPLOAD_KEY = String(process.env.LIBRARY_UPLOAD_KEY || '').trim();
const ADMIN_TOKEN = String(process.env.HM_ADMIN_TOKEN || '').trim();
const DRY = has('dry-run');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

function die(msg) {
  console.error('[ABORT] ' + msg);
  process.exit(1);
}
function log(tag, msg) {
  console.log('[' + tag.padEnd(8) + '] ' + msg);
}
function human(n) {
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function findPython() {
  const candidates = [
    process.env.DSH_PYTHON,
    'C:/Users/30453/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe',
    'python',
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'import PIL,sys;print(PIL.__version__)'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return '';
}

/* 图片 → 单文件 PDF：按文件名自然序排序，等比缩放到长边上限，JPEG 质量 88 */
const PY_BUILD = String.raw`
import os, sys, re
from PIL import Image

src, out_pdf, out_cover, max_edge, quality = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
exts = {'.jpg','.jpeg','.png','.webp','.bmp','.gif','.tif','.tiff'}
def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]
files = []
for root, _, names in os.walk(src):
    for n in names:
        if os.path.splitext(n)[1].lower() in exts:
            files.append(os.path.join(root, n))
files.sort(key=lambda p: natkey(os.path.relpath(p, src)))
if not files:
    print('NO_IMAGES'); sys.exit(3)

pages = []
for p in files:
    try:
        im = Image.open(p)
        im.load()
    except Exception:
        continue
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    w, h = im.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1,int(w*scale)), max(1,int(h*scale))), Image.LANCZOS)
    pages.append(im)
if not pages:
    print('NO_DECODABLE'); sys.exit(4)

first = pages[0].convert('RGB')
# 封面：长边 900，JPEG q85
cw, ch = first.size
cs = min(1.0, 900 / max(cw, ch))
cover = first.resize((max(1,int(cw*cs)), max(1,int(ch*cs))), Image.LANCZOS)
cover.save(out_cover, 'JPEG', quality=85, optimize=True)

pages[0].save(out_pdf, 'PDF', resolution=150.0, save_all=True, append_images=pages[1:])
print('OK', len(pages))
`;

async function main() {
  if (!IMAGES) die('缺少 --images <图片文件夹>');
  if (!TITLE) die('缺少 --title');
  const src = path.resolve(IMAGES);
  if (!fs.existsSync(src)) die('目录不存在：' + src);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-import-'));
  const pdfPath = path.join(work, 'book.pdf');
  const coverPath = path.join(work, 'cover.jpg');

  const py = findPython();
  if (!py) die('找不到带 Pillow 的 Python（可设置 DSH_PYTHON）');
  log('build', '拼 PDF 中（可能几分钟，取决于页数与分辨率）…');
  const r = spawnSync(py, ['-c', PY_BUILD, src, pdfPath, coverPath, arg('max-edge', '2400'), arg('quality', '88')], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) die('PDF 生成失败：' + (r.stdout || '') + (r.stderr || ''));
  const pages = Number((r.stdout || '').trim().split(/\s+/)[1] || 0);
  const pdfBytes = fs.statSync(pdfPath).size;
  const coverBytes = fs.statSync(coverPath).size;
  log('build', 'PDF ' + human(pdfBytes) + ' / ' + pages + ' 页；封面 ' + human(coverBytes));

  if (DRY) {
    log('dry-run', '不执行上传。产物：' + pdfPath + ' , ' + coverPath);
    return;
  }

  if (!UPLOAD_KEY && !ADMIN_TOKEN) {
    die('缺少鉴权：设置 LIBRARY_UPLOAD_KEY=xxx（上传口令）或 HM_ADMIN_TOKEN=xxx（管理员 token）');
  }
  const authHeaders = Object.assign(
    { 'Content-Type': 'application/json' },
    ADMIN_TOKEN ? { Authorization: 'Bearer ' + ADMIN_TOKEN } : { 'x-upload-key': UPLOAD_KEY },
  );

  async function presign(kind, name, mime, size) {
    const res = await fetch(BASE + '/api/library/uploads/presign', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ kind, name, mime, size }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error('presign 失败 ' + res.status + ' ' + text.slice(0, 200));
    return JSON.parse(text);
  }

  async function put(url, mime, filePath) {
    const body = fs.readFileSync(filePath);
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mime }, body });
    if (!res.ok) throw new Error('上传失败 ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }

  const stamp = Date.now().toString(36);
  const slug = String(arg('slug', 'book')).replace(/[^A-Za-z0-9._-]/g, '_');

  log('upload', '申请 PDF 直传地址…');
  const p1 = await presign('books', 'lwa-' + stamp + '-' + slug + '.pdf', 'application/pdf', pdfBytes);
  await put(p1.url, 'application/pdf', pdfPath);
  log('upload', 'PDF 已上传 ' + p1.key);

  log('upload', '申请封面上传地址…');
  const p2 = await presign('covers', 'lwa-' + stamp + '-' + slug + '-cover.jpg', 'image/jpeg', coverBytes);
  await put(p2.url, 'image/jpeg', coverPath);
  log('upload', '封面已上传 ' + p2.key);

  const book = {
    title: TITLE,
    author: AUTHOR,
    intro: INTRO || ('来源：本地图集，共 ' + pages + ' 页原画。'),
    pageCount: pages,
    area: AREA,
    toc: [],
    pdfKey: p1.key,
    pdfBytes,
    coverKey: p2.key,
    coverBytes,
  };
  const res = await fetch(BASE + '/api/library/books', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ADMIN_TOKEN ? { Authorization: 'Bearer ' + ADMIN_TOKEN } : {}),
    body: JSON.stringify(book),
  });
  const text = await res.text();
  if (!res.ok) die('写入书目失败 ' + res.status + ' ' + text.slice(0, 300));
  const created = JSON.parse(text).book || {};
  log('done', '入库成功 id=' + created.id + ' 标题=' + (created.title || TITLE));
  console.log('\n下一步：node server/scripts/db-export.js 刷新书目快照（可选）');
}

main().catch((err) => die((err && err.message) || String(err)));
