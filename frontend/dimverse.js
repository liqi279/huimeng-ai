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
  var timerPanel = null;
  var challengeSignboard = null;
  var gameReturnTimer = 0;
  var gameReturnOverlay = null;

  function buildTutorialPanel() {
    if (!tutorialPanel) {
      tutorialPanel = el('aside', 'dv-game-tutorial');
      tutorialPanel.innerHTML = '<strong>次元探索指南 <span>/ CONTROLS</span></strong>' +
        '<p><b>W A S D</b> / 方向键：移动团子</p>' +
        '<p>靠近随机出现的能量晶体即可吞食</p>' +
        '<p>收集超过 20 个后，从下方向上撞击问号方块</p>';
      dimPage.appendChild(tutorialPanel);
      scorePanel = el('div', 'dv-game-score');
      scorePanel.innerHTML = '<span class="dv-hud-label">吞食数量</span><strong class="dv-score-value">00</strong><span class="dv-hud-unit">枚</span>';
      dimPage.appendChild(scorePanel);
      timerPanel = el('div', 'dv-game-timer');
      timerPanel.innerHTML = '<span class="dv-hud-label">能量挑战</span><strong class="dv-timer-value">01:00</strong>';
      dimPage.appendChild(timerPanel);
    }
    requestAnimationFrame(function () {
      if (tutorialPanel) tutorialPanel.classList.add('is-visible');
      if (scorePanel) scorePanel.classList.add('is-visible');
      if (timerPanel) timerPanel.classList.add('is-visible');
    });
    showChallengeSignboard();
  }

  function showChallengeSignboard() {
    if (challengeSignboard) challengeSignboard.remove();
    challengeSignboard = el('div', 'dv-challenge-signboard');
    challengeSignboard.innerHTML = '<span class="dv-signboard-kicker">DIMENSIONAL TRIAL · 01</span>' +
      '<strong>能量晶体收集挑战</strong><span class="dv-signboard-sub">在 60 秒内吞食 21 枚晶体，开启下一道次元门</span>' +
      '<b class="dv-signboard-clock">01:00</b>';
    dimPage.appendChild(challengeSignboard);
    requestAnimationFrame(function () { if (challengeSignboard) challengeSignboard.classList.add('is-dropped'); });
    window.setTimeout(function () {
      if (!gameState || gameState.phase !== 'playing') return;
      if (challengeSignboard) challengeSignboard.classList.add('is-running');
      gameState.timerStarted = true;
      gameState.timerStart = performance.now();
      gameState.lastCrystalSpawn = 0;
    }, 1050);
    window.setTimeout(function () {
      if (challengeSignboard && gameState && gameState.phase === 'playing') challengeSignboard.classList.add('is-compact');
    }, 2500);
  }

  function updateHud() {
    if (!gameState) return;
    if (scorePanel) {
      var scoreValue = scorePanel.querySelector('.dv-score-value');
      if (scoreValue) scoreValue.textContent = String(gameState.score).padStart(2, '0');
    }
    if (timerPanel) {
      var timerValue = timerPanel.querySelector('.dv-timer-value');
      if (timerValue) timerValue.textContent = formatGameTime(gameState.timeLeft);
    }
    if (challengeSignboard) {
      var signClock = challengeSignboard.querySelector('.dv-signboard-clock');
      if (signClock) signClock.textContent = formatGameTime(gameState.timeLeft);
    }
  }

  function formatGameTime(seconds) {
    var n = Math.max(0, Math.ceil(seconds));
    var minutes = Math.floor(n / 60), remainder = n % 60;
    return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
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
      if (gameState.block) { gameState.block.x *= sx; gameState.block.y *= sy; }
      gameState.width = oldW; gameState.height = oldH;
      if (gameState.phase === 'maze' || gameState.phase === 'maze_transition') generateMaze(gameState);
    }
  }

  function startDimverseGame() {
    if (gameState) return;
    gameCanvas = el('canvas', 'dv-browser-game');
    gameCanvas.setAttribute('aria-label', '使用方向键或 WASD 移动团子，吞食随机能量晶体并探索迷宫');
    dimPage.appendChild(gameCanvas);
    gameCtx = gameCanvas.getContext('2d');
    if (!gameCtx) return;
    gameCanvas.addEventListener('pointerdown', setGamePointerTarget);
    gameCanvas.addEventListener('pointermove', function (event) {
      if (event.buttons || event.pointerType === 'touch') setGamePointerTarget(event);
    });
    var w = window.innerWidth, h = window.innerHeight;
    gameState = {
      width: w, height: h, x: w * 0.5, y: -72, vx: 0, vy: 0,
      floorY: h * 0.61, phase: 'fall', phaseAt: performance.now(),
      squash: 0, squashV: 0, tilt: 0, blinkUntil: performance.now() + 500,
      nextBlink: performance.now() + 2400, score: 0,
      crystals: [], confetti: [], block: null, timerStarted: false,
      timerStart: 0, timeLeft: 60, lastCrystalSpawn: 0,
      maze: null, ghosts: [], mazeBoard: null, mazeTransitionAt: 0,
      lastTime: 0, messageUntil: 0
    };
    resizeGame();
    if (!gameRaf) gameRaf = requestAnimationFrame(gameFrame);
  }

  function onGameKeyDown(event) {
    if (!gameState || ['playing', 'block', 'maze'].indexOf(gameState.phase) < 0 ||
        !dimPage || dimPage.getAttribute('aria-hidden') === 'true') return;
    var key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' '].indexOf(key) >= 0) {
      event.preventDefault();
      gameKeys[key === ' ' ? 'space' : key] = true;
    }
  }

  function onGameKeyUp(event) { delete gameKeys[event.key.toLowerCase() === ' ' ? 'space' : event.key.toLowerCase()]; }

  function setGamePointerTarget(event) {
    if (!gameState || ['playing', 'block', 'maze'].indexOf(gameState.phase) < 0 || !gameCanvas) return;
    var rect = gameCanvas.getBoundingClientRect();
    gameState.pointerTarget = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawGameDango(ctx, s, now, airHeight, scale) {
    var bodyScale = scale || 1;
    var shadowScale = Math.max(0.45, 1 - airHeight / Math.max(1, s.height));
    ctx.save();
    ctx.globalAlpha = Math.max(0.07, 0.25 - airHeight / s.height * 0.16);
    ctx.fillStyle = '#020611';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 48 * bodyScale, 48 * shadowScale * bodyScale, 12 * shadowScale * bodyScale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    var speed = Math.min(1, Math.hypot(s.vx, s.vy) / 340);
    var breathe = s.phase === 'playing' || s.phase === 'block' ? Math.sin(now * 0.0032) * 0.014 : 0;
    ctx.save();
    ctx.translate(s.x, s.y + Math.sin(now * 0.004) * (s.phase === 'playing' ? 1.5 : 0));
    ctx.rotate(s.tilt);
    ctx.scale((1 + s.squash) * bodyScale, (1 - s.squash * 0.7 + breathe) * bodyScale);
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
    var pulse = 1 + Math.sin(now * 0.004 + crystal.seed) * 0.14;
    ctx.save(); ctx.translate(crystal.x, crystal.y); ctx.rotate(now * 0.0007 + crystal.seed);
    ctx.shadowColor = '#51eaff'; ctx.shadowBlur = 20;
    var glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 25 * pulse);
    glow.addColorStop(0, 'rgba(103,234,255,.42)'); glow.addColorStop(1, 'rgba(103,234,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 25 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#67eaff'; ctx.beginPath(); ctx.moveTo(0, -12 * pulse); ctx.lineTo(9 * pulse, 0); ctx.lineTo(0, 12 * pulse); ctx.lineTo(-9 * pulse, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  function spawnRandomCrystal(s) {
    var margin = 38;
    var x = rnd(margin, Math.max(margin + 1, s.width - margin));
    var y = rnd(92, Math.max(100, s.height - 42));
    for (var tries = 0; tries < 8 && Math.hypot(x - s.x, y - s.y) < 110; tries++) {
      x = rnd(margin, Math.max(margin + 1, s.width - margin));
      y = rnd(92, Math.max(100, s.height - 42));
    }
    s.crystals.push({ x: x, y: y, seed: rnd(0, 1000), born: performance.now(), life: rnd(7.5, 12.5) });
    if (s.crystals.length > 18) s.crystals.shift();
  }

  function beginCelebration(s, now) {
    if (s.phase !== 'playing') return;
    s.phase = 'celebrating';
    s.celebrationUntil = now + 3100;
    s.confetti = [];
    for (var i = 0; i < 150; i++) {
      s.confetti.push({
        x: rnd(0, s.width), y: rnd(-s.height * 0.7, 0),
        vx: rnd(-150, 150), vy: rnd(80, 360), rot: rnd(0, Math.PI * 2),
        vr: rnd(-5, 5), size: rnd(3, 8),
        color: ['#67eaff', '#f5a4ff', '#ffe58a', '#8cffc1', '#ffffff'][i % 5]
      });
    }
    if (challengeSignboard) challengeSignboard.classList.add('is-celebrating');
    if (tutorialPanel) {
      var p = tutorialPanel.querySelector('p:last-child');
      if (p) p.innerHTML = '太棒了！从问号方块的正下方，向上移动撞击它';
    }
    s.block = null;
  }

  function drawCelebration(ctx, s, now) {
    s.confetti.forEach(function (p) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 9;
      ctx.fillRect(-p.size * 0.5, -p.size * 0.3, p.size, p.size * 0.62);
      ctx.restore();
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.shadowColor = '#e879f9'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#fff3ff';
    ctx.fillText('21+  能量收集完成！', s.width * 0.5, Math.max(120, s.height * 0.22));
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#9defff';
    ctx.fillText('太棒啦！下一道次元门已经解锁', s.width * 0.5, Math.max(146, s.height * 0.22 + 27));
    ctx.restore();
  }

  function drawQuestionBlock(ctx, block, now) {
    var size = block.size;
    var pulse = 1 + Math.sin(now * 0.006) * 0.035;
    ctx.save(); ctx.translate(block.x, block.y); ctx.scale(pulse, pulse);
    ctx.shadowColor = '#ffbf55'; ctx.shadowBlur = 28;
    ctx.fillStyle = '#8b4b14'; ctx.fillRect(-size / 2 - 4, -size / 2 - 4, size + 8, size + 8);
    var grad = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#fff1a6'); grad.addColorStop(0.42, '#ffc34e'); grad.addColorStop(1, '#d8791f');
    ctx.fillStyle = grad; ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = '#fff0a3'; ctx.lineWidth = 3; ctx.strokeRect(-size / 2 + 4, -size / 2 + 4, size - 8, size - 8);
    ctx.fillStyle = '#9a4b15'; ctx.font = '900 47px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,255,255,.65)'; ctx.shadowBlur = 5; ctx.fillText('?', 0, 1);
    ctx.restore();
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = '#fff0bd'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 12;
    ctx.fillText('从下方撞击方块', block.x, block.y + size * 0.86);
    ctx.restore();
  }

  function burstQuestionBlock(s, now) {
    var b = s.block;
    s.blockParticles = [];
    for (var i = 0; i < 180; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = rnd(90, 520);
      s.blockParticles.push({
        x: b.x + rnd(-b.size * 0.42, b.size * 0.42),
        y: b.y + rnd(-b.size * 0.42, b.size * 0.42),
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        size: rnd(1.5, 5), life: rnd(0.55, 1.25), age: 0,
        color: ['#fff0a6', '#ffc34e', '#67eaff', '#d7a7ff'][i % 4]
      });
    }
    s.phase = 'maze_transition';
    s.mazeTransitionAt = now;
    generateMaze(s);
    if (tutorialPanel) {
      var p = tutorialPanel.querySelector('p:last-child');
      if (p) p.innerHTML = '第二关：穿过迷宫，避开两名幽灵守卫，抵达漩涡出口';
    }
  }

  function generateMaze(s) {
    var cols = Math.floor((s.width - 40) / 28);
    var rows = Math.floor((s.height - 150) / 28);
    cols = Math.max(11, Math.min(31, cols)); rows = Math.max(11, Math.min(21, rows));
    if (cols % 2 === 0) cols--; if (rows % 2 === 0) rows--;
    var grid = [];
    for (var y = 0; y < rows; y++) {
      var line = [];
      for (var x = 0; x < cols; x++) line.push(1);
      grid.push(line);
    }
    var stack = [{ x: 1, y: 1 }];
    grid[1][1] = 0;
    while (stack.length) {
      var current = stack[stack.length - 1];
      var dirs = [{ x: 0, y: -2 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 }];
      for (var di = dirs.length - 1; di > 0; di--) {
        var swap = Math.floor(Math.random() * (di + 1));
        var temp = dirs[di]; dirs[di] = dirs[swap]; dirs[swap] = temp;
      }
      var next = null;
      for (var d = 0; d < dirs.length; d++) {
        var nx = current.x + dirs[d].x, ny = current.y + dirs[d].y;
        if (nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && grid[ny][nx] === 1) {
          next = { x: nx, y: ny }; break;
        }
      }
      if (next) {
        grid[current.y + (next.y - current.y) / 2][current.x + (next.x - current.x) / 2] = 0;
        grid[next.y][next.x] = 0; stack.push(next);
      } else stack.pop();
    }
    grid[rows - 2][cols - 2] = 0;
    var cell = Math.min((s.width - 34) / cols, (s.height - 142) / rows);
    var boardW = cell * cols, boardH = cell * rows;
    var board = { x: (s.width - boardW) / 2, y: Math.max(78, (s.height - boardH) / 2 + 32), cell: cell, width: boardW, height: boardH };
    s.maze = grid; s.mazeBoard = board;
    s.mazePlayer = { x: board.x + cell * 1.5, y: board.y + cell * 1.5 };
    s.x = s.mazePlayer.x; s.y = s.mazePlayer.y; s.vx = 0; s.vy = 0;
    s.mazeExit = { x: cols - 2, y: rows - 2 };
    s.ghosts = [
      makeMazeGhost(cols - 2, 1, '#ff76d7', '#ffb0eb', 2.0),
      makeMazeGhost(1, rows - 2, '#78eaff', '#b8f8ff', 2.35)
    ];
  }

  function makeMazeGhost(x, y, color, eye, speed) {
    return { cellX: x, cellY: y, fromX: x, fromY: y, toX: x, toY: y, progress: 1, color: color, eye: eye, speed: speed, pathAt: 0 };
  }

  function mazeCellAt(s, x, y) {
    var b = s.mazeBoard, c = b.cell;
    return { x: Math.floor((x - b.x) / c), y: Math.floor((y - b.y) / c) };
  }

  function mazeCanOccupy(s, x, y) {
    var b = s.mazeBoard, r = b.cell * 0.22;
    var tests = [[-r, -r], [r, -r], [-r, r], [r, r]];
    for (var i = 0; i < tests.length; i++) {
      var cell = mazeCellAt(s, x + tests[i][0], y + tests[i][1]);
      if (!s.maze[cell.y] || s.maze[cell.y][cell.x] !== 0) return false;
    }
    return true;
  }

  function findMazePath(grid, sx, sy, tx, ty) {
    var rows = grid.length, cols = grid[0].length;
    var queue = [{ x: sx, y: sy }], head = 0, previous = Object.create(null);
    var startKey = sx + ',' + sy; previous[startKey] = null;
    var found = false;
    while (head < queue.length) {
      var p = queue[head++], key = p.x + ',' + p.y;
      if (p.x === tx && p.y === ty) { found = true; break; }
      var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (var i = 0; i < dirs.length; i++) {
        var nx = p.x + dirs[i][0], ny = p.y + dirs[i][1], nk = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || grid[ny][nx] !== 0 || Object.prototype.hasOwnProperty.call(previous, nk)) continue;
        previous[nk] = key; queue.push({ x: nx, y: ny });
      }
    }
    if (!found) return [];
    var path = [], cursor = tx + ',' + ty;
    while (cursor) {
      var parts = cursor.split(',');
      path.push({ x: Number(parts[0]), y: Number(parts[1]) });
      cursor = previous[cursor];
    }
    return path.reverse();
  }

  function updateMazeGhosts(s, dt, now) {
    var b = s.mazeBoard;
    s.ghosts.forEach(function (g) {
      if (g.progress >= 1) {
        g.cellX = g.toX; g.cellY = g.toY;
        if (now >= g.pathAt) {
          var playerCell = mazeCellAt(s, s.mazePlayer.x, s.mazePlayer.y);
          var path = findMazePath(s.maze, g.cellX, g.cellY, playerCell.x, playerCell.y);
          if (path.length > 1) {
            g.fromX = g.cellX; g.fromY = g.cellY;
            g.toX = path[1].x; g.toY = path[1].y; g.progress = 0;
          }
          g.pathAt = now + 160;
        }
      }
      if (g.progress < 1) g.progress = Math.min(1, g.progress + dt * g.speed);
      var gx = g.fromX + (g.toX - g.fromX) * g.progress;
      var gy = g.fromY + (g.toY - g.fromY) * g.progress;
      g.x = b.x + (gx + 0.5) * b.cell;
      g.y = b.y + (gy + 0.5) * b.cell;
    });
  }

  function drawMaze(ctx, s, now, reveal) {
    var b = s.mazeBoard, grid = s.maze, cell = b.cell;
    ctx.save();
    ctx.shadowColor = 'rgba(34,211,238,.3)'; ctx.shadowBlur = 28;
    ctx.fillStyle = 'rgba(3,8,24,.78)';
    roundRect(ctx, b.x - 10, b.y - 10, b.width + 20, b.height + 20, 16);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = reveal;
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[y].length; x++) {
        var px = b.x + x * cell, py = b.y + y * cell;
        if (grid[y][x] === 1) {
          var wall = ctx.createLinearGradient(px, py, px + cell, py + cell);
          wall.addColorStop(0, 'rgba(65,94,145,.92)'); wall.addColorStop(1, 'rgba(25,38,77,.96)');
          ctx.fillStyle = wall; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          ctx.strokeStyle = 'rgba(110,225,255,.22)'; ctx.lineWidth = 0.8; ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
        } else {
          ctx.fillStyle = 'rgba(9,18,42,.58)'; ctx.fillRect(px, py, cell, cell);
        }
      }
    }
    ctx.strokeStyle = 'rgba(103,232,249,.42)'; ctx.lineWidth = 1.2; ctx.strokeRect(b.x, b.y, b.width, b.height);
    ctx.restore();
    var ex = b.x + (s.mazeExit.x + 0.5) * cell, ey = b.y + (s.mazeExit.y + 0.5) * cell;
    drawMazeVortex(ctx, ex, ey, cell * 0.38, now);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawMazeVortex(ctx, x, y, r, now) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 0.0015);
    ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 20;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.strokeStyle = i % 2 ? '#67eaff' : '#d78cff';
      ctx.lineWidth = Math.max(1.4, r * 0.11);
      ctx.arc(0, 0, r * (0.9 - i * 0.19), now * 0.001 * (i % 2 ? -1 : 1), now * 0.001 * (i % 2 ? -1 : 1) + Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawMazeGhost(ctx, ghost, now, cell) {
    var r = cell * 0.31, bob = Math.sin(now * 0.007 + ghost.cellX) * cell * 0.035;
    ctx.save(); ctx.translate(ghost.x, ghost.y + bob);
    ctx.shadowColor = ghost.color; ctx.shadowBlur = 18;
    ctx.fillStyle = ghost.color;
    ctx.beginPath(); ctx.arc(0, -r * 0.12, r, Math.PI, 0);
    ctx.lineTo(r, r * 0.85); ctx.lineTo(r * 0.48, r * 0.58); ctx.lineTo(0, r * 0.88);
    ctx.lineTo(-r * 0.48, r * 0.58); ctx.lineTo(-r, r * 0.85); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#17213b';
    ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.08, r * 0.13, r * 0.23, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.27, -r * 0.08, r * 0.13, r * 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-r * 0.34, -r * 0.16, r * 0.055, 0, Math.PI * 2); ctx.arc(r * 0.25, -r * 0.16, r * 0.055, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function updateFreeMovement(s, dt, speed, now) {
    var dx = (gameKeys.d || gameKeys.arrowright ? 1 : 0) - (gameKeys.a || gameKeys.arrowleft ? 1 : 0);
    var dy = (gameKeys.s || gameKeys.arrowdown ? 1 : 0) - (gameKeys.w || gameKeys.arrowup ? 1 : 0);
    if (!dx && !dy && s.pointerTarget) {
      dx = s.pointerTarget.x - s.x; dy = s.pointerTarget.y - s.y;
      if (Math.hypot(dx, dy) < 18) { s.pointerTarget = null; dx = dy = 0; }
    }
    var mag = Math.hypot(dx, dy) || 1; dx /= mag; dy /= mag;
    var targetVx = dx * speed, targetVy = dy * speed * 0.82, accel = (dx || dy) ? 1500 : 1900;
    s.vx += Math.max(-accel * dt, Math.min(accel * dt, targetVx - s.vx));
    s.vy += Math.max(-accel * dt, Math.min(accel * dt, targetVy - s.vy));
    var previousY = s.y;
    s.x = Math.max(70, Math.min(s.width - 70, s.x + s.vx * dt));
    s.y = Math.max(104, Math.min(s.height - 70, s.y + s.vy * dt));
    var tiltTarget = Math.max(-0.11, Math.min(0.11, s.vx / speed * 0.11));
    s.tilt += (tiltTarget - s.tilt) * (1 - Math.exp(-9 * dt));
    var squashTarget = Math.hypot(s.vx, s.vy) > 20 ? 0.045 : 0;
    s.squashV += (squashTarget - s.squash) * 68 * dt;
    s.squashV *= Math.exp(-10.5 * dt); s.squash += s.squashV * dt;
    if (now > s.nextBlink) { s.blinkUntil = now + 150; s.nextBlink = now + 2200 + Math.random() * 1700; }
    return previousY;
  }

  function updateMazePlayer(s, dt) {
    var dx = (gameKeys.d || gameKeys.arrowright ? 1 : 0) - (gameKeys.a || gameKeys.arrowleft ? 1 : 0);
    var dy = (gameKeys.s || gameKeys.arrowdown ? 1 : 0) - (gameKeys.w || gameKeys.arrowup ? 1 : 0);
    if (!dx && !dy && s.pointerTarget) {
      dx = s.pointerTarget.x - s.mazePlayer.x; dy = s.pointerTarget.y - s.mazePlayer.y;
      if (Math.hypot(dx, dy) < 12) { s.pointerTarget = null; dx = dy = 0; }
    }
    var mag = Math.hypot(dx, dy) || 1; dx /= mag; dy /= mag;
    var speed = s.mazeBoard.cell * 3.5;
    var nx = s.mazePlayer.x + dx * speed * dt, ny = s.mazePlayer.y + dy * speed * dt;
    if (mazeCanOccupy(s, nx, s.mazePlayer.y)) s.mazePlayer.x = nx;
    if (mazeCanOccupy(s, s.mazePlayer.x, ny)) s.mazePlayer.y = ny;
    s.x = s.mazePlayer.x; s.y = s.mazePlayer.y;
    s.vx = dx * speed; s.vy = dy * speed;
    s.tilt += (Math.max(-0.11, Math.min(0.11, dx * 0.11)) - s.tilt) * (1 - Math.exp(-10 * dt));
    s.squash += (Math.hypot(dx, dy) > 0 ? 0.035 : -s.squash) * Math.min(1, dt * 8);
  }

  function triggerGameReturn(s, success) {
    if (s.phase === 'gameover') return;
    s.phase = 'gameover';
    if (tutorialPanel) {
      var p = tutorialPanel.querySelector('p:last-child');
      if (p) p.textContent = success ? '成功穿越迷宫！' : '被幽灵守卫追上了……';
    }
    if (timerPanel) {
      var value = timerPanel.querySelector('.dv-timer-value');
      if (value) value.textContent = success ? 'CLEAR' : 'OVER';
    }
    window.clearTimeout(gameReturnTimer);
    gameReturnTimer = window.setTimeout(function () { playReturnVortex(success); }, 650);
  }

  function playReturnVortex(success) {
    if (!dimPage || dimPage.getAttribute('aria-hidden') === 'true') return;
    if (gameReturnOverlay) gameReturnOverlay.remove();
    gameReturnOverlay = el('div', 'dv-game-return-vortex');
    var canvas = el('canvas', 'dv-game-return-canvas');
    gameReturnOverlay.appendChild(canvas);
    var caption = el('strong', 'dv-game-return-caption', success ? '次元探索完成' : '次元空间 · 再会');
    gameReturnOverlay.appendChild(caption);
    dimPage.appendChild(gameReturnOverlay);
    var size = 360, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    var ctx = canvas.getContext('2d');
    if (ctx) { ctx.scale(dpr, dpr); drawReturnSpiral(ctx, size / 2, size / 2, size * 0.47); }
    requestAnimationFrame(function () { gameReturnOverlay.classList.add('is-covering'); });
    window.setTimeout(function () {
      if (gameReturnOverlay) { gameReturnOverlay.remove(); gameReturnOverlay = null; }
      resetDimverseToWelcome();
    }, 1450);
  }

  function drawReturnSpiral(ctx, cx, cy, radius) {
    ctx.save(); ctx.translate(cx, cy);
    for (var layer = 0; layer < 8; layer++) {
      ctx.beginPath();
      ctx.strokeStyle = ['#67eaff', '#a78bfa', '#f0abfc', '#8be9fd'][layer % 4];
      ctx.lineWidth = 2.5 + layer * 0.55;
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 20;
      ctx.arc(0, 0, radius * (0.96 - layer * 0.105), layer * 0.62, layer * 0.62 + Math.PI * 1.72);
      ctx.stroke();
    }
    ctx.restore();
  }

  function resetDimverseToWelcome() {
    window.clearTimeout(gameReturnTimer); gameReturnTimer = 0;
    if (gameRaf) cancelAnimationFrame(gameRaf);
    gameRaf = 0; gameState = null; gameKeys = Object.create(null);
    if (gameCanvas) { gameCanvas.remove(); gameCanvas = null; }
    gameCtx = null;
    [tutorialPanel, scorePanel, timerPanel, challengeSignboard].forEach(function (node) { if (node) node.remove(); });
    tutorialPanel = scorePanel = timerPanel = challengeSignboard = null;
    var center = dimPage && dimPage.querySelector('.dv-center');
    var title = center && center.querySelector('.dv-title');
    if (title) title.classList.remove('dv-title-dissolving', 'dv-title-building');
    if (center && dimStartBtn) {
      dimStartBtn.classList.remove('is-exiting', 'is-pending');
      dimStartBtn.classList.add('is-ready');
      dimStartBtn.disabled = false;
      if (!dimStartBtn.isConnected) center.appendChild(dimStartBtn);
    }
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
    } else if (s.phase === 'playing') {
      updateFreeMovement(s, dt, 300, now);
      if (s.timerStarted) {
        s.timeLeft = Math.max(0, 60 - (now - s.timerStart) / 1000);
        if (now - s.lastCrystalSpawn > 470 && s.crystals.length < 15) {
          spawnRandomCrystal(s); s.lastCrystalSpawn = now;
        }
        for (var ci = s.crystals.length - 1; ci >= 0; ci--) {
          var crystal = s.crystals[ci];
          if (now - crystal.born > crystal.life * 1000) { s.crystals.splice(ci, 1); continue; }
          if (Math.hypot(s.x - crystal.x, s.y - crystal.y) < 70) {
            s.crystals.splice(ci, 1); s.score += 1; updateHud();
            if (s.score > 20) { beginCelebration(s, now); break; }
          }
        }
        updateHud();
        if (s.timeLeft <= 0 && s.phase === 'playing') {
          if (challengeSignboard) challengeSignboard.classList.add('is-timeup');
          triggerGameReturn(s, false);
        }
      }
    } else if (s.phase === 'celebrating') {
      s.confetti.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.rot += p.vr * dt; });
      if (now >= s.celebrationUntil) {
        s.confetti = [];
        s.phase = 'block';
        s.block = { x: s.width * 0.5, y: Math.max(190, s.height * 0.39), size: 76, hit: false, pulse: 0 };
      }
    } else if (s.phase === 'block') {
      var previousY = updateFreeMovement(s, dt, 300, now);
      if (s.block && !s.block.hit) {
        var underside = s.block.y + s.block.size / 2 + 40;
        if (previousY > underside && s.y <= underside && s.x > s.block.x - s.block.size * 0.9 && s.x < s.block.x + s.block.size * 0.9 && s.vy < 0) {
          s.block.hit = true; burstQuestionBlock(s, now);
        }
      }
    } else if (s.phase === 'maze_transition') {
      s.blockParticles.forEach(function (p) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; });
      if (now - s.mazeTransitionAt > 900) s.phase = 'maze';
    } else if (s.phase === 'maze') {
      updateMazePlayer(s, dt);
      updateMazeGhosts(s, dt, now);
      var radius = s.mazeBoard.cell * 0.28;
      for (var gi = 0; gi < s.ghosts.length; gi++) {
        if (Math.hypot(s.mazePlayer.x - s.ghosts[gi].x, s.mazePlayer.y - s.ghosts[gi].y) < radius * 1.7) {
          triggerGameReturn(s, false); break;
        }
      }
      var exitX = s.mazeBoard.x + (s.mazeExit.x + 0.5) * s.mazeBoard.cell;
      var exitY = s.mazeBoard.y + (s.mazeExit.y + 0.5) * s.mazeBoard.cell;
      if (s.phase === 'maze' && Math.hypot(s.mazePlayer.x - exitX, s.mazePlayer.y - exitY) < s.mazeBoard.cell * 0.42) triggerGameReturn(s, true);
    }

    var ctx = gameCtx;
    ctx.clearRect(0, 0, s.width, s.height);
    if (s.phase === 'playing' || s.phase === 'fall' || s.phase === 'celebrating' || s.phase === 'block') {
      s.crystals.forEach(function (crystal) { drawGameCrystal(ctx, crystal, now); });
      if (s.phase === 'celebrating' || s.phase === 'block') drawCelebration(ctx, s, now);
      if (s.block && (s.phase === 'celebrating' || s.phase === 'block')) drawQuestionBlock(ctx, s.block, now);
      drawGameDango(ctx, s, now, Math.max(0, s.floorY - 54 - s.y));
    } else if (s.phase === 'maze_transition') {
      var reveal = Math.min(1, (now - s.mazeTransitionAt) / 850);
      drawMaze(ctx, s, now, reveal);
      s.blockParticles.forEach(function (p) {
        if (p.age >= p.life) return;
        ctx.save(); ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.fillRect(p.x, p.y, p.size, p.size); ctx.restore();
      });
      drawGameDango(ctx, s, now, 0, 0.3 + reveal * 0.08);
    } else if (s.phase === 'maze') {
      drawMaze(ctx, s, now, 1);
      s.ghosts.forEach(function (ghost) { drawMazeGhost(ctx, ghost, now, s.mazeBoard.cell); });
      drawGameDango(ctx, s, now, 0, 0.31);
      ctx.save(); ctx.textAlign = 'center'; ctx.font = '600 12px system-ui,sans-serif';
      ctx.fillStyle = 'rgba(190,226,255,.85)'; ctx.fillText('找到漩涡出口 · 避开两名幽灵守卫', s.width * 0.5, 78); ctx.restore();
    }
    if (s.phase !== 'gameover') gameRaf = requestAnimationFrame(gameFrame);
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

