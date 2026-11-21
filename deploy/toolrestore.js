/* ============================================================
 * 图片修复 HMTOOLRESTORE
 * 在【工具】模块下提供「图片修复」卡片：
 *  1. 自动分层：单图层 → 前景 / 中景 / 背景 三层
 *  2. 画笔分层：用画笔圈绘主体，手动分离图层
 *  3. 智能填充：分离后缺失像素自动补齐（邻域扩散 inpainting）
 *  4. 线稿提取：Sobel 边缘检测 → 线稿
 * 纯前端 Canvas 实现，无需后端。
 * ============================================================ */
window.HMToolRestore = (function () {
  'use strict';

  var MAX_DIM = 900; // 处理最大边长，避免卡顿

  var state = {
    mode: 'auto',        // auto | brush | inpaint | lines
    img: null,           // HTMLImageElement
    w: 0, h: 0,
    srcData: null,       // ImageData 原图
    layers: {},          // {foreground, midground, background} ImageData
    brushMask: null,     // Uint8ClampedArray 画笔蒙版
    brushColor: '#ff2d75',
    brushSize: 24,
    drawing: false,
    lastX: 0, lastY: 0
  };

  var el = {};
  var inited = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------- 工具函数 ---------- */
  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function cloneImageData(src) {
    var cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    var c = cv.getContext('2d');
    var d = c.createImageData(src.width, src.height);
    d.data.set(src.data);
    return d;
  }

  function imageDataToCanvas(id) {
    var cv = document.createElement('canvas');
    cv.width = id.width;
    cv.height = id.height;
    cv.getContext('2d').putImageData(id, 0, 0);
    return cv;
  }

  function downloadCanvas(cv, name) {
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ---------- 图片加载 ---------- */
  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        state.img = img;
        var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        state.w = Math.round(img.width * scale);
        state.h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = state.w;
        cv.height = state.h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, state.w, state.h);
        state.srcData = ctx.getImageData(0, 0, state.w, state.h);
        state.brushMask = new Uint8ClampedArray(state.w * state.h);
        state.layers = {};
        renderMain();
        toast('图片已加载：' + state.w + '×' + state.h, 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function renderMain() {
    if (!el.mainCanvas) return;
    if (!state.srcData) {
      el.mainCanvas.width = 400;
      el.mainCanvas.height = 300;
      var ctx = el.mainCanvas.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#6d7f94';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击或拖拽上传图片', 200, 155);
      return;
    }
    el.mainCanvas.width = state.w;
    el.mainCanvas.height = state.h;
    el.mainCanvas.getContext('2d').putImageData(state.srcData, 0, 0);

    // 画笔模式显示蒙版
    if (state.mode === 'brush') drawBrushOverlay();
    if (el.layerWrap) el.layerWrap.innerHTML = '';
  }

  /* ---------- 模式 1：自动分层 ---------- */
  function autoSplit() {
    if (!state.srcData) { toast('请先上传图片', 'error'); return; }
    toast('正在分层…', 'info');
    var w = state.w, h = state.h;
    var src = state.srcData.data;
    var n = w * h;

    // 1) Sobel 边缘强度
    var edge = new Float32Array(n);
    var maxE = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = (y * w + x) * 4;
        var gx = -luminance(src[i - 4 - w * 4], src[i - 3 - w * 4], src[i - 2 - w * 4])
               - 2 * luminance(src[i - 4], src[i - 3], src[i - 2])
               - luminance(src[i - 4 + w * 4], src[i - 3 + w * 4], src[i - 2 + w * 4])
               + luminance(src[i + 4 - w * 4], src[i + 3 - w * 4], src[i + 2 - w * 4])
               + 2 * luminance(src[i + 4], src[i + 3], src[i + 2])
               + luminance(src[i + 4 + w * 4], src[i + 3 + w * 4], src[i + 2 + w * 4]);
        var gy = -luminance(src[i - 4 - w * 4], src[i - 3 - w * 4], src[i - 2 - w * 4])
               - 2 * luminance(src[i - w * 4], src[i - w * 4 + 1], src[i - w * 4 + 2])
               - luminance(src[i + 4 - w * 4], src[i + 3 - w * 4], src[i + 2 - w * 4])
               + luminance(src[i - 4 + w * 4], src[i - 3 + w * 4], src[i - 2 + w * 4])
               + 2 * luminance(src[i + w * 4], src[i + w * 4 + 1], src[i + w * 4 + 2])
               + luminance(src[i + 4 + w * 4], src[i + 3 + w * 4], src[i + 2 + w * 4]);
        var e = Math.sqrt(gx * gx + gy * gy);
        edge[y * w + x] = e;
        if (e > maxE) maxE = e;
      }
    }
    // 归一化
    if (maxE > 0) for (var k = 0; k < n; k++) edge[k] /= maxE;

    // 2) 中心显著性：距中心越近越显著
    var cx = w / 2, cy = h / 2;
    var maxD = Math.sqrt(cx * cx + cy * cy);

    // 3) 综合显著性 = 边缘强度 * 0.6 + 中心权重 * 0.4
    var sal = new Float32Array(n);
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var idx = y2 * w + x2;
        var dist = Math.sqrt((x2 - cx) * (x2 - cx) + (y2 - cy) * (y2 - cy)) / maxD;
        var centerW = 1 - dist; // 中心=1, 边缘=0
        sal[idx] = edge[idx] * 0.55 + centerW * 0.45;
      }
    }

    // 4) 阈值分三层：前景 top 25%，中景 25~55%，背景其余
    var sorted = Array.from(sal).sort(function (a, b) { return a - b; });
    var tHigh = sorted[Math.floor(n * 0.72)];
    var tLow = sorted[Math.floor(n * 0.40)];

    var fg = cloneImageData(state.srcData);
    var mg = cloneImageData(state.srcData);
    var bg = cloneImageData(state.srcData);
    var fgD = fg.data, mgD = mg.data, bgD = bg.data;

    for (var p = 0; p < n; p++) {
      var s = sal[p];
      var a = p * 4;
      if (s >= tHigh) { mgD[a + 3] = 0; bgD[a + 3] = 0; }        // 前景
      else if (s >= tLow) { fgD[a + 3] = 0; bgD[a + 3] = 0; }   // 中景
      else { fgD[a + 3] = 0; mgD[a + 3] = 0; }                 // 背景
    }

    state.layers = { foreground: fg, midground: mg, background: bg };
    renderLayers();
    toast('自动分层完成', 'success');
  }

  function renderLayers() {
    if (!el.layerWrap) return;
    var items = [
      { key: 'foreground', label: '前景' },
      { key: 'midground', label: '中景' },
      { key: 'background', label: '背景' }
    ];
    var html = '';
    items.forEach(function (it) {
      var id = state.layers[it.key];
      if (!id) return;
      var cv = imageDataToCanvas(id);
      html += '<div class="hm-rs-layer">' +
        '<div class="hm-rs-layer-title">' + it.label + '</div>' +
        '<img src="' + cv.toDataURL('image/png') + '" alt="' + it.label + '">' +
        '<button class="hm-pill" data-dl="' + it.key + '">下载 PNG</button>' +
        '</div>';
    });
    el.layerWrap.innerHTML = html;
  }

  /* ---------- 模式 2：画笔分层 ---------- */
  function drawBrushOverlay() {
    if (!state.brushMask || !el.mainCanvas) return;
    var ctx = el.mainCanvas.getContext('2d');
    var w = state.w, h = state.h;
    var mask = state.brushMask;
    var img = ctx.createImageData(w, h);
    var d = img.data;
    for (var i = 0; i < w * h; i++) {
      if (mask[i]) {
        d[i * 4] = 255; d[i * 4 + 1] = 45; d[i * 4 + 2] = 117; d[i * 4 + 3] = 110;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function getPos(e) {
    var rect = el.mainCanvas.getBoundingClientRect();
    var sx = state.w / rect.width;
    var sy = state.h / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * sx),
      y: Math.floor((e.clientY - rect.top) * sy)
    };
  }

  function strokeBrush(x, y) {
    var w = state.w, h = state.h, mask = state.brushMask;
    var r = state.brushSize;
    var r2 = r * r;
    var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        var dx = xx - x, dy = yy - y;
        if (dx * dx + dy * dy <= r2) mask[yy * w + xx] = 1;
      }
    }
  }

  function brushStart(e) {
    if (state.mode !== 'brush' || !state.srcData) return;
    state.drawing = true;
    var p = getPos(e);
    state.lastX = p.x; state.lastY = p.y;
    strokeBrush(p.x, p.y);
    drawBrushOverlay();
  }
  function brushMove(e) {
    if (!state.drawing) return;
    var p = getPos(e);
    // 插值
    var dx = p.x - state.lastX, dy = p.y - state.lastY;
    var steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    for (var s = 1; s <= steps; s++) {
      strokeBrush(Math.round(state.lastX + dx * s / steps), Math.round(state.lastY + dy * s / steps));
    }
    state.lastX = p.x; state.lastY = p.y;
    drawBrushOverlay();
  }
  function brushEnd() { state.drawing = false; }

  function extractBrushLayer() {
    if (!state.srcData || !state.brushMask) { toast('请先上传图片并用画笔圈出主体', 'error'); return; }
    var w = state.w, h = state.h, mask = state.brushMask;
    var painted = 0;
    for (var i = 0; i < mask.length; i++) if (mask[i]) painted++;
    if (painted < 10) { toast('请先用画笔圈出要分离的区域', 'error'); return; }

    // 用 mask 作为前景，其余为背景
    var fg = cloneImageData(state.srcData);
    var bg = cloneImageData(state.srcData);
    var fgD = fg.data, bgD = bg.data;
    for (var k = 0; k < w * h; k++) {
      var a = k * 4;
      if (mask[k]) bgD[a + 3] = 0; else fgD[a + 3] = 0;
    }
    state.layers = { foreground: fg, background: bg };
    renderLayers();
    toast('已按画笔区域分离为前景 / 背景', 'success');
  }

  function clearBrush() {
    if (!state.brushMask) return;
    state.brushMask.fill(0);
    drawBrushOverlay();
  }

  /* ---------- 模式 3：智能填充（inpainting） ---------- */
  function inpaint() {
    if (!state.srcData) { toast('请先上传图片', 'error'); return; }
    // 以透明像素为待填充区域。先把当前主画布数据作为输入
    var ctx = el.mainCanvas.getContext('2d');
    var id = ctx.getImageData(0, 0, state.w, state.h);
    var w = id.width, h = id.height, d = id.data;

    // 标记需要填充的像素（透明）
    var todo = 0;
    for (var i = 0; i < w * h; i++) if (d[i * 4 + 3] < 128) todo++;
    if (todo === 0) { toast('没有需要填充的透明区域，请先分层或擦除部分像素', 'error'); return; }

    toast('正在智能填充…', 'info');
    // 迭代邻域平均填充
    var maxIter = Math.ceil(Math.max(w, h) * 0.6);
    for (var iter = 0; iter < maxIter; iter++) {
      var changed = false;
      var next = new Uint8ClampedArray(d);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = (y * w + x) * 4;
          if (d[idx + 3] >= 128) continue; // 已填充，跳过
          var r = 0, g = 0, b = 0, cnt = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              var nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              var ni = (ny * w + nx) * 4;
              if (d[ni + 3] >= 128) { r += d[ni]; g += d[ni + 1]; b += d[ni + 2]; cnt++; }
            }
          }
          if (cnt > 0) {
            next[idx] = r / cnt;
            next[idx + 1] = g / cnt;
            next[idx + 2] = b / cnt;
            next[idx + 3] = 255;
            changed = true;
          }
        }
      }
      d.set(next);
      if (!changed) break;
    }
    ctx.putImageData(id, 0, 0);
    state.srcData = id; // 更新原图数据
    toast('智能填充完成', 'success');
  }

  /* ---------- 模式 4：线稿提取 ---------- */
  function extractLines() {
    if (!state.srcData) { toast('请先上传图片', 'error'); return; }
    toast('正在提取线稿…', 'info');
    var w = state.w, h = state.h;
    var src = state.srcData.data;
    var out = el.mainCanvas.getContext('2d').createImageData(w, h);
    var od = out.data;

    // Sobel 边缘
    var edge = new Float32Array(w * h);
    var maxE = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = (y * w + x) * 4;
        var gx = -luminance(src[i - 4 - w * 4], src[i - 3 - w * 4], src[i - 2 - w * 4])
               - 2 * luminance(src[i - 4], src[i - 3], src[i - 2])
               - luminance(src[i - 4 + w * 4], src[i - 3 + w * 4], src[i - 2 + w * 4])
               + luminance(src[i + 4 - w * 4], src[i + 3 - w * 4], src[i + 2 - w * 4])
               + 2 * luminance(src[i + 4], src[i + 3], src[i + 2])
               + luminance(src[i + 4 + w * 4], src[i + 3 + w * 4], src[i + 2 + w * 4]);
        var gy = -luminance(src[i - 4 - w * 4], src[i - 3 - w * 4], src[i - 2 - w * 4])
               - 2 * luminance(src[i - w * 4], src[i - w * 4 + 1], src[i - w * 4 + 2])
               - luminance(src[i + 4 - w * 4], src[i + 3 - w * 4], src[i + 2 - w * 4])
               + luminance(src[i - 4 + w * 4], src[i - 3 + w * 4], src[i - 2 + w * 4])
               + 2 * luminance(src[i + w * 4], src[i + w * 4 + 1], src[i + w * 4 + 2])
               + luminance(src[i + 4 + w * 4], src[i + 3 + w * 4], src[i + 2 + w * 4]);
        var e = Math.sqrt(gx * gx + gy * gy);
        edge[y * w + x] = e;
        if (e > maxE) maxE = e;
      }
    }
    var thr = maxE * 0.18;
    for (var p = 0; p < w * h; p++) {
      var a = p * 4;
      var isEdge = edge[p] > thr;
      var v = isEdge ? 30 : 255; // 黑线白底
      od[a] = v; od[a + 1] = v; od[a + 2] = v; od[a + 3] = 255;
    }
    el.mainCanvas.getContext('2d').putImageData(out, 0, 0);
    state.srcData = out;
    toast('线稿提取完成', 'success');
  }

  /* ---------- 模式切换 ---------- */
  function setMode(m) {
    state.mode = m;
    el.tabs.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === m);
    });
    // 显示/隐藏画笔控制
    if (el.brushCtrl) el.brushCtrl.style.display = m === 'brush' ? 'flex' : 'none';
    if (el.inpaintBtn) el.inpaintBtn.style.display = m === 'inpaint' ? 'inline-flex' : 'none';
    if (el.linesBtn) el.linesBtn.style.display = m === 'lines' ? 'inline-flex' : 'none';
    if (el.autoBtn) el.autoBtn.style.display = m === 'auto' ? 'inline-flex' : 'none';
    if (el.extractBtn) el.extractBtn.style.display = m === 'brush' ? 'inline-flex' : 'none';
    if (el.clearBtn) el.clearBtn.style.display = m === 'brush' ? 'inline-flex' : 'none';
    renderMain();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (inited) return;
    inited = true;
    el.back = $('rsBack');
    el.upload = $('rsUpload');
    el.file = $('rsFile');
    el.mainCanvas = $('rsMain');
    el.tabs = $('rsTabs');
    el.brushCtrl = $('rsBrushCtrl');
    el.brushSize = $('rsBrushSize');
    el.brushSizeVal = $('rsBrushSizeVal');
    el.autoBtn = $('rsAutoBtn');
    el.extractBtn = $('rsExtractBtn');
    el.clearBtn = $('rsClearBtn');
    el.inpaintBtn = $('rsInpaintBtn');
    el.linesBtn = $('rsLinesBtn');
    el.layerWrap = $('rsLayers');

    // 上传
    el.upload.addEventListener('click', function () { el.file.click(); });
    el.file.addEventListener('change', function (e) { if (e.target.files[0]) loadImage(e.target.files[0]); });
    // 拖拽
    el.mainCanvas.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.mainCanvas.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
    });

    // 画笔
    el.mainCanvas.addEventListener('mousedown', brushStart);
    el.mainCanvas.addEventListener('mousemove', brushMove);
    window.addEventListener('mouseup', brushEnd);
    el.mainCanvas.addEventListener('touchstart', function (e) { e.preventDefault(); brushStart(e.touches[0]); });
    el.mainCanvas.addEventListener('touchmove', function (e) { e.preventDefault(); brushMove(e.touches[0]); });
    el.mainCanvas.addEventListener('touchend', brushEnd);
    el.brushSize.addEventListener('input', function () {
      state.brushSize = parseInt(el.brushSize.value, 10) || 24;
      if (el.brushSizeVal) el.brushSizeVal.textContent = state.brushSize;
    });

    // 模式切换
    el.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (b) setMode(b.getAttribute('data-mode'));
    });

    el.autoBtn.addEventListener('click', autoSplit);
    el.extractBtn.addEventListener('click', extractBrushLayer);
    el.clearBtn.addEventListener('click', clearBrush);
    el.inpaintBtn.addEventListener('click', inpaint);
    el.linesBtn.addEventListener('click', extractLines);

    el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });

    // 下载分层
    el.layerWrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dl]');
      if (!b) return;
      var key = b.getAttribute('data-dl');
      var id = state.layers[key];
      if (id) downloadCanvas(imageDataToCanvas(id), key + '.png');
    });

    setMode('auto');
  }

  function enter() { init(); }
  function leave() {}

  return { enter: enter, leave: leave };
})();
