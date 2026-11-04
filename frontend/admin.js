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

  /* ============ 一次性事件绑定（到 index.html 里已有的 #view-admin 元素） ============ */
  function bindAdminEvents() {
    if (eventsBound) return;
    eventsBound = true;

    var page = document.getElementById('view-admin');
    if (!page) return;

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
      /* 重置 Tab 状态 */
      currentTopTab = 'admin';
      var page = document.getElementById('view-admin');
      if (page) {
        page.querySelectorAll('.hm-admin-top-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.top === 'admin');
        });
        page.querySelectorAll('.hm-admin-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.tab === currentSubTab);
        });
      }
      var subTabsWrap = document.getElementById('adminSubTabs');
      if (subTabsWrap) subTabsWrap.style.display = '';
      destroyAllCharts();
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

  function loadTab(tab) {
    destroyAllCharts();
    var body = document.getElementById('adminBody');
    if (!body) return;
    body.innerHTML = '<div class="hm-admin-loading"><span>加载中…</span></div>';

    var apiMap = {
      overview: HM.api.admin.overview,
      ranking:  HM.api.admin.ranking,
      logs:     HM.api.admin.logs,
      accounts: HM.api.admin.accounts,
      projects: HM.api.admin.projects,
    };
    var fn = apiMap[tab];
    if (!fn) { body.innerHTML = '<p>Tab 未实现</p>'; return; }

    fn().then(function (data) {
      body.innerHTML = '';
      var renderers = { overview: renderOverview, ranking: renderRanking,
                        logs: renderLogs, accounts: renderAccounts, projects: renderProjects };
      if (renderers[tab]) renderers[tab](data, body);
    }).catch(function (err) {
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

  /* ============ 账号管理 ============ */
  function renderAccounts(data, body) {
    var accs = data.accounts || [];
    body.innerHTML = [
      '<div class="hm-admin-panel hm-admin-panel-wide">',
        '<div class="hm-admin-panel-head"><h3>账号管理</h3>' +
          '<div class="hm-admin-filter-tabs">' +
            '<button class="hm-admin-filter-tab is-active">全部 ' + accs.length + '</button>' +
            '<button class="hm-admin-filter-tab">会员用户</button>' +
            '<button class="hm-admin-filter-tab">运营</button>' +
            '<button class="hm-admin-filter-tab">设计师</button>' +
          '</div>' +
        '</div>',
        '<div class="hm-admin-account-grid">',
          accs.map(function (a) {
            var statusClass = a.status === '在线' ? 'is-online' : 'is-offline';
            return '<div class="hm-admin-account-card">' +
              '<div class="hm-admin-account-head">' +
                '<div class="hm-admin-account-avatar">' + a.avatar + '</div>' +
                '<div class="hm-admin-account-info">' +
                  '<strong>' + a.name + '</strong>' +
                  '<span class="hm-pill is-member">' + a.role + '</span>' +
                '</div>' +
                '<div class="hm-admin-account-status ' + statusClass + '">' +
                  '<i></i>' + a.status +
                '</div>' +
              '</div>' +
              '<div class="hm-admin-account-bars">' +
                '<div class="hm-admin-account-item">' +
                  '<span>额度</span>' +
                  '<div class="hm-admin-mini-bar"><i style="width:' + Math.min(100, a.used / (a.credits || 1) * 100) + '%"></i></div>' +
                  '<b>' + fmt(a.used) + '/' + fmt(a.credits) + '</b>' +
                '</div>' +
              '</div>' +
              '<div class="hm-admin-account-meta">' +
                '<span>📂 ' + a.projects + ' 项目</span>' +
                '<span>🎨 ' + fmt(a.works) + ' 作品</span>' +
                '<span>📅 ' + a.joinDays + ' 天</span>' +
              '</div>' +
            '</div>';
          }).join(''),
        '</div>',
      '</div>',
    ].join('');
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

    var html = '';
    html += '<div class="hm-admin-body hm-api-body">';
    html += '  <header class="hm-api-header">' +
      '    <div class="hm-api-header-stats">' +
      '      <div class="hm-api-stat"><strong>' + total + '</strong><small>接入总数</small></div>' +
      '      <div class="hm-api-stat"><strong>' + enabledCount + '</strong><small>已启用</small></div>' +
      '      <div class="hm-api-stat"><strong>' + providers.filter(function (p) { return apiTestState[p.id] === 'ok'; }).length + '</strong><small>在线</small></div>' +
      '    </div>' +
      '    <div class="hm-api-header-actions">' +
      '      <button class="hm-api-tool-btn" data-api-act="test-all">🔍 测试全部</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="export">📤 导出配置</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="import">📥 导入配置</button>' +
      '      <button class="hm-api-tool-btn" data-api-act="add-custom">＋ 新增接入</button>' +
      '    </div>' +
      '  </header>';

    html += '  <div class="hm-api-grid">';
    providers.forEach(function (p) { html += apiCardHtml(p); });
    html += '  </div>';

    html += '  <p class="hm-api-footer">密钥仅保存在本浏览器（localStorage），不会上传服务器。每个接入都独立启用，默认引擎在「生成」页底部切换。</p>';
    html += '</div>';

    body.innerHTML = html;
    bindApiPanel(body);
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
