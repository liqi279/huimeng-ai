'use strict';

/* =============================================================
 * 绘梦 · 登录 / 注册 / 用户管理 UI
 * 依赖 api.js（window.HM.api）与 app.js（window.HMApp）
 * 暴露全局函数：showLogin / hideLogin / updateUserUI
 * ============================================================= */
(function () {
  var api = (window.HM && window.HM.api) ? window.HM.api : null;

  var mode = 'login'; /* 'login' | 'register' */
  var submitting = false;

  var els = {};
  function cache() {
    els.auth = document.getElementById('hmAuth');
    els.form = document.getElementById('authForm');
    els.title = document.getElementById('authTitle');
    els.sub = document.getElementById('authSub');
    els.username = document.getElementById('authUsername');
    els.password = document.getElementById('authPassword');
    els.confirmWrap = document.getElementById('authConfirmWrap');
    els.confirm = document.getElementById('authConfirm');
    els.error = document.getElementById('authError');
    els.submit = document.getElementById('authSubmit');
    els.submitText = document.getElementById('authSubmitText');
    els.spin = document.querySelector('#authSubmit .hm-auth-spin');
    els.switchHint = document.getElementById('authSwitchHint');
    els.switchBtn = document.getElementById('authSwitchBtn');
    els.tabLogin = document.getElementById('authTabLogin');
    els.tabRegister = document.getElementById('authTabRegister');

    els.userWrap = document.getElementById('hmUserWrap');
    els.userPill = document.getElementById('hmUserPill');
    els.userAvatar = document.getElementById('hmUserAvatar');
    els.userName = document.getElementById('hmUserName');
    els.userRole = document.getElementById('hmUserRole');
    els.userMenu = document.getElementById('hmUserMenu');
    els.adminBtn = document.getElementById('hmUserAdminBtn');

    els.adminModal = document.getElementById('userAdminModal');
    els.adminClose = document.getElementById('userAdminClose');
    els.adminList = document.getElementById('adminUserList');
    els.adminNewUser = document.getElementById('adminNewUser');
    els.adminNewPass = document.getElementById('adminNewPass');
    els.adminNewRole = document.getElementById('adminNewRole');
    els.adminCreateBtn = document.getElementById('adminCreateBtn');
  }

  /* ---------- 认证页显隐 ---------- */
  function showLogin(tab) {
    if (!els.auth) return;
    mode = tab === 'register' ? 'register' : 'login';
    els.auth.hidden = false;
    els.auth.setAttribute('aria-hidden', 'false');
    applyMode();
    clearError();
    setTimeout(function () { els.username && els.username.focus(); }, 50);
  }

  function hideLogin() {
    if (!els.auth) return;
    els.auth.hidden = true;
    els.auth.setAttribute('aria-hidden', 'true');
  }

  function applyMode() {
    var isReg = mode === 'register';
    els.tabLogin.classList.toggle('is-active', !isReg);
    els.tabRegister.classList.toggle('is-active', isReg);
    els.confirmWrap.hidden = !isReg;
    if (isReg) {
      els.title.textContent = '创建账号';
      els.sub.textContent = '注册后你的作品将云端同步';
      els.submitText.textContent = '注册并登录';
      els.switchHint.textContent = '已有账号？';
      els.switchBtn.textContent = '去登录';
      els.password.setAttribute('autocomplete', 'new-password');
    } else {
      els.title.textContent = '欢迎回来';
      els.sub.textContent = '登录你的账号继续创作';
      els.submitText.textContent = '登录';
      els.switchHint.textContent = '还没有账号？';
      els.switchBtn.textContent = '立即注册';
      els.password.setAttribute('autocomplete', 'current-password');
    }
  }

  function setError(msg) {
    if (!msg) { clearError(); return; }
    els.error.textContent = msg;
    els.error.hidden = false;
  }
  function clearError() { els.error.hidden = true; els.error.textContent = ''; }

  function setSubmitting(on) {
    submitting = on;
    els.submit.disabled = on;
    els.spin.hidden = !on;
    els.submitText.hidden = on;
  }

  /* ---------- 提交 ---------- */
  async function handleSubmit(ev) {
    ev.preventDefault();
    if (submitting) return;
    var username = (els.username.value || '').trim();
    var password = els.password.value || '';
    var confirm = els.confirm.value || '';

    if (!username || !password) { setError('请输入用户名和密码'); return; }
    if (username.length < 3) { setError('用户名至少 3 个字符'); return; }
    if (password.length < 6) { setError('密码至少 6 个字符'); return; }
    if (mode === 'register' && password !== confirm) { setError('两次输入的密码不一致'); return; }

    setSubmitting(true);
    clearError();
    try {
      var res = mode === 'register'
        ? await api.register(username, password)
        : await api.login(username, password);
      if (res && res.token) api.setToken(res.token);
      var me = await api.me();
      window.HMApp = window.HMApp || {};
      window.HMApp.user = me.user;
      try { localStorage.setItem('hm.user', JSON.stringify(me.user)); } catch (e) {}

      /* 拉取该用户作品并刷新 */
      await refreshUserWorks();

      /* 同步该用户的桌面布局 */
      if (window.HMDesk && typeof window.HMDesk.sync === 'function') {
        try { window.HMDesk.sync(); } catch (e) {}
      }

      hideLogin();
      updateUserUI();
      if (window.HMApp && window.HMApp.toast) {
        window.HMApp.toast(mode === 'register' ? '注册成功，欢迎加入绘梦' : '登录成功', 'success');
      }
    } catch (err) {
      var msg = (err && err.message) ? err.message : '操作失败，请稍后重试';
      /* 网络错误通常意味着后端未启动或证书未信任 */
      if (/Failed to fetch|NetworkError|网络错误|load failed/i.test(msg) || (err && err.status === 0)) {
        msg = '无法连接后端，请确认：\n1. 本地已启动后端（cd server && node src/index.js）\n2. 首次使用请访问 https://localhost:8443 信任自签证书';
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshUserWorks() {
    if (!api || !api.online) return;
    try {
      var data = await api.listWorks();
      if (data && Array.isArray(data.items) && window.HMApp && window.HMApp.state) {
        var A = window.HMApp;
        /* 合并服务端与本地，绝不用服务端空列表覆盖本地
           （Render 免费层重启会清空 data/，作品可能只存在本地） */
        var localWorks = Array.isArray(A.state.works) ? A.state.works : [];
        A.state.works = (A.mergeWorks
          ? A.mergeWorks(data.items, localWorks)
          : data.items.concat(localWorks));
        /* 从 IndexedDB 补回原图（本地缓存里 url 被清空、blob 标记存在） */
        if (A.hydrateWorks) { try { await A.hydrateWorks(); } catch (e) {} }
        /* 走 saveWorks：备份 + 写 IndexedDB + 同步服务端，不直接写 localStorage */
        if (A.saveWorks) A.saveWorks();
        if (A.renderWorks) A.renderWorks();
      }
    } catch (e) {}
  }

  /* ---------- 用户头像 UI ---------- */
  function updateUserUI() {
    if (!els.userWrap) return;
    var user = (window.HMApp && window.HMApp.user) || null;
    if (!user) {
      els.userWrap.hidden = true;
      return;
    }
    els.userWrap.hidden = false;
    els.userAvatar.textContent = String(user.username || '?').charAt(0).toUpperCase();
    els.userName.textContent = user.username || '用户';
    var isAdmin = user.role === 'admin';
    els.userRole.hidden = !isAdmin;
    els.adminBtn.hidden = !isAdmin;
  }

  function toggleUserMenu(force) {
    var open = typeof force === 'boolean' ? force : !els.userMenu.classList.contains('is-open');
    els.userMenu.classList.toggle('is-open', open);
    els.userMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  async function handleLogout() {
    if (api && api.logout) api.logout();
    window.HMApp = window.HMApp || {};
    window.HMApp.user = null;
    toggleUserMenu(false);
    updateUserUI();
    showLogin('login');
  }

  /* ---------- 管理员 - 用户管理 ---------- */
  function openAdminModal() {
    if (!els.adminModal) return;
    els.adminModal.classList.add('is-open');
    els.adminModal.setAttribute('aria-hidden', 'false');
    loadAdminUsers();
  }
  function closeAdminModal() {
    if (!els.adminModal) return;
    els.adminModal.classList.remove('is-open');
    els.adminModal.setAttribute('aria-hidden', 'true');
  }

  function roleLabel(role) { return role === 'admin' ? '超级管理员' : '普通用户'; }
  function formatTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return ''; }
  }

  async function loadAdminUsers() {
    if (!api) return;
    els.adminList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">加载中…</div>';
    try {
      var data = await api.listUsers();
      var users = (data && data.users) || [];
      var me = (window.HMApp && window.HMApp.user) || null;
      if (!users.length) {
        els.adminList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">暂无用户</div>';
        return;
      }
      els.adminList.innerHTML = users.map(function (u) {
        var isMe = me && me.id === u.id;
        var avatar = String(u.username || '?').charAt(0).toUpperCase();
        var roleCls = u.role === 'admin' ? '' : 'is-user';
        return '' +
          '<div class="hm-admin-row" data-uid="' + u.id + '">' +
            '<span class="hm-user-avatar">' + avatar + '</span>' +
            '<div class="hm-admin-info">' +
              '<div class="hm-admin-uname">' + escapeHtml(u.username) + (isMe ? ' <span style="color:var(--muted);font-weight:400;font-size:12px;">（你）</span>' : '') + '</div>' +
              '<div class="hm-admin-meta">创建于 ' + formatTime(u.createdAt) + '</div>' +
            '</div>' +
            '<span class="hm-admin-role-tag ' + roleCls + '">' + roleLabel(u.role) + '</span>' +
            '<div class="hm-admin-actions">' +
              (u.role === 'admin'
                ? '<button data-acmd="demote"' + (isMe ? ' disabled style="opacity:.4;cursor:not-allowed;"' : '') + '>降为用户</button>'
                : '<button data-acmd="promote"' + (isMe ? ' disabled style="opacity:.4;cursor:not-allowed;"' : '') + '>升为管理员</button>') +
              '<button data-acmd="reset">重置密码</button>' +
              '<button data-acmd="delete" class="is-danger"' + (isMe ? ' disabled style="opacity:.4;cursor:not-allowed;"' : '') + '>删除</button>' +
            '</div>' +
          '</div>';
      }).join('');
    } catch (err) {
      els.adminList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);font-size:13px;">加载失败：' + escapeHtml(err.message || '未知错误') + '</div>';
    }
  }

  async function handleAdminAction(uid, cmd) {
    var me = (window.HMApp && window.HMApp.user) || null;
    if (me && me.id === uid) return;
    try {
      if (cmd === 'promote') {
        await api.setUserRole(uid, 'admin');
        toast('已提升为管理员', 'success');
      } else if (cmd === 'demote') {
        await api.setUserRole(uid, 'user');
        toast('已降为普通用户', 'success');
      } else if (cmd === 'reset') {
        var pwd = window.prompt('请输入新密码（至少 6 位）：');
        if (pwd === null) return;
        if (pwd.length < 6) { toast('密码至少 6 位', 'error'); return; }
        await api.resetUserPassword(uid, pwd);
        toast('密码已重置', 'success');
      } else if (cmd === 'delete') {
        if (!window.confirm('确定删除该用户？该用户的所有作品与桌面数据将被清除，且不可恢复。')) return;
        await api.deleteUser(uid);
        toast('用户已删除', 'success');
      }
      loadAdminUsers();
    } catch (err) {
      toast(err && err.message ? err.message : '操作失败', 'error');
    }
  }

  async function handleAdminCreate() {
    var username = (els.adminNewUser.value || '').trim();
    var password = els.adminNewPass.value || '';
    var role = els.adminNewRole.value || 'user';
    if (username.length < 3) { toast('用户名至少 3 个字符', 'error'); return; }
    if (password.length < 6) { toast('密码至少 6 个字符', 'error'); return; }
    try {
      await api.createUser(username, password, role);
      els.adminNewUser.value = '';
      els.adminNewPass.value = '';
      toast('用户创建成功', 'success');
      loadAdminUsers();
    } catch (err) {
      toast(err && err.message ? err.message : '创建失败', 'error');
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, type) {
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type);
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    cache();
    if (!els.auth) return;

    els.tabLogin.addEventListener('click', function () { mode = 'login'; applyMode(); clearError(); });
    els.tabRegister.addEventListener('click', function () { mode = 'register'; applyMode(); clearError(); });
    els.switchBtn.addEventListener('click', function () {
      mode = mode === 'login' ? 'register' : 'login';
      applyMode();
      clearError();
    });
    els.form.addEventListener('submit', handleSubmit);

    /* 用户菜单 */
    els.userPill.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleUserMenu();
    });
    document.addEventListener('click', function (ev) {
      if (els.userMenu && !els.userMenu.contains(ev.target) && ev.target !== els.userPill) {
        toggleUserMenu(false);
      }
    });
    els.userMenu.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-ucmd]');
      if (!btn) return;
      var cmd = btn.dataset.ucmd;
      if (cmd === 'logout') handleLogout();
      else if (cmd === 'admin') { toggleUserMenu(false); openAdminModal(); }
      else if (cmd === 'profile') {
        toggleUserMenu(false);
        var u = (window.HMApp && window.HMApp.user) || {};
        toast('当前账号：' + (u.username || '') + '（' + roleLabel(u.role) + '）', 'info');
      }
    });

    /* 管理员弹窗 */
    els.adminClose.addEventListener('click', closeAdminModal);
    els.adminModal.addEventListener('click', function (ev) {
      if (ev.target === els.adminModal) closeAdminModal();
    });
    els.adminCreateBtn.addEventListener('click', handleAdminCreate);
    els.adminList.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-acmd]');
      if (!btn || btn.disabled) return;
      var row = btn.closest('.hm-admin-row');
      if (!row) return;
      handleAdminAction(row.dataset.uid, btn.dataset.acmd);
    });

    /* 暴露到全局，供 app.js 的 authBoot 调用 */
    window.showLogin = showLogin;
    window.hideLogin = hideLogin;
    window.updateUserUI = updateUserUI;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
