
/* ============================================================
 * 绘梦 · 跨设备云同步层（HMSync）
 * ------------------------------------------------------------
 * 职责：
 *   1. 作品元数据 → /api/works（带 _rev 乐观锁，删除写墓碑）
 *   2. 作品图片 → POST /api/works/:id/asset（服务端存对象存储，库里只留 url）
 *   3. 桌面/项目文件夹树 → /api/desk
 *   4. 编集/宣发/偏好 → /api/docs/:kind
 *   5. 登录后一次性迁移本地旧数据（按 id 去重，可重试）
 *   6. 离线队列：断网时进队列，恢复网络/下次启动重放
 * localStorage / IndexedDB 降级为本地缓存。
 * ============================================================ */
/* ============================================================
 * 绘梦 · 登录态持久化层（HMAuth）
 * ------------------------------------------------------------
 * 「刷新后保持登录」依赖三件事：
 *   1) token 真正写进了本地存储（配额满时写入会静默失败）
 *   2) 页面启动时不被 5xx / 超时 / 断网误判成「登录失效」
 *   3) hm.user 缓存缺失时仍能从 token payload 还原登录态
 * 这里把这三件事集中处理，页面只调 HMAuth.getToken / setToken / classify。
 * ============================================================ */
(function () {
  'use strict';
  if (window.HMAuth) return;

  var TOKEN_KEY = 'hm.token';
  var TOKEN_BAK = 'hm.token.bak';

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  /* 只清理「可重建」的缓存来腾配额：旧作品快照与离线队列。
     绝不碰 hm.token / hm.user / anidream.works.v1 / anidream.rev.v1 */
  function trimStorage() {
    var removed = 0;
    try {
      var snaps = [];
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (k && k.indexOf('.snap.') > 0) snaps.push(k);
      }
      snaps.sort();
      /* 只留最新 1 份（正常上限是 3 份），配额紧张时优先回收 */
      while (snaps.length > 1) { localStorage.removeItem(snaps.shift()); removed += 1; }
      if (localStorage.getItem('anidream.queue.v1')) {
        localStorage.removeItem('anidream.queue.v1');
        removed += 1;
      }
    } catch (e) {}
    if (removed) console.warn('[HMAuth] 配额紧张，已清理 ' + removed + ' 项可重建缓存');
    return removed;
  }

  function readToken() {
    var t = lsGet(TOKEN_KEY);
    if (t) return t;
    /* 主键丢了但本标签页还有 → 回填主键（刷新后仍然登录） */
    t = ssGet(TOKEN_KEY);
    if (t) { lsSet(TOKEN_KEY, t); return t; }
    /* 主键被误删但备份还在 → 回填 */
    t = lsGet(TOKEN_BAK);
    if (t) { lsSet(TOKEN_KEY, t); ssSet(TOKEN_KEY, t); return t; }
    return '';
  }

  function writeToken(token) {
    token = token ? String(token) : '';
    if (!token) {
      lsDel(TOKEN_KEY); lsDel(TOKEN_BAK); ssDel(TOKEN_KEY);
      return true;
    }
    var ok = lsSet(TOKEN_KEY, token);
    if (!ok) {
      /* 配额满：回收可重建缓存后重试一次 */
      trimStorage();
      ok = lsSet(TOKEN_KEY, token);
    }
    if (!ok) {
      /* 仍然写不进：降级到 sessionStorage（同标签页刷新依旧保持登录） */
      ssSet(TOKEN_KEY, token);
      console.warn('[HMAuth] localStorage 写入失败（可能配额已满），token 已降级存到 sessionStorage；建议清理本地缓存');
    } else {
      /* 主键成功时同步留一份备份，主键被外部清理时可回填 */
      if (!lsSet(TOKEN_BAK, token)) ssSet(TOKEN_KEY, token);
    }
    /* 回读校验：写进去读不出来等于没登录，必须显式告警而不是静默 */
    var back = ok ? lsGet(TOKEN_KEY) : ssGet(TOKEN_KEY);
    if (back !== token) {
      console.warn('[HMAuth] token 回读校验失败，本次刷新可能需要重新登录');
      return false;
    }
    return true;
  }

  function b64url(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return s;
  }
  function utf8(bin) {
    try {
      if (typeof TextDecoder !== 'undefined') {
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch (e) {}
    try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
  }
  /* 解析 token payload（无 exp，因此只用于「还原用户是谁」，是否失效只看服务端 401） */
  function decodeToken(token) {
    var parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    var json = '';
    try { json = utf8(atob(b64url(parts[1]))); } catch (e) { return null; }
    var p = null;
    try { p = JSON.parse(json); } catch (e) { return null; }
    if (!p || !p.uid) return null;
    return {
      id: String(p.uid),
      username: p.username || ('guest_' + String(p.uid).slice(-6)),
      role: p.role || 'user',
      status: p.status || 'approved'
    };
  }

  /* 'auth' = 服务端明确否定凭证（只有这种才允许清 token / 登出）
     'network' = 5xx / 超时 / 断网，必须保留 token，稍后重试
     'other' = 其余业务错误，同样不动登录态 */
  function classify(err) {
    if (!err) return 'other';
    var status = Number(err.status || err.statusCode || 0);
    var raw = String(err.message || err.code || '');
    var msg = raw.toLowerCase();
    if (status === 401 || status === 403) return 'auth';
    if (status >= 500 || err.offline || err.timeout || err.name === 'AbortError') return 'network';
    if (msg.indexOf('timeout') >= 0 || msg.indexOf('超时') >= 0 ||
        msg.indexOf('failed to fetch') >= 0 || msg.indexOf('network') >= 0 ||
        msg.indexOf('offline') >= 0 || msg.indexOf('网络') >= 0 ||
        msg.indexOf('无法连接') >= 0 || msg.indexOf('abort') >= 0) return 'network';
    /* 无状态码时只认「明确说凭证无效」的措辞；
       不能宽泛匹配 'token'，否则 500 文案里带 token 会把用户踢下线 */
    if (msg.indexOf('未登录') >= 0 || msg.indexOf('登录已过期') >= 0 ||
        msg.indexOf('unauthorized') >= 0 ||
        (msg.indexOf('token') >= 0 && (msg.indexOf('invalid') >= 0 || msg.indexOf('expired') >= 0))) {
      return 'auth';
    }
    return 'other';
  }

  /* 只有「账号确实处于待审批 / 已拒绝」才算账号被拦。
     ACCOUNT_UNDEFINED（账号记录缺 status）属于服务端数据问题，
     不能当成登录失效，否则每次刷新都会被踢下线。 */
  function isAccountBlocked(err) {
    if (!err) return false;
    var code = String(err.code || (err.data && err.data.error && err.data.error.code) || '');
    if (code === 'ACCOUNT_PENDING' || code === 'ACCOUNT_REJECTED') return true;
    var msg = String(err.message || '');
    return msg.indexOf('等待超级管理员审批') >= 0 || msg.indexOf('注册申请已被拒绝') >= 0;
  }

  window.HMAuth = {
    getToken: readToken,
    setToken: writeToken,
    decodeToken: decodeToken,
    classify: classify,
    isAccountBlocked: isAccountBlocked,
    trimStorage: trimStorage
  };
})();

/* ============================================================
 * 存储就绪提示：账号/作品/图片仍在临时存储时必须显式告警，
 * 不能把「写进了本地文件 + 本地盘」显示成「已同步」。
 * ============================================================ */
(function () {
  'use strict';
  if (window.HMStorageNotice) return;
  var el = null;

  function hide() { if (el) el.style.display = 'none'; }

  function show(text) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'hmStorageNotice';
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:560px;' +
        'padding:10px 14px;border-radius:12px;font-size:12px;line-height:1.6;color:#fecaca;' +
        'background:rgba(69,10,10,.95);border:1px solid rgba(248,113,113,.45);' +
        'box-shadow:0 8px 28px rgba(0,0,0,.45);cursor:pointer';
      el.title = '点击打开「设置 → 云同步」查看存储状态';
      el.addEventListener('click', function () {
        try {
          if (window.HMApp && window.HMApp.openAdmin) window.HMApp.openAdmin('sync');
          else if (window.HMApp && window.HMApp.openSettings) window.HMApp.openSettings();
        } catch (e) {}
      });
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
  }

  function refresh() {
    var api = window.HM && window.HM.api;
    var base = (api && api.base) || '';
    if (!base || (typeof location !== 'undefined' && location.protocol === 'file:')) return;
    Promise.all([
      fetch(base + '/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(base + '/auth/store-status', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (arr) {
      var h = arr[0] || {};
      var s = arr[1] || {};
      var ud = h.userData || {};
      var stores = h.stores || {};
      var accounts = (stores.accounts && stores.accounts.mode) || s.storage || '';
      var dataStore = ud.dataStore || (stores.userData && stores.userData.mode) || '';
      var objectStore = ud.objectStore || (stores.assets && stores.assets.mode) || '';
      var bad = [];
      if (accounts && accounts !== 'mysql') bad.push('账号库=' + (s.label || accounts));
      if (dataStore && dataStore !== 'mysql') bad.push('作品/项目=' + (ud.dataLabel || dataStore));
      if (objectStore && objectStore !== 's3') bad.push('图片=' + (ud.objectLabel || objectStore));
      if (!bad.length) { hide(); return; }
      show('⚠ 当前为临时存储：' + bad.join('，') + '。服务重启/重新部署后数据可能丢失，尚不能视为已同步。');
    });
  }

  window.HMStorageNotice = { refresh: refresh, hide: hide };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(refresh, 1200); });
  } else {
    setTimeout(refresh, 1200);
  }
  setTimeout(refresh, 8000);
})();

