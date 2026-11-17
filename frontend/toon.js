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
    timer: null,
    rec: null,
    localCancel: false,
    localDuration: 0,
    isLocalVideo: false
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
      if (el) el.textContent = '被浏览器拦截（https 页面不能访问 http 本地服务）· 可本地补间生成';
      setBadge(false, '本地补间可用（未连 GPU）');
      if (!silent) toast('https 页面无法访问 http 本地推理服务，已启用本地快速补间；真实推理请用本地版打开', 'error');
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
        var timeout = err && err.name === 'AbortError';
        var httpsPage = window.location.protocol === 'https:';
        var reason = timeout ? '超时' : (httpsPage ? '被浏览器拦截 / 服务未启动' : '拒绝连接');
        if (el) {
          el.textContent = '未连接（' + reason + '）' + (httpsPage ? ' · 见下方提示' : '');
          el.classList.remove('is-ok');
        }
        setBadge(false, '服务未连接');
        if (!silent) {
          if (httpsPage) {
            toast('线上 https 页面直连本机 http 服务常被拦截：请下载本地单文件版打开，或改用 HTTPS 推理服务', 'error');
          } else if (timeout) {
            toast('连接超时：确认 server.py 已启动且端口为 ' + base.split(':').pop(), 'error');
          } else {
            toast('无法连接推理服务：请先运行 server.py，并确认地址 ' + base, 'error');
          }
        }
      });
  }

  /* ---------------- 真实推理 ---------------- */
  function setBusy(busy) {
    state.busy = busy;
    var gen = $('tcGenBtn'), stop = $('tcStopBtn');
    if (gen) { gen.disabled = busy; gen.textContent = busy ? '推理中…' : (localTweenBlocked() ? '✨ 生成补间（本地快速）' : '✨ 生成补间（真实推理）'); }
    if (stop) stop.hidden = !busy;
  }

  /* https 页面无法访问 http://127.0.0.1（Chrome 直接按 loopback 地址空间拦截），
     此时改用浏览器内交叉淡化生成，不再把按钮做成「看起来能点、实际必然失败」。 */
  function localTweenBlocked() {
    return window.location.protocol === 'https:' && /^http:\/\//i.test(apiBase());
  }

  var TC_RES = { '320_512': [512, 320], '256_256': [256, 256], '576_1024': [1024, 576] };

  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('关键帧读取失败')); };
      img.src = src;
    });
  }

  function drawCover(ctx, img, w, h) {
    var s = Math.max(w / img.width, h / img.height);
    var dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /* 线上兜底：首尾帧交叉淡化 → canvas 逐帧 → MediaRecorder 编码为视频 */
  function generateLocalTween() {
    if (!state.firstFile || !state.lastFile) { toast('请先上传首帧与尾帧', 'error'); return; }
    var first = $('tcThumbFirst'), last = $('tcThumbLast');
    if (!first || !last || !first.src || !last.src) { toast('关键帧尚未载入', 'error'); return; }
    if (state.busy) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      toast('当前浏览器不支持本地视频编码，请下载本地版连接 GPU 推理服务', 'error');
      return;
    }

    var fps = Math.max(5, Math.min(30, parseInt(($('tcFs') || {}).value, 10) || 10));
    var resKey = ($('tcRes') || {}).value || '320_512';
    var size = TC_RES[resKey] || TC_RES['320_512'];
    var W = size[0], H = size[1];

    setBusy(true);
    state.localCancel = false;
    var t0 = Date.now();
    var meta = $('tcMeta');
    if (meta) meta.textContent = '本地补间生成中…';

    Promise.all([loadImg(first.src), loadImg(last.src)]).then(function (imgs) {
      var attempt = 0;
      var thumbs = [];
      function buildThumbs() {
        var tcv = document.createElement('canvas');
        tcv.width = Math.max(2, Math.round(W / 2));
        tcv.height = Math.max(2, Math.round(H / 2));
        var tctx = tcv.getContext('2d');
        thumbs = [];
        for (var j = 0; j < 9; j++) {
          var kk = (j / 8) * (j / 8) * (3 - 2 * (j / 8));
          tctx.fillStyle = '#000';
          tctx.fillRect(0, 0, tcv.width, tcv.height);
          tctx.globalAlpha = 1;
          drawCover(tctx, imgs[0], tcv.width, tcv.height);
          tctx.globalAlpha = kk;
          drawCover(tctx, imgs[1], tcv.width, tcv.height);
          tctx.globalAlpha = 1;
          thumbs.push(tcv.toDataURL('image/jpeg', 0.72));
        }
      }
      /* 浏览器首次 canvas 录制常拿不到帧（空 blob），失败自动重试 */
      function recordOnce() {
        attempt++;
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        /* 挂到屏幕外并保持真实尺寸，否则部分 Chrome 版本 captureStream 一帧都录不到 */
        cv.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + W + 'px;height:' + H + 'px;pointer-events:none;';
        document.body.appendChild(cv);
        var ctx = cv.getContext('2d');
        var stream = cv.captureStream(fps);
        var mime = '';
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].some(function (m) {
          if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
          return false;
        });
        var chunks = [];
        var rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : undefined);
        state.rec = rec;
        var total = Math.max(6, Math.round(fps * 1.6));
        var i = 0;
        var step = Math.ceil(1000 / fps);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          state.rec = null;
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          if (cv.parentNode) cv.parentNode.removeChild(cv);
          if (state.localCancel) {
            state.localCancel = false;
            setBusy(false);
            if (meta) meta.textContent = '已停止生成';
            toast('已停止生成', 'info');
            return;
          }
          var blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
          if (blob.size < 2000) {
            if (attempt < 3) {
              if (meta) meta.textContent = '本地补间生成中…（重试 ' + attempt + '/3）';
              window.setTimeout(recordOnce, 150);
              return;
            }
            setBusy(false);
            if (meta) meta.textContent = '本地补间未生成：浏览器未录到帧，请再点一次「生成补间」';
            toast('本地补间未生成，请再点一次「生成补间」重试', 'error');
            return;
          }
          /* 录制期间不能对同一 canvas 调 toDataURL（会让 captureStream 丢帧），停止后再生成缩略图 */
          buildThumbs();
          var url = URL.createObjectURL(blob);
          setBusy(false);
          onGenerated(url, {
            elapsed: ((Date.now() - t0) / 1000).toFixed(1),
            resolution: resKey,
            steps: '本地',
            fps: fps,
            duration: total / fps,
            thumbs: thumbs.slice(),
            local: true
          }, apiBase());
          toast('未连接 GPU 推理服务，已用本地交叉淡化生成补间', 'info');
        };
        function frame() {
          var t = total <= 1 ? 1 : i / (total - 1);
          var k = t * t * (3 - 2 * t); /* 缓入缓出 */
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          drawCover(ctx, imgs[0], W, H);
          ctx.globalAlpha = k;
          drawCover(ctx, imgs[1], W, H);
          ctx.globalAlpha = 1;
          if (++i >= total) { window.setTimeout(function () { try { rec.stop(); } catch (e) {} }, step); return; }
          window.setTimeout(frame, step);
        }
        rec.start();
        frame();
      }
      recordOnce();
    }).catch(function (err) {
      setBusy(false);
      if (meta) meta.textContent = '生成失败：' + (err && err.message || err);
      toast('本地补间失败：' + (err && err.message || err), 'error');
    });
  }

  function generate() {
    if (!state.firstFile || !state.lastFile) { toast('请先上传首帧与尾帧', 'error'); return; }
    if (state.busy) return;
    /* https 线上页访问 http 本机服务必被浏览器拦截，直接走本地补间，避免「点了没反应」 */
    if (localTweenBlocked()) { generateLocalTween(); return; }
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
    if (state.rec) {
      state.localCancel = true;
      try { state.rec.stop(); } catch (e) {}
      return;
    }
    if (state.xhr) { try { state.xhr.abort(); } catch (e) {} }
  }

  function onGenerated(url, data, base) {
    state.videoUrl = url;
    state.isLocalVideo = !!data.local;
    state.localDuration = data.local ? (data.duration || 0) : 0;
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
      meta.textContent = (data.local ? '本地补间（未连 GPU）' : '完成') + ' · ' + data.elapsed + 's · ' + data.resolution.replace('_', '×')
        + ' · ' + (data.local ? '交叉淡化' : data.steps + ' 步') + ' · ' + data.fps + ' fps';
    }
    toast(data.local ? ('本地补间已生成，用时 ' + data.elapsed + 's') : ('真实推理完成，用时 ' + data.elapsed + 's'), 'success');
    if (data.local && data.thumbs && data.thumbs.length) {
      /* 本地视频没有 duration 元数据，直接用生成时截下的帧做时间轴 */
      state.frames = data.thumbs.slice();
      state.idx = 0;
      renderTimeline();
    } else {
      extractFrames(base);
    }
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
    if (meta && state.isLocalVideo) {
      meta.textContent = '本地补间（未连 GPU） · ' + state.frames.length + ' 帧缩略 · '
        + (v.videoWidth || 0) + '×' + (v.videoHeight || 0) + ' · ' + (state.localDuration || 0).toFixed(1) + 's';
      return;
    }
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
      a.download = 'tooncrafter_' + Date.now() + (/mp4/.test(blob.type || '') ? '.mp4' : '.webm');
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
      var applySaved = function () {
        var A = window.HMApp;
        var cloud = (A && A.state && A.state.toonApi) || '';
        var saved = cloud || localStorage.getItem(API_LS) || '';
        if (saved) api.value = saved;
        if (saved) state.apiBase = saved;
      };
      try { applySaved(); } catch (e) {}
      api.addEventListener('change', function () {
        var v = api.value.trim();
        state.apiBase = v;
        try { localStorage.setItem(API_LS, v); } catch (e) {}
        var A = window.HMApp;
        if (A && A.state) A.state.toonApi = v;
        if (A && A.persistPrefs) A.persistPrefs();
        if (!state.busy) setBusy(false);
        if (v) testApi(true); else setBadge(false, '服务未连接');
      });
      /* 云端 prefs 到达时刷新地址 */
      document.addEventListener('hm:prefs', function () {
        try {
          var A = window.HMApp;
          var v = (A && A.state && A.state.toonApi) || '';
          if (v && v !== api.value) { api.value = v; state.apiBase = v; testApi(true); }
        } catch (e) {}
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
      var dur = (v && isFinite(v.duration) && v.duration) ? v.duration : (state.localDuration || 0);
      if (v && dur && state.frames.length > 1) {
        v.currentTime = (dur * i) / (state.frames.length - 1);
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
    setBusy(false);
    if (localTweenBlocked()) {
      var empty = $('tcStageEmpty');
      if (empty) empty.textContent = '上传首尾帧后点击「生成补间」：线上版用本地补间，本地版用 GPU 真实推理';
    }
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

/* =============================================================
 * 首尾帧补间 Pro（AnimateDiff 扩散补间 + 纯插帧）
 * 服务：GET /api/health · POST /api/warmup
 *       POST /api/interpolate（multipart：first/last/prompt/steps/cfg/eta/fs/seed/resolution/mode）
 *       GET  /results/<name>.mp4
 * 默认地址 http://127.0.0.1:7862，与 :7861 的 ToonCrafter 并存
 * ============================================================= */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var LS = 'anidream.toon2.api.v1';
  var DEFAULT_BASE = 'http://127.0.0.1:7862';
  var state = { mode: 'diffusion', first: null, last: null, apiOk: false, busy: false, xhr: null, url: '' };

  function toast(msg, type) {
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type || 'info');
  }
  function base() {
    var el = $('t2Api');
    var A = window.HMApp;
    var v = String((el && el.value) || (A && A.state && A.state.toon2Api) ||
      localStorage.getItem(LS) || DEFAULT_BASE).trim().replace(/\/+$/, '');
    return v || DEFAULT_BASE;
  }
  function setMeta(text) { var el = $('t2Meta'); if (el) el.textContent = text; }
  function setBadge(ok, text) {
    state.apiOk = ok;
    var b = $('t2Badge');
    if (b) { b.textContent = text; b.classList.toggle('is-ok', ok); }
  }

  function setMode(mode) {
    state.mode = mode === 'interp' ? 'interp' : 'diffusion';
    document.querySelectorAll('#view-tooltoon2 [data-t2-mode]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-t2-mode') === state.mode);
    });
    var view = $('view-tooltoon2');
    if (view) view.classList.toggle('is-interp', state.mode === 'interp');
    ['t2Prompt', 't2Steps', 't2Cfg', 't2Eta'].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = state.mode === 'interp';
    });
    var hint = $('t2ModeHint');
    if (hint) hint.textContent = state.mode === 'interp'
      ? '纯插帧：不生成新内容，只按光流补中间帧，速度快、保留原画；提示词 / 步数 / CFG / ETA 不生效。'
      : 'AnimateDiff 扩散生成中间帧，动作更自然；需 GPU 与模型权重。';
  }

  function loadImage(file, key, thumbId) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      if (key === 'first') state.first = file; else state.last = file;
      var th = $(thumbId);
      if (th) { th.src = url; th.classList.add('is-loaded'); }
      var drop = th && th.closest('.tc-drop');
      if (drop) drop.classList.add('has-img');
      toast('已载入' + (key === 'first' ? '首帧' : '尾帧') + '（' + img.width + '×' + img.height + '）', 'success');
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

  function testApi(silent) {
    var b = base();
    var el = $('t2ApiState');
    if (window.location.protocol === 'https:' && b.indexOf('http://') === 0) {
      if (el) el.textContent = 'https 页面无法访问 http 本地服务，请用本地版打开';
      setBadge(false, '服务未连接');
      if (!silent) toast('https 页面访问 http 本地服务会被浏览器拦截', 'error');
      return;
    }
    if (el) el.textContent = '检测中…';
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 6000) : null;
    fetch(b + '/api/health', { signal: ctrl && ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (info) {
        if (timer) window.clearTimeout(timer);
        if (!info) throw new Error('服务无响应');
        var dev = info.device === 'cuda' ? (info.gpu || 'GPU') : 'CPU（较慢）';
        var modes = info.modes ? ' · 模式 ' + [].concat(info.modes).join('/') : '';
        if (el) el.textContent = '已连接 · ' + dev + modes;
        setBadge(true, '服务已连接');
        if (!silent) toast('已连接补间服务（' + dev + '）', 'success');
        if (state.mode === 'diffusion') {
          fetch(b + '/api/warmup', { method: 'POST' }).catch(function () {});
        }
      })
      .catch(function () {
        if (timer) window.clearTimeout(timer);
        if (el) el.textContent = '未连接 · 请先启动 :7862 服务';
        setBadge(false, '服务未连接');
        if (!silent) toast('连接失败：请确认本机已启动 python server.py --port 7862', 'error');
      });
  }

  function setBusy(busy) {
    state.busy = busy;
    var gen = $('t2GenBtn'), stop = $('t2StopBtn');
    if (gen) gen.disabled = busy;
    if (stop) stop.hidden = !busy;
  }

  function generate() {
    if (state.busy) return;
    if (!state.first || !state.last) { toast('请先上传首帧和尾帧', 'error'); return; }
    var b = base();
    var fd = new FormData();
    fd.append('mode', state.mode);
    fd.append('first', state.first);
    fd.append('last', state.last);
    fd.append('prompt', ($('t2Prompt') && $('t2Prompt').value) || '');
    fd.append('steps', ($('t2Steps') && $('t2Steps').value) || '25');
    fd.append('cfg', ($('t2Cfg') && $('t2Cfg').value) || '7.5');
    fd.append('eta', ($('t2Eta') && $('t2Eta').value) || '0');
    fd.append('fs', ($('t2Fs') && $('t2Fs').value) || '8');
    fd.append('seed', ($('t2Seed') && $('t2Seed').value) || '123');
    fd.append('resolution', ($('t2Res') && $('t2Res').value) || '320_512');

    var xhr = new XMLHttpRequest();
    state.xhr = xhr;
    xhr.open('POST', b + '/api/interpolate', true);
    xhr.responseType = 'json';
    var started = Date.now();
    var tick = window.setInterval(function () {
      setMeta('生成中… ' + Math.round((Date.now() - started) / 1000) + 's（' +
        (state.mode === 'interp' ? '纯插帧' : '扩散补间') + '）');
    }, 500);
    setBusy(true);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) setMeta('上传关键帧 ' + Math.round((e.loaded / e.total) * 100) + '%');
    };
    xhr.onload = function () {
      window.clearInterval(tick);
      setBusy(false);
      state.xhr = null;
      var data = xhr.response;
      if (!data) { try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; } }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok !== false) {
        var name = data.name || data.file ||
          (data.video ? String(data.video).split('/').pop() : '');
        var url = data.video
          ? (String(data.video).indexOf('http') === 0 ? data.video : b + data.video)
          : (name ? b + '/results/' + name + '.mp4' : '');
        if (!url) {
          setMeta('生成失败：服务未返回视频地址');
          toast('生成失败：服务未返回视频地址', 'error');
          return;
        }
        state.url = url;
        var video = $('t2Video'), empty = $('t2Empty');
        if (empty) empty.hidden = true;
        if (video) {
          video.hidden = false;
          video.src = url;
          var pr = video.play();
          if (pr && pr.catch) pr.catch(function () {});
        }
        setMeta('完成 · ' + (data.elapsed ? data.elapsed + 's · ' : '') +
          (state.mode === 'interp' ? '纯插帧' : (data.steps ? data.steps + ' 步' : '扩散补间')) +
          (data.fps ? ' · ' + data.fps + ' fps' : ''));
        toast('补间完成', 'success');
      } else {
        var msg = (data && (data.error || data.message)) || ('HTTP ' + xhr.status);
        setMeta('生成失败：' + msg);
        toast('生成失败：' + msg, 'error');
      }
    };
    xhr.onerror = function () {
      window.clearInterval(tick);
      setBusy(false);
      state.xhr = null;
      setMeta('无法连接 ' + b + ' · 请先启动本地补间服务');
      setBadge(false, '服务未连接');
      toast('无法连接本地补间服务，请确认 :7862 已启动', 'error');
    };
    xhr.onabort = function () {
      window.clearInterval(tick);
      setBusy(false);
      state.xhr = null;
      setMeta('已停止生成');
    };
    xhr.send(fd);
  }

  function play() {
    var video = $('t2Video');
    if (!state.url && video) state.url = video.src || '';
    if (!state.url) { toast('还没有可播放的视频', 'info'); return; }
    if (video) {
      video.hidden = false;
      var pr = video.play();
      if (pr && pr.catch) pr.catch(function () { toast('浏览器阻止了自动播放，请点视频上的播放键', 'info'); });
    }
  }

  function save() {
    var video = $('t2Video');
    if (!state.url && video) state.url = video.src || '';
    if (!state.url) { toast('还没有可下载的视频', 'info'); return; }
    var a = document.createElement('a');
    a.href = state.url;
    a.download = 'first-last-' + Date.now() + '.mp4';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('已开始下载视频', 'success');
  }

  function bind() {
    document.querySelectorAll('#view-tooltoon2 [data-t2-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-t2-mode')); });
    });
    bindDrop('t2DropFirst', 't2FileFirst', 'first', 't2ThumbFirst');
    bindDrop('t2DropLast', 't2FileLast', 'last', 't2ThumbLast');

    [['t2Steps', 't2StepsVal'], ['t2Cfg', 't2CfgVal'], ['t2Eta', 't2EtaVal'], ['t2Fs', 't2FsVal'], ['t2Seed', 't2SeedVal']].forEach(function (pair) {
      var input = $(pair[0]), out = $(pair[1]);
      if (!input || !out) return;
      var sync = function () { out.textContent = input.value; };
      input.addEventListener('input', sync);
      sync();
    });

    var apiInput = $('t2Api');
    if (apiInput) {
      var applySaved = function () {
        var A = window.HMApp;
        var cloud = (A && A.state && A.state.toon2Api) || '';
        var saved = cloud || localStorage.getItem(LS) || '';
        if (saved) apiInput.value = saved;
      };
      try { applySaved(); } catch (e) {}
      apiInput.addEventListener('change', function () {
        var v = apiInput.value.trim().replace(/\/+$/, '');
        apiInput.value = v;
        try { localStorage.setItem(LS, v); } catch (e) {}
        var A = window.HMApp;
        if (A && A.state) A.state.toon2Api = v;
        if (A && A.persistPrefs) A.persistPrefs();
        if (!v) { setBadge(false, '服务未连接'); var st = $('t2ApiState'); if (st) st.textContent = '请填写服务地址'; return; }
        if (!state.busy) testApi(true);
      });
      /* 云端 prefs 到达时刷新地址 */
      document.addEventListener('hm:prefs', function () {
        try {
          var A = window.HMApp;
          var v = (A && A.state && A.state.toon2Api) || '';
          if (v && v !== apiInput.value) { apiInput.value = v; testApi(true); }
        } catch (e) {}
      });
    }

    var testBtn = $('t2ApiTest');
    if (testBtn) testBtn.addEventListener('click', function () { testApi(false); });
    var genBtn = $('t2GenBtn');
    if (genBtn) genBtn.addEventListener('click', generate);
    var stopBtn = $('t2StopBtn');
    if (stopBtn) stopBtn.addEventListener('click', function () {
      if (state.xhr) { try { state.xhr.abort(); } catch (e) {} }
    });
    var playBtn = $('t2PlayBtn');
    if (playBtn) playBtn.addEventListener('click', play);
    var saveBtn = $('t2SaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', save);
  }

  var booted = false;
  function boot() {
    if (booted || !document.getElementById('view-tooltoon2')) return;
    booted = true;
    bind();
    setMode('diffusion');
    setBusy(false);
    testApi(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.HMToon2 = {
    leave: function () {
      var v = $('t2Video');
      if (v && !v.paused) v.pause();
    }
  };
})();
