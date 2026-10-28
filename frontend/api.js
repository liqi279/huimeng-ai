'use strict';

/* =============================================================
 * 绘梦 · 后端 API 客户端（前后端分离）
 * 默认使用同源 /api；也可用 ?api= 指定后端地址，例如：
 *   GitHub Pages + 本地后端（推荐 HTTPS 避免混合内容拦截）：
 *     ?api=https://localhost:8443/api   （首次需访问 https://localhost:8443 信任自签证书）
 *     ?api=http://localhost:8787/api    （Chrome 允许 localhost 混合内容，其他浏览器可能拦截）
 * 或 <meta name="hm-api-base" content="..."> 指定后端地址。
 * ============================================================= */
(function () {
  var HM = window.HM = window.HM || {};

  var META = document.querySelector('meta[name="hm-api-base"]');
  var override = '';
  try {
    override = new URLSearchParams(location.search).get('api') || '';
  } catch (err) { override = ''; }

  /* 自动检测：在静态托管（如 GitHub Pages）上默认指向本地 HTTPS 后端，
   * 避免用户手动添加 ?api= 参数。本地运行时仍走同源 /api。 */
  var isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  var autoBase = isLocalHost ? '/api' : 'https://localhost:8443/api';

  var base = String(override || (META && META.content) || autoBase).replace(/\/+$/, '');
  var origin = '';
  if (/^https?:/i.test(base)) {
    try { origin = new URL(base).origin; } catch (err) { origin = ''; }
  }

  function apiUrl(path) {
    return base + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function normalizeError(data, status) {
    var message = '';
    var hint = '';
    if (data && typeof data === 'object') {
      if (data.error && typeof data.error === 'object') {
        message = String(data.error.message || '');
        hint = String(data.error.hint || '');
      } else if (typeof data.error === 'string') {
        message = data.error;
      } else if (data.message) {
        message = String(data.message);
      }
    } else if (typeof data === 'string') {
      message = data.slice(0, 180);
    }
    var error = new Error(message || ('后端请求失败（HTTP ' + status + '）'));
    if (hint) error.hint = hint;
    error.status = status;
    return error;
  }

  function authToken() {
    try { return localStorage.getItem('hm.token') || ''; } catch (e) { return ''; }
  }
  function setAuthToken(token) {
    try {
      if (token) localStorage.setItem('hm.token', token);
      else localStorage.removeItem('hm.token');
    } catch (e) {}
  }

  async function request(path, options, timeoutMs) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 30000);

    try {
      var token = authToken();
      var init = {
        method: opts.method || 'GET',
        headers: Object.assign({ Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, opts.headers || {}),
        signal: controller.signal
      };
      if (opts.body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }

      var res;
      try {
        res = await fetch(apiUrl(path), init);
      } catch (err) {
        var netError = new Error(err && err.name === 'AbortError'
          ? '后端请求超时，请稍后重试'
          : '无法连接后端服务，请确认已运行 npm start');
        netError.offline = true;
        throw netError;
      }

      var raw = await res.text();
      var data = null;
      if (raw) {
        try { data = JSON.parse(raw); } catch (err) { data = raw; }
      }
      if (!res.ok) throw normalizeError(data, res.status);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  var api = {
    base: base,
    online: false,
    checked: false,
    config: null,
    modes: [],
    engines: []
  };

  /* 探测后端；返回是否可用 */
  api.ping = async function () {
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      api.checked = true;
      api.online = false;
      return false;
    }
    try {
      var health = await request('/health', {}, 6000);
      api.online = !!(health && health.ok);
      api.modes = (health && health.modes) || [];
      api.engines = (health && health.engines) || [];
    } catch (err) {
      api.online = false;
    }
    api.checked = true;

    if (api.online) {
      try {
        api.config = await request('/config', {}, 6000);
      } catch (err) { api.config = null; }
    }
    return api.online;
  };

  api.hasServerKey = function () {
    return !!(api.config && api.config.rayin && api.config.rayin.hasKey);
  };

  api.generate = function (payload, timeoutMs) {
    return request('/generate', { method: 'POST', body: payload }, timeoutMs || 180000);
  };

  api.translate = async function (text) {
    var data = await request('/translate', { method: 'POST', body: { text: text } }, 30000);
    return (data && data.text) || '';
  };

  api.listWorks = function () { return request('/works', {}, 15000); };
  api.saveWork = function (work) { return request('/works', { method: 'POST', body: { work: work } }, 15000); };
  api.deleteWork = function (id) { return request('/works/' + encodeURIComponent(id), { method: 'DELETE' }, 15000); };
  api.clearWorks = function () { return request('/works', { method: 'DELETE' }, 15000); };

  api.getDesk = function () { return request('/desk', {}, 15000); };
  api.saveDesk = function (desk) { return request('/desk', { method: 'PUT', body: { desk: desk } }, 30000); };

  api.listAssets = function () { return request('/assets', {}, 15000); };
  api.addAsset = function (asset) { return request('/assets', { method: 'POST', body: asset }, 60000); };
  api.deleteAsset = function (id) { return request('/assets/' + encodeURIComponent(id), { method: 'DELETE' }, 15000); };

  api.presets = function () { return request('/presets', {}, 15000); };
  api.models = function (cfg) {
    return request('/rayin/models', { method: 'POST', body: cfg || {} }, 45000);
  };

  /* 后端返回的 /uploads/... 相对地址在跨域时需要补全 origin */
  api.mediaUrl = function (url) {
    var value = String(url || '');
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.charAt(0) === '/' && origin) return origin + value;
    return value;
  };

  /* -------------- 用户认证 -------------- */
  api.setToken = setAuthToken;
  api.getToken = authToken;

  api.register = function (username, password) {
    return request('/auth/register', { method: 'POST', body: { username: username, password: password } }, 15000);
  };
  api.login = function (username, password) {
    return request('/auth/login', { method: 'POST', body: { username: username, password: password } }, 15000);
  };
  api.me = function () {
    return request('/auth/me', {}, 10000);
  };
  api.logout = function () {
    setAuthToken('');
    try { localStorage.removeItem('hm.user'); } catch (e) {}
  };

  /* 管理员：用户管理 */
  api.listUsers = function () { return request('/auth/users', {}, 15000); };
  api.createUser = function (username, password, role) {
    return request('/auth/users', { method: 'POST', body: { username: username, password: password, role: role } }, 15000);
  };
  api.setUserRole = function (id, role) {
    return request('/auth/users/' + encodeURIComponent(id) + '/role', { method: 'PATCH', body: { role: role } }, 15000);
  };
  api.resetUserPassword = function (id, password) {
    return request('/auth/users/' + encodeURIComponent(id) + '/password', { method: 'PATCH', body: { password: password } }, 15000);
  };
  api.deleteUser = function (id) {
    return request('/auth/users/' + encodeURIComponent(id), { method: 'DELETE' }, 15000);
  };

  HM.api = api;
})();
