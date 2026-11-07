'use strict';

/* 把 frontend/ 下的分文件源码打包成单文件 HTML：
 *   deploy/index.html（GitHub Pages / Vercel / Netlify 静态托管）
 *   绘梦AI动漫创作平台.html（本地双击打开）
 * 用法：node scripts/build-deploy.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'frontend');

/* 生成唯一构建 ID（时间戳 + 短哈希），供前端版本更新检测 */
function makeBuildId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
  let commit = '0000000';
  try {
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
  /* 注入 const HM_BUILD = 'xxx' 到 <head> 末尾 */
  const injection =
    '<script>window.HM_BUILD = "' + buildId + '";</script>';
  html = html.replace(
    /(<\/head>)/i,
    injection + '\n$1'
  );
  return html;
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
console.log('构建 ID：' + buildId);

let html = read('index.html');

const styleTag = '<style>\n' + inlineStyle(read('styles.css')) + '\n</style>';
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.css["'][^>]*>/i, styleTag);
if (!html.includes(styleTag.slice(0, 40))) {
  throw new Error('未找到 styles.css 的 link 标签');
}

const styleAdminTag = '<style>\n' + inlineStyle(read('styles-admin.css')) + '\n</style>';
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles-admin\.css["'][^>]*>/i, styleAdminTag);
if (!html.includes(styleAdminTag.slice(0, 40))) {
  throw new Error('未找到 styles-admin.css 的 link 标签');
}

const scripts = ['three.min.js', 'HMOrbitControls.js', 'HMTransformControls.js', 'HMDRACOLoader.js', 'HMGLTFLoader.js', 'female-mannequin-glb.js', 'miku-player.js', 'miku-chat.js', 'jszip.min.js', 'chart.umd.min.js', 'api.js', 'auth-ui.js', 'app.js', 'storyboard.js', 'director3d.js', 'paint.js', 'toolimage.js', 'toolreference.js', 'tooltraining.js', 'toolrestore.js', 'toolworkflow.js', 'toolvideo.js', 'chat.js', 'canvas.js', 'library.js', 'voice.js', 'toon.js', 'ui.js', 'dimverse.js', 'desk.js', 'admin.js'];
for (const file of scripts) {
  const re = new RegExp('<script[^>]*src=["\']' + file.replace(/\./g, '\\.') + '["\'][^>]*></script>', 'i');
  if (!re.test(html)) throw new Error('未找到脚本标签：' + file);
  html = html.replace(re, () => '<script>\n' + inlineScript(read(file)) + '\n</script>');
}

/* 初音未来播放器插件运行时按 ./lib/ 加载引擎脚本，随部署一起发布 */
const deployLibDir = path.join(ROOT, 'deploy', 'lib');
fs.mkdirSync(deployLibDir, { recursive: true });
const feLibDir = path.join(FE, 'lib');
if (fs.existsSync(feLibDir)) {
  for (const file of fs.readdirSync(feLibDir)) {
    if (!file.endsWith('.js')) continue;
    fs.copyFileSync(path.join(feLibDir, file), path.join(deployLibDir, file));
  }
}

/* 图书馆种子数据：内联进单文件，静态部署（无后端）时作为离线书架 */
const seedPath = path.join(ROOT, 'data', 'library', 'books.seed.json');
if (!fs.existsSync(seedPath)) throw new Error('缺少图书馆种子数据：data/library/books.seed.json');
const seedRaw = fs.readFileSync(seedPath, 'utf8');
let seedData;
try {
  seedData = JSON.parse(seedRaw);
} catch (err) {
  throw new Error('图书馆种子数据不是合法 JSON：' + err.message);
}
const seedTag = '<script>window.HM_LIBRARY_SEED = '
  + inlineScript(JSON.stringify(seedData))
  + ';</script>\n</head>';
html = html.replace('</head>', seedTag);

if (/<script[^>]+src=|<link[^>]+href=/i.test(html)) {
  throw new Error('仍有未内联的外部资源引用');
}

html = injectBuildId(html, buildId);

const outFiles = [
  path.join(ROOT, 'deploy', 'index.html'),
  path.join(ROOT, '绘梦AI动漫创作平台.html')
];

for (const file of outFiles) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  console.log('已生成 ' + path.relative(ROOT, file) + '（' + (html.length / 1024).toFixed(1) + ' KB）');
}
