/* ============================================================
 * 着色 HMPaint（参考 RETAS PaintMan 的上色工作流）
 * - 布局：左侧工具栏 / 中部画布 / 右侧色指定表（色号 + 色块 + 使用次数）
 * - 图层：线稿层（可调浓度、可隐藏）+ 多个上色图层（增删/复制/排序/锁定/不透明度）
 * - 工具：油漆桶（受线稿遮挡、可闭合缝隙）、画笔、橡皮、吸管
 * - 撤销 / 重做、缩放适配、导入线稿、导出 PNG、本地自动保存
 * ============================================================ */
window.HMPaint = (function () {
  var LS_PREFIX = 'anidream.paint.v1';
  var MAX_W = 1600;
  var MAX_H = 1000;
  var LINE_LAYER_ID = 'lyr_line';

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

  // el.paintLayers: [{ layer, canvas, ctx }]  与 state.layers 中的上色层一一对应
  // el.line / el.lineCtx: 线稿层画布（始终在最上层，接收指针事件）

  function uid(p) { return (p || 'c') + Math.random().toString(36).slice(2, 7); }
  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------------- 数据 ---------------- */
  function makeLayer(type, name, opts) {
    opts = opts || {};
    return {
      id: type === 'line' ? LINE_LAYER_ID : uid('lyr_'),
      name: name,
      type: type,                          // 'line' | 'paint'
      visible: opts.visible !== false,
      locked: type === 'line' ? true : (opts.locked || false),
      opacity: typeof opts.opacity === 'number' ? opts.opacity : 1,
      data: opts.data || ''
    };
  }

  function defaults() {
    return {
      name: '未命名着色',
      w: 1280, h: 720,
      layers: [
        makeLayer('line', '线稿', { opacity: 1 }),
        makeLayer('paint', '上色 1', { opacity: 1 })
      ],
      activeLayerId: '',
      palette: PRESETS.map(function (p) { return { code: p.code, name: p.name, color: p.color, count: 0, custom: false }; }),
      current: '#ffcfae'
    };
  }

  function ensureActive(s) {
    if (!s || !Array.isArray(s.layers)) return;
    var paint = s.layers.filter(function (l) { return l.type === 'paint'; });
    if (!paint.length) {
      var nl = makeLayer('paint', '上色 1');
      s.layers.push(nl);
      paint = [nl];
    }
    var exists = paint.some(function (l) { return l.id === s.activeLayerId; });
    if (!exists) s.activeLayerId = paint[0].id;
  }

  function normalize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') { ensureActive(d); return d; }
    d.name = s.name || d.name;
    d.w = Number(s.w) > 0 ? Math.min(MAX_W, Number(s.w)) : 1280;
    d.h = Number(s.h) > 0 ? Math.min(MAX_H, Number(s.h)) : 720;

    var layers;
    if (Array.isArray(s.layers) && s.layers.length) {
      layers = s.layers.map(function (l, i) {
        if (!l || typeof l !== 'object') return makeLayer('paint', '图层 ' + (i + 1));
        var type = l.type === 'line' ? 'line' : 'paint';
        return makeLayer(type, String(l.name || (type === 'line' ? '线稿' : '图层 ' + (i + 1))), {
          visible: l.visible !== false,
          locked: type === 'line' ? true : !!l.locked,
          opacity: (Number(l.opacity) >= 0 && Number(l.opacity) <= 1) ? Number(l.opacity) : 1,
          data: typeof l.data === 'string' ? l.data : ''
        });
      });
    } else {
      // 兼容旧数据：state.line / state.paint / showLine / showPaint / lineAlpha
      layers = [
        makeLayer('line', '线稿', {
          visible: s.showLine !== false,
          opacity: (Number(s.lineAlpha) >= 0.2 && Number(s.lineAlpha) <= 1) ? Number(s.lineAlpha) : 1,
          data: typeof s.line === 'string' ? s.line : ''
        }),
        makeLayer('paint', '上色 1', {
          visible: s.showPaint !== false,
          opacity: 1,
          data: typeof s.paint === 'string' ? s.paint : ''
        })
      ];
    }
    // 保证线稿层存在且放在数组首位
    var line = layers.filter(function (l) { return l.type === 'line'; })[0];
    var paints = layers.filter(function (l) { return l.type === 'paint'; });
    if (!line) line = makeLayer('line', '线稿');
    d.layers = [line].concat(paints);

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
    d.activeLayerId = typeof s.activeLayerId === 'string' ? s.activeLayerId : '';
    ensureActive(d);
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
      state.layers.forEach(function (l) {
        var ref = layerRef(l.id);
        if (ref && ref.canvas) l.data = ref.canvas.toDataURL('image/png');
      });
      localStorage.setItem(lsKey(), JSON.stringify(state));
    } catch (e) {
      toast('本地存储空间不足，本次上色未能保存', 'error');
    }
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function lineLayer() { return state ? state.layers.find(function (l) { return l.type === 'line'; }) : null; }
  function paintLayers() { return state ? state.layers.filter(function (l) { return l.type === 'paint'; }) : []; }
  function activeLayer() {
    if (!state) return null;
    return state.layers.find(function (l) { return l.id === state.activeLayerId; }) || null;
  }
  function layerRef(id) {
    if (id === LINE_LAYER_ID) return { layer: lineLayer(), canvas: el.line, ctx: el.lineCtx };
    for (var i = 0; i < el.paintLayers.length; i++) {
      if (el.paintLayers[i].layer.id === id) return el.paintLayers[i];
    }
    return null;
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
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

    el.layerList = $('ptLayerList');
    el.addLayerBtn = $('ptAddLayer');
    el.dupLayerBtn = $('ptDupLayer');
    el.upLayerBtn = $('ptUpLayer');
    el.downLayerBtn = $('ptDownLayer');
    el.delLayerBtn = $('ptDelLayer');

    el.paintCtx = el.paint.getContext('2d');
    el.lineCtx = el.line.getContext('2d');

    bindTop();
    bindTools();
    bindPaint();
    bindChart();
    bindLayers();
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
      if ((e.ctrlKey || e.metaKey) || e.altKey) return;
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

  /* ---------------- 画布 / 图层 DOM ---------------- */
  // 构建 state.layers 对应的 canvas 引用；复用已有 canvas（按 data-layer-id 匹配），保留内容
  function buildLayerCanvases() {
    var paints = paintLayers();
    var existing = {};
    el.wrap.querySelectorAll('canvas').forEach(function (c) {
      if (c === el.paint || c === el.line) return;
      var id = c.getAttribute('data-layer-id');
      if (id) existing[id] = c;
    });
    el.paintLayers = [];
    if (paints[0]) {
      el.paint.setAttribute('data-layer-id', paints[0].id);
      el.paintLayers.push({ layer: paints[0], canvas: el.paint, ctx: el.paintCtx });
    }
    for (var i = 1; i < paints.length; i++) {
      var l = paints[i];
      var c = existing[l.id];
      if (!c) {
        c = document.createElement('canvas');
        c.width = state.w;
        c.height = state.h;
        el.wrap.appendChild(c);
      }
      c.setAttribute('data-layer-id', l.id);
      el.paintLayers.push({ layer: l, canvas: c, ctx: c.getContext('2d') });
    }
    var validIds = paints.map(function (p) { return p.id; });
    el.wrap.querySelectorAll('canvas').forEach(function (c) {
      if (c === el.paint || c === el.line) return;
      var id = c.getAttribute('data-layer-id');
      if (validIds.indexOf(id) === -1) c.remove();
    });
    reorderLayerDom();
  }

  // 按 state.layers 顺序重排 DOM：上色层从下到上，线稿层在最上
  function reorderLayerDom() {
    var paints = paintLayers();
    paints.forEach(function (l) {
      var ref = layerRef(l.id);
      if (ref && ref.canvas && ref.canvas.parentNode === el.wrap) {
        el.wrap.appendChild(ref.canvas);
      }
    });
    if (el.line.parentNode === el.wrap) el.wrap.appendChild(el.line);
  }

  function sizeCanvases() {
    el.paint.width = state.w;
    el.paint.height = state.h;
    el.line.width = state.w;
    el.line.height = state.h;
    el.paintLayers.forEach(function (r) {
      r.canvas.width = state.w;
      r.canvas.height = state.h;
      r.ctx = r.canvas.getContext('2d');
    });
    el.paintCtx = el.paint.getContext('2d');
    el.lineCtx = el.line.getContext('2d');
    el.wrap.style.width = Math.round(state.w * zoom) + 'px';
    el.wrap.style.height = Math.round(state.h * zoom) + 'px';
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

  // 统一应用图层可见性与不透明度（单一渲染入口，避免状态污染）
  function applyLayerVisibility() {
    if (!state) return;
    state.layers.forEach(function (l) {
      var ref = layerRef(l.id);
      if (!ref || !ref.canvas) return;
      var o = l.visible ? l.opacity : 0;
      ref.canvas.style.opacity = String(o);
      ref.canvas.style.pointerEvents = (l.type === 'line') ? 'auto' : 'none';
    });
    renderLayers();
  }

  function updateCursor() {
    if (!el.line) return;
    var c = 'crosshair';
    if (tool === 'picker') c = 'copy';
    el.line.style.cursor = c;
  }

  function restore() {
    buildLayerCanvases();
    sizeCanvases();
    el.paintLayers.forEach(function (r) { r.ctx.clearRect(0, 0, state.w, state.h); });
    el.lineCtx.clearRect(0, 0, state.w, state.h);
    lineReady = false;
    var line = lineLayer();
    el.empty.hidden = !!(line && line.data);
    var pending = 0;
    function done() {
      pending--;
      if (pending <= 0) {
        lineReady = !!(line && line.data);
        el.empty.hidden = lineReady;
        applyLayerVisibility();
        requestAnimationFrame(fitCanvas);
        updateMeta();
      }
    }
    state.layers.forEach(function (l) {
      if (!l.data) return;
      var ref = layerRef(l.id);
      if (!ref) return;
      pending++;
      loadImage(l.data, function (img) {
        ref.ctx.clearRect(0, 0, state.w, state.h);
        ref.ctx.drawImage(img, 0, 0, state.w, state.h);
        done();
      }, done);
    });
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
    if (lineReady && !drawingEmpty()) {
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
        buildLayerCanvases();
        sizeCanvases();
        el.paintLayers.forEach(function (r) { r.ctx.clearRect(0, 0, state.w, state.h); });
        el.lineCtx.clearRect(0, 0, state.w, state.h);
        el.lineCtx.drawImage(img, 0, 0, state.w, state.h);
        removePaperWhite(state.w, state.h);
        var line = lineLayer();
        if (line) line.data = el.line.toDataURL('image/png');
        paintLayers().forEach(function (l) { l.data = ''; });
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
      for (var i = 0; i < el.paintLayers.length; i++) {
        var d = el.paintLayers[i].ctx.getImageData(0, 0, state.w, state.h).data;
        for (var j = 3; j < d.length; j += 4) { if (d[j] !== 0) return false; }
      }
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

  function activeCtx() {
    var al = activeLayer();
    if (!al || al.type !== 'paint') return null;
    if (al.locked) return null;
    var ref = layerRef(al.id);
    return ref ? ref.ctx : null;
  }

  function bindPaint() {
    el.line.addEventListener('pointerdown', function (e) {
      if (!state || !lineReady) { toast('请先导入线稿', 'info'); return; }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      var p = pointFromEvent(e);
      if (!p) return;
      e.preventDefault();
      if (tool === 'picker') { pickColor(p); return; }
      var al = activeLayer();
      if (!al || al.type !== 'paint') { toast('请先选择一个上色图层', 'info'); return; }
      if (al.locked) { toast('当前图层已锁定', 'info'); return; }
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
    var ctx = activeCtx();
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = paintColor();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, brushSize / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function paintSegment(a, b) {
    var ctx = activeCtx();
    if (!ctx) return;
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

  // 吸管：从最上层可见图层取色（上色层自顶向下，最后取线稿）
  function pickColor(p) {
    var paints = paintLayers().slice().reverse();
    for (var i = 0; i < paints.length; i++) {
      var l = paints[i];
      if (!l.visible) continue;
      var ref = layerRef(l.id);
      if (!ref) continue;
      var hit = null;
      try { hit = ref.ctx.getImageData(p.x, p.y, 1, 1).data; } catch (e) { hit = null; }
      if (hit && hit[3] > 24) { setCurrent(rgbToHex(hit[0], hit[1], hit[2])); return; }
    }
    var line = lineLayer();
    if (line && line.visible) {
      try {
        var lh = el.lineCtx.getImageData(p.x, p.y, 1, 1).data;
        if (lh && lh[3] > 24) { setCurrent(rgbToHex(lh[0], lh[1], lh[2])); return; }
      } catch (e) { /* ignore */ }
    }
    setCurrent('#ffffff');
  }

  function setCurrent(hex) {
    state.current = hex;
    renderPalette();
    scheduleSave();
  }

  /* ---------------- 油漆桶 ---------------- */
  function floodFill(sx, sy) {
    var ctx = activeCtx();
    if (!ctx) return false;
    var w = state.w, h = state.h;
    var pdata, ldata;
    try {
      pdata = ctx.getImageData(0, 0, w, h);
      ldata = el.lineCtx.getImageData(0, 0, w, h).data;
    } catch (e) {
      toast('画布读取失败，请重新导入线稿', 'error');
      return false;
    }
    var d = pdata.data;
    var lineMask = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      if (ldata[i * 4 + 3] > 24) lineMask[i] = 1;
    }
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
    ctx.putImageData(pdata, 0, 0);
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
    var al = activeLayer();
    if (!al || al.type !== 'paint') return;
    var ref = layerRef(al.id);
    if (!ref) return;
    try {
      undoStack.push({ id: al.id, data: ref.canvas.toDataURL('image/png') });
      if (undoStack.length > 20) undoStack.shift();
      redoStack = [];
    } catch (e) { /* ignore */ }
  }
  function undo() {
    if (!state) return;
    if (!undoStack.length) { toast('没有可撤销的操作', 'info'); return; }
    var snap = undoStack.pop();
    var ref = layerRef(snap.id);
    if (ref) {
      try { redoStack.push({ id: snap.id, data: ref.canvas.toDataURL('image/png') }); } catch (e) { /* ignore */ }
      loadImage(snap.data, function (img) {
        ref.ctx.clearRect(0, 0, state.w, state.h);
        ref.ctx.drawImage(img, 0, 0, state.w, state.h);
        scheduleSave();
        renderPalette();
      });
    }
  }
  function redo() {
    if (!state) return;
    if (!redoStack.length) { toast('没有可重做的操作', 'info'); return; }
    var snap = redoStack.pop();
    var ref = layerRef(snap.id);
    if (ref) {
      try { undoStack.push({ id: snap.id, data: ref.canvas.toDataURL('image/png') }); } catch (e) { /* ignore */ }
      loadImage(snap.data, function (img) {
        ref.ctx.clearRect(0, 0, state.w, state.h);
        ref.ctx.drawImage(img, 0, 0, state.w, state.h);
        scheduleSave();
        renderPalette();
      });
    }
  }

  function clearPaint() {
    if (!state) return;
    var al = activeLayer();
    if (!al || al.type !== 'paint') { toast('请先选择一个上色图层', 'info'); return; }
    if (al.locked) { toast('当前图层已锁定', 'info'); return; }
    if (!window.confirm('确定清空当前图层的上色吗？')) return;
    pushUndo();
    var ref = layerRef(al.id);
    if (ref) ref.ctx.clearRect(0, 0, state.w, state.h);
    saveNow();
    toast('已清空当前图层', 'success');
  }

  /* ---------------- 图层面板 ---------------- */
  function bindLayers() {
    el.addLayerBtn.addEventListener('click', addLayer);
    el.dupLayerBtn.addEventListener('click', duplicateLayer);
    el.upLayerBtn.addEventListener('click', function () { moveLayer(1); });
    el.downLayerBtn.addEventListener('click', function () { moveLayer(-1); });
    el.delLayerBtn.addEventListener('click', removeLayer);

    el.layerList.addEventListener('click', function (e) {
      var eye = e.target.closest('[data-eye]');
      var lock = e.target.closest('[data-lock]');
      var row = e.target.closest('[data-layer]');
      if (!row) return;
      var id = row.getAttribute('data-layer');
      if (eye) { toggleVisible(id); return; }
      if (lock) { toggleLock(id); return; }
      setActiveLayer(id);
    });
    el.layerList.addEventListener('dblclick', function (e) {
      var name = e.target.closest('[data-layername]');
      if (!name) return;
      var id = name.getAttribute('data-layername');
      renameLayer(id);
    });
    el.layerList.addEventListener('input', function (e) {
      var op = e.target.closest('[data-layerop]');
      if (!op) return;
      var id = op.getAttribute('data-layerop');
      setLayerOpacity(id, Number(op.value) / 100);
    });
  }

  function paintLayerIndex(id) {
    return state.layers.findIndex(function (l) { return l.id === id && l.type === 'paint'; });
  }

  function addLayer() {
    if (!state) return;
    var n = paintLayers().length + 1;
    var nl = makeLayer('paint', '上色 ' + n);
    state.layers.push(nl);
    state.activeLayerId = nl.id;
    buildLayerCanvases();
    sizeCanvases();
    applyLayerVisibility();
    scheduleSave();
    toast('已新建图层：' + nl.name, 'success');
  }

  function duplicateLayer() {
    if (!state) return;
    var al = activeLayer();
    if (!al || al.type !== 'paint') { toast('请先选择一个上色图层', 'info'); return; }
    var ref = layerRef(al.id);
    var nl = makeLayer('paint', al.name + ' 副本', { visible: al.visible, opacity: al.opacity });
    var idx = paintLayerIndex(al.id);
    state.layers.splice(idx + 1, 0, nl);
    state.activeLayerId = nl.id;
    buildLayerCanvases();
    sizeCanvases();
    if (ref) {
      var nref = layerRef(nl.id);
      if (nref) nref.ctx.drawImage(ref.canvas, 0, 0);
    }
    applyLayerVisibility();
    scheduleSave();
    toast('已复制图层：' + nl.name, 'success');
  }

  function removeLayer() {
    if (!state) return;
    var paints = paintLayers();
    if (paints.length <= 1) { toast('至少需要保留一个上色图层', 'info'); return; }
    var al = activeLayer();
    if (!al || al.type !== 'paint') return;
    if (!window.confirm('确定删除图层「' + al.name + '」吗？')) return;
    state.layers = state.layers.filter(function (l) { return l.id !== al.id; });
    ensureActive(state);
    buildLayerCanvases();
    sizeCanvases();
    applyLayerVisibility();
    scheduleSave();
    toast('已删除图层', 'success');
  }

  // dir: +1 上移（更靠前），-1 下移（更靠后）
  function moveLayer(dir) {
    if (!state) return;
    var al = activeLayer();
    if (!al || al.type !== 'paint') return;
    var idx = state.layers.findIndex(function (l) { return l.id === al.id; });
    var paints = paintLayers();
    var pidx = paints.findIndex(function (l) { return l.id === al.id; });
    var targetPidx = pidx + dir;
    if (targetPidx < 0 || targetPidx >= paints.length) return;
    var target = paints[targetPidx];
    var tidx = state.layers.findIndex(function (l) { return l.id === target.id; });
    state.layers[idx] = target;
    state.layers[tidx] = al;
    reorderLayerDom();
    applyLayerVisibility();
    scheduleSave();
  }

  function setActiveLayer(id) {
    if (!state) return;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l || l.type !== 'paint') return;
    state.activeLayerId = id;
    renderLayers();
    scheduleSave();
  }

  function toggleVisible(id) {
    if (!state) return;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l) return;
    l.visible = !l.visible;
    applyLayerVisibility();
    scheduleSave();
  }

  function toggleLock(id) {
    if (!state) return;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l || l.type !== 'paint') return;
    l.locked = !l.locked;
    renderLayers();
    scheduleSave();
  }

  function setLayerOpacity(id, op) {
    if (!state) return;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l) return;
    l.opacity = Math.max(0, Math.min(1, op));
    applyLayerVisibility();
    scheduleSave();
  }

  function renameLayer(id) {
    if (!state) return;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l) return;
    var name = window.prompt('图层名称', l.name);
    if (name === null) return;
    name = name.trim().slice(0, 16) || l.name;
    l.name = name;
    renderLayers();
    scheduleSave();
  }

  // 面板顺序：线稿在最上，上色层按"前→后"显示（即数组中靠后的在上）
  function renderLayers() {
    if (!state || !el.layerList) return;
    var html = '';
    var line = lineLayer();
    if (line) html += renderLayerRow(line);
    var paints = paintLayers().slice().reverse();
    paints.forEach(function (l) { html += renderLayerRow(l); });
    el.layerList.innerHTML = html;
  }

  function renderLayerRow(l) {
    var isLine = l.type === 'line';
    var active = !isLine && l.id === state.activeLayerId;
    var eye = l.visible ? '◉' : '○';
    var lockIcon = isLine ? '🔒' : (l.locked ? '🔒' : '🔓');
    var op = Math.round(l.opacity * 100);
    return '<div class="hm-pt-layer' + (active ? ' is-active' : '') +
      (l.locked && !isLine ? ' is-locked' : '') +
      '" data-layer="' + l.id + '">' +
      '<button class="hm-pt-eye' + (l.visible ? '' : ' is-off') + '" data-eye="' + l.id + '" title="显示 / 隐藏">' + eye + '</button>' +
      '<button class="hm-pt-lock' + (l.locked || isLine ? '' : ' is-unlocked') + '" data-lock="' + l.id + '" title="锁定 / 解锁">' + lockIcon + '</button>' +
      '<span class="hm-pt-layername" data-layername="' + l.id + '" title="双击重命名">' + l.name + '</span>' +
      '<input type="range" class="hm-pt-layerop" data-layerop="' + l.id + '" min="0" max="100" value="' + op + '" title="不透明度">' +
      '<em class="hm-pt-layerval">' + op + '</em>' +
      '</div>';
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
    el.meta.textContent = state.w + '×' + state.h + ' · ' + state.palette.length + ' 色 · ' + paintLayers().length + ' 层';
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
    // 合成：按 z 序自下而上绘制所有可见上色层，再绘线稿层
    state.layers.forEach(function (l) {
      if (l.type !== 'paint') return;
      if (!l.visible) return;
      var ref = layerRef(l.id);
      if (!ref) return;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(ref.canvas, 0, 0);
      ctx.restore();
    });
    var line = lineLayer();
    if (line && line.visible) {
      ctx.save();
      ctx.globalAlpha = line.opacity;
      ctx.drawImage(el.line, 0, 0);
      ctx.restore();
    }
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
    renderLayers();
    restore();
  }

  function leave() {
    if (state) saveNow();
  }

  return { init: init, enter: enter, leave: leave };
})();
