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
    /* Render 免费层休眠后首个请求要 20~60 秒唤醒：
       打开登录框就先预热，用户输入账号密码的时间足够服务器醒来 */
    if (api && api.warmup) { try { api.warmup(); } catch (e) {} }
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

  /* 切换账号时清掉顶栏搜索框里浏览器残留/自动填充的文字（例如 admin），
     并重新设为只读，避免再次被自动填充 */
  function resetSearchBox() {
    var input = document.getElementById('modelSearch');
    if (!input) return;
    input.value = '';
    try { delete input.dataset.userTyped; } catch (e) { input.removeAttribute('data-user-typed'); }
    input.setAttribute('readonly', '');
  }
  window.HMResetSearchBox = resetSearchBox;

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
    /* 超过 3 秒仍未返回，说明后端在冷启动，给出明确提示避免用户以为卡死 */
    var slowTimer = setTimeout(function () {
      if (submitting) els.sub.textContent = '正在唤醒服务器（首次约 20~60 秒，请稍候）…';
    }, 3000);

    try {
      var res = mode === 'register'
        ? await api.register(username, password)
        : await api.login(username, password);
      if (res && res.token) api.setToken(res.token);
      /* 登录成功即证明后端在线（预热前 ping 可能因冷启动超时，把在线标记纠正过来） */
      if (api) api.online = true;
      /* 登录/注册接口已直接返回完整用户信息，不再额外请求 /auth/me，
         少一个跨地域往返（用户点击到登录框关闭只保留 1 个请求） */
      var me = (res && res.user) ? { user: res.user } : await api.me();
      window.HMApp = window.HMApp || {};
      window.HMApp.user = me.user;
      try { localStorage.setItem('hm.user', JSON.stringify(me.user)); } catch (e) {}

      /* 认证已完成：立即关闭登录框并刷新用户区，
         作品与桌面放到后台并行加载，不再让用户干等 */
      hideLogin();
      updateUserUI();
      resetSearchBox();
      if (window.HMApp && window.HMApp.toast) {
        window.HMApp.toast(mode === 'register' ? '注册成功，欢迎加入绘梦' : '登录成功', 'success');
      }
      loadUserData();
    } catch (err) {
      var msg = (err && err.message) ? err.message : '操作失败，请稍后重试';
      /* 网络错误通常意味着后端未启动或证书未信任 */
      if (/Failed to fetch|NetworkError|网络错误|load failed/i.test(msg) || (err && err.status === 0)) {
        msg = '无法连接后端，请确认：\n1. 本地已启动后端（cd server && node src/index.js）\n2. 首次使用请访问 https://localhost:8443 信任自签证书';
      }
      setError(msg);
    } finally {
      clearTimeout(slowTimer);
      setSubmitting(false);
      applyMode();
    }
  }

  /* 登录后：并行拉取作品与桌面布局（两者互不依赖，省一个往返） */
  function loadUserData() {
    var tasks = [refreshUserWorks()];
    if (window.HMDesk && typeof window.HMDesk.reloadForUser === 'function') {
      tasks.push(Promise.resolve().then(function () { window.HMDesk.reloadForUser(); }));
    } else if (window.HMDesk && typeof window.HMDesk.sync === 'function') {
      tasks.push(Promise.resolve().then(function () { window.HMDesk.sync(); }));
    }
    Promise.all(tasks).catch(function () {});
  }

  async function refreshUserWorks() {
    if (!api || !api.online) return;
    try {
      var data = await api.listWorks();
      if (data && Array.isArray(data.items) && window.HMApp && window.HMApp.state) {
        var A = window.HMApp;
        /* 手动登录时 state.works 已被登出清空，需先从该用户专属 key 加载本地作品，
           再与服务端合并（Render 重启会清空 data/，作品可能只存在本地） */
        var localFromKey = [];
        try {
          var key = A.worksLsKey ? A.worksLsKey() : 'anidream.works.v1';
          var raw = localStorage.getItem(key);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) localFromKey = parsed;
          }
        } catch (e) {}
        var memWorks = Array.isArray(A.state.works) ? A.state.works : [];
        var localWorks = localFromKey.length ? localFromKey : memWorks;
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
    /* app.js 的 authBoot 可能在 DOMContentLoaded 之前就调入本函数，
       此时元素尚未缓存，先补一次缓存，避免账号信息一直空白 */
    if (!els.userWrap) cache();
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
    /* 清空内存中的作品与桌面，避免下个账号看到上个账号的数据。
       注意：不删 localStorage（按用户隔离的 key 仍保留），
       同账号再次登录时 authBoot 会从对应用户 key 恢复。 */
    if (window.HMApp.state) {
      window.HMApp.state.works = [];
    }
    if (window.HMApp.renderWorks) window.HMApp.renderWorks();
    if (window.HMDesk && typeof window.HMDesk.resetForLogout === 'function') {
      try { window.HMDesk.resetForLogout(); } catch (e) {}
    }
    window.HMApp.user = null;
    toggleUserMenu(false);
    updateUserUI();
    resetSearchBox();
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
  }

  /* 立即暴露到全局：app.js 的 boot() 在 DOMContentLoaded 之前同步执行，
     若等到 bind() 里才暴露，authBoot 调用 updateUserUI/hideLogin 会抛
     ReferenceError 中断整个引导流程，导致右上角账号信息永远不显示 */
  window.showLogin = showLogin;
  window.hideLogin = hideLogin;
  window.updateUserUI = updateUserUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
