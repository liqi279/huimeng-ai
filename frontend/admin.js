'use strict';

/* ===========================================================
 * 绘梦 AI · 管理台（独立 view page —— 与 create/works 同级）
 * 5 个子 Tab：概览 / 消耗排行 / 调用日志 / 账号管理 / 项目管理
 * 2 个占位 Tab：创作统计 / 软件设置（顶栏）
 * 容器在 index.html 的 #view-admin
 * =========================================================== */
(function () {
  var A = window.HMUI || {};
  var HM = window.HM;
  if (!HM) return;

  var charts = {};
  var currentTopTab = 'admin';
  var currentSubTab = 'overview';
  var eventsBound = false;

  /* ============ 权限检查 ============ */
  function isAdmin() {
    try {
      var t = localStorage.getItem('hm.token');
      if (!t) return false;
      var parts = t.split('.');
      if (parts.length < 2) return false;
      var payload = JSON.parse(atob(parts[1]));
      return payload.role === 'admin';
    } catch (e) { return false; }
  }

  /* ============ 打开 / 关闭 —— 用 HM.switchView ============ */
  function openAdmin() {
    if (!isAdmin()) {
      HM.toast && HM.toast('管理台仅超级管理员可访问', 'info');
      return;
    }
    if (HM.switchView) HM.switchView('admin');
  }

  function closeAdmin() {
    destroyAllCharts();
    if (HM.switchView) HM.switchView('create');
  }

  /* 直达「设置 → 管理台 → 账号管理」 */
  function openAccountAdmin() {
    if (!isAdmin()) {
      HM.toast && HM.toast('账号管理仅超级管理员可访问', 'info');
      return;
    }
    window.HM_ADMIN_TARGET = 'admin';
    window.HM_ADMIN_SUBTAB = 'accounts';
    if (HM.switchView) HM.switchView('admin');
  }

  /* ============ 一次性事件绑定（到 index.html 里已有的 #view-admin 元素） ============ */
  function bindAdminEvents() {
    if (eventsBound) return;
    eventsBound = true;

    var page = document.getElementById('view-admin');
    if (!page) return;

    /* 新增人员弹窗 + 非超管隐藏「账号管理」入口 */
    bindAccCreateModal();
    syncAccountsVisibility();

    page.addEventListener('click', function (e) {
      /* 顶 Tab：管理台 / 创作统计 / 软件设置 */
      var topBtn = e.target.closest('[data-top]');
      if (topBtn) {
        var top = topBtn.dataset.top;
        currentTopTab = top;
        page.querySelectorAll('.hm-admin-top-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.top === top);
        });
        var subTabsWrap = document.getElementById('adminSubTabs');
        var body = document.getElementById('adminBody');
        if (top === 'admin') {
          subTabsWrap.style.display = '';
          destroyAllCharts();
          body.innerHTML = '';
          switchSubTab('overview');
        } else if (top === 'api') {
          subTabsWrap.style.display = 'none';
          destroyAllCharts();
          renderApiPanel(body);
        } else {
          /* 占位 Tab */
          subTabsWrap.style.display = 'none';
          destroyAllCharts();
          body.innerHTML = '<div class="hm-admin-placeholder">' +
            '<div class="hm-admin-ph-ico">' + (top === 'stats' ? '📊' : '⚙️') + '</div>' +
            '<h2>' + (top === 'stats' ? '创作统计' : '软件设置') + '</h2>' +
            '<p>功能开发中，敬请期待…</p>' +
            '</div>';
        }
        return;
      }

      /* 子 Tab：概览 / 消耗排行 / ... */
      var subBtn = e.target.closest('[data-tab]');
      if (subBtn) {
        var tab = subBtn.dataset.tab;
        page.querySelectorAll('.hm-admin-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.tab === tab);
        });
        switchSubTab(tab);
        return;
      }
    });

    /* 账号管理：新增人员 + 筛选 + 审批操作（事件委托，列表重绘后依然有效） */
    page.addEventListener('click', function (e) {
      var createBtn = e.target.closest('[data-accopen="create"]');
      if (createBtn) { openAccCreateModal(); return; }
      var filterBtn = e.target.closest('[data-accfilter]');
      if (filterBtn) {
        accountFilter = filterBtn.dataset.accfilter || 'all';
        rerenderAccountRows();
        return;
      }
      var actionBtn = e.target.closest('[data-accmd]');
      if (actionBtn && !actionBtn.disabled) {
        handleAccountAction(actionBtn.dataset.uid, actionBtn.dataset.accmd);
      }
    });

    /* 新注册申请提醒弹框 */
    var noticeModal = document.getElementById('hmApplyNoticeModal');
    var noticeLater = document.getElementById('hmApplyNoticeLater');
    var noticeClose = document.getElementById('hmApplyNoticeClose');
    var noticeGo = document.getElementById('hmApplyNoticeGo');
    if (noticeLater) noticeLater.addEventListener('click', dismissApplyNotice);
    if (noticeClose) noticeClose.addEventListener('click', dismissApplyNotice);
    if (noticeModal) noticeModal.addEventListener('click', function (e) { if (e.target === noticeModal) dismissApplyNotice(); });
    if (noticeGo) noticeGo.addEventListener('click', function () {
      dismissApplyNotice();
      currentTopTab = 'admin';
      window.HM_ADMIN_TARGET = null;
      var tabsWrap = document.getElementById('adminSubTabs');
      if (tabsWrap) tabsWrap.style.display = '';
      switchSubTab('accounts');
    });

    /* 页面内 Esc 不应该退出到桌面 —— 让 desk.js 等自己处理 */
  }

  /* ============ Tab 切换加载 ============ */
  function switchSubTab(tab) {
    currentSubTab = tab;
    loadTab(tab);
  }

  /* ============ onView 钩子 —— switchView('admin') 时触发 ============ */
  var _origOnView = A.onView;
  A.onView = function (view) {
    if (_origOnView) _origOnView(view);
    if (view === 'admin') {
      if (!eventsBound) bindAdminEvents();
      /* 非超管看不到「账号管理」入口；若残留指向该 Tab，回落到概览 */
      syncAccountsVisibility();
      if (!isAdmin() && currentSubTab === 'accounts') currentSubTab = 'overview';
      /* 重置 Tab 状态；顶栏「API接入管理」入口可通过 HM_ADMIN_TARGET 指定落地 Tab */
      var target = window.HM_ADMIN_TARGET || 'admin';
      window.HM_ADMIN_TARGET = null;
      if (window.HM_ADMIN_SUBTAB) {
        currentSubTab = window.HM_ADMIN_SUBTAB;
        window.HM_ADMIN_SUBTAB = null;
      }
      currentTopTab = target;
      refreshPendingBadge();
      var page = document.getElementById('view-admin');
      if (page) {
        page.querySelectorAll('.hm-admin-top-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.top === target);
        });
        page.querySelectorAll('.hm-admin-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.tab === currentSubTab);
        });
      }
      var subTabsWrap = document.getElementById('adminSubTabs');
      var adminBody = document.getElementById('adminBody');
      destroyAllCharts();
      if (target === 'api') {
        if (subTabsWrap) subTabsWrap.style.display = 'none';
        if (adminBody) renderApiPanel(adminBody);
        return;
      }
      if (subTabsWrap) subTabsWrap.style.display = '';
      /* 延迟一帧确保 DOM 可见后再渲染（Chart.js 需要 canvas 有尺寸） */
      requestAnimationFrame(function () {
        loadTab(currentSubTab);
      });
    } else {
      /* 离开管理台 —— 销毁所有 Chart 实例 */
      destroyAllCharts();
    }
  };

  function destroyAllCharts() {
    Object.keys(charts).forEach(function (k) {
      if (charts[k]) { try { charts[k].destroy(); } catch (e) {} }
    });
    charts = {};
  }

  var loadSeq = 0;

  function loadTab(tab) {
    /* 当前不在「管理台」顶 Tab 时不要渲染，否则会把「API接入管理」等面板覆盖成加载中/仪表盘 */
    if (currentTopTab !== 'admin') return;
    destroyAllCharts();
    var body = document.getElementById('adminBody');
    if (!body) return;
    var seq = ++loadSeq;
    body.innerHTML = '<div class="hm-admin-loading"><span>加载中…</span></div>';

    var apiMap = {
      overview: HM.api.admin.overview,
      ranking:  HM.api.admin.ranking,
      logs:     HM.api.admin.logs,
      accounts: function () { return HM.api.listUsers(); },
      projects: HM.api.admin.projects,
    };
    var fn = apiMap[tab];
    if (!fn) { body.innerHTML = '<p>Tab 未实现</p>'; return; }

    fn().then(function (data) {
      if (seq !== loadSeq || currentTopTab !== 'admin') return;
      body.innerHTML = '';
      var renderers = { overview: renderOverview, ranking: renderRanking,
                        logs: renderLogs, accounts: renderAccounts, projects: renderProjects };
      if (renderers[tab]) renderers[tab](data, body);
    }).catch(function (err) {
      if (seq !== loadSeq || currentTopTab !== 'admin') return;
      body.innerHTML = '<div class="hm-admin-error">' +
        '<h3>加载失败</h3><p>' + (err && err.message ? err.message : String(err)) + '</p></div>';
    });
  }

  /* ============ 概览 Dashboard ============ */
  function renderOverview(data, body) {
    /* 顶部统计卡 */
    var c = data.cards;
    var cardHtml = [
      ['活跃账号', c.activeAccounts + '/' + c.totalAccounts, '👥'],
      ['生成作品数', fmt(c.totalWorks), '🎨'],
      ['总请求数', fmt(c.totalRequests), '⚡'],
      ['本月消耗', '¥' + fmt(c.monthCost), '💳'],
      ['总消耗', '¥' + fmt(c.totalCost), '💰'],
      ['API 消耗', '¥' + fmt(c.apiCost), '🔌'],
      ['平均耗时', c.avgLatency + 's', '⏱️'],
    ].map(function (x) {
      return '<div class="hm-card">' +
        '<div class="hm-card-ico">' + x[2] + '</div>' +
        '<div class="hm-card-body"><strong>' + x[1] + '</strong><span>' + x[0] + '</span></div>' +
        '</div>';
    }).join('');

    /* 费用环形图 */
    var ringHtml = '<div class="hm-admin-panel">' +
      '<div class="hm-admin-panel-head"><h3>费用概览</h3><span>当前周期</span></div>' +
      '<div class="hm-admin-ring-wrap"><canvas id="costRing" width="260" height="260"></canvas>' +
      '<div class="hm-admin-ring-total"><span>¥</span><strong>' + fmt(c.totalCost) + '</strong></div>' +
      '<ul class="hm-admin-ring-legend">' +
      data.costBreakdown.map(function (x, i) {
        return '<li><i style="background:' + RING_COLORS[i % RING_COLORS.length] + '"></i>' +
          '<span>' + x.name + '</span><b>' + x.value + '%</b></li>';
      }).join('') +
      '</ul></div></div>';

    /* 成本条形图 */
    var barHtml = '<div class="hm-admin-panel">' +
      '<div class="hm-admin-panel-head"><h3>成本统计</h3><span>Top 8 模型</span></div>' +
      '<canvas id="costBar" height="200"></canvas></div>';

    /* 趋势折线图 */
    var lineHtml = '<div class="hm-admin-panel hm-admin-panel-wide">' +
      '<div class="hm-admin-panel-head"><h3>趋势分析</h3>' +
      '<div class="hm-admin-legend-btns">' +
        '<button class="hm-admin-legend-btn is-active" data-trend="works">生成量</button>' +
        '<button class="hm-admin-legend-btn is-active" data-trend="cost">消耗</button>' +
      '</div></div>' +
      '<canvas id="trendLine" height="180"></canvas></div>';

    /* API 成本 Top 列表 */
    var apiTopHtml = '<div class="hm-admin-panel">' +
      '<div class="hm-admin-panel-head"><h3>API 成本 Top</h3></div>' +
      '<ul class="hm-admin-top-list">' +
      data.apiTop.map(function (x, i) {
        return '<li><em>#' + (i + 1) + '</em><span class="hm-admin-top-name">' + x.name + '</span>' +
          '<b>¥' + fmt(x.cost) + '</b><small>' + fmt(x.calls) + ' 次</small></li>';
      }).join('') +
      '</ul></div>';

    /* 模型使用 Top 列表 */
    var modelTopHtml = '<div class="hm-admin-panel">' +
      '<div class="hm-admin-panel-head"><h3>模型使用 Top</h3></div>' +
      '<ul class="hm-admin-top-list hm-admin-top-list-share">' +
      data.modelTop.map(function (x, i) {
        return '<li><em>#' + (i + 1) + '</em><span class="hm-admin-top-name">' + x.name + '</span>' +
          '<div class="hm-admin-share-bar"><i style="width:' + x.share + '%"></i></div>' +
          '<b>' + x.share + '%</b></li>';
      }).join('') +
      '</ul></div>';

    body.innerHTML = [
      '<div class="hm-admin-cards">' + cardHtml + '</div>',
      '<div class="hm-admin-row">',
        ringHtml,
        barHtml,
      '</div>',
      '<div class="hm-admin-row">',
        apiTopHtml,
        lineHtml,
        modelTopHtml,
      '</div>',
    ].join('');

    /* 初始化 Chart 图表 */
    setTimeout(function () {
      drawCostRing(data.costBreakdown);
      drawCostBar(data.modelCosts);
      drawTrendLine(data.days);
    }, 30);
  }

  var RING_COLORS = ['#6366f1', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899'];

  function drawCostRing(breakdown) {
    if (!window.Chart) return;
    var el = document.getElementById('costRing');
    if (!el) return;
    charts.costRing = new Chart(el.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: breakdown.map(function (x) { return x.name; }),
        datasets: [{
          data: breakdown.map(function (x) { return x.value; }),
          backgroundColor: RING_COLORS,
          borderWidth: 0,
          cutout: '72%',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
      },
    });
  }

  function drawCostBar(models) {
    if (!window.Chart) return;
    var el = document.getElementById('costBar');
    if (!el) return;
    charts.costBar = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: {
        labels: models.map(function (x) { return x.name.replace('Rayin', '').trim(); }),
        datasets: [{
          label: '成本 (¥)',
          data: models.map(function (x) { return x.cost; }),
          backgroundColor: '#22d3ee',
          borderRadius: 4,
        }, {
          label: '调用次数',
          data: models.map(function (x) { return x.calls; }),
          backgroundColor: '#6366f1',
          borderRadius: 4,
          yAxisID: 'y1',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8', maxRotation: 45 }, grid: { display: false } },
          y: { type: 'linear', position: 'left', ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
          y1: { type: 'linear', position: 'right', ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }

  function drawTrendLine(days) {
    if (!window.Chart) return;
    var el = document.getElementById('trendLine');
    if (!el) return;
    charts.trendLine = new Chart(el.getContext('2d'), {
      type: 'line',
      data: {
        labels: days.map(function (x) { return x.date; }),
        datasets: [{
          label: '生成量',
          data: days.map(function (x) { return x.works; }),
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.15)',
          fill: true, tension: 0.4, pointRadius: 2,
        }, {
          label: '消耗 (¥)',
          data: days.map(function (x) { return x.cost; }),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.15)',
          fill: true, tension: 0.4, pointRadius: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
        },
      },
    });
  }

  /* ============ 消耗排行 ============ */
  function renderRanking(data, body) {
    var rows = data.rows || [];
    var maxCost = rows.reduce(function (m, x) { return Math.max(m, x.cost); }, 1);
    body.innerHTML = [
      '<div class="hm-admin-panel hm-admin-panel-wide">',
        '<div class="hm-admin-panel-head"><h3>消耗排行</h3><span>Top ' + rows.length + ' 账号</span></div>',
        '<div class="hm-admin-rank-list">',
          rows.map(function (x) {
            var pct = Math.round(x.cost / maxCost * 100);
            return '<div class="hm-admin-rank-row">' +
              '<div class="hm-admin-rank-no">' + x.rank + '</div>' +
              '<div class="hm-admin-rank-name">' + x.name + '</div>' +
              '<div class="hm-admin-rank-bar-wrap">' +
                '<div class="hm-admin-rank-bar" style="width:' + pct + '%"></div>' +
              '</div>' +
              '<div class="hm-admin-rank-model"><span class="hm-pill">会员 M</span><span class="hm-pill is-free">Rayin API</span></div>' +
              '<div class="hm-admin-rank-cost">¥' + fmt(x.cost) + '</div>' +
              '<div class="hm-admin-rank-calls">' + fmt(x.calls) + ' 次</div>' +
            '</div>';
          }).join(''),
        '</div>',
      '</div>',
    ].join('');
  }

  /* ============ 调用日志 ============ */
  function renderLogs(data, body) {
    var rows = data.rows || [];
    var statusColor = { '成功': '#10b981', '失败': '#ef4444', '重试中': '#f59e0b' };
    body.innerHTML = [
      '<div class="hm-admin-panel hm-admin-panel-wide">',
        '<div class="hm-admin-panel-head"><h3>调用日志</h3><span>' + rows.length + ' 条记录</span></div>',
        '<div class="hm-admin-log-table-wrap">',
          '<table class="hm-admin-log-table">',
            '<thead><tr>' +
              '<th>时间</th><th>账号</th><th>模型</th><th>任务 ID</th>' +
              '<th>耗时</th><th>状态</th><th>Token</th><th>响应码</th><th>费用</th>' +
            '</tr></thead>',
            '<tbody>' +
              rows.map(function (x) {
                var t = new Date(x.createdAt);
                var timeStr = t.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').replace('T', ' ').slice(0, 19);
                return '<tr>' +
                  '<td class="hm-td-time">' + timeStr + '</td>' +
                  '<td class="hm-td-acc">' + x.account + '</td>' +
                  '<td class="hm-td-model">' + x.model + '</td>' +
                  '<td class="hm-td-code">' + x.taskId + '</td>' +
                  '<td>' + x.duration + 's</td>' +
                  '<td><span class="hm-td-status" style="color:' + statusColor[x.status] + '">' + x.status + '</span></td>' +
                  '<td>' + fmt(x.tokens) + '</td>' +
                  '<td class="hm-td-code">' + x.responseCode + '</td>' +
                  '<td>¥' + x.cost + '</td>' +
                '</tr>';
              }).join(''),
            '</tbody>',
          '</table>',
        '</div>',
      '</div>',
    ].join('');
  }

  /* ============ 账号管理（真实账号 + 注册审批） ============ */
  var accountCache = { users: [], pendingCount: 0 };
  var accountFilter = 'all';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(ms) {
    if (!ms) return '—';
    try {
      var d = new Date(Number(ms));
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return '—'; }
  }
  function statusText(s) { return s === 'pending' ? '待审批' : (s === 'rejected' ? '已拒绝' : '已通过'); }
  function currentUserId() {
    var u = (window.HMApp && window.HMApp.user) || {};
    return u.id || '';
  }

  function updatePendingBadge(count) {
    var badge = document.getElementById('accountsPendingBadge');
    if (!badge) return;
    var n = Number(count) || 0;
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      badge.hidden = true;
      badge.textContent = '0';
    }
  }

  function maybeShowApplyNotice(count) {
    var n = Number(count) || 0;
    if (!n) return;
    var dismissed = 0;
    try { dismissed = Number(sessionStorage.getItem('hm.applyNoticeDismissed') || 0); } catch (e) {}
    if (n <= dismissed) return;
    var modal = document.getElementById('hmApplyNoticeModal');
    var text = document.getElementById('hmApplyNoticeText');
    if (!modal) return;
    if (text) text.textContent = '有 ' + n + ' 个新账号正在等待审批，请及时处理。';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function dismissApplyNotice() {
    var modal = document.getElementById('hmApplyNoticeModal');
    if (modal) { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); }
    try { sessionStorage.setItem('hm.applyNoticeDismissed', String(accountCache.pendingCount || 0)); } catch (e) {}
  }

  function refreshPendingBadge() {
    if (!isAdmin() || !HM.api || typeof HM.api.pendingCount !== 'function') return;
    HM.api.pendingCount().then(function (res) {
      var count = (res && res.count) || 0;
      accountCache.pendingCount = count;
      updatePendingBadge(count);
      maybeShowApplyNotice(count);
    }).catch(function () {});
  }

  function accActions(u) {
    var self = currentUserId() && currentUserId() === u.id;
    var out = [];
    if (u.status === 'pending') {
      out.push('<button data-accmd="approve" data-uid="' + esc(u.id) + '" class="is-primary">通过</button>');
      out.push('<button data-accmd="reject" data-uid="' + esc(u.id) + '" class="is-danger">拒绝</button>');
    } else if (u.status === 'rejected') {
      out.push('<button data-accmd="approve" data-uid="' + esc(u.id) + '" class="is-primary">通过</button>');
    } else if (u.role === 'admin') {
      out.push('<button data-accmd="demote" data-uid="' + esc(u.id) + '"' + (self ? ' disabled' : '') + '>降为用户</button>');
    } else {
      out.push('<button data-accmd="promote" data-uid="' + esc(u.id) + '">设为超管</button>');
    }
    if (u.status !== 'pending') {
      out.push('<button data-accmd="reset" data-uid="' + esc(u.id) + '"' + (self ? ' disabled' : '') + '>重置密码</button>');
    }
    out.push('<button data-accmd="delete" data-uid="' + esc(u.id) + '" class="is-danger"' + (self ? ' disabled' : '') + '>删除</button>');
    return out.join('');
  }

  function renderAccountRows() {
    var users = accountCache.users || [];
    var counts = {
      all: users.length,
      pending: users.filter(function (u) { return u.status === 'pending'; }).length,
      approved: users.filter(function (u) { return u.status === 'approved'; }).length,
      rejected: users.filter(function (u) { return u.status === 'rejected'; }).length,
    };
    var shown = accountFilter === 'all' ? users : users.filter(function (u) { return u.status === accountFilter; });

    var filters = [
      ['all', '全部'], ['pending', '待审批'], ['approved', '已通过'], ['rejected', '已拒绝']
    ].map(function (f) {
      return '<button class="hm-acc-filter' + (accountFilter === f[0] ? ' is-active' : '') +
        '" data-accfilter="' + f[0] + '">' + f[1] + ' ' + counts[f[0]] + '</button>';
    }).join('');

    var rows = shown.map(function (u) {
      var initial = (u.username || '?').slice(0, 1).toUpperCase();
      var self = currentUserId() && currentUserId() === u.id;
      return '<div class="hm-acc-row">' +
        '<div class="hm-acc-avatar">' + esc(initial) + '</div>' +
        '<div class="hm-acc-info">' +
          '<div class="hm-acc-name">' + esc(u.username || '') +
            (self ? '<span class="hm-acc-pill is-admin">我</span>' : '') +
            '<span class="hm-acc-pill is-' + esc(u.status) + '">' + statusText(u.status) + '</span>' +
            '<span class="hm-acc-pill ' + (u.role === 'admin' ? 'is-admin' : 'is-user') + '">' +
              (u.role === 'admin' ? '超级管理员' : '普通用户') + '</span>' +
          '</div>' +
          '<div class="hm-acc-meta">' +
            '<span>ID：' + esc(u.id) + '</span>' +
            '<span>邮箱：' + esc(u.email || '—') + '</span>' +
            '<span>注册：' + fmtDate(u.createdAt) + '</span>' +
            (u.status === 'approved' && u.approvedAt ? '<span>通过：' + fmtDate(u.approvedAt) + '</span>' : '') +
            (u.note ? '<span>备注：' + esc(u.note) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="hm-acc-actions">' + accActions(u) + '</div>' +
      '</div>';
    }).join('');

    return '<div class="hm-acc-toolbar">' + filters + '</div>' +
      (rows ? '<div class="hm-acc-list">' + rows + '</div>' : '<div class="hm-acc-empty">暂无账号</div>');
  }

  function renderAccounts(data, body) {
    accountCache = {
      users: (data && data.users) || [],
      pendingCount: (data && data.pendingCount) || 0,
      storage: (data && data.storage) || '',
      storageLabel: (data && data.storageLabel) || '',
      storageWarning: (data && data.storageWarning) || '',
    };
    updatePendingBadge(accountCache.pendingCount);

    var storage = accountCache.storage;
    var isMysql = storage === 'mysql';
    var storageHtml = '';
    if (storage) {
      storageHtml =
        '<div class="hm-acc-storage ' + (isMysql ? 'is-mysql' : 'is-file') + '">' +
          '<span>账号存储：<b>' + esc(accountCache.storageLabel || (isMysql ? 'MySQL' : '文件存储')) + '</b></span>' +
          (isMysql ? '' : '<span class="hm-acc-storage-tip">' + esc(accountCache.storageWarning || '当前为文件存储，Render 重启可能丢失账号数据') + '</span>') +
          (!isMysql ? '<button data-accmd="migrate">同步文件账号入库</button>' : '') +
          '<button data-accmd="export"' + (!isMysql ? ' style="margin-left:8px"' : '') + '>导出 JSON 备份</button>' +
        '</div>';
    }

    body.innerHTML = [
      '<div class="hm-admin-panel hm-admin-panel-wide">',
        '<div class="hm-admin-panel-head"><h3>账号管理</h3>' +
          '<span style="font-size:12px;color:#8b94a6;margin-right:auto">账号由超级管理员创建，创建后可直接登录</span>' +
          '<button type="button" class="hm-acc-create" data-accopen="create">＋ 新增人员</button>' +
        '</div>',
        storageHtml,
        renderAccountRows(),
      '</div>',
    ].join('');
    maybeShowApplyNotice(accountCache.pendingCount);
  }

  function rerenderAccountRows() {
    if (currentSubTab !== 'accounts' || currentTopTab !== 'admin') return;
    var body = document.getElementById('adminBody');
    if (!body) return;
    renderAccounts(accountCache, body);
  }

  /* ---------- 新增人员：直接建号（approved，建完即可登录） ---------- */
  function accCreateError(msg) {
    var el = document.getElementById('accCreateError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function openAccCreateModal() {
    var modal = document.getElementById('hmAccountCreateModal');
    if (!modal) return;
    var u = document.getElementById('accNewUser');
    var p = document.getElementById('accNewPass');
    var r = document.getElementById('accNewRole');
    var n = document.getElementById('accNewNote');
    if (u) u.value = '';
    if (p) { p.value = ''; p.type = 'password'; }
    if (r) r.value = 'user';
    if (n) n.value = '';
    accCreateError('');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { if (u) u.focus(); }, 50);
  }

  function closeAccCreateModal() {
    var modal = document.getElementById('hmAccountCreateModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function genAccPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var buf = new Uint32Array(12);
    var hasCrypto = !!(window.crypto && typeof window.crypto.getRandomValues === 'function');
    if (hasCrypto) { try { window.crypto.getRandomValues(buf); } catch (e) { hasCrypto = false; } }
    var out = '';
    for (var i = 0; i < 12; i++) {
      var n = hasCrypto ? buf[i] : Math.floor(Math.random() * 4294967296);
      out += chars.charAt(n % chars.length);
    }
    /* 生成后切成明文，方便超管当场记下/复制给新同事 */
    var p = document.getElementById('accNewPass');
    if (p) { p.value = out; p.type = 'text'; }
    accCreateError('');
  }

  async function submitAccCreate() {
    var uEl = document.getElementById('accNewUser');
    var pEl = document.getElementById('accNewPass');
    var rEl = document.getElementById('accNewRole');
    var nEl = document.getElementById('accNewNote');
    var username = String((uEl && uEl.value) || '').trim();
    var password = (pEl && pEl.value) || '';
    var role = (rEl && rEl.value) === 'admin' ? 'admin' : 'user';
    var note = String((nEl && nEl.value) || '').trim();
    if (username.length < 3) { accCreateError('用户名至少 3 个字符'); return; }
    if (password.length < 6) { accCreateError('密码至少 6 个字符'); return; }
    if (!HM.api || typeof HM.api.createUser !== 'function') { accCreateError('接口未就绪，请刷新页面后重试'); return; }

    var btn = document.getElementById('accCreateSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '创建中…'; }
    accCreateError('');
    try {
      await HM.api.createUser(username, password, role, note);
      closeAccCreateModal();
      HM.toast && HM.toast('账号已创建，可直接登录', 'success');
      /* 刷新账号列表（筛选状态保持不变） */
      if (currentSubTab === 'accounts' && currentTopTab === 'admin') loadTab('accounts');
    } catch (err) {
      accCreateError((err && err.message) || '创建失败，请稍后重试');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '创建账号'; }
    }
  }

  function bindAccCreateModal() {
    if (bindAccCreateModal.bound) return;
    bindAccCreateModal.bound = true;
    var modal = document.getElementById('hmAccountCreateModal');
    if (!modal) return;
    var gen = document.getElementById('accGenPass');
    if (gen) gen.addEventListener('click', genAccPassword);
    var submit = document.getElementById('accCreateSubmit');
    if (submit) submit.addEventListener('click', submitAccCreate);
    ['accCreateClose', 'accCreateCancel'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', closeAccCreateModal);
    });
    modal.addEventListener('click', function (ev) { if (ev.target === modal) closeAccCreateModal(); });
  }

  /* 非超管：隐藏「账号管理」子 Tab 入口 */
  function syncAccountsVisibility() {
    var page = document.getElementById('view-admin');
    if (!page) return;
    var tab = page.querySelector('.hm-admin-tab[data-tab="accounts"]');
    if (tab) tab.hidden = !isAdmin();
  }

  function downloadJson(obj, filename) {
    try {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) {
      HM.toast && HM.toast('导出失败：' + e.message, 'error');
    }
  }

  async function handleAccountAction(uid, cmd) {
    var api = HM.api;
    if (!api) return;
    try {
      if (cmd === 'export') {
        var snapshot = await api.exportUsers();
        downloadJson(snapshot, 'huimeng-users-' + Date.now() + '.json');
        HM.toast && HM.toast('已导出账号备份 JSON', 'success');
        return;
      }
      if (cmd === 'migrate') {
        if (!window.confirm('把文件存储中的账号同步进 MySQL？已存在的账号不会被覆盖。')) return;
        var migrated = await api.migrateFileUsers();
        HM.toast && HM.toast('已同步 ' + ((migrated && migrated.migrated) || 0) + ' 个账号到 MySQL', 'success');
        loadTab('accounts');
        return;
      }
      if (cmd === 'approve') {
        await api.setUserStatus(uid, 'approved', '');
        HM.toast && HM.toast('已通过该注册申请', 'success');
      } else if (cmd === 'reject') {
        var note = window.prompt('拒绝原因（可选，可留空）：', '');
        if (note === null) return;
        await api.setUserStatus(uid, 'rejected', note || '');
        HM.toast && HM.toast('已拒绝该注册申请', 'success');
      } else if (cmd === 'promote') {
        if (!window.confirm('确定将该账号设为超级管理员？')) return;
        await api.setUserRole(uid, 'admin');
        HM.toast && HM.toast('已设为超级管理员', 'success');
      } else if (cmd === 'demote') {
        if (!window.confirm('确定将该超管降为普通用户？')) return;
        await api.setUserRole(uid, 'user');
        HM.toast && HM.toast('已降为普通用户', 'success');
      } else if (cmd === 'reset') {
        var pwd = window.prompt('请输入新密码（至少 6 位）：', '');
        if (!pwd) return;
        if (pwd.length < 6) { HM.toast && HM.toast('密码至少 6 位', 'info'); return; }
        await api.resetUserPassword(uid, pwd);
        HM.toast && HM.toast('密码已重置', 'success');
      } else if (cmd === 'delete') {
        if (!window.confirm('删除后该账号将无法登录，确定删除？')) return;
        await api.deleteUser(uid);
        HM.toast && HM.toast('账号已删除', 'success');
      }
      loadTab('accounts');
    } catch (err) {
      HM.toast && HM.toast((err && err.message) || '操作失败', 'error');
    }
  }

  /* ============ 项目管理 ============ */
  function renderProjects(data, body) {
    var projs = data.projects || [];
    body.innerHTML = [
      '<div class="hm-admin-panel hm-admin-panel-wide">',
        '<div class="hm-admin-panel-head"><h3>项目管理</h3>' +
          '<button class="hm-pill hm-pill-primary" style="padding:6px 14px">＋ 新建项目</button>' +
        '</div>',
        '<div class="hm-admin-project-grid">',
          projs.map(function (p) {
            var spentPct = Math.round(p.spent / Math.max(1, p.budget) * 100);
            var statusColor = { '进行中': '#10b981', '暂停': '#f59e0b', '已完成': '#64748b' }[p.status] || '#64748b';
            return '<div class="hm-admin-project-card">' +
              '<div class="hm-admin-project-top">' +
                '<strong>' + p.name + '</strong>' +
                '<span class="hm-admin-project-members">👥 ' + p.members + ' 人</span>' +
              '</div>' +
              '<div class="hm-admin-project-status" style="color:' + statusColor + '">' + p.status + ' · ' + p.phase + '</div>' +
              '<div class="hm-admin-project-budget">' +
                '<div class="hm-admin-project-budget-row">' +
                  '<span>预算</span><b>¥0</b><span>¥' + fmt(p.budget) + '</span>' +
                '</div>' +
                '<div class="hm-admin-mini-bar"><i style="width:' + Math.min(100, spentPct) + '%"></i></div>' +
              '</div>' +
              '<div class="hm-admin-project-footer">' +
                '<span>📋 成员管理</span>' +
                '<span>💰 预算配置</span>' +
                '<span>📤 导出数据</span>' +
              '</div>' +
              '<div class="hm-admin-project-spacer"></div>' +
              '<div class="hm-admin-project-notice" data-notice="' + p.id + '">⚠️ 额度用尽，点击继续充值</div>' +
            '</div>';
          }).join(''),
        '</div>',
      '</div>',
    ].join('');
  }

  function fmt(n) {
    if (typeof n !== 'number') return n || '';
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1) + 'k';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
  }

  /* ============ 导出到 window.HMUI ============ */
  A.openAdmin = openAdmin;
  A.closeAdmin = closeAdmin;
  A.openAccountAdmin = openAccountAdmin;
  A.refreshPendingBadge = refreshPendingBadge;
  A.isAdmin = isAdmin;
  A.adminLoaded = true;

  /* 自动在 HM.api 下注册 admin 接口（api.js 先于 admin.js 加载） */
  function ensureAdminApi() {
    if (!HM.api) return;
    if (!HM.api.admin) {
      HM.api.admin = {
        overview: function () { return HM.api.get('/admin/overview'); },
        ranking:  function () { return HM.api.get('/admin/ranking'); },
        logs:     function () { return HM.api.get('/admin/logs'); },
        accounts: function () { return HM.api.get('/admin/accounts'); },
        projects: function () { return HM.api.get('/admin/projects'); },
      };
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureAdminApi);
  } else {
    ensureAdminApi();
  }

  /* =========================================================
   * API接入管理 —— 可视化卡片面板
   * 数据源：HMApp.state.providers（anidream.providers.v1）
   *        HMApp.state.prefs 里 rayin 密钥（anidream.rayin.v1）
   *        HMApp.state.catalog.providers（后端 /catalog 下发的预设）
   * ========================================================= */

  var apiTestState = {}; // {providerId: 'ok' | 'fail' | 'loading'}

  function hmEsc(str) {
    return String(str == null ? '' : str).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function maskKey(key) {
    if (!key) return '未配置';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 3) + '••••••••' + key.slice(-4);
  }

  function getProviders() {
    var App = window.HMApp;
    if (!App) return [];
    var catalog = (App.state && App.state.catalog && App.state.catalog.providers) || [];
    var saved = (App.state && App.state.providers) || {};
    var list = catalog.map(function (p) {
      var s = saved[p.id] || {};
      return {
        id: p.id,
        name: p.name,
        base: s.base || p.base || '',
        key: s.key || '',
        model: s.model || (p.models && p.models[0] ? p.models[0].id : ''),
        enabled: p.id === (App.state && App.state.providerId) || !!s.key,
        preset: p
      };
    });
    // RayinAPI 单独一条
    var prefs = (App.state && App.state.prefs) || {};
    var rayinPrefs = prefs.rayin || {};
    list.push({
      id: '__rayin__',
      name: 'RayinAPI（GPT-image / Gemini Banana）',
      base: rayinPrefs.base || 'https://www.rayinai.com/v1',
      key: rayinPrefs.key || '',
      model: prefs.gptModel || 'gpt-image-2',
      model2: prefs.bananaModel || 'gemini-3.1-flash-image',
      enabled: !!rayinPrefs.key || true,
      isRayin: true
    });
    // 自定义已填但 catalog 里没有的
    Object.keys(saved).forEach(function (id) {
      if (id === '__rayin__') return;
      if (!list.find(function (p) { return p.id === id; })) {
        list.push({
          id: id, name: id,
          base: saved[id].base || '',
          key: saved[id].key || '',
          model: saved[id].model || '',
          enabled: !!saved[id].key,
          isCustom: true
        });
      }
    });
    return list;
  }

  function saveApiCard(id, base, key, model, model2, enabled) {
    var App = window.HMApp;
    if (!App) return;
    var prefs = App.state.prefs = App.state.prefs || {};
    var providers = App.state.providers = App.state.providers || {};

    if (id === '__rayin__') {
      prefs.rayin = prefs.rayin || {};
      prefs.rayin.base = base;
      prefs.rayin.key = key;
      prefs.gptModel = model;
      prefs.bananaModel = model2 || prefs.bananaModel;
      if (enabled) App.state.engine = 'gpt-image';
      // 持久化
      try { localStorage.setItem('anidream.rayin.v1', JSON.stringify(prefs.rayin)); } catch (e) {}
      try { localStorage.setItem('anidream.prefs.v1', JSON.stringify(prefs)); } catch (e) {}
    } else {
      providers[id] = { base: base, key: key, model: model };
      if (enabled) App.state.providerId = id;
      try { localStorage.setItem('anidream.providers.v1', JSON.stringify(providers)); } catch (e) {}
      try { localStorage.setItem('anidream.prefs.v1', JSON.stringify(prefs)); } catch (e) {}
    }
    if (App.toast) App.toast('已保存 ' + id, 'success');
  }

  function deleteApiCard(id) {
    var App = window.HMApp;
    if (!App) return;
    if (!confirm('确定删除这个 API 接入配置？密钥将从本地清除。')) return;
    if (id === '__rayin__') {
      try { localStorage.removeItem('anidream.rayin.v1'); } catch (e) {}
      App.state.prefs = App.state.prefs || {};
      App.state.prefs.rayin = { base: 'https://www.rayinai.com/v1', key: '' };
    } else {
      delete App.state.providers[id];
      try { localStorage.setItem('anidream.providers.v1', JSON.stringify(App.state.providers)); } catch (e) {}
      if (App.state.providerId === id) App.state.providerId = null;
    }
    if (App.toast) App.toast('已删除 ' + id, 'info');
    renderApiPanel(document.getElementById('adminBody'));
  }

  /* 简单 ping 测试（用 models endpoint 或 /v1/models） */
  function testApi(id, base, key) {
    var App = window.HMApp;
    if (!App || !base) return Promise.resolve({ ok: false, msg: '请先填接口地址' });
    var url = base.replace(/\/+$/, '') + '/models';
    var headers = key ? { 'Authorization': 'Bearer ' + key } : {};
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () { resolve({ ok: false, msg: '请求超时' }); }, 8000);
      fetch(url, { method: 'GET', headers: headers })
        .then(function (r) {
          clearTimeout(timeout);
          if (r.ok) return r.json();
          return r.text().then(function (txt) {
            try { var j = JSON.parse(txt); resolve({ ok: false, msg: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); }
            catch (e) { resolve({ ok: false, msg: 'HTTP ' + r.status }); }
          });
        })
        .then(function (data) {
          if (Array.isArray(data.data) && data.data.length) {
            resolve({ ok: true, msg: '连接成功 · ' + data.data.length + ' 个模型' });
          } else {
            resolve({ ok: true, msg: '连接成功' });
          }
        })
        .catch(function (err) {
          clearTimeout(timeout);
          resolve({ ok: false, msg: err.message || '网络错误' });
        });
    });
  }

  function apiCardHtml(p) {
    var state = apiTestState[p.id] || '';
    var stateHtml = '';
    if (state === 'loading') stateHtml = '<span class="hm-api-state is-testing"><i></i>测试中…</span>';
    else if (state === 'ok') stateHtml = '<span class="hm-api-state is-ok">● 在线</span>';
    else if (state === 'fail') stateHtml = '<span class="hm-api-state is-bad">● 离线</span>';
    else stateHtml = '<span class="hm-api-state is-idle">○ 未测试</span>';

    var keyMask = p._showKey ? hmEsc(p.key) : maskKey(p.key);
    var keyEye = p._showKey ? '👁‍🗨' : '👁';

    var extraField = '';
    if (p.isRayin) {
      extraField =
        '<label class="hm-api-field"><span>Gemini Banana 模型</span>' +
        '<input class="hm-api-input" data-ik="model2" value="' + hmEsc(p.model2 || '') + '" placeholder="gemini-3.1-flash-image"></label>';
    }

    return '<div class="hm-api-card" data-api="' + hmEsc(p.id) + '">' +
      '<div class="hm-api-card-head">' +
        '<div class="hm-api-card-title">' +
          '<span class="hm-api-card-dot" style="background:' + (p.isRayin ? '#a78bfa' : (p.preset && p.preset.color) || '#60a5fa') + '"></span>' +
          '<strong>' + hmEsc(p.name) + '</strong>' +
          (p.isCustom ? '<em class="hm-api-tag">自定义</em>' : '') +
        '</div>' +
        '<div class="hm-api-card-head-right">' +
          stateHtml +
          '<label class="hm-api-switch" title="启用/禁用">' +
            '<input type="checkbox" data-ik="enabled"' + (p.enabled ? ' checked' : '') + '>' +
            '<span></span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="hm-api-card-body">' +
        '<label class="hm-api-field"><span>接口地址</span>' +
          '<input class="hm-api-input" data-ik="base" value="' + hmEsc(p.base) + '" placeholder="https://.../v1"></label>' +
        '<label class="hm-api-field"><span>API Key</span>' +
          '<div class="hm-api-key-row">' +
            '<input class="hm-api-input" data-ik="key" type="' + (p._showKey ? 'text' : 'password') + '" value="' + hmEsc(p.key) + '" placeholder="sk-...">' +
            '<button class="hm-api-eye" data-eye title="显示/隐藏">' + keyEye + '</button>' +
          '</div></label>' +
        '<label class="hm-api-field"><span>' + (p.isRayin ? 'GPT-image 模型' : '默认模型 ID') + '</span>' +
          '<input class="hm-api-input" data-ik="model" value="' + hmEsc(p.model) + '" placeholder="..."></label>' +
        extraField +
      '</div>' +
      '<div class="hm-api-card-foot">' +
        '<div class="hm-api-foot-msg" data-msg></div>' +
        '<div class="hm-api-foot-btns">' +
          '<button class="hm-api-btn hm-api-btn-ghost" data-test>测试连接</button>' +
          '<button class="hm-api-btn hm-api-btn-primary" data-save>保存</button>' +
          (!p.preset && p.id !== '__rayin__' ? '<button class="hm-api-btn hm-api-btn-danger" data-del>删除</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderApiPanel(body) {
    var App = window.HMApp;
    if (!body || !App) return;
    var providers = getProviders();
    var total = providers.length;
    var enabledCount = providers.filter(function (p) { return p.enabled; }).length;

    /* ---- 读取调用日志 ---- */
    var apiLogs = [];
    try { apiLogs = JSON.parse(localStorage.getItem('anidream.api-logs.v1') || '[]'); } catch (e) {}
    var okCount = apiLogs.filter(function (l) { return l.status === 'ok'; }).length;
    var failCount = apiLogs.length - okCount;

    var html = '';
    html += '<div class="hm-admin-body hm-api-body">';
    html += '  <header class="hm-api-header">' +
      '    <div class="hm-api-header-stats">' +
      '      <div class="hm-api-stat"><strong>' + total + '</strong><small>接入总数</small></div>' +
      '      <div class="hm-api-stat"><strong>' + enabledCount + '</strong><small>已启用</small></div>' +
      '      <div class="hm-api-stat"><strong>' + (providers.filter(function (p) { return apiTestState[p.id] === 'ok'; }).length) + '</strong><small>在线</small></div>' +
      '      <div class="hm-api-stat"><strong>' + apiLogs.length + '</strong><small>累计调用</small></div>' +
      '    </div>' +
      '    <div class="hm-api-header-actions">' +
      '      <button class="hm-api-tool-btn" data-api-act="test-all">🔍 测试全部</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="export">📤 导出配置</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="import">📥 导入配置</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="add-custom">＋ 新增接入</button>' +
      '    </div>' +
      '  </header>';

    html += '  <section class="hm-api-sec">' +
      '    <h3 class="hm-api-sec-title"><span class="hm-api-sec-bar"></span>API 接入列表</h3>' +
      '    <div class="hm-api-grid">';
    providers.forEach(function (p) { html += apiCardHtml(p); });
    html += '    </div>' +
      '  </section>';

    html += '  <section class="hm-api-sec">' +
      '    <h3 class="hm-api-sec-title"><span class="hm-api-sec-bar"></span>调用日志 <span class="hm-api-sec-sub">成功 ' + okCount + ' · 失败 ' + failCount + ' · 最多保留 500 条</span></h3>' +
      '    <div class="hm-api-log-actions">' +
      '      <button class="hm-api-tool-btn small" data-log-act="clear">🗑 清空日志</button>' +
      '      <button class="hm-api-tool-btn small" data-log-act="export">📤 导出日志 CSV</button>' +
      '    </div>';

    if (!apiLogs.length) {
      html += '<div class="hm-api-log-empty">' +
        '<div class="hm-api-log-empty-ico">📡</div>' +
        '<p>还没有调用记录</p>' +
        '<small>在「生成」页出图成功或失败后会自动写日志</small>' +
        '</div>';
    } else {
      html += '<div class="hm-api-log-wrap"><table class="hm-api-log-table"><thead><tr>' +
        '<th>时间</th><th>状态</th><th>Provider</th><th>模型</th><th>耗时</th><th>提示词</th><th>错误</th>' +
        '</tr></thead><tbody>';
      apiLogs.slice(0, 200).forEach(function (l) { html += logRowHtml(l); });
      html += '</tbody></table></div>';
      if (apiLogs.length > 200) html += '<p class="hm-api-log-more">仅显示最近 200 条（共 ' + apiLogs.length + '）</p>';
    }
    html += '  </section>';

    html += '  <p class="hm-api-footer">密钥仅保存在本浏览器（localStorage），不会上传服务器。调用日志同样仅本地，可随时清空。</p>';
    html += '</div>';

    body.innerHTML = html;
    bindApiPanel(body);
  }

  function logRowHtml(l) {
    var d = new Date(l.ts);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    var dateStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm + ':' + ss;
    var statusClass = l.status === 'ok' ? 'is-ok' : 'is-fail';
    var statusIcon = l.status === 'ok' ? '✓' : '✗';
    var provider = hmEsc(l.provider || '');
    var model = hmEsc(l.model || '');
    var latency = (l.latencyMs != null ? Math.round(l.latencyMs) + ' ms' : '—');
    var prompt = hmEsc((l.promptPreview || '').slice(0, 55));
    var err = hmEsc((l.errorMsg || '').slice(0, 60));
    return '<tr class="' + statusClass + '">' +
      '<td class="hm-api-log-ts">' + dateStr + '</td>' +
      '<td class="hm-api-log-status ' + statusClass + '">' + statusIcon + '</td>' +
      '<td class="hm-api-log-provider">' + provider + '</td>' +
      '<td class="hm-api-log-model">' + model + '</td>' +
      '<td class="hm-api-log-latency">' + latency + '</td>' +
      '<td class="hm-api-log-prompt" title="' + hmEsc(l.promptPreview || '') + '">' + prompt + '</td>' +
      '<td class="hm-api-log-err" title="' + hmEsc(l.errorMsg || '') + '">' + err + '</td>' +
      '</tr>';
  }

  function bindApiPanel(body) {
    if (!body) return;

    /* 全局按钮 */
    body.addEventListener('click', function (e) {
      var tool = e.target.closest('[data-api-act]');
      if (tool) {
        var act = tool.dataset.apiAct;
        var providers = getProviders();
        if (act === 'test-all') {
          providers.forEach(function (p) { testAndUpdate(p.id); });
        } else if (act === 'export') {
          var data = { providers: (window.HMApp.state && window.HMApp.state.providers) || {} };
          data.rayin = (window.HMApp.state && window.HMApp.state.prefs && window.HMApp.state.prefs.rayin) || {};
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'anidream-api-config.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        } else if (act === 'import') {
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'application/json';
          inp.onchange = function () {
            var f = inp.files && inp.files[0]; if (!f) return;
            var r = new FileReader();
            r.onload = function () {
              try {
                var j = JSON.parse(r.result);
                var App = window.HMApp;
                if (j.providers) {
                  App.state.providers = j.providers;
                  try { localStorage.setItem('anidream.providers.v1', JSON.stringify(j.providers)); } catch (e) {}
                }
                if (j.rayin) {
                  App.state.prefs = App.state.prefs || {};
                  App.state.prefs.rayin = j.rayin;
                  try { localStorage.setItem('anidream.rayin.v1', JSON.stringify(j.rayin)); } catch (e) {}
                }
                if (App.toast) App.toast('导入成功', 'success');
                renderApiPanel(document.getElementById('adminBody'));
              } catch (err) { if (window.HMApp.toast) window.HMApp.toast('导入失败：' + err.message, 'error'); }
            };
            r.readAsText(f);
          };
          inp.click();
        } else if (act === 'add-custom') {
          var id = prompt('请输入新接入的唯一 ID（例如 my-provider）', 'custom-' + Date.now());
          if (!id) return;
          var App = window.HMApp;
          App.state.providers = App.state.providers || {};
          App.state.providers[id] = { base: '', key: '', model: '' };
          try { localStorage.setItem('anidream.providers.v1', JSON.stringify(App.state.providers)); } catch (e) {}
          renderApiPanel(document.getElementById('adminBody'));
        }
        return;
      }

      /* 调用日志操作 */
      var logActBtn = e.target.closest('[data-log-act]');
      if (logActBtn) {
        var logAct = logActBtn.dataset.logAct;
        if (logAct === 'clear') {
          if (!confirm('确定清空所有调用日志？（最多保留 500 条，清空后不可恢复）')) return;
          try { localStorage.removeItem('anidream.api-logs.v1'); } catch (e) {}
          if (window.HMApp && HMApp.toast) HMApp.toast('日志已清空', 'info');
        } else if (logAct === 'export') {
          try {
            var list = JSON.parse(localStorage.getItem('anidream.api-logs.v1') || '[]');
            var bom = '\ufeff';
            var csv = bom + 'ts,date,status,provider,endpoint,model,latencyMs,promptPreview,errorMsg,jobId\n';
            list.forEach(function (l) {
              var row = [
                l.ts || '',
                new Date(l.ts || 0).toISOString(),
                l.status || '',
                '"' + String(l.provider || '').replace(/"/g, '""') + '"',
                l.endpoint || '',
                '"' + String(l.model || '').replace(/"/g, '""') + '"',
                l.latencyMs || '',
                '"' + String(l.promptPreview || '').replace(/"/g, '""') + '"',
                '"' + String(l.errorMsg || '').replace(/"/g, '""') + '"',
                l.jobId || ''
              ].join(',');
              csv += row + '\n';
            });
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'anidream-api-logs.csv';
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          } catch (err) {
            if (window.HMApp && HMApp.toast) HMApp.toast('导出失败：' + err.message, 'error');
          }
        }
        renderApiPanel(document.getElementById('adminBody'));
        return;
      }

      /* 卡内按钮 */
      var card = e.target.closest('.hm-api-card');
      if (!card) return;
      var id = card.dataset.api;
      var p = getProviders().find(function (x) { return x.id === id; });
      if (!p) return;

      if (e.target.closest('[data-eye]')) {
        p._showKey = !p._showKey;
        renderApiPanel(document.getElementById('adminBody'));
        return;
      }
      if (e.target.closest('[data-test]')) {
        testAndUpdate(id);
        return;
      }
      if (e.target.closest('[data-save]')) {
        saveFromCard(card, p);
        return;
      }
      if (e.target.closest('[data-del]')) {
        deleteApiCard(id);
        return;
      }
    });
  }

  function saveFromCard(card, p) {
    var inputs = card.querySelectorAll('[data-ik]');
    var payload = { base: p.base, key: p.key, model: p.model, model2: p.model2, enabled: p.enabled };
    inputs.forEach(function (el) {
      var k = el.dataset.ik;
      if (k === 'enabled') payload.enabled = el.checked;
      else payload[k] = el.value.trim();
    });
    saveApiCard(p.id, payload.base, payload.key, payload.model, payload.model2, payload.enabled);
  }

  function testAndUpdate(id) {
    var p = getProviders().find(function (x) { return x.id === id; });
    if (!p) return;
    apiTestState[id] = 'loading';
    var card = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-msg]');
    if (card) card.textContent = '连接测试中…';
    renderApiPanel(document.getElementById('adminBody'));

    var base = p.base;
    var key = p.key;
    testApi(id, base, key).then(function (res) {
      apiTestState[id] = res.ok ? 'ok' : 'fail';
      var c = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-msg]');
      if (c) { c.textContent = res.msg; c.className = 'hm-api-foot-msg ' + (res.ok ? 'is-ok' : 'is-bad'); }
      /* 只更新状态灯，不重渲染（避免输入框丢失焦点） */
      var stateEl = document.querySelector('.hm-api-card[data-api="' + id + '"] .hm-api-state');
      if (stateEl) {
        stateEl.className = 'hm-api-state is-' + (res.ok ? 'ok' : 'bad');
        stateEl.textContent = (res.ok ? '● 在线' : '● 离线');
      }
    });
  }

  /* 全局暴露 */
  window.HMAdmin = { open: openAdmin, close: closeAdmin, isAdmin: isAdmin };
})();


(function bindAvatarToggle() {
  var btn = document.getElementById('avatarToggle');
  if (!btn) return;
  /* 页面加载时不自动挂载形象 / AI 语音浮层，统一由顶栏「虚拟形象」按钮按需创建 */
  window.MIKU_CHAT_NO_AUTO = true;
  function widgetEl() { return document.getElementById('vinyl-widget'); }
  function sync() {
    var el = widgetEl();
    var r = el ? el.getBoundingClientRect() : null;
    var on = !!(el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none' && r && r.width > 0 && r.height > 0);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function ensure() {
    if (!widgetEl() && window.MikuPlayer && !window.__HM_MIKU_MOUNTED) {
      try { window.MikuPlayer.init(); window.__HM_MIKU_MOUNTED = true; } catch (e) {}
    }
    if (window.MikuChat && !window.__HM_MIKU_CHAT) {
      try { window.MikuChat.init({ anchor: '#vinyl-widget' }); window.__HM_MIKU_CHAT = true; } catch (e) {}
    }
  }
  btn.addEventListener('click', function () {
    var before = widgetEl();
    if (!before) {
      /* 首次点击：按需挂载并直接显示 */
      ensure();
      var fresh = widgetEl();
      if (fresh) fresh.style.display = 'block';
      setTimeout(sync, 60);
      return;
    }
    var hidden = before.style.display === 'none' || getComputedStyle(before).display === 'none';
    before.style.display = hidden ? 'block' : 'none';
    if (hidden) {
      var ball = document.getElementById('mini-ball');
      if (ball) ball.style.display = 'none';
    }
    sync();
  });
  window.addEventListener('load', function () { setTimeout(sync, 400); });
})();

(function () {
  var KEY = 'anidream.compile.v1';
  var view = document.getElementById('view-compile');
  if (!view) return;
  var listEl = document.getElementById('cmpList');

  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(d) ? d : []; }
    catch (e) { return []; }
  }
  var data = load();
  var pending = {};
  window.HMCloudReload = window.HMCloudReload || {};
  window.HMCloudReload.compile = function () { data = load(); try { render(); } catch (e) {} };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { alert('保存失败：本机存储空间不足（文件过大时请改用下载链接）'); }
    if (window.HMSync && window.HMSync.pushDoc) window.HMSync.pushDoc('compile', data);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(ts) {
    var d = new Date(ts || Date.now());
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function findEp(id) {
    for (var i = 0; i < data.length; i++) if (data[i].id === id) return data[i];
    return null;
  }

  function verHtml(ep, v) {
    var sub = [v.ver, v.desc, fmt(v.ts)].filter(Boolean).join(' · ');
    var dl = v.url
      ? '<a class="cmp-btn" href="' + esc(v.url) + '" download="' + esc(v.fileName || v.name) + '">下载</a>'
      : '<span class="cmp-btn is-disabled">下载</span>';
    return '<div class="cmp-ver' + (v.adopted ? ' is-adopted' : '') + '">' +
      '<div class="cmp-ver-main"><div class="cmp-ver-name">' + esc(v.name) +
        (v.adopted ? '<span class="cmp-tag">采用</span>' : '') + '</div>' +
        '<div class="cmp-ver-sub">' + esc(sub) + '</div></div>' +
      '<div class="cmp-ver-ops">' +
        (v.adopted ? '<button class="cmp-btn" disabled>已采用</button>'
                   : '<button class="cmp-btn is-primary" data-cmp="adopt" data-ver="' + v.id + '">设为采用</button>') +
        dl +
        '<button class="cmp-btn is-danger" data-cmp="del-ver" data-ver="' + v.id + '">删除</button>' +
      '</div></div>';
  }

  function epHtml(ep) {
    var adopted = null;
    ep.versions.forEach(function (v) { if (v.adopted) adopted = v; });
    var body = ep.versions.length
      ? ep.versions.map(function (v) { return verHtml(ep, v); }).join('')
      : '<div class="cmp-empty">本集还没有导出版本</div>';
    return '<section class="cmp-ep" data-ep="' + ep.id + '">' +
      '<header class="cmp-ep-head"><div><b>' + esc(ep.title) + '</b>' +
        '<span class="cmp-ep-sub">' + ep.versions.length + ' 个版本 · ' +
        (adopted ? '采用：' + esc(adopted.name) : '未标记采用') + '</span></div>' +
        '<button class="cmp-btn is-danger" data-cmp="del-ep">删除本集</button></header>' +
      '<div class="cmp-vers">' + body + '</div>' +
      '<div class="cmp-add">' +
        '<input class="cmp-input cmp-grow" data-f="name" placeholder="版本名称（必填，如：第 1 话 最终版）">' +
        '<input class="cmp-input" data-f="ver" placeholder="版本号 / 时间" style="width:130px">' +
        '<input class="cmp-input cmp-grow" data-f="url" placeholder="下载链接（可选，http/https）">' +
        '<input class="cmp-input cmp-grow" data-f="desc" placeholder="说明（可选）">' +
        '<label class="cmp-btn cmp-file"><span>选择文件</span><input type="file" data-f="file" hidden></label>' +
        '<button class="cmp-btn is-primary" data-cmp="add-ver">＋ 添加版本</button>' +
      '</div></section>';
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = data.length
      ? data.map(epHtml).join('')
      : '<div class="cmp-empty">还没有「集」，先在右上角输入集名并点击「＋ 新建集」。</div>';
  }

  view.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cmp]');
    if (!btn) return;
    var act = btn.getAttribute('data-cmp');
    var card = btn.closest('[data-ep]');
    var ep = card ? findEp(card.getAttribute('data-ep')) : null;

    if (act === 'add-ep') {
      var inp = document.getElementById('cmpEpInput');
      var title = (inp && inp.value || '').trim();
      if (!title) { alert('请先填写集名'); if (inp) inp.focus(); return; }
      data.push({ id: uid(), title: title, versions: [] });
      save(); render();
      if (inp) inp.value = '';
      return;
    }
    if (!ep) return;
    if (act === 'del-ep') {
      if (!confirm('删除「' + ep.title + '」及其全部版本？')) return;
      data = data.filter(function (x) { return x.id !== ep.id; });
      save(); render(); return;
    }
    if (act === 'del-ver') {
      var vid = btn.getAttribute('data-ver');
      ep.versions = ep.versions.filter(function (v) { return v.id !== vid; });
      save(); render(); return;
    }
    if (act === 'adopt') {
      var aid = btn.getAttribute('data-ver');
      ep.versions.forEach(function (v) { v.adopted = (v.id === aid); });
      save(); render(); return;
    }
    if (act === 'add-ver') {
      var get = function (k) {
        var el = card.querySelector('[data-f="' + k + '"]');
        return el ? String(el.value || '').trim() : '';
      };
      var name = get('name');
      if (!name) { alert('请填写版本名称'); return; }
      var p = pending[ep.id];
      ep.versions.push({
        id: uid(), name: name, ver: get('ver'), desc: get('desc'),
        url: get('url') || (p ? p.data : ''), fileName: p ? p.name : '',
        ts: Date.now(), adopted: ep.versions.length === 0
      });
      delete pending[ep.id];
      save(); render();
    }
  });

  view.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || input.getAttribute('data-f') !== 'file') return;
    var card = input.closest('[data-ep]');
    if (!card) return;
    var epId = card.getAttribute('data-ep');
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 1.5 * 1024 * 1024) {
      alert('文件超过 1.5MB，本机存储放不下，请改用下载链接');
      input.value = '';
      return;
    }
    var rd = new FileReader();
    rd.onload = function () {
      pending[epId] = { name: f.name, data: rd.result };
      var label = input.closest('label');
      var span = label && label.querySelector('span');
      if (span) { span.textContent = '✓ ' + f.name; label.title = f.name; }
    };
    rd.readAsDataURL(f);
  });

  render();
  new MutationObserver(function () {
    if (document.body.getAttribute('data-view') === 'compile') render();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
})();


  /* ===================== 宣发（发布任务 · 平台记录 · 数据看板） ===================== */
  (function () {
    var KEY = 'anidream.publish.v1';
    var PLATFORMS = [
      { id: 'bilibili', name: 'B站' },
      { id: 'douyin', name: '抖音' },
      { id: 'kuaishou', name: '快手' },
      { id: 'xiaohongshu', name: '小红书' },
      { id: 'youtube', name: 'YouTube' }
    ];
    var STATUS = { todo: '待发', done: '已发', fail: '失败' };
    var view = document.getElementById('view-publish');
    if (!view) return;

    var db = load();
    var editingId = null;
    var pendingFile = null;
    window.HMCloudReload = window.HMCloudReload || {};
    window.HMCloudReload.publish = function () {
      db = load();
      try { renderTasks(); } catch (e) {}
      try { renderBoard(); } catch (e) {}
    };

    function $(id) { return document.getElementById(id); }

    function load() {
      try {
        var data = JSON.parse(localStorage.getItem(KEY) || '{}');
        return {
          tasks: (Array.isArray(data.tasks) ? data.tasks : []).map(normalize),
          metrics: Array.isArray(data.metrics) ? data.metrics : []
        };
      } catch (err) { return { tasks: [], metrics: [] }; }
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (err) {}
      if (window.HMSync && window.HMSync.pushDoc) window.HMSync.pushDoc('publish', db);
    }
    function uid(prefix) {
      return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    function esc(text) {
      return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    }
    function platName(id) {
      for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].id === id) return PLATFORMS[i].name;
      return id;
    }
    function chipClass(st) {
      return st === 'done' ? 'is-done' : (st === 'fail' ? 'is-fail' : '');
    }
    function fmtSize(n) {
      n = Number(n) || 0;
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
      return n + ' B';
    }
    function fmtPlan(v) { return v ? String(v).replace('T', ' ') : '未设置'; }
    function fmtTime(v) {
      if (!v) return '';
      var d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function num(id) { return Math.max(0, Number($(id).value) || 0); }
    function toast(msg) {
      if (window.A && typeof window.A.toast === 'function') window.A.toast(msg, 'success');
    }

    /* ---------------- 发布任务 ---------------- */
    function taskOf(id) {
      for (var i = 0; i < db.tasks.length; i++) if (db.tasks[i].id === id) return db.tasks[i];
      return null;
    }
    function normalize(t) {
      t.platforms = Array.isArray(t.platforms) ? t.platforms : [];
      t.links = t.links || {};
      t.pstatus = t.pstatus || {};
      t.publishedAt = t.publishedAt || {};
      t.status = t.status || 'todo';
      return t;
    }

    function platformRows(t) {
      if (!t.platforms.length) return '<div class="pub-meta">未选择平台</div>';
      return t.platforms.map(function (pid) {
        var st = t.pstatus[pid] || t.status || 'todo';
        var at = t.publishedAt[pid];
        return '<div class="pub-plat">' +
          '<span>' + esc(platName(pid)) + '</span>' +
          '<span class="pub-chip ' + chipClass(st) + '">' + STATUS[st] + '</span>' +
          '<span class="pub-meta">' + esc(at ? fmtTime(at) : '未发布') + '</span>' +
          '<input class="cmp-input" data-pub-link="1" data-task="' + t.id + '" data-plat="' + pid + '" placeholder="发布链接" value="' + esc(t.links[pid] || '') + '">' +
          '<button type="button" class="pub-btn" data-pub-copy="1" data-task="' + t.id + '" data-plat="' + pid + '">复制</button>' +
          '<button type="button" class="pub-btn" data-pub-done="1" data-task="' + t.id + '" data-plat="' + pid + '">标记已发布</button>' +
          '</div>';
      }).join('');
    }

    function taskMeta(t) {
      var bits = ['计划 ' + esc(fmtPlan(t.planAt))];
      if (t.file && t.file.name) bits.push('成片 ' + esc(t.file.name) + ' · ' + fmtSize(t.file.size));
      if (t.desc) bits.push(esc(t.desc));
      return bits.join(' ｜ ');
    }

    function renderTasks() {
      var box = $('pubTasks');
      if (!db.tasks.length) {
        box.innerHTML = '<div class="pub-empty">暂无发布任务，先在上方新建一条</div>';
        return;
      }
      box.innerHTML = db.tasks.map(function (t) {
        var opts = ['todo', 'done', 'fail'].map(function (k) {
          return '<option value="' + k + '"' + (t.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>';
        }).join('');
        return '<div class="pub-card">' +
          '<div class="pub-card-head">' +
            '<span class="pub-card-title">' + esc(t.ep || '未命名剧集') + ' · ' + esc(t.title || '未命名任务') + '</span>' +
            '<select class="cmp-input" data-pub-status="1" data-task="' + t.id + '" style="width:82px;height:26px">' + opts + '</select>' +
            '<button type="button" class="pub-btn" data-pub-edit="1" data-task="' + t.id + '">编辑</button>' +
            '<button type="button" class="pub-btn is-danger" data-pub-del="1" data-task="' + t.id + '">删除</button>' +
          '</div>' +
          '<div class="pub-meta">' + taskMeta(t) + '</div>' +
          platformRows(t) +
          '</div>';
      }).join('');
    }

    function resetForm() {
      editingId = null;
      pendingFile = null;
      $('pubEp').value = '';
      $('pubTitle').value = '';
      $('pubPlan').value = '';
      $('pubDesc').value = '';
      $('pubFileName').value = '';
      $('pubFile').value = '';
      view.querySelectorAll('#pubPlatforms input[type="checkbox"]').forEach(function (el) { el.checked = false; });
      $('pubSave').textContent = '＋ 新建任务';
      $('pubCancel').hidden = true;
    }

    function saveTask() {
      var ep = $('pubEp').value.trim();
      var title = $('pubTitle').value.trim();
      var platforms = [];
      view.querySelectorAll('#pubPlatforms input[type="checkbox"]').forEach(function (el) {
        if (el.checked) platforms.push(el.value);
      });
      if (!ep && !title) { toast('请填写剧集或标题'); return; }
      if (!platforms.length) { toast('请至少选择一个平台'); return; }

      if (editingId) {
        var t = taskOf(editingId);
        if (t) {
          t.ep = ep; t.title = title;
          t.planAt = $('pubPlan').value;
          t.desc = $('pubDesc').value.trim();
          t.platforms = platforms;
          if (pendingFile) t.file = pendingFile;
          save();
        }
      } else {
        db.tasks.unshift(normalize({
          id: uid('task'),
          ep: ep,
          title: title,
          planAt: $('pubPlan').value,
          desc: $('pubDesc').value.trim(),
          platforms: platforms,
          file: pendingFile || null,
          status: 'todo',
          createdAt: Date.now()
        }));
        save();
      }
      var wasEditing = !!editingId;
      resetForm();
      renderTasks();
      renderRecords();
      toast(wasEditing ? '已保存' : '已新建任务');
    }

    function editTask(id) {
      var t = taskOf(id);
      if (!t) return;
      editingId = id;
      pendingFile = null;
      $('pubEp').value = t.ep || '';
      $('pubTitle').value = t.title || '';
      $('pubPlan').value = t.planAt || '';
      $('pubDesc').value = t.desc || '';
      $('pubFileName').value = t.file && t.file.name ? t.file.name + ' · ' + fmtSize(t.file.size) : '';
      view.querySelectorAll('#pubPlatforms input[type="checkbox"]').forEach(function (el) {
        el.checked = t.platforms.indexOf(el.value) >= 0;
      });
      $('pubSave').textContent = '保存修改';
      $('pubCancel').hidden = false;
      $('pubEp').focus();
    }

    function delTask(id) {
      if (!window.confirm('删除这条发布任务及其平台记录？')) return;
      db.tasks = db.tasks.filter(function (t) { return t.id !== id; });
      save();
      if (editingId === id) resetForm();
      renderTasks();
      renderRecords();
    }

    /* ---------------- 平台记录 ---------------- */
    function renderRecords() {
      var box = $('pubRecords');
      var rows = [];
      db.tasks.forEach(function (t) {
        if (!t.platforms.length) return;
        rows.push('<div class="pub-card">' +
          '<div class="pub-card-head"><span class="pub-card-title">' + esc(t.ep || '未命名剧集') + ' · ' + esc(t.title || '未命名任务') + '</span>' +
          '<span class="pub-meta">计划 ' + esc(fmtPlan(t.planAt)) + '</span></div>' +
          platformRows(t) + '</div>');
      });
      box.innerHTML = rows.length ? rows.join('') : '<div class="pub-empty">还没有平台记录，先到「发布任务」新建任务并选择平台</div>';
    }

    function copyText(text) {
      if (!text) { toast('链接为空'); return; }
      var done = function () { toast('已复制'); };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (err) {}
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    }

    function markDone(taskId, pid) {
      var t = taskOf(taskId);
      if (!t) return;
      t.pstatus[pid] = 'done';
      t.publishedAt[pid] = new Date().toISOString();
      var allDone = t.platforms.every(function (p) { return t.pstatus[p] === 'done'; });
      if (allDone) t.status = 'done';
      save();
      renderTasks();
      renderRecords();
      toast('已标记为已发布');
    }

    /* ---------------- 数据看板 ---------------- */
    function fillSelect(sel, items, allLabel, keepValue) {
      var cur = keepValue ? sel.value : '';
      var html = allLabel ? '<option value="">' + allLabel + '</option>' : '';
      html += items.map(function (it) {
        return '<option value="' + esc(it.value) + '">' + esc(it.label) + '</option>';
      }).join('');
      sel.innerHTML = html;
      if (cur) sel.value = cur;
    }

    function distinctEps() {
      var seen = {}, out = [];
      db.metrics.forEach(function (m) {
        if (m.ep && !seen[m.ep]) { seen[m.ep] = 1; out.push({ value: m.ep, label: m.ep }); }
      });
      db.tasks.forEach(function (t) {
        if (t.ep && !seen[t.ep]) { seen[t.ep] = 1; out.push({ value: t.ep, label: t.ep }); }
      });
      return out;
    }

    function filteredMetrics() {
      var ep = $('pubFEp').value;
      var pf = $('pubFPlatform').value;
      var range = $('pubFRange').value;
      var now = Date.now();
      return db.metrics.filter(function (m) {
        if (ep && m.ep !== ep) return false;
        if (pf && m.platform !== pf) return false;
        if (range !== 'all') {
          var t = m.date ? new Date(m.date + 'T00:00:00').getTime() : 0;
          if (!t || t < now - Number(range) * 86400000) return false;
        }
        return true;
      }).sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    }

    function zeroSum() { return { views: 0, likes: 0, comments: 0, favs: 0, shares: 0, last: '' }; }
    function addTo(sum, m) {
      sum.views += Number(m.views) || 0;
      sum.likes += Number(m.likes) || 0;
      sum.comments += Number(m.comments) || 0;
      sum.favs += Number(m.favs) || 0;
      sum.shares += Number(m.shares) || 0;
      if (m.date && m.date > sum.last) sum.last = m.date;
      return sum;
    }
    function sumAll(list) {
      return list.reduce(function (s, m) { return addTo(s, m); }, zeroSum());
    }
    function groupBy(list, keyFn) {
      var order = [], map = {};
      list.forEach(function (m) {
        var k = keyFn(m);
        if (!map[k]) { map[k] = zeroSum(); order.push(k); }
        addTo(map[k], m);
      });
      return { order: order, map: map };
    }
    function sumTable(group, label) {
      if (!group.order.length) return '<div class="pub-empty">暂无数据</div>';
      var rows = group.order.map(function (k) {
        var s = group.map[k];
        return '<tr><td>' + esc(k) + '</td><td>' + s.views.toLocaleString() + '</td><td>' + s.likes.toLocaleString() + '</td>' +
          '<td>' + s.comments.toLocaleString() + '</td><td>' + s.favs.toLocaleString() + '</td><td>' + s.shares.toLocaleString() + '</td>' +
          '<td>' + esc(s.last || '-') + '</td></tr>';
      }).join('');
      return '<table class="pub-table"><thead><tr><th>' + esc(label) + '</th><th>播放量</th><th>点赞</th><th>评论</th><th>收藏</th><th>分享</th><th>最近更新</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function renderBoard() {
      fillSelect($('pubFEp'), distinctEps(), '全部剧集', true);
      fillSelect($('pubFPlatform'), PLATFORMS.map(function (p) { return { value: p.id, label: p.name }; }), '全部平台', true);

      var list = filteredMetrics();
      var total = sumAll(list);
      $('pubSum').innerHTML = '<table class="pub-table"><thead><tr><th>范围</th><th>播放量</th><th>点赞</th><th>评论</th><th>收藏</th><th>分享</th><th>最近更新</th></tr></thead><tbody>' +
        '<tr><td>总计</td><td>' + total.views.toLocaleString() + '</td><td>' + total.likes.toLocaleString() + '</td><td>' + total.comments.toLocaleString() + '</td>' +
        '<td>' + total.favs.toLocaleString() + '</td><td>' + total.shares.toLocaleString() + '</td><td>' + esc(total.last || '-') + '</td></tr>' +
        '</tbody></table>';

      $('pubByPlatform').innerHTML = sumTable(groupBy(list, function (m) { return platName(m.platform); }), '平台');
      $('pubByEp').innerHTML = sumTable(groupBy(list, function (m) { return m.ep || '未标注'; }), '剧集');

      $('pubMetrics').innerHTML = list.length ? ('<table class="pub-table"><thead><tr><th>日期</th><th>平台</th><th>剧集</th><th>播放量</th><th>点赞</th><th>评论</th><th>收藏</th><th>分享</th></tr></thead><tbody>' +
        list.map(function (m) {
          return '<tr><td>' + esc(m.date || '-') + '</td><td>' + esc(platName(m.platform)) + '</td><td>' + esc(m.ep || '-') + '</td>' +
            '<td>' + (Number(m.views) || 0).toLocaleString() + '</td><td>' + (Number(m.likes) || 0).toLocaleString() + '</td>' +
            '<td>' + (Number(m.comments) || 0).toLocaleString() + '</td><td>' + (Number(m.favs) || 0).toLocaleString() + '</td>' +
            '<td>' + (Number(m.shares) || 0).toLocaleString() + '</td></tr>';
        }).join('') + '</tbody></table>') : '<div class="pub-empty">暂无录入数据</div>';
    }

    function addMetric() {
      var m = {
        id: uid('m'), platform: $('pubMPlatform').value, ep: $('pubMEp').value.trim(),
        date: $('pubMDate').value, views: num('pubMViews'), likes: num('pubMLikes'),
        comments: num('pubMComments'), favs: num('pubMFavs'), shares: num('pubMShares')
      };
      if (!m.platform || !m.date) { toast('请选择平台与日期'); return; }
      db.metrics.unshift(m);
      save();
      $('pubMEp').value = '';
      $('pubMViews').value = ''; $('pubMLikes').value = ''; $('pubMComments').value = '';
      $('pubMFavs').value = ''; $('pubMShares').value = '';
      renderBoard();
      toast('已录入');
    }

    /* ---------------- 交互 ---------------- */
    function switchTab(name) {
      view.querySelectorAll('[data-pub-tab]').forEach(function (el) {
        el.classList.toggle('hm-pill-primary', el.getAttribute('data-pub-tab') === name);
      });
      view.querySelectorAll('[data-pub-panel]').forEach(function (el) {
        el.hidden = el.getAttribute('data-pub-panel') !== name;
      });
      if (name === 'board') renderBoard();
      if (name === 'records') renderRecords();
    }

    function onClick(event) {
      var tab = event.target.closest('[data-pub-tab]');
      if (tab) { switchTab(tab.getAttribute('data-pub-tab')); return; }
      if (event.target.closest('#pubFileBtn')) { $('pubFile').click(); return; }
      if (event.target.closest('#pubSave')) { saveTask(); return; }
      if (event.target.closest('#pubCancel')) { resetForm(); return; }
      if (event.target.closest('#pubMAdd')) { addMetric(); return; }

      var edit = event.target.closest('[data-pub-edit]');
      if (edit) { editTask(edit.getAttribute('data-task')); return; }
      var del = event.target.closest('[data-pub-del]');
      if (del) { delTask(del.getAttribute('data-task')); return; }
      var copy = event.target.closest('[data-pub-copy]');
      if (copy) {
        var t1 = taskOf(copy.getAttribute('data-task'));
        if (t1) copyText(t1.links[copy.getAttribute('data-plat')] || '');
        return;
      }
      var done = event.target.closest('[data-pub-done]');
      if (done) { markDone(done.getAttribute('data-task'), done.getAttribute('data-plat')); return; }
    }

    function onChange(event) {
      var el = event.target;
      if (el.id === 'pubFile') {
        var f = el.files && el.files[0];
        pendingFile = f ? { name: f.name, size: f.size } : null;
        $('pubFileName').value = f ? f.name + ' · ' + fmtSize(f.size) : '';
        return;
      }
      var st = el.closest('[data-pub-status]');
      if (st) {
        var t = taskOf(st.getAttribute('data-task'));
        if (t) { t.status = st.value; save(); renderTasks(); renderRecords(); }
        return;
      }
      var link = el.closest('[data-pub-link]');
      if (link) {
        var task = taskOf(link.getAttribute('data-task'));
        if (task) { task.links[link.getAttribute('data-plat')] = link.value.trim(); save(); }
        return;
      }
      if (el.id === 'pubFEp' || el.id === 'pubFPlatform' || el.id === 'pubFRange') {
        renderBoard();
      }
    }

    function init() {
      $('pubPlatforms').innerHTML = PLATFORMS.map(function (p) {
        return '<label><input type="checkbox" value="' + p.id + '">' + p.name + '</label>';
      }).join('');
      fillSelect($('pubMPlatform'), PLATFORMS.map(function (p) { return { value: p.id, label: p.name }; }));
      $('pubMDate').value = new Date().toISOString().slice(0, 10);
      view.addEventListener('click', onClick);
      view.addEventListener('change', onChange);
      renderTasks();
      renderRecords();
      renderBoard();
      new MutationObserver(function () {
        if (document.body.getAttribute('data-view') === 'publish') renderBoard();
      }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    }

    init();
  })();