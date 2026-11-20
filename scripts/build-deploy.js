'use strict';

/*
 * GitHub Pages：发布可缓存的多文件前端，避免把数 MB CSS/JS 内嵌到单个 HTML。
 * 本地双击文件：仍生成独立的自包含 HTML，保持原有离线预览能力。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'frontend');
const DEPLOY = path.join(ROOT, 'deploy');

function makeBuildId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  let commit = '0000000';
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      const refPath = path.join(ROOT, '.git', head.replace('ref: ', '').trim());
      commit = fs.readFileSync(refPath, 'utf8').trim().slice(0, 7);
    } else {
      commit = head.slice(0, 7);
    }
  } catch (e) {}
  return stamp + '-' + commit;
}

function injectBuildId(html, buildId) {
  if (/window\.HM_BUILD\s*=/.test(html)) return html;
  return html.replace(/(<\/head>)/i,
    '<script>window.HM_BUILD = "' + buildId + '";</script>\n$1');
}

function read(name) {
  return fs.readFileSync(path.join(FE, name), 'utf8');
}
function inlineStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}
function inlineScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

const buildId = makeBuildId();
const scripts = [
  'jszip.min.js', 'chart.umd.min.js', 'api.js', 'auth-ui.js', 'app.js',
  'three.min.js', 'HMOrbitControls.js', 'HMTransformControls.js',
  'HMDRACOLoader.js', 'HMGLTFLoader.js', 'female-mannequin-glb.js',
  'miku-player.js', 'storyboard.js', 'director3d.js', 'paint.js',
  'toolimage.js', 'toolreference.js', 'tooltraining.js', 'toolrestore.js',
  'toolworkflow.js', 'toolvideo.js', 'chat.js', 'canvas.js', 'library.js',
  'voice.js', 'toon.js', 'ui.js', 'dimverse.js', 'desk.js', 'admin.js'
];

/* 1. 本地独立文件：保留旧的自包含构建方式。 */
let standalone = read('index.html');
const styleTag = '<style>\n' + inlineStyle(read('styles.css')) + '\n</style>';
standalone = standalone.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.css["'][^>]*>/i,
  styleTag
);
if (!standalone.includes(styleTag.slice(0, 40))) {
  throw new Error('未找到 styles.css 的 link 标签');
}
const adminStyleTag = '<style>\n' + inlineStyle(read('styles-admin.css')) + '\n</style>';
standalone = standalone.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles-admin\.css["'][^>]*>/i,
  adminStyleTag
);
if (!standalone.includes(adminStyleTag.slice(0, 40))) {
  throw new Error('未找到 styles-admin.css 的 link 标签');
}
for (const file of scripts) {
  const escaped = file.replace(/\./g, '\\.');
  const re = new RegExp("<script[^>]*src=[\"']" + escaped + "[\"'][^>]*></script>", "i");
  if (!re.test(standalone)) throw new Error('未找到脚本标签：' + file);
  standalone = standalone.replace(re, () => '<script>\n' + inlineScript(read(file)) + '\n</script>');
}
standalone = injectBuildId(standalone, buildId);
fs.writeFileSync(path.join(ROOT, '绘梦AI动漫创作平台.html'), standalone, 'utf8');
console.log('已生成本地自包含文件（' + (standalone.length / 1024).toFixed(1) + ' KB）');

/* 2. Pages 发布：复制源码和静态资源，保留 deploy/ 中额外的游戏、资源与 vendor 文件。 */
fs.mkdirSync(DEPLOY, { recursive: true });
fs.cpSync(FE, DEPLOY, { recursive: true, force: true });

let page = read('index.html');
page = injectBuildId(page, buildId);
page = page.replace(
  /(<link\b[^>]*\bhref=["'])(styles(?:-admin)?\.css)(["'])/gi,
  (_, prefix, file, suffix) => prefix + file + '?v=' + encodeURIComponent(buildId) + suffix
);

const criticalScripts = new Set([
  'jszip.min.js', 'chart.umd.min.js', 'api.js', 'auth-ui.js', 'app.js'
]);
page = page.replace(
  /<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)><\/script>/gi,
  (tag, attrs, src) => {
    const clean = src.replace(/^\.\//, '').split('?')[0];
    if (!scripts.includes(clean)) return tag;
    attrs = attrs.replace(/\bsrc=(["'])([^"']+)\1/i, (_, quote, value) =>
      'src=' + quote + value.split('?')[0] + '?v=' + encodeURIComponent(buildId) + quote
    );
    if (!criticalScripts.has(clean) && !/\bdefer\b/i.test(attrs)) attrs += ' defer';
    return '<script' + attrs + '></script>';
  }
);

fs.writeFileSync(path.join(DEPLOY, 'index.html'), page, 'utf8');

/* 初音未来播放器依赖的本地引擎脚本随 Pages 一起发布。 */
const feLib = path.join(FE, 'lib');
const deployLib = path.join(DEPLOY, 'lib');
if (fs.existsSync(feLib)) fs.cpSync(feLib, deployLib, { recursive: true, force: true });

const required = ['styles.css', 'styles-admin.css', ...scripts];
for (const file of required) {
  const target = path.join(DEPLOY, file);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    throw new Error('Pages 发布资源缺失：' + file);
  }
}
if (page.length > 800000 || !/styles\.css\?v=/.test(page) || !/<script[^>]*\bdefer\b/.test(page)) {
  throw new Error('Pages 入口未正确拆分或启用延迟脚本加载');
}
console.log('Pages 多文件产物已准备：HTML ' +
  (Buffer.byteLength(page, 'utf8') / 1024).toFixed(1) +
  ' KB；' + required.length + ' 个独立资源可缓存；非首屏模块 defer 加载');
