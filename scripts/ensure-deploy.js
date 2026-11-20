'use strict';

/* GitHub Pages publishes deploy/. Keep the production Dimverse assets synchronized
 * with their canonical frontend sources before validating the artifact.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const idx = path.join(root, 'deploy', 'index.html');
const assets = path.join(root, 'deploy', 'assets');
const dimverseSource = path.join(root, 'frontend', 'dimverse.js');
const dimverseBundle = path.join(assets, 'hm-s29-b9fa10c0.js');
const sourceStyles = path.join(root, 'frontend', 'styles.css');
const deployedStyles = path.join(assets, 'hm.css');
const styleMarker = '/* ============ 次元宇宙 · 原网页背景上的透明 Canvas 游戏层 ============ */';
const legacyStyleMarker = '/* ============ 次元宇宙 · 原网页背景上的透明 Godot 游戏层 ============ */';

if (!fs.existsSync(idx) || !fs.existsSync(assets)) {
  console.error('[publish] 缺少 deploy/index.html 或 deploy/assets');
  process.exit(1);
}
if (!fs.existsSync(dimverseSource) || !fs.existsSync(sourceStyles) ||
    !fs.existsSync(dimverseBundle) || !fs.existsSync(deployedStyles)) {
  console.error('[publish] 次元宇宙源文件或生产资源缺失');
  process.exit(1);
}

/* Always publish the exact tested Dimverse controller source. */
fs.copyFileSync(dimverseSource, dimverseBundle);

/* The production stylesheet contains the shared platform CSS; append the
 * canonical Dimverse-only overlay rules without replacing unrelated styles. */
const sourceCss = fs.readFileSync(sourceStyles, 'utf8');
const markerIndex = sourceCss.indexOf(styleMarker);
if (markerIndex < 0) {
  console.error('[publish] frontend/styles.css 缺少 Canvas 游戏层样式标记');
  process.exit(1);
}
const dimverseCss = sourceCss.slice(markerIndex).trim();
let css = fs.readFileSync(deployedStyles, 'utf8');
const currentIndex = css.indexOf(styleMarker);
const legacyIndex = css.indexOf(legacyStyleMarker);
const existingIndex = currentIndex < 0 ? legacyIndex : legacyIndex < 0 ? currentIndex : Math.min(currentIndex, legacyIndex);
if (existingIndex >= 0) css = css.slice(0, existingIndex).trimEnd();
css = css.trimEnd() + '\n\n' + dimverseCss + '\n';
fs.writeFileSync(deployedStyles, css, 'utf8');

const html = fs.readFileSync(idx, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"?]+)/g)].map((m) => m[1]);
const miss = refs.filter((f) => !fs.existsSync(path.join(assets, f)));
if (miss.length) {
  console.error('[publish] deploy/assets 缺失：' + miss.join(', '));
  process.exit(1);
}

const bundle = fs.readFileSync(dimverseBundle, 'utf8');
const deployedCss = fs.readFileSync(deployedStyles, 'utf8');
for (const [ok, message] of [
  [bundle.includes("el('button', 'dv-start-btn is-pending', '开启')"), '生产脚本未包含等待标题入场完成后显示的开启按钮'],
  [bundle.includes('function startDimverseGame()'), '生产脚本未包含本页团子游戏启动逻辑'],
  [bundle.includes('function drawGameDango(ctx, s, now, airHeight, scale)'), '生产脚本未包含团子绘制与弹性动画'],
  [bundle.includes('function spawnRandomCrystal(s)'), '生产脚本未包含随机能量晶体生成'],
  [bundle.includes('function generateMaze(s)'), '生产脚本未包含第二关随机迷宫生成'],
  [bundle.includes('function updateMazeGhosts(s, dt, now)'), '生产脚本未包含双幽灵追击逻辑'],
  [deployedCss.includes('.dv-challenge-signboard'), '生产样式未包含一分钟挑战招牌样式'],
  [deployedCss.includes('.dv-game-return-vortex'), '生产样式未包含漩涡返回过渡样式'],
  [deployedCss.includes('.dv-start-btn'), '生产样式未包含开启按钮样式'],
  [deployedCss.includes('.dv-browser-game'), '生产样式未包含 Canvas 游戏层样式'],
]) {
  if (!ok) {
    console.error('[publish] ' + message);
    process.exit(1);
  }
}

console.log('[publish] Dimverse production bundle synchronized; deploy/ assets ' + refs.length + ' references verified');
