'use strict';

/* =============================================================
 * 绘梦 · 桌面 / 项目文件夹 / 历史记录
 * 依赖 app.js 暴露的 window.HMApp 与 api.js 的 window.HM.api
 * ============================================================= */
(function () {
  var A = window.HMApp;
  if (!A) return;
  var api = window.HM && window.HM.api;
  var state = A.state;
  var esc = A.esc;
  var LS_DESK = 'anidream.desk.v1';

  var CARD_W = 200;
  var CARD_H = 240;
  var GAP = 14;
  var PAD = 12;

  /* ---------------- 数据 ---------------- */
  var desk = {
    folders: [],
    positions: {},
    assigns: {},
    names: {},
    updatedAt: 0
  };

  var view = {
    activeFolder: null,
    sort: 'newest',
    search: '',
    selected: {},
    cut: null,
    z: 20,
    menuWork: null,
    menuFolder: null,
    paramWork: null,
    renameCb: null,
    sizeKey: ''
  };

  var hist = {
    page: 1,
    per: 24,
    zoom: 100,
    tab: 'history',
    q: '',
    type: 'all',
    model: 'all',
    folder: 'all'
  };

  function load() {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(LS_DESK) || 'null');
    } catch (err) {
      stored = null;
    }
    if (!stored || typeof stored !== 'object') return;
    desk.folders = Array.isArray(stored.folders) ? stored.folders.filter(function (f) { return f && f.id && f.name; }) : [];
    desk.positions = stored.positions && typeof stored.positions === 'object' ? stored.positions : {};
    desk.assigns = stored.assigns && typeof stored.assigns === 'object' ? stored.assigns : {};
    desk.names = stored.names && typeof stored.names === 'object' ? stored.names : {};
    desk.updatedAt = Number(stored.updatedAt) || 0;
  }

  var persistTimer = null;

  function payload() {
    return {
      folders: desk.folders,
      positions: desk.positions,
      assigns: desk.assigns,
      names: desk.names,
      updatedAt: desk.updatedAt
    };
  }

  function persistNow() {
    desk.updatedAt = Date.now();
    try {
      localStorage.setItem(LS_DESK, JSON.stringify(payload()));
    } catch (err) {
      /* 存储空间不足时静默失败 */
    }
    if (api && api.online && api.saveDesk) {
      api.saveDesk(payload()).catch(function () {});
    }
  }

  function persistSoon() {
    if (persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistNow();
    }, 260);
  }

  function syncServer() {
    if (!api || !api.online || !api.getDesk) return;
    api.getDesk().then(function (d) {
      if (!d || typeof d !== 'object') return;
      var remote = d.desk || d;
      if (!remote || !Array.isArray(remote.folders)) return;
      var remoteTime = Number(remote.updatedAt) || 0;
      if (remoteTime > desk.updatedAt) {
        desk.folders = remote.folders;
        desk.positions = remote.positions || {};
        desk.assigns = remote.assigns || {};
        desk.names = remote.names || {};
        desk.updatedAt = remoteTime;
        try {
          localStorage.setItem(LS_DESK, JSON.stringify(payload()));
        } catch (err) {}
        renderAll();
      } else if (desk.updatedAt) {
        persistNow();
      }
    }).catch(function () {});
  }

  /* ---------------- 工具 ---------------- */
  function $(sel) {
    return document.querySelector(sel);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function findWork(id) {
    for (var i = 0; i < state.works.length; i += 1) {
      if (state.works[i] && state.works[i].id === id) return state.works[i];
    }
    return null;
  }

  function today(ts) {
    var d = new Date(ts || Date.now());
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function typeLabel(type) {
    if (type === 'video') return '视频';
    if (type === 'audio') return '音频';
    return '图片';
  }

  function workName(work) {
    if (!work) return '未命名';
    if (desk.names[work.id]) return desk.names[work.id];
    if (work.name) return work.name;
    var text = String(work.prompt || '').trim();
    if (text) return text.length > 16 ? text.slice(0, 16) + '…' : text;
    return (work.modelName || '作品') + ' ' + (work.type === 'video' ? '视频' : work.type === 'audio' ? '音频' : '图片');
  }

  function mediaHtml(work, mode) {
    var url = esc(work.thumb || work.url || '');
    var cls = mode === 'history' ? 'hm-history-media' : 'desk-media-inner';
    if (work.type === 'video') {
      return '<div class="' + cls + ' is-video"><video src="' + url + '" muted playsinline preload="metadata"></video><span class="media-play">▶</span></div>';
    }
    if (work.type === 'audio') {
      return '<div class="' + cls + ' is-audio"><span>♪</span><small>音频</small></div>';
    }
    return '<div class="' + cls + '"><img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy" draggable="false"></div>';
  }

  function folderOf(id) {
    return desk.assigns[id] || null;
  }

  function folderName(id) {
    var f = desk.folders.find(function (x) { return x.id === id; });
    return f ? f.name : '个人空间';
  }

  function creditOf(work) {
    if (work.type === 'video') return 60;
    if (work.type === 'audio') return 10;
    return 1;
  }

  /* ---------------- 项目文件夹 ---------------- */
  function visibleFolders() {
    var list = desk.folders.slice();
    var q = view.search.trim().toLowerCase();
    if (q) {
      list = list.filter(function (f) {
        return String(f.name).toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) {
      if (view.sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function folderCount(id) {
    return state.works.filter(function (w) { return desk.assigns[w.id] === id; }).length;
  }

  function folderCredit(id) {
    var total = 0;
    state.works.forEach(function (w) {
      if (desk.assigns[w.id] === id) total += creditOf(w);
    });
    return total;
  }

  function renderPanel() {
    var list = byId('projList');
    if (!list) return;
    var total = state.works.length;
    var html = '';
    html += '<button class="hm-proj-row is-history" data-proj="history">' +
      '<span class="hm-proj-ico">◷</span>' +
      '<span class="hm-proj-txt"><strong>历史记录</strong><small>最近 10 分钟 / 项目 / 人员</small></span>' +
      '</button>';
    html += '<div class="hm-proj-space">';
    html += '<button class="hm-proj-row is-space ' + (view.activeFolder === null ? 'is-active' : '') + '" data-proj="space">' +
      '<span class="hm-proj-ico">▫</span>' +
      '<span class="hm-proj-txt"><strong>个人空间</strong><small>' + total + ' 项</small></span>' +
      '<span class="hm-proj-lock">⌾</span>' +
      '</button>';
    html += '<button class="hm-proj-row is-new" data-proj="new">' +
      '<span class="hm-proj-ico">＋</span><span class="hm-proj-txt"><strong>新建文件夹</strong><small>把作品归档到新文件夹</small></span>' +
      '</button>';
    html += '</div>';
    html += '<div class="hm-proj-folders">';
    var folders = visibleFolders();
    if (!folders.length) {
      html += '<p class="hm-proj-none">' + (view.search ? '没有匹配的文件夹' : '还没有文件夹，点击「新建文件夹」开始整理') + '</p>';
    }
    folders.forEach(function (f) {
      var count = folderCount(f.id);
      var credit = folderCredit(f.id);
      html += '<div class="hm-proj-folder ' + (view.activeFolder === f.id ? 'is-active' : '') + '" data-folder-row="' + esc(f.id) + '">' +
        '<button class="hm-proj-folder-main" data-folder-open="' + esc(f.id) + '">' +
        '<span class="hm-folder-ico">▸</span>' +
        '<span class="hm-proj-txt"><strong>' + esc(f.name) + '</strong><small>' + count + ' 项</small></span>' +
        '</button>' +
        '<span class="hm-proj-credit ' + (credit > 0 ? 'is-plus' : '') + '">+' + credit + '</span>' +
        '<button class="hm-proj-more" data-folder-more="' + esc(f.id) + '" aria-label="文件夹操作">⋯</button>' +
        '</div>';
    });
    html += '</div>';
    list.innerHTML = html;
    var sortBtn = byId('projSortBtn');
    if (sortBtn) sortBtn.textContent = view.sort === 'name' ? '排序 · 名称' : '排序 · 最新';
  }

  function openPanel() {
    var panel = byId('projPanel');
    if (!panel) return;
    renderPanel();
    panel.hidden = false;
    var search = byId('projSearch');
    if (search) setTimeout(function () { search.focus(); }, 30);
  }

  function closePanel() {
    var panel = byId('projPanel');
    if (panel) panel.hidden = true;
  }

  function newFolder(cb) {
    var base = '新建文件夹';
    var names = desk.folders.map(function (f) { return f.name; });
    var name = base;
    var index = 2;
    while (names.indexOf(name) >= 0) {
      name = base + ' ' + index;
      index += 1;
    }
    askName('新建文件夹', name, function (value) {
      if (!value) return;
      var folder = { id: 'f' + A.uid(), name: value, createdAt: Date.now() };
      desk.folders.unshift(folder);
      persistNow();
      renderPanel();
      if (cb) cb(folder);
      A.toast('已创建文件夹「' + value + '」', 'success');
    });
  }

  function deleteFolder(id) {
    var folder = desk.folders.find(function (f) { return f.id === id; });
    if (!folder) return;
    if (!window.confirm('删除文件夹「' + folder.name + '」？其中的作品会回到个人空间。')) return;
    desk.folders = desk.folders.filter(function (f) { return f.id !== id; });
    Object.keys(desk.assigns).forEach(function (wid) {
      if (desk.assigns[wid] === id) delete desk.assigns[wid];
    });
    if (view.activeFolder === id) view.activeFolder = null;
    persistNow();
    renderAll();
    A.toast('文件夹已删除', 'info');
  }

  /* ---------------- 桌面 ---------------- */
  function activeWorks() {
    var list = state.works.slice();
    if (view.activeFolder) {
      list = list.filter(function (w) { return desk.assigns[w.id] === view.activeFolder; });
    }
    return list;
  }

  function boardSize(grid) {
    return {
      w: grid.clientWidth || 0,
      h: grid.clientHeight || 0
    };
  }

  function available(grid) {
    var size = boardSize(grid);
    var cardW = cardWidth();
    var edge = 4;
    /* 横向允许贴 rail 边缘，纵向无限（可滚动） */
    return {
      w: Math.max(1, size.w - cardW - edge),
      h: 99999
    };
  }

  function cardWidth() {
    var style = window.getComputedStyle(document.documentElement);
    var v = parseInt(style.getPropertyValue('--desk-w'), 10);
    return v > 0 ? v : CARD_W;
  }

  /* 紧凑网格：从顶部 0,0 开始按行列排，无视已拖散的卡片位置 */
  function compactSlot(idx, grid) {
    var size = boardSize(grid);
    var cardW = cardWidth();
    var cols = Math.max(1, Math.floor((size.w - PAD * 2 + GAP) / (cardW + GAP)));
    var col = idx % cols;
    var row = Math.floor(idx / cols);
    return { pxLeft: PAD + col * (cardW + GAP), pxTop: PAD + row * (CARD_H + GAP), z: idx + 1 };
  }

  /* 找现有卡片占用的最大 bottom px */
  function maxCardBottom(grid) {
    var max = 0;
    grid.querySelectorAll('.desk-card, .result-card.is-desk-job').forEach(function (el) {
      var top = parseInt(el.style.top, 10) || 0;
      max = Math.max(max, top + CARD_H + GAP);
    });
    Object.keys(desk.positions).forEach(function (key) {
      var p = desk.positions[key];
      if (p && typeof p.pxTop === 'number') {
        max = Math.max(max, p.pxTop + CARD_H + GAP);
      }
    });
    return max || (PAD + CARD_H);
  }

  /* 默认布局：有现存卡片时从底部追加，否则从顶部紧凑排 */
  function defaultSlot(idx, grid) {
    var bottom = maxCardBottom(grid);
    /* 如果所有卡片都在顶部附近（没被拖散），直接紧凑排 */
    if (bottom <= PAD + CARD_H + GAP * 2) return compactSlot(idx, grid);
    /* 否则在现有最底部之下开新行 */
    var size = boardSize(grid);
    var cardW = cardWidth();
    var cols = Math.max(1, Math.floor((size.w - PAD * 2 + GAP) / (cardW + GAP)));
    var rowOffset = Math.max(0, Math.floor((bottom - PAD) / (CARD_H + GAP)));
    var col = idx % cols;
    var row = rowOffset + Math.floor(idx / cols);
    return { pxLeft: PAD + col * (cardW + GAP), pxTop: PAD + row * (CARD_H + GAP), z: idx + 1 };
  }

  function placeCard(el, id, idx, grid) {
    if (!el) return;
    var pos = desk.positions[id] || desk.positions['job:' + id];
    if (!pos || (typeof pos.pxTop !== 'number' && typeof pos.y !== 'number')) {
      pos = defaultSlot(idx, grid);
    }
    var left, top;
    if (typeof pos.pxTop === 'number') {
      left = Math.round(pos.pxLeft || 0);
      top = Math.round(pos.pxTop);
    } else {
      left = Math.round(Math.min(1, Math.max(0, pos.x || 0)) * (grid.clientWidth - cardWidth() - 4));
      top = Math.round(Math.min(1, Math.max(0, pos.y || 0)) * grid.clientHeight);
      pos.pxLeft = left;
      pos.pxTop = top;
      delete pos.x;
      delete pos.y;
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.zIndex = String(pos.z || idx + 1);
    if (!desk.positions[id]) desk.positions[id] = { pxLeft: left, pxTop: top, z: pos.z || idx + 1 };
  }

  function deskCardHtml(work) {
    return '<article class="desk-card" data-work="' + esc(work.id) + '" data-type="' + esc(work.type || 'image') + '">' +
      deskCardHtmlInner(work) +
      '</article>';
  }

  function deskCardHtmlInner(work) {
    var name = workName(work);
    var meta = [work.modelName || 'AI', (work.width && work.height) ? work.width + '×' + work.height : ''];
    if (work.type === 'video' && work.duration) meta.push(work.duration + 's');
    if (work.elapsed && work.elapsed > 0) meta.push('耗时 ' + work.elapsed.toFixed(1) + 's');
    return '<div class="desk-thumb">' + mediaHtml(work, 'desk') +
      '<span class="desk-badge">已完成</span></div>' +
      '<div class="desk-info"><strong>' + esc(name) + '</strong><small>' + esc(meta.filter(Boolean).join(' · ')) + '</small></div>' +
      '<div class="desk-acts">' +
      '<button data-dact="preview" title="预览">◉</button>' +
      '<button data-dact="download" title="下载">↓</button>' +
      '<button data-dact="delete" title="删除">✕</button>' +
      '</div>' +
      '<span class="desk-check" aria-hidden="true"></span>';
  }

  function setDockVar() {
    var dock = $('.hm-dock');
    var h = dock ? dock.offsetHeight : 210;
    var grid = byId('resultGrid');
    if (grid) grid.style.setProperty('--hm-dock-h', h + 'px');
    document.documentElement.style.setProperty('--hm-dock-h', h + 'px');
  }

  var deskDirty = false;

  function renderDesktop() {
    var grid = byId('resultGrid');
    if (!grid) return;
    if (document.body.getAttribute('data-view') !== 'create') {
      deskDirty = true;
      return;
    }
    deskDirty = false;
    if (!grid.classList.contains('is-board')) grid.classList.add('is-board');
    setDockVar();

    var works = activeWorks();
    /* 时间升序：最早生成的在最顶行最前，最新的在最底下 */
    works.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

    /* ---------- 清理已完成/失败的 job 节点（它们已进 state.works） ---------- */
    Array.prototype.forEach.call(grid.querySelectorAll('[data-job]'), function (node) {
      if (!node.classList.contains('is-loading')) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    });

    /* ---------- 增量更新 desk-card ---------- */
    var needIds = {};
    works.forEach(function (w) { needIds[w.id] = true; });

    Array.prototype.forEach.call(grid.querySelectorAll('.desk-card'), function (node) {
      var id = node.dataset.work;
      if (!needIds[id]) node.parentNode.removeChild(node);
    });

    works.forEach(function (w, i) {
      var existing = grid.querySelector('.desk-card[data-work="' + w.id + '"]');
      if (!existing) {
        existing = document.createElement('article');
        existing.className = 'desk-card';
        existing.dataset.work = w.id;
        existing.dataset.type = (w.type || 'image');
        grid.appendChild(existing);
      }
      existing.innerHTML = deskCardHtmlInner(w);
      placeCard(existing, w.id, i, grid);
    });

    /* ---------- 原地处理 loading 卡片：不再 removeChild + appendChild ---------- */
    var loadingJobs = [];
    if (A && A.state && A.state.jobs) {
      A.state.jobs.forEach(function (j) {
        if (j.status === 'loading') loadingJobs.push(j);
      });
    }

    /* 清掉 DOM 中已不在 state 的 loading job（不应存在但保险） */
    Array.prototype.forEach.call(grid.querySelectorAll('.result-card.is-desk-job[data-job]'), function (node) {
      var still = loadingJobs.some(function (j) { return j.id === node.dataset.job; });
      if (!still && node.parentNode) node.parentNode.removeChild(node);
    });

    loadingJobs.forEach(function (job, i) {
      var id = job.id;
      /* 找 grid 中已存在的 loading 节点（可能是 createLoadingCard 刚 append 的，
         也可能是上次 renderDesktop 标记过的 is-desk-job） */
      var existing = grid.querySelector('.result-card.is-desk-job[data-job="' + id + '"]')
                 || grid.querySelector('.result-card[data-job="' + id + '"]');
      if (!existing) {
        /* 极端兜底 */
        existing = document.createElement('article');
        existing.className = 'result-card is-loading';
        existing.dataset.job = id;
      }
      existing.classList.add('is-desk-job');
      /* 关键：确保节点在 grid 里（如果之前被误移除则 append 回来） */
      if (!existing.parentNode) grid.appendChild(existing);
      var pos = desk.positions['job:' + id];
      if (!pos) {
        pos = defaultSlot(works.length + i, grid);
        desk.positions['job:' + id] = pos;
      }
      /* px 坐标渲染 */
      var leftPx = typeof pos.pxLeft === 'number' ? pos.pxLeft : 0;
      var topPx = typeof pos.pxTop === 'number' ? pos.pxTop : 0;
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        /* 迁移旧百分比坐标 */
        leftPx = Math.round(Math.min(1, Math.max(0, pos.x)) * (grid.clientWidth - cardWidth() - 4));
        topPx = Math.round(Math.min(1, Math.max(0, pos.y)) * grid.clientHeight);
        pos.pxLeft = leftPx;
        pos.pxTop = topPx;
        delete pos.x;
        delete pos.y;
      }
      existing.style.left = leftPx + 'px';
      existing.style.top = topPx + 'px';
      existing.style.zIndex = String(30 + i);
    });

    /* 首帧可能早于画板完成布局，待布局稳定后按真实尺寸重排一次（只动位置，不重建 DOM） */
    var sizeKey = grid.clientWidth + 'x' + grid.clientHeight;
    if (view.sizeKey !== sizeKey) {
      view.sizeKey = sizeKey;
      window.requestAnimationFrame(function () {
        var g = byId('resultGrid');
        if (!g || g !== grid) return;
        var key = g.clientWidth + 'x' + g.clientHeight;
        if (key === view.sizeKey) return;
        view.sizeKey = key;
        Array.prototype.forEach.call(g.querySelectorAll('.desk-card'), function (el, idx) {
          if (el.dataset.work) placeCard(el, el.dataset.work, idx, g);
        });
      });
    }

    var empty = byId('emptyState');
    var hasJobs = loadingJobs.length > 0;
    if (empty) empty.style.display = (works.length || hasJobs) ? 'none' : 'flex';

    var hint = byId('deskHint');
    if (hint) hint.hidden = works.length < 1 && !hasJobs;

    syncSelection();

    /* 若用户一直在底部附近，自动滚到底部跟随最新生成的图 */
    var distFromBottom = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
    if (distFromBottom < 240) grid.scrollTop = grid.scrollHeight;
  }

  function syncJobs() {
    renderDesktop();
  }

  function renderAll() {
    renderPanel();
    renderDesktop();
    if (document.body.getAttribute('data-view') === 'history') renderHistory();
  }

  function tidy() {
    var grid = byId('resultGrid');
    if (!grid) return;
    /* 按时间从早到晚排列，强制紧凑网格（无视任何拖动过的旧位置） */
    var works = activeWorks();
    works.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    works.forEach(function (w, i) {
      desk.positions[w.id] = compactSlot(i, grid);
    });
    Object.keys(desk.positions).forEach(function (k) {
      if (k.indexOf('job:') === 0) delete desk.positions[k];
    });
    persistNow();
    renderDesktop();
    setTimeout(function () { grid.scrollTop = 0; }, 30);
    A.toast('已按时间紧凑整理（最早在顶）', 'success');
  }

  /* ---------------- 选择 ---------------- */
  function selectedIds() {
    return Object.keys(view.selected).filter(function (id) {
      return view.selected[id] && findWork(id);
    });
  }

  function syncSelection() {
    var grid = byId('resultGrid');
    var ids = selectedIds();
    if (grid) {
      Array.prototype.forEach.call(grid.querySelectorAll('.desk-card[data-work]'), function (el) {
        el.classList.toggle('is-selected', !!view.selected[el.dataset.work]);
        el.classList.toggle('is-cut', view.cut === el.dataset.work);
      });
    }
    var bar = byId('deskSelBar');
    if (bar) {
      bar.hidden = !ids.length;
      var count = byId('deskSelCount');
      if (count) count.textContent = '已选 ' + ids.length + ' 项';
    }
  }

  function clearSelection() {
    view.selected = {};
    syncSelection();
  }

  function selectAll() {
    view.selected = {};
    activeWorks().forEach(function (w) { view.selected[w.id] = true; });
    syncSelection();
  }

  function selectOnly(id) {
    view.selected = {};
    view.selected[id] = true;
    syncSelection();
  }

  function toggleSelect(id) {
    if (view.selected[id]) delete view.selected[id];
    else view.selected[id] = true;
    syncSelection();
  }

  /* ---------------- 拖动 ---------------- */
  var drag = null;

  function onPointerDown(event) {
    if (event.button !== 0) return;
    var grid = byId('resultGrid');
    if (!grid || !grid.contains(event.target)) return;
    /* 同时识别成品卡片和生成中的 job 卡片 */
    var card = event.target.closest('.desk-card[data-work], .result-card.is-desk-job[data-job]');
    var cardW = cardWidth();
    var maxLeft = grid.clientWidth - cardW - 4;

    if (!card) {
      if (event.target === grid) clearSelection();
      return;
    }
    /* 按钮/链接区域不触发拖动 */
    if (event.target.closest('button') || event.target.closest('.desk-acts') || event.target.closest('.action-btn')) return;

    /* 选中当前卡片（job 卡片用 job:id 作为选择 key，避免和 work id 冲突） */
    var key;
    var isJob = card.hasAttribute('data-job');
    if (isJob) key = 'job:' + card.dataset.job;
    else key = card.dataset.work;

    if (event.ctrlKey || event.metaKey || event.shiftKey) toggleSelect(key);
    else if (!view.selected[key]) selectOnly(key);

    var ids = selectedIds();
    if (!ids.length) return;

    view.z += 1;
    var items = [];
    ids.forEach(function (wid) {
      var q = isJob ? '.result-card.is-desk-job[data-job="' + wid.replace('job:', '') + '"]'
                   : '.desk-card[data-work="' + wid + '"]';
      var el = grid.querySelector(q);
      if (!el) return;
      var pos = desk.positions[wid] || {};
      pos.z = view.z;
      desk.positions[wid] = pos;
      el.style.zIndex = String(view.z);
      items.push({ id: wid, el: el, left: el.offsetLeft, top: el.offsetTop });
    });

    drag = {
      startX: event.clientX,
      startY: event.clientY,
      items: items,
      maxLeft: Math.max(1, maxLeft),
      moved: false,
      pointerId: event.pointerId
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.items.forEach(function (item) {
      if (!item.el) return;
      item.el.classList.add('is-dragging');
      /* 横向限死 rail 边缘，纵向允许无限向下（grid 自动滚动） */
      var left = Math.max(0, Math.min(drag.maxLeft, item.left + dx));
      var top = Math.max(-CARD_H, item.top + dy);
      item.el.style.left = left + 'px';
      item.el.style.top = top + 'px';
      item.nextLeft = left;
      item.nextTop = top;
    });
    /* 拖动时让 grid 自动跟随滚动 */
    var grid = byId('resultGrid');
    if (grid && drag.items[0]) {
      var t = drag.items[0].nextTop;
      var visibleTop = grid.scrollTop;
      var visibleBottom = visibleTop + grid.clientHeight;
      if (t < visibleTop + 40) grid.scrollTop = Math.max(0, t - 80);
      else if (t > visibleBottom - CARD_H - 40) grid.scrollTop = Math.min(grid.scrollHeight, t - grid.clientHeight + CARD_H + 40);
    }
  }

  function onPointerUp(event) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (!drag) return;
    var current = drag;
    drag = null;
    /* 先保存新位置（即使要合并也需要） */
    var newPositions = {};
    if (!current.moved) return;
    current.items.forEach(function (item) {
      if (!item.el) return;
      item.el.classList.remove('is-dragging');
      var left = typeof item.nextLeft === 'number' ? item.nextLeft : item.left;
      var top = typeof item.nextTop === 'number' ? item.nextTop : item.top;
      newPositions[item.id] = { left: left, top: top };
      var pos = desk.positions[item.id] || {};
      pos.pxLeft = left;
      pos.pxTop = Math.max(0, top);
      delete pos.x;
      delete pos.y;
      desk.positions[item.id] = pos;
    });

    /* 需求2：拖到另一个卡片上 → 自动合并 */
    if (event && typeof document.elementFromPoint === 'function') {
      var targetEl = document.elementFromPoint(event.clientX, event.clientY);
      var dropCard = targetEl ? targetEl.closest('.desk-card[data-work], .result-card.is-desk-job[data-job]') : null;
      if (dropCard) {
        var dropIsJob = dropCard.hasAttribute('data-job');
        var dropId = dropIsJob ? 'job:' + dropCard.dataset.job : dropCard.dataset.work;
        var draggedIds = current.items.map(function (i) { return i.id; });
        /* 不能拖到自己身上 */
        if (draggedIds.indexOf(dropId) < 0) {
          /* 如果目标在某文件夹里，也把被拖的放进去；否则新建文件夹 */
          var workId = dropIsJob ? dropCard.dataset.job : dropCard.dataset.work;
          var targetFolderId = desk.assigns[workId];
          var folder = mergeItemsIntoFolder(draggedIds.concat([dropId]), targetFolderId, true);
          persistNow();
          clearSelection();
          renderDesktop();
          if (folder) A.toast('已把 ' + (draggedIds.length + 1) + ' 项合并到「' + folder.name + '」', 'success');
          return;
        }
      }
    }

    persistSoon();
  }

  /* 把一组 id 合并进文件夹（create=true 时若无文件夹则新建） */
  function mergeItemsIntoFolder(ids, folderId, create) {
    var folder = folderId ? desk.folders.find(function (f) { return f.id === folderId; }) : null;
    if (!folder && create) {
      var base = '新建文件夹';
      var names = desk.folders.map(function (f) { return f.name; });
      var name = base, idx = 2;
      while (names.indexOf(name) >= 0) { name = base + ' ' + idx; idx += 1; }
      folder = { id: 'f' + A.uid(), name: name, createdAt: Date.now() };
      desk.folders.unshift(folder);
    }
    if (!folder) return null;
    ids.forEach(function (id) {
      /* job:xxx 转成 work id */
      var wid = id.indexOf('job:') === 0 ? id.slice(4) : id;
      desk.assigns[wid] = folder.id;
    });
    return folder;
  }

  /* ---------------- 作品操作 ---------------- */
  function deleteWork(work) {
    if (!work) return;
    if (!window.confirm('删除「' + workName(work) + '」？此操作不可撤销。')) return;
    state.works = state.works.filter(function (w) { return w.id !== work.id; });
    delete desk.positions[work.id];
    delete desk.assigns[work.id];
    delete desk.names[work.id];
    if (view.cut === work.id) view.cut = null;
    delete view.selected[work.id];
    persistNow();
    A.saveWorks();
    A.renderWorks();
    A.toast('已删除', 'info');
  }

  function duplicateWork(work) {
    var copy = Object.assign({}, work, {
      id: 'w' + A.uid(),
      createdAt: Date.now(),
      name: workName(work) + ' 副本'
    });
    state.works.unshift(copy);
    var pos = desk.positions[work.id] || { x: 0.1, y: 0.1, z: 1 };
    desk.positions[copy.id] = {
      x: Math.min(1, (pos.x || 0) + 0.07),
      y: Math.min(1, (pos.y || 0) + 0.08),
      z: view.z + 1
    };
    view.z += 1;
    desk.names[copy.id] = copy.name;
    persistNow();
    A.saveWorks();
    A.renderWorks();
    A.toast('已复制一份', 'success');
  }

  function cutWork(work) {
    view.cut = work.id;
    syncSelection();
    A.toast('已剪切「' + workName(work) + '」，右键桌面空白处可粘贴', 'info');
  }

  function pasteWork() {
    if (!view.cut) {
      A.toast('剪贴板是空的，先右键作品选择「剪切」', 'info');
      return;
    }
    var id = view.cut;
    view.cut = null;
    if (view.activeFolder) desk.assigns[id] = view.activeFolder;
    else delete desk.assigns[id];
    persistNow();
    renderAll();
    A.toast(view.activeFolder ? '已粘贴到「' + folderName(view.activeFolder) + '」' : '已粘贴到个人空间', 'success');
  }

  function restoreParams(work) {
    if (!work) return;
    var input = byId('promptInput');
    if (input) {
      input.value = work.prompt || work.enPrompt || '';
      if (input.dispatchEvent) input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (work.modelId) state.modelId = work.modelId;
    if (work.ratioId) state.ratio = work.ratioId;
    if (work.scaleId) state.scale = work.scaleId;
    if (work.steps) state.steps = work.steps;
    if (work.seed) state.seed = work.seed;
    if (work.engine) state.engine = work.engine;
    if (A.syncSettingsUI) A.syncSettingsUI();
    if (A.persistPrefs) A.persistPrefs();
    A.switchView('create');
    A.toast('已恢复「' + workName(work) + '」的生成参数', 'success');
  }

  function appendPrompt(work) {
    var text = String(work.prompt || work.enPrompt || '').trim();
    if (!text) {
      A.toast('该作品没有可用的提示词', 'error');
      return;
    }
    var input = byId('promptInput');
    if (input) {
      var current = input.value.trim();
      if (current.indexOf(text) < 0) {
        input.value = current ? current.replace(/[，,\s]+$/, '') + ', ' + text : text;
      }
      if (input.dispatchEvent) input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    A.switchView('create');
    A.toast('提示词已追加到输入框', 'success');
  }

  function useAsRef(work) {
    if (work.type && work.type !== 'image') {
      A.toast('仅图片可以作为参考素材', 'error');
      return;
    }
    function apply(dataUrl) {
      state.refImage = { dataUrl: dataUrl, width: work.width || 1024, height: work.height || 1024 };
      if (A.renderRef) A.renderRef();
      A.switchView('create');
      A.toast('已加入参考素材', 'success');
      if (state.engine !== 'gpt-image') A.toast('参考图需要切换 GPT-image 引擎后生效', 'info');
    }
    var url = work.url || '';
    if (!url) return;
    if (/^data:/i.test(url)) {
      apply(url);
      return;
    }
    fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('fetch failed');
      return res.blob();
    }).then(function (blob) {
      var reader = new FileReader();
      reader.onload = function () { apply(String(reader.result || '')); };
      reader.readAsDataURL(blob);
    }).catch(function () {
      A.toast('该图片存在跨域限制，请先下载再手动上传为参考图', 'error');
    });
  }

  function sendToCanvas(work) {
    A.switchView('canvas');
    A.toast('已发送「' + workName(work) + '」到画布', 'success');
    if (window.HMUI && window.HMUI.renderCanvas) window.HMUI.renderCanvas();
  }

  /* ---------------- 右键菜单 ---------------- */
  function hideContexts() {
    ['hmCtx', 'deskCtx', 'folderCtx'].forEach(function (id) {
      var el = byId(id);
      if (el) el.hidden = true;
    });
  }

  function showContext(id, x, y) {
    hideContexts();
    var el = byId(id);
    if (!el) return;
    el.hidden = false;
    var rect = el.getBoundingClientRect();
    var left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, x));
    var top = Math.min(window.innerHeight - rect.height - 8, Math.max(8, y));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function openWorkMenu(work, x, y) {
    view.menuWork = work;
    showContext('hmCtx', x, y);
  }

  /* ---------------- 参数弹窗 ---------------- */
  function openParam(work) {
    view.paramWork = work;
    var modal = byId('paramModal');
    if (!modal) return;
    var title = byId('paramTitle');
    if (title) title.textContent = workName(work);
    var rows = [
      ['类型', typeLabel(work.type)],
      ['模型', work.modelName || '—'],
      ['引擎', work.engine || 'flux'],
      ['尺寸', (work.width || 0) + ' × ' + (work.height || 0)],
      ['比例', work.ratioId || '—'],
      ['清晰度', (work.scaleId || '—').toUpperCase()],
      ['步数', work.steps || '—'],
      ['种子', work.seed || '—'],
      ['耗时', work.elapsed ? Number(work.elapsed).toFixed(1) + 's' : '—'],
      ['时长', work.duration ? work.duration + 's' : '—'],
      ['所属', folderName(folderOf(work.id))],
      ['创建时间', today(work.createdAt)]
    ];
    var body = byId('paramBody');
    if (body) {
      body.innerHTML =
        '<div class="hm-param-grid">' + rows.map(function (row) {
          return '<div class="hm-param-row"><span>' + esc(row[0]) + '</span><strong>' + esc(String(row[1])) + '</strong></div>';
        }).join('') + '</div>' +
        '<label class="hm-param-prompt"><span>提示词</span><textarea readonly>' + esc(work.prompt || work.enPrompt || '') + '</textarea></label>';
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeParam() {
    var modal = byId('paramModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ---------------- 重命名弹窗 ---------------- */
  function askName(title, value, cb) {
    var modal = byId('renameModal');
    var input = byId('renameInput');
    var head = byId('renameTitle');
    if (!modal || !input) {
      if (cb) cb(value);
      return;
    }
    view.renameCb = cb;
    if (head) head.textContent = title || '重命名';
    input.value = value || '';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () {
      input.focus();
      input.select();
    }, 40);
  }

  function closeRename() {
    var modal = byId('renameModal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
    }
    view.renameCb = null;
  }

  function confirmRename() {
    var input = byId('renameInput');
    var value = input ? input.value.trim() : '';
    var cb = view.renameCb;
    closeRename();
    if (value && cb) cb(value);
  }

  /* ---------------- 历史记录 ---------------- */
  function historyList() {
    var q = hist.q.trim().toLowerCase();
    var list = state.works.filter(function (w) {
      if (hist.type !== 'all' && (w.type || 'image') !== hist.type) return false;
      if (hist.folder !== 'all' && desk.assigns[w.id] !== hist.folder) return false;
      if (hist.model !== 'all' && String(w.modelId || '') !== hist.model) return false;
      if (q) {
        var hay = [w.prompt, w.enPrompt, w.modelName, w.id, w.seed].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list;
  }

  function fillHistorySelects() {
    var folderSel = byId('historyFolder');
    if (folderSel) {
      var current = hist.folder;
      folderSel.innerHTML = '<option value="all">全部项目</option>' +
        desk.folders.map(function (f) {
          return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>';
        }).join('');
      folderSel.value = desk.folders.some(function (f) { return f.id === current; }) ? current : 'all';
      hist.folder = folderSel.value;
    }
    var modelSel = byId('historyModel');
    if (modelSel) {
      var currentModel = hist.model;
      var ids = [];
      state.works.forEach(function (w) {
        if (w.modelId && ids.indexOf(w.modelId) < 0) ids.push(w.modelId);
      });
      modelSel.innerHTML = '<option value="all">全部模型</option>' + ids.map(function (id) {
        var w = state.works.find(function (x) { return x.modelId === id; });
        return '<option value="' + esc(id) + '">' + esc((w && w.modelName) || id) + '</option>';
      }).join('');
      modelSel.value = ids.indexOf(currentModel) >= 0 ? currentModel : 'all';
      hist.model = modelSel.value;
    }
  }

  function historyCardHtml(work) {
    var meta = work.type === 'audio' ? '音频 · 语音合成' : (work.type === 'video' ? '视频 · ' + (work.duration || 5) + '秒' : (work.width || 0) + '×' + (work.height || 0));
    return '<article class="hm-history-card" data-work="' + esc(work.id) + '" data-type="' + esc(work.type || 'image') + '">' +
      '<div class="hm-history-thumb">' + mediaHtml(work, 'history') +
      '<span class="hm-history-badge">已完成</span></div>' +
      '<div class="hm-history-info">' +
      '<strong>' + esc(workName(work)) + '</strong>' +
      '<small>' + esc((work.modelName || 'AI') + ' · ' + meta) + '</small>' +
      '</div>' +
      '<div class="hm-history-foot">' +
      '<span>' + esc(today(work.createdAt)) + '</span>' +
      '<span class="hm-history-acts">' +
      '<button data-hact="preview" title="预览">◎</button>' +
      '<button data-hact="id" title="任务 ID">ID</button>' +
      '<button data-hact="download" title="下载">↓</button>' +
      '</span>' +
      '</div>' +
      '</article>';
  }

  function renderHistory() {
    fillHistorySelects();
    var list = historyList();
    var pages = Math.max(1, Math.ceil(list.length / hist.per));
    if (hist.page > pages) hist.page = pages;
    if (hist.page < 1) hist.page = 1;
    var start = (hist.page - 1) * hist.per;
    var items = list.slice(start, start + hist.per);

    var grid = byId('historyGrid');
    if (grid) {
      grid.style.setProperty('--hist-scale', String(hist.zoom / 100));
      grid.innerHTML = items.map(historyCardHtml).join('');
    }
    var empty = byId('historyEmpty');
    if (empty) empty.style.display = items.length ? 'none' : 'flex';

    var count = byId('historyCount');
    if (count) count.textContent = '共 ' + list.length + ' 项';
    var info = byId('historyPageInfo');
    if (info) info.textContent = hist.page + ' / ' + pages;
    var prev = byId('historyPrev');
    if (prev) prev.disabled = hist.page <= 1;
    var next = byId('historyNext');
    if (next) next.disabled = hist.page >= pages;
    var zoomVal = byId('historyZoomVal');
    if (zoomVal) zoomVal.textContent = hist.zoom + '%';
  }

  function openHistory() {
    closePanel();
    A.switchView('history');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    /* 顶层「项目选择」按钮：拦截 app.js 的 data-view 跳转 */
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('.hm-project');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      var panel = byId('projPanel');
      if (panel && !panel.hidden) closePanel();
      else openPanel();
    }, true);

    /* 点击面板外部关闭 */
    document.addEventListener('click', function (event) {
      var panel = byId('projPanel');
      if (!panel || panel.hidden) return;
      if (event.target.closest('#projPanel')) return;
      if (event.target.closest('.modal') || event.target.closest('.hm-ctx')) return;
      closePanel();
    });

    var closeBtn = byId('projCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    var newBtn = byId('projNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        newFolder(function () { renderDesktop(); });
      });
    }

    var search = byId('projSearch');
    if (search) {
      search.addEventListener('input', function () {
        view.search = search.value;
        renderPanel();
      });
    }

    var sortBtn = byId('projSortBtn');
    if (sortBtn) {
      sortBtn.addEventListener('click', function () {
        view.sort = view.sort === 'name' ? 'newest' : 'name';
        renderPanel();
      });
    }

    var projList = byId('projList');
    if (projList) {
      projList.addEventListener('click', function (event) {
        var more = event.target.closest('[data-folder-more]');
        if (more) {
          event.stopPropagation();
          view.menuFolder = more.dataset.folderMore;
          var rect = more.getBoundingClientRect();
          showContext('folderCtx', rect.left - 150, rect.bottom + 6);
          return;
        }
        var open = event.target.closest('[data-folder-open]');
        if (open) {
          var id = open.dataset.folderOpen;
          view.activeFolder = view.activeFolder === id ? null : id;
          clearSelection();
          renderPanel();
          renderDesktop();
          return;
        }
        var row = event.target.closest('[data-proj]');
        if (!row) return;
        var action = row.dataset.proj;
        if (action === 'history') {
          openHistory();
        } else if (action === 'space') {
          view.activeFolder = null;
          clearSelection();
          renderPanel();
          renderDesktop();
        } else if (action === 'new') {
          newFolder(function () { renderDesktop(); });
        }
      });
    }

    /* 桌面 */
    var grid = byId('resultGrid');
    if (grid) {
      grid.addEventListener('pointerdown', onPointerDown);
      grid.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        var card = event.target.closest('.desk-card[data-work]');
        if (card) {
          var work = findWork(card.dataset.work);
          if (work) openWorkMenu(work, event.clientX, event.clientY);
        } else {
          showContext('deskCtx', event.clientX, event.clientY);
        }
      });
      grid.addEventListener('click', function (event) {
        var card = event.target.closest('.desk-card[data-work]');
        if (!card) return;
        var work = findWork(card.dataset.work);
        if (!work) return;
        var act = event.target.closest('[data-dact]');
        if (act) {
          if (act.dataset.dact === 'preview') A.openLightbox(work);
          else if (act.dataset.dact === 'download') A.downloadImage(work.url, A.fileNameFor(work));
          else if (act.dataset.dact === 'delete') deleteWork(work);
        }
      });
      grid.addEventListener('dblclick', function (event) {
        var card = event.target.closest('.desk-card[data-work]');
        if (!card) return;
        var work = findWork(card.dataset.work);
        if (work) A.openLightbox(work);
      });
    }

    window.addEventListener('resize', function () {
      setDockVar();
      if (document.body.getAttribute('data-view') === 'create') renderDesktop();
    });

    /* 选择工具条 */
    var mergeBtn = byId('deskMergeBtn');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', function () {
        var ids = selectedIds();
        if (!ids.length) return;
        newFolder(function (folder) {
          ids.forEach(function (id) { desk.assigns[id] = folder.id; });
          view.activeFolder = folder.id;
          persistNow();
          clearSelection();
          renderAll();
          A.toast('已把 ' + ids.length + ' 项合并到「' + folder.name + '」', 'success');
        });
      });
    }
    var foldBtn = byId('deskFoldBtn');
    if (foldBtn) {
      foldBtn.addEventListener('click', function () {
        newFolder(function () { renderDesktop(); });
      });
    }
    var allBtn = byId('deskSelectAll');
    if (allBtn) allBtn.addEventListener('click', selectAll);
    var clearBtn = byId('deskSelClear');
    if (clearBtn) clearBtn.addEventListener('click', clearSelection);

    /* 右键菜单命令 */
    var ctx = byId('hmCtx');
    if (ctx) {
      ctx.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-cmd]');
        if (!btn) return;
        var cmd = btn.dataset.cmd;
        var work = view.menuWork;
        hideContexts();
        if (!work) return;
        switch (cmd) {
          case 'preview': A.openLightbox(work); break;
          case 'restore': restoreParams(work); break;
          case 'ref': useAsRef(work); break;
          case 'prompt': appendPrompt(work); break;
          case 'params': openParam(work); break;
          case 'copy': duplicateWork(work); break;
          case 'cut': cutWork(work); break;
          case 'rename':
            askName('重命名作品', workName(work), function (value) {
              desk.names[work.id] = value;
              delete work.name;
              persistNow();
              renderDesktop();
              renderPanel();
              A.toast('已重命名', 'success');
            });
            break;
          case 'download': A.downloadImage(work.url, A.fileNameFor(work)); break;
          case 'canvas': sendToCanvas(work); break;
          case 'delete': deleteWork(work); break;
          default: break;
        }
      });
    }

    var deskCtx = byId('deskCtx');
    if (deskCtx) {
      deskCtx.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-dcmd]');
        if (!btn) return;
        var cmd = btn.dataset.dcmd;
        hideContexts();
        if (cmd === 'paste') pasteWork();
        else if (cmd === 'newfolder') newFolder(function () { renderDesktop(); });
        else if (cmd === 'tidy') tidy();
        else if (cmd === 'selectall') selectAll();
      });
    }

    var folderCtx = byId('folderCtx');
    if (folderCtx) {
      folderCtx.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-fcmd]');
        if (!btn) return;
        var cmd = btn.dataset.fcmd;
        var folderId = view.menuFolder;
        hideContexts();
        if (!folderId) return;
        var folder = desk.folders.find(function (f) { return f.id === folderId; });
        if (!folder) return;

        /* 找所有属于此文件夹的 work */
        var folderWorks = state.works.filter(function (w) { return desk.assigns[w.id] === folderId; });

        if (cmd === 'open') {
          view.activeFolder = folderId;
          renderAll();
          A.toast('已切到「' + folder.name + '」文件夹（' + folderWorks.length + ' 项）', 'success');
        } else if (cmd === 'scatter' || cmd === 'out') {
          folderWorks.forEach(function (w) { delete desk.assigns[w.id]; });
          if (cmd === 'delete') return;
          persistNow();
          if (view.activeFolder === folderId) view.activeFolder = null;
          renderAll();
          A.toast('已把 ' + folderWorks.length + ' 项移出「' + folder.name + '」', 'success');
        } else if (cmd === 'download') {
          if (!folderWorks.length) { A.toast('文件夹是空的', 'info'); return; }
          A.toast('开始批量下载 ' + folderWorks.length + ' 张到「' + folder.name + '」', 'success');
          folderWorks.forEach(function (w, i) {
            setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 400);
          });
        } else if (cmd === 'rename') {
          askName('重命名文件夹', folder.name, function (value) {
            folder.name = value;
            persistNow();
            renderAll();
          });
        } else if (cmd === 'merge') {
          var ids = selectedIds();
          if (!ids.length) { A.toast('先在桌面上选中要移动的作品', 'info'); return; }
          ids.forEach(function (id) { desk.assigns[id] = folderId; });
          persistNow();
          clearSelection();
          renderAll();
          A.toast('已移动 ' + ids.length + ' 项到「' + folder.name + '」', 'success');
        } else if (cmd === 'delete') {
          deleteFolder(folderId);
        }
      });
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('#hmCtx') || event.target.closest('#deskCtx') || event.target.closest('#folderCtx')) return;
      hideContexts();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideContexts();
        closePanel();
        closeParam();
        closeRename();
      }
    });

    /* 参数弹窗 */
    var paramModal = byId('paramModal');
    if (paramModal) {
      paramModal.addEventListener('click', function (event) {
        if (event.target === paramModal || event.target.closest('[data-close-param]')) closeParam();
      });
    }
    var paramCopy = byId('paramCopy');
    if (paramCopy) {
      paramCopy.addEventListener('click', function () {
        var text = (view.paramWork && (view.paramWork.prompt || view.paramWork.enPrompt)) || '';
        if (!text) return A.toast('没有可复制的提示词', 'error');
        copyText(text);
      });
    }
    var paramRestore = byId('paramRestore');
    if (paramRestore) {
      paramRestore.addEventListener('click', function () {
        if (view.paramWork) {
          closeParam();
          restoreParams(view.paramWork);
        }
      });
    }
    var paramDownload = byId('paramDownload');
    if (paramDownload) {
      paramDownload.addEventListener('click', function () {
        if (view.paramWork) A.downloadImage(view.paramWork.url, A.fileNameFor(view.paramWork));
      });
    }

    /* 重命名弹窗 */
    var renameModal = byId('renameModal');
    if (renameModal) {
      renameModal.addEventListener('click', function (event) {
        if (event.target === renameModal) closeRename();
      });
    }
    var renameOk = byId('renameOk');
    if (renameOk) renameOk.addEventListener('click', confirmRename);
    var renameCancel = byId('renameCancel');
    if (renameCancel) renameCancel.addEventListener('click', closeRename);
    var renameInput = byId('renameInput');
    if (renameInput) {
      renameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') confirmRename();
      });
    }

    /* 历史记录 */
    var worksHistoryBtn = byId('worksHistoryBtn');
    if (worksHistoryBtn) worksHistoryBtn.addEventListener('click', openHistory);
    var historyClose = byId('historyClose');
    if (historyClose) historyClose.addEventListener('click', function () { A.switchView('create'); });
    var historyRefresh = byId('historyRefresh');
    if (historyRefresh) {
      historyRefresh.addEventListener('click', function () {
        renderHistory();
        A.toast('历史记录已刷新', 'info');
      });
    }
    var historySearch = byId('historySearch');
    if (historySearch) {
      var timer = null;
      historySearch.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          hist.q = historySearch.value;
          hist.page = 1;
          renderHistory();
        }, 180);
      });
    }
    ['historyFolder', 'historyType', 'historyModel'].forEach(function (id) {
      var el = byId(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (id === 'historyFolder') hist.folder = el.value;
        if (id === 'historyType') hist.type = el.value;
        if (id === 'historyModel') hist.model = el.value;
        hist.page = 1;
        renderHistory();
      });
    });
    var historyZoom = byId('historyZoom');
    if (historyZoom) {
      historyZoom.addEventListener('input', function () {
        hist.zoom = Number(historyZoom.value) || 100;
        renderHistory();
      });
    }
    var historyTabs = byId('historyTabs');
    if (historyTabs) {
      historyTabs.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-htab]');
        if (!btn) return;
        hist.tab = btn.dataset.htab;
        hist.page = 1;
        Array.prototype.forEach.call(historyTabs.querySelectorAll('[data-htab]'), function (el) {
          el.classList.toggle('is-active', el === btn);
        });
        renderHistory();
      });
    }
    var historyPrev = byId('historyPrev');
    if (historyPrev) {
      historyPrev.addEventListener('click', function () {
        if (hist.page <= 1) return;
        hist.page -= 1;
        renderHistory();
      });
    }
    var historyNext = byId('historyNext');
    if (historyNext) {
      historyNext.addEventListener('click', function () {
        hist.page += 1;
        renderHistory();
      });
    }

    var historyGrid = byId('historyGrid');
    if (historyGrid) {
      historyGrid.addEventListener('click', function (event) {
        var card = event.target.closest('[data-work]');
        if (!card) return;
        var work = findWork(card.dataset.work);
        if (!work) return;
        var act = event.target.closest('[data-hact]');
        if (act) {
          if (act.dataset.hact === 'preview') A.openLightbox(work);
          else if (act.dataset.hact === 'download') A.downloadImage(work.url, A.fileNameFor(work));
          else if (act.dataset.hact === 'id') copyText(work.id);
          return;
        }
        A.openLightbox(work);
      });
      historyGrid.addEventListener('contextmenu', function (event) {
        var card = event.target.closest('[data-work]');
        if (!card) return;
        event.preventDefault();
        var work = findWork(card.dataset.work);
        if (work) openWorkMenu(work, event.clientX, event.clientY);
      });
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        A.toast('已复制到剪贴板', 'success');
      }).catch(function () {
        A.toast('复制失败，请手动选择文本', 'error');
      });
      return;
    }
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      A.toast('已复制到剪贴板', 'success');
    } catch (err) {
      A.toast('复制失败', 'error');
    }
    document.body.removeChild(area);
  }

  /* ---------------- 与主应用联动 ---------------- */
  function hookOnView() {
    if (!window.HMUI || typeof window.HMUI.onView !== 'function') return;
    if (window.HMUI.__deskHooked) return;
    var prev = window.HMUI.onView;
    window.HMUI.onView = function (name) {
      try {
        prev(name);
      } catch (err) {}
      if (name === 'create') renderDesktop();
      else if (name === 'history') renderHistory();
      if (name !== 'create') {
        hidDeskBar();
      }
    };
    window.HMUI.__deskHooked = true;
  }

  function hidDeskBar() {
    var bar = byId('deskSelBar');
    if (bar) bar.hidden = true;
    var hint = byId('deskHint');
    if (hint) hint.hidden = true;
    clearSelection();
  }

  function onWorksChanged() {
    renderPanel();
    if (document.body.getAttribute('data-view') === 'create') renderDesktop();
    else deskDirty = true;
    if (document.body.getAttribute('data-view') === 'history') renderHistory();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    load();
    bindEvents();
    hookOnView();
    renderPanel();
    renderDesktop();
    setTimeout(syncServer, 1200);
    setTimeout(syncServer, 4200);
    setTimeout(function () {
      renderPanel();
      if (deskDirty && document.body.getAttribute('data-view') === 'create') renderDesktop();
    }, 900);
    /* 生成中卡片实时耗时刷新 */
    startJobTimer();
  }

  var jobTimer = null;
  function startJobTimer() {
    if (jobTimer) return;
    jobTimer = setInterval(function () {
      if (document.body.getAttribute('data-view') !== 'create') return;
      var grid = byId('resultGrid');
      if (!grid) return;
      var cards = grid.querySelectorAll('.result-card[data-job]:not(.is-done):not(.is-error)');
      if (!cards.length) return;
      cards.forEach(function (card) {
        var timeEl = card.querySelector('[data-time]');
        if (!timeEl) return;
        var id = card.dataset.job;
        var job = A.state.jobs.find(function (j) { return j.id === id; });
        if (!job || !job.startedAt) return;
        var secs = (Date.now() - job.startedAt) / 1000;
        timeEl.textContent = secs.toFixed(1) + 's';
      });
    }, 400);
  }

  window.HMDesk = {
    init: init,
    renderDesktop: renderDesktop,
    syncJobs: syncJobs,
    clearSelection: clearSelection,
    onWorksChanged: onWorksChanged,
    tidy: tidy,
    openHistory: openHistory,
    openParam: openParam,
    deleteWork: deleteWork
  };

  init();
})();
