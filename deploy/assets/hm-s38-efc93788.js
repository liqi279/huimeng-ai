
/* ================= 快捷键：按焦点区域生效 + 设置可改可同步 =================
 * 存储复用账号 prefs（anidream.prefs.v1.shortcuts），与其它设置同一套云同步。
 * 区域：桌面工作区 / 参考主体区域 / 提示词框 / 图书馆 / 画布 / 全屏编辑器。
 * 同一组合键在不同区域可对应不同动作；输入焦点在文本框时只放行带修饰键的组合。 */
(function () {
  'use strict';

  var PREFS_KEY = 'anidream.prefs.v1';

  var REGIONS = [
    { id: 'desktop', label: '桌面工作区 / 结果区', hint: '焦点或悬停在创作台、作品卡片上' },
    { id: 'refs', label: '参考主体区域', hint: '焦点或悬停在参考图上传区' },
    { id: 'prompt', label: '提示词框', hint: '焦点或悬停在提示词输入区' },
    { id: 'library', label: '图书馆', hint: '焦点或悬停在藏书阁' },
    { id: 'canvas', label: '画布', hint: '焦点或悬停在无限画布' },
    { id: 'editor', label: '全屏「画面描述」编辑器', hint: '编辑器打开时优先匹配' }
  ];

  var ACTIONS = [
    { id: 'prompt.send', region: 'prompt', label: '发送 / 开始生成', def: 'Ctrl+Enter', run: function () { clickId('generateBtn'); } },
    { id: 'prompt.expand', region: 'prompt', label: '展开全屏编辑器', def: 'Ctrl+Alt+E', run: function () { clickId('expandPrompt'); } },
    { id: 'prompt.inspire', region: 'prompt', label: '插入一条随机灵感', def: 'Ctrl+Alt+I', run: function () { clickId('inspireBtn'); } },
    { id: 'prompt.seed', region: 'prompt', label: '换一个随机种子', def: 'Ctrl+Alt+K', run: function () { clickId('seedRandom'); } },

    { id: 'desktop.generate', region: 'desktop', label: '开始生成', def: 'Ctrl+Alt+G', run: function () { clickId('generateBtn'); } },
    { id: 'desktop.history', region: 'desktop', label: '打开历史记录', def: 'Ctrl+Alt+H', run: function () { clickId('worksHistoryBtn'); } },

    { id: 'refs.upload', region: 'refs', label: '上传参考图', def: 'Ctrl+Alt+U', run: function () { clickId('refPickBtn'); } },
    { id: 'refs.select', region: 'refs', label: '进入选择素材', def: 'Ctrl+Alt+S', run: function () { clickId('refSelectBtn'); } },
    { id: 'refs.deleteSelected', region: 'refs', label: '删除选中的参考图', def: 'Ctrl+Alt+Shift+D', run: function () { clickId('refSelectDelete'); } },
    { id: 'refs.clearAll', region: 'refs', label: '全部删除（上锁，需连点两次）', def: 'Ctrl+Alt+Shift+X', run: function () { clickId('refClearBtn'); } },

    { id: 'library.search', region: 'library', label: '聚焦搜索框', def: 'Ctrl+Alt+F', run: function () { focusId('libSearchInput'); } },
    { id: 'library.add', region: 'library', label: '新增书籍', def: 'Ctrl+Alt+N', run: function () { clickId('libAddBtn'); } },
    { id: 'library.favorite', region: 'library', label: '我的收藏', def: 'Ctrl+Alt+B', run: function () { clickId('libFavBtn'); } },
    { id: 'library.history', region: 'library', label: '阅读历史', def: 'Ctrl+Alt+H', run: function () { clickId('libHistoryBtn'); } },
    { id: 'library.prevPage', region: 'library', label: '上一页', def: 'Ctrl+Alt+ArrowLeft', run: function () { clickId('libPagerPrev'); } },
    { id: 'library.nextPage', region: 'library', label: '下一页', def: 'Ctrl+Alt+ArrowRight', run: function () { clickId('libPagerNext'); } },

    { id: 'canvas.text', region: 'canvas', label: '新建文本节点', def: 'Ctrl+Alt+T', run: function () { clickId('ncAddText'); } },
    { id: 'canvas.image', region: 'canvas', label: '上传图片节点', def: 'Ctrl+Alt+M', run: function () { clickId('ncAddImage'); } },
    { id: 'canvas.genImage', region: 'canvas', label: '新建「生成图片」节点', def: 'Ctrl+Alt+G', run: function () { clickId('ncAddGenImage'); } },
    { id: 'canvas.tidy', region: 'canvas', label: '整理布局', def: 'Ctrl+Alt+L', run: function () { clickId('ncTidy'); } },
    { id: 'canvas.zoomIn', region: 'canvas', label: '放大画布', def: 'Ctrl+Alt+=', run: function () { clickId('ncZoomIn'); } },
    { id: 'canvas.zoomOut', region: 'canvas', label: '缩小画布', def: 'Ctrl+Alt+-', run: function () { clickId('ncZoomOut'); } },
    { id: 'canvas.fit', region: 'canvas', label: '适应全部节点', def: 'Ctrl+Alt+0', run: function () { clickId('ncFit'); } },

    { id: 'editor.apply', region: 'editor', label: '完成并写回提示词', def: 'Ctrl+Enter', run: function () { clickId('promptEditorApply'); } },
    { id: 'editor.close', region: 'editor', label: '关闭编辑器', def: 'Escape', run: function () { clickId('promptEditorClose'); } }
  ];

  var DEFAULTS = {};
  ACTIONS.forEach(function (a) { DEFAULTS[a.id] = a.def; });

  var binding = readBindings();
  var pending = {};
  var recording = null;
  var recordBtn = null;
  var lastHover = null;
  var panelBody = null;

  function $(id) { return document.getElementById(id); }
  function clickId(id) { var n = $(id); if (n) { n.click(); return true; } return false; }
  function focusId(id) { var n = $(id); if (n && n.focus) { n.focus(); return true; } return false; }
  function say(msg, kind) {
    try {
      if (window.HMApp && typeof window.HMApp.toast === 'function') { window.HMApp.toast(msg, kind || 'info'); return; }
    } catch (e) {}
    try { if (typeof window.toast === 'function') window.toast(msg, kind || 'info'); } catch (e2) {}
  }

  /* ---------------- 持久化（复用账号 prefs） ---------------- */
  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function readBindings() {
    var saved = readPrefs().shortcuts || {};
    var out = {};
    ACTIONS.forEach(function (a) {
      out[a.id] = (typeof saved[a.id] === 'string') ? saved[a.id] : a.def;
    });
    return out;
  }
  function writeBindings(map) {
    var prefs = readPrefs();
    prefs.shortcuts = map;
    prefs.updatedAt = Date.now();
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { return false; }
    if (window.HMSync && typeof window.HMSync.pushPrefs === 'function') {
      try { window.HMSync.pushPrefs(); } catch (e2) {}
    }
    return true;
  }

  /* ---------------- 区域判定 ---------------- */
  function regionOf(node) {
    if (!node || !node.closest) return '';
    if (node.closest('#promptEditor')) return 'editor';
    if (node.closest('.hm-prompt')) return 'prompt';
    if (node.closest('#refDrop')) return 'refs';
    if (node.closest('#view-library')) return 'library';
    if (node.closest('#view-canvas')) return 'canvas';
    if (node.closest('#view-create') || node.closest('#view-works')) return 'desktop';
    return '';
  }

  function activeRegion(e) {
    var panel = $('promptEditor');
    if (panel && panel.classList.contains('is-open')) return 'editor';
    var r = regionOf(document.activeElement);
    if (r) return r;
    r = regionOf(lastHover) || regionOf(e.target);
    if (r) return r;
    var v = document.body.dataset.view || '';
    if (v === 'create' || v === 'works') return 'desktop';
    if (v === 'library') return 'library';
    if (v === 'canvas') return 'canvas';
    return '';
  }

  function isEditable(node) {
    if (!node || !node.closest) return false;
    if (node.isContentEditable) return true;
    var tag = (node.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function comboOf(e) {
    var k = e.key;
    if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return '';
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    else if (k === '+') k = '=';
    else if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  }

  document.addEventListener('pointerover', function (e) { lastHover = e.target; }, true);
  document.addEventListener('mouseover', function (e) { lastHover = e.target; }, true);

  /* ---------------- 快捷键分发 ---------------- */
  document.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;  /* 中文输入法候选期间不拦截 */
    if (recording) return;                            /* 设置面板录制中，交给录制器 */
    var combo = comboOf(e);
    if (!combo) return;
    var region = activeRegion(e);
    if (!region) return;
    var hit = null;
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      if (a.region === region && binding[a.id] && binding[a.id] === combo) { hit = a; break; }
    }
    if (!hit) return;
    /* 焦点在文本框里时，只放行带修饰键的组合（Esc 除外），不吞普通字符/退格/回车 */
    if (isEditable(e.target) && !(e.ctrlKey || e.altKey || e.metaKey) && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    try { hit.run(); } catch (err) {}
  }, true);

  /* ---------------- 设置面板 ---------------- */
  function regionLabel(id) {
    for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].id === id) return REGIONS[i].label;
    return id;
  }
  function regionOfAction(id) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i].region;
    return '';
  }
  function conflictFor(id, combo, map) {
    var region = regionOfAction(id);
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      if (a.id === id || a.region !== region) continue;
      if (map[a.id] === combo) return a;
    }
    return null;
  }

  function buildPanel() {
    var h = '<div class="hm-hk">';
    h += '<div class="hm-hk-head"><div><h2>快捷键</h2>'
      + '<p>快捷键只在当前焦点 / 悬停所在的区域生效，同一组合键在不同区域可以对应不同动作；输入焦点在文本框里时不会吞掉普通字符键。默认键位都带 Ctrl+Alt（或区域内的 Ctrl+Enter / Esc），避开浏览器默认快捷键。</p></div>'
      + '<div class="hm-hk-actions"><button type="button" class="hm-hk-btn" data-hk-all>全部恢复默认</button>'
      + '<button type="button" class="hm-hk-btn is-primary" data-hk-save>保存并应用</button></div></div>';
    REGIONS.forEach(function (r) {
      var list = ACTIONS.filter(function (a) { return a.region === r.id; });
      if (!list.length) return;
      h += '<div class="hm-hk-region"><div class="hm-hk-region-head"><b>' + r.label + '</b><span>' + r.hint + '</span></div>';
      list.forEach(function (a) {
        var v = pending[a.id] || '';
        h += '<div class="hm-hk-row"><span class="hm-hk-name">' + a.label + '</span>'
          + '<button type="button" class="hm-hk-key' + (v ? '' : ' is-empty') + '" data-hk-rec="' + a.id + '">' + (v || '未设置') + '</button>'
          + '<button type="button" class="hm-hk-reset" data-hk-reset="' + a.id + '">恢复默认</button></div>';
      });
      h += '</div>';
    });
    h += '<div class="hm-hk-note">点击键位后按下新组合键即可录制；Esc 取消录制，Backspace 清除绑定；同一区域内重复的组合键会被拒绝。保存后写入账号设置（与其它设置同一套云同步），刷新或换设备后仍然生效。</div>';
    h += '</div>';
    return h;
  }

  function refreshRows() {
    if (!panelBody) return;
    Array.prototype.forEach.call(panelBody.querySelectorAll('[data-hk-rec]'), function (btn) {
      var id = btn.dataset.hkRec;
      if (recording === id) return;
      var v = pending[id] || '';
      btn.textContent = v || '未设置';
      btn.classList.toggle('is-empty', !v);
      btn.classList.remove('is-rec');
    });
  }

  function beginRecord(id, btn) {
    if (recording) stopRecord();
    recording = id;
    recordBtn = btn;
    btn.textContent = '按下新键位…';
    btn.classList.add('is-rec');
    btn.classList.remove('is-empty');
    document.addEventListener('keydown', onRecordKey, true);
  }

  function stopRecord() {
    if (recordBtn) recordBtn.classList.remove('is-rec');
    recording = null;
    recordBtn = null;
    document.removeEventListener('keydown', onRecordKey, true);
    refreshRows();
  }

  function onRecordKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { stopRecord(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { pending[recording] = ''; stopRecord(); return; }
    var combo = comboOf(e);
    if (!combo) return;
    var other = conflictFor(recording, combo, pending);
    if (other) { say('「' + combo + '」已被「' + other.label + '」占用（同一区域）', 'error'); return; }
    pending[recording] = combo;
    stopRecord();
  }

  function savePanel() {
    var ids = Object.keys(pending);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!pending[id]) continue;
      var other = conflictFor(id, pending[id], pending);
      if (other) {
        say('「' + pending[id] + '」在「' + regionLabel(regionOfAction(id)) + '」内与「' + other.label + '」冲突，请先修改', 'error');
        return;
      }
    }
    Object.keys(pending).forEach(function (k) { binding[k] = pending[k]; });
    if (!writeBindings(binding)) { say('保存失败：本地存储不可用', 'error'); return; }
    say('快捷键已保存并同步', 'success');
    refreshRows();
  }

  function mountPanel() {
    var body = $('adminBody');
    if (!body) return;
    stopRecord();
    panelBody = body;
    pending = {};
    Object.keys(binding).forEach(function (k) { pending[k] = binding[k]; });
    body.innerHTML = buildPanel();
    refreshRows();
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-top="settings"]') : null;
    if (!t) return;
    /* 交给设置页自己的 Tab 逻辑先渲染占位，再用快捷键面板覆盖 */
    setTimeout(mountPanel, 0);
  }, false);

  document.addEventListener('click', function (e) {
    if (!panelBody || !panelBody.contains(e.target)) return;
    var rec = e.target.closest('[data-hk-rec]');
    if (rec) { beginRecord(rec.dataset.hkRec, rec); return; }
    var rst = e.target.closest('[data-hk-reset]');
    if (rst) { pending[rst.dataset.hkReset] = DEFAULTS[rst.dataset.hkReset] || ''; refreshRows(); return; }
    if (e.target.closest('[data-hk-all]')) {
      Object.keys(DEFAULTS).forEach(function (k) { pending[k] = DEFAULTS[k]; });
      refreshRows();
      say('已恢复默认键位，点「保存并应用」生效');
      return;
    }
    if (e.target.closest('[data-hk-save]')) savePanel();
  }, false);

  /* 云端 prefs 到达时刷新本地绑定（跨设备同步） */
  document.addEventListener('hm:prefs', function () {
    binding = readBindings();
    if (panelBody && panelBody.querySelector('.hm-hk')) {
      pending = {};
      Object.keys(binding).forEach(function (k) { pending[k] = binding[k]; });
      refreshRows();
    }
  });

  /* 设置页退出时调用：未保存的键位改动自动保存，不默默丢弃 */
  window.HMHkSettings = {
    hasUnsaved: function () {
      if (!pending || !Object.keys(pending).length) return false;
      return ACTIONS.some(function (a) { return (pending[a.id] || '') !== (binding[a.id] || ''); });
    },
    commit: function () {
      if (!window.HMHkSettings.hasUnsaved()) return false;
      savePanel();
      return true;
    }
  };
})();
