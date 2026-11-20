
'use strict';

/* =============================================================
 * 绘梦 · 图书馆
 * 复古书架 / 开书动画 / 书籍详情 / 目录与左右翻页 / 搜索推荐
 * 新增·编辑·删除书籍 / 收藏 / 阅读历史（续读上次页码）
 *
 * 数据层：
 *   优先调用后端 /api/library（MySQL，见 data/mysql/）
 *   后端不可用时自动回退到 data/library/books.seed.json（构建时内联）
 *   + localStorage，保证静态页面也能完整演示
 * ============================================================= */
(function () {
  var A = window.HMApp;
  var LS = {
    books: 'anidream.library.books.v2',
    fav: 'anidream.library.fav.v2',
    hist: 'anidream.library.history.v2',
    user: 'anidream.library.user.v1',
    area: 'anidream.library.area.v1',
    pdfMode: 'anidream.library.pdfmode.v1',
    conceptOrder: 'anidream.library.conceptOrder.v1',
    ocrLang: 'anidream.library.ocrlang.v1',
    pageOcrLang: 'anidream.library.pageocrlang.v1',
    meta: 'anidream.library.books.meta.v1'
  };

  var SEED = (window.HM_LIBRARY_SEED && window.HM_LIBRARY_SEED.books) || [];

  /* 图书馆区域：单按钮切换；all 为汇总区（不按 area 过滤） */
  var LIB_AREAS = [
    { id: 'all', name: '全部藏书', desc: '汇总全部区域的书籍' },
    { id: 'ref', name: '参考素材', desc: '该区域内容' },
    { id: 'psd', name: '插画作画过程PSD源文件', desc: '该区域内容' },
    { id: 'anim', name: '动画教程', desc: '该区域内容' },
    { id: 'paint', name: '绘画教程', desc: '该区域内容' },
    { id: 'concept', name: '原画资料', desc: '该区域内容' }
  ];
  var DEFAULT_AREA = 'all';   /* 首次进入默认展示汇总；已有分区选择的用户保持原选择 */

  /* 「插画作画过程PSD源文件」在库里的 area 是 paint，只有 category 能标识这个分类；
     区域 = psd 时按 category 命中，其余区域仍严格按 area 过滤（其它区域规则不变）。 */
  var PSD_CATEGORY = '插画作画过程PSD源文件';
  function bookInArea(b, area) {
    if (area === 'all') return true;
    if (area === 'psd') return b.category === PSD_CATEGORY || b.area === 'psd';
    return b.area === area;
  }

  var state = {
    mode: 'local',        /* local | remote */
    area: 'all',          /* 当前图书馆区域 id（无历史记录时默认全部藏书） */
    shelfPage: 1,         /* 当前书架页码（区域过滤后分页，与阅读器页码解耦） */
    books: [],
    shelfBooks: [],
    fav: {},
    hist: [],
    query: '',
    current: null,        /* 当前完整书籍 */
    page: 0,              /* 0 = 目录页，1..n = 正文页 */
    flipBusy: false,
    editing: null,
    booted: false,
    loading: false,
    pdfTocCollapsed: false, /* 目录折叠状态：本次阅读内记住 */
    libDirPage: '',         /* 原画资料当前进入的作品母文件夹（纯展示页面状态） */
    storeUsedBytes: null,   /* 全库已用字节数（GET /library/books 的 store.usedBytes） */
    storeLimitLabel: ''     /* 全库上限文案（store.limitLabel，如 "500G"） */
  };

  var els = {};
  var bound = false;
  var searchTimer = null;
  var suggestItems = [];
  var suggestIndex = -1;
  var pdfSlowTimer = null;
  var libPrefsPushTimer = null;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, type) {
    if (A && A.toast) { A.toast(msg, type || 'info'); return; }
    console.log('[library] ' + msg);
  }

  function nowMs() { return Date.now(); }

  function uid() {
    return 'lib-' + nowMs().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function byId(id) {
    for (var i = 0; i < state.books.length; i++) {
      if (state.books[i].id === id) return state.books[i];
    }
    return null;
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }

  function libraryUser() {
    try {
      var v = localStorage.getItem(LS.user);
      if (!v) {
        v = 'guest-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(LS.user, v);
      }
      return v;
    } catch (err) { return 'guest'; }
  }

  function apiUrl(path) {
    var base = (window.HM && window.HM.api && window.HM.api.base) || '/api';
    return base + (path.charAt(0) === '/' ? path : '/' + path);
  }

  /* 书籍封面 / PDF 地址统一出口：旧域名（Render）历史数据自动改写到当前 API origin */
  function mediaFile(url) {
    var api = window.HM && window.HM.api;
    var value = String(url || '');
    if (!value) return '';
    return api && api.fileUrl ? api.fileUrl(value) : value;
  }

  /* 列表封面按展示宽度取缩略图：COS 直链末尾追加 imageMogr2 参数即可，
     原图动辄数百 KB，缩到卡片尺寸能省九成以上；非 COS 地址原样返回。
     该参数不在签名 URL 的 q-url-param-list 里，追加后签名仍然有效。 */
  function coverThumb(url, width) {
    var value = String(url || '');
    if (!value || value.indexOf('imageMogr2') >= 0) return value;
    if (!/\.cos\.[a-z0-9-]+\.myqcloud\.com\//i.test(value)) return value;
    var q = 'imageMogr2/thumbnail/' + Math.round(width) + 'x/quality/80';
    return value + (value.indexOf('?') >= 0 ? '&' : '?') + q;
  }

  /* 封面懒加载 / 释放：进入视口附近才加载，滚出两屏后收回 src 释放解码内存，
     再滚回来时从缓存恢复，避免长列表一次性解码几十张原图。 */
  var coverObserver = null;
  function watchCovers(root) {
    if (!root || !window.IntersectionObserver) return;
    if (!coverObserver) {
      coverObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var img = entry.target;
          var src = img.getAttribute('data-cover-src') || '';
          if (entry.isIntersecting) {
            if (src && !img.getAttribute('src')) img.setAttribute('src', src);
            img.style.visibility = '';
          } else if (img.getAttribute('src')) {
            img.setAttribute('data-cover-src', img.getAttribute('src'));
            img.removeAttribute('src');
            img.style.visibility = 'hidden';
          }
        });
      }, { rootMargin: '600px 0px 900px 0px' });
    }
    coverObserver.disconnect();
    var imgs = root.querySelectorAll('img.lib-book-cover-img, img.lib-dir-cover, img.lib-detail-cover-img, .lib-panel-cover img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.getAttribute('data-cover-src')) img.setAttribute('data-cover-src', img.getAttribute('src') || '');
      coverObserver.observe(img);
    }
  }

  /* 封面缩略图（COS imageMogr2）加载失败时，回退到 /cover-url 取原图，只重试一次。
     服务端始终保留原图，这里只换地址，不删不改任何数据。 */
  function coverFallback(img) {
    if (!img || img.getAttribute('data-cover-fb')) return;
    var id = img.getAttribute('data-cover-id');
    if (!id) return;
    img.setAttribute('data-cover-fb', '1');
    fetch(apiUrl('/library/books/' + encodeURIComponent(id) + '/cover-url'))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) {
          img.setAttribute('data-cover-src', d.url);
          img.src = d.url;
        }
      })
      .catch(function () {});
  }
  window.HM = window.HM || {};
  window.HM.coverFallback = coverFallback;

  /* 封面地址是否仍可直接使用：
     - 迁移前旧域名会被改写到 SCF /api/library/file/ 代理，该代理对文件响应不可用
     - /api/library/file/ 代理地址（网关会塞 application/json + attachment，图片必坏）
     - COS 预签名直链带 q-sign-time，过期后 403
     不可用时由调用方换用列表里已刷新的地址，或退回文字封面 */
  function coverUrlUsable(url) {
    var value = String(url || '');
    if (!value) return false;
    var api = window.HM && window.HM.api;
    if (api && api.isLegacyFileUrl && api.isLegacyFileUrl(value)) return false;
    if (value.indexOf('/api/library/file/') >= 0) return false;
    var m = /[?&]q-sign-time=(\d+);(\d+)/.exec(value);
    if (m && Number(m[2]) * 1000 <= Date.now()) return false;
    return true;
  }

  function request(path, options, timeoutMs) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 12000);
    var headers = { Accept: 'application/json', 'x-library-user': libraryUser() };
    try {
      var token = localStorage.getItem('hm.token');
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (err) {}
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(apiUrl(path), {
      method: opts.method || 'GET',
      headers: headers,
      signal: controller.signal,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (err) { data = raw; }
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
          var error = new Error(msg);
          error.status = res.status;
          throw error;
        }
        return data;
      });
    }).finally(function () { clearTimeout(timer); });
  }

  /* ---------------- 本地数据 ---------------- */
  function seedBooks() {
    return SEED.map(function (b, i) {
      return normalize(b, i);
    });
  }

  function timeValue(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = Number(v);
    if (isFinite(n) && n > 0) return n;
    var p = Date.parse(v);
    return isFinite(p) ? p : fallback;
  }

  function normalize(b, i) {
    var t = nowMs();
    return {
      id: String(b.id || uid()),
      title: String(b.title || '无题'),
      author: String(b.author || '佚名'),
      category: String(b.category || '未分类'),
      tags: Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(/[,，、]/).filter(Boolean),
      intro: String(b.intro || ''),
      accent: /^#[0-9a-f]{6}$/i.test(String(b.accent || '')) ? b.accent : '#8a6a4f',
      coverUrl: String(b.coverUrl || ''),
      area: String(b.area || ''),
      pdfUrl: String(b.pdfUrl || ''),
      pageCount: Number(b.pageCount) || 0,
      toc: Array.isArray(b.toc) ? b.toc : [],
      sortNo: Number(b.sortNo == null ? i : b.sortNo),
      createdAt: timeValue(b.createdAt, t),
      updatedAt: timeValue(b.updatedAt, t),
      pages: (b.pages || []).map(function (p, idx) {
        return {
          pageNo: idx + 1,
          title: String(p.title || ('第 ' + (idx + 1) + ' 页')),
          content: String(p.content || '')
        };
      })
    };
  }

  function localBooks() {
    var list = readJSON(LS.books, null);
    if (!Array.isArray(list) || !list.length) {
      if (!SEED.length) return [];
      list = seedBooks();
      writeJSON(LS.books, list);
    }
    return list;
  }

  function saveLocalBooks(list) {
    writeJSON(LS.books, list);
  }

  function loadFavLocal() {
    var v = readJSON(LS.fav, {});
    return v && typeof v === 'object' ? v : {};
  }

  function loadHistLocal() {
    var v = readJSON(LS.hist, []);
    return Array.isArray(v) ? v : [];
  }

  /* ---------------- 数据层 ---------------- */
  function applyQuery(list) {
    var q = state.query.trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (b) {
      return [b.title, b.author, b.category, b.intro]
        .concat(b.tags || [])
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function markShelf() {
    /* all 为汇总区：不过滤 area，包含全部区域的书；其余区域严格按 area 过滤 */
    var areaBooks = state.books.filter(function (b) { return bookInArea(b, state.area); });
    /* 排序：sortNo 升序（001=0、002=1）；同 sortNo 按 createdAt 升序，新书排后面 */
    areaBooks.sort(function (a, b) {
      var sa = Number(a.sortNo), sb = Number(b.sortNo);
      if (!isFinite(sa)) sa = 1e15;
      if (!isFinite(sb)) sb = 1e15;
      if (sa !== sb) return sa - sb;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
    state.shelfBooks = applyQuery(areaBooks);
  }

  function boot() {
    if (state.booted) return Promise.resolve();
    state.loading = true;
    renderSkeleton();
    /* 先上上次成功拉取的书架缓存，避免列表接口冷启动时白屏 */
    var cached = readJSON(LS.meta, null);
    if (cached && cached.books && cached.books.length) {
      state.mode = 'remote';
      state.books = cached.books.map(function (b, i) {
        var nb = normalize(b, i);
        /* 缓存可能是迁移前的快照：旧域名 / 代理地址 / 已过期的预签名直链先不展示，
           等 /library/books 返回新地址后自然恢复，避免首屏坏图 */
        if (!coverUrlUsable(nb.coverUrl)) nb.coverUrl = '';
        return nb;
      });
      state.fav = cached.fav || {};
      state.hist = cached.hist || [];
      pruneHistory(true);
      state.booted = true;
      state.loading = false;
      markShelf();
      renderShelf();
      renderStatus();
    }
    return request('/library/books', {}, 30000).then(function (data) {
      state.mode = 'remote';
      applyStore(data.store); /* 全库用量随书目一起刷新 */
      state.books = (data.items || []).map(function (b, i) { return normalize(b, i); });
      return loadRemoteAux();
    }).then(function () {
      saveRemoteMeta();
    }).catch(function (err) {
      /* 已有缓存时保持缓存书架，不因一次接口超时清空 */
      if (cached && cached.books && cached.books.length) return;
      state.mode = 'local';
      state.books = localBooks();
      state.fav = loadFavLocal();
      state.hist = loadHistLocal();
    }).then(function () {
      pruneHistory(true);
      state.booted = true;
      state.loading = false;
      markShelf();
      renderShelf();
      renderStatus();
    });
  }

  function saveRemoteMeta() {
    try {
      writeJSON(LS.meta, { at: Date.now(), books: state.books, fav: state.fav, hist: state.hist });
    } catch (e) {}
  }

  function loadRemoteAux() {
    return Promise.all([
      request('/library/favorites', {}, 12000).catch(function () { return { items: [] }; }),
      request('/library/history', {}, 12000).catch(function () { return { items: [] }; })
    ]).then(function (res) {
      var fav = {};
      (res[0].items || []).forEach(function (b) { fav[b.id] = true; });
      state.fav = fav;
      state.hist = res[1].items || [];
    });
  }

  function refreshRemote() {
    if (state.mode !== 'remote') {
      state.books = localBooks();
      markShelf();
      renderShelf();
      renderStatus();
      return Promise.resolve();
    }
    return request('/library/books', {}, 30000).then(function (data) {
      applyStore(data.store); /* 全库用量随书目一起刷新 */
      state.books = (data.items || []).map(function (b, i) { return normalize(b, i); });
      return loadRemoteAux();
    }).then(function () {
      saveRemoteMeta();
    }).catch(function () {
      /* 刷新失败时保留当前书架，不因一次接口抖动切回本地数据 */
    }).then(function () {
      markShelf();
      renderShelf();
      renderStatus();
    });
  }

  function fetchBook(id, strict) {
    var cached = byId(id);
    /* 只有正文缓存且封面地址仍可用时才直接复用，否则走远端详情刷新 */
    if (cached && cached.pages && cached.pages.length && coverUrlUsable(cached.coverUrl)) return Promise.resolve(cached);
    if (state.mode === 'remote') {
      var p = request('/library/books/' + encodeURIComponent(id), {}, 20000)
        .then(function (data) { return data.book; });
      /* strict 用于「打开书籍」：失败要露出真实原因，不再静默退回列表快照 */
      return strict ? p : p.catch(function () { return cached; });
    }
    return Promise.resolve(cached);
  }

  function isFavorite(id) {
    return !!(state.fav && state.fav[id]);
  }

  function setFavorite(id, on) {
    state.fav[id] = !!on;
    if (!on) delete state.fav[id];
    writeJSON(LS.fav, state.fav);
    if (state.mode === 'remote') {
      var p = on
        ? request('/library/favorites', { method: 'POST', body: { bookId: id } }, 8000)
        : request('/library/favorites/' + encodeURIComponent(id), { method: 'DELETE' }, 8000);
      p.catch(function () { toast('收藏未能同步到服务器，已保存在本地', 'info'); });
    }
    return Promise.resolve();
  }

  function persistProgress(bookId, page) {
    var t = nowMs();
    var entry = null;
    state.hist = state.hist.filter(function (h) {
      if (h.bookId === bookId) { entry = h; return false; }
      return true;
    });
    if (!entry) entry = { bookId: bookId };
    entry.lastPage = page;
    entry.openedAt = t;
    var lite = byId(bookId);
    if (lite) entry.book = liteLite(lite);
    state.hist.unshift(entry);
    if (state.hist.length > 40) state.hist.length = 40;
    writeJSON(LS.hist, state.hist);

    if (state.mode === 'remote') {
      request('/library/progress', { method: 'POST', body: { bookId: bookId, lastPage: page } }, 8000)
        .catch(function () {});
    }
  }

  function liteLite(b) {
    return {
      id: b.id, title: b.title, author: b.author, category: b.category,
      tags: b.tags, intro: b.intro, accent: b.accent, coverUrl: b.coverUrl,
      pages: (b.pages || []).length
    };
  }

  function progressOf(id) {
    for (var i = 0; i < state.hist.length; i++) {
      if (state.hist[i].bookId === id) return Number(state.hist[i].lastPage) || 0;
    }
    return 0;
  }

  /* ---------------- 阅读历史：保留一周 / 时间筛选 / 清空 ----------------
   * 记录时间统一取 openedAt（本机与后端 /library/history 都用这个字段）。
   * 超过 7 天的记录在读取时回收，并把回收结果写回本机存储（顺带更新远端快照），
   * 不需要用户手动操作；清空后的历史用 clearedAt 水位挡住后端回流的旧记录。 */
  var HIST_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  var HIST_CLEARED_KEY = 'anidream.library.histcleared.v1';
  var histFilter = 'all';

  function histTime(h) {
    return Number(h && (h.openedAt || h.updatedAt || h.at)) || 0;
  }

  /* 关闭/结束阅读时间：退出阅读器时写入 closedAt；格式化给列表小字用 */
  function fmtHistTime(ts) {
    var n = Number(ts);
    if (!n) return '';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '';
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function markHistClosed(bookId) {
    if (!bookId) return;
    var entry = null;
    for (var i = 0; i < state.hist.length; i++) {
      if (state.hist[i].bookId === bookId) { entry = state.hist[i]; break; }
    }
    if (!entry) return;
    entry.closedAt = nowMs();
    try { writeJSON(LS.hist, state.hist); } catch (e) {}
    if (state.mode === 'remote') { try { saveRemoteMeta(); } catch (e) {} }
  }

  /* 阅读历史封面：优先书目自身的 coverUrl（与上传时同一套图片服务）；
     加载失败先换原图地址，仍失败则退回中性占位，绝不留下裂图 */
  function panelCoverFallback(img) {
    if (!img) return;
    var box = img.parentNode;
    var placeholder = function () {
      if (!box) return;
      box.classList.add('is-placeholder');
      box.innerHTML = '<span>无封面</span>';
    };
    if (img.getAttribute('data-cover-fb')) { placeholder(); return; }
    img.setAttribute('data-cover-fb', '1');
    var id = img.getAttribute('data-cover-id');
    if (!id) { placeholder(); return; }
    fetch(apiUrl('/library/books/' + encodeURIComponent(id) + '/cover-url'))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) {
          img.setAttribute('data-cover-src', d.url);
          img.src = d.url;
        }
        else placeholder();
      })
      .catch(placeholder);
  }
  window.HM.panelCoverFallback = panelCoverFallback;

  function histClearedAt() {
    try { return Number(localStorage.getItem(HIST_CLEARED_KEY)) || 0; } catch (e) { return 0; }
  }

  function pruneHistory(silent) {
    var now = Date.now();
    var cleared = histClearedAt();
    var before = state.hist.length;
    state.hist = state.hist.filter(function (h) {
      var ts = histTime(h);
      if (cleared && ts && ts <= cleared) return false;
      if (!ts) return true;          /* 没有时间戳的旧记录不误删 */
      return (now - ts) <= HIST_KEEP_MS;
    });
    if (state.hist.length === before) return;
    try { writeJSON(LS.hist, state.hist); } catch (e) {}
    if (state.mode === 'remote') { try { saveRemoteMeta(); } catch (e) {} }
    if (!silent) toast('已清理超过一周的阅读历史', 'info');
  }

  function clearHistory() {
    try { localStorage.setItem(HIST_CLEARED_KEY, String(Date.now())); } catch (e) {}
    state.hist = [];
    try { writeJSON(LS.hist, []); } catch (e) {}
    if (state.mode === 'remote') { try { saveRemoteMeta(); } catch (e) {} }
    showPanel('hist');
    toast('阅读历史已清空', 'success');
  }

  function histInRange(h) {
    if (histFilter === 'all') return true;
    var ts = histTime(h);
    if (!ts) return false;
    var now = Date.now();
    if (histFilter === 'today') {
      var a = new Date(ts);
      var b = new Date(now);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    var span = histFilter === '3d' ? 3 * 86400000
      : histFilter === '7d' ? 7 * 86400000
      : histFilter === '30d' ? 30 * 86400000 : 0;
    return span ? (now - ts) <= span : true;
  }

  /* ---------------- 书架渲染 ---------------- */
  function renderSkeleton() {
    if (!els.body) return;
    els.body.innerHTML = '<div class="lib-loading">正在整理书架…</div>';
  }

  var SHELF_BOOK_WIDTH = 120;   /* 单本书标称宽度（与 bookCardHtml 的 --w 一致） */
  var SHELF_ROWS_PER_PAGE = 3;  /* 一页固定 3 层 */
  var shelfPerRowCache = 0;

  /* 现场测量柜内可用宽度与书间距，算出每层能放几本：perRow = floor(内宽 / (书宽 + 间距)) */
  function measureShelfPerRow() {
    if (!els.body || !els.body.clientWidth) return shelfPerRowCache || 1;
    var probe = document.createElement('div');
    probe.className = 'lib-shelf-books';
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:100%;height:1px;visibility:hidden;pointer-events:none;';
    els.body.appendChild(probe);
    var cs = window.getComputedStyle(probe);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padR = parseFloat(cs.paddingRight) || 0;
    var gap = parseFloat(cs.columnGap || cs.gap) || 0;
    var inner = probe.clientWidth - padL - padR;
    els.body.removeChild(probe);
    if (!(inner > 0)) return shelfPerRowCache || 1;
    var bookW = (state.area === 'concept' || state.area === 'psd') ? 168 : SHELF_BOOK_WIDTH; /* 原画资料/PSD 按文件夹形态的宽度算每层容量 */
    shelfPerRowCache = Math.max(1, Math.floor((inner + gap) / (bookW + gap)));
    return shelfPerRowCache;
  }

  function shelfPageSize() { return measureShelfPerRow() * SHELF_ROWS_PER_PAGE; }

  /* 原画资料：母文件夹标题用作品全称。优先取条目的 category（若它是「前缀 + 更长全称」），
     否则用下面这张常见缩写映射补全；都没有时才沿用前缀本身。只影响展示，不改书目数据。 */
  var CONCEPT_WORK_NAMES = {
    '86': '86－不存在的战区－',
    'eva': '新世纪福音战士',
    'air': 'AIR',
    'clannad': 'CLANNAD',
    '小魔女学园': '小魔女学园',
    '斩服少女': '斩服少女',
    '灵能百分百': '灵能百分百',
    '紫罗兰永恒花园': '紫罗兰永恒花园',
    '白箱': '白箱（SHIROBAKO）'
  };

  function conceptWorkName(prefix, books) {
    var p = String(prefix || '').trim();
    if (!p) return '';
    var lower = p.toLowerCase();
    for (var i = 0; i < books.length; i++) {
      var c = String(books[i].category || '').trim();
      if (c && c !== '未分类' && c.toLowerCase().indexOf(lower) === 0 && c.length > p.length) return c;
    }
    return CONCEPT_WORK_NAMES[lower] || CONCEPT_WORK_NAMES[p] || p;
  }

  /* 按标题前缀自动分组（如「CLANNAD · 画集 · 上」→ CLANNAD），不写死 id；
     key/prefix 保持原前缀用于身份与排序持久化，name 只用于展示全称。 */
  function conceptDirGroups(list) {
    var map = {}, order = [];
    list.forEach(function (b) {
      var title = String(b.title || '');
      /* 分隔符兼容「·」「•」「・」「|」：作品前缀相同即归入同一母文件夹 */
      var cut = title.search(/[·•・|｜]/);
      var prefix = cut > 0 ? title.slice(0, cut).trim() : '';
      var key = prefix || ('\u0000' + b.id);
      if (!map[key]) {
        map[key] = { key: key, prefix: prefix, name: prefix, books: [] };
        order.push(map[key]);
      }
      map[key].books.push(b);
    });
    order.forEach(function (g) { g.name = conceptWorkName(g.prefix, g.books); });
    return order;
  }

  /* PSD 分类：按作者归母文件夹（作者字段可能带来源后缀「焦茶 / 萌绘图库」，展示只取作者名）。
     分组结构与原画资料完全一致，直接复用同一套母文件夹卡与进入/返回逻辑。 */
  function psdAuthorName(b) {
    var a = String((b && b.author) || '').trim();
    if (!a) return '佚名';
    return a.split(/\s*[/／]\s*/)[0] || a;
  }

  function psdDirGroups(list) {
    var map = {}, order = [];
    list.forEach(function (b) {
      var name = psdAuthorName(b);
      var key = 'a:' + name;
      if (!map[key]) {
        map[key] = { key: key, prefix: '', name: name, books: [] };
        order.push(map[key]);
      }
      map[key].books.push(b);
    });
    return order;
  }

  /* 目录卡封面：优先「画集 · 上」的封面，其次任一「画集」条目，最后取组内第一条的封面；
     只引用已有封面地址，不新增文件、不改数据 */
  function conceptDirCover(books) {
    var pick = null;
    books.forEach(function (b) {
      var t = String(b.title || '');
      if (!pick && t.indexOf('画集') >= 0 && t.indexOf('上') >= 0) pick = b;
    });
    if (!pick) {
      books.forEach(function (b) {
        if (!pick && String(b.title || '').indexOf('画集') >= 0) pick = b;
      });
    }
    if (!pick) pick = books[0];
    return pick && pick.coverUrl ? coverThumb(mediaFile(pick.coverUrl), 360) : '';
  }

  /* ---------------- 原画资料：展示顺序（自然排序 + 拖拽自定义顺序） ---------------- */
  function conceptNaturalCompare(a, b) {
    var ax = String(a || '').toLowerCase().match(/(\d+|\D+)/g) || [];
    var bx = String(b || '').toLowerCase().match(/(\d+|\D+)/g) || [];
    var n = Math.min(ax.length, bx.length);
    for (var i = 0; i < n; i++) {
      var x = ax[i], y = bx[i];
      if (x === y) continue;
      var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) return Number(x) - Number(y);
      return x.localeCompare(y, 'zh-Hans-CN');
    }
    return ax.length - bx.length;
  }

  /* 顺序结构：{ dirs: ['g:86', 'b:<bookId>'...], items: { '86': [bookId...] } } */
  function conceptOrderRead() {
    var d = readJSON(LS.conceptOrder, null);
    return {
      dirs: (d && Array.isArray(d.dirs)) ? d.dirs : [],
      items: (d && d.items && typeof d.items === 'object') ? d.items : {}
    };
  }

  function conceptOrderSave(order) {
    order.updatedAt = nowMs();
    writeJSON(LS.conceptOrder, order);
    /* 与阅读偏好同一条同步链路：library 文档随账号走 */
    clearTimeout(libPrefsPushTimer);
    libPrefsPushTimer = setTimeout(function () {
      if (window.HMSync && window.HMSync.pushLibraryPrefs) {
        try { window.HMSync.pushLibraryPrefs(); } catch (e) {}
      }
    }, 600);
  }

  function conceptGroupKey(g) {
    return g.prefix ? ('g:' + g.prefix) : ('b:' + ((g.books[0] && g.books[0].id) || ''));
  }

  /* 母文件夹：自定义顺序优先，新增的按作品名自然排序追加 */
  function orderConceptGroups(groups, order) {
    var rank = {};
    (order.dirs || []).forEach(function (k, i) { if (!(k in rank)) rank[k] = i; });
    groups.forEach(function (g) {
      g._key = conceptGroupKey(g);
      g._rank = (g._key in rank) ? rank[g._key] : 1e9;
      g._sortText = g.name || String((g.books[0] && g.books[0].title) || '');
    });
    groups.sort(function (a, b) {
      if (a._rank !== b._rank) return a._rank - b._rank;
      return conceptNaturalCompare(a._sortText, b._sortText);
    });
    return groups;
  }

  /* 组内子文件夹：自定义顺序优先，新增的按卷次自然排序追加（第2卷 < 第10卷） */
  function orderConceptBooks(books, savedIds) {
    var rank = {};
    (savedIds || []).forEach(function (id, i) { if (!(String(id) in rank)) rank[String(id)] = i; });
    return books.slice().sort(function (a, b) {
      var ra = (String(a.id) in rank) ? rank[String(a.id)] : 1e9;
      var rb = (String(b.id) in rank) ? rank[String(b.id)] : 1e9;
      if (ra !== rb) return ra - rb;
      return conceptNaturalCompare(a.title, b.title);
    });
  }

  function conceptDirCardHtml(g) {
    var cover = conceptDirCover(g.books);
    return '<button type="button" class="lib-book is-dir" data-libdir="' + esc(g.key) + '"'
      + ' title="' + esc(g.name) + ' · ' + g.books.length + ' 册">'
      + '<span class="lib-dir-body">'
      + (cover
        ? '<img class="lib-dir-cover" src="' + esc(cover) + '" alt="' + esc(g.name) + '" loading="lazy">'
        : '<span class="lib-dir-ico">📁</span>')
      + '<span class="lib-dir-name">' + esc(g.name) + '</span>'
      + '<span class="lib-dir-meta">' + g.books.length + ' 册 · 点击进入</span>'
      + '</span></button>';
  }

  /* 卡片内容签名：签名一致就复用原节点，避免整块重绘（封面重新解码造成的「闪一下」） */
  function cardSig(b, index) {
    return [b.id, index, b.title, b.author, b.category, b.accent,
      b.coverUrl || '', b.pageCount || 0, b.updatedAt || 0,
      isFavorite(b.id) ? 1 : 0, progressOf(b.id) || 0].join('|');
  }

  function nodeFromHtml(html, key, sig) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var el = tpl.content.firstElementChild;
    if (!el) return null;
    el.setAttribute('data-hm-key', key);
    el.setAttribute('data-hm-sig', sig);
    return el;
  }

  /* 只替换签名变化的格子：位置/内容没变的卡片保留原 DOM，图片不会重新加载 */
  function paintItems(box, items, make) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var cur = box.children[i];
      if (cur && cur.getAttribute('data-hm-key') === it.key && cur.getAttribute('data-hm-sig') === it.sig) continue;
      var el = make(it);
      if (!el) continue;
      if (cur) box.replaceChild(el, cur); else box.appendChild(el);
    }
    while (box.children.length > items.length) box.removeChild(box.lastElementChild);
  }

  function dirSig(g) {
    return 'g|' + g.name + '|' + g.books.length + '|' + conceptDirCover(g.books)
      + '|' + g.books.map(function (b) { return b.id; }).join(',');
  }

  /* 原画资料的两级页面：第一层只列作品母文件夹；点进去整块换成子文件夹页面（带返回）。
     PSD 分类复用同一套页面与卡片，只是分组口径换成「作者」。
     同组子文件夹连续排在同一条 flex 流里（组间才有间距），卡片外层可拖动换序。 */
  function renderConceptDirs() {
    var order = conceptOrderRead();
    var sourceGroups = state.area === 'psd' ? psdDirGroups(state.shelfBooks) : conceptDirGroups(state.shelfBooks);
    var groups = orderConceptGroups(sourceGroups, order);
    var page = state.libDirPage || '';
    var cur = null;
    groups.forEach(function (g) { if (g.key === page) cur = g; });
    var pageLabel = cur ? cur.name : page;
    var items = [];
    if (page) {
      var books = cur ? orderConceptBooks(cur.books, order.items[page]) : [];
      items = books.map(function (b, i) {
        return { key: 'b:' + b.id, sig: cardSig(b, i), html: bookCardHtml(b, i), drag: 'data-drag-id="' + esc(b.id) + '"' };
      });
    } else {
      groups.forEach(function (g) {
        var isGroup = !!g.name && (state.area === 'psd' || g.books.length > 1);
        items.push({
          key: 'g:' + conceptGroupKey(g),
          sig: dirSig(g),
          html: isGroup ? conceptDirCardHtml(g) : bookCardHtml(g.books[0], 0),
          drag: 'data-drag-key="' + esc(conceptGroupKey(g)) + '"'
        });
      });
    }
    if (!items.length) {
      els.body.innerHTML = '<div class="lib-shelf-wrap lib-concept-scroll">'
        + (page ? '<div class="lib-dir-bar"><button type="button" class="lib-dir-back" data-libback="1">← 返回</button><span class="lib-dir-title">' + esc(pageLabel) + '</span></div>' : '')
        + '<div class="lib-empty lib-shelf-empty">'
        + '<div class="lib-empty-icon">📁</div><h3>' + (state.query ? '没有找到相关资料' : '这个区域还没有资料') + '</h3>'
        + '<p>' + (state.query ? '换个关键词试试，或清空搜索查看全部资料。' : '上传资料后会自动按标题前缀归入对应文件夹。') + '</p>'
        + '</div></div>';
      if (coverObserver) coverObserver.disconnect();
      if (els.pager) els.pager.hidden = true;
      renderStatus();
      return;
    }
    var wrap = els.body.querySelector('.lib-shelf-wrap[data-hm-concept="1"]');
    if (!wrap || wrap.hmPage !== page) {
      var bar = page
        ? '<div class="lib-dir-bar"><button type="button" class="lib-dir-back" data-libback="1">← 返回</button>'
          + '<span class="lib-dir-title">' + esc(pageLabel) + '</span></div>'
        : '';
      els.body.innerHTML = '<div class="lib-shelf-wrap lib-concept-scroll" data-hm-concept="1">' + bar
        + '<div class="lib-dirs' + (page ? ' is-page' : '') + '"></div></div>';
      wrap = els.body.querySelector('.lib-shelf-wrap[data-hm-concept="1"]');
      wrap.hmPage = page;
    }
    var dirs = wrap.querySelector('.lib-dirs');
    paintItems(dirs, items, function (it) {
      return nodeFromHtml('<div class="lib-drag-item" draggable="true" ' + it.drag + '>' + it.html + '</div>', it.key, it.sig);
    });
    watchCovers(dirs);
    if (els.pager) els.pager.hidden = true;
    renderStatus();
  }

  function renderShelf() {
    if (!els.body) return;
    if ((state.area === 'concept' || state.area === 'psd') && state.shelfBooks.length) { renderConceptDirs(); return; }
    var perRow = measureShelfPerRow();
    var pageSize = perRow * SHELF_ROWS_PER_PAGE;
    var total = state.shelfBooks.length;
    /* 逐格填满：每层 perRow 本，每页 3 层；第 1 页取 1–pageSize，第 2 页取 pageSize+1 起 */
    var pages = Math.max(1, Math.ceil(total / pageSize));
    if (state.shelfPage > pages) state.shelfPage = pages;
    if (state.shelfPage < 1) state.shelfPage = 1;
    var start = (state.shelfPage - 1) * pageSize;
    var list = state.shelfBooks.slice(start, start + pageSize);
    if (!list.length) {
      /* 0 本书也渲染三层空柜子，空态提示叠在柜体内部 */
      var emptyRows = '';
      for (var r = 0; r < SHELF_ROWS_PER_PAGE; r++) {
        emptyRows += '<section class="lib-shelf-row">'
          + '<div class="lib-shelf-books"></div>'
          + '<div class="lib-shelf-plank">'
          + '<span class="lib-shelf-label">第 ' + (r + 1) + ' 架</span>'
          + '<span class="lib-shelf-count">0 册</span>'
          + '</div></section>';
      }
      els.body.innerHTML = '<div class="lib-shelf-wrap">' + emptyRows
        + '<div class="lib-empty lib-shelf-empty">'
        + '<div class="lib-empty-icon">📖</div>'
        + '<h3>' + (state.query ? '没有找到相关书籍' : '书架还是空的') + '</h3>'
        + '<p>' + (state.query ? '换个关键词试试，或清空搜索查看全部藏书。' : '点击右上角「新增书籍」，把第一本书放上书架。') + '</p>'
        + '</div></div>';
      if (coverObserver) coverObserver.disconnect();
      renderPager(0);
      renderStatus();
      return;
    }

    /* 每页固定 3 层：不足的书位留空，不塌陷。
       结构只建一次，翻页/刷新时按 key 复用没变化的卡片，避免整块重绘。 */
    var wrap = els.body.querySelector('.lib-shelf-wrap[data-hm-shelf="1"]');
    if (!wrap || wrap.getAttribute('data-hm-perrow') !== String(perRow) || wrap.children.length !== SHELF_ROWS_PER_PAGE) {
      var html = '';
      for (var rowIndex = 0; rowIndex < SHELF_ROWS_PER_PAGE; rowIndex++) {
        html += '<section class="lib-shelf-row">'
          + '<div class="lib-shelf-books"></div>'
          + '<div class="lib-shelf-plank">'
          + '<span class="lib-shelf-label">第 ' + (rowIndex + 1) + ' 架</span>'
          + '<span class="lib-shelf-count"></span>'
          + '</div></section>';
      }
      els.body.innerHTML = '<div class="lib-shelf-wrap" data-hm-shelf="1" data-hm-perrow="' + perRow + '">' + html + '</div>';
      wrap = els.body.querySelector('.lib-shelf-wrap[data-hm-shelf="1"]');
    }
    for (var rowIndex = 0; rowIndex < SHELF_ROWS_PER_PAGE; rowIndex++) {
      var group = list.slice(rowIndex * perRow, (rowIndex + 1) * perRow);
      var rowEl = wrap.children[rowIndex];
      var box = rowEl.querySelector('.lib-shelf-books');
      box.className = 'lib-shelf-books' + (group.length >= perRow ? ' is-full' : '');
      var items = [];
      for (var gi = 0; gi < group.length; gi++) {
        var b = group[gi];
        var abs = start + rowIndex * perRow + gi;
        items.push({ key: b.id, sig: cardSig(b, abs), html: bookCardHtml(b, abs) });
      }
      paintItems(box, items, function (it) { return nodeFromHtml(it.html, it.key, it.sig); });
      var countEl = rowEl.querySelector('.lib-shelf-count');
      if (countEl) countEl.textContent = group.length + ' 册';
    }
    watchCovers(wrap);
    renderPager(total);
    renderStatus();
  }

  /* 底部页码控件：始终显示；只有 1 页时翻页按钮禁用，页码照常显示「第 1 / 1 页」 */
  function renderPager(total) {
    if (!els.pager) return;
    var pages = Math.max(1, Math.ceil(total / shelfPageSize()));
    els.pager.hidden = false;
    if (els.pagerInfo) els.pagerInfo.textContent = '第 ' + state.shelfPage + ' / ' + pages + ' 页';
    if (els.pagerInput) {
      els.pagerInput.value = state.shelfPage;
      els.pagerInput.max = pages;
    }
    if (els.pagerPrev) els.pagerPrev.disabled = state.shelfPage <= 1;
    if (els.pagerNext) els.pagerNext.disabled = state.shelfPage >= pages;
    /* 右侧步进：▲ = 数值 +1（下一页），▼ = 数值 -1（上一页） */
    if (els.pagerUp) els.pagerUp.disabled = state.shelfPage >= pages;
    if (els.pagerDown) els.pagerDown.disabled = state.shelfPage <= 1;
  }

  /* 新增书籍后定位到最后一页，让新书落在最后一页的最后一个格位 */
  function jumpToLastShelfPage() {
    state.shelfPage = Math.max(1, Math.ceil(state.shelfBooks.length / shelfPageSize()));
  }

  function bookCardHtml(b, index, asBook) {
    /* 原画资料：条目按文件夹形态展示；data-id 与 .lib-book 保持不变，
       点开仍走原来的 openBook 入口，搜索/预取/收藏逻辑都不变。
       asBook=true 用于「文件夹展开后的组内书目」，仍渲染成原来的书卡 */
    if (state.area === 'concept' && !asBook) {
      var dirPages = (b.pages && b.pages.length) || Number(b.pageCount) || 0;
      var dCover = b.coverUrl ? coverThumb(mediaFile(b.coverUrl), 360) : '';
      return '<button type="button" class="lib-book is-dir' + (b.coverUrl ? ' has-cover' : '') + '" data-id="' + esc(b.id) + '"'
        + ' title="' + esc(b.title) + ' · ' + esc(b.category || '未分类') + '">'
        + '<span class="lib-dir-body">'
        + (dCover
          ? '<img class="lib-dir-cover" src="' + esc(dCover) + '" alt="' + esc(b.title) + '" loading="lazy">'
          : '<span class="lib-dir-ico">📁</span>')
        + '<span class="lib-dir-name">' + esc(b.title) + '</span>'
        + '<span class="lib-dir-meta">' + esc(b.category || '未分类') + ' · ' + dirPages + ' 页</span>'
        + '</span>'
        + (isFavorite(b.id) ? '<span class="lib-book-star" title="已收藏">★</span>' : '')
        + '</button>';
    }
    var tilt = ((index % 5) - 2) * 1.1;
    var width = 120; /* 单本标称宽度，每层容量按柜内宽度现场测量 */
    var pageCount = (b.pages && b.pages.length) || Number(b.pageCount) || 0;
    var hasProgress = progressOf(b.id) > 0;
    return '<button type="button" class="lib-book' + (b.coverUrl ? ' has-cover' : '') + '" data-id="' + esc(b.id) + '"'
      + ' style="--accent:' + esc(b.accent) + ';--tilt:' + tilt + 'deg;--w:' + width + 'px"'
      + ' title="' + esc(b.title) + ' · ' + esc(b.author) + '">'
      + '<span class="lib-book-body">'
      + '<span class="lib-book-spine"><span class="lib-book-spine-title">' + esc(b.title) + '</span></span>'
      + '<span class="lib-book-cover">'
      + '<span class="lib-book-cover-frame"></span>'
      + '<span class="lib-book-cover-gen">'
      + '<span class="lib-book-cover-title">' + esc(b.title) + '</span>'
      + '<span class="lib-book-cover-rule"></span>'
      + '<span class="lib-book-cover-author">' + esc(b.author) + '</span>'
      + '<span class="lib-book-cover-seal">藏</span>'
      + '<span class="lib-book-cover-brand">绘梦藏书</span>'
      + '</span>'
      + (b.coverUrl
        ? '<img class="lib-book-cover-img" src="' + esc(coverThumb(mediaFile(b.coverUrl), 260)) + '" alt="' + esc(b.title) + '" loading="lazy" data-cover-id="' + esc(b.id) + '" onerror="window.HM&&window.HM.coverFallback&&window.HM.coverFallback(this)">'
        : '')
      + '</span>'
      + '<span class="lib-book-edge"></span>'
      + '</span>'
      + (isFavorite(b.id) ? '<span class="lib-book-star" title="已收藏">★</span>' : '')
      + (hasProgress ? '<span class="lib-book-progress" title="读到第 ' + progressOf(b.id) + ' 页"></span>' : '')
      + '<span class="lib-book-pages">' + pageCount + ' 页</span>'
      + '</button>';
  }

  function renderStatus() {
    if (!els.status) return;
    var total = state.books.length;
    var shown = state.shelfBooks.length;
    var modeLabel = state.mode === 'remote' ? 'MySQL · 后端已连接' : '本地藏书 · 离线模式';
    var limitLabel = state.storeLimitLabel || '500G';
    var usedLabel = state.storeUsedBytes == null ? '--' : formatBytes(state.storeUsedBytes);
    els.status.innerHTML = '<span class="lib-status-dot ' + (state.mode === 'remote' ? 'is-on' : '') + '"></span>'
      + '<span>' + modeLabel + '</span>'
      + '<span class="lib-status-sep">·</span>'
      + '<span>共 ' + total + ' 册，当前展示 ' + shown + ' 册</span>'
      + '<span class="lib-status-sep">·</span>'
      + '<span class="lib-store-used">' + esc(usedLabel + ' / ' + limitLabel) + '</span>'
      + '<span>存储空间上限 ' + esc(limitLabel) + '</span>';
    syncAreaBtn(); /* 书目变化后同步区域按钮上的数量 */
  }

  /* 全库存储用量：store.usedBytes / store.limitLabel，缺字段时保持降级显示 */
  function applyStore(store) {
    store = store || {};
    var used = Number(store.usedBytes);
    state.storeUsedBytes = isFinite(used) && used >= 0 ? used : null;
    state.storeLimitLabel = typeof store.limitLabel === 'string' && store.limitLabel ? store.limitLabel : '';
  }

  /* 字节数 → KB/MB/GB，保留 1 位小数 */
  function formatBytes(n) {
    if (!isFinite(n) || n < 0) return '--';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var v = n / 1024;
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + units[i];
  }

  /* ---------------- 搜索 ---------------- */
  function bindSearch() {
    var input = els.search;
    if (!input) return;

    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var value = input.value;
      state.query = value;
      state.shelfPage = 1;
      markShelf();
      renderShelf();
      if (els.clearBtn) els.clearBtn.hidden = !value;

      searchTimer = setTimeout(function () { updateSuggest(value); }, 220);
      if (!value.trim()) hideSuggest();
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' && suggestItems.length) {
        event.preventDefault();
        suggestIndex = (suggestIndex + 1) % suggestItems.length;
        paintSuggestActive();
      } else if (event.key === 'ArrowUp' && suggestItems.length) {
        event.preventDefault();
        suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
        paintSuggestActive();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (suggestIndex >= 0 && suggestItems[suggestIndex]) {
          var target = suggestItems[suggestIndex];
          if (target.kind === 'term') {
            input.value = target.text;
            state.query = target.text;
            state.shelfPage = 1;
            markShelf(); renderShelf(); hideSuggest();
          } else {
            openBook(target.id);
            hideSuggest();
          }
        } else {
          hideSuggest();
        }
      } else if (event.key === 'Escape') {
        hideSuggest();
      }
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) updateSuggest(input.value);
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('#libSearchWrap')) hideSuggest();
    });

    if (els.clearBtn) {
      els.clearBtn.addEventListener('click', function () {
        input.value = '';
        state.query = '';
        state.shelfPage = 1;
        markShelf(); renderShelf();
        els.clearBtn.hidden = true;
        hideSuggest();
        input.focus();
      });
    }
  }

  function updateSuggest(q) {
    var value = String(q || '').trim();
    if (!value) { hideSuggest(); return; }

    var lower = value.toLowerCase();
    var local = state.books.filter(function (b) {
      return [b.title, b.author, b.category].concat(b.tags || [])
        .join(' ').toLowerCase().indexOf(lower) >= 0;
    }).slice(0, 6).map(function (b) {
      return { kind: 'book', id: b.id, title: b.title, sub: b.author + ' · ' + b.category };
    });

    var terms = [];
    state.books.forEach(function (b) {
      if (b.title.toLowerCase().indexOf(lower) >= 0) terms.push(b.title);
      (b.tags || []).forEach(function (t) {
        if (t.toLowerCase().indexOf(lower) >= 0) terms.push(t);
      });
    });
    terms = terms.filter(function (t, i, arr) { return arr.indexOf(t) === i; }).slice(0, 4)
      .map(function (t) { return { kind: 'term', text: t }; });

    suggestItems = local.concat(terms);
    suggestIndex = -1;
    paintSuggest(value);

    if (state.mode === 'remote') {
      request('/library/suggest?q=' + encodeURIComponent(value), {}, 6000).then(function (data) {
        if (!data || !data.books) return;
        if (els.search && els.search.value.trim() !== value) return;
        var extra = data.books.filter(function (b) {
          return !suggestItems.some(function (s) { return s.kind === 'book' && s.id === b.id; });
        }).map(function (b) {
          return { kind: 'book', id: b.id, title: b.title, sub: (b.author || '') + ' · ' + (b.category || '') };
        });
        suggestItems = suggestItems.concat(extra).slice(0, 8);
        paintSuggest(value);
      }).catch(function () {});
    }
  }

  function paintSuggest(q) {
    if (!els.suggest) return;
    if (!suggestItems.length) {
      els.suggest.innerHTML = '<div class="lib-suggest-empty">没有匹配的书籍，按回车可直接筛选</div>';
      els.suggest.hidden = false;
      return;
    }
    els.suggest.innerHTML = '<div class="lib-suggest-head">搜索推荐</div>'
      + suggestItems.map(function (item, idx) {
        if (item.kind === 'term') {
          return '<button type="button" class="lib-suggest-item" data-term="' + esc(item.text) + '" data-idx="' + idx + '">'
            + '<span class="lib-suggest-ic">#</span>'
            + '<span class="lib-suggest-text">' + esc(item.text) + '</span>'
            + '<span class="lib-suggest-tag">关键词</span></button>';
        }
        return '<button type="button" class="lib-suggest-item" data-book="' + esc(item.id) + '" data-idx="' + idx + '">'
          + '<span class="lib-suggest-ic">📖</span>'
          + '<span class="lib-suggest-text">' + esc(item.title) + '<small>' + esc(item.sub) + '</small></span>'
          + '<span class="lib-suggest-tag">书籍</span></button>';
      }).join('');
    els.suggest.hidden = false;
    els.suggest.onmousedown = function (event) {
      event.preventDefault();
      var btn = event.target.closest('[data-idx]');
      if (!btn) return;
      var idx = Number(btn.getAttribute('data-idx'));
      var item = suggestItems[idx];
      if (!item) return;
      if (item.kind === 'term') {
        els.search.value = item.text;
        state.query = item.text;
        state.shelfPage = 1;
        markShelf(); renderShelf(); hideSuggest();
      } else {
        openBook(item.id);
        hideSuggest();
      }
    };
    paintSuggestActive();
  }

  function paintSuggestActive() {
    if (!els.suggest) return;
    els.suggest.querySelectorAll('.lib-suggest-item').forEach(function (el) {
      el.classList.toggle('is-active', Number(el.getAttribute('data-idx')) === suggestIndex);
    });
  }

  function hideSuggest() {
    if (els.suggest) els.suggest.hidden = true;
    suggestIndex = -1;
    suggestItems = [];
  }

  /* ---------------- 开书动画 ---------------- */
  function animateOpen(card, book) {
    return new Promise(function (resolve) {
      if (!els.openLayer || !card) { resolve(); return; }
      var rect = card.getBoundingClientRect();
      var viewRect = els.view.getBoundingClientRect();
      var layer = els.openLayer;
      layer.hidden = false;
      layer.innerHTML = '<div class="lib-fly-book" style="--accent:' + esc(book.accent) + '">'
        + '<div class="lib-fly-cover"><span class="lib-fly-cover-title">' + esc(book.title) + '</span>'
        + '<span class="lib-fly-cover-author">' + esc(book.author) + '</span></div>'
        + '<div class="lib-fly-pages"></div></div>';
      var fly = layer.querySelector('.lib-fly-book');
      var pad = 0;
      fly.style.left = rect.left + 'px';
      fly.style.top = rect.top + 'px';
      fly.style.width = rect.width + 'px';
      fly.style.height = rect.height + 'px';

      var targetW = Math.max(viewRect.width - 80, 320);
      var targetH = Math.max(viewRect.height - 120, 260);
      var sx = targetW / Math.max(rect.width, 1);
      var sy = targetH / Math.max(rect.height, 1);
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var tx = (viewRect.left + viewRect.width / 2) - cx;
      var ty = (viewRect.top + viewRect.height / 2 + 10) - cy;

      card.classList.add('is-opening');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          fly.classList.add('is-flying');
          fly.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + sx + ',' + sy + ')';
          fly.querySelector('.lib-fly-cover').classList.add('is-open');
        });
      });

      setTimeout(function () {
        layer.hidden = true;
        layer.innerHTML = '';
        if (card) card.classList.remove('is-opening');
        resolve();
      }, 720);
    });
  }

  /* ---------------- 书籍详情 ---------------- */
  var openToken = 0;   /* 每次打开自增：晚到的旧请求/旧动画不再改页面 */

  function openBook(id) {
    var book = byId(id);
    if (!book) return;
    var card = document.querySelector('.lib-book[data-id="' + id + '"]');
    var token = ++openToken;
    closeDetail(true);
    toast('正在打开《' + book.title + '》', 'info');

    /* 点击立即反馈：先用列表里的轻量书目播开书动画；动画结束后再按结果铺骨架/正文/错误，
       详情接口先返回也不会盖在飞书动画上 */
    var animDone = false, result = '', fullBook = null, failErr = null;
    function settle() {
      if (token !== openToken) return;
      if (result === 'ok') { state.current = fullBook; renderDetail(fullBook); }
      else if (result === 'err') { renderDetailError(book, failErr); }
      else { renderDetailPending(book); }
    }
    animateOpen(card, book).then(function () { animDone = true; settle(); });

    fetchBook(id, true).then(function (full) {
      if (token !== openToken) return;
      if (!full) throw new Error('详情为空：接口没有返回这本书');
      fullBook = full;
      result = 'ok';
      if (animDone) settle();
    }).catch(function (err) {
      if (token !== openToken) return;
      failErr = err;
      result = 'err';
      if (animDone) settle();
    });
  }

  /* 打开失败的类型化文案：超时 / 网络 / 权限 / 不存在 / 服务端错误分开说 */
  function openErrorText(err) {
    if (!err) return '未知错误';
    if (err.name === 'AbortError') return '请求超时，请检查网络后重试';
    var s = Number(err.status) || 0;
    if (s === 401 || s === 403) return '没有权限读取这本书（HTTP ' + s + '）';
    if (s === 404) return '这本书已不存在（HTTP 404）';
    if (s >= 500) return '服务器暂时不可用（HTTP ' + s + '）';
    if (s) return '请求失败（HTTP ' + s + '）';
    if (/Failed to fetch|NetworkError|network/i.test(String(err.message || ''))) return '网络连接失败，请检查网络后重试';
    return String(err.message || '未知错误');
  }

  function detailShell(book, bodyHtml) {
    var cover = coverUrlUsable(book.coverUrl) ? coverThumb(mediaFile(book.coverUrl), 640) : '';
    els.detail.innerHTML = '<div class="lib-detail-inner">'
      + '<button type="button" class="lib-back-btn" data-back>← 返回书架</button>'
      + '<div class="lib-detail-grid">'
      + '<div class="lib-detail-cover-col">'
      + '<div class="lib-detail-cover" style="--accent:' + esc(book.accent) + '" data-author="' + esc(book.author) + '">'
      + (cover
        ? '<img class="lib-detail-cover-img" src="' + esc(cover) + '" alt="' + esc(book.title) + '">'
        : '<span class="lib-detail-cover-frame"></span>'
          + '<span class="lib-detail-cover-title">' + esc(book.title) + '</span>'
          + '<span class="lib-detail-cover-rule"></span>'
          + '<span class="lib-detail-cover-author">' + esc(book.author) + '</span>'
          + '<span class="lib-detail-cover-brand">绘梦藏书 · 统一模板</span>')
      + '</div><div class="lib-detail-cover-shadow"></div></div>'
      + '<div class="lib-detail-info">'
      + '<div class="lib-detail-eyebrow">藏 书 阁 · ' + esc(book.category) + '</div>'
      + '<h1 class="lib-detail-title">' + esc(book.title) + '</h1>'
      + '<p class="lib-detail-author">' + esc(book.author) + ' 著</p>'
      + bodyHtml
      + '</div></div></div>';
    els.detail.hidden = false;
    requestAnimationFrame(function () { els.detail.classList.add('is-open'); });
    els.detail.querySelectorAll('[data-back]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeDetail(); });
    });
  }

  function renderDetailPending(book) {
    if (!els.detail) return;
    detailShell(book, '<div class="lib-loading">正在读取《' + esc(book.title) + '》…</div>');
  }

  function renderDetailError(book, err) {
    if (!els.detail) return;
    detailShell(book, '<div class="lib-empty" style="min-height:0;padding:24px 0;align-items:flex-start;text-align:left">'
      + '<h3>书籍加载失败</h3>'
      + '<p>' + esc(openErrorText(err)) + '</p>'
      + '<div class="lib-detail-actions">'
      + '<button type="button" class="lib-btn-primary" data-retry>重 试</button>'
      + '<button type="button" class="lib-btn" data-back>返回书架</button>'
      + '</div></div>');
    var retry = els.detail.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', function () { openBook(book.id); });
  }

  function detailProgressText(book) {
    var p = progressOf(book.id);
    if (!p) return '尚未开始阅读';
    var total = (book.pages || []).length;
    if (p === 0) return '上次读到目录';
    return '上次读到第 ' + Math.min(p, total) + ' / ' + total + ' 页';
  }

  function renderDetail(book) {
    if (!els.detail) return;
    state.page = progressOf(book.id) || 0;
    if (state.page > (book.pages || []).length) state.page = 0;

    var fav = isFavorite(book.id);
    var pages = (book.pages || []).length;
    var updated = new Date(book.updatedAt || nowMs());
    var dateStr = updated.getFullYear() + '-' + pad2(updated.getMonth() + 1) + '-' + pad2(updated.getDate());
    /* 详情接口的历史数据可能仍是旧域名/代理地址：优先改用列表接口已刷新的可用封面 */
    var detailCover = coverUrlUsable(book.coverUrl) ? book.coverUrl : '';
    if (!detailCover) {
      var listed = byId(book.id);
      if (listed && coverUrlUsable(listed.coverUrl)) detailCover = listed.coverUrl;
    }

    els.detail.innerHTML = '<div class="lib-detail-inner">'
      + '<button type="button" class="lib-back-btn" data-back>← 返回书架</button>'
      + '<div class="lib-detail-grid">'
      + '<div class="lib-detail-cover-col">'
      + '<div class="lib-detail-cover" style="--accent:' + esc(book.accent) + '" data-author="' + esc(book.author) + '">'
      + (detailCover
        ? '<img class="lib-detail-cover-img" src="' + esc(coverThumb(mediaFile(detailCover), 640)) + '" alt="' + esc(book.title) + '">'
        : '<span class="lib-detail-cover-frame"></span>'
          + '<span class="lib-detail-cover-title">' + esc(book.title) + '</span>'
          + '<span class="lib-detail-cover-rule"></span>'
          + '<span class="lib-detail-cover-author">' + esc(book.author) + '</span>'
          + '<span class="lib-detail-cover-brand">绘梦藏书 · 统一模板</span>')
      + '</div>'
      + '<div class="lib-detail-cover-shadow"></div>'
      + '</div>'
      + '<div class="lib-detail-info">'
      + '<div class="lib-detail-eyebrow">藏 书 阁 · ' + esc(book.category) + '</div>'
      + '<h1 class="lib-detail-title">' + esc(book.title) + '</h1>'
      + '<p class="lib-detail-author">' + esc(book.author) + ' 著</p>'
      + '<div class="lib-detail-tags">' + (book.tags || []).map(function (t) {
        return '<span>' + esc(t) + '</span>';
      }).join('') + '</div>'
      + '<p class="lib-detail-intro">' + esc(book.intro || '这本书还没有写下简介。') + '</p>'
      + '<div class="lib-detail-meta">'
      + '<span>共 ' + bookTotalPages(book) + ' 页</span><span>' + esc(book.category) + '</span>'
      + '<span>更新于 ' + dateStr + '</span><span>' + detailProgressText(book) + '</span>'
      + '</div>'
      + '<div class="lib-detail-actions">'
      + '<button type="button" class="lib-btn-primary" data-read>' + (progressOf(book.id) ? '继续阅读 · 第 ' + Math.max(progressOf(book.id), 1) + ' 页' : '开 始 阅 读') + '</button>'
      + '<button type="button" class="lib-btn lib-fav-btn' + (fav ? ' is-on' : '') + '" data-fav>' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>'
      + '<button type="button" class="lib-btn" data-edit>✎ 编辑</button>'
      + '</div>'
      + '<div class="lib-detail-tip">点击「开始阅读」向左翻页进入目录；阅读时可点击左右两侧翻书。</div>'
      + '</div></div>'
      + '<div class="lib-detail-toc">'
      + '<div class="lib-detail-toc-head">目 录 <span>' + pages + ' 章</span></div>'
      + '<div class="lib-detail-toc-list">'
      + (book.pages || []).map(function (p, idx) {
        return '<button type="button" class="lib-detail-toc-item" data-page="' + (idx + 1) + '">'
          + '<span class="lib-toc-no">' + pad2(idx + 1) + '</span>'
          + '<span class="lib-toc-title">' + esc(p.title) + '</span></button>';
      }).join('') || '<div class="lib-detail-toc-empty">暂无正文</div>'
      + '</div></div>'
      + '</div>';

    els.detail.hidden = false;
    requestAnimationFrame(function () { els.detail.classList.add('is-open'); });

    /* 详情页封面坏图：退化成文字封面 */
    var detailCoverImg = els.detail.querySelector('.lib-detail-cover-img');
    if (detailCoverImg) detailCoverImg.addEventListener('error', function () {
      var box = detailCoverImg.closest('.lib-detail-cover');
      if (!box) return;
      var title = detailCoverImg.getAttribute('alt') || '';
      var author = box.getAttribute('data-author') || '';
      if (detailCoverImg.parentNode) detailCoverImg.parentNode.removeChild(detailCoverImg);
      box.insertAdjacentHTML('afterbegin',
        '<span class="lib-detail-cover-frame"></span>'
        + '<span class="lib-detail-cover-title">' + esc(title) + '</span>'
        + '<span class="lib-detail-cover-rule"></span>'
        + '<span class="lib-detail-cover-author">' + esc(author) + '</span>'
        + '<span class="lib-detail-cover-brand">绘梦藏书 · 统一模板</span>');
    });

    els.detail.querySelector('[data-back]').addEventListener('click', function () { closeDetail(); });
    els.detail.querySelector('[data-read]').addEventListener('click', function () {
      enterReader(state.current, progressOf(state.current.id) || 0);
    });
    els.detail.querySelector('[data-fav]').addEventListener('click', function () {
      var on = !isFavorite(state.current.id);
      setFavorite(state.current.id, on);
      this.classList.toggle('is-on', on);
      this.textContent = on ? '★ 已收藏' : '☆ 收藏';
      toast(on ? '已加入收藏' : '已取消收藏', 'success');
      renderShelf();
    });
    els.detail.querySelector('[data-edit]').addEventListener('click', function () {
      openBookForm(state.current);
    });
    els.detail.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        enterReader(state.current, Number(btn.getAttribute('data-page')));
      });
    });
    /* 详情页就预取签名直链：点「继续阅读」时无需再等一次后端握手 */
    prefetchPdfSignedUrl(book);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function closeDetail(silent) {
    if (!els.detail) return;
    var wasOpen = !els.detail.hidden;
    els.detail.classList.remove('is-open');
    els.detail.hidden = true;
    els.detail.innerHTML = '';
    /* 用户主动返回时作废还在路上的打开请求，避免详情晚到又把页面顶开 */
    if (!silent) openToken += 1;
    if (!silent && state.current) state.current = null;
    /* 返回书架时刷新进度点与收藏星标 */
    if (!silent && wasOpen) { markShelf(); renderShelf(); }
  }

  /* ---------------- 阅读器 ---------------- */
  function pageCount(book) { return (book.pages || []).length + 1; }

  /* 真实总页数：优先书目接口的 pageCount，退回正文页数 */
  function bookTotalPages(book) {
    var n = Number(book && book.pageCount);
    if (n > 0) return n;
    return (book && book.pages ? book.pages.length : 0);
  }

  /* -------- PDF 目录：优先接口 toc，其次 pdf.js 书签，最后页码跳转 -------- */
  function setupPdfToc(book, doc) {
    var listEl = els.reader.querySelector('[data-toc-list]');
    if (!listEl) return;
    var toc = book.toc || [];
    if (toc.length) { renderPdfTocItems(listEl, toc); return; }
    if (!doc) {
      listEl.dataset.done = '1';
      listEl.innerHTML = '<div class="lib-toc-note">该 PDF 无内置目录<br>可在下方输入页码跳转</div>';
      return;
    }
    doc.getOutline().then(function (outline) {
      if (!outline || !outline.length) throw new Error('empty-outline');
      return resolvePdfOutline(doc, outline);
    }).then(function (items) {
      if (!items.length) throw new Error('empty-outline');
      renderPdfTocItems(listEl, items);
    }).catch(function () {
      listEl.dataset.done = '1';
      listEl.innerHTML = '<div class="lib-toc-note">该 PDF 无内置目录<br>可在下方输入页码跳转</div>';
    });
  }

  function normalizeTocPage(item) {
    var page = Number(item.page || item.p || 0);
    if (!page && item.href) {
      var m = /#page=(\d+)/i.exec(String(item.href));
      if (m) page = parseInt(m[1], 10);
    }
    return page;
  }

  function renderPdfTocItems(listEl, items) {
    listEl.dataset.done = '1';
    var html = items.map(function (it) {
      var page = normalizeTocPage(it);
      var depth = Math.min(Number(it.depth) || 0, 2);
      var title = it.title || it.name || it.label || '未命名';
      return '<button type="button" class="lib-pdf-toc-item' + (page ? '' : ' is-disabled') + '" data-toc-page="' + (page || '') + '" style="padding-left:' + (8 + depth * 12) + 'px">'
        + esc(title) + (page ? '<span class="lib-pdf-toc-page">' + page + '</span>' : '') + '</button>';
    }).join('');
    listEl.innerHTML = html || '<div class="lib-toc-note">该 PDF 无内置目录</div>';
    listEl.querySelectorAll('[data-toc-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = parseInt(btn.getAttribute('data-toc-page'), 10);
        if (page) flipTo(page);
      });
    });
  }

  var PDFJS_BASE = 'vendor/pdfjs/';
  var pdfJsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_BASE + 'pdf.min.js';
      s.onload = function () {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        } catch (e) {}
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        pdfJsPromise = null;
        reject(new Error('pdfjs-load-failed：' + s.src));
      };
      document.head.appendChild(s);
    });
    return pdfJsPromise;
  }

  function resolvePdfOutline(doc, outline) {
    var out = [];
    function walk(items, depth) {
      return items.reduce(function (p, it) {
        return p.then(function () {
          var destPromise = it.dest
            ? doc.getDestination(it.dest).catch(function () { return null; })
            : Promise.resolve(null);
          return destPromise.then(function (dest) {
            var pagePromise = (dest && dest[0])
              ? doc.getPageIndex(dest[0]).then(function (idx) { return idx + 1; }).catch(function () { return 0; })
              : Promise.resolve(0);
            return pagePromise.then(function (page) {
              out.push({ title: it.title || '未命名', page: page, depth: depth });
              return (it.items && it.items.length) ? walk(it.items, depth + 1) : null;
            });
          });
        }, function () { return null; });
      }, Promise.resolve());
    }
    return walk(outline, 0).then(function () { return out; });
  }

  /* -------- PDF 阅读：pdf.js canvas 自绘；任何失败都只在站内提示，绝不导航直链 -------- */
  function pdfOverlay() {
    return els.reader && els.reader.querySelector('[data-pdf-loading]');
  }

  function pdfLoadingText(text) {
    var el = els.reader && els.reader.querySelector('[data-loading-text]');
    if (el) el.textContent = text;
  }

  function hidePdfLoading() {
    clearPdfSlowTimer();
    var overlay = pdfOverlay();
    if (overlay) overlay.classList.add('is-hidden');
  }

  /* 14 秒没有新进展才提示「仍在加载」，有进度就不断重置 */
  function clearPdfSlowTimer() {
    if (pdfSlowTimer) { clearTimeout(pdfSlowTimer); pdfSlowTimer = null; }
  }

  function kickPdfSlowTimer(ms) {
    clearPdfSlowTimer();
    pdfSlowTimer = setTimeout(function () {
      pdfLoadingText('PDF 处理中（大文件首次打开较慢）… 请稍候，或点击重试');
      var retry = els.reader && els.reader.querySelector('[data-pdf-retry]');
      if (retry) retry.hidden = false;
    }, ms || 14000);
  }

  function formatMb(bytes) {
    return (Number(bytes || 0) / 1048576).toFixed(1) + ' MB';
  }

  function pdfProgress(loaded, total) {
    var text;
    if (total > 0 && loaded >= total) {
      /* 字节已下完，剩下的是 pdf.js 解析/排版，和网络无关 */
      pdfLoadingText('PDF 已下载，正在解析页面…');
      kickPdfSlowTimer(30000);
      return;
    }
    if (total > 0) {
      var pct = Math.max(0, Math.min(100, Math.round(loaded / total * 100)));
      text = '正在加载 ' + formatMb(loaded) + ' / ' + formatMb(total) + '（' + pct + '%）';
    } else if (loaded > 0) {
      text = '正在加载 ' + formatMb(loaded) + ' …';
    } else {
      return;
    }
    pdfLoadingText(text);
    kickPdfSlowTimer();
  }

  /* 向后端要一次性签名直链：只发地址，不搬字节；同一本书 5 分钟内复用 */
  var pdfSignedCache = {};
  var pdfSignedPending = {};
  var PDF_SIGNED_TTL = 5 * 60 * 1000;

  /* 打开一本书的分段耗时打点：点击 → /pdf-url → pdf.js 就绪 → 首页渲染 */
  var pdfPerf = {};
  function pdfPerfReset() {
    pdfPerf = { t0: performance.now() };
    window.__pdfPerf = null;
  }
  function reportPdfPerf() {
    if (!pdfPerf.t0 || !pdfPerf.first) return;
    var worker = Math.max(pdfPerf.js || pdfPerf.t0, pdfPerf.url || pdfPerf.t0);
    var out = {
      url: Math.round((pdfPerf.url || 0) - pdfPerf.t0),
      js: Math.round((pdfPerf.js || 0) - pdfPerf.t0),
      doc: Math.round((pdfPerf.doc || 0) - pdfPerf.t0),
      firstPaint: Math.round(pdfPerf.first - pdfPerf.t0),
      urlToWorker: Math.round(worker - (pdfPerf.url || pdfPerf.t0)),
      workerToFirst: Math.round(pdfPerf.first - worker)
    };
    window.__pdfPerf = out;
    try { console.info('[perf] pdf.open ' + JSON.stringify(out)); } catch (e) {}
  }

  /* 阅读器预热：空闲时把 pdf.js 主脚本与 worker 拉进浏览器缓存，点击时不再付这一笔 */
  var pdfWarmStarted = false;
  function warmPdfReader() {
    if (pdfWarmStarted) return;
    pdfWarmStarted = true;
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    idle(function () {
      loadPdfJs().then(function () {
        try {
          /* 只为进 HTTP 缓存；失败无副作用 */
          fetch(PDFJS_BASE + 'pdf.worker.min.js', { cache: 'force-cache' }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
    }, { timeout: 3000 });
  }

  function fetchPdfSignedUrl(book, force) {
    var id = String((book && book.id) || '');
    var hit = id && pdfSignedCache[id];
    if (!force && hit && Date.now() - hit.at < PDF_SIGNED_TTL) return Promise.resolve(hit.url);
    if (!force && pdfSignedPending[id]) return pdfSignedPending[id];

    function once() {
      return request('/library/books/' + encodeURIComponent(id) + '/pdf-url', {}, 30000)
        .then(function (data) {
          var url = data && (data.url || data.pdfUrl || data.signedUrl);
          if (!url) throw new Error('pdf-url 未返回可用地址');
          url = mediaFile(url);
          pdfSignedCache[id] = { url: String(url), at: Date.now() };
          return String(url);
        });
    }
    var pending = once().catch(function (err) {
      /* 超时 / 网络错误 / 5xx 先重试一次，避免一次慢握手就退回整卷流式 */
      var status = err && err.status;
      if (status && status < 500) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, 700); }).then(once);
    }).then(function (url) {
      delete pdfSignedPending[id];
      return url;
    }, function (err) {
      delete pdfSignedPending[id];
      throw err;
    });
    if (!force) pdfSignedPending[id] = pending;
    return pending;
  }

  /* 详情页预取：不阻塞界面，失败静默，真正阅读时仍会重试 */
  function prefetchPdfSignedUrl(book) {
    if (!book || !book.pdfUrl) return;
    fetchPdfSignedUrl(book).catch(function () {});
  }

  function setPdfTocCollapsed(on) {
    state.pdfTocCollapsed = !!on;
    if (!els.reader) return;
    var aside = els.reader.querySelector('[data-pdf-toc]');
    if (aside) aside.classList.toggle('is-collapsed', state.pdfTocCollapsed);
    var caret = els.reader.querySelector('[data-toc-caret]');
    if (caret) caret.textContent = state.pdfTocCollapsed ? '▸' : '▾';
    var head = els.reader.querySelector('.lib-pdf-toc-head');
    if (head) head.setAttribute('aria-expanded', state.pdfTocCollapsed ? 'false' : 'true');
    var btn = els.reader.querySelector('.lib-pdf-toc-toggle');
    if (btn) btn.classList.toggle('is-on', state.pdfTocCollapsed);
  }

  function pdfModeName(mode) {
    if (mode === 'fit') return '适应宽度';
    if (mode === 'height') return '适应高度';
    if (mode === 'page') return '适应页面';
    return Math.round(Number(mode) * 100) + '%';
  }

  function readPdfMode() {
    try {
      var v = localStorage.getItem(LS.pdfMode);
      if (v === 'fit' || v === 'height' || v === 'page') return v;
      var n = Number(v);
      if (v && isFinite(n) && n >= 0.4 && n <= 6) return n;
    } catch (e) {}
    return 'fit';
  }

  function savePdfMode(mode) {
    try { localStorage.setItem(LS.pdfMode, String(mode)); } catch (e) {}
    if (window.HMSync && window.HMSync.pushLibraryPrefs) {
      clearTimeout(libPrefsPushTimer);
      libPrefsPushTimer = setTimeout(function () { window.HMSync.pushLibraryPrefs(); }, 600);
    }
  }

  function updatePdfZoomLabel() {
    var el = els.reader && els.reader.querySelector('[data-zoom-label]');
    if (el) el.textContent = pdfModeName(state.pdfZoom);
    if (!els.reader) return;
    els.reader.querySelectorAll('[data-pdf-mode]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-pdf-mode') === state.pdfZoom);
    });
  }

  function setPdfZoom(next) {
    state.pdfZoom = next;
    savePdfMode(next);
    updatePdfZoomLabel();
    renderPdfCanvas();
  }

  var PDF_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  function stepPdfZoom(dir) {
    var cur = typeof state.pdfZoom === 'number' ? state.pdfZoom : (state.pdfLastScale || 1);
    var i = 0;
    while (i < PDF_ZOOM_STEPS.length && PDF_ZOOM_STEPS[i] < cur - 0.001) i++;
    var next = dir > 0
      ? PDF_ZOOM_STEPS[Math.min(PDF_ZOOM_STEPS.length - 1, i)]
      : PDF_ZOOM_STEPS[Math.max(0, i - 1)];
    setPdfZoom(next);
  }

  function renderPdfCanvas() {
    var doc = state.pdfDoc;
    var canvas = els.reader && els.reader.querySelector('[data-pdf-canvas]');
    var scroll = els.reader && els.reader.querySelector('[data-pdf-scroll]');
    if (!doc || !canvas || !scroll) return;
    var pageNo = Math.max(1, Math.min(state.page, doc.numPages));
    /* 页号变化：先清掉上一页覆盖层；处于译文态时渲染完成后自动翻新页 */
    var pageChanged = !!(pageOcr.page && pageOcr.page !== pageNo);
    if (pageChanged) {
      pageOcr.page = pageNo;
      pageOcr.bookId = state.current ? String(state.current.id) : '';
      pageOcr.token++;
      pageOcr.busy = false;
      pageOcrClearVisual();
      pageOcrSync();
    }
    var token = ++state.pdfToken;
    if (state.pdfTask && state.pdfTask.cancel) {
      try { state.pdfTask.cancel(); } catch (e) {}
    }
    doc.getPage(pageNo).then(function (page) {
      if (token !== state.pdfToken) return null;
      var base = page.getViewport({ scale: 1 });
      var availW = Math.max(240, (scroll.clientWidth || 820) - 28);
      /* 减去上下 padding 与横向滚动条余量，保证「适应高度」不出现纵向滚动条 */
      var availH = Math.max(220, (scroll.clientHeight || 640) - 48);
      var scale;
      if (state.pdfZoom === 'height') scale = availH / base.height;
      else if (state.pdfZoom === 'page') scale = Math.min(availW / base.width, availH / base.height);
      else if (state.pdfZoom === 'fit') scale = availW / base.width;
      else scale = Number(state.pdfZoom) || 1;
      state.pdfLastScale = scale;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      canvas.style.width = Math.round(vp.width / dpr) + 'px';
      canvas.style.height = Math.round(vp.height / dpr) + 'px';
      var task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      state.pdfTask = task;
      return task.promise.then(function () {
        if (token !== state.pdfToken) return;
        if (!pdfPerf.first) { pdfPerf.first = performance.now(); reportPdfPerf(); }
        hidePdfLoading();
        requestAnimationFrame(function () {
          if (pageChanged && pageOcr.mode === 'dst') pageOcrShow();
          else pageOcrRelayout();
        });
        /* 只预取下一页，不预取全书 */
        state.pdfPrefetched = state.pdfPrefetched || {};
        var next = pageNo + 1;
        if (next <= doc.numPages && !state.pdfPrefetched[next]) {
          state.pdfPrefetched[next] = true;
          doc.getPage(next).catch(function () {});
        }
      });
    }).catch(function (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.warn('[library] PDF 渲染失败：', err && err.name, err && err.message);
      showPdfError(err);
    });
    scroll.scrollTop = 0;
  }

  /* 失败时只在站内提示 + 重试；不创建 iframe、不打开直链 */
  function showPdfError(err) {
    clearPdfSlowTimer();
    var scroll = els.reader && els.reader.querySelector('[data-pdf-scroll]');
    if (scroll) scroll.hidden = true;
    var bar = els.reader && els.reader.querySelector('.lib-pdf-toolbar');
    if (bar) bar.hidden = true;
    var overlay = pdfOverlay();
    if (overlay) overlay.classList.remove('is-hidden');
    var spinner = els.reader && els.reader.querySelector('[data-pdf-spinner]');
    if (spinner) spinner.hidden = true;
    var timedOut = !!(err && /加载超时/.test(String(err.message || '')));
    pdfLoadingText(timedOut
      ? 'PDF 加载失败：读取超时（网络或存储服务响应异常），请点击「重试」'
      : 'PDF 加载失败：无法读取文件（网络或存储服务异常），请点击「重试」');
    var retry = els.reader && els.reader.querySelector('[data-pdf-retry]');
    if (retry) retry.hidden = false;
    /* 原始错误：name / message / stack 前几行，可选中复制，便于用户截图定位 */
    var raw = els.reader && els.reader.querySelector('[data-pdf-raw]');
    if (raw) {
      if (err) {
        var lines = [];
        lines.push((err.name || 'Error') + ': ' + (err.message || String(err)));
        var stack = String(err.stack || '').split('\n').slice(1, 4);
        for (var i = 0; i < stack.length; i++) if (stack[i].trim()) lines.push(stack[i].trim());
        raw.textContent = lines.join('\n');
        raw.hidden = false;
      } else {
        raw.hidden = true;
        raw.textContent = '';
      }
    }
    if (err) console.warn('[library] PDF 加载失败：', err.name || '', err.message || '');
  }

  function ensurePdfDoc(book) {
    if (state.pdfDoc) return Promise.resolve(state.pdfDoc);
    if (state.pdfDocPromise) return state.pdfDocPromise;

    function streamUrl(url) {
      var s = String(url || '');
      var hashAt = s.indexOf('#');
      var hash = hashAt >= 0 ? s.slice(hashAt) : '';
      var base = hashAt >= 0 ? s.slice(0, hashAt) : s;
      return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'stream=1' + hash;
    }

    state.pdfDocPromise = loadPdfJs()
      .then(function (pdfjs) {
        pdfPerf.js = performance.now();
        /* 分段读取：只取当前页需要的字节；带真实进度回调
         * 看门狗：20 秒没有首字节 / 60 秒没有新进度就中止本次取件，
         * 避免后端返回空响应（如 SCF 文件接口只给响应头）时一直转圈 */
        var PDF_FIRST_BYTE_MS = 20000;
        var PDF_STALL_MS = 60000;
        function open(url) {
          return new Promise(function (resolve, reject) {
            var task = pdfjs.getDocument({
              url: url,
              disableRange: false,
              disableStream: false,
              /* 不后台整卷预取：大 PDF 在慢网下会把带宽抢光，先保证首屏 */
              disableAutoFetch: true,
              withCredentials: false
            });
            var settled = false;
            var watchdog = null;
            function arm(ms) {
              if (watchdog) clearTimeout(watchdog);
              watchdog = setTimeout(function () {
                fail(new Error('加载超时：' + Math.round(ms / 1000) + ' 秒没有收到新数据'));
              }, ms);
            }
            function fail(err) {
              if (settled) return;
              settled = true;
              if (watchdog) { clearTimeout(watchdog); watchdog = null; }
              try { task.destroy(); } catch (e) {}
              reject(err);
            }
            task.onProgress = function (p) {
              if (!p) return;
              pdfProgress(p.loaded || 0, p.total || 0);
              arm(PDF_STALL_MS);
            };
            task.promise.then(function (doc) {
              if (settled) { try { doc.destroy(); } catch (e) {} return; }
              settled = true;
              if (watchdog) { clearTimeout(watchdog); watchdog = null; }
              resolve(doc);
            }, fail);
            arm(PDF_FIRST_BYTE_MS);
          });
        }

        var attempts = [];
        /* 第一选择：后端签名直链，字节完全不过我们的服务器 */
        if (!pdfSignedCache[String(book.id)]) pdfLoadingText('正在获取加速地址…');
        return fetchPdfSignedUrl(book).then(function (signed) {
          pdfPerf.url = performance.now();
          pdfLoadingText('正在加载 PDF …');
          kickPdfSlowTimer(20000);
          return open(signed);
        }).catch(function (err) {
          attempts.push('签名直链（' + (err && err.name) + ' / ' + (err && err.message) + '）');
          console.warn('[library] 签名直链失败，改用 stream=1：', err && err.name, err && err.message);
          var streamed = streamUrl(mediaFile(book.pdfUrl));
          pdfLoadingText('正在加载 PDF …');
          kickPdfSlowTimer();
          return open(streamed).catch(function (err2) {
            attempts.push('流式 ' + streamed + '（' + (err2 && err2.name) + ' / ' + (err2 && err2.message) + '）');
            var e = new Error('已尝试：' + attempts.join('；'));
            e.name = (err2 && err2.name) || (err && err.name) || 'Error';
            throw e;
          });
        });
      })
      .then(function (doc) { state.pdfDoc = doc; pdfPerf.doc = performance.now(); return doc; });
    return state.pdfDocPromise;
  }

  /* PDF 加载提示与重试；先渲染框架，再加载 PDF */
  function setupPdfReader(book) {
    state.pdfDoc = null;
    state.pdfDocPromise = null;
    state.pdfTotal = 0;
    state.pdfZoom = readPdfMode();
    state.pdfPrefetched = {};
    state.pdfToken = (state.pdfToken || 0) + 1;

    var overlay = pdfOverlay();
    var txt = overlay && overlay.querySelector('[data-loading-text]');
    var retry = overlay && overlay.querySelector('[data-pdf-retry]');

    function resetLoading(text) {
      var sc = els.reader && els.reader.querySelector('[data-pdf-scroll]');
      var bar = els.reader && els.reader.querySelector('.lib-pdf-toolbar');
      var spinner = els.reader && els.reader.querySelector('[data-pdf-spinner]');
      if (overlay) overlay.classList.remove('is-hidden');
      if (sc) sc.hidden = false;
      if (bar) bar.hidden = false;
      if (spinner) spinner.hidden = false;
      pdfLoadingText(text || '正在加载 PDF …');
      if (retry) retry.hidden = true;
      /* 首次取直链 + 首段字节可能较慢，给 20 秒；之后有进度就按 14 秒重置 */
      kickPdfSlowTimer(20000);
    }

    resetLoading();

    var scroll = els.reader.querySelector('[data-pdf-scroll]');
    if (scroll && !scroll.dataset.pdfWheel) {
      scroll.dataset.pdfWheel = '1';
      scroll.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        stepPdfZoom(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    var zoomOut = els.reader.querySelector('[data-zoom-out]');
    var zoomIn = els.reader.querySelector('[data-zoom-in]');
    if (zoomOut && !zoomOut.dataset.pdfZoomBound) {
      zoomOut.dataset.pdfZoomBound = '1';
      zoomOut.addEventListener('click', function () { stepPdfZoom(-1); });
    }
    if (zoomIn && !zoomIn.dataset.pdfZoomBound) {
      zoomIn.dataset.pdfZoomBound = '1';
      zoomIn.addEventListener('click', function () { stepPdfZoom(1); });
    }

    if (retry) {
      retry.dataset.pdfRetry = '1';
      retry.onclick = function () {
        state.pdfDoc = null;
        state.pdfDocPromise = null;
        setupPdfReader(book);
        paintPdfPage();
      };
    }

    var jump = els.reader.querySelector('[data-toc-jump]');
    var go = els.reader.querySelector('[data-toc-go]');
    function doJump() {
      var n = parseInt(jump && jump.value, 10);
      if (!n || n < 1) return;
      flipTo(Math.min(n, Math.max(1, state.pdfTotal || bookTotalPages(book))));
    }
    if (go && !go.dataset.pdfBound) {
      go.dataset.pdfBound = '1';
      go.addEventListener('click', doJump);
    }
    if (jump && !jump.dataset.pdfBound) {
      jump.dataset.pdfBound = '1';
      jump.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJump(); });
    }

    ensurePdfDoc(book).then(function (doc) {
      state.pdfTotal = doc.numPages;
      updatePdfZoomLabel();
      paintPdfPage();
      setupPdfToc(book, doc);
    }).catch(function (err) {
      console.warn('[library] pdf.js 加载失败：', err && err.name, err && err.message);
      showPdfError(err);
      setupPdfToc(book, null);
    });
  }

  function enterReader(book, page) {
    if (!book) return;
    /* pdf.js 只在真正进入 PDF 阅读器时加载，书架上浏览不再抢占首屏带宽 */
    if (book.pdfUrl) warmPdfReader();
    state.current = book;
    if (book.pdfUrl) pdfPerfReset();
    if (book.pdfUrl) {
      /* PDF 书：页号 1..真实总页数 */
      var pdfMax = Math.max(1, bookTotalPages(book));
      state.page = Math.max(1, Math.min(Number(page) || 1, pdfMax));
    } else {
      state.page = Math.max(0, Math.min(Number(page) || 0, pageCount(book) - 1));
    }
    closeDetail(true);
    renderReader();
    els.reader.hidden = false;
    requestAnimationFrame(function () { els.reader.classList.add('is-open'); });
    paintPage();
    persistProgress(book.id, state.page);
  }

  function renderReader() {
    if (!els.reader) return;
    var book = state.current;
    var isPdf = !!book.pdfUrl;
    var stageHtml = isPdf
      ? '<aside class="lib-pdf-toc" data-pdf-toc>'
        + '<button type="button" class="lib-pdf-toc-head" data-toc-toggle aria-expanded="true">'
        + '<span>目录</span><span class="lib-pdf-toc-caret" data-toc-caret>▾</span></button>'
        + '<div class="lib-pdf-toc-list" data-toc-list><div class="lib-toc-note">正在解析目录…</div></div>'
        + '<div class="lib-pdf-toc-jump"><input type="number" min="1" step="1" data-toc-jump placeholder="页码"><button type="button" class="lib-toc-go" data-toc-go>跳转</button></div>'
        + '</aside>'
        + '<div class="lib-pdf-view">'
        + '<div class="lib-pdf-toolbar">'
        + '<button type="button" class="lib-pdf-toc-toggle" data-toc-toggle aria-label="展开或收起目录">☰ 目录</button>'
        + '<span class="lib-pdf-modes">'
        + '<button type="button" class="lib-pdf-mode" data-pdf-mode="fit">适应宽度</button>'
        + '<button type="button" class="lib-pdf-mode" data-pdf-mode="height">适应高度</button>'
        + '<button type="button" class="lib-pdf-mode" data-pdf-mode="page">适应页面</button>'
        + '</span>'
        + '<button type="button" class="lib-pdf-zoom" data-zoom-out aria-label="缩小">−</button>'
        + '<span class="lib-pdf-zoom-label" data-zoom-label>适应宽度</span>'
        + '<button type="button" class="lib-pdf-zoom" data-zoom-in aria-label="放大">+</button>'
        + '<button type="button" class="lib-pdf-open" data-pdf-full>⛶ 全屏阅读</button>'
        + '<select class="lib-pdf-ocr-lang" data-page-ocr-lang title="整页识别语言">'
        + '<option value="auto">自动</option><option value="jpn">日文</option>'
        + '<option value="eng">英文</option><option value="chi_sim">中文</option>'
        + '</select>'
        + '<button type="button" class="lib-pdf-open lib-pdf-ocr" data-page-ocr aria-pressed="false" title="把当前页整页文字译成中文并原位覆盖">全文翻译</button>'
        + '</div>'
        + '<div class="lib-pdf-scroll" data-pdf-scroll>'
        + '<div class="lib-pdf-stage" data-pdf-stage>'
        + '<canvas class="lib-pdf-canvas" data-pdf-canvas></canvas>'
        + '<div class="lib-page-ocr-layer" data-page-ocr-layer hidden></div>'
        + '<div class="lib-page-ocr-tip" data-page-ocr-tip hidden>'
        + '<span data-page-ocr-msg></span><button type="button" data-page-ocr-copy hidden>复制原文</button>'
        + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="lib-pdf-loading" data-pdf-loading>'
        + '<span class="lib-pdf-spinner" data-pdf-spinner></span><span data-loading-text>正在加载 PDF …</span>'
        + '<button type="button" class="lib-pdf-retry" data-pdf-retry hidden>重试</button>'
        + '<pre class="lib-pdf-raw" data-pdf-raw hidden></pre>'
        + '</div>'
        + '</div>'
      : '<div class="lib-book-frame">'
        + '<div class="lib-page-under" data-under></div>'
        + '<div class="lib-page-top" data-top></div>'
        + '<div class="lib-page-gutter"></div>'
        + '</div>';
    els.reader.innerHTML = '<div class="lib-reader-top">'
      + '<button type="button" class="lib-reader-back" data-exit>← 合上书</button>'
      + '<div class="lib-reader-title">《' + esc(book.title) + '》</div>'
      + '<div class="lib-reader-page-label" data-page-label></div>'
      + '<button type="button" class="lib-fs-btn lib-reader-ocr" data-ocr-open aria-expanded="false" title="识别并翻译当前页">文 识别翻译</button>'
      + '<button type="button" class="lib-fs-btn" data-fs title="全屏阅读">⛶ 全屏</button>'
      + '</div>'
      + '<div class="lib-reader-stage' + (isPdf ? ' is-pdf' : '') + '">'
      + '<button type="button" class="lib-flip-zone lib-flip-left" data-prev aria-label="上一页">'
      + '<span class="lib-flip-arrow">‹</span></button>'
      + stageHtml
      + '<button type="button" class="lib-flip-zone lib-flip-right" data-next aria-label="下一页">'
      + '<span class="lib-flip-arrow">›</span></button>'
      + '</div>'
      + '<div class="lib-reader-bottom">'
      + '<div class="lib-reader-progress"><div class="lib-reader-progress-fill" data-fill></div></div>'
      + '<div class="lib-reader-hint">' + (isPdf ? '左右按钮翻 PDF 页 · 上下滑动浏览' : '点击左侧 / 右侧翻页 · 也可使用 ← → 键') + '</div>'
      + '</div>';

    els.reader.querySelector('[data-exit]').addEventListener('click', exitReader);
    els.reader.querySelector('[data-prev]').addEventListener('click', function () { flipTo(state.page - 1); });
    els.reader.querySelector('[data-next]').addEventListener('click', function () { flipTo(state.page + 1); });
    els.reader.querySelector('[data-fs]').addEventListener('click', toggleReaderFullscreen);
    var readerOcr = els.reader.querySelector('[data-ocr-open]');
    if (readerOcr) {
      if (ocr.open) { readerOcr.classList.add('is-on'); readerOcr.setAttribute('aria-expanded', 'true'); }
      readerOcr.addEventListener('click', function () { ocr.open ? closeOcrDock() : ocrOpen(); });
    }
    var pageOcrBtn = els.reader.querySelector('[data-page-ocr]');
    if (pageOcrBtn) pageOcrBtn.addEventListener('click', pageOcrToggle);
    var pageLangSel = els.reader.querySelector('[data-page-ocr-lang]');
    if (pageLangSel) {
      pageLangSel.value = pageOcrReadLang();
      pageLangSel.addEventListener('change', function () { pageOcrSaveLang(pageLangSel.value); });
    }
    var fullBtn = els.reader.querySelector('[data-pdf-full]');
    if (fullBtn) fullBtn.addEventListener('click', toggleReaderFullscreen);
    syncFsButton();
    /* 目录展开 / 收起：标题与工具栏按钮都可切换 */
    els.reader.querySelectorAll('[data-toc-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () { setPdfTocCollapsed(!state.pdfTocCollapsed); });
    });
    setPdfTocCollapsed(state.pdfTocCollapsed);
    /* 缩放模式：适应宽度 / 适应高度 / 适应页面 */
    els.reader.querySelectorAll('[data-pdf-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setPdfZoom(btn.getAttribute('data-pdf-mode')); });
    });
    if (isPdf) setupPdfReader(book);
    updatePdfZoomLabel();
    var topEl = els.reader.querySelector('[data-top]');
    if (topEl) topEl.addEventListener('click', function (event) {
      var toc = event.target.closest('[data-toc-page]');
      if (toc) {
        var targetPage = Number(toc.getAttribute('data-toc-page'));
        if (targetPage === state.page) return;
        jumpTo(targetPage);
        return;
      }
      var link = event.target.closest('[data-jump]');
      if (link) jumpTo(Number(link.getAttribute('data-jump')));
    });

    /* 阅读器入场：像翻开一页 */
    els.reader.classList.add('is-entering');
    setTimeout(function () { els.reader.classList.remove('is-entering'); }, 700);
  }

  function paintPage() {
    if (!els.reader || !state.current) return;
    if (state.current.pdfUrl) { paintPdfPage(); return; }
    var top = els.reader.querySelector('[data-top]');
    var under = els.reader.querySelector('[data-under]');
    if (top) top.innerHTML = pageHtml(state.current, state.page);
    if (under) under.innerHTML = '';
    var label = els.reader.querySelector('[data-page-label]');
    var realTotal = bookTotalPages(state.current);
    if (label) {
      label.textContent = state.page === 0
        ? '目录 · 共 ' + realTotal + ' 页'
        : '第 ' + state.page + ' / ' + Math.max(realTotal, state.page) + ' 页';
    }
    var fill = els.reader.querySelector('[data-fill]');
    if (fill) {
      var pct = realTotal <= 0 ? 100 : Math.round((state.page / realTotal) * 100);
      fill.style.width = Math.min(100, pct) + '%';
    }
    updateFlipZones();
  }

  /* PDF 阅读：只走 pdf.js canvas 自绘 */
  function paintPdfPage() {
    var book = state.current;
    var total = state.pdfTotal || Math.max(1, bookTotalPages(book));
    if (state.page > total) state.page = total;
    if (state.pdfDoc) renderPdfCanvas();
    var label = els.reader.querySelector('[data-page-label]');
    if (label) label.textContent = '第 ' + state.page + ' / ' + total + ' 页';
    var fill = els.reader.querySelector('[data-fill]');
    if (fill) fill.style.width = Math.min(100, Math.round((state.page / total) * 100)) + '%';
    updateFlipZones();
  }

  function updateFlipZones() {
    if (!els.reader) return;
    var prev = els.reader.querySelector('[data-prev]');
    var next = els.reader.querySelector('[data-next]');
    var isPdf = !!(state.current && state.current.pdfUrl);
    var max = isPdf
      ? (state.pdfTotal || Math.max(1, bookTotalPages(state.current)))
      : pageCount(state.current) - 1;
    var min = isPdf ? 1 : 0;
    if (prev) prev.classList.toggle('is-disabled', state.page <= min);
    if (next) next.classList.toggle('is-disabled', state.page >= max);
  }

  function pageHtml(book, page) {
    var pages = book.pages || [];
    if (page <= 0) {
      return '<div class="lib-page-inner lib-page-toc">'
        + '<div class="lib-page-ornament">✦ ✦ ✦</div>'
        + '<h2 class="lib-page-h">目 录</h2>'
        + '<div class="lib-page-sub">《' + esc(book.title) + '》 · ' + esc(book.author) + '</div>'
        + '<div class="lib-toc-list">'
        + (pages.length ? pages.map(function (p, idx) {
          return '<button type="button" class="lib-toc-row" data-toc-page="' + (idx + 1) + '">'
            + '<span class="lib-toc-dots"><span>' + pad2(idx + 1) + '</span>'
            + '<span class="lib-toc-leader"></span>'
            + '<span>' + esc(p.title) + '</span></span>'
            + '<span class="lib-toc-pg">P' + (idx + 1) + '</span></button>';
        }).join('') : '<div class="lib-page-empty">这本书还没有正文，可在「编辑」里补充。</div>')
        + '</div>'
        + '<div class="lib-page-foot">— ' + esc(book.category) + ' —</div>'
        + '</div>';
    }
    var p = pages[page - 1];
    if (!p) {
      return '<div class="lib-page-inner"><div class="lib-page-empty">这一页是空白的。</div></div>';
    }
    return '<div class="lib-page-inner">'
      + '<div class="lib-page-ornament">✦</div>'
      + '<h2 class="lib-page-h">' + esc(p.title) + '</h2>'
      + '<div class="lib-page-body">' + esc(p.content).replace(/\n/g, '<br>') + '</div>'
      + '<div class="lib-page-foot">— ' + page + ' / ' + pages.length + ' · ' + esc(book.title) + ' —</div>'
      + '</div>';
  }

  function jumpTo(target, dir) {
    if (state.flipBusy) return;
    var total = pageCount(state.current);
    if (target < 0 || target >= total || target === state.page) return;
    var direction = dir || (target > state.page ? 'next' : 'prev');
    if (Math.abs(target - state.page) > 1) {
      /* 目录跳转：直接落页，带一次轻翻 */
      state.page = target;
      paintPage();
      persistProgress(state.current.id, state.page);
      return;
    }
    doFlip(target, direction);
  }

  function flipTo(target) {
    if (state.current && state.current.pdfUrl) {
      var pdfTotal = state.pdfTotal || Math.max(1, bookTotalPages(state.current));
      if (target < 1 || target > pdfTotal || target === state.page) return;
      state.page = target;
      paintPage();
      persistProgress(state.current.id, state.page);
      return;
    }
    var total = pageCount(state.current);
    if (state.flipBusy || target < 0 || target >= total) return;
    doFlip(target, target > state.page ? 'next' : 'prev');
  }

  function doFlip(target, dir) {
    if (!els.reader || !state.current) return;
    if (state.flipBusy || target === state.page) return;
    state.flipBusy = true;

    var top = els.reader.querySelector('[data-top]');
    var under = els.reader.querySelector('[data-under]');
    if (!top || !under) { state.flipBusy = false; return; }

    /* 下面先铺好目标页，上面是正在翻动的这一页 */
    if (dir === 'next') {
      under.innerHTML = pageHtml(state.current, target);
      under.classList.add('is-visible');
      top.innerHTML = pageHtml(state.current, state.page);
      top.classList.remove('is-flip-prev', 'is-flip-prev-init');
      top.classList.add('is-flip-next');
    } else {
      under.innerHTML = pageHtml(state.current, state.page);
      under.classList.add('is-visible');
      top.innerHTML = pageHtml(state.current, target);
      top.classList.remove('is-flip-next', 'is-flip-prev');
      top.classList.add('is-flip-prev-init');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          top.classList.remove('is-flip-prev-init');
          top.classList.add('is-flip-prev');
        });
      });
    }

    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      top.classList.remove('is-flip-next', 'is-flip-prev', 'is-flip-prev-init');
      under.classList.remove('is-visible');
      under.innerHTML = '';
      state.page = target;
      state.flipBusy = false;
      paintPage();
      persistProgress(state.current.id, state.page);
    };
    top.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 760);
  }

  /* 阅读界面全屏（Esc 退出时按钮状态由 fullscreenchange 复位） */
  function syncFsButton() {
    var btn = els.reader && els.reader.querySelector('[data-fs]');
    if (!btn) return;
    var on = !!document.fullscreenElement && els.reader.contains(document.fullscreenElement);
    btn.textContent = on ? '⤢ 退出全屏' : '⛶ 全屏';
    btn.classList.toggle('is-on', on);
    var full = els.reader.querySelector('[data-pdf-full]');
    if (full) {
      full.textContent = on ? '⤢ 退出全屏' : '⛶ 全屏阅读';
      full.classList.toggle('is-on', on);
    }
  }

  function toggleReaderFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    if (els.reader && els.reader.requestFullscreen) {
      var p = els.reader.requestFullscreen();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function exitReader() {
    if (!els.reader) return;
    if (document.fullscreenElement && els.reader.contains(document.fullscreenElement) && document.exitFullscreen) {
      document.exitFullscreen();
    }
    state.pdfDoc = null;
    state.pdfDocPromise = null;
    state.pdfTotal = 0;
    state.pdfPrefetched = {};
    state.pdfToken = (state.pdfToken || 0) + 1;
    clearPdfSlowTimer();
    els.reader.classList.remove('is-open', 'is-entering');
    els.reader.hidden = true;
    els.reader.innerHTML = '';
    if (state.current) {
      var book = state.current;
      markHistClosed(book.id);
      renderDetail(book);
    }
  }

  /* ---------------- 收藏 / 历史 ---------------- */
  function showPanel(kind) {
    if (!els.modal) return;
    var title = kind === 'fav' ? '我的收藏' : '阅读历史';
    if (kind === 'hist') pruneHistory(true);
    var list;
    var tools = '';
    var hint = '';
    var emptyText;
    if (kind === 'fav') {
      list = state.books.filter(function (b) { return isFavorite(b.id); })
        .map(function (b) { return { book: b, h: null }; });
      emptyText = '还没有收藏的书籍，打开一本书点击「收藏」吧。';
    } else {
      list = state.hist.filter(histInRange)
        .map(function (h) {
          var b = h.book || byId(h.bookId);
          return b ? { book: b, h: h } : null;
        })
        .filter(Boolean);
      emptyText = state.hist.length
        ? '这个时间段内没有阅读记录，换个时间范围试试。'
        : '还没有阅读记录，去书架翻开一本书。';
      tools = '<div class="lib-panel-tools">'
        + '<select data-hist-range aria-label="按时间段筛选阅读历史">'
        + '<option value="all">全部时间</option>'
        + '<option value="today">今天</option>'
        + '<option value="3d">最近 3 天</option>'
        + '<option value="7d">最近 7 天</option>'
        + '<option value="30d">最近 30 天</option>'
        + '</select>'
        + '<button type="button" data-hist-clear>清空历史</button>'
        + '</div>'
        + '<p class="lib-panel-hint">默认仅保留最近一周的阅读记录，超过 7 天会自动删除。</p>';
    }

    els.modal.hidden = false;
    els.modal.innerHTML = '<div class="lib-modal-mask" data-mask></div>'
      + '<div class="lib-modal-card lib-panel">'
      + '<div class="lib-modal-head"><h3>' + title + '</h3>'
      + '<button type="button" class="lib-modal-close" data-close>×</button></div>'
      + tools
      + (list.length ? '<div class="lib-panel-list">' + list.map(function (it) {
        var b = it.book;
        var p = progressOf(b.id);
        var sub = kind === 'fav'
          ? esc(b.author) + ' · ' + esc(b.category)
          : (p ? '上次读到第 ' + p + ' 页' : '未开始阅读') + ' · ' + esc(b.author);
        if (kind === 'hist') {
          /* 小字：进度 · 作者 · 关闭时间；老记录没有 closedAt 时显示「未记录」 */
          sub += ' · 关闭 ' + (fmtHistTime(it.h && it.h.closedAt) || '未记录');
        }
        var cover = kind === 'hist' && coverUrlUsable(b.coverUrl) ? mediaFile(b.coverUrl) : '';
        var coverHtml = cover
          ? '<span class="lib-panel-cover has-img"><img src="' + esc(coverThumb(cover, 160)) + '" alt="" loading="lazy"'
            + ' data-cover-id="' + esc(b.id) + '" onerror="window.HM.panelCoverFallback(this)"></span>'
          : '<span class="lib-panel-cover' + (kind === 'hist' ? ' is-placeholder' : '') + '" style="--accent:' + esc(b.accent) + '">'
            + '<span>' + esc(kind === 'hist' ? '无封面' : b.title.slice(0, 4)) + '</span></span>';
        return '<button type="button" class="lib-panel-item" data-open="' + esc(b.id) + '">'
          + coverHtml
          + '<span class="lib-panel-text"><b>' + esc(b.title) + '</b><small>' + sub + '</small></span>'
          + '<span class="lib-panel-go">打开 →</span></button>';
      }).join('') + '</div>'
        : '<div class="lib-panel-empty">' + emptyText + '</div>')
      + '</div>';

    els.modal.querySelectorAll('[data-close], [data-mask]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    var rangeSel = els.modal.querySelector('[data-hist-range]');
    if (rangeSel) {
      rangeSel.value = histFilter;
      rangeSel.addEventListener('change', function () {
        histFilter = rangeSel.value || 'all';
        showPanel('hist');
      });
    }
    var clearBtn = els.modal.querySelector('[data-hist-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!state.hist.length) { toast('还没有阅读记录可清空', 'info'); return; }
        if (window.confirm && !window.confirm('确定清空全部阅读历史？清空后不可恢复。')) return;
        clearHistory();
      });
    }
    els.modal.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-open');
        closeModal();
        if (kind === 'hist') {
          var p = progressOf(id);
          var lite = byId(id);
          fetchBook(id).then(function (full) {
            if (!full) return;
            if (p > 0) enterReader(full, p);
            else openBook(id);
          });
        } else {
          openBook(id);
        }
      });
    });
  }

  /* ---------------- 新增 / 编辑 ---------------- */
  function openBookForm(book) {
    state.editing = book || null;
    if (!els.modal) return;
    var b = book || { title: '', author: '', category: '', tags: [], intro: '', accent: '#8a6a4f', pages: [] };
    var pagesText = (b.pages || []).map(function (p) { return p.title + '\n' + p.content; }).join('\n---\n');
    els.modal.hidden = false;
    els.modal.innerHTML = '<div class="lib-modal-mask" data-mask></div>'
      + '<div class="lib-modal-card lib-form-card">'
      + '<div class="lib-modal-head"><h3>' + (book ? '编辑书籍' : '新增书籍') + '</h3>'
      + '<button type="button" class="lib-modal-close" data-close>×</button></div>'
      + '<form class="lib-form" data-form>'
      + '<div class="lib-form-row"><label>书名</label><input name="title" required maxlength="120" value="' + esc(b.title) + '" placeholder="例如：夜航船"></div>'
      + '<div class="lib-form-row lib-form-2"><div><label>作者</label><input name="author" maxlength="120" value="' + esc(b.author) + '" placeholder="作者"></div>'
      + '<div><label>分类</label><input name="category" maxlength="60" value="' + esc(b.category) + '" placeholder="古典笔记 / 小说 / 画集"></div></div>'
      + '<div class="lib-form-row"><label>标签</label><input name="tags" maxlength="200" value="' + esc((b.tags || []).join('，')) + '" placeholder="用逗号分隔，例如：古典，笔记，博物"></div>'
      + '<div class="lib-form-row"><label>简介</label><textarea name="intro" rows="3" maxlength="2000" placeholder="一段话介绍这本书">' + esc(b.intro) + '</textarea></div>'
      + '<div class="lib-form-row lib-form-2"><div><label>封面色调</label><input name="accent" type="color" value="' + esc(b.accent) + '"></div>'
      + '<div><label>正文分页</label><div class="lib-form-hint-inline">用单独一行的 --- 分页</div></div></div>'
      + '<div class="lib-form-row"><label>正文</label><textarea name="pages" rows="10" placeholder="第一行是章节标题，正文另起一行。&lt;br&gt;多个章节之间用单独一行 --- 分隔">' + esc(pagesText) + '</textarea></div>'
      + '<div class="lib-form-actions"><button type="button" class="lib-btn" data-close>取消</button>'
      + '<button type="submit" class="lib-btn-primary">' + (book ? '保存修改' : '放上书架') + '</button></div>'
      + '</form></div>';

    els.modal.querySelectorAll('[data-close], [data-mask]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    els.modal.querySelector('[data-form]').addEventListener('submit', function (event) {
      event.preventDefault();
      submitBookForm(this);
    });
  }

  function formPages(text) {
    return String(text || '')
      .split(/\n\s*---\s*\n/)
      .map(function (chunk, idx) {
        var lines = chunk.replace(/\r/g, '').split('\n');
        var title = (lines.shift() || '').trim();
        var content = lines.join('\n').trim();
        if (!title && !content) return null;
        return { title: title || ('第 ' + (idx + 1) + ' 页'), content: content };
      })
      .filter(Boolean);
  }

  function submitBookForm(form) {
    var fd = new FormData(form);
    var data = {
      title: String(fd.get('title') || '').trim(),
      author: String(fd.get('author') || '').trim(),
      category: String(fd.get('category') || '未分类').trim() || '未分类',
      tags: String(fd.get('tags') || '').split(/[,，、|]/).map(function (t) { return t.trim(); }).filter(Boolean),
      intro: String(fd.get('intro') || '').trim(),
      accent: String(fd.get('accent') || '#8a6a4f'),
      pages: formPages(fd.get('pages'))
    };
    if (!data.title) { toast('书名不能为空', 'error'); return; }

    var editing = state.editing;
    var btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

    var action;
    if (editing) {
      action = state.mode === 'remote'
        ? request('/library/books/' + encodeURIComponent(editing.id), { method: 'PUT', body: data }, 15000)
        : Promise.resolve();
    } else {
      action = state.mode === 'remote'
        ? request('/library/books', { method: 'POST', body: data }, 15000)
        : Promise.resolve();
    }

    action.then(function (res) {
      if (state.mode === 'local') {
        var list = localBooks();
        var t = nowMs();
        if (editing) {
          for (var i = 0; i < list.length; i++) {
            if (list[i].id === editing.id) {
              list[i] = Object.assign({}, list[i], data, { pages: data.pages, updatedAt: t });
            }
          }
        } else {
          list.push(normalize(Object.assign({}, data, { id: uid(), createdAt: t, updatedAt: t }), list.length));
        }
        saveLocalBooks(list);
        state.books = list;
      } else {
        var saved = res && res.book ? res.book : null;
        if (saved) {
          var norm = normalize(saved, state.books.length);
          var found = false;
          state.books = state.books.map(function (b) { if (b.id === norm.id) { found = true; return norm; } return b; });
          if (!found) state.books.push(norm);
        } else {
          return refreshRemote().then(function () {
            if (!editing) jumpToLastShelfPage();
            renderShelf();
          });
        }
      }
      markShelf();
      if (!editing) jumpToLastShelfPage();
      renderShelf(); renderStatus();
      closeModal();
      toast(editing ? '书籍已更新' : '已放上书架', 'success');
    }).catch(function (err) {
      toast('保存失败：' + (err && err.message ? err.message : err), 'error');
      if (btn) { btn.disabled = false; btn.textContent = editing ? '保存修改' : '放上书架'; }
    });
  }

  function confirmDelete(book) {
    if (!window.confirm('确定要删除《' + book.title + '》吗？删除后无法恢复。')) return;
    var action = state.mode === 'remote'
      ? request('/library/books/' + encodeURIComponent(book.id), { method: 'DELETE' }, 12000)
      : Promise.resolve();
    action.then(function () {
      if (state.mode === 'local') {
        var list = localBooks().filter(function (b) { return b.id !== book.id; });
        saveLocalBooks(list);
        state.books = list;
      } else {
        state.books = state.books.filter(function (b) { return b.id !== book.id; });
        delete state.fav[book.id];
        writeJSON(LS.fav, state.fav);
      }
      closeDetail();
      markShelf(); renderShelf();
      toast('已删除《' + book.title + '》', 'success');
    }).catch(function (err) {
      toast('删除失败：' + (err && err.message ? err.message : err), 'error');
    });
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    els.modal.innerHTML = '';
    state.editing = null;
  }

  /* ---------------- 键盘 ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', function (event) {
      if (document.body.dataset.view !== 'library') return;
      if (els.modal && !els.modal.hidden) {
        if (event.key === 'Escape') closeModal();
        return;
      }
      if (els.reader && !els.reader.hidden) {
        if (event.key === 'ArrowLeft') flipTo(state.page - 1);
        else if (event.key === 'ArrowRight') flipTo(state.page + 1);
        else if (event.key === 'Escape') {
          if (document.fullscreenElement) return; /* 交给浏览器退全屏，按钮由 fullscreenchange 复位 */
          exitReader();
        }
        return;
      }
      if (els.detail && !els.detail.hidden) {
        if (event.key === 'Escape') closeDetail();
      }
    });
  }

  /* ---------------- 区域切换（单按钮 + 弹窗） ---------------- */
  function areaById(id) {
    for (var i = 0; i < LIB_AREAS.length; i++) {
      if (LIB_AREAS[i].id === id) return LIB_AREAS[i];
    }
    /* 旧 localStorage 值或非法值：回落到默认区域（不落到汇总区） */
    for (var j = 0; j < LIB_AREAS.length; j++) {
      if (LIB_AREAS[j].id === DEFAULT_AREA) return LIB_AREAS[j];
    }
    return LIB_AREAS[0];
  }

  function currentArea() { return areaById(state.area); }

  /* 各区域书籍数量：all = 全库总数，其余按 area 字段前端统计；
     psd 是「按分类」的视图（书的 area 仍是 paint），额外按 category 统计一份，
     保证每个区域按钮上的数字与该区域书架实际册数一致。 */
  function areaCounts() {
    var counts = { all: state.books.length };
    for (var i = 0; i < state.books.length; i++) {
      var b = state.books[i];
      if (!b) continue;
      var a = b.area;
      if (a) counts[a] = (counts[a] || 0) + 1;
      if (b.area !== 'psd' && bookInArea(b, 'psd')) counts.psd = (counts.psd || 0) + 1;
    }
    return counts;
  }

  function areaLabel(area, counts) {
    var n = (counts && counts[area.id] != null) ? counts[area.id] : 0;
    return area.name + '（' + n + '本）';
  }

  function syncAreaBtn() {
    var counts = areaCounts();
    var label = areaLabel(currentArea(), counts);
    var nameEl = $('libAreaName');
    if (nameEl) nameEl.textContent = label;
    var btn = $('libAreaBtn');
    if (btn) btn.title = '切换图书馆区域 · 当前：' + label;
  }

  function setArea(id) {
    state.area = areaById(id).id;
    state.shelfPage = 1;
    state.libDirPage = '';   /* 换区域时退出母文件夹，回到该区域第一层 */
    writeJSON(LS.area, state.area);
    if (window.HMSync && window.HMSync.pushLibraryPrefs) {
      clearTimeout(libPrefsPushTimer);
      libPrefsPushTimer = setTimeout(function () { window.HMSync.pushLibraryPrefs(); }, 600);
    }
    syncAreaBtn();
    markShelf();
    renderShelf();
  }

  /* 登录后账号数据先落到 localStorage，再回灌当前 UI（避免本地默认值盖掉线上值） */
  window.HMLibrary = {
    applyRemotePrefs: function () {
      state.area = areaById(readJSON(LS.area, DEFAULT_AREA)).id;
      state.libDirPage = '';
      state.pdfZoom = readPdfMode();
      syncAreaBtn();
      updatePdfZoomLabel();
      if (bound) { markShelf(); renderShelf(); }
    }
  };

  function openAreaPicker() {
    if (!els.modal) return;
    var counts = areaCounts();
    els.modal.hidden = false;
    els.modal.innerHTML = '<div class="lib-modal-mask" data-mask></div>'
      + '<div class="lib-modal-card lib-panel" role="dialog" aria-label="选择图书馆区域">'
      + '<div class="lib-modal-head"><h3>选择区域</h3>'
      + '<button type="button" class="lib-modal-close" data-close>×</button></div>'
      + '<div class="lib-panel-list">' + LIB_AREAS.map(function (a) {
        var on = a.id === state.area;
        return '<button type="button" class="lib-panel-item lib-area-item' + (on ? ' is-current' : '') + '" data-area="' + a.id + '">'
          + '<span class="lib-panel-cover" style="--accent:#c9a227"><span>' + esc(a.name.slice(0, 2)) + '</span></span>'
          + '<span class="lib-panel-text"><b>' + esc(areaLabel(a, counts)) + '</b><small>' + esc(a.desc || '该区域内容') + '</small></span>'
          + '<span class="lib-panel-go">' + (on ? '✓ 当前' : '选择 →') + '</span></button>';
      }).join('') + '</div></div>';
    els.modal.querySelectorAll('[data-close], [data-mask]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    els.modal.querySelectorAll('[data-area]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setArea(btn.getAttribute('data-area'));
        closeModal();
      });
    });
  }

  /* ---------------- 入口 ---------------- */
  function bindOnce() {
    if (bound) return;
    bound = true;

    els.body = $('libBody');
    els.search = $('libSearchInput');
    els.clearBtn = $('libSearchClear');
    els.suggest = $('libSuggest');
    els.status = $('libStatus');
    els.openLayer = $('libOpenLayer');
    els.detail = $('libDetail');
    els.reader = $('libReader');
    els.modal = $('libModal');
    els.view = $('view-library');

    /* 全屏状态变化（含 Esc 退出）时同步按钮 */
    document.addEventListener('fullscreenchange', syncFsButton);

    var savedArea = readJSON(LS.area, DEFAULT_AREA);
    state.area = areaById(savedArea).id;
    syncAreaBtn();
    var areaBtn = $('libAreaBtn');
    if (areaBtn) areaBtn.addEventListener('click', openAreaPicker);

    els.pager = $('libPager');
    els.pagerPrev = $('libPagerPrev');
    els.pagerNext = $('libPagerNext');
    els.pagerInput = $('libPagerInput');
    els.pagerInfo = $('libPagerInfo');

    function goPage(n) {
      var pages = Math.max(1, Math.ceil(state.shelfBooks.length / shelfPageSize()));
      state.shelfPage = Math.min(pages, Math.max(1, Number(n) || 1));
      renderShelf();
    }
    if (els.pagerPrev) els.pagerPrev.addEventListener('click', function () { goPage(state.shelfPage - 1); });
    if (els.pagerNext) els.pagerNext.addEventListener('click', function () { goPage(state.shelfPage + 1); });
    els.pagerUp = $('libPagerUp');
    els.pagerDown = $('libPagerDown');
    /* 上箭头 = 数值 +1，下箭头 = 数值 -1；goPage 自带边界钳制（1 ~ 总页数） */
    function bindPagerRepeat(btn, delta) {
      if (!btn || btn.dataset.hmPagerBound) return;
      btn.dataset.hmPagerBound = '1';
      var holdTimer = null;
      var repeatTimer = null;
      var delay = 140;
      function stopRepeat() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
        delay = 140;
      }
      function stepOnce() { goPage(state.shelfPage + delta); }
      /* 连发：起步 140ms 一档，每次减 8ms，最快 60ms 一档 */
      function tick() {
        stepOnce();
        delay = Math.max(60, delay - 8);
        repeatTimer = setTimeout(tick, delay);
      }
      function start(event) {
        if (event && event.button !== undefined && event.button !== 0) return;
        if (event) event.preventDefault();
        stopRepeat();
        stepOnce();
        holdTimer = setTimeout(function () {
          holdTimer = null;
          tick();
        }, 400);
      }
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stopRepeat);
      btn.addEventListener('pointercancel', stopRepeat);
      btn.addEventListener('pointerleave', stopRepeat);
      btn.addEventListener('blur', stopRepeat);
      /* 松手在按钮外也能立刻停 */
      window.addEventListener('pointerup', stopRepeat);
      /* 键盘触发（Enter/Space）没有 pointerdown，补一次单击 */
      btn.addEventListener('click', function (event) {
        if (event.detail === 0) stepOnce();
      });
    }
    bindPagerRepeat(els.pagerUp, 1);
    bindPagerRepeat(els.pagerDown, -1);
    if (els.pagerInput) {
      var applyJump = function () {
        var v = parseInt(els.pagerInput.value, 10);
        goPage(isNaN(v) ? state.shelfPage : v);
      };
      els.pagerInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); applyJump(); els.pagerInput.blur(); }
      });
      els.pagerInput.addEventListener('blur', applyJump);
    }

    bindSearch();
    bindKeys();

    var addBtn = $('libAddBtn');
    if (addBtn) addBtn.addEventListener('click', function () { openBookForm(null); });
    var favBtn = $('libFavBtn');
    if (favBtn) favBtn.addEventListener('click', function () { showPanel('fav'); });
    var histBtn = $('libHistoryBtn');
    if (histBtn) histBtn.addEventListener('click', function () { showPanel('hist'); });
    bindOcr();

    if (els.body) {
      /* 封面坏图/0 字节：退化成书名文字卡，不显示破图标 */
      function degradeBookCover(img) {
        var card = img && img.closest ? img.closest('.lib-book') : null;
        if (!card || !card.classList.contains('has-cover')) return;
        card.classList.remove('has-cover');
        card.style.width = '';
        card.style.height = '';
        if (img.parentNode) img.parentNode.removeChild(img);
      }
      /* 真实封面：书卡按图片比例定宽高，图片正好铺满（无黑边、无裁切） */
      function fitBookCover(img) {
        var card = img.closest('.lib-book');
        if (!card) return;
        if (!img.naturalWidth || !img.naturalHeight) { degradeBookCover(img); return; }
        var books = card.parentElement;
        if (!books) return;
        var count = books.querySelectorAll('.lib-book').length || 1;
        var gap = 18;
        var availH = (books.clientHeight || 184) - 24;
        var slotW = ((books.clientWidth || 960) - 40 - gap * Math.max(0, count - 1)) / count;
        var ratio = img.naturalWidth / img.naturalHeight;
        var baseW = Math.min(120, slotW);
        var w = baseW;
        /* 宽幅封面（横图）：在整层放得下的前提下放大到接近竖版书的高度，
           避免被 120px 的竖版书宽“压”成一条小横条；仍然按真实比例、不裁切不拉伸 */
        if (ratio > 1.12 && count > 0) {
          var freeW = (books.clientWidth || 960) - 40 - gap * Math.max(0, count - 1);
          var maxW = freeW - 120 * Math.max(0, count - 1);
          var tallW = availH * ratio;
          w = Math.min(tallW, Math.max(baseW, maxW));
        }
        if (w / ratio > availH) w = availH * ratio;
        w = Math.max(56, Math.round(w));
        card.style.width = w + 'px';
        card.style.height = Math.round(w / ratio) + 'px';
      }
      els.body.addEventListener('load', function (event) {
        var img = event.target;
        if (!img || !img.classList || !img.classList.contains('lib-book-cover-img')) return;
        fitBookCover(img);
      }, true);
      els.body.addEventListener('error', function (event) {
        var img = event.target;
        if (!img || !img.classList || !img.classList.contains('lib-book-cover-img')) return;
        degradeBookCover(img);
      }, true);
      window.addEventListener('resize', function () {
        if (!els.body) return;
        els.body.querySelectorAll('.lib-book-cover-img').forEach(fitBookCover);
      });
      /* 窗口尺寸变化：重算每层容量并重排，页码自动夹紧（防抖 150ms） */
      var relayoutTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(relayoutTimer);
        relayoutTimer = setTimeout(function () {
          if (!els.body) return;
          renderShelf();
          /* 阅读器尺寸变化时，适应类缩放需要重新计算 */
          if (state.pdfDoc && els.reader && !els.reader.hidden && typeof state.pdfZoom === 'string') renderPdfCanvas();
        }, 150);
      });
      els.body.addEventListener('click', function (event) {
        /* 原画资料：母文件夹 → 子文件夹页面（整块替换），返回按钮回到母文件夹列表 */
        var dirCard = event.target.closest('[data-libdir]');
        if (dirCard) {
          state.libDirPage = dirCard.getAttribute('data-libdir') || '';
          state.shelfPage = 1;
          renderShelf();
          return;
        }
        var backBtn = event.target.closest('[data-libback]');
        if (backBtn) {
          state.libDirPage = '';
          state.shelfPage = 1;
          renderShelf();
          return;
        }
        var card = event.target.closest('.lib-book');
        if (!card) return;
        /* 统一走站内详情/阅读；PDF 入口在详情与阅读界面内 */
        openBook(card.getAttribute('data-id'));
      });

      /* 原画资料：拖动排序（母文件夹 / 组内子文件夹），松手立即生效并持久化 */
      var conceptDrag = null;
      function clearConceptDrop() {
        if (!els.body) return;
        els.body.querySelectorAll('.lib-drag-item').forEach(function (n) {
          n.classList.remove('is-drop-before', 'is-drop-after');
          delete n.dataset.dropAfter;
        });
      }
      function clearConceptDrag() {
        if (conceptDrag && conceptDrag.el) conceptDrag.el.classList.remove('is-dragging');
        conceptDrag = null;
        clearConceptDrop();
      }
      els.body.addEventListener('dragstart', function (event) {
        if (state.area !== 'concept') return;
        var item = event.target.closest && event.target.closest('.lib-drag-item');
        if (!item) return;
        conceptDrag = { el: item };
        item.classList.add('is-dragging');
        try {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', item.getAttribute('data-drag-id') || item.getAttribute('data-drag-key') || '');
        } catch (e) {}
      });
      els.body.addEventListener('dragover', function (event) {
        if (!conceptDrag) return;
        var item = event.target.closest && event.target.closest('.lib-drag-item');
        if (!item || item === conceptDrag.el) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = 'move'; } catch (e) {}
        var rect = item.getBoundingClientRect();
        var after = (event.clientX - rect.left) > rect.width / 2;
        clearConceptDrop();
        item.classList.add(after ? 'is-drop-after' : 'is-drop-before');
        item.dataset.dropAfter = after ? '1' : '0';
      });
      els.body.addEventListener('drop', function (event) {
        if (!conceptDrag) return;
        var item = event.target.closest && event.target.closest('.lib-drag-item');
        if (!item) return;
        event.preventDefault();
        var src = conceptDrag.el;
        var after = item.dataset.dropAfter === '1';
        var nodes = Array.prototype.slice.call(els.body.querySelectorAll('.lib-drag-item'));
        var from = nodes.indexOf(src);
        if (from < 0) { clearConceptDrag(); return; }
        nodes.splice(from, 1);
        var to = nodes.indexOf(item);
        if (to < 0) { clearConceptDrag(); return; }
        if (after) to += 1;
        nodes.splice(to, 0, src);
        var order = conceptOrderRead();
        var page = state.libDirPage || '';
        if (page) {
          order.items[page] = nodes.map(function (n) { return n.getAttribute('data-drag-id'); }).filter(Boolean);
        } else {
          order.dirs = nodes.map(function (n) { return n.getAttribute('data-drag-key'); }).filter(Boolean);
        }
        conceptOrderSave(order);
        clearConceptDrag();
        renderShelf();
      });
      els.body.addEventListener('dragend', clearConceptDrag);

      /* 悬停 / 键盘聚焦 / 按下即预取 pdf-url：点击时省掉一次后端握手 */
      function prefetchCard(el) {
        var card = el && el.closest && el.closest('.lib-book');
        if (!card) return;
        var id = card.getAttribute('data-id');
        for (var i = 0; i < state.shelfBooks.length; i++) {
          if (String(state.shelfBooks[i].id) === String(id)) {
            prefetchPdfSignedUrl(state.shelfBooks[i]);
            return;
          }
        }
      }
      els.body.addEventListener('mouseover', function (event) { prefetchCard(event.target); });
      els.body.addEventListener('focusin', function (event) { prefetchCard(event.target); });
      els.body.addEventListener('pointerdown', function (event) { prefetchCard(event.target); }, { passive: true });
    }
  }

  function enter() {
    bindOnce();
    boot().then(function () {
      if (!state.books.length && state.mode === 'local') {
        renderShelf();
      }
    }).catch(function (err) {
      console.error('[Library] enter failed', err);
    });
  }

  function leave() {
    hideSuggest();
    closeModal();
    closeOcrDock();
    pageOcrReset();
    if (els.reader) { els.reader.classList.remove('is-open'); els.reader.hidden = true; els.reader.innerHTML = ''; }
    if (els.detail) { els.detail.classList.remove('is-open'); els.detail.hidden = true; els.detail.innerHTML = ''; }
    if (els.openLayer) { els.openLayer.hidden = true; els.openLayer.innerHTML = ''; }
  }

  function refresh() {
    if (!bound) return enter();
    state.booted = false;
    return boot();
  }

  /* ---------------- OCR 识别 + 翻译（pot 风格停靠窗） ---------------- */
  var OCR_TESS_URLS = [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
  ];
  var OCR_LANGS = {
    auto: { tr: 'auto', label: '自动', size: '约 8MB' },
    jpn: { tr: 'ja', label: '日文', size: '2.0MB' },
    eng: { tr: 'en', label: '英文', size: '3.0MB' },
    chi_sim: { tr: 'zh-CN', label: '中文', size: '2.4MB' }
  };
  var OCR_AUTO_PACK = 'jpn+eng+chi_sim';
  var ocr = {
    open: false,
    tab: 'page',
    busy: false,
    worker: null,
    workerLang: '',
    file: null,
    imageCanvas: null,
    srcText: '',
    dstText: '',
    tessPromise: null,
    queue: Promise.resolve()
  };
  /* 整页译中文：与悬浮窗状态、缓存完全独立，仅共用识别 worker */
  var PAGE_OCR_MAX_PARAS = 18;
  var pageOcr = {
    mode: 'src',      // src = 原文；dst = 译文覆盖
    page: 0,
    bookId: '',
    busy: false,
    token: 0,
    entry: null,
    cache: {},
    tipTimer: 0
  };

  function ocrEl(id) { return document.getElementById(id); }

  function ocrStatus(msg, type) {
    var el = ocrEl('libOcrStatus');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; el.className = 'lib-ocr-status'; return; }
    el.hidden = false;
    el.className = 'lib-ocr-status' + (type ? ' is-' + type : '');
    el.textContent = msg;
  }

  function ocrSetBusy(busy) {
    ocr.busy = busy;
    var run = ocrEl('libOcrRun');
    if (run) {
      run.disabled = busy;
      run.textContent = busy ? '处理中…' : (ocr.tab === 'image' ? '识别这张图' : '识别当前页');
    }
    var pick = ocrEl('libOcrPick');
    if (pick) pick.disabled = busy;
  }

  function ocrSyncEntry(open) {
    document.querySelectorAll('[data-ocr-open]').forEach(function (b) {
      b.classList.toggle('is-on', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function ocrOpen() {
    var dock = ocrEl('libOcrDock');
    var btn = ocrEl('libOcrBtn');
    if (!dock) return;
    dock.hidden = false;
    ocr.open = true;
    if (els.view) els.view.classList.add('is-ocr-open');
    if (btn) { btn.classList.add('is-on'); btn.setAttribute('aria-expanded', 'true'); }
    ocrSyncEntry(true);
    var run = ocrEl('libOcrRun');
    if (run) run.focus();
    if (state.pdfDoc && els.reader && !els.reader.hidden) renderPdfCanvas();
  }

  function closeOcrDock() {
    var dock = ocrEl('libOcrDock');
    var btn = ocrEl('libOcrBtn');
    if (!dock) return;
    dock.hidden = true;
    ocr.open = false;
    if (els.view) els.view.classList.remove('is-ocr-open');
    if (btn) { btn.classList.remove('is-on'); btn.setAttribute('aria-expanded', 'false'); }
    ocrSyncEntry(false);
    if (state.pdfDoc && els.reader && !els.reader.hidden) renderPdfCanvas();
  }

  function ocrSetTab(tab) {
    ocr.tab = tab === 'image' ? 'image' : 'page';
    var pageBtn = ocrEl('libOcrTabPage');
    var imgBtn = ocrEl('libOcrTabImage');
    var drop = ocrEl('libOcrDrop');
    if (pageBtn) { pageBtn.classList.toggle('is-on', ocr.tab === 'page'); pageBtn.setAttribute('aria-selected', ocr.tab === 'page' ? 'true' : 'false'); }
    if (imgBtn) { imgBtn.classList.toggle('is-on', ocr.tab === 'image'); imgBtn.setAttribute('aria-selected', ocr.tab === 'image' ? 'true' : 'false'); }
    if (drop) drop.hidden = ocr.tab !== 'image';
    var run = ocrEl('libOcrRun');
    if (run && !ocr.busy) run.textContent = ocr.tab === 'image' ? '识别这张图' : '识别当前页';
  }

  function ocrCanvasFromImage(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(2, Math.max(1, 1800 / Math.max(w, h)));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function ocrGrabPage() {
    if (!(state.pdfDoc && state.page >= 1)) {
      var img = els.reader && els.reader.querySelector('.lib-reader-scroll img, [data-pdf-scroll] img, img');
      if (img && (img.naturalWidth || img.width) > 240) {
        return Promise.resolve(ocrCanvasFromImage(img));
      }
      return Promise.reject(new Error('当前页不是 PDF 或图片，请翻到正文页，或用「上传 / 粘贴图片」。'));
    }
    var pageNo = Math.max(1, Math.min(state.page, state.pdfDoc.numPages));
    return state.pdfDoc.getPage(pageNo).then(function (page) {
      var vp = page.getViewport({ scale: 2 });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
        return canvas;
      });
    });
  }

  function ocrLoadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('脚本加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function ocrEnsureTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocr.tessPromise) return ocr.tessPromise;
    ocr.tessPromise = OCR_TESS_URLS.reduce(function (p, url) {
      return p.catch(function () { return ocrLoadScript(url); });
    }, Promise.reject(new Error('init'))).then(function (url) {
      if (!window.Tesseract) throw new Error('识别引擎加载失败');
      ocr.tessBase = url.replace(/tesseract\.min\.js.*$/, '');
      return window.Tesseract;
    }).catch(function (err) {
      ocr.tessPromise = null;
      throw new Error('识别引擎加载失败（CDN 不可达），请检查网络后重试。');
    });
    return ocr.tessPromise;
  }

  function ocrWorker(langKey) {
    var pack = langKey === 'auto' ? OCR_AUTO_PACK : langKey;
    var key = pack;
    if (ocr.worker && ocr.workerLang === key) return Promise.resolve(ocr.worker);
    var chain = Promise.resolve();
    if (ocr.worker) {
      chain = ocr.worker.terminate().catch(function () {});
      ocr.worker = null;
      ocr.workerLang = '';
    }
    return chain.then(function () {
      return ocrEnsureTesseract();
    }).then(function (T) {
      var base = ocr.tessBase || 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/';
      var langPath = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/' + pack + '/4.0.0_best_int';
      return T.createWorker(pack, 1, {
        workerPath: base + 'worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
        langPath: langPath,
        logger: function (m) {
          if (!m) return;
          if (m.status === 'recognizing text') {
            ocrStatus('识别中 ' + Math.round((m.progress || 0) * 100) + '%', 'busy');
          } else if (m.status && m.status.indexOf('loading') === 0) {
            ocrStatus('正在准备语言包（' + OCR_LANGS[langKey].size + '，首次较慢）…', 'busy');
          }
        }
      }).then(function (worker) {
        ocr.worker = worker;
        ocr.workerLang = key;
        return worker;
      });
    });
  }

  /* 自动识别：按结果字符集判断语种（自动模式本身用组合语言包识别） */
  function ocrGuessLang(text) {
    var s = String(text || '');
    var kana = (s.match(/[\u3040-\u30ff]/g) || []).length;
    var han = (s.match(/[\u3400-\u9fff]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    if (kana >= 3) return 'jpn';
    if (latin >= 6 && latin >= han * 2) return 'eng';
    if (han >= 3) return kana > 0 ? 'jpn' : 'chi_sim';
    if (latin >= 3) return 'eng';
    return '';
  }

  /* OCR worker 串行队列：悬浮窗单图识别与整页识别共用 worker，排队避免互相打断 */
  function ocrEnqueue(fn) {
    var run = ocr.queue.then(function () { return fn(); });
    ocr.queue = run.then(function () {}, function () {});
    return run;
  }

  function ocrRunText(canvas, lang) {
    return ocrEnqueue(function () {
      return ocrWorker(lang).then(function (worker) {
        ocrStatus('正在识别' + OCR_LANGS[lang].label + '文字…', 'busy');
        return worker.recognize(canvas);
      });
    }).then(function (res) {
      var text = res && res.data && res.data.text ? String(res.data.text) : '';
      ocr.detectedLang = lang === 'auto' ? ocrGuessLang(text) : lang;
      /* 日文识别常在汉字/假名之间插空格，先去掉再保留正常西文空格 */
      text = text.replace(/([\u3040-\u30ff\u3400-\u9fff])[ \t\u3000]+(?=[\u3040-\u30ff\u3400-\u9fff])/g, '$1');
      return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    });
  }

  function ocrChunks(text, size) {
    var out = [];
    var rest = text;
    while (rest.length > size) {
      var cut = rest.lastIndexOf('\n', size);
      if (cut < size * 0.5) cut = size;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) out.push(rest);
    return out;
  }

  function ocrGoogle(text, from, to) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
      + '&sl=' + encodeURIComponent(from) + '&tl=' + encodeURIComponent(to)
      + '&q=' + encodeURIComponent(text);
    return fetch(url, { signal: controller.signal }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      var segs = data && data[0];
      if (!segs || !segs.length) throw new Error('空译文');
      return segs.map(function (s) { return s && s[0] ? s[0] : ''; }).join('');
    }).finally(function () { clearTimeout(timer); });
  }

  function ocrTranslate(text) {
    var sel = ocrEl('libOcrFrom') ? ocrEl('libOcrFrom').value : 'auto';
    var fromKey = sel === 'auto' ? (ocr.detectedLang || '') : sel;
    if (!OCR_LANGS[fromKey]) fromKey = 'jpn';
    var from = OCR_LANGS[fromKey].tr;
    var to = ocrEl('libOcrTo') ? ocrEl('libOcrTo').value : 'zh-CN';
    if (from === to) return Promise.resolve(text);
    var parts = ocrChunks(text, 1600);
    var done = [];
    function step(i) {
      if (i >= parts.length) return Promise.resolve(done.join('\n'));
      var chunk = parts[i];
      return request('/ocr/translate', { method: 'POST', body: { q: chunk, from: from, to: to } }, 8000)
        .then(function (data) {
          var t = data && (data.text || data.translation || data.result);
          if (!t) throw new Error('翻译接口未返回文本');
          return String(t);
        })
        .catch(function () { return ocrGoogle(chunk, from, to); })
        .then(function (t) {
          done.push(t);
          return step(i + 1);
        });
    }
    return step(0).catch(function () {
      throw new Error('翻译服务不可用（后端接口未上线，直连翻译也失败），已保留原文。');
    });
  }

  function ocrRender(text, dst) {
    var srcEl = ocrEl('libOcrSrc');
    var dstEl = ocrEl('libOcrDst');
    if (srcEl) srcEl.textContent = text || '未识别到文字。';
    if (dstEl) dstEl.textContent = dst || (text ? '等待翻译…' : '译文会显示在这里。');
    document.querySelectorAll('[data-ocr-copy="src"]').forEach(function (b) { b.disabled = !text; });
    document.querySelectorAll('[data-ocr-copy="dst"]').forEach(function (b) { b.disabled = !dst; });
    ocr.srcText = text || '';
    ocr.dstText = dst || '';
  }

  function ocrCopy(text, btn) {
    if (!text) return;
    function ok() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) {}
        document.body.removeChild(ta);
      });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function ocrStart() {
    if (ocr.busy) return;
    var from = ocrEl('libOcrFrom') ? ocrEl('libOcrFrom').value : 'jpn';
    if (!OCR_LANGS[from]) from = 'jpn';
    var grab;
    if (ocr.tab === 'image') {
      if (!ocr.imageCanvas) {
        ocrStatus('请先选择或粘贴一张图片。', 'err');
        return;
      }
      grab = Promise.resolve(ocr.imageCanvas);
    } else {
      grab = ocrGrabPage();
    }
    ocrRender('', '');
    ocrSetBusy(true);
    ocrStatus('准备识别…', 'busy');
    grab.then(function (canvas) {
      return ocrRunText(canvas, from);
    }).then(function (text) {
      if (!text) {
        ocrStatus('没有识别到文字，可换一张更清晰的图，或切换识别语言。', 'err');
        ocrRender('', '');
        return null;
      }
      ocrRender(text, '');
      ocrStatus('识别完成，共 ' + text.length + ' 字，正在翻译…', 'busy');
      return ocrTranslate(text).then(function (dst) {
        ocrRender(text, dst);
        ocrStatus('完成 · 原文 ' + text.length + ' 字', 'ok');
      }).catch(function (err) {
        ocrRender(text, '');
        ocrStatus(err.message || '翻译服务不可用，已保留原文。', 'err');
      });
    }).catch(function (err) {
      ocrStatus(err && err.message ? err.message : String(err), 'err');
    }).finally(function () {
      ocrSetBusy(false);
    });
  }

  function ocrLoadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      ocrStatus('请选择图片文件（PNG / JPG / WebP）。', 'err');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        ocr.imageCanvas = ocrCanvasFromImage(img);
        ocr.file = file;
        var nameEl = ocrEl('libOcrFilename');
        if (nameEl) nameEl.textContent = file.name || '已粘贴的截图';
        ocrSetTab('image');
        ocrStatus('已载入图片，点击「识别这张图」开始。', 'ok');
      };
      img.onerror = function () { ocrStatus('图片解码失败，请换一张。', 'err'); };
      img.src = String(reader.result || '');
    };
    reader.onerror = function () { ocrStatus('图片读取失败，请重试。', 'err'); };
    reader.readAsDataURL(file);
  }

  /* ---------------- 整页译中文（PDF 原位覆盖层） ---------------- */
  function pageOcrReadLang() {
    try {
      var v = localStorage.getItem(LS.pageOcrLang);
      if (OCR_LANGS[v]) return v;
    } catch (e) {}
    return 'auto';
  }

  function pageOcrSaveLang(v) {
    try { localStorage.setItem(LS.pageOcrLang, v); } catch (e) {}
  }

  function pageOcrParts() {
    var r = els.reader;
    return {
      layer: r && r.querySelector('[data-page-ocr-layer]'),
      tip: r && r.querySelector('[data-page-ocr-tip]'),
      msg: r && r.querySelector('[data-page-ocr-msg]'),
      copy: r && r.querySelector('[data-page-ocr-copy]'),
      btn: r && r.querySelector('[data-page-ocr]')
    };
  }

  function pageOcrSync() {
    var p = pageOcrParts();
    if (!p.btn) return;
    var on = pageOcr.mode === 'dst';
    p.btn.classList.toggle('is-on', on);
    p.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    p.btn.textContent = pageOcr.busy ? '翻译中…' : (on ? '恢复原文' : '全文翻译');
    p.btn.disabled = pageOcr.busy;
  }

  function pageOcrTip(text, type, autoHide) {
    var p = pageOcrParts();
    if (!p.tip || !p.msg) return;
    clearTimeout(pageOcr.tipTimer);
    if (!text) { p.tip.hidden = true; return; }
    p.tip.hidden = false;
    p.tip.className = 'lib-page-ocr-tip' + (type ? ' is-' + type : '');
    p.msg.textContent = text;
    if (autoHide) {
      pageOcr.tipTimer = setTimeout(function () {
        var q = pageOcrParts();
        if (q.tip && !q.tip.classList.contains('is-err')) q.tip.hidden = true;
      }, 2600);
    }
  }

  function pageOcrShowCopy(show, text) {
    var p = pageOcrParts();
    if (!p.copy) return;
    p.copy.hidden = !show;
    p.copy.onclick = show ? function () { ocrCopy(text, p.copy); } : null;
  }

  function pageOcrClearVisual() {
    var p = pageOcrParts();
    if (p.layer) { p.layer.innerHTML = ''; p.layer.hidden = true; }
    pageOcrTip('');
    pageOcrShowCopy(false);
    pageOcr.entry = null;
    clearTimeout(pageOcr.tipTimer);
  }

  function pageOcrReset() {
    pageOcr.token++;
    pageOcr.busy = false;
    pageOcr.mode = 'src';
    pageOcr.page = 0;
    pageOcr.bookId = '';
    pageOcrClearVisual();
    pageOcrSync();
  }

  function pageOcrToggle() {
    if (pageOcr.busy) return;
    if (pageOcr.mode === 'dst') {
      /* 恢复原文：只还原显示，缓存保留 */
      pageOcr.token++;
      pageOcr.busy = false;
      pageOcr.mode = 'src';
      pageOcr.page = state.page;
      pageOcr.bookId = state.current ? String(state.current.id) : '';
      pageOcrClearVisual();
      pageOcrSync();
      return;
    }
    pageOcrTranslate();
  }

  function pageOcrTranslate() {
    if (!state.current || !state.current.pdfUrl) {
      pageOcrTip('整页翻译仅支持 PDF 页面。', 'err');
      return;
    }
    if (!state.pdfDoc || state.page < 1) {
      pageOcrTip('请先翻到 PDF 正文页。', 'err');
      return;
    }
    pageOcr.mode = 'dst';
    pageOcr.page = state.page;
    pageOcr.bookId = String(state.current.id);
    pageOcrSync();
    pageOcrShow();
  }

  function pageOcrShow() {
    var pageNo = state.page;
    var langSel = els.reader && els.reader.querySelector('[data-page-ocr-lang]');
    var langKey = langSel ? langSel.value : 'auto';
    if (!OCR_LANGS[langKey]) langKey = 'auto';
    var key = pageOcr.bookId + '|' + pageNo + '|' + langKey;
    var cached = pageOcr.cache[key];
    pageOcr.token++;
    var token = pageOcr.token;
    if (cached) {
      pageOcr.busy = false;
      pageOcr.entry = cached;
      pageOcrPaint(cached);
      pageOcrSync();
      pageOcrTip('已复用本页译文缓存 · 点「恢复原文」还原', 'ok', true);
      return;
    }
    pageOcr.busy = true;
    pageOcrClearVisual();
    pageOcrSync();
    pageOcrTip(langKey === 'auto' ? '正在准备语言包并识别整页（首次约 8MB）…' : '正在识别整页文字…', 'busy');
    var picked = null;
    ocrGrabPage().then(function (canvas) {
      picked = canvas;
      if (token !== pageOcr.token) return null;
      return ocrEnqueue(function () {
        return ocrWorker(langKey).then(function (worker) {
          return worker.recognize(canvas, {}, { tsv: true, text: true });
        });
      });
    }).then(function (res) {
      if (token !== pageOcr.token || !res) return null;
      var parsed = pageOcrParse(res, picked);
      if (!parsed.lines.length) {
        pageOcr.busy = false;
        pageOcr.mode = 'src';
        pageOcrSync();
        pageOcrClearVisual();
        pageOcrTip('没有识别到文字，可切换识别语言后重试。', 'err');
        return null;
      }
      var paras = pageOcrCapParas(pageOcrMakeParas(parsed.lines));
      var fromKey = langKey === 'auto' ? (ocrGuessLang(parsed.text) || 'jpn') : langKey;
      var entry = {
        key: key, page: pageNo, lang: langKey, fromKey: fromKey,
        lines: parsed.lines, paras: paras, srcText: parsed.text
      };
      pageOcrTip('识别到 ' + parsed.lines.length + ' 行，正在翻译 ' + paras.length + ' 段…', 'busy');
      return pageOcrTranslateParas(entry, OCR_LANGS[fromKey].tr, 'zh-CN', token).then(function (failed) {
        if (token !== pageOcr.token) return null;
        pageOcr.busy = false;
        if (failed >= entry.paras.length) {
          pageOcr.mode = 'src';
          pageOcrSync();
          pageOcrClearVisual();
          pageOcrTip('已识别 ' + entry.lines.length + ' 行，翻译暂不可用（原文已保留）。', 'err');
          pageOcrShowCopy(true, entry.srcText);
          return null;
        }
        pageOcr.cache[key] = entry;
        pageOcr.entry = entry;
        pageOcrPaint(entry);
        pageOcrSync();
        if (failed > 0) {
          pageOcrTip('已译 ' + (paras.length - failed) + ' 段，' + failed + ' 段未译（显示原文）。', 'err');
        } else {
          pageOcrTip('整页已译成中文 · 点「恢复原文」还原', 'ok', true);
        }
        return null;
      });
    }).catch(function (err) {
      if (token !== pageOcr.token) return;
      pageOcr.busy = false;
      pageOcr.mode = 'src';
      pageOcrSync();
      pageOcrTip(err && err.message ? err.message : '整页识别失败，请重试。', 'err');
    });
  }

  function pageOcrTranslateParas(entry, from, to, token) {
    var paras = entry.paras;
    var total = paras.length;
    var idx = 0;
    var done = 0;
    var failed = 0;
    function lane() {
      if (idx >= total || token !== pageOcr.token) return Promise.resolve();
      var p = paras[idx++];
      return pageOcrTranslateText(p.text, from, to).then(function (t) {
        p.dst = t;
      }).catch(function () {
        p.dst = '';
        failed++;
      }).then(function () {
        done++;
        if (token === pageOcr.token && done < total) {
          pageOcrTip('翻译中 ' + done + ' / ' + total + ' 段…', 'busy');
        }
        return lane();
      });
    }
    var lanes = [];
    for (var i = 0; i < 3; i++) lanes.push(lane());
    return Promise.all(lanes).then(function () { return failed; });
  }

  function pageOcrTranslateText(text, from, to) {
    if (!text) return Promise.resolve('');
    if (from === to) return Promise.resolve(text);
    var parts = ocrChunks(text, 1200);
    var out = [];
    return parts.reduce(function (chain, chunk) {
      return chain.then(function () {
        return request('/ocr/translate', { method: 'POST', body: { q: chunk, from: from, to: to } }, 8000)
          .then(function (data) {
            var t = data && (data.text || data.translation || data.result);
            if (!t) throw new Error('翻译接口未返回文本');
            out.push(String(t));
          })
          .catch(function () {
            return ocrGoogle(chunk, from, to).then(function (t) { out.push(t); });
          });
      });
    }, Promise.resolve()).then(function () { return out.join('\n'); });
  }

  function pageOcrJoin(a, b) {
    if (!a) return b;
    if (!b) return a;
    var last = a.charAt(a.length - 1);
    var first = b.charAt(0);
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(last) && /[\u3040-\u30ff\u3400-\u9fff]/.test(first)) return a + b;
    return a + ' ' + b;
  }

  function pageOcrMakeParas(lines) {
    var sorted = lines.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var hs = sorted.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; });
    var med = hs[Math.floor(hs.length / 2)] || 0.02;
    var paras = [];
    sorted.forEach(function (l) {
      var cur = paras[paras.length - 1];
      var gap = cur ? l.y - (cur.y + cur.h) : 0;
      var nearX = cur ? Math.abs(l.x - cur.x) <= Math.max(0.05, cur.w * 0.4) : false;
      if (cur && gap <= Math.max(med * 0.9, 0.008) && gap >= -med * 0.5 && nearX) {
        var x0 = Math.min(cur.x, l.x);
        var y0 = Math.min(cur.y, l.y);
        var x1 = Math.max(cur.x + cur.w, l.x + l.w);
        var y1 = Math.max(cur.y + cur.h, l.y + l.h);
        cur.x = x0; cur.y = y0; cur.w = x1 - x0; cur.h = y1 - y0;
        cur.text = pageOcrJoin(cur.text, l.text);
        cur.lines += 1;
      } else {
        paras.push({ x: l.x, y: l.y, w: l.w, h: l.h, text: l.text, lines: 1, dst: '' });
      }
    });
    return paras;
  }

  /* 单页请求上限：段落过多时合并相邻段，避免把接口打爆 */
  function pageOcrCapParas(paras) {
    while (paras.length > PAGE_OCR_MAX_PARAS) {
      var best = 0;
      var bestGap = Infinity;
      for (var i = 0; i < paras.length - 1; i++) {
        var gap = paras[i + 1].y - (paras[i].y + paras[i].h);
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      var a = paras[best];
      var b = paras[best + 1];
      var x0 = Math.min(a.x, b.x);
      var y0 = Math.min(a.y, b.y);
      var x1 = Math.max(a.x + a.w, b.x + b.w);
      var y1 = Math.max(a.y + a.h, b.y + b.h);
      paras.splice(best, 2, {
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        text: pageOcrJoin(a.text, b.text),
        lines: (a.lines || 1) + (b.lines || 1),
        dst: ''
      });
    }
    return paras;
  }

  /* bbox 解析：优先 TSV（词级坐标），缺失时退回 blocks */
  function pageOcrParse(res, canvas) {
    var data = (res && res.data) || {};
    var W = canvas.width || 1;
    var H = canvas.height || 1;
    var raw = [];
    var tsv = data.tsv ? String(data.tsv) : '';
    if (tsv.indexOf('level') === 0) {
      var rows = tsv.split(/\r?\n/);
      var map = {};
      for (var i = 0; i < rows.length; i++) {
        var c = rows[i].split('\t');
        if (c.length < 12 || c[0] !== '5') continue;
        var conf = Number(c[10]);
        var word = c.slice(11).join('\t').trim();
        if (!word || !(conf >= 25)) continue;
        var k = c[1] + '/' + c[2] + '/' + c[3] + '/' + c[4];
        var g = map[k];
        if (!g) {
          g = map[k] = { x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9], words: [] };
        } else {
          g.x0 = Math.min(g.x0, +c[6]);
          g.y0 = Math.min(g.y0, +c[7]);
          g.x1 = Math.max(g.x1, +c[6] + +c[8]);
          g.y1 = Math.max(g.y1, +c[7] + +c[9]);
        }
        g.words.push(word);
      }
      Object.keys(map).forEach(function (k) {
        var g = map[k];
        raw.push({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, words: g.words });
      });
    } else if (data.blocks) {
      data.blocks.forEach(function (b) {
        (b.paragraphs || []).forEach(function (p) {
          (p.lines || []).forEach(function (l) {
            if (!l.bbox || !l.text || !l.text.trim()) return;
            raw.push({ x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, words: [l.text.trim()] });
          });
        });
      });
    }
    var lines = [];
    raw.forEach(function (r) {
      var text = r.words ? r.words.join(' ') : '';
      text = text.replace(/([\u3040-\u30ff\u3400-\u9fff])[ \t]+(?=[\u3040-\u30ff\u3400-\u9fff])/g, '$1')
        .replace(/[ \t]+([、。，．・：；！？）」』】])/g, '$1')
        .trim();
      if (!text) return;
      var x = r.x0 / W;
      var y = r.y0 / H;
      var w = (r.x1 - r.x0) / W;
      var h = (r.y1 - r.y0) / H;
      if (w < 0.004 || h < 0.004) return;
      lines.push({ x: x, y: y, w: w, h: h, text: text });
    });
    lines.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    return { lines: lines, text: lines.map(function (l) { return l.text; }).join('\n') };
  }

  function pageOcrPaint(entry) {
    var p = pageOcrParts();
    if (!p.layer) return;
    p.layer.innerHTML = '';
    entry.paras.forEach(function (para) {
      var d = document.createElement('div');
      d.className = 'lib-page-ocr-block' + (para.dst ? '' : ' is-raw');
      d.style.left = (para.x * 100).toFixed(3) + '%';
      d.style.top = (para.y * 100).toFixed(3) + '%';
      d.style.width = (para.w * 100).toFixed(3) + '%';
      d.style.height = (para.h * 100).toFixed(3) + '%';
      d.textContent = para.dst || para.text;
      p.layer.appendChild(d);
      para.el = d;
    });
    p.layer.hidden = false;
    pageOcrFit();
    requestAnimationFrame(pageOcrFit);
  }

  /* 字号按框高与文字长度自适应；放不下时按行截断省略 */
  function pageOcrFit() {
    var p = pageOcrParts();
    var entry = pageOcr.entry;
    if (!p.layer || p.layer.hidden || !entry) return;
    var W = p.layer.clientWidth;
    var H = p.layer.clientHeight;
    if (!W || !H) return;
    entry.paras.forEach(function (para) {
      var el = para.el;
      if (!el) return;
      var w = Math.max(8, para.w * W);
      var h = Math.max(8, para.h * H);
      var text = el.textContent || '';
      var fs = Math.min(20, Math.max(9, Math.floor(h * 0.66)));
      for (; fs >= 8; fs--) {
        var cpl = Math.max(1, Math.floor(w / (fs * 1.02)));
        var need = Math.ceil(text.length / cpl) * fs * 1.18;
        if (need <= h + 1) break;
      }
      fs = Math.max(8, fs);
      el.style.fontSize = fs + 'px';
      var cpl2 = Math.max(1, Math.floor(w / (fs * 1.02)));
      var maxLines = Math.max(1, Math.floor((h + 1) / (fs * 1.18)));
      el.style.webkitLineClamp = String(Math.min(maxLines, Math.max(1, Math.ceil(text.length / cpl2))));
    });
  }

  function pageOcrRelayout() {
    if (pageOcr.mode !== 'dst' || !pageOcr.entry) return;
    pageOcrFit();
  }

  function bindOcr() {
    var btn = ocrEl('libOcrBtn');
    if (btn) btn.addEventListener('click', function () { ocr.open ? closeOcrDock() : ocrOpen(); });
    var close = ocrEl('libOcrClose');
    if (close) close.addEventListener('click', closeOcrDock);
    var tabPage = ocrEl('libOcrTabPage');
    if (tabPage) tabPage.addEventListener('click', function () { ocrSetTab('page'); });
    var tabImage = ocrEl('libOcrTabImage');
    if (tabImage) tabImage.addEventListener('click', function () { ocrSetTab('image'); });
    var pick = ocrEl('libOcrPick');
    var file = ocrEl('libOcrFile');
    if (pick && file) {
      pick.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        if (file.files && file.files[0]) ocrLoadFile(file.files[0]);
        file.value = '';
      });
    }
    var run = ocrEl('libOcrRun');
    if (run) run.addEventListener('click', ocrStart);
    var swap = ocrEl('libOcrSwap');
    if (swap) {
      swap.addEventListener('click', function () {
        var fromEl = ocrEl('libOcrFrom');
        var toEl = ocrEl('libOcrTo');
        if (!fromEl || !toEl) return;
        var from = fromEl.value;
        var to = toEl.value;
        if (from === 'chi_sim' || to === 'zh-CN') {
          fromEl.value = to === 'zh-CN' ? 'chi_sim' : 'jpn';
          toEl.value = from === 'chi_sim' ? 'ja' : 'zh-CN';
          return;
        }
        fromEl.value = to === 'ja' ? 'jpn' : 'eng';
        toEl.value = 'zh-CN';
      });
    }
    document.querySelectorAll('[data-ocr-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        ocrCopy(b.getAttribute('data-ocr-copy') === 'dst' ? ocr.dstText : ocr.srcText, b);
      });
    });
    document.addEventListener('paste', function (event) {
      if (!ocr.open) return;
      var items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { ocrLoadFile(f); event.preventDefault(); }
          return;
        }
      }
    });
    var drop = ocrEl('libOcrDrop');
    if (drop) {
      drop.addEventListener('dragover', function (e) { e.preventDefault(); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) ocrLoadFile(f);
      });
    }
    /* 悬浮窗识别语言：默认自动，单独记住，不影响整页翻译的选择 */
    var fromSel = ocrEl('libOcrFrom');
    if (fromSel) {
      try {
        var saved = localStorage.getItem(LS.ocrLang);
        if (OCR_LANGS[saved]) fromSel.value = saved;
      } catch (e) {}
      fromSel.addEventListener('change', function () {
        try { localStorage.setItem(LS.ocrLang, fromSel.value); } catch (e) {}
      });
    }
    window.addEventListener('resize', function () { requestAnimationFrame(pageOcrRelayout); });
  }

  window.HMLibrary = { enter: enter, leave: leave, refresh: refresh };
})();

