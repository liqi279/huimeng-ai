'use strict';

/* =============================================================
 * 绘梦 · ToonCrafter 首尾帧补间（模块 09）
 * 数据/代码来源：插件/09-ToonCrafter首尾帧补间（ToonCrafter 官方仓库）
 * 浏览器端提供「预演」：按缓动曲线重建中间帧、时间轴、循环播放、
 * 帧序列 ZIP 导出；同时给出本地官方推理命令与接口连通性检测。
 * ============================================================= */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    first: null,        // Image
    last: null,         // Image
    frames: [],         // dataURL
    idx: 0,
    playing: false,
    timer: null,
    apiOk: false,
    w: 512,
    h: 320
  };

  function ease(t) {
    var mode = ($('tcEase') || {}).value || 'ease';
    if (mode === 'linear') return t;
    if (mode === 'zoom') return t;
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function toast(msg, type) {
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type || 'info');
  }

  /* 等比裁切绘制（cover），zoom 模式下首帧轻微放大 */
  function drawCover(ctx, img, w, h, scale, alpha) {
    if (!img) return;
    var s = Math.max(w / img.width, h / img.height) * (scale || 1);
    var dw = img.width * s, dh = img.height * s;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  }

  function drawAt(ctx, t) {
    var w = state.w, h = state.h;
    ctx.clearRect(0, 0, w, h);
    var e = ease(t);
    var mode = ($('tcEase') || {}).value || 'ease';
    if (mode === 'zoom') {
      drawCover(ctx, state.first, w, h, 1 + e * 0.12, 1 - e);
      drawCover(ctx, state.last, w, h, 1 + e * 0.12, e);
    } else {
      drawCover(ctx, state.first, w, h, 1, 1 - e);
      drawCover(ctx, state.last, w, h, 1, e);
    }
  }

  function setSize() {
    var v = ($('tcSize') || {}).value || '512x320';
    var parts = v.split('x');
    state.w = parseInt(parts[0], 10);
    state.h = parseInt(parts[1], 10);
    var cv = $('tcCanvas');
    if (cv) { cv.width = state.w; cv.height = state.h; }
  }

  function loadImage(file, key, thumbId) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state[key] = img;
      var th = $(thumbId);
      if (th) { th.src = url; th.classList.add('is-loaded'); }
      var drop = $(thumbId).closest('.tc-drop');
      if (drop) drop.classList.add('has-img');
      toast('已载入' + (key === 'first' ? '首帧' : '尾帧'), 'success');
    };
    img.onerror = function () { toast('图片读取失败', 'error'); };
    img.src = url;
  }

  function bindDrop(dropId, fileId, key, thumbId) {
    var drop = $(dropId), input = $(fileId);
    if (!drop || !input) return;
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) loadImage(input.files[0], key, thumbId);
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImage(f, key, thumbId);
    });
  }

  function frameCount() { return parseInt($('tcFrames').value, 10) + 2; }

  function generate() {
    if (!state.first || !state.last) { toast('请先上传首帧与尾帧', 'error'); return; }
    stopPlay();
    setSize();
    var cv = $('tcCanvas');
    var ctx = cv.getContext('2d');
    var total = frameCount();
    state.frames = [];
    for (var i = 0; i < total; i++) {
      var t = total === 1 ? 0 : i / (total - 1);
      drawAt(ctx, t);
      state.frames.push(cv.toDataURL('image/png'));
    }
    state.idx = 0;
    $('tcStageEmpty').hidden = true;
    renderTimeline();
    showFrame(0);
    updateMeta();
    toast('已生成 ' + total + ' 帧（含首尾帧）', 'success');
  }

  function showFrame(i) {
    if (!state.frames.length) return;
    state.idx = Math.max(0, Math.min(state.frames.length - 1, i));
    var cv = $('tcCanvas');
    var ctx = cv.getContext('2d');
    var img = new Image();
    img.onload = function () { ctx.clearRect(0, 0, state.w, state.h); ctx.drawImage(img, 0, 0, state.w, state.h); };
    img.src = state.frames[state.idx];
    var items = $('tcTimeline').querySelectorAll('.tc-frame');
    for (var k = 0; k < items.length; k++) items[k].classList.toggle('is-active', k === state.idx);
    var meta = $('tcMeta');
    if (meta) meta.textContent = '第 ' + (state.idx + 1) + ' / ' + state.frames.length + ' 帧 · ' + state.w + '×' + state.h;
  }

  function renderTimeline() {
    var box = $('tcTimeline');
    if (!box) return;
    box.innerHTML = state.frames.map(function (src, i) {
      var label = i === 0 ? '首' : (i === state.frames.length - 1 ? '尾' : String(i));
      return '<button class="tc-frame" data-i="' + i + '" type="button">'
        + '<img src="' + src + '" alt="">'
        + '<span>' + label + '</span></button>';
    }).join('');
  }

  function updateMeta() {
    var meta = $('tcMeta');
    if (meta) meta.textContent = state.frames.length
      ? ('共 ' + state.frames.length + ' 帧 · ' + state.w + '×' + state.h + ' · ' + $('tcFps').value + ' fps')
      : '—';
  }

  function play() {
    if (!state.frames.length) { toast('请先生成补间帧', 'error'); return; }
    if (state.playing) { stopPlay(); return; }
    state.playing = true;
    $('tcPlayBtn').textContent = '⏸ 暂停';
    var fps = parseInt($('tcFps').value, 10) || 12;
    state.timer = window.setInterval(function () {
      showFrame((state.idx + 1) % state.frames.length);
    }, Math.round(1000 / fps));
  }

  function stopPlay() {
    state.playing = false;
    if (state.timer) { window.clearInterval(state.timer); state.timer = null; }
    var b = $('tcPlayBtn');
    if (b) b.textContent = '▶ 播放';
  }

  function download(name, url) {
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
  }

  function exportPng() {
    if (!state.frames.length) { toast('请先生成补间帧', 'error'); return; }
    download('tooncrafter_frame_' + String(state.idx + 1).padStart(4, '0') + '.png', state.frames[state.idx]);
  }

  function exportZip() {
    if (!state.frames.length) { toast('请先生成补间帧', 'error'); return; }
    if (!window.JSZip) { toast('ZIP 组件未加载', 'error'); return; }
    var zip = new window.JSZip();
    state.frames.forEach(function (src, i) {
      zip.file('frame_' + String(i + 1).padStart(4, '0') + '.png', src.split(',')[1], { base64: true });
    });
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      download('tooncrafter_frames.zip', URL.createObjectURL(blob));
      toast('已导出 ' + state.frames.length + ' 帧', 'success');
    });
  }

  function commandText() {
    return 'python scripts/infer.py -i 首帧.png 尾帧.png -o ./results --frame_num '
      + $('tcFrames').value + ' --ddim_steps ' + $('tcSteps').value
      + ' --resolution ' + state.w + 'x' + state.h;
  }

  function syncCmd() {
    var pre = $('tcCmd');
    if (pre) pre.textContent = commandText();
  }

  function copyCmd() {
    var text = commandText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('推理命令已复制', 'success'); },
        function () { toast('复制失败，请手动选择文本', 'error'); });
    } else {
      toast('复制失败，请手动选择文本', 'error');
    }
  }

  function testApi() {
    var base = ($('tcApi').value || '').replace(/\/+$/, '');
    var el = $('tcApiState');
    if (!base) { toast('请填写本地服务地址', 'error'); return; }
    if (el) el.textContent = '检测中…';
    var done = false;
    var timer = window.setTimeout(function () {
      if (done) return;
      done = true;
      state.apiOk = false;
      if (el) { el.textContent = '未连接 · 使用浏览器预演'; el.classList.remove('is-ok'); }
    }, 4000);
    fetch(base, { method: 'GET', mode: 'cors' }).then(function () {
      if (done) return;
      done = true; window.clearTimeout(timer);
      state.apiOk = true;
      if (el) { el.textContent = '已连接'; el.classList.add('is-ok'); }
      var badge = $('tcMode');
      if (badge) { badge.textContent = '本地 ToonCrafter'; badge.classList.add('is-ok'); }
      toast('本地 ToonCrafter 服务可达', 'success');
    }).catch(function () {
      if (done) return;
      done = true; window.clearTimeout(timer);
      state.apiOk = false;
      if (el) { el.textContent = '未连接 · 使用浏览器预演'; el.classList.remove('is-ok'); }
      toast('本地服务不可达（需先启动 gradio_app.py）', 'error');
    });
  }

  function bind() {
    bindDrop('tcDropFirst', 'tcFileFirst', 'first', 'tcThumbFirst');
    bindDrop('tcDropLast', 'tcFileLast', 'last', 'tcThumbLast');

    $('tcGenBtn').addEventListener('click', generate);
    $('tcPlayBtn').addEventListener('click', play);
    $('tcExportZipBtn').addEventListener('click', exportZip);
    $('tcExportPngBtn').addEventListener('click', exportPng);
    $('tcCmdBtn').addEventListener('click', copyCmd);
    $('tcApiTest').addEventListener('click', testApi);

    $('tcFrames').addEventListener('input', function () {
      $('tcFramesVal').textContent = this.value; syncCmd();
    });
    $('tcSteps').addEventListener('input', function () {
      $('tcStepsVal').textContent = this.value; syncCmd();
    });
    $('tcFps').addEventListener('input', function () {
      $('tcFpsVal').textContent = this.value + ' fps';
      updateMeta();
      if (state.playing) { stopPlay(); play(); }
    });
    $('tcSize').addEventListener('change', function () { setSize(); updateMeta(); syncCmd(); });
    $('tcEase').addEventListener('change', function () { if (state.frames.length) generate(); });

    $('tcTimeline').addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      stopPlay();
      showFrame(parseInt(b.dataset.i, 10));
    });

    document.addEventListener('keydown', function (e) {
      if (document.body.dataset.view !== 'tooltoon') return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      if (e.key === 'ArrowRight') { stopPlay(); showFrame(state.idx + 1); }
      if (e.key === 'ArrowLeft') { stopPlay(); showFrame(state.idx - 1); }
    });
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    setSize();
    bind();
    syncCmd();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.getElementById('view-tooltoon')) boot();
    });
  } else if (document.getElementById('view-tooltoon')) boot();

  window.HMToon = {
    stop: stopPlay,
    leave: stopPlay
  };
})();
