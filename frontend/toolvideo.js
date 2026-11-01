/* ============================================================
 * 免费生视频 HMTOOLVIDEO（零成本本地生成流水线）
 * 流程：提示词 → 生成 HTML 代码（含场景与分辨率）
 *      → 逐帧把 HTML 渲染为 PNG（同一份 HTML 在沙盒 iframe 中执行）
 *      → 连续帧预览 → 导出 GIF / WebM(MP4) / PNG 序列 ZIP / 单帧 PNG / HTML 代码
 * 不调用付费接口，不消耗积分。
 * ============================================================ */
window.HMToolVideo = (function () {
  'use strict';

  var DEFAULT_PROMPT = '深蓝夜空里，星光粒子缓缓汇聚成一颗发光的星球';
  var MAX_FRAMES = 96;

  var el = {};
  var inited = false;

  var spec = null;          // 当前场景规格
  var code = '';            // 生成的 HTML 代码
  var frameUrls = [];       // PNG dataURL 帧序列
  var frameImgs = [];       // 已解码的帧图片
  var cur = 0;              // 当前预览帧
  var playing = false;
  var rafId = 0;
  var lastTick = 0;
  var iframe = null;
  var busy = false;
  var gifBusy = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }
  function pad(n, len) { var s = String(n); while (s.length < (len || 3)) s = '0' + s; return s; }

  /* ---------------- 提示词编译（本地确定性，零成本） ---------------- */
  var THEMES = [
    { style: 'particles', bg1: '#0b1330', bg2: '#02040c', palette: ['#8ab4ff', '#c7d2fe', '#67e8f9', '#ffffff'],
      keys: ['星', '夜空', '银河', '宇宙', '太空', 'star', 'space', 'galaxy'] },
    { style: 'rain', bg1: '#071320', bg2: '#01060b', palette: ['#7dd3fc', '#38bdf8', '#bae6fd'],
      keys: ['雨', '水滴', '暴雨', 'rain', 'storm'] },
    { style: 'city', bg1: '#160b2a', bg2: '#05010f', palette: ['#f472b6', '#22d3ee', '#fbbf24', '#a78bfa'],
      keys: ['城市', '都市', '霓虹', '赛博', 'city', 'cyber', 'neon'] },
    { style: 'blocks', bg1: '#101a2b', bg2: '#05080f', palette: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa'],
      keys: ['方块', '像素', '几何', '马赛克', '网格', 'block', 'pixel', 'grid'] },
    { style: 'wave', bg1: '#071e2f', bg2: '#020a12', palette: ['#38bdf8', '#22d3ee', '#a5f3fc', '#0ea5e9'],
      keys: ['浪', '海', '水波', '湖', 'wave', 'ocean', 'sea'] },
    { style: 'ripple', bg1: '#120c22', bg2: '#05030d', palette: ['#c4b5fd', '#a78bfa', '#f0abfc'],
      keys: ['涟漪', '圆环', '光环', '扩散', 'ripple', 'ring'] },
    { style: 'orbit', bg1: '#0a1228', bg2: '#03050f', palette: ['#93c5fd', '#fda4af', '#fef3c7', '#a7f3d0'],
      keys: ['轨道', '旋转', '星球', '行星', '卫星', 'orbit', 'planet', 'spin'] },
    { style: 'fireworks', bg1: '#0b0a1a', bg2: '#02020a', palette: ['#fbbf24', '#f472b6', '#60a5fa', '#4ade80', '#ffffff'],
      keys: ['烟花', '爆', '焰火', '火花', 'firework', 'fire'] }
  ];

  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function themeForStyle(style) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].style === style) return THEMES[i];
    return THEMES[0];
  }

  function compilePrompt(prompt, opts) {
    var text = String(prompt || '').toLowerCase();
    var chosen = null;
    for (var i = 0; i < THEMES.length && !chosen; i++) {
      var t = THEMES[i];
      for (var k = 0; k < t.keys.length; k++) {
        if (text.indexOf(t.keys[k].toLowerCase()) >= 0) { chosen = t; break; }
      }
    }
    if (!chosen) chosen = THEMES[0];
    var style = opts && opts.style && opts.style !== 'auto' ? opts.style : chosen.style;
    var theme = themeForStyle(style);
    var seed = opts && opts.seed ? Number(opts.seed) : (hashStr(prompt) % 99991);
    var hash = hashStr(prompt + '#' + seed);
    var w = Number(opts && opts.w) || 960;
    var h = Number(opts && opts.h) || 540;
    var palette = theme.palette.slice();
    if (opts && opts.accent) palette[0] = opts.accent;
    return {
      w: w, h: h,
      fps: Number(opts && opts.fps) || 18,
      frames: Math.min(MAX_FRAMES, Math.max(8, Number(opts && opts.frames) || 36)),
      seed: seed,
      style: style,
      bg1: theme.bg1,
      bg2: theme.bg2,
      palette: palette,
      count: 70 + (hash % 130),
      speed: 0.55 + (hash % 60) / 100,
      cols: 12 + (hash % 7),
      rows: 7 + (hash % 4),
      prompt: String(prompt || '')
    };
  }

  /* ---------------- 场景渲染（单一渲染入口，禁止外部依赖） ---------------- */
  function renderScene(ctx, spec, t) {
    var w = spec.w, h = spec.h;
    t = ((t % 1) + 1) % 1;
    var pal = (spec.palette && spec.palette.length) ? spec.palette : ['#93c5fd'];
    function col(i) { return pal[((i % pal.length) + pal.length) % pal.length]; }
    function rnd(i) {
      var x = Math.sin((spec.seed || 1) * 9283.17 + i * 269.31) * 43758.5453;
      return x - Math.floor(x);
    }
    function rgba(hex, a) {
      var s = String(hex || '').replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var r = parseInt(s.slice(0, 2), 16) || 0;
      var g = parseInt(s.slice(2, 4), 16) || 0;
      var b = parseInt(s.slice(4, 6), 16) || 0;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // 背景
    var lg = ctx.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, spec.bg1 || '#0b1330');
    lg.addColorStop(1, spec.bg2 || '#02040c');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);

    var style = spec.style || 'particles';
    var i, x, y;

    if (style === 'particles') {
      var n = spec.count || 120;
      var cx = w * 0.5, cy = h * 0.52, maxR = Math.min(w, h) * 0.46;
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.6);
      cg.addColorStop(0, rgba(col(0), 0.5));
      cg.addColorStop(0.45, rgba(col(0), 0.1));
      cg.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);
      for (i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + t * Math.PI * 2 * (spec.speed || 1) * 0.9;
        var rr = maxR * (0.34 + 0.66 * rnd(i)) * (0.78 + 0.22 * Math.sin(t * 6.2832 + i * 0.7));
        x = cx + Math.cos(a) * rr * 1.28;
        y = cy + Math.sin(a) * rr * 0.9;
        var pr = 1 + rnd(i + 50) * 3;
        var pa = 0.35 + 0.65 * Math.abs(Math.sin(t * 6.2832 + i * 0.33));
        ctx.globalAlpha = pa;
        ctx.fillStyle = col(i);
        ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = pa * 0.15;
        ctx.beginPath(); ctx.arc(x, y, pr * 4.2, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'blocks') {
      var cols = spec.cols || 16, rows = spec.rows || 9;
      var cw = w / cols, ch = h / rows, gap = Math.min(cw, ch) * 0.16;
      for (var by = 0; by < rows; by++) {
        for (var bx = 0; bx < cols; bx++) {
          var ph = t * 6.2832 + (bx + by) * 0.42;
          var s = 0.18 + 0.82 * Math.abs(Math.sin(ph));
          ctx.save();
          ctx.translate(bx * cw + cw / 2, by * ch + ch / 2);
          ctx.scale(s, s);
          ctx.globalAlpha = 0.25 + 0.75 * s;
          ctx.fillStyle = col(bx * 3 + by * 5);
          ctx.fillRect(-(cw - gap) / 2, -(ch - gap) / 2, cw - gap, ch - gap);
          ctx.restore();
        }
      }
    } else if (style === 'rain') {
      var nr = spec.count || 140;
      ctx.lineCap = 'round';
      for (i = 0; i < nr; i++) {
        var rx = rnd(i) * w * 1.1 - w * 0.05;
        var sp = 0.5 + rnd(i + 30) * 0.9;
        var prog = ((rnd(i + 11) + t * (spec.speed || 1) * sp * 2.4) % 1.15) - 0.05;
        var ry = prog * (h + 80) - 40;
        var len = 10 + rnd(i + 70) * 26;
        ctx.globalAlpha = 0.22 + rnd(i + 5) * 0.5;
        ctx.strokeStyle = col(i);
        ctx.lineWidth = 1 + rnd(i + 9) * 2;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + 2, ry + len); ctx.stroke();
      }
      var gg = ctx.createLinearGradient(0, h * 0.82, 0, h);
      gg.addColorStop(0, rgba(col(1), 0));
      gg.addColorStop(1, rgba(col(1), 0.35));
      ctx.globalAlpha = 1;
      ctx.fillStyle = gg;
      ctx.fillRect(0, h * 0.82, w, h * 0.18);
    } else if (style === 'wave') {
      for (var k = 0; k < 5; k++) {
        ctx.beginPath();
        for (x = 0; x <= w; x += 8) {
          var ny = h * (0.42 + k * 0.072) + Math.sin((x / w) * 6.2832 * 2 + t * 6.2832 + k * 0.8) * h * 0.055;
          if (x === 0) ctx.moveTo(x, ny); else ctx.lineTo(x, ny);
        }
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.globalAlpha = 0.1 + k * 0.06;
        ctx.fillStyle = col(k);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'ripple') {
      var rcx = w * 0.5, rcy = h * 0.5, rmax = Math.max(w, h) * 0.62, rings = 9;
      for (i = 0; i < rings; i++) {
        var rph = (t + i / rings) % 1;
        ctx.globalAlpha = (1 - rph) * 0.55;
        ctx.strokeStyle = col(i);
        ctx.lineWidth = 2 + (1 - rph) * 7;
        ctx.beginPath(); ctx.arc(rcx, rcy, rph * rmax, 0, 6.2832); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col(2);
      ctx.beginPath(); ctx.arc(rcx, rcy, 8, 0, 6.2832); ctx.fill();
    } else if (style === 'orbit') {
      var ocx = w * 0.5, ocy = h * 0.5, R = Math.min(w, h) * 0.3;
      var og = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, R * 0.95);
      og.addColorStop(0, rgba(col(0), 0.85));
      og.addColorStop(0.45, rgba(col(0), 0.22));
      og.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(ocx, ocy, R * 0.95, 0, 6.2832); ctx.fill();
      ctx.fillStyle = col(0);
      ctx.beginPath(); ctx.arc(ocx, ocy, R * 0.26, 0, 6.2832); ctx.fill();
      var on = spec.count || 90;
      for (i = 0; i < on; i++) {
        var orbit = 0.45 + (i % 4) * 0.16;
        var oa = (i / on) * Math.PI * 2 * 3 + t * 6.2832 * (spec.speed || 1) * 1.6;
        var orr = R * orbit;
        x = ocx + Math.cos(oa) * orr * 1.35;
        y = ocy + Math.sin(oa) * orr * 0.68;
        ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 6.2832 + i));
        ctx.fillStyle = col(i);
        ctx.beginPath(); ctx.arc(x, y, 1.6 + rnd(i) * 2.4, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'city') {
      var horizon = h * 0.72;
      var sg = ctx.createRadialGradient(w * 0.5, horizon, 0, w * 0.5, horizon, w * 0.55);
      sg.addColorStop(0, rgba(col(0), 0.3));
      sg.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, horizon);
      for (var layer = 0; layer < 2; layer++) {
        var baseY = horizon + layer * h * 0.06;
        for (i = 0; i < 14; i++) {
          var bw = (w / 16) * (0.6 + rnd(i + layer * 20) * 0.8);
          var bxx = i * w / 14 + rnd(i + layer * 13) * 10;
          var bh = h * (0.12 + rnd(i + layer * 7) * 0.3);
          ctx.globalAlpha = 1;
          ctx.fillStyle = layer === 0 ? 'rgba(6,10,22,0.95)' : 'rgba(10,16,32,0.9)';
          ctx.fillRect(bxx, baseY - bh, bw, bh);
          var winCols = Math.max(1, Math.floor(bw / 14));
          for (var wy = 0; wy < Math.floor(bh / 16); wy++) {
            for (var wx = 0; wx < winCols; wx++) {
              var blink = Math.sin(t * 12.566 + (wx + wy * 3 + i) * 0.7 + layer);
              if (blink < 0.15) continue;
              ctx.globalAlpha = 0.3 + 0.55 * blink;
              ctx.fillStyle = col(wx + wy + i);
              ctx.fillRect(bxx + 4 + wx * 14, baseY - bh + 6 + wy * 16, 5, 7);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      var sweep = ((t * 1.6) % 1) * (w * 1.4) - w * 0.2;
      var swg = ctx.createLinearGradient(sweep - 60, 0, sweep + 60, 0);
      swg.addColorStop(0, rgba(col(1), 0));
      swg.addColorStop(0.5, rgba(col(1), 0.16));
      swg.addColorStop(1, rgba(col(1), 0));
      ctx.fillStyle = swg;
      ctx.fillRect(0, 0, w, horizon);
    } else {
      var bursts = 3;
      for (var b = 0; b < bursts; b++) {
        var bph = (t + b / bursts) % 1;
        var fcx = w * (0.18 + rnd(b + 3) * 0.64);
        var fcy = h * (0.16 + rnd(b + 8) * 0.42);
        var fmax = Math.min(w, h) * (0.18 + rnd(b + 1) * 0.22);
        var frad = fmax * Math.pow(bph, 0.55);
        var falpha = Math.max(0, 1 - bph * 1.1);
        for (var p = 0; p < 36; p++) {
          var fa = (p / 36) * 6.2832 + rnd(b * 10 + p) * 0.5;
          x = fcx + Math.cos(fa) * frad;
          y = fcy + Math.sin(fa) * frad + bph * bph * h * 0.12;
          ctx.globalAlpha = falpha * (0.45 + 0.55 * rnd(p));
          ctx.fillStyle = col(p + b);
          ctx.beginPath(); ctx.arc(x, y, 1.6 + rnd(p + 20) * 2, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // 暗角
    var vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------------- 生成 HTML 代码 ---------------- */
  function buildHtml(s) {
    var src = renderScene.toString();
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<title>' + (s.style) + ' scene · ' + s.w + '×' + s.h + '</title>\n' +
      '<style>html,body{margin:0;height:100%;background:' + s.bg2 + ';overflow:hidden}' +
      'canvas{display:block;width:100vw;height:100vh}</style>\n</head>\n<body>\n' +
      '<canvas id="c" width="' + s.w + '" height="' + s.h + '"></canvas>\n' +
      '<script>\n(function(){\n' +
      'var SPEC = ' + JSON.stringify(s) + ';\n' +
      'var render = (' + src + ');\n' +
      'var cv = document.getElementById("c");\n' +
      'var ctx = cv.getContext("2d");\n' +
      'function draw(t){ render(ctx, SPEC, t); }\n' +
      'window.__HM_FRAME__ = function(t){ draw(t); return cv; };\n' +
      'window.__HM_SPEC__ = SPEC;\n' +
      'var stopped = false;\n' +
      'window.__HM_STOP__ = function(){ stopped = true; };\n' +
      'var t0 = null;\n' +
      'function loop(ts){\n' +
      '  if (stopped) return;\n' +
      '  if (!t0) t0 = ts;\n' +
      '  var t = ((ts - t0) / (SPEC.frames / SPEC.fps * 1000)) % 1;\n' +
      '  draw(t);\n' +
      '  requestAnimationFrame(loop);\n' +
      '}\n' +
      'draw(0);\n' +
      'requestAnimationFrame(loop);\n' +
      '})();\n' +
      '<\/script>\n</body>\n</html>';
  }

  /* ---------------- iframe：真正执行生成的 HTML ---------------- */
  function ensureIframe(html) {
    if (iframe) { iframe.remove(); iframe = null; }
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;visibility:hidden;pointer-events:none';
    f.width = spec.w;
    f.height = spec.h;
    f.setAttribute('aria-hidden', 'true');
    f.srcdoc = html;
    document.body.appendChild(f);
    iframe = f;
  }

  function waitIframe(timeoutMs) {
    return new Promise(function (resolve) {
      var waited = 0;
      function check() {
        try {
          if (iframe && iframe.contentWindow && typeof iframe.contentWindow.__HM_FRAME__ === 'function') return resolve(true);
        } catch (e) { /* 跨域或未就绪 */ }
        waited += 60;
        if (waited >= timeoutMs) return resolve(false);
        setTimeout(check, 60);
      }
      check();
    });
  }

  function fallbackCanvas() {
    var cv = document.createElement('canvas');
    cv.width = spec.w;
    cv.height = spec.h;
    return cv;
  }

  /* ---------------- 帧序列 ---------------- */
  async function renderFramesAsync() {
    if (!spec) return;
    if (busy) return;
    busy = true;
    frameUrls = [];
    frameImgs = [];
    cur = 0;
    stopPlay();
    clearThumbs();
    setStep(1, 'done', '已生成');
    setStep(2, 'run', '渲染中');
    setStep(3, '', '待合成');
    setProgress(0);
    setStatusHint('');
    status('正在把 HTML 逐帧渲染为 PNG…');
    setExportsEnabled(false);

    var total = spec.frames;
    var urls = [];
    var usedIframe = false;
    try {
      usedIframe = await waitIframe(2500);
      if (usedIframe && iframe.contentWindow.__HM_STOP__) iframe.contentWindow.__HM_STOP__();
    } catch (e) { usedIframe = false; }

    try {
      if (usedIframe) {
        for (var i = 0; i < total; i++) {
          var cv = iframe.contentWindow.__HM_FRAME__(i / total);
          urls.push(cv.toDataURL('image/png'));
          setProgress(Math.round((i + 1) / total * 100));
          if (i % 6 === 5) await sleep(0);
        }
      }
    } catch (e) {
      urls = [];
      usedIframe = false;
    }

    if (!urls.length) {
      var cv2 = fallbackCanvas();
      var ctx2 = cv2.getContext('2d');
      for (var j = 0; j < total; j++) {
        renderScene(ctx2, spec, j / total);
        urls.push(cv2.toDataURL('image/png'));
        setProgress(Math.round((j + 1) / total * 100));
        if (j % 6 === 5) await sleep(0);
      }
      setStatusHint('（沙盒 iframe 不可用，已使用内置同源渲染器，输出一致）');
    }

    frameUrls = urls;
    setProgress(100);
    status('正在解码 ' + urls.length + ' 帧…');
    frameImgs = await loadImages(urls);
    setStep(2, 'done', urls.length + ' 帧');
    setStep(3, 'run', '可合成');
    status('帧序列就绪：' + spec.w + '×' + spec.h + ' · ' + urls.length + ' 帧 · ' + spec.fps + ' fps');
    setExportsEnabled(true);
    renderThumbs();
    el.scrub.max = String(Math.max(0, urls.length - 1));
    el.scrub.value = '0';
    showFrame(0);
    busy = false;
    startPlay();
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function loadImages(urls) {
    return Promise.all(urls.map(function (u) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = u;
      });
    }));
  }

  /* ---------------- 预览 / 播放 ---------------- */
  function showFrame(i) {
    if (!frameImgs.length) return;
    cur = Math.max(0, Math.min(frameImgs.length - 1, i));
    var img = frameImgs[cur];
    var cv = el.preview;
    if (cv.width !== spec.w || cv.height !== spec.h) { cv.width = spec.w; cv.height = spec.h; }
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, spec.w, spec.h);
    if (img) ctx.drawImage(img, 0, 0, spec.w, spec.h);
    el.scrub.value = String(cur);
    el.frameInfo.textContent = (cur + 1) + ' / ' + frameImgs.length;
    el.stageEmpty.hidden = true;
  }

  function startPlay() {
    if (!frameImgs.length || playing) return;
    playing = true;
    lastTick = 0;
    el.playBtn.textContent = '⏸ 暂停';
    var step = 1000 / (spec.fps || 18);
    function tick(ts) {
      if (!playing) return;
      if (!lastTick) lastTick = ts;
      var dt = ts - lastTick;
      if (dt >= step) {
        lastTick = ts - (dt % step);
        showFrame((cur + 1) % frameImgs.length);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopPlay() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (el.playBtn) el.playBtn.textContent = '▶ 播放';
  }

  function clearThumbs() {
    if (el.thumbs) el.thumbs.innerHTML = '';
  }

  function renderThumbs() {
    if (!el.thumbs) return;
    var html = '';
    for (var i = 0; i < frameUrls.length; i++) {
      html += '<img class="hm-gv-thumb" data-frame="' + i + '" src="' + frameUrls[i] + '" alt="帧' + (i + 1) + '">';
    }
    el.thumbs.innerHTML = html;
  }

  /* ---------------- 生成流程 ---------------- */
  function generateCode(opts) {
    var prompt = el.prompt.value.trim() || DEFAULT_PROMPT;
    var res = el.res.value.split('x');
    var themeSel = el.theme ? el.theme.value : 'auto';
    spec = compilePrompt(prompt, {
      w: Number(res[0]) || 960,
      h: Number(res[1]) || 540,
      fps: Number(el.fps.value) || 18,
      frames: Number(el.frames.value) || 36,
      seed: Number(el.seed.value) || 0,
      style: themeSel,
      accent: el.accent ? el.accent.value : ''
    });
    code = buildHtml(spec);
    el.code.value = code;
    setStep(1, 'done', 'HTML 已生成');
    status('已生成 HTML 代码（' + spec.w + '×' + spec.h + '，' + spec.frames + ' 帧 @ ' + spec.fps + 'fps）');
    ensureIframe(code);
    renderFramesAsync();
  }

  function applyCode() {
    var text = el.code.value.trim();
    if (!text) { toast('代码为空', 'error'); return; }
    var m = text.match(/var SPEC\s*=\s*(\{[\s\S]*?\});\s*var render\s*=/);
    if (!m) { toast('未找到场景规格 SPEC，请使用上方生成或保持格式', 'error'); return; }
    var parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { toast('SPEC 解析失败：' + e.message, 'error'); return; }
    if (!parsed || !parsed.w || !parsed.h) { toast('SPEC 缺少尺寸信息', 'error'); return; }
    spec = parsed;
    spec.frames = Math.min(MAX_FRAMES, Math.max(8, Number(spec.frames) || 36));
    spec.fps = Math.max(4, Number(spec.fps) || 18);
    code = text;
    ensureIframe(code);
    renderFramesAsync();
  }

  /* ---------------- 导出 ---------------- */
  function safeName() {
    var p = String(el.prompt.value || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 16);
    return p || 'video';
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function exportGif() {
    if (!frameImgs.length || gifBusy) return;
    gifBusy = true;
    var btn = el.exportGif;
    btn.disabled = true;
    btn.textContent = 'GIF 合成中…';
    status('正在合成 GIF（' + (el.gifSize.value || 480) + 'px 宽）…');
    try {
      var gw = Math.min(spec.w, Number(el.gifSize.value) || 480);
      var gh = Math.round(gw * spec.h / spec.w);
      var cvs = document.createElement('canvas');
      cvs.width = gw;
      cvs.height = gh;
      var ctx = cvs.getContext('2d');
      var delay = Math.max(2, Math.round(100 / spec.fps));
      var all = [];
      for (var i = 0; i < frameImgs.length; i++) {
        ctx.clearRect(0, 0, gw, gh);
        if (frameImgs[i]) ctx.drawImage(frameImgs[i], 0, 0, gw, gh);
        var data = ctx.getImageData(0, 0, gw, gh).data;
        var idx = new Uint8Array(gw * gh);
        for (var p = 0, o = 0; p < idx.length; p++, o += 4) {
          idx[p] = ((data[o] >> 5) << 5) | ((data[o + 1] >> 5) << 2) | (data[o + 2] >> 6);
        }
        all.push(idx);
        btn.textContent = 'GIF ' + Math.round((i + 1) / frameImgs.length * 100) + '%';
        if (i % 4 === 3) await sleep(0);
      }
      var bytes = gifEncode(all, gw, gh, delay);
      download(new Blob([bytes], { type: 'image/gif' }), safeName() + '.gif');
      status('GIF 已导出：' + gw + '×' + gh + ' · ' + frameImgs.length + ' 帧');
      toast('GIF 已导出', 'success');
    } catch (e) {
      toast('GIF 导出失败：' + (e && e.message || e), 'error');
    } finally {
      gifBusy = false;
      btn.disabled = false;
      btn.textContent = '导出 GIF';
    }
  }

  function pickVideoMime() {
    var list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < list.length; i++) {
      try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) { /* ignore */ }
    }
    return '';
  }

  function exportVideo() {
    if (!frameImgs.length) return;
    if (!window.MediaRecorder) { toast('当前浏览器不支持视频录制，请改用 GIF', 'error'); return; }
    var mime = pickVideoMime();
    var isMp4 = /mp4/.test(mime);
    var cvs = document.createElement('canvas');
    cvs.width = spec.w;
    cvs.height = spec.h;
    var ctx = cvs.getContext('2d');
    if (!cvs.captureStream) { toast('当前浏览器不支持画布录制，请改用 GIF', 'error'); return; }
    var stream = cvs.captureStream(spec.fps);
    var rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(12000000, Math.max(2000000, spec.w * spec.h * 4)) })
        : new MediaRecorder(stream);
    } catch (e) {
      toast('视频录制初始化失败', 'error');
      return;
    }
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var ext = isMp4 ? 'mp4' : 'webm';
      download(new Blob(chunks, { type: mime || 'video/webm' }), safeName() + '.' + ext);
      status('视频已导出：.' + ext + ' · ' + frameImgs.length + ' 帧');
      toast('视频已导出（.' + ext + '）', 'success');
      el.exportVideo.disabled = false;
      el.exportVideo.textContent = isMp4 ? '导出 MP4' : '导出 WebM';
    };
    el.exportVideo.disabled = true;
    el.exportVideo.textContent = '录制中…';
    status('正在录制 ' + (isMp4 ? 'MP4' : 'WebM') + '…');
    rec.start();
    var i = 0;
    var step = 1000 / spec.fps;
    var timer = setInterval(function () {
      if (i >= frameImgs.length) {
        clearInterval(timer);
        setTimeout(function () { try { rec.stop(); } catch (e) { /* ignore */ } }, 240);
        return;
      }
      ctx.drawImage(frameImgs[i], 0, 0, spec.w, spec.h);
      i++;
    }, step);
  }

  function exportZip() {
    if (!frameUrls.length) return;
    if (!window.JSZip) { toast('ZIP 组件未加载', 'error'); return; }
    status('正在打包 PNG 帧序列…');
    var zip = new window.JSZip();
    frameUrls.forEach(function (u, i) {
      zip.file('frame_' + pad(i) + '.png', String(u).split(',')[1], { base64: true });
    });
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      download(blob, safeName() + '_frames.zip');
      status('已导出 ' + frameUrls.length + ' 张 PNG（ZIP）');
      toast('PNG 帧序列已导出', 'success');
    }, function (err) {
      toast('打包失败：' + (err && err.message || err), 'error');
    });
  }

  function exportPng() {
    if (!frameUrls.length) return;
    var a = document.createElement('a');
    a.href = frameUrls[cur] || frameUrls[0];
    a.download = safeName() + '_frame_' + pad(cur) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('当前帧已导出', 'success');
  }

  function exportHtml() {
    if (!code) return;
    download(new Blob([code], { type: 'text/html;charset=utf-8' }), safeName() + '_scene.html');
    toast('HTML 代码已导出', 'success');
  }

  /* ---------------- 细节 UI ---------------- */
  function status(msg) { if (el.status) el.status.textContent = msg; }
  function setStatusHint(hint) { if (el.statusHint) el.statusHint.textContent = hint; }
  function setProgress(p) { if (el.progress) el.progress.style.width = Math.max(0, Math.min(100, p)) + '%'; }
  function setStep(n, cls, text) {
    var node = el['step' + n];
    if (!node) return;
    node.classList.remove('is-run', 'is-done');
    if (cls) node.classList.add('is-' + cls);
    var em = node.querySelector('em');
    if (em && text) em.textContent = text;
  }
  function setExportsEnabled(on) {
    [el.exportGif, el.exportVideo, el.exportZip, el.exportPng, el.exportHtml].forEach(function (b) {
      if (b) b.disabled = !on;
    });
  }

  /* ---------------- GIF 编码（3-3-2 调色板 + LZW） ---------------- */
  function gifEncode(framesIdx, w, h, delayCs) {
    var out = [];
    function push() { for (var i = 0; i < arguments.length; i++) out.push(arguments[i]); }
    // Header + Logical Screen Descriptor
    push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    push(w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 0xF7, 0x00, 0x00);
    // Global Color Table: 8×8×4 = 256
    for (var r = 0; r < 8; r++) {
      for (var g = 0; g < 8; g++) {
        for (var b = 0; b < 4; b++) {
          push(Math.round(r * 255 / 7), Math.round(g * 255 / 7), Math.round(b * 255 / 3));
        }
      }
    }
    // NETSCAPE 循环扩展
    push(0x21, 0xFF, 0x0B);
    var ns = 'NETSCAPE2.0';
    for (var i = 0; i < ns.length; i++) push(ns.charCodeAt(i));
    push(0x03, 0x01, 0x00, 0x00, 0x00);

    for (var f = 0; f < framesIdx.length; f++) {
      // Graphic Control Extension
      push(0x21, 0xF9, 0x04, 0x04, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00);
      // Image Descriptor
      push(0x2C, 0x00, 0x00, 0x00, 0x00, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 0x00);
      var data = lzwEncode(framesIdx[f], 8);
      push(0x08);
      var pos = 0;
      while (pos < data.length) {
        var chunk = Math.min(255, data.length - pos);
        push(chunk);
        for (var c = 0; c < chunk; c++) push(data[pos + c]);
        pos += chunk;
      }
      push(0x00);
    }
    push(0x3B);
    return out;
  }

  function lzwEncode(indices, minCodeSize) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var nextCode = eoiCode + 1;
    var dict = new Map();
    var out = [];
    var curByte = 0, curBits = 0;
    function emit(code) {
      curByte |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) {
        out.push(curByte & 0xff);
        curByte >>= 8;
        curBits -= 8;
      }
      // GIF 解码表比编码表慢一拍：码宽应在本次写出后、下一次写出前提升
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    }
    emit(clearCode);
    var code = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var key = code * 512 + k;
      var found = dict.get(key);
      if (found !== undefined) {
        code = found;
      } else {
        emit(code);
        if (nextCode < 4096) {
          dict.set(key, nextCode);
          nextCode++;
        } else {
          emit(clearCode);
          dict = new Map();
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
        }
        code = k;
      }
    }
    emit(code);
    emit(eoiCode);
    while (curBits > 0) { out.push(curByte & 0xff); curByte >>= 8; curBits -= 8; }
    return out;
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
    el.prompt = $('gvPrompt');
    el.theme = $('gvTheme');
    el.res = $('gvRes');
    el.frames = $('gvFrames');
    el.framesVal = $('gvFramesVal');
    el.fps = $('gvFps');
    el.seed = $('gvSeed');
    el.accent = $('gvAccent');
    el.genBtn = $('gvGen');
    el.ideaBtn = $('gvIdea');
    el.applyBtn = $('gvApply');
    el.code = $('gvCode');
    el.preview = $('gvPreview');
    el.stageEmpty = $('gvStageEmpty');
    el.playBtn = $('gvPlay');
    el.scrub = $('gvScrub');
    el.frameInfo = $('gvFrameInfo');
    el.thumbs = $('gvThumbs');
    el.status = $('gvStatus');
    el.statusHint = $('gvStatusHint');
    el.progress = $('gvProgress');
    el.step1 = $('gvStep1');
    el.step2 = $('gvStep2');
    el.step3 = $('gvStep3');
    el.exportGif = $('gvGif');
    el.exportVideo = $('gvVideo');
    el.exportZip = $('gvZip');
    el.exportPng = $('gvPng');
    el.exportHtml = $('gvHtml');
    el.gifSize = $('gvGifSize');
    el.back = $('gvBack');

    el.genBtn.addEventListener('click', function () { if (!busy) generateCode(); });
    el.ideaBtn.addEventListener('click', randomIdea);
    el.applyBtn.addEventListener('click', function () { if (!busy) applyCode(); });
    el.frames.addEventListener('input', function () {
      el.framesVal.textContent = el.frames.value;
    });
    el.playBtn.addEventListener('click', function () { if (playing) stopPlay(); else startPlay(); });
    el.scrub.addEventListener('input', function () { stopPlay(); showFrame(Number(el.scrub.value) || 0); });
    el.thumbs.addEventListener('click', function (e) {
      var t = e.target.closest('[data-frame]');
      if (!t) return;
      stopPlay();
      showFrame(Number(t.getAttribute('data-frame')) || 0);
    });
    el.exportGif.addEventListener('click', exportGif);
    el.exportVideo.addEventListener('click', exportVideo);
    el.exportZip.addEventListener('click', exportZip);
    el.exportPng.addEventListener('click', exportPng);
    el.exportHtml.addEventListener('click', exportHtml);
    el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });

    var mime = pickVideoMime();
    el.exportVideo.textContent = /mp4/.test(mime) ? '导出 MP4' : '导出 WebM';
    el.exportVideo.title = /mp4/.test(mime)
      ? '使用浏览器原生 MP4 编码导出'
      : '当前浏览器仅支持 WebM 编码（可直接上传或转码为 MP4）';
    setExportsEnabled(false);
  }

  var IDEAS = [
    '深蓝夜空里，星光粒子缓缓汇聚成一颗发光的星球',
    '霓虹城市雨夜，粉蓝色灯带在楼群间流动',
    '像素方块随节拍跳动，呈现几何节奏动画',
    '海面波浪层层推进，青蓝色水纹不断翻涌',
    '紫罗兰色涟漪从中心扩散，如同心跳的脉动',
    '行星环绕恒星旋转，拖出细碎光轨',
    '金色烟花在夜空连续绽放，火星随风飘落'
  ];

  function randomIdea() {
    var cur = el.prompt.value.trim();
    var idx = 0;
    for (var i = 0; i < IDEAS.length; i++) if (IDEAS[i] === cur) { idx = i; break; }
    var next = IDEAS[(idx + 1) % IDEAS.length];
    el.prompt.value = next;
    el.seed.value = String((hashStr(next) % 99991));
    if (!busy) generateCode();
  }

  /* ---------------- 生命周期 ---------------- */
  function enter() {
    init();
    if (!code) {
      el.prompt.value = DEFAULT_PROMPT;
      el.seed.value = '';
      generateCode();
    } else {
      showFrame(cur);
    }
  }

  function leave() {
    stopPlay();
  }

  return { init: init, enter: enter, leave: leave };
})();
