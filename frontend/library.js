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
    area: 'anidream.library.area.v1'
  };

  var SEED = (window.HM_LIBRARY_SEED && window.HM_LIBRARY_SEED.books) || [];

  /* 图书馆区域：单按钮切换，五区目前均为空 */
  var LIB_AREAS = [
    { id: 'ref', name: '参考素材' },
    { id: 'psd', name: '插画作画过程PSD源文件' },
    { id: 'anim', name: '动画教程' },
    { id: 'paint', name: '绘画教程' },
    { id: 'concept', name: '原画资料' }
  ];

  var state = {
    mode: 'local',        /* local | remote */
    area: 'ref',          /* 当前图书馆区域 id */
    page: 1,              /* 当前书架页码（区域过滤后分页） */
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
    loading: false
  };

  var els = {};
  var bound = false;
  var searchTimer = null;
  var suggestItems = [];
  var suggestIndex = -1;

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

  function request(path, options, timeoutMs) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 12000);
    var headers = { Accept: 'application/json', 'x-library-user': libraryUser() };
    try {
      var token = localStorage.getItem('hm.token');
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (err) {}
    var method = opts.method || 'GET';
    /* GET/HEAD 不允许带 body，null 也视为无体 */
    var hasBody = opts.body !== undefined && opts.body !== null && method !== 'GET' && method !== 'HEAD';
    if (hasBody) headers['Content-Type'] = 'application/json';

    return fetch(apiUrl(path), {
      method: method,
      headers: headers,
      signal: controller.signal,
      body: hasBody ? JSON.stringify(opts.body) : undefined
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
    var areaBooks = state.books.filter(function (b) { return b.area === state.area; });
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
    /* 收藏/历史与书单并行发起：三者各自要 0.4~0.8s，串起来用户就得多等一倍以上 */
    var aux = fetchAux();
    return request('/library/books', {}, 7000).then(function (data) {
      state.mode = 'remote';
      state.books = (data.items || []).map(function (b, i) { return normalize(b, i); });
      state.booted = true;
      state.loading = false;
      markShelf();
      renderShelf();   /* 书单先到先渲染，不等收藏/历史 */
      renderStatus();
      return aux.then(function (res) {
        applyAux(res);
        if (state.mode !== 'remote') return;
        markShelf();
        renderShelf();
        renderStatus();
      });
    }, function () {
      /* 书单请求失败（离线 / 超时 / 后端未启动）才回落到本地存储 */
      state.mode = 'local';
      state.books = localBooks();
      state.fav = loadFavLocal();
      state.hist = loadHistLocal();
      state.booted = true;
      state.loading = false;
      markShelf();
      renderShelf();
      renderStatus();
    });
  }

  function fetchAux() {
    return Promise.all([
      request('/library/favorites', {}, 6000).catch(function () { return { items: [] }; }),
      request('/library/history', {}, 6000).catch(function () { return { items: [] }; })
    ]);
  }

  function applyAux(res) {
    var fav = {};
    (res[0].items || []).forEach(function (b) { fav[b.id] = true; });
    state.fav = fav;
    state.hist = res[1].items || [];
  }

  function loadRemoteAux() {
    return fetchAux().then(applyAux);
  }

  function refreshRemote() {
    if (state.mode !== 'remote') {
      state.books = localBooks();
      markShelf();
      renderShelf();
      renderStatus();
      return Promise.resolve();
    }
    return request('/library/books', {}, 10000).then(function (data) {
      state.books = (data.items || []).map(function (b, i) { return normalize(b, i); });
      return loadRemoteAux();
    }).catch(function () {
      state.mode = 'local';
      state.books = localBooks();
    }).then(function () {
      markShelf();
      renderShelf();
      renderStatus();
    });
  }

  function fetchBook(id) {
    var cached = byId(id);
    if (cached && cached.pages && cached.pages.length) return Promise.resolve(cached);
    if (state.mode === 'remote') {
      return request('/library/books/' + encodeURIComponent(id), {}, 10000)
        .then(function (data) { return data.book; })
        .catch(function () { return cached; });
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

  /* ---------------- 书架渲染 ---------------- */
  function renderSkeleton() {
    if (!els.body) return;
    els.body.innerHTML = '<div class="lib-loading">正在整理书架…</div>';
  }

  var SHELF_PER_ROW = 8;
  var SHELF_PAGE_SIZE = 24;   /* 每页 3 架 × 8 本 */

  function renderShelf() {
    if (!els.body) return;
    var total = state.shelfBooks.length;
    var pages = Math.max(1, Math.ceil(total / SHELF_PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    var start = (state.page - 1) * SHELF_PAGE_SIZE;
    var list = state.shelfBooks.slice(start, start + SHELF_PAGE_SIZE);
    if (!list.length) {
      /* 0 本书也渲染三层空柜子，空态提示叠在柜体内部 */
      var emptyRows = '';
      for (var r = 0; r < 3; r++) {
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
      renderPager(0);
      renderStatus();
      return;
    }

    /* 每页固定 3 层：不足的书位留空，不塌陷 */
    var html = '';
    for (var rowIndex = 0; rowIndex < 3; rowIndex++) {
      var group = list.slice(rowIndex * SHELF_PER_ROW, (rowIndex + 1) * SHELF_PER_ROW);
      var booksHtml = group.map(function (b, idx) {
        return bookCardHtml(b, start + rowIndex * SHELF_PER_ROW + idx);
      }).join('');
      html += '<section class="lib-shelf-row">'
        + '<div class="lib-shelf-books' + (group.length >= SHELF_PER_ROW ? ' is-full' : '') + '">' + booksHtml + '</div>'
        + '<div class="lib-shelf-plank">'
        + '<span class="lib-shelf-label">第 ' + (rowIndex + 1) + ' 架</span>'
        + '<span class="lib-shelf-count">' + group.length + ' 册</span>'
        + '</div></section>';
    }

    els.body.innerHTML = '<div class="lib-shelf-wrap">' + html + '</div>';
    renderPager(total);
    renderStatus();
  }

  /* 底部页码控件：总数不足一页时隐藏 */
  function renderPager(total) {
    if (!els.pager) return;
    var pages = Math.max(1, Math.ceil(total / SHELF_PAGE_SIZE));
    if (pages <= 1) {
      els.pager.hidden = true;
      return;
    }
    els.pager.hidden = false;
    if (els.pagerInfo) els.pagerInfo.textContent = '第 ' + state.page + ' / ' + pages + ' 页';
    if (els.pagerInput) {
      els.pagerInput.value = state.page;
      els.pagerInput.max = pages;
    }
    if (els.pagerPrev) els.pagerPrev.disabled = state.page <= 1;
    if (els.pagerNext) els.pagerNext.disabled = state.page >= pages;
  }

  function bookCardHtml(b, index) {
    var tilt = ((index % 5) - 2) * 1.1;
    var width = 120; /* 八本等宽，层内等距排开 */
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
        ? '<img class="lib-book-cover-img" src="' + esc(b.coverUrl) + '" alt="' + esc(b.title) + '" loading="lazy">'
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
    els.status.innerHTML = '<span class="lib-status-dot ' + (state.mode === 'remote' ? 'is-on' : '') + '"></span>'
      + '<span>' + modeLabel + '</span>'
      + '<span class="lib-status-sep">·</span>'
      + '<span>共 ' + total + ' 册，当前展示 ' + shown + ' 册</span>'
      + '<span class="lib-status-sep">·</span>'
      + '<span>存储空间上限 500G</span>';
  }

  /* ---------------- 搜索 ---------------- */
  function bindSearch() {
    var input = els.search;
    if (!input) return;

    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var value = input.value;
      state.query = value;
      state.page = 1;
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
  function openBook(id) {
    var book = byId(id);
    if (!book) return;
    var card = document.querySelector('.lib-book[data-id="' + id + '"]');
    closeDetail(true);
    toast('正在打开《' + book.title + '》', 'info');

    fetchBook(id).then(function (full) {
      if (!full) { toast('书籍加载失败', 'error'); return; }
      state.current = full;
      return animateOpen(card, full);
    }).then(function () {
      if (!state.current) return;
      renderDetail(state.current);
    }).catch(function (err) {
      toast('打开失败：' + (err && err.message ? err.message : err), 'error');
    });
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

    els.detail.innerHTML = '<div class="lib-detail-inner">'
      + '<button type="button" class="lib-back-btn" data-back>← 返回书架</button>'
      + '<div class="lib-detail-grid">'
      + '<div class="lib-detail-cover-col">'
      + '<div class="lib-detail-cover" style="--accent:' + esc(book.accent) + '" data-author="' + esc(book.author) + '">'
      + (book.coverUrl
        ? '<img class="lib-detail-cover-img" src="' + esc(book.coverUrl) + '" alt="' + esc(book.title) + '">'
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
      + '<button type="button" class="lib-btn lib-btn-danger" data-del>删除</button>'
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
    els.detail.querySelector('[data-del]').addEventListener('click', function () {
      confirmDelete(state.current);
    });
    els.detail.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        enterReader(state.current, Number(btn.getAttribute('data-page')));
      });
    });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function closeDetail(silent) {
    if (!els.detail) return;
    var wasOpen = !els.detail.hidden;
    els.detail.classList.remove('is-open');
    els.detail.hidden = true;
    els.detail.innerHTML = '';
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
    var overlay = pdfOverlay();
    if (overlay) overlay.classList.add('is-hidden');
  }

  function updatePdfZoomLabel() {
    var el = els.reader && els.reader.querySelector('[data-zoom-label]');
    if (!el) return;
    el.textContent = state.pdfZoom === 'fit' ? '适合宽度' : Math.round(Number(state.pdfZoom) * 100) + '%';
  }

  function setPdfZoom(next) {
    state.pdfZoom = next;
    updatePdfZoomLabel();
    renderPdfCanvas();
  }

  function renderPdfCanvas() {
    var doc = state.pdfDoc;
    var canvas = els.reader && els.reader.querySelector('[data-pdf-canvas]');
    var scroll = els.reader && els.reader.querySelector('[data-pdf-scroll]');
    if (!doc || !canvas || !scroll) return;
    var pageNo = Math.max(1, Math.min(state.page, doc.numPages));
    var token = ++state.pdfToken;
    if (state.pdfTask && state.pdfTask.cancel) {
      try { state.pdfTask.cancel(); } catch (e) {}
    }
    doc.getPage(pageNo).then(function (page) {
      if (token !== state.pdfToken) return null;
      var base = page.getViewport({ scale: 1 });
      var availW = Math.max(240, (scroll.clientWidth || 820) - 28);
      var scale = state.pdfZoom === 'fit' ? availW / base.width : Number(state.pdfZoom);
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
        hidePdfLoading();
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
    var scroll = els.reader && els.reader.querySelector('[data-pdf-scroll]');
    if (scroll) scroll.hidden = true;
    var bar = els.reader && els.reader.querySelector('.lib-pdf-toolbar');
    if (bar) bar.hidden = true;
    var overlay = pdfOverlay();
    if (overlay) overlay.classList.remove('is-hidden');
    var spinner = els.reader && els.reader.querySelector('[data-pdf-spinner]');
    if (spinner) spinner.hidden = true;
    var detail = '';
    if (err) {
      detail = (err.name || 'Error') + (err.message ? '：' + String(err.message).slice(0, 400) : '');
    }
    pdfLoadingText(detail ? 'PDF 加载失败（' + detail + '），请点击「重试」' : 'PDF 加载失败，请点击「重试」');
    var retry = els.reader && els.reader.querySelector('[data-pdf-retry]');
    if (retry) retry.hidden = false;
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
        function open(url) {
          /* 分段读取：只取当前页需要的字节 */
          return pdfjs.getDocument({
            url: url,
            disableRange: false,
            disableStream: false
          }).promise;
        }
        return open(book.pdfUrl).catch(function (err) {
          var directMsg = (err && err.name) + ' / ' + (err && err.message);
          console.warn('[library] 直链加载失败，切换流式接口：', directMsg);
          pdfLoadingText('直链加载失败，已切换流式加载 …');
          return open(streamUrl(book.pdfUrl)).catch(function (err2) {
            var e = new Error(
              '直链 ' + book.pdfUrl + '：' + directMsg +
              '；流式 ' + streamUrl(book.pdfUrl) + '：' + (err2 && err2.name) + ' / ' + (err2 && err2.message)
            );
            e.name = (err2 && err2.name) || (err && err.name) || 'Error';
            throw e;
          });
        });
      })
      .then(function (doc) { state.pdfDoc = doc; return doc; });
    return state.pdfDocPromise;
  }

  /* PDF 加载提示与重试；先渲染框架，再加载 PDF */
  function setupPdfReader(book) {
    state.pdfDoc = null;
    state.pdfDocPromise = null;
    state.pdfTotal = 0;
    state.pdfZoom = 'fit';
    state.pdfPrefetched = {};
    state.pdfToken = (state.pdfToken || 0) + 1;

    var overlay = pdfOverlay();
    var txt = overlay && overlay.querySelector('[data-loading-text]');
    var retry = overlay && overlay.querySelector('[data-pdf-retry]');
    var slow = null;

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
      if (slow) clearTimeout(slow);
      slow = setTimeout(function () {
        pdfLoadingText('仍在加载 PDF … 请稍候，或点击重试');
        if (retry) retry.hidden = false;
      }, 12000);
    }

    resetLoading();

    var scroll = els.reader.querySelector('[data-pdf-scroll]');
    if (scroll && !scroll.dataset.pdfWheel) {
      scroll.dataset.pdfWheel = '1';
      scroll.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        var steps = ['fit', 1, 1.5, 2, 3];
        var i = steps.indexOf(state.pdfZoom);
        if (i < 0) i = 0;
        setPdfZoom(steps[Math.max(0, Math.min(steps.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]);
      }, { passive: false });
    }
    var zoomOut = els.reader.querySelector('[data-zoom-out]');
    var zoomIn = els.reader.querySelector('[data-zoom-in]');
    var zoomSteps = ['fit', 1, 1.5, 2, 3];
    if (zoomOut && !zoomOut.dataset.pdfZoom) zoomOut.dataset.pdfZoom = '1';
    if (zoomIn && !zoomIn.dataset.pdfZoom) zoomIn.dataset.pdfZoom = '1';
    if (zoomOut && !zoomOut.dataset.pdfZoomBound) {
      zoomOut.dataset.pdfZoomBound = '1';
      zoomOut.addEventListener('click', function () {
        var i = zoomSteps.indexOf(state.pdfZoom);
        setPdfZoom(zoomSteps[Math.max(0, (i < 0 ? 0 : i) - 1)]);
      });
    }
    if (zoomIn && !zoomIn.dataset.pdfZoomBound) {
      zoomIn.dataset.pdfZoomBound = '1';
      zoomIn.addEventListener('click', function () {
        var i = zoomSteps.indexOf(state.pdfZoom);
        setPdfZoom(zoomSteps[Math.min(zoomSteps.length - 1, (i < 0 ? 0 : i) + 1)]);
      });
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
    state.current = book;
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
      ? '<aside class="lib-pdf-toc">'
        + '<div class="lib-pdf-toc-head">目录</div>'
        + '<div class="lib-pdf-toc-list" data-toc-list><div class="lib-toc-note">正在解析目录…</div></div>'
        + '<div class="lib-pdf-toc-jump"><input type="number" min="1" step="1" data-toc-jump placeholder="页码"><button type="button" class="lib-toc-go" data-toc-go>跳转</button></div>'
        + '</aside>'
        + '<div class="lib-pdf-view">'
        + '<div class="lib-pdf-toolbar">'
        + '<button type="button" class="lib-pdf-zoom" data-zoom-out aria-label="缩小">−</button>'
        + '<span class="lib-pdf-zoom-label" data-zoom-label>适合宽度</span>'
        + '<button type="button" class="lib-pdf-zoom" data-zoom-in aria-label="放大">+</button>'
        + '<button type="button" class="lib-pdf-open" data-pdf-full>⛶ 全屏阅读</button>'
        + '</div>'
        + '<div class="lib-pdf-scroll" data-pdf-scroll><canvas class="lib-pdf-canvas" data-pdf-canvas></canvas></div>'
        + '<div class="lib-pdf-loading" data-pdf-loading>'
        + '<span class="lib-pdf-spinner" data-pdf-spinner></span><span data-loading-text>正在加载 PDF …</span>'
        + '<button type="button" class="lib-pdf-retry" data-pdf-retry hidden>重试</button>'
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
    var fullBtn = els.reader.querySelector('[data-pdf-full]');
    if (fullBtn) fullBtn.addEventListener('click', toggleReaderFullscreen);
    syncFsButton();
    if (isPdf) setupPdfReader(book);
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
    els.reader.classList.remove('is-open', 'is-entering');
    els.reader.hidden = true;
    els.reader.innerHTML = '';
    if (state.current) {
      var book = state.current;
      renderDetail(book);
    }
  }

  /* ---------------- 收藏 / 历史 ---------------- */
  function showPanel(kind) {
    if (!els.modal) return;
    var title = kind === 'fav' ? '我的收藏' : '阅读历史';
    var list = kind === 'fav'
      ? state.books.filter(function (b) { return isFavorite(b.id); })
      : state.hist.map(function (h) { return h.book || byId(h.bookId); }).filter(Boolean);

    els.modal.hidden = false;
    els.modal.innerHTML = '<div class="lib-modal-mask" data-mask></div>'
      + '<div class="lib-modal-card lib-panel">'
      + '<div class="lib-modal-head"><h3>' + title + '</h3>'
      + '<button type="button" class="lib-modal-close" data-close>×</button></div>'
      + (list.length ? '<div class="lib-panel-list">' + list.map(function (b) {
        var p = progressOf(b.id);
        var sub = kind === 'fav'
          ? esc(b.author) + ' · ' + esc(b.category)
          : (p ? '上次读到第 ' + p + ' 页' : '未开始阅读') + ' · ' + esc(b.author);
        return '<button type="button" class="lib-panel-item" data-open="' + esc(b.id) + '">'
          + '<span class="lib-panel-cover" style="--accent:' + esc(b.accent) + '"><span>' + esc(b.title.slice(0, 4)) + '</span></span>'
          + '<span class="lib-panel-text"><b>' + esc(b.title) + '</b><small>' + sub + '</small></span>'
          + '<span class="lib-panel-go">打开 →</span></button>';
      }).join('') + '</div>'
        : '<div class="lib-panel-empty">' + (kind === 'fav' ? '还没有收藏的书籍，打开一本书点击「收藏」吧。' : '还没有阅读记录，去书架翻开一本书。') + '</div>')
      + '</div>';

    els.modal.querySelectorAll('[data-close], [data-mask]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
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
          return refreshRemote();
        }
      }
      markShelf(); renderShelf(); renderStatus();
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
    return LIB_AREAS[0];
  }

  function currentArea() { return areaById(state.area); }

  function syncAreaBtn() {
    var nameEl = $('libAreaName');
    if (nameEl) nameEl.textContent = currentArea().name;
    var btn = $('libAreaBtn');
    if (btn) btn.title = '切换图书馆区域 · 当前：' + currentArea().name;
  }

  function setArea(id) {
    state.area = areaById(id).id;
    state.page = 1;
    writeJSON(LS.area, state.area);
    syncAreaBtn();
    markShelf();
    renderShelf();
  }

  function openAreaPicker() {
    if (!els.modal) return;
    els.modal.hidden = false;
    els.modal.innerHTML = '<div class="lib-modal-mask" data-mask></div>'
      + '<div class="lib-modal-card lib-panel" role="dialog" aria-label="选择图书馆区域">'
      + '<div class="lib-modal-head"><h3>选择区域</h3>'
      + '<button type="button" class="lib-modal-close" data-close>×</button></div>'
      + '<div class="lib-panel-list">' + LIB_AREAS.map(function (a) {
        var on = a.id === state.area;
        return '<button type="button" class="lib-panel-item lib-area-item' + (on ? ' is-current' : '') + '" data-area="' + a.id + '">'
          + '<span class="lib-panel-cover" style="--accent:#c9a227"><span>' + esc(a.name.slice(0, 2)) + '</span></span>'
          + '<span class="lib-panel-text"><b>' + esc(a.name) + '</b><small>该区域内容</small></span>'
          + '<span class="lib-panel-go">' + (on ? '✓ 当前' : '选择 →') + '</span></button>';
      }).join('') + '</div></div>';
    els.modal.querySelectorAll('[data-close], [data-mask]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    els.modal.querySelectorAll('[data-area]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setArea(btn.getAttribute('data-area'));
        closeModal();
        toast('已切换到「' + currentArea().name + '」', 'info');
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

    var savedArea = readJSON(LS.area, LIB_AREAS[0].id);
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
      var pages = Math.max(1, Math.ceil(state.shelfBooks.length / SHELF_PAGE_SIZE));
      state.page = Math.min(pages, Math.max(1, Number(n) || 1));
      renderShelf();
    }
    if (els.pagerPrev) els.pagerPrev.addEventListener('click', function () { goPage(state.page - 1); });
    if (els.pagerNext) els.pagerNext.addEventListener('click', function () { goPage(state.page + 1); });
    if (els.pagerInput) {
      var applyJump = function () {
        var v = parseInt(els.pagerInput.value, 10);
        goPage(isNaN(v) ? state.page : v);
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
        var w = Math.min(120, slotW);
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
      els.body.addEventListener('click', function (event) {
        var card = event.target.closest('.lib-book');
        if (!card) return;
        /* 统一走站内详情/阅读；PDF 入口在详情与阅读界面内 */
        openBook(card.getAttribute('data-id'));
      });
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
    if (els.reader) { els.reader.classList.remove('is-open'); els.reader.hidden = true; els.reader.innerHTML = ''; }
    if (els.detail) { els.detail.classList.remove('is-open'); els.detail.hidden = true; els.detail.innerHTML = ''; }
    if (els.openLayer) { els.openLayer.hidden = true; els.openLayer.innerHTML = ''; }
  }

  function refresh() {
    if (!bound) return enter();
    state.booted = false;
    return boot();
  }

  window.HMLibrary = { enter: enter, leave: leave, refresh: refresh };
})();
