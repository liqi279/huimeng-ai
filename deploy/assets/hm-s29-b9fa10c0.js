'use strict';

/* =============================================================
 * 次元宇宙（Dimensional Universe）
 * 顶栏赛博漩涡图标 → 点击触发漩涡覆盖整页的过渡动画 → 进入次元宇宙页
 * 次元宇宙页顶栏同样保留漩涡图标，点击触发反向过渡回到绘梦主页
 * ============================================================= */
(function () {
  var CYBER_COLORS = ['#22d3ee', '#a855f7', '#f472b6', '#38bdf8', '#c084fc'];

  /* ---------- 工具 ---------- */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ---------- 赛博漩涡绘制 ---------- */
  function makeVortex(canvas, size, opts) {
    size = size || 80;
    opts = opts || {};
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      /* 不支持 canvas 2D 的环境（如旧浏览器/测试）跳过绘制，但按钮仍可点击 */
      return { stop: function () {}, setSize: function () {} };
    }
    var cx = size / 2;
    var cy = size / 2;
    var t = 0;
    var raf = 0;
    var alive = true;
    var lastFrame = 0;

    var layers = [
      { r: size * 0.42, w: size * 0.05, speed: 0.012, dir: 1, color: CYBER_COLORS[0], segs: 3, gap: 0.9 },
      { r: size * 0.33, w: size * 0.045, speed: 0.019, dir: -1, color: CYBER_COLORS[1], segs: 4, gap: 0.7 },
      { r: size * 0.24, w: size * 0.04, speed: 0.028, dir: 1, color: CYBER_COLORS[3], segs: 5, gap: 0.6 },
      { r: size * 0.15, w: size * 0.03, speed: 0.04, dir: -1, color: CYBER_COLORS[2], segs: 2, gap: 0.5 }
    ];
    var particles = [];
    for (var i = 0; i < 14; i++) {
      particles.push({
        r: rnd(size * 0.12, size * 0.44),
        a: rnd(0, Math.PI * 2),
        speed: rnd(0.005, 0.03) * (Math.random() < 0.5 ? 1 : -1),
        size: rnd(0.8, 2.2),
        color: CYBER_COLORS[i % CYBER_COLORS.length]
      });
    }

    function drawHexBarrier(alpha) {
      var rr = size * 0.47;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.3);
      ctx.beginPath();
      for (var k = 0; k < 6; k++) {
        var ang = (k / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(ang) * rr;
        var y = Math.sin(ang) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(34,211,238,' + (0.35 * alpha) + ')';
      ctx.lineWidth = size * 0.012;
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = size * 0.12;
      ctx.stroke();
      ctx.restore();
    }

    function frame(now) {
      if (!alive) return;
      if (now - lastFrame < 1000 / 30) { raf = requestAnimationFrame(frame); return; }
      lastFrame = now;
      t += 1;
      ctx.clearRect(0, 0, size, size);

      /* 中心核 */
      var coreR = size * 0.05 * (1 + 0.25 * Math.sin(t * 0.12));
      var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.4, 'rgba(168,85,247,0.6)');
      grd.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
      ctx.fill();

      /* 多层旋转弧带 */
      for (var li = 0; li < layers.length; li++) {
        var L = layers[li];
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * L.speed * L.dir);
        ctx.lineCap = 'round';
        ctx.lineWidth = L.w;
        ctx.strokeStyle = L.color;
        ctx.shadowColor = L.color;
        ctx.shadowBlur = size * 0.1;
        var segAngle = (Math.PI * 2) / L.segs;
        for (var s = 0; s < L.segs; s++) {
          var start = s * segAngle;
          var end = start + segAngle * L.gap;
          ctx.beginPath();
          ctx.arc(0, 0, L.r, start, end);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 沿流线运动的粒子 */
      for (var p = 0; p < particles.length; p++) {
        var P = particles[p];
        P.a += P.speed;
        var px = cx + Math.cos(P.a) * P.r;
        var py = cy + Math.sin(P.a) * P.r;
        ctx.save();
        ctx.fillStyle = P.color;
        ctx.shadowColor = P.color;
        ctx.shadowBlur = size * 0.14;
        ctx.beginPath();
        ctx.arc(px, py, P.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      drawHexBarrier(1);

      raf = requestAnimationFrame(frame);
    }
    frame();

    return {
      stop: function () { alive = false; cancelAnimationFrame(raf); },
      setSize: function (s) { size = s; canvas.width = s; canvas.height = s; cx = cy = s / 2; }
    };
  }

  /* ---------- 顶栏漩涡图标 ---------- */
  var vortexBtn = null;
  var vortexCanvas = null;
  var vortexAnim = null;

  function buildVortexButton() {
    if (vortexBtn) return;
    var topRight = $('.hm-top-right');
    if (!topRight) return;
    vortexBtn = el('button', 'dv-vortex-btn');
    vortexBtn.type = 'button';
    vortexBtn.title = '次元宇宙（Dimensional Universe）';
    vortexBtn.setAttribute('aria-label', '进入次元宇宙');
    vortexCanvas = el('canvas', 'dv-vortex-canvas');
    vortexBtn.appendChild(vortexCanvas);
    /* 插入到用户头像左侧 */
    var userWrap = $('#hmUserWrap');
    if (userWrap) topRight.insertBefore(vortexBtn, userWrap);
    else topRight.insertBefore(vortexBtn, topRight.firstChild);

    vortexAnim = makeVortex(vortexCanvas, 72);
    vortexBtn.addEventListener('click', function () {
      enterDimverse();
    });
  }

  /* ---------- 漩涡全屏过渡 ---------- */
  var overlay = null;
  var overlayCanvas = null;
  var overlayAnim = null;
  var transitioning = false;

  function ensureOverlay() {
    if (overlay) return;
    overlay = el('div', 'dv-overlay');
    overlayCanvas = el('canvas', 'dv-overlay-canvas');
    overlay.appendChild(overlayCanvas);
    document.body.appendChild(overlay);
  }

  function runVortexTransition(fromEl, onMid, onDone) {
    if (transitioning) return;
    transitioning = true;
    ensureOverlay();

    var rect = fromEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var maxDim = Math.max(W, H) * 1.6;
    var canvasSize = 360;

    overlay.style.display = 'flex';
    overlayCanvas.width = canvasSize;
    overlayCanvas.height = canvasSize;
    overlayCanvas.style.width = rect.width + 'px';
    overlayCanvas.style.height = rect.height + 'px';
    overlayCanvas.style.left = (cx - rect.width / 2) + 'px';
    overlayCanvas.style.top = (cy - rect.height / 2) + 'px';

    if (overlayAnim) overlayAnim.stop();
    overlayAnim = makeVortex(overlayCanvas, canvasSize);

    var start = performance.now();
    var phase1 = 320;   /* 覆盖整个页面 */
    var phase2 = 140;   /* 全黑保持 */
    var phase3 = 360;   /* 缩回图标 */
    var total = phase1 + phase2 + phase3;
    var midFired = false;

    function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
    function easeInCubic(x) { return x * x * x; }

    function tick(now) {
      var dt = now - start;
      if (dt >= total) {
        overlay.style.display = 'none';
        if (overlayAnim) { overlayAnim.stop(); overlayAnim = null; }
        transitioning = false;
        if (onDone) onDone();
        return;
      }
      if (dt < phase1) {
        var p = dt / phase1;
        var scale = 1 + (maxDim / rect.width - 1) * easeOutCubic(p);
        overlayCanvas.style.transform = 'translate(-50%,-50%) scale(' + scale + ')';
        overlayCanvas.style.opacity = String(0.4 + 0.6 * p);
        overlay.style.background = 'rgba(2,4,12,' + (0.1 + 0.8 * p) + ')';
      } else if (dt < phase1 + phase2) {
        overlayCanvas.style.transform = 'translate(-50%,-50%) scale(' + (maxDim / rect.width) + ')';
        overlay.style.background = 'rgba(2,4,12,1)';
        if (!midFired) { midFired = true; if (onMid) onMid(); }
      } else {
        var q = (dt - phase1 - phase2) / phase3;
        var scale2 = (maxDim / rect.width) + (1 - maxDim / rect.width) * easeInCubic(q);
        overlayCanvas.style.transform = 'translate(-50%,-50%) scale(' + scale2 + ')';
        overlay.style.opacity = String(1 - easeInCubic(q));
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- 次元宇宙页 ---------- */
  var dimPage = null;
  var dimVortexBtn = null;
  var dimVortexCanvas = null;
  var dimVortexAnim = null;
  var dimSymbols = [];
  var dimRaf = 0;
  var lastSymbolFrame = 0;
  var dimStartBtn = null;
  var dimTitleIntroStarted = false;

  function buildDimPage() {
    if (dimPage) return;
    dimPage = el('div', 'dv-page');
    dimPage.setAttribute('aria-hidden', 'true');
    /* 关键视觉底层直接由页面节点持有，避免旧缓存样式把整个次元空间渲染成纯黑。 */
    dimPage.style.backgroundColor = '#070817';
    dimPage.style.backgroundImage =
      'radial-gradient(ellipse at 18% 12%, rgba(34,211,238,.13), transparent 54%),' +
      'radial-gradient(ellipse at 84% 88%, rgba(168,85,247,.16), transparent 58%),' +
      'repeating-linear-gradient(0deg, rgba(34,211,238,.055) 0 1px, transparent 1px 48px),' +
      'repeating-linear-gradient(90deg, rgba(34,211,238,.055) 0 1px, transparent 1px 48px),' +
      'linear-gradient(160deg, #050817 0%, #100a24 52%, #070817 100%)';

    /* 顶栏 */
    var topbar = el('div', 'dv-topbar');
    var left = el('div', 'dv-topbar-left');
    dimVortexBtn = el('button', 'dv-vortex-btn dv-vortex-btn-small');
    dimVortexBtn.type = 'button';
    dimVortexBtn.title = '返回绘梦主页';
    dimVortexBtn.setAttribute('aria-label', '返回绘梦主页');
    dimVortexCanvas = el('canvas', 'dv-vortex-canvas');
    dimVortexBtn.appendChild(dimVortexCanvas);
    dimVortexBtn.addEventListener('click', function () { leaveDimverse(); });
    left.appendChild(dimVortexBtn);

    var brand = el('div', 'dv-brand');
    brand.innerHTML = '<span class="dv-brand-mark">次元</span><span class="dv-brand-sub">DIMENSIONAL UNIVERSE</span>';
    left.appendChild(brand);

    var right = el('div', 'dv-topbar-right');
    var pill = el('button', 'dv-pill');
    pill.innerHTML = '<span class="dv-dot"></span>连接绘梦';
    right.appendChild(pill);

    topbar.appendChild(left);
    topbar.appendChild(right);
    dimPage.appendChild(topbar);

    /* 漂浮符号层 */
    var symLayer = el('div', 'dv-symbols');
    dimPage.appendChild(symLayer);

    /* 中心文案 */
    var center = el('div', 'dv-center');
    center.innerHTML = '<h1 class="dv-title" data-text="欢迎来到次元宇宙" aria-label="欢迎来到次元宇宙">欢迎来到次元宇宙</h1>';
    prepareTitleCharacters(center.querySelector('.dv-title'));
    dimStartBtn = el('button', 'dv-start-btn is-pending', '开启');
    dimStartBtn.type = 'button';
    dimStartBtn.disabled = true;
    dimStartBtn.setAttribute('aria-label', '开启次元宇宙序章');
    dimStartBtn.addEventListener('click', function () {
      if (dimStartBtn.disabled || !dimStartBtn.classList.contains('is-ready')) return;
      dimStartBtn.disabled = true;
      dimStartBtn.classList.remove('is-ready');
      dimStartBtn.classList.add('is-exiting');
      var title = center.querySelector('.dv-title');
      if (title) title.classList.add('dv-title-dissolving');
      window.setTimeout(function () { dimStartBtn.remove(); }, 260);
      startDimverseGame();
    });
    center.appendChild(dimStartBtn);
    dimPage.appendChild(center);

    document.body.appendChild(dimPage);
    spawnSymbols(symLayer);
  }

  function spawnSymbols(layer) {
    var glyphs = ['◈', '◇', '△', '▽', '○', '□', '⬡', '⬢', '✦', '✧', '◎', '⊕', '⊗', '⌬', '⟁', '⎔', '⏣', '⏢', '◬', '⌖'];
    var count = 28;
    dimSymbols = [];
    for (var i = 0; i < count; i++) {
      var s = el('span', 'dv-sym');
      s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      var state = {
        el: s,
        x: rnd(0, 100), y: rnd(0, 100),
        vx: rnd(-0.08, 0.08), vy: rnd(-0.06, 0.06),
        rot: rnd(0, 360), vr: rnd(-0.4, 0.4),
        size: rnd(14, 34),
        color: CYBER_COLORS[Math.floor(Math.random() * CYBER_COLORS.length)],
        opacity: rnd(0.12, 0.5)
      };
      s.style.left = '0';
      s.style.top = '0';
      s.style.transform = 'translate3d(' + state.x + 'vw, ' + state.y + 'vh, 0) rotate(' + state.rot + 'deg)';
      s.style.fontSize = state.size + 'px';
      s.style.color = state.color;
      s.style.opacity = state.opacity;
      s.style.textShadow = '0 0 12px ' + state.color;
      layer.appendChild(s);
      dimSymbols.push(state);
    }
  }

  function animateSymbols(now) {
    now = typeof now === 'number' ? now : performance.now();
    if (!dimPage || dimPage.getAttribute('aria-hidden') === 'true') {
      dimRaf = 0;
      return;
    }
    if (now - lastSymbolFrame < 1000 / 30) { dimRaf = requestAnimationFrame(animateSymbols); return; }
    lastSymbolFrame = now;
    for (var i = 0; i < dimSymbols.length; i++) {
      var s = dimSymbols[i];
      s.x += s.vx; s.y += s.vy; s.rot += s.vr;
      if (s.x < -5) s.x = 105; if (s.x > 105) s.x = -5;
      if (s.y < -5) s.y = 105; if (s.y > 105) s.y = -5;
      s.el.style.transform = 'translate3d(' + s.x + 'vw, ' + s.y + 'vh, 0) rotate(' + s.rot + 'deg)';
    }
    dimRaf = requestAnimationFrame(animateSymbols);
  }

  /* ---------- 粒子汇聚成字 · 赛博屏障显形 ---------- */
  function startTitleParticleIntro(center, title, onComplete) {
    if (!center || !title) return;
    title.classList.add('dv-title-building');
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      title.classList.remove('dv-title-building');
      if (onComplete) onComplete();
      return;
    }
    var oldCanvas = center.querySelector('.dv-title-particles');
    if (oldCanvas) oldCanvas.remove();
    var canvas = el('canvas', 'dv-title-particles');
    center.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      title.classList.remove('dv-title-building');
      if (onComplete) onComplete();
      return;
    }

    var w = Math.max(1, center.clientWidth);
    var h = Math.max(1, center.clientHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    var rect = title.getBoundingClientRect();
    var base = center.getBoundingClientRect();
    var left = rect.left - base.left;
    var top = rect.top - base.top;
    var mask = document.createElement('canvas');
    mask.width = Math.ceil(w);
    mask.height = Math.ceil(h);
    var mctx = mask.getContext('2d');
    var style = window.getComputedStyle(title);
    /* Canvas font 不接受部分 CSS font 简写中的 line-height；拆开设置，确保文字蒙版按真实标题字号绘制。 */
    mctx.font = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = '#fff';
    var titleText = title.textContent || '欢迎来到次元宇宙';
    mctx.fillText(titleText, left + rect.width / 2, top + rect.height / 2, rect.width + 8);
    var pixels = mctx.getImageData(0, 0, mask.width, mask.height).data;
    var points = [];
    var step = 2;
    for (var y = Math.max(0, Math.floor(top)); y < Math.min(mask.height, top + rect.height); y += step) {
      for (var x = Math.max(0, Math.floor(left)); x < Math.min(mask.width, left + rect.width); x += step) {
        if (pixels[(y * mask.width + x) * 4 + 3] > 80 && Math.random() > 0.08) points.push({ x: x, y: y });
      }
    }
    /* 低端浏览器或字体采样失败时，用逐字测量结果生成轮廓采样点，绝不让粒子阶段空跑。 */
    if (!points.length) {
      var fontSize = parseFloat(style.fontSize) || 48;
      var fallbackFont = [style.fontWeight, fontSize + 'px', style.fontFamily].join(' ');
      mctx.font = fallbackFont;
      var measured = mctx.measureText(titleText).width;
      var charWidth = measured / Math.max(1, Array.from(titleText).length);
      var fallbackLeft = left + Math.max(0, (rect.width - measured) / 2);
      for (var ci = 0; ci < Array.from(titleText).length; ci++) {
        var cw = charWidth;
        for (var fy = top + rect.height * 0.12; fy < top + rect.height * 0.88; fy += 3) {
          for (var fx = fallbackLeft + ci * charWidth; fx < fallbackLeft + (ci + 1) * charWidth; fx += 3) {
            if (Math.random() > 0.42) points.push({ x: fx, y: fy });
          }
        }
      }
    }
    if (points.length > 1000) {
      var stride = points.length / 1000;
      points = points.filter(function (_, i) { return i % stride < 1; });
    }
    var particles = points.map(function (p) {
      var angle = rnd(0, Math.PI * 2);
      var radius = rnd(Math.max(w, h) * 0.28, Math.max(w, h) * 0.85);
      return {
        x: w / 2 + Math.cos(angle) * radius,
        y: h / 2 + Math.sin(angle) * radius,
        sx: w / 2 + Math.cos(angle) * radius,
        sy: h / 2 + Math.sin(angle) * radius,
        tx: p.x, ty: p.y,
        size: rnd(0.65, 1.65),
        color: CYBER_COLORS[Math.floor(Math.random() * CYBER_COLORS.length)],
        delay: rnd(0, 0.28)
      };
    });

    var start = performance.now();
    var duration = 2600;
    var shieldDuration = 1150;
    var raf = 0;
    var alive = true;
    var lastFrame = 0;
    function ease(x) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3); }
    function hexPath(x, y, r) {
      ctx.beginPath();
      for (var k = 0; k < 6; k++) {
        var a = Math.PI / 3 * k - Math.PI / 6;
        var px = x + Math.cos(a) * r;
        var py = y + Math.sin(a) * r;
        if (!k) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    function frame(now) {
      if (!alive || !dimPage || dimPage.getAttribute('aria-hidden') === 'true') {
        canvas.remove();
        return;
      }
      if (now - lastFrame < 1000 / 45) { raf = requestAnimationFrame(frame); return; }
      lastFrame = now;
      var elapsed = now - start;
      var p = Math.min(1, elapsed / duration);
      ctx.clearRect(0, 0, w, h);

      /* 第一阶段：四面八方的能量粒子向文字轮廓汇聚 */
      for (var i = 0; i < particles.length; i++) {
        var q = particles[i];
        var local = ease((p - q.delay) / (1 - q.delay));
        q.x = q.sx + (q.tx - q.sx) * local;
        q.y = q.sy + (q.ty - q.sy) * local;
        var alpha = 0.25 + local * 0.75;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = q.color;
        ctx.shadowColor = q.color;
        ctx.shadowBlur = (i % 8 === 0) ? 4 + local * 5 : 0;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size * (0.7 + local * 0.5), 0, Math.PI * 2);
        ctx.fill();
        if (local < 0.82) {
          ctx.globalAlpha = alpha * 0.22;
          ctx.strokeStyle = q.color;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + (q.tx - q.sx) * 0.025, q.y + (q.ty - q.sy) * 0.025);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      /* 第二阶段：文字成形后，六边形能量屏障由内向外闭合 */
      var shield = Math.max(0, Math.min(1, (elapsed - duration) / shieldDuration));
      if (shield > 0) {
        var sx = left - 26, sy = top - 22;
        var sw = rect.width + 52, sh = rect.height + 44;
        var radius = 13;
        var cols = Math.ceil(sw / (radius * 1.5)) + 2;
        var rows = Math.ceil(sh / (radius * 1.72)) + 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx - 8, sy - 8, sw + 16, sh + 16);
        ctx.clip();
        for (var row = -1; row < rows; row++) {
          for (var col = -1; col < cols; col++) {
            var hx = sx + col * radius * 1.5 + (row % 2) * radius * 0.75;
            var hy = sy + row * radius * 1.72;
            var dist = Math.hypot(hx - (left + rect.width / 2), hy - (top + rect.height / 2));
            var reveal = shield * Math.max(sw, sh) * 0.78;
            if (dist > reveal) continue;
            var fade = Math.max(0.08, 1 - Math.max(0, dist - reveal + 40) / 70);
            hexPath(hx, hy, radius * 0.52);
            ctx.strokeStyle = row % 2 ? 'rgba(34,211,238,' + (0.12 * fade) + ')' : 'rgba(192,132,252,' + (0.16 * fade) + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
        ctx.restore();

        var pulse = 0.5 + Math.sin(elapsed * 0.018) * 0.5;
        ctx.strokeStyle = 'rgba(34,211,238,' + (0.35 * (1 - shield * 0.45)) + ')';
        ctx.lineWidth = 1.4;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 16;
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.shadowBlur = 0;
        var scanY = sy + ((elapsed - duration) % 420) / 420 * sh;
        ctx.fillStyle = 'rgba(103,232,249,' + (0.16 + pulse * 0.12) + ')';
        ctx.fillRect(sx, scanY, sw, 1.5);
      }

      if (elapsed < duration + shieldDuration) {
        raf = requestAnimationFrame(frame);
      } else {
        title.classList.remove('dv-title-building');
        canvas.style.transition = 'opacity .35s ease';
        canvas.style.opacity = '0';
        window.setTimeout(function () {
          canvas.remove();
          if (onComplete) onComplete();
        }, 380);
      }
    }
    raf = requestAnimationFrame(frame);
    return function () { alive = false; cancelAnimationFrame(raf); canvas.remove(); };
  }

  function prepareTitleCharacters(title) {
    if (!title || title.dataset.charactersReady === 'true') return;
    var text = title.textContent || '';
    title.textContent = '';
    Array.from(text).forEach(function (character, index) {
      var span = document.createElement('span');
      span.className = 'dv-title-char';
      span.textContent = character;
      span.setAttribute('data-char', character);
      span.setAttribute('aria-hidden', 'true');
      span.style.setProperty('--dv-char-delay', (-rnd(0, 8)).toFixed(2) + 's');
      span.style.setProperty('--dv-char-duration', rnd(5.5, 10.5).toFixed(2) + 's');
      span.style.setProperty('--dv-char-cyan-delay', (-rnd(0, 10)).toFixed(2) + 's');
      span.style.setProperty('--dv-char-cyan-duration', rnd(4.5, 9).toFixed(2) + 's');
      span.style.setProperty('--dv-char-pink-delay', (-rnd(0, 12)).toFixed(2) + 's');
      span.style.setProperty('--dv-char-pink-duration', rnd(5, 11).toFixed(2) + 's');
      span.style.setProperty('--dv-rise-x', rnd(-90, 90).toFixed(0) + 'px');
      span.style.setProperty('--dv-rise-rot', rnd(-35, 35).toFixed(0) + 'deg');
      span.style.setProperty('--dv-rise-delay', rnd(0, 0.18).toFixed(2) + 's');
      title.appendChild(span);
    });
    title.dataset.charactersReady = 'true';
  }

  /* ---------- 本页 Canvas 游戏层：不依赖外部 iframe/WASM 握手 ---------- */
  var gameCanvas = null;
  var gameCtx = null;
  var gameRaf = 0;
  var gameState = null;
  var gameKeys = Object.create(null);
  var tutorialPanel = null;
  var scorePanel = null;

  function buildTutorialPanel(stage) {
    if (!tutorialPanel) {
      tutorialPanel = el('aside', 'dv-game-tutorial');
      tutorialPanel.innerHTML = '<strong>次元探索指南 <span>/ CONTROLS</span></strong>' +
        '<p><b>W A S D</b> / 方向键：移动团子</p>' +
        '<p>第一关：60 秒内吞食超过 20 枚随机能量晶体</p>' +
        '<p>收集完成后，从问号方块下方向上撞击</p>';
      dimPage.appendChild(tutorialPanel);
    }
    var paragraphs = tutorialPanel.querySelectorAll('p');
    if (stage === 'block') {
      if (paragraphs[1]) paragraphs[1].textContent = '挑战完成！站到问号方块的正下方';
      if (paragraphs[2]) paragraphs[2].textContent = '按 W / ↑ 向上跳起，撞击方块开启第二关';
    } else if (stage === 'maze') {
      if (paragraphs[1]) paragraphs[1].textContent = '第二关：穿过随机生成的迷宫';
      if (paragraphs[2]) paragraphs[2].textContent = '躲避两名幽灵守卫，抵达漩涡出口';
    }
    requestAnimationFrame(function () { if (tutorialPanel) tutorialPanel.classList.add('is-visible'); });
  }

  function resizeGame() {
    if (!gameCanvas || !gameCtx) return;
    var oldW = gameCanvas.clientWidth || window.innerWidth;
    var oldH = gameCanvas.clientHeight || window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    gameCanvas.width = Math.max(1, Math.round(oldW * dpr));
    gameCanvas.height = Math.max(1, Math.round(oldH * dpr));
    gameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gameState) {
      var sx = oldW / gameState.width, sy = oldH / gameState.height;
      gameState.x *= sx; gameState.y *= sy; gameState.floorY = oldH * 0.61;
      gameState.crystals.forEach(function (c) { c.x *= sx; c.y *= sy; });
      gameState.width = oldW; gameState.height = oldH;
    }
  }

  var gameFrame = null;

  function restoreDimverseWelcome() {
    if (gameFrame) { gameFrame.remove(); gameFrame = null; }
    if (tutorialPanel) { tutorialPanel.remove(); tutorialPanel = null; }
    if (scorePanel) { scorePanel.remove(); scorePanel = null; }
    gameCanvas = null; gameCtx = null; gameState = null; gameRaf = 0;
    if (!dimPage) return;
    var center = dimPage.querySelector('.dv-center');
    if (!center) return;
    center.innerHTML = '';
    var title = el('h1', 'dv-title', '欢迎来到次元宇宙');
    title.setAttribute('data-text', '欢迎来到次元宇宙');
    title.setAttribute('aria-label', '欢迎来到次元宇宙');
    prepareTitleCharacters(title);
    center.appendChild(title);
    dimStartBtn = el('button', 'dv-start-btn is-ready', '再次开启');
    dimStartBtn.type = 'button';
    dimStartBtn.addEventListener('click', function () {
      if (dimStartBtn.disabled) return;
      dimStartBtn.disabled = true;
      dimStartBtn.classList.remove('is-ready');
      dimStartBtn.classList.add('is-exiting');
      title.classList.add('dv-title-dissolving');
      window.setTimeout(function () { if (dimStartBtn && dimStartBtn.isConnected) dimStartBtn.remove(); }, 260);
      startDimverseGame();
    });
    center.appendChild(dimStartBtn);
  }

  function onGodotMessage(event) {
    if (!gameFrame || event.source !== gameFrame.contentWindow) return;
    if (event.data === 'hm-godot-ready') {
      gameFrame.style.opacity = '1';
      return;
    }
    if (event.data === 'hm-godot-landed') {
      buildTutorialPanel('crystals');
      return;
    }
    if (event.data === 'hm-godot-block') {
      buildTutorialPanel('block');
      return;
    }
    if (event.data === 'hm-godot-maze') {
      buildTutorialPanel('maze');
      return;
    }
    if (event.data === 'hm-godot-welcome') restoreDimverseWelcome();
  }

  function ensureGodotOverlay() {
    if (gameFrame) return;
    gameFrame = el('iframe', 'dv-godot-overlay dv-godot-game');
    gameFrame.title = '次元空间双阶段挑战';
    gameFrame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    gameFrame.setAttribute('loading', 'eager');
    gameFrame.style.opacity = '0';
    gameFrame.addEventListener('load', function () {
      try {
        var doc = gameFrame.contentDocument;
        if (doc) {
          doc.documentElement.style.background = 'transparent';
          doc.documentElement.style.backgroundColor = 'transparent';
          if (doc.body) {
            doc.body.style.background = 'transparent';
            doc.body.style.backgroundColor = 'transparent';
            doc.body.style.margin = '0';
            doc.body.style.overflow = 'hidden';
          }
          var canvas = doc.querySelector('canvas');
          if (canvas) { canvas.style.background = 'transparent'; canvas.style.backgroundColor = 'transparent'; }
        }
      } catch (e) { console.warn('[Dimverse] transparent Godot shell setup skipped:', e); }
    });
    gameFrame.src = new URL('./dimverse/game/index.html', document.baseURI).href + '?embed=1';
    dimPage.appendChild(gameFrame);
  }

  function startDimverseGame() {
    ensureGodotOverlay();
  }

  function onGameKeyDown(event) {
    if (!gameState || gameState.phase !== 'playing' || !dimPage || dimPage.getAttribute('aria-hidden') === 'true') return;
    var key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].indexOf(key) >= 0) {
      event.preventDefault(); gameKeys[key] = true;
    }
  }

  function onGameKeyUp(event) { delete gameKeys[event.key.toLowerCase()]; }

  function setGamePointerTarget(event) {
    if (!gameState || gameState.phase !== 'playing' || !gameCanvas) return;
    var rect = gameCanvas.getBoundingClientRect();
    gameState.pointerTarget = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawGameDango(ctx, s, now, airHeight) {
    var shadowScale = Math.max(0.45, 1 - airHeight / Math.max(1, s.height));
    ctx.save();
    ctx.globalAlpha = Math.max(0.07, 0.25 - airHeight / s.height * 0.16);
    ctx.fillStyle = '#020611';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 48, 48 * shadowScale, 12 * shadowScale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    var speed = Math.min(1, Math.hypot(s.vx, s.vy) / 340);
    var breathe = s.phase === 'playing' ? Math.sin(now * 0.0032) * 0.014 : 0;
    ctx.save();
    ctx.translate(s.x, s.y + Math.sin(now * 0.004) * (s.phase === 'playing' ? 1.5 : 0));
    ctx.rotate(s.tilt);
    ctx.scale(1 + s.squash, 1 - s.squash * 0.7 + breathe);
    var wobble = Math.sin(now * 0.004 + s.x * 0.012) * (1.2 + speed * 2.4);
    traceDangoSlime(ctx, wobble);
    ctx.shadowColor = 'rgba(15,48,70,.2)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 7;
    var body = ctx.createRadialGradient(-24, -39, 5, 2, -3, 94);
    body.addColorStop(0, '#effaff'); body.addColorStop(0.42, '#d7edf7');
    body.addColorStop(0.78, '#bdddeb'); body.addColorStop(1, '#9fbed0');
    ctx.fillStyle = body; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.save(); traceDangoSlime(ctx, wobble); ctx.clip();
    var softLight = ctx.createRadialGradient(-31, -39, 1, -22, -26, 61);
    softLight.addColorStop(0, 'rgba(255,255,255,.44)');
    softLight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = softLight; ctx.fillRect(-74, -64, 148, 122);
    var underside = ctx.createLinearGradient(0, 8, 0, 52);
    underside.addColorStop(0, 'rgba(88,129,152,0)');
    underside.addColorStop(1, 'rgba(88,129,152,.18)');
    ctx.fillStyle = underside; ctx.fillRect(-72, 0, 144, 56);
    ctx.restore();
    ctx.save(); traceDangoSlime(ctx, wobble);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(100,132,151,.72)'; ctx.lineWidth = 4.2; ctx.stroke();
    ctx.translate(0, -0.7); ctx.strokeStyle = 'rgba(240,250,255,.42)'; ctx.lineWidth = 1.25; ctx.stroke();
    ctx.restore();
    var lookX = Math.max(-2, Math.min(2, s.vx / 150));
    var lookY = Math.max(-1.5, Math.min(1.5, s.vy / 240));
    var blinking = now < s.blinkUntil;
    ctx.strokeStyle = '#24313b'; ctx.fillStyle = '#24313b'; ctx.lineWidth = 3.7; ctx.lineCap = 'round';
    [-17, 14].forEach(function (eyeX, i) {
      if (blinking) {
        ctx.beginPath(); ctx.moveTo(eyeX - 4, -27); ctx.quadraticCurveTo(eyeX, -23, eyeX + 4, -27); ctx.stroke();
      } else {
        var offset = i ? 2 : -2;
        ctx.beginPath(); ctx.moveTo(eyeX + lookX, -38 + lookY);
        ctx.quadraticCurveTo(eyeX + offset + lookX, -32 + lookY, eyeX + 3 + lookX, -25 + lookY); ctx.stroke();
      }
    });
    var blush = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
    blush.addColorStop(0, 'rgba(244,151,173,.45)'); blush.addColorStop(1, 'rgba(244,151,173,0)');
    ctx.fillStyle = blush;
    ctx.beginPath(); ctx.ellipse(-34, -9, 10, 7, 0, 0, Math.PI * 2); ctx.ellipse(34, -9, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(70,105,126,.68)'; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.arc(0, -2, 4, 0.2, Math.PI - 0.2); ctx.stroke();
    if (speed > 0.12) {
      ctx.strokeStyle = 'rgba(100,132,151,.48)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 3, 4, 0.15, Math.PI - 0.15); ctx.stroke();
    }
    ctx.restore();
  }

  function traceDangoSlime(ctx, wobble) {
    ctx.beginPath();
    ctx.moveTo(-62, 39);
    ctx.bezierCurveTo(-69, 33, -68, 15, -65, -2);
    ctx.bezierCurveTo(-62, -27, -48, -48, -29, -53 - wobble * 0.35);
    ctx.bezierCurveTo(-12, -59 - wobble, 11, -59 + wobble * 0.3, 29, -51);
    ctx.bezierCurveTo(50, -43, 64, -23, 67, -1);
    ctx.bezierCurveTo(70, 15, 69, 32, 62, 40);
    ctx.bezierCurveTo(53, 49, 29, 48 + wobble * 0.15, 10, 48);
    ctx.bezierCurveTo(-14, 50, -48, 50 - wobble * 0.12, -62, 39);
    ctx.closePath();
  }

  function drawGameCrystal(ctx, crystal, now) {
    if (crystal.got) return;
    var pulse = 1 + Math.sin(now * 0.004 + crystal.x) * 0.12;
    ctx.save(); ctx.translate(crystal.x, crystal.y); ctx.rotate(now * 0.0007);
    ctx.shadowColor = '#51eaff'; ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(34,211,238,.2)'; ctx.beginPath(); ctx.arc(0, 0, 16 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#67eaff'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function gameFrame(now) {
    gameRaf = 0;
    if (!gameCtx || !gameState || !dimPage || dimPage.getAttribute('aria-hidden') === 'true') return;
    var s = gameState, dt = s.lastTime ? Math.min((now - s.lastTime) / 1000, 0.04) : 1 / 60;
    s.lastTime = now;
    if (s.phase === 'fall') {
      var p = Math.min(1, (now - s.phaseAt) / 1250);
      var ease = p < 1 ? 1 - Math.pow(1 - p, 3) : 1;
      s.y = -72 + (s.floorY - 54 + 72) * ease;
      s.vy = (s.floorY - 54 + 72) * 3 * Math.pow(1 - p, 2) / 1.25;
      s.squash = Math.max(0, Math.min(0.12, s.vy / 1100 * 0.12));
      if (p >= 1) {
        s.phase = 'playing'; s.y = s.floorY - 54; s.vy = 0;
        s.squash = 0.32; s.squashV = 0; buildTutorialPanel();
      }
    } else {
      var dx = (gameKeys.d || gameKeys.arrowright ? 1 : 0) - (gameKeys.a || gameKeys.arrowleft ? 1 : 0);
      var dy = (gameKeys.s || gameKeys.arrowdown ? 1 : 0) - (gameKeys.w || gameKeys.arrowup ? 1 : 0);
      if (!dx && !dy && s.pointerTarget) {
        dx = s.pointerTarget.x - s.x; dy = s.pointerTarget.y - s.y;
        if (Math.hypot(dx, dy) < 18) { s.pointerTarget = null; dx = dy = 0; }
      }
      var mag = Math.hypot(dx, dy) || 1; dx /= mag; dy /= mag;
      var targetVx = dx * 285, targetVy = dy * 230, accel = (dx || dy) ? 1500 : 1900;
      s.vx += Math.max(-accel * dt, Math.min(accel * dt, targetVx - s.vx));
      s.vy += Math.max(-accel * dt, Math.min(accel * dt, targetVy - s.vy));
      s.x = Math.max(76, Math.min(s.width - 76, s.x + s.vx * dt));
      s.y = Math.max(145, Math.min(s.height - 80, s.y + s.vy * dt));
      var tiltTarget = Math.max(-0.11, Math.min(0.11, s.vx / 285 * 0.11));
      s.tilt += (tiltTarget - s.tilt) * (1 - Math.exp(-9 * dt));
      var squashTarget = Math.hypot(s.vx, s.vy) > 20 ? 0.045 : 0;
      s.squashV += (squashTarget - s.squash) * 68 * dt;
      s.squashV *= Math.exp(-10.5 * dt); s.squash += s.squashV * dt;
      if (now > s.nextBlink) { s.blinkUntil = now + 150; s.nextBlink = now + 2200 + Math.random() * 1700; }
      s.crystals.forEach(function (crystal) {
        if (!crystal.got && Math.hypot(s.x - crystal.x, s.y - crystal.y) < 70) {
          crystal.got = true; s.score += 1;
          if (scorePanel) scorePanel.textContent = '能量晶体　' + String(s.score).padStart(2, '0') + ' / 04';
        }
      });
    }
    var ctx = gameCtx;
    ctx.clearRect(0, 0, s.width, s.height);
    s.crystals.forEach(function (crystal) { drawGameCrystal(ctx, crystal, now); });
    drawGameDango(ctx, s, now, Math.max(0, s.floorY - 54 - s.y));
    gameRaf = requestAnimationFrame(gameFrame);
  }

  function showDimPage() {
    if (!dimPage) buildDimPage();
    dimPage.style.display = 'flex';
    if (vortexAnim) { vortexAnim.stop(); vortexAnim = null; }
    if (!dimVortexAnim && dimVortexCanvas) dimVortexAnim = makeVortex(dimVortexCanvas, 64);
    requestAnimationFrame(function () {
      dimPage.classList.add('is-visible');
      dimPage.setAttribute('aria-hidden', 'false');
      if (!dimRaf) animateSymbols();
      if (gameState && !gameRaf) gameRaf = requestAnimationFrame(gameFrame);
      /* 正确顺序：进入页面先由粒子汇聚成标题并形成赛博屏障，完成后才显示「开启」。 */
      if (!dimTitleIntroStarted) {
        dimTitleIntroStarted = true;
        var title = dimPage.querySelector('.dv-title');
        var completed = false;
        function finishTitleIntro() {
          if (completed) return;
          completed = true;
          if (title) title.classList.remove('dv-title-building');
          var particleCanvas = dimPage.querySelector('.dv-title-particles');
          if (particleCanvas) particleCanvas.remove();
          if (dimStartBtn && dimStartBtn.isConnected) {
            dimStartBtn.disabled = false;
            dimStartBtn.classList.remove('is-pending');
            dimStartBtn.classList.add('is-ready');
          }
        }
        /* 无论 Canvas/字体采样/浏览器动画是否异常，都不能让欢迎页永久黑屏。 */
        try {
          startTitleParticleIntro(dimPage.querySelector('.dv-center'), title, finishTitleIntro);
        } catch (introError) {
          console.error('[Dimverse] title particle intro failed:', introError);
          finishTitleIntro();
        }
        window.setTimeout(finishTitleIntro, 5200);
      }
    });
  }

  function hideDimPage() {
    if (!dimPage) return;
    /* Stop the embedded WebAssembly game when leaving this route. */
    if (gameFrame) restoreDimverseWelcome();
    if (dimVortexAnim) { dimVortexAnim.stop(); dimVortexAnim = null; }
    if (!vortexAnim && vortexCanvas) vortexAnim = makeVortex(vortexCanvas, 72);
    dimPage.classList.remove('is-visible');
    dimPage.setAttribute('aria-hidden', 'true');
    gameKeys = Object.create(null);
    setTimeout(function () { if (dimPage) dimPage.style.display = 'none'; }, 350);
  }

  /* ---------- 专属网址路由 ---------- */
  /* 仅增删 view 参数，保留 hm_v 等其他查询参数及 hash。 */
  function isDimverseRoute() {
    try {
      return new URL(window.location.href).searchParams.get('view') === 'dimverse';
    } catch (e) {
      return false;
    }
  }

  function updateDimverseRoute(active, replace) {
    try {
      var url = new URL(window.location.href);
      if (active) url.searchParams.set('view', 'dimverse');
      else url.searchParams.delete('view');

      var next = url.pathname + url.search + url.hash;
      var current = window.location.pathname + window.location.search + window.location.hash;
      if (next === current) return;

      var state = Object.assign({}, window.history.state || {}, { hmDimverse: !!active });
      if (replace) window.history.replaceState(state, '', next);
      else window.history.pushState(state, '', next);
    } catch (e) {
      /* 地址栏更新失败时不阻断页面本身的进入/退出。 */
      console.warn('[Dimverse] URL route update failed:', e);
    }
  }

  /* 次元宇宙沿用绘梦主页面的 DOM 与背景；游戏绘制在同页透明 Canvas 上。 */
  function syncDimverseFromLocation() {
    if (isDimverseRoute()) {
      if (!dimPage) buildDimPage();
      document.body.classList.add('dv-open');
      showDimPage();
      return;
    }
    hideDimPage();
    document.body.classList.remove('dv-open');
  }

  /* ---------- 进入 / 离开 ---------- */
  function enterDimverse() {
    if (transitioning) return;
    runVortexTransition(vortexBtn, function () {
      updateDimverseRoute(true, false);
      document.body.classList.add('dv-open');
      showDimPage();
    });
  }

  function leaveDimverse() {
    /* 独立 /dimverse/ 入口通过同源 iframe 展示主应用；离开时回到站点根路径。 */
    if (window.top !== window.self) {
      window.top.location.href = new URL('../', window.location.href).href;
      return;
    }
    if (transitioning) return;
    runVortexTransition(dimVortexBtn, function () {
      updateDimverseRoute(false, false);
      hideDimPage();
      document.body.classList.remove('dv-open');
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    buildVortexButton();
    window.addEventListener('message', onGodotMessage);
    window.addEventListener('keydown', onGameKeyDown);
    window.addEventListener('keyup', onGameKeyUp);
    window.addEventListener('blur', function () { gameKeys = Object.create(null); });
    window.addEventListener('resize', resizeGame);
    /* 支持直接打开 / 刷新 ?view=dimverse 的专属页面。 */
    if (isDimverseRoute()) syncDimverseFromLocation();
    window.addEventListener('popstate', syncDimverseFromLocation);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HMDimverse = { enter: enterDimverse, leave: leaveDimverse };
})();

