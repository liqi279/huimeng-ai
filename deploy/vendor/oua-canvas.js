/*!
 * OUA Canvas 0.2.0 · 绘梦 AI 独立绘画引擎（第二段）
 * ---------------------------------------------------------------------------
 * 单文件、零依赖、纯原生浏览器 API。两种用法：
 *
 * 1) 独立页（自带工具条 + 右侧面板）：
 *    window.OUACanvas.mount(container, { width, height, storageKey });
 *
 * 2) 嵌入页面（无自带 UI，画布铺满容器，适合「构图纸上直接画」）：
 *    window.OUACanvas.mount(container, {
 *      chrome: false, background: 'transparent', shadow: false, border: false,
 *      fit: 'view', brushUnit: 'px', storageKey: 'hm.oua.paint.v2',
 *      width: 257, height: 364            // 文档坐标（这里直接用纸面 mm）
 *    });
 *    api.setViewport({ x, y, w, h });      // 文档坐标里可见的窗口（mm）
 *    api.attachCurve(canvasEl);            // 把曲线编辑器挂到页面自己的面板
 *
 * 能力（第二段补齐）：
 *   画笔 / 橡皮 / 压感 / 压感曲线 / 最小最大笔宽 / 稳定器 / 撤销重做 60 步
 *   图层：新建 复制 删除 重命名 显隐 透明度 混合模式 上下移动 当前层
 *   帧：加帧 删帧 复制帧 拖动排序 当前帧高亮 洋葱皮
 *   播放：按 fps 播放 / 暂停 / 逐帧前后走
 *   导出：当前帧 PNG / 整段序列帧 ZIP
 *   嵌入：无 chrome、透明底、无阴影边框、按 view 窗口等比映射
 *
 * 持久化：整个工程（含帧 / 图层 / 笔画 / 设置 / 曲线）存在 localStorage。
 * 本文件不读写宿主页面除挂载容器以外的 DOM。
 */
