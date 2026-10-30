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
  /* 按用户隔离的桌面 key：已登录用 anidream.desk.v1.<userId>，未登录用访客共享 key */
  function getDeskLsKey() {
    var uid = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    return uid ? ('anidream.desk.v1.' + uid) : 'anidream.desk.v1';
  }

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
    parentFolder: null,
    selectedFolders: {},  /* { folderId: true } 多选 */
    sort: 'newest',
    search: '',
    selected: {},
    cut: null,
    z: 20,
    menuWork: null,
    menuFolder: null,
    paramWork: null,
    renameCb: null,
    sizeKey: '',
    expanded: {},
    inline: null  /* { parentId: 'fx'|null, rowId: 'fx', isNew: true, value: '' } 行内输入状态 */
  };

  /* 统一剪贴板（localStorage 持久化，跨项目/文件夹复制剪切粘贴） */
  var CLIP_LS = 'anidream.clipboard.v1';
  var clipboard = {
    data: null,
    load: function () {
      try { clipboard.data = JSON.parse(localStorage.getItem(CLIP_LS) || 'null'); }
      catch (e) { clipboard.data = null; }
    },
    save: function () {
      try { localStorage.setItem(CLIP_LS, JSON.stringify(clipboard.data || null)); } catch (e) {}
    },
    clear: function () { clipboard.data = null; clipboard.save(); },
    setCopy: function (works) {
      clipboard.data = { type: 'copy', works: works.map(function (w) { return Object.assign({}, w); }), ts: Date.now() };
      clipboard.save();
    },
    setCut: function (works, fromFolder) {
      clipboard.data = { type: 'cut', works: works.map(function (w) { return Object.assign({}, w); }), fromFolder: fromFolder || null, ts: Date.now() };
      clipboard.save();
    },
    isEmpty: function () { return !clipboard.data || !clipboard.data.works || !clipboard.data.works.length; }
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
      stored = JSON.parse(localStorage.getItem(getDeskLsKey()) || 'null');
    } catch (err) {
      stored = null;
    }
    if (!stored || typeof stored !== 'object') return;
    desk.folders = Array.isArray(stored.folders) ? stored.folders.filter(function (f) { return f && f.id && f.name; }).map(function (f) {
      /* 给旧数据补 parentId（默认根目录）+ createdAt */
      f.parentId = f.parentId || null;
      f.createdAt = Number(f.createdAt) || 0;
      return f;
    }) : [];
    desk.positions = stored.positions && typeof stored.positions === 'object' ? stored.positions : {};
    desk.assigns = stored.assigns && typeof stored.assigns === 'object' ? stored.assigns : {};
    desk.names = stored.names && typeof stored.names === 'object' ? stored.names : {};
    desk.updatedAt = Number(stored.updatedAt) || 0;
    /* 恢复上次停留的桌面（每个文件夹桌面独立，刷新后回到同一个桌面） */
    view.activeFolder = stored.activeFolder && desk.folders.some(function (f) { return f.id === stored.activeFolder; })
      ? stored.activeFolder : null;
  }

  var persistTimer = null;

  function payload() {
    return {
      folders: desk.folders,
      positions: desk.positions,
      assigns: desk.assigns,
      names: desk.names,
      activeFolder: view.activeFolder || null,
      updatedAt: desk.updatedAt
    };
  }

  function persistNow() {
    desk.updatedAt = Date.now();
    try {
      localStorage.setItem(getDeskLsKey(), JSON.stringify(payload()));
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
          localStorage.setItem(getDeskLsKey(), JSON.stringify(payload()));
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

  /* 统计某 folder（不含子文件夹）的作品数和总 credit */
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

  /* ---------------- 项目文件夹（树形） ---------------- */

  /* 把扁平 folders 数组转成树：
     [{ id, name, parentId, createdAt, children: [...] }] */
  function buildTree() {
    var q = view.search.trim().toLowerCase();
    var all = desk.folders.slice();
    /* 搜索时：如果匹配某节点，把它所有祖先也带上 */
    if (q) {
      all = all.filter(function (f) {
        return String(f.name).toLowerCase().indexOf(q) >= 0;
      });
      var matchedIds = {};
      all.forEach(function (f) { matchedIds[f.id] = true; });
      /* 把匹配节点的父链条也加回来 */
      var extra = [];
      desk.folders.forEach(function (f) {
        if (!matchedIds[f.id]) {
          var p = f.parentId;
          while (p) {
            if (matchedIds[p]) { extra.push(f); break; }
            p = desk.folders.find(function (x) { return x.id === p; })?.parentId || null;
          }
        }
      });
      all = all.concat(extra.filter(function (f) {
        return !all.some(function (a) { return a.id === f.id; });
      }));
    }

    /* 排序 */
    all.sort(function (a, b) {
      if (view.sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    /* 构建 parentId → children 索引 */
    var byParent = {};
    all.forEach(function (f) {
      var pid = f.parentId || null;
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(Object.assign({}, f, { children: [] }));
    });
    /* 递归挂 children */
    function attach(roots) {
      roots.forEach(function (n) {
        n.children = byParent[n.id] ? byParent[n.id].slice() : [];
        attach(n.children);
      });
    }
    var roots = byParent[null] || [];
    attach(roots);
    return roots;
  }

  /* 收集一个 folder 及其所有子孙 folder 的 id */
  function collectDescendantIds(id) {
    var ids = [id];
    var stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      desk.folders.forEach(function (f) {
        if (f.parentId === cur) { ids.push(f.id); stack.push(f.id); }
      });
    }
    return ids;
  }

  /* 环检测：dest 是否是 src 的子孙（src 不能拖进自己或自己的子树里） */
  function isDescendantOf(srcId, destId) {
    if (!srcId || !destId) return false;
    if (srcId === destId) return true;
    var dest = desk.folders.find(function (f) { return f.id === destId; });
    if (!dest) return false;
    /* 从 dest 往上找父链，看能不能走到 src */
    var p = dest.parentId;
    while (p) {
      if (p === srcId) return true;
      p = desk.folders.find(function (f) { return f.id === p; })?.parentId || null;
    }
    return false;
  }

  /* 移动 folder 到 targetFolder 下（targetFolder=null → 根目录）
     ★ 只改 folder.parentId，children 自动跟着父层级（不需要批量改 assigns/parentId）
     folder 内部作品归属 desk.assigns[workId]=folderId 不变 —— 它们属于 folder 本身 */
  function moveFolder(folderId, targetFolderId) {
    var folder = desk.folders.find(function (f) { return f.id === folderId; });
    if (!folder) return false;
    if (folderId === targetFolderId) return false;
    if (isDescendantOf(folderId, targetFolderId)) return false;  /* 禁止拖进自己的子树 */
    folder.parentId = targetFolderId || null;
    persistNow();
    return true;
  }

  /* 把多个 work 从一个 folder 移到另一个 folder（或根目录 targetFolder=null） */
  function moveWorksFolder(workIds, targetFolderId) {
    workIds.forEach(function (wid) {
      if (targetFolderId) desk.assigns[wid] = targetFolderId;
      else delete desk.assigns[wid];
    });
    persistNow();
  }

  /* 递归渲染一个 folder 节点（及其 children） */
  function renderFolderNode(node, depth) {
    var html = '';
    var hasChildren = node.children && node.children.length > 0;
    var expanded = view.expanded[node.id] !== false;

    /* ★ inline 重命名：整个 node 行替换为 input —— 顶级和子级都能生效 */
    if (view.inline && !view.inline.isNew && view.inline.rowId === node.id) {
      var val = view.inline.value;
      html += '<div class="hm-proj-folder is-renaming" style="padding-left:' + (10 + depth * 14) + 'px">' +
        '<span class="hm-tree-toggle is-leaf" style="visibility:hidden">·</span>' +
        '<span class="hm-folder-ico">📁</span>' +
        '<input class="hm-inline-input" data-folder-inline="' + esc(node.id) + '" data-inline-kind="rename" value="' + esc(val) + '" maxlength="40" autocomplete="off">' +
        '<button class="hm-inline-cancel" data-inline-cancel="' + esc(node.id) + '">✕</button>' +
        '</div>';
      return html;  /* 渲染这一行就停，children 也不画（重命名时整个节点变为纯 input） */
    }

    var count = folderCount(node.id);
    var credit = folderCredit(node.id);
    var isActive = view.activeFolder === node.id;
    var isSelected = !!view.selectedFolders[node.id];

    var classes = ['hm-proj-folder'];
    if (isActive) classes.push('is-active');
    if (isSelected) classes.push('is-selected');

    html += '<div class="' + classes.join(' ') + '" draggable="true" droppable="true"' +
      ' data-folder-row="' + esc(node.id) + '"' +
      ' data-drag-source="folder" data-drag-id="' + esc(node.id) + '"' +
      ' style="padding-left:' + (10 + depth * 14) + 'px">' +

      '<span class="hm-tree-toggle' + (hasChildren ? '' : ' is-leaf') +
        (expanded ? ' is-open' : '') + '" data-folder-toggle="' + esc(node.id) + '">' +
        (hasChildren ? '▸' : '·') +
      '</span>' +

      '<button class="hm-proj-folder-main" data-folder-open="' + esc(node.id) + '">' +
      '<span class="hm-folder-ico">📁</span>' +
      '<span class="hm-proj-txt"><strong>' + esc(node.name) + '</strong><small>' + count + ' 项</small></span>' +
      '</button>' +
      '<button class="hm-proj-plus" data-folder-plus="' + esc(node.id) + '" title="在此新建子文件夹">＋</button>' +
      '<span class="hm-proj-credit ' + (credit > 0 ? 'is-plus' : '') + '">+' + credit + '</span>' +
      '<button class="hm-proj-more" data-folder-more="' + esc(node.id) + '" aria-label="项目操作">⋯</button>' +
      '</div>';

    /* inline 新建子文件夹（在这个父节点下）—— 在 children 之前插入一行 */
    if (view.inline && view.inline.isNew && view.inline.parentId === node.id) {
      html += renderInlineRow(node.id, depth + 1);
    }

    if (hasChildren && expanded) {
      node.children.forEach(function (child) {
        html += renderFolderNode(child, depth + 1);
      });
    }
    return html;
  }

  /* inline 新建子文件夹占位行（显示在 children 最前面） */
  function renderInlineRow(parentId, depth) {
    var val = (view.inline && view.inline.isNew && view.inline.parentId === parentId) ? view.inline.value : '';
    return '<div class="hm-proj-folder is-inline-new" style="padding-left:' + (10 + depth * 14) + 'px">' +
      '<span class="hm-tree-toggle is-leaf" style="visibility:hidden">·</span>' +
      '<span class="hm-folder-ico hm-inline-plus">＋</span>' +
      '<input class="hm-inline-input" data-folder-inline-parent="' + esc(parentId || '') + '" data-inline-kind="new" value="' + esc(val) + '" placeholder="新建文件夹..." maxlength="40" autocomplete="off">' +
      '<button class="hm-inline-cancel" data-inline-cancel="' + esc(parentId || '') + '">✕</button>' +
      '</div>';
  }

  function renderPanel() {
    var list = byId('projList');
    if (!list) return;
    var total = state.works.length;
    var html = '';

    /* 历史记录（固定在最顶） */
    html += '<button class="hm-proj-row is-history" data-proj="history">' +
      '<span class="hm-proj-ico">◷</span>' +
      '<span class="hm-proj-txt"><strong>历史记录</strong><small>最近 10 分钟 / 项目 / 人员</small></span>' +
      '</button>';

    /* 个人空间 */
    html += '<div class="hm-proj-space">';
    html += '<button class="hm-proj-row is-space ' + (view.activeFolder === null ? 'is-active' : '') + '" data-proj="space">' +
      '<span class="hm-proj-ico">▫</span>' +
      '<span class="hm-proj-txt"><strong>个人空间</strong><small>' + total + ' 项</small></span>' +
      '<span class="hm-proj-lock">⌾</span>' +
      '</button>';
    html += '<button class="hm-proj-row is-new" data-proj="new">' +
      '<span class="hm-proj-ico">＋</span><span class="hm-proj-txt"><strong>新建文件夹</strong><small>在根目录创建新项目</small></span>' +
      '</button>';
    html += '</div>';

    html += '<div class="hm-proj-folders">';
    var tree = buildTree();

    /* inline 根目录新建行（parentId === null && isNew）—— 插在最前 */
    if (view.inline && view.inline.isNew && !view.inline.parentId) {
      html += renderInlineRow(null, 0);
    }

    if (!tree.length && !(view.inline && view.inline.isNew)) {
      html += '<p class="hm-proj-none">' + (view.search ? '没有匹配的项目' : '还没有项目文件夹，点击「新建文件夹」开始整理') + '</p>';
    }
    tree.forEach(function (node) {
      html += renderFolderNode(node, 0);  /* renderFolderNode 内部自动处理 inline rename 替换 */
    });
    /* 根目录 drop zone：拖入 = targetFolder=null */
    html += '<div class="hm-root-drop-zone" droppable="true" data-root-drop="true">' +
      '<span>把文件夹拖到这里放回根目录</span></div>';
    html += '</div>';
    list.innerHTML = html;

    /* 自动 focus inline input */
    if (view.inline) {
      var ip = list.querySelector('.hm-inline-input');
      if (ip) { setTimeout(function () { ip.focus(); ip.select(); }, 30); }
    }

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
    hideContexts();  /* 关闭面板时同时关闭所有右键菜单（bug: 菜单留在屏幕中央） */
  }

  /* ---------------- 行内 inline 输入 ---------------- */

  /* 开启 inline：在指定 parentId 下新建，或重命名已有 rowId */
  function startInlineCreate(parentId) {
    /* 自动展开父节点，让 inline 行可见 */
    if (parentId) view.expanded[parentId] = true;
    view.inline = { parentId: parentId || null, rowId: null, isNew: true, value: '' };
    renderPanel();
  }
  function startInlineRename(rowId) {
    var folder = desk.folders.find(function (f) { return f.id === rowId; });
    if (!folder) return;
    view.inline = { parentId: folder.parentId || null, rowId: rowId, isNew: false, value: folder.name };
    renderPanel();
  }
  function cancelInline() {
    view.inline = null;
    renderPanel();
  }
  function commitInline(value) {
    value = (value || '').trim();
    var inline = view.inline;
    view.inline = null;
    if (!value || !inline) { renderPanel(); return; }
    if (inline.isNew) {
      /* 同级去重 */
      var parentId = inline.parentId || null;
      var siblings = desk.folders.filter(function (f) { return (f.parentId || null) === parentId; });
      var names = siblings.map(function (f) { return f.name; });
      var name = value;
      var idx = 2;
      while (names.indexOf(name) >= 0) { name = value + ' ' + idx; idx++; }
      var folder = { id: 'f' + A.uid(), name: name, parentId: parentId, createdAt: Date.now() };
      desk.folders.unshift(folder);
      persistNow();
      A.toast('已创建文件夹「' + name + '」', 'success');
    } else {
      /* 重命名 */
      var target = desk.folders.find(function (f) { return f.id === inline.rowId; });
      if (target) {
        target.name = value;
        persistNow();
        A.toast('已重命名为「' + value + '」', 'success');
      }
    }
    renderPanel();
    renderDesktop();
  }

  /* 把旧 askName modal 调用也改成 inline 模式（newFolder / folderCtx newsub / rename） */
  function newFolder(parentId, cb) {
    /* newFolder(cb) 兼容旧调用 → 根目录创建 */
    if (typeof parentId === 'function') { cb = parentId; parentId = null; }
    var base = '新建文件夹';
    /* 同级（同一个 parentId 下）的 folder 名字不能重复 */
    var siblings = desk.folders.filter(function (f) { return (f.parentId || null) === (parentId || null); });
    var names = siblings.map(function (f) { return f.name; });
    var name = base;
    var index = 2;
    while (names.indexOf(name) >= 0) {
      name = base + ' ' + index;
      index += 1;
    }
    var parentName = null;
    if (parentId) {
      var parent = desk.folders.find(function (f) { return f.id === parentId; });
      parentName = parent ? parent.name : null;
    }
    askName(parentName ? '在「' + parentName + '」下新建子文件夹' : '新建文件夹', name, function (value) {
      if (!value) return;
      var folder = { id: 'f' + A.uid(), name: value, parentId: parentId || null, createdAt: Date.now() };
      desk.folders.unshift(folder);
      /* 自动展开父节点，让新子文件夹可见 */
      if (parentId) view.expanded[parentId] = true;
      persistNow();
      renderPanel();
      if (cb) cb(folder);
      A.toast('已创建文件夹「' + value + '」' + (parentName ? '（在「' + parentName + '」下）' : ''), 'success');
    });
  }

  function deleteFolder(id, silent) {
    var folder = desk.folders.find(function (f) { return f.id === id; });
    if (!folder) return;
    var descendantIds = collectDescendantIds(id);
    var totalWorks = 0;
    descendantIds.forEach(function (fid) {
      Object.keys(desk.assigns).forEach(function (wid) {
        if (desk.assigns[wid] === fid) { delete desk.assigns[wid]; totalWorks++; }
      });
    });
    if (!silent) {
      var msg = '删除「' + folder.name + '」？';
      if (descendantIds.length > 1) msg += '（包含 ' + (descendantIds.length - 1) + ' 个子文件夹）';
      msg += '\n其中 ' + totalWorks + ' 项作品将回到个人空间。';
      if (!window.confirm(msg)) return;
    }
    desk.folders = desk.folders.filter(function (f) { return descendantIds.indexOf(f.id) < 0; });
    if (view.activeFolder && descendantIds.indexOf(view.activeFolder) >= 0) view.activeFolder = folder.parentId || null;
    persistNow();
    renderAll();
    if (!silent) A.toast('已删除 ' + descendantIds.length + ' 个文件夹，' + totalWorks + ' 项作品回到个人空间', 'info');
  }

  /* ---------------- 桌面 ---------------- */
  function activeWorks() {
    var list = state.works.slice();
    if (view.activeFolder) {
      /* 正在查看某个文件夹内部 */
      list = list.filter(function (w) { return desk.assigns[w.id] === view.activeFolder; });
    } else {
      /* 桌面根视图：只显示散落（没有被任何文件夹收走）的作品 */
      list = list.filter(function (w) { return !desk.assigns[w.id]; });
    }
    return list;
  }

  /* 新生成的作品：如果当前正处在某个文件夹的桌面里，自动归入该文件夹 */
  function onWorkCreated(work) {
    if (!work || !work.id || !view.activeFolder) return;
    if (desk.assigns[work.id]) return;
    desk.assigns[work.id] = view.activeFolder;
    delete desk.positions[work.id];
    persistSoon();
  }

  /* 某个文件夹下（含所有子孙文件夹）的全部作品 */
  function worksUnderFolder(id) {
    var ids = {};
    (function collect(fid) {
      ids[fid] = true;
      desk.folders.forEach(function (f) {
        if ((f.parentId || null) === fid && !ids[f.id]) collect(f.id);
      });
    })(id);
    return state.works.filter(function (w) { return ids[desk.assigns[w.id]]; });
  }

  /* 某文件夹是否"有内容"：自身有作品，或有子文件夹 */
  function folderHasContent(id) {
    if (state.works.some(function (w) { return desk.assigns[w.id] === id; })) return true;
    return desk.folders.some(function (f) { return (f.parentId || null) === id; });
  }

  /* 当前桌面这一层要显示的文件夹：
     根桌面 → 顶层文件夹；进入某文件夹 → 它的直接子文件夹。
     这样每个文件夹都有自己独立的一层桌面，互不混在一起。 */
  function activeFolders() {
    var parentId = view.activeFolder || null;
    return desk.folders.filter(function (f) {
      if (!f || !f.id) return false;
      if (f.id === view.activeFolder) return false;
      if ((f.parentId || null) !== parentId) return false;
      return folderHasContent(f.id);
    });
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

  function defaultSlot(idx, grid) {
    return compactSlot(idx, grid);
  }

  /* 两张卡片是否像素重叠（用于给新卡片找空位，避免压在别人身上） */
  function overlapsAny(left, top, occupied) {
    var w = cardWidth();
    return occupied.some(function (r) {
      return left < r.left + w && r.left < left + w &&
        top < r.top + CARD_H && r.top < top + CARD_H;
    });
  }

  /* 从 startIdx 往后找第一个没被占用的网格位（保持生成顺序，不覆盖已有卡片） */
  function nextFreeSlot(startIdx, grid, occupied) {
    var idx = startIdx;
    var guard = 0;
    while (guard++ < 600) {
      var slot = compactSlot(idx, grid);
      if (!overlapsAny(slot.pxLeft, slot.pxTop, occupied)) return slot;
      idx += 1;
    }
    return compactSlot(startIdx, grid);
  }

  function placeCard(el, id, idx, grid, occupied) {
    occupied = occupied || [];
    if (!el) return;
    var pos = desk.positions[id] || desk.positions['job:' + id];
    /* 只在用户明确拖过（_userSet=true）时才用存储坐标，否则一律从空位紧凑排 */
    if (!pos || !pos._userSet) {
      pos = nextFreeSlot(idx, grid, occupied);
    }
    var left, top;
    if (typeof pos.pxTop === 'number') {
      left = Math.round(pos.pxLeft || 0);
      top = Math.round(pos.pxTop);
    } else if (typeof pos.y === 'number') {
      left = Math.round(Math.min(1, Math.max(0, pos.x || 0)) * (grid.clientWidth - cardWidth() - 4));
      top = Math.round(Math.min(1, Math.max(0, pos.y)) * grid.clientHeight);
      pos.pxLeft = left;
      pos.pxTop = top;
      delete pos.x;
      delete pos.y;
    } else {
      var slot = nextFreeSlot(idx, grid, occupied);
      left = slot.pxLeft;
      top = slot.pxTop;
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.zIndex = String(pos.z || idx + 1);
    if (!desk.positions[id]) desk.positions[id] = { pxLeft: left, pxTop: top, z: pos.z || idx + 1 };
    occupied.push({ left: left, top: top });
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

  /* 文件夹卡片 HTML：正方形，顶部缩略图网格 + 名称 + 数量角标 */
  function folderCardHtmlInner(folder) {
    var items = worksUnderFolder(folder.id);
    var subCount = desk.folders.filter(function (f) { return (f.parentId || null) === folder.id; }).length;
    var thumbs = items.slice(0, 4).map(function (w) { return esc(w.thumb || w.url || ''); });
    var more = Math.max(0, items.length - 4);
    var gridHtml = '';
    if (thumbs.length === 0) {
      gridHtml = '<div class="folder-grid-empty">📂</div>';
    } else if (thumbs.length === 1) {
      gridHtml = '<img src="' + thumbs[0] + '" class="folder-t" alt="">';
    } else {
      gridHtml = thumbs.map(function (t, i) {
        return '<img src="' + t + '" class="folder-t folder-t-' + i + '" alt="">';
      }).join('');
    }
    var moreHtml = more > 0 ? '<span class="folder-more">+' + more + '</span>' : '';
    var meta = items.length + ' 项' + (subCount ? ' · ' + subCount + ' 个子文件夹' : '');
    return '<div class="folder-thumb">' + gridHtml + moreHtml + '</div>' +
      '<div class="folder-info"><strong>' + esc(folder.name) + '</strong><small>' + meta + '</small></div>' +
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
    /* 切换桌面 → 提示词与参考图跟随切换（每个桌面独立、跨刷新保留） */
    if (window.HMComposer && window.HMComposer.onFolderChange) {
      try { window.HMComposer.onFolderChange(view.activeFolder); }
      catch (err) { console.warn('[desk] composer 同步失败，已忽略：', err); }
    }
    persistSoon(); /* 记住当前停在哪个桌面 */
    if (!grid.classList.contains('is-board')) grid.classList.add('is-board');
    setDockVar();

    /* ---------- 清理已完成/失败的 job 节点 ---------- */
    Array.prototype.forEach.call(grid.querySelectorAll('[data-job]'), function (node) {
      if (!node.classList.contains('is-loading')) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    });

    var works = activeWorks();
    works.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var folders = activeFolders();

    /* ---------- 文件夹桌面无需返回按钮：各文件夹桌面独立，通过左侧项目栏切换 ---------- */
    var backHint = byId('deskBackHint');
    if (backHint && backHint.parentNode) backHint.parentNode.removeChild(backHint);

    /* ---------- 增量更新 desk-card ---------- */
    var needIds = {};
    works.forEach(function (w) { needIds[w.id] = true; });

    Array.prototype.forEach.call(grid.querySelectorAll('.desk-card'), function (node) {
      var id = node.dataset.work;
      if (!needIds[id]) node.parentNode.removeChild(node);
    });

    var idx = 0;
    var occupied = [];
    works.forEach(function (w) {
      var existing = grid.querySelector('.desk-card[data-work="' + w.id + '"]');
      if (!existing) {
        existing = document.createElement('article');
        existing.className = 'desk-card';
        existing.dataset.work = w.id;
        existing.dataset.type = (w.type || 'image');
        grid.appendChild(existing);
      }
      existing.innerHTML = deskCardHtmlInner(w);
      placeCard(existing, w.id, idx, grid, occupied);
      idx += 1;
    });

    /* ---------- 增量更新 folder-card（每一层桌面都显示本层文件夹） ---------- */
    var needFolderIds = {};
    folders.forEach(function (f) { needFolderIds[f.id] = true; });

    Array.prototype.forEach.call(grid.querySelectorAll('.folder-card'), function (node) {
      var id = node.dataset.folder;
      if (!needFolderIds[id]) node.parentNode.removeChild(node);
    });

    folders.forEach(function (f) {
      var existing = grid.querySelector('.folder-card[data-folder="' + f.id + '"]');
      if (!existing) {
        existing = document.createElement('article');
        existing.className = 'folder-card';
        existing.dataset.folder = f.id;
        grid.appendChild(existing);
      }
      existing.innerHTML = folderCardHtmlInner(f);
      var pos = desk.positions[f.id];
      if (!pos || !pos.pxLeft) {
        pos = nextFreeSlot(works.length + folders.indexOf(f), grid, occupied);
        pos._userSet = false;
        desk.positions[f.id] = pos;
      }
      var left = typeof pos.pxLeft === 'number' ? pos.pxLeft : PAD;
      var top = typeof pos.pxTop === 'number' ? pos.pxTop : PAD;
      existing.style.left = left + 'px';
      existing.style.top = top + 'px';
      existing.style.zIndex = String(pos.z || idx + 1);
      occupied.push({ left: left, top: top });
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
        pos = nextFreeSlot(works.length + folders.length + i, grid, occupied);
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
        var occ = [];
        Array.prototype.forEach.call(g.querySelectorAll('.desk-card'), function (el, idx) {
          if (el.dataset.work) placeCard(el, el.dataset.work, idx, g, occ);
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

  /* 把访客共享 key（anidream.desk.v1）里的数据迁移到当前用户专属 key。
     场景：页面刚加载时 window.HMApp.user 尚未就绪，用户在访客态下创建了文件夹，
     这些数据进了 anidream.desk.v1；等 me() 确认用户身份后 reloadForUser 切到用户 key，
     如果不迁移，这些文件夹就"消失"了。 */
  function migrateGuestToUser() {
    var uid = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    if (!uid) return;
    var guestKey = 'anidream.desk.v1';
    var userKey = 'anidream.desk.v1.' + uid;
    if (guestKey === userKey) return;
    var guest = null;
    try { guest = JSON.parse(localStorage.getItem(guestKey) || 'null'); } catch (e) { guest = null; }
    if (!guest || typeof guest !== 'object') return;
    /* 仅当访客数据里有内容（文件夹或作品归属）时才迁移，避免空数据覆盖用户已有数据 */
    var hasGuestContent = (Array.isArray(guest.folders) && guest.folders.length > 0) ||
      (guest.assigns && Object.keys(guest.assigns).length > 0);
    if (!hasGuestContent) return;
    var user = null;
    try { user = JSON.parse(localStorage.getItem(userKey) || 'null'); } catch (e) { user = null; }
    var hasUserContent = user && ((Array.isArray(user.folders) && user.folders.length > 0) ||
      (user.assigns && Object.keys(user.assigns).length > 0));
    if (hasUserContent) return; /* 用户 key 已有内容，不覆盖 */
    /* 把访客数据写入用户 key（合并：访客文件夹追加到用户文件夹前） */
    var merged = {
      folders: (guest.folders || []).slice(),
      positions: Object.assign({}, guest.positions || {}),
      assigns: Object.assign({}, guest.assigns || {}),
      names: Object.assign({}, guest.names || {}),
      activeFolder: guest.activeFolder || null,
      updatedAt: Date.now()
    };
    try { localStorage.setItem(userKey, JSON.stringify(merged)); } catch (e) {}
    /* 迁移后清空访客 key，避免下次重复迁移 */
    try { localStorage.removeItem(guestKey); } catch (e) {}
  }

  /* 登录后：从当前用户的专属 key 重新加载桌面布局（切换账号时调用） */
  function reloadForUser() {
    /* 先把访客态下创建的文件夹迁移到用户专属 key，防止"刷新后文件夹消失" */
    migrateGuestToUser();
    desk.folders = [];
    desk.positions = {};
    desk.assigns = {};
    desk.names = {};
    desk.updatedAt = 0;
    view.activeFolder = null;
    view.selected = {};
    load();
    renderAll();
    setTimeout(syncServer, 800);
  }

  /* 登出时：清空桌面内存数据，避免下个账号看到上个账号的文件夹布局 */
  function resetForLogout() {
    desk.folders = [];
    desk.positions = {};
    desk.assigns = {};
    desk.names = {};
    desk.updatedAt = 0;
    view.activeFolder = null;
    view.selected = {};
    renderAll();
  }

  function tidy() {
    var grid = byId('resultGrid');
    if (!grid) return;
    /* 每一层桌面：works + 本层 folders 合并紧凑排 */
    var works = activeWorks();
    works.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var items = works.map(function (w) { return { key: w.id, createdAt: w.createdAt || 0 }; });
    var folders = activeFolders();
    folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    items = items.concat(folders.map(function (f) { return { key: f.id, createdAt: f.createdAt || 0 }; }));
    items.forEach(function (it, i) {
      var slot = compactSlot(i, grid);
      slot._userSet = false;
      desk.positions[it.key] = slot;
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
    var folderIds = {};
    activeFolders().forEach(function (f) { folderIds[f.id] = true; });
    return Object.keys(view.selected).filter(function (id) {
      if (!view.selected[id]) return false;
      return findWork(id) || folderIds[id];
    });
  }

  function selectedWorks() {
    return selectedIds().map(function (id) { return findWork(id); }).filter(Boolean);
  }

  function syncSelection() {
    var grid = byId('resultGrid');
    var ids = selectedIds();
    if (grid) {
      Array.prototype.forEach.call(grid.querySelectorAll('.desk-card[data-work]'), function (el) {
        el.classList.toggle('is-selected', !!view.selected[el.dataset.work]);
        el.classList.toggle('is-cut', view.cut === el.dataset.work);
      });
      Array.prototype.forEach.call(grid.querySelectorAll('.folder-card[data-folder]'), function (el) {
        el.classList.toggle('is-selected', !!view.selected[el.dataset.folder]);
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
  var marquee = null; /* 框选模式 */

  function onPointerDown(event) {
    if (event.button !== 0) return;
    var grid = byId('resultGrid');
    if (!grid || !grid.contains(event.target)) return;
    var card = event.target.closest('.desk-card[data-work], .result-card.is-desk-job[data-job], .folder-card[data-folder]');
    var cardW = cardWidth();
    var maxLeft = grid.clientWidth - cardW - 4;

    if (!card) {
      /* 空白处按下 → 框选 */
      if (event.target !== grid && !event.target.closest('.hm-canvas')) return;
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) clearSelection();
      var rect = grid.getBoundingClientRect();
      marquee = {
        startX: event.clientX - rect.left + grid.scrollLeft,
        startY: event.clientY - rect.top + grid.scrollTop,
        x: 0, y: 0, w: 0, h: 0,
        el: document.createElement('div')
      };
      marquee.el.className = 'desk-marquee';
      marquee.el.style.cssText = 'position:absolute;pointer-events:none;border:1px dashed rgba(96,165,250,.7);background:rgba(96,165,250,.12);border-radius:4px;z-index:9998;display:none;left:0;top:0;';
      grid.appendChild(marquee.el);
      window.addEventListener('pointermove', onMarqueeMove);
      window.addEventListener('pointerup', onMarqueeUp);
      event.preventDefault();
      return;
    }
    /* 按钮/链接区域不触发拖动 */
    if (event.target.closest('button') || event.target.closest('.desk-acts') || event.target.closest('.action-btn')) return;

    /* 选中当前卡片 */
    var key;
    var isJob = card.hasAttribute('data-job');
    var isFolder = card.classList.contains('folder-card');
    if (isJob) key = 'job:' + card.dataset.job;
    else if (isFolder) key = card.dataset.folder;
    else key = card.dataset.work;

    if (event.ctrlKey || event.metaKey || event.shiftKey) toggleSelect(key);
    else if (!view.selected[key]) selectOnly(key);

    var ids = selectedIds();
    if (!ids.length) return;

    view.z += 1;
    var items = [];
    ids.forEach(function (wid) {
      var q;
      if (isJob) q = '.result-card.is-desk-job[data-job="' + wid.replace('job:', '') + '"]';
      else if (isFolder || desk.folders.some(function (f) { return f.id === wid; })) q = '.folder-card[data-folder="' + wid + '"]';
      else q = '.desk-card[data-work="' + wid + '"]';
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
    /* 不在 pointerdown 里 preventDefault —— 会阻断后续的 click 事件（folder-card 弹窗等） */
  }

  /* 拖动判定阈值：小于该距离的位移视为「点击」，不保存位置、不标记 _userSet。
     触屏板/鼠标点击时手指的微小抖动很容易超过 4px，导致卡片被误拖并永久偏移，
     因此把阈值提高到 8px（常规桌面端 5-10px 区间）。 */
  var DRAG_THRESHOLD = 8;

  function onPointerMove(event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      try { event.preventDefault(); } catch (e) {}
    }
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
    /* 拖动时让 grid 自动跟随滚动
       注意：只能在卡片贴近可见区域边缘时才滚动，否则会出现「点一下上面的图，
       滚动条却往下跑」的问题。之前用 visibleBottom - CARD_H - 40 做阈值，
       卡片高度 240px，导致几乎所有卡片的下移拖动都触发向下滚动。
       现在改为：卡片顶部距可见顶部 < 30px 才上滚，卡片底部距可见底部 < 30px 才下滚。 */
    var grid = byId('resultGrid');
    if (grid && drag.items[0]) {
      var t = drag.items[0].nextTop;
      var b = t + CARD_H;
      var visibleTop = grid.scrollTop;
      var visibleBottom = visibleTop + grid.clientHeight;
      if (t < visibleTop + 30) grid.scrollTop = Math.max(0, t - 60);
      else if (b > visibleBottom - 30) grid.scrollTop = Math.min(grid.scrollHeight, b - grid.clientHeight + 60);
    }
  }

  /* ---------- 框选（矩形） ---------- */
  function onMarqueeMove(event) {
    if (!marquee) return;
    var grid = byId('resultGrid');
    var rect = grid.getBoundingClientRect();
    var cx = event.clientX - rect.left + grid.scrollLeft;
    var cy = event.clientY - rect.top + grid.scrollTop;
    var x = Math.min(marquee.startX, cx);
    var y = Math.min(marquee.startY, cy);
    var w = Math.abs(cx - marquee.startX);
    var h = Math.abs(cy - marquee.startY);
    marquee.x = x; marquee.y = y; marquee.w = w; marquee.h = h;
    if (w < 3 && h < 3) { marquee.el.style.display = 'none'; return; }
    marquee.el.style.display = 'block';
    marquee.el.style.left = x + 'px';
    marquee.el.style.top = y + 'px';
    marquee.el.style.width = w + 'px';
    marquee.el.style.height = h + 'px';
    /* 自动滚动到 marquee 边缘 */
    var visibleTop = grid.scrollTop;
    var visibleBottom = visibleTop + grid.clientHeight;
    if (cy < visibleTop + 30) grid.scrollTop = Math.max(0, cy - 80);
    else if (cy > visibleBottom - 30) grid.scrollTop = Math.min(grid.scrollHeight, cy - grid.clientHeight + 80);
    /* 实时判断哪些卡片被框住 */
    var allCards = grid.querySelectorAll('.desk-card, .folder-card, .result-card.is-desk-job[data-job]');
    allCards.forEach(function (c) {
      var l = c.offsetLeft, t = c.offsetTop, r = l + c.offsetWidth, b = t + c.offsetHeight;
      var hit = l < x + w && r > x && t < y + h && b > y;
      if (hit) {
        var k = c.hasAttribute('data-job') ? 'job:' + c.dataset.job : (c.classList.contains('folder-card') ? c.dataset.folder : c.dataset.work);
        view.selected[k] = true;
      } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        var k2 = c.hasAttribute('data-job') ? 'job:' + c.dataset.job : (c.classList.contains('folder-card') ? c.dataset.folder : c.dataset.work);
        delete view.selected[k2];
      }
    });
    syncSelection();
  }

  function onMarqueeUp() {
    window.removeEventListener('pointermove', onMarqueeMove);
    window.removeEventListener('pointerup', onMarqueeUp);
    if (!marquee) return;
    if (marquee.el && marquee.el.parentNode) marquee.el.parentNode.removeChild(marquee.el);
    marquee = null;
  }

  function onPointerUp(event) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (!drag) return;
    var current = drag;
    drag = null;
    var merged = false;

    /* 需求2：先查 elementFromPoint —— 保持 .is-dragging 让 pointer-events:none 穿透到目标卡片
       （如果先 removeClass('is-dragging')，被拖的卡片自身会重新遮挡 elementFromPoint 的命中） */
    if (event && typeof document.elementFromPoint === 'function') {
      var targetEl = document.elementFromPoint(event.clientX, event.clientY);
      var dropCard = targetEl ? targetEl.closest('.desk-card[data-work], .result-card.is-desk-job[data-job], .folder-card[data-folder]') : null;
      if (dropCard) {
        var dropIsJob = dropCard.hasAttribute('data-job');
        var dropIsFolder = dropCard.classList.contains('folder-card');
        var dropId, workId, targetFolderId;
        if (dropIsFolder) {
          dropId = dropCard.dataset.folder;
          targetFolderId = dropId;
        } else if (dropIsJob) {
          dropId = 'job:' + dropCard.dataset.job;
          workId = dropCard.dataset.job;
          targetFolderId = desk.assigns[workId];
        } else {
          dropId = dropCard.dataset.work;
          workId = dropCard.dataset.work;
          targetFolderId = desk.assigns[workId];
        }
        var draggedIds = current.items.map(function (i) { return i.id; });
        /* 不能拖到自己身上（folder 被拖也不能拖进自己） */
        if (draggedIds.indexOf(dropId) < 0 && !draggedIds.some(function (d) { return d === targetFolderId; })) {
          /* 记住 dropCard 的原始位置——新建 folder 要放在这里 */
          var inheritedPos = null;
          if (!dropIsFolder) {
            inheritedPos = desk.positions[workId] || null;
          }
          var folder = mergeItemsIntoFolder(draggedIds.concat([dropIsFolder ? [] : [dropId]]), targetFolderId, !dropIsFolder);
          if (folder) {
            /* 新建文件夹 → 放在 dropCard 原位置 */
            if (!dropIsFolder && inheritedPos) {
              desk.positions[folder.id] = {
                pxLeft: inheritedPos.pxLeft || PAD,
                pxTop: inheritedPos.pxTop || PAD,
                z: (inheritedPos.z || view.z + 1),
                _userSet: true
              };
            } else if (!dropIsFolder && !inheritedPos) {
              desk.positions[folder.id] = compactSlot(0, grid);
            }
            persistNow();
            clearSelection();
            renderDesktop(); /* renderDesktop 会重建 DOM，连带清掉残留的 is-dragging */
            A.toast('已合并到「' + folder.name + '」', 'success');
            merged = true;
          }
        }
      }
    }

    if (merged) return;

    /* 没合并：清 is-dragging + 保存位置 */
    if (current.moved) {
      current.items.forEach(function (item) {
        if (!item.el) return;
        item.el.classList.remove('is-dragging');
        var left = typeof item.nextLeft === 'number' ? item.nextLeft : item.left;
        var top = typeof item.nextTop === 'number' ? item.nextTop : item.top;
        var pos = desk.positions[item.id] || {};
        pos.pxLeft = left;
        pos.pxTop = Math.max(0, top);
        pos._userSet = true;
        delete pos.x;
        delete pos.y;
        desk.positions[item.id] = pos;
      });
    } else {
      current.items.forEach(function (item) {
        if (item.el) item.el.classList.remove('is-dragging');
      });
    }

    persistSoon();
  }

  /* 把一组 id 合并进文件夹（create=true 时若无文件夹则新建） */
  function mergeItemsIntoFolder(ids, folderId, create) {
    var folder = folderId ? desk.folders.find(function (f) { return f.id === folderId; }) : null;
    if (!folder && create) {
      var count = ids.length;
      folder = { id: 'f' + A.uid(), name: '文件夹 (' + count + ')', createdAt: Date.now(), parentId: null };
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

  /* 复制/剪切：支持单张（右键菜单）或多张（Ctrl+C/X、Ctrl+A 后操作） */
  function copyWork(work) {
    var works = work ? [work] : selectedWorks();
    if (!works.length) { clipboard.clear(); return A.toast('没有可复制的项', 'info'); }
    clipboard.setCopy(works);
    A.toast('已复制 ' + works.length + ' 项，Ctrl+V 可粘贴到任何项目', 'info');
  }

  function cutWork(work) {
    var works = work ? [work] : selectedWorks();
    if (!works.length) { clipboard.clear(); return A.toast('没有可剪切的项', 'info'); }
    var ids = works.map(function (w) { return w.id; });
    var fromFolder = view.activeFolder;
    clipboard.setCut(works, fromFolder);
    ids.forEach(function (id) { view.cut = id; }); /* 标记半透明 */
    syncSelection();
    renderDesktop();
    A.toast('已剪切 ' + works.length + ' 项，Ctrl+V 粘贴到任何项目', 'info');
  }

  function pasteWork() {
    if (clipboard.isEmpty()) return A.toast('剪贴板是空的，先右键或 Ctrl+C 复制', 'info');
    var data = clipboard.data;
    var targetFolder = view.activeFolder;

    if (data.type === 'copy') {
      var newCount = 0;
      data.works.forEach(function (orig) {
        var copy = Object.assign({}, orig, { id: 'w' + A.uid(), createdAt: Date.now(), name: workName(orig) + ' 副本' });
        state.works.push(copy);
        if (targetFolder) desk.assigns[copy.id] = targetFolder;
        /* 位置：compactSlot 下一个空位 */
        grid = byId('resultGrid');
        desk.positions[copy.id] = compactSlot(state.works.length + newCount, grid);
        desk.names[copy.id] = copy.name;
        newCount += 1;
      });
      clipboard.clear();
      persistNow();
      A.saveWorks();
      renderDesktop();
      clearSelection();
      A.toast('已粘贴 ' + newCount + ' 项到「' + (targetFolder ? folderName(targetFolder) : '个人空间') + '」', 'success');
    } else if (data.type === 'cut') {
      data.works.forEach(function (orig) {
        /* 从源位置移除 */
        state.works = state.works.filter(function (w) { return w.id !== orig.id; });
        delete desk.positions[orig.id];
        delete desk.names[orig.id];
        view.cut = null;
        /* 放到目标位置 */
        state.works.push(orig);
        if (targetFolder) desk.assigns[orig.id] = targetFolder;
        else delete desk.assigns[orig.id];
        grid = byId('resultGrid');
        desk.positions[orig.id] = compactSlot(state.works.length - 1, grid);
      });
      clipboard.clear();
      persistNow();
      A.saveWorks();
      renderDesktop();
      clearSelection();
      A.toast('已移动 ' + data.works.length + ' 项到「' + (targetFolder ? folderName(targetFolder) : '个人空间') + '」', 'success');
    }
  }

  function restoreParams(work) {
    if (!work) return;
    /* 统一走 app.js 的 reuseJob：它会校验模型（id 失效时按名称回退）、
       引擎、比例、倍数、步数与种子，避免恢复成不存在的模型或错误参数 */
    if (A.reuseJob) {
      A.reuseJob(work);
      return;
    }
    var inp = byId('promptInput');
    if (inp) {
      inp.value = work.prompt || work.enPrompt || '';
      if (inp.dispatchEvent) inp.dispatchEvent(new Event('input', { bubbles: true }));
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

  /* ---------------- 文件夹预览弹窗 ---------------- */
  function openFolderPreview(folder) {
    var modal = byId('folderPreviewModal');
    if (!modal) return;
    var items = state.works.filter(function (w) { return desk.assigns[w.id] === folder.id; });
    items.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

    var title = byId('folderPrevTitle');
    if (title) title.textContent = folder.name + '（' + items.length + ' 项）';

    var body = byId('folderPrevBody');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<p class="folder-prev-empty">文件夹里还没有作品</p>';
    } else {
      body.innerHTML = items.map(function (w) {
        var url = esc(w.thumb || w.url || '');
        var cls = w.type === 'video' ? 'is-video' : (w.type === 'audio' ? 'is-audio' : '');
        var inner;
        if (w.type === 'video') inner = '<video src="' + url + '" muted playsinline preload="metadata"></video><span class="media-play">▶</span>';
        else if (w.type === 'audio') inner = '<span>♪</span><small>音频</small>';
        else inner = '<img src="' + url + '" alt="' + esc(w.prompt) + '" loading="lazy" draggable="false">';
        return '<div class="folder-prev-cell" data-fp="' + esc(w.id) + '">' +
          '<div class="folder-prev-media ' + cls + '">' + inner + '</div>' +
          '<div class="folder-prev-meta"><strong>' + esc(workName(w)) + '</strong><small>' + typeLabel(w.type) + ' · ' + (w.width || 0) + '×' + (w.height || 0) + '</small></div>' +
          '</div>';
      }).join('');
    }

    modal.hidden = false;

    /* 点击弹窗内的缩略图 → 打开原图 lightbox */
    body.onclick = function (ev) {
      var cell = ev.target.closest('.folder-prev-cell');
      if (!cell) return;
      var w = findWork(cell.dataset.fp);
      if (w && typeof A.openLightbox === 'function') A.openLightbox(w);
    };
  }

  function closeFolderPreview() {
    var modal = byId('folderPreviewModal');
    if (modal) modal.hidden = true;
  }

  /* ---------------- 文件夹卡片行内重命名 ---------------- */
  function startFolderRename(card) {
        if (!card) {  return; }
    var folderId = card.dataset.folder;
    var folder = desk.folders.find(function (f) { return f.id === folderId; });
    if (!folder) {  return; }
    var strong = card.querySelector('.folder-info strong');
    if (!strong || card.classList.contains('is-renaming')) {  return; }
    card.classList.add('is-renaming');
    var input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.className = 'folder-rename-input';
    input.maxLength = 24;
    strong.replaceWith(input);
    input.focus();
    input.select();
    
    function commit() {
            var val = input.value.trim();
      if (val && val !== folder.name) folder.name = val;
      card.classList.remove('is-renaming');
      if (input.parentNode) {
        var newStrong = document.createElement('strong');
        newStrong.textContent = folder.name;
        input.replaceWith(newStrong);
      }
      persistNow();
      renderPanel();
      A.toast('已重命名为「' + folder.name + '」', 'success');
    }
    function cancel() {
            card.classList.remove('is-renaming');
      if (input.parentNode) {
        var newStrong = document.createElement('strong');
        newStrong.textContent = folder.name;
        input.replaceWith(newStrong);
      }
    }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', function () {  commit(); });
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
      /* ============== inline input 事件（在 click 之前，因为是 input 自己冒泡） ============== */
      projList.addEventListener('input', function (event) {
        var ip = event.target.closest('.hm-inline-input');
        if (!ip) return;
        if (view.inline) view.inline.value = ip.value;
      });
      projList.addEventListener('keydown', function (event) {
        var ip = event.target.closest('.hm-inline-input');
        if (!ip) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          commitInline(ip.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          /* 只取消行内编辑，不把整个项目面板一起关掉 */
          event.stopPropagation();
          cancelInline();
        }
      });
      projList.addEventListener('blur', function (event) {
        var ip = event.target.closest('.hm-inline-input');
        if (!ip) return;
        /* 点击 cancel 按钮 → cancelInline 会先执行 */
        setTimeout(function () {
          if (view.inline && document.activeElement !== ip) commitInline(ip.value);
        }, 150);
      }, true);  /* 捕获阶段 */

      /* cancel 按钮 */
      projList.addEventListener('click', function (event) {
        var cb = event.target.closest('[data-inline-cancel]');
        if (cb) { event.stopPropagation(); cancelInline(); return; }
      });

      /* ============== 右键菜单（项目侧栏） ============== */
      projList.addEventListener('contextmenu', function (event) {
        var row = event.target.closest('[data-folder-row]');
        if (row) {
          event.preventDefault();
          event.stopPropagation();
          view.menuFolder = row.dataset.folderRow;
          showContext('folderCtx', event.clientX, event.clientY);
          return;
        }
        var isSpace = event.target.closest('[data-proj="space"]');
        if (isSpace) { event.preventDefault(); }
      });

      /* ============== 主 click 事件 ============== */
      projList.addEventListener('click', function (event) {
        /* 折叠/展开 toggle */
        var toggle = event.target.closest('[data-folder-toggle]');
        if (toggle) {
          event.stopPropagation();
          var tid = toggle.dataset.folderToggle;
          view.expanded[tid] = view.expanded[tid] === false;
          renderPanel();
          return;
        }
        /* ＋号：行内在该文件夹下建子文件夹 */
        var plus = event.target.closest('[data-folder-plus]');
        if (plus) {
          event.stopPropagation();
          startInlineCreate(plus.dataset.folderPlus);
          return;
        }
        /* ⋯ 更多菜单 */
        var more = event.target.closest('[data-folder-more]');
        if (more) {
          event.stopPropagation();
          view.menuFolder = more.dataset.folderMore;
          var rect = more.getBoundingClientRect();
          showContext('folderCtx', rect.left - 150, rect.bottom + 6);
          return;
        }
        /* 文件夹行 —— 支持 Ctrl/Shift 多选 + 单击同步桌面（不关面板） */
        var folderRow = event.target.closest('[data-folder-row]');
        if (folderRow && !event.target.closest('.hm-inline-input')) {
          event.stopPropagation();
          var fid = folderRow.dataset.folderRow;
          if (event.ctrlKey || event.metaKey) {
            /* 多选：切换 */
            if (view.selectedFolders[fid]) delete view.selectedFolders[fid];
            else view.selectedFolders[fid] = true;
          } else if (event.shiftKey) {
            /* Shift 多选：先找当前展开可见的顺序 */
            var visible = [];
            function collect(nodes) { nodes.forEach(function (n) {
              visible.push(n.id);
              if (n.children && n.children.length && view.expanded[n.id] !== false) collect(n.children);
            }); }
            collect(buildTree());
            var curIdx = visible.indexOf(fid);
            var last = Object.keys(view.selectedFolders).pop() || view.activeFolder || null;
            var lastIdx = last ? visible.indexOf(last) : curIdx;
            view.selectedFolders = {};
            var from = Math.min(curIdx, lastIdx);
            var to = Math.max(curIdx, lastIdx);
            for (var i = from; i <= to; i++) view.selectedFolders[visible[i]] = true;
          } else {
            /* 单击：清多选 + 设 active + 同步桌面 */
            view.selectedFolders = {};
            view.selectedFolders[fid] = true;
            view.activeFolder = fid;
            clearSelection();
            renderPanel();
            renderDesktop();
            /* 不关 panel */
            return;
          }
          renderPanel();
          return;
        }
        /* 个人空间 / 新建按钮 */
        var row = event.target.closest('[data-proj]');
        if (!row) return;
        var action = row.dataset.proj;
        if (action === 'history') {
          openHistory();
        } else if (action === 'space') {
          view.selectedFolders = {};
          view.activeFolder = null;
          clearSelection();
          renderPanel();
          renderDesktop();
        } else if (action === 'new') {
          startInlineCreate(null);
        }
      });

      /* ============== HTML5 Drag & Drop：文件夹 → 文件夹 / 根目录 ============== */
      projList.addEventListener('dragstart', function (e) {
        var row = e.target.closest('[data-folder-row]');
        if (!row) { return; }
        var dragSrcId = row.dataset.folderRow;
        row.classList.add('is-dragging');
        try {
          e.dataTransfer.setData('application/x-folder', dragSrcId);
          e.dataTransfer.setData('text/plain', dragSrcId);
          e.dataTransfer.effectAllowed = 'move';
        } catch (err) {}
      });
      projList.addEventListener('dragend', function (e) {
        projList.querySelectorAll('.is-drop-over').forEach(function (el) { el.classList.remove('is-drop-over'); });
        projList.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });
      });
      projList.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var row = e.target.closest('[data-folder-row]');
        var isRootDrop = !!e.target.closest('[data-root-drop]');
        projList.querySelectorAll('.is-drop-over').forEach(function (el) { el.classList.remove('is-drop-over'); });
        if (isRootDrop) {
          var rootZone = projList.querySelector('[data-root-drop]');
          if (rootZone) rootZone.classList.add('is-drop-over');
        } else if (row) {
          var tgtId = row.dataset.folderRow;
          var srcId = e.dataTransfer.types ? null : null; /* 从 text/plain 读 src — 但这里只做视觉 */
          row.classList.add('is-drop-over');
        }
      });
      projList.addEventListener('drop', function (e) {
        e.preventDefault();
        var srcId = null;
        try { srcId = e.dataTransfer.getData('application/x-folder') || e.dataTransfer.getData('text/plain'); } catch (err) {}
        if (!srcId) return;

        projList.querySelectorAll('.is-drop-over').forEach(function (el) { el.classList.remove('is-drop-over'); });
        projList.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });

        var actualSrcId = srcId, dragType = 'folder';
        if (srcId.indexOf('folder:') === 0) { actualSrcId = srcId.slice(7); }
        else if (srcId.indexOf('work:') === 0) { actualSrcId = srcId.slice(5); dragType = 'work'; }

        var targetRow = e.target.closest('[data-folder-row]');
        var isRootDrop = !!e.target.closest('[data-root-drop]');

        if (dragType === 'folder') {
          if (isRootDrop) {
            moveFolder(actualSrcId, null);
            var f1 = desk.folders.find(function (f) { return f.id === actualSrcId; });
            A.toast('「' + (f1 ? f1.name : '文件夹') + '」已移到根目录', 'success');
          } else if (targetRow && targetRow.dataset.folderRow !== actualSrcId) {
            var tgtId = targetRow.dataset.folderRow;
            if (isDescendantOf(actualSrcId, tgtId)) {
              A.toast('不能把文件夹拖进它自己的子文件夹里', 'info'); return;
            }
            moveFolder(actualSrcId, tgtId);
            var fs = desk.folders.find(function (f) { return f.id === actualSrcId; });
            var ft = desk.folders.find(function (f) { return f.id === tgtId; });
            A.toast('「' + (fs ? fs.name : '文件夹') + '」已移入「' + (ft ? ft.name : '目标') + '」', 'success');
            view.expanded[tgtId] = true;
          } else { return; }
          if (view.activeFolder === actualSrcId || isDescendantOf(actualSrcId, view.activeFolder)) view.activeFolder = actualSrcId;
          view.selectedFolders = {};
          view.selectedFolders[actualSrcId] = true;
          renderPanel();
          renderDesktop();
        } else {
          if (isRootDrop) { moveWorksFolder([actualSrcId], null); A.toast('已把 1 项移到根目录', 'success'); }
          else if (targetRow) {
            var tf = targetRow.dataset.folderRow;
            moveWorksFolder([actualSrcId], tf);
            var tf2 = desk.folders.find(function (f) { return f.id === tf; });
            A.toast('已把 1 项移入「' + (tf2 ? tf2.name : '文件夹') + '」', 'success');
          } else { return; }
          renderPanel(); renderDesktop();
        }
      });
    }

    /* 桌面 */
    var grid = byId('resultGrid');
    if (grid) {
      /* 桌面 folder-card / work-card 拖拽到侧栏文件夹 */
      grid.addEventListener('dragstart', function (e) {
        var card = e.target.closest('.folder-card[data-folder], .desk-card[data-work]');
        if (!card) return;
        var dragType = card.classList.contains('folder-card') ? 'folder' : 'work';
        var dataId = (dragType + ':' + card.dataset[dragType]);
        try {
          e.dataTransfer.setData('text/plain', dataId);
          e.dataTransfer.setData('application/x-folder', dataId);
          e.dataTransfer.effectAllowed = 'move';
        } catch (err) {}
      });

      grid.addEventListener('pointerdown', onPointerDown);
      grid.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        /* 右键 folder-card → folderCtx */
        var folderCard = event.target.closest('.folder-card[data-folder]');
        if (folderCard) {
          view.menuFolder = folderCard.dataset.folder;
          showContext('folderCtx', event.clientX, event.clientY);
          return;
        }
        var card = event.target.closest('.desk-card[data-work]');
        if (card) {
          var work = findWork(card.dataset.work);
          if (work) openWorkMenu(work, event.clientX, event.clientY);
        } else {
          showContext('deskCtx', event.clientX, event.clientY);
          /* 根据 clipboard 状态禁用/启用粘贴按钮 */
          var pasteBtn = byId('deskCtxPaste');
          if (pasteBtn) pasteBtn.disabled = clipboard.isEmpty();
        }
      });
      grid.addEventListener('click', function (event) {
        /* 左键 folder-card → 弹窗预览文件夹内容 */
        var folderCard = event.target.closest('.folder-card[data-folder]');
        if (folderCard) {
          if (event.target.closest('button')) return;
          var folder = desk.folders.find(function (f) { return f.id === folderCard.dataset.folder; });
          if (folder) openFolderPreview(folder);
          return;
        }
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

        /* 多选：操作同时应用到 selectedFolders 里的项 */
        var multiIds = (cmd === 'delete' || cmd === 'zip' || cmd === 'download' || cmd === 'copy')
          ? Object.keys(view.selectedFolders).filter(function (id) { return id !== folderId; })
          : [];
        var folder = desk.folders.find(function (f) { return f.id === folderId; });
        if (!folder) return;
        var allTargetIds = [folderId].concat(multiIds);

        if (cmd === 'open') {
          view.activeFolder = folderId;
          view.selectedFolders = {};
          view.selectedFolders[folderId] = true;
          clearSelection();
          renderPanel();
          renderDesktop();
        } else if (cmd === 'newsub') {
          /* 在该文件夹下行内建子文件夹 */
          startInlineCreate(folderId);
        } else if (cmd === 'delete') {
          /* 删除所有选中的文件夹 */
          if (allTargetIds.length > 1) {
            if (!window.confirm('删除 ' + allTargetIds.length + ' 个文件夹？所有作品会回到个人空间。')) return;
            allTargetIds.forEach(function (fid) { deleteFolder(fid, true); });
            view.selectedFolders = {};
          } else {
            deleteFolder(folderId);
          }
        } else if (cmd === 'rename') {
          startInlineRename(folderId);
        } else if (cmd === 'zip' || cmd === 'download' || cmd === 'copy') {
          /* 批量收集作品 */
          var allWorks = [];
          allTargetIds.forEach(function (fid) {
            allWorks = allWorks.concat(state.works.filter(function (w) { return desk.assigns[w.id] === fid; }));
          });
          if (!allWorks.length) return A.toast('项目里是空的', 'info');
          if (cmd === 'zip') {
            /* 单个 folder zip（多 folder 暂用逐 folder 下载代替） */
            if (allTargetIds.length > 1) {
              A.toast('开始下载 ' + allTargetIds.length + ' 个项目共 ' + allWorks.length + ' 项', 'success');
              allWorks.forEach(function (w, i) {
                setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 300);
              });
              return;
            }
            /* 单个 folder 走 JSZip —— 原来的逻辑复用 */
            var folderWorks = allWorks;
            if (typeof JSZip === 'undefined') {
              A.toast('开始下载「' + folder.name + '」里的 ' + folderWorks.length + ' 项', 'success');
              folderWorks.forEach(function (w, i) {
                setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 400);
              });
              return;
            }
            A.toast('正在打包「' + folder.name + '」…', 'info');
            var zip = new JSZip();
            var folderName = (folder.name || '项目').replace(/[\\/:*?"<>|]/g, '_');
            var sub = zip.folder(folderName);
            var fetched = 0;
            folderWorks.forEach(function (w) {
              try {
                var url = w.url || w.thumb;
                var fname = A.fileNameFor(w);
                if (url && /^data:/.test(url)) {
                  var parts = url.match(/^data:([^;]+);base64,(.+)$/);
                  if (parts) {
                    var mime = parts[1];
                    var ext = mime.split('/')[1] || 'png';
                    if (!/\.([a-z0-9]+)$/i.test(fname)) fname += '.' + ext;
                    sub.file(fname, parts[2], { base64: true });
                    fetched++; checkDone(); return;
                  }
                }
                fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
                  if (!/\.([a-z0-9]+)$/i.test(fname)) {
                    var extFromType = (blob.type || '').split('/')[1] || 'png';
                    fname += '.' + extFromType;
                  }
                  sub.file(fname, blob);
                }).catch(function () {
                  sub.file(fname + '.txt', '下载失败: ' + url);
                }).then(function () { fetched++; checkDone(); });
              } catch (err) { fetched++; checkDone(); }
            });
            function checkDone() {
              if (fetched < folderWorks.length) return;
              zip.generateAsync({ type: 'blob' }).then(function (blob) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = folderName + '.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
                A.toast('已导出「' + folderName + '.zip」（' + folderWorks.length + ' 项）', 'success');
              });
            }
          } else if (cmd === 'download') {
            A.toast('开始批量下载 ' + allWorks.length + ' 项', 'success');
            allWorks.forEach(function (w, i) {
              setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 300);
            });
          } else if (cmd === 'copy') {
            clipboard.setCopy(allWorks);
            A.toast('已复制 ' + allTargetIds.length + ' 个项目共 ' + allWorks.length + ' 项，Ctrl+V 粘贴', 'info');
          }
        }
      });
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('#hmCtx') || event.target.closest('#deskCtx') || event.target.closest('#folderCtx')) return;
      hideContexts();
    });

    /* 鼠标光标所在区域（项目栏 / 桌面），快捷键以此为准 */
    var lastMouse = { x: 0, y: 0 };
    document.addEventListener('mousemove', function (ev) {
      lastMouse.x = ev.clientX;
      lastMouse.y = ev.clientY;
    }, true);

    function hoverRegion() {
      var el = document.elementFromPoint(lastMouse.x, lastMouse.y);
      if (!el) return '';
      if (el.closest('#projPanel')) return 'panel';
      if (el.closest('#resultGrid')) return 'desk';
      return '';
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideContexts();
        /* inline 优先 cancel（不关面板） */
        if (view.inline) { cancelInline(); return; }
        closePanel();
        closeParam();
        closeRename();
        closeFolderPreview();
        clearSelection();
        return;
      }

      /* ===== F2 重命名快捷键（跨所有场景） ===== */
      if (event.key === 'F2') {
        /* 如果 inline 已经在编辑 → Enter 提交（复用 commitInline） */
        if (view.inline) {
          event.preventDefault();
          var curInput = projList ? projList.querySelector('.hm-inline-input') : null;
          commitInline(curInput ? curInput.value : view.inline.value);
          return;
        }
        /* 1. 侧栏 projList 有 active/selected folder → 重命名
           （仅当光标/焦点在项目栏时才回退到 activeFolder，避免在桌面按 F2 改到文件夹） */
        var inPanelFocus = event.target && event.target.closest && event.target.closest('#projPanel');
        var panelRegion = hoverRegion() === 'panel' || inPanelFocus;
        var targetFolder = panelRegion ? view.activeFolder : null;
        if (panelRegion && !targetFolder) {
          var selKeys = Object.keys(view.selectedFolders);
          if (selKeys.length === 1) targetFolder = selKeys[0];
        }
        if (targetFolder && desk.folders.some(function (f) { return f.id === targetFolder; })) {
          event.preventDefault();
          openPanel();
          startInlineRename(targetFolder);
          return;
        }
        /* 2. 桌面上选中了 folder-card（桌面多选 selected 里有 folder id） */
        var keys = selectedIds();
        /* 没有选中项时，以鼠标光标下的卡片为准 */
        if (!keys.length) {
          var hovEl = document.elementFromPoint(lastMouse.x, lastMouse.y);
          var hovCard = hovEl && hovEl.closest('.folder-card, .desk-card');
          if (hovCard) keys = [hovCard.dataset.folder || hovCard.dataset.work];
        }
        var deskFolderIds = keys.filter(function (k) { return desk.folders.some(function (f) { return f.id === k; }); });
        if (deskFolderIds.length === 1) {
          event.preventDefault();
          openPanel();
          view.activeFolder = deskFolderIds[0];
          startInlineRename(deskFolderIds[0]);
          return;
        }
        /* 3. 桌面上选中了 work → 重命名 work（原 askName） */
        var workIds = keys.filter(function (k) { return !k.indexOf('job:') && !desk.folders.some(function (f) { return f.id === k; }); });
        if (workIds.length === 1) {
          var work = findWork(workIds[0]);
          if (work) {
            event.preventDefault();
            askName('重命名', workName(work), function (value) {
              desk.names[work.id] = value;
              delete work.name;
              persistNow();
              renderDesktop();
              A.toast('已重命名', 'success');
            });
          }
          return;
        }
        return;
      }

      /* 只有桌面视图 + 没有在输入框/textarea/select/contenteditable 里，才响应桌面快捷键
         注意：以「光标下的元素」为准 —— 光标停在文本框上才让输入框处理，
         避免项目栏搜索框自动获得焦点后，桌面快捷键全部失灵 */
      var active = document.activeElement;
      var underEl = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(lastMouse.x, lastMouse.y) : null;
      if (underEl && underEl.closest && underEl.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (active && active.matches && active.matches('textarea, [contenteditable="true"]')) return;
      if (active && active.matches && active.matches('input, select') && !active.closest('#projSearch')) return;
      var inModal = active && active.closest('.modal, .hm-ctx');
      if (inModal) return;
      var isDesk = document.body.getAttribute('data-view') === 'create';
      if (!isDesk) return;

      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey) {
        var keys = selectedIds();
        /* 没有选中项时，以鼠标光标下的卡片为准 */
        if (!keys.length) {
          var hovEl = document.elementFromPoint(lastMouse.x, lastMouse.y);
          var hovCard = hovEl && hovEl.closest('.folder-card, .desk-card');
          if (hovCard) keys = [hovCard.dataset.folder || hovCard.dataset.work];
        }
        if (!keys.length) return;
        var folderIds = keys.filter(function (k) { return desk.folders.some(function (f) { return f.id === k; }); });
        if (folderIds.length) {
          event.preventDefault();
          folderIds.forEach(function (fid) { deleteFolder(fid); });
        } else {
          var workIds = keys.filter(function (k) { return !k.indexOf('job:'); });
          if (workIds.length) {
            event.preventDefault();
            var names = workIds.map(function (k) {
              var w = findWork(k);
              return w ? workName(w) : '';
            }).filter(Boolean);
            var label = workIds.length === 1 ? (names[0] || '该项') : workIds.length + ' 项';
            if (window.confirm('删除「' + label + '」？此操作不可撤销。')) {
              workIds.forEach(function (k) { deleteWork(findWork(k)); });
              clearSelection();
            }
          }
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        /* Ctrl+A：全选桌面可见项 */
        event.preventDefault();
        clearSelection();
        var allWorks = activeWorks();
        allWorks.forEach(function (w) { view.selected[w.id] = true; });
        if (!view.activeFolder) {
          activeFolders().forEach(function (f) { view.selected[f.id] = true; });
        }
        syncSelection();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        /* Ctrl+D：整理 */
        event.preventDefault();
        tidy();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyWork(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        cutWork(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteWork();
      }
    });

    /* ===== 区域感知快捷键：以鼠标光标所在区域决定作用对象 =====
       光标在左侧项目栏 → 作用于文件夹；在桌面 → 作用于作品/文件夹卡片。
       Delete/Backspace 删除、F2 重命名、Enter 打开文件夹、Ctrl+A 全选。 */
    document.addEventListener('keydown', function (event) {
      var key = event.key;
      var isDelete = key === 'Delete' || key === 'Backspace';
      var isF2 = key === 'F2';
      var isEnter = key === 'Enter';
      var isSelAll = (event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a';
      if (!isDelete && !isF2 && !isEnter && !isSelAll) return;
      if (event.altKey) return;
      if (document.body.getAttribute('data-view') !== 'create') return;
      /* 以光标下元素为准：光标停在文本框上时不拦截，交给输入框自己处理；
         面板搜索框自动聚焦不应阻断区域快捷键 */
      var underEl = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(lastMouse.x, lastMouse.y) : null;
      if (underEl && underEl.closest && underEl.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (underEl && underEl.closest && underEl.closest('.modal, .hm-ctx')) return;
      var active = document.activeElement;
      if (active && active.matches && active.matches('textarea, [contenteditable="true"]')) return;
      if (active && active.matches && active.matches('input, select') && !active.closest('#projSearch')) return;
      if (active && active.closest && active.closest('.modal, .hm-ctx')) return;
      var region = hoverRegion();
      if (!region && event.target && event.target.closest && event.target.closest('#projPanel')) region = 'panel';
      /* 只有光标在项目栏时才拦截；桌面/中性区域交给原有逻辑处理 */
      if (region !== 'panel') return;

      /* 目标文件夹：优先光标下的那一行 → 已选中的 → 当前打开的 */
      var hoveredRow = underEl && underEl.closest && underEl.closest('#projPanel [data-folder-row]');
      var hoveredFolderId = hoveredRow ? hoveredRow.dataset.folderRow : null;
      var folderIds = Object.keys(view.selectedFolders).filter(function (k) { return view.selectedFolders[k]; });
      if (hoveredFolderId) folderIds = [hoveredFolderId];
      else if (!folderIds.length && view.activeFolder) folderIds = [view.activeFolder];
      event.stopPropagation();

      if (isSelAll) {
        event.preventDefault();
        view.selectedFolders = {};
        desk.folders.forEach(function (f) {
          if ((f.parentId || null) === (view.activeFolder || null)) view.selectedFolders[f.id] = true;
        });
        renderPanel();
        return;
      }
      if (isEnter) {
        if (folderIds.length === 1) {
          event.preventDefault();
          view.activeFolder = folderIds[0];
          view.selectedFolders = {};
          clearSelection();
          renderPanel();
          renderDesktop();
        }
        return;
      }
      if (isF2) {
        if (folderIds.length !== 1) return;
        event.preventDefault();
        startInlineRename(folderIds[0]);
        return;
      }
      if (isDelete) {
        if (!folderIds.length) return;
        event.preventDefault();
        folderIds.forEach(function (fid) { deleteFolder(fid); });
        view.selectedFolders = {};
        renderPanel();
      }
    }, true);

    var paramModal = byId('paramModal');
    if (paramModal) {
      paramModal.addEventListener('click', function (event) {
        if (event.target === paramModal || event.target.closest('[data-close-param]')) closeParam();
      });
    }

    /* 文件夹预览弹窗 */
    var folderPrevModal = byId('folderPreviewModal');
    if (folderPrevModal) {
      folderPrevModal.addEventListener('click', function (event) {
        if (event.target === folderPrevModal || event.target.closest('[data-close-folder-prev]')) closeFolderPreview();
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
    clipboard.load();
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
        var job = A.state.jobs.get(id);
        if (!job || !job.startedAt) return;
        var ms = Date.now() - job.startedAt;
        timeEl.textContent = A.formatDuration ? A.formatDuration(ms) : ((ms / 1000).toFixed(1) + 's');
      });
    }, 400);
  }

  window.HMDesk = {
    init: init,
    renderDesktop: renderDesktop,
    syncJobs: syncJobs,
    clearSelection: clearSelection,
    onWorksChanged: onWorksChanged,
    onWorkCreated: onWorkCreated,
    tidy: tidy,
    openHistory: openHistory,
    openParam: openParam,
    deleteWork: deleteWork,
    sync: syncServer,
    reloadForUser: reloadForUser,
    resetForLogout: resetForLogout,
    getActiveFolder: function () { return view.activeFolder; },
    /* 顶部「个人空间」按钮：回到根桌面（未归档作品 + 顶层文件夹） */
    goSpace: function () {
      view.selectedFolders = {};
      view.activeFolder = null;
      clearSelection();
      var panel = byId('projPanel');
      if (panel) panel.hidden = true;
      renderPanel();
      renderDesktop();
    }
  };

  init();
})();
