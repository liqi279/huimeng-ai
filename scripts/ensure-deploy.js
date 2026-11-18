'use strict';

/* 发布校验占位脚本。
 * GitHub Pages 工作流固定执行 `npm run build`，本脚本只校验 deploy/ 产物完整，
 * 不再从 frontend/ 重新打包，确保发布的就是仓库里的 deploy/ 目录。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const idx = path.join(root, 'deploy', 'index.html');
const assets = path.join(root, 'deploy', 'assets');

if (!fs.existsSync(idx)) {
  console.error('[publish] 缺少 deploy/index.html');
  process.exit(1);
}
if (!fs.existsSync(assets)) {
  console.error('[publish] 缺少 deploy/assets');
  process.exit(1);
}

const html = fs.readFileSync(idx, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"?]+)/g)].map((m) => m[1]);
const miss = refs.filter((f) => !fs.existsSync(path.join(assets, f)));
if (miss.length) {
  console.error('[publish] deploy/assets 缺失：' + miss.join(', '));
  process.exit(1);
}

console.log('[publish] 直接发布 deploy/：index.html ' + fs.statSync(idx).size + ' 字节，资源 ' + refs.length + ' 个齐全');