(function () {
  'use strict';

  if (window.HMSync) return;
  var api = window.HM && window.HM.api;
  if (!api) return;

  var LS_REV = 'anidream.rev.v1';
  var LS_SYNC = 'anidream.sync.v1';
  var LS_QUEUE = 'anidream.queue.v1';
  var DOC_KINDS = { desk: 1, compile: 1, publish: 1, prefs: 1, library: 1, draft: 1, api: 1 };

  var revs = read(LS_REV, { works: {}, docs: {}, fp: {}, docfp: {} });
  if (!revs.docfp) revs.docfp = {};
  var sync = read(LS_SYNC, { lastSync: 0, migrated: {}, conflicts: 0, lastError: '' });
  /* 历史版本把每次 409 乐观锁重试都累加到 conflicts 并永久持久化，数字只增不减
     （线上看到的 571 就是历次自动重试的累计值，不是 571 条待处理冲突）。
     现在 conflicts 只统计「自动合并失败、仍未解决」的冲突；升级时清零一次。 */
  if (sync.conflictSchema !== 2) {
    sync.conflicts = 0;
    sync.conflictSchema = 2;
    saveSync();
  }
  var queue = read(LS_QUEUE, []);
  var storage = null;
  var usage = null;
  var busy = false;
  var pushTimer = null;
  var panelEl = null;
  var lastPullAt = 0;

  /* ============================================================
   * 数据安全层（事故修复）：
   *   1. 本地作品来源永远是「所有候选键的并集」，不依赖单一 key
   *   2. 任何覆盖写之前先做带时间戳快照（保留最近 3 份）
   *   3. 同步流程试图把作品列表写空 → 拦回快照内容，绝不落盘空数组
   * ============================================================ */
  var LS_WORK_PREFIX = 'anidream.works';
  var LEGACY_WORK_KEYS = ['anidream.works', 'hm.works', 'works', 'anidream.works.v1.bak'];
  var MAX_SNAPSHOTS = 3;
  var syncDepth = 0;

  function toast(msg, type) {
    try { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type || 'info'); } catch (e) {}
  }

  function itemId(w) {
    if (w && w.id) return String(w.id);
    return 'fp_' + fingerprint(w || {});
  }

  /* 并集合并：按 id 去重，时间新的字段优先，任何一条都不丢 */
  function mergeLists() {
    var map = Object.create(null);
    var order = [];
    Array.prototype.forEach.call(arguments, function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (w) {
        if (!w || typeof w !== 'object') return;
        var id = itemId(w);
        if (!map[id]) {
          map[id] = Object.assign({}, w, { id: id });
          order.push(id);
          return;
        }
        var cur = map[id];
        if (workTime(w) >= workTime(cur)) map[id] = Object.assign({}, cur, w, { id: id });
        else map[id] = Object.assign({}, w, cur, { id: id });
      });
    });
    return order.map(function (id) { return map[id]; }).sort(function (a, b) {
      return workTime(b) - workTime(a);
    });
  }

  /* 扫描本地所有可能存过作品的键（当前用户键 / .bak / .snap.* / 历史键名）
     注意：只取「当前用户 + 无后缀的访客键」，不读其它用户的键，避免串号。 */
  function collectLocalWorks(userId) {
    var u = userId || uid();
    var prefix = u ? 'anidream.works.v1.' + u : '';
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (LEGACY_WORK_KEYS.indexOf(k) >= 0) { keys.push(k); continue; }
        if (k === 'anidream.works.v1' || k === 'anidream.works.v1.bak') { keys.push(k); continue; }
        if (prefix && (k === prefix || k.indexOf(prefix + '.') === 0)) keys.push(k);
      }
    } catch (e) {}
    var lists = [];
    keys.forEach(function (k) {
      try {
        var raw = localStorage.getItem(k);
        if (!raw || raw.length < 3) return;
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) lists.push(arr);
      } catch (e) {}
    });
    return mergeLists.apply(null, lists);
  }

  function userWorkKey(u) { return 'anidream.works.v1.' + u; }

  function snapshotKeys(u) {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (k && k.indexOf(userWorkKey(u) + '.snap.') === 0) out.push(k);
      }
    } catch (e) {}
    out.sort();
    return out;
  }

  function pruneSnapshots(u) {
    var keys = snapshotKeys(u);
    while (keys.length > MAX_SNAPSHOTS) {
      try { localStorage.removeItem(keys.shift()); } catch (e) {}
    }
  }

  /* 覆盖写之前调用：把「磁盘上现有的」作品列表备份成 .snap.<时间戳>
     注意：快照本身也占 localStorage 配额，写太勤会把 hm.token 挤掉，
     导致「刷新后要重新登录」。因此自动快照必须节流 + 限体积。 */
  var SNAP_MIN_INTERVAL = 60000;              /* 自动快照最快 1 分钟一次 */
  var SNAP_MAX_BYTES = 512 * 1024;            /* 单份快照上限 512KB */
  var lastSnapAt = 0;

  function snapshotWorks(reason) {
    var u = uid();
    if (!u) return null;
    var force = reason === 'recover';
    if (!force && Date.now() - lastSnapAt < SNAP_MIN_INTERVAL) return null;
    var key = userWorkKey(u);
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (!raw || raw.length < 3 || raw === '[]') return null;
    if (!force && raw.length > SNAP_MAX_BYTES) {
      console.warn('[HMSync] 作品列表过大（' + Math.round(raw.length / 1024) + 'KB），跳过自动快照以免挤占登录态');
      return null;
    }
    var snapKey = key + '.snap.' + Date.now();
    try { localStorage.setItem(snapKey, raw); }
    catch (e) {
      /* 配额满：先回收旧快照/离线队列再重试一次 */
      if (window.HMAuth && window.HMAuth.trimStorage) window.HMAuth.trimStorage();
      try { localStorage.setItem(snapKey, raw); } catch (e2) { return null; }
    }
    lastSnapAt = Date.now();
    pruneSnapshots(u);
    if (force) console.log('[HMSync] 恢复前已快照', snapKey);
    return snapKey;
  }

  function latestSnapshot(u) {
    var keys = snapshotKeys(u);
    if (!keys.length) return [];
    try {
      var arr = JSON.parse(localStorage.getItem(keys[keys.length - 1]) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  /* 由 saveWorks 在写入前调用 */
  function beforePersist(list) {
    snapshotWorks('saveWorks');
    if (syncDepth) {
      if (Array.isArray(list) && list.length) return;
      var prev = latestSnapshot(uid());
      if (!prev.length) return;
      if (window.HMApp && window.HMApp.state) window.HMApp.state.works = prev;
      sync.lastError = '同步返回空列表，已阻止清空本地作品，并从快照恢复 ' + prev.length + ' 条';
      saveSync();
      toast('已阻止一次空列表覆盖，本地作品已从快照恢复', 'warn');
      return;
    }
    /* 用户主动把列表删空（单条删完/多选删除/清空）：记标记，避免下次进页面被自动恢复"复活" */
    if (Array.isArray(list) && !list.length && uid()) {
      try { localStorage.setItem('hmsync.clearedAt.' + uid(), String(Date.now())); } catch (e) {}
    }
  }

  function runSyncWrite(fn) {
    syncDepth += 1;
    try { return fn(); } finally { syncDepth -= 1; }
  }

  /* 读取 IndexedDB 里所有 blob（作品 id → data URL），用于恢复入口 */
  function idbAll() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('anidream', 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onerror = function () { resolve({}); };
        req.onsuccess = function () {
          var db = req.result;
          var out = {};
          try {
            var cur = db.transaction('blobs', 'readonly').objectStore('blobs').openCursor();
            cur.onerror = function () { resolve(out); };
            cur.onsuccess = function (e) {
              var c = e.target.result;
              if (!c) { resolve(out); return; }
              out[String(c.key)] = c.value;
              c.continue();
            };
          } catch (e) { resolve({}); }
        };
      } catch (e) { resolve({}); }
    });
  }

  function read(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v && typeof v === 'object' ? v : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function saveRevs() { write(LS_REV, revs); }
  function saveSync() { write(LS_SYNC, sync); }
  function saveQueue() { write(LS_QUEUE, queue); }
  function user() { return (window.HMApp && window.HMApp.user) || null; }
  function uid() { var u = user(); return u && u.id ? u.id : ''; }

  function urlOf(path) {
    var base = String(api.base || '').replace(/\/+$/, '');
    return base + path;
  }

  function request(method, path, body, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 45000);
    var token = '';
    try { token = localStorage.getItem('hm.token') || ''; } catch (e) {}
    var init = {
      method: method,
      headers: Object.assign({ Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      signal: controller.signal
    };
    /* GET/HEAD 不能带 body：原来传 null 也会序列化成 "null"，
       浏览器直接抛「Request with GET/HEAD method cannot have body」，
       导致登录后拉取 bootstrap / docs 全军覆没 */
    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(urlOf(path), init).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = raw; }
        if (!res.ok) {
          var err = new Error((data && data.error && data.error.message) || ('请求失败 HTTP ' + res.status));
          err.status = res.status;
          err.code = data && data.error && data.error.code;
          err.hint = data && data.error && data.error.hint;
          err.data = data;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        err = new Error('请求超时');
        err.offline = true;
      } else if (err && !err.status) {
        err.offline = true;
      }
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(36) + ':' + str.length;
  }
  function fingerprint(work) {
    return hash(JSON.stringify({
      p: work.prompt || '',
      u: (work.url || '').slice(0, 160),
      t: work.thumb ? work.thumb.length : 0,
      n: work.name || '',
      c: work.createdAt || 0,
      r: work.ratioId || '',
      s: work.scaleId || '',
      m: work.modelId || ''
    }));
  }
  function workTime(work) {
    var v = work && (work._updatedAt || work.updatedAt || work.createdAt);
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }

  /* ---------------- 作品推送 ---------------- */
  function onWorksChanged() {
    if (!uid()) return;
    /* 恢复入口刚把本地作品挂回列表时，先不要立刻回传云端（避免用恢复结果覆盖云端） */
    if (sync.pausedUntil && Date.now() < sync.pausedUntil) return;
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      pushDirtyWorks();
    }, 900);
  }

  async function pushDirtyWorks() {
    if (!uid() || busy) return;
    if (!window.HMApp || !Array.isArray(window.HMApp.state && window.HMApp.state.works)) return;
    busy = true;
    try {
      await window.HMApp.hydrateWorks();
      var works = window.HMApp.state.works.filter(function (w) { return w && w.id; });
      for (var i = 0; i < works.length; i += 1) {
        var w = works[i];
        var key = uid() + ':' + w.id;
        if (revs.fp[key] && revs.fp[key] === fingerprint(w)) continue;
        await pushOne(w);
      }
      if (window.HMApp.saveWorks) window.HMApp.saveWorks();
      sync.lastSync = Date.now();
      sync.lastError = '';
      saveSync();
    } catch (err) {
      sync.lastError = (err && err.message) || '同步失败';
      saveSync();
    } finally {
      busy = false;
      renderPanel();
    }
  }

  /* 把上游直链（可能是临时签名地址）读成 dataUrl，才能落到账号资产库。
     先生成图/视频直连 URL 过期后，换设备就会整片打不开——这一步是根治。 */
  async function remoteToDataUrl(url) {
    try {
      var r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var blob = await r.blob();
      if (!/^(image|video)\//.test(blob.type || '')) throw new Error('不是媒体类型');
      return await new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(blob);
      });
    } catch (e) {
      /* 没有 CORS 头时退一步：用 crossorigin 图片画进 canvas */
      var img = await new Promise(function (resolve, reject) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('图片跨域不可读')); };
        im.src = url;
      });
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    }
  }

  async function uploadAsset(work) {
    if (!work || typeof work.url !== 'string' || !work.url) return work;
    /* 已镜像过（服务端有 _assetId，每次 /works 会重新签发新链接）*/
    if (work._assetId) return work;
    var src = work.url;
    if (src.indexOf('data:') !== 0) {
      if (!/^https?:/i.test(src)) return work;
      var mirrored = null;
      try { mirrored = await remoteToDataUrl(src); } catch (e) { mirrored = null; }
      if (!mirrored) {
        /* 跨域读不到：保留原直链，6 小时内不再重试，避免每次同步都白跑一次下载 */
        work._mirrorFailAt = Date.now();
        return work;
      }
      work.rawUrl = work.rawUrl || src;
      src = mirrored;
    }
    /* 无论上传是否成功，先把原图字节留在本机 IndexedDB：
       上游直链以后失效时，这台设备还能重新镜像，不会连原图一起丢 */
    try { idbPutBlob(work.id, src); } catch (e) {}
    var res = await request('POST', '/works/' + encodeURIComponent(work.id) + '/asset', { dataUrl: src }, 120000);    if (!res || !res.asset) return work;
    work.url = res.asset.url;
    work._assetId = res.asset.assetId;
    work._assetBytes = res.asset.bytes;
    work._updatedAt = Date.now();
    /* 关键：不删除 IndexedDB 里的原图。对象存储未配置时图片落在 Render 本地盘，
       重新部署/重启后 URL 会 404，本地 blob 是唯一还能救回来的来源。 */
    work.blob = true;
    work._localBlobKept = true;
    usage = res.usage || usage;
    return work;
  }

  async function pushOne(work) {
    if (!work || !work.id) return null;
    if (work.url && (work.url.indexOf('data:') === 0 ||
        (!work._assetId && /^https?:/i.test(work.url) &&
          !(work._mirrorFailAt && Date.now() - work._mirrorFailAt < 6 * 3600 * 1000)))) {
      await uploadAsset(work);
    }
    var key = uid() + ':' + work.id;
    var payload = Object.assign({}, work);
    delete payload._rev;
    var body = { work: payload };
    if (revs.works[work.id] != null) body.rev = revs.works[work.id];
    try {
      var res = await request('POST', '/works', body, 45000);
      if (res && res.rev != null) {
        revs.works[work.id] = res.rev;
        revs.fp[key] = fingerprint(work);
        saveRevs();
      }
      return res;
    } catch (err) {
      if (err.status === 409) {
        /* 409 是乐观锁「版本号过期」，不是数据损坏：下面会拿服务端当前版本
           自动合并或强制重推。只有这一步也失败，才算真正未解决的冲突。 */
        var cur = err.data && err.data.current;
        if (!cur) {
          /* 旧 /works 列表会带全部内联图（>6MB），SCF 网关 406 且无 CORS 头；
             改用已瘦身的 bootstrap 取当前作品。 */
          var snap = await request('GET', '/user-data/bootstrap', null, 30000);
          (snap && snap.works || []).forEach(function (w) { if (w.id === work.id) cur = w; });
        }
        if (cur && Number(cur._updatedAt) > workTime(work)) {
          applyServerWork(cur);
          saveRevs(); saveSync();
          return null;
        }
        var rev = cur && cur._rev != null ? cur._rev : null;
        var force = { work: payload };
        if (rev != null) force.rev = rev;
        try {
          var retry = await request('POST', '/works', force, 45000);
          if (retry && retry.rev != null) {
            revs.works[work.id] = retry.rev;
            revs.fp[key] = fingerprint(work);
            saveRevs();
          }
          return retry;
        } catch (mergeErr) {
          sync.conflicts += 1;
          saveSync();
          throw mergeErr;
        }
      }
      throw err;
    }
  }

  function applyServerWork(serverWork) {
    if (!window.HMApp || !window.HMApp.state || !Array.isArray(window.HMApp.state.works)) return;
    var list = window.HMApp.state.works;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === serverWork.id) {
        var keepLocalImage = list[i].url && list[i].url.indexOf('data:') === 0 && !serverWork.url;
        list[i] = Object.assign({}, serverWork, keepLocalImage ? { url: list[i].url } : {});
        return;
      }
    }
    list.unshift(serverWork);
  }

  /* ---------------- 删除同步 ---------------- */
  async function deleteWorks(ids) {
    if (!uid() || !Array.isArray(ids)) return;
    for (var i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      var rev = revs.works[id];
      var path = '/works/' + encodeURIComponent(id) + (rev != null ? '?rev=' + rev : '');
      try {
        await request('DELETE', path, null, 20000);
        delete revs.works[id];
        delete revs.fp[uid() + ':' + id];
        saveRevs();
      } catch (err) {
        if (err.status === 404) continue;
        queue.push({ op: 'delete', id: id, ts: Date.now() });
        saveQueue();
      }
    }
    sync.lastSync = Date.now();
    saveSync();
    renderPanel();
  }

  /* ---------------- 清空全部作品 ---------------- */
  async function clearAll() {
    if (!uid()) return;
    try {
      await request('DELETE', '/works', null, 30000);
      revs.works = {};
      revs.fp = {};
      saveRevs();
    } catch (err) {
      if (err.offline || !err.status) {
        queue.push({ op: 'clear', ts: Date.now() });
        saveQueue();
      }
    }
    sync.lastSync = Date.now();
    saveSync();
  }

  /* ---------------- 文档（desk/compile/publish/prefs） ---------------- */
  function docKey(kind) {
    var u = uid();
    if (kind === 'desk') return 'anidream.desk.v1' + (u ? '.' + u : '');
    if (kind === 'compile') return 'anidream.compile.v1';
    if (kind === 'publish') return 'anidream.publish.v1';
    if (kind === 'prefs') return 'anidream.prefs.v1';
    if (kind === 'library') return 'anidream.library.area.v1';
    if (kind === 'draft') return 'anidream.draft.v1';
    if (kind === 'api') return 'anidream.api.v1';
    return '';
  }

  async function pushDoc(kind, data, opts) {
    if (!uid() || !DOC_KINDS[kind]) return null;
    var body = { data: data };
    if (revs.docs[kind] != null) body.rev = revs.docs[kind];
    try {
      var res = await request('PUT', '/docs/' + kind, body, 30000);
      if (res && res.doc) revs.docs[kind] = res.doc.rev;
      revs.docfp[kind] = hash(JSON.stringify(data));
      saveRevs();
      return res;
    } catch (err) {
      if (err.status === 409) {
        /* 同作品逻辑：409 先尝试自动合并/强制重推，失败才计入未解决冲突 */
        var cur = (err.data && err.data.doc) || null;
        if (!cur) {
          var got = await request('GET', '/docs/' + kind, null, 15000);
          cur = got && got.doc;
        }
        var localTs = Number(data && data.updatedAt) || Date.now();
        var remoteTs = Number(cur && cur.updatedAt) || 0;
        if (remoteTs > localTs && cur && cur.data) {
          applyDoc(kind, cur.data, cur.rev);
          saveSync();
          return null;
        }
        var force = { data: data, rev: cur ? cur.rev : undefined };
        try {
          var retry = await request('PUT', '/docs/' + kind, force, 30000);
          if (retry && retry.doc) revs.docs[kind] = retry.doc.rev;
          saveRevs();
          saveSync();
          return retry;
        } catch (mergeErr) {
          sync.conflicts += 1;
          saveSync();
          throw mergeErr;
        }
      }
      if (err.offline) {
        if (opts && opts.strict) throw err;
        queue.push({ op: 'doc', kind: kind, data: data, ts: Date.now() });
        saveQueue();
        return null;
      }
      throw err;
    }
  }

  function pushPrefs() {
    var prefs = read('anidream.prefs.v1', null);
    if (prefs) pushDoc('prefs', prefs).catch(function () {});
  }

  /* 阅读分区 + PDF 阅读模式：合并成一个 library 文档，随账号走 */
  function pushLibraryPrefs() {
    if (!uid()) return null;
    /* 这两个键是字符串/数字，不能用只认对象的 read()，否则会读出 null */
    var area = null, pdfMode = null;
    try {
      var rawArea = localStorage.getItem('anidream.library.area.v1');
      if (rawArea) {
        try { area = JSON.parse(rawArea); } catch (e2) { area = rawArea; }
      }
    } catch (e) {}
    try { pdfMode = localStorage.getItem('anidream.library.pdfmode.v1'); } catch (e) {}
    /* 原画资料的文件夹拖拽顺序：随同一个 library 文档同步 */
    var conceptOrder = null;
    try {
      var rawOrder = localStorage.getItem('anidream.library.conceptOrder.v1');
      if (rawOrder) conceptOrder = JSON.parse(rawOrder);
    } catch (e) {}
    var data = { area: area, pdfMode: pdfMode, conceptOrder: conceptOrder, updatedAt: Date.now() };
    return pushDoc('library', data).catch(function (err) {
      if (err && err.offline) return;
      toast('阅读偏好同步失败：' + ((err && err.message) || '网络异常'), 'error');
    });
  }

  /* 写作草稿（纯文本）随账号走；大体积画布草稿不走这里 */
  function pushDraftDoc(draft) {
    if (!uid() || !draft || typeof draft.text !== 'string') return null;
    return pushDoc('draft', { text: draft.text, at: Number(draft.at) || Date.now() }).catch(function (err) {
      if (err && err.offline) return;
      toast('草稿同步失败：' + ((err && err.message) || '网络异常'), 'error');
    });
  }

  function applyDoc(kind, data, rev) {
    /* library：一个文档拆回两个本地键，不能按整 JSON 覆盖 area 键 */
    if (kind === 'library') {
      if (data && typeof data === 'object') {
        try {
          if (data.area != null) localStorage.setItem('anidream.library.area.v1', JSON.stringify(data.area));
          if (data.pdfMode != null) localStorage.setItem('anidream.library.pdfmode.v1', String(data.pdfMode));
          if (data.conceptOrder != null) localStorage.setItem('anidream.library.conceptOrder.v1', JSON.stringify(data.conceptOrder));
        } catch (e) {}
      }
      if (rev != null) { revs.docs[kind] = rev; saveRevs(); }
      revs.docfp[kind] = hash(JSON.stringify(data));
      if (window.HMLibrary && window.HMLibrary.applyRemotePrefs) {
        try { window.HMLibrary.applyRemotePrefs(); } catch (e) {}
      }
      return;
    }
    /* draft：时间戳旧的远端草稿不能覆盖本机更新的内容 */
    if (kind === 'draft') {
      var local = read('anidream.draft.v1', null) || {};
      var remoteAt = Number(data && data.at) || 0;
      var localAt = Number(local.at) || 0;
      if (data && remoteAt >= localAt) {
        try { localStorage.setItem('anidream.draft.v1', JSON.stringify({ text: data.text || '', at: remoteAt })); } catch (e) {}
        var input = document.getElementById('writingInput');
        if (input && !input.value && data.text) {
          input.value = data.text;
          var count = document.getElementById('writingCount');
          if (count) count.textContent = input.value.length + ' / 6000';
        }
      }
      if (rev != null) { revs.docs[kind] = rev; saveRevs(); }
      revs.docfp[kind] = hash(JSON.stringify(data));
      return;
    }
    var key = docKey(kind);
    if (!key || data == null) return;
    /* api：云端文档缺 Key 时保留本机已有 Key，避免刷新后凭证被清空 */
    if (kind === 'api' && typeof data === 'object') {
      try {
        var prev = read(key, null) || {};
        data = JSON.parse(JSON.stringify(data));
        var cp = data.providers || (data.providers = {});
        var lp = prev.providers || {};
        Object.keys(lp).forEach(function (id) {
          if (!cp[id]) cp[id] = lp[id];
          else if (!cp[id].key && lp[id] && lp[id].key) cp[id].key = lp[id].key;
        });
        /* 云端缺类型/计费时保留本机已有值，避免拉取时丢数据 */
        var cb = data.bindings || (data.bindings = {});
        var lb = prev.bindings || {};
        Object.keys(lb).forEach(function (id) { if (!cb[id] && lb[id]) cb[id] = lb[id]; });
        var cbi = data.billing || (data.billing = {});
        var lbi = prev.billing || {};
        Object.keys(lbi).forEach(function (id) { if (!cbi[id] && lbi[id]) cbi[id] = lbi[id]; });
        if ((!data.rayin || !data.rayin.key) && prev.rayin && prev.rayin.key) {
          data.rayin = Object.assign({}, prev.rayin, data.rayin || {});
        }
      } catch (e) {}
    }
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
    if (rev != null) { revs.docs[kind] = rev; saveRevs(); }
    revs.docfp[kind] = hash(JSON.stringify(data));
    if (kind === 'desk' && window.HMDesk && window.HMDesk.reloadForUser) {
      window.HMDesk.reloadForUser();
    } else if (window.HMCloudReload && window.HMCloudReload[kind]) {
      try { window.HMCloudReload[kind](); } catch (e) {}
    } else if (kind === 'prefs' && window.HMApp && window.HMApp.state) {
      try {
        Object.assign(window.HMApp.state, data);
        if (window.HMApp.syncSettingsUI) window.HMApp.syncSettingsUI();
        /* 通知各模块（如首尾帧补间服务地址）把云端值刷回输入框 */
        document.dispatchEvent(new CustomEvent('hm:prefs'));
      } catch (e) {}
    }
  }

  /* ---------------- 自动重试 + 断线接回 ----------------
   * 一次失败不允许长期停在红字：
   *   1) 拉取本身先做短退避重试，吃掉网关瞬时 406/5xx/断网；
   *   2) 仍失败则按 5s→120s 指数退避在后台重连，成功即刻清空错误；
   *   3) 网络恢复（online）、页面重新可见、手动同步都会立即再试一次。 */
  var retryTimer = null;
  var retryCount = 0;
  var RETRY_DELAYS = [5000, 10000, 20000, 40000, 60000, 120000];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryCount = 0;
    sync.retryAt = 0;
    sync.retryCount = 0;
  }

  function scheduleRetry() {
    if (!uid() || retryTimer) return;
    var delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    retryCount += 1;
    sync.retryAt = Date.now() + delay;
    sync.retryCount = retryCount;
    saveSync();
    renderPanel();
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!uid()) { retryCount = 0; return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { scheduleRetry(); return; }
      lastPullAt = 0;
      afterLogin(true);
    }, delay);
  }

  /* bootstrap 单次请求内部再重试 2 次（间隔 1.2s / 3s）；
     401/403 是登录态问题，重试无意义，直接抛给上层。 */
  function pullBootstrap() {
    var delays = [0, 1200, 3000];
    var attempt = 0;
    function next() {
      return request('GET', '/user-data/bootstrap', null, 30000).catch(function (err) {
        if (err && (err.status === 401 || err.status === 403)) throw err;
        attempt += 1;
        if (attempt >= delays.length) throw err;
        return sleep(delays[attempt]).then(next);
      });
    }
    return next();
  }

  /* ---------------- 登录后：拉取 + 迁移 ----------------
   * 铁律：拉取失败 / 401 / 403 / 超时 / 结构异常 / 云端为空，都不允许改动本地作品。 */
  async function afterLogin(force) {
    if (!uid() || busy || !window.HMApp) return;
    if (!force && Date.now() - lastPullAt < 20000) return;
    lastPullAt = Date.now();
    /* 登录后后台补传 + 逐步迁移本地老原图（成功一张释放一张） */
    setTimeout(function () {
      try { migrateLocalOriginals(3); } catch (e) {}
      try { retryPendingUploads(); } catch (e) {}
    }, 3000);
    busy = true;
    try {
      await window.HMApp.hydrateWorks();
      var boot;
      try {
        boot = await pullBootstrap();
      } catch (err) {
        sync.lastError = '云端拉取失败（' + ((err && err.message) || '网络异常') +
          (err && err.status ? ' HTTP ' + err.status : '') + '），本机作品保持不变；已转入自动重连';
        saveSync();
        renderPanel();
        scheduleRetry();
        return;
      }
      if (!boot || typeof boot !== 'object') {
        sync.lastError = '云端返回结构异常，已忽略本次同步，本机作品保持不变；稍后自动重试';
        saveSync();
        renderPanel();
        scheduleRetry();
        return;
      }
      /* 拉取成功：先清掉历史遗留的失败提示，再落地数据（applyBootstrap 自己的告警不受影响） */
      sync.lastError = '';
      clearRetry();
      applyBootstrap(boot);
      await migrateLocal();
      await flushQueue();
      sync.lastSync = Date.now();
      saveSync();
    } catch (err) {
      sync.lastError = (err && err.message) || '拉取失败';
      saveSync();
      renderPanel();
      scheduleRetry();
    } finally {
      busy = false;
      renderPanel();
    }
  }

  function validWork(w) {
    return !!(w && typeof w === 'object' && (w.id || w.url || w.thumb || w.failed || w.ok === false));
  }

  function applyBootstrap(boot) {
    if (!boot || typeof boot !== 'object') return;
    storage = boot.storage || storage;
    usage = boot.usage || usage;

    /* 结构异常（字段名变动 / 被网关改写）：不动本地，不保存 */
    if (!Array.isArray(boot.works)) {
      sync.lastError = '云端作品字段缺失（works 不是数组），已忽略，本机作品保持不变';
      saveSync();
      return;
    }

    /* 账号数据（含阅读偏好/草稿）必须先落地，再做作品渲染，
       避免本地空默认值把线上值盖掉；作品为空也不能跳过这一步 */
    var docs = boot.docs || {};
    Object.keys(DOC_KINDS).forEach(function (kind) {
      var d = docs[kind];
      if (!d || d.data == null) return;
      var localRev = Number(revs.docs[kind]) || 0;
      /* rev 是浏览器级计数，换账号/换设备后可能高于云端；
         云端文档的 updatedAt 更新时也要落地，避免服务端新数据被本地旧数据挡住 */
      var cloudAt = Number(d.data && d.data.updatedAt) || 0;
      var localAt = 0;
      try {
        var lk = docKey(kind);
        var ld = lk ? read(lk, null) : null;
        localAt = Number(ld && ld.updatedAt) || 0;
      } catch (e) {}
      if (!localRev || Number(d.rev) > localRev || (cloudAt && cloudAt > localAt)) applyDoc(kind, d.data, d.rev);
      else revs.docs[kind] = Number(d.rev);
    });
    saveRevs();

    var serverWorks = boot.works.filter(validWork);
    var deleted = Array.isArray(boot.deleted) ? boot.deleted : [];
    var deletedMap = {};
    deleted.forEach(function (d) { if (d && d.id) deletedMap[String(d.id)] = Number(d.updatedAt) || 0; });

    /* 本地作品 = 所有本地候选键 ∪ 当前内存列表 */
    var local = mergeLists(collectLocalWorks(uid()), (window.HMApp.state && window.HMApp.state.works) || []);
    var localMap = {};
    local.forEach(function (w) { localMap[itemId(w)] = w; });

    /* 云端为空：保留本地全部作品并标记待上传，绝不写空 */
    if (!serverWorks.length) {
      if (!local.length) return;
      local.forEach(function (w) { w._pendingUpload = true; });
      runSyncWrite(function () {
        window.HMApp.state.works = local;
        if (window.HMApp.saveWorks) window.HMApp.saveWorks();
        if (window.HMApp.renderWorks) window.HMApp.renderWorks();
      });
      toast('云端暂无作品，已保留本机 ' + local.length + ' 条', 'info');
      return;
    }

    var merged = [];
    serverWorks.forEach(function (sw) {
      var sid = itemId(sw);
      var lw = localMap[sid];
      var tomb = deletedMap[sid];
      var serverTs = Number(sw._updatedAt) || 0;
      if (lw && (workTime(lw) > serverTs || (tomb && workTime(lw) > tomb))) {
        /* 本地更新（例如离线期间生成）：保留并标记待上传 */
        merged.push(Object.assign({}, lw, { _pendingUpload: true }));
      } else {
        merged.push(sw);
        revs.works[sid] = sw._rev;
        revs.fp[uid() + ':' + sid] = fingerprint(sw);
      }
      delete localMap[sid];
    });
    Object.keys(localMap).forEach(function (id) {
      var lw = localMap[id];
      var tomb = deletedMap[id];
      if (tomb && workTime(lw) <= tomb) return; /* 其它设备已删除且本地没有更新 */
      merged.push(Object.assign({}, lw, { _pendingUpload: true }));
    });

    merged.sort(function (a, b) { return workTime(b) - workTime(a); });
    runSyncWrite(function () {
      window.HMApp.state.works = merged;
      if (window.HMApp.saveWorks) window.HMApp.saveWorks();
      if (window.HMApp.renderWorks) window.HMApp.renderWorks();
    });
  }

  async function migrateLocal() {
    if (!uid()) return;
    var state = (window.HMApp && window.HMApp.state) || {};
    var works = (state.works || []).filter(function (w) { return w && w.id; });
    for (var i = 0; i < works.length; i += 1) {
      var w = works[i];
      var key = uid() + ':' + w.id;
      if (revs.fp[key] && revs.fp[key] === fingerprint(w)) continue;
      await pushOne(w);
    }

    /* 文档：本地有内容且比服务端新才写（后端同样按 updatedAt 兜底） */
    var docs = {
      desk: read(docKey('desk'), null),
      compile: read(docKey('compile'), null),
      publish: read(docKey('publish'), null),
      prefs: read(docKey('prefs'), null)
    };
    var kinds = Object.keys(docs);
    for (var k = 0; k < kinds.length; k += 1) {
      var kind = kinds[k];
      if (docs[kind] == null) continue;
      if (revs.docfp[kind] && revs.docfp[kind] === hash(JSON.stringify(docs[kind]))) continue;
      await pushDoc(kind, docs[kind]);
    }

    sync.migrated[uid()] = Date.now();
    saveSync();
    if (window.HMApp.saveWorks) window.HMApp.saveWorks();
  }

  /* ---------------- 恢复本地备份（一次性、可重复、不重复插入、不回写云端） ---------------- */
  async function recoverLocal() {
    if (!window.HMApp || !window.HMApp.state) return { restored: 0 };
    var local = mergeLists(collectLocalWorks(uid()), window.HMApp.state.works || []);
    var blobs = await idbAll();
    var known = {};
    local.forEach(function (w) { known[itemId(w)] = 1; });

    /* 列表里已经没有、但 IndexedDB 还留着图的孤儿 blob → 也挂回列表 */
    var orphans = 0;
    Object.keys(blobs).forEach(function (id) {
      if (known[id]) return;
      local.push({
        id: id,
        type: 'image',
        url: blobs[id],
        ok: true,
        blob: true,
        prompt: '',
        createdAt: Date.now(),
        _recoveredLocal: true
      });
      known[id] = 1;
      orphans += 1;
    });

    var withImage = 0;
    var missing = 0;
    var remoteOnly = 0;
    local.forEach(function (w) {
      if (blobs[w.id]) {
        /* 本地原图优先：远端签名 URL 可能因为 Render 重启/重新部署已经 404 */
        if (w.url && String(w.url).indexOf('data:') !== 0) w._remoteUrl = w.url;
        w.url = blobs[w.id];
        w.blob = true;
      }
      if (w.url || (w.thumb && String(w.thumb).indexOf('data:') === 0)) {
        withImage += 1;
        if (!blobs[w.id] && !w.thumb && /^https?:/.test(String(w.url || ''))) remoteOnly += 1;
      } else missing += 1;
      w._recoveredLocal = true;
      w._pendingUpload = true; /* 只标待上传，不立刻回写云端 */
    });
    local.sort(function (a, b) { return workTime(b) - workTime(a); });

    if (!local.length) {
      toast('本机没有找到可恢复的作品数据（localStorage 与 IndexedDB 都是空的）', 'warn', 7000);
      return { restored: 0, withImage: 0, missing: 0, orphans: 0, remoteOnly: 0 };
    }

    snapshotWorks('recover');
    sync.pausedUntil = Date.now() + 120000; /* 2 分钟内不自动回传，避免恢复结果覆盖云端 */
    try { localStorage.removeItem('hmsync.clearedAt.' + uid()); } catch (e) {}
    window.HMApp.state.works = local;
    if (window.HMApp.saveWorks) window.HMApp.saveWorks();
    if (window.HMApp.renderWorks) window.HMApp.renderWorks();
    sync.lastError = '';
    saveSync();
    renderPanel();
    toast('已从本机恢复 ' + local.length + ' 条（本地图 ' + withImage + ' 条，缺图 ' + missing +
      ' 条，孤儿图 ' + orphans + ' 条' + (remoteOnly ? '，仅剩远端链接 ' + remoteOnly + ' 条可能已失效' : '') +
      '），未回写云端', 'success', 9000);
    return { restored: local.length, withImage: withImage, missing: missing, orphans: orphans, remoteOnly: remoteOnly };
  }

  /* ---------------- 离线队列 ---------------- */
  async function flushQueue() {
    if (!queue.length || !uid()) return;
    var pending = queue.slice();
    queue = [];
    saveQueue();
    for (var i = 0; i < pending.length; i += 1) {
      var item = pending[i];
      try {
        if (item.op === 'delete') await deleteWorks([item.id]);
        else if (item.op === 'doc') await pushDoc(item.kind, item.data);
        else if (item.op === 'clear') await clearAll();
      } catch (e) {
        queue.push(item);
        saveQueue();
      }
    }
  }

  window.addEventListener('online', function () {
    setTimeout(function () {
      if (uid()) { lastPullAt = 0; afterLogin(true); }
      flushQueue().then(function () { pushDirtyWorks(); });
    }, 1500);
  });

  /* 长时间停留后台再切回来：上次失败或数据已过期，立即补拉一次 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !uid() || busy) return;
    if (sync.lastError || Date.now() - (Number(sync.lastSync) || 0) > 300000) {
      lastPullAt = 0;
      afterLogin(true);
    }
  });

  /* ---------------- 设置页「云同步」面板 ---------------- */
  function ensurePanel() {
    var host = document.getElementById('view-admin');
    if (!host) return null;
    if (panelEl && panelEl.parentNode === host) return panelEl;
    panelEl = document.createElement('section');
    panelEl.className = 'hm-cloud-card';
    panelEl.style.cssText = 'margin:0 0 18px;padding:16px 18px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04)';
    host.insertBefore(panelEl, host.firstChild);
    return panelEl;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  function renderPanel() {
    var host = document.getElementById('view-admin');
    if (!host || host.hidden) return;
    var el = ensurePanel();
    if (!el) return;
    var st = storage || { dataLabel: '检测中…', objectLabel: '检测中…', warnings: [] };
    var u = usage || {};
    var warn = (st.warnings || []).map(function (w) {
      return '<div style="color:#fca5a5;font-size:12px;margin-top:4px">⚠ ' + w + '</div>';
    }).join('');
    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<div><b style="font-size:15px">云同步 · 跨设备数据</b>' +
        '<div style="color:#a5a0c0;font-size:12px;margin-top:4px">账号数据按 user_id 存后端；本机 localStorage/IndexedDB 仅作缓存。</div></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" id="hmSyncNow" class="hm-pill">立即同步</button>' +
          '<button type="button" id="hmClaimLegacy" class="hm-pill">认领历史数据</button>' +
          '<button type="button" id="hmSyncExport" class="hm-pill">导出备份</button>' +
          '<button type="button" id="hmSyncMigrate" class="hm-pill">重新上传本机数据</button>' +
          '<button type="button" id="hmSyncRecover" class="hm-pill">恢复本地备份</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;font-size:12.5px">' +
        '<div>结构数据：<b>' + st.dataLabel + '</b></div>' +
        '<div>图片存储：<b>' + st.objectLabel + '</b></div>' +
        '<div>作品：<b>' + (u.works != null ? u.works : '-') + ' / ' + (u.workCap || '-') + '</b></div>' +
        '<div>图片占用：<b>' + fmtBytes(u.bytes) + '</b></div>' +
        '<div>最近同步：<b>' + (sync.lastSync ? new Date(sync.lastSync).toLocaleString() : '尚未同步') + '</b></div>' +
        '<div>待重试：<b>' + queue.length + '</b> 条 · 冲突：<b>' + (sync.conflicts || 0) + '</b></div>' +
      '</div>' + warn +
      (sync.lastError
        ? '<div style="color:#f87171;font-size:12px;margin-top:6px">最近错误：' + String(sync.lastError).slice(0, 180) +
          (sync.retryAt && sync.retryAt > Date.now()
            ? '（第 ' + (sync.retryCount || 1) + ' 次自动重连将在 ' + Math.max(1, Math.round((sync.retryAt - Date.now()) / 1000)) + ' 秒后开始）'
            : '') +
          '</div>'
        : '');

    var btnNow = el.querySelector('#hmSyncNow');
    if (btnNow) btnNow.onclick = function () {
      btnNow.disabled = true;
      refreshStatus().then(function () { return afterLogin(true); }).finally(function () { btnNow.disabled = false; });
    };
    var btnExport = el.querySelector('#hmSyncExport');
    if (btnExport) btnExport.onclick = exportBackup;
    var btnClaim = el.querySelector('#hmClaimLegacy');
    if (btnClaim) btnClaim.onclick = function () {
      if (!window.HMClaim || typeof window.HMClaim.run !== 'function') return;
      btnClaim.disabled = true;
      window.HMClaim.run({ force: true }).then(function (res) {
        var msg = (res && res.ok === false)
          ? ('认领失败：' + (res.error || '未知错误'))
          : ('认领完成：作品 ' + ((res && res.works) || 0) + ' 条、桌面 ' + ((res && res.desk) || 0) + ' 项');
        toast(msg, res && res.ok === false ? 'error' : 'success');
        renderPanel();
      }).finally(function () { btnClaim.disabled = false; });
    };
    var btnMigrate = el.querySelector('#hmSyncMigrate');
    if (btnMigrate) btnMigrate.onclick = function () {
      revs.fp = {};
      revs.works = {};
      revs.docs = {};
      saveRevs();
      btnMigrate.disabled = true;
      migrateLocal().finally(function () { btnMigrate.disabled = false; renderPanel(); });
    };
    var btnRecover = el.querySelector('#hmSyncRecover');
    if (btnRecover) btnRecover.onclick = function () {
      if (!window.confirm('从本机 localStorage 快照与 IndexedDB 图片恢复作品？\n不会覆盖云端，恢复后只标记「待同步」。')) return;
      btnRecover.disabled = true;
      recoverLocal().finally(function () { btnRecover.disabled = false; });
    };
  }

  async function refreshStatus() {
    if (!uid()) return;
    try {
      var res = await request('GET', '/user-data/status', null, 15000);
      if (res) { storage = res.storage; usage = res.usage; renderPanel(); }
    } catch (e) {}
  }

  async function exportBackup() {
    if (!uid()) return;
    try {
      var controller = new AbortController();
      var token = '';
      try { token = localStorage.getItem('hm.token') || ''; } catch (e) {}
      var res = await fetch(urlOf('/user-data/export'), {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        signal: controller.signal
      });
      if (!res.ok) throw new Error('导出失败 HTTP ' + res.status);
      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'huimeng-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    } catch (err) {
      if (window.HMApp && window.HMApp.toast) window.HMApp.toast((err && err.message) || '导出失败', 'error');
    }
  }

  /* 设置页显示时刷新面板（switchView 会改 body[data-view]） */
  try {
    var mo = new MutationObserver(function () {
      if (document.body.getAttribute('data-view') === 'admin') {
        renderPanel();
        refreshStatus();
      }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  } catch (e) {}

  /* 启动：等 authBoot 把 user 写好后拉起同步（authBoot 会调 syncAllWorksToServer → afterLogin） */
  setTimeout(function () {
    if (uid()) { refreshStatus(); }
  }, 2500);

  /* 进页面自愈：本地列表为空但检测到历史作品/快照/blob → 自动从本机恢复一次（不依赖云端）。
     用户主动清空过的账号（clearedAt 标记）不会被"复活"。 */
  var autoRecovered = false;
  function maybeAutoRecover() {
    try {
      if (autoRecovered || !uid() || !window.HMApp || !window.HMApp.state) return;
      var list = window.HMApp.state.works || [];
      if (list.length) return;
      if (localStorage.getItem('hmsync.clearedAt.' + uid())) return;
      var cand = collectLocalWorks(uid());
      if (!cand.length) return;
      autoRecovered = true;
      console.warn('[HMSync] 本地列表为空但存在历史作品，自动恢复', cand.length, '条');
      recoverLocal();
    } catch (e) {}
  }
  setTimeout(maybeAutoRecover, 3000);
  setTimeout(maybeAutoRecover, 9000);

  window.addEventListener('beforeunload', function () { saveRevs(); saveSync(); saveQueue(); });

  /* ---------------- 防回归断言（运行期自检，控制台可复跑） ---------------- */
  function assertNoDataLoss() {
    var cases = [];
    var one = [{ id: 'w1', url: 'data:x', createdAt: 1 }];
    cases.push(['服务端空 + 本地非空 → 保留本地', mergeLists([], one).length === 1]);
    cases.push(['并集去重不产生重复', mergeLists(one, one).length === 1]);
    cases.push(['本地独有作品必须保留', mergeLists(one, [{ id: 'w2', createdAt: 2 }]).length === 2]);
    cases.push(['【事故回归】空 + 空 = 空，且不得触发写入', mergeLists([], []).length === 0]);
    cases.push(['非数组输入不抛错', Array.isArray(mergeLists(null, undefined, one))]);
    var failed = cases.filter(function (c) { return !c[1]; });
    if (failed.length) console.error('[HMSync] 防回归断言失败：', failed.map(function (c) { return c[0]; }));
    else console.log('[HMSync] 防回归断言通过（' + cases.length + ' 项）');
    return { ok: failed.length === 0, total: cases.length, failed: failed.map(function (c) { return c[0]; }) };
  }

  /* ---- 原图归档：本地空间不足时把原图存到后端，本地只留缩略图 + 地址 ---- */
  var PENDING_KEY = 'anidream.pendingUploads';
  function pendingIds() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function savePendingIds(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify((list || []).slice(0, 50))); } catch (e) {}
  }
  function markPendingUpload(id) {
    if (!id) return;
    var list = pendingIds();
    if (list.indexOf(id) < 0) list.unshift(id);
    savePendingIds(list);
  }

  async function archiveWork(work) {
    if (!work || !work.id) return { ok: false, reason: 'no-work' };
    if (!uid()) return { ok: false, reason: 'auth' };
    if (!api.online) {
      /* 离线也入队：联网后由 retryPendingUploads 自动补传，不能只留在内存里 */
      markPendingUpload(work.id);
      return { ok: false, reason: 'offline' };
    }
    var raw = (typeof work._pendingUrl === 'string' && work._pendingUrl) || work.url;
    if (!raw || (raw.indexOf('data:') !== 0 && !/^https?:/i.test(raw))) return { ok: false, reason: 'no-src' };
    if (work._assetId) {
      /* 已经在对象存储：直接释放本地整份副本 */
      try { idbDelBlob(work.id); } catch (e) {}
      work.blob = false;
      return { ok: true, url: work.url };
    }
    var backup = work.url;
    work.url = raw;
    try { await uploadAsset(work); } catch (e) {}
    if (!work._assetId) {
      work.url = backup;
      markPendingUpload(work.id);
      return { ok: false, reason: 'upload-failed' };
    }
    delete work._pendingUrl;
    /* 只在云端确实有副本后才删本机原图，避免两头都丢 */
    try { idbDelBlob(work.id); } catch (e) {}
    work.blob = false;
    work._localBlobKept = false;
    work._archivedAt = Date.now();
    savePendingIds(pendingIds().filter(function (x) { return x !== work.id; }));
    if (window.HMApp && window.HMApp.saveWorks) { try { window.HMApp.saveWorks(); } catch (e) {} }
    if (window.HMApp && window.HMApp.renderWorks) { try { window.HMApp.renderWorks(); } catch (e) {} }
    return { ok: true, url: work.url, bytes: work._assetBytes || 0 };
  }

  async function retryPendingUploads() {
    if (!uid() || !api.online) return;
    var ids = pendingIds();
    if (!ids.length) return;
    var works = (window.HMApp && window.HMApp.state && window.HMApp.state.works) || [];
    for (var i = 0; i < ids.length && i < 5; i += 1) {
      var target = null;
      for (var j = 0; j < works.length; j += 1) {
        if (works[j] && works[j].id === ids[i]) { target = works[j]; break; }
      }
      if (!target) { savePendingIds(pendingIds().filter(function (x) { return x !== ids[i]; })); continue; }
      await archiveWork(target);
    }
  }

  /* 已有本地原图不硬删：逐张上传成功后，才释放对应的本地副本 */
  async function migrateLocalOriginals(limit) {
    if (!uid() || !api.online) return;
    try { await window.HMApp.hydrateWorks(); } catch (e) {}
    var pool = ((window.HMApp && window.HMApp.state && window.HMApp.state.works) || []).filter(function (w) {
      return w && w.id && !w._assetId && typeof w.url === 'string'
        && w.url.indexOf('data:') === 0 && w.url.length > 200000;
    }).slice(0, limit || 3);
    for (var i = 0; i < pool.length; i += 1) { await archiveWork(pool[i]); }
  }

  window.HMSync = {
    afterLogin: afterLogin,
    onWorksChanged: onWorksChanged,
    deleteWorks: deleteWorks,
    clearAll: clearAll,
    pushDoc: pushDoc,
    pushPrefs: pushPrefs,
    pushLibraryPrefs: pushLibraryPrefs,
    pushDraftDoc: pushDraftDoc,
    /* 接入配置：必须真正写到云端；未登录/离线直接抛错，界面据此提示 */
    pushApi: function (data) {
      if (!uid()) return Promise.reject(new Error('未登录，无法保存到云端'));
      return pushDoc('api', data, { strict: true }).then(function (res) {
        if (!res) throw new Error('云端保存未完成，请重试');
        return res;
      });
    },
    /* 保存接入配置前先拉云端最新文档，避免本机过期数据覆盖云端 */
    pullApi: function () {
      if (!uid()) return Promise.resolve(null);
      return request('GET', '/docs/api', null, 30000).then(function (res) {
        if (!res || !res.doc || res.doc.data == null) return null;
        applyDoc('api', res.doc.data, res.doc.rev);
        saveRevs();
        return res.doc.data;
      });
    },
    /* 数据安全层（供页面内其它模块与排障使用） */
    collectLocalWorks: collectLocalWorks,
    mergeLists: mergeLists,
    snapshotWorks: snapshotWorks,
    beforePersist: beforePersist,
    runSyncWrite: runSyncWrite,
    recoverLocal: recoverLocal,
    autoRecover: maybeAutoRecover,
    archiveWork: archiveWork,
    retryPendingUploads: retryPendingUploads,
    migrateLocalOriginals: migrateLocalOriginals,
    hasPendingUploads: function () { return pendingIds().length > 0; },
    assertNoDataLoss: assertNoDataLoss,
    pullDocs: async function () {
      var boot = await pullBootstrap();
      sync.lastError = '';
      saveSync();
      applyBootstrap(boot);
    },
    status: function () { return { storage: storage, usage: usage, sync: sync, queue: queue.length }; },
    refreshPanel: renderPanel
  };

  setTimeout(function () { assertNoDataLoss(); }, 4000);

  /* 若用户已经登录（脚本晚于 authBoot），主动拉一次 */
  setTimeout(function () {
    if (uid()) afterLogin();
  }, 3500);
})();

