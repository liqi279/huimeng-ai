/* ============================================================
 * 故事版 HMStoryboard（分镜创作）
 * - 场次分组 + 镜头卡片网格（参考 Boords / StudioBinder 布局）
 * - 镜头属性：景别 / 运镜 / 视角 / 时长 / 画面描述 / 对白 / 备注
 * - 拖拽排序、跨场次移动、复制 / 删除镜头
 * - 本地上传画面（自动压缩）、动态预览 Animatic、导入导出 JSON、打印 / PDF
 * ============================================================ */
window.HMStoryboard = (function () {
  var SHOT_SIZES = ['大远景', '远景', '全景', '中景', '中近景', '近景', '特写', '大特写'];
  var MOVES = ['固定', '推', '拉', '摇', '移', '跟', '升降', '环绕', '手持'];
  var ANGLES = ['平视', '俯视', '仰视', '过肩', '主观'];
  var LS_PREFIX = 'anidream.storyboard.v1';

  var project = null;
  var selectedId = null;
  var imageTargetId = null;
  var inited = false;
  var loadedKey = '';
  var saveTimer = null;
  var pressDrag = null;          // 指针拖拽状态（替代不稳定的原生 HTML5 拖拽）
  var suppressClick = false;     // 拖拽结束后抑制紧随其后的 click
  var DRAG_THRESHOLD = 6;        // 超过该位移才视为拖拽
  var ctxMenu = null;            // 卡片右键菜单
  var ctxTargetId = null;        // 右键菜单当前作用的镜头
  var el = {};
  var playState = { raf: null, playing: false, index: 0, duration: 1000, elapsed: 0, lastTick: 0 };

  function uid() { return 'sb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function frameIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 9h18M7 5v14M17 5v14" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>';
  }

  /* ---------------- 数据 ---------------- */
  function makePanel(sceneId) {
    return {
      id: uid(), sceneId: sceneId, image: '',
      shot: '中景', move: '固定', angle: '平视',
      duration: 3, desc: '', dialogue: '', notes: ''
    };
  }
  function defaultProject() {
    var s = { id: uid(), title: '场景 1', desc: '' };
    return { name: '未命名分镜', scenes: [s], panels: [makePanel(s.id)] };
  }
  function normalize(p) {
    if (!p || typeof p !== 'object') return defaultProject();
    var scenes = Array.isArray(p.scenes) ? p.scenes.filter(function (s) { return s && s.id; }) : [];
    if (!scenes.length) scenes = [{ id: uid(), title: '场景 1', desc: '' }];
    var valid = {};
    scenes.forEach(function (s) { valid[s.id] = true; if (!s.title) s.title = '未命名场次'; s.desc = s.desc || ''; });
    var panels = Array.isArray(p.panels) ? p.panels.filter(function (x) { return x && x.id; }) : [];
    panels.forEach(function (x) {
      if (!valid[x.sceneId]) x.sceneId = scenes[0].id;
      x.image = x.image || '';
      x.shot = x.shot || '中景';
      x.move = x.move || '固定';
      x.angle = x.angle || '平视';
      x.duration = Number(x.duration) > 0 ? Number(x.duration) : 3;
      x.desc = x.desc || '';
      x.dialogue = x.dialogue || '';
      x.notes = x.notes || '';
    });
    return { name: p.name || '未命名分镜', scenes: scenes, panels: panels };
  }

  function lsKey() {
    var u = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    return u ? (LS_PREFIX + '.' + u) : LS_PREFIX;
  }
  function loadProject() {
    try {
      var raw = localStorage.getItem(lsKey());
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveNow() {
    try { localStorage.setItem(lsKey(), JSON.stringify(project)); }
    catch (e) { toast('保存失败：本地存储空间不足（画面图片过多）', 'error'); }
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }

  function findScene(id) {
    for (var i = 0; i < project.scenes.length; i++) if (project.scenes[i].id === id) return project.scenes[i];
    return null;
  }
  function findPanel(id) {
    for (var i = 0; i < project.panels.length; i++) if (project.panels[i].id === id) return project.panels[i];
    return null;
  }
  function panelsOf(sceneId) { return project.panels.filter(function (p) { return p.sceneId === sceneId; }); }
  function globalIndex(p) { return project.panels.indexOf(p); }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
    el.board = $('sbBoard');
    el.meta = $('sbMeta');
    el.nameInput = $('sbProjectName');
    el.inspEmpty = $('sbInspEmpty');
    el.inspBody = $('sbInspBody');
    el.inspIndex = $('sbInspIndex');
    el.inspThumb = $('sbInspThumb');
    el.inspScene = $('sbInspScene');
    el.inspShot = $('sbInspShot');
    el.inspMove = $('sbInspMove');
    el.inspAngle = $('sbInspAngle');
    el.inspDur = $('sbInspDur');
    el.inspDesc = $('sbInspDesc');
    el.inspDialogue = $('sbInspDialogue');
    el.inspNotes = $('sbInspNotes');
    el.imageInput = $('sbImageInput');
    el.importInput = $('sbImportInput');
    el.playOverlay = $('sbPlayOverlay');
    el.playStage = $('sbPlayStage');
    el.playCap = $('sbPlayCap');
    el.playIndex = $('sbPlayIndex');
    el.playProg = $('sbPlayProg');
    el.playToggle = $('sbPlayToggle');

    fillSelect(el.inspShot, SHOT_SIZES);
    fillSelect(el.inspMove, MOVES);
    fillSelect(el.inspAngle, ANGLES);

    bindTop();
    bindBoard();
    bindContextMenu();
    bindInspector();
    bindPlay();
  }

  function fillSelect(sel, list) {
    if (!sel) return;
    sel.innerHTML = '';
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  function bindTop() {
    el.nameInput.addEventListener('input', function () {
      project.name = el.nameInput.value.trim() || '未命名分镜';
      scheduleSave();
    });
    $('sbAddSceneBtn').addEventListener('click', addScene);
    $('sbExportBtn').addEventListener('click', exportJSON);
    $('sbPrintBtn').addEventListener('click', printBoard);
    $('sbPlayBtn').addEventListener('click', startPlay);
    $('sbImportBtn').addEventListener('click', function () { el.importInput.click(); });
    el.importInput.addEventListener('change', importJSON);
    el.imageInput.addEventListener('change', onImagePicked);
  }

  /* ---------------- 渲染 ---------------- */
  function renderBoard() {
    if (!el.board) return;
    var b = el.board;
    b.innerHTML = '';
    project.scenes.forEach(function (scene, si) {
      var sec = document.createElement('section');
      sec.className = 'hm-sb-scene';
      sec.dataset.scene = scene.id;

      var head = document.createElement('div');
      head.className = 'hm-sb-scene-head';
      head.dataset.dropScene = scene.id;
      head.innerHTML =
        '<span class="hm-sb-scene-no">' + (si + 1) + '</span>' +
        '<input class="hm-sb-scene-title" value="' + esc(scene.title) + '" maxlength="40" title="场次名称">' +
        '<input class="hm-sb-scene-desc" value="' + esc(scene.desc) + '" maxlength="120" placeholder="场次说明（地点 / 时间 / 氛围）">' +
        '<span class="hm-sb-scene-count">' + panelsOf(scene.id).length + ' 镜头</span>' +
        '<button class="hm-sb-mini" data-addshot="' + scene.id + '">+ 镜头</button>' +
        '<button class="hm-sb-mini danger" data-delscene="' + scene.id + '">删除场次</button>';
      sec.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'hm-sb-grid';
      grid.dataset.dropScene = scene.id;
      panelsOf(scene.id).forEach(function (p) {
        grid.appendChild(buildCard(p));
      });
      var add = document.createElement('div');
      add.className = 'hm-sb-addcard';
      add.dataset.addshot = scene.id;
      add.dataset.dropScene = scene.id;
      add.innerHTML = '<span>＋ 添加镜头</span>';
      grid.appendChild(add);
      sec.appendChild(grid);
      b.appendChild(sec);
    });
    updateMeta();
    syncInspector();
  }

  function buildCard(p) {
    var card = document.createElement('div');
    card.className = 'hm-sb-card' + (p.id === selectedId ? ' is-sel' : '');
    card.dataset.id = p.id;
    var thumb = p.image
      ? '<img src="' + p.image + '" alt="">'
      : '<div class="hm-sb-ph">' + frameIcon() + '<span>未上传画面</span></div>';
    card.innerHTML =
      '<div class="hm-sb-thumb">' + thumb + '<span class="hm-sb-idx">#' + (globalIndex(p) + 1) + '</span></div>' +
      '<div class="hm-sb-card-body">' +
        '<div class="hm-sb-card-title">' + esc(p.desc || '未命名镜头') + '</div>' +
        '<div class="hm-sb-card-tags">' +
          '<span class="hm-sb-tag">' + esc(p.shot) + '</span>' +
          '<span class="hm-sb-tag">' + esc(p.move) + '</span>' +
          (p.angle !== '平视' ? '<span class="hm-sb-tag">' + esc(p.angle) + '</span>' : '') +
          '<span class="hm-sb-tag">' + p.duration.toFixed(1) + 's</span>' +
        '</div>' +
      '</div>';
    return card;
  }

  function updateMeta() {
    var total = project.panels.reduce(function (a, p) { return a + (Number(p.duration) || 0); }, 0);
    el.meta.textContent = project.scenes.length + ' 个场次 · ' + project.panels.length + ' 个镜头 · 总时长 ' + total.toFixed(1) + 's';
  }

  function updateCardInPlace(p) {
    var card = el.board.querySelector('.hm-sb-card[data-id="' + p.id + '"]');
    if (!card) return;
    card.replaceWith(buildCard(p));
  }

  /* ---------------- 场次与镜头操作 ---------------- */
  function addScene() {
    var s = { id: uid(), title: '场景 ' + (project.scenes.length + 1), desc: '' };
    project.scenes.push(s);
    var p = makePanel(s.id);
    project.panels.push(p);
    selectedId = p.id;
    saveNow();
    renderBoard();
  }

  function deleteScene(id) {
    if (project.scenes.length <= 1) { toast('至少保留一个场次', 'info'); return; }
    var sc = findScene(id);
    if (!sc) return;
    if (!window.confirm('删除「' + sc.title + '」及其下所有镜头？')) return;
    project.scenes = project.scenes.filter(function (s) { return s.id !== id; });
    project.panels = project.panels.filter(function (p) { return p.sceneId !== id; });
    if (selectedId && !findPanel(selectedId)) selectedId = null;
    saveNow();
    renderBoard();
  }

  function addShot(sceneId) {
    if (!findScene(sceneId)) return;
    var p = makePanel(sceneId);
    var last = -1;
    for (var i = 0; i < project.panels.length; i++) if (project.panels[i].sceneId === sceneId) last = i;
    project.panels.splice(last + 1, 0, p);
    selectedId = p.id;
    saveNow();
    renderBoard();
  }

  function deletePanel(id) {
    var p = findPanel(id);
    if (!p) return;
    if (!window.confirm('删除该镜头？')) return;
    var i = project.panels.indexOf(p);
    project.panels.splice(i, 1);
    var next = project.panels[Math.min(i, project.panels.length - 1)];
    selectedId = next ? next.id : null;
    saveNow();
    renderBoard();
  }

  function duplicatePanel(id) {
    var p = findPanel(id);
    if (!p) return;
    var copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    project.panels.splice(project.panels.indexOf(p) + 1, 0, copy);
    selectedId = copy.id;
    saveNow();
    renderBoard();
  }

  function navPanel(delta) {
    var p = findPanel(selectedId);
    if (!p) return;
    var i = project.panels.indexOf(p) + delta;
    if (i < 0 || i >= project.panels.length) return;
    selectedId = project.panels[i].id;
    renderBoard();
  }

  /* ---------------- 拖拽排序（支持跨场次） ---------------- */
  function clearDropMarks() {
    el.board.querySelectorAll('.drop-target').forEach(function (n) { n.classList.remove('drop-target'); });
  }

  function bindBoard() {
    el.board.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; }
      var add = e.target.closest('[data-addshot]');
      if (add) { addShot(add.getAttribute('data-addshot')); return; }
      var del = e.target.closest('[data-delscene]');
      if (del) { deleteScene(del.getAttribute('data-delscene')); return; }
      var card = e.target.closest('.hm-sb-card');
      if (card) { selectedId = card.dataset.id; renderBoard(); }
    });

    el.board.addEventListener('input', function (e) {
      var t = e.target;
      var sec = t.closest('.hm-sb-scene');
      if (!sec) return;
      var sc = findScene(sec.dataset.scene);
      if (!sc) return;
      if (t.classList.contains('hm-sb-scene-title')) { sc.title = t.value; scheduleSave(); }
      else if (t.classList.contains('hm-sb-scene-desc')) { sc.desc = t.value; scheduleSave(); }
    });

    /* 指针拖拽排序：不依赖原生 HTML5 拖拽（拖拽图片/全局事件易导致失效），鼠标与触屏均可稳定工作 */
    el.board.addEventListener('pointerdown', onCardPointerDown);

    /* 失焦 / 页面隐藏时兜底清理拖拽态，避免拖拽副本残留把界面卡住 */
    window.addEventListener('blur', resetDragState);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) resetDragState();
    });
  }

  function onCardPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, input, select, textarea')) return;
    var card = e.target.closest('.hm-sb-card');
    if (!card || !card.dataset.id) return;
    // 上一次拖拽若未正常结束（如在窗口外松开），先彻底清理，避免副本叠加
    if (pressDrag) { var stale = pressDrag; pressDrag = null; endPressDrag(stale); }
    pressDrag = {
      id: card.dataset.id,
      card: card,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      ghost: null,
      offsetX: 0,
      offsetY: 0,
      target: null,
      pointerId: e.pointerId
    };
    // 指针捕获：即使指针移出窗口 / 画板，pointerup 仍能送达，避免拖拽卡死
    try { card.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    window.addEventListener('pointermove', onCardPointerMove, { passive: false });
    window.addEventListener('pointerup', onCardPointerUp);
    window.addEventListener('pointercancel', onCardPointerCancel);
  }

  function onCardPointerMove(e) {
    if (!pressDrag) return;
    var dx = e.clientX - pressDrag.startX;
    var dy = e.clientY - pressDrag.startY;
    if (!pressDrag.active) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      startGhost(e);
    }
    if (e.cancelable) e.preventDefault();
    var r = pressDrag.card.getBoundingClientRect();
    pressDrag.ghost.style.left = (e.clientX - pressDrag.offsetX) + 'px';
    pressDrag.ghost.style.top = (e.clientY - pressDrag.offsetY) + 'px';
    pressDrag.ghost.style.width = r.width + 'px';

    var under = document.elementFromPoint(e.clientX, e.clientY);
    var t = under ? under.closest('.hm-sb-card, .hm-sb-addcard, .hm-sb-scene-head, .hm-sb-grid') : null;
    clearDropMarks();
    if (t && !(t.classList.contains('hm-sb-card') && t.dataset.id === pressDrag.id)) {
      t.classList.add('drop-target');
      pressDrag.target = t;
    } else {
      pressDrag.target = null;
    }
  }

  function startGhost(e) {
    pressDrag.active = true;
    var card = pressDrag.card;
    var r = card.getBoundingClientRect();
    pressDrag.offsetX = e.clientX - r.left;
    pressDrag.offsetY = e.clientY - r.top;
    var g = card.cloneNode(true);
    g.className = 'hm-sb-card hm-sb-ghost';
    g.style.position = 'fixed';
    g.style.left = r.left + 'px';
    g.style.top = r.top + 'px';
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    document.body.appendChild(g);
    pressDrag.ghost = g;
    card.classList.add('is-press-drag');
    document.body.classList.add('hm-sb-dragging');
  }

  function endPressDrag(pd) {
    var d = pd || pressDrag;
    window.removeEventListener('pointermove', onCardPointerMove);
    window.removeEventListener('pointerup', onCardPointerUp);
    window.removeEventListener('pointercancel', onCardPointerCancel);
    if (d) {
      if (d.ghost) d.ghost.remove();
      if (d.card) d.card.classList.remove('is-press-drag');
    }
    // 兜底：清掉任何残留的拖拽副本，防止多次拖拽后叠加卡死
    document.querySelectorAll('.hm-sb-ghost').forEach(function (n) { n.remove(); });
    document.body.classList.remove('hm-sb-dragging');
    clearDropMarks();
  }

  function onCardPointerUp() {
    var pd = pressDrag;
    pressDrag = null;
    endPressDrag(pd);
    if (!pd || !pd.active) return;         // 未超过阈值：交给 click 正常选中
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    if (pd.target) dropPanel(pd.id, pd.target);
    else renderBoard();
  }

  function onCardPointerCancel() {
    var pd = pressDrag;
    pressDrag = null;
    endPressDrag(pd);
  }

  function resetDragState() {
    if (pressDrag) { var pd = pressDrag; pressDrag = null; endPressDrag(pd); }
    document.querySelectorAll('.hm-sb-ghost').forEach(function (n) { n.remove(); });
    document.body.classList.remove('hm-sb-dragging');
    clearDropMarks();
  }

  /* ---------------- 卡片右键菜单 ---------------- */
  function bindContextMenu() {
    el.board.addEventListener('contextmenu', function (e) {
      var card = e.target.closest('.hm-sb-card');
      if (!card || !card.dataset.id) return;
      e.preventDefault();
      selectedId = card.dataset.id;
      el.board.querySelectorAll('.hm-sb-card.is-sel').forEach(function (n) { n.classList.remove('is-sel'); });
      card.classList.add('is-sel');
      syncInspector();
      showCtxMenu(card.dataset.id, e.clientX, e.clientY);
    });
    el.board.addEventListener('scroll', hideCtxMenu);
    document.addEventListener('pointerdown', function (e) {
      if (ctxMenu && !ctxMenu.hidden && !ctxMenu.contains(e.target)) hideCtxMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideCtxMenu();
    });
    window.addEventListener('resize', hideCtxMenu);
  }

  function ensureCtxMenu() {
    if (ctxMenu) return ctxMenu;
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'hm-sb-ctx';
    ctxMenu.hidden = true;
    ctxMenu.innerHTML =
      '<button type="button" data-ctx="dup">复制镜头</button>' +
      '<button type="button" data-ctx="del" class="danger">删除镜头</button>';
    document.body.appendChild(ctxMenu);
    ctxMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ctx]');
      if (!btn) return;
      var act = btn.getAttribute('data-ctx');
      var id = ctxTargetId;
      hideCtxMenu();
      if (!id) return;
      if (act === 'dup') duplicatePanel(id);
      else if (act === 'del') deletePanel(id);
    });
    return ctxMenu;
  }

  function showCtxMenu(id, x, y) {
    ensureCtxMenu();
    ctxTargetId = id;
    ctxMenu.hidden = false;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    var r = ctxMenu.getBoundingClientRect();
    var maxLeft = window.innerWidth - r.width - 8;
    var maxTop = window.innerHeight - r.height - 8;
    ctxMenu.style.left = Math.max(8, Math.min(x, maxLeft)) + 'px';
    ctxMenu.style.top = Math.max(8, Math.min(y, maxTop)) + 'px';
  }

  function hideCtxMenu() {
    if (ctxMenu) ctxMenu.hidden = true;
    ctxTargetId = null;
  }

  function dropPanel(id, target) {
    var p = findPanel(id);
    if (!p) return;
    if (target.classList.contains('hm-sb-card')) {
      var tp = findPanel(target.dataset.id);
      if (!tp || tp.id === p.id) return;
      moveBefore(p, tp);
    } else {
      var sceneId = target.dataset.dropScene;
      if (!sceneId) {
        var sec = target.closest('[data-drop-scene]');
        sceneId = sec ? sec.dataset.dropScene : '';
      }
      if (!sceneId || !findScene(sceneId)) return;
      moveToEnd(p, sceneId);
    }
    selectedId = p.id;
    saveNow();
    renderBoard();
  }

  function moveBefore(p, beforePanel) {
    var from = project.panels.indexOf(p);
    if (from >= 0) project.panels.splice(from, 1);
    p.sceneId = beforePanel.sceneId;
    var to = project.panels.indexOf(beforePanel);
    if (to < 0) project.panels.push(p); else project.panels.splice(to, 0, p);
  }

  function moveToEnd(p, sceneId) {
    var from = project.panels.indexOf(p);
    if (from >= 0) project.panels.splice(from, 1);
    p.sceneId = sceneId;
    var last = -1;
    for (var i = 0; i < project.panels.length; i++) if (project.panels[i].sceneId === sceneId) last = i;
    project.panels.splice(last + 1, 0, p);
  }

  /* ---------------- 检查器 ---------------- */
  function syncInspector() {
    var p = findPanel(selectedId);
    el.inspEmpty.hidden = !!p;
    el.inspBody.hidden = !p;
    if (!p) { el.inspIndex.textContent = ''; return; }
    el.inspIndex.textContent = '#' + (globalIndex(p) + 1);

    el.inspThumb.innerHTML = p.image
      ? '<img src="' + p.image + '" alt="">'
      : '<div class="hm-sb-ph">' + frameIcon() + '<span>点击上传画面</span></div>';

    el.inspScene.innerHTML = '';
    project.scenes.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = '场次 ' + (i + 1) + '：' + s.title;
      if (s.id === p.sceneId) o.selected = true;
      el.inspScene.appendChild(o);
    });

    el.inspShot.value = p.shot;
    el.inspMove.value = p.move;
    el.inspAngle.value = p.angle;
    el.inspDur.value = p.duration;
    el.inspDesc.value = p.desc;
    el.inspDialogue.value = p.dialogue;
    el.inspNotes.value = p.notes;
  }

  function setField(field, value) {
    var p = findPanel(selectedId);
    if (!p) return;
    p[field] = value;
    updateCardInPlace(p);
    updateMeta();
    scheduleSave();
  }

  function bindInspector() {
    $('sbInspUpload').addEventListener('click', function () { pickImage(selectedId); });
    el.inspThumb.addEventListener('click', function () { pickImage(selectedId); });
    $('sbInspClearImg').addEventListener('click', function () {
      var p = findPanel(selectedId);
      if (!p) return;
      p.image = '';
      saveNow();
      renderBoard();
    });

    el.inspScene.addEventListener('change', function () {
      var p = findPanel(selectedId);
      if (!p) return;
      var sid = el.inspScene.value;
      if (sid && p.sceneId !== sid && findScene(sid)) {
        p.sceneId = sid;
        saveNow();
        renderBoard();
      }
    });

    el.inspShot.addEventListener('change', function () { setField('shot', el.inspShot.value); });
    el.inspMove.addEventListener('change', function () { setField('move', el.inspMove.value); });
    el.inspAngle.addEventListener('change', function () { setField('angle', el.inspAngle.value); });
    el.inspDur.addEventListener('input', function () {
      var v = parseFloat(el.inspDur.value);
      if (!isFinite(v) || v <= 0) return;
      setField('duration', v);
    });
    el.inspDesc.addEventListener('input', function () { setField('desc', el.inspDesc.value); });
    el.inspDialogue.addEventListener('input', function () { setField('dialogue', el.inspDialogue.value); });
    el.inspNotes.addEventListener('input', function () { setField('notes', el.inspNotes.value); });

    $('sbInspPrev').addEventListener('click', function () { navPanel(-1); });
    $('sbInspNext').addEventListener('click', function () { navPanel(1); });
    $('sbInspDup').addEventListener('click', function () { duplicatePanel(selectedId); });
    $('sbInspDel').addEventListener('click', function () { deletePanel(selectedId); });
  }

  /* ---------------- 画面图片 ---------------- */
  function pickImage(id) {
    if (!id) { toast('请先选择一个镜头', 'info'); return; }
    imageTargetId = id;
    el.imageInput.value = '';
    el.imageInput.click();
  }

  function onImagePicked() {
    var f = el.imageInput.files && el.imageInput.files[0];
    if (!f || !imageTargetId) return;
    compressImage(f, function (dataUrl) {
      var p = findPanel(imageTargetId);
      if (p) {
        p.image = dataUrl;
        saveNow();
        renderBoard();
      }
      el.imageInput.value = '';
    });
  }

  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 720;
          var sc = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.round(img.width * sc), h = Math.round(img.height * sc);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { cb(reader.result); }
      };
      img.onerror = function () { cb(reader.result); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- 导入 / 导出 / 打印 ---------------- */
  function exportJSON() {
    var blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (project.name || 'storyboard') + '.storyboard.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出分镜 JSON', 'success');
  }

  function importJSON() {
    var f = el.importInput.files && el.importInput.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        project = normalize(data);
        selectedId = project.panels[0] ? project.panels[0].id : null;
        el.nameInput.value = project.name;
        saveNow();
        renderBoard();
        toast('已导入故事版', 'success');
      } catch (e) {
        toast('导入失败：文件不是有效的分镜 JSON', 'error');
      }
    };
    reader.readAsText(f);
    el.importInput.value = '';
  }

  function printBoard() {
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(project.name) + ' · 故事版</title>' +
      '<style>' +
      'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#111;margin:24px;background:#fff}' +
      'h1{font-size:22px;margin:0 0 4px}.meta{color:#666;font-size:12px;margin-bottom:20px}' +
      'h2{font-size:15px;margin:22px 0 10px;padding-bottom:6px;border-bottom:2px solid #111}' +
      'h2 small{font-weight:400;color:#666;font-size:12px;margin-left:8px}' +
      '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}' +
      '.cell{border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid}' +
      '.thumb{aspect-ratio:16/9;background:#f2f2f2;display:flex;align-items:center;justify-content:center}' +
      '.thumb img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.noph{color:#aaa;font-size:12px}.bar{display:flex;gap:8px;align-items:center;padding:6px 8px;font-size:11px;border-bottom:1px solid #eee;background:#fafafa}' +
      '.no{font-weight:700}.tag{background:#eee;border-radius:4px;padding:1px 5px}' +
      '.desc{padding:8px;font-size:12px;line-height:1.5;margin:0}.dia{padding:0 8px 6px;font-size:12px;color:#1a4b8c;margin:0}' +
      '.note{padding:0 8px 8px;font-size:11px;color:#777;margin:0}' +
      '@media print{body{margin:12mm}}' +
      '</style></head><body>';
    html += '<h1>' + esc(project.name) + '</h1>';
    var total = project.panels.reduce(function (a, p) { return a + (Number(p.duration) || 0); }, 0);
    html += '<div class="meta">' + project.scenes.length + ' 个场次 · ' + project.panels.length + ' 个镜头 · 总时长 ' + total.toFixed(1) + 's</div>';
    project.scenes.forEach(function (s, si) {
      var ps = panelsOf(s.id);
      html += '<h2>场次 ' + (si + 1) + '：' + esc(s.title) + (s.desc ? '<small>' + esc(s.desc) + '</small>' : '') + '</h2>';
      html += '<div class="grid">';
      ps.forEach(function (p) {
        html += '<div class="cell">' +
          '<div class="thumb">' + (p.image ? '<img src="' + p.image + '">' : '<span class="noph">未上传画面</span>') + '</div>' +
          '<div class="bar"><span class="no">#' + (globalIndex(p) + 1) + '</span>' +
            '<span class="tag">' + esc(p.shot) + '</span>' +
            '<span class="tag">' + esc(p.move) + '</span>' +
            '<span class="tag">' + esc(p.angle) + '</span>' +
            '<span class="tag">' + p.duration.toFixed(1) + 's</span></div>' +
          '<p class="desc">' + esc(p.desc || '（无描述）') + '</p>' +
          (p.dialogue ? '<p class="dia">♪ ' + esc(p.dialogue) + '</p>' : '') +
          (p.notes ? '<p class="note">备注：' + esc(p.notes) + '</p>' : '') +
          '</div>';
      });
      html += '</div>';
    });
    html += '</body></html>';

    var w = window.open('', '_blank');
    if (!w) { toast('请允许弹出窗口后再打印', 'error'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) { /* ignore */ } }, 400);
  }

  /* ---------------- 动态预览（Animatic） ---------------- */
  function bindPlay() {
    $('sbPlayClose').addEventListener('click', stopPlay);
    el.playToggle.addEventListener('click', togglePlay);
    document.addEventListener('keydown', function (e) {
      if (el.playOverlay.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); stopPlay(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });
  }

  function startPlay() {
    if (!project.panels.length) { toast('还没有镜头，先添加镜头', 'info'); return; }
    playState.index = 0;
    playState.playing = true;
    el.playOverlay.hidden = false;
    showPlayFrame();
  }

  function showPlayFrame() {
    var p = project.panels[playState.index];
    if (!p) { stopPlay(); return; }
    el.playIndex.textContent = (playState.index + 1) + '/' + project.panels.length;
    el.playStage.innerHTML = p.image
      ? '<img src="' + p.image + '" alt="">'
      : '<div class="hm-sb-play-ph">镜头 ' + (playState.index + 1) + ' · 未上传画面</div>';
    var cap = [p.shot, p.move, (p.angle !== '平视' ? p.angle : ''), p.desc || ('镜头 ' + (playState.index + 1))];
    el.playCap.textContent = cap.filter(function (x) { return x; }).join(' · ');
    el.playToggle.textContent = playState.playing ? '暂停' : '播放';
    restartTimer(Number(p.duration) || 3);
  }

  function restartTimer(seconds) {
    cancelAnimationFrame(playState.raf);
    playState.raf = null;
    playState.duration = Math.max(300, seconds * 1000);
    playState.elapsed = 0;
    playState.lastTick = 0;
    el.playProg.style.width = '0%';
    if (playState.playing) playState.raf = requestAnimationFrame(tickPlay);
  }

  function tickPlay(now) {
    if (!playState.playing) return;
    if (!playState.lastTick) playState.lastTick = now;
    var dt = now - playState.lastTick;
    playState.lastTick = now;
    playState.elapsed += dt;
    var pct = Math.min(1, playState.elapsed / playState.duration);
    el.playProg.style.width = (pct * 100) + '%';
    if (pct >= 1) {
      playState.index++;
      if (playState.index >= project.panels.length) { stopPlay(); return; }
      showPlayFrame();
      return;
    }
    playState.raf = requestAnimationFrame(tickPlay);
  }

  function togglePlay() {
    if (el.playOverlay.hidden) return;
    if (playState.playing) {
      playState.playing = false;
      cancelAnimationFrame(playState.raf);
      playState.raf = null;
      el.playToggle.textContent = '播放';
    } else {
      playState.playing = true;
      playState.lastTick = 0;
      el.playToggle.textContent = '暂停';
      playState.raf = requestAnimationFrame(tickPlay);
    }
  }

  function stopPlay() {
    playState.playing = false;
    if (playState.raf) cancelAnimationFrame(playState.raf);
    playState.raf = null;
    if (el.playOverlay) el.playOverlay.hidden = true;
  }

  /* ---------------- 对外接口 ---------------- */
  function enter() {
    init();
    resetDragState();
    var key = lsKey();
    if (!project || loadedKey !== key) {
      var saved = loadProject();
      project = saved || project || defaultProject();
      loadedKey = key;
      selectedId = selectedId && findPanel(selectedId) ? selectedId : (project.panels[0] ? project.panels[0].id : null);
    }
    el.nameInput.value = project.name;
    renderBoard();
  }

  function pause() { stopPlay(); }

  return { init: init, enter: enter, pause: pause };
})();
