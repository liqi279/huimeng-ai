'use strict';

/* =============================================================
 * 绘梦 · 作画模块（HMSakuga）
 * 顶栏子模块切换：原画 / 动画 / 着色
 * （三个子模块为既有视图，功能不变，仅入口并入「作画」顶栏）
 *
 * 防闪帧：切换时优先使用 View Transitions API——浏览器先对当前
 * 画面截图，再原子地替换 DOM 并交叉淡入，中间不会出现空白帧或
 * 背景透闪；不支持的浏览器回退为普通切换。
 * ============================================================= */
(function () {
  var GROUP = ['oua', 'animation', 'paint'];

  function $(id) { return document.getElementById(id); }

  function currentView() { return document.body.dataset.view || ''; }

  function syncTabs() {
    var view = currentView();
    document.querySelectorAll('#sakugaTabs .sakuga-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-sakuga') === view);
    });
  }

  function goView(target) {
    if (!(window.HMApp && window.HMApp.switchView)) return;
    if (typeof document.startViewTransition === 'function') {
      /* 原子切换：旧画面截图 → DOM 替换 → 新画面淡入，无空白帧 */
      document.startViewTransition(function () {
        window.HMApp.switchView(target);
      });
    } else {
      window.HMApp.switchView(target);
    }
  }

  function bindTabs() {
    var bar = $('sakugaTabs');
    if (!bar) return;
    bar.addEventListener('click', function (event) {
      var tab = event.target.closest('.sakuga-tab');
      if (!tab) return;
      var target = tab.getAttribute('data-sakuga');
      if (!target || target === currentView()) return;
      goView(target);
    });
    /* 视图变化时同步高亮（含侧栏直进、快捷键切视图等情况） */
    var observer = new MutationObserver(syncTabs);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    syncTabs();
  }

  window.HMSakuga = {
    isGroupView: function (view) { return GROUP.indexOf(view) >= 0; },
    goView: goView,
    syncTabs: syncTabs
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTabs);
  } else {
    bindTabs();
  }
})();
