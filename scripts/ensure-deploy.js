'use strict';

/* GitHub Pages 发布校验：多文件静态前端 + Dimverse 生产脚本。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const deploy = path.join(root, 'deploy');
const idx = path.join(deploy, 'index.html');
const assets = path.join(deploy, 'assets');
const dimverseSource = path.join(root, 'frontend', 'dimverse.js');
const dimverseBundle = path.join(assets, 'hm-s29-b9fa10c0.js');
const sourceStyles = path.join(root, 'frontend', 'styles.css');
const deployedStyles = path.join(assets, 'hm.css');
const pageStyles = path.join(deploy, 'styles.css');
const styleMarker = '/* ============ 次元宇宙 · 原网页背景上的透明 Canvas 游戏层 ============ */';
const legacyStyleMarker = '/* ============ 次元宇宙 · 原网页背景上的透明 Godot 游戏层 ============ */';

if (!fs.existsSync(idx) || !fs.existsSync(assets)) {
  console.error('[publish] 缺少 deploy/index.html 或 deploy/assets');
  process.exit(1);
}
if (!fs.existsSync(dimverseSource) || !fs.existsSync(sourceStyles) ||
    !fs.existsSync(dimverseBundle) || !fs.existsSync(deployedStyles) ||
    !fs.existsSync(pageStyles)) {
  console.error('[publish] 前端入口、样式或次元宇宙生产资源缺失');
  process.exit(1);
}

/* Pages 主入口必须保持轻量，并通过独立文件加载样式和脚本。 */
let html = fs.readFileSync(idx, 'utf8');
if (Buffer.byteLength(html, 'utf8') > 800000 ||
    !/href=["']styles\.css\?v=/.test(html) ||
    !/href=["']styles-admin\.css\?v=/.test(html) ||
    !/<script[^>]*\bsrc=["']api\.js\?v=/.test(html) ||
    !/<script[^>]*\bdefer\b/.test(html)) {
  console.error('[publish] Pages 入口仍是大型内嵌包，或缺少独立资源/延迟加载配置');
  process.exit(1);
}

/* 始终发布当前已验证的 Dimverse 控制器。 */
fs.copyFileSync(dimverseSource, dimverseBundle);

/* 兼容并替换独立的 dimverse.js 引用，保留 defer 执行时序。 */
const dimverseTag = /<script\b([^>]*\bsrc=["'](?:\.\/)?dimverse\.js(?:\?[^"']*)?["'][^>]*)><\/script>/i;
const dimverseMatch = html.match(dimverseTag);
if (dimverseMatch) {
  let attrs = dimverseMatch[1].replace(/\bsrc=(["'])([^"']+)\1/i,
    'src="./assets/hm-s29-b9fa10c0.js"');
  if (!/\bdefer\b/i.test(attrs)) attrs += ' defer';
  html = html.replace(dimverseTag, '<script' + attrs + '></script>');
} else if (!html.includes('./assets/hm-s29-b9fa10c0.js')) {
  console.error('[publish] Pages 入口缺少可替换的 Dimverse 脚本引用');
  process.exit(1);
}

/* 同步旧版共享样式资产，避免其他入口引用时出现版本漂移。 */
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
const existingIndex = currentIndex < 0 ? legacyIndex :
  legacyIndex < 0 ? currentIndex : Math.min(currentIndex, legacyIndex);
if (existingIndex >= 0) css = css.slice(0, existingIndex).trimEnd();
css = css.trimEnd() + '\n\n' + dimverseCss + '\n';
fs.writeFileSync(deployedStyles, css, 'utf8');

/* 主页面使用独立 styles.css；只在 HTML 内补充极小的透明游戏层规则。 */
if (!html.includes('.dv-godot-overlay')) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) {
    console.error('[publish] deploy/index.html 缺少 head 结束标签');
    process.exit(1);
  }
  const godotStyle = '<style>.dv-godot-overlay{position:absolute;z-index:4;inset:0;display:block;width:100%;height:100%;border:0;background:transparent!important;pointer-events:auto;touch-action:none;transition:opacity .35s ease}</style>';
  html = html.slice(0, headEnd) + godotStyle + html.slice(headEnd);
}
fs.writeFileSync(idx, html, 'utf8');

const refs = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"?]+)/g)].map((m) => m[1]);
const miss = refs.filter((f) => !fs.existsSync(path.join(assets, f)));
if (miss.length) {
  console.error('[publish] deploy/assets 缺失：' + miss.join(', '));
  process.exit(1);
}

const bundle = fs.readFileSync(dimverseBundle, 'utf8');
const deployedCss = fs.readFileSync(pageStyles, 'utf8');
for (const [ok, message] of [
  [bundle.includes("el('button', 'dv-start-btn is-pending', '开启')"), '生产脚本未包含等待标题入场完成后显示的开启按钮'],
  [bundle.includes('function startDimverseGame()') && bundle.includes("new URL('./dimverse/game/index.html'") && bundle.includes('function ensureGodotOverlay()'), '生产脚本未接入 Godot 双阶段游戏导出'],
  [bundle.includes("event.data === 'hm-godot-ready'") && bundle.includes("event.data === 'hm-godot-landed'"), '生产脚本未接入 Godot 生命周期桥接'],
  [bundle.includes("event.data === 'hm-godot-block'") && bundle.includes("event.data === 'hm-godot-maze'"), '生产脚本未接入问号方块和迷宫阶段提示'],
  [deployedCss.includes('.dv-start-btn'), '生产样式未包含开启按钮样式'],
  [deployedCss.includes('.dv-godot-overlay') && html.includes('.dv-godot-overlay'), '生产 HTML/CSS 未包含透明 Godot 游戏层样式'],
]) {
  if (!ok) {
    console.error('[publish] ' + message);
    process.exit(1);
  }
}

const criticalFiles = [
  'styles.css', 'styles-admin.css', 'jszip.min.js', 'chart.umd.min.js',
  'api.js', 'auth-ui.js', 'app.js', 'three.min.js', 'ui.js',
  'desk.js', 'admin.js', 'vendor/oua-canvas.js'
];
const missingFiles = criticalFiles.filter((file) =>
  !fs.existsSync(path.join(deploy, file))
);
if (missingFiles.length) {
  console.error('[publish] Pages 静态资源缺失：' + missingFiles.join(', '));
  process.exit(1);
}

console.log('[publish] 多文件 Pages 入口已验证：HTML ' +
  (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) +
  ' KB；独立 CSS/JS 资源、defer 加载与 Dimverse/Godot 资源均通过检查');
