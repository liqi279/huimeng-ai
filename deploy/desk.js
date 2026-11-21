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
  var DESK_INFO_H = 44;       /* 标题 + 耗时行的固定高度 */
  var DESK_INFO_H_PLAIN = 30; /* 只有标题时的高度 */
  var GAP = 14;
  var PAD = 12;

  /* 作品卡尺寸：按原图长宽比缩放到格位可用空间内，取宽高上限后等比收缩，
     保证卡片不超出 200×240 的格位、不压到邻卡 */
  function deskCardSize(work) {
    var maxW = cardWidth();
    var infoH = (work && work.elapsed > 0) ? DESK_INFO_H : DESK_INFO_H_PLAIN;
    var maxThumbH = CARD_H - infoH;
    var aw = Number(work && work.width) || 0;
    var ah = Number(work && work.height) || 0;
    if (!(aw > 0 && ah > 0)) return { w: maxW, h: CARD_H };
    var ratio = aw / ah;
    var thumbW = maxW;
    var thumbH = maxW / ratio;
    if (thumbH > maxThumbH) {
      thumbH = maxThumbH;
      thumbW = maxThumbH * ratio;
    }
    return { w: Math.round(thumbW), h: Math.round(thumbH) + infoH };
  }

  /* ---------------- 数据 ---------------- */
  var desk = {
    folders: [],
    stacks: [],      /* 桌面层的叠放组：不属于项目/文件夹，不进项目列表 */
    positions: {},
    assigns: {},
    names: {},
    tombstones: {},  /* 已删除的文件夹 id → 删除时间，用于跨设备合并时不把删掉的文件夹拉回来 */
    updatedAt: 0
  };
  /* 当前内存里的 desk 属于哪个 uid（换账号时防止把上个账号的布局写进新账号的键） */
  var deskUid = '';

  var view = {
    activeFolder: null,
    activeStack: null,  /* 当前打开的叠放组；与项目/文件夹互斥 */
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
    deskUid = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
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
    desk.tombstones = stored.tombstones && typeof stored.tombstones === 'object' ? stored.tombstones : {};
    desk.stacks = Array.isArray(stored.stacks) ? stored.stacks.filter(function (s) {
      return s && s.id;
    }).map(function (s) {
      return {
        id: s.id,
        name: s.name || '叠放',
        createdAt: Number(s.createdAt) || 0,
        /* 名字最后修改时间：云端合并时用它判断谁的名字更新，避免刷新后被旧名字盖回 */
        updatedAt: Number(s.updatedAt) || 0,
        memberIds: Array.isArray(s.memberIds) ? s.memberIds.filter(Boolean) : [],
        panel: s.panel && typeof s.panel === 'object'
          ? { x: Number(s.panel.x) || 0, y: Number(s.panel.y) || 0, userSet: !!s.panel.userSet }
          : null
      };
    }) : [];
    desk.updatedAt = Number(stored.updatedAt) || 0;
    /* 旧的「叠放 (N)」是按文件夹存的，安全迁成 stacks：成员转进 memberIds，
       不删作品、不丢位置；迁移失败也不影响其它数据 */
    try { migrateStackFolders(); } catch (e) {}
    /* 恢复上次停留的桌面（每个文件夹桌面独立，刷新后回到同一个桌面） */
    view.activeFolder = stored.activeFolder && desk.folders.some(function (f) { return f.id === stored.activeFolder; })
      ? stored.activeFolder : null;
    view.activeStack = null;  /* 叠放改为桌面内浮窗，不再作为“进入某一层”的状态 */
  }

  /* 把旧文件夹语义的「叠放 (N)」迁到 desk.stacks；幂等，可重复执行 */
  function migrateStackFolders() {
    var migrated = 0;
    desk.folders = desk.folders.filter(function (f) {
      if (!/^叠放/.test(f.name || '')) return true;
      var ids = Object.keys(desk.assigns).filter(function (k) { return desk.assigns[k] === f.id; });
      /* 云端旧文件夹与本地已迁移的 stack 可能同 id（load 已迁过一次、pull 又拉回旧文件夹），
         此时只补成员，不再 push 第二个同 id 的 stack，避免渲染与同步出现重复项 */
      var existed = null;
      for (var i = 0; i < desk.stacks.length; i += 1) {
        if (desk.stacks[i].id === f.id) { existed = desk.stacks[i]; break; }
      }
      if (existed) {
        if (!Array.isArray(existed.memberIds)) existed.memberIds = [];
        ids.forEach(function (k) {
          if (existed.memberIds.indexOf(k) < 0) existed.memberIds.push(k);
        });
      } else {
        desk.stacks.push({
          id: f.id,
          name: f.name,
          createdAt: Number(f.createdAt) || Date.now(),
          memberIds: ids
        });
      }
      ids.forEach(function (k) { delete desk.assigns[k]; });
      migrated += 1;
      return false;
    });
    if (migrated) {
      desk.updatedAt = Date.now();
      try { persistNow(); } catch (e) {}
    }
  }

  var persistTimer = null;

  function payload() {
    return {
      folders: desk.folders,
      stacks: desk.stacks,
      positions: desk.positions,
      assigns: desk.assigns,
      names: desk.names,
      tombstones: desk.tombstones,
      activeFolder: view.activeFolder || null,
      activeStack: view.activeStack || null,
      updatedAt: desk.updatedAt
    };
  }

  function persistNow() {
    desk.updatedAt = Date.now();
    /* 本地只做展示缓存：改动先标记 pending，再拆成逐项 op 提交云端 */
    pendingLocal = true;
    try {
      localStorage.setItem(getDeskLsKey(), JSON.stringify(payload()));
    } catch (err) {
      /* 存储空间不足时静默失败 */
    }
    if (!api || !api.online) return;
    if (api.deskOps) {
      /* 云端权威：/desk/ops 逐项落库；还没有云端基线时先拉一次，再在该版本上重放本地改动 */
      if (lastCloud) flushOps();
      else syncServer();
      return;
    }
    /* 旧后端没有逐项接口时才整包写，服务端 mergeAndSave 会兜底合并，不会抹掉别的设备的数据 */
    if (api.saveDesk) {
      api.saveDesk(payload()).then(function (r) {
        if (r && r.rev != null) setSyncMeta(r.rev, r.updatedAt);
        pendingLocal = false;
      }).catch(function () {});
    }
  }

  function persistSoon() {
    if (persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistNow();
    }, 260);
  }

  /* ---------------- 云端合并 ----------------
     旧实现是整包「谁 updatedAt 大听谁的」：另一台设备只要本地改动过（或时钟偏快），
     拉取时判成云端更旧，就不拉、还把自己的整包推上去，两个设备从此各看各的。
     这里改成按文件夹 id 合并 + 删除墓碑，新建/重命名/移动/删除四种操作都能收敛。 */
  function folderTs(f) {
    return Number(f && f.updatedAt) || Number(f && f.createdAt) || 0;
  }

  function mergeDesk(remote) {
    if (!remote || !Array.isArray(remote.folders)) return false;
    var changed = false;
    var remoteFolders = {};
    remote.folders.forEach(function (f) {
      if (f && f.id && f.name) remoteFolders[f.id] = f;
    });
    var tombstones = Object.assign({}, desk.tombstones || {});
    Object.keys(remote.tombstones || {}).forEach(function (k) {
      tombstones[k] = Math.max(Number(tombstones[k]) || 0, Number(remote.tombstones[k]) || 0);
    });
    var localIds = {};
    var merged = desk.folders.map(function (f) {
      localIds[f.id] = 1;
      var r = remoteFolders[f.id];
      if (r && folderTs(r) > folderTs(f)) {
        changed = true;
        return Object.assign({}, f, r, { parentId: r.parentId || null });
      }
      return f;
    });
    Object.keys(remoteFolders).forEach(function (id) {
      if (!localIds[id]) {
        var f = remoteFolders[id];
        f.parentId = f.parentId || null;
        f.createdAt = Number(f.createdAt) || 0;
        merged.push(f);
        changed = true;
      }
    });
    /* 同一文件夹在两台设备都删过 / 一台删过：墓碑时间不早于该文件夹最后修改时间，就不再出现 */
    var beforeLen = merged.length;
    merged = merged.filter(function (f) {
      var t = Number(tombstones[f.id]) || 0;
      return !(t && t >= folderTs(f));
    });
    if (merged.length !== beforeLen) changed = true;
    desk.folders = merged;

    /* 叠放：按 id 合并，成员取并集（删除走墓碑） */
    var stackMap = {};
    desk.stacks.forEach(function (s) { stackMap[s.id] = s; });
    (Array.isArray(remote.stacks) ? remote.stacks : []).forEach(function (rs) {
      if (!rs || !rs.id) return;
      var cur = stackMap[rs.id];
      if (!cur) {
        desk.stacks.push({
          id: rs.id,
          name: rs.name || '叠放',
          createdAt: Number(rs.createdAt) || 0,
          updatedAt: Number(rs.updatedAt) || 0,
          memberIds: Array.isArray(rs.memberIds) ? rs.memberIds.slice() : [],
          panel: rs.panel || null
        });
        changed = true;
        return;
      }
      /* 名字按最后修改时间取新：重命名后刷新/多端同步都不会被旧名字盖回 */
      var rTs = Number(rs.updatedAt) || 0;
      var lTs = Number(cur.updatedAt) || 0;
      if (rTs > lTs && rs.name) {
        cur.name = rs.name;
        cur.updatedAt = rTs;
        changed = true;
      }
      if (!Array.isArray(cur.memberIds)) cur.memberIds = [];
      (rs.memberIds || []).forEach(function (id) {
        if (cur.memberIds.indexOf(id) < 0) { cur.memberIds.push(id); changed = true; }
      });
    });
    var stackBefore = desk.stacks.length;
    desk.stacks = desk.stacks.filter(function (s) {
      var t = Number(tombstones[s.id]) || 0;
      return !(t && t >= Number(s.createdAt || 0));
    });
    if (desk.stacks.length !== stackBefore) changed = true;

    /* 作品归属 / 命名 / 位置：本地已有的值优先，缺的从云端补 */
    ['assigns', 'names', 'positions'].forEach(function (k) {
      var src = remote[k] || {};
      if (!desk[k] || typeof desk[k] !== 'object') desk[k] = {};
      Object.keys(src).forEach(function (key) {
        if (desk[k][key] === undefined || desk[k][key] === null || desk[k][key] === '') {
          desk[k][key] = src[key];
          changed = true;
        }
      });
    });

    desk.tombstones = tombstones;
    /* 作品归属墓碑 a:<workId>：只有「仍带该归属的文档」比墓碑旧时才移除，
       避免把删除后重新归入文件夹的作品又踢回桌面 */
    var remoteAssigns = remote.assigns || {};
    var remoteDocTs = Number(remote.updatedAt) || 0;
    var localDocTs = Number(desk.updatedAt) || 0;
    Object.keys(desk.assigns).forEach(function (wid) {
      var t = Number(tombstones['a:' + wid]) || 0;
      if (!t) return;
      var ownerTs = 0;
      if (Object.prototype.hasOwnProperty.call(desk.assigns, wid)) ownerTs = Math.max(ownerTs, localDocTs);
      if (Object.prototype.hasOwnProperty.call(remoteAssigns, wid)) ownerTs = Math.max(ownerTs, remoteDocTs);
      if (t > ownerTs) { delete desk.assigns[wid]; changed = true; }
    });
    if (view.activeFolder && !desk.folders.some(function (f) { return f.id === view.activeFolder; })) {
      view.activeFolder = null;
    }
    return changed;
  }

  function saveLocalNow() {
    try { localStorage.setItem(getDeskLsKey(), JSON.stringify(payload())); } catch (err) {}
  }

  /* 云端缺、本地有的文件夹/叠放数量。旧逻辑只在「本地被云端补到了东西」时才回写，
     于是被别的设备旧快照覆盖掉的文件夹永远补不回云端，两台电脑各看各的。
     这里把「本地独有」也算作需要回写的情况，用于修复已经分裂的数据。 */
  function localOnlyCount(remote) {
    if (!remote || typeof remote !== 'object') return 0;
    var ids = Object.create(null);
    var stackIds = Object.create(null);
    (Array.isArray(remote.folders) ? remote.folders : []).forEach(function (f) {
      if (f && f.id) ids[f.id] = 1;
    });
    (Array.isArray(remote.stacks) ? remote.stacks : []).forEach(function (s) {
      if (s && s.id) stackIds[s.id] = 1;
    });
    var n = 0;
    desk.folders.forEach(function (f) { if (f && f.id && !ids[f.id]) n += 1; });
    desk.stacks.forEach(function (s) { if (s && s.id && !stackIds[s.id]) n += 1; });
    return n;
  }

  /* ---------------- 云端权威同步 ----------------
     · 云端 desk 是唯一权威：进入页面 / 切回前台 / rev 变化 → 拉全量覆盖本地缓存
     · 本地只做展示缓存；用户改动拆成逐项 op（POST /desk/ops）提交，不再整包写
     · 有未确认操作时先记 pendingLocal，拿到新 rev 后在云端版本上重放，避免互相覆盖
     · 轻量探测 /desk/rev：可见时 9s 一次，ETag/304；隐藏不探测 */
  var syncMeta = { rev: null, etag: null, lastPoll: 0, polling: false, timer: null };
  var lastCloud = null;      /* 最近一次云端返回的 desk（权威快照） */
  var pendingLocal = false;  /* 本地有尚未确认写入的改动 */
  var flushState = { sending: false, again: false };

  function cloneDoc(v) {
    try { return v == null ? v : JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  function setSyncMeta(rev, updatedAt) {
    if (rev == null) return;
    syncMeta.rev = Number(rev) || 0;
    syncMeta.etag = '"' + syncMeta.rev + '-' + (Number(updatedAt) || 0) + '"';
  }

  /* 用云端文档替换本地展示缓存 */
  function adoptCloudDoc(doc) {
    if (!doc || typeof doc !== 'object') return;
    lastCloud = cloneDoc(doc);
    desk.folders = Array.isArray(doc.folders) ? cloneDoc(doc.folders) : [];
    desk.stacks = Array.isArray(doc.stacks) ? cloneDoc(doc.stacks) : [];
    desk.positions = cloneDoc(doc.positions) || {};
    desk.assigns = cloneDoc(doc.assigns) || {};
    desk.names = cloneDoc(doc.names) || {};
    desk.tombstones = cloneDoc(doc.tombstones) || {};
    desk.updatedAt = Number(doc.updatedAt) || Date.now();
    if (view.activeFolder) {
      var still = false;
      for (var i = 0; i < desk.folders.length; i += 1) {
        if (desk.folders[i] && desk.folders[i].id === view.activeFolder) { still = true; break; }
      }
      if (!still) view.activeFolder = null;
    }
    if (view.activeStack) {
      var hasStack = false;
      for (var j = 0; j < desk.stacks.length; j += 1) {
        if (desk.stacks[j] && desk.stacks[j].id === view.activeStack) { hasStack = true; break; }
      }
      if (!hasStack) view.activeStack = null;
    }
    pendingLocal = false;
    saveLocalNow();
    /* 云端可能还带着旧版「叠放 (N)」文件夹（旧客户端写进来的）：
       立刻迁成 stacks，迁移结果会作为逐项 op 提交，避免叠放被当成普通文件夹平铺 */
    try { migrateStackFolders(); } catch (e) {}
    renderAll();
  }

  function sameMembers(a, b) { return (a || []).join(',') === (b || []).join(','); }

  /* 本地→云端的逐项差异（新建/改名/移动/删除/归入/移出/位置），不整包 */
  function buildOps(prev, next) {
    var ops = [];
    if (!prev || !next) return ops;
    var pf = {}, nf = {}, ps = {}, ns = {};
    (prev.folders || []).forEach(function (f) { if (f && f.id) pf[f.id] = f; });
    (next.folders || []).forEach(function (f) { if (f && f.id) nf[f.id] = f; });
    (prev.stacks || []).forEach(function (s) { if (s && s.id) ps[s.id] = s; });
    (next.stacks || []).forEach(function (s) { if (s && s.id) ns[s.id] = s; });
    var tombs = next.tombstones || {};

    Object.keys(nf).forEach(function (id) {
      var a = pf[id], b = nf[id];
      if (!a) { ops.push({ type: 'folder.add', folder: b }); return; }
      if (a.name !== b.name || (a.parentId || null) !== (b.parentId || null) || (a.mode || '') !== (b.mode || '')) {
        ops.push({
          type: 'folder.update', id: id,
          patch: { name: b.name, parentId: b.parentId || null, mode: b.mode, updatedAt: Number(b.updatedAt) || Date.now() }
        });
      }
    });
    Object.keys(pf).forEach(function (id) {
      if (!nf[id]) ops.push({ type: 'folder.delete', id: id, ts: Number(tombs[id]) || Date.now() });
    });

    Object.keys(ns).forEach(function (id) {
      var a = ps[id], b = ns[id];
      if (!a) { ops.push({ type: 'stack.add', stack: b }); return; }
      var patch = {};
      if ((a.name || '') !== (b.name || '')) patch.name = b.name;
      if (!sameMembers(a.memberIds, b.memberIds)) patch.memberIds = b.memberIds || [];
      if (patch.name !== undefined || patch.memberIds !== undefined) {
        patch.updatedAt = Number(b.updatedAt) || Date.now();
        ops.push({ type: 'stack.update', id: id, patch: patch });
      }
    });
    Object.keys(ps).forEach(function (id) {
      if (!ns[id]) ops.push({ type: 'stack.delete', id: id, ts: Number(tombs[id]) || Date.now() });
    });

    var pa = prev.assigns || {}, na = next.assigns || {};
    Object.keys(na).forEach(function (wid) {
      if (!pa[wid] || pa[wid] !== na[wid]) ops.push({ type: 'assign.set', workId: wid, folderId: na[wid] });
    });
    Object.keys(pa).forEach(function (wid) {
      if (!na[wid]) ops.push({ type: 'assign.del', workId: wid, ts: Number(tombs['a:' + wid]) || Date.now() });
    });

    var pn = prev.names || {}, nn = next.names || {};
    Object.keys(nn).forEach(function (wid) {
      if (pn[wid] !== nn[wid]) ops.push({ type: 'name.set', workId: wid, name: nn[wid] });
    });
    Object.keys(pn).forEach(function (wid) {
      if (nn[wid] === undefined) ops.push({ type: 'name.del', workId: wid });
    });

    var pp = prev.positions || {}, np = next.positions || {};
    Object.keys(np).forEach(function (wid) {
      if (JSON.stringify(pp[wid]) !== JSON.stringify(np[wid])) {
        ops.push({ type: 'position.set', workId: wid, position: np[wid] });
      }
    });
    Object.keys(pp).forEach(function (wid) {
      if (np[wid] === undefined) ops.push({ type: 'position.del', workId: wid });
    });

    return ops;
  }

  function flushOps() {
    if (!lastCloud || !api || !api.deskOps) return;
    if (flushState.sending) { flushState.again = true; return; }
    var ops = buildOps(lastCloud, payload());
    if (!ops.length) { pendingLocal = false; return; }
    /* 服务端单次最多应用 2000 条；这里按 300 条分批，剩下的在成功返回后继续 diff */
    var batch = ops.slice(0, 300);
    flushState.sending = true;
    flushState.again = false;
    api.deskOps(batch, syncMeta.rev).then(function (r) {
      flushState.sending = false;
      if (!r) return;
      var doc = r.desk || (r.doc && r.doc.data);
      if (r.rev != null) setSyncMeta(r.rev, r.updatedAt);
      if (doc) lastCloud = cloneDoc(doc);
      pendingLocal = false;
      if (flushState.again || (doc && buildOps(doc, payload()).length)) { flushOps(); return; }
      if (doc) adoptCloudDoc(doc);
    }).catch(function (err) {
      flushState.sending = false;
      if (err && Number(err.status) === 409 && err.data && err.data.desk) {
        /* 别的设备先写了：以它的版本为新基线，把本地操作重放上去 */
        lastCloud = cloneDoc(err.data.desk);
        if (err.data.rev != null) setSyncMeta(err.data.rev, err.data.updatedAt);
        flushOps();
        return;
      }
      /* 网络失败：保留本地缓存，等下一次改动/探测再试 */
    });
  }

  /* 拉到云端全量：没有待确认操作就直接覆盖本地；有就先重放再说 */
  function applyCloud(doc) {
    if (!doc) return false;
    lastCloud = cloneDoc(doc);
    if (pendingLocal) { flushOps(); return true; }
    /* 云端压根没有桌面文档（新账号/旧库为空）而本地缓存有内容：
       本地是唯一来源，先回写云端，避免「第一次拉取就被空文档清空」 */
    var cloudEmpty = !(Array.isArray(doc.folders) && doc.folders.length) &&
      !(Array.isArray(doc.stacks) && doc.stacks.length);
    var noTomb = !doc.tombstones || !Object.keys(doc.tombstones).length;
    if (cloudEmpty && noTomb && (desk.folders.length || desk.stacks.length || Object.keys(desk.assigns).length)) {
      pendingLocal = true;
      flushOps();
      return true;
    }
    adoptCloudDoc(doc);
    return true;
  }

  function pollDeskRev(force) {
    if (!api || !api.online || !api.getDeskRev) {
      if (force) syncServer();
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (syncMeta.polling) return;
    var now = Date.now();
    if (!force && now - syncMeta.lastPoll < 8500) return;
    syncMeta.lastPoll = now;
    syncMeta.polling = true;
    api.getDeskRev(syncMeta.etag).then(function (r) {
      syncMeta.polling = false;
      if (!r || r.notModified) return;
      var rev = Number(r.rev) || 0;
      var differs = syncMeta.rev == null || rev !== syncMeta.rev;
      setSyncMeta(rev, r.updatedAt);
      if (differs) syncServer();
    }).catch(function () { syncMeta.polling = false; });
  }

  function startRealtimeSync() {
    if (syncMeta.timer) return;
    syncMeta.timer = setInterval(pollDeskRev, 9000);
  }

  /* 换账号/登出时必须清掉同步游标：否则会把上一个账号的云端快照当成基线，
     用新账号的本地状态去和它做 diff，甚至把 op 写到新账号名下 */
  function resetSyncState() {
    syncMeta.rev = null;
    syncMeta.etag = null;
    syncMeta.lastPoll = 0;
    lastCloud = null;
    pendingLocal = false;
    flushState.sending = false;
    flushState.again = false;
  }

  function syncServer() {
    if (!api || !api.online || !api.getDesk) return;
    api.getDesk().then(function (d) {
      if (!d || typeof d !== 'object') return;
      var remote = d.desk || d;
      if (!remote || !Array.isArray(remote.folders)) return;
      if (d.rev != null) setSyncMeta(d.rev, d.updatedAt);
      applyCloud(remote);
    }).catch(function () {});
  }

  /* 测试生图补录：每个会话只跑一次。只新增作品，不动文件夹/叠放/归属/位置；
     补录成功后重新拉一次云端数据，新图立刻出现在桌面根层（自动紧凑排到空位）。 */
  var deskBackfillDone = false;
  function runDeskBackfill() {
    if (deskBackfillDone || !api || !api.backfillDesk) return;
    deskBackfillDone = true;
    api.backfillDesk().then(function (r) {
      if (!r || !r.added) return;
      if (window.HMSync && window.HMSync.pullDocs) window.HMSync.pullDocs().catch(function () {});
      if (window.HMApp && window.HMApp.toast) {
        window.HMApp.toast('已把 ' + r.added + ' 张测试图补进桌面', 'ok', 4000);
      }
    }).catch(function () {});
  }

  /* 登录即见：以云端为准拉取；返回是否拿到云端文档 */
  function pullNow() {
    if (!api || !api.online || !api.getDesk) return Promise.resolve(false);
    /* 换账号时内存里的布局可能还属于上一个 uid：先跳过，等 reloadForUser 按新 uid 重载后再拉 */
    var uidNow = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    if (String(deskUid) !== String(uidNow)) return Promise.resolve(false);
    return api.getDesk().then(function (d) {
      if (!d || typeof d !== 'object') return false;
      var remote = d.desk || d;
      if (!remote || !Array.isArray(remote.folders)) return false;
      if (d.rev != null) setSyncMeta(d.rev, d.updatedAt);
      runDeskBackfill();
      return applyCloud(remote);
    }).catch(function () { return false; });
  }

  /* 认领历史桌面（旧 uid 键 / guest 键）：只补当前缺失的文件夹与位置，
     绝不覆盖现有布局；空桌面不会被空数据盖掉。返回新增条目数。 */
  function claimLegacy(item) {
    if (!item || typeof item !== 'object') return 0;
    /* 内存布局不属于当前账号时不合并，避免串号 */
    var uidNow = (window.HMApp && window.HMApp.user && window.HMApp.user.id) || '';
    if (String(deskUid) !== String(uidNow)) return 0;
    var added = 0;
    var haveId = Object.create(null);
    var haveName = Object.create(null);
    desk.folders.forEach(function (f) {
      haveId[f.id] = 1;
      haveName[String(f.parentId || '') + '|' + String(f.name || '')] = 1;
    });
    (Array.isArray(item.folders) ? item.folders : []).forEach(function (f) {
      if (!f || !f.id || !f.name) return;
      var sig = String(f.parentId || '') + '|' + String(f.name || '');
      if (haveId[f.id] || haveName[sig]) return;
      /* 整条复制（含 mode 等扩展字段），避免把叠放降级成普通文件夹 */
      desk.folders.push(Object.assign({}, f, {
        id: f.id,
        name: f.name,
        parentId: f.parentId || null,
        createdAt: Number(f.createdAt) || 0
      }));
      haveId[f.id] = 1;
      haveName[sig] = 1;
      added += 1;
    });
    /* 旧键里若已有 stacks（新版叠放），按 id 合并成员，避免认领时丢掉叠放 */
    (Array.isArray(item.stacks) ? item.stacks : []).forEach(function (s) {
      if (!s || !s.id) return;
      var cur = null;
      for (var si = 0; si < desk.stacks.length; si += 1) {
        if (desk.stacks[si].id === s.id) { cur = desk.stacks[si]; break; }
      }
      if (!cur) {
        desk.stacks.push(Object.assign({}, s, {
          id: s.id,
          name: s.name || '叠放',
          createdAt: Number(s.createdAt) || 0,
          memberIds: Array.isArray(s.memberIds) ? s.memberIds.slice() : []
        }));
        added += 1;
        return;
      }
      if (!Array.isArray(cur.memberIds)) cur.memberIds = [];
      (s.memberIds || []).forEach(function (m) {
        if (m && cur.memberIds.indexOf(m) < 0) { cur.memberIds.push(m); added += 1; }
      });
    });
    ['positions', 'assigns', 'names'].forEach(function (k) {
      var src = item[k];
      if (!src || typeof src !== 'object') return;
      if (!desk[k] || typeof desk[k] !== 'object') desk[k] = {};
      Object.keys(src).forEach(function (key) {
        var cur = desk[k][key];
        if (cur === undefined || cur === null || cur === '') {
          desk[k][key] = src[key];
          added += 1;
        }
      });
    });
    if (added) {
      desk.updatedAt = Math.max(Number(desk.updatedAt) || 0, Number(item.updatedAt) || 0, Date.now());
      try { localStorage.setItem(getDeskLsKey(), JSON.stringify(payload())); } catch (err) {}
      renderAll();
      /* 云端权威：认领结果算本地改动，走逐项 op 提交，不再整包写 */
      pendingLocal = true;
      if (api && api.online) {
        if (api.deskOps) {
          if (lastCloud) flushOps();
          else syncServer();
        } else if (api.saveDesk) {
          api.saveDesk(payload()).catch(function () {});
        }
      }
      console.log('[HMDesk] 已认领历史桌面条目', added, '项');
    }
    return added;
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
    if (work.failed || work.ok === false) {
      return '<div class="' + cls + ' is-failed"><b>!</b><small>生成失败</small></div>';
    }
    if (work.type === 'video') {
      return '<div class="' + cls + ' is-video"><video src="' + url + '" muted playsinline preload="metadata"></video><span class="media-play">▶</span></div>';
    }
    if (work.type === 'audio') {
      return '<div class="' + cls + ' is-audio"><span>♪</span><small>音频</small></div>';
    }
    /* 历史记录封面：优先小图 thumb，懒加载；加载失败时退回中性占位，不出现裂图 */
    if (mode === 'history') {
      return '<div class="' + cls + '">' +
        '<img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy" decoding="async" draggable="false"' +
        ' onerror="this.style.display=\'none\';this.parentNode.classList.add(\'is-missing\')">' +
        '</div>';
    }
    return '<div class="' + cls + '"><img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy" draggable="false"></div>';
  }

  function folderOf(id) {
    return desk.assigns[id] || null;
  }

  /* 作品「移出文件夹 / 删除」时写归属墓碑：多端合并时删除才不会被另一台设备补回来 */
  function unassign(wid) {
    if (!wid) return;
    delete desk.assigns[wid];
    if (!desk.tombstones || typeof desk.tombstones !== 'object') desk.tombstones = {};
    desk.tombstones['a:' + wid] = Date.now();
  }

  function folderName(id) {
    var f = desk.folders.find(function (x) { return x.id === id; });
    return f ? f.name : '个人空间';
  }

  /* 顶栏显示当前所在项目文件夹名：根桌面显示「个人空间」，进入文件夹显示文件夹名 */
  function syncFolderNow() {
    var el = byId('hmFolderNowName');
    if (!el) return;
    var name = view.activeFolder ? folderName(view.activeFolder) : '个人空间';
    if (el.textContent !== name) el.textContent = name;
    var box = byId('hmFolderNow');
    if (box) box.title = '当前项目文件夹：' + name;
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
    folder.updatedAt = Date.now();
    persistNow();
    return true;
  }

  /* 把多个 work 从一个 folder 移到另一个 folder（或根目录 targetFolder=null） */
  function moveWorksFolder(workIds, targetFolderId) {
    workIds.forEach(function (wid) {
      if (targetFolderId) desk.assigns[wid] = targetFolderId;
      else unassign(wid);
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

    html += '<div class="' + classes.join(' ') + '" draggable="false" droppable="true"' +
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
    /* 新建入口跟随当前所在位置：选中了某个项目/文件夹就建它的子文件夹，否则建在根目录 */
    var curFolder = view.activeFolder ? desk.folders.find(function (f) { return f.id === view.activeFolder; }) : null;
    html += '<button class="hm-proj-row is-new" data-proj="new">' +
      '<span class="hm-proj-ico">＋</span><span class="hm-proj-txt"><strong>' + (curFolder ? '新建子文件夹' : '新建文件夹') + '</strong><small>' +
      (curFolder ? '在「' + esc(curFolder.name) + '」下新建' : '在根目录创建新项目') + '</small></span>' +
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
    if (!inline) { renderPanel(); return; }
    if (inline.isNew) {
      /* 名称为空/只有空格 → 用默认名，同级重名顺延，绝不覆盖已有文件夹 */
      var parentId = inline.parentId || null;
      var siblings = desk.folders.filter(function (f) { return (f.parentId || null) === parentId; });
      var names = siblings.map(function (f) { return f.name; });
      var base = value || '新建文件夹';
      var name = base;
      var idx = 2;
      while (names.indexOf(name) >= 0) { name = base + ' ' + idx; idx++; }
      var folder = { id: 'f' + A.uid(), name: name, parentId: parentId, createdAt: Date.now(), updatedAt: Date.now() };
      desk.folders.unshift(folder);
      if (parentId) view.expanded[parentId] = true;
      persistNow();
      A.toast('已创建文件夹「' + name + '」', 'success');
    } else {
      /* 重命名：空名字视为取消，不把已有文件夹改成空名 */
      if (!value) { renderPanel(); return; }
      var target = desk.folders.find(function (f) { return f.id === inline.rowId; });
      if (target) {
        target.name = value;
        target.updatedAt = Date.now();
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
      /* 输入为空 → 用默认名；重名 → 同级顺延，绝不覆盖 */
      var base = String(value || '').trim() || '新建文件夹';
      var finalName = base;
      var dup = 2;
      while (names.indexOf(finalName) >= 0) { finalName = base + ' ' + dup; dup++; }
      var folder = { id: 'f' + A.uid(), name: finalName, parentId: parentId || null, createdAt: Date.now(), updatedAt: Date.now() };
      desk.folders.unshift(folder);
      /* 自动展开父节点，让新子文件夹可见 */
      if (parentId) view.expanded[parentId] = true;
      persistNow();
      renderPanel();
      if (cb) cb(folder);
      A.toast('已创建文件夹「' + finalName + '」' + (parentName ? '（在「' + parentName + '」下）' : ''), 'success');
    });
  }

  function deleteFolder(id, silent) {
    var folder = desk.folders.find(function (f) { return f.id === id; });
    if (!folder) return;
    var descendantIds = collectDescendantIds(id);
    var totalWorks = 0;
    descendantIds.forEach(function (fid) {
      Object.keys(desk.assigns).forEach(function (wid) {
        if (desk.assigns[wid] === fid) { unassign(wid); totalWorks++; }
      });
    });
    if (!silent) {
      var msg = '删除文件夹「' + folder.name + '」？';
      if (descendantIds.length > 1) msg += '（包含 ' + (descendantIds.length - 1) + ' 个子文件夹，会一并删除）';
      msg += '\n只删除文件夹本身：其中 ' + totalWorks + ' 张图片会回到桌面（原位置附近），图片不会被删除。';
      if (!window.confirm(msg)) return;
    }
    desk.folders = desk.folders.filter(function (f) { return descendantIds.indexOf(f.id) < 0; });
    /* 记录删除墓碑：跨设备合并时不会把已删的文件夹（含子孙）再拉回来 */
    var delAt = Date.now();
    descendantIds.forEach(function (fid) { desk.tombstones[fid] = delAt; });
    if (view.activeFolder && descendantIds.indexOf(view.activeFolder) >= 0) view.activeFolder = folder.parentId || null;
    persistNow();
    renderAll();
    if (!silent) A.toast('已删除 ' + descendantIds.length + ' 个文件夹，' + totalWorks + ' 张图片回到桌面（图片未删除）', 'info');
  }

  /* ---------------- 桌面 ---------------- */
  function activeWorks() {
    var list = state.works.slice();
    if (view.activeStack) {
      var st = desk.stacks.find(function (s) { return s.id === view.activeStack; });
      var ids = st ? st.memberIds : [];
      return list.filter(function (w) { return ids.indexOf(w.id) >= 0; });
    }
    if (view.activeFolder) {
      /* 正在查看某个文件夹内部 */
      list = list.filter(function (w) { return desk.assigns[w.id] === view.activeFolder; });
    } else {
      /* 桌面根视图：只显示散落作品；已进文件夹或已叠放的不再单独出现 */
      var inStack = {};
      desk.stacks.forEach(function (s) { (s.memberIds || []).forEach(function (id) { inStack[id] = true; }); });
      list = list.filter(function (w) { return !desk.assigns[w.id] && !inStack[w.id]; });
    }
    return list;
  }

  /* 新生成的作品：如果当前正处在某个文件夹的桌面里，自动归入该文件夹 */
  function onWorkCreated(work) {
    if (!work || !work.id) return;
    if (view.activeStack) {
      var st = desk.stacks.find(function (s) { return s.id === view.activeStack; });
      if (st && st.memberIds.indexOf(work.id) < 0) {
        st.memberIds.push(work.id);
        delete desk.positions[work.id];
        persistSoon();
      }
      return;
    }
    if (!view.activeFolder) return;
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
    if (view.activeStack) return [];
    var parentId = view.activeFolder || null;
    return desk.folders.filter(function (f) {
      if (!f || !f.id) return false;
      if (f.id === view.activeFolder) return false;
      /* 个人空间（根桌面）不再只显示顶层文件夹：其他项目里的文件夹也要能出现，
         这样在个人空间就能直接进入别处建的项目文件夹；进入某文件夹后仍只显示它的直接子级 */
      if (parentId !== null && (f.parentId || null) !== parentId) return false;
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
    var size = deskCardSize(work);
    return '<article class="desk-card" data-work="' + esc(work.id) + '" data-type="' + esc(work.type || 'image') +
      '" style="width:' + size.w + 'px;height:' + size.h + 'px">' +
      deskCardHtmlInner(work) +
      '</article>';
  }

  function deskCardHtmlInner(work) {
    var name = workName(work);
    var isFailed = !!(work.failed || work.ok === false);
    /* 卡面只保留标题与耗时；AI 标识、风格名、尺寸等仍保留在作品数据里，只是不渲染 */
    var elapsedHtml = (work.elapsed && work.elapsed > 0)
      ? '<div class="desk-elapsed">耗时 ' + work.elapsed.toFixed(1) + 's</div>' : '';
    return '<div class="desk-thumb">' + mediaHtml(work, 'desk') +
            (isFailed ? '<span class="desk-badge">生成失败</span>' : '') + '</div>' +
      '<div class="desk-info"><strong>' + esc(name) + '</strong></div>' +
      elapsedHtml +
      '<span class="desk-check" aria-hidden="true"></span>';
  }

  /* 文件夹卡片 HTML：正方形，顶部缩略图网格 + 名称 + 数量角标 */
  function folderCardHtmlInner(folder) {
    var items = worksUnderFolder(folder.id);
    var subCount = desk.folders.filter(function (f) { return (f.parentId || null) === folder.id; }).length;
    var isStack = /^叠放/.test(folder.name || '');
    var assignedCount = 0;
    Object.keys(desk.assigns).forEach(function (k) { if (desk.assigns[k] === folder.id) assignedCount += 1; });
    var total = isStack ? Math.max(items.length, assignedCount) : items.length;
    var thumbs = items.slice(0, 4);
    var more = isStack ? total : Math.max(0, items.length - 4);
    var gridHtml = '';
    if (thumbs.length === 0) {
      gridHtml = '<div class="folder-grid-empty">📂</div>';
    } else if (thumbs.length === 1) {
      gridHtml = '<img src="' + esc(thumbs[0].thumb || thumbs[0].url || '') + '" data-fp="' + esc(thumbs[0].id) + '" class="folder-t" alt="">';
    } else {
      gridHtml = thumbs.map(function (w, i) {
        return '<img src="' + esc(w.thumb || w.url || '') + '" data-fp="' + esc(w.id) + '" class="folder-t folder-t-' + i + '" alt="">';
      }).join('');
    }
    var moreHtml = more > 0 ? '<span class="folder-more">' + (isStack ? more : '+' + more) + '</span>' : '';
    var meta = items.length + ' 项' + (subCount ? ' · ' + subCount + ' 个子文件夹' : '');
    return '<div class="folder-thumb">' + gridHtml + moreHtml + '</div>' +
      '<div class="folder-info"><strong>' + esc(folder.name) + '</strong><small>' + meta + '</small></div>' +
      '<span class="desk-check" aria-hidden="true"></span>';
  }

  /* 叠放卡片 HTML：与文件夹卡同构，但成员来自 stack.memberIds，不读 assigns */
  function stackCardHtmlInner(st) {
    var items = state.works.filter(function (w) { return st.memberIds.indexOf(w.id) >= 0; });
    var total = st.memberIds.length || items.length;
    var thumbs = items.slice(0, 4);
    var gridHtml = '';
    if (thumbs.length === 0) {
      gridHtml = '<div class="folder-grid-empty">▣</div>';
    } else if (thumbs.length === 1) {
      gridHtml = '<img src="' + esc(thumbs[0].thumb || thumbs[0].url || '') + '" class="folder-t" data-stack-fp="' + esc(thumbs[0].id) + '" alt="">';
    } else {
      gridHtml = thumbs.map(function (w, i) {
        return '<img src="' + esc(w.thumb || w.url || '') + '" class="folder-t folder-t-' + i + '" data-stack-fp="' + esc(w.id) + '" alt="">';
      }).join('');
    }
    return '<div class="folder-thumb">' + gridHtml +
      '<span class="folder-more">' + total + '</span></div>' +
      '<div class="folder-info"><strong>' + esc(st.name || '叠放') + '</strong><small>' + total + ' 项</small></div>' +
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
    syncFolderNow();
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

    /* ---------- 清理已完成/失败的 job 节点 ----------
       is-done（成功）→ 会被转成 desk-card 显示在桌面，这里清理掉
       is-loading（生成中）→ 保留
       is-error（失败）→ 保留，让用户看到具体报错并点"重试" */
    Array.prototype.forEach.call(grid.querySelectorAll('[data-job]'), function (node) {
      if (!node.classList.contains('is-loading') && !node.classList.contains('is-error')) {
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
    /* 用户定过位的叠放卡先占住网格位：作品卡排布时会让开，
       这样新建的叠放落在被拖入图片的位置时，其它图不会压到它身上 */
    if (!view.activeFolder && !view.activeStack) {
      desk.stacks.forEach(function (st0) {
        var sp = desk.positions[st0.id];
        if (sp && sp._userSet && typeof sp.pxLeft === 'number') {
          occupied.push({ left: sp.pxLeft, top: sp.pxTop });
        }
      });
    }
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
      var sz = deskCardSize(w);
      existing.style.width = sz.w + 'px';
      existing.style.height = sz.h + 'px';
      existing.classList.toggle('is-failed', !!(w.failed || w.ok === false));
      placeCard(existing, w.id, idx, grid, occupied);
      idx += 1;
    });

    /* ---------- 增量更新 folder-card（每一层桌面都显示本层文件夹） ---------- */
    var needFolderIds = {};
    folders.forEach(function (f) { needFolderIds[f.id] = true; });

    Array.prototype.forEach.call(grid.querySelectorAll('.folder-card'), function (node) {
      if (node.dataset.stack) return;
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
      existing.classList.toggle('is-stack', /^叠放/.test(f.name || ''));
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

    /* ---------- 叠放卡：只存在于桌面根层，不进项目列表 ---------- */
    var stacks = (!view.activeFolder && !view.activeStack) ? desk.stacks.slice() : [];
    var needStackIds = {};
    stacks.forEach(function (s) { needStackIds[s.id] = true; });
    Array.prototype.forEach.call(grid.querySelectorAll('.folder-card[data-stack]'), function (node) {
      if (!needStackIds[node.dataset.stack]) node.parentNode.removeChild(node);
    });
    stacks.forEach(function (s, si) {
      var existing = grid.querySelector('.folder-card[data-stack="' + s.id + '"]');
      if (!existing) {
        existing = document.createElement('article');
        existing.className = 'folder-card is-stack';
        existing.dataset.stack = s.id;
        existing.dataset.folder = s.id;
        grid.appendChild(existing);
      }
      existing.innerHTML = stackCardHtmlInner(s);
      var pos = desk.positions[s.id];
      if (!pos || !pos.pxLeft) {
        pos = nextFreeSlot(works.length + folders.length + si, grid, occupied);
        pos._userSet = false;
        desk.positions[s.id] = pos;
      }
      var left = typeof pos.pxLeft === 'number' ? pos.pxLeft : PAD;
      var top = typeof pos.pxTop === 'number' ? pos.pxTop : PAD;
      /* 从旧文件夹迁过来的叠放沿用了旧坐标，可能正好压在别的卡上：
         自动坐标（用户没手动定过）才让位到最近的空网格，用户拖过的位置保持不动 */
      if (!pos._userSet && overlapsAny(left, top, occupied)) {
        pos = nextFreeSlot(works.length + folders.length + si, grid, occupied);
        pos._userSet = false;
        desk.positions[s.id] = pos;
        left = pos.pxLeft;
        top = pos.pxTop;
      }
      existing.style.left = left + 'px';
      existing.style.top = top + 'px';
      existing.style.zIndex = String(pos.z || idx + 1);
      occupied.push({ left: left, top: top });
    });

    /* ---------- 原地处理 active 卡片（loading + error）：不再 removeChild + appendChild ----------
       loading（生成中）→ 保留，位置/样式由 desk 管理
       error（失败）→ 也保留，同样被 desk 管理位置/拖拽/框选，用户可删除/重试/整理 */
    var activeJobs = [];
    if (A && A.state && A.state.jobs) {
      A.state.jobs.forEach(function (j) {
        if (j.status === 'loading' || j.status === 'error') activeJobs.push(j);
      });
    }

    /* 清掉 DOM 中已不在 state 的 active job（不应存在但保险）
       is-done 会被转成 desk-card，is-desk-job 会被 markJobDone 去掉，不会走到这里 */
    Array.prototype.forEach.call(grid.querySelectorAll('.result-card.is-desk-job[data-job]'), function (node) {
      var still = activeJobs.some(function (j) { return j.id === node.dataset.job; });
      if (!still && node.parentNode) node.parentNode.removeChild(node);
    });

    activeJobs.forEach(function (job, i) {
      var id = job.id;
      /* 找 grid 中已存在的节点（可能是 createLoadingCard 刚 append 的，
         也可能是上次 renderDesktop 标记过的 is-desk-job，或是 markJobError 改成 error 的） */
      var existing = grid.querySelector('.result-card.is-desk-job[data-job="' + id + '"]')
                 || grid.querySelector('.result-card[data-job="' + id + '"]');
      if (!existing) {
        /* 极端兜底 */
        existing = document.createElement('article');
        existing.className = 'result-card ' + (job.status === 'error' ? 'is-error' : 'is-loading');
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
    var hasJobs = activeJobs.length > 0;
    if (empty) empty.style.display = (works.length || hasJobs) ? 'none' : 'flex';

    var hint = byId('deskHint');
    if (hint) hint.hidden = works.length < 1 && !hasJobs;

    syncSelection();

    /* 若用户一直在底部附近，自动滚到底部跟随最新生成的图 */
    var distFromBottom = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
    if (distFromBottom < 240) grid.scrollTop = grid.scrollHeight;

    /* 叠放浮窗是桌面里的常驻浮层：重排/增删后补回原位置，只有 ✕ 或组被移空才关闭 */
    if (!view.activeFolder) { try { renderOpenStackPanels(); } catch (e) {} }
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
    if (!uid) return false;
    var guestKey = 'anidream.desk.v1';
    var userKey = 'anidream.desk.v1.' + uid;
    if (guestKey === userKey) return false;
    var guest = null;
    try { guest = JSON.parse(localStorage.getItem(guestKey) || 'null'); } catch (e) { guest = null; }
    if (!guest || typeof guest !== 'object') return false;
    /* 仅当访客数据里有内容（文件夹或作品归属）时才迁移，避免空数据覆盖用户已有数据 */
    var hasGuestContent = (Array.isArray(guest.folders) && guest.folders.length > 0) ||
      (guest.assigns && Object.keys(guest.assigns).length > 0);
    if (!hasGuestContent) return false;
    var user = null;
    try { user = JSON.parse(localStorage.getItem(userKey) || 'null'); } catch (e) { user = null; }
    var hasUserContent = user && ((Array.isArray(user.folders) && user.folders.length > 0) ||
      (user.assigns && Object.keys(user.assigns).length > 0));
    if (hasUserContent) return false; /* 用户 key 已有内容，不覆盖 */
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
    return true;
  }

  /* 登录后：从当前用户的专属 key 重新加载桌面布局（切换账号时调用） */
  function reloadForUser() {
    /* 先把访客态下创建的文件夹迁移到用户专属 key，防止"刷新后文件夹消失" */
    var guestMigrated = migrateGuestToUser();
    resetSyncState();
    desk.folders = [];
    desk.stacks = [];
    desk.positions = {};
    desk.assigns = {};
    desk.names = {};
    desk.updatedAt = 0;
    view.activeFolder = null;
    view.activeStack = null;
    view.selected = {};
    load();
    /* 访客期新建的文件夹从没上过云：标记 pending，pullNow 拉回云端版本后重放成 op */
    if (guestMigrated) pendingLocal = true;
    renderAll();
    /* 登录即见：立即拉云端桌面（返回 Promise，供登录流程 await），不再延迟 800ms */
    return pullNow();
  }

  /* 登出时：清空桌面内存数据，避免下个账号看到上个账号的文件夹布局 */
  function resetForLogout() {
    resetSyncState();
    desk.folders = [];
    desk.stacks = [];
    desk.positions = {};
    desk.assigns = {};
    desk.names = {};
    desk.updatedAt = 0;
    deskUid = '';
    view.activeFolder = null;
    view.activeStack = null;
    view.selected = {};
    renderAll();
  }

  function tidy(silent) {
    var grid = byId('resultGrid');
    if (!grid) return;
    /* 每一层桌面：works + 本层 folders 合并紧凑排 */
    var works = activeWorks();
    works.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var items = works.map(function (w) { return { key: w.id, createdAt: w.createdAt || 0 }; });
    var folders = activeFolders();
    folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    items = items.concat(folders.map(function (f) { return { key: f.id, createdAt: f.createdAt || 0 }; }));
    /* 叠放卡也在桌面层，整理时一并排进网格，避免它们留在旧坐标上与别的卡重叠 */
    if (!view.activeFolder && !view.activeStack) {
      desk.stacks.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
        .forEach(function (s) { items.push({ key: s.id, createdAt: s.createdAt || 0 }); });
    }
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
    if (!silent) A.toast('已按时间紧凑整理（最早在顶）', 'success');
  }

  /* ---------------- 选择 ---------------- */
  function selectedIds() {
    var folderIds = {};
    activeFolders().forEach(function (f) { folderIds[f.id] = true; });
    /* 叠放卡只存在于桌面根层：它同样是可选中、可拖动的对象，
       若不计入这里，pointerdown 会因「选中集合为空」直接 return，叠放就永远拖不动 */
    if (!view.activeFolder) {
      desk.stacks.forEach(function (s) { folderIds[s.id] = true; });
    }
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
    lastPointerType = event.pointerType || 'mouse';
    suppressClick = false; /* 新手势开始，清掉上一次拖拽留下的吞点击标记 */
    if (event.button !== 0) return;
    var grid = byId('resultGrid');
    if (!grid || !grid.contains(event.target)) return;
    var card = event.target.closest('.desk-card[data-work], .result-card.is-desk-job[data-job], .folder-card[data-folder]');
    var cardW = cardWidth();
    var maxLeft = grid.clientWidth - cardW - 4;

    if (!card) {
      /* 空白处按下 → 框选。主题背景/装饰/纹理层都算空白：
         只要不是卡片本体、叠放浮窗或菜单，就允许起框，避免背景层吃掉鼠标事件 */
      if (event.target.closest('.folder-card[data-stack], .stack-panel, .desk-context-menu, .hm-menu, .desk-sel-bar')) return;
      /* 记录拖动前的基线选中：框经过再移开的卡片要回到这个状态，而不是一律清空 */
      var baseSel = {};
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        clearSelection();
      } else {
        Object.keys(view.selected).forEach(function (k) { if (view.selected[k]) baseSel[k] = true; });
      }
      var rect = grid.getBoundingClientRect();
      marquee = {
        startX: event.clientX - rect.left + grid.scrollLeft,
        startY: event.clientY - rect.top + grid.scrollTop,
        startClientX: event.clientX,
        startClientY: event.clientY,
        baseline: baseSel,
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

    /* 普通单击：按下即高亮（原来要等 pointerup/click 才切换，手感明显延迟）。
       选中态同步写入，拖动仍然沿用同一份选中集合，不影响拖动排序。 */
    var plainClick = !(event.ctrlKey || event.metaKey || event.shiftKey);
    if (!plainClick) toggleSelect(key);
    else if (!view.selected[key]) selectOnly(key);

    var ids = selectedIds();
    var pendingKey = null;
    if (plainClick && !view.selected[key] && ids.indexOf(key) < 0) {
      ids = [key];
      pendingKey = key;
    }
    if (!ids.length) return;

    /* 每次拖动都要真正压在已有卡片之上：z 计数在刷新后会回到 20，
       若不清到当前最大值，重开页面后再拖会被上次的高 z 卡片盖住 */
    var maxZ = view.z;
    Object.keys(desk.positions).forEach(function (k) {
      var z = Number(desk.positions[k] && desk.positions[k].z) || 0;
      if (z > maxZ) maxZ = z;
    });
    view.z = maxZ + 1;
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
      pendingKey: pendingKey,
      pointerId: event.pointerId
    };
    /* 文件夹卡：拖动按网格插入排序（其他卡让位）。作品卡与叠放卡保留自由拖动语义：
       叠放卡必须能放到桌面任意位置，不能像文件夹那样被网格插队吸附。 */
    if (card.classList.contains('folder-card') && !card.dataset.stack && items.length === 1 &&
        !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      var all = [], elMap = {}, draggedId = items[0].id;
      Array.prototype.forEach.call(grid.querySelectorAll('.desk-card[data-work], .folder-card[data-folder]'), function (el) {
        var id = el.dataset.stack || el.dataset.folder || el.dataset.work;
        if (!id) return;
        elMap[id] = el;
        all.push({ id: id, left: el.offsetLeft, top: el.offsetTop });
      });
      all.sort(function (a, b) {
        if (Math.abs(a.top - b.top) > CARD_H / 2) return a.top - b.top;
        return a.left - b.left;
      });
      drag.sortMode = true;
      drag.draggedId = draggedId;
      drag.draggedEl = items[0].el;
      drag.elMap = elMap;
      drag.orderIds = all.map(function (it) { return it.id; }).filter(function (id) { return id !== draggedId; });
      drag.sortIdx = null;
      drag.preview = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    /* 不在 pointerdown 里 preventDefault —— 会阻断后续的 click 事件（folder-card 弹窗等） */
  }

  /* 拖动判定阈值：小于该距离的位移视为「点击」，不保存位置、不标记 _userSet。
     触屏板/鼠标点击时手指的微小抖动很容易超过 4px，导致卡片被误拖并永久偏移，
     因此把阈值提高到 8px（常规桌面端 5-10px 区间）。 */
  var DRAG_THRESHOLD = 8;

  /* 半透明虚影：原卡留在桌面原位，跟手的是这张克隆出来的虚影 */
  function createRefGhost(srcEl) {
    if (!srcEl) return null;
    var ghost = srcEl.cloneNode(true);
    ghost.className = 'desk-card desk-ref-ghost';
    ghost.style.cssText = 'position:fixed;left:0;top:0;width:' + srcEl.offsetWidth +
      'px;height:' + srcEl.offsetHeight + 'px;margin:0;pointer-events:none;z-index:10030;' +
      'opacity:.55;transform:translate(-50%,-50%);';
    document.body.appendChild(ghost);
    return ghost;
  }

  /* 桌面卡片点击语义（单击选中 / 双击看大图）所需的两个模块级状态：
     lastPointerType —— 记录最后一次按下的输入类型，触屏保留「单击即看大图」；
     suppressClick  —— 拖动结束后置 true，吞掉松手时补发的那次 click。 */
  var lastPointerType = 'mouse';
  var suppressClick = false;

  /* 叠放卡移动时，它已打开的浮窗按拖动开始时的相对偏移一起移动；
     松手后把绝对坐标写回 stack.panel（原有位置字段），重渲染时沿用，不会跳回原位 */
  function followStackPanel(sid, item, left, top) {
    var panel = stackPanelEl(sid);
    if (!panel || !panel.parentNode) return;
    var st = desk.stacks.find(function (s) { return s.id === sid; });
    /* 用户手动拖过浮窗（userSet）：保持用户放的位置，不再被自动跟随覆盖 */
    if (st && st.panel && st.panel.userSet) return;
    if (!item.panelOff) {
      item.panelOff = {
        x: (parseFloat(panel.style.left) || 0) - (item.left || 0),
        y: (parseFloat(panel.style.top) || 0) - (item.top || 0)
      };
    }
    var px = Math.max(0, left + item.panelOff.x);
    var py = Math.max(0, top + item.panelOff.y);
    panel.style.left = px + 'px';
    panel.style.top = py + 'px';
    /* 跟随出来的坐标只标记 follow，不标记 userSet，后续仍可按「贴卡」重新吸附 */
    if (st) st.panel = { x: px, y: py, follow: true };
  }

  function onPointerMove(event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      /* 真正开始拖动时才把卡片补进选中（单击不会触发） */
      if (drag.pendingKey) {
        selectOnly(drag.pendingKey);
        drag.pendingKey = null;
      }
      /* 桌面内拖动就是普通移动：卡片跟手、可落在桌面任意位置。
         只有拖到「参考主体」区域上方时才切虚影（见下方 refHoverEl 分支），
         这样同一段拖拽可以中途切换，且非参考区永远能正常落位。 */
      try { event.preventDefault(); } catch (e) {}
    }
    drag.items.forEach(function (item) {
      if (!item.el) return;
      item.el.classList.add('is-dragging');
      if (drag.sortMode) return; /* 排序模式：位置由 applySortPreview 按网格给出 */
      /* 横向限死 rail 边缘，纵向允许无限向下（grid 自动滚动） */
      var left = Math.max(0, Math.min(drag.maxLeft, item.left + dx));
      var top = Math.max(-CARD_H, item.top + dy);
      item.nextLeft = left;
      item.nextTop = top;
      if (drag.ghostMode) return; /* 原作卡留在原位，只有虚影跟手 */
      item.el.style.left = left + 'px';
      item.el.style.top = top + 'px';
      var stackId = item.el.dataset && item.el.dataset.stack;
      if (stackId) followStackPanel(stackId, item, left, top);
    });
    if (drag.refGhost) {
      drag.refGhost.style.left = event.clientX + 'px';
      drag.refGhost.style.top = event.clientY + 'px';
    }
    if (drag.sortMode) applySortPreview(event);
    /* 拖到「参考主体」区域：作品卡已经是虚影模式，这里只负责高亮；
       文件夹/叠放卡仍沿用「进入参考区才切虚影」的旧逻辑 */
    var refHoverEl = byId('refDrop');
    if (refHoverEl && !refHoverEl.hidden) {
      var rr = refHoverEl.getBoundingClientRect();
      var overRef = event.clientX >= rr.left - 12 && event.clientX <= rr.right + 12 &&
                    event.clientY >= rr.top - 12 && event.clientY <= rr.bottom + 12;
      refHoverEl.classList.toggle('is-over', overRef);
      if (overRef && !drag.refGhost) {
        /* 只有「拖向参考主体」这一种意图才切虚影：
           原卡回原位只降不透明度，跟手的是半透明克隆 */
        drag.ghostMode = true;
        drag.items.forEach(function (item) {
          if (!item.el) return;
          if (item.left != null) { item.el.style.left = item.left + 'px'; item.el.style.top = item.top + 'px'; }
          item.el.classList.add('is-refsource');
        });
        var srcEl = drag.items[0] && drag.items[0].el;
        drag.refGhost = createRefGhost(srcEl);
        if (drag.refGhost) {
          drag.refGhost.style.left = event.clientX + 'px';
          drag.refGhost.style.top = event.clientY + 'px';
        }
      }
      if (drag.refGhost && !overRef) {
        /* 离开参考区：撤掉虚影，卡片立刻回到跟手位置，继续普通拖动 */
        drag.refGhost.remove();
        drag.refGhost = null;
        drag.ghostMode = false;
        drag.items.forEach(function (item) {
          if (!item.el) return;
          item.el.classList.remove('is-refsource');
          if (typeof item.nextLeft === 'number') {
            item.el.style.left = item.nextLeft + 'px';
            item.el.style.top = item.nextTop + 'px';
          }
        });
      }
      if (drag.refGhost && overRef) {
        if (event.cancelable) event.preventDefault();
        return; /* 参考区拖拽期间不参与排序 */
      }
    }
    /* 拖动时让 grid 自动跟随滚动
       注意：只能在卡片贴近可见区域边缘时才滚动，否则会出现「点一下上面的图，
       滚动条却往下跑」的问题。之前用 visibleBottom - CARD_H - 40 做阈值，
       卡片高度 240px，导致几乎所有卡片的下移拖动都触发向下滚动。
       现在改为：卡片顶部距可见顶部 < 30px 才上滚，卡片底部距可见底部 < 30px 才下滚。 */
    var grid = byId('resultGrid');
    if (grid && drag.items[0] && !drag.sortMode) {
      var t = drag.items[0].nextTop;
      var b = t + CARD_H;
      var visibleTop = grid.scrollTop;
      var visibleBottom = visibleTop + grid.clientHeight;
      if (t < visibleTop + 30) grid.scrollTop = Math.max(0, t - 60);
      else if (b > visibleBottom - 30) grid.scrollTop = Math.min(grid.scrollHeight, b - grid.clientHeight + 60);
    }
  }

  /* 文件夹/叠放卡拖动时的插入排序预览：按指针所在网格位算出插入下标，
     其余卡片实时让位；松手时由 onPointerUp 把这套位置写回 desk.positions。 */
  function applySortPreview(event) {
    if (!drag || !drag.sortMode) return;
    var grid = byId('resultGrid');
    if (!grid) return;
    var rect = grid.getBoundingClientRect();
    var px = event.clientX - rect.left;
    var py = event.clientY - rect.top + grid.scrollTop;
    var cardW = cardWidth();
    var cols = Math.max(1, Math.floor((grid.clientWidth - PAD * 2 + GAP) / (cardW + GAP)));
    var col = Math.max(0, Math.min(cols - 1, Math.floor((px - PAD) / (cardW + GAP))));
    var row = Math.max(0, Math.floor((py - PAD) / (CARD_H + GAP)));
    var idx = Math.max(0, Math.min(drag.orderIds.length, row * cols + col));
    if (idx === drag.sortIdx) return;
    drag.sortIdx = idx;
    var order = drag.orderIds.slice();
    order.splice(idx, 0, drag.draggedId);
    var preview = {};
    order.forEach(function (id, i) {
      var slot = compactSlot(i, grid);
      preview[id] = slot;
      var el = id === drag.draggedId ? drag.draggedEl : drag.elMap[id];
      if (!el) return;
      el.style.left = slot.pxLeft + 'px';
      el.style.top = slot.pxTop + 'px';
    });
    drag.preview = preview;
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
    /* 实时判断哪些卡片被框住：用视口坐标下的实际可见矩形做「相交即中」，
       含主题缩放/transform 后的真实尺寸，四个方向拖动都一样 */
    var vx1 = Math.min(marquee.startClientX, event.clientX);
    var vy1 = Math.min(marquee.startClientY, event.clientY);
    var vx2 = Math.max(marquee.startClientX, event.clientX);
    var vy2 = Math.max(marquee.startClientY, event.clientY);
    var allCards = grid.querySelectorAll('.desk-card, .folder-card, .result-card.is-desk-job[data-job]');
    allCards.forEach(function (c) {
      /* 叠放浮窗里的图片不参与框选 */
      if (c.closest('.stack-panel')) return;
      var cr = c.getBoundingClientRect();
      var hit = cr.left < vx2 && cr.right > vx1 && cr.top < vy2 && cr.bottom > vy1;
      var k = c.hasAttribute('data-job') ? 'job:' + c.dataset.job : (c.classList.contains('folder-card') ? c.dataset.folder : c.dataset.work);
      if (hit) {
        view.selected[k] = true;
        c.classList.add('is-selected');
      } else if (marquee.baseline && marquee.baseline[k]) {
        /* 拖动前就选中的卡片：框移开也保持选中 */
        view.selected[k] = true;
        c.classList.add('is-selected');
      } else {
        delete view.selected[k];
        c.classList.remove('is-selected');
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
    if (current.refGhost) {
      current.refGhost.remove();
      current.items.forEach(function (item) { if (item.el) item.el.classList.remove('is-refsource'); });
    }
    var merged = false;
    /* 真正拖动过：松手后浏览器可能补发一次 click（选中/看大图），这里标记吞掉 */
    if (current.moved) suppressClick = true;

    /* 文件夹/叠放卡：松手即插入排序，落点决定顺序；位置写回桌面数据并同步 */
    if (current.sortMode) {
      current.items.forEach(function (item) {
        if (item.el) item.el.classList.remove('is-dragging');
      });
      if (current.moved && current.preview) {
        Object.keys(current.preview).forEach(function (id) {
          var slot = current.preview[id];
          var pos = desk.positions[id] || {};
          pos.pxLeft = slot.pxLeft;
          pos.pxTop = slot.pxTop;
          pos._userSet = true;
          desk.positions[id] = pos;
        });
        persistNow();
        renderDesktop();
        /* 移动结束后焦点落在这张叠放上：选中态、键盘删除、后续右键都作用于它 */
        selectOnly(current.draggedId);
      }
      return;
    }

    /* 叠放卡：自由拖到桌面任意位置，松手即写回坐标并同步；
       不参与文件夹/图片的合并与网格排序，避免被任何目标卡「吸」回去。 */
    var stackOnlyId = '';
    if (current.items.length === 1 && current.items[0].el && current.items[0].el.dataset.stack) {
      stackOnlyId = current.items[0].el.dataset.stack;
    }
    if (stackOnlyId) {
      current.items.forEach(function (item) {
        if (item.el) item.el.classList.remove('is-dragging');
      });
      if (current.moved) {
        current.items.forEach(function (item) {
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
        persistNow();
        renderDesktop();
        /* 移动结束后焦点落在被移动的叠放上：选中态、键盘操作、右键都作用于它 */
        selectOnly(stackOnlyId);
      }
      return;
    }

    /* 桌面图片拖到「参考主体」区域松手：作为参考主体填入（与手动上传同一条通路），
       并把卡片位置还原，避免顺手改掉桌面布局 */
    if (current.moved && event) {
      var refDropEl = byId('refDrop');
      if (refDropEl && !refDropEl.hidden) {
        var refRect = refDropEl.getBoundingClientRect();
        /* 12px 容差：松手时手指/光标常常差几个像素，严格边界会让用户以为「拖不进去」 */
        var overRef = event.clientX >= refRect.left - 12 && event.clientX <= refRect.right + 12 &&
                      event.clientY >= refRect.top - 12 && event.clientY <= refRect.bottom + 12;
        if (overRef) {
          refDropEl.classList.remove('is-over');
          var dropWorkId = '';
          for (var di = 0; di < current.items.length; di += 1) {
            var did = String((current.items[di] && current.items[di].id) || '');
            if (!did) continue;
            if (did.indexOf('job:') === 0) did = did.slice(4);
            var isFolderItem = desk.folders.some(function (f) { return f.id === did; });
            if (!isFolderItem) { dropWorkId = did; break; }
          }
          current.items.forEach(function (item) {
            if (!item || !item.el) return;
            item.el.classList.remove('is-dragging');
            if (item.left != null) {
              item.el.style.left = item.left + 'px';
              item.el.style.top = item.top + 'px';
            }
          });
          if (dropWorkId && window.HMRefDrop && typeof window.HMRefDrop.acceptWorkId === 'function') {
            window.HMRefDrop.acceptWorkId(dropWorkId);
          } else if (dropWorkId) {
            A.toast('参考主体功能暂不可用，请手动上传', 'error');
          } else {
            A.toast('只能拖图片作为参考主体', 'error');
          }
          return;
        }
      }
    }

    /* 需求2：先查 elementFromPoint —— 保持 .is-dragging 让 pointer-events:none 穿透到目标卡片
       （如果先 removeClass('is-dragging')，被拖的卡片自身会重新遮挡 elementFromPoint 的命中）
       只认「已有文件夹」：拖到普通作品卡只移动位置，不再隐式新建文件夹/合并 */
    if (event && typeof document.elementFromPoint === 'function') {
      var targetEl = document.elementFromPoint(event.clientX, event.clientY);
      var dropCard = targetEl ? targetEl.closest('.folder-card[data-folder]') : null;
      if (dropCard) {
        var dropId = dropCard.dataset.folder;
        var targetFolderId = dropId;
        var draggedIds = current.items.map(function (i) { return i.id; });
        /* 叠放卡：只接受图片叠入；项目和其它叠放都不能拖进去 */
        if (dropCard.dataset.stack) {
          if (draggedIds.some(function (id) { return desk.folders.some(function (f) { return f.id === id; }) || desk.stacks.some(function (s) { return s.id === id; }); })) {
            A.toast('叠放只存在于桌面，不能把项目拖进去', 'error');
            merged = true;
          } else {
            var st = desk.stacks.find(function (s) { return s.id === dropCard.dataset.stack; });
            if (st) {
              draggedIds.forEach(function (id) {
                var real = String(id || '');
                if (real && st.memberIds.indexOf(real) < 0) st.memberIds.push(real);
                delete desk.assigns[real];
              });
              st.name = '叠放 (' + st.memberIds.length + ')';
              persistNow(); clearSelection(); renderDesktop();
              A.toast('已叠放（' + st.memberIds.length + ' 张）', 'success');
              merged = true;
            }
          }
        }
        /* 叠放卡不能拖进项目 */
        if (!merged && draggedIds.some(function (id) { return desk.stacks.some(function (s) { return s.id === id; }); })) {
          A.toast('叠放只存在于桌面，不能拖进项目', 'error');
          merged = true;
        }
        /* 不能拖到自己身上（folder 被拖也不能拖进自己） */
        if (!merged && draggedIds.indexOf(dropId) < 0 && !draggedIds.some(function (d) { return d === targetFolderId; })) {
          /* create=false：拖拽路径永不新建文件夹；目标文件夹不存在时返回 null，merged 保持 false */
          var folder = mergeItemsIntoFolder(draggedIds, targetFolderId, false);
          if (folder) {
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

    /* 图片拖到另一张图片上松手 → 叠成一张「叠放」卡（参考图里的效果）：
       两张缩略图同卡展示 + 右下角数量角标，点开里面仍可自由拖动、互相压住 */
    if (event && typeof document.elementFromPoint === 'function' && !merged) {
      var overEl = document.elementFromPoint(event.clientX, event.clientY);
      var overWork = overEl ? overEl.closest('.desk-card[data-work]') : null;
      if (overWork) {
        var targetWid = overWork.dataset.work;
        var moving = current.items.map(function (i) { return String(i.id || '').replace(/^job:/, ''); })
          .filter(function (id) {
            /* 只把真正的作品 id 叠进去：项目/叠放自身不是图片，写进 memberIds 会污染数据 */
            return id && !desk.folders.some(function (f) { return f.id === id; }) &&
              !desk.stacks.some(function (s) { return s.id === id; });
          });
        if (moving.length && moving.indexOf(targetWid) < 0) {
          var stack = stackWorks(targetWid, moving);
          if (stack) {
            persistNow();
            clearSelection();
            renderDesktop();
            A.toast('已叠放（' + stack.count + ' 张）', 'success');
            merged = true;
          }
        }
      }
    }
    if (merged) return;

    /* 没合并：清 is-dragging + 保存位置
       拖进参考区松手的路径已在上面 return，这里只需按最后跟手坐标落位 */
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

  /* ---------------- 叠放浮窗 ---------------- */

  function stackMembers(st) {
    return state.works.filter(function (w) { return st.memberIds.indexOf(w.id) >= 0; });
  }

  /* 叠放浮窗：每组一个独立浮窗，可同时打开、互不覆盖。
     只有点该浮窗的 ✕、或该组图片被移空时才关闭；点桌面空白/别的卡片/别的叠放都不收起。 */
  function stackOpenMap() {
    if (!view.stackOpen || typeof view.stackOpen !== 'object') view.stackOpen = {};
    return view.stackOpen;
  }
  function stackSelOf(id) {
    if (!view.stackSel || typeof view.stackSel !== 'object') view.stackSel = {};
    if (!view.stackSel[id] || typeof view.stackSel[id] !== 'object') view.stackSel[id] = {};
    return view.stackSel[id];
  }
  function stackPanelEl(id) { return byId('stackPanel-' + id); }

  function closeStackPanel(id) {
    var map = stackOpenMap();
    var ids = id ? [id] : Object.keys(map);
    ids.forEach(function (sid) {
      var panel = stackPanelEl(sid);
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      delete map[sid];
      if (view.stackSel) delete view.stackSel[sid];
    });
  }

  function openStackPanel(id) {
    var st = desk.stacks.find(function (s) { return s.id === id; });
    if (!st) return;
    stackOpenMap()[id] = true;
    stackSelOf(id); /* 这组自己的选中集合；不影响其它叠放浮窗 */
    renderStackPanel(id);
  }

  /* 桌面重排/整理/缩放后统一把还开着的浮窗补回来（节点被重建时不会丢） */
  function renderOpenStackPanels() {
    var map = stackOpenMap();
    Object.keys(map).forEach(function (sid) {
      /* 数据快照里暂时找不到这组（云端拉取/重排的中间态）时不关闭浮窗：
         浮窗只由用户明确关闭（✕ / Esc）、组被前端自己删空、或进入项目桌面时收起。
         否则一次后台刷新就会把用户正开着的叠放「藏」起来。 */
      if (!desk.stacks.some(function (s) { return s.id === sid; })) return;
      if (view.activeFolder) return;
      try { renderStackPanel(sid); } catch (e) {}
    });
  }

  function renderStackPanel(id) {
    id = id || '';
    if (!id) return;
    var st = desk.stacks.find(function (s) { return s.id === id; });
    if (!st) return; /* 同上：不因数据中间态移除已打开的浮窗 */
    if (!stackOpenMap()[id]) return;
    var grid = byId('resultGrid');
    if (!grid) return;
    var panel = stackPanelEl(id);
    var hadPanel = !!panel;
    var keepLeft = hadPanel ? panel.style.left : '';
    var keepTop = hadPanel ? panel.style.top : '';
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'stackPanel-' + id;
      panel.className = 'stack-panel';
      panel.dataset.stackId = id;
      grid.appendChild(panel);
    }
    var sel = stackSelOf(id);
    var items = stackMembers(st);
    var cells = items.map(function (w) {
      var ts = w.elapsed ? ('耗时 ' + Number(w.elapsed).toFixed(1) + 's') : '';
      return '<button type="button" class="sp-cell' + (sel[w.id] ? ' is-selected' : '') + '" data-sp="' + esc(w.id) + '">' +
        '<img src="' + esc(w.thumb || w.url || '') + '" alt="" draggable="false">' +
        '<strong>' + esc(w.prompt || workName(w)) + '</strong>' +
        (ts ? '<small>' + esc(ts) + '</small>' : '') +
        '</button>';
    }).join('');
    /* 内容没变就不重建 DOM：拖浮窗/选图过程中节点被替换会让浮窗闪一下或拖动中断 */
    var sig = (st.name || '') + '|' + st.memberIds.join(',');
    if (panel._hmSig !== sig) {
      panel._hmSig = sig;
      panel.innerHTML =
        '<div class="stack-panel-head"><span>▣</span><strong>' + esc(st.name || '叠放') + '</strong>' +
          '<span class="stack-panel-count">' + st.memberIds.length + '</span>' +
          '<button type="button" class="stack-panel-close" title="关闭">✕</button></div>' +
        '<div class="stack-panel-body">' + (cells || '<div class="folder-grid-empty">空</div>') + '</div>' +
        '<div class="stack-panel-foot"><span class="sp-sel"></span>' +
          '<button type="button" class="sp-remove" hidden>→ 移出</button></div>';
    }

    /* 尺寸跟内容走：1 项 1 列、2–4 项 2 列、5 项以上 3 列；宽度/高度都有上限，
       窄窗口下按桌面宽度收，缩略图跟着列宽自适应（不会一张图占满浮窗）。 */
    var n = items.length;
    var cols = n <= 1 ? 1 : (n <= 4 ? 2 : 3);
    var avail = Math.max(180, grid.clientWidth - 24);
    var want = cols * 108 + (cols - 1) * 10 + 24 + 2;
    var pw = Math.max(200, Math.min(380, avail, want));
    panel.style.width = pw + 'px';
    var bodyEl = panel.querySelector('.stack-panel-body');
    if (bodyEl) {
      bodyEl.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      bodyEl.style.maxHeight = Math.max(120, grid.clientHeight - 140) + 'px';
    }
    var ph = panel.offsetHeight || 240;

    /* 位置：默认贴着被点的叠放卡（右侧 → 左侧 → 下方 → 上方），不盖住卡片本身。
       只有用户主动拖过（panel.userSet）才沿用该组自己的坐标；旧数据没标记的一律重新贴卡。 */
    var scrollTop = grid.scrollTop || 0;
    var minX = 8, maxX = Math.max(minX, grid.clientWidth - pw - 8);
    var minY = scrollTop + 8, maxY = Math.max(minY, scrollTop + grid.clientHeight - ph - 8);
    var pos = st.panel || {};
    var x, y;
    if (pos.userSet && typeof pos.x === 'number') {
      x = pos.x;
      y = pos.y;
    } else {
      var cardEl = grid.querySelector('.folder-card[data-stack="' + st.id + '"]');
      if (cardEl) {
        var cl = cardEl.offsetLeft, ct = cardEl.offsetTop;
        var cw = cardEl.offsetWidth || 200, ch = cardEl.offsetHeight || 200;
        x = cl + cw + 8;
        if (x > maxX) x = cl - pw - 8;
        y = ct;
        if (x < minX) {
          /* 左右都放不下 → 卡片下方 */
          x = Math.max(minX, Math.min(maxX, cl));
          y = ct + ch + 8;
          if (y > maxY) y = Math.max(minY, ct - ph - 8);
        } else if (y > maxY) {
          y = Math.max(minY, Math.min(maxY, ct + ch - ph));
        }
      } else {
        x = Math.max(minX, (grid.clientWidth - pw) / 2);
        y = Math.max(minY, (grid.clientHeight - ph) / 2);
      }
    }
    /* 没有用户手动放置（userSet）的浮窗每次都按上面「贴卡」重新算，保证紧贴叠放；
       用户拖过的那一组走 pos.x/pos.y，不会被自动布局挪走 */
    panel.style.left = Math.min(maxX, Math.max(minX, x)) + 'px';
    panel.style.top = Math.min(maxY, Math.max(minY, y)) + 'px';

    updateStackFoot(st);

    /* 每次 openStackPanel 都会新建 #stackPanel 节点：绑定标记必须挂在节点上，
       不能用模块级布尔值，否则关闭后再打开的新节点没有任何监听（点了没反应）。 */
    if (!panel._hmStackBound) {
      panel._hmStackBound = true;
      panel.addEventListener('click', function (event) {
        if (panel._spDragEnded) { panel._spDragEnded = false; return; }
        var sid = panel.dataset.stackId;
        if (event.target.closest('.stack-panel-close')) { closeStackPanel(sid); return; }
        var cell = event.target.closest('.sp-cell[data-sp]');
        if (cell) {
          var wid = cell.dataset.sp;
          var s = stackSelOf(sid);
          if (s[wid]) delete s[wid];
          else s[wid] = true;
          /* 只更新选中态，不重建 DOM：否则双击的第二下会落到新节点上，dblclick 永远不触发 */
          cell.classList.toggle('is-selected', !!s[wid]);
          var stNow = desk.stacks.find(function (x) { return x.id === sid; });
          if (stNow) updateStackFoot(stNow);
          return;
        }
        if (event.target.closest('.sp-remove')) {
          removeSelectedFromStack(sid);
        }
      });
      panel.addEventListener('dblclick', function (event) {
        var cell = event.target.closest('.sp-cell[data-sp]');
        if (!cell) return;
        var work = findWork(cell.dataset.sp);
        if (work) A.openLightbox(work);
      });
      panel.addEventListener('contextmenu', function (event) {
        var sid = panel.dataset.stackId;
        var cell = event.target.closest('.sp-cell[data-sp]');
        if (!cell) return;
        event.preventDefault();
        event.stopPropagation();
        var s = stackSelOf(sid);
        Object.keys(s).forEach(function (k) { delete s[k]; });
        s[cell.dataset.sp] = true;
        Array.prototype.forEach.call(panel.querySelectorAll('.sp-cell'), function (c) {
          c.classList.toggle('is-selected', c === cell);
        });
        var stNow = desk.stacks.find(function (x) { return x.id === sid; });
        if (stNow) updateStackFoot(stNow);
        var work = findWork(cell.dataset.sp);
        if (work) openWorkMenu(work, event.clientX, event.clientY);
      });
    }
    /* 标题栏拖动要按当前 head 节点绑定：renderStackPanel 会重建 innerHTML，
       旧 head 已不在 DOM 里，只绑一次会让再次渲染后的浮窗拖不动。 */
    var head = panel.querySelector('.stack-panel-head');
    if (head && !head._hmDragBound) {
      head._hmDragBound = true;
      head.addEventListener('pointerdown', function (event) {
        if (event.target.closest('.stack-panel-close')) return;
        event.preventDefault();
        var rect = panel.getBoundingClientRect();
        var gridRect = grid.getBoundingClientRect();
        var offX = event.clientX - rect.left;
        var offY = event.clientY - rect.top;
        var scrollTop = grid.scrollTop || 0;
        var maxX = Math.max(8, grid.clientWidth - rect.width - 8);
        var maxY = Math.max(scrollTop + 8, scrollTop + grid.clientHeight - rect.height - 8);
        function move(e) {
          var nx = Math.min(maxX, Math.max(8, e.clientX - gridRect.left - offX));
          var ny = Math.min(maxY, Math.max(scrollTop + 8, e.clientY - gridRect.top - offY + scrollTop));
          panel.style.left = nx + 'px';
          panel.style.top = ny + 'px';
        }
        function up() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          var sid = panel.dataset.stackId;
          var st2 = desk.stacks.find(function (x) { return x.id === sid; });
          if (st2) {
            /* 只有用户真的拖过才记住该组坐标；下次打开优先贴卡，贴不下再用这里 */
            st2.panel = { x: parseInt(panel.style.left, 10) || 0, y: parseInt(panel.style.top, 10) || 0, userSet: true };
            persistNow();
            selectOnly(st2.id); /* 移动浮窗后，焦点也落回这组叠放 */
          }
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
    }
    /* 浮窗内缩略图 → 拖出成独立卡片（与标题拖动、卡片拖动互不干扰） */
    bindStackCellDrag(panel);
  }

  function updateStackFoot(st) {
    if (!st) return;
    var panel = stackPanelEl(st.id);
    if (!panel) return;
    var sel = stackSelOf(st.id);
    var ids = Object.keys(sel);
    var label = panel.querySelector('.sp-sel');
    var btn = panel.querySelector('.sp-remove');
    if (ids.length) {
      var names = ids.map(function (id) {
        var w = findWork(id);
        return w ? (w.prompt || workName(w)).slice(0, 10) : id;
      });
      label.textContent = '已选 ' + ids.length + ' 项 · ' + names.join('、');
      btn.hidden = false;
    } else {
      label.textContent = '';
      btn.hidden = true;
    }
    Array.prototype.forEach.call(panel.querySelectorAll('.sp-cell'), function (cell) {
      cell.classList.toggle('is-selected', !!sel[cell.dataset.sp]);
    });
  }

  function removeSelectedFromStack(stackId) {
    var st = desk.stacks.find(function (s) { return s.id === (stackId || ''); });
    if (!st) return;
    var sel = stackSelOf(st.id);
    var ids = Object.keys(sel);
    if (!ids.length) return;
    st.memberIds = st.memberIds.filter(function (id) { return ids.indexOf(id) < 0; });
    ids.forEach(function (id) { delete desk.positions[id]; });
    var empty = !st.memberIds.length;
    if (empty) desk.stacks = desk.stacks.filter(function (s) { return s.id !== st.id; });
    else st.name = '叠放 (' + st.memberIds.length + ')';
    delete view.stackSel[st.id];
    persistNow();
    renderDesktop();
    if (empty) closeStackPanel(st.id);
    else renderStackPanel(st.id);
    A.toast('已移出 ' + ids.length + ' 张，回到桌面', 'success');
  }

  /* 浮窗里按下缩略图 → 拖出单张：位移超过阈值才算拖动；
     松手落在桌面空白/文件夹卡上才移出，落回浮窗内或界面外一律取消。
     浮窗标题拖动、叠放卡拖动、桌面框选都走各自原有逻辑，互不影响。 */
  function bindStackCellDrag(panel) {
    if (panel._hmCellDragBound) return;
    panel._hmCellDragBound = true;
    panel.addEventListener('pointerdown', function (event) {
      var cell = event.target.closest('.sp-cell[data-sp]');
      if (!cell) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      var sid = panel.dataset.stackId;
      var wid = cell.dataset.sp;
      var startX = event.clientX, startY = event.clientY;
      var ghost = null;
      var moved = false;
      var overRef = null;
      /* 落点是否在参考主体区域内（与原生拖拽同一 12px 容差） */
      function refDropAt(x, y) {
        var ref = byId('refDrop');
        if (!ref || ref.hidden) return null;
        var r = ref.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        if (x < r.left - 12 || x > r.right + 12 || y < r.top - 12 || y > r.bottom + 12) return null;
        return ref;
      }
      function setRefOver(on) {
        var ref = byId('refDrop');
        if (ref) ref.classList.toggle('is-over', !!on);
      }
      function onMove(e) {
        if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 8) return;
        if (!moved) {
          moved = true;
          panel._spDragging = true;
          ghost = createRefGhost(cell); /* 沿用桌面已有的拖动虚影样式 */
        }
        if (ghost) {
          ghost.style.left = e.clientX + 'px';
          ghost.style.top = e.clientY + 'px';
        }
        /* 参考主体可放置反馈：进入高亮、离开立即取消 */
        overRef = refDropAt(e.clientX, e.clientY);
        setRefOver(!!overRef);
        if (e.cancelable) e.preventDefault();
      }
      function onUp(e) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        ghost = null;
        panel._spDragging = false;
        setRefOver(false);
        if (!moved) return;
        /* 拖动结束吞掉随后补发的 click，避免顺带切换浮窗里的选中态 */
        panel._spDragEnded = true;
        setTimeout(function () { panel._spDragEnded = false; }, 0);
        var hitRef = refDropAt(e.clientX, e.clientY);
        if (hitRef) {
          /* 拖到参考主体区域：走与作品卡拖入同一条通路（含上限/去重校验） */
          if (window.HMRefDrop && typeof window.HMRefDrop.acceptWorkId === 'function') {
            try { window.HMRefDrop.acceptWorkId(wid); } catch (err) {}
          }
          return;
        }
        var dropEl = document.elementFromPoint(e.clientX, e.clientY);
        if (!dropEl) return;                         /* 界面外：取消 */
        if (dropEl.closest('.stack-panel')) return;   /* 落回浮窗内：取消 */
        if (dropEl.closest('#resultGrid')) {
          moveWorkOutOfStack(sid, wid, dropEl, e.clientX, e.clientY);
        }
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  /* 把单张图从叠放组里放到桌面：落在文件夹卡 → 归到该文件夹；
     否则按落点写回桌面坐标（沿用 desk.positions 的 pxLeft/pxTop）。 */
  function moveWorkOutOfStack(stackId, wid, dropEl, clientX, clientY) {
    var st = desk.stacks.find(function (s) { return s.id === stackId; });
    if (!st || (st.memberIds || []).indexOf(wid) < 0) return;
    var grid = byId('resultGrid');
    if (!grid) return;
    var folderCard = dropEl.closest ? dropEl.closest('.folder-card[data-folder]') : null;
    var toFolder = null;
    if (folderCard && !folderCard.dataset.stack) toFolder = folderCard.dataset.folder;
    if (toFolder) {
      desk.assigns[wid] = toFolder;
      delete desk.positions[wid];
    } else {
      var rect = grid.getBoundingClientRect();
      var left = Math.max(0, Math.min(Math.max(1, grid.clientWidth - cardWidth() - 4),
        clientX - rect.left + grid.scrollLeft));
      var top = Math.max(0, clientY - rect.top + grid.scrollTop);
      unassign(wid);
      desk.positions[wid] = { pxLeft: left, pxTop: top, _userSet: true };
    }
    st.memberIds = (st.memberIds || []).filter(function (id) { return id !== wid; });
    if (view.stackSel && view.stackSel[stackId]) delete view.stackSel[stackId][wid];
    var empty = !st.memberIds.length;
    if (empty) desk.stacks = desk.stacks.filter(function (s) { return s.id !== st.id; });
    else st.name = '叠放 (' + st.memberIds.length + ')';
    desk.updatedAt = Date.now();
    persistNow();
    renderDesktop();
    if (empty) closeStackPanel(st.id);
    else renderStackPanel(st.id);
    A.toast('已移出 1 张到' + (toFolder ? '文件夹' : '桌面'), 'success');
  }

  /* 把图片叠到目标图片上：目标已属于某个叠放组就并入，否则在桌面根层新建一组。
     叠放只存在桌面层，不写入 folders / assigns，因此不会出现在项目列表里。 */
  function stackWorks(targetId, ids) {
    if (!targetId || !ids || !ids.length) return null;
    if (view.activeFolder && !view.activeStack) return null; /* 项目内不生成叠放 */
    var st = desk.stacks.find(function (s) { return (s.memberIds || []).indexOf(targetId) >= 0; });
    if (!st && view.activeStack) st = desk.stacks.find(function (s) { return s.id === view.activeStack; });
    if (!st) {
      st = { id: 's' + A.uid(), name: '叠放 (2)', createdAt: Date.now(), memberIds: [] };
      desk.stacks.unshift(st);
      /* 新叠放出现在被拖入那张图的“当前显示位置”旁。
         注意不能用 desk.positions 里的旧 px 坐标：未手动拖过的卡在渲染时会按索引重排，
         存储坐标可能早已过时（那正是叠放跑到桌面末尾/别处的原因）。 */
      var tel = document.querySelector('#resultGrid .desk-card[data-work="' + targetId + '"]');
      var tpos = desk.positions[targetId];
      var tx = null, ty = null;
      if (tel) { tx = tel.offsetLeft; ty = tel.offsetTop; }
      else if (tpos && typeof tpos.pxLeft === 'number') { tx = tpos.pxLeft; ty = tpos.pxTop; }
      if (tx != null) {
        /* 直接占据被拖入图片当前所在的网格位；作品排布会为它让开 */
        desk.positions[st.id] = { pxLeft: tx, pxTop: ty, _userSet: true };
      }
    }
    ids.forEach(function (id) {
      if (id && id !== targetId && st.memberIds.indexOf(id) < 0) st.memberIds.push(id);
    });
    if (st.memberIds.indexOf(targetId) < 0) st.memberIds.push(targetId);
    /* 从项目归属里摘出来，避免同一张图同时出现在项目和叠放里 */
    st.memberIds.forEach(function (id) { delete desk.assigns[id]; });
    st.name = '叠放 (' + st.memberIds.length + ')';
    return { id: st.id, count: st.memberIds.length };
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
  /* 批量删除：选中几张删几张，确认只弹一次。
     注意：不能逐条调用带 confirm 的删除 —— 连续弹窗会被浏览器拦截（后续 confirm 直接返回 false），
     结果只有第一张真正被删掉。 */
  function deleteWorks(list, silent) {
    var works = (list || []).filter(Boolean);
    if (!works.length) return 0;
    if (!silent) {
      var label = works.length === 1 ? (workName(works[0]) || '该项') : works.length + ' 项';
      if (!window.confirm('删除「' + label + '」？此操作不可撤销。')) return 0;
    }
    var ids = {};
    works.forEach(function (w) { ids[w.id] = true; });
    state.works = state.works.filter(function (w) { return !ids[w.id]; });
    var gridEl = (A.els && A.els.resultGrid) || document;
    works.forEach(function (w) {
      if (typeof A.idbDelBlob === 'function') {
        try { A.idbDelBlob(w.id); } catch (e) {}
      }
      delete desk.positions[w.id];
      unassign(w.id);
      delete desk.names[w.id];
      if (view.cut === w.id) view.cut = null;
      delete view.selected[w.id];
      delete view.selected['job:' + w.id];
      /* 作品与任务同 id：清掉任务记录，避免结果区/桌面残留失败或加载卡 */
      if (A.state && A.state.jobs && typeof A.state.jobs.delete === 'function') {
        A.state.jobs.delete(w.id);
      }
      Array.prototype.forEach.call(gridEl.querySelectorAll('[data-job="' + w.id + '"]'), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    });
    /* 删图后同步叠放成员：被删光的叠放整组移除（不留空壳），并关掉它开着的浮窗 */
    var emptiedStacks = [];
    desk.stacks.forEach(function (st) {
      var before = (st.memberIds || []).length;
      st.memberIds = (st.memberIds || []).filter(function (id) { return !ids[id]; });
      if (st.memberIds.length !== before) {
        if (st.memberIds.length) st.name = '叠放 (' + st.memberIds.length + ')';
        else emptiedStacks.push(st.id);
      }
    });
    if (emptiedStacks.length) {
      desk.stacks = desk.stacks.filter(function (s) { return emptiedStacks.indexOf(s.id) < 0; });
      emptiedStacks.forEach(function (sid) {
        delete desk.positions[sid];
        closeStackPanel(sid);
      });
    }
    /* 删除后立刻按原有顺序规则紧凑重排（叠放/文件夹/图片一起），并持久化坐标：
       否则删掉中间一张后会留下空位、后面的叠放与文件夹不跟随前移。 */
    tidy(true);
    A.saveWorks();
    A.renderWorks();
    /* 删除同步到后端（写墓碑，其它设备增量拉取时能感知删除） */
    if (window.HMSync && window.HMSync.deleteWorks) {
      window.HMSync.deleteWorks(works.map(function (w) { return w.id; }));
    }
    /* 删除后清理选中状态并刷新批量操作条的隐藏/计数 */
    if (!selectedIds().length) view.selected = {};
    syncSelection();
    if (!silent) A.toast(works.length > 1 ? '已删除 ' + works.length + ' 项' : '已删除', 'info');
    /* 文件夹预览打开时同步刷新，避免残留已删除的卡片 */
    var prevModal = byId('folderPreviewModal');
    if (prevModal && !prevModal.hidden && view.prevFolder) {
      var prevFolder = desk.folders.find(function (f) { return f.id === view.prevFolder; });
      if (prevFolder) openFolderPreview(prevFolder);
      else closeFolderPreview();
    }
    return works.length;
  }

  function deleteWork(work) {
    if (!work) return;
    deleteWorks([work], false);
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
        else unassign(orig.id);
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
    fetchImageForRef(url).then(function (blob) {
      var reader = new FileReader();
      reader.onload = function () { apply(String(reader.result || '')); };
      reader.readAsDataURL(blob);
    }).catch(function (err) {
      var why = String((err && err.message) || '网络被拦截');
      A.toast('这张图读不到（' + why + '）；请下载后手动上传为参考图', 'error', 6000);
    });
  }

  /* 与 HMRefDrop 同一套策略：直连失败 → 后端代理代取 */
  function fetchImageForRef(url) {
    return hmReadImageBlob(url);
  }

  function sendToCanvas(work) {
    A.switchView('canvas');
    A.toast('已发送「' + workName(work) + '」到画布', 'success');
    if (window.HMUI && window.HMUI.renderCanvas) window.HMUI.renderCanvas();
  }

  /* ---------------- 右键菜单 ---------------- */
  function hideContexts() {
    ['hmCtx', 'deskCtx', 'folderCtx', 'stackCtx'].forEach(function (id) {
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
    var ctx = byId('hmCtx');
    var failed = !!(work && (work.failed || work.ok === false));
    if (ctx) {
      var blocked = ['download', 'canvas', 'ref', 'copy', 'cut'];
      Array.prototype.forEach.call(ctx.querySelectorAll('[data-cmd]'), function (btn) {
        var cmd = btn.dataset.cmd;
        if (cmd === 'retry') { btn.hidden = !failed; return; }
        btn.disabled = failed && blocked.indexOf(cmd) >= 0;
      });
    }
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
        else if (w.failed || w.ok === false) inner = '<div class="folder-prev-failed">!<small>生成失败</small></div>';
        else inner = '<img src="' + url + '" alt="' + esc(w.prompt) + '" loading="lazy" draggable="false">';
        return '<div class="folder-prev-cell" data-fp="' + esc(w.id) + '">' +
          '<div class="folder-prev-media ' + cls + '">' + inner + '</div>' +
          '<div class="folder-prev-meta"><strong>' + esc(workName(w)) + '</strong><small>' + typeLabel(w.type) + ' · ' + (w.width || 0) + '×' + (w.height || 0) + '</small></div>' +
          '</div>';
      }).join('');
    }

    modal.hidden = false;
    view.prevFolder = folder.id;

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

  /* 关闭时间文案：取记录的 closedAt（任务结束/关闭时刻），缺失时显示「未记录」 */
  function historyClosedText(work) {
    var ts = Number(work && work.closedAt) || 0;
    if (!ts) return '关闭 未记录';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '关闭 未记录';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return '关闭 ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function historyCardHtml(work) {
    var meta = work.type === 'audio' ? '音频 · 语音合成' : (work.type === 'video' ? '视频 · ' + (work.duration || 5) + '秒' : (work.width || 0) + '×' + (work.height || 0));
    var isFailed = !!(work.failed || work.ok === false);
    return '<article class="hm-history-card' + (isFailed ? ' is-failed' : '') + '" data-work="' + esc(work.id) + '" data-type="' + esc(work.type || 'image') + '">' +
      '<div class="hm-history-thumb">' + mediaHtml(work, 'history') +
      '<span class="hm-history-badge">' + (isFailed ? '生成失败' : '已完成') + '</span></div>' +
      '<div class="hm-history-info">' +
      '<strong>' + esc(workName(work)) + '</strong>' +
      '<small>' + esc((work.modelName || 'AI') + ' · ' + meta) + '</small>' +
      '</div>' +
      '<div class="hm-history-foot">' +
      '<span>' + esc(today(work.createdAt)) + '</span>' +
      '<span class="hm-history-closed">' + esc(historyClosedText(work)) + '</span>' +
      '<span class="hm-history-acts">' +
      '<button data-hact="preview" title="预览">◎</button>' +
      '<button data-hact="id" title="任务 ID">ID</button>' +
      '<button data-hact="download" title="' + (isFailed ? '无可下载的图片' : '下载') + '"' + (isFailed ? ' disabled' : '') + '>↓</button>' +
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

    /* 点击面板外部关闭。注意：面板内的点击常会触发 renderPanel() 重建 DOM，
       冒泡到 document 时 event.target 已经脱离 #projPanel，closest() 会误判为“外部”。
       用 composedPath()（派发瞬间固定的路径）判断才可靠。 */
    document.addEventListener('click', function (event) {
      var panel = byId('projPanel');
      if (!panel || panel.hidden) return;
      var inPanel = false;
      if (typeof event.composedPath === 'function') {
        inPanel = event.composedPath().some(function (n) { return n && n.id === 'projPanel'; });
      }
      if (inPanel || (event.target.closest && event.target.closest('#projPanel'))) return;
      if (event.target.closest && (event.target.closest('.modal') || event.target.closest('.hm-ctx'))) return;
      closePanel();
    });

    var closeBtn = byId('projCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    var newBtn = byId('projNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        /* 跟随当前位置：选中了项目就建它的子文件夹 */
        newFolder(view.activeFolder || null, function () { renderDesktop(); });
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
            /* renderDesktop 在非 create 视图会提前 return（只标 deskDirty），
               从资产/项目页点文件夹时就不会切过去，看起来像"点了没反应"。
               先切回 create 视图，让这次点击真的进入文件夹桌面。 */
            if (document.body.getAttribute('data-view') !== 'create' && A.switchView) {
              A.switchView('create');
            }
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
          if (document.body.getAttribute('data-view') !== 'create' && A.switchView) {
            A.switchView('create');
          }
          renderPanel();
          renderDesktop();
        } else if (action === 'new') {
          startInlineCreate(view.activeFolder || null);
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

      /* ============== 指针拖拽（鼠标/触控）：不依赖浏览器原生 HTML5 drag ============== */
      var pdrag = null;
      var suppressDropClick = false;
      function clearDropMarks() {
        projList.querySelectorAll('.is-drop-over').forEach(function (el) { el.classList.remove('is-drop-over'); });
        projList.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });
      }
      function dragTargetAt(x, y) {
        var el = document.elementFromPoint(x, y);
        if (!el || !el.closest) return null;
        return { row: el.closest('[data-folder-row]'),
                 root: el.closest('[data-root-drop]'),
                 inList: !!el.closest('#projList') };
      }
      projList.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('.hm-inline-input, [data-folder-toggle], [data-folder-plus], [data-folder-more], [data-inline-cancel]')) return;
        var row = e.target.closest('[data-folder-row]');
        if (!row) return;
        pdrag = { id: row.dataset.folderRow, el: row, x: e.clientX, y: e.clientY, moved: false, ghost: null };
      });
      document.addEventListener('pointermove', function (e) {
        if (!pdrag) return;
        if (!pdrag.moved) {
          if (Math.abs(e.clientX - pdrag.x) < 4 && Math.abs(e.clientY - pdrag.y) < 4) return;
          pdrag.moved = true;
          var nameEl = pdrag.el.querySelector('.hm-proj-txt strong');
          var ghost = document.createElement('div');
          ghost.className = 'hm-drag-ghost';
          ghost.textContent = nameEl ? nameEl.textContent : '文件夹';
          document.body.appendChild(ghost);
          pdrag.ghost = ghost;
        }
        e.preventDefault();
        if (pdrag.ghost) {
          pdrag.ghost.style.left = (e.clientX + 12) + 'px';
          pdrag.ghost.style.top = (e.clientY + 12) + 'px';
        }
        clearDropMarks();
        pdrag.el.classList.add('is-dragging');
        var hit = dragTargetAt(e.clientX, e.clientY);
        if (!hit) return;
        if (hit.row && hit.row.dataset.folderRow !== pdrag.id && !isDescendantOf(pdrag.id, hit.row.dataset.folderRow)) {
          hit.row.classList.add('is-drop-over');
        } else if (!hit.row && (hit.root || hit.inList)) {
          var rz = projList.querySelector('[data-root-drop]');
          if (rz) rz.classList.add('is-drop-over');
        }
      });
      function endPointerDrag(e, cancelled) {
        if (!pdrag) return;
        var d = pdrag;
        pdrag = null;
        if (!d.moved) return;
        suppressDropClick = true;
        if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
        clearDropMarks();
        if (cancelled) return;
        var hit = dragTargetAt(e.clientX, e.clientY);
        if (!hit) return;
        var moved = false;
        if (hit.row && hit.row.dataset.folderRow !== d.id) {
          var tgtId = hit.row.dataset.folderRow;
          if (isDescendantOf(d.id, tgtId)) {
            A.toast('不能把文件夹拖进它自己的子文件夹里', 'info');
            return;
          }
          if (moveFolder(d.id, tgtId)) {
            view.expanded[tgtId] = true;
            var fs = desk.folders.find(function (f) { return f.id === d.id; });
            var ft = desk.folders.find(function (f) { return f.id === tgtId; });
            A.toast('「' + (fs ? fs.name : '文件夹') + '」已移入「' + (ft ? ft.name : '目标') + '」', 'success');
            moved = true;
          }
        } else if (hit.root || hit.inList) {
          if (moveFolder(d.id, null)) {
            var f1 = desk.folders.find(function (f) { return f.id === d.id; });
            A.toast('「' + (f1 ? f1.name : '文件夹') + '」已移到根目录', 'success');
            moved = true;
          }
        }
        if (moved) {
          if (view.activeFolder === d.id || isDescendantOf(d.id, view.activeFolder)) view.activeFolder = d.id;
          view.selectedFolders = {};
          view.selectedFolders[d.id] = true;
          renderPanel();
          renderDesktop();
        }
      }
      document.addEventListener('pointerup', function (e) { endPointerDrag(e, false); });
      document.addEventListener('pointercancel', function (e) { endPointerDrag(e, true); });
      document.addEventListener('click', function (e) {
        if (!suppressDropClick) return;
        suppressDropClick = false;
        e.stopPropagation();
        e.preventDefault();
      }, true);
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

      /* 叠放卡右键统一在 document 捕获阶段处理：焦点态/拖拽逻辑里的 preventDefault、
         stopPropagation 会先把事件吞掉，卡片自身的监听和 #resultGrid 的委托都可能收不到 */
      document.addEventListener('contextmenu', function (event) {
        var stackCard = event.target && event.target.closest ? event.target.closest('.folder-card[data-stack]') : null;
        if (!stackCard) return;
        var sid = stackCard.dataset.stack;
        if (!sid) return;
        event.preventDefault();
        event.stopPropagation();
        selectOnly(sid);
        /* 叠放有专属处理菜单（打开/解散/导出/下载/重命名/复制/剪切/删除），
           不再借用单张图的菜单，也不再只是打开浮窗 */
        view.menuStack = sid;
        var delLabel = byId('stackCtxDelLabel');
        if (delLabel) delLabel.textContent = '删除 (' + Math.max(1, selectedIds().length) + ')';
        showContext('stackCtx', event.clientX, event.clientY);
      }, true);

      grid.addEventListener('pointerdown', onPointerDown);
      grid.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        /* 右键失败结果卡片 → 与作品卡一致的菜单（下载等置灰、重试可用） */
        var jobCard = event.target.closest('.result-card.is-error[data-job]');
        if (jobCard) {
          var failedWork = findWork(jobCard.dataset.job);
          if (failedWork) {
            openWorkMenu(failedWork, event.clientX, event.clientY);
            return;
          }
        }
        /* 右键叠放卡：缩略图 → 该图的作品菜单（预览/参数/参考图/删除，和桌面图一致）；
           卡身 → 选中这组并打开浮窗。绝不能再落到 folderCtx（叠放不是文件夹，菜单项全是空操作） */
        var stackCardCtx = event.target.closest('.folder-card[data-stack]');
        if (stackCardCtx) {
          var sid = stackCardCtx.dataset.stack;
          selectOnly(sid);
          var th = event.target.closest('.folder-t[data-stack-fp]');
          var thWork = th ? findWork(th.dataset.stackFp) : null;
          if (thWork) openWorkMenu(thWork, event.clientX, event.clientY);
          else openStackPanel(sid);
          return;
        }
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
      var clickTimer = null;
      var clickSeq = 0;
      grid.addEventListener('click', function (event) {
        /* 1. folder-card 里的叠放小图 (.folder-t img) → 打开 lightbox 预览 */
        var fp = event.target.closest('.folder-t[data-fp]');
        if (fp) {
          var w = findWork(fp.dataset.fp);
          if (w) A.openLightbox(w);
          return;
        }
        /* 2. folder-card 本体 → 进入该文件夹桌面（不再弹窗预览） */
        var folderCard = event.target.closest('.folder-card[data-folder]');
        if (folderCard) {
          if (event.target.closest('button')) return;
          /* 刚拖完松手补发的 click 不算点击：否则拖叠放/文件夹会顺手打开浮窗 */
          if (suppressClick) { suppressClick = false; return; }
          /* 叠放：双击/点击都弹桌面内浮窗，不再切换成“进入项目” */
          if (folderCard.dataset.stack) {
            openStackPanel(folderCard.dataset.stack);
            return;
          }
          var folder = desk.folders.find(function (f) { return f.id === folderCard.dataset.folder; });
          if (folder) {
            closeStackPanel(); /* 进入项目桌面时收起桌面浮窗，避免浮窗盖住新桌面 */
            view.activeFolder = folder.id;
            renderDesktop();
            persistSoon();
          }
          return;
        }
        /* 3. desk-card 本体：单击 = 选中，双击 = 看大图（见下一个 dblclick 监听） */
        var card = event.target.closest('.desk-card[data-work]');
        if (!card) { clearSelection(); return; }   /* 桌面空白单击 → 清空选中 */
        if (event.target.closest('button, [data-dact]')) return; /* 操作按钮由各自按钮处理 */
        if (suppressClick) { suppressClick = false; return; } /* 刚拖完的松手 click 不算点击 */
        var work = findWork(card.dataset.work);
        if (!work) return;
        /* 触屏双击不可靠：手机端保留「单击直接看大图」 */
        if (lastPointerType === 'touch') { A.openLightbox(work); return; }
        var seq = ++clickSeq;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(function () {
          if (seq !== clickSeq) return;      /* 已被双击或后续点击取消 */
          /* 已选中（含多选中的某一张）→ 保持原样，不塌缩成单选 */
          if (!view.selected[work.id]) selectOnly(work.id);
        }, 320);
      });
      grid.addEventListener('dblclick', function (event) {
        var card = event.target.closest('.desk-card[data-work]');
        if (!card) return;
        /* 让待执行的单击定时器失效，避免弹图前先选中两次 */
        clickSeq += 1;
        clearTimeout(clickTimer);
        var work = findWork(card.dataset.work);
        if (work) A.openLightbox(work);
      });
    }

    window.addEventListener('resize', function () {
      setDockVar();
      if (document.body.getAttribute('data-view') === 'create') renderDesktop();
      /* 浮窗按内容/桌面宽度算尺寸，窗口变窄时要重新收一次（多组各自独立） */
      try { renderOpenStackPanels(); } catch (e) {}
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
          case 'retry': if (A.retryWork) A.retryWork(work); break;
          case 'download': A.downloadImage(work.url, A.fileNameFor(work)); break;
          case 'canvas': sendToCanvas(work); break;
          case 'delete':
            /* 右键的那张属于当前多选集合 → 删除整批；否则维持单张删除 */
            var selIds = selectedIds().filter(function (k) { return findWork(k); });
            if (selIds.indexOf(work.id) >= 0 && selIds.length > 1) {
              var selWorks = selIds.map(function (k) { return findWork(k); }).filter(Boolean);
              if (deleteWorks(selWorks, false)) clearSelection();
            } else {
              deleteWork(work);
            }
            break;
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
            if (!window.confirm('删除 ' + allTargetIds.length + ' 个文件夹？图片会回到桌面，图片本身不会被删除。')) return;
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
                (A.fetchImageBlob ? A.fetchImageBlob(url) : fetch(A.proxyMediaUrl ? A.proxyMediaUrl(url) : url).then(function (r) { return r.blob(); })).then(function (blob) {
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

    /* 叠放右键菜单的命令 */
    var stackCtx = byId('stackCtx');
    if (stackCtx) {
      stackCtx.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-scmd]');
        if (!btn || btn.disabled) return;
        var cmd = btn.dataset.scmd;
        var sid = view.menuStack;
        hideContexts();
        var st = desk.stacks.find(function (s) { return s.id === sid; });
        if (!st) return;
        var members = stackMembers(st);
        if (cmd === 'rename') {
          askName('重命名叠放', st.name || '叠放', function (value) {
            st.name = value || st.name;
            st.updatedAt = Date.now();  /* 名字版本号：合并时据此保留较晚修改 */
            desk.updatedAt = Date.now();
            persistNow();
            renderDesktop();
            renderOpenStackPanels();
          });
          return;
        }
        if (!members.length) { A.toast('这组叠放里没有图片', 'info'); return; }
        if (cmd === 'open') {
          openStackPanel(sid);
        } else if (cmd === 'ungroup') {
          desk.stacks = desk.stacks.filter(function (s) { return s.id !== sid; });
          desk.updatedAt = Date.now();
          clearSelection();
          persistNow();
          renderDesktop();
          A.toast('已解散「' + (st.name || '叠放') + '」，图片已回到桌面', 'success');
        } else if (cmd === 'zip') {
          var zipName = (st.name || '叠放').replace(/[\\/:*?"<>|]/g, '_');
          if (typeof JSZip === 'undefined') {
            A.toast('开始下载「' + zipName + '」里的 ' + members.length + ' 项', 'success');
            members.forEach(function (w, i) {
              setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 400);
            });
            return;
          }
          A.toast('正在打包「' + zipName + '」…', 'info');
          var zip = new JSZip();
          var sub = zip.folder(zipName);
          var pending = members.length;
          var done = function () {
            pending -= 1;
            if (pending > 0) return;
            zip.generateAsync({ type: 'blob' }).then(function (blob) {
              var a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = zipName + '.zip';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
              A.toast('已导出「' + zipName + '.zip」（' + members.length + ' 项）', 'success');
            });
          };
          members.forEach(function (w) {
            var url = w.url || w.thumb;
            var fname = A.fileNameFor(w);
            (A.fetchImageBlob ? A.fetchImageBlob(url) : fetch(A.proxyMediaUrl ? A.proxyMediaUrl(url) : url).then(function (r) { return r.blob(); })).then(function (blob) {
              if (!/\.([a-z0-9]+)$/i.test(fname)) fname += '.' + ((blob.type || '').split('/')[1] || 'png');
              sub.file(fname, blob);
            }).catch(function () {}).then(done);
          });
        } else if (cmd === 'download') {
          A.toast('开始批量下载 ' + members.length + ' 项', 'success');
          members.forEach(function (w, i) {
            setTimeout(function () { A.downloadImage(w.url, A.fileNameFor(w)); }, i * 300);
          });
        } else if (cmd === 'copy') {
          clipboard.setCopy(members);
          A.toast('已复制 ' + members.length + ' 项，Ctrl+V 粘贴', 'info');
        } else if (cmd === 'cut') {
          clipboard.setCut(members, view.activeFolder || null);
          A.toast('已剪切 ' + members.length + ' 项，Ctrl+V 粘贴', 'info');
        } else if (cmd === 'delete') {
          if (!window.confirm('删除整组叠放里的 ' + members.length + ' 张图片？此操作不可撤销。')) return;
          deleteWorks(members, true);
          clearSelection();
          persistNow();
          renderDesktop();
        }
      });
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('#hmCtx') || event.target.closest('#deskCtx') || event.target.closest('#folderCtx') || event.target.closest('#stackCtx')) return;
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
        /* 叠放不在 selectedIds 的批量操作集合里，但它可以是“当前焦点”：
           焦点叠放优先于鼠标位置，避免移动完叠放后按 Delete 作用到别的卡 */
        var focusStackIds = Object.keys(view.selected).filter(function (k) {
          return desk.stacks.some(function (s) { return s.id === k; });
        });
        if (!keys.length && focusStackIds.length) {
          keys = focusStackIds;
        } else if (!keys.length) {
          /* 没有选中项时，以鼠标光标下的卡片为准 */
          var hovEl = document.elementFromPoint(lastMouse.x, lastMouse.y);
          var hovCard = hovEl && hovEl.closest('.folder-card, .desk-card');
          if (hovCard) keys = [hovCard.dataset.folder || hovCard.dataset.work];
        }
        if (!keys.length) return;
        /* 叠放：只解散分组，图片回到桌面，图片本身不删除 */
        var stackIds = keys.filter(function (k) {
          return desk.stacks.some(function (s) { return s.id === k; });
        });
        if (stackIds.length) {
          event.preventDefault();
          desk.stacks = desk.stacks.filter(function (s) { return stackIds.indexOf(s.id) < 0; });
          desk.updatedAt = Date.now();
          keys = keys.filter(function (k) { return stackIds.indexOf(k) < 0; });
          if (!keys.length) {
            clearSelection();
            persistNow();
            renderDesktop();
            return;
          }
          renderDesktop();
        }
        var folderIds = keys.filter(function (k) { return desk.folders.some(function (f) { return f.id === k; }); });
        if (folderIds.length) {
          event.preventDefault();
          if (folderIds.length > 1) {
            /* 多选文件夹：确认一次后静默批量删除，避免连续 confirm 被浏览器拦截 */
            if (!window.confirm('删除选中的 ' + folderIds.length + ' 个文件夹？图片会回到桌面，图片本身不会被删除。')) return;
            folderIds.forEach(function (fid) { deleteFolder(fid, true); });
          } else {
            folderIds.forEach(function (fid) { deleteFolder(fid); });
          }
        } else {
          /* 排除 'job:' 前缀（生成中/失败的任务卡），只保留作品 id */
          var workIds = keys.filter(function (k) { return k.indexOf('job:') !== 0; });
          if (workIds.length) {
            event.preventDefault();
            /* 多选：一次性删除整个选中集合（deleteWorks 只确认一次） */
            var works = workIds.map(function (k) { return findWork(k); }).filter(Boolean);
            if (works.length && deleteWorks(works, false)) clearSelection();
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
    /* 跨设备一致性：先探测 rev（9s 一次），变了才整包合并；切回/聚焦/联网立即探测 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pollDeskRev(true);
    });
    window.addEventListener('focus', function () { pollDeskRev(true); });
    window.addEventListener('online', function () { pollDeskRev(true); });
    startRealtimeSync();
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
    useAsRef: useAsRef,
    sync: syncServer,
    pullNow: pullNow,
    claimLegacy: claimLegacy,
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
