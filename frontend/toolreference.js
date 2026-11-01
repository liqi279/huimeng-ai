/* ============================================================
 * 素材参考 HMTOOLREFERENCE
 * 在【工具】模块下提供「参考」卡片：按关键词搜索不同素材参考
 * 图源：Pixabay（免费图库：照片 / 插画 / 矢量）
 * 支持：分类快选、缩略图网格、大图查看、复制链接、保存到资产库
 * 需要用户填入 Pixabay API Key（免费，pixabay.com/api/docs）
 * ============================================================ */
window.HMToolReference = (function () {
  'use strict';

  var LS_KEY = 'anidream.pixabay.key';
  var DEFAULT_KEY = '58353329-F7CBBE7615A3BBFD57B1BBF44';

  var CATEGORIES = [
    { id: 'character', label: '人物', tags: ['portrait', 'people'] },
    { id: 'pose', label: '姿势', tags: ['pose'] },
    { id: 'costume', label: '服装', tags: ['fashion', 'clothing'] },
    { id: 'scene', label: '场景', tags: ['landscape', 'scenery'] },
    { id: 'prop', label: '道具', tags: ['object', 'still-life'] },
    { id: 'light', label: '光影', tags: ['lighting', 'backlight'] },
    { id: 'color', label: '色彩', tags: ['colorful', 'gradient'] }
  ];

  var SOURCES = [
    { id: 'all', label: '全部素材', desc: '照片 + 插画 + 矢量', type: 'all' },
    { id: 'photo', label: '照片', desc: '摄影实景', type: 'photo' },
    { id: 'illustration', label: '插画', desc: '数字 / 手绘插画', type: 'illustration' },
    { id: 'vector', label: '矢量', desc: 'SVG 矢量图', type: 'vector' }
  ];

  var state = {
    query: '',
    source: 'all',
    category: '',
    page: 1,
    results: [],
    loading: false,
    apiKey: ''
  };

  var el = {};
  var inited = false;
  var abortCtrl = null;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  function loadKey() {
    try { return localStorage.getItem(LS_KEY) || DEFAULT_KEY; } catch (e) { return DEFAULT_KEY; }
  }
  function saveKey(k) {
    try { localStorage.setItem(LS_KEY, k || ''); } catch (e) {}
  }

  /* ---------------- 图源请求 ---------------- */
  function buildQuery() {
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
    return tags.join(' ');
  }

  function apiUrl(type, q, page) {
    return 'https://pixabay.com/api/?' +
      'key=' + encodeURIComponent(state.apiKey) +
      '&q=' + encodeURIComponent(q) +
      '&image_type=' + type +
      '&per_page=40&page=' + page +
      '&safesearch=true&lang=zh';
  }

  function normalize(raw) {
    var out = [];
    var hits = (raw && raw.hits) || [];
    for (var i = 0; i < hits.length; i++) {
      var p = hits[i];
      out.push({
        thumb: p.previewURL,
        full: p.largeImageURL || p.webformatURL,
        source: p.pageURL || '',
        title: p.tags || '',
        tags: p.tags || '',
        width: p.imageWidth, height: p.imageHeight,
        score: p.likes, views: p.views
      });
    }
    return out;
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

  function openOnSource() {
    var q = buildQuery();
    var url = 'https://pixabay.com/images/search/' + encodeURIComponent(q) + '/';
    window.open(url, '_blank', 'noopener');
  }

  async function search() {
    if (state.loading) return;
    var q = buildQuery();
    if (!q) {
      toast('请输入关键词或选择分类', 'error');
      return;
    }
    if (!state.apiKey) {
      toast('请先填入 Pixabay API Key（免费申请），或点击「在 Pixabay 打开」', 'error');
      return;
    }
    state.loading = true;
    renderStatus('搜索中…');
    renderGrid();

    if (abortCtrl) { try { abortCtrl.abort(); } catch (e) {} }
    abortCtrl = new AbortController();

    var src = getSource();
    var url = apiUrl(src.type, q, state.page);
    try {
      var data = await fetchJson(url);
      state.results = normalize(data);
      if (!state.results.length) {
        renderStatus('未找到结果，试试其他关键词');
      } else {
        renderStatus('共 ' + (data && data.totalHits || state.results.length) + ' 条结果 · Pixabay ' + src.label);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      state.results = [];
      renderStatus('搜索失败（' + (err.message || '网络错误') + '），可点击「在 Pixabay 打开」直接访问');
    } finally {
      state.loading = false;
      renderGrid();
    }
  }

  function getSource() {
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === state.source) return SOURCES[i];
    return SOURCES[0];
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
        ? '<div class="hm-rf-loading"><div class="hm-rf-spinner"></div><p>正在从 Pixabay 拉取素材…</p></div>'
        : '<div class="hm-rf-empty"><div class="hm-rf-empty-icon">参</div><h3>输入关键词或选择分类开始搜索</h3><p>图源 Pixabay 免费图库，点击大图可保存到资产库</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.results.length; i++) {
      var r = state.results[i];
      if (!r.thumb) continue;
      html += '<button class="hm-rf-item" data-idx="' + i + '" title="' + (r.tags || '参考图') + '">' +
        '<img src="' + r.thumb + '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
        (r.score != null ? '<span class="hm-rf-score">♥ ' + r.score + '</span>' : '') +
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
      '<p><b>图源：</b>Pixabay' + (r.score != null ? ' · 点赞 ' + r.score : '') +
      (r.views != null ? ' · 浏览 ' + r.views : '') + '</p>' +
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
    el.keyInput = $('rfKey');
    el.keySave = $('rfKeySave');

    state.apiKey = loadKey();
    if (el.keyInput) el.keyInput.value = state.apiKey;

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

    if (el.keySave) el.keySave.addEventListener('click', function () {
      state.apiKey = el.keyInput ? el.keyInput.value.trim() : '';
      saveKey(state.apiKey);
      toast(state.apiKey ? 'Pixabay Key 已保存' : '已清空 Pixabay Key');
    });

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