(function (global) {
  'use strict';

  var VERSION = '0.2.0';
  var STYLE_ID = 'ouac-style';
  var HISTORY_LIMIT = 60;
  var LUT_SIZE = 512;
  var CACHE_SCALE = 4;        // 图层 / 帧合成缓存的内部倍率（文档单位 → 缓存像素）
  var FRAME_DUR = 2;          // 新帧默认时长（帧数，12fps 下约 1/6 秒）

  var DEFAULT_CURVE = [[0, 0], [0.25, 0.3], [0.5, 0.55], [0.75, 0.8], [1, 1]];
  var CURVE_PRESETS = {
    linear: [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]],
    soft: [[0, 0], [0.25, 0.1], [0.5, 0.28], [0.75, 0.6], [1, 1]],
    hard: [[0, 0], [0.25, 0.42], [0.5, 0.78], [0.75, 0.94], [1, 1]],
    s: [[0, 0], [0.25, 0.12], [0.5, 0.5], [0.75, 0.88], [1, 1]]
  };

  var DEFAULTS = {
    width: 1280,
    height: 720,
    fps: 12,
    storageKey: 'ouac.default',
    minBrush: 2,
    maxBrush: 28,
    pressureCurve: null,
    pressureExp: 0.85,
    pressureWidth: true,
    pressureOpacity: true,
    stabilizer: 3,
    color: '#1a1a1a',
    opacity: 1,
    background: '#ffffff',
    pressureSource: null,
    /* 第二段新增 */
    chrome: true,
    fit: 'fit',              // 'fit' | 'fill' | 'view'
    padding: 12,
    shadow: true,
    border: true,
    view: null,              // { x, y, w, h } 文档坐标
    brushUnit: 'doc',        // 'doc' | 'px'：设置里的笔宽单位
    exportWidth: 1920
  };

  var CSS = [
    '.ouac-root{--ouac-bg:#15171c;--ouac-panel:#1c1f25;--ouac-line:#2b303a;--ouac-fg:#e7eaf0;--ouac-dim:#8d95a5;--ouac-accent:#6ea8ff;',
    'display:flex;flex-direction:column;width:100%;height:100%;min-height:300px;background:var(--ouac-bg);color:var(--ouac-fg);',
    'font:12px/1.5 Inter,"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif;border-radius:12px;overflow:hidden;',
    'box-sizing:border-box;user-select:none;-webkit-user-select:none;outline:none}',
    '.ouac-root *{box-sizing:border-box}',
    '.ouac-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;background:linear-gradient(#1f2229,#1a1d23);border-bottom:1px solid var(--ouac-line)}',
    '.ouac-group{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-right:8px;border-right:1px solid var(--ouac-line)}',
    '.ouac-group:last-child{border-right:0;padding-right:0}',
    '.ouac-btn{appearance:none;border:1px solid var(--ouac-line);background:#252932;color:var(--ouac-fg);border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer;line-height:1.2}',
    '.ouac-btn:hover{border-color:#3d4655;background:#2c313c}',
    '.ouac-btn:active{transform:translateY(1px)}',
    '.ouac-btn.is-on{background:rgba(110,168,255,.16);border-color:rgba(110,168,255,.65);color:#cfe2ff}',
    '.ouac-btn[disabled]{opacity:.38;cursor:not-allowed}',
    '.ouac-mini{appearance:none;border:1px solid var(--ouac-line);background:#252932;color:var(--ouac-fg);border-radius:5px;padding:2px 7px;font:inherit;font-size:11px;cursor:pointer}',
    '.ouac-mini:hover{border-color:#3d4655}',
    '.ouac-field{display:flex;align-items:center;gap:5px;color:var(--ouac-dim);font-size:11px;white-space:nowrap}',
    '.ouac-field input[type=range]{width:74px;accent-color:#6ea8ff}',
    '.ouac-field b{color:#cdd6e6;font-weight:600;min-width:26px;display:inline-block}',
    '.ouac-field-wide{width:100%;padding:4px 0 0}',
    '.ouac-field-wide input[type=range]{flex:1;width:auto}',
    '.ouac-check{display:flex;align-items:center;gap:4px;color:#aeb7c7;font-size:11px;white-space:nowrap;cursor:pointer}',
    '.ouac-check input{accent-color:#6ea8ff}',
    '.ouac-color{width:28px;height:24px;padding:0;border:1px solid var(--ouac-line);border-radius:6px;background:#252932;cursor:pointer}',
    '.ouac-body{flex:1;display:flex;min-height:0}',
    '.ouac-stage{position:relative;flex:1;min-width:0;min-height:0;background:radial-gradient(circle at 50% 40%,#1c2027,#111318 70%);overflow:hidden}',
    '.ouac-stageCanvas{position:absolute;left:0;top:0;display:block;touch-action:none;cursor:crosshair}',
    '.ouac-hint{position:absolute;left:10px;bottom:8px;color:#7f8899;font-size:11px;background:rgba(12,14,18,.55);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:3px 8px;pointer-events:none;white-space:nowrap}',
    '.ouac-side{width:250px;flex:0 0 250px;border-left:1px solid var(--ouac-line);background:#181b21;display:flex;flex-direction:column;gap:1px;overflow:auto}',
    '.ouac-panel{padding:10px;border-bottom:1px solid var(--ouac-line);display:flex;flex-direction:column;gap:8px}',
    '.ouac-panelHead{display:flex;align-items:center;justify-content:space-between;color:#aab3c3;font-size:11px;letter-spacing:.04em}',
    '.ouac-curve{width:100%;height:150px;display:block;border:1px solid var(--ouac-line);border-radius:6px;background:#12141a;touch-action:none;cursor:crosshair}',
    '.ouac-presets{display:flex;gap:5px;flex-wrap:wrap}',
    '.ouac-curveInfo{color:#8d95a5;font-size:11px;line-height:1.7;word-break:break-all}',
    '.ouac-curveInfo b{color:#cdd6e6;font-weight:600}',
    '.ouac-status{color:#8d95a5;font-size:11px;line-height:1.6;min-height:32px}',
    '.ouac-status.is-warn{color:#ffb86b}',
    /* 嵌入模式：只留画布，不留任何工具栏 / 背景 / 阴影 / 圆角 */
    '.ouac-embed{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:transparent;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}',
    '.ouac-embed .ouac-stageCanvas{position:absolute;left:0;top:0;display:block;background:transparent;touch-action:none;cursor:crosshair}',
    '@media (max-width:720px){.ouac-side{width:190px;flex-basis:190px}.ouac-field input[type=range]{width:56px}}'
  ].join('');

  // -------------------------------------------------------------------------
  // 基础工具
  // -------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function round(v, p) { var k = Math.pow(10, p); return Math.round(v * k) / k; }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) { if (has(src, k)) target[k] = src[k]; }
    }
    return target;
  }
  var _uid = 0;
  function uid(prefix) { _uid += 1; return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + _uid; }

  function injectStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // -------------------------------------------------------------------------
  // 压感曲线：点列 -> 单调三次插值 -> 512 项查找表
  // -------------------------------------------------------------------------
  function normalizeCurve(input) {
    var fallback = DEFAULT_CURVE.map(function (p) { return p.slice(); });
    if (!input) return fallback;
    var raw = input;
    if (!Array.isArray(raw) && raw && Array.isArray(raw.points)) raw = raw.points;
    if (!Array.isArray(raw) || !raw.length) return fallback;
    var pts = [];
    if (typeof raw[0] === 'number') {
      for (var i = 0; i < raw.length; i++) {
        pts.push([raw.length === 1 ? 0 : i / (raw.length - 1), num(raw[i], 0)]);
      }
    } else {
      for (var j = 0; j < raw.length; j++) {
        var it = raw[j];
        if (Array.isArray(it)) pts.push([num(it[0], 0), num(it[1], 0)]);
        else if (it && typeof it === 'object') pts.push([num(it.x, 0), num(it.y, 0)]);
      }
    }
    if (pts.length < 2) return fallback;
    var maxX = 0, maxY = 0;
    for (var k = 0; k < pts.length; k++) {
      if (pts[k][0] > maxX) maxX = pts[k][0];
      if (pts[k][1] > maxY) maxY = pts[k][1];
    }
    var divX = maxX > 1.0001 ? 100 : 1;
    var divY = maxY > 1.0001 ? 100 : 1;
    var out = [];
    for (var m = 0; m < pts.length; m++) {
      out.push([clamp(pts[m][0] / divX, 0, 1), clamp(pts[m][1] / divY, 0, 1)]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    for (var n = 0; n < out.length; n++) {
      if (merged.length && Math.abs(merged[merged.length - 1][0] - out[n][0]) < 1e-6) {
        merged[merged.length - 1][1] = out[n][1];
      } else {
        merged.push(out[n]);
      }
    }
    if (merged.length < 2) return fallback;
    merged[0][0] = 0;
    merged[merged.length - 1][0] = 1;
    return merged;
  }

  function buildCurveLUT(points, size) {
    size = size || LUT_SIZE;
    var pts = normalizeCurve(points);
    var n = pts.length;
    var xs = [], ys = [], dx = [], dy = [], slopes = [], m = [];
    var i;
    for (i = 0; i < n; i++) { xs.push(pts[i][0]); ys.push(pts[i][1]); }
    for (i = 0; i < n - 1; i++) {
      dx[i] = Math.max(1e-9, xs[i + 1] - xs[i]);
      dy[i] = ys[i + 1] - ys[i];
      slopes[i] = dy[i] / dx[i];
    }
    m[0] = slopes[0];
    m[n - 1] = slopes[n - 2];
    for (i = 1; i < n - 1; i++) {
      m[i] = (slopes[i - 1] * slopes[i] <= 0) ? 0 : (slopes[i - 1] + slopes[i]) / 2;
    }
    for (i = 0; i < n - 1; i++) {
      if (Math.abs(slopes[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / slopes[i];
      var b = m[i + 1] / slopes[i];
      var s = a * a + b * b;
      if (s > 9) {
        var t = 3 / Math.sqrt(s);
        m[i] = t * a * slopes[i];
        m[i + 1] = t * b * slopes[i];
      }
    }
    var lut = new Float32Array(size);
    var seg = 0;
    for (i = 0; i < size; i++) {
      var x = i / (size - 1);
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      var h = dx[seg];
      var tt = clamp((x - xs[seg]) / h, 0, 1);
      var t2 = tt * tt, t3 = t2 * tt;
      var h00 = 2 * t3 - 3 * t2 + 1;
      var h10 = t3 - 2 * t2 + tt;
      var h01 = -2 * t3 + 3 * t2;
      var h11 = t3 - t2;
      var y = h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1];
      lut[i] = clamp(y, 0, 1);
    }
    return lut;
  }

  function sampleLUT(lut, p) {
    p = clamp(p, 0, 1);
    var n = lut.length - 1;
    var f = p * n;
    var i = Math.floor(f);
    if (i >= n) return lut[n];
    var t = f - i;
    return lut[i] + (lut[i + 1] - lut[i]) * t;
  }

  function widthForPressure(p, cfg) {
    var t = cfg.pw ? clamp(p, 0, 1) : 1;
    var shaped = (cfg.exp === 1) ? t : Math.pow(t, Math.max(0.05, cfg.exp));
    return cfg.min + (cfg.max - cfg.min) * shaped;
  }

  // -------------------------------------------------------------------------
  // 笔画几何
  // -------------------------------------------------------------------------
  function buildSamples(points, step) {
    var n = points.length;
    if (!n) return [];
    if (n === 1) return [{ x: points[0].x, y: points[0].y, p: points[0].p }];
    step = Math.max(0.2, num(step, 1.6));
    var out = [{ x: points[0].x, y: points[0].y, p: points[0].p }];
    var pushQuad = function (x0, y0, p0, cx, cy, cp, x1, y1, p1) {
      var d = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(cx - x0, cy - y0);
      var steps = clamp(Math.ceil(d / step), 2, 220);
      for (var i = 1; i <= steps; i++) {
        var t = i / steps, mt = 1 - t;
        var x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
        var y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
        var p = p0 + (p1 - p0) * t;
        var prev = out[out.length - 1];
        if (prev && Math.abs(prev.x - x) < 1e-4 && Math.abs(prev.y - y) < 1e-4) {
          prev.p = p;
          continue;
        }
        out.push({ x: x, y: y, p: p });
      }
    };
    var sx = points[0].x, sy = points[0].y, sp = points[0].p;
    for (var i = 1; i < n - 1; i++) {
      var c = points[i];
      var next = points[i + 1];
      var mx = (c.x + next.x) / 2;
      var my = (c.y + next.y) / 2;
      var mp = (c.p + next.p) / 2;
      pushQuad(sx, sy, sp, c.x, c.y, c.p, mx, my, mp);
      sx = mx; sy = my; sp = mp;
    }
    var last = points[n - 1];
    pushQuad(sx, sy, sp, last.x, last.y, last.p, last.x, last.y, last.p);
    return out;
  }

  function traceRibbon(ctx, samples, cfg) {
    var m = samples.length;
    if (!m) return;
    var hw = new Array(m);
    for (var i = 0; i < m; i++) {
      hw[i] = Math.max(0.05, widthForPressure(samples[i].p, cfg) / 2);
    }
    if (m === 1) {
      ctx.beginPath();
      ctx.arc(samples[0].x, samples[0].y, hw[0], 0, Math.PI * 2);
      ctx.closePath();
      return;
    }
    var left = new Array(m), right = new Array(m);
    for (var j = 0; j < m; j++) {
      var prev = samples[j === 0 ? 0 : j - 1];
      var next = samples[j === m - 1 ? m - 1 : j + 1];
      var dx = next.x - prev.x, dy = next.y - prev.y;
      var len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      var nx = -dy, ny = dx;
      var s = samples[j];
      left[j] = { x: s.x + nx * hw[j], y: s.y + ny * hw[j] };
      right[j] = { x: s.x - nx * hw[j], y: s.y - ny * hw[j] };
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (var a = 1; a < m; a++) ctx.lineTo(left[a].x, left[a].y);
    for (var b = m - 1; b >= 0; b--) ctx.lineTo(right[b].x, right[b].y);
    ctx.closePath();
    var first = samples[0], end = samples[m - 1];
    ctx.moveTo(first.x + hw[0], first.y);
    ctx.arc(first.x, first.y, hw[0], 0, Math.PI * 2);
    ctx.closePath();
    ctx.moveTo(end.x + hw[m - 1], end.y);
    ctx.arc(end.x, end.y, hw[m - 1], 0, Math.PI * 2);
    ctx.closePath();
  }

  function strokeAlphaOf(stroke) {
    if (stroke.erase) return 1;
    if (!stroke.cfg.po) return stroke.opacity;
    var pts = stroke.points;
    if (!pts.length) return stroke.opacity;
    var sum = 0;
    for (var i = 0; i < pts.length; i++) sum += pts[i].p;
    var avg = sum / pts.length;
    return stroke.opacity * (0.25 + 0.75 * avg);
  }

  function paintStroke(ctx, stroke) {
    var samples = buildSamples(stroke.points, stroke.step);
    if (!samples.length) return;
    ctx.save();
    if (stroke.erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = clamp(stroke.opacity, 0, 1);
      ctx.fillStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp(stroke.alpha == null ? 1 : stroke.alpha, 0, 1);
      ctx.fillStyle = stroke.color;
    }
    traceRibbon(ctx, samples, stroke.cfg);
    ctx.fill();
    ctx.restore();
  }

  function sampleStrokeWidths(samples, cfg, count) {
    count = count || 11;
    var n = samples.length;
    var out = [];
    if (!n) return out;
    for (var i = 0; i < count; i++) {
      var idx = (n === 1) ? 0 : Math.round(i * (n - 1) / (count - 1));
      var s = samples[idx];
      out.push({ p: round(s.p, 3), w: round(widthForPressure(s.p, cfg), 2) });
    }
    return out;
  }

  function defaultPressureRead(ev) {
    if (!ev) return null;
    if (ev.pointerType === 'pen') {
      var p = ev.pressure;
      if (typeof p === 'number' && isFinite(p)) return clamp(p, 0, 1);
    }
    return null;
  }

  var BLEND = {
    'source-over': 'source-over',
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    'soft-light': 'soft-light',
    'color-dodge': 'color-dodge',
    'linear-burn': 'multiply'
  };

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // -------------------------------------------------------------------------
  // 引擎
  // -------------------------------------------------------------------------
  function Engine(container, options) {
    this.container = container;
    this.options = options || {};
    this.opts = assign({}, DEFAULTS, this.options);
    this.id = uid('ouac');
    this._destroyed = false;
    this._rafDraw = 0;
    this._playRaf = 0;
    this._saveTimer = 0;
    this._listeners = {};
    this._cache = { layers: {}, frames: {}, onion: {} };

    this.settings = {
      tool: 'brush',
      color: /^#[0-9a-f]{6}$/i.test(String(this.opts.color)) ? String(this.opts.color) : '#1a1a1a',
      opacity: clamp(num(this.opts.opacity, 1), 0.05, 1),
      minBrush: clamp(num(this.opts.minBrush, 2), 0.5, 400),
      maxBrush: clamp(num(this.opts.maxBrush, 28), 1, 480),
      exp: clamp(num(this.opts.pressureExp, 0.85), 0.1, 3),
      pressureWidth: this.opts.pressureWidth !== false,
      pressureOpacity: this.opts.pressureOpacity !== false,
      stabilizer: clamp(Math.round(num(this.opts.stabilizer, 3)), 0, 10),
      curve: normalizeCurve(this.opts.pressureCurve)
    };
    if (this.settings.maxBrush <= this.settings.minBrush) {
      this.settings.maxBrush = this.settings.minBrush + 1;
    }
    this._lut = buildCurveLUT(this.settings.curve, LUT_SIZE);

    this.pressureSource = this.opts.pressureSource || null;
    this.pressureReader = function (ev) { return defaultPressureRead(ev); };

    this.view = { scale: 1, ox: 0, oy: 0, win: null };
    this.project = { width: 0, height: 0, fps: 12, frames: [], activeFrameId: '', activeLayerId: '', onion: { enabled: false } };
    this.doc = { width: 0, height: 0, strokes: [] };
    this.history = { stack: [], index: 0 };
    this._liveStroke = null;
    this._pendingMoves = [];
    this._stab = null;
    this._pointerId = null;
    this._lastStats = [];
    this._lastPressure = null;
    this._viewRect = { left: 0, top: 0, width: 0, height: 0 };
    this._playing = false;
    this._playTime = 0;
  }

  Engine.prototype.init = function () {
    injectStyle();
    this.buildDom();
    this.setupDoc();
    this.bindUi();
    this.bindPointer();
    this.bindKeyboard();
    this.layout();
    if (this.curveEl) this.layoutCurve();
    this.syncUi();
    this.render();
    this.setStatus('就绪 · ' + round(this.doc.width, 1) + '×' + round(this.doc.height, 1) +
      ' · ' + this.project.frames.length + ' 帧');
    this.api = this.buildApi();
    return this.api;
  };

  // ---------------------------------------------------------------- DOM
  Engine.prototype.buildDom = function () {
    var root = document.createElement('div');
    root.className = this.opts.chrome === false ? 'ouac-embed' : 'ouac-root';
    root.tabIndex = -1;

    if (this.opts.chrome === false) {
      this.container.innerHTML = '';
      root.innerHTML = '<canvas class="ouac-stageCanvas" data-el="canvas"></canvas>';
      this.container.appendChild(root);
      this.root = root;
      this.stageEl = root;
      this.stage = root.querySelector('[data-el="canvas"]');
      this.stageCtx = this.stage.getContext('2d');
      this.hintEl = null;
      this.curveEl = null;
      this.curveCtx = null;
      this.curveInfoEl = null;
      this.statusEl = null;
      return;
    }

    root.innerHTML = [
      '<div class="ouac-top">',
      '  <div class="ouac-group">',
      '    <button class="ouac-btn is-on" data-act="toolBrush">画笔</button>',
      '    <button class="ouac-btn" data-act="toolEraser">橡皮</button>',
      '    <input class="ouac-color" type="color" data-bind="color" value="#1a1a1a" title="颜色">',
      '  </div>',
      '  <div class="ouac-group">',
      '    <label class="ouac-field"><span>细</span><input type="range" min="1" max="60" step="0.5" data-bind="minBrush"><b data-show="minBrush"></b></label>',
      '    <label class="ouac-field"><span>粗</span><input type="range" min="2" max="160" step="1" data-bind="maxBrush"><b data-show="maxBrush"></b></label>',
      '    <label class="ouac-field"><span>浓度</span><input type="range" min="0.05" max="1" step="0.01" data-bind="opacity"><b data-show="opacity"></b></label>',
      '    <label class="ouac-field"><span>防抖</span><input type="range" min="0" max="10" step="1" data-bind="stabilizer"><b data-show="stabilizer"></b></label>',
      '  </div>',
      '  <div class="ouac-group">',
      '    <label class="ouac-check"><input type="checkbox" data-bind="pressureWidth">压感笔宽</label>',
      '    <label class="ouac-check"><input type="checkbox" data-bind="pressureOpacity">压感浓度</label>',
      '  </div>',
      '  <div class="ouac-group">',
      '    <button class="ouac-btn" data-act="undo" title="Ctrl+Z">撤销</button>',
      '    <button class="ouac-btn" data-act="redo" title="Ctrl+Shift+Z">重做</button>',
      '    <button class="ouac-btn" data-act="clear">清空</button>',
      '  </div>',
      '</div>',
      '<div class="ouac-body">',
      '  <div class="ouac-stage" data-el="stage">',
      '    <canvas class="ouac-stageCanvas" data-el="canvas"></canvas>',
      '    <div class="ouac-hint" data-el="hint">鼠标/触控：恒定笔宽 · 压感笔：按 pressure 变宽</div>',
      '  </div>',
      '  <aside class="ouac-side">',
      '    <section class="ouac-panel">',
      '      <div class="ouac-panelHead"><span>压感曲线（横轴输入 → 纵轴输出）</span></div>',
      '      <canvas class="ouac-curve" data-el="curve"></canvas>',
      '      <div class="ouac-presets">',
      '        <button class="ouac-mini" data-curve="linear">线性</button>',
      '        <button class="ouac-mini" data-curve="soft">柔和</button>',
      '        <button class="ouac-mini" data-curve="hard">硬朗</button>',
      '        <button class="ouac-mini" data-curve="s">S 型</button>',
      '        <button class="ouac-mini" data-act="curveReset">默认</button>',
      '      </div>',
      '      <label class="ouac-field ouac-field-wide"><span>指数</span><input type="range" min="0.2" max="2.5" step="0.05" data-bind="exp"><b data-show="exp"></b></label>',
      '      <div class="ouac-curveInfo" data-el="curveInfo"></div>',
      '    </section>',
      '    <section class="ouac-panel">',
      '      <div class="ouac-panelHead"><span>状态</span></div>',
      '      <div class="ouac-status" data-el="status"></div>',
      '    </section>',
      '  </aside>',
      '</div>'
    ].join('');

    this.container.innerHTML = '';
    this.container.appendChild(root);
    this.root = root;
    this.stageEl = root.querySelector('[data-el="stage"]');
    this.stage = root.querySelector('[data-el="canvas"]');
    this.stageCtx = this.stage.getContext('2d');
    this.hintEl = root.querySelector('[data-el="hint"]');
    this.curveEl = root.querySelector('[data-el="curve"]');
    this.curveCtx = this.curveEl.getContext('2d');
    this.curveInfoEl = root.querySelector('[data-el="curveInfo"]');
    this.statusEl = root.querySelector('[data-el="status"]');
  };

  // ---------------------------------------------------------------- 工程 / 文档
  Engine.prototype.makeLayer = function (name) {
    return { id: uid('lyr'), name: name || '图层', visible: true, opacity: 1, blend: 'source-over', strokes: [], v: 1 };
  };

  Engine.prototype.makeFrame = function (name) {
    var layer = this.makeLayer('图层 1');
    return { id: uid('frm'), name: name || '原画', dur: FRAME_DUR, layers: [layer] };
  };

  Engine.prototype.makeProject = function (w, h) {
    var frame = this.makeFrame('原画 1');
    var p = {
      width: Math.max(8, num(w, 1280)),
      height: Math.max(8, num(h, 720)),
      fps: clamp(Math.round(num(this.opts.fps, 12)), 1, 60),
      frames: [frame],
      activeFrameId: frame.id,
      activeLayerId: frame.layers[0].id,
      onion: { enabled: false, before: 1, after: 1 }
    };
    return p;
  };

  Engine.prototype.setupDoc = function () {
    var saved = this.readStorage();
    if (saved && saved.project) {
      this.project = saved.project;
    } else {
      this.project = this.makeProject(this.opts.width, this.opts.height);
    }
    /* 先套挂载参数，再用本地存档覆盖（存档里的笔刷设置优先） */
    this.applySettings(this.options, this.options.pressureCurve);
    if (saved && saved.settings) this.applySettings(saved.settings, saved.curve);
    this.doc.width = this.project.width;
    this.doc.height = this.project.height;
    this.bindActive();
    if (this.opts.view) this.view.win = this.normalizeWindow(this.opts.view);
    this._cache = { layers: {}, frames: {}, onion: {} };
  };

  Engine.prototype.normalizeWindow = function (w) {
    if (!w) return null;
    var x = num(w.x, 0), y = num(w.y, 0);
    var ww = Math.max(1, num(w.w, this.doc.width));
    var hh = Math.max(1, num(w.h, this.doc.height));
    return { x: x, y: y, w: ww, h: hh };
  };

  Engine.prototype.activeFrame = function () {
    var list = this.project.frames;
    for (var i = 0; i < list.length; i++) if (list[i].id === this.project.activeFrameId) return list[i];
    return list[0];
  };

  Engine.prototype.frameIndex = function (id) {
    var list = this.project.frames;
    for (var i = 0; i < list.length; i++) if (list[i].id === (id || this.project.activeFrameId)) return i;
    return 0;
  };

  Engine.prototype.activeLayerOf = function (frame) {
    frame = frame || this.activeFrame();
    if (!frame) return null;
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === this.project.activeLayerId) return frame.layers[i];
    }
    return frame.layers[frame.layers.length - 1] || null;
  };

  Engine.prototype.bindActive = function () {
    var frame = this.activeFrame();
    if (!frame) {
      var nf = this.makeFrame('原画 1');
      this.project.frames = [nf];
      this.project.activeFrameId = nf.id;
      frame = nf;
    }
    var layer = this.activeLayerOf(frame);
    if (!layer) {
      layer = frame.layers[frame.layers.length - 1] || this.makeLayer('图层 1');
      if (!frame.layers.length) frame.layers.push(layer);
      this.project.activeLayerId = layer.id;
    }
    this.doc.width = this.project.width;
    this.doc.height = this.project.height;
    this.doc.strokes = layer.strokes;
    this._activeLayer = layer;
    return layer;
  };

  // ---------------------------------------------------------------- 持久化
  Engine.prototype.readStorage = function () {
    var key = this.opts.storageKey;
    if (!key || typeof localStorage === 'undefined') return null;
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data) return null;

      if (data.v >= 2 && data.project && Array.isArray(data.project.frames)) {
        var p = data.project;
        var frames = [];
        for (var i = 0; i < p.frames.length; i++) frames.push(this.hydrateFrame(p.frames[i]));
        if (!frames.length) return null;
        var active = null;
        for (var j = 0; j < frames.length; j++) if (frames[j].id === p.activeFrameId) active = frames[j];
        if (!active) active = frames[0];
        return {
          project: {
            width: clamp(num(p.width, 1280), 8, 8000),
            height: clamp(num(p.height, 720), 8, 8000),
            fps: clamp(Math.round(num(p.fps, 12)), 1, 60),
            frames: frames,
            activeFrameId: active.id,
            activeLayerId: p.activeLayerId || active.layers[active.layers.length - 1].id,
            onion: { enabled: !!(p.onion && p.onion.enabled), before: 1, after: 1 }
          },
          settings: data.settings || null,
          curve: data.curve || null
        };
      }

      /* v1 单文档迁移：一层一帧 */
      if (data.doc && Array.isArray(data.doc.strokes)) {
        var w = clamp(Math.round(num(data.doc.width, 1280)), 16, 8000);
        var h = clamp(Math.round(num(data.doc.height, 720)), 16, 8000);
        var layer = this.makeLayer('图层 1');
        for (var k = 0; k < data.doc.strokes.length; k++) layer.strokes.push(this.deserializeStroke(data.doc.strokes[k]));
        var f = { id: uid('frm'), name: '原画 1', dur: FRAME_DUR, layers: [layer] };
        return {
          project: {
            width: w, height: h, fps: 12, frames: [f],
            activeFrameId: f.id, activeLayerId: layer.id,
            onion: { enabled: false, before: 1, after: 1 }
          },
          settings: data.settings || null,
          curve: data.curve || null
        };
      }
      return null;
    } catch (err) {
      this.setStatus('读取本地存档失败：' + err.message, true);
      return null;
    }
  };

  Engine.prototype.hydrateFrame = function (raw) {
    var frame = { id: raw.id || uid('frm'), name: raw.name || '原画', dur: clamp(Math.round(num(raw.dur, FRAME_DUR)), 1, 240), layers: [] };
    var layers = Array.isArray(raw.layers) ? raw.layers : [];
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i] || {};
      var layer = {
        id: l.id || uid('lyr'),
        name: l.name || '图层',
        visible: l.visible !== false,
        opacity: clamp(num(l.opacity, 1), 0, 1),
        blend: BLEND[l.blend] ? l.blend : 'source-over',
        strokes: [],
        v: 1
      };
      var strokes = Array.isArray(l.strokes) ? l.strokes : [];
      for (var j = 0; j < strokes.length; j++) layer.strokes.push(this.deserializeStroke(strokes[j]));
      frame.layers.push(layer);
    }
    if (!frame.layers.length) frame.layers.push(this.makeLayer('图层 1'));
    return frame;
  };

  Engine.prototype.serializeStroke = function (stroke) {
    var pts = [];
    for (var i = 0; i < stroke.points.length; i++) {
      var p = stroke.points[i];
      pts.push([round(p.x, 3), round(p.y, 3), round(p.p, 3)]);
    }
    return {
      color: stroke.color,
      opacity: stroke.opacity,
      erase: !!stroke.erase,
      min: round(stroke.cfg.min, 3),
      max: round(stroke.cfg.max, 3),
      exp: round(stroke.cfg.exp, 3),
      pw: stroke.cfg.pw,
      po: stroke.cfg.po,
      alpha: round(stroke.alpha == null ? 1 : stroke.alpha, 4),
      step: round(stroke.step || 1.6, 3),
      pts: pts
    };
  };

  Engine.prototype.deserializeStroke = function (raw) {
    var cfg = {
      min: clamp(num(raw.min, 2), 0.02, 400),
      max: clamp(num(raw.max, 28), 0.03, 480),
      exp: clamp(num(raw.exp, 0.85), 0.05, 4),
      pw: raw.pw !== false,
      po: raw.po !== false
    };
    if (cfg.max <= cfg.min) cfg.max = cfg.min + 1;
    var points = [];
    var pts = Array.isArray(raw.pts) ? raw.pts : [];
    for (var i = 0; i < pts.length; i++) {
      var it = pts[i];
      if (!it) continue;
      points.push({ x: num(it[0], 0), y: num(it[1], 0), p: clamp(num(it[2], 1), 0, 1) });
    }
    return {
      id: uid('s'),
      color: /^#[0-9a-f]{6}$/i.test(String(raw.color)) ? String(raw.color) : '#1a1a1a',
      opacity: clamp(num(raw.opacity, 1), 0.02, 1),
      erase: !!raw.erase,
      alpha: clamp(num(raw.alpha, 1), 0, 1),
      step: clamp(num(raw.step, 1.6), 0.05, 20),
      cfg: cfg,
      points: points
    };
  };

  Engine.prototype.serializeProject = function () {
    var frames = [];
    for (var i = 0; i < this.project.frames.length; i++) {
      var f = this.project.frames[i];
      var layers = [];
      for (var j = 0; j < f.layers.length; j++) {
        var l = f.layers[j];
        var strokes = [];
        for (var k = 0; k < l.strokes.length; k++) strokes.push(this.serializeStroke(l.strokes[k]));
        layers.push({ id: l.id, name: l.name, visible: l.visible, opacity: round(l.opacity, 3), blend: l.blend, strokes: strokes });
      }
      frames.push({ id: f.id, name: f.name, dur: f.dur, layers: layers });
    }
    return {
      v: 2,
      project: {
        width: this.project.width,
        height: this.project.height,
        fps: this.project.fps,
        frames: frames,
        activeFrameId: this.project.activeFrameId,
        activeLayerId: this.project.activeLayerId,
        onion: this.project.onion
      },
      settings: {
        tool: this.settings.tool,
        color: this.settings.color,
        opacity: this.settings.opacity,
        minBrush: this.settings.minBrush,
        maxBrush: this.settings.maxBrush,
        exp: this.settings.exp,
        pressureWidth: this.settings.pressureWidth,
        pressureOpacity: this.settings.pressureOpacity,
        stabilizer: this.settings.stabilizer
      },
      curve: this.settings.curve.map(function (p) { return [round(p[0], 4), round(p[1], 4)]; })
    };
  };

  Engine.prototype.scheduleSave = function () {
    var self = this;
    if (!this.opts.storageKey) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function () {
      self._saveTimer = 0;
      self.saveNow();
    }, 420);
  };

  Engine.prototype.saveNow = function () {
    if (!this.opts.storageKey) return false;
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(this.opts.storageKey, JSON.stringify(this.serializeProject()));
      return true;
    } catch (err) {
      this.setStatus('本地保存失败（可能超出配额）：' + err.message, true);
      return false;
    }
  };

  // ---------------------------------------------------------------- 设置
  Engine.prototype.applySettings = function (src, curve) {
    if (!src) return;
    var s = this.settings;
    if (src.tool === 'brush' || src.tool === 'eraser') s.tool = src.tool;
    if (typeof src.color === 'string' && /^#[0-9a-f]{6}$/i.test(src.color)) s.color = src.color;
    if (has(src, 'opacity')) s.opacity = clamp(num(src.opacity, s.opacity), 0.02, 1);
    if (has(src, 'minBrush')) s.minBrush = clamp(num(src.minBrush, s.minBrush), 0.5, 400);
    if (has(src, 'maxBrush')) s.maxBrush = clamp(num(src.maxBrush, s.maxBrush), 1, 480);
    if (has(src, 'pressureExp')) s.exp = clamp(num(src.pressureExp, s.exp), 0.1, 3);
    if (has(src, 'exp')) s.exp = clamp(num(src.exp, s.exp), 0.1, 3);
    if (has(src, 'pressureWidth')) s.pressureWidth = src.pressureWidth !== false;
    if (has(src, 'pressureOpacity')) s.pressureOpacity = src.pressureOpacity !== false;
    if (has(src, 'stabilizer')) s.stabilizer = clamp(Math.round(num(src.stabilizer, s.stabilizer)), 0, 10);
    if (src.pressureCurve) s.curve = normalizeCurve(src.pressureCurve);
    if (curve) s.curve = normalizeCurve(curve);
    if (s.maxBrush <= s.minBrush) s.maxBrush = s.minBrush + 1;
    this._lut = buildCurveLUT(s.curve, LUT_SIZE);
  };

  Engine.prototype.applyCurve = function (p) {
    return sampleLUT(this._lut, p);
  };

  Engine.prototype.brushScale = function () {
    /* brushUnit=px 时，把屏幕 px 换算成文档单位 */
    if (this.opts.brushUnit === 'px') return 1 / Math.max(1e-6, this.view.scale);
    return 1;
  };

  Engine.prototype.makeCfg = function () {
    var s = this.settings;
    var k = this.brushScale();
    return {
      min: Math.max(0.02, s.minBrush * k),
      max: Math.max(0.04, s.maxBrush * k),
      exp: s.exp,
      pw: s.pressureWidth,
      po: s.pressureOpacity
    };
  };

  // ---------------------------------------------------------------- 布局 / 渲染
  Engine.prototype.layout = function () {
    if (this._destroyed) return;
    var rect = this.stageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this._stageW = 0;
      this._stageH = 0;
      return;
    }
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    this._dpr = dpr;
    this._stageW = rect.width;
    this._stageH = rect.height;
    var pw = Math.max(1, Math.round(rect.width * dpr));
    var ph = Math.max(1, Math.round(rect.height * dpr));
    if (this.stage.width !== pw || this.stage.height !== ph) {
      this.stage.width = pw;
      this.stage.height = ph;
    }
    this.stage.style.width = rect.width + 'px';
    this.stage.style.height = rect.height + 'px';
    this._viewRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

    var doc = this.doc;
    var view = this.view;
    var win = view.win;
    if (win) {
      var sc = rect.width / win.w;
      if (!isFinite(sc) || sc <= 0) sc = 1;
      view.scale = sc;
      view.ox = -win.x * sc;
      view.oy = -win.y * sc;
    } else if (this.opts.fit === 'fill') {
      var sf = Math.min(rect.width / doc.width, rect.height / doc.height);
      view.scale = sf;
      view.ox = (rect.width - doc.width * sf) / 2;
      view.oy = (rect.height - doc.height * sf) / 2;
    } else {
      var pad = num(this.opts.padding, 12);
      var s2 = Math.min((rect.width - pad * 2) / doc.width, (rect.height - pad * 2) / doc.height);
      if (!isFinite(s2) || s2 <= 0) s2 = 1;
      view.scale = s2;
      view.ox = (rect.width - doc.width * s2) / 2;
      view.oy = (rect.height - doc.height * s2) / 2;
    }
    this.render();
  };

  Engine.prototype.frameSignature = function (frame) {
    var parts = [frame.id];
    for (var i = 0; i < frame.layers.length; i++) {
      var l = frame.layers[i];
      parts.push(l.id + ':' + l.v + ':' + (l.visible ? 1 : 0) + ':' + round(l.opacity, 3) + ':' + l.blend);
    }
    return parts.join('|');
  };

  Engine.prototype.layerCanvas = function (layer) {
    var key = layer.id + ':' + layer.v;
    var hit = this._cache.layers[key];
    if (hit) return hit;
    var c = makeCanvas(this.doc.width * CACHE_SCALE, this.doc.height * CACHE_SCALE);
    var ctx = c.getContext('2d');
    ctx.setTransform(CACHE_SCALE, 0, 0, CACHE_SCALE, 0, 0);
    for (var i = 0; i < layer.strokes.length; i++) paintStroke(ctx, layer.strokes[i]);
    this._cache.layers[key] = c;
    /* 只保留最近的 24 个图层缓存 */
    var keys = Object.keys(this._cache.layers);
    if (keys.length > 24) delete this._cache.layers[keys[0]];
    return c;
  };

  Engine.prototype.compositeFrame = function (frame) {
    var key = this.frameSignature(frame);
    var hit = this._cache.frames[key];
    if (hit) return hit;
    var c = makeCanvas(this.doc.width * CACHE_SCALE, this.doc.height * CACHE_SCALE);
    var ctx = c.getContext('2d');
    for (var i = 0; i < frame.layers.length; i++) {
      var l = frame.layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      ctx.globalAlpha = clamp(l.opacity, 0, 1);
      ctx.globalCompositeOperation = BLEND[l.blend] || 'source-over';
      ctx.drawImage(this.layerCanvas(l), 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this._cache.frames[key] = c;
    var keys = Object.keys(this._cache.frames);
    if (keys.length > 8) delete this._cache.frames[keys[0]];
    return c;
  };

  Engine.prototype.tintCanvas = function (src, color) {
    var c = makeCanvas(src.width, src.height);
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  };

  Engine.prototype.onionCanvas = function (frame, color) {
    var key = this.frameSignature(frame) + '|' + color;
    var hit = this._cache.onion[key];
    if (hit) return hit;
    var c = this.tintCanvas(this.compositeFrame(frame), color);
    this._cache.onion[key] = c;
    var keys = Object.keys(this._cache.onion);
    if (keys.length > 4) delete this._cache.onion[keys[0]];
    return c;
  };

  Engine.prototype.render = function () {
    if (this._destroyed) return;
    var ctx = this.stageCtx;
    if (!ctx) return;
    var dpr = this._dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.stage.width, this.stage.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this._stageW) return;

    var doc = this.doc, v = this.view;
    var win = v.win;
    var vx = win ? win.x : 0, vy = win ? win.y : 0;
    var vw = win ? win.w : doc.width, vh = win ? win.h : doc.height;

    /* 背景与投影（嵌入模式关闭） */
    if (this.opts.background !== 'transparent' || this.opts.shadow) {
      ctx.save();
      if (this.opts.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 8;
      }
      if (this.opts.background !== 'transparent') {
        ctx.fillStyle = this.opts.background;
        ctx.fillRect(v.ox, v.oy, vw * v.scale, vh * v.scale);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._stageW, this._stageH);
    ctx.clip();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);

    var cs = 1 / CACHE_SCALE;
    var cur = this.activeFrame();
    var idx = this.frameIndex(cur && cur.id);

    /* 洋葱皮：前后帧半透明参考 */
    if (this.project.onion.enabled) {
      var prev = this.project.frames[idx - 1];
      var next = this.project.frames[idx + 1];
      if (prev) {
        var pc = this.onionCanvas(prev, '#3f7fff');
        ctx.globalAlpha = 0.28;
        ctx.drawImage(pc, 0, 0, pc.width * cs, pc.height * cs);
      }
      if (next) {
        var nc = this.onionCanvas(next, '#ff5d5d');
        ctx.globalAlpha = 0.22;
        ctx.drawImage(nc, 0, 0, nc.width * cs, nc.height * cs);
      }
      ctx.globalAlpha = 1;
    }

    /* 当前帧 */
    if (cur) {
      var cc = this.compositeFrame(cur);
      ctx.drawImage(cc, 0, 0, cc.width * cs, cc.height * cs);
    }

    /* 落笔预览 */
    if (this._liveStroke && this.preview) {
      ctx.globalAlpha = this._liveStroke.erase ? 0.55 : 1;
      ctx.drawImage(this.preview, 0, 0, this.preview.width * cs, this.preview.height * cs);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (this.opts.border) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(v.ox + 0.5, v.oy + 0.5, vw * v.scale - 1, vh * v.scale - 1);
    }
  };

  Engine.prototype.rebuildBase = function () {
    this._cache.frames = {};
    this._cache.layers = {};
    this._cache.onion = {};
    this.render();
  };

  Engine.prototype.clearPreview = function () {
    if (!this.preview) return;
    var ctx = this.preview.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
  };

  Engine.prototype.ensureBuffers = function () {
    var w = Math.max(1, Math.round(this.doc.width * CACHE_SCALE));
    var h = Math.max(1, Math.round(this.doc.height * CACHE_SCALE));
    if (!this.preview) this.preview = makeCanvas(w, h);
    if (this.preview.width !== w || this.preview.height !== h) {
      this.preview.width = w;
      this.preview.height = h;
    }
  };

  Engine.prototype.paintPreview = function () {
    var stroke = this._liveStroke;
    this.ensureBuffers();
    var ctx = this.preview.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
    if (!stroke) return;
    ctx.setTransform(CACHE_SCALE, 0, 0, CACHE_SCALE, 0, 0);
    var samples = buildSamples(stroke.points, stroke.step);
    if (!samples.length) return;
    ctx.save();
    if (stroke.erase) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ff6b6b';
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = stroke.color;
    }
    traceRibbon(ctx, samples, stroke.cfg);
    ctx.fill();
    ctx.restore();
  };

  // ---------------------------------------------------------------- 指针 / 绘制
  Engine.prototype.readPressure = function (ev) {
    var v = null;
    try {
      if (this.pressureSource) {
        if (typeof this.pressureSource === 'function') v = this.pressureSource(ev);
        else if (typeof this.pressureSource.read === 'function') v = this.pressureSource.read(ev);
      }
      if (v === null || v === undefined) v = this.pressureReader(ev);
    } catch (err) {
      v = null;
    }
    if (v === null || v === undefined) return null;
    v = Number(v);
    if (!isFinite(v)) return null;
    return clamp(v, 0, 1);
  };

  Engine.prototype.coalesced = function (ev) {
    try {
      if (typeof ev.getCoalescedEvents === 'function') {
        var list = ev.getCoalescedEvents();
        if (list && list.length) return list;
      }
    } catch (err) { /* ignore */ }
    return [ev];
  };

  Engine.prototype.clientToDoc = function (clientX, clientY) {
    var rect = this.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.view.ox) / this.view.scale,
      y: (clientY - rect.top - this.view.oy) / this.view.scale
    };
  };

  Engine.prototype.bindPointer = function () {
    var self = this;
    this._onDown = function (e) { self.onPointerDown(e); };
    this._onMove = function (e) { self.onPointerMove(e); };
    this._onUp = function (e) { self.onPointerUp(e); };
    this.stage.addEventListener('pointerdown', this._onDown);
    this.stage.addEventListener('pointermove', this._onMove);
    this.stage.addEventListener('pointerup', this._onUp);
    this.stage.addEventListener('pointercancel', this._onUp);

    this._onResize = function () { self.layout(); };
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self.layout(); });
      this._ro.observe(this.stageEl);
    } else {
      global.addEventListener('resize', this._onResize);
    }
    this._onWinMove = function () { self.layout(); };
    global.addEventListener('scroll', this._onWinMove, true);
  };

  Engine.prototype.onPointerDown = function (e) {
    if (this._destroyed || this._playing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false && e.pointerType !== 'pen') return;
    e.preventDefault();
    try { this.root.focus({ preventScroll: true }); } catch (err) { try { this.root.focus(); } catch (e2) {} }

    var pos = this.clientToDoc(e.clientX, e.clientY);
    var raw = this.readPressure(e);
    var p = (raw === null) ? 1 : this.applyCurve(raw);
    var cfg = this.makeCfg();

    this.ensureBuffers();
    this._liveStroke = {
      id: uid('s'),
      tool: this.settings.tool,
      color: this.settings.color,
      opacity: this.settings.opacity,
      erase: this.settings.tool === 'eraser',
      cfg: cfg,
      step: Math.max(0.05, 1.1 / Math.max(1e-6, this.view.scale)),
      alpha: 1,
      points: [{ x: pos.x, y: pos.y, p: p }]
    };
    this._stab = { x: pos.x, y: pos.y, p: p };
    this._pointerId = e.pointerId;
    this._pendingMoves = [];
    this._lastPressure = raw;
    try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.paintPreview();
    this.render();
    this.updateHint(raw, p);
  };

  Engine.prototype.onPointerMove = function (e) {
    if (!this._liveStroke) return;
    if (this._pointerId !== null && e.pointerId !== this._pointerId) return;
    e.preventDefault();
    var evs = this.coalesced(e);
    for (var i = 0; i < evs.length; i++) this._pendingMoves.push(evs[i]);
    var self = this;
    if (!this._rafDraw) {
      this._rafDraw = global.requestAnimationFrame(function () {
        self._rafDraw = 0;
        self.flushMoves();
      });
    }
  };

  Engine.prototype.flushMoves = function () {
    if (!this._liveStroke) { this._pendingMoves = []; return; }
    var list = this._pendingMoves;
    this._pendingMoves = [];
    if (!list.length) return;
    var stroke = this._liveStroke;
    var changed = false;
    var rect = this.stage.getBoundingClientRect();
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var x = (ev.clientX - rect.left - this.view.ox) / this.view.scale;
      var y = (ev.clientY - rect.top - this.view.oy) / this.view.scale;
      var raw = this.readPressure(ev);
      var pOut = (raw === null) ? 1 : this.applyCurve(raw);

      var level = this.settings.stabilizer;
      var sx = x, sy = y, sp = pOut;
      if (level > 0) {
        var k = 1 - Math.min(0.9, level * 0.085);
        var st = this._stab;
        sx = st.x + (x - st.x) * k;
        sy = st.y + (y - st.y) * k;
        sp = st.p + (pOut - st.p) * k;
      }
      this._stab = { x: sx, y: sy, p: sp };
      this._lastPressure = raw;

      var pts = stroke.points;
      var last = pts[pts.length - 1];
      if (!last || Math.abs(last.x - sx) > 0.02 || Math.abs(last.y - sy) > 0.02 || Math.abs(last.p - sp) > 0.002) {
        pts.push({ x: sx, y: sy, p: sp });
        changed = true;
      }
      this._lastPOut = pOut;
    }
    if (changed) {
      stroke.alpha = strokeAlphaOf(stroke);
      this.paintPreview();
      this.render();
      this.updateHint(this._lastPressure, this._lastPOut);
    }
  };

  Engine.prototype.onPointerUp = function (e) {
    if (!this._liveStroke) return;
    if (this._pointerId !== null && e.pointerId !== this._pointerId) return;
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      var evs = this.coalesced(e);
      for (var i = 0; i < evs.length; i++) this._pendingMoves.push(evs[i]);
    }
    this.flushMoves();
    this.commitStroke();
    this._pointerId = null;
    try { this.stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };

  Engine.prototype.commitStroke = function () {
    var stroke = this._liveStroke;
    this._liveStroke = null;
    this.clearPreview();
    if (!stroke || !stroke.points.length) { this.render(); return; }
    if (stroke.points.length === 1) {
      stroke.points.push({ x: stroke.points[0].x, y: stroke.points[0].y, p: stroke.points[0].p });
    }
    stroke.alpha = strokeAlphaOf(stroke);
    var samples = buildSamples(stroke.points, stroke.step);
    this._lastStats = sampleStrokeWidths(samples, stroke.cfg, 11);

    var layer = this._activeLayer || this.bindActive();
    var list = layer.strokes;
    var index = list.length;
    list.push(stroke);
    layer.v += 1;
    delete this._cache.layers[layer.id + ':' + (layer.v - 1)];

    this.pushAction({
      label: stroke.erase ? '擦除' : '笔画',
      undo: function () {
        var at = list.indexOf(stroke);
        if (at >= 0) list.splice(at, 1);
        layer.v += 1;
        this.invalidate();
      },
      redo: function () {
        list.splice(Math.min(index, list.length), 0, stroke);
        layer.v += 1;
        this.invalidate();
      }
    });

    this.invalidate();
    this.scheduleSave();
    this.syncUi();
    this.emit('stroke', { layerId: layer.id, count: list.length });
    this.setStatus((stroke.erase ? '擦除' : '笔画') + '已记录 · 笔画 ' + list.length + ' / 撤销 ' + this.history.index);
  };

  Engine.prototype.invalidate = function () {
    this._cache.frames = {};
    this._cache.onion = {};
    this.render();
    this.emit('change', { reason: 'render' });
  };

  Engine.prototype.afterRestore = function () {
    this.invalidate();
    this.scheduleSave();
    this.syncUi();
  };

  // ---------------------------------------------------------------- 历史
  Engine.prototype.pushAction = function (action) {
    var h = this.history;
    h.stack = h.stack.slice(0, h.index);
    h.stack.push(action);
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
    h.index = h.stack.length;
  };

  Engine.prototype.undo = function () {
    var h = this.history;
    if (h.index <= 0) {
      this.setStatus('没有可撤销的操作');
      this.syncUi();
      return false;
    }
    h.index -= 1;
    var action = h.stack[h.index];
    action.undo.call(this);
    this.setStatus('已撤销：' + action.label + ' · 剩余 ' + h.index + ' 步');
    this.emit('change', { reason: 'undo' });
    return true;
  };

  Engine.prototype.redo = function () {
    var h = this.history;
    if (h.index >= h.stack.length) {
      this.setStatus('没有可重做的操作');
      this.syncUi();
      return false;
    }
    var action = h.stack[h.index];
    h.index += 1;
    action.redo.call(this);
    this.setStatus('已重做：' + action.label + ' · 可重做 ' + (h.stack.length - h.index) + ' 步');
    this.emit('change', { reason: 'redo' });
    return true;
  };

  Engine.prototype.clearAll = function () {
    var layer = this._activeLayer || this.bindActive();
    var old = layer.strokes;
    if (!old.length) {
      this.setStatus('当前图层已经是空的');
      return;
    }
    layer.strokes = [];
    layer.v += 1;
    this.doc.strokes = layer.strokes;
    this.pushAction({
      label: '清空图层',
      undo: function () {
        layer.strokes = old;
        layer.v += 1;
        this.doc.strokes = layer.strokes;
        this.invalidate();
      },
      redo: function () {
        layer.strokes = [];
        layer.v += 1;
        this.doc.strokes = layer.strokes;
        this.invalidate();
      }
    });
    this.invalidate();
    this.scheduleSave();
    this.setStatus('已清空当前图层');
  };

  // ---------------------------------------------------------------- 曲线编辑器
  Engine.prototype.attachCurve = function (el) {
    if (!el) return this.api;
    var self = this;
    if (this._curveBound) {
      var old = this._curveBound;
      old.removeEventListener('pointerdown', this._curveDown);
      old.removeEventListener('pointermove', this._curveMove);
      old.removeEventListener('pointerup', this._curveUp);
      old.removeEventListener('pointercancel', this._curveUp);
    }
    this.curveEl = el;
    this.curveCtx = el.getContext('2d');
    this._curveDown = function (e) { self.curvePointer(e, 'down'); };
    this._curveMove = function (e) { self.curvePointer(e, 'move'); };
    this._curveUp = function (e) { self.curvePointer(e, 'up'); };
    el.addEventListener('pointerdown', this._curveDown);
    el.addEventListener('pointermove', this._curveMove);
    el.addEventListener('pointerup', this._curveUp);
    el.addEventListener('pointercancel', this._curveUp);
    this._curveBound = el;
    this.layoutCurve();
    return this.api;
  };

  Engine.prototype.layoutCurve = function () {
    if (!this.curveEl) return;
    var rect = this.curveEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (this.curveEl.width !== w || this.curveEl.height !== h) {
      this.curveEl.width = w;
      this.curveEl.height = h;
    }
    this._curveGeom = { w: rect.width, h: rect.height, dpr: dpr, pad: 12 };
    this.drawCurve();
  };

  Engine.prototype.drawCurve = function () {
    var g = this._curveGeom;
    if (!g || !this.curveCtx) return;
    var ctx = this.curveCtx;
    var w = g.w, h = g.h, pad = g.pad;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var gx = pad + (w - pad * 2) * i / 4;
      var gy = pad + (h - pad * 2) * i / 4;
      ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, h - pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(w - pad, gy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.strokeRect(pad + 0.5, pad + 0.5, w - pad * 2 - 1, h - pad * 2 - 1);

    var iw = w - pad * 2, ih = h - pad * 2;
    ctx.beginPath();
    for (var s = 0; s <= 96; s++) {
      var x = s / 96;
      var y = this.applyCurve(x);
      var px = pad + x * iw;
      var py = pad + (1 - y) * ih;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    var curve = this.settings.curve;
    for (var k = 0; k < curve.length; k++) {
      var cx = pad + curve[k][0] * iw;
      var cy = pad + (1 - curve[k][1]) * ih;
      ctx.beginPath();
      ctx.arc(cx, cy, k === this._curveDrag ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = k === this._curveDrag ? '#ffffff' : '#0f1115';
      ctx.fill();
      ctx.strokeStyle = '#6ea8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(160,170,190,.55)';
    ctx.font = '10px Inter,sans-serif';
    ctx.fillText('输出', 2, pad + 4);
    ctx.fillText('100%', w - 34, h - 2);
    ctx.fillText('输入 100%', 2, h - 2);
  };

  Engine.prototype.curveInfoText = function () {
    var parts = [];
    var curve = this.settings.curve;
    for (var i = 0; i < curve.length; i++) {
      parts.push(Math.round(curve[i][0] * 100) + '%→' + Math.round(curve[i][1] * 100) + '%');
    }
    var widths = [];
    var pressures = [0.25, 0.5, 0.75, 1];
    for (var j = 0; j < pressures.length; j++) {
      widths.push(Math.round(pressures[j] * 100) + '%:' + round(this.getWidthForPressure(pressures[j]), 1) + 'px');
    }
    return '<div>' + parts.join(' · ') + '</div><div>笔宽 <b>' + widths.join(' · ') + '</b></div>';
  };

  Engine.prototype.curvePointer = function (e, phase) {
    var g = this._curveGeom;
    if (!g) return;
    var rect = this.curveEl.getBoundingClientRect();
    var iw = g.w - g.pad * 2, ih = g.h - g.pad * 2;
    var x = (e.clientX - rect.left - g.pad) / iw;
    var y = 1 - (e.clientY - rect.top - g.pad) / ih;
    var curve = this.settings.curve;

    if (phase === 'down') {
      var best = -1, bestD = 18;
      for (var i = 0; i < curve.length; i++) {
        var dx = (curve[i][0] - x) * iw;
        var dy = (curve[i][1] - y) * ih;
        var d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = i; }
      }
      this._curveDrag = best;
      if (best < 0) return;
      e.preventDefault();
      try { this.curveEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (phase === 'up') {
      if (this._curveDrag == null) return;
      this._curveDrag = null;
      this.drawCurve();
      this.scheduleSave();
      this.syncCurveInfo();
      this.emit('change', { reason: 'curve' });
      return;
    }
    var idx = this._curveDrag;
    if (idx == null || idx < 0) return;
    var isEnd = (idx === 0 || idx === curve.length - 1);
    var nx = isEnd ? curve[idx][0] : clamp(x, 0.02, 0.98);
    if (!isEnd) {
      var lo = curve[idx - 1][0] + 0.01;
      var hi = curve[idx + 1][0] - 0.01;
      nx = clamp(nx, lo, hi);
    }
    curve[idx][0] = nx;
    curve[idx][1] = clamp(y, 0, 1);
    this._lut = buildCurveLUT(curve, LUT_SIZE);
    this.drawCurve();
    this.syncCurveInfo();
    e.preventDefault();
  };

  Engine.prototype.syncCurveInfo = function () {
    if (this.curveInfoEl) this.curveInfoEl.innerHTML = this.curveInfoText();
  };

  // ---------------------------------------------------------------- UI
  Engine.prototype.bindUi = function () {
    if (this.opts.chrome === false) return;
    var self = this;
    this.root.addEventListener('click', function (e) {
      var actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      if (actEl && self.root.contains(actEl)) {
        var act = actEl.getAttribute('data-act');
        if (act === 'toolBrush' || act === 'toolEraser') {
          self.settings.tool = (act === 'toolBrush') ? 'brush' : 'eraser';
          self.syncUi();
          self.scheduleSave();
          self.setStatus('当前工具：' + (self.settings.tool === 'brush' ? '画笔' : '橡皮'));
        } else if (act === 'undo') {
          self.undo();
        } else if (act === 'redo') {
          self.redo();
        } else if (act === 'clear') {
          self.clearAll();
        } else if (act === 'curveReset') {
          self.settings.curve = normalizeCurve(DEFAULT_CURVE);
          self._lut = buildCurveLUT(self.settings.curve, LUT_SIZE);
          self.drawCurve();
          self.syncCurveInfo();
          self.scheduleSave();
          self.setStatus('压感曲线已恢复默认（5 个控制点）');
        }
        return;
      }
      var preset = e.target.closest ? e.target.closest('[data-curve]') : null;
      if (preset && self.root.contains(preset)) {
        var name = preset.getAttribute('data-curve');
        if (CURVE_PRESETS[name]) {
          self.settings.curve = normalizeCurve(CURVE_PRESETS[name]);
          self._lut = buildCurveLUT(self.settings.curve, LUT_SIZE);
          self.drawCurve();
          self.syncCurveInfo();
          self.scheduleSave();
          self.setStatus('曲线预设：' + name);
        }
      }
    });

    this.root.addEventListener('input', function (e) {
      var key = e.target.getAttribute ? e.target.getAttribute('data-bind') : null;
      if (!key) return;
      var val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      self.setOptionInternal(key, val);
      self.syncUi();
      self.scheduleSave();
    });

    this.root.addEventListener('change', function (e) {
      var key = e.target.getAttribute ? e.target.getAttribute('data-bind') : null;
      if (!key) return;
      self.setOptionInternal(key, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      self.syncUi();
      self.scheduleSave();
    });

    this.curveEl.addEventListener('pointerdown', function (e) { self.curvePointer(e, 'down'); });
    this.curveEl.addEventListener('pointermove', function (e) { self.curvePointer(e, 'move'); });
    this.curveEl.addEventListener('pointerup', function (e) { self.curvePointer(e, 'up'); });
    this.curveEl.addEventListener('pointercancel', function (e) { self.curvePointer(e, 'up'); });
  };

  Engine.prototype.setOptionInternal = function (key, value) {
    var s = this.settings;
    if (key === 'color') {
      if (/^#[0-9a-f]{6}$/i.test(String(value))) s.color = String(value);
    } else if (key === 'opacity') {
      s.opacity = clamp(num(value, 1), 0.05, 1);
    } else if (key === 'minBrush') {
      s.minBrush = clamp(num(value, 2), 0.5, 400);
      if (s.maxBrush <= s.minBrush) s.maxBrush = s.minBrush + 1;
    } else if (key === 'maxBrush') {
      s.maxBrush = clamp(num(value, 28), 1, 480);
      if (s.maxBrush <= s.minBrush) s.maxBrush = s.minBrush + 1;
    } else if (key === 'exp') {
      s.exp = clamp(num(value, 0.85), 0.2, 2.5);
    } else if (key === 'stabilizer') {
      s.stabilizer = clamp(Math.round(num(value, 3)), 0, 10);
    } else if (key === 'pressureWidth') {
      s.pressureWidth = !!value;
    } else if (key === 'pressureOpacity') {
      s.pressureOpacity = !!value;
    }
  };

  Engine.prototype.syncUi = function () {
    if (this._destroyed || !this.root) return;
    var s = this.settings;
    this.root.querySelectorAll('[data-bind]').forEach(function (el) {
      var key = el.getAttribute('data-bind');
      if (el.type === 'checkbox') el.checked = !!s[key];
      else el.value = s[key];
    });
    this.root.querySelectorAll('[data-show]').forEach(function (el) {
      var key = el.getAttribute('data-show');
      var v = s[key];
      if (key === 'opacity') v = round(v, 2);
      if (key === 'exp') v = round(v, 2);
      el.textContent = v;
    });
    this.root.querySelectorAll('[data-act="toolBrush"],[data-act="toolEraser"]').forEach(function (el) {
      var on = (el.getAttribute('data-act') === 'toolBrush') === (s.tool === 'brush');
      el.classList.toggle('is-on', on);
    });
    var undoBtn = this.root.querySelector('[data-act="undo"]');
    var redoBtn = this.root.querySelector('[data-act="redo"]');
    if (undoBtn) undoBtn.disabled = this.history.index <= 0;
    if (redoBtn) redoBtn.disabled = this.history.index >= this.history.stack.length;
    this.syncCurveInfo();
  };

  Engine.prototype.setStatus = function (text, warn) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-warn', !!warn);
  };

  Engine.prototype.updateHint = function (raw, pOut) {
    if (!this.hintEl) return;
    var w = round(widthForPressure(pOut == null ? 1 : pOut, this.makeCfg()), 1);
    if (raw === null || raw === undefined) {
      this.hintEl.textContent = '鼠标/触控：恒定笔宽 ' + w + 'px · 压感笔可读取 pressure';
    } else {
      this.hintEl.textContent = '压感 ' + round(raw, 2) + ' → 曲线输出 ' + round(pOut, 2) + ' · 笔宽 ' + w + 'px';
    }
  };

  Engine.prototype.bindKeyboard = function () {
    var self = this;
    this._onKey = function (e) {
      if (self._destroyed) return;
      var active = document.activeElement;
      var inside = self.root.contains(active) || self.root.contains(e.target);
      if (!inside) return;
      if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'))) return;
      var meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      var key = (e.key || '').toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        self.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        self.redo();
      }
    };
    document.addEventListener('keydown', this._onKey);
  };

  // ---------------------------------------------------------------- 尺寸
  Engine.prototype.resize = function (w, h, silent) {
    w = Math.max(8, num(w, this.doc.width));
    h = Math.max(8, num(h, this.doc.height));
    if (Math.abs(w - this.doc.width) < 1e-6 && Math.abs(h - this.doc.height) < 1e-6) return this.api;
    var sx = w / this.doc.width;
    var sy = h / this.doc.height;
    var oldW = this.doc.width, oldH = this.doc.height;
    var self = this;
    var apply = function (kx, ky, nw, nh) {
      var frames = self.project.frames;
      for (var i = 0; i < frames.length; i++) {
        for (var j = 0; j < frames[i].layers.length; j++) {
          var layer = frames[i].layers[j];
          var s = Math.sqrt(Math.max(1e-6, kx * ky));
          for (var k = 0; k < layer.strokes.length; k++) {
            var stroke = layer.strokes[k];
            for (var p = 0; p < stroke.points.length; p++) {
              stroke.points[p].x *= kx;
              stroke.points[p].y *= ky;
            }
            stroke.cfg.min *= s;
            stroke.cfg.max *= s;
            stroke.step *= s;
          }
          layer.v += 1;
        }
      }
      self.project.width = nw;
      self.project.height = nh;
      self.doc.width = nw;
      self.doc.height = nh;
      if (self.view.win) self.view.win = null;
      self.ensureBuffers();
      self.invalidate();
      self.layout();
      self.scheduleSave();
    };
    if (!silent) {
      this.pushAction({
        label: '调整画布尺寸',
        undo: function () { apply(1 / sx, 1 / sy, oldW, oldH); },
        redo: function () { apply(sx, sy, w, h); }
      });
    }
    apply(sx, sy, w, h);
    this.syncUi();
    this.setStatus('画布尺寸 → ' + round(w, 1) + '×' + round(h, 1) + '（已有笔画按比例缩放）');
    return this.api;
  };

  // ---------------------------------------------------------------- 图层
  Engine.prototype.getLayers = function () {
    var frame = this.activeFrame();
    var out = [];
    for (var i = frame.layers.length - 1; i >= 0; i--) {
      var l = frame.layers[i];
      out.push({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        blend: l.blend, strokeCount: l.strokes.length,
        active: l.id === this.project.activeLayerId
      });
    }
    return out;
  };

  Engine.prototype.addLayer = function (name) {
    var frame = this.activeFrame();
    var layer = this.makeLayer(name || ('图层 ' + (frame.layers.length + 1)));
    frame.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.bindActive();
    this.invalidate();
    this.scheduleSave();
    this.emit('layers', { reason: 'add' });
    return layer.id;
  };

  Engine.prototype.deleteLayer = function (id) {
    var frame = this.activeFrame();
    if (frame.layers.length <= 1) {
      this.setStatus('至少保留一个图层');
      return false;
    }
    var at = -1;
    for (var i = 0; i < frame.layers.length; i++) if (frame.layers[i].id === id) at = i;
    if (at < 0) return false;
    frame.layers.splice(at, 1);
    if (this.project.activeLayerId === id) {
      var next = frame.layers[Math.min(at, frame.layers.length - 1)];
      this.project.activeLayerId = next.id;
    }
    this.bindActive();
    this.invalidate();
    this.scheduleSave();
    this.emit('layers', { reason: 'delete' });
    return true;
  };

  Engine.prototype.duplicateLayer = function (id) {
    var frame = this.activeFrame();
    var at = -1;
    for (var i = 0; i < frame.layers.length; i++) if (frame.layers[i].id === (id || this.project.activeLayerId)) at = i;
    if (at < 0) return null;
    var src = frame.layers[at];
    var copy = {
      id: uid('lyr'), name: src.name + ' 副本', visible: src.visible,
      opacity: src.opacity, blend: src.blend, strokes: [], v: 1
    };
    for (var j = 0; j < src.strokes.length; j++) {
      var st = this.deserializeStroke(this.serializeStroke(src.strokes[j]));
      copy.strokes.push(st);
    }
    frame.layers.splice(at + 1, 0, copy);
    this.project.activeLayerId = copy.id;
    this.bindActive();
    this.invalidate();
    this.scheduleSave();
    this.emit('layers', { reason: 'duplicate' });
    return copy.id;
  };

  Engine.prototype.renameLayer = function (id, name) {
    var frame = this.activeFrame();
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === id) {
        frame.layers[i].name = String(name || '').slice(0, 40) || '图层';
        this.invalidate();
        this.scheduleSave();
        this.emit('layers', { reason: 'rename' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.setLayerVisible = function (id, visible) {
    var frame = this.activeFrame();
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === id) {
        frame.layers[i].visible = !!visible;
        this.invalidate();
        this.scheduleSave();
        this.emit('layers', { reason: 'visible' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.setLayerOpacity = function (id, opacity) {
    var frame = this.activeFrame();
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === id) {
        frame.layers[i].opacity = clamp(num(opacity, 1), 0, 1);
        this.invalidate();
        this.scheduleSave();
        this.emit('layers', { reason: 'opacity' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.setLayerBlend = function (id, blend) {
    var frame = this.activeFrame();
    if (!BLEND[blend]) blend = 'source-over';
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === id) {
        frame.layers[i].blend = blend;
        this.invalidate();
        this.scheduleSave();
        this.emit('layers', { reason: 'blend' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.moveLayer = function (id, delta) {
    var frame = this.activeFrame();
    var at = -1;
    for (var i = 0; i < frame.layers.length; i++) if (frame.layers[i].id === id) at = i;
    if (at < 0) return false;
    var to = clamp(at + delta, 0, frame.layers.length - 1);
    if (to === at) return false;
    var item = frame.layers.splice(at, 1)[0];
    frame.layers.splice(to, 0, item);
    this.invalidate();
    this.scheduleSave();
    this.emit('layers', { reason: 'move' });
    return true;
  };

  Engine.prototype.setActiveLayer = function (id) {
    var frame = this.activeFrame();
    for (var i = 0; i < frame.layers.length; i++) {
      if (frame.layers[i].id === id) {
        if (this.project.activeLayerId === id) return true;
        this.project.activeLayerId = id;
        this.bindActive();
        this.invalidate();
        this.scheduleSave();
        this.emit('layers', { reason: 'active' });
        return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------- 帧
  Engine.prototype.frameStart = function (index) {
    var start = 0;
    for (var i = 0; i < index; i++) start += this.project.frames[i].dur;
    return start;
  };

  Engine.prototype.totalFrames = function () {
    var sum = 0;
    for (var i = 0; i < this.project.frames.length; i++) sum += this.project.frames[i].dur;
    return sum;
  };

  Engine.prototype.getFrames = function () {
    var self = this;
    var idx = this.frameIndex();
    return this.project.frames.map(function (f, i) {
      return {
        id: f.id, name: f.name, dur: f.dur, start: self.frameStart(i),
        index: i, active: i === idx, layers: f.layers.length,
        strokes: f.layers.reduce(function (n, l) { return n + l.strokes.length; }, 0)
      };
    });
  };

  Engine.prototype.addFrame = function (afterId) {
    var list = this.project.frames;
    var at = this.frameIndex(afterId) + 1;
    var frame = this.makeFrame('原画 ' + (list.length + 1));
    list.splice(at, 0, frame);
    this.setActiveFrame(frame.id);
    this.scheduleSave();
    this.emit('frames', { reason: 'add' });
    return frame.id;
  };

  Engine.prototype.deleteFrame = function (id) {
    var list = this.project.frames;
    if (list.length <= 1) {
      this.setStatus('至少保留一帧');
      return false;
    }
    var at = this.frameIndex(id);
    list.splice(at, 1);
    var next = list[Math.min(at, list.length - 1)];
    this.setActiveFrame(next.id);
    this.scheduleSave();
    this.emit('frames', { reason: 'delete' });
    return true;
  };

  Engine.prototype.duplicateFrame = function (id) {
    var list = this.project.frames;
    var at = this.frameIndex(id);
    var frame = list[at];
    var copy = { id: uid('frm'), name: frame.name + ' 副本', dur: frame.dur, layers: [] };
    for (var i = 0; i < frame.layers.length; i++) {
      var src = frame.layers[i];
      var layer = { id: uid('lyr'), name: src.name, visible: src.visible, opacity: src.opacity, blend: src.blend, strokes: [], v: 1 };
      for (var j = 0; j < src.strokes.length; j++) {
        layer.strokes.push(this.deserializeStroke(this.serializeStroke(src.strokes[j])));
      }
      copy.layers.push(layer);
    }
    list.splice(at + 1, 0, copy);
    this.setActiveFrame(copy.id);
    this.scheduleSave();
    this.emit('frames', { reason: 'duplicate' });
    return copy.id;
  };

  Engine.prototype.moveFrame = function (id, toIndex) {
    var list = this.project.frames;
    var at = this.frameIndex(id);
    var to = clamp(Math.round(num(toIndex, at)), 0, list.length - 1);
    if (to === at) return false;
    var item = list.splice(at, 1)[0];
    list.splice(to, 0, item);
    this.invalidate();
    this.scheduleSave();
    this.emit('frames', { reason: 'move' });
    return true;
  };

  Engine.prototype.setFrameDuration = function (id, dur) {
    var list = this.project.frames;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].dur = clamp(Math.round(num(dur, list[i].dur)), 1, 480);
        this.scheduleSave();
        this.emit('frames', { reason: 'duration' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.setActiveFrame = function (id) {
    var list = this.project.frames;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        this.project.activeFrameId = id;
        var layer = this.activeLayerOf(list[i]);
        this.project.activeLayerId = layer ? layer.id : '';
        this.bindActive();
        this.invalidate();
        this.emit('frames', { reason: 'active' });
        return true;
      }
    }
    return false;
  };

  Engine.prototype.stepFrame = function (delta) {
    var idx = this.frameIndex();
    var to = clamp(idx + delta, 0, this.project.frames.length - 1);
    var target = this.project.frames[to];
    if (target) {
      this.setActiveFrame(target.id);
      this._playTime = this.frameStart(to);
      this.emit('time', this.timeState());
    }
    return target ? target.id : null;
  };

  Engine.prototype.seekFrame = function (index) {
    var to = clamp(Math.round(num(index, 0)), 0, this.project.frames.length - 1);
    var target = this.project.frames[to];
    if (!target) return null;
    this.setActiveFrame(target.id);
    this._playTime = this.frameStart(to);
    this.emit('time', this.timeState());
    return target.id;
  };

  Engine.prototype.timeState = function () {
    var fps = this.project.fps;
    var idx = this.frameIndex();
    var t = Math.max(0, this._playTime);
    return {
      time: t, frame: idx, fps: fps,
      code: formatTimecode(t, fps),
      total: this.totalFrames(),
      playing: this._playing
    };
  };

  function formatTimecode(t, fps) {
    var frames = Math.max(0, Math.round(t));
    var ff = frames % fps;
    var totalSec = Math.floor(frames / fps);
    var ss = totalSec % 60;
    var mm = Math.floor(totalSec / 60) % 60;
    var hh = Math.floor(totalSec / 3600);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);
  }

  Engine.prototype.setFps = function (fps) {
    this.project.fps = clamp(Math.round(num(fps, this.project.fps)), 1, 60);
    this.scheduleSave();
    this.emit('frames', { reason: 'fps', fps: this.project.fps });
    return this.project.fps;
  };

  // ---------------------------------------------------------------- 播放
  Engine.prototype.play = function () {
    if (this._playing) return this.api;
    if (this.project.frames.length < 1) return this.api;
    this._playing = true;
    this._playTime = this._playTime || 0;
    var self = this;
    var last = 0;
    var loop = function (ts) {
      if (!self._playing) return;
      if (!last) last = ts;
      var dt = Math.min(0.2, (ts - last) / 1000);
      last = ts;
      var total = self.totalFrames();
      self._playTime += dt * self.project.fps;
      if (self._playTime >= total) self._playTime = 0;
      var idx = self.frameIndexAt(self._playTime);
      var frame = self.project.frames[idx];
      if (frame && frame.id !== self.project.activeFrameId) {
        self.project.activeFrameId = frame.id;
        var layer = self.activeLayerOf(frame);
        self.project.activeLayerId = layer ? layer.id : '';
        self.bindActive();
        self._cache.frames = self._cache.frames;
      }
      self.render();
      self.emit('time', self.timeState());
      self._playRaf = global.requestAnimationFrame(loop);
    };
    this._playRaf = global.requestAnimationFrame(loop);
    this.emit('play', { playing: true });
    return this.api;
  };

  Engine.prototype.frameIndexAt = function (time) {
    var acc = 0;
    for (var i = 0; i < this.project.frames.length; i++) {
      acc += this.project.frames[i].dur;
      if (time < acc) return i;
    }
    return this.project.frames.length - 1;
  };

  Engine.prototype.pause = function () {
    this._playing = false;
    if (this._playRaf) global.cancelAnimationFrame(this._playRaf);
    this._playRaf = 0;
    this.emit('play', { playing: false });
    this.emit('time', this.timeState());
    return this.api;
  };

  Engine.prototype.togglePlay = function () {
    if (this._playing) this.pause(); else this.play();
    return this._playing;
  };

  // ---------------------------------------------------------------- 洋葱皮
  Engine.prototype.setOnion = function (opts) {
    var o = this.project.onion || (this.project.onion = { enabled: false });
    if (typeof opts === 'boolean') o.enabled = opts;
    else if (opts) {
      if (has(opts, 'enabled')) o.enabled = !!opts.enabled;
      if (has(opts, 'before')) o.before = clamp(Math.round(num(opts.before, 1)), 0, 3);
      if (has(opts, 'after')) o.after = clamp(Math.round(num(opts.after, 1)), 0, 3);
    }
    this.render();
    this.scheduleSave();
    this.emit('onion', { enabled: !!o.enabled });
    return this.getOnion();
  };

  Engine.prototype.getOnion = function () {
    var o = this.project.onion || { enabled: false };
    return { enabled: !!o.enabled, before: o.before || 1, after: o.after || 1 };
  };

  // ---------------------------------------------------------------- 导出
  Engine.prototype.visibleWindow = function () {
    if (this.view.win) return this.view.win;
    return { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
  };

  Engine.prototype.renderFrameToCanvas = function (frame, widthPx) {
    frame = frame || this.activeFrame();
    var win = this.visibleWindow();
    var w = clamp(Math.round(num(widthPx, this.opts.exportWidth, 1)), 32, 4096);
    var h = clamp(Math.round(w * win.h / win.w), 32, 4096);
    var c = makeCanvas(w, h);
    var ctx = c.getContext('2d');
    /* 导出默认落在白底上（嵌入模式画布本身透明，PNG 不能是空的） */
    var bg = this.opts.exportBackground || (this.opts.background === 'transparent' ? '#ffffff' : this.opts.background);
    if (bg && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    var scale = w / win.w;
    ctx.setTransform(scale, 0, 0, scale, -win.x * scale, -win.y * scale);
    for (var i = 0; i < frame.layers.length; i++) {
      var layer = frame.layers[i];
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      ctx.globalCompositeOperation = BLEND[layer.blend] || 'source-over';
      for (var j = 0; j < layer.strokes.length; j++) paintStroke(ctx, layer.strokes[j]);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return c;
  };

  Engine.prototype.exportPNG = function (widthPx) {
    var c = this.renderFrameToCanvas(this.activeFrame(), widthPx);
    return c.toDataURL('image/png');
  };

  Engine.prototype.exportSequence = function (widthPx) {
    var out = [];
    for (var i = 0; i < this.project.frames.length; i++) {
      var frame = this.project.frames[i];
      var c = this.renderFrameToCanvas(frame, widthPx);
      out.push({ name: 'frame_' + String(i + 1).padStart(3, '0') + '.png', dataURL: c.toDataURL('image/png') });
    }
    return out;
  };

  Engine.prototype.downloadPNG = function (name) {
    var dataURL = this.exportPNG();
    triggerDownload(dataURL, (name || 'oua-frame') + '.png');
    return dataURL;
  };

  Engine.prototype.downloadSequenceZip = function (name) {
    var items = this.exportSequence();
    var blob = zipStore(items.map(function (it) {
      return { name: it.name, data: dataURLToBytes(it.dataURL) };
    }));
    var url = URL.createObjectURL(blob);
    triggerDownload(url, (name || 'oua-sequence') + '.zip');
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { count: items.length, bytes: blob.size };
  };

  function triggerDownload(href, filename) {
    if (typeof document === 'undefined') return;
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  function dataURLToBytes(dataURL) {
    var base64 = String(dataURL).split(',')[1] || '';
    var bin = atob(base64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var enc = new TextEncoder();
    for (var i = 0; i < entries.length; i++) {
      var nameBytes = enc.encode(entries[i].name);
      var data = entries[i].data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);
      offset += local.length + data.length;
    }
    var centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }

  // ---------------------------------------------------------------- 事件
  Engine.prototype.emit = function (name, payload) {
    var arr = this._listeners[name] || [];
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (err) { /* 监听器异常不影响引擎 */ }
    }
    if (name !== 'change') {
      var all = this._listeners.change || [];
      for (var j = 0; j < all.length; j++) {
        try { all[j]({ reason: name, detail: payload }); } catch (err2) { /* ignore */ }
      }
    }
  };

  // ---------------------------------------------------------------- 对外 API
  Engine.prototype.getWidthForPressure = function (p) {
    var s = this.settings;
    var w = widthForPressure(clamp(this.applyCurve(clamp(num(p, 0), 0, 1)), 0, 1), {
      min: s.minBrush,
      max: s.maxBrush,
      exp: s.exp,
      pw: s.pressureWidth
    });
    return w;
  };

  Engine.prototype.buildApi = function () {
    var self = this;
    var api = {
      version: VERSION,
      root: this.root,
      canvas: this.stage,

      destroy: function () { self.destroy(); },
      undo: function () { return self.undo(); },
      redo: function () { return self.redo(); },
      resize: function (w, h) { return self.resize(w, h); },
      clear: function () { self.clearAll(); return api; },

      setOptions: function (obj) {
        self.applySettings(obj, obj && obj.pressureCurve);
        if (obj && obj.pressureSource) self.pressureSource = obj.pressureSource;
        if (obj && obj.pressureReader && typeof obj.pressureReader === 'function') self.pressureReader = obj.pressureReader;
        if (obj && obj.exportWidth) self.opts.exportWidth = obj.exportWidth;
        if (obj && (has(obj, 'width') || has(obj, 'height'))) {
          self.resize(has(obj, 'width') ? obj.width : self.doc.width, has(obj, 'height') ? obj.height : self.doc.height);
        }
        self.syncUi();
        self.drawCurve();
        self.scheduleSave();
        self.emit('settings', { tool: self.settings.tool, color: self.settings.color });
        return api;
      },
      getOptions: function () {
        return {
          width: self.doc.width,
          height: self.doc.height,
          fps: self.project.fps,
          minBrush: self.settings.minBrush,
          maxBrush: self.settings.maxBrush,
          pressureCurve: self.settings.curve.map(function (p) { return [p[0], p[1]]; }),
          pressureExp: self.settings.exp,
          pressureWidth: self.settings.pressureWidth,
          pressureOpacity: self.settings.pressureOpacity,
          stabilizer: self.settings.stabilizer,
          color: self.settings.color,
          opacity: self.settings.opacity,
          tool: self.settings.tool,
          exportWidth: self.opts.exportWidth
        };
      },

      setTool: function (tool) {
        if (tool === 'brush' || tool === 'eraser') {
          self.settings.tool = tool;
          self.syncUi();
          self.scheduleSave();
          self.emit('settings', { tool: tool });
        }
        return self.settings.tool;
      },
      getTool: function () { return self.settings.tool; },

      setViewport: function (win) {
        self.view.win = self.normalizeWindow(win);
        self.layout();
        return api;
      },
      setDocSize: function (w, h) {
        if (Math.abs(num(w, self.doc.width) - self.doc.width) > 0.01 ||
            Math.abs(num(h, self.doc.height) - self.doc.height) > 0.01) {
          self.resize(num(w, self.doc.width), num(h, self.doc.height), true);
        }
        return api;
      },
      attachCurve: function (el) { return self.attachCurve(el); },
      redrawCurve: function () { self.layoutCurve(); return api; },

      saveNow: function () { return self.saveNow(); },
      getStrokeCount: function () { return self.doc.strokes.length; },
      getStrokeBounds: function () {
        var b = null;
        for (var i = 0; i < self.doc.strokes.length; i++) {
          var pts = self.doc.strokes[i].points;
          for (var j = 0; j < pts.length; j++) {
            var p = pts[j];
            if (!b) b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
            else {
              if (p.x < b.x0) b.x0 = p.x;
              if (p.y < b.y0) b.y0 = p.y;
              if (p.x > b.x1) b.x1 = p.x;
              if (p.y > b.y1) b.y1 = p.y;
            }
          }
        }
        return b;
      },
      getLastStrokeSamples: function () { return self._lastStats.slice(); },
      getWidthForPressure: function (p) { return self.getWidthForPressure(p); },
      getViewport: function () {
        return {
          scale: self.view.scale,
          ox: self.view.ox,
          oy: self.view.oy,
          win: self.view.win ? assign({}, self.view.win) : null,
          docWidth: self.doc.width,
          docHeight: self.doc.height,
          stageWidth: self._viewRect.width,
          stageHeight: self._viewRect.height
        };
      },

      /* 图层 */
      getLayers: function () { return self.getLayers(); },
      addLayer: function (name) { return self.addLayer(name); },
      deleteLayer: function (id) { return self.deleteLayer(id); },
      duplicateLayer: function (id) { return self.duplicateLayer(id); },
      renameLayer: function (id, name) { return self.renameLayer(id, name); },
      setLayerVisible: function (id, v) { return self.setLayerVisible(id, v); },
      setLayerOpacity: function (id, v) { return self.setLayerOpacity(id, v); },
      setLayerBlend: function (id, v) { return self.setLayerBlend(id, v); },
      moveLayer: function (id, delta) { return self.moveLayer(id, delta); },
      setActiveLayer: function (id) { return self.setActiveLayer(id); },
      getActiveLayer: function () {
        var l = self._activeLayer || self.activeLayerOf();
        return l ? { id: l.id, name: l.name, opacity: l.opacity, visible: l.visible, blend: l.blend } : null;
      },

      /* 帧 */
      getFrames: function () { return self.getFrames(); },
      setFrames: function (list) {
        if (!Array.isArray(list) || !list.length) return api;
        var frames = [];
        for (var i = 0; i < list.length; i++) {
          var raw = list[i];
          if (raw && Array.isArray(raw.layers)) {
            frames.push(self.hydrateFrame(raw));
          } else {
            var lyr = self.makeLayer('图层 1');
            var strokes = Array.isArray(raw && raw.layers) ? raw.layers : [];
            frames.push({ id: raw && raw.id || uid('frm'), name: (raw && raw.name) || '原画', dur: (raw && raw.dur) || FRAME_DUR, layers: [lyr] });
          }
        }
        self.project.frames = frames;
        self.project.activeFrameId = frames[0].id;
        self.project.activeLayerId = frames[0].layers[frames[0].layers.length - 1].id;
        self.bindActive();
        self.invalidate();
        self.scheduleSave();
        self.emit('frames', { reason: 'set' });
        return api;
      },
      addFrame: function (afterId) { return self.addFrame(afterId); },
      deleteFrame: function (id) { return self.deleteFrame(id); },
      duplicateFrame: function (id) { return self.duplicateFrame(id); },
      moveFrame: function (id, index) { return self.moveFrame(id, index); },
      seekFrame: function (index) { return self.seekFrame(index); },
      setActiveFrame: function (id) { return self.setActiveFrame(id); },
      stepFrame: function (delta) { return self.stepFrame(delta); },
      getActiveFrame: function () {
        var f = self.activeFrame();
        return f ? { id: f.id, name: f.name, index: self.frameIndex(f.id), dur: f.dur } : null;
      },
      getFrameDuration: function () { return self.project.fps; },

      /* 播放 */
      play: function () { self.play(); return api; },
      pause: function () { self.pause(); return api; },
      togglePlay: function () { return self.togglePlay(); },
      isPlaying: function () { return self._playing; },
      setFps: function (fps) { return self.setFps(fps); },
      getFps: function () { return self.project.fps; },
      getTimeState: function () { return self.timeState(); },

      /* 洋葱皮 */
      setOnion: function (opts) { return self.setOnion(opts); },
      getOnion: function () { return self.getOnion(); },

      /* 导出 */
      exportPNG: function (widthPx) { return self.exportPNG(widthPx); },
      exportSequence: function (widthPx) { return self.exportSequence(widthPx); },
      downloadPNG: function (name) { return self.downloadPNG(name); },
      downloadSequenceZip: function (name) { return self.downloadSequenceZip(name); },

      on: function (event, fn) {
        if (!self._listeners[event]) self._listeners[event] = [];
        self._listeners[event].push(fn);
        return function () {
          var arr = self._listeners[event] || [];
          var i = arr.indexOf(fn);
          if (i >= 0) arr.splice(i, 1);
        };
      }
    };
    return api;
  };

  Engine.prototype.destroy = function () {
    if (this._destroyed) return;
    this.saveNow();
    this._destroyed = true;
    if (this._rafDraw) global.cancelAnimationFrame(this._rafDraw);
    if (this._playRaf) global.cancelAnimationFrame(this._playRaf);
    if (this._ro) this._ro.disconnect();
    global.removeEventListener('resize', this._onResize);
    global.removeEventListener('scroll', this._onWinMove, true);
    document.removeEventListener('keydown', this._onKey);
    if (this.stage) {
      this.stage.removeEventListener('pointerdown', this._onDown);
      this.stage.removeEventListener('pointermove', this._onMove);
      this.stage.removeEventListener('pointerup', this._onUp);
      this.stage.removeEventListener('pointercancel', this._onUp);
    }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.container.innerHTML = '';
    this.doc.strokes = [];
    this.history.stack = [];
  };

  function mount(container, options) {
    if (!container || container.nodeType !== 1) {
      throw new Error('OUACanvas.mount: 第一个参数必须是 DOM 容器元素');
    }
    var engine = new Engine(container, options);
    return engine.init();
  }

  var OUACanvas = {
    version: VERSION,
    mount: mount,
    util: {
      normalizeCurve: normalizeCurve,
      buildCurveLUT: buildCurveLUT,
      sampleLUT: sampleLUT,
      widthForPressure: widthForPressure,
      buildSamples: buildSamples,
      defaultCurve: DEFAULT_CURVE,
      presets: CURVE_PRESETS
    }
  };

  global.OUACanvas = OUACanvas;
  if (typeof module !== 'undefined' && module.exports) module.exports = OUACanvas;
})(typeof window !== 'undefined' ? window : this);
