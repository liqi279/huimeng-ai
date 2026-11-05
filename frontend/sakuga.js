'use strict';

/* =============================================================
 * 绘梦 · 作画模块（HMSakuga / HMCSPBridge）
 * 1) 顶栏子模块切换：原画 / 动画 / 着色 / CSP作画
 *    （前三个为既有视图，功能不变，仅入口并入「作画」顶栏）
 * 2) CSP作画：唤起本机已安装的 CLIP STUDIO PAINT（协议探测），
 *    完成稿导入平台资产库。
 *    注意：桌面软件无法在网页内运行，平台只做本地联动。
 * ============================================================= */
(function () {
  var GROUP = ['sakuga', 'oua', 'animation', 'paint'];
  var cspState = 'unknown'; // unknown | launching | launched | notfound

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) {
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type || 'info');
  }

  /* ---------------- 子模块切换 ---------------- */
  function currentView() { return document.body.dataset.view || ''; }

  function syncTabs() {
    var view = currentView();
    document.querySelectorAll('#sakugaTabs .sakuga-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-sakuga') === view);
    });
  }

  var lastAutoLaunch = 0;

  function onViewMaybeAutoLaunch() {
    syncTabs();
    /* 每次切入「CSP作画」子模块时，自动尝试唤起本地 CSP（10 秒冷却防抖动） */
    if (currentView() !== 'sakuga') return;
    var now = Date.now();
    if (now - lastAutoLaunch < 10000) return;
    lastAutoLaunch = now;
    window.setTimeout(function () {
      if (currentView() === 'sakuga') launchCSP();
    }, 350);
  }

  function bindTabs() {
    var bar = $('sakugaTabs');
    if (!bar) return;
    bar.addEventListener('click', function (event) {
      var tab = event.target.closest('.sakuga-tab');
      if (!tab) return;
      var target = tab.getAttribute('data-sakuga');
      if (!target || target === currentView()) return;
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView(target);
    });
    /* 视图变化时同步高亮（含侧栏直进、快捷键切视图等情况） */
    var observer = new MutationObserver(onViewMaybeAutoLaunch);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    syncTabs();
  }

  /* ---------------- CSP 状态展示 ---------------- */
  function setCspStatus(state) {
    cspState = state;
    var dot = $('cspDot');
    var text = $('cspStatusText');
    var note = $('cspNote');
    var label = { unknown: '未检测', launching: '唤起中…', launched: '已唤起本地 CSP', notfound: '未检测到本地 CSP' }[state] || state;
    if (text) text.textContent = label;
    if (dot) dot.setAttribute('data-state', state);
    if (note) note.hidden = state !== 'notfound';
  }

  /* ---------------- 唤起本地 CSP（协议探测） ----------------
   * CSP 安装后可响应 clipstudio: 协议。隐藏 iframe 发起协议请求，
   * 若系统把焦点切走（blur）说明外部应用被唤起；
   * 否则视为未安装，展示正版安装引导。
   */
  function launchCSP() {
    if (cspState === 'launching') return;
    setCspStatus('launching');
    var decided = false;

    function onBlur() {
      if (decided) return;
      decided = true;
      setCspStatus('launched');
      toast('已请求唤起本地 CSP，请在你的作画窗口中继续', 'success');
    }
    window.addEventListener('blur', onBlur, { once: true });

    var probe = document.createElement('iframe');
    probe.style.display = 'none';
    probe.setAttribute('aria-hidden', 'true');
    probe.src = 'clipstudio://open';
    document.body.appendChild(probe);

    window.setTimeout(function () {
      try { probe.remove(); } catch (err) { /* ignore */ }
      window.removeEventListener('blur', onBlur);
      if (decided) return;
      decided = true;
      setCspStatus('notfound');
      toast('未检测到本地 CSP，请确认已正版安装 CLIP STUDIO PAINT', 'info');
    }, 1800);
  }

  /* ---------------- 完成稿导入 ---------------- */
  function importFiles(files) {
    if (!files || !files.length) return;
    if (window.HMUI && typeof window.HMUI.importAssets === 'function') {
      window.HMUI.importAssets(files);
      renderPreview(files);
    } else {
      toast('资产模块尚未就绪，请稍后再试', 'error');
    }
  }

  function renderPreview(files) {
    var box = $('cspPreview');
    if (!box) return;
    Array.prototype.slice.call(files, 0, 8).forEach(function (file) {
      if (!/^image\//.test(file.type || '')) return;
      var img = document.createElement('img');
      img.className = 'csp-preview-item';
      img.alt = file.name;
      img.title = file.name;
      img.src = URL.createObjectURL(file);
      img.onload = function () { try { URL.revokeObjectURL(img.src); } catch (err) { /* ignore */ } };
      box.prepend(img);
    });
  }

  function bindCspPanel() {
    var launchBtn = $('cspLaunchBtn');
    if (launchBtn) launchBtn.addEventListener('click', launchCSP);

    var importBtn = $('cspImportBtn');
    var input = $('cspImportInput');
    if (importBtn && input) {
      importBtn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        importFiles(input.files);
        input.value = '';
      });
    }

    var drop = $('cspDropZone');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.classList.add('is-drag');
        });
      });
      ['dragleave', 'drop'].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.classList.remove('is-drag');
        });
      });
      drop.addEventListener('drop', function (event) {
        var files = event.dataTransfer && event.dataTransfer.files;
        importFiles(files);
      });
    }
  }

  /* ---------------- 对外接口 ---------------- */
  window.HMCSPBridge = {
    launch: launchCSP,
    status: function () { return cspState; },
    importFiles: importFiles,
    openAssets: function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('assets');
    }
  };

  window.HMSakuga = {
    isGroupView: function (view) { return GROUP.indexOf(view) >= 0; },
    syncTabs: syncTabs
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bindTabs(); bindCspPanel(); });
  } else {
    bindTabs();
    bindCspPanel();
  }
})();
