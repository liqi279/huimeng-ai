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
    user: 'anidream.library.user.v1'
  };

  var SEED = (window.HM_LIBRARY_SEED && window.HM_LIBRARY_SEED.books) || [];

  var state = {
    mode: 'local',        /* local | remote */
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
      sortNo: Number(b.sortNo == null ? i : b.sortNo),
      createdAt: Number(b.createdAt || t),
      updatedAt: Number(b.updatedAt || t),
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
    state.shelfBooks = applyQuery(state.books);
  }

  function boot() {
    if (state.booted) return Promise.resolve();
    state.loading = true;
    renderSkeleton();
    return request('/library/books', {}, 7000).then(function (data) {
      state.mode = 'remote';
      state.books = (data.items || []).map(function (b, i) { return normalize(b, i); });
      return loadRemoteAux();
    }).catch(function (err) {
      state.mode = 'local';
      state.books = localBooks();
      state.fav = loadFavLocal();
      state.hist = loadHistLocal();
    }).then(function () {
      state.booted = true;
      state.loading = false;
      markShelf();
      renderShelf();
      renderStatus();
    });
  }

  function loadRemoteAux() {
    return Promise.all([
      request('/library/favorites', {}, 6000).catch(function () { return { items: [] }; }),
      request('/library/history', {}, 6000).catch(function () { return { items: [] }; })
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
    return request('/library/books', {}, 10000).then(function (data) {
      state.books = data.items || [];
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

  var SHELF_PER_ROW = 6;

  function renderShelf() {
    if (!els.body) return;
    var list = state.shelfBooks;
    if (!list.length) {
      els.body.innerHTML = '<div class="lib-empty">'
        + '<div class="lib-empty-icon">📖</div>'
        + '<h3>' + (state.query ? '没有找到相关书籍' : '书架还是空的') + '</h3>'
        + '<p>' + (state.query ? '换个关键词试试，或清空搜索查看全部藏书。' : '点击右上角「新增书籍」，把第一本书放上书架。') + '</p>'
        + '</div>';
      renderStatus();
      return;
    }

    var rows = [];
    for (var i = 0; i < list.length; i += SHELF_PER_ROW) {
      rows.push(list.slice(i, i + SHELF_PER_ROW));
    }

    var html = rows.map(function (group, rowIndex) {
      var label = group[0] && group[0].category ? group[0].category : '藏书';
      var booksHtml = group.map(function (b, idx) {
        return bookCardHtml(b, rowIndex * SHELF_PER_ROW + idx);
      }).join('');
      return '<section class="lib-shelf-row">'
        + '<div class="lib-shelf-books">' + booksHtml + '</div>'
        + '<div class="lib-shelf-plank">'
        + '<span class="lib-shelf-label">第 ' + (rowIndex + 1) + ' 架 · ' + esc(label) + '</span>'
        + '<span class="lib-shelf-count">' + group.length + ' 册</span>'
        + '</div></section>';
    }).join('');

    els.body.innerHTML = '<div class="lib-shelf-wrap">' + html + '</div>';
    renderStatus();
  }

  function bookCardHtml(b, index) {
    var tilt = ((index % 5) - 2) * 1.1;
    var width = 88 + (index % 3) * 7;
    var pageCount = (b.pages && b.pages.length) || Number(b.pageCount) || 0;
    var hasProgress = progressOf(b.id) > 0;
    return '<button type="button" class="lib-book" data-id="' + esc(b.id) + '"'
      + ' style="--accent:' + esc(b.accent) + ';--tilt:' + tilt + 'deg;--w:' + width + 'px"'
      + ' title="' + esc(b.title) + ' · ' + esc(b.author) + '">'
      + '<span class="lib-book-body">'
      + '<span class="lib-book-spine"><span class="lib-book-spine-title">' + esc(b.title) + '</span></span>'
      + '<span class="lib-book-cover">'
      + '<span class="lib-book-cover-frame"></span>'
      + '<span class="lib-book-cover-title">' + esc(b.title) + '</span>'
      + '<span class="lib-book-cover-rule"></span>'
      + '<span class="lib-book-cover-author">' + esc(b.author) + '</span>'
      + '<span class="lib-book-cover-seal">藏</span>'
      + '<span class="lib-book-cover-brand">绘梦藏书</span>'
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
      + '<div class="lib-detail-cover" style="--accent:' + esc(book.accent) + '">'
      + '<span class="lib-detail-cover-frame"></span>'
      + '<span class="lib-detail-cover-title">' + esc(book.title) + '</span>'
      + '<span class="lib-detail-cover-rule"></span>'
      + '<span class="lib-detail-cover-author">' + esc(book.author) + '</span>'
      + '<span class="lib-detail-cover-brand">绘梦藏书 · 统一模板</span>'
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
      + '<span>共 ' + pages + ' 页</span><span>' + esc(book.category) + '</span>'
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

  function enterReader(book, page) {
    if (!book) return;
    state.current = book;
    state.page = Math.max(0, Math.min(Number(page) || 0, pageCount(book) - 1));
    closeDetail(true);
    renderReader();
    els.reader.hidden = false;
    requestAnimationFrame(function () { els.reader.classList.add('is-open'); });
    paintPage();
    persistProgress(book.id, state.page);
  }

  function renderReader() {
    if (!els.reader) return;
    els.reader.innerHTML = '<div class="lib-reader-top">'
      + '<button type="button" class="lib-reader-back" data-exit>← 合上书</button>'
      + '<div class="lib-reader-title">《' + esc(state.current.title) + '》</div>'
      + '<div class="lib-reader-page-label" data-page-label></div>'
      + '</div>'
      + '<div class="lib-reader-stage">'
      + '<button type="button" class="lib-flip-zone lib-flip-left" data-prev aria-label="上一页">'
      + '<span class="lib-flip-arrow">‹</span></button>'
      + '<div class="lib-book-frame">'
      + '<div class="lib-page-under" data-under></div>'
      + '<div class="lib-page-top" data-top></div>'
      + '<div class="lib-page-gutter"></div>'
      + '</div>'
      + '<button type="button" class="lib-flip-zone lib-flip-right" data-next aria-label="下一页">'
      + '<span class="lib-flip-arrow">›</span></button>'
      + '</div>'
      + '<div class="lib-reader-bottom">'
      + '<div class="lib-reader-progress"><div class="lib-reader-progress-fill" data-fill></div></div>'
      + '<div class="lib-reader-hint">点击左侧 / 右侧翻页 · 也可使用 ← → 键</div>'
      + '</div>';

    els.reader.querySelector('[data-exit]').addEventListener('click', exitReader);
    els.reader.querySelector('[data-prev]').addEventListener('click', function () { flipTo(state.page - 1); });
    els.reader.querySelector('[data-next]').addEventListener('click', function () { flipTo(state.page + 1); });
    els.reader.querySelector('[data-top]').addEventListener('click', function (event) {
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
    var top = els.reader.querySelector('[data-top]');
    var under = els.reader.querySelector('[data-under]');
    if (top) top.innerHTML = pageHtml(state.current, state.page);
    if (under) under.innerHTML = '';
    var label = els.reader.querySelector('[data-page-label]');
    if (label) {
      var total = pageCount(state.current);
      label.textContent = state.page === 0
        ? '目录 · 共 ' + (total - 1) + ' 页'
        : '第 ' + state.page + ' / ' + (total - 1) + ' 页';
    }
    var fill = els.reader.querySelector('[data-fill]');
    if (fill) {
      var pct = total <= 1 ? 100 : Math.round((state.page / (total - 1)) * 100);
      fill.style.width = pct + '%';
    }
    updateFlipZones();
  }

  function updateFlipZones() {
    if (!els.reader) return;
    var prev = els.reader.querySelector('[data-prev]');
    var next = els.reader.querySelector('[data-next]');
    if (prev) prev.classList.toggle('is-disabled', state.page <= 0);
    if (next) next.classList.toggle('is-disabled', state.page >= pageCount(state.current) - 1);
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

  function exitReader() {
    if (!els.reader) return;
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
        else if (event.key === 'Escape') exitReader();
        return;
      }
      if (els.detail && !els.detail.hidden) {
        if (event.key === 'Escape') closeDetail();
      }
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

    bindSearch();
    bindKeys();

    var addBtn = $('libAddBtn');
    if (addBtn) addBtn.addEventListener('click', function () { openBookForm(null); });
    var favBtn = $('libFavBtn');
    if (favBtn) favBtn.addEventListener('click', function () { showPanel('fav'); });
    var histBtn = $('libHistoryBtn');
    if (histBtn) histBtn.addEventListener('click', function () { showPanel('hist'); });

    if (els.body) {
      els.body.addEventListener('click', function (event) {
        var card = event.target.closest('.lib-book');
        if (!card) return;
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
