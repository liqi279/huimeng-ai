/* ============================================================
 * 着色 HMPaint（参考 RETAS PaintMan 的上色工作流）
 * - 布局：左侧工具栏 / 中部画布 / 右侧色指定表（色号 + 色块 + 使用次数）
 * - 图层：线稿层（可调浓度、可隐藏）+ 上色层
 * - 工具：油漆桶（受线稿遮挡、可闭合缝隙）、画笔、橡皮、吸管
 * - 撤销 / 重做、缩放适配、导入线稿、导出 PNG、本地自动保存
 * ============================================================ */
window.HMPaint = (function () {
  var LS_PREFIX = 'anidream.paint.v1';
  var MAX_W = 1600;
  var MAX_H = 1000;

  var PRESETS = [
    { code: '001', name: '线稿', color: '#1a1a1a' },
    { code: '101', name: '肌肤-亮', color: '#ffe6d2' },
    { code: '102', name: '肌肤', color: '#ffcfae' },
    { code: '103', name: '肌肤-影', color: '#e8a87c' },
    { code: '111', name: '头发-亮', color: '#8a6a5a' },
    { code: '112', name: '头发', color: '#6a4a3c' },
    { code: '113', name: '头发-影', color: '#4a2f26' },
    { code: '121', name: '衣服-亮', color: '#8fb8ff' },
    { code: '122', name: '衣服', color: '#5c86d6' },
    { code: '123', name: '衣服-影', color: '#3b5a99' },
    { code: '131', name: '眼白', color: '#ffffff' },
    { code: '132', name: '瞳孔', color: '#4a6fa5' },
    { code: '141', name: '背景-天', color: '#bfe3ff' },
    { code: '142', name: '背景-地', color: '#d9c7a8' }
  ];

  var state = null;
  var el = {};
  var inited = false;
  var loadedKey = '';
  var saveTimer = null;

  var tool = 'bucket';
  var brushSize = 12;
  var tolerance = 24;
  var blockByLine = true;
  var gapClose = true;
  var zoom = 1;
  var fitMode = true;
  var lineReady = false;

  var undoStack = [];
  var redoStack = [];
  var drawing = false;
  var lastPt = null;

  function uid(p) { return (p || 'c') + Math.random().toString(36).slice(2, 7); }
  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------------- 数据 ---------------- */
  function defaults() {
    return {
      name: '未命名着色',
      w: 1280, h: 720,
      line: '',
      paint: '',
      palette: PRESETS.map(function (p) { return { code: p.code, name: p.name, color: p.color, count: 0, custom: false }; }),
      current: '#ffcfae',
      showLine: true,
      showPaint: true,
      lineAlpha: 1
    };
  }

  function normalize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    d.name = s.name || d.name;
    d.w = Number(s.w) > 0 ? Math.min(MAX_W, Number(s.w)) : 1280;
    d.h = Number(s.h) > 0 ? Math.min(MAX_H, Number(s.h)) : 720;
    d.line = typeof s.line === 'string' ? s.line : '';
    d.paint = typeof s.paint === 'string' ? s.paint : '';
    if (Array.isArray(s.palette) && s.palette.length) {
      d.palette = s.palette.filter(function (p) { return p && p.color; }).map(function (p) {
        return {
          code: String(p.code || ''),
          name: String(p.name || '自定义'),
          color: String(p.color),
          count: Number(p.count) || 0,
          custom: !!p.custom
        };
      });
      if (!d.palette.length) d.palette = defaults().palette;
    }
    d.current = s.current || d.current;
    d.showLine = s.showLine !== false;
    d.showPaint = s.showPaint !== false;
    d.lineAlpha = Number(s.lineAlpha) >= 0.2 ? Number(s.lineAlpha) : 1;
    return d;
  }

  function lsKey() {
    var u = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    return u ? (LS_PREFIX + '.' + u) : LS_PREFIX;
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(lsKey());
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveNow() {
    if (!state) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      state.paint = el.paint ? el.paint.toDataURL('image/png') : state.paint;
      localStorage.setItem(lsKey(), JSON.stringify(state));
    } catch (e) {
      toast('本地存储空间不足，本次上色未能保存', 'error');
    }
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
    // 便于阅读，显式别名
    el.name = $('ptName');
    el.meta = $('ptMeta');
    el.importBtn = $('ptImportBtn');
    el.importInput = $('ptImportInput');
    el.undoBtn = $('ptUndoBtn');
    el.redoBtn = $('ptRedoBtn');
    el.clearBtn = $('ptClearBtn');
    el.exportBtn = $('ptExportBtn');
    el.tools = $('ptTools');
    el.size = $('ptSize');
    el.sizeVal = $('ptSizeVal');
    el.tol = $('ptTol');
    el.tolVal = $('ptTolVal');
    el.blockLine = $('ptBlockLine');
    el.gapClose = $('ptGapClose');
    el.zoomOut = $('ptZoomOut');
    el.zoomFit = $('ptZoomFit');
    el.zoomIn = $('ptZoomIn');
    el.zoomVal = $('ptZoomVal');
    el.lineEye = $('ptLineEye');
    el.paintEye = $('ptPaintEye');
    el.lineAlpha = $('ptLineAlpha');
    el.stage = $('ptStage');
    el.wrap = $('ptCanvasWrap');
    el.paint = $('ptPaintCanvas');
    el.line = $('ptLineCanvas');
    el.empty = $('ptEmpty');
    el.colors = $('ptColors');
    el.newColor = $('ptNewColor');
    el.newName = $('ptNewName');
    el.addColor = $('ptAddColor');
    el.curSwatch = $('ptCurSwatch');
    el.curCode = $('ptCurCode');
    el.curName = $('ptCurName');

    el.paintCtx = el.paint.getContext('2d');
    el.lineCtx = el.line.getContext('2d');

    bindTop();
    bindTools();
    bindPaint();
    bindChart();
    bindKeys();
    window.addEventListener('resize', function () {
      if (fitMode) fitCanvas();
    });
  }

  function bindTop() {
    el.name.addEventListener('input', function () {
      if (!state) return;
      state.name = el.name.value.trim() || '未命名着色';
      scheduleSave();
    });
    el.importBtn.addEventListener('click', function () { el.importInput.click(); });
    el.importInput.addEventListener('change', function () {
      var f = el.importInput.files && el.importInput.files[0];
      el.importInput.value = '';
      if (!f) return;
      importLine(f);
    });
    el.undoBtn.addEventListener('click', undo);
    el.redoBtn.addEventListener('click', redo);
    el.clearBtn.addEventListener('click', clearPaint);
    el.exportBtn.addEventListener('click', exportPng);
  }

  function bindTools() {
    el.tools.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tool]');
      if (!btn) return;
      tool = btn.getAttribute('data-tool');
      el.tools.querySelectorAll('[data-tool]').forEach(function (n) {
        n.classList.toggle('is-active', n === btn);
      });
      updateCursor();
    });
    el.size.addEventListener('input', function () {
      brushSize = Number(el.size.value) || 1;
      el.sizeVal.textContent = String(brushSize);
    });
    el.tol.addEventListener('input', function () {
      tolerance = Number(el.tol.value) || 0;
      el.tolVal.textContent = String(tolerance);
    });
    el.blockLine.addEventListener('change', function () { blockByLine = el.blockLine.checked; });
    el.gapClose.addEventListener('change', function () { gapClose = el.gapClose.checked; });
    el.zoomOut.addEventListener('click', function () { setZoom(zoom * 0.8); });
    el.zoomIn.addEventListener('click', function () { setZoom(zoom * 1.25); });
    el.zoomFit.addEventListener('click', function () { fitCanvas(); });
    el.lineEye.addEventListener('click', function () {
      if (!state) return;
      state.showLine = !state.showLine;
      applyLayerVisibility();
      scheduleSave();
    });
    el.paintEye.addEventListener('click', function () {
      if (!state) return;
      state.showPaint = !state.showPaint;
      applyLayerVisibility();
      scheduleSave();
    });
    el.lineAlpha.addEventListener('input', function () {
      if (!state) return;
      state.lineAlpha = Math.max(0.2, Number(el.lineAlpha.value) / 100);
      applyLayerVisibility();
      scheduleSave();
    });
  }

  function bindChart() {
    el.colors.addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) {
        var code = del.getAttribute('data-del');
        state.palette = state.palette.filter(function (p) { return p.code !== code; });
        renderPalette();
        scheduleSave();
        return;
      }
      var row = e.target.closest('[data-code]');
      if (!row) return;
      var item = findColor(row.getAttribute('data-code'));
      if (!item) return;
      state.current = item.color;
      renderPalette();
      scheduleSave();
    });
    el.addColor.addEventListener('click', function () {
      if (!state) return;
      var color = el.newColor.value || '#ffcfae';
      var name = el.newName.value.trim() || '自定义色';
      var n = 901;
      while (findColor(String(n))) n++;
      var item = { code: String(n), name: name, color: color, count: 0, custom: true };
      state.palette.push(item);
      state.current = color;
      el.newName.value = '';
      renderPalette();
      scheduleSave();
      toast('已添加色号 ' + item.code, 'success');
    });
    el.newColor.addEventListener('input', function () {
      el.newColor.title = el.newColor.value;
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (!state || document.body.dataset.view !== 'paint') return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      var k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var map = { b: 'brush', e: 'eraser', g: 'bucket', i: 'picker' };
      if (map[k]) {
        tool = map[k];
        el.tools.querySelectorAll('[data-tool]').forEach(function (n) {
          n.classList.toggle('is-active', n.getAttribute('data-tool') === tool);
        });
        updateCursor();
      }
    });
  }

  /* ---------------- 画布 ---------------- */
  function sizeCanvases() {
    el.paint.width = state.w;
    el.paint.height = state.h;
    el.line.width = state.w;
    el.line.height = state.h;
    el.wrap.style.width = Math.round(state.w * zoom) + 'px';
    el.wrap.style.height = Math.round(state.h * zoom) + 'px';
    el.paintCtx = el.paint.getContext('2d');
    el.lineCtx = el.line.getContext('2d');
  }

  function setZoom(z) {
    fitMode = false;
    zoom = Math.max(0.1, Math.min(4, z));
    el.wrap.style.width = Math.round(state.w * zoom) + 'px';
    el.wrap.style.height = Math.round(state.h * zoom) + 'px';
    el.zoomVal.textContent = Math.round(zoom * 100) + '%';
  }

  function fitCanvas() {
    if (!state || !el.stage) return;
    var pad = 48;
    var sw = Math.max(160, el.stage.clientWidth - pad);
    var sh = Math.max(120, el.stage.clientHeight - pad);
    zoom = Math.min(sw / state.w, sh / state.h);
    zoom = Math.max(0.1, Math.min(2, zoom));
    fitMode = true;
    el.wrap.style.width = Math.round(state.w * zoom) + 'px';
    el.wrap.style.height = Math.round(state.h * zoom) + 'px';
    el.zoomVal.textContent = Math.round(zoom * 100) + '%';
  }

  function applyLayerVisibility() {
    if (!state) return;
    el.line.style.opacity = state.showLine ? String(state.lineAlpha) : '0';
    el.paint.style.opacity = state.showPaint ? '1' : '0';
    el.lineEye.classList.toggle('is-off', !state.showLine);
    el.paintEye.classList.toggle('is-off', !state.showPaint);
    el.lineAlpha.value = String(Math.round(state.lineAlpha * 100));
  }

  function updateCursor() {
    if (!el.line) return;
    var c = 'crosshair';
    if (tool === 'brush' || tool === 'eraser') c = 'crosshair';
    if (tool === 'picker') c = 'copy';
    el.line.style.cursor = c + '';
  }

  function restore() {
    sizeCanvases();
    el.paintCtx.clearRect(0, 0, state.w, state.h);
    el.lineCtx.clearRect(0, 0, state.w, state.h);
    lineReady = false;
    el.empty.hidden = !!state.line;
    var pending = 0;
    function done() {
      pending--;
      if (pending <= 0) {
        lineReady = !!state.line;
        el.empty.hidden = lineReady;
        applyLayerVisibility();
        requestAnimationFrame(fitCanvas);
        updateMeta();
      }
    }
    if (state.line) {
      pending++;
      loadImage(state.line, function (img) {
        el.lineCtx.clearRect(0, 0, state.w, state.h);
        el.lineCtx.drawImage(img, 0, 0, state.w, state.h);
        done();
      }, done);
    }
    if (state.paint) {
      pending++;
      loadImage(state.paint, function (img) {
        el.paintCtx.clearRect(0, 0, state.w, state.h);
        el.paintCtx.drawImage(img, 0, 0, state.w, state.h);
        done();
      }, done);
    }
    if (pending === 0) done();
  }

  function loadImage(src, ok, fail) {
    var img = new Image();
    img.onload = function () { ok(img); };
    img.onerror = function () { if (fail) fail(); };
    img.src = src;
  }

  function importLine(file) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
    if (state.line && !drawingEmpty()) {
      if (!window.confirm('导入新线稿会清空当前上色，是否继续？')) return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var ratio = Math.min(1, MAX_W / w, MAX_H / h);
        state.w = Math.max(2, Math.round(w * ratio));
        state.h = Math.max(2, Math.round(h * ratio));
        sizeCanvases();
        el.paintCtx.clearRect(0, 0, state.w, state.h);
        el.lineCtx.clearRect(0, 0, state.w, state.h);
        el.lineCtx.drawImage(img, 0, 0, state.w, state.h);
        removePaperWhite(state.w, state.h);
        state.line = el.line.toDataURL('image/png');
        state.paint = '';
        lineReady = true;
        el.empty.hidden = true;
        undoStack = [];
        redoStack = [];
        applyLayerVisibility();
        fitCanvas();
        updateMeta();
        saveNow();
        toast('线稿已导入，开始上色吧', 'success');
      };
      img.onerror = function () { toast('图片解析失败', 'error'); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('读取文件失败', 'error'); };
    reader.readAsDataURL(file);
  }

  /* 把线稿中的纸张白底转为透明，避免白底遮挡油漆桶填充 */
  function removePaperWhite(w, h) {
    try {
      var img = el.lineCtx.getImageData(0, 0, w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3];
        if (a === 0) continue;
        var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum >= 236) d[i + 3] = 0;
        else if (a < 255) d[i + 3] = Math.max(a, 255 - Math.round(lum / 3));
      }
      el.lineCtx.putImageData(img, 0, 0);
    } catch (e) { /* ignore */ }
  }

  function drawingEmpty() {
    try {
      var d = el.paintCtx.getImageData(0, 0, state.w, state.h).data;
      for (var i = 3; i < d.length; i += 4) { if (d[i] !== 0) return false; }
    } catch (e) { return false; }
    return true;
  }

  /* ---------------- 绘制 ---------------- */
  function pointFromEvent(e) {
    var r = el.line.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x = Math.round((e.clientX - r.left) / r.width * state.w);
    var y = Math.round((e.clientY - r.top) / r.height * state.h);
    if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
    return { x: x, y: y };
  }

  function bindPaint() {
    el.line.addEventListener('pointerdown', function (e) {
      if (!state || !lineReady) { toast('请先导入线稿', 'info'); return; }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      var p = pointFromEvent(e);
      if (!p) return;
      e.preventDefault();
      if (tool === 'picker') { pickColor(p); return; }
      if (tool === 'bucket') {
        pushUndo();
        var filled = floodFill(p.x, p.y);
        if (!filled) undoStack.pop();
        renderPalette();
        scheduleSave();
        return;
      }
      pushUndo();
      drawing = true;
      lastPt = p;
      try { el.line.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      paintDot(p);
    });
    el.line.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pointFromEvent(e);
      if (!p || !lastPt) return;
      paintSegment(lastPt, p);
      lastPt = p;
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      lastPt = null;
      scheduleSave();
      renderPalette();
    }
    el.line.addEventListener('pointerup', endStroke);
    el.line.addEventListener('pointercancel', endStroke);
    el.line.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function paintColor() { return state ? state.current : '#000'; }

  function paintDot(p) {
    var ctx = el.paintCtx;
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = paintColor();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, brushSize / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function paintSegment(a, b) {
    var ctx = el.paintCtx;
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = paintColor();
    ctx.lineWidth = Math.max(1, brushSize);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function pickColor(p) {
    var hit = null;
    try { hit = el.lineCtx.getImageData(p.x, p.y, 1, 1).data; } catch (e) { hit = null; }
    if (hit && hit[3] > 24) {
      setCurrent(rgbToHex(hit[0], hit[1], hit[2]));
      return;
    }
    try { hit = el.paintCtx.getImageData(p.x, p.y, 1, 1).data; } catch (e2) { hit = null; }
    if (hit && hit[3] > 24) setCurrent(rgbToHex(hit[0], hit[1], hit[2]));
    else setCurrent('#ffffff');
  }

  function setCurrent(hex) {
    state.current = hex;
    renderPalette();
    scheduleSave();
  }

  /* ---------------- 油漆桶 ---------------- */
  function floodFill(sx, sy) {
    var w = state.w, h = state.h;
    var pdata, ldata;
    try {
      pdata = el.paintCtx.getImageData(0, 0, w, h);
      ldata = el.lineCtx.getImageData(0, 0, w, h).data;
    } catch (e) {
      toast('画布读取失败，请重新导入线稿', 'error');
      return false;
    }
    var d = pdata.data;
    // lineMask：真实线稿像素（alpha>24），用于区分"线稿"与"扩张间隙"
    var lineMask = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      if (ldata[i * 4 + 3] > 24) lineMask[i] = 1;
    }
    // blocked：用于洪水填充扩散控制的阻挡掩码（开启闭合缝隙时向外扩张 1px，防止漏色）
    var blocked = new Uint8Array(lineMask);
    if (blockByLine && gapClose) dilate(blocked, w, h, 1);
    var start = sy * w + sx;
    if (blockByLine && blocked[start]) {
      toast('该位置被线稿覆盖，请点击色块区域', 'info');
      return false;
    }
    if (!blockByLine) blocked = new Uint8Array(w * h);

    var si = start * 4;
    var tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
    var fill = hexToRgb(state.current);
    if (tr === fill.r && tg === fill.g && tb === fill.b && ta === 255) return false;

    var visited = new Uint8Array(w * h);
    var stack = [start];
    var changed = false;
    while (stack.length) {
      var idx = stack.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;
      var o = idx * 4;
      var match = (ta === d[o + 3] && Math.abs(d[o] - tr) <= tolerance && Math.abs(d[o + 1] - tg) <= tolerance && Math.abs(d[o + 2] - tb) <= tolerance);
      if (blocked[idx]) {
        // 扩张间隙像素：与填充区4邻接的间隙直接填充以消除黑边，但不扩散（防止沿线稿环漏色）
        if (match && !lineMask[idx]) {
          d[o] = fill.r; d[o + 1] = fill.g; d[o + 2] = fill.b; d[o + 3] = 255;
          changed = true;
        }
        continue;
      }
      if (match) {
        d[o] = fill.r; d[o + 1] = fill.g; d[o + 2] = fill.b; d[o + 3] = 255;
        changed = true;
        var x = idx % w;
        if (x > 0) stack.push(idx - 1);
        if (x < w - 1) stack.push(idx + 1);
        if (idx >= w) stack.push(idx - w);
        if (idx + w < w * h) stack.push(idx + w);
      }
    }
    // 第二遍：填充与已填充区域8邻接的间隙像素（覆盖角落），不传播
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var ci = y * w + x;
        if (!blocked[ci] || lineMask[ci]) continue;
        var co = ci * 4;
        if (d[co + 3] !== 0) continue;
        var adj = false;
        for (var dy = -1; dy <= 1 && !adj; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (d[( (y + dy) * w + (x + dx)) * 4 + 3] === 255) { adj = true; break; }
          }
        }
        if (adj && ta === d[co + 3] && Math.abs(d[co] - tr) <= tolerance && Math.abs(d[co + 1] - tg) <= tolerance && Math.abs(d[co + 2] - tb) <= tolerance) {
          d[co] = fill.r; d[co + 1] = fill.g; d[co + 2] = fill.b; d[co + 3] = 255;
          changed = true;
        }
      }
    }
    if (!changed) return false;
    el.paintCtx.putImageData(pdata, 0, 0);
    bumpColor(state.current);
    return true;
  }

  function dilate(mask, w, h, radius) {
    var src = new Uint8Array(mask);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (src[i]) continue;
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            if (!dx && !dy) continue;
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (src[ny * w + nx]) { mask[i] = 1; dy = radius; break; }
          }
        }
      }
    }
  }

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
  function rgbToHex(r, g, b) {
    function h2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + h2(r) + h2(g) + h2(b);
  }

  function bumpColor(hex) {
    var item = state.palette.find(function (p) { return p.color.toLowerCase() === String(hex).toLowerCase(); });
    if (item) item.count = (item.count || 0) + 1;
  }

  /* ---------------- 撤销 / 重做 ---------------- */
  function pushUndo() {
    if (!state) return;
    try {
      undoStack.push(el.paint.toDataURL('image/png'));
      if (undoStack.length > 20) undoStack.shift();
      redoStack = [];
    } catch (e) { /* ignore */ }
  }
  function undo() {
    if (!state) return;
    if (!undoStack.length) { toast('没有可撤销的操作', 'info'); return; }
    try { redoStack.push(el.paint.toDataURL('image/png')); } catch (e) { /* ignore */ }
    var src = undoStack.pop();
    loadImage(src, function (img) {
      el.paintCtx.clearRect(0, 0, state.w, state.h);
      el.paintCtx.drawImage(img, 0, 0, state.w, state.h);
      scheduleSave();
      renderPalette();
    });
  }
  function redo() {
    if (!state) return;
    if (!redoStack.length) { toast('没有可重做的操作', 'info'); return; }
    try { undoStack.push(el.paint.toDataURL('image/png')); } catch (e) { /* ignore */ }
    var src = redoStack.pop();
    loadImage(src, function (img) {
      el.paintCtx.clearRect(0, 0, state.w, state.h);
      el.paintCtx.drawImage(img, 0, 0, state.w, state.h);
      scheduleSave();
      renderPalette();
    });
  }

  function clearPaint() {
    if (!state) return;
    if (!window.confirm('确定清空当前所有上色吗？')) return;
    pushUndo();
    el.paintCtx.clearRect(0, 0, state.w, state.h);
    saveNow();
    toast('已清空上色', 'success');
  }

  /* ---------------- 色指定表 ---------------- */
  function findColor(code) {
    return state ? state.palette.find(function (p) { return p.code === code; }) : null;
  }

  function renderPalette() {
    if (!state || !el.colors) return;
    var html = '';
    state.palette.forEach(function (p) {
      var active = p.color.toLowerCase() === String(state.current).toLowerCase();
      html += '<div class="hm-pt-color' + (active ? ' is-active' : '') + '" data-code="' + p.code + '" title="' + p.name + '">' +
        '<i style="background:' + p.color + '"></i>' +
        '<b>' + p.code + '</b>' +
        '<span>' + p.name + '</span>' +
        '<em>' + (p.count || 0) + '</em>' +
        (p.custom ? '<u class="hm-pt-color-del" data-del="' + p.code + '" title="删除该色">×</u>' : '') +
        '</div>';
    });
    el.colors.innerHTML = html;
    var cur = findColorByHex(state.current);
    el.curSwatch.style.background = state.current;
    el.curCode.textContent = cur ? cur.code : '—';
    el.curName.textContent = cur ? cur.name : state.current;
    updateMeta();
  }

  function findColorByHex(hex) {
    var h = String(hex).toLowerCase();
    return state.palette.find(function (p) { return p.color.toLowerCase() === h; });
  }

  function updateMeta() {
    if (!state || !el.meta) return;
    el.meta.textContent = state.w + '×' + state.h + ' · ' + state.palette.length + ' 色';
  }

  /* ---------------- 导出 ---------------- */
  function exportPng() {
    if (!state) return;
    if (!lineReady) { toast('请先导入线稿', 'info'); return; }
    var out = document.createElement('canvas');
    out.width = state.w;
    out.height = state.h;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.globalAlpha = state.showPaint ? 1 : 0;
    ctx.drawImage(el.paint, 0, 0);
    ctx.globalAlpha = state.showLine ? state.lineAlpha : 0;
    ctx.drawImage(el.line, 0, 0);
    ctx.globalAlpha = 1;
    try {
      var url = out.toDataURL('image/png');
      var a = document.createElement('a');
      var safe = (state.name || '着色').replace(/[\\/:*?"<>|]/g, '_');
      a.href = url;
      a.download = safe + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('已导出 PNG', 'success');
    } catch (e) {
      toast('导出失败', 'error');
    }
  }

  /* ---------------- 对外接口 ---------------- */
  function enter() {
    init();
    var key = lsKey();
    if (!state || loadedKey !== key) {
      state = loadState() || defaults();
      loadedKey = key;
    }
    el.name.value = state.name;
    el.size.value = String(brushSize);
    el.sizeVal.textContent = String(brushSize);
    el.tol.value = String(tolerance);
    el.tolVal.textContent = String(tolerance);
    el.blockLine.checked = blockByLine;
    el.gapClose.checked = gapClose;
    el.newColor.value = state.current;
    renderPalette();
    restore();
  }

  function leave() {
    if (state) saveNow();
  }

  return { init: init, enter: enter, leave: leave };
})();
