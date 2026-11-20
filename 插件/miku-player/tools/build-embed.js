#!/usr/bin/env node
/**
 * build-embed.js — 将 index.html 打包成可嵌入的 miku-player.js
 *
 * 产物：dist/miku-player.js
 * 用法：<script src="miku-player.js"></script>
 *       MikuPlayer.init('#container', { autoPlay: false, avatar: 'live2d' });
 *
 * 做的事：
 *   1. 从 index.html 抽取 <style> CSS、vinyl-widget HTML 片段、主程序 JS
 *   2. 从 miku/ 目录重读所有资源并 base64 编码，重建 MIKU_ASSETS
 *      （确保 model.json 内的动作文件名与实际文件一致）
 *   3. 包装成 window.MikuPlayer.init(container, options) 接口
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'index.html');
const MIKU_DIR = path.join(ROOT, 'miku');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'miku-player.js');

// ---------- 1. 读取 index.html ----------
const html = fs.readFileSync(SRC_HTML, 'utf8');

// 抽取 CSS
const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!cssMatch) throw new Error('未找到 <style> 块');
const CSS = cssMatch[1].trim();

// 抽取 widget HTML（从 vinyl-widget 到 audio 标签结束，不含 page 说明区）
const widgetStart = html.indexOf('<div id="vinyl-widget"');
const audioEnd = html.indexOf('</audio>', widgetStart) + '</audio>'.length;
if (widgetStart < 0 || audioEnd < 0) throw new Error('未找到 vinyl-widget / audio 片段');
const WIDGET_HTML = html.slice(widgetStart, audioEnd).trim();

// 抽取主程序 JS（assets script 之后的 <script>）
const assetsScriptEnd = html.indexOf('</script>', html.indexOf('id="miku-assets"'));
const appScriptStart = html.indexOf('<script>', assetsScriptEnd);
const appScriptEnd = html.indexOf('</script>', appScriptStart);
if (appScriptStart < 0 || appScriptEnd < 0) throw new Error('未找到主程序 <script>');
const APP_JS = html.slice(appScriptStart + '<script>'.length, appScriptEnd).trim();

// ---------- 2. 重建 MIKU_ASSETS（从 miku/ 目录重读） ----------
function walk(dir, base = '') {
  const result = {};
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) {
      Object.assign(result, walk(full, rel));
    } else {
      const buf = fs.readFileSync(full);
      result['miku/' + rel] = buf.toString('base64');
    }
  }
  return result;
}
const MIKU_ASSETS = walk(MIKU_DIR);

// ---------- 3. 组装 miku-player.js ----------
const wrapper = `/*!
 * Miku Vinyl Player — 可嵌入版
 * 用法：MikuPlayer.init(container, { autoPlay, avatar, position });
 * container 可以是 CSS 选择器字符串或 DOM 元素；不传则挂到 body。
 */
(function (global) {
  'use strict';

  var CSS = ${JSON.stringify(CSS)};
  var WIDGET_HTML = ${JSON.stringify(WIDGET_HTML)};
  var MIKU_ASSETS = ${JSON.stringify(MIKU_ASSETS)};

  var injectedStyle = false;
  var instances = [];

  function injectStyle() {
    if (injectedStyle) return;
    var style = document.createElement('style');
    style.setAttribute('data-miku-player', '');
    style.textContent = CSS;
    document.head.appendChild(style);
    injectedStyle = true;
  }

  function resolveContainer(arg) {
    if (!arg) return document.body;
    if (typeof arg === 'string') {
      var el = document.querySelector(arg);
      if (!el) throw new Error('MikuPlayer: 未找到容器 "' + arg + '"');
      return el;
    }
    if (arg && arg.nodeType === 1) return arg;
    throw new Error('MikuPlayer: container 必须是选择器字符串或 DOM 元素');
  }

  function runApp() {
${APP_JS}
  }

  /**
   * 初始化播放器。
   * @param {string|Element} [container] 容器选择器或元素，默认 body
   * @param {Object} [options]
   * @param {boolean} [options.autoPlay=false]  是否自动播放（受浏览器自动播放策略限制）
   * @param {string}  [options.avatar='live2d'] 默认形象：disc | live2d | spine | ae | builtin
   * @param {string}  [options.position]        覆盖默认位置，如 'right:36px;bottom:130px'
   * @returns {{ play:Function, pause:Function, toggle:Function, destroy:Function, el:HTMLElement }}
   */
  function init(container, options) {
    options = options || {};
    injectStyle();

    // 设置全局资源表（主程序通过 window.__MIKU_ASSETS__ 读取）
    global.__MIKU_ASSETS__ = MIKU_ASSETS;

    var host = resolveContainer(container);
    var wrap = document.createElement('div');
    wrap.className = 'miku-player-host';
    wrap.innerHTML = WIDGET_HTML;
    host.appendChild(wrap);

    // 可选：覆盖位置
    if (options.position) {
      var w = wrap.querySelector('#vinyl-widget');
      if (w) w.setAttribute('style', options.position);
    }

    // 执行主程序（会通过 getElementById 绑定刚注入的元素）
    runApp();

    var widget = wrap.querySelector('#vinyl-widget');
    var audio = wrap.querySelector('#audio');

    var api = {
      el: wrap,
      widget: widget,
      audio: audio,
      play: function () { if (audio) audio.play(); },
      pause: function () { if (audio) audio.pause(); },
      toggle: function () { if (audio) { if (audio.paused) audio.play(); else audio.pause(); } },
      destroy: function () {
        if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
        var idx = instances.indexOf(api);
        if (idx >= 0) instances.splice(idx, 1);
      }
    };
    instances.push(api);
    return api;
  }

  global.MikuPlayer = { init: init, instances: instances };

  // 自动初始化：若页面存在 [data-miku-player] 容器则自动挂载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
  function autoInit() {
    var nodes = document.querySelectorAll('[data-miku-player]');
    nodes.forEach(function (n) { init(n); });
  }
})(typeof window !== 'undefined' ? window : this);
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, wrapper, 'utf8');
console.log('已生成:', OUT_FILE, '(' + (fs.statSync(OUT_FILE).size / 1024).toFixed(1) + ' KB)');
console.log('资源文件数:', Object.keys(MIKU_ASSETS).length);
