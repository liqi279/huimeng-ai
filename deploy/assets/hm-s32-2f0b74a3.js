
/* =============================================================
 * 侧栏中段 · 右键菜单（置顶 / 固定）
 * 依赖：.hm-rail-top / [data-rail] / #railCtxMenu / is-pinned / is-fixed
 * 存储：localStorage['anidream.rail.pins.v1']
 * ============================================================= */
(function () {
  'use strict';
  var PIN_KEY = 'anidream.rail.pins.v1';
  var railTop = document.querySelector('.hm-rail-top');
  var menu = document.getElementById('railCtxMenu');
  if (!railTop || !menu) return;

  var titleEl = document.getElementById('railCtxTitle');
  var pinText = document.getElementById('railCtxPinText');
  var fixText = document.getElementById('railCtxFixText');
  var ctxItem = null;

  function readStore() {
    var fallback = { pins: [], order: [], fixed: [] };
    try {
      var raw = localStorage.getItem(PIN_KEY);
      if (!raw) return fallback;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return fallback;
      return {
        pins: Array.isArray(obj.pins) ? obj.pins : [],
        order: Array.isArray(obj.order) ? obj.order : [],
        fixed: Array.isArray(obj.fixed) ? obj.fixed : []
      };
    } catch (e) {
      return fallback;
    }
  }

  function railItems() {
    return railTop.querySelectorAll('.hm-rail-item[data-rail]');
  }

  function orderList() {
    var out = [];
    railItems().forEach(function (el) {
      var key = el.getAttribute('data-rail');
      if (key) out.push(key);
    });
    return out;
  }

  function pinList() {
    var out = [];
    railItems().forEach(function (el) {
      if (el.classList.contains('is-pinned')) out.push(el.getAttribute('data-rail'));
    });
    return out;
  }

  function fixedList() {
    var out = [];
    railItems().forEach(function (el) {
      if (el.classList.contains('is-fixed')) out.push(el.getAttribute('data-rail'));
    });
    return out;
  }

  function byKey(key) {
    if (!key) return null;
    return railTop.querySelector('.hm-rail-item[data-rail="' + key + '"]');
  }

  function saveRailState() {
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify({
        pins: pinList(),
        order: orderList(),
        fixed: fixedList()
      }));
    } catch (e) { /* ignore */ }
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
  }

  function placeMenu(x, y) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.hidden = false;
    var w = menu.offsetWidth || 168;
    var h = menu.offsetHeight || 96;
    var pad = 8;
    var left = x;
    var top = y;
    if (left + w > window.innerWidth - pad) left = x - w;   /* 靠右时向内偏 */
    if (left < pad) left = pad;
    if (top + h > window.innerHeight - pad) top = y - h;    /* 靠下时向上偏 */
    if (top < pad) top = pad;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function syncMenuText() {
    var pinned = !!(ctxItem && ctxItem.classList.contains('is-pinned'));
    var fixed = !!(ctxItem && ctxItem.classList.contains('is-fixed'));
    if (pinText) pinText.textContent = pinned ? '取消置顶' : '置顶';
    if (fixText) fixText.textContent = fixed ? '取消固定' : '固定';
  }

  function openMenu(el, x, y) {
    ctxItem = el;
    if (titleEl) {
      var label = el.querySelector('span');
      titleEl.textContent = ((label ? label.textContent : el.textContent) || '').trim() || '模块';
    }
    syncMenuText();
    placeMenu(x, y);
  }

  function togglePin(el) {
    if (el.classList.contains('is-pinned')) {
      /* 取消置顶：按记录的原始位置插回 */
      el.classList.remove('is-pinned');
      el.removeAttribute('data-pinned');
      var prevKey = el.getAttribute('data-pinprev') || '';
      el.removeAttribute('data-pinprev');
      var anchor = byKey(prevKey);
      if (anchor && anchor !== el && anchor.parentNode === railTop) {
        railTop.insertBefore(el, anchor.nextSibling);
      } else {
        var firstPlain = null;
        var list = railItems();
        for (var i = 0; i < list.length; i++) {
          if (!list[i].classList.contains('is-pinned')) { firstPlain = list[i]; break; }
        }
        if (firstPlain && firstPlain !== el) railTop.insertBefore(el, firstPlain);
        else if (!firstPlain) railTop.appendChild(el);
      }
    } else {
      /* 置顶：插到最前，并记住原位置 */
      var prev = el.previousElementSibling;
      var prevRail = prev && prev.getAttribute ? (prev.getAttribute('data-rail') || '') : '';
      el.setAttribute('data-pinprev', prevRail);
      el.classList.add('is-pinned');
      el.setAttribute('data-pinned', '1');
      railTop.insertBefore(el, railTop.firstElementChild);
    }
    saveRailState();
  }

  function toggleFix(el) {
    if (el.classList.contains('is-fixed')) {
      el.classList.remove('is-fixed');
      el.removeAttribute('data-fixed');
      el.setAttribute('data-pinned', el.classList.contains('is-pinned') ? '1' : '0');
    } else {
      el.classList.add('is-fixed');
      el.setAttribute('data-fixed', '1');
      el.setAttribute('draggable', 'false');
    }
    saveRailState();
  }

  function applyStoredState() {
    var store = readStore();
    var i, el;
    for (i = 0; i < store.order.length; i++) {
      el = byKey(store.order[i]);
      if (el) railTop.appendChild(el);
    }
    /* 旧顺序里没有 layout：默认排到「美术设定」之后，避免被顶到最前 */
    if (store.order.length && store.order.indexOf('layout') < 0) {
      var layoutEl = byKey('layout');
      var artEl = byKey('art');
      if (layoutEl && artEl && artEl.parentNode === railTop) {
        railTop.insertBefore(layoutEl, artEl.nextSibling);
      }
    }
    /* 旧顺序里没有 edit：默认排到「摄影」之后 */
    if (store.order.length && store.order.indexOf('edit') < 0) {
      var editEl = byKey('edit');
      var directorEl = byKey('director');
      if (editEl && directorEl && directorEl.parentNode === railTop) {
        railTop.insertBefore(editEl, directorEl.nextSibling);
      }
    }
    for (i = 0; i < store.fixed.length; i++) {
      el = byKey(store.fixed[i]);
      if (el) {
        el.classList.add('is-fixed');
        el.setAttribute('data-fixed', '1');
        el.setAttribute('draggable', 'false');
      }
    }
    for (i = store.pins.length - 1; i >= 0; i--) {
      el = byKey(store.pins[i]);
      if (el) {
        el.classList.add('is-pinned');
        el.setAttribute('data-pinned', '1');
        railTop.insertBefore(el, railTop.firstElementChild);
      }
    }
  }

  /* 右键：只作用于 .hm-rail-top 内的模块按钮（底部四项在外层容器，不响应） */
  railTop.addEventListener('contextmenu', function (e) {
    var node = e.target;
    var item = node && node.closest ? node.closest('[data-rail]') : null;
    if (!item || !railTop.contains(item)) return;
    e.preventDefault();
    openMenu(item, e.clientX, e.clientY);
  });

  menu.addEventListener('click', function (e) {
    var node = e.target;
    var btn = node && node.closest ? node.closest('[data-rctx]') : null;
    if (!btn || !ctxItem) return;
    var act = btn.getAttribute('data-rctx');
    if (act === 'pin') togglePin(ctxItem);
    else if (act === 'fix') toggleFix(ctxItem);
    syncMenuText();
    closeMenu();
  });

  document.addEventListener('click', function (e) {
    if (menu.hidden) return;
    if (menu.contains(e.target)) return;
    closeMenu();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) closeMenu();
  });

  railTop.addEventListener('scroll', closeMenu, true);

  /* 拖拽结束后同步存储（固定项不参与，已在 initRailDragSort 内跳过） */
  railTop.addEventListener('dragend', function () {
    saveRailState();
  }, true);

  /* 切换视图时收起菜单 */
  new MutationObserver(function () {
    closeMenu();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view', 'class'] });

  applyStoredState();
})();
