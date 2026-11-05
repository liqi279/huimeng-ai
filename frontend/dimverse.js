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

    function frame() {
      if (!alive) return;
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

  function buildDimPage() {
    if (dimPage) return;
    dimPage = el('div', 'dv-page');
    dimPage.setAttribute('aria-hidden', 'true');

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
    center.innerHTML = '<h1 class="dv-title">欢迎来到次元宇宙</h1>'
      + '<p class="dv-sub">页面正开发中<span class="dv-dots">......</span>敬请期待</p>'
      + '<div class="dv-meta">'
      + '<span>2D 横版</span><i></i><span>2.5D</span><i></i><span>3D · 多元视角</span>'
      + '</div>';
    dimPage.appendChild(center);

    document.body.appendChild(dimPage);
    dimVortexAnim = makeVortex(dimVortexCanvas, 64);
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
      s.style.left = state.x + '%';
      s.style.top = state.y + '%';
      s.style.fontSize = state.size + 'px';
      s.style.color = state.color;
      s.style.opacity = state.opacity;
      s.style.textShadow = '0 0 12px ' + state.color;
      layer.appendChild(s);
      dimSymbols.push(state);
    }
  }

  function animateSymbols() {
    if (!dimPage || dimPage.getAttribute('aria-hidden') === 'true') {
      dimRaf = 0;
      return;
    }
    for (var i = 0; i < dimSymbols.length; i++) {
      var s = dimSymbols[i];
      s.x += s.vx; s.y += s.vy; s.rot += s.vr;
      if (s.x < -5) s.x = 105; if (s.x > 105) s.x = -5;
      if (s.y < -5) s.y = 105; if (s.y > 105) s.y = -5;
      s.el.style.left = s.x + '%';
      s.el.style.top = s.y + '%';
      s.el.style.transform = 'rotate(' + s.rot + 'deg)';
    }
    dimRaf = requestAnimationFrame(animateSymbols);
  }

  function showDimPage() {
    if (!dimPage) buildDimPage();
    dimPage.style.display = 'flex';
    requestAnimationFrame(function () {
      dimPage.classList.add('is-visible');
      dimPage.setAttribute('aria-hidden', 'false');
      if (!dimRaf) animateSymbols();
    });
  }

  function hideDimPage() {
    if (!dimPage) return;
    dimPage.classList.remove('is-visible');
    dimPage.setAttribute('aria-hidden', 'true');
    setTimeout(function () { if (dimPage) dimPage.style.display = 'none'; }, 350);
  }

  /* ---------- 进入 / 离开 ---------- */
  function enterDimverse() {
    if (transitioning) return;
    runVortexTransition(vortexBtn, function () {
      buildDimPage();
      showDimPage();
      document.body.classList.add('dv-open');
    });
  }

  function leaveDimverse() {
    if (transitioning) return;
    runVortexTransition(dimVortexBtn, function () {
      hideDimPage();
      document.body.classList.remove('dv-open');
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    buildVortexButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HMDimverse = { enter: enterDimverse, leave: leaveDimverse };
})();
