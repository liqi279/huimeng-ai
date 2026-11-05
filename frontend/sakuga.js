'use strict';

/* =============================================================
 * 绘梦 · 作画模块（HMSakuga）
 * 顶栏子模块切换：原画 / 动画 / 着色
 * （三个子模块为既有视图，功能不变，仅入口并入「作画」顶栏）
 *
 * 防闪帧：视图切换为 display 原子替换（同帧完成，无过渡帧），
 * 配合 .hm-page 不透明底色，不会产生任何中间画面。
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
    if (window.HMApp && window.HMApp.switchView) {
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
