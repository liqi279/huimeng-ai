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
    if (window.HMSettingsToggle && window.HMSettingsToggle.isOpen()) {
      window.HMSettingsToggle.exit();
      return;
    }
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
        /* 消耗日志已独立成页：设置里这一项只作入口，点击直接打开该页 */
        if (tab === 'usage') {
          currentSubTab = 'overview';
          page.querySelectorAll('.hm-admin-tab').forEach(function (t) {
            t.classList.toggle('is-active', t.dataset.tab === 'overview');
          });
          if (HM.switchView) HM.switchView('usage');
          return;
        }
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

    /* 调用日志：筛选 / 分页 / 401 重新登录 / 失败重试（事件委托，表格重绘后依然有效） */
    page.addEventListener('click', function (e) {
      if (e.target.closest('[data-logsubmit]')) {
        readLogFilters();
        logState.page = 1;
        renderLogsPage(document.getElementById('adminBody'));
        return;
      }
      if (e.target.closest('[data-logreset]')) {
        logState.status = ''; logState.model = ''; logState.user = ''; logState.q = '';
        logState.from = ''; logState.to = ''; logState.page = 1;
        renderLogsPage(document.getElementById('adminBody'));
        return;
      }
      if (e.target.closest('[data-logretry]')) { loadCallLogs(); return; }
      if (e.target.closest('[data-logsignin]')) {
        if (window.showLogin) window.showLogin();
        else HM.toast && HM.toast('请点击右上角头像登录管理员账号', 'info');
        return;
      }
      var pgBtn = e.target.closest('[data-logpage]');
      if (pgBtn && !pgBtn.disabled) {
        var dir = pgBtn.dataset.logpage;
        if (dir === 'prev' && logState.page > 1) logState.page -= 1;
        else if (dir === 'next' && logState.page < logState.pages) logState.page += 1;
        else return;
        loadCallLogs();
      }
    });
    page.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (!e.target.closest || !e.target.closest('.hm-log-toolbar')) return;
      e.preventDefault();
      readLogFilters();
      logState.page = 1;
      renderLogsPage(document.getElementById('adminBody'));
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
    if (view === 'usage') {
      renderUsageView();
      return;
    }
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

  /* ============ 消耗日志（与调用日志同一张 api_call_logs 表） ============ */
  function usageTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function usageKindLabel(kind) {
    return kind === 'video' ? '视频生成' : kind === 'audio' ? '音频合成'
      : kind === 'chat' ? 'AI 对话' : '桌面';
  }

  function usageRow(r) {
    var ok = r.rawStatus === 'ok';
    var sec = Number(r.duration) || 0;
    var durText = sec >= 60
      ? (Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's')
      : (Math.round(sec) + 's');
    return '<tr>' +
      '<td class="hm-usage-time">' + usageTime(r.createdAt) + '</td>' +
      '<td class="hm-usage-time">' + usageTime(r.finishedAt) + '</td>' +
      '<td>' + hmEsc(r.userId || '—') + '</td>' +
      '<td><b>' + hmEsc(r.model || '未标注模型') + '</b><small>' + hmEsc(usageKindLabel(r.kind)) + '</small></td>' +
      '<td><span class="hm-usage-status ' + (ok ? 'is-ok' : 'is-fail') + '">' + (ok ? '成功' : '失败') + '</span>' +
        '<small class="hm-usage-job">' + hmEsc(r.taskId || '') + '</small>' +
        (ok ? '' : '<small class="hm-usage-err">' + hmEsc(r.errorMsg || '—') + '</small>') +
      '</td>' +
      '<td class="hm-usage-dim">个人空间</td>' +
      '<td class="hm-usage-dim">' + usageKindLabel(r.kind) + '</td>' +
      '<td class="hm-usage-time">' + durText + '</td>' +
      '<td class="hm-usage-cost">⚡ ' + (Number(r.cost) || 0).toFixed(2) + '</td>' +
      '</tr>';
  }

  function renderUsageLogs(data, body) {
    var rows = (data && data.rows) || [];
    var okCount = rows.filter(function (r) { return r.rawStatus === 'ok'; }).length;
    var totalCost = rows.reduce(function (s, r) { return s + (Number(r.cost) || 0); }, 0);
    var html = '<div class="hm-admin-panel hm-usage-panel">' +
      '<div class="hm-admin-panel-head"><h3>消耗日志</h3>' +
      '<span>共 ' + rows.length + ' 条 · 成功 ' + okCount + ' · 合计 ⚡' + totalCost.toFixed(2) + '</span></div>';
    if (!rows.length) {
      html += '<div class="hm-admin-empty">还没有消耗记录：出图成功或失败后会自动写入这张表。</div>';
    } else {
      html += '<div class="hm-usage-wrap"><table class="hm-usage-table"><thead><tr>' +
        '<th>点击时间</th><th>结束时间</th><th>成员</th><th>模型</th><th>状态</th>' +
        '<th>项目</th><th>生成方式</th><th>耗时</th><th>消耗积分</th>' +
        '</tr></thead><tbody>';
      rows.slice(0, 200).forEach(function (r) { html += usageRow(r); });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function loadTab(tab) {
    /* 当前不在「管理台」顶 Tab 时不要渲染，否则会把「API接入管理」等面板覆盖成加载中/仪表盘 */
    if (currentTopTab !== 'admin') return;
    destroyAllCharts();
    var body = document.getElementById('adminBody');
    if (!body) return;
    var seq = ++loadSeq;
    if (tab === 'logs') { renderLogsPage(body); return; }
    body.innerHTML = '<div class="hm-admin-loading"><span>加载中…</span></div>';

    var apiMap = {
      overview: HM.api.admin.overview,
      ranking:  HM.api.admin.ranking,
      usage:    HM.api.admin.logs,
      accounts: function () { return HM.api.listUsers(); },
      projects: HM.api.admin.projects,
    };
    var fn = apiMap[tab];
    if (!fn) { body.innerHTML = '<p>Tab 未实现</p>'; return; }

    fn().then(function (data) {
      if (seq !== loadSeq || currentTopTab !== 'admin') return;
      body.innerHTML = '';
      var renderers = { overview: renderOverview, ranking: renderRanking,
                        usage: renderUsageLogs,
                        accounts: renderAccounts, projects: renderProjects };
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

  /* ============ 调用日志（真实接口 /admin/call-logs，兼容 /admin/logs） ============ */
  var logState = {
    page: 1, pageSize: 50, status: '', model: '', user: '', q: '', from: '', to: '',
    rows: [], total: 0, pages: 1, source: '', seq: 0
  };

  function logStatusOf(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    if (s === 'success' || s === 'ok' || s === '成功') return 'success';
    if (s === 'failed' || s === 'fail' || s === 'error' || s === '失败') return 'failed';
    return 'other';
  }

  function logTimeText(v) {
    if (v == null || v === '') return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function normalizeLogRow(x) {
    x = x || {};
    var raw = x.status != null ? x.status : x.state;
    var dur = x.duration != null ? Number(x.duration)
      : (x.latency != null ? Number(x.latency) : null);
    var durText = '—';
    if (dur != null && !isNaN(dur)) {
      durText = dur >= 1000 ? (dur / 1000).toFixed(1) + 's' : (Math.round(dur * 10) / 10) + 's';
    }
    var tokens = x.tokens != null ? Number(x.tokens) : (x.totalTokens != null ? Number(x.totalTokens) : null);
    var code = x.responseCode != null && x.responseCode !== '' ? x.responseCode
      : (x.statusCode != null ? x.statusCode : '');
    return {
      rawStatus: raw == null ? '' : String(raw),
      status: logStatusOf(raw),
      timeText: logTimeText(x.createdAt || x.created_at || x.time || x.timestamp),
      user: x.user || x.username || x.account || x.userId || x.accountId || '—',
      model: x.model || x.modelName || x.modelKey || '—',
      modelKey: x.modelKey || '',
      taskId: x.taskId || x.task_id || x.jobId || x.id || '—',
      durationText: durText,
      tokensText: tokens == null || isNaN(tokens) ? '—' : fmt(tokens),
      codeText: code === '' ? '—' : String(code),
      costText: (Number(x.cost) || 0).toFixed(2),
      error: x.error || x.errorMsg || x.errorMessage || ''
    };
  }

  function logQueryString() {
    var p = [];
    if (logState.from) p.push('from=' + encodeURIComponent(logState.from));
    if (logState.to) p.push('to=' + encodeURIComponent(logState.to));
    if (logState.status) p.push('status=' + encodeURIComponent(logState.status));
    if (logState.model) p.push('model=' + encodeURIComponent(logState.model));
    if (logState.user) p.push('user=' + encodeURIComponent(logState.user));
    if (logState.q) p.push('q=' + encodeURIComponent(logState.q));
    p.push('page=' + logState.page);
    p.push('pageSize=' + logState.pageSize);
    return p.join('&');
  }

  function logToolbarHtml() {
    function opt(v, label, cur) {
      return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
    }
    return '<div class="hm-log-toolbar">' +
      '<label>状态<select id="logStatus">' + opt('', '全部', logState.status) +
        opt('success', '成功', logState.status) + opt('failed', '失败', logState.status) + '</select></label>' +
      '<label>模型<input id="logModel" value="' + esc(logState.model) + '" placeholder="模型名"></label>' +
      '<label>用户<input id="logUser" value="' + esc(logState.user) + '" placeholder="用户"></label>' +
      '<label>关键词<input id="logQ" value="' + esc(logState.q) + '" placeholder="任务 / 错误"></label>' +
      '<label>起始<input id="logFrom" type="datetime-local" value="' + esc(logState.from) + '"></label>' +
      '<label>结束<input id="logTo" type="datetime-local" value="' + esc(logState.to) + '"></label>' +
      '<label>每页<select id="logPageSize">' +
        [20, 50, 100, 200].map(function (n) { return opt(String(n), n + ' 条', String(logState.pageSize)); }).join('') +
      '</select></label>' +
      '<button type="button" class="hm-log-btn is-primary" data-logsubmit>查询</button>' +
      '<button type="button" class="hm-log-btn" data-logreset>重置</button>' +
      '</div>';
  }

  function readLogFilters() {
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function iso(v) {
      if (!v) return '';
      var d = new Date(v);
      return isNaN(d.getTime()) ? v : d.toISOString();
    }
    logState.status = val('logStatus');
    logState.model = String(val('logModel') || '').trim();
    logState.user = String(val('logUser') || '').trim();
    logState.q = String(val('logQ') || '').trim();
    logState.from = iso(val('logFrom'));
    logState.to = iso(val('logTo'));
    var ps = Number(val('logPageSize'));
    logState.pageSize = ps > 0 ? Math.min(200, ps) : 50;
  }

  function renderLogsPage(body) {
    body = body || document.getElementById('adminBody');
    if (!body) return;
    body.innerHTML = logToolbarHtml() +
      '<div class="hm-admin-panel hm-admin-panel-wide">' +
        '<div class="hm-admin-panel-head"><h3>调用日志</h3><span id="logMeta">加载中…</span></div>' +
        '<div id="logTable"></div>' +
        '<div class="hm-log-pager" id="logPager"></div>' +
      '</div>';
    loadCallLogs();
  }

  function renderLogTable() {
    var wrap = document.getElementById('logTable');
    if (!wrap) return;
    var meta = document.getElementById('logMeta');
    if (meta) {
      meta.textContent = '共 ' + logState.total + ' 条 · 第 ' + logState.page + '/' + logState.pages + ' 页' +
        (logState.source === 'logs' ? '（兼容接口 /admin/logs）' : '');
    }
    if (!logState.rows.length) {
      wrap.innerHTML = '<div class="hm-admin-empty">当前筛选条件下没有调用记录。</div>';
      return;
    }
    var trs = logState.rows.map(function (r) {
      var cls = r.status === 'success' ? 'is-success' : (r.status === 'failed' ? 'is-failed' : '');
      var label = r.status === 'success' ? '成功' : (r.status === 'failed' ? '失败' : (r.rawStatus || '—'));
      return '<tr>' +
        '<td class="hm-td-time">' + esc(r.timeText) + '</td>' +
        '<td class="hm-td-acc">' + esc(r.user) + '</td>' +
        '<td class="hm-td-model">' + esc(r.model) +
          (r.modelKey && r.modelKey !== r.model ? '<span class="hm-log-src">' + esc(r.modelKey) + '</span>' : '') + '</td>' +
        '<td class="hm-td-code">' + esc(r.taskId) + '</td>' +
        '<td>' + esc(r.durationText) + '</td>' +
        '<td><span class="hm-log-state ' + cls + '">' + esc(label) + '</span>' +
          (r.error ? '<small class="hm-log-err-text" title="' + esc(r.error) + '">' + esc(r.error) + '</small>' : '') + '</td>' +
        '<td>' + esc(r.tokensText) + '</td>' +
        '<td class="hm-td-code">' + esc(r.codeText) + '</td>' +
        '<td>¥' + esc(r.costText) + '</td>' +
      '</tr>';
    }).join('');
    wrap.innerHTML = '<div class="hm-admin-log-table-wrap"><table class="hm-admin-log-table">' +
      '<thead><tr><th>时间</th><th>用户</th><th>模型</th><th>任务 ID</th><th>耗时</th>' +
      '<th>状态</th><th>Tokens</th><th>响应码</th><th>费用</th></tr></thead>' +
      '<tbody>' + trs + '</tbody></table></div>';
  }

  function renderLogPager() {
    var el = document.getElementById('logPager');
    if (!el) return;
    el.innerHTML = '<span>第 ' + logState.page + ' / ' + logState.pages + ' 页 · 共 ' + logState.total + ' 条</span>' +
      '<button type="button" class="hm-log-btn" data-logpage="prev"' + (logState.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button type="button" class="hm-log-btn" data-logpage="next"' + (logState.page >= logState.pages ? ' disabled' : '') + '>下一页</button>';
  }

  function applyLogData(data, source) {
    var rows = Array.isArray(data) ? data : ((data && (data.rows || data.items || data.list)) || []);
    var total = data && !Array.isArray(data) && data.total != null ? Number(data.total) : rows.length;
    var pages = data && !Array.isArray(data) && data.pages != null ? Number(data.pages) : 0;
    logState.source = source;
    logState.rows = rows.map(normalizeLogRow);
    logState.total = isNaN(total) ? rows.length : total;
    logState.pages = pages > 0 ? pages : Math.max(1, Math.ceil(logState.total / logState.pageSize));
    if (logState.page > logState.pages) logState.page = logState.pages;
    renderLogTable();
    renderLogPager();
  }

  function loadCallLogs() {
    var wrap = document.getElementById('logTable');
    if (!wrap) return;
    if (currentTopTab !== 'admin' || currentSubTab !== 'logs') return;
    var api = HM.api;
    if (!api) return;
    var seq = ++logState.seq;
    wrap.innerHTML = '<div class="hm-admin-loading"><span>加载中…</span></div>';
    var meta = document.getElementById('logMeta');
    if (meta) meta.textContent = '加载中…';
    var pager = document.getElementById('logPager');
    if (pager) pager.innerHTML = '';

    function stale() { return seq !== logState.seq; }

    function fail(err) {
      if (stale()) return;
      var status = Number(err && err.status || 0);
      var msg = (err && err.message) || String(err);
      var title = status === 401 ? '未登录或登录已过期（HTTP 401）' : '调用日志加载失败';
      var hint = status === 401
        ? '请用管理员账号重新登录；密码只在这里输入，不会写进代码或日志。'
        : (err && err.offline ? '无法连接后端服务，请检查网络后重试。' : '');
      wrap.innerHTML = '<div class="hm-admin-error">' +
        '<h3>' + esc(title) + '</h3>' +
        '<p>' + esc(msg) + '</p>' +
        (hint ? '<p class="hm-log-hint">' + esc(hint) + '</p>' : '') +
        '<div class="hm-log-err-actions">' +
          (status !== 401 ? '' : '<button type="button" class="hm-log-btn is-primary" data-logsignin>管理员登录</button>') +
          '<button type="button" class="hm-log-btn" data-logretry>重试</button>' +
        '</div>' +
      '</div>';
      if (meta) meta.textContent = status === 401 ? '未登录（401）' : '加载失败';
    }

    var primary = api.admin && api.admin.callLogs
      ? api.admin.callLogs(logQueryString())
      : Promise.reject(new Error('日志接口未注册'));
    primary.then(function (data) {
      if (stale()) return;
      applyLogData(data, 'call-logs');
    }).catch(function (err) {
      if (stale()) return;
      /* /admin/call-logs 不存在（404）时才退回旧表 /admin/logs；其余错误直接报出来 */
      if (Number(err && err.status) === 404 && api.admin && api.admin.legacyLogs) {
        api.admin.legacyLogs().then(function (data) {
          if (stale()) return;
          applyLogData(data, 'logs');
        }).catch(function (err2) {
          if (stale()) return;
          fail(Number(err2 && err2.status) === 404 ? err : err2);
        });
        return;
      }
      fail(err);
    });
  }

  /* ============ 消耗日志独立页（走同一真实接口，不造假数据） ============ */
  var usagePageState = {
    from: '', to: '', status: '', page: 1, pageSize: 50,
    total: 0, pages: 1, rows: [], source: '', seq: 0
  };

  function usagePageQueryString() {
    var p = [];
    if (usagePageState.from) p.push('from=' + encodeURIComponent(usagePageState.from));
    if (usagePageState.to) p.push('to=' + encodeURIComponent(usagePageState.to));
    if (usagePageState.status) p.push('status=' + encodeURIComponent(usagePageState.status));
    p.push('page=' + usagePageState.page);
    p.push('pageSize=' + usagePageState.pageSize);
    return p.join('&');
  }

  function usagePageFilterHtml() {
    function opt(v, label, cur) {
      return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
    }
    return '<label>起始<input id="usageFrom" type="datetime-local" value="' + esc(usagePageState.from) + '"></label>' +
      '<label>结束<input id="usageTo" type="datetime-local" value="' + esc(usagePageState.to) + '"></label>' +
      '<label>状态<select id="usageStatus">' + opt('', '全部', usagePageState.status) +
        opt('success', '成功', usagePageState.status) + opt('failed', '失败', usagePageState.status) + '</select></label>' +
      '<label>每页<select id="usagePageSize">' +
        [20, 50, 100, 200].map(function (n) { return opt(String(n), n + ' 条', String(usagePageState.pageSize)); }).join('') +
      '</select></label>' +
      '<button type="button" class="hm-log-btn is-primary" data-usage-submit>查询</button>' +
      '<button type="button" class="hm-log-btn" data-usage-reset>重置</button>';
  }

  function readUsageFilters() {
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function iso(v) {
      if (!v) return '';
      var d = new Date(v);
      return isNaN(d.getTime()) ? v : d.toISOString();
    }
    usagePageState.from = iso(val('usageFrom'));
    usagePageState.to = iso(val('usageTo'));
    usagePageState.status = val('usageStatus');
    var ps = Number(val('usagePageSize'));
    usagePageState.pageSize = ps > 0 ? Math.min(200, ps) : 50;
  }

  function usagePageStatsHtml() {
    var rows = usagePageState.rows;
    var ok = 0, fail = 0, cost = 0, tokens = 0, durSum = 0, durN = 0;
    rows.forEach(function (r) {
      if (r.status === 'success') ok += 1;
      else if (r.status === 'failed') fail += 1;
      cost += Number(r.costText) || 0;
      var t = parseFloat(String(r.tokensText).replace(/[^\d.]/g, ''));
      if (!isNaN(t)) tokens += t;
      var d = parseFloat(String(r.durationText).replace(/[^\d.]/g, ''));
      if (!isNaN(d)) { durSum += d; durN += 1; }
    });
    var avg = durN ? (durSum / durN) : 0;
    return '<div class="hm-usage-stat is-cost"><span>当前页消耗积分</span><strong>⚡ ' + cost.toFixed(2) + '</strong></div>' +
      '<div class="hm-usage-stat is-ok"><span>成功</span><strong>' + ok + '</strong></div>' +
      '<div class="hm-usage-stat is-fail"><span>失败</span><strong>' + fail + '</strong></div>' +
      '<div class="hm-usage-stat"><span>当前页 Tokens</span><strong>' + (tokens >= 10000 ? (tokens / 1000).toFixed(1) + 'k' : String(Math.round(tokens))) + '</strong></div>' +
      '<div class="hm-usage-stat"><span>平均耗时</span><strong>' + (durN ? avg.toFixed(1) + 's' : '—') + '</strong></div>';
  }

  function renderUsageTable() {
    var wrap = document.getElementById('usageList');
    if (!wrap) return;
    var stats = document.getElementById('usageStats');
    if (stats) stats.innerHTML = usagePageStatsHtml();
    var rows = usagePageState.rows;
    if (!rows.length) {
      wrap.innerHTML = '<div class="hm-admin-empty">当前筛选条件下没有消耗记录。</div>';
      return;
    }
    var trs = rows.map(function (r) {
      var cls = r.status === 'success' ? 'is-success' : (r.status === 'failed' ? 'is-failed' : '');
      var label = r.status === 'success' ? '成功' : (r.status === 'failed' ? '失败' : (r.rawStatus || '—'));
      return '<tr>' +
        '<td class="hm-td-time">' + esc(r.timeText) + '</td>' +
        '<td>' + esc(r.user) + '</td>' +
        '<td class="hm-td-model">' + esc(r.model) + '</td>' +
        '<td><span class="hm-log-state ' + cls + '">' + esc(label) + '</span></td>' +
        '<td>' + esc(r.durationText) + '</td>' +
        '<td>' + esc(r.tokensText) + '</td>' +
        '<td class="hm-td-code">' + esc(r.codeText) + '</td>' +
        '<td class="hm-usage-cost">⚡ ' + esc(r.costText) + '</td>' +
        '<td class="hm-td-code">' + esc(r.taskId) + '</td>' +
        '<td>' + (r.error ? '<small class="hm-log-err-text" title="' + esc(r.error) + '">' + esc(r.error) + '</small>' : '—') + '</td>' +
      '</tr>';
    }).join('');
    wrap.innerHTML = '<div class="hm-usage-wrap"><table class="hm-usage-log-table">' +
      '<thead><tr><th>时间</th><th>用户</th><th>模型</th><th>状态</th><th>耗时</th>' +
      '<th>Tokens</th><th>响应码</th><th>消耗积分</th><th>任务 ID</th><th>错误</th></tr></thead>' +
      '<tbody>' + trs + '</tbody></table></div>' +
      '<div class="hm-log-pager">' +
        '<span>第 ' + usagePageState.page + ' / ' + usagePageState.pages + ' 页 · 共 ' + usagePageState.total + ' 条' +
        (usagePageState.source === 'logs' ? '（兼容接口 /admin/logs）' : '') + '</span>' +
        '<button type="button" class="hm-log-btn" data-usage-page="prev"' + (usagePageState.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
        '<button type="button" class="hm-log-btn" data-usage-page="next"' + (usagePageState.page >= usagePageState.pages ? ' disabled' : '') + '>下一页</button>' +
      '</div>';
  }

  function loadUsagePage() {
    var wrap = document.getElementById('usageList');
    if (!wrap) return;
    var api = HM.api;
    if (!api) return;
    var seq = ++usagePageState.seq;
    wrap.innerHTML = '<div class="hm-admin-loading"><span>加载中…</span></div>';
    var stats = document.getElementById('usageStats');
    if (stats) stats.innerHTML = '';
    function stale() { return seq !== usagePageState.seq; }
    function fail(err) {
      if (stale()) return;
      var status = Number(err && err.status || 0);
      var title = status === 401 ? '未登录或登录已过期（HTTP 401）' : '消耗日志加载失败';
      var hint = status === 401
        ? '请用管理员账号重新登录；密码只在登录框输入，不会写进代码或日志。'
        : (err && err.offline ? '无法连接后端服务，请检查网络后重试。' : '');
      wrap.innerHTML = '<div class="hm-admin-error">' +
        '<h3>' + esc(title) + '</h3>' +
        '<p>' + esc((err && err.message) || String(err)) + '</p>' +
        (hint ? '<p class="hm-log-hint">' + esc(hint) + '</p>' : '') +
        '<div class="hm-log-err-actions">' +
          (status !== 401 ? '' : '<button type="button" class="hm-log-btn is-primary" data-usage-signin>管理员登录</button>') +
          '<button type="button" class="hm-log-btn" data-usage-retry>重试</button>' +
        '</div>' +
      '</div>';
      if (stats) stats.innerHTML = '';
    }
    function apply(data, source) {
      if (stale()) return;
      var rows = Array.isArray(data) ? data : ((data && (data.rows || data.items || data.list)) || []);
      var total = data && !Array.isArray(data) && data.total != null ? Number(data.total) : rows.length;
      var pages = data && !Array.isArray(data) && data.pages != null ? Number(data.pages) : 0;
      usagePageState.source = source;
      usagePageState.rows = rows.map(normalizeLogRow);
      usagePageState.total = isNaN(total) ? rows.length : total;
      usagePageState.pages = pages > 0 ? pages : Math.max(1, Math.ceil(usagePageState.total / usagePageState.pageSize));
      renderUsageTable();
    }
    var primary = api.admin && api.admin.callLogs
      ? api.admin.callLogs(usagePageQueryString())
      : Promise.reject(new Error('日志接口未注册'));
    primary.then(function (data) { apply(data, 'call-logs'); }).catch(function (err) {
      if (stale()) return;
      if (Number(err && err.status) === 404 && api.admin && api.admin.legacyLogs) {
        api.admin.legacyLogs().then(function (data) { apply(data, 'logs'); }).catch(function (err2) {
          if (stale()) return;
          fail(Number(err2 && err2.status) === 404 ? err : err2);
        });
        return;
      }
      fail(err);
    });
  }

  function renderUsageView() {
    var host = document.getElementById('usageFilter');
    if (host) host.innerHTML = usagePageFilterHtml();
    loadUsagePage();
  }

  (function bindUsagePageEvents() {
    document.addEventListener('click', function (e) {
      var page = document.getElementById('view-usage');
      if (!page || page.hidden) return;
      if (e.target.closest('[data-usage-refresh]')) { loadUsagePage(); return; }
      if (e.target.closest('[data-usage-submit]')) {
        readUsageFilters(); usagePageState.page = 1; loadUsagePage(); return;
      }
      if (e.target.closest('[data-usage-reset]')) {
        usagePageState.from = ''; usagePageState.to = ''; usagePageState.status = '';
        usagePageState.page = 1; renderUsageView(); return;
      }
      if (e.target.closest('[data-usage-retry]')) { loadUsagePage(); return; }
      if (e.target.closest('[data-usage-signin]')) {
        if (window.showLogin) window.showLogin();
        else HM.toast && HM.toast('请点击右上角头像登录管理员账号', 'info');
        return;
      }
      var pg = e.target.closest('[data-usage-page]');
      if (pg && !pg.disabled) {
        var dir = pg.dataset.usagePage;
        if (dir === 'prev' && usagePageState.page > 1) usagePageState.page -= 1;
        else if (dir === 'next' && usagePageState.page < usagePageState.pages) usagePageState.page += 1;
        else return;
        loadUsagePage();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var page = document.getElementById('view-usage');
      if (!page || page.hidden) return;
      if (!e.target.closest || !e.target.closest('#usageFilter')) return;
      e.preventDefault();
      readUsageFilters();
      usagePageState.page = 1;
      loadUsagePage();
    });
  })();

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
            var statusColor = { '进行中': '#ef4444', '暂停': '#ef4444', '已完成': '#10b981' }[p.status] || '#ef4444';
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
    /* 调用日志主接口（新表）+ 兼容接口（旧表） */
    HM.api.admin.callLogs = function (qs) {
      return HM.api.get('/admin/call-logs' + (qs ? '?' + qs : ''), 30000);
    };
    HM.api.admin.legacyLogs = function () {
      return HM.api.get('/admin/logs', 30000);
    };
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

  /* 类型筛选与平台下拉的当前选择（会话内保留，不写磁盘） */
  var API_TYPES = [
    { id: 'image', label: '生图' },
    { id: 'video', label: '生视频' },
    { id: 'chat', label: 'AI 对话' },
    { id: 'audio', label: '生音频' }
  ];
  var apiFilter = { platform: '', types: [], billing: '' };
  /* 调用日志的筛选：只按真实记录里出现过的平台/类型来筛 */
  var apiLogFilter = { platform: '', type: '' };
  var apiDocCache = null;

  /* 接入配置文档：providers / bindings / rayin，随 /docs/api 同步，换设备可恢复。
     旧数据只在本地 localStorage 时按需合并，不覆盖云端已有值。 */
  function getApiDoc() {
    if (apiDocCache) return apiDocCache;
    var doc = null;
    try { doc = JSON.parse(localStorage.getItem('anidream.api.v1') || 'null'); } catch (e) { doc = null; }
    if (!doc || typeof doc !== 'object') doc = {};
    if (!doc.providers || typeof doc.providers !== 'object') doc.providers = {};
    if (!doc.bindings || typeof doc.bindings !== 'object') doc.bindings = {};
    if (!doc.billing || typeof doc.billing !== 'object') doc.billing = {};
    if (!doc.rayin || typeof doc.rayin !== 'object') doc.rayin = {};
    /* Banana/Gemini 三个模型已下架：接入管理只保留 GPT-image 一张卡，历史 banana 配置清掉 */
    if (!doc.providers['__rayin__:gpt-image']) {
      var oldGpt = doc.providers['__rayin__'] || {};
      var oldBan = doc.providers['__rayin_banana__'] || {};
      var rb = oldGpt.base || oldBan.base || doc.rayin.base || 'https://www.rayinai.com/v1';
      var rk = oldGpt.key || oldBan.key || doc.rayin.key || '';
      var gpt = Object.assign({}, oldGpt);
      gpt.name = 'RayinAPI'; gpt.platform = '__rayin__'; gpt.series = 'GPT-image'; gpt.engine = 'gpt-image';
      gpt.base = oldGpt.base || rb; gpt.key = oldGpt.key || rk;
      var gptModel = String(oldGpt.model || doc.gptModel || '');
      gpt.model = /^gpt-image/i.test(gptModel) ? gptModel : 'gpt-image-2';
      gpt.model2 = '';
      doc.providers['__rayin__:gpt-image'] = gpt;
      if (doc.bindings['__rayin__'] != null) doc.bindings['__rayin__:gpt-image'] = doc.bindings['__rayin__'];
      if (doc.billing['__rayin__'] != null) doc.billing['__rayin__:gpt-image'] = doc.billing['__rayin__'];
    }
    /* 无论是否刚迁移，历史伪平台 id 与 Banana 配置一律清掉 */
    ['__rayin__', '__rayin__:banana', '__rayin_banana__'].forEach(function (pid) {
      delete doc.providers[pid];
      delete doc.bindings[pid];
      delete doc.billing[pid];
    });
    /* 接入管理只保留 RayinAPI：清掉其它平台的历史记录（不显示、不参与模型推导） */
    Object.keys(doc.providers).forEach(function (pid) {
      if (pid.indexOf('__rayin') !== 0) {
        delete doc.providers[pid];
        delete doc.bindings[pid];
        delete doc.billing[pid];
      }
    });
    doc.updatedAt = Number(doc.updatedAt) || 0;
    apiDocCache = doc;
    return doc;
  }
  function resetApiDoc() {
    apiDocCache = null;
    var body = document.getElementById('adminBody');
    if (body && body.querySelector('.hm-api-body')) renderApiPanel(body);
  }
  function apiBinding(id) {
    var v = getApiDoc().bindings[id];
    return API_TYPES.some(function (t) { return t.id === v; }) ? v : '';
  }
  function apiTypeLabel(t) {
    var hit = API_TYPES.filter(function (x) { return x.id === t; })[0];
    return hit ? hit.label : '';
  }
  function apiTypeOptionsHtml(selected) {
    var html = '<option value="">未分类</option>';
    API_TYPES.forEach(function (t) {
      html += '<option value="' + t.id + '"' + (t.id === selected ? ' selected' : '') + '>' + t.label + '</option>';
    });
    return html;
  }

  /* 计费方式：每条接入记录一个值，未选择时为「未绑定」，不默认归到免费或收费 */
  var API_BILLING = [
    { id: 'free', label: '免费' },
    { id: 'paid', label: '收费' }
  ];
  function apiBilling(id) {
    var v = getApiDoc().billing[id];
    return v === 'free' || v === 'paid' ? v : '';
  }
  function apiBillingLabel(v) { return v === 'free' ? '免费' : (v === 'paid' ? '收费' : '未绑定'); }
  function apiBillingKey(p) { return p.billing === 'free' || p.billing === 'paid' ? p.billing : 'unbound'; }
  function apiBillingOptionsHtml(selected) {
    var html = '<option value="">未绑定</option>';
    API_BILLING.forEach(function (b) {
      html += '<option value="' + b.id + '"' + (b.id === selected ? ' selected' : '') + '>' + b.label + '</option>';
    });
    return html;
  }
  function apiBillingFilterOptionsHtml(selected) {
    var html = '<option value="">全部计费</option><option value="unbound"' + (selected === 'unbound' ? ' selected' : '') + '>未绑定</option>';
    API_BILLING.forEach(function (b) {
      html += '<option value="' + b.id + '"' + (b.id === selected ? ' selected' : '') + '>' + b.label + '</option>';
    });
    return html;
  }
  function apiBillingBadgeHtml(v) {
    return v === 'free' ? '<span class="hm-api-billing-badge is-free">免费</span>'
      : (v === 'paid' ? '<span class="hm-api-billing-badge is-paid">收费</span>'
        : '<span class="hm-api-billing-badge is-none">未绑定</span>');
  }

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
    var doc = getApiDoc();
    /* 接入管理只保留 RayinAPI：catalog.providers 不再参与（第三方平台预设已删），
       本地旧平台配置也不再回显，只保留 GPT-image 一条接入（Banana/Gemini 已下架） */
    var list = [];
    var prefs = (App.state && App.state.prefs) || {};
    var gptRec = doc.providers['__rayin__:gpt-image'] || {};
    var rayinModels = (App.state && App.state.catalog && App.state.catalog.rayin) || [];
    list.push({
      id: '__rayin__:gpt-image',
      platform: '__rayin__',
      platformName: 'RayinAPI',
      name: 'RayinAPI',
      series: 'GPT-image',
      base: gptRec.base || 'https://www.rayinai.com/v1',
      key: gptRec.key || '',
      model: gptRec.model || doc.gptModel || prefs.gptModel || 'gpt-image-2',
      models: rayinModels.filter(function (m) { return m.engine === 'gpt-image'; }),
      enabled: true,
      isRayin: true,
      rayinVariant: 'gpt',
      type: apiBinding('__rayin__:gpt-image'),
      billing: apiBilling('__rayin__:gpt-image')
    });
    // 自定义已填但 catalog 里没有的
    /* 非 Rayin 的历史配置一律不再展示（读盘时已过滤，这里再兜一层） */
    return list;
  }

  /* 一条接入记录对应的模型列表：Rayin 用后端 catalog 的全量模型，
     其他平台用配置里保存的模型，保证表格里每个模型都属于当前平台。 */
  function apiModelsOf(p) {
    var out = [];
    var seen = {};
    function push(id, name, configured) {
      id = String(id || '').trim();
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, name: name || id, configured: !!configured });
    }
    (p.models || []).forEach(function (m) {
      push(m.id || m.model, m.name || m.id || m.model, p.isRayin ? (m.id === p.model || m.id === p.model2) : ((m.id || m.model) === p.model));
    });
    if (p.isRayin) {
      push(p.model, p.model, true);
      push(p.model2, p.model2, true);
    } else {
      push(p.model, p.model, true);
    }
    return out;
  }

  /* 同系列识别：仅按已有模型名/ID 的明确前缀归组，认不出来的保持自己的名字，
     不凭空编造系列；同一系列只保留一条接入记录展示。 */
  function apiSeriesOf(m) {
    var s = String(m.name || m.id || '');
    var low = s.toLowerCase();
    if (low.indexOf('flux') >= 0) return 'FLUX.1';
    if (low.indexOf('kolors') >= 0) return 'Kolors';
    if (low.indexOf('sdxl') >= 0 || low.indexOf('sd 3') >= 0 || low.indexOf('stable-diffusion') >= 0) return 'Stable Diffusion';
    if (low.indexOf('gemini') >= 0) return 'Gemini';
    if (low.indexOf('gpt-image') >= 0) return 'GPT-image';
    if (low.indexOf('imagen') >= 0) return 'Imagen';
    if (s.indexOf('通义万相') >= 0) return '通义万相';
    if (s.indexOf('豆包') >= 0) return '豆包';
    if (s.indexOf('混元') >= 0) return '混元';
    return s || '未命名';
  }

  function apiSeriesGroups(models) {
    var map = {}, order = [];
    models.forEach(function (m) {
      var name = apiSeriesOf(m);
      if (!map[name]) { map[name] = []; order.push(name); }
      map[name].push(m);
    });
    return order.map(function (name) { return { name: name, models: map[name] }; });
  }

  /* 平台/类型互相约束：先按平台过滤可选类型，再按已选类型收敛平台，
     保证不会出现「平台 A + 类型 B 永远空表」的死角。 */
  function normalizeApiFilter(providers) {
    if (apiFilter.platform && !providers.some(function (p) { return (p.platform || p.id) === apiFilter.platform; })) {
      apiFilter.platform = '';
    }
    var scope = apiFilter.platform
      ? providers.filter(function (p) { return (p.platform || p.id) === apiFilter.platform; })
      : providers;
    if (apiFilter.billing) {
      scope = scope.filter(function (p) { return apiBillingKey(p) === apiFilter.billing; });
    }
    var supported = {};
    scope.forEach(function (p) { if (p.type) supported[p.type] = 1; });
    apiFilter.types = apiFilter.types.filter(function (t) { return supported[t]; });
    if (apiFilter.types.length) {
      var cur = providers.filter(function (p) { return (p.platform || p.id) === apiFilter.platform; })[0];
      if (cur && apiFilter.types.indexOf(cur.type) < 0) apiFilter.platform = '';
    }
    return supported;
  }

  /* 保存一条接入记录：先落本机，再 PUT /docs/api；
     云端失败必须把原因带回界面，不能静默成功。 */
  function saveApiCard(p) {
    var App = window.HMApp;
    if (!App) return Promise.reject(new Error('应用未就绪'));
    /* 接口地址归一化：误填 /models、/chat/completions 等端点时剥到根地址再存 */
    var nb = apiBaseNormalize(p.base);
    p.base = nb.base;
    var id = p.id;
    var name = String(p.name || '').trim() || id;
    /* 保存前先拉云端最新文档：本机缓存可能过期，直接 push 会把云端类型/计费/Key 覆盖成空 */
    var fresh = (window.HMSync && window.HMSync.pullApi)
      ? window.HMSync.pullApi().catch(function () { return null; })
      : Promise.resolve(null);
    return fresh.then(function () {
      /* 模型留空时按真实清单自动选（不覆盖用户已填的模型名） */
      return autoPickModelIfNeeded(p);
    }).then(function () {
      var doc = getApiDoc();
      var prefs = App.state.prefs = App.state.prefs || {};
      var providers = App.state.providers = App.state.providers || {};
      var prevProvider = doc.providers[id] || {};
      var nextProvider = Object.assign({}, prevProvider, {
        name: name,
        base: p.base,
        key: p.key,
        model: p.model,
        model2: p.model2 || ''
      });
      if (!nextProvider.key) nextProvider.key = prevProvider.key || '';
      doc.providers[id] = nextProvider;
      /* 空值不覆盖已有类型/计费，避免旧页面把云端值冲掉 */
      if (p.type) doc.bindings[id] = p.type;
      else if (doc.bindings[id] == null) doc.bindings[id] = '';
      if (p.billing === 'free' || p.billing === 'paid') doc.billing[id] = p.billing;

      if (id.indexOf('__rayin__') === 0) {
        /* 通道跟着模型名/地址形态走，而不是跟着卡片 id：
         * /v1beta 且 Gemini 模型 → banana；gpt-image* → OpenAI 兼容出图 */
        var modelIsGemini = /^gemini/i.test(String(p.model || ''));
        var baseIsNative = /\/v\d+(alpha|beta)\d*$/i.test(String(p.base || ''));
        var isBanana = modelIsGemini && (baseIsNative || !/^gpt-image/i.test(String(p.model || '')));
        var prevRayin = doc.rayin || {};
        var rayinKey = p.key || prevProvider.key || '';
        prefs.rayin = { base: p.base, key: rayinKey };
        if (isBanana) {
          prefs.bananaModel = p.model;
          doc.bananaModel = p.model;
          if (p.enabled) App.state.engine = 'banana';
        } else {
          prefs.gptModel = p.model;
          doc.gptModel = p.model;
          if (p.enabled) App.state.engine = 'gpt-image';
        }
        doc.rayin = { base: p.base, key: rayinKey };
        nextProvider.model = p.model;
        nextProvider.model2 = '';
        nextProvider.engine = isBanana ? 'banana' : 'gpt-image';
        nextProvider.platform = '__rayin__';
        nextProvider.series = isBanana ? 'Gemini Banana' : 'GPT-image';
        nextProvider.name = 'RayinAPI';
        doc.providers[id] = nextProvider;
        /* 切通道必须同时换模型：只改 engine 会把旧通道的模型名发到新端点（404）。
         * 同时把运行时 state.api 补全，避免本地存储被覆盖成只剩 {base,key}。 */
        var nextApi = Object.assign({}, App.state.api || {}, {
          base: p.base,
          key: rayinKey
        });
        if (isBanana) nextApi.bananaModel = p.model;
        else nextApi.gptModel = p.model;
        App.state.api = nextApi;
        if (p.enabled) {
          App.state.channelModel = p.model;
          prefs.engine = isBanana ? 'banana' : 'gpt-image';
          prefs.channelModel = p.model;
        }
        try { localStorage.setItem('anidream.rayin.v1', JSON.stringify(nextApi)); } catch (e) {}
      } else {
        providers[id] = { base: p.base, key: nextProvider.key, model: p.model };
        if (p.enabled) App.state.providerId = id;
        try { localStorage.setItem('anidream.providers.v1', JSON.stringify(providers)); } catch (e) {}
      }
      try { localStorage.setItem('anidream.prefs.v1', JSON.stringify(prefs)); } catch (e) {}
      doc.updatedAt = Date.now();
      try { localStorage.setItem('anidream.api.v1', JSON.stringify(doc)); } catch (e) {}
      apiDocCache = doc;

      var push = window.HMSync && window.HMSync.pushApi;
      if (!push) {
        var noSync = new Error('云同步模块未加载，请刷新页面重试');
        noSync.localSaved = true;
        return Promise.reject(noSync);
      }
      return push(doc).then(function (res) {
        /* 回读校验：后端返回的文档里必须仍带这次填的 Key，防止被服务端过滤后只剩本机 */
        var cloud = res && res.doc && res.doc.data;
        var expectKey = String(nextProvider.key || '');
        var gotKey = null;
        if (cloud) {
          if (cloud.providers && cloud.providers[id]) gotKey = cloud.providers[id].key;
          else if (id.indexOf('__rayin__') === 0 && cloud.rayin) gotKey = cloud.rayin.key;
        }
        if (cloud && gotKey != null && String(gotKey) !== expectKey) {
          throw new Error('云端未保存 API Key，请重试');
        }
        /* 再主动 GET 一次 /docs/api，确认这条记录真的能读回来，而不是只看写入返回 200 */
        var verify = (window.HMSync && window.HMSync.pullApi)
          ? window.HMSync.pullApi().catch(function () { return null; })
          : Promise.resolve(null);
        return verify.then(function () {
          var after = getApiDoc();
          var rec = (after.providers && after.providers[id]) || null;
          if (!rec) throw new Error('云端回读失败：没有找到这条接入记录');
          if (String(rec.key || '') !== expectKey) throw new Error('云端回读失败：API Key 不一致');
          if (p.model && String(rec.model || '') !== String(p.model)) throw new Error('云端回读失败：模型名不一致');
          /* 保存成功后刷新同步面板：连接状态、最近同步时间一起更新 */
          if (window.HMSync && window.HMSync.refreshPanel) {
            try { window.HMSync.refreshPanel(); } catch (e) {}
          }
          return res;
        });
      }).catch(function (err) {
        err.localSaved = true;
        throw err;
      });
    });
  }

  function deleteApiCard(id) {
    var App = window.HMApp;
    if (!App) return;
    if (!confirm('确定删除这个 API 接入配置？密钥会从本机与云端一起清除。')) return;
    var doc = getApiDoc();
    if (id === '__rayin__') {
      try { localStorage.removeItem('anidream.rayin.v1'); } catch (e) {}
      App.state.prefs = App.state.prefs || {};
      App.state.prefs.rayin = { base: 'https://www.rayinai.com/v1', key: '' };
      delete doc.rayin;
      delete doc.gptModel;
      delete doc.bananaModel;
      delete doc.bindings[id];
      delete doc.billing[id];
    } else {
      delete App.state.providers[id];
      try { localStorage.setItem('anidream.providers.v1', JSON.stringify(App.state.providers)); } catch (e) {}
      if (App.state.providerId === id) App.state.providerId = null;
      delete doc.providers[id];
      delete doc.bindings[id];
      delete doc.billing[id];
    }
    doc.updatedAt = Date.now();
    try { localStorage.setItem('anidream.api.v1', JSON.stringify(doc)); } catch (e) {}
    apiDocCache = doc;
    if (App.toast) App.toast('已删除 ' + id, 'info');
    var push = window.HMSync && window.HMSync.pushApi;
    if (push) {
      push(doc).catch(function (err) {
        if (App.toast) App.toast('本机已删除；云端删除失败：' + ((err && err.message) || '网络异常'), 'error');
      });
    }
    renderApiPanel(document.getElementById('adminBody'));
  }

  /* 连接测试：不再只验证「地址 + 密钥」，而是分三层判断真实可用性
   *   1) /models 401/403/网络失败        → 密钥或地址不对（红）
   *   2) 模型不在账号清单里              → 模型不可用（红，给出可用图像模型）
   *   3) 真实发一次最小出图请求          → 分组/通道不可用也拦得住（红）
   * 只有真正拿到图片字节才显示绿色「可用」。 */
  /* 接口地址归一化：用户常把具体端点（/models、/chat/completions、
   * /images/generations…）当根地址填进来，直接拼会变成 /v1/models/models，
   * 上游会把 models 当成模型名报 404。这里统一剥到 API 根地址。 */
  var API_ENDPOINT_TAIL = /\/(models|chat\/completions|completions|responses|images\/generations|images\/edits|images\/variations|embeddings)\/?$/i;
  function apiBaseNormalize(raw) {
    /* 容忍从文档复制的格式：反引号 / 引号 / 全角引号 / 首尾空格，以及多余结尾斜杠 */
    var s = String(raw || '').trim().replace(/^[`'"“”‘’\s]+|[`'"“”‘’\s]+$/g, '');
    var stripped = s.replace(/\/+$/, '').replace(API_ENDPOINT_TAIL, '').replace(/\/+$/, '');
    return { base: stripped, changed: stripped !== s };
  }

  function apiProbeText(status, body) {
    var msg = '';
    try {
      var j = JSON.parse(body);
      msg = (j && j.error && (j.error.message || j.error.type)) || '';
    } catch (e) { msg = String(body || '').slice(0, 120); }
    return msg || ('HTTP ' + status);
  }

  function isImageModelId(id) { return /image|imagen|dall|flux|seedream|banana/i.test(String(id || '')); }

  /* 保存时模型留空：按这条 Key 的真实 /models 清单自动选一个能出图的模型。
   * 只填空值，用户手填的模型（含 gpt-image-2）一律不覆盖。 */
  var API_IMG_PREF = ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-2.6-flare',
    'gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst',
    'gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image'];

  function autoPickModelIfNeeded(p) {
    if (String((p && p.model) || '').trim() || !p || !p.base) return Promise.resolve();
    var root = apiBaseNormalize(p.base).base;
    var native = /\/v\d+(alpha|beta)\d*$/i.test(root);
    if (!native && !/\/v\d+[a-z]*$/i.test(root)) root = root.replace(/\/+$/, '') + '/v1';
    var headers = p.key ? (native ? { 'x-goog-api-key': p.key } : { 'Authorization': 'Bearer ' + p.key }) : {};
    return fetch(root + '/models', { method: 'GET', headers: headers }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      var ids = ((data && (data.data || data.models)) || []).map(function (m) {
        return String((m && (m.id || m.name)) || '').replace(/^models\//, '');
      }).filter(Boolean);
      var imgs = ids.filter(isImageModelId);
      if (!imgs.length) return;
      var chosen = '';
      for (var i = 0; i < API_IMG_PREF.length && !chosen; i += 1) {
        if (imgs.indexOf(API_IMG_PREF[i]) >= 0) chosen = API_IMG_PREF[i];
      }
      if (!chosen) chosen = imgs[0];
      p.model = chosen;
    }).catch(function () {});
  }

  function testApi(id, base, key, model, engine) {
    var App = window.HMApp;
    if (!App || !base) return Promise.resolve({ ok: false, msg: '请先填接口地址' });
    var root = apiBaseNormalize(base).base;
    if (!root) return Promise.resolve({ ok: false, msg: '请先填接口地址' });
    /* 地址形态决定调用方式：/v1beta、/v1alpha → Gemini 原生；其余 → OpenAI 兼容 */
    var native = /\/v\d+(alpha|beta)\d*$/i.test(root);
    if (!native && !/\/v\d+[a-z]*$/i.test(root)) root = root.replace(/\/+$/, '') + '/v1';
    var headers = key ? (native ? { 'x-goog-api-key': key } : { 'Authorization': 'Bearer ' + key }) : {};
    var want = String(model || '').trim();
    var modeLabel = native ? 'Gemini 原生接口' : 'OpenAI 兼容接口';

    function fetchT(url, opts, ms) {
      return new Promise(function (resolve) {
        var timer = setTimeout(function () { resolve({ timeout: true }); }, ms);
        fetch(url, opts).then(function (r) {
          return r.text().then(function (txt) {
            clearTimeout(timer);
            resolve({ status: r.status, ok: r.ok, text: txt });
          });
        }).catch(function (err) {
          clearTimeout(timer);
          resolve({ status: 0, ok: false, text: (err && err.message) || '网络错误' });
        });
      });
    }

    return fetchT(root + '/models', { method: 'GET', headers: headers }, 12000).then(function (r) {
      if (r.timeout) return { ok: false, msg: '请求超时：地址不可达' };
      if (r.status === 401 || r.status === 403) {
        return { ok: false, msg: '密钥无效或没有权限（HTTP ' + r.status + '）：请核对 API Key' };
      }
      if (!r.ok) {
        return { ok: false, msg: modeLabel + '地址不可用（HTTP ' + r.status + '）：' + apiProbeText(r.status, r.text) };
      }
      var ids = [];
      try {
        var j = JSON.parse(r.text);
        ids = ((j && (j.data || j.models)) || []).map(function (m) {
          return String((m && (m.id || m.name)) || '').replace(/^models\//, '');
        }).filter(Boolean);
      } catch (e) { ids = []; }

      if (!want) return { ok: false, msg: '密钥/地址正常，但这条配置还没有模型 ID' };
      if (ids.length && ids.indexOf(want) < 0) {
        var imgs = ids.filter(isImageModelId);
        return {
          ok: false,
          msg: '密钥/地址正常，但模型「' + want + '」不在该账号清单里' +
            (imgs.length ? '；可用图像模型：' + imgs.slice(0, 8).join('、') : '；清单里没有图像模型')
        };
      }
      /* 文字模型：地址与密钥都对，但这条通道不能出图，不能给绿灯 */
      if (!isImageModelId(want)) {
        return {
          ok: false,
          msg: '密钥有效（' + modeLabel + '），但模型「' + want + '」是文字模型，不能生成图片；出图请改用 GPT-image 配置（模型 gpt-image-2.5-flare）'
        };
      }
      /* 真实最小出图：原生走 :generateContent，兼容走 /images/generations 或 /chat/completions */
      var isBanana = engine === 'banana';
      var postHeaders = Object.assign({ 'Content-Type': 'application/json' }, headers);
      var req = native
        ? fetchT(root + '/models/' + encodeURIComponent(want) + ':generateContent', {
          method: 'POST',
          headers: postHeaders,
          body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] })
        }, 90000)
        : (isBanana
          ? fetchT(root + '/chat/completions', {
            method: 'POST',
            headers: postHeaders,
            body: JSON.stringify({ model: want, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] })
          }, 90000)
          : fetchT(root + '/images/generations', {
            method: 'POST',
            headers: postHeaders,
            body: JSON.stringify({ model: want, prompt: 'ping', n: 1, size: '1024x1024' })
          }, 90000));

      return req.then(function (g) {
        if (g.timeout) return { ok: false, msg: '地址/密钥正常，但真实出图超时（>90s）' };
        if (g.status === 404) {
          var m = apiProbeText(404, g.text);
          var geminiModel = engine === 'banana' || /^gemini/i.test(want);
          if (geminiModel || /not supported by any configured account|no available (account|channel)/i.test(m)) {
            return { ok: false, msg: '密钥有效，但该分组未承接 Gemini 图像（模型「' + want + '」）；请改用 GPT-image 配置（模型 gpt-image-2.5-flare，走 /images/generations）' };
          }
          return { ok: false, msg: '密钥有效，但模型「' + want + '」不可用：' + m };
        }
        if (g.status === 401 || g.status === 403) {
          return { ok: false, msg: '密钥无效或没有出图权限（HTTP ' + g.status + '）' };
        }
        if (!g.ok) return { ok: false, msg: '真实出图失败（HTTP ' + g.status + '）：' + apiProbeText(g.status, g.text) };
        var bytes = 0;
        try {
          var d = JSON.parse(g.text);
          if (native) {
            var parts = (d && d.candidates && d.candidates[0] && d.candidates[0].content
              && d.candidates[0].content.parts) || [];
            for (var i = 0; i < parts.length; i++) {
              var inline = parts[i].inlineData || parts[i].inline_data;
              if (inline && inline.data) {
                bytes = Math.floor(String(inline.data).replace(/\s+/g, '').length * 3 / 4);
                break;
              }
            }
          } else {
            var first = (d && d.data && d.data[0]) || (d && d.choices && d.choices[0] && d.choices[0].message) || {};
            var b64 = first.b64_json;
            if (!b64 && typeof first.content === 'string') {
              var mm = /data:image\/[^;]+;base64,([A-Za-z0-9+/=\r\n]+)/.exec(first.content);
              if (mm) b64 = mm[1];
            }
            if (b64) bytes = Math.floor(b64.replace(/\s+/g, '').length * 3 / 4);
            else if (first.url || (d && d.data && d.data[0] && d.data[0].url)) bytes = -1;
          }
        } catch (e) { bytes = 0; }
        if (!bytes) return { ok: false, msg: '接口返回 200 但没有拿到图片内容：请检查模型是否支持该端点' };
        return { ok: true, msg: '可用 · 实测出图成功' + (bytes > 0 ? '（约 ' + Math.round(bytes / 1024) + ' KB）' : '') };
      });
    });
  }

  function apiCardHtml(p) {
    var state = apiTestState[p.id] || '';
    var stateHtml = '';
    var nb = apiBaseNormalize(p.base || '');
    var baseHint = nb.changed ? ('将自动使用根地址：' + nb.base + '（已去掉端点后缀）') : '';
    if (state === 'loading') stateHtml = '<span class="hm-api-state is-testing"><i></i>测试中…</span>';
    else if (state === 'ok') stateHtml = '<span class="hm-api-state is-ok">● 在线</span>';
    else if (state === 'fail') stateHtml = '<span class="hm-api-state is-bad">● 离线</span>';
    else stateHtml = '<span class="hm-api-state is-idle">○ 未测试</span>';

    var keyMask = p._showKey ? hmEsc(p.key) : maskKey(p.key);
    var keyEye = p._showKey ? '👁‍🗨' : '👁';

    var nameField = p.isCustom
      ? '<label class="hm-api-field"><span>平台名称</span>' +
        '<input class="hm-api-input" data-ik="name" value="' + hmEsc(p.name) + '" placeholder="例如 OpenAI / 硅基流动"></label>'
      : '';

    return '<div class="hm-api-card" data-api="' + hmEsc(p.id) + '">' +
      '<div class="hm-api-card-head">' +
        '<div class="hm-api-card-title">' +
          '<span class="hm-api-card-dot" style="background:' + (p.isRayin ? '#a78bfa' : (p.preset && p.preset.color) || '#60a5fa') + '"></span>' +
          '<strong>' + hmEsc(p.name) + '</strong>' +
          (p.series ? '<em class="hm-api-tag">' + hmEsc(p.series) + '</em>' : '') +
          (p.isCustom ? '<em class="hm-api-tag">自定义</em>' : '') +
          (p.type ? '<span class="hm-api-type-badge">' + apiTypeLabel(p.type) + '</span>' : '<span class="hm-api-type-none">未分类</span>') +
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
        nameField +
        '<label class="hm-api-field"><span>接口地址</span>' +
          '<input class="hm-api-input" data-ik="base" value="' + hmEsc(p.base) + '" placeholder="https://.../v1">' +
          '<small data-base-hint style="display:block;margin-top:4px;font-size:11px;color:#fbbf24;">' + hmEsc(baseHint) + '</small></label>' +
        '<label class="hm-api-field"><span>API Key</span>' +
          '<div class="hm-api-key-row">' +
            '<input class="hm-api-input" data-ik="key" type="' + (p._showKey ? 'text' : 'password') + '" value="' + hmEsc(p.key) + '" placeholder="sk-...">' +
            '<button class="hm-api-eye" data-eye title="显示/隐藏">' + keyEye + '</button>' +
          '</div></label>' +
        '<label class="hm-api-field"><span>' + (p.isRayin ? (p.rayinVariant === 'banana' ? 'Gemini Banana 模型' : 'GPT-image 模型') : '默认模型 ID') + '</span>' +
          '<input class="hm-api-input" data-ik="model" value="' + hmEsc(p.model) + '" placeholder="..."></label>' +
        apiModelNamesHtml(p) +
      '</div>' +
      '<div class="hm-api-card-foot">' +
        '<div class="hm-api-foot-left">' +
          '<label class="hm-api-type-bind" title="绑定后，上方类型筛选按这里归类">类型' +
            '<select class="hm-api-select sm" data-ik="type">' + apiTypeOptionsHtml(p.type) + '</select>' +
          '</label>' +
          '<label class="hm-api-type-bind" title="计费方式会随这条接入配置一起保存到云端">计费' +
            '<select class="hm-api-select sm" data-ik="billing">' + apiBillingOptionsHtml(p.billing) + '</select>' +
          '</label>' +
          '<div class="hm-api-foot-msg" data-msg></div>' +
        '</div>' +
        '<div class="hm-api-foot-btns">' +
          '<button class="hm-api-btn hm-api-btn-ghost" data-test title="会真实生成 1 张 1024 图校验模型/分组是否可出图（按量计费）">测试连接</button>' +
          '<button class="hm-api-btn hm-api-btn-primary" data-save>保存</button>' +
          (!p.preset && !p.isRayin ? '<button class="hm-api-btn hm-api-btn-danger" data-del>删除</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* 这条配置绑定的模型名（展示用）：优先取该系列下的目录模型，其次取已填的模型 ID。
     不写入数据，只用于卡片下方那行小字。 */
  function apiModelNames(p) {
    var names = [];
    function add(v) {
      var s = String(v == null ? '' : v).trim();
      if (s && names.indexOf(s) < 0) names.push(s);
    }
    (p.models || []).forEach(function (m) {
      var id = String(m.id || m.model || '').trim();
      var series = String(m.series || m.group || '').trim();
      if (p.series && series && series !== p.series) return;
      add(id || m.name);
    });
    add(p.model);
    add(p.model2);
    return names;
  }
  function apiModelNamesHtml(p) {
    var names = apiModelNames(p);
    if (!names.length) return '';
    var full = names.join('、');
    return '<div class="hm-api-model-names" title="' + hmEsc(full) + '">' + hmEsc(full) + '</div>';
  }

  function apiSectionControlsHtml(providers, supported) {
    var opts = '<option value="">全部平台</option>';
    var seenPlat = {};
    providers.forEach(function (p) {
      var pid = p.platform || p.id;
      if (seenPlat[pid]) return;
      seenPlat[pid] = 1;
      var match = (!apiFilter.types.length || apiFilter.types.indexOf(p.type) >= 0) &&
        (!apiFilter.billing || apiBillingKey(p) === apiFilter.billing);
      if (p.platform) {
        match = providers.some(function (q) {
          return (q.platform || q.id) === pid &&
            (!apiFilter.types.length || apiFilter.types.indexOf(q.type) >= 0) &&
            (!apiFilter.billing || apiBillingKey(q) === apiFilter.billing);
        });
      }
      opts += '<option value="' + hmEsc(pid) + '"' +
        (apiFilter.platform === pid ? ' selected' : '') +
        (match ? '' : ' disabled') + '>' +
        hmEsc(p.platformName || p.name) + (match ? '' : '（无匹配记录）') + '</option>';
    });
    var chips = API_TYPES.map(function (t) {
      var on = apiFilter.types.indexOf(t.id) >= 0;
      var enabled = !!supported[t.id];
      return '<label class="hm-api-type-chip' + (enabled ? '' : ' is-disabled') + '"' +
        ' title="' + (enabled ? '按 ' + t.label + ' 筛选' : '当前平台没有该类型的接入记录') + '">' +
        '<input type="checkbox" data-api-type="' + t.id + '"' + (on ? ' checked' : '') + (enabled ? '' : ' disabled') + '>' +
        t.label + '</label>';
    }).join('');
    var anyType = Object.keys(supported).length > 0;
    return '<div class="hm-api-sec-controls">' +
      '<select class="hm-api-select" data-api-platform title="按接入平台筛选">' + opts + '</select>' +
      '<select class="hm-api-select" data-api-billing title="按计费方式筛选（未绑定单独一类）">' + apiBillingFilterOptionsHtml(apiFilter.billing) + '</select>' +
      '<div class="hm-api-types">' + chips + '</div>' +
      (anyType ? '' : '<span class="hm-api-type-hint">先给接入记录绑定类型</span>') +
      '<button class="hm-api-tool-btn" data-api-act="add-api">＋ 新增 API</button>' +
      '</div>';
  }

  /* 一条接入记录 = 一行；同系列模型归并在同一格的系列标签下，不再一个模型一行 */
  function apiModelTableHtml(rows) {
    if (!rows.length) return '<div class="hm-api-model-empty">当前筛选下没有模型</div>';
    var body = rows.map(function (r) {
      var groups = apiSeriesGroups(r.models);
      var modelsHtml = groups.map(function (g) {
        var chips = g.models.map(function (m) {
          return '<span class="hm-api-model-chip" title="' + hmEsc(m.id) + '">' + hmEsc(m.name) + '</span>';
        }).join('');
        var showLabel = !(g.models.length === 1 && g.models[0].name === g.name);
        return '<div class="hm-api-series">' +
          (showLabel ? '<span class="hm-api-series-name">' + hmEsc(g.name) + '</span>' : '') +
          chips + '</div>';
      }).join('');
      var rowName = r.p.name + (r.p.series ? ' · ' + r.p.series : '');
      return '<tr>' +
        '<td class="hm-api-model-platform" title="' + hmEsc(rowName) + '">' + hmEsc(rowName) + '</td>' +
        '<td class="hm-api-log-model">' + modelsHtml + '</td>' +
        '<td>' + (r.p.type ? '<span class="hm-api-type-badge">' + apiTypeLabel(r.p.type) + '</span>'
          : '<span class="hm-api-type-none">未分类</span>') + '</td>' +
        '<td>' + apiBillingBadgeHtml(r.p.billing) + '</td>' +
        '<td class="hm-api-model-state">' + (r.p.enabled ? '<span class="is-on">● 已启用</span>'
          : '<span class="is-off">○ 未启用</span>') + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="hm-api-model-wrap"><table class="hm-api-log-table hm-api-model-table">' +
      '<thead><tr><th>平台</th><th>模型（按系列归并）</th><th>类型</th><th>计费</th><th>状态</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  function renderApiPanel(body) {
    var App = window.HMApp;
    if (!body || !App) return;
    /* 模型名小字实时跟随输入：改模型 ID 时不用等保存/重渲染 */
    if (!body._hmModelLineBound) {
      body._hmModelLineBound = true;
      body.addEventListener('input', function (e) {
        var el = e.target;
        var ik = el && el.getAttribute ? el.getAttribute('data-ik') : '';
        if (ik === 'base') {
          var card0 = el.closest('.hm-api-card');
          var hint0 = card0 && card0.querySelector('[data-base-hint]');
          if (hint0) {
            var n0 = apiBaseNormalize(el.value);
            hint0.textContent = n0.changed ? ('将自动使用根地址：' + n0.base + '（已去掉端点后缀）') : '';
          }
          return;
        }
        if (ik !== 'model') return;
        var card = el.closest('.hm-api-card');
        if (!card) return;
        var line = card.querySelector('.hm-api-model-names');
        if (!line) return;
        var v = String(el.value || '').trim();
        if (!v) return;
        var parts = (line.textContent || '').split('、').filter(Boolean);
        if (parts.indexOf(v) < 0) parts.push(v);
        line.textContent = parts.join('、');
        line.title = parts.join('、');
      });
      body.addEventListener('change', function (e) {
        var el = e.target;
        if (!el || el.getAttribute('data-ik') !== 'base') return;
        var n = apiBaseNormalize(el.value);
        if (!n.changed) return;
        el.value = n.base;
        var card = el.closest('.hm-api-card');
        var hint = card && card.querySelector('[data-base-hint]');
        if (hint) hint.textContent = '已自动归一化为根地址：' + n.base;
      });
    }
    var providers = getProviders();
    var total = providers.length;
    var enabledCount = providers.filter(function (p) { return p.enabled; }).length;
    var supported = normalizeApiFilter(providers);

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
      '    </div>' +
      '  </header>';

    /* 平台 + 类型共同作用：只显示交集；平台下拉与类型勾选互相收敛 */
    var platformProviders = providers.filter(function (p) {
      return !apiFilter.platform || (p.platform || p.id) === apiFilter.platform;
    });
    var rows = platformProviders.map(function (p) {
      return { p: p, models: apiModelsOf(p) };
    });
    if (apiFilter.types.length) {
      rows = rows.filter(function (r) { return apiFilter.types.indexOf(r.p.type) >= 0; });
    }
    if (apiFilter.billing) {
      rows = rows.filter(function (r) { return apiBillingKey(r.p) === apiFilter.billing; });
    }
    var unclassified = rows.filter(function (r) { return !r.p.type; }).length;
    var modelCount = rows.reduce(function (n, r) { return n + r.models.length; }, 0);
    var seriesCount = rows.reduce(function (n, r) { return n + apiSeriesGroups(r.models).length; }, 0);
    /* 接入配置与列表共用同一组筛选条件：平台 ∩ 类型 ∩ 计费 */
    var filteredProviders = platformProviders.filter(function (p) {
      if (apiFilter.types.length && apiFilter.types.indexOf(p.type) < 0) return false;
      if (apiFilter.billing && apiBillingKey(p) !== apiFilter.billing) return false;
      return true;
    });
    var cardsHtml = '';
    filteredProviders.forEach(function (p) { cardsHtml += apiCardHtml(p); });

    html += '  <section class="hm-api-sec">' +
      '    <div class="hm-api-sec-head">' +
      '      <h3 class="hm-api-sec-title"><span class="hm-api-sec-bar"></span>API 接入列表</h3>' +
      apiSectionControlsHtml(providers, supported) +
      '    </div>' +
      '    <div class="hm-api-listbox">' +
      '      <div class="hm-api-subhead">模型列表 <span>' + rows.length + ' 条接入记录 · ' +
        seriesCount + ' 个系列 · ' + modelCount + ' 个模型' +
        (unclassified ? ' · 未分类 ' + unclassified + ' 条' : '') + '</span></div>' +
      apiModelTableHtml(rows) +
      '      <div class="hm-api-subhead">接入配置 <span>' + filteredProviders.length + ' 条</span></div>' +
      (filteredProviders.length
        ? '<div class="hm-api-grid">' + cardsHtml + '</div>'
        : '<div class="hm-api-model-empty">当前筛选下没有接入记录</div>') +
      '    </div>' +
      '  </section>';

    /* 日志筛选：选项只来自真实记录里出现过的平台/类型 */
    var logPlatforms = [];
    var logTypes = [];
    apiLogs.forEach(function (l) {
      if (l.provider && logPlatforms.indexOf(l.provider) < 0) logPlatforms.push(l.provider);
      var lt = l.type || 'image';
      if (logTypes.indexOf(lt) < 0) logTypes.push(lt);
    });
    var shownLogs = apiLogs.filter(function (l) {
      if (apiLogFilter.platform && l.provider !== apiLogFilter.platform) return false;
      if (apiLogFilter.type && (l.type || 'image') !== apiLogFilter.type) return false;
      return true;
    });

    html += '  <section class="hm-api-sec">' +
      '    <h3 class="hm-api-sec-title"><span class="hm-api-sec-bar"></span>调用日志 <span class="hm-api-sec-sub">成功 ' + okCount + ' · 失败 ' + failCount + ' · 最多保留 500 条</span></h3>' +
      '    <div class="hm-api-log-actions">' +
      '      <button class="hm-api-tool-btn small" data-log-act="clear">🗑 清空日志</button>' +
      '      <button class="hm-api-tool-btn small" data-log-act="export">📤 导出日志 CSV</button>' +
      '    </div>';
    if (apiLogs.length) {
      html += '<div class="hm-api-log-filters">' +
        '<select data-log-filter="platform"><option value="">全部平台</option>' +
        logPlatforms.map(function (p) {
          return '<option value="' + hmEsc(p) + '"' + (apiLogFilter.platform === p ? ' selected' : '') + '>' + hmEsc(p) + '</option>';
        }).join('') + '</select>' +
        '<select data-log-filter="type"><option value="">全部类型</option>' +
        logTypes.map(function (t) {
          return '<option value="' + hmEsc(t) + '"' + (apiLogFilter.type === t ? ' selected' : '') + '>' + hmEsc(apiLogTypeLabel(t)) + '</option>';
        }).join('') + '</select>' +
        '<span class="hm-api-log-filter-count">当前 ' + shownLogs.length + ' 条</span>' +
        '</div>';
    }

    if (!apiLogs.length) {
      html += '<div class="hm-api-log-empty">' +
        '<div class="hm-api-log-empty-ico">📡</div>' +
        '<p>还没有调用记录</p>' +
        '<small>在「生成」页出图成功或失败后会自动写日志</small>' +
        '</div>';
    } else if (!shownLogs.length) {
      html += '<div class="hm-api-log-empty"><p>当前筛选下没有调用记录</p><small>换个平台或类型试试</small></div>';
    } else {
      html += '<div class="hm-api-log-wrap"><table class="hm-api-log-table"><thead><tr>' +
        '<th>时间</th><th>结果</th><th>类型</th><th>平台 / 接入配置</th><th>模型</th><th>耗时</th><th>提示词</th><th>失败原因</th>' +
        '</tr></thead><tbody>';
      shownLogs.slice(0, 200).forEach(function (l) { html += logRowHtml(l); });
      html += '</tbody></table></div>';
      if (shownLogs.length > 200) html += '<p class="hm-api-log-more">仅显示最近 200 条（筛选后共 ' + shownLogs.length + '）</p>';
    }
    html += '  </section>';

    html += '  <p class="hm-api-footer">接入配置与密钥会随账号保存到云端（/docs/api），换设备登录后可恢复；未登录时只保存在本机。调用日志仍仅本地，可随时清空。</p>';
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
    var statusIcon = l.status === 'ok' ? '✓ 成功' : '✗ 失败';
    var provider = hmEsc(l.provider || '');
    var model = hmEsc(l.model || '—');
    var latency = (l.latencyMs != null ? Math.round(l.latencyMs) + ' ms' : '—');
    var prompt = hmEsc((l.promptPreview || '').slice(0, 55));
    var err = hmEsc((l.errorMsg || '').slice(0, 60));
    return '<tr class="' + statusClass + '">' +
      '<td class="hm-api-log-ts">' + dateStr + '</td>' +
      '<td class="hm-api-log-status ' + statusClass + '">' + statusIcon + '</td>' +
      '<td>' + hmEsc(apiLogTypeLabel(l.type)) + '</td>' +
      '<td class="hm-api-log-provider">' + provider + '</td>' +
      '<td class="hm-api-log-model">' + model + '</td>' +
      '<td class="hm-api-log-latency">' + latency + '</td>' +
      '<td class="hm-api-log-prompt" title="' + hmEsc(l.promptPreview || '') + '">' + prompt + '</td>' +
      '<td class="hm-api-log-err" title="' + hmEsc(l.errorMsg || '') + '">' + err + '</td>' +
      '</tr>';
  }

  function apiLogTypeLabel(t) {
    return t === 'video' ? '生视频' : t === 'audio' ? '生音频' : t === 'chat' ? 'AI对话' : '生图';
  }

  function bindApiPanel(body) {
    if (!body) return;
    /* 面板会反复重渲染，事件只绑一次，避免重复保存/重复请求 */
    if (body.dataset.apiBound === '1') return;
    body.dataset.apiBound = '1';

    body.addEventListener('change', function (e) {
      var logSel = e.target.closest('[data-log-filter]');
      if (logSel) {
        var lk = logSel.getAttribute('data-log-filter');
        apiLogFilter[lk === 'platform' ? 'platform' : 'type'] = logSel.value;
        renderApiPanel(body);
        return;
      }
      var plat = e.target.closest('[data-api-platform]');
      if (plat) {
        apiFilter.platform = plat.value;
        renderApiPanel(body);
        return;
      }
      var billingSel = e.target.closest('[data-api-billing]');
      if (billingSel) {
        apiFilter.billing = billingSel.value;
        renderApiPanel(body);
        return;
      }
      var typeInput = e.target.closest('[data-api-type]');
      if (typeInput) {
        var typeId = typeInput.dataset.apiType;
        var idx = apiFilter.types.indexOf(typeId);
        if (typeInput.checked && idx < 0) apiFilter.types.push(typeId);
        else if (!typeInput.checked && idx >= 0) apiFilter.types.splice(idx, 1);
        renderApiPanel(body);
      }
    });

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
          data.api = getApiDoc();
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
                /* 导入时同样只收 RayinAPI：其他平台的旧配置直接丢弃 */
                function rayinOnly(src) {
                  var out = {};
                  Object.keys(src || {}).forEach(function (k2) {
                    if (k2.indexOf('__rayin') === 0) out[k2] = src[k2];
                  });
                  return out;
                }
                if (j.providers) {
                  var pv = rayinOnly(j.providers);
                  App.state.providers = pv;
                  try { localStorage.setItem('anidream.providers.v1', JSON.stringify(pv)); } catch (e) {}
                }
                if (j.rayin) {
                  App.state.prefs = App.state.prefs || {};
                  App.state.prefs.rayin = j.rayin;
                  try { localStorage.setItem('anidream.rayin.v1', JSON.stringify(j.rayin)); } catch (e) {}
                }
                if (j.api && typeof j.api === 'object') {
                  apiDocCache = null;
                  var imported = getApiDoc();
                  ['providers', 'bindings'].forEach(function (k) {
                    if (j.api[k] && typeof j.api[k] === 'object') {
                      imported[k] = (k === 'providers') ? rayinOnly(j.api[k]) : j.api[k];
                    }
                  });
                  if (j.api.billing && typeof j.api.billing === 'object') imported.billing = j.api.billing;
                  if (j.api.rayin) imported.rayin = j.api.rayin;
                  if (j.api.gptModel) imported.gptModel = j.api.gptModel;
                  if (j.api.bananaModel) imported.bananaModel = j.api.bananaModel;
                  imported.updatedAt = Date.now();
                  try { localStorage.setItem('anidream.api.v1', JSON.stringify(imported)); } catch (e) {}
                  apiDocCache = imported;
                  if (window.HMSync && HMSync.pushApi) {
                    HMSync.pushApi(imported).catch(function (e2) {
                      if (App.toast) App.toast('已导入本机；云端同步失败：' + ((e2 && e2.message) || '网络异常'), 'error');
                    });
                  }
                }
                if (App.toast) App.toast('导入成功', 'success');
                renderApiPanel(document.getElementById('adminBody'));
              } catch (err) { if (window.HMApp.toast) window.HMApp.toast('导入失败：' + err.message, 'error'); }
            };
            r.readAsText(f);
          };
          inp.click();
        } else if (act === 'add-custom' || act === 'add-api') {
          addApiRecord();
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
        var saveBtn = e.target.closest('[data-save]');
        if (saveBtn.disabled) return;
        saveBtn.disabled = true;
        var msgEl = card.querySelector('[data-msg]');
        if (msgEl) { msgEl.textContent = '保存中…'; msgEl.className = 'hm-api-foot-msg'; }
        saveFromCard(card, p).then(function () {
          if (window.HMApp && HMApp.toast) HMApp.toast('已保存 ' + p.name, 'success');
          renderApiPanel(body);
        }).catch(function (err) {
          var reason = (err && err.message) || '网络异常';
          if (err && err.localSaved) {
            /* 本机已写入，重渲染让绑定/表格立即生效，同时把云端失败原因留在卡片上 */
            renderApiPanel(body);
            var msg2 = document.querySelector('.hm-api-card[data-api="' + p.id + '"] [data-msg]');
            if (msg2) { msg2.textContent = '仅本机生效：已保存到本机，云端失败：' + reason; msg2.className = 'hm-api-foot-msg is-bad'; }
            if (window.HMApp && HMApp.toast) HMApp.toast('仅本机生效：已保存到本机，云端失败：' + reason, 'error');
          } else {
            saveBtn.disabled = false;
            if (msgEl) { msgEl.textContent = '保存失败：' + reason; msgEl.className = 'hm-api-foot-msg is-bad'; }
            if (window.HMApp && HMApp.toast) HMApp.toast('保存失败：' + reason, 'error');
          }
        });
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
    var payload = {
      id: p.id,
      name: p.name,
      base: p.base,
      key: p.key,
      model: p.model,
      model2: p.model2,
      enabled: p.enabled,
      type: apiBinding(p.id),
      billing: p.billing || ''
    };
    inputs.forEach(function (el) {
      var k = el.dataset.ik;
      if (k === 'enabled') payload.enabled = el.checked;
      else if (k === 'type') payload.type = el.value;
      else payload[k] = el.value.trim();
    });
    if (!payload.base) return Promise.reject(new Error('接口地址不能为空'));
    /* 模型可以留空：保存时会按这条 Key 的真实清单自动选一个能出图的模型 */
    return saveApiCard(payload);
  }

  /* 新增一条空白接入记录：先进输入态，点保存才写后端 */
  function addApiRecord() {
    var App = window.HMApp;
    if (!App) return;
    var providers = App.state.providers = App.state.providers || {};
    var doc = getApiDoc();
    var seq = 1;
    var id = 'custom-' + seq;
    while (providers[id] || doc.providers[id]) { seq += 1; id = 'custom-' + seq; }
    var name = '新接入 ' + seq;
    providers[id] = { base: '', key: '', model: '' };
    doc.providers[id] = { name: name, base: '', key: '', model: '', model2: '' };
    doc.bindings[id] = '';
    doc.billing[id] = '';
    doc.updatedAt = Date.now();
    try { localStorage.setItem('anidream.providers.v1', JSON.stringify(providers)); } catch (e) {}
    try { localStorage.setItem('anidream.api.v1', JSON.stringify(doc)); } catch (e) {}
    apiDocCache = doc;
    apiFilter.platform = '';
    renderApiPanel(document.getElementById('adminBody'));
    setTimeout(function () {
      var el = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-ik="name"]');
      if (!el) el = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-ik="base"]');
      if (el) { try { el.focus(); } catch (e) {} }
    }, 30);
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
    var nbTest = apiBaseNormalize(base);
    if (nbTest.changed) {
      base = nbTest.base;
      var baseInput = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-ik="base"]');
      if (baseInput) baseInput.value = base;
      var baseHintEl = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-base-hint]');
      if (baseHintEl) baseHintEl.textContent = '已自动归一化为根地址：' + base;
    }
    var engine = p.rayinVariant === 'banana' ? 'banana' : (p.rayinVariant === 'gpt' ? 'gpt-image' : ((p.preset && p.preset.engine) || ''));
    testApi(id, base, key, p.model, engine).then(function (res) {
      apiTestState[id] = res.ok ? 'ok' : 'fail';
      var c = document.querySelector('.hm-api-card[data-api="' + id + '"] [data-msg]');
      if (c) { c.textContent = res.msg; c.className = 'hm-api-foot-msg ' + (res.ok ? 'is-ok' : 'is-bad'); }
      /* 只更新状态灯，不重渲染（避免输入框丢失焦点） */
      var stateEl = document.querySelector('.hm-api-card[data-api="' + id + '"] .hm-api-state');
      if (stateEl) {
        stateEl.className = 'hm-api-state is-' + (res.ok ? 'ok' : 'bad');
        stateEl.textContent = (res.ok ? '● 可用' : '● 不可用');
      }
    });
  }

  /* 云端 /docs/api 拉回后：刷新缓存并按需重渲染接入面板 */
  window.HMCloudReload = window.HMCloudReload || {};
  window.HMCloudReload.api = function () { resetApiDoc(); };

  /* 全局暴露 */
  window.HMAdmin = { open: openAdmin, close: closeAdmin, isAdmin: isAdmin, testApi: testApi, saveApiCard: saveApiCard, autoPickModelIfNeeded: autoPickModelIfNeeded };
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