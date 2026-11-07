'use strict';

/* =============================================================
 * 绘梦 · ToonCrafter 首尾帧补间（模块 09）
 * 真实推理：上传首帧/尾帧 → POST 到本地 ToonCrafter 推理服务
 * （插件/09-ToonCrafter首尾帧补间/服务/server.py，复用官方模型）
 * → 返回真实 mp4 → 页面播放 / 下载 / 抽帧导出
 * ============================================================= */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var API_LS = 'anidream.toon.api.v1';

  var state = {
    firstFile: null,
    lastFile: null,
    apiBase: 'http://127.0.0.1:7861',
    apiOk: false,
    busy: false,
    xhr: null,
    videoUrl: '',
    frames: [],
    idx: 0,
    playing: false,
    timer: null
  };

  function toast(msg, type) {
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type || 'info');
  }

  function apiBase() {
    return (($('tcApi') && $('tcApi').value) || state.apiBase).trim().replace(/\/+$/, '');
  }

  function setBadge(ok, text) {
    state.apiOk = ok;
    var b = $('tcMode');
    if (b) {
      b.textContent = text;
      b.classList.toggle('is-ok', ok);
    }
  }

  /* ---------------- 关键帧 ---------------- */
  function loadImage(file, key, thumbId) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      if (key === 'first') state.firstFile = file; else state.lastFile = file;
      var th = $(thumbId);
      if (th) { th.src = url; th.classList.add('is-loaded'); }
      var drop = th && th.closest('.tc-drop');
      if (drop) drop.classList.add('has-img');
      toast('已载入' + (key === 'first' ? '首帧' : '尾帧') + '（' + img.width + '×' + img.height + '）', 'success');
      drawPreview();
    };
    img.onerror = function () { toast('图片读取失败', 'error'); };
    img.src = url;
  }

  function drawPreview() {
    var cv = $('tcCanvas');
    if (!cv || state.videoUrl) return;
    var th = $('tcThumbFirst');
    if (!th || !th.src) return;
    var ctx = cv.getContext('2d');
    var img = new Image();
    img.onload = function () {
      cv.width = img.width; cv.height = img.height;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      var empty = $('tcStageEmpty');
      if (empty) empty.hidden = true;
      var meta = $('tcMeta');
      if (meta) meta.textContent = '首帧预览 ' + img.width + '×' + img.height + ' · 等待生成';
    };
    img.src = th.src;
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

  /* ---------------- 服务连通性 ---------------- */
  function testApi(silent) {
    var base = apiBase();
    var el = $('tcApiState');
    if (!base) { toast('请填写推理服务地址', 'error'); return; }
    if (window.location.protocol === 'https:' && base.indexOf('http://') === 0) {
      if (el) el.textContent = '被浏览器拦截（https 页面不能访问 http 本地服务）';
      setBadge(false, '请用本地版打开');
      if (!silent) toast('https 页面无法访问 http 本地推理服务，请打开本地单文件版或本机 http 服务', 'error');
      return;
    }
    if (el) el.textContent = '检测中…';
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 6000) : null;
    fetch(base + '/api/health', { signal: ctrl && ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (timer) window.clearTimeout(timer);
        if (!info || !info.ok) throw new Error('服务返回异常');
        var ok512 = info.checkpoints && info.checkpoints['320_512'];
        var text = '已连接 · ' + (info.device === 'cuda' ? (info.gpu || 'GPU') : 'CPU（很慢）');
        if (info.vram_gb) text += ' · ' + info.vram_gb + 'G';
        if (el) { el.textContent = text; el.classList.add('is-ok'); }
        setBadge(true, 'ToonCrafter 已连接');
        if (!silent) {
          toast('推理服务已连接' + (info.device === 'cuda' ? '（' + (info.gpu || 'GPU') + '）' : ''), 'success');
          if (!ok512) toast('提示：512 权重尚未下载，首次生成会自动拉取', 'info');
        }
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        if (el) { el.textContent = '未连接（' + (err && err.name === 'AbortError' ? '超时' : '拒绝连接') + '）'; el.classList.remove('is-ok'); }
        setBadge(false, '服务未连接');
        if (!silent) toast('无法连接推理服务，请确认已运行 server.py', 'error');
      });
  }

  /* ---------------- 真实推理 ---------------- */
  function setBusy(busy) {
    state.busy = busy;
    var gen = $('tcGenBtn'), stop = $('tcStopBtn');
    if (gen) { gen.disabled = busy; gen.textContent = busy ? '推理中…' : '✨ 生成补间（真实推理）'; }
    if (stop) stop.hidden = !busy;
  }

  function generate() {
    if (!state.firstFile || !state.lastFile) { toast('请先上传首帧与尾帧', 'error'); return; }
    if (state.busy) return;
    if (!state.apiOk) { testApi(true); }

    var base = apiBase();
    var fd = new FormData();
    fd.append('first', state.firstFile);
    fd.append('last', state.lastFile);
    fd.append('prompt', ($('tcPrompt') || {}).value || 'an anime scene');
    fd.append('steps', ($('tcSteps') || {}).value || '50');
    fd.append('cfg', ($('tcCfg') || {}).value || '7.5');
    fd.append('eta', ($('tcEta') || {}).value || '1.0');
    fd.append('fs', ($('tcFs') || {}).value || '10');
    fd.append('seed', ($('tcSeed') || {}).value || '123');
    fd.append('resolution', ($('tcRes') || {}).value || '320_512');

    setBusy(true);
    var t0 = Date.now();
    var meta = $('tcMeta');
    var timer = window.setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      if (meta) meta.textContent = '推理中… ' + s + 's（首次含权重加载，可能 1–3 分钟）';
    }, 500);

    var xhr = new XMLHttpRequest();
    state.xhr = xhr;
    xhr.open('POST', base + '/api/interpolate', true);
    xhr.responseType = 'json';
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable && meta) {
        meta.textContent = '上传关键帧 ' + Math.round((e.loaded / e.total) * 100) + '%';
      }
    };
    xhr.onload = function () {
      window.clearInterval(timer);
      setBusy(false);
      state.xhr = null;
      var data = xhr.response;
      if (!data) {
        try { data = JSON.parse(xhr.responseText); } catch (err) { data = null; }
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
        var url = data.video.indexOf('http') === 0 ? data.video : base + data.video;
        onGenerated(url, data, base);
      } else {
        var msg = (data && data.error) || ('HTTP ' + xhr.status);
        if (meta) meta.textContent = '生成失败：' + msg;
        toast('生成失败：' + msg, 'error');
      }
    };
    xhr.onerror = function () {
      window.clearInterval(timer);
      setBusy(false);
      state.xhr = null;
      if (meta) meta.textContent = '连接中断';
      toast('连接推理服务失败（检查地址 / CORS / 服务是否运行）', 'error');
    };
    xhr.onabort = function () {
      window.clearInterval(timer);
      setBusy(false);
      state.xhr = null;
      if (meta) meta.textContent = '已停止生成';
      toast('已停止生成', 'info');
    };
    xhr.send(fd);
  }

  function stopGenerate() {
    if (state.xhr) { try { state.xhr.abort(); } catch (e) {} }
  }

  function onGenerated(url, data, base) {
    state.videoUrl = url;
    var video = $('tcVideo'), cv = $('tcCanvas'), empty = $('tcStageEmpty');
    if (cv) cv.hidden = true;
    if (empty) empty.hidden = true;
    if (video) {
      video.hidden = false;
      video.src = url;
      var pr = video.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    var meta = $('tcMeta');
    if (meta) {
      meta.textContent = '完成 · ' + data.elapsed + 's · ' + data.resolution.replace('_', '×')
        + ' · ' + data.steps + ' 步 · ' + data.fps + ' fps';
    }
    toast('真实推理完成，用时 ' + data.elapsed + 's', 'success');
    extractFrames(base);
  }

  /* 从生成的真实视频抽帧，做时间轴缩略图 */
  function extractFrames(base) {
    var video = $('tcVideo');
    if (!video) return;
    state.frames = [];
    state.idx = 0;
    function sample() {
      var dur = video.duration || 0;
      if (!dur || !isFinite(dur)) return;
      var n = Math.min(24, Math.max(8, Math.round(dur * 8)));
      var cv = document.createElement('canvas');
      var vw = video.videoWidth || 512, vh = video.videoHeight || 320;
      var scale = Math.min(1, 256 / vw);
      cv.width = Math.round(vw * scale); cv.height = Math.round(vh * scale);
      var ctx = cv.getContext('2d');
      var done = 0;
      for (var i = 0; i < n; i++) {
        (function (i) {
          var t = (dur * i) / (n - 1 || 1);
          video.currentTime = Math.min(dur - 0.02, t);
          video.onseeked = function () {
            ctx.drawImage(video, 0, 0, cv.width, cv.height);
            state.frames[i] = cv.toDataURL('image/jpeg', 0.72);
            done++;
            if (done === n) {
              video.currentTime = 0;
              video.onseeked = null;
              renderTimeline();
              updateMeta();
            }
          };
        })(i);
      }
    }
    if (video.readyState >= 1) sample();
    else video.addEventListener('loadedmetadata', sample, { once: true });
  }

  function renderTimeline() {
    var box = $('tcTimeline');
    if (!box) return;
    box.innerHTML = state.frames.map(function (src, i) {
      if (!src) return '';
      var label = i === 0 ? '首' : (i === state.frames.length - 1 ? '尾' : String(i));
      return '<button class="tc-frame" data-i="' + i + '" type="button">'
        + '<img src="' + src + '" alt="">'
        + '<span>' + label + '</span></button>';
    }).join('');
  }

  function updateMeta() {
    var v = $('tcVideo');
    if (!v || !state.frames.length) return;
    var meta = $('tcMeta');
    if (meta) {
      meta.textContent = state.frames.length + ' 帧缩略 · ' + (v.videoWidth || 0) + '×' + (v.videoHeight || 0)
        + ' · ' + (v.duration ? v.duration.toFixed(2) : '0') + 's';
    }
  }

  function playPause() {
    var v = $('tcVideo');
    if (!state.videoUrl || !v) { toast('请先生成补间视频', 'error'); return; }
    if (v.paused) {
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () {});
    } else { v.pause(); }
  }

  function saveVideo() {
    if (!state.videoUrl) { toast('请先生成补间视频', 'error'); return; }
    fetch(state.videoUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tooncrafter_' + Date.now() + '.mp4';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('视频已下载', 'success');
    }).catch(function () {
      window.open(state.videoUrl, '_blank');
    });
  }

  function exportPng() {
    var v = $('tcVideo');
    if (!state.videoUrl || !v) { toast('请先生成补间视频', 'error'); return; }
    var cv = document.createElement('canvas');
    cv.width = v.videoWidth || 512; cv.height = v.videoHeight || 320;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'tooncrafter_frame.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function exportZip() {
    if (!state.frames.length) { toast('请先生成补间视频', 'error'); return; }
    if (!window.JSZip) { toast('ZIP 组件未加载', 'error'); return; }
    var zip = new window.JSZip();
    state.frames.forEach(function (src, i) {
      if (!src) return;
      zip.file('frame_' + String(i + 1).padStart(4, '0') + '.jpg', src.split(',')[1], { base64: true });
    });
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tooncrafter_frames.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('已导出 ' + state.frames.length + ' 帧', 'success');
    });
  }

  function deployCommand() {
    return [
      '# 1) 安装（首次）',
      'cd 插件/09-ToonCrafter首尾帧补间/服务 && bash install.sh',
      '# 2) 启动推理服务',
      'source .venv/bin/activate && python server.py --port 7861 --warmup 320_512',
      '# 3) 页面「推理服务」填 http://127.0.0.1:7861 → 连接测试 → 生成'
    ].join('\n');
  }

  function copyCmd() {
    var text = deployCommand();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('部署命令已复制', 'success'); },
        function () { toast('复制失败，请手动选择文本', 'error'); });
    } else {
      toast('复制失败，请手动选择文本', 'error');
    }
  }

  function bind() {
    bindDrop('tcDropFirst', 'tcFileFirst', 'first', 'tcThumbFirst');
    bindDrop('tcDropLast', 'tcFileLast', 'last', 'tcThumbLast');

    $('tcGenBtn').addEventListener('click', generate);
    $('tcStopBtn').addEventListener('click', stopGenerate);
    $('tcPlayBtn').addEventListener('click', playPause);
    $('tcSaveVideoBtn').addEventListener('click', saveVideo);
    $('tcExportZipBtn').addEventListener('click', exportZip);
    $('tcExportPngBtn').addEventListener('click', exportPng);
    $('tcCmdBtn').addEventListener('click', copyCmd);
    $('tcApiTest').addEventListener('click', function () { testApi(false); });

    [['tcSteps', 'tcStepsVal', ''], ['tcCfg', 'tcCfgVal', ''], ['tcEta', 'tcEtaVal', ''],
     ['tcFs', 'tcFsVal', ''], ['tcSeed', 'tcSeedVal', '']].forEach(function (p) {
      var el = $(p[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        var b = $(p[1]);
        if (b) b.textContent = el.value;
      });
    });

    var api = $('tcApi');
    if (api) {
      try { var saved = localStorage.getItem(API_LS); if (saved) api.value = saved; } catch (e) {}
      api.addEventListener('change', function () {
        try { localStorage.setItem(API_LS, api.value.trim()); } catch (e) {}
        testApi(true);
      });
    }

    var video = $('tcVideo');
    if (video) {
      video.addEventListener('play', function () {
        state.playing = true;
        var b = $('tcPlayBtn'); if (b) b.textContent = '⏸ 暂停';
      });
      video.addEventListener('pause', function () {
        state.playing = false;
        var b = $('tcPlayBtn'); if (b) b.textContent = '▶ 播放';
      });
      video.addEventListener('timeupdate', updateMeta);
    }

    var timeline = $('tcTimeline');
    if (timeline) timeline.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      var v = $('tcVideo');
      var i = parseInt(b.dataset.i, 10);
      if (v && v.duration && state.frames.length > 1) {
        v.currentTime = (v.duration * i) / (state.frames.length - 1);
      }
      var items = timeline.querySelectorAll('.tc-frame');
      for (var k = 0; k < items.length; k++) items[k].classList.toggle('is-active', k === i);
    });

    document.addEventListener('keydown', function (e) {
      if (document.body.dataset.view !== 'tooltoon') return;
      if (e.key === ' ') { e.preventDefault(); playPause(); }
    });

    var cmd = $('tcCmd');
    if (cmd) cmd.textContent = deployCommand();
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    bind();
    testApi(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.getElementById('view-tooltoon')) boot();
    });
  } else if (document.getElementById('view-tooltoon')) boot();

  window.HMToon = {
    stop: function () {
      var v = $('tcVideo');
      if (v && !v.paused) v.pause();
      stopGenerate();
      if (window.speechSynthesis) { /* noop */ }
    },
    leave: function () {
      var v = $('tcVideo');
      if (v && !v.paused) v.pause();
    }
  };
})();
