
/* ================= 设置入口：开关式进出 + 来源视图恢复 =================
 * 所有进入 #view-admin 的路径都经过 body[data-view] 变更，这里统一记住来源视图
 * 与滚动位置；再次点击同一入口、点「退出设置」或按 Esc 都走同一条恢复链路。 */
(function () {
  'use strict';

  var SCROLL_SEL = ['#view-create', '#resultGrid', '#worksGrid', '#view-works',
                    '#view-library', '#view-library .lib-body', '#view-canvas'];
  var source = null;
  var lastView = document.body.dataset.view || 'create';

  function inAdmin() { return (document.body.dataset.view || '') === 'admin'; }

  function switchTo(v) {
    if (window.HMApp && typeof window.HMApp.switchView === 'function') { window.HMApp.switchView(v); return; }
    if (typeof window.switchView === 'function') window.switchView(v);
  }

  function captureScrolls() {
    var out = [];
    SCROLL_SEL.forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n) return;
      if (!n.scrollTop && !n.scrollLeft) return;
      out.push({ sel: sel, top: n.scrollTop, left: n.scrollLeft });
    });
    return out;
  }

  function restoreScrolls(list) {
    if (!list || !list.length) return;
    requestAnimationFrame(function () {
      list.forEach(function (it) {
        var n = document.querySelector(it.sel);
        if (!n) return;
        n.scrollTop = it.top;
        n.scrollLeft = it.left;
      });
    });
  }

  /* 记住进入设置前的视图与滚动位置（切换前 DOM 只是 hidden，状态仍原样保留） */
  new MutationObserver(function () {
    var cur = document.body.dataset.view || '';
    if (cur === lastView) return;
    if (cur === 'admin' && lastView && lastView !== 'admin') {
      source = { view: lastView, scrolls: captureScrolls() };
    }
    lastView = cur;
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

  function enter(target) {
    if (inAdmin()) return;
    if (target) window.HM_ADMIN_TARGET = target;
    switchTo('admin');
  }

  function exit() {
    /* 未保存的快捷键改动按现有保存逻辑自动落盘，不默默丢弃 */
    try {
      if (window.HMHkSettings && window.HMHkSettings.hasUnsaved()) window.HMHkSettings.commit();
    } catch (e) {}
    var view = (source && source.view) || '';
    var scrolls = source && source.scrolls;
    source = null;
    if (!view || view === 'admin') view = 'create';
    switchTo(view);
    restoreScrolls(scrolls);
  }

  function toggle(target) {
    if (inAdmin()) { exit(); return; }
    enter(target);
  }

  /* 同一个入口再点一次 → 收回并回到来源视图 */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest
      ? e.target.closest('#apiConfigBtn, #hmUserAdminBtn, [data-ucmd="admin"], #adminCloseBtn')
      : null;
    if (!t) return;
    if (t.id === 'adminCloseBtn') {
      e.preventDefault();
      e.stopImmediatePropagation();
      exit();
      return;
    }
    if (inAdmin()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exit();
    }
  }, true);

  /* Esc 与关闭按钮走同一条退出链路；有弹窗 / 编辑器 / 大图在前时先让它们处理 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !inAdmin()) return;
    if (document.querySelector('.modal.is-open')) return;
    var ed = document.getElementById('promptEditor');
    if (ed && ed.classList.contains('is-open')) return;
    var lb = document.getElementById('lightbox');
    if (lb && lb.classList && lb.classList.contains('is-open')) return;
    e.preventDefault();
    e.stopPropagation();
    exit();
  }, true);

  window.HMSettingsToggle = { enter: enter, exit: exit, toggle: toggle, isOpen: inAdmin };
})();
