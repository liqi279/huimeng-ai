'use strict';

/* 把 frontend/ 下的分文件源码打包成单文件 HTML：
 *   deploy/index.html（GitHub Pages / Vercel / Netlify 静态托管）
 *   绘梦AI动漫创作平台.html（本地双击打开）
 * 用法：node scripts/build-deploy.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'frontend');

function read(name) {
  return fs.readFileSync(path.join(FE, name), 'utf8');
}

function inlineStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}

function inlineScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

let html = read('index.html');

const styleTag = '<style>\n' + inlineStyle(read('styles.css')) + '\n</style>';
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.css["'][^>]*>/i, styleTag);
if (!html.includes(styleTag.slice(0, 40))) {
  throw new Error('未找到 styles.css 的 link 标签');
}

const scripts = ['jszip.min.js', 'api.js', 'auth-ui.js', 'app.js', 'ui.js', 'desk.js'];
for (const file of scripts) {
  const re = new RegExp('<script[^>]*src=["\']' + file.replace(/\./g, '\\.') + '["\'][^>]*></script>', 'i');
  if (!re.test(html)) throw new Error('未找到脚本标签：' + file);
  html = html.replace(re, () => '<script>\n' + inlineScript(read(file)) + '\n</script>');
}

if (/<script[^>]+src=|<link[^>]+href=/i.test(html)) {
  throw new Error('仍有未内联的外部资源引用');
}

const outFiles = [
  path.join(ROOT, 'deploy', 'index.html'),
  path.join(ROOT, '绘梦AI动漫创作平台.html')
];

for (const file of outFiles) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  console.log('已生成 ' + path.relative(ROOT, file) + '（' + (html.length / 1024).toFixed(1) + ' KB）');
}
