/* ============================================================
 * 素材参考 HMTOOLREFERENCE
 * 在【工具】模块下提供「参考」卡片：按关键词搜索不同素材参考
 * 图源：Yandere / Danbooru / Konachan（动漫插画）+ Openverse（通用素材）
 * 支持：分类快选、缩略图网格、大图查看、复制链接、保存到资产库
 * ============================================================ */
window.HMToolReference = (function () {
  'use strict';

  var CATEGORIES = [
    { id: 'character', label: '人物', tags: ['1girl', 'solo'] },
    { id: 'pose', label: '姿势', tags: ['standing', 'looking_at_viewer'] },
    { id: 'costume', label: '服装', tags: ['school_uniform', 'sailor_dress'] },
    { id: 'scene', label: '场景', tags: ['scenery', 'sky'] },
    { id: 'prop', label: '道具', tags: ['flower', 'holding'] },
    { id: 'light', label: '光影', tags: ['backlighting', 'sunlight'] },
    { id: 'color', label: '色彩', tags: ['colorful', 'gradient'] }
  ];

  var SOURCES = [
    { id: 'yandere', label: 'Yande.re', desc: '动漫插画 · 无密钥', type: 'yandere' },
    { id: 'danbooru', label: 'Danbooru', desc: '动漫插画 · 标签最全', type: 'danbooru' },
    { id: 'konachan', label: 'Konachan', desc: '动漫壁纸 · 高清', type: 'konachan' },
    { id: 'openverse', label: 'Openverse', desc: '通用素材 · 摄影/插画', type: 'openverse' }
  ];

  var state = {
    query: '',
    source: 'danbooru',
    category: '',
    page: 1,
    results: [],
    loading: false
  };

  var el = {};
  var inited = false;
  var abortCtrl = null;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------------- 图源请求 ---------------- */
  function buildTags() {
    var tags = [];
    if (state.query) tags.push(state.query.trim());
    if (state.category) {
      for (var i = 0; i < CATEGORIES.length; i++) {
        if (CATEGORIES[i].id === state.category) {
          tags = tags.concat(CATEGORIES[i].tags);
          break;
        }
      }
    }
    return tags;
  }

  function apiUrl(type, tags, page) {
    var q = tags.join(' ');
    if (type === 'yandere') {
      return 'https://yande.re/post.json?tags=' + encodeURIComponent(q) + '&limit=40&page=' + page;
    }
    if (type === 'konachan') {
      return 'https://konachan.com/post.json?tags=' + encodeURIComponent(q) + '&limit=40&page=' + page;
    }
    if (type === 'danbooru') {
      return 'https://danbooru.donmai.us/posts.json?tags=' + encodeURIComponent(q) + '&limit=40&page=' + page;
    }
    if (type === 'openverse') {
      return 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) + '&page_size=40&page=' + page;
    }
    return '';
  }

  function normalize(raw, type) {
    var out = [];
    if (type === 'openverse') {
      var arr = raw && raw.results ? raw.results : [];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        out.push({
          thumb: it.thumbnail,
          full: it.url,
          source: it.foreign_landing_url || it.url,
          title: it.title || '',
          tags: (it.tags || []).map(function (t) { return t.name || t; }).join(' '),
          width: it.width, height: it.height, license: it.license
        });
      }
    } else {
      for (var j = 0; j < raw.length; j++) {
        var p = raw[j];
        if (!p) continue;
        out.push({
          thumb: p.preview_file_url || p.preview_url || p.sample_url || p.file_url,
          full: p.large_file_url || p.file_url || p.sample_url,
          source: p.source || '',
          title: '',
          tags: p.tag_string || p.tags || '',
          width: p.image_width || p.width, height: p.image_height || p.height, score: p.score
        });
      }
    }
    return out;
  }

  /* Moebooru 系（Yande.re / Konachan）不发 CORS 头，用 JSONP 绕过 */
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = '__rfcb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      var timer = setTimeout(function () { cleanup(); reject(new Error('请求超时')); }, 15000);
      var script = document.createElement('script');
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = null; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (d) { cleanup(); resolve(d); };
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'callback=' + cb;
      script.onerror = function () { cleanup(); reject(new Error('网络错误')); };
      document.head.appendChild(script);
    });
  }

  /* 直连优先，失败时走公共 CORS 代理兜底 */
  async function fetchJson(url) {
    try {
      var res = await fetch(url, { signal: abortCtrl.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      var proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      var res2 = await fetch(proxy, { signal: abortCtrl.signal });
      if (!res2.ok) throw new Error('HTTP ' + res2.status);
      return await res2.json();
    }
  }

  async function search() {
    if (state.loading) return;
    var tags = buildTags();
    if (!tags.length) {
      toast('请输入关键词或选择分类', 'error');
      return;
    }
    state.loading = true;
    renderStatus('搜索中…');
    renderGrid();

    if (abortCtrl) { try { abortCtrl.abort(); } catch (e) {} }
    abortCtrl = new AbortController();

    var src = getSource();
    var url = apiUrl(src.type, tags, state.page);
    try {
      var data;
      if (src.type === 'yandere' || src.type === 'konachan') {
        data = await jsonp(url);
      } else {
        data = await fetchJson(url);
      }
      state.results = normalize(data, src.type);
      if (!state.results.length) {
        renderStatus('未找到结果，试试其他关键词或图源');
      } else {
        renderStatus('共 ' + state.results.length + ' 条结果 · ' + src.label);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      state.results = [];
      renderStatus('搜索失败（' + (err.message || '网络错误') + '），可点击「在图源打开」直接访问');
    } finally {
      state.loading = false;
      renderGrid();
    }
  }

  function getSource() {
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === state.source) return SOURCES[i];
    return SOURCES[0];
  }

  function openOnSource() {
    var src = getSource();
    var tags = buildTags().join(' ');
    var url = '';
    if (src.type === 'yandere') url = 'https://yande.re/post?tags=' + encodeURIComponent(tags);
    else if (src.type === 'konachan') url = 'https://konachan.com/post?tags=' + encodeURIComponent(tags);
    else if (src.type === 'danbooru') url = 'https://danbooru.donmai.us/posts?tags=' + encodeURIComponent(tags);
    else url = 'https://openverse.org/search/?q=' + encodeURIComponent(tags) + '&type=image';
    window.open(url, '_blank', 'noopener');
  }

  /* ---------------- 渲染 ---------------- */
  function renderSources() {
    if (!el.sources) return;
    var html = '';
    for (var i = 0; i < SOURCES.length; i++) {
      var s = SOURCES[i];
      html += '<button class="hm-rf-src' + (s.id === state.source ? ' is-active' : '') + '" data-src="' + s.id + '">' +
        '<b>' + s.label + '</b><span>' + s.desc + '</span></button>';
    }
    el.sources.innerHTML = html;
  }

  function renderCategories() {
    if (!el.cats) return;
    var html = '<button class="hm-rf-cat' + (state.category === '' ? ' is-active' : '') + '" data-cat="">全部</button>';
    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      html += '<button class="hm-rf-cat' + (state.category === c.id ? ' is-active' : '') + '" data-cat="' + c.id + '">' + c.label + '</button>';
    }
    el.cats.innerHTML = html;
  }

  function renderGrid() {
    if (!el.grid) return;
    if (!state.results.length) {
      el.grid.innerHTML = state.loading
        ? '<div class="hm-rf-loading"><div class="hm-rf-spinner"></div><p>正在从 ' + getSource().label + ' 拉取素材…</p></div>'
        : '<div class="hm-rf-empty"><div class="hm-rf-empty-icon">参</div><h3>输入关键词或选择分类开始搜索</h3><p>支持多个图源切换，点击大图可保存到资产库</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.results.length; i++) {
      var r = state.results[i];
      if (!r.thumb) continue;
      html += '<button class="hm-rf-item" data-idx="' + i + '" title="' + (r.tags || r.title || '参考图') + '">' +
        '<img src="' + r.thumb + '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
        (r.score != null ? '<span class="hm-rf-score">' + r.score + '</span>' : '') +
        '</button>';
    }
    el.grid.innerHTML = html;
  }

  function renderStatus(msg) {
    if (el.status) el.status.textContent = msg || '';
  }

  function openDetail(idx) {
    var r = state.results[idx];
    if (!r || !el.detail) return;
    el.detailImg.src = r.full || r.thumb;
    el.detailImg.alt = r.tags || r.title || '';
    el.detailMeta.innerHTML =
      '<p><b>图源：</b>' + getSource().label + (r.score != null ? ' · 评分 ' + r.score : '') + '</p>' +
      '<p class="hm-rf-tags">' + (r.tags || r.title || '—') + '</p>';
    el.detail.dataset.idx = idx;
    el.detail.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    if (!el.detail) return;
    el.detail.hidden = true;
    document.body.style.overflow = '';
  }

  function copyLink() {
    var idx = parseInt(el.detail.dataset.idx, 10);
    var r = state.results[idx];
    if (!r) return;
    var url = r.full || r.thumb;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('链接已复制'); }, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('链接已复制'); } catch (e) { toast('复制失败', 'error'); }
      document.body.removeChild(ta);
    }
  }

  function openSource() {
    var idx = parseInt(el.detail.dataset.idx, 10);
    var r = state.results[idx];
    if (!r) return;
    var url = r.source || r.full || r.thumb;
    if (url) window.open(url, '_blank', 'noopener');
  }

  function saveToAssets() {
    var idx = parseInt(el.detail.dataset.idx, 10);
    var r = state.results[idx];
    if (!r) return;
    if (window.HMAssets && typeof window.HMAssets.addFromUrl === 'function') {
      window.HMAssets.addFromUrl(r.full || r.thumb, r.tags || r.title || '参考图');
      toast('已加入资产库');
    } else {
      toast('资产库未就绪，可右键保存图片');
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
    el.search = $('rfSearch');
    el.btn = $('rfBtn');
    el.sources = $('rfSources');
    el.cats = $('rfCats');
    el.grid = $('rfGrid');
    el.status = $('rfStatus');
    el.openSrc = $('rfOpenSrc');
    el.detail = $('rfDetail');
    el.detailImg = $('rfDetailImg');
    el.detailMeta = $('rfDetailMeta');
    el.detailClose = $('rfDetailClose');
    el.detailCopy = $('rfDetailCopy');
    el.detailOpen = $('rfDetailOpen');
    el.detailSave = $('rfDetailSave');
    el.back = $('rfBack');

    renderSources();
    renderCategories();
    renderGrid();

    bind();
  }

  function bind() {
    if (el.back) el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });
    if (el.search) el.search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { state.query = el.search.value; state.page = 1; search(); }
    });
    if (el.btn) el.btn.addEventListener('click', function () {
      state.query = el.search.value; state.page = 1; search();
    });
    if (el.openSrc) el.openSrc.addEventListener('click', openOnSource);

    if (el.sources) el.sources.addEventListener('click', function (e) {
      var b = e.target.closest('[data-src]');
      if (!b) return;
      state.source = b.getAttribute('data-src');
      renderSources();
      if (state.query || state.category) { state.page = 1; search(); }
    });
    if (el.cats) el.cats.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (!b) return;
      state.category = b.getAttribute('data-cat');
      renderCategories();
      state.page = 1; search();
    });
    if (el.grid) el.grid.addEventListener('click', function (e) {
      var it = e.target.closest('[data-idx]');
      if (!it) return;
      openDetail(parseInt(it.getAttribute('data-idx'), 10));
    });
    if (el.detailClose) el.detailClose.addEventListener('click', closeDetail);
    if (el.detail) el.detail.addEventListener('click', function (e) {
      if (e.target === el.detail) closeDetail();
    });
    if (el.detailCopy) el.detailCopy.addEventListener('click', copyLink);
    if (el.detailOpen) el.detailOpen.addEventListener('click', openSource);
    if (el.detailSave) el.detailSave.addEventListener('click', saveToAssets);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.detail && !el.detail.hidden) closeDetail();
    });
  }

  function enter() { init(); }
  function leave() { if (abortCtrl) { try { abortCtrl.abort(); } catch (e) {} } closeDetail(); }

  return { enter: enter, leave: leave };
})();
