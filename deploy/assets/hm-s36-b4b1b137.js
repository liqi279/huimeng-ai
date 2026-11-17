
/* ============ 【原画】构图纸绘画工作台：画布 / 笔刷 / 图层 / 帧 / 播放 / 导出 ============
   画布铺在摄影框画面区内，文档坐标 = 纸面 mm；尺寸、Field、三层框变化时只改视窗映射，
   笔画按纸面 mm 定位，不会错位。工具设置接在页面现有右侧面板与时间轴里，不另起工具条。 */
(function () {
  'use strict';
  var root = document.getElementById('view-oua');
  if (!root || !window.OUACanvas) return;

  var mountEl = root.querySelector('[data-oua-mount]');
  var paperEl = root.querySelector('.oua-paper');
  var frameEl = root.querySelector('[data-oua-frame-wrap]');
  var guidesEl = root.querySelector('.oua-frame-guides');
  var panel = document.getElementById('ouaLayersPanel');
  var listEl = panel ? panel.querySelector('.hm-oua-lyr-list') : null;
  var propsEl = panel ? panel.querySelector('.hm-oua-lyr-props') : null;
  var footEl = panel ? panel.querySelector('.hm-oua-lyr-foot') : null;
  var countEl = panel ? panel.querySelector('.hm-oua-lyr-head-count') : null;
  if (!mountEl || !paperEl || !frameEl || !guidesEl || !panel || !listEl) return;

  var sizeInfo = (window.HMOuaSize && window.HMOuaSize.get()) || {
    paper: { id: 'b4v', label: 'B4 257×364', w: 257, h: 364 },
    frame: '4:3', field: { id: '12', mm: [304.8, 228.6] }, ratio: 4 / 3
  };

  var eng = window.OUACanvas.mount(mountEl, {
    chrome: false,
    fit: 'view',
    brushUnit: 'px',
    exportWidth: 1920,
    background: 'transparent',
    shadow: false,
    border: false,
    width: sizeInfo.paper.w,
    height: sizeInfo.paper.w * 0.75,
    storageKey: 'hm.oua.paint.v2',
    fps: 12,
    minBrush: 1,
    maxBrush: 6,
    stabilizer: 3
  });
  window.HMOuaStudio = { engine: eng };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function q(sel) { return root.querySelector(sel); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---------------- 视窗映射：纸面 mm → 摄影框画面 ---------------- */
  function syncView() {
    var pr = paperEl.getBoundingClientRect();
    var fr = frameEl.getBoundingClientRect();
    if (!pr.width || !pr.height || !fr.width || !fr.height) return;
    var paperW = sizeInfo.paper.w;
    var pxPerMm = pr.width / paperW;
    if (!isFinite(pxPerMm) || pxPerMm <= 0) return;
    var docW = paperW;
    var docH = pr.height / pxPerMm;
    eng.setDocSize(docW, docH);
    eng.setViewport({
      x: (fr.left - pr.left) / pxPerMm,
      y: (fr.top - pr.top) / pxPerMm,
      w: fr.width / pxPerMm,
      h: fr.height / pxPerMm
    });
    eng.redrawCurve();
  }

  document.addEventListener('hm:oua-size', function (e) {
    if (e && e.detail) sizeInfo = e.detail;
    syncView();
    renderTimeline();
    pullBrush();
  });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { syncView(); }).observe(paperEl);
    new ResizeObserver(function () { renderTimeline(); }).observe(q('[data-oua-track-row="V1"]'));
  }
  window.addEventListener('resize', syncView);
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (!root.hidden) setTimeout(syncView, 40);
    }).observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  requestAnimationFrame(syncView);
  setTimeout(syncView, 120);

  /* ---------------- 画笔面板（接进现有右侧面板） ---------------- */
  var STAB_OPTS = (function () {
    var buf = '';
    for (var i = 0; i <= 10; i++) buf += '<option value="' + i + '">' + i + '</option>';
    return buf;
  })();

  var brushEl = document.createElement('section');
  brushEl.className = 'hm-oua-brush';
  brushEl.id = 'ouaBrushPanel';
  brushEl.innerHTML = [
    '<div class="hm-oua-brush-head"><span>画笔 / 橡皮</span><em data-oua-brush-note>构图纸 · mm 坐标</em></div>',
    '<div class="hm-oua-brush-row">',
    '  <button class="hm-oua-tool is-on" type="button" data-oua-tool="brush">画笔</button>',
    '  <button class="hm-oua-tool" type="button" data-oua-tool="eraser">橡皮</button>',
    '  <input class="hm-oua-color" type="color" value="#1a1a1a" data-oua-brush="color" title="画笔颜色" aria-label="画笔颜色">',
    '  <button class="hm-oua-mini" type="button" data-oua-act="undo">撤销</button>',
    '  <button class="hm-oua-mini" type="button" data-oua-act="redo">重做</button>',
    '</div>',
    '<label class="hm-oua-brush-field"><span>粗细</span><input type="range" min="1" max="48" step="0.5" data-oua-brush="max" aria-label="最大笔宽"><b data-oua-out="max"></b></label>',
    '<label class="hm-oua-brush-field"><span>最小</span><input type="range" min="0.5" max="24" step="0.5" data-oua-brush="min" aria-label="最小笔宽"><b data-oua-out="min"></b></label>',
    '<label class="hm-oua-brush-field"><span>浓度</span><input type="range" min="5" max="100" step="1" data-oua-brush="opacity" aria-label="浓度"><b data-oua-out="opacity"></b></label>',
    '<div class="hm-oua-brush-row">',
    '  <label class="hm-oua-switch"><input type="checkbox" data-oua-brush="pressureWidth" checked>压感</label>',
    '  <label class="hm-oua-switch"><input type="checkbox" data-oua-brush="pressureOpacity" checked>压感浓度</label>',
    '  <label class="hm-oua-switch"><span>稳定器</span><select data-oua-brush="stabilizer" aria-label="稳定器">' + STAB_OPTS + '</select></label>',
    '</div>',
    '<details class="hm-oua-curve-wrap">',
    '  <summary>压感曲线 <span class="hm-oua-curve-info" data-oua-curve-info></span></summary>',
    '  <canvas class="hm-oua-curve" data-oua-curve></canvas>',
    '  <div class="hm-oua-presets">',
    '    <button type="button" data-oua-curve-preset="linear">线性</button>',
    '    <button type="button" data-oua-curve-preset="soft">柔和</button>',
    '    <button type="button" data-oua-curve-preset="hard">硬朗</button>',
    '    <button type="button" data-oua-curve-preset="s">S 型</button>',
    '    <button type="button" data-oua-curve-preset="default">默认</button>',
    '  </div>',
    '</details>'
  ].join('');

  var bodyEl = panel.querySelector('.hm-oua-lyr-body');
  if (bodyEl) bodyEl.insertBefore(brushEl, propsEl);

  var curveEl = brushEl.querySelector('[data-oua-curve]');
  var curveInfoEl = brushEl.querySelector('[data-oua-curve-info]');
  var noteEl = brushEl.querySelector('[data-oua-brush-note]');
  eng.attachCurve(curveEl);
  var curveWrap = brushEl.querySelector('.hm-oua-curve-wrap');
  if (curveWrap) {
    curveWrap.addEventListener('toggle', function () {
      if (curveWrap.open) requestAnimationFrame(function () { eng.redrawCurve(); });
    });
  }

  function curveText(points) {
    return points.map(function (p) {
      return Math.round(p[0] * 100) + '%→' + Math.round(p[1] * 100) + '%';
    }).join(' · ');
  }

  function pullBrush() {
    var o = eng.getOptions();
    var setVal = function (key, val) {
      var el = brushEl.querySelector('[data-oua-brush="' + key + '"]');
      if (el) el.value = val;
    };
    setVal('color', o.color);
    setVal('max', o.maxBrush);
    setVal('min', o.minBrush);
    setVal('opacity', Math.round(o.opacity * 100));
    setVal('stabilizer', o.stabilizer);
    var pw = brushEl.querySelector('[data-oua-brush="pressureWidth"]');
    var po = brushEl.querySelector('[data-oua-brush="pressureOpacity"]');
    if (pw) pw.checked = !!o.pressureWidth;
    if (po) po.checked = !!o.pressureOpacity;
    brushEl.querySelectorAll('[data-oua-tool]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-oua-tool') === o.tool);
    });
    var out = { max: o.maxBrush, min: o.minBrush, opacity: Math.round(o.opacity * 100) };
    Object.keys(out).forEach(function (k) {
      var el = brushEl.querySelector('[data-oua-out="' + k + '"]');
      if (el) el.textContent = k === 'opacity' ? out[k] + '%' : out[k] + 'px';
    });
    if (curveInfoEl) curveInfoEl.textContent = curveText(o.pressureCurve);
    if (noteEl) noteEl.textContent = sizeInfo.paper.label + ' · ' + round1(eng.getViewport().docWidth) + '×' + round1(eng.getViewport().docHeight) + 'mm';
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  brushEl.addEventListener('click', function (e) {
    var tool = e.target.closest('[data-oua-tool]');
    if (tool) {
      eng.setTool(tool.getAttribute('data-oua-tool'));
      pullBrush();
      return;
    }
    var act = e.target.closest('[data-oua-act]');
    if (act) {
      var name = act.getAttribute('data-oua-act');
      if (name === 'undo') eng.undo();
      else if (name === 'redo') eng.redo();
      pullBrush();
      return;
    }
    var preset = e.target.closest('[data-oua-curve-preset]');
    if (preset) {
      var key = preset.getAttribute('data-oua-curve-preset');
      var pts = key === 'default' ? window.OUACanvas.util.defaultCurve : window.OUACanvas.util.presets[key];
      if (pts) {
        eng.setOptions({ pressureCurve: pts });
        eng.redrawCurve();
        pullBrush();
      }
    }
  });

  brushEl.addEventListener('input', function (e) {
    var key = e.target.getAttribute && e.target.getAttribute('data-oua-brush');
    if (!key) return;
    var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (key === 'max') eng.setOptions({ maxBrush: Number(v) });
    else if (key === 'min') eng.setOptions({ minBrush: Number(v) });
    else if (key === 'opacity') eng.setOptions({ opacity: Number(v) / 100 });
    else if (key === 'color') eng.setOptions({ color: v });
    else if (key === 'stabilizer') eng.setOptions({ stabilizer: Number(v) });
    else if (key === 'pressureWidth') eng.setOptions({ pressureWidth: !!v });
    else if (key === 'pressureOpacity') eng.setOptions({ pressureOpacity: !!v });
    pullBrush();
  });
  brushEl.addEventListener('change', function (e) {
    var key = e.target.getAttribute && e.target.getAttribute('data-oua-brush');
    if (key === 'color') eng.setOptions({ color: e.target.value });
  });

  /* ---------------- 图层面板 ---------------- */
  var selBlend = propsEl ? propsEl.querySelector('select') : null;
  var rangeOpacity = propsEl ? propsEl.querySelector('input[type="range"]') : null;
  var numOpacity = propsEl ? propsEl.querySelector('.hm-oua-lyr-num') : null;

  if (selBlend) {
    var blends = [
      ['source-over', '正常'], ['multiply', '正片叠底'], ['screen', '滤色'],
      ['overlay', '叠加'], ['soft-light', '柔光'], ['color-dodge', '颜色减淡']
    ];
    selBlend.innerHTML = blends.map(function (b) {
      return '<option value="' + b[0] + '">' + b[1] + '</option>';
    }).join('');
  }

  var EYE_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M1.6 8S4.1 4.2 8 4.2 14.4 8 14.4 8 11.9 11.8 8 11.8 1.6 8 1.6 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>';

  function activeLayerId() {
    var layers = eng.getLayers();
    for (var i = 0; i < layers.length; i++) if (layers[i].active) return layers[i].id;
    return layers[0] ? layers[0].id : '';
  }

  function renderLayers() {
    var layers = eng.getLayers();
    if (countEl) countEl.textContent = String(layers.length);
    if (!layers.length) {
      listEl.innerHTML = '<div class="hm-oua-empty">还没有图层</div>';
      return;
    }
    var buf = [];
    /* getLayers() 已按「顶层在前」返回，直接渲染 */
    layers.forEach(function (l) {
      buf.push(
        '<div class="hm-oua-lyr-row' + (l.active ? ' is-active' : '') + (l.visible ? '' : ' is-off') + '" data-layer-id="' + l.id + '">' +
        '<button class="hm-oua-lyr-eye' + (l.visible ? '' : ' is-off') + '" type="button" data-layer-eye="' + l.id + '" title="显示 / 隐藏图层" aria-label="显示 / 隐藏图层">' + EYE_SVG + '</button>' +
        '<span class="hm-oua-lyr-thumb" data-kind="line"><i></i></span>' +
        '<span class="hm-oua-lyr-name" data-layer-name="' + l.id + '" title="双击重命名">' + escapeHtml(l.name) + '</span>' +
        '<span class="hm-oua-lyr-count">' + l.strokeCount + '</span>' +
        '</div>'
      );
    });
    listEl.innerHTML = buf.join('');
    syncProps();
  }

  function syncProps() {
    var layers = eng.getLayers();
    var cur = null;
    for (var i = 0; i < layers.length; i++) if (layers[i].active) cur = layers[i];
    if (!cur) return;
    if (rangeOpacity) rangeOpacity.value = Math.round(cur.opacity * 100);
    if (numOpacity) numOpacity.textContent = Math.round(cur.opacity * 100) + '%';
    if (selBlend) selBlend.value = cur.blend || 'source-over';
  }

  listEl.addEventListener('click', function (e) {
    var eye = e.target.closest('[data-layer-eye]');
    if (eye) {
      e.stopPropagation();
      var id = eye.getAttribute('data-layer-eye');
      var layers = eng.getLayers();
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].id === id) eng.setLayerVisible(id, !layers[i].visible);
      }
      return;
    }
    var row = e.target.closest('.hm-oua-lyr-row');
    if (row && !row.classList.contains('is-active')) eng.setActiveLayer(row.getAttribute('data-layer-id'));
  });

  listEl.addEventListener('dblclick', function (e) {
    var name = e.target.closest('[data-layer-name]');
    if (!name) return;
    var id = name.getAttribute('data-layer-name');
    name.contentEditable = 'true';
    name.focus();
    try { document.execCommand('selectAll', false, null); } catch (err) { /* ignore */ }
    var commit = function (cancel) {
      name.contentEditable = 'false';
      if (cancel) { renderLayers(); return; }
      eng.renameLayer(id, name.textContent.trim() || '图层');
    };
    name.addEventListener('blur', function () { commit(false); }, { once: true });
    name.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(true); }
    });
  });

  if (rangeOpacity) {
    rangeOpacity.addEventListener('input', function () {
      var id = activeLayerId();
      if (!id) return;
      eng.setLayerOpacity(id, Number(this.value) / 100);
      if (numOpacity) numOpacity.textContent = this.value + '%';
    });
  }
  if (selBlend) {
    selBlend.addEventListener('change', function () {
      var id = activeLayerId();
      if (id) eng.setLayerBlend(id, this.value);
    });
  }

  if (footEl) {
    footEl.innerHTML = [
      '<button class="hm-oua-lyr-fbtn" type="button" title="新建图层" aria-label="新建图层" data-layer-op="add"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M3.2 1.9h6.1l3.5 3.5v8.7H3.2z"/><path d="M8 6.9v4.2M5.9 9h4.2"/></svg></button>',
      '<button class="hm-oua-lyr-fbtn" type="button" title="复制图层" aria-label="复制图层" data-layer-op="dup"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="5.7" y="2.2" width="8.1" height="9.3" rx="1.1"/><rect x="2.2" y="4.5" width="8.1" height="9.3" rx="1.1"/></svg></button>',
      '<button class="hm-oua-lyr-fbtn" type="button" title="上移图层" aria-label="上移图层" data-layer-op="up"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.8V3.6M4.2 7.4 8 3.6l3.8 3.8"/></svg></button>',
      '<button class="hm-oua-lyr-fbtn" type="button" title="下移图层" aria-label="下移图层" data-layer-op="down"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.2v9.2M4.2 8.6 8 12.4l3.8-3.8"/></svg></button>',
      '<button class="hm-oua-lyr-fbtn is-danger" type="button" title="删除图层" aria-label="删除图层" data-layer-op="del"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.9 4.8h10.2M6.2 4.8V3.3h3.6v1.5M4.4 4.8l.7 8.6h5.8l.7-8.6"/><path d="M6.7 7.1v4M9.3 7.1v4"/></svg></button>'
    ].join('');
    footEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-layer-op]');
      if (!btn) return;
      var op = btn.getAttribute('data-layer-op');
      var id = activeLayerId();
      if (op === 'add') eng.addLayer();
      else if (op === 'dup') eng.duplicateLayer(id);
      /* 引擎数组首=画面最底层，数组尾=最顶层：上移=朝数组尾(+1)，下移=朝数组首(-1) */
      else if (op === 'up') eng.moveLayer(id, 1);
      else if (op === 'down') eng.moveLayer(id, -1);
      else if (op === 'del') eng.deleteLayer(id);
      renderLayers();
    });
  }

  /* ---------------- 时间轴：播放 / 帧 / 导出 ---------------- */
  var transportEl = root.querySelector('.oua-tl-transport');
  var infoEl = root.querySelector('.oua-tl-info');
  var playheadEl = root.querySelector('.oua-playhead');
  var rulerRow = root.querySelector('.oua-ruler-row');
  var trackRow = q('[data-oua-track-row="V1"]');
  var tcEl = null;
  var countLabel = null;
  var playBtn = null;
  var fpsSel = null;
  var onionBox = null;
  var pxPerSec = 100;

  if (transportEl) {
    transportEl.removeAttribute('aria-hidden');
    transportEl.innerHTML = [
      '<button class="oua-tl-btn is-step" type="button" data-oua-transport="prev" title="上一帧" aria-label="上一帧"></button>',
      '<button class="oua-tl-btn is-play" type="button" data-oua-transport="play" title="播放 / 暂停" aria-label="播放 / 暂停"></button>',
      '<button class="oua-tl-btn is-step is-next" type="button" data-oua-transport="next" title="下一帧" aria-label="下一帧"></button>',
      '<span class="oua-tl-tc" data-oua-tc>00:00:00:00</span>',
      '<span class="oua-tl-count" data-oua-count>1 / 1</span>'
    ].join('');
    tcEl = transportEl.querySelector('[data-oua-tc]');
    countLabel = transportEl.querySelector('[data-oua-count]');
    playBtn = transportEl.querySelector('[data-oua-transport="play"]');
  }

  if (infoEl) {
    infoEl.removeAttribute('aria-hidden');
    infoEl.innerHTML = [
      '<label class="oua-tl-mini">fps<select data-oua-fps aria-label="帧率"><option>8</option><option selected>12</option><option>24</option><option>25</option><option>30</option></select></label>',
      '<label class="oua-tl-check"><input type="checkbox" data-oua-onion>洋葱皮</label>',
      '<button class="oua-tl-action" type="button" data-oua-frame-op="add">＋帧</button>',
      '<button class="oua-tl-action" type="button" data-oua-frame-op="dup">复制帧</button>',
      '<button class="oua-tl-action" type="button" data-oua-frame-op="del">删除帧</button>',
      '<button class="oua-tl-action" type="button" data-oua-export="png">导出 PNG</button>',
      '<button class="oua-tl-action" type="button" data-oua-export="seq">序列 ZIP</button>'
    ].join('');
    fpsSel = infoEl.querySelector('[data-oua-fps]');
    onionBox = infoEl.querySelector('[data-oua-onion]');
  }

  function domainSeconds(frames, fps) {
    var total = 0;
    for (var i = 0; i < frames.length; i++) total += frames[i].dur;
    return Math.max(4, Math.ceil(total / fps) + 1);
  }

  function renderTimeline() {
    if (!trackRow) return;
    var frames = eng.getFrames();
    var fps = eng.getFps();
    var width = trackRow.clientWidth || 0;
    if (!width) return;
    var secs = domainSeconds(frames, fps);
    pxPerSec = width / secs;

    if (rulerRow) {
      var labels = [];
      var step = secs > 12 ? 2 : 1;
      for (var s = 0; s <= secs; s += step) {
        labels.push('<span class="oua-ruler-label" style="left:' + (s * pxPerSec) + 'px">00:' + (s < 10 ? '0' : '') + s + '</span>');
      }
      rulerRow.innerHTML = labels.join('');
    }

    var buf = [];
    frames.forEach(function (f) {
      var left = pxPerSec * f.start / fps;
      var w = Math.max(10, pxPerSec * f.dur / fps);
      buf.push('<div class="oua-clip' + (f.active ? ' is-current' : '') + '" data-frame-id="' + f.id +
        '" data-index="' + f.index + '" style="left:' + left + 'px;width:' + Math.max(6, w - 2) +
        'px" title="' + f.name + ' · ' + f.strokes + ' 笔">' + (f.index + 1) + '</div>');
    });
    trackRow.innerHTML = buf.join('');

    updateTime(eng.getTimeState());
    if (fpsSel) fpsSel.value = String(fps);
    if (onionBox) onionBox.checked = !!eng.getOnion().enabled;
  }

  function updateTime(ts) {
    if (!ts) return;
    if (tcEl) tcEl.textContent = ts.code;
    if (countLabel) {
      var frames = eng.getFrames();
      countLabel.textContent = (ts.frame + 1) + ' / ' + frames.length + ' 帧';
    }
    if (playheadEl) playheadEl.style.left = (pxPerSec * ts.time / ts.fps) + 'px';
    if (playBtn) playBtn.classList.toggle('is-playing', !!ts.playing);
    if (trackRow) {
      var clips = trackRow.querySelectorAll('.oua-clip');
      for (var i = 0; i < clips.length; i++) {
        clips[i].classList.toggle('is-current', Number(clips[i].getAttribute('data-index')) === ts.frame);
      }
    }
  }

  if (transportEl) {
    transportEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-oua-transport]');
      if (!btn) return;
      var act = btn.getAttribute('data-oua-transport');
      if (act === 'play') {
        eng.togglePlay();
      } else if (act === 'prev') {
        eng.pause();
        eng.stepFrame(-1);
      } else if (act === 'next') {
        eng.pause();
        eng.stepFrame(1);
      }
      updateTime(eng.getTimeState());
      renderTimeline();
    });
  }

  if (infoEl) {
    infoEl.addEventListener('click', function (e) {
      var fop = e.target.closest('[data-oua-frame-op]');
      if (fop) {
        var op = fop.getAttribute('data-oua-frame-op');
        if (op === 'add') eng.addFrame();
        else if (op === 'dup') eng.duplicateFrame();
        else if (op === 'del') eng.deleteFrame();
        renderLayers();
        renderTimeline();
        return;
      }
      var exp = e.target.closest('[data-oua-export]');
      if (exp) {
        var kind = exp.getAttribute('data-oua-export');
        try {
          if (kind === 'png') eng.downloadPNG('oua-frame-' + (eng.getTimeState().frame + 1));
          else eng.downloadSequenceZip('oua-sequence');
        } catch (err) {
          if (window.toast) window.toast('导出失败：' + err.message, 'error');
        }
      }
    });
    infoEl.addEventListener('change', function (e) {
      var fps = e.target.closest('[data-oua-fps]');
      if (fps) {
        eng.setFps(Number(fps.value));
        renderTimeline();
        return;
      }
      var onion = e.target.closest('[data-oua-onion]');
      if (onion) eng.setOnion({ enabled: onion.checked });
    });
  }

  if (trackRow) {
    var dragFrame = null;
    trackRow.addEventListener('pointerdown', function (e) {
      var clip = e.target.closest('.oua-clip');
      if (!clip) return;
      e.preventDefault();
      dragFrame = {
        id: clip.getAttribute('data-frame-id'),
        index: Number(clip.getAttribute('data-index')),
        x0: e.clientX,
        moved: false,
        clip: clip
      };
      clip.classList.add('is-drag');
      try { clip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    trackRow.addEventListener('pointermove', function (e) {
      if (!dragFrame) return;
      var dx = e.clientX - dragFrame.x0;
      if (Math.abs(dx) < 8) return;
      var frames = eng.getFrames();
      var cell = Math.max(6, pxPerSec / eng.getFps());
      var delta = Math.round(dx / cell);
      var to = clamp(dragFrame.index + delta, 0, frames.length - 1);
      if (to !== dragFrame.index) {
        eng.moveFrame(dragFrame.id, to);
        dragFrame.index = to;
        dragFrame.x0 = e.clientX;
        dragFrame.moved = true;
        renderTimeline();
      }
    });
    trackRow.addEventListener('pointerup', function () {
      if (!dragFrame) return;
      if (dragFrame.clip) dragFrame.clip.classList.remove('is-drag');
      if (!dragFrame.moved) eng.seekFrame(dragFrame.index);
      dragFrame = null;
      renderTimeline();
    });
    trackRow.addEventListener('pointercancel', function () {
      if (dragFrame && dragFrame.clip) dragFrame.clip.classList.remove('is-drag');
      dragFrame = null;
    });
  }

  /* ---------------- 三层框：安全框 / 扫描框拖拽 + 重置 ---------------- */
  var BOX_KEY = 'hm.oua.boxes.v1';
  var BOX_DEFAULT = {
    scan: { l: 2.5, t: 2.5, r: 2.5, b: 2.5 },
    safe: { l: 5, t: 5, r: 5, b: 5 }
  };
  var boxes = loadBoxes();

  function loadBoxes() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(BOX_KEY) || 'null'); } catch (e) { raw = null; }
    var out = {};
    ['scan', 'safe'].forEach(function (name) {
      var src = raw && raw[name] || {};
      var pick = function (key) {
        var v = Number(src[key]);
        return isFinite(v) && src[key] !== undefined && src[key] !== null ? clamp(v, 0, 60) : BOX_DEFAULT[name][key];
      };
      out[name] = { l: pick('l'), t: pick('t'), r: pick('r'), b: pick('b') };
    });
    return out;
  }

  function saveBoxes() {
    try { localStorage.setItem(BOX_KEY, JSON.stringify(boxes)); } catch (e) { /* ignore */ }
  }

  function applyBox(name) {
    var el = guidesEl.querySelector('[data-oua-box="' + name + '"]');
    if (!el) return;
    var b = boxes[name];
    el.style.left = b.l + '%';
    el.style.top = b.t + '%';
    el.style.right = b.r + '%';
    el.style.bottom = b.b + '%';
  }

  function buildBoxes() {
    var crop = '';
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      crop += '<i class="oua-crop is-' + c + '"></i>';
    });
    guidesEl.innerHTML =
      '<i class="oua-guide is-v"></i><i class="oua-guide is-h"></i>' +
      '<i class="oua-guide is-scan" data-oua-box="scan"><span class="oua-box-tag">SCAN</span></i>' +
      '<i class="oua-guide is-safe" data-oua-box="safe"><span class="oua-box-tag">SAFE</span></i>' +
      crop;
    ['scan', 'safe'].forEach(function (name) {
      var el = guidesEl.querySelector('[data-oua-box="' + name + '"]');
      ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
        var h = document.createElement('b');
        h.className = 'oua-box-handle';
        h.setAttribute('data-corner', c);
        h.setAttribute('data-handle-box', name);
        h.title = name.toUpperCase() + ' 框线';
        el.appendChild(h);
      });
      applyBox(name);
    });
  }

  function clampBox(name, nb) {
    var minSize = 8;
    if (name === 'scan') {
      nb.l = clamp(nb.l, 0, 60);
      nb.t = clamp(nb.t, 0, 60);
      nb.r = clamp(nb.r, 0, 60);
      nb.b = clamp(nb.b, 0, 60);
      if (nb.l + nb.r > 100 - minSize) nb.r = 100 - minSize - nb.l;
      if (nb.t + nb.b > 100 - minSize) nb.b = 100 - minSize - nb.t;
      return nb;
    }
    var s = boxes.scan;
    var maxL = 100 - s.r - minSize;
    var maxT = 100 - s.b - minSize;
    nb.l = clamp(nb.l, s.l + 0.5, maxL);
    nb.r = clamp(nb.r, s.r + 0.5, 100 - s.l - minSize);
    nb.t = clamp(nb.t, s.t + 0.5, maxT);
    nb.b = clamp(nb.b, s.b + 0.5, 100 - s.t - minSize);
    if (nb.l + nb.r > 100 - minSize) nb.r = 100 - minSize - nb.l;
    if (nb.t + nb.b > 100 - minSize) nb.b = 100 - minSize - nb.t;
    return nb;
  }

  guidesEl.addEventListener('pointerdown', function (e) {
    var handle = e.target.closest('.oua-box-handle');
    if (!handle) return;
    e.preventDefault();
    var name = handle.getAttribute('data-handle-box');
    var corner = handle.getAttribute('data-corner');
    var fr = frameEl.getBoundingClientRect();
    if (!fr.width || !fr.height) return;
    var startX = e.clientX, startY = e.clientY;
    var orig = assign({}, boxes[name]);
    var onMove = function (ev) {
      var dx = (ev.clientX - startX) / fr.width * 100;
      var dy = (ev.clientY - startY) / fr.height * 100;
      var nb = assign({}, orig);
      if (corner.indexOf('l') >= 0) nb.l = orig.l + dx;
      if (corner.indexOf('r') >= 0) nb.r = orig.r - dx;
      if (corner.indexOf('t') >= 0) nb.t = orig.t + dy;
      if (corner.indexOf('b') >= 0) nb.b = orig.b - dy;
      boxes[name] = clampBox(name, nb);
      applyBox(name);
    };
    var onUp = function () {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveBoxes();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  var resetBtn = q('[data-oua-box-reset]');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      boxes = {
        scan: assign({}, BOX_DEFAULT.scan),
        safe: assign({}, BOX_DEFAULT.safe)
      };
      applyBox('scan');
      applyBox('safe');
      saveBoxes();
    });
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  /* ---------------- 引擎事件 ---------------- */
  eng.on('layers', function () { renderLayers(); });
  eng.on('settings', function () { pullBrush(); });
  eng.on('frames', function () { renderLayers(); renderTimeline(); });
  var uiFrameIndex = -1;
  eng.on('time', function (ts) {
    if (ts && ts.frame !== uiFrameIndex) {
      uiFrameIndex = ts.frame;
      renderLayers();
    }
    updateTime(ts);
  });
  eng.on('stroke', function () { renderLayers(); });
  eng.on('change', function (info) {
    if (info && (info.reason === 'undo' || info.reason === 'redo')) {
      renderLayers();
      pullBrush();
    } else if (info && info.reason === 'curve') {
      pullBrush();
    }
  });

  /* ---------------- 初始化 ---------------- */
  buildBoxes();
  renderLayers();
  pullBrush();
  renderTimeline();
  if (transportEl) updateTime(eng.getTimeState());
})();
