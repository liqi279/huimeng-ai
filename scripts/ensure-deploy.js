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

/* The Pages HTML is a legacy self-contained bundle. Replace its embedded
 * stale Dimverse controller with the canonical, independently tested asset.
 * This keeps the deployed entry point in sync with frontend/dimverse.js.
 */
let html = fs.readFileSync(idx, 'utf8');
const dimverseMarker = '次元宇宙（Dimensional Universe）';
const dimverseStart = html.indexOf(dimverseMarker);
if (dimverseStart >= 0 && !html.includes('./assets/hm-s29-b9fa10c0.js')) {
  const scriptStart = html.lastIndexOf('<script', dimverseStart);
  const scriptEnd = html.indexOf('</script>', dimverseStart);
  if (scriptStart < 0 || scriptEnd < 0) {
    console.error('[publish] 无法定位 deploy/index.html 中的旧次元宇宙脚本');
    process.exit(1);
  }
  html = html.slice(0, scriptStart) +
    '<script src="./assets/hm-s29-b9fa10c0.js"></script>' +
    html.slice(scriptEnd + '</script>'.length);
  fs.writeFileSync(idx, html, 'utf8');
}
/* The deployed HTML has its platform CSS inlined and does not load hm.css.
 * Add only the new transparent Godot iframe rule to avoid duplicating the
 * entire platform stylesheet.
 */
if (!html.includes('.dv-godot-overlay')) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) {
    console.error('[publish] deploy/index.html 缺少 head 结束标签');
    process.exit(1);
  }
  const godotStyle = '<style>.dv-godot-overlay{position:absolute;z-index:4;inset:0;display:block;width:100%;height:100%;border:0;background:transparent!important;pointer-events:auto;touch-action:none;transition:opacity .35s ease}</style>';
  html = html.slice(0, headEnd) + godotStyle + html.slice(headEnd);
  fs.writeFileSync(idx, html, 'utf8');
}
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
  [bundle.includes('function startDimverseGame()') && bundle.includes("new URL('./dimverse/game/index.html'") && bundle.includes('function ensureGodotOverlay()'), '生产脚本未接入 Godot 双阶段游戏导出'],
  [bundle.includes("event.data === 'hm-godot-ready'") && bundle.includes("event.data === 'hm-godot-landed'"), '生产脚本未接入 Godot 生命周期桥接'],
  [deployedCss.includes('.dv-start-btn'), '生产样式未包含开启按钮样式'],
  [deployedCss.includes('.dv-godot-overlay') && html.includes('.dv-godot-overlay'), '生产 HTML/CSS 未包含透明 Godot 游戏层样式'],
]) {
  if (!ok) {
    console.error('[publish] ' + message);
    process.exit(1);
  }
}

console.log('[publish] Dimverse production bundle synchronized; deploy/ assets ' + refs.length + ' references verified');
