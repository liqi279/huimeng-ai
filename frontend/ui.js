'use strict';

/* =============================================================
 * 绘梦 · V3 工作台
 * 左侧导航（桌面 / 画布 / 成片 / 工具 / 资产 / 写作 / 论坛）
 * 预设弹窗、资产库、全屏编辑器、图片 / 视频 / 音频多模态
 * ============================================================= */
(function () {
  var A = window.HMApp;
  var api = window.HM && window.HM.api;
  if (!A) return;

  var state = A.state;
  var esc = A.esc;

  var LS = {
    theme: 'anidream.theme.v1',
    assets: 'anidream.assets.v1',
    draft: 'anidream.draft.v1',
    forum: 'anidream.forum.v1',
    mode: 'anidream.mode.v1',
    preset: 'anidream.preset.v1',
    credit: 'anidream.credit.v1',
    railOrder: 'anidream.railOrder.v1',
    season: 'anidream.season.v1',
    seasonFx: 'anidream.seasonFx.v1',
    homeMode: 'anidream.homeMode.v1',
    railCollapsed: 'anidream.railCollapsed.v1'
  };

  var ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l4-4m-4 4l-4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12h9.4l.8-12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var PRESETS = [
    { id: 'cel-shading', name: '赛璐璐动漫', category: '风格', keywords: 'cel shading, anime style, clean lineart, vibrant colors, flat shading', tag: '二次元', accent: '#6ea8fe' },
    { id: 'ghibli-soft', name: '吉卜力柔光', category: '风格', keywords: 'studio ghibli inspired, soft watercolor background, warm sunlight, gentle atmosphere', tag: '治愈系', accent: '#8bd6a8' },
    { id: 'guofeng-ink', name: '国风水墨', category: '风格', keywords: 'chinese ink painting, xieyi brushwork, rice paper texture, misty mountains, elegant', tag: '国风', accent: '#c9a86a' },
    { id: 'mecha-scifi', name: '机甲科幻', category: '风格', keywords: 'mecha anime, sci-fi concept art, metallic armor, neon accents, detailed machinery', tag: '机甲', accent: '#7aa2ff' },
    { id: 'makoto-light', name: '新海诚光影', category: '滤镜', keywords: 'makoto shinkai lighting, lens flare, dramatic sky, saturated sunset, cinematic glow', tag: '电影感', accent: '#ffb26b' },
    { id: 'film-grain', name: '胶片颗粒', category: '滤镜', keywords: '35mm film grain, analog color grading, soft halation, muted palette', tag: '胶片', accent: '#d8c3a5' },
    { id: 'dolly-in', name: '缓慢推镜', category: '运镜', keywords: 'slow dolly in, smooth camera push, shallow depth of field, cinematic movement', tag: '推镜', accent: '#9fd3ff' },
    { id: 'orbit-shot', name: '环绕运镜', keywords: 'orbit camera movement, 360 degree arc shot, parallax background, dynamic framing', category: '运镜', tag: '环绕', accent: '#b7a7ff' },
    { id: 'custom-soft', name: '柔光加雾', category: '自定义', keywords: 'soft bloom, atmospheric haze, dreamy lighting', tag: '自定义', accent: '#f0a6d0' },
    { id: 'custom-contrast', name: '高对比硬光', category: '自定义', keywords: 'high contrast, hard light, dramatic shadows, bold rim light', tag: '自定义', accent: '#f2c14e' },
    { id: 'custom-free', name: '自由关键词', category: '自定义', keywords: '', tag: '自由', accent: '#8a93a6' }
  ];

  var W_TEMPLATES = {
    storyboard: '【分镜脚本】\n镜头 01 · 全景：\n场景：\n动作：\n情绪：\n\n镜头 02 · 特写：\n场景：\n动作：\n情绪：\n',
    character: '【角色设定】\n姓名：\n年龄：\n外貌（发型 / 瞳色 / 服装）：\n性格：\n标志性道具：\n常用动作：\n',
    scene: '【场景描述】\n地点：\n时间：\n天气：\n光线：\n主要物件：\n氛围关键词：\n',
    camera: '【镜头语言】\n景别：特写 / 近景 / 中景 / 全景\n机位：平视 / 俯拍 / 仰拍\n运动：推 / 拉 / 摇 / 移 / 环绕\n焦距与景深：\n构图要点：\n'
  };

  var theme = 'dark';
  var presetList = PRESETS.slice();
  var presetCat = '风格';
  var presetSearch = '';
  var presetActive = null;

  var assets = [];
  var pageFilter = '';
  var modalFilter = '';

  var posts = [];

  /* ---------------- 侧边栏「桌面 / 画布」模式切换 ----------------
   * 第一个侧栏按钮是双模式入口：点击后在按钮右侧弹出菜单，
   * 选择「画布」则按钮与视图都变为画布，选择「桌面」则变回桌面。
   */
  var homeMode = 'create'; // 'create' = 桌面, 'canvas' = 画布

  function syncHomeBtn() {
    var btn = document.getElementById('railHomeBtn');
    var label = document.getElementById('railHomeLabel');
    if (!btn) return;
    var isCanvas = homeMode === 'canvas';
    if (label) label.textContent = isCanvas ? '画布' : '桌面';
    btn.setAttribute('data-rail', homeMode);
    btn.title = (isCanvas ? '画布' : '桌面') + '（点击在 桌面/画布 之间切换）';
    var icDesk = btn.querySelector('.hm-home-ic-desktop');
    var icCanvas = btn.querySelector('.hm-home-ic-canvas');
    if (icDesk) icDesk.style.display = isCanvas ? 'none' : '';
    if (icCanvas) icCanvas.style.display = isCanvas ? '' : 'none';
    var menu = document.getElementById('homeModeMenu');
    if (menu) {
      menu.querySelectorAll('[data-hmode]').forEach(function (item) {
        item.classList.toggle('is-current', item.getAttribute('data-hmode') === homeMode);
      });
    }
  }

  function setHomeMode(mode, opts) {
    if (mode !== 'create' && mode !== 'canvas') return;
    homeMode = mode;
    try { localStorage.setItem(LS.homeMode, mode); } catch (err) {}
    syncHomeBtn();
    closeHomeMenu();
    if (!(opts && opts.silent) && window.HMApp && window.HMApp.switchView) {
      window.HMApp.switchView(mode);
    }
  }

  function toggleHomeMenu() {
    var menu = document.getElementById('homeModeMenu');
    if (!menu) return;
    syncHomeBtn();
    if (menu.hidden) {
      var btn = document.getElementById('railHomeBtn');
      if (btn && btn.getBoundingClientRect) {
        var r = btn.getBoundingClientRect();
        menu.style.left = (r.right + 8) + 'px';
        menu.style.top = r.top + 'px';
      }
      menu.hidden = false;
    } else {
      menu.hidden = true;
    }
  }

  function closeHomeMenu() {
    var menu = document.getElementById('homeModeMenu');
    if (menu) menu.hidden = true;
  }

  function bindHomeSwitch() {
    syncHomeBtn();
    var menu = document.getElementById('homeModeMenu');
    if (menu) {
      menu.addEventListener('click', function (event) {
        var item = event.target.closest('[data-hmode]');
        if (!item) return;
        event.stopPropagation();
        setHomeMode(item.getAttribute('data-hmode'));
      });
    }
    document.addEventListener('click', function (event) {
      var m = document.getElementById('homeModeMenu');
      if (!m || m.hidden) return;
      if (event.target.closest('#homeModeMenu') || event.target.closest('#railHomeBtn')) return;
      closeHomeMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeHomeMenu();
    });
  }

  function initHomeMode() {
    var saved = 'create';
    try { saved = localStorage.getItem(LS.homeMode) || 'create'; } catch (err) {}
    if (saved !== 'canvas' && saved !== 'create') saved = 'create';
    homeMode = saved;
    syncHomeBtn();
    if (saved === 'canvas' && window.HMApp && window.HMApp.switchView) {
      window.HMApp.switchView('canvas');
    }
  }

  var credit = { total: 300, used: 0 };

  /* ---------------- 侧边栏显示 / 隐藏 ----------------
   * 侧栏右缘中间的小按钮：折叠 rail 与主内容左偏移，主区域自动扩展。
   */
  function setRailCollapsed(collapsed) {
    document.body.classList.toggle('rail-collapsed', !!collapsed);
    try { localStorage.setItem(LS.railCollapsed, collapsed ? '1' : '0'); } catch (err) {}
    var btn = document.getElementById('railToggleBtn');
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? '显示侧边栏' : '隐藏侧边栏';
      btn.setAttribute('aria-label', btn.title);
      btn.classList.toggle('is-collapsed', !!collapsed);
    }
    /* 画布 / 导演台等依赖容器尺寸的视图重新计算 */
    window.setTimeout(function () {
      if (window.HMCanvas && typeof window.HMCanvas.relayout === 'function') {
        try { window.HMCanvas.relayout(); } catch (err) {}
      }
      window.dispatchEvent(new Event('resize'));
      scheduleRailCutline();
    }, 320);
  }

  function bindRailToggle() {
    var btn = document.getElementById('railToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setRailCollapsed(!document.body.classList.contains('rail-collapsed'));
    });
  }

  function initRailCollapsed() {
    var saved = '0';
    try { saved = localStorage.getItem(LS.railCollapsed) || '0'; } catch (err) {}
    setRailCollapsed(saved === '1');
  }

  /* ---------------- 侧边栏「隐藏线」 ----------------
   * 隐藏线固定在左下角「主题」图标正上方。
   * 线上方可用高度放不下的图标会收进隐藏区（不出现半截图标），
   * 点击隐藏线可展开 / 收起隐藏区。
   */
  var railCutTimer = null;

  function layoutRailCutline() {
    var rail = document.getElementById('hmRail');
    var cut = document.getElementById('railCutline');
    var railTop = rail ? rail.querySelector('.hm-rail-top') : null;
    if (!rail || !cut || !railTop) return;

    if (rail.classList.contains('is-expanded')) {
      rail.classList.remove('has-cut');
      return;
    }

    var overflowed = railTop.scrollHeight - railTop.clientHeight > 1;
    rail.classList.toggle('has-cut', overflowed);
    cut.setAttribute('aria-expanded', 'false');
  }

  function scheduleRailCutline() {
    window.clearTimeout(railCutTimer);
    railCutTimer = window.setTimeout(layoutRailCutline, 60);
  }

  function bindRailCutline() {
    var rail = document.getElementById('hmRail');
    var cut = document.getElementById('railCutline');
    if (!rail || !cut) return;

    cut.addEventListener('click', function () {
      var expanded = rail.classList.toggle('is-expanded');
      cut.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      cut.title = expanded ? '收起隐藏区图标' : '隐藏线（上方放不下的图标会收进这里）';
      if (expanded) rail.classList.remove('has-cut');
      else layoutRailCutline();
    });

    window.addEventListener('resize', scheduleRailCutline);
    scheduleRailCutline();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleRailCutline).catch(function () {});
    }
  }

  /* ---------------- 本地存储 ---------------- */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) { return false; }
  }

  /* ---------------- 主题 / 积分 ---------------- */
  function applyTheme(value) {
    theme = value === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('hm-light', theme === 'light');
  }

  /* ---------------- 四季主题 · 动态 CG ---------------- */
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var SEASONS = {
    spring: {
      key: 'spring', label: '春 · 樱', en: 'SPRING', emoji: '🌸', type: 'petal',
      sky: ['#150a1a', '#3a1a3c', '#7b3657', '#d38aa0'],
      accent: '#ff9ecd', glow: '#ffd9e8',
      hills: ['rgba(38,20,34,.92)', 'rgba(52,26,44,.92)', 'rgba(66,32,54,.92)'],
      petalColor: '255,183,213',
    },
    summer: {
      key: 'summer', label: '夏 · 萤', en: 'SUMMER', emoji: '🌿', type: 'firefly',
      sky: ['#03101a', '#07293a', '#0d4a55', '#2f8f8a'],
      accent: '#5eead4', glow: '#a7f3e6',
      hills: ['rgba(6,32,36,.92)', 'rgba(8,46,50,.92)', 'rgba(10,60,62,.92)'],
      petalColor: '120,255,220',
    },
    autumn: {
      key: 'autumn', label: '秋 · 枫', en: 'AUTUMN', emoji: '🍁', type: 'leaf',
      sky: ['#160b06', '#3b1a0c', '#7a3412', '#d98342'],
      accent: '#f59e6b', glow: '#ffd0a1',
      hills: ['rgba(40,20,10,.92)', 'rgba(56,27,12,.92)', 'rgba(72,34,14,.92)'],
      petalColor: '232,106,51',
    },
    winter: {
      key: 'winter', label: '冬 · 雪', en: 'WINTER', emoji: '❄️', type: 'snow',
      sky: ['#060c17', '#122034', '#22405f', '#5d8ab2'],
      accent: '#93c5fd', glow: '#e0f2ff',
      hills: ['rgba(16,28,44,.94)', 'rgba(24,40,60,.94)', 'rgba(34,54,78,.94)'],
      petalColor: '235,247,255',
    },
  };
  var SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
  var seasonRaf = null, seasonAmbientStop = null, seasonAutoTimer = null;

  function applySeason(key) {
    if (!key || key === 'none' || !SEASONS[key]) {
      document.body.removeAttribute('data-season');
    } else {
      document.body.setAttribute('data-season', key);
    }
    writeJSON(LS.season, key || 'none');
    document.querySelectorAll('.hm-season-card').forEach(function (c) {
      c.classList.toggle('is-active', (c.getAttribute('data-season') || 'none') === (key || 'none'));
    });
  }

  function currentSeason() {
    var k = readJSON(LS.season, 'none');
    return (SEASONS[k] ? k : 'none');
  }

  /* ===== 粒子 ===== */
  function spawnSeasonParticle(type, W, H, initial) {
    var p = {
      x: Math.random() * W,
      y: initial ? Math.random() * H : -30,
      r: 0, vx: 0, vy: 0,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.06,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.55 + Math.random() * 0.45,
    };
    if (type === 'petal') {
      p.r = 5 + Math.random() * 7;
      p.vy = 0.55 + Math.random() * 1.1;
      p.vx = (Math.random() - 0.5) * 1.1;
    } else if (type === 'leaf') {
      p.r = 7 + Math.random() * 9;
      p.vy = 0.75 + Math.random() * 1.4;
      p.vx = (Math.random() - 0.5) * 1.3;
      p.vr = (Math.random() - 0.5) * 0.12;
    } else if (type === 'snow') {
      p.r = 1.8 + Math.random() * 4.2;
      p.vy = 0.35 + Math.random() * 0.9;
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vr = 0;
    } else { /* firefly */
      p.r = 1.6 + Math.random() * 2.2;
      p.vx = (Math.random() - 0.5) * 0.5;
      p.vy = (Math.random() - 0.5) * 0.4;
      p.vr = 0;
    }
    return p;
  }

  function updateSeasonParticle(p, type, W, H, t) {
    if (type === 'petal' || type === 'leaf') {
      p.x += p.vx + Math.sin(t * 1.2 + p.phase) * 1.05;
      p.y += p.vy;
      p.rot += p.vr;
    } else if (type === 'snow') {
      p.x += p.vx + Math.sin(t * 0.8 + p.phase) * 0.5;
      p.y += p.vy;
    } else {
      p.x += p.vx;
      p.y += p.vy + Math.sin(t * 1.6 + p.phase) * 0.25;
      p.alpha = 0.35 + Math.abs(Math.sin(t * 1.9 + p.phase)) * 0.65;
    }
    if (p.y > H + 30) { p.y = -30; p.x = Math.random() * W; }
    if (p.x > W + 40) p.x = -40;
    if (p.x < -40) p.x = W + 40;
  }

  function drawSeasonParticle(ctx, p, type) {
    if (type === 'petal') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(255,183,213,' + p.alpha + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 0.52, p.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,248,' + p.alpha * 0.5 + ')';
      ctx.beginPath();
      ctx.ellipse(-p.r * 0.16, -p.r * 0.3, p.r * 0.16, p.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (type === 'leaf') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(232,106,51,' + p.alpha + ')';
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
        var rad = (i % 2 === 0) ? p.r : p.r * 0.42;
        ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,140,' + p.alpha * 0.6 + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, p.r * 0.75);
      ctx.stroke();
      ctx.restore();
    } else if (type === 'snow') {
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.2);
      g.addColorStop(0, 'rgba(255,255,255,' + p.alpha + ')');
      g.addColorStop(0.45, 'rgba(226,242,255,' + p.alpha * 0.7 + ')');
      g.addColorStop(1, 'rgba(180,214,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      var g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
      g2.addColorStop(0, 'rgba(190,255,225,' + p.alpha + ')');
      g2.addColorStop(0.25, 'rgba(110,245,210,' + p.alpha * 0.55 + ')');
      g2.addColorStop(1, 'rgba(60,200,180,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(240,255,250,' + p.alpha + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ===== 场景（天空 / 光晕 / 山峦） ===== */
  function drawSeasonScene(ctx, W, H, s, t) {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, s.sky[0]);
    sky.addColorStop(0.38, s.sky[1]);
    sky.addColorStop(0.72, s.sky[2]);
    sky.addColorStop(1, s.sky[3]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* 光晕 */
    var cx = W * 0.62, cy = H * 0.34;
    var rad = Math.max(W, H) * 0.28;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(0.12, hexA(s.glow, 0.55));
    g.addColorStop(0.42, hexA(s.accent, 0.10));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();

    /* 云层 / 光束 */
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (var i = 0; i < 5; i++) {
      var y = H * (0.16 + i * 0.075) + Math.sin(t * 0.35 + i) * 6;
      var grad = ctx.createLinearGradient(0, y, W, y + 24);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, W, 26);
    }
    ctx.restore();

    /* 山峦（三层剪影） */
    for (var k = 0; k < s.hills.length; k++) {
      var baseY = H * (0.64 + k * 0.11);
      var amp = H * (0.045 - k * 0.008);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (var x = 0; x <= W; x += 6) {
        var yy = baseY
          + Math.sin((x / W) * Math.PI * (1.4 + k) + k * 1.15) * amp
          + Math.sin((x / W) * Math.PI * 4.6 + k * 2) * amp * 0.28;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = s.hills[k];
      ctx.fill();
    }

    /* 底部渐暗 + 暗角 */
    var vg = ctx.createLinearGradient(0, H * 0.55, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
  }

  function runSeasonCanvas(canvas, s, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return function () {};
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;

    function resize() {
      var r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    var count = opts.count || Math.min(110, Math.round(W / 12));
    var ps = [];
    for (var i = 0; i < count; i++) ps.push(spawnSeasonParticle(s.type, W, H, true));

    var t0 = performance.now();
    var raf = 0;
    function frame(now) {
      var t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      drawSeasonScene(ctx, W, H, s, t);
      for (var j = 0; j < ps.length; j++) {
        updateSeasonParticle(ps[j], s.type, W, H, t);
        drawSeasonParticle(ctx, ps[j], s.type);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onResize() { resize(); }
    window.addEventListener('resize', onResize);

    return function stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }

  /* ===== 全屏 CG 播放 ===== */
  function playSeasonCG(key, duration) {
    var s = SEASONS[key];
    if (!s) return;
    var old = document.getElementById('hmSeasonCG');
    if (old) old.remove();
    if (seasonRaf) { seasonRaf(); seasonRaf = null; }

    var wrap = document.createElement('div');
    wrap.id = 'hmSeasonCG';
    wrap.className = 'hm-season-cg';
    wrap.innerHTML =
      '<canvas class="hm-season-cg-canvas"></canvas>' +
      '<div class="hm-season-cg-caption">' +
        '<span class="hm-season-cg-en">' + s.en + '</span>' +
        '<strong class="hm-season-cg-cn">' + s.label + '</strong>' +
        '<span class="hm-season-cg-line"></span>' +
      '</div>' +
      '<div class="hm-season-cg-skip">点击任意处跳过</div>';
    document.body.appendChild(wrap);

    var stop = runSeasonCanvas(wrap.querySelector('canvas'), s, { count: 120 });
    seasonRaf = stop;

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      wrap.classList.add('is-out');
      if (seasonRaf) { seasonRaf(); seasonRaf = null; }
      setTimeout(function () { wrap.remove(); }, 760);
    }
    wrap.addEventListener('click', finish);
    setTimeout(finish, duration || 5200);
  }

  /* ===== 环境粒子（可选常驻） ===== */
  function startSeasonAmbient() {
    stopSeasonAmbient();
    var key = currentSeason();
    if (!SEASONS[key]) return;
    if (!readJSON(LS.seasonFx, true)) return;
    var cv = document.getElementById('hmSeasonAmbient');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'hmSeasonAmbient';
      cv.className = 'hm-season-ambient';
      document.body.appendChild(cv);
    }
    seasonAmbientStop = runSeasonCanvas(cv, SEASONS[key], { count: 42 });
  }

  function stopSeasonAmbient() {
    if (seasonAmbientStop) { seasonAmbientStop(); seasonAmbientStop = null; }
    var cv = document.getElementById('hmSeasonAmbient');
    if (cv) cv.remove();
  }

  function restartSeasonAmbient() {
    stopSeasonAmbient();
    startSeasonAmbient();
  }

  /* ===== 四季自动轮回 ===== */
  function stopSeasonAuto() {
    if (seasonAutoTimer) { clearInterval(seasonAutoTimer); seasonAutoTimer = null; }
  }
  function startSeasonAuto() {
    stopSeasonAuto();
    seasonAutoTimer = setInterval(function () {
      var cur = currentSeason();
      var idx = SEASON_ORDER.indexOf(cur);
      var next = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length];
      applySeason(next);
      restartSeasonAmbient();
    }, 30000);
  }

  /* ===== 主题面板 ===== */
  var SEASON_CARDS = [
    { key: 'none', label: '经典 · 夜', en: 'CLASSIC', emoji: '🌙' },
    { key: 'spring', label: '春 · 樱', en: 'SPRING', emoji: '🌸' },
    { key: 'summer', label: '夏 · 萤', en: 'SUMMER', emoji: '🌿' },
    { key: 'autumn', label: '秋 · 枫', en: 'AUTUMN', emoji: '🍁' },
    { key: 'winter', label: '冬 · 雪', en: 'WINTER', emoji: '❄️' },
  ];

  function openSeasonPanel() {
    var old = document.getElementById('hmSeasonPanel');
    if (old) old.remove();

    var cur = currentSeason();
    var ambientOn = readJSON(LS.seasonFx, true);
    var autoOn = !!seasonAutoTimer;

    var overlay = document.createElement('div');
    overlay.id = 'hmSeasonPanel';
    overlay.className = 'hm-season-overlay';
    overlay.innerHTML =
      '<div class="hm-season-modal" role="dialog" aria-label="主题设置">' +
        '<div class="hm-season-head">' +
          '<div><h3>四季轮回 · 主题</h3><p>为创作空间换一季光景，点击卡片播放专属动态 CG</p></div>' +
          '<button class="hm-season-close" title="关闭">✕</button>' +
        '</div>' +
        '<div class="hm-season-grid">' +
          SEASON_CARDS.map(function (c) {
            return '<button class="hm-season-card hm-season-art-' + c.key + (c.key === cur ? ' is-active' : '') + '" data-season="' + c.key + '">' +
              '<span class="hm-season-card-art"><i></i><i></i><i></i><i></i><i></i></span>' +
              '<span class="hm-season-card-emoji">' + c.emoji + '</span>' +
              '<span class="hm-season-card-label">' + c.label + '</span>' +
              '<span class="hm-season-card-en">' + c.en + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="hm-season-options">' +
          '<label class="hm-season-switch"><input type="checkbox" id="hmSeasonAmbient" ' + (ambientOn ? 'checked' : '') + '><span>环境粒子常驻</span></label>' +
          '<label class="hm-season-switch"><input type="checkbox" id="hmSeasonAuto" ' + (autoOn ? 'checked' : '') + '><span>四季自动轮回（30s）</span></label>' +
          '<button class="hm-season-theme-btn" id="hmSeasonLight">' + (theme === 'light' ? '☀️ 浅色模式' : '🌙 深色模式') + '</button>' +
        '</div>' +
        '<div class="hm-season-tip">动态 CG 由 Canvas 实时绘制 · 不占用额外资源</div>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() { overlay.classList.add('is-out'); setTimeout(function () { overlay.remove(); }, 240); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.hm-season-close').addEventListener('click', close);

    overlay.querySelectorAll('.hm-season-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var key = card.getAttribute('data-season');
        applySeason(key);
        overlay.querySelectorAll('.hm-season-card').forEach(function (c) {
          c.classList.toggle('is-active', c === card);
        });
        if (key === 'none') {
          stopSeasonAmbient();
          A.toast && A.toast('已切换为经典夜色主题', 'info');
        } else {
          restartSeasonAmbient();
          A.toast && A.toast('已切换为「' + SEASONS[key].label + '」主题', 'success');
        }
      });
    });

    var fx = overlay.querySelector('#hmSeasonAmbient');
    fx.addEventListener('change', function () {
      writeJSON(LS.seasonFx, fx.checked);
      if (fx.checked) restartSeasonAmbient(); else stopSeasonAmbient();
    });

    var auto = overlay.querySelector('#hmSeasonAuto');
    auto.addEventListener('change', function () {
      if (auto.checked) {
        startSeasonAuto();
        A.toast && A.toast('已开启四季自动轮回', 'info');
      } else {
        stopSeasonAuto();
        A.toast && A.toast('已关闭四季自动轮回', 'info');
      }
    });

    var lightBtn = overlay.querySelector('#hmSeasonLight');
    lightBtn.addEventListener('click', function () {
      applyTheme(theme === 'light' ? 'dark' : 'light');
      writeJSON(LS.theme, theme);
      lightBtn.textContent = theme === 'light' ? '☀️ 浅色模式' : '🌙 深色模式';
      A.toast && A.toast(theme === 'light' ? '已切换到浅色模式' : '已切换到深色模式', 'info');
    });
  }

  function bindTheme() {
    var btn = document.getElementById('themeBtn');
    if (btn) {
      btn.addEventListener('click', function () { openSeasonPanel(); });
    }
    var settings = document.getElementById('settingsBtn');
    if (settings) settings.addEventListener('click', function () { A.openApiModal(); });

    var railCredit = document.getElementById('railCredit');
    if (railCredit) {
      railCredit.addEventListener('click', function () {
        A.toast('本地演示积分：剩余 ' + remainCredit() + ' / ' + credit.total + ' · 免费图片通道不扣积分', 'info');
      });
    }
  }

  function remainCredit() {
    return Math.max(0, credit.total - credit.used);
  }

  function updateCredit() {
    var el = document.getElementById('creditValue');
    if (el) el.textContent = String(remainCredit());
    var rail = document.getElementById('railCredit');
    if (rail) rail.title = '剩余积分 ' + remainCredit() + ' / ' + credit.total;
  }

  function loadCredit() {
    var saved = readJSON(LS.credit, null);
    if (saved && typeof saved.total === 'number' && typeof saved.used === 'number') {
      credit = { total: saved.total, used: saved.used };
    } else {
      writeJSON(LS.credit, credit);
    }
  }

  function spendCredit(amount) {
    credit.used += amount;
    writeJSON(LS.credit, credit);
    updateCredit();
  }

  /* ---------------- 后端状态 ---------------- */
  function setBackend(online) {
    var el = document.getElementById('backendStatus');
    if (el) {
      el.textContent = online
        ? '后端已连接 · 视频 / 音频 / 资产 / 作品联网可用'
        : '未检测到后端服务：图片走免费直连；视频 / 音频需启动 Node 后端';
    }
    document.body.dataset.backend = online ? 'online' : 'offline';
  }

  async function detectBackend() {
    if (!api) { setBackend(false); return; }
    var online = await api.ping();
    setBackend(online);
    if (online) {
      try {
        var data = await api.presets();
        if (data && Array.isArray(data.items) && data.items.length) presetList = data.items;
      } catch (err) { /* 使用内置预设 */ }
    }
  }

  /* ---------------- 左侧导航 ---------------- */
  var DISABLED_RAILS = {};

  function bindRail() {
    document.addEventListener('click', function (event) {
      var item = event.target.closest('[data-rail]');
      if (!item) return;
      if (item.id === 'railHomeBtn') {
        /* 桌面/画布双模式按钮：点击同时切回桌面布局并弹出模式菜单 */
        event.preventDefault();
        setHomeMode('create');
        toggleHomeMenu();
        return;
      }
      var view = item.getAttribute('data-rail');
      if (!view) return;
      if (item.disabled || DISABLED_RAILS[view]) {
        A.toast && A.toast('「' + item.querySelector('span')?.textContent + '」功能开发中，敬请期待', 'info');
        return;
      }
      event.preventDefault();
      closeHomeMenu();
      A.switchView(view);
    });
  }

  // 侧边栏拖拽排序
  function initRailDragSort() {
    var railTop = document.querySelector('.hm-rail-top');
    if (!railTop) return;

    var items = railTop.querySelectorAll('.hm-rail-item[data-rail]');

    // 恢复保存的顺序（旧数据里的「作画」母入口按原位置拆成 原画 / 动画 / 着色）
    try {
      var order = readJSON(LS.railOrder, null);
      if (Array.isArray(order) && order.length) {
        var map = {};
        items.forEach(function (el) { map[el.getAttribute('data-rail')] = el; });
        order.forEach(function (rail) {
          if (rail === 'oua') {
            ['oua', 'animation', 'paint'].forEach(function (key) {
              if (map[key]) railTop.appendChild(map[key]);
            });
            return;
          }
          if (map[rail]) railTop.appendChild(map[rail]);
        });
        /* 旧顺序里没有的新入口跟随「原画」，避免被排到最前或最末。
           倒序插入，保证最终排列为 原画 → 动画 → 着色 */
        ['paint', 'animation'].forEach(function (key) {
          if (!map[key] || order.indexOf(key) >= 0) return;
          var anchor = map.oua;
          if (anchor && anchor.parentNode === railTop) {
            railTop.insertBefore(map[key], anchor.nextSibling);
          }
        });
        /* 旧顺序里没有 layout 时，默认排在「美术设定」之后 */
        if (map.layout && order.indexOf('layout') < 0 && map.art && map.art.parentNode === railTop) {
          railTop.insertBefore(map.layout, map.art.nextSibling);
        }
        /* 旧顺序里没有 edit 时，默认排在「摄影」之后 */
        if (map.edit && order.indexOf('edit') < 0 && map.director && map.director.parentNode === railTop) {
          railTop.insertBefore(map.edit, map.director.nextSibling);
        }
      }
    } catch (e) { /* ignore */ }

    var dragged = null;
    var placeholder = document.createElement('div');
    placeholder.className = 'hm-rail-placeholder';

    function getItems() {
      return railTop.querySelectorAll('.hm-rail-item[data-rail]');
    }

    getItems().forEach(function (el) {
      el.setAttribute('draggable', 'true');

      el.addEventListener('dragstart', function (e) {
        if (el.classList.contains('is-fixed')) { e.preventDefault(); dragged = null; return; }
        dragged = el;
        el.classList.add('is-dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', el.getAttribute('data-rail') || '');
        } catch (err) { /* ignore */ }
      });

      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (el.classList.contains('is-fixed') || (dragged && dragged.classList.contains('is-fixed'))) return;
        if (!dragged || dragged === el) return;
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
        var rect = el.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          railTop.insertBefore(dragged, el);
        } else {
          railTop.insertBefore(dragged, el.nextSibling);
        }
      });

      el.addEventListener('drop', function (e) {
        e.preventDefault();
      });

      el.addEventListener('dragend', function () {
        el.classList.remove('is-dragging');
        dragged = null;
        // 保存新顺序
        var newOrder = Array.from(getItems())
          .map(function (x) { return x.getAttribute('data-rail'); })
          .filter(Boolean);
        writeJSON(LS.railOrder, newOrder);
        if (A.toast) A.toast('已保存侧边栏顺序', 'success');
      });
    });
  }

  function updateRailBadges() {
    var badge = document.getElementById('railWorksBadge');
    if (badge) badge.textContent = String((A.state.works || []).length);
    updateCredit();
  }

  var prevView = null;

  function onView(view) {
    /* 原画 / 动画 / 着色 已是一级入口，各自高亮自己的侧栏按钮 */
    var railView = view;
    document.querySelectorAll('[data-rail]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-rail') === railView);
    });
    updateRailBadges();

    if (prevView === 'modeling' && view !== 'modeling' && window.BlenderBridge) {
      try { window.BlenderBridge.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'director' && view !== 'director' && window.HMDirector) {
      try { window.HMDirector.pause(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'director3d' && view !== 'director3d' && window.HMDirector3D) {
      try { window.HMDirector3D.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'director3d' && window.HMDirector3D) {
      try { window.HMDirector3D.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'storyboard' && view !== 'storyboard' && window.HMStoryboard) {
      try { window.HMStoryboard.pause(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'paint' && view !== 'paint' && window.HMPaint) {
      try { window.HMPaint.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'toolvideo' && view !== 'toolvideo' && window.HMToolVideo) {
      try { window.HMToolVideo.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'toolvideo' && window.HMToolVideo) {
      try { window.HMToolVideo.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'toolimage' && view !== 'toolimage' && window.HMToolImage) {
      try { window.HMToolImage.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'toolimage' && window.HMToolImage) {
      try { window.HMToolImage.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'toolreference' && view !== 'toolreference' && window.HMToolReference) {
      try { window.HMToolReference.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'toolreference' && window.HMToolReference) {
      try { window.HMToolReference.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'tooltraining' && view !== 'tooltraining' && window.HMToolTraining) {
      try { window.HMToolTraining.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'tooltraining' && window.HMToolTraining) {
      try { window.HMToolTraining.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'toolrestore' && view !== 'toolrestore' && window.HMToolRestore) {
      try { window.HMToolRestore.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'toolrestore' && window.HMToolRestore) {
      try { window.HMToolRestore.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'toolworkflow' && view !== 'toolworkflow' && window.HMToolWorkflow) {
      try { window.HMToolWorkflow.leave(); } catch (e) { /* ignore */ }
    }
    if (view === 'toolworkflow' && window.HMToolWorkflow) {
      try { window.HMToolWorkflow.enter(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'canvas' && view !== 'canvas' && window.HMCanvas) {
      try { window.HMCanvas.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'library' && view !== 'library' && window.HMLibrary) {
      try { window.HMLibrary.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'voice' && view !== 'voice' && window.HMVoice) {
      try { window.HMVoice.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'tooltoon' && view !== 'tooltoon' && window.HMToon) {
      try { window.HMToon.leave(); } catch (e) { /* ignore */ }
    }
    prevView = view;

    if (view === 'canvas' && window.HMCanvas) {
      try { window.HMCanvas.enter(); } catch (e) { console.error('[Canvas] enter failed', e); }
    }
    if (view === 'library' && window.HMLibrary) {
      try { window.HMLibrary.enter(); } catch (e) { console.error('[Library] enter failed', e); }
    }
    if (view === 'assets') { renderAssetPage(); loadProjects(); }
    if (view === 'writing') loadDraft();
    if (view === 'forum') renderForum();
    if (view === 'modeling' && window.BlenderBridge) {
      try { window.BlenderBridge.enter(); } catch (e) { /* ignore */ }
    }
    if (view === 'director' && window.HMDirector) {
      try { window.HMDirector.onEnter(); } catch (e) { console.error('[Director] onEnter failed', e); }
    }
    if (view === 'storyboard' && window.HMStoryboard) {
      try { window.HMStoryboard.enter(); } catch (e) { console.error('[Storyboard] enter failed', e); }
    }
    if (view === 'paint' && window.HMPaint) {
      try { window.HMPaint.enter(); } catch (e) { console.error('[Paint] enter failed', e); }
    }
    if (view === 'plan' && window.HMPlan) {
      try { window.HMPlan.enter(); } catch (e) { console.error('[Plan] enter failed', e); }
    }
    if (view === 'script' && window.HMScript) {
      try { window.HMScript.enter(); } catch (e) { console.error('[Script] enter failed', e); }
    }
    if (view === 'art' && window.HMArt) {
      try { window.HMArt.enter(); } catch (e) { console.error('[Art] enter failed', e); }
    }
    if (view === 'oua' && window.HMOUA) {
      try { window.HMOUA.enter(); } catch (e) { console.error('[OUA] enter failed', e); }
    }
    if (view === 'animation' && window.HMAnimation) {
      try { window.HMAnimation.enter(); } catch (e) { console.error('[Animation] enter failed', e); }
    }
  }

  function onRenderWorks() {
    updateRailBadges();
  }

  /* ---------------- 生成模式 ---------------- */
  function bindModes() {
    var tabs = document.getElementById('modeMenu');
    if (tabs) {
      tabs.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-mode]');
        if (!btn) return;
        setMode(btn.dataset.mode);
        A.closeAllMenus();
        A.toast(
          state.mode === 'image' ? '已切换到图片生成'
            : state.mode === 'video' ? '已切换到视频生成 · 需启动后端'
              : '已切换到音频合成 · 需启动后端',
          'info'
        );
      });
    }

    bindChoice('durationMenu', 'duration', 'duration', 'durationChipText', function (value) {
      return value + '秒';
    }, Number);
    bindChoice('voiceMenu', 'voice', 'voice', 'voiceChipText', function (value) {
      return '音色 · ' + value;
    });
    bindChoice('audioFmtMenu', 'format', 'audioFormat', 'audioFmtText', function (value) {
      return String(value).toUpperCase();
    });
    bindChoice('sampleRateMenu', 'rate', 'sampleRate', 'sampleRateText', function (value) {
      return (Number(value) / 1000) + 'k';
    }, Number);
  }

  function bindChoice(menuId, attr, key, labelId, format, cast) {
    var menu = document.getElementById(menuId);
    var label = document.getElementById(labelId);
    if (!menu) return;

    menu.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-' + attr + ']');
      if (!btn) return;
      var raw = btn.getAttribute('data-' + attr);
      state[key] = cast ? cast(raw) : raw;
      menu.querySelectorAll('button').forEach(function (el) {
        el.classList.toggle('is-active', el === btn);
      });
      if (label) label.textContent = format(state[key]);
      persistMode();
      A.closeAllMenus();
    });
  }

  function setMode(mode) {
    if (['image', 'video', 'audio'].indexOf(mode) < 0) return;
    state.mode = mode;

    document.querySelectorAll('#modeMenu [data-mode]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-mode') === mode);
    });
    document.querySelectorAll('#modelMenu [data-mode-panel]').forEach(function (el) {
      el.hidden = el.getAttribute('data-mode-panel') !== mode;
    });

    var modeText = document.getElementById('engineModeText');
    if (modeText) modeText.textContent = mode === 'image' ? '生图' : mode === 'video' ? '视频' : '音频';

    syncModeUI();
    persistMode();
  }

  function syncModeUI() {
    var mode = state.mode || 'image';
    document.body.dataset.mode = mode;

    document.querySelectorAll('.hm-actions-right .hm-av-only').forEach(function (el) {
      el.hidden = mode === 'audio';
    });
    document.querySelectorAll('.hm-actions-right .hm-video-only').forEach(function (el) {
      el.hidden = mode !== 'video';
    });
    document.querySelectorAll('.hm-actions-right .hm-audio-only').forEach(function (el) {
      el.hidden = mode !== 'audio';
    });

    var imageOnly = mode === 'image';
    if (A.els.modelsToggle) A.els.modelsToggle.hidden = !imageOnly;
    /* refDrop 在所有模式下都显示（上传参考主体），但内容/accept 动态变化 */
    if (A.els.refDrop) A.els.refDrop.hidden = false;
    updateRefDropForMode(mode);

    var hint = document.getElementById('genHint');
    if (hint && !state.generating) {
      hint.textContent = imageOnly
        ? (A.ENGINE_META && A.ENGINE_META[state.engine] ? A.ENGINE_META[state.engine].hint : '免费 · 约 10 秒')
        : mode === 'video' ? '需后端 · 约 30-90 秒' : '需后端 · 约 5 秒';
    }

    var notice = document.getElementById('composerNotice');
    if (notice) {
      if (imageOnly) {
        notice.textContent = state.engine === 'flux'
          ? '免费通道 · 无水印 · 生成后可直接下载原图'
          : 'RayinAPI 按量计费 · 生成后可直接下载原图';
      } else if (mode === 'video') {
        notice.textContent = '视频为异步任务 · 由 Node 后端代理生成（暂无完全免费视频模型）';
      } else {
        var audioFree = modeFreeFor('audio');
        notice.textContent = audioFree
          ? 'Edge-TTS 完全免费无额度 · 200+ 声音 · 支持中文 / 英文等 50+ 语言'
          : 'RayinAPI 按量计费 · 切换到 Edge-TTS（免费）免密钥使用';
      }
    }

    syncScaleLabels();
  }

  function syncScaleLabels() {
    var picker = A.els.scalePicker;
    var chip = document.getElementById('scaleChipText');
    if (!picker) return;

    var video = state.mode === 'video';
    picker.querySelectorAll('button').forEach(function (el) {
      var value = el.getAttribute('data-scale');
      if (video) {
        el.textContent = value === '1k' ? '720p' : value === '2k' ? '1080p' : '1080p 超清';
      } else {
        el.textContent = value === '1k' ? '标清 1K' : value === '2k' ? '高清 2K' : '超清 4K';
      }
    });
    if (chip) {
      chip.textContent = video
        ? (state.scale === '1k' ? '720p' : '1080p')
        : String(state.scale || '1k').toUpperCase();
    }
  }

  /* 参考主体上传区：按模式 + 模型 动态更新提示文案 */
  function updateRefDropForMode(mode) {
    var emptyText = document.getElementById('refEmptyText');
    var hintText = document.getElementById('refHintText');
    var input = document.getElementById('refInput');
    var limits = document.getElementById('refLimits');
    var limitsText = document.getElementById('refLimitsText');

    if (mode === 'video') {
      var videoMeta = mediaCatalog.video.find(function (m) { return m.id === state.videoModel; }) || mediaCatalog.video[0];
      var refHint = videoMeta && videoMeta.refHint ? videoMeta.refHint : '支持图片/视频/音频参考';
      if (emptyText) emptyText.textContent = '拖入或上传参考主体（图片/视频/音频）';
      if (hintText) hintText.textContent = refHint;
      if (input) input.setAttribute('accept', 'image/*,video/*,audio/*');
      if (limits && limitsText) {
        limits.hidden = false;
        limitsText.textContent = '视频参考主体 · 图片 ≤10MB 最多10张 · 视频 ≤50MB 最多3个 · 音频 ≤10MB 最多3个';
      }
    } else if (mode === 'audio') {
      if (emptyText) emptyText.textContent = '拖入或上传参考音频（可选）';
      if (hintText) hintText.textContent = '音频参考 ≤10MB · 最多 3 个';
      if (input) input.setAttribute('accept', 'audio/*');
      if (limits && limitsText) {
        limits.hidden = false;
        limitsText.textContent = '音频参考主体：音频文件 ≤10MB 最多 3 个（Edge-TTS 免费通道暂不支持参考音频）';
      }
    } else {
      if (emptyText) emptyText.textContent = '拖入或上传参考图（最多 10 张）· 支持多张批量';
      if (hintText) hintText.textContent = '参考图可指定主体 · 提示词中用 @1 @2 … 引用';
      if (input) input.setAttribute('accept', 'image/*');
      if (limits) limits.hidden = true;
    }
  }

  function persistMode() {
    writeJSON(LS.mode, {
      mode: state.mode,
      duration: state.duration,
      voice: state.voice,
      audioFormat: state.audioFormat,
      sampleRate: state.sampleRate
    });
  }

  /* ---------------- 免费模型目录（视频 / 音频） ---------------- */
  var mediaCatalog = {
    video: [
      /* 账号一 — 按次 */
      { id: 'vidu-q4', name: 'Vidu Q4', minDuration: 4, maxDuration: 16, free: false, resolutions: ['720p', '1080p'], fps: 24, billingType: 'perTask', credits: 31, creditsMin: 19, creditsPerSec: 0, desc: '19-31 积分/次', refHint: '图15 / 视0 / 音3 多参考，支持首尾帧' },
      { id: 'minimax_h3-768p', name: 'MiniMax H3', minDuration: 5, maxDuration: 15, free: false, resolutions: ['768p', '480p'], fps: 24, billingType: 'perTask', credits: 15, creditsMin: 13, creditsPerSec: 0, desc: '13-15 积分/次', refHint: '图9 / 视0 / 音3 全参模式，原生 768p' },
      { id: 'sd-2-720p', name: 'Seedance 2 · 9图3音3视', minDuration: 5, maxDuration: 15, free: false, resolutions: ['720p'], fps: 24, billingType: 'perTask', credits: 35, creditsPerSec: 0, desc: '35 积分/次', refHint: '9图+3音+3视 多模态参考' },
      { id: 'seedance-2.0-903', name: 'Seedance 2.0 满血', minDuration: 5, maxDuration: 15, free: false, resolutions: ['720p'], fps: 24, billingType: 'perTask', credits: 34, creditsPerSec: 0, desc: '34 积分/次', refHint: 'seedance-2.0-903，9图+0视+3音' },
      /* 账号二 — 混合 */
      { id: 'sd2.5-sss', name: 'Seedance 2.5 SSS', minDuration: 5, maxDuration: 30, free: false, resolutions: ['720p'], fps: 24, billingType: 'perTask', credits: 70, creditsPerSec: 0, desc: '70 积分/次', refHint: '图30 / 视10 / 音10 极多参考' },
    ],
    audio: {
      models: [
        { id: 'edgetts', name: 'Edge-TTS（免费）', source: 'edgetts', free: true },
        { id: 'tts-1', name: 'TTS-1', source: 'rayin', free: false },
        { id: 'tts-1-hd', name: 'TTS-1 HD', source: 'rayin', free: false },
        { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS', source: 'rayin', free: false },
      ],
      edgeVoices: null, /* 从后端加载 */
      refLimits: {
        audios: { count: 3, maxBytes: 10 * 1024 * 1024 }
      }
    }
  };

  async function loadMediaCatalog() {
    if (!(api && api.online)) return;
    try {
      var data = await api.mediaModels();
      if (!data) return;
      if (data.video) mediaCatalog.video = data.video;
      if (data.audio) mediaCatalog.audio = Object.assign({}, mediaCatalog.audio, data.audio);
      renderVideoModels();
      renderAudioModels();
      renderDurationControls();
      renderVoiceMenu();
    } catch (err) { /* 保持内置兜底 */ }
  }

  function renderVideoModels() {
    var menu = document.querySelector('#modelMenu [data-mode-panel="video"]');
    if (!menu) return;
    menu.innerHTML = '<span class="hm-menu-label">视频模型</span>' +
      '<div class="hm-chip-grid">' +
      mediaCatalog.video.map(function (m) {
        /* 支持积分范围显示（creditsMin / creditsPerSecMin → 最小-最大） */
        var creditsText;
        if (m.billingType === 'perSecond') {
          var psMin = m.creditsPerSecMin;
          var psMax = m.creditsPerSec || 0;
          creditsText = psMin != null ? psMin + '-' + psMax + ' 积分 / 秒' : psMax + ' 积分 / 秒';
        } else {
          var cMin = m.creditsMin;
          var cMax = m.credits || 0;
          creditsText = cMin != null ? cMin + '-' + cMax + ' 积分 / 次' : cMax + ' 积分 / 次';
        }
        var badge = m.billingType === 'perSecond'
          ? '<small class="hm-pay-badge hm-pay-persec">按秒</small>'
          : '<small class="hm-pay-badge">按次</small>';
        var tip = m.refHint ? ' ' + m.refHint : '';
        return '<button data-vmodel="' + m.id + '" title="' + creditsText + tip + '">' +
          m.name + badge +
          '<span class="hm-credits-hover" aria-hidden="true">' + creditsText + '</span>' +
        '</button>';
      }).join('') +
      '</div>' +
      '<p class="hm-menu-note">视频为异步任务 · 由 Node 后端代理生成 · 鼠标悬停查看积分</p>';

    menu.querySelectorAll('[data-vmodel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.videoModel = btn.getAttribute('data-vmodel');
        A.persistPrefs();
        A.syncEngineUI();
        renderDurationControls();
        syncScaleLabels();
        updateRefDropForMode(state.mode);
        renderVideoModels();
      });
    });
  }

  function renderAudioModels() {
    var menu = document.querySelector('#modelMenu [data-mode-panel="audio"]');
    if (!menu) return;
    menu.innerHTML = '<span class="hm-menu-label">音频模型</span>' +
      '<div class="hm-chip-grid">' +
      mediaCatalog.audio.models.map(function (m) {
        var badge = m.free ? '<small class="hm-free-badge">免费</small>' : '<small class="hm-pay-badge">RayinAPI</small>';
        return '<button data-amodel="' + m.id + '">' + m.name + badge + '</button>';
      }).join('') +
      '</div>' +
      '<p class="hm-menu-note">Edge-TTS 完全免费无额度 · RayinAPI 需密钥</p>';

    menu.querySelectorAll('[data-amodel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.audioModel = btn.getAttribute('data-amodel');
        A.persistPrefs();
        A.syncEngineUI();
        renderVoiceMenu();
        renderAudioModels();
      });
    });
  }

  /* 根据当前模型夹紧 duration 到合法范围 */
  function clampDuration(val) {
    var meta = mediaCatalog.video.find(function (m) { return m.id === state.videoModel; }) || mediaCatalog.video[0];
    var min = meta.minDuration || 5;
    var max = meta.maxDuration || 30;
    return Math.max(min, Math.min(max, val));
  }

  /* 绑定视频时长滑块的 input/change 事件（只绑一次，避免重复） */
  function bindDurationSlider() {
    var slider = document.getElementById('durationSlider');
    if (!slider || slider._hmBound) return;
    slider._hmBound = true;

    var label = document.getElementById('durationSliderLabel');
    var update = function () {
      /* 滑块全局 1-30，但夹紧到当前模型合法范围 */
      var raw = Number(slider.value);
      var val = clampDuration(raw);
      state.duration = val;
      slider.value = val; /* 把滑块位置也拉回合法值 */
      if (label) label.textContent = val + '秒';
      syncChoiceLabels();
    };

    slider.addEventListener('input', update);
    slider.addEventListener('change', function () {
      update();
      persistMode();
      A.persistPrefs();
    });
  }

  /* duration 控件：slider 固定全局 1-30，但值被当前模型夹紧到合法范围 */
  function renderDurationControls() {
    var modelId = state.videoModel;
    var meta = mediaCatalog.video.find(function (m) { return m.id === modelId; }) || mediaCatalog.video[0];
    var min = meta.minDuration || 5;
    var max = meta.maxDuration || 30;

    /* 同时夹紧 state.duration */
    state.duration = clampDuration(state.duration);

    /* 更新下拉菜单（保留用于兼容） */
    var menu = document.getElementById('durationMenu');
    if (menu) {
      menu.innerHTML = '';
      for (var d = min; d <= max; d += 5) {
        var btn = document.createElement('button');
        btn.setAttribute('data-duration', d);
        btn.textContent = d + ' 秒';
        if (d === state.duration) btn.classList.add('is-active');
        btn.addEventListener('click', function () {
          state.duration = Number(this.getAttribute('data-duration'));
          syncChoiceLabels();
          A.persistPrefs();
        });
        menu.appendChild(btn);
      }
    }
    /* slider：全局固定范围 1-30 / step=1，当前值夹紧到模型合法范围 */
    var slider = document.getElementById('durationSlider');
    if (slider) {
      slider.min = 1;
      slider.max = 30;
      slider.step = 1;
      slider.value = state.duration;
      var label = document.getElementById('durationSliderLabel');
      if (label) label.textContent = state.duration + '秒 · 模型支持 ' + min + '-' + max + 's';
    }

    /* 模型支持的分辨率：动态启用/禁用 scale 按钮 */
    var scalePicker = A.els.scalePicker;
    if (scalePicker && state.mode === 'video') {
      var supported = meta.resolutions || ['720p', '1080p'];
      scalePicker.querySelectorAll('button').forEach(function (el) {
        var value = el.getAttribute('data-scale');
        /* 1k→720p, 2k→1080p, 4k→2k */
        var res = value === '1k' ? '720p' : value === '2k' ? '1080p' : '2k';
        var ok = supported.indexOf(res) >= 0;
        el.disabled = !ok;
        el.style.opacity = ok ? '' : '0.35';
        el.style.pointerEvents = ok ? '' : 'none';
        if (!ok && state.scale === value) {
          /* 当前选中的分辨率不被支持，自动降级 */
          var fallback = supported.indexOf('1080p') >= 0 ? '2k' : '1k';
          state.scale = fallback;
        }
      });
      syncScaleLabels();
    }

    syncChoiceLabels();
  }

  /* voice 菜单：Edge-TTS 模式显示中文/英文常用声，付费模式显示 alloy/echo 等 */
  function renderVoiceMenu() {
    var menu = document.getElementById('voiceMenu');
    if (!menu) return;
    var isEdge = state.audioModel === 'edgetts';

    if (isEdge && mediaCatalog.audio.edgeVoices) {
      /* Edge-TTS：按语言分组显示 */
      var zh = mediaCatalog.audio.edgeVoices.filter(function (v) { return v.language === 'zh'; });
      var en = mediaCatalog.audio.edgeVoices.filter(function (v) { return v.language === 'en'; });
      menu.innerHTML =
        '<span class="hm-menu-label">中文</span>' +
        zh.slice(0, 6).map(function (v) { return '<button data-voice="' + v.name + '">' + v.name.replace('zh-CN-', '').replace('Neural', '') + '</button>'; }).join('') +
        '<span class="hm-menu-label">英文</span>' +
        en.slice(0, 4).map(function (v) { return '<button data-voice="' + v.name + '">' + v.name.replace('en-US-', '').replace('Neural', '') + '</button>'; }).join('');
    } else {
      /* 付费模型：固定 OpenAI 音色 */
      menu.innerHTML =
        '<button data-voice="alloy">alloy</button>' +
        '<button data-voice="echo">echo</button>' +
        '<button data-voice="fable">fable</button>' +
        '<button data-voice="onyx">onyx</button>' +
        '<button data-voice="nova">nova</button>' +
        '<button data-voice="shimmer">shimmer</button>';
    }

    menu.querySelectorAll('[data-voice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.voice = btn.getAttribute('data-voice');
        syncChoiceLabels();
        A.persistPrefs();
        menu.querySelectorAll('[data-voice]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });
    /* 同步当前 active 状态 */
    menu.querySelectorAll('[data-voice]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-voice') === state.voice);
    });

    syncChoiceLabels();
  }

  /* ---------------- 多模态生成（后端） ---------------- */
  async function runMedia(mode) {
    var text = A.els.promptInput.value.trim();
    if (!text) {
      A.toast(mode === 'audio' ? '先写下要合成的台词' : '先描述你想生成的画面', 'error');
      A.els.promptInput.focus();
      return;
    }
    if (!api || !api.online) {
      A.toast('视频 / 音频生成需要后端在线（当前无法连接 Render 服务器）', 'error');
      return;
    }

    /* 免费 Edge-TTS 通道不需要 RayinAPI key，付费通道才要 */
    var modelId = mode === 'video' ? state.videoModel : state.audioModel;
    var modelMeta = null;
    if (mode === 'audio') {
      modelMeta = mediaCatalog.audio.models.find(function (m) { return m.id === modelId; });
    }
    var isFree = mode === 'audio' && modelMeta && modelMeta.free;
    if (!isFree && !modeFreeFor(mode)) {
      var hasUserKey = !!String((state.api && state.api.key) || '').trim();
      var hasServerKey = api.hasServerKey();
      if (!hasUserKey && !hasServerKey) {
        A.toast(mode === 'video'
          ? '视频生成需要 RayinAPI 密钥（暂无完全免费视频模型可用）'
          : '请先在「接入设置」填写 RayinAPI 密钥，或切换到 Edge-TTS 免费模型', 'error');
        if (mode === 'audio') {
          A.toast('切换到模型菜单 → Edge-TTS（免费）即可免密钥使用', 'info');
        }
        if (!isFree) A.openApiModal();
        return;
      }
    }

    A.els.emptyState.style.display = 'none';
    A.els.resultGrid.innerHTML = '';
    state.jobs.clear();

    var size = A.currentSize();
    var job = {
      id: A.uid(),
      type: mode,
      prompt: text,
      promptEn: '',
      modelId: mode === 'video' ? modelId : modelId,
      modelName: modeModelLabelSimple(mode),
      engine: isFree ? 'edgetts' : (mode === 'audio' ? 'rayin-tts' : 'rayin-video'),
      metaLabel: mode === 'video' ? '视频' : (isFree ? 'Edge-TTS 免费' : '音频'),
      width: mode === 'video' ? size.w : 960,
      height: mode === 'video' ? size.h : 720,
      ratioId: state.ratio,
      scaleId: state.scale,
      steps: 0,
      seed: state.seed,
      status: 'loading',
      startedAt: Date.now(),
      url: '',
      elapsed: 0,
      duration: mode === 'video' ? state.duration : 0
    };
    state.jobs.set(job.id, job);
    A.createLoadingCard(job);

    A.setGenerating(true);
    A.startTicker();
    A.updateQueue(mode === 'video' ? '视频生成中' : (isFree ? 'Edge-TTS 合成中（免费）' : '语音合成中'));

    try {
      var data;
      if (mode === 'video') {
        data = await api.generate({
          mode: 'video',
          model: state.videoModel,
          prompt: text,
          ratio: state.ratio,
          resolution: state.scale === '1k' ? '720p' : '1080p',
          duration: state.duration,
          seed: state.seed,
          rayin: state.api
        }, 200000);
      } else {
        data = await api.generate({
          mode: 'audio',
          model: state.audioModel,
          text: text,
          voice: state.voice,
          format: state.audioFormat,
          sampleRate: state.sampleRate,
          rayin: state.api
        }, 90000);
      }

      var item = data && data.items && data.items[0];
      if (!item || !item.url) throw new Error('后端未返回媒体地址');
      if (api.mediaUrl) item.url = api.mediaUrl(item.url);
      if (item.width) job.width = item.width;
      if (item.height) job.height = item.height;
      if (item.duration) job.duration = item.duration;

      var elapsed = (Date.now() - job.startedAt) / 1000;
      A.markJobDone(job, item.url, item.seed || state.seed, elapsed);
      A.toast(mode === 'video' ? '视频已生成，可下载' : (isFree ? 'Edge-TTS 语音已合成（免费）' : '语音已合成'), 'success');
    } catch (err) {
      A.markJobError(job, err);
      A.toast(A.errorText(err), 'error');
    } finally {
      A.setGenerating(false);
      A.stopTicker();
      A.updateQueue('空闲');
      A.renderWorks();
    }
  }

  function modeFreeFor(mode) {
    if (mode !== 'audio') return false; /* 视频暂未提供免费模型 */
    var meta = mediaCatalog.audio.models.find(function (m) { return m.id === state.audioModel; });
    return !!(meta && meta.free);
  }

  function modeModelLabelSimple(mode) {
    var m = mediaCatalog.audio.models.find(function (x) { return x.id === state.audioModel; });
    if (mode === 'audio' && m) return m.name;
    var vm = mediaCatalog.video.find(function (x) { return x.id === state.videoModel; });
    if (mode === 'video' && vm) return vm.name;
    return mode === 'video' ? '视频生成' : '语音合成';
  }

  /* ---------------- 全屏提示词编辑器 ---------------- */
  function bindEditor() {
    var panel = document.getElementById('promptEditor');
    var input = document.getElementById('promptEditorInput');
    var count = document.getElementById('promptEditorCount');
    var expand = document.getElementById('expandPrompt');

    if (!panel || !input) return;

    function updateCount() {
      if (count) count.textContent = input.value.length + ' / 1800';
    }

    function open() {
      input.value = A.els.promptInput.value;
      updateCount();
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      setTimeout(function () { input.focus(); }, 40);
    }

    function close() {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('no-scroll');
    }

    if (expand) {
      expand.addEventListener('click', function (event) {
        event.stopImmediatePropagation();
        open();
      }, true);
    }
    var closeBtn = document.getElementById('promptEditorClose');
    if (closeBtn) closeBtn.addEventListener('click', close);

    var apply = document.getElementById('promptEditorApply');
    if (apply) {
      apply.addEventListener('click', function () {
        A.els.promptInput.value = input.value;
        A.updateCharCount();
        close();
      });
    }

    input.addEventListener('input', updateCount);
    panel.addEventListener('click', function (event) {
      if (event.target === panel) close();
    });
  }

  /* ---------------- 预设弹窗 ---------------- */
  function bindPresetModal() {
    var btn = document.getElementById('presetBtn');
    var modal = document.getElementById('presetModal');
    if (!modal) return;

    if (btn) btn.addEventListener('click', openPresetModal);

    var close = document.getElementById('presetClose');
    if (close) close.addEventListener('click', closePresetModal);

    modal.addEventListener('click', function (event) {
      if (event.target === modal) closePresetModal();
    });

    var tabs = document.getElementById('presetTabs');
    if (tabs) {
      tabs.addEventListener('click', function (event) {
        var tab = event.target.closest('[data-cat]');
        if (!tab) return;
        presetCat = tab.getAttribute('data-cat');
        tabs.querySelectorAll('[data-cat]').forEach(function (el) {
          el.classList.toggle('is-active', el === tab);
        });
        renderPresets();
      });
    }

    var search = document.getElementById('presetSearch');
    if (search) {
      search.addEventListener('input', function () {
        presetSearch = search.value.trim().toLowerCase();
        renderPresets();
      });
    }

    var grid = document.getElementById('presetGrid');
    if (grid) {
      grid.addEventListener('click', function (event) {
        var item = event.target.closest('[data-preset]');
        if (!item) return;
        applyPreset(item.getAttribute('data-preset'));
      });
    }

    var clear = document.getElementById('presetClear');
    if (clear) clear.addEventListener('click', clearPreset);

    var saved = readJSON(LS.preset, null);
    if (saved && saved.id) {
      presetActive = saved;
      var chip = document.getElementById('presetChipText');
      if (chip) chip.textContent = saved.name;
    }
  }

  function openPresetModal() {
    var modal = document.getElementById('presetModal');
    if (!modal) return;
    renderPresets();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }

  function closePresetModal() {
    var modal = document.getElementById('presetModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  function renderPresets() {
    var grid = document.getElementById('presetGrid');
    if (!grid) return;

    var list = presetList.filter(function (item) {
      if (item.category !== presetCat) return false;
      if (!presetSearch) return true;
      return [item.name, item.tag, item.keywords, item.category].join(' ').toLowerCase().indexOf(presetSearch) >= 0;
    });

    document.getElementById('presetSectionTitle').textContent =
      presetCat + ' · ' + list.length + ' 个预设';

    if (!list.length) {
      grid.innerHTML = '<p class="model-empty">这个分类下没有匹配的预设</p>';
      return;
    }

    grid.innerHTML = list.map(function (item) {
      var active = presetActive && presetActive.id === item.id;
      return '<button class="hm-preset-item' + (active ? ' is-active' : '') + '" data-preset="' + esc(item.id) + '">' +
        '<span class="hm-preset-thumb" style="--p1:' + esc(item.accent || '#3b82f6') + ';--p2:#1e293b">' + esc(item.name) + '</span>' +
        '<span class="hm-preset-copy"><strong>' + esc(item.name) + '</strong><small>' + esc(item.tag || item.category) + '</small></span>' +
      '</button>';
    }).join('');
  }

  function applyPreset(id) {
    var preset = presetList.find(function (item) { return item.id === id; });
    if (!preset) return;

    if (!preset.keywords) {
      A.toast('「自定义」预设不附带固定关键词，直接在描述里写即可', 'info');
      closePresetModal();
      return;
    }

    var input = A.els.promptInput;
    var text = input.value.trim();
    if (text.toLowerCase().indexOf(preset.keywords.toLowerCase()) < 0) {
      input.value = text ? text.replace(/[，,\s]+$/, '') + ', ' + preset.keywords : preset.keywords;
    }

    presetActive = preset;
    try {
      writeJSON(LS.preset, preset);
      A.updateCharCount();
      var chip = document.getElementById('presetChipText');
      if (chip) chip.textContent = preset.name;
    } finally {
      closePresetModal();
    }
    A.toast('已应用预设：' + preset.name, 'success');
  }

  function clearPreset() {
    if (presetActive && presetActive.keywords) {
      var input = A.els.promptInput;
      var text = input.value;
      var idx = text.toLowerCase().indexOf(presetActive.keywords.toLowerCase());
      if (idx >= 0) {
        input.value = (text.slice(0, idx) + text.slice(idx + presetActive.keywords.length))
          .replace(/[，,]\s*$/, '')
          .replace(/^\s*[，,]/, '')
          .trim();
        A.updateCharCount();
      }
    }
    presetActive = null;
    writeJSON(LS.preset, null);
    var chip = document.getElementById('presetChipText');
    if (chip) chip.textContent = '预设';
    A.toast('已清除预设关键词', 'info');
  }

  /* ---------------- 资产库 ---------------- */
  var assetTab = 'project';
  var currentProjectId = '';
  var currentFolder = '';
  var projects = [];

  function assetKindLabel(kind) {
    return kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片';
  }

  function assetThumb(asset) {
    var url = esc(asset.url);
    if (asset.kind === 'video') {
      return '<video src="' + url + '" muted playsinline preload="metadata"></video>';
    }
    if (asset.kind === 'audio') {
      return '<div class="hm-audio-thumb">♪<small>音频</small></div>';
    }
    return '<img src="' + url + '" alt="' + esc(asset.name) + '" loading="lazy">';
  }

  function assetCard(asset) {
    var folderBadge = asset.folder ? '<span class="hm-asset-badge hm-asset-badge-folder">📁 ' + esc(asset.folder) + '</span>' : '';
    var typeBadge = asset.type === 'reference'
      ? '<span class="hm-asset-badge hm-asset-badge-ref">参考</span>'
      : '<span class="hm-asset-badge hm-asset-badge-proj">项目</span>';
    return '<article class="hm-asset-card" data-asset="' + esc(asset.id) + '">' +
      assetThumb(asset) +
      '<div class="hm-asset-meta"><span>' + esc(asset.name || '素材') + '</span><span>' + assetKindLabel(asset.kind) + '</span></div>' +
      '<div class="hm-asset-badges">' + folderBadge + typeBadge + '</div>' +
      '<div class="hm-asset-actions">' +
        '<button data-aact="use" title="用作生成参考">' + ICON_EYE + '</button>' +
        '<button data-aact="delete" title="删除">' + ICON_TRASH + '</button>' +
      '</div>' +
    '</article>';
  }

  function filteredAssets(filter) {
    var list = assets;
    if (assetTab === 'project') {
      list = list.filter(function (a) { return a.type !== 'reference'; });
      if (currentProjectId) list = list.filter(function (a) { return a.projectId === currentProjectId; });
      if (currentFolder) list = list.filter(function (a) { return a.folder === currentFolder; });
    } else {
      list = list.filter(function (a) { return a.type === 'reference'; });
    }
    if (filter) {
      list = list.filter(function (asset) {
        return [asset.name, asset.kind, asset.folder || ''].join(' ').toLowerCase().indexOf(filter) >= 0;
      });
    }
    return list;
  }

  async function loadProjects() {
    if (api && api.online) {
      try {
        var data = await api.listProjects();
        projects = (data && data.projects) || [];
      } catch (err) { projects = []; }
    } else {
      projects = [];
    }
    renderProjectSelect();
  }

  function renderProjectSelect() {
    var sel = document.getElementById('assetProjectSelect');
    var folderRow = document.getElementById('assetFolderRow');
    var folderSel = document.getElementById('assetFolderSelect');
    if (!sel) return;

    // 项目选择
    var html = '<option value="">— 未选择 —（显示所有无归属项目资产）</option>';
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      html += '<option value="' + esc(p.id) + '"' + (p.id === currentProjectId ? ' selected' : '') + '>' +
        esc(p.name) + ' (' + (p.assetCount || 0) + ') </option>';
    }
    sel.innerHTML = html;

    // 文件夹选择
    if (folderRow) folderRow.hidden = !currentProjectId;
    if (folderSel && currentProjectId) {
      var proj = projects.find(function (p) { return p.id === currentProjectId; });
      var folders = proj && proj.folders ? proj.folders : [];
      var fhtml = '<option value="">全部文件夹</option>';
      for (var j = 0; j < folders.length; j++) {
        fhtml += '<option value="' + esc(folders[j]) + '"' + (folders[j] === currentFolder ? ' selected' : '') + '>' + esc(folders[j]) + '</option>';
      }
      folderSel.innerHTML = fhtml;
      if (!folders.length) folderSel.innerHTML += '<option value="">（此项目还没有文件夹）</option>';
    }
  }

  function renderAssetPage() {
    var grid = document.getElementById('assetsGrid');
    var empty = document.getElementById('assetsEmpty');
    var total = document.getElementById('assetsTotal');
    var subtitle = document.getElementById('assetsSubtitle');
    var emptyTitle = document.getElementById('assetsEmptyTitle');
    var emptyHint = document.getElementById('assetsEmptyHint');
    var projectBar = document.getElementById('assetProjectBar');
    if (!grid) return;

    // 项目栏只在 project tab 显示
    if (projectBar) projectBar.hidden = assetTab !== 'project';

    var list = filteredAssets(pageFilter);
    if (total) total.textContent = String(list.length);
    if (subtitle) {
      if (assetTab === 'project') {
        subtitle.textContent = currentProjectId
          ? '项目资产 · ' + (projects.find(function (p) { return p.id === currentProjectId; }) || {}).name + (currentFolder ? ' · ' + currentFolder : '') + ' · 共 ' + list.length + ' 项'
          : '项目资产（未选择项目） · 共 ' + list.length + ' 项';
      } else {
        subtitle.textContent = '参考资料资产 · 共 ' + list.length + ' 项';
      }
    }
    if (empty) empty.hidden = list.length > 0;
    if (emptyTitle) emptyTitle.textContent = list.length ? '' : (assetTab === 'project' ? '还没有项目资产' : '还没有参考资料');
    if (emptyHint) emptyHint.textContent = list.length ? '' : (assetTab === 'project'
      ? '先新建一个项目，然后导入素材归属到它'
      : '导入通用参考图、参考视频，所有项目都能调用');
    grid.innerHTML = list.map(assetCard).join('');
  }

  function renderAssetModal() {
    var grid = document.getElementById('assetModalGrid');
    var empty = document.getElementById('assetModalEmpty');
    var count = document.getElementById('assetModalCount');
    if (!grid) return;

    var list = filteredAssets(modalFilter);
    if (count) count.textContent = list.length + ' 项';
    if (empty) empty.hidden = list.length > 0;
    grid.innerHTML = list.map(assetCard).join('');
  }

  function openAssetModal() {
    var modal = document.getElementById('assetModal');
    if (!modal) return;
    renderAssetModal();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }

  function closeAssetModal() {
    var modal = document.getElementById('assetModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  function promptText(label, def) {
    var v = window.prompt(label, def || '');
    return v == null ? '' : String(v).trim();
  }

  async function bindAssetUI() {
    var importInput = document.getElementById('assetsImportInput');

    // Tab 切换
    var tabs = document.querySelectorAll('[data-atab]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
        assetTab = tab.getAttribute('data-atab');
        // 切换 tab 时重置项目/文件夹选择
        if (assetTab !== 'project') {
          currentProjectId = ''; currentFolder = '';
        }
        renderProjectSelect();
        renderAssetPage();
      });
    });

    // 项目选择
    var projectSel = document.getElementById('assetProjectSelect');
    if (projectSel) {
      projectSel.addEventListener('change', function () {
        currentProjectId = projectSel.value;
        currentFolder = '';
        renderProjectSelect();
        renderAssetPage();
      });
    }

    // 文件夹选择
    var folderSel = document.getElementById('assetFolderSelect');
    if (folderSel) {
      folderSel.addEventListener('change', function () {
        currentFolder = folderSel.value;
        renderAssetPage();
      });
    }

    // 新建项目
    var newProjBtn = document.getElementById('assetNewProject');
    if (newProjBtn) newProjBtn.addEventListener('click', async function () {
      var name = promptText('项目名称', '未命名项目');
      if (!name) return;
      try {
        var res = await api.createProject({ name: name });
        if (res && res.project) {
          projects.unshift(res.project);
          currentProjectId = res.project.id;
          currentFolder = '';
          renderProjectSelect();
          renderAssetPage();
          A.toast('项目已创建：' + name, 'success');
        }
      } catch (err) { A.toast('项目创建失败：' + (err.message || '未知错误'), 'error'); }
    });

    // 新建文件夹
    var newFolderBtn = document.getElementById('assetNewFolder');
    if (newFolderBtn) newFolderBtn.addEventListener('click', async function () {
      if (!currentProjectId) { A.toast('请先选择或新建一个项目', 'info'); return; }
      var proj = projects.find(function (p) { return p.id === currentProjectId; });
      var name = promptText('文件夹名称', '新文件夹');
      if (!name) return;
      try {
        await api.addProjectFolder(currentProjectId, name);
        // 更新本地 projects 副本
        if (proj && !proj.folders.includes(name)) proj.folders.push(name);
        currentFolder = name;
        renderProjectSelect();
        renderAssetPage();
        A.toast('文件夹已创建：' + name, 'success');
      } catch (err) { A.toast('文件夹创建失败：' + (err.message || '未知错误'), 'error'); }
    });

    ['assetsImportBtn', 'assetsEmptyImport', 'assetModalImport'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn && importInput) btn.addEventListener('click', function () { importInput.click(); });
    });

    if (importInput) {
      importInput.addEventListener('change', function () {
        handleFiles(importInput.files);
        importInput.value = '';
      });
    }

    var search = document.getElementById('assetsSearch');
    if (search) {
      search.addEventListener('input', function () {
        pageFilter = search.value.trim().toLowerCase();
        renderAssetPage();
      });
    }

    var modalSearch = document.getElementById('assetModalSearch');
    if (modalSearch) {
      modalSearch.addEventListener('input', function () {
        modalFilter = modalSearch.value.trim().toLowerCase();
        renderAssetModal();
      });
    }

    var btn = document.getElementById('assetsBtn');
    if (btn) btn.addEventListener('click', openAssetModal);

    var modal = document.getElementById('assetModal');
    if (modal) {
      var close = document.getElementById('assetModalClose');
      if (close) close.addEventListener('click', closeAssetModal);
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeAssetModal();
      });
    }

    ['assetsGrid', 'assetModalGrid'].forEach(function (id) {
      var grid = document.getElementById(id);
      if (!grid) return;
      grid.addEventListener('click', function (event) {
        var card = event.target.closest('[data-asset]');
        if (!card) return;
        var asset = assets.find(function (item) { return item.id === card.getAttribute('data-asset'); });
        if (!asset) return;
        var action = event.target.closest('[data-aact]');
        if (action) {
          if (action.getAttribute('data-aact') === 'use') useAsset(asset);
          else removeAsset(asset);
          return;
        }
        useAsset(asset);
      });
    });
  }

  function normalizeAsset(raw) {
    var asset = raw || {};
    return {
      id: asset.id || 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: asset.name || '素材',
      kind: asset.kind || 'image',
      url: api && api.mediaUrl ? api.mediaUrl(asset.url) : asset.url,
      size: asset.size || 0,
      createdAt: asset.createdAt || new Date().toISOString(),
      source: asset.source || 'local',
      type: ['project', 'reference'].includes(asset.type) ? asset.type : 'project',
      projectId: asset.projectId || null,
      folder: asset.folder || null,
    };
  }

  async function loadAssets() {
    if (api && api.online) {
      try {
        var data = await api.listAssets();
        if (data && Array.isArray(data.items)) {
          assets = data.items.map(function (item) {
            var asset = normalizeAsset(item);
            asset.source = 'server';
            return asset;
          });
          renderAssetPage();
          renderAssetModal();
          return;
        }
      } catch (err) { /* 回退本地 */ }
    }
    assets = readJSON(LS.assets, []).map(normalizeAsset);
    renderAssetPage();
    renderAssetModal();
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function kindOfMime(mime) {
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    return 'image';
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    var added = 0;

    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      if (file.size > 50 * 1024 * 1024) {
        A.toast('「' + file.name + '」超过 50MB，已跳过', 'error');
        continue;
      }
      try {
        var dataUrl = await readFileAsDataUrl(file);
        var kind = kindOfMime(file.type || '');
        if (api && api.online) {
          var body = { dataUrl: dataUrl, name: file.name, kind: kind, type: assetTab };
          if (assetTab === 'project' && currentProjectId) body.projectId = currentProjectId;
          if (assetTab === 'project' && currentFolder) body.folder = currentFolder;
          var res = await api.addAsset(body);
          var asset = normalizeAsset(res && res.asset);
          asset.source = 'server';
          assets.unshift(asset);
        } else {
          assets.unshift({
            id: 'a_' + Date.now() + '_' + i,
            name: file.name,
            kind: kind,
            url: dataUrl,
            size: file.size,
            createdAt: new Date().toISOString(),
            source: 'local',
            type: assetTab,
            projectId: assetTab === 'project' ? currentProjectId : null,
            folder: assetTab === 'project' ? currentFolder : null,
          });
          assets = assets.slice(0, 24);
          if (!writeJSON(LS.assets, assets)) {
            A.toast('本地空间不足，素材未保存', 'error');
            assets = assets.slice(1);
          }
        }
        added += 1;
      } catch (err) {
        A.toast((err && err.message) || '素材导入失败', 'error');
      }
    }

    if (added) {
      renderAssetPage();
      renderAssetModal();
      A.toast('已导入 ' + added + ' 个素材到「' + (assetTab === 'project' ? '项目资产' : '参考资料') + '」', 'success');
    }
  }

  async function useAsset(asset) {
    if (asset.kind !== 'image') {
      A.toast('只有图片素材可以作为参考图', 'info');
      return;
    }
    try {
      var dataUrl = asset.url;
      if (!/^data:/i.test(dataUrl)) {
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        dataUrl = await readFileAsDataUrl(blob);
      }
      var image = await new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = dataUrl;
      });

      A.state.refImage = {
        dataUrl: dataUrl,
        name: asset.name || 'reference.png',
        width: image.naturalWidth || 1024,
        height: image.naturalHeight || 1024
      };
      A.renderRef();
      closeAssetModal();
      A.switchView('create');
      A.toast(A.state.engine === 'gpt-image'
        ? '已作为参考图，可直接生成'
        : '已作为参考图，请切换到 GPT-image 引擎生成', 'success');
    } catch (err) {
      A.toast('参考图读取失败，请换一个素材', 'error');
    }
  }

  async function removeAsset(asset) {
    if (api && api.online && asset.source === 'server') {
      try { await api.deleteAsset(asset.id); } catch (err) { /* 忽略 */ }
    }
    assets = assets.filter(function (item) { return item.id !== asset.id; });
    if (!(api && api.online)) writeJSON(LS.assets, assets);
    renderAssetPage();
    renderAssetModal();
    A.toast('素材已删除', 'info');
  }

  /* ---------------- 写作 ---------------- */
  function bindWriting() {
    var templates = document.getElementById('writingTemplates');
    var input = document.getElementById('writingInput');
    var count = document.getElementById('writingCount');
    if (!templates || !input) return;

    templates.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-template]');
      if (!btn) return;
      var text = W_TEMPLATES[btn.getAttribute('data-template')] || '';
      input.value = input.value.trim() ? input.value.replace(/\s*$/, '') + '\n\n' + text : text;
      updateWritingCount();
      saveDraft(true);
      input.focus();
    });

    function updateWritingCount() {
      if (count) count.textContent = input.value.length + ' / 6000';
    }

    input.addEventListener('input', function () {
      updateWritingCount();
      clearTimeout(input._timer);
      input._timer = setTimeout(function () { saveDraft(true); }, 700);
    });

    var copy = document.getElementById('writingCopy');
    if (copy) {
      copy.addEventListener('click', function () {
        var text = input.value.trim();
        if (!text) { A.toast('还没有可以复制的文本', 'info'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            A.toast('文本已复制', 'success');
          }).catch(function () { A.toast('复制失败，请手动选择', 'error'); });
        } else {
          input.select();
          document.execCommand('copy');
          A.toast('文本已复制', 'success');
        }
      });
    }

    var save = document.getElementById('writingSave');
    if (save) save.addEventListener('click', function () { saveDraft(false); });

    var send = document.getElementById('writingSend');
    if (send) {
      send.addEventListener('click', function () {
        var text = input.value.trim();
        if (!text) { A.toast('先写点内容，再送去生成', 'error'); return; }
        A.els.promptInput.value = text.slice(0, 1800);
        A.updateCharCount();
        A.switchView('create');
        A.els.promptInput.focus();
        A.toast('文本已送入描述框', 'success');
      });
    }

    updateWritingCount();
  }

  function loadDraft() {
    var draft = readJSON(LS.draft, null);
    var input = document.getElementById('writingInput');
    var label = document.getElementById('writingSaved');
    if (!input || !draft) return;
    input.value = draft.text || '';
    var count = document.getElementById('writingCount');
    if (count) count.textContent = input.value.length + ' / 6000';
    if (label && draft.at) {
      label.textContent = '上次保存 ' + new Date(draft.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
  }

  function saveDraft(silent) {
    var input = document.getElementById('writingInput');
    var label = document.getElementById('writingSaved');
    if (!input) return;
    var at = Date.now();
    writeJSON(LS.draft, { text: input.value, at: at });
    if (label) {
      label.textContent = '已保存 ' + new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (!silent) A.toast('草稿已保存', 'success');
  }

  /* ---------------- 论坛（本地） ---------------- */
  function bindForum() {
    var body = document.getElementById('forumBody');
    var count = document.getElementById('forumCount');
    var publish = document.getElementById('forumPublish');
    var list = document.getElementById('forumList');
    if (!body) return;

    body.addEventListener('input', function () {
      if (count) count.textContent = body.value.length + ' / 600';
    });

    if (publish) {
      publish.addEventListener('click', function () {
        var title = document.getElementById('forumTitle').value.trim();
        var text = body.value.trim();
        if (!title && !text) {
          A.toast('写个标题或内容再发布', 'error');
          return;
        }
        posts.unshift({
          id: 'p_' + Date.now(),
          title: title || '未命名帖子',
          body: text,
          likes: 0,
          liked: false,
          createdAt: Date.now()
        });
        posts = posts.slice(0, 30);
        writeJSON(LS.forum, posts);
        document.getElementById('forumTitle').value = '';
        body.value = '';
        if (count) count.textContent = '0 / 600';
        renderForum();
        A.toast('已发布到论坛（仅本地可见）', 'success');
      });
    }

    if (list) {
      list.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-pact]');
        if (!btn) return;
        var card = btn.closest('[data-post]');
        if (!card) return;
        var id = card.getAttribute('data-post');
        var post = posts.find(function (item) { return item.id === id; });
        if (!post) return;
        if (btn.getAttribute('data-pact') === 'like') {
          post.liked = !post.liked;
          post.likes += post.liked ? 1 : -1;
          writeJSON(LS.forum, posts);
          renderForum();
        } else if (btn.getAttribute('data-pact') === 'delete') {
          posts = posts.filter(function (item) { return item.id !== id; });
          writeJSON(LS.forum, posts);
          renderForum();
        }
      });
    }
  }

  function formatTime(value) {
    var diff = Date.now() - Number(value || 0);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return new Date(Number(value)).toLocaleDateString('zh-CN');
  }

  function renderForum() {
    posts = posts.length ? posts : readJSON(LS.forum, []);
    var list = document.getElementById('forumList');
    if (!list) return;

    if (!posts.length) {
      list.innerHTML = '<p class="model-empty">还没有帖子<br>发布第一条提示词分享吧</p>';
      return;
    }

    list.innerHTML = posts.map(function (post) {
      return '<article class="hm-forum-post" data-post="' + esc(post.id) + '">' +
        '<h4>' + esc(post.title) + '</h4>' +
        '<p>' + esc(post.body || '（无正文）') + '</p>' +
        '<div class="hm-forum-meta">' +
          '<span>' + formatTime(post.createdAt) + '</span>' +
          '<button data-pact="like" class="' + (post.liked ? 'is-liked' : '') + '">♥ ' + post.likes + '</button>' +
          '<button data-pact="delete">删除</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ---------------- 工具 ---------------- */
  function bindTools() {
    document.querySelectorAll('.hm-tool-card').forEach(function (card) {
      card.addEventListener('click', function () { runTool(card.getAttribute('data-tool')); });
    });
  }

  function runTool(tool) {
    if (tool === 'toolvideo') { A.switchView('toolvideo'); return; }
    if (tool === 'toolimage') { A.switchView('toolimage'); return; }
    if (tool === 'toolreference') { A.switchView('toolreference'); return; }
    if (tool === 'tooltraining') { A.switchView('tooltraining'); return; }
    if (tool === 'toolrestore') { A.switchView('toolrestore'); return; }
    if (tool === 'toolworkflow') { A.switchView('toolworkflow'); return; }
    if (tool === 'toolopenvideo') { A.switchView('toolopenvideo'); return; }
    if (tool === 'tooltoon') { A.switchView('tooltoon'); return; }
    if (tool === 'translate') return translateTool();
    if (tool === 'inspire') { A.els.inspireBtn.click(); return; }
    if (tool === 'presets') { openPresetModal(); return; }
    if (tool === 'assets') { openAssetModal(); return; }
    if (tool === 'batch') { batchDownload(); return; }
    if (tool === 'clean') { cleanLocal(); return; }
    if (tool === 'api') { A.openApiModal(); return; }
    if (tool === 'help') {
      var helpBtn = document.getElementById('helpBtn');
      if (helpBtn) helpBtn.click();
    }
  }

  async function translateTool() {
    var text = A.els.promptInput.value.trim();
    if (!text) {
      A.toast('先在描述框写一段中文，再使用智能翻译', 'error');
      A.switchView('create');
      A.els.promptInput.focus();
      return;
    }
    if (!/[\u4e00-\u9fff]/.test(text)) {
      A.toast('当前描述已经是英文，无需翻译', 'info');
      return;
    }

    A.switchView('create');
    A.toast('正在翻译…', 'info');
    try {
      var out = api && api.online ? await api.translate(text) : await A.translatePrompt(text);
      if (!out) throw new Error('翻译结果为空');
      A.els.promptInput.value = out;
      A.updateCharCount();
      A.toast('已翻译为英文提示词', 'success');
    } catch (err) {
      A.toast('翻译失败：' + ((err && err.message) || '请稍后重试'), 'error');
    }
  }

  function batchDownload() {
    var works = (A.state.works || []).slice(0, 12);
    if (!works.length) {
      A.toast('还没有可以下载的作品', 'info');
      return;
    }
    A.toast('开始批量下载 ' + works.length + ' 个作品', 'info');
    works.forEach(function (work, index) {
      setTimeout(function () {
        A.downloadImage(work.url || work.thumb, A.fileNameFor(work));
      }, index * 700);
    });
  }

  function cleanLocal() {
    if (!window.confirm('清理本地作品与写作草稿？可从「设置 → 云同步 → 恢复本地备份」找回最近 3 次快照。')) return;
    if (window.HMSync && window.HMSync.snapshotWorks) window.HMSync.snapshotWorks('clean-local');
    A.state.works = [];
    A.saveWorks();
    A.renderWorks();
    try { localStorage.removeItem(LS.draft); } catch (err) { /* 忽略 */ }
    var input = document.getElementById('writingInput');
    if (input) input.value = '';
    var count = document.getElementById('writingCount');
    if (count) count.textContent = '0 / 6000';
    A.toast('本地作品与草稿已清理', 'success');
  }

  /* ---------------- 初始化 ---------------- */
  function readPrefs() {
    applyTheme(readJSON(LS.theme, 'dark'));
    applySeason(readJSON(LS.season, 'none'));
    loadCredit();

    var saved = readJSON(LS.mode, null);
    if (saved) {
      state.mode = ['image', 'video', 'audio'].indexOf(saved.mode) >= 0 ? saved.mode : 'image';
      state.duration = saved.duration === 10 ? 10 : 5;
      state.voice = saved.voice || 'alloy';
      state.audioFormat = saved.audioFormat === 'mp3' ? 'mp3' : 'wav';
      state.sampleRate = Number(saved.sampleRate) === 24000 ? 24000 : 48000;
    } else {
      state.mode = 'image';
    }
    persistMode();
  }

  function syncChoiceLabels() {
    var durationChip = document.getElementById('durationChipText');
    if (durationChip) durationChip.textContent = state.duration + '秒';
    var voiceChip = document.getElementById('voiceChipText');
    if (voiceChip) voiceChip.textContent = '音色 · ' + state.voice;
    var fmt = document.getElementById('audioFmtText');
    if (fmt) fmt.textContent = String(state.audioFormat).toUpperCase();
    var rate = document.getElementById('sampleRateText');
    if (rate) rate.textContent = (Number(state.sampleRate) / 1000) + 'k';

    document.querySelectorAll('#durationMenu [data-duration]').forEach(function (el) {
      el.classList.toggle('is-active', Number(el.getAttribute('data-duration')) === state.duration);
    });
    document.querySelectorAll('#voiceMenu [data-voice]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-voice') === state.voice);
    });
    document.querySelectorAll('#audioFmtMenu [data-format]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-format') === state.audioFormat);
    });
    document.querySelectorAll('#sampleRateMenu [data-rate]').forEach(function (el) {
      el.classList.toggle('is-active', Number(el.getAttribute('data-rate')) === Number(state.sampleRate));
    });
  }

  async function init() {
    readPrefs();
    bindRail();
    bindHomeSwitch();
    initHomeMode();
    bindRailToggle();
    initRailCollapsed();
    bindRailCutline();
    initRailDragSort();
    bindTheme();
    startSeasonAmbient();
    bindModes();
    bindPresetModal();
    bindAssetUI();
    bindWriting();
    bindForum();
    bindEditor();
    bindTools();

    syncChoiceLabels();
    setMode(state.mode);
    updateCredit();
    renderForum();
    renderAssetPage();
    renderAssetModal();
    loadDraft();

    /* 初始化视频/音频模型菜单（先用内置兜底，后端在线时覆盖） */
    renderVideoModels();
    renderAudioModels();
    renderDurationControls();
    renderVoiceMenu();
    bindDurationSlider();

    await detectBackend();
    await loadAssets();
    await loadMediaCatalog();

    /* 导演台初始化 */
    if (window.HMDirector) {
      try { window.HMDirector.init(); } catch (e) { console.error('[Director] init failed', e); }
    }

    /* 3D 导演台初始化 */
    if (window.HMDirector3D) {
      try { window.HMDirector3D.init(); } catch (e) { console.error('[Director3D] init failed', e); }
    }

    /* 右侧 AI 聊天面板初始化 */
    if (window.HMChat) {
      try { window.HMChat.init(); } catch (e) { console.error('[Chat] init failed', e); }
    }

    /* 初音未来 · 胶片悬浮音乐播放器插件：默认不自动挂载，
     * 由顶栏「虚拟形象」按钮按需创建 / 收起（见 bindAvatarToggle） */
  }

  window.HMUI = {
    init: init,
    onView: onView,
    onRenderWorks: onRenderWorks,
    runMedia: runMedia,
    setMode: setMode,
    openPresetModal: openPresetModal,
    openAssetModal: openAssetModal,
    setHomeMode: setHomeMode,
    openEditor: function () {
      var expand = document.getElementById('expandPrompt');
      if (expand) expand.click();
    },
    importAssets: function (files) { return handleFiles(files); }
  };

  init();
})();

/* =============================================================
 * 企划模块（HMPlan）
 * 热榜 / 排行榜 / 搜索 / 日式动漫企划书
 * ============================================================= */
(function () {
  'use strict';
  var api = window.HM && window.HM.api;
  var A = window.HMApp;
  if (!api || !A) { console.warn('[HMPlan] 缺少 api 或 A'); return; }

  var state = {
    currentPlatform: 'douyin',
    currentCategory: 'anime',
    currentMainTab: 'trending',
    autoRefresh: true,
    autoRefreshTimer: null,
    trendingCache: {},
    rankingCache: {},
    // 企划书状态
    proposals: [],
    editingProposal: null,   // { id, ...data }
    editingStep: 'concept',
  };

  var PLATFORM_EMOJI = { douyin: '🎵', weibo: '🔴', zhihu: '💡', bilibili: '📺', baidu: '🔍', toutiao: '📰', douban: '📚' };
  var PLATFORM_NAME = { douyin: '抖音', weibo: '微博', zhihu: '知乎', bilibili: 'B站', baidu: '百度', toutiao: '头条', douban: '豆瓣' };
  var CAT_EMOJI = { anime: '🎬', movie: '🎥', game: '🎮', music: '🎵', tech: '💻', animeip: '🌟' };

  function $(id) { return document.getElementById(id); }

  function fmtHeat(v) {
    var n = Number(v) || 0;
    if (n >= 10000000) return (n / 10000000).toFixed(1) + '千万';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try { var d = new Date(iso); } catch (e) { return iso; }
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function setFresh(label, iso) {
    var el = $(label);
    if (el) el.textContent = label === 'planRankingFresh' ? '构建时间：' + fmtTime(iso) : '上次刷新：' + fmtTime(iso);
  }

  /* ============ 主 Tab 切换 ============ */
  function bindMainTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-ptab]');
      if (!tab) return;
      var ptab = tab.getAttribute('data-ptab');
      document.querySelectorAll('.hm-plan-main-tab').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      document.querySelectorAll('.hm-plan-section').forEach(function (s) {
        s.classList.toggle('is-active', s.id === 'plan' + ptab.charAt(0).toUpperCase() + ptab.slice(1));
      });
      state.currentMainTab = ptab;
      // 按需加载
      if (ptab === 'ranking' && $(state.currentCategory + '_rank') === null) {
        loadRanking(state.currentCategory);
      }
      if (ptab === 'proposal') loadProposalList();
      if (ptab === 'trending') loadTrending(state.currentPlatform);
    });
  }

  /* ============ 平台 Tab ============ */
  function bindPlatformTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-platform]');
      if (!tab || !tab.closest('.hm-plan-platform-tabs')) return;
      var plat = tab.getAttribute('data-platform');
      state.currentPlatform = plat;
      document.querySelectorAll('.hm-plan-platform-tabs .hm-plan-plat').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      loadTrending(plat);
    });
  }

  /* ============ 类别 Tab ============ */
  function bindCategoryTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-category]');
      if (!tab || !tab.closest('.hm-plan-cat-tabs')) return;
      var cat = tab.getAttribute('data-category');
      state.currentCategory = cat;
      document.querySelectorAll('.hm-plan-cat-tabs .hm-plan-cat').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      loadRanking(cat);
    });
  }

  /* ============ 热榜 ============ */
  function renderTrendingList(items, platform) {
    var list = $('planTrendingList');
    if (!list) return;
    list.innerHTML = '';
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="hm-plan-empty-state">暂无热榜数据</div>';
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement('a');
      row.className = 'hm-plan-trend-row';
      row.href = it.url || '#';
      row.target = '_blank';
      row.rel = 'noopener';
      var rankCls = it.rank <= 3 ? 'hm-plan-rank-top' : 'hm-plan-rank-num';
      var rankHtml = it.rank <= 3
        ? '<span class="hm-plan-rank-medal">' + ['🥇', '🥈', '🥉'][it.rank - 1] + '</span>'
        : '<span class="' + rankCls + '">' + it.rank + '</span>';
      var catHtml = it.category ? '<span class="hm-plan-tag">' + it.category + '</span>' : '';
      var heatHtml = it.heat ? '<span class="hm-plan-heat">🔥 ' + fmtHeat(it.heat) + '</span>' : '';
      row.innerHTML = rankHtml +
        '<div class="hm-plan-trend-body">' +
          '<div class="hm-plan-trend-title">' + (it.title || '').replace(/[<>]/g, '') + '</div>' +
          '<div class="hm-plan-trend-meta">' + catHtml + heatHtml + '</div>' +
        '</div>' +
        (it.image ? '<img class="hm-plan-trend-img" src="' + it.image + '" alt="">' : '');
      list.appendChild(row);
    });
  }

  async function loadTrending(platform) {
    var empty = $('planTrendingEmpty');
    var list = $('planTrendingList');
    if (empty) empty.hidden = false;
    if (list) list.innerHTML = '';
    try {
      var data = await api.planTrending(platform);
      state.trendingCache[platform] = data;
      renderTrendingList(data.items || [], platform);
      setFresh('planTrendingFresh', data.fetchedAt);
      if (data.source === 'fallback') {
        A.toast && A.toast('⚠️ 当前使用本地备用数据（远端抓取失败）', 'warn');
      }
    } catch (err) {
      if (list) list.innerHTML = '<div class="hm-plan-empty-state">加载失败：' + (err && err.message || err) + '</div>';
    } finally {
      if (empty) empty.hidden = true;
    }
  }

  function bindTrendingRefresh() {
    var btn = $('planTrendingRefresh');
    if (!btn) return;
    btn.addEventListener('click', function () {
      loadTrending(state.currentPlatform);
    });
    var autoBtn = $('planAutoRefresh');
    if (!autoBtn) return;
    autoBtn.addEventListener('click', function () {
      state.autoRefresh = !state.autoRefresh;
      autoBtn.textContent = state.autoRefresh ? '⏸ 自动刷新' : '▶ 自动刷新';
      if (state.autoRefresh) startAutoRefresh(); else stopAutoRefresh();
    });
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshTimer = setInterval(function () {
      if (state.currentMainTab === 'trending') {
        loadTrending(state.currentPlatform);
      }
    }, 5 * 60 * 1000); // 5分钟
  }
  function stopAutoRefresh() {
    if (state.autoRefreshTimer) { clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
  }

  /* ============ 排行榜 ============ */
  function renderRankingList(items, cat) {
    var list = $('planRankingList');
    if (!list) return;
    list.innerHTML = '';
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="hm-plan-empty-state">暂无排行数据</div>';
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement('a');
      row.className = 'hm-plan-rank-row';
      row.href = it.url || '#';
      row.target = '_blank';
      row.rel = 'noopener';
      var rankCls = it.rank <= 3 ? 'hm-plan-rank-top' : 'hm-plan-rank-num';
      var rankHtml = it.rank <= 3
        ? '<span class="hm-plan-rank-medal">' + ['🥇', '🥈', '🥉'][it.rank - 1] + '</span>'
        : '<span class="' + rankCls + '">' + it.rank + '</span>';
      var platformHtml = it._platformName ? '<span class="hm-plan-plat-badge hm-plan-plat-' + it._platform + '">' + PLATFORM_EMOJI[it._platform] + ' ' + it._platformName + '</span>' : '';
      var catHtml = it.category ? '<span class="hm-plan-tag">' + it.category + '</span>' : '';
      var heatHtml = it.heat ? '<span class="hm-plan-heat">🔥 ' + fmtHeat(it.heat) + '</span>' : '';
      row.innerHTML = rankHtml +
        '<div class="hm-plan-rank-body">' +
          '<div class="hm-plan-rank-title">' + (it.title || '').replace(/[<>]/g, '') + '</div>' +
          '<div class="hm-plan-rank-meta">' + platformHtml + catHtml + heatHtml + '</div>' +
        '</div>' +
        (it.image ? '<img class="hm-plan-rank-img" src="' + it.image + '" alt="">' : '');
      list.appendChild(row);
    });
  }

  async function loadRanking(cat, refresh) {
    var list = $('planRankingList');
    if (list) list.innerHTML = '<div class="hm-plan-empty-state">⏳ 正在聚合多平台数据...</div>';
    try {
      var data = await api.planRanking(cat, refresh);
      state.rankingCache[cat] = data;
      renderRankingList(data.items || [], cat);
      setFresh('planRankingFresh', data.builtAt);
    } catch (err) {
      if (list) list.innerHTML = '<div class="hm-plan-empty-state">加载失败：' + (err && err.message || err) + '</div>';
    }
  }

  function bindRankingRefresh() {
    var btn = $('planRankingRefresh');
    if (!btn) return;
    btn.addEventListener('click', function () {
      loadRanking(state.currentCategory, true);
    });
  }

  /* ============ 搜索 ============ */
  async function doSearch() {
    var q = $('planSearchInput').value.trim();
    var category = $('planSearchCategory').value;
    var platform = $('planSearchPlatform').value;
    var results = $('planSearchResults');
    if (!results) return;
    if (!q) {
      results.innerHTML = '<div class="hm-plan-search-placeholder"><div class="hm-plan-search-emoji">🔎</div><h3>输入关键词开始搜索</h3><p>例如：AI 动漫、新海诚、ComfyUI、国创</p></div>';
      return;
    }
    results.innerHTML = '<div class="hm-plan-empty-state">⏳ 正在搜索...</div>';
    try {
      var data = await api.planSearch(q, category, platform);
      var items = (data && data.trending) || [];
      if (items.length === 0) {
        results.innerHTML = '<div class="hm-plan-empty-state">未找到与「' + q + '」相关的热榜内容</div>';
        return;
      }
      var html = '<div class="hm-plan-search-meta">找到 <b>' + items.length + '</b> 条相关热榜';
      if (data.category) html += ' · 类别：' + CAT_EMOJI[data.category];
      if (data.platform) html += ' · 平台：' + PLATFORM_EMOJI[data.platform];
      html += '</div><div class="hm-plan-search-list">';
      items.forEach(function (it) {
        html += '<a class="hm-plan-search-item" href="' + (it.url || '#') + '" target="_blank" rel="noopener">' +
          '<span class="hm-plan-plat-badge hm-plan-plat-' + it.platform + '">' + PLATFORM_EMOJI[it.platform] + ' ' + it.platformName + '</span>' +
          '<div class="hm-plan-search-title">' + (it.title || '').replace(/[<>]/g, '') + '</div>' +
          '<span class="hm-plan-heat">🔥 ' + fmtHeat(it.heat) + '</span>' +
        '</a>';
      });
      html += '</div>';
      results.innerHTML = html;
    } catch (err) {
      results.innerHTML = '<div class="hm-plan-empty-state">搜索失败：' + (err && err.message || err) + '</div>';
    }
  }

  function bindSearch() {
    var btn = $('planSearchBtn');
    if (btn) btn.addEventListener('click', doSearch);
    var input = $('planSearchInput');
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch();
    });
  }

  /* ============ 企划书 CRUD ============ */
  function emptyProposal() {
    return {
      title: '', category: 'anime', tags: [], status: 'draft',
      concept: {
        titleJp: '', titleEn: '', logline: '', tagline: '',
        genre: '奇幻', targetAge: '全年龄',
        runtime: '24分钟/集', episodes: 12, broadcastPeriod: '', budget: '',
      },
      worldview: { setting: '', era: '', location: '', worldview: '', powerSystem: '', themes: '' },
      characters: [], sellingPoints: [],
      promotion: { teaser: '', pv: '', socialMedia: '', events: '', collaborations: '', merch: '' },
      schedule: [],
    };
  }

  async function loadProposalList() {
    var list = $('planProposalList');
    if (!list) return;
    try {
      var data = await api.listProposals();
      state.proposals = (data && data.items) || [];
      if (state.proposals.length === 0) {
        list.innerHTML = '<div class="hm-plan-proposal-empty">' +
          '<div class="hm-plan-search-emoji">📝</div>' +
          '<h3>还没有企划书</h3>' +
          '<p>点击「＋ 新建企划书」开始撰写你的日式动漫企划</p>' +
          '<button class="hm-pill hm-pill-primary" id="planNewProposalEmpty">＋ 新建企划书</button>' +
        '</div>';
        var emptyBtn = $('planNewProposalEmpty');
        if (emptyBtn) emptyBtn.addEventListener('click', createNewProposal);
        return;
      }
      var html = '';
      state.proposals.forEach(function (p) {
        html += '<div class="hm-plan-proposal-card" data-pid="' + p.id + '">' +
          '<div class="hm-plan-proposal-card-head">' +
            '<h4>' + (p.title || '未命名').replace(/[<>]/g, '') + '</h4>' +
            '<span class="hm-plan-plat-badge hm-plan-plat-' + p.category + '">' + (CAT_EMOJI[p.category] || '📝') + '</span>' +
          '</div>' +
          '<p>' + ((p.logline || '').replace(/[<>]/g, '') || '—').slice(0, 80) + '</p>' +
          '<div class="hm-plan-proposal-card-meta">' +
            '<span>集数: ' + (p.episodes || '—') + '</span>' +
            '<span>更新: ' + fmtTime(p.updatedAt) + '</span>' +
          '</div>' +
          '<div class="hm-plan-proposal-card-actions">' +
            '<button class="hm-pill" data-act="open">✏️ 编辑</button>' +
            '<button class="hm-pill" data-act="del">🗑 删除</button>' +
          '</div>' +
        '</div>';
      });
      list.innerHTML = html;
      list.querySelectorAll('.hm-plan-proposal-card').forEach(function (card) {
        var pid = card.getAttribute('data-pid');
        card.querySelectorAll('[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var act = btn.getAttribute('data-act');
            if (act === 'open') openProposal(pid);
            if (act === 'del') deleteProposal(pid, card);
          });
        });
        card.addEventListener('click', function () { openProposal(pid); });
      });
    } catch (err) {
      list.innerHTML = '<div class="hm-plan-empty-state">加载失败：' + (err && err.message || err) + '</div>';
    }
  }

  async function createNewProposal() {
    var title = window.prompt('企划书标题？', '');
    if (title === null) return;
    var prop = emptyProposal();
    prop.title = title || '未命名企划';
    try {
      var data = await api.createProposal(prop);
      if (data && data.proposal) {
        state.editingProposal = data.proposal;
        state.editingStep = 'concept';
        showProposalEditor();
      }
    } catch (err) {
      A.toast && A.toast('创建失败: ' + (err && err.message || err), 'error');
    }
  }

  async function openProposal(id) {
    try {
      var data = await api.getProposal(id);
      if (data && data.proposal) {
        state.editingProposal = data.proposal;
        state.editingStep = 'concept';
        showProposalEditor();
      }
    } catch (err) {
      A.toast && A.toast('加载失败: ' + (err && err.message || err), 'error');
    }
  }

  async function deleteProposal(id, cardEl) {
    if (!window.confirm('确定删除这个企划书？此操作不可恢复。')) return;
    try {
      await api.deleteProposal(id);
      A.toast && A.toast('已删除', 'success');
      if (cardEl) cardEl.remove();
      loadProposalList();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  function showProposalEditor() {
    var list = $('planProposalList');
    var editor = $('planProposalEditor');
    var title = $('planProposalTitle');
    var saveBtn = $('planSaveProposal');
    var backBtn = $('planProposalBack');
    var newBtn = $('planNewProposal');
    if (list) list.hidden = true;
    if (editor) editor.hidden = false;
    if (title) title.textContent = '📝 ' + (state.editingProposal.title || '未命名企划');
    if (saveBtn) saveBtn.hidden = false;
    if (backBtn) backBtn.hidden = false;
    if (newBtn) newBtn.hidden = true;
    renderProposalForm();
  }

  function showProposalList() {
    var list = $('planProposalList');
    var editor = $('planProposalEditor');
    var title = $('planProposalTitle');
    var saveBtn = $('planSaveProposal');
    var backBtn = $('planProposalBack');
    var newBtn = $('planNewProposal');
    if (list) list.hidden = false;
    if (editor) editor.hidden = true;
    if (title) title.textContent = '📝 我的企划书';
    if (saveBtn) saveBtn.hidden = true;
    if (backBtn) backBtn.hidden = true;
    if (newBtn) newBtn.hidden = false;
    state.editingProposal = null;
    loadProposalList();
  }

  function navStep(step) {
    state.editingStep = step;
    document.querySelectorAll('.hm-plan-proposal-nav a').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-pstep') === step);
    });
    document.querySelectorAll('.hm-plan-pstep').forEach(function (s) {
      s.hidden = s.id !== ('planPstep-' + step);
    });
    // 首次进入角色/卖点/排期时渲染空列表
    if (step === 'characters') renderCharList();
    if (step === 'selling') renderSpList();
    if (step === 'schedule') renderSchedList();
  }

  function bindStepNav() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('.hm-plan-proposal-nav a');
      if (!a) return;
      var step = a.getAttribute('data-pstep');
      navStep(step);
    });
  }

  /* ----- 表单数据绑定 ----- */
  function getProp(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setProp(obj, path, val) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function renderProposalForm() {
    var data = state.editingProposal;
    if (!data) return;
    // 初始化嵌套对象
    data.concept = Object.assign({ titleJp: '', titleEn: '', logline: '', tagline: '', genre: '奇幻', targetAge: '全年龄', runtime: '24分钟/集', episodes: 12, broadcastPeriod: '', budget: '' }, data.concept || {});
    data.worldview = Object.assign({ setting: '', era: '', location: '', worldview: '', powerSystem: '', themes: '' }, data.worldview || {});
    data.promotion = Object.assign({ teaser: '', pv: '', socialMedia: '', events: '', collaborations: '', merch: '' }, data.promotion || {});
    // 填充 input/textarea/select
    var root = $('planProposalEditor');
    if (!root) return;
    root.querySelectorAll('[data-prop]').forEach(function (el) {
      var prop = el.getAttribute('data-prop');
      var val = getProp(data, prop);
      if (val === undefined || val === null) val = '';
      if (el.tagName === 'SELECT') {
        // 确保选项存在
        var found = false;
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === String(val)) { found = true; break; }
        }
        if (!found && val) {
          var opt = document.createElement('option');
          opt.value = String(val); opt.textContent = String(val);
          el.appendChild(opt);
        }
        el.value = String(val);
      } else if (el.type === 'number') {
        el.value = val === '' ? '' : Number(val);
      } else {
        el.value = val;
      }
      // 绑定 input 事件
      el.oninput = function () {
        var v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
        setProp(data, prop, v);
      };
    });
    navStep('concept');
  }

  /* ----- 角色列表 ----- */
  function renderCharList() {
    var list = $('planCharList');
    if (!list) return;
    var chars = state.editingProposal.characters || [];
    list.innerHTML = '';
    if (chars.length === 0) {
      list.innerHTML = '<div class="hm-plan-empty-state">暂无角色，点击下方按钮添加主角 / 配角</div>';
      return;
    }
    chars.forEach(function (c, idx) {
      var div = document.createElement('div');
      div.className = 'hm-plan-char-card';
      div.innerHTML =
        '<div class="hm-plan-char-head"><b>角色 #' + (idx + 1) + '</b>' +
          '<button class="hm-pill hm-pill-mini" data-del="' + idx + '">删除</button>' +
        '</div>' +
        '<div class="hm-plan-grid-2">' +
          '<label class="hm-plan-field"><span>日文名</span><input data-char="' + idx + '" data-cprop="nameJp" value="' + (c.nameJp || '') + '"></label>' +
          '<label class="hm-plan-field"><span>中文名</span><input data-char="' + idx + '" data-cprop="nameCn" value="' + (c.nameCn || '') + '"></label>' +
          '<label class="hm-plan-field"><span>年龄</span><input data-char="' + idx + '" data-cprop="age" value="' + (c.age || '') + '"></label>' +
          '<label class="hm-plan-field"><span>性别</span><select data-char="' + idx + '" data-cprop="gender">' +
            '<option value="">—</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option>' +
          '</select></label>' +
          '<label class="hm-plan-field"><span>角色定位</span><input data-char="' + idx + '" data-cprop="role" placeholder="主角 / 女主 / 反派 / 老师..." value="' + (c.role || '') + '"></label>' +
          '<label class="hm-plan-field"><span>声优（CV）</span><input data-char="' + idx + '" data-cprop="seiyuu" value="' + (c.seiyuu || '') + '"></label>' +
        '</div>' +
        '<label class="hm-plan-field"><span>性格描述（性格）</span><textarea data-char="' + idx + '" data-cprop="personality" rows="2">' + (c.personality || '') + '</textarea></label>' +
        '<label class="hm-plan-field"><span>外貌特征（外見）</span><textarea data-char="' + idx + '" data-cprop="appearance" rows="2">' + (c.appearance || '') + '</textarea></label>' +
        '<label class="hm-plan-field"><span>口头禅（口癖）</span><input data-char="' + idx + '" data-cprop="catchphrase" value="' + (c.catchphrase || '') + '"></label>';
      list.appendChild(div);
    });
    // 绑定事件
    list.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        chars.splice(Number(btn.getAttribute('data-del')), 1);
        state.editingProposal.characters = chars;
        renderCharList();
      });
    });
    list.querySelectorAll('[data-char]').forEach(function (el) {
      var cIdx = Number(el.getAttribute('data-char'));
      var cProp = el.getAttribute('data-cprop');
      var c = chars[cIdx];
      if (el.tagName === 'SELECT') {
        // ensure option
        for (var i = 0; i < el.options.length; i++) if (el.options[i].value === String(c[cProp] || '')) el.selectedIndex = i;
      }
      el.oninput = function () { c[cProp] = el.value; };
    });
  }

  function bindCharAdd() {
    var btn = $('planCharAdd');
    if (!btn) return;
    btn.addEventListener('click', function () {
      state.editingProposal.characters = state.editingProposal.characters || [];
      state.editingProposal.characters.push({ nameJp: '', nameCn: '', age: '', gender: '', role: '', personality: '', appearance: '', seiyuu: '', catchphrase: '' });
      renderCharList();
    });
  }

  /* ----- 卖点列表 ----- */
  function renderSpList() {
    var list = $('planSpList');
    if (!list) return;
    var items = state.editingProposal.sellingPoints || [];
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div class="hm-plan-empty-state">暂无卖点，添加 2-5 条核心卖点帮助企划通过</div>';
      return;
    }
    items.forEach(function (sp, idx) {
      var div = document.createElement('div');
      div.className = 'hm-plan-sp-card';
      div.innerHTML =
        '<div class="hm-plan-char-head"><b>卖点 #' + (idx + 1) + '</b>' +
          '<button class="hm-pill hm-pill-mini" data-sdel="' + idx + '">删除</button>' +
        '</div>' +
        '<label class="hm-plan-field"><span>卖点标题</span><input data-sp="' + idx + '" data-sprop="point" value="' + (sp.point || '') + '" placeholder="例：日本一线声优阵容"></label>' +
        '<label class="hm-plan-field"><span>详细描述</span><textarea data-sp="' + idx + '" data-sprop="description" rows="2" placeholder="为什么这一点会吸引观众...">' + (sp.description || '') + '</textarea></label>' +
        '<label class="hm-plan-field"><span>目标受众</span><input data-sp="' + idx + '" data-sprop="targetAudience" value="' + (sp.targetAudience || '') + '" placeholder="例：18-30岁女性 / 机战爱好者"></label>';
      list.appendChild(div);
    });
    list.querySelectorAll('[data-sdel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        items.splice(Number(btn.getAttribute('data-sdel')), 1);
        state.editingProposal.sellingPoints = items;
        renderSpList();
      });
    });
    list.querySelectorAll('[data-sp]').forEach(function (el) {
      var sIdx = Number(el.getAttribute('data-sp'));
      var sProp = el.getAttribute('data-sprop');
      el.oninput = function () { items[sIdx][sProp] = el.value; };
    });
  }
  function bindSpAdd() {
    var btn = $('planSpAdd');
    if (!btn) return;
    btn.addEventListener('click', function () {
      state.editingProposal.sellingPoints = state.editingProposal.sellingPoints || [];
      state.editingProposal.sellingPoints.push({ point: '', description: '', targetAudience: '' });
      renderSpList();
    });
  }

  /* ----- 排期列表 ----- */
  function renderSchedList() {
    var list = $('planSchedList');
    if (!list) return;
    var items = state.editingProposal.schedule || [];
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div class="hm-plan-empty-state">暂无排期，添加制作阶段和时间节点</div>';
      return;
    }
    items.forEach(function (s, idx) {
      var div = document.createElement('div');
      div.className = 'hm-plan-sched-card';
      div.innerHTML =
        '<div class="hm-plan-char-head"><b>阶段 #' + (idx + 1) + '</b>' +
          '<button class="hm-pill hm-pill-mini" data-schdel="' + idx + '">删除</button>' +
        '</div>' +
        '<div class="hm-plan-grid-2">' +
          '<label class="hm-plan-field"><span>阶段（フェーズ）</span><input data-sch="' + idx + '" data-schprop="phase" value="' + (s.phase || '') + '" placeholder="企画 / 脚本 / 设计 / 演出 / 作画 / 后期..."></label>' +
          '<label class="hm-plan-field"><span>负责人</span><input data-sch="' + idx + '" data-schprop="owner" value="' + (s.owner || '') + '"></label>' +
          '<label class="hm-plan-field"><span>开始日期</span><input data-sch="' + idx + '" data-schprop="startDate" value="' + (s.startDate || '') + '" placeholder="2025-04-01"></label>' +
          '<label class="hm-plan-field"><span>结束日期</span><input data-sch="' + idx + '" data-schprop="endDate" value="' + (s.endDate || '') + '" placeholder="2025-06-30"></label>' +
        '</div>' +
        '<label class="hm-plan-field"><span>交付物</span><input data-sch="' + idx + '" data-schprop="deliverable" value="' + (s.deliverable || '') + '" placeholder="剧本初稿 / 角色定稿 / 分镜 / 动画 / 成品"></label>';
      list.appendChild(div);
    });
    list.querySelectorAll('[data-schdel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        items.splice(Number(btn.getAttribute('data-schdel')), 1);
        state.editingProposal.schedule = items;
        renderSchedList();
      });
    });
    list.querySelectorAll('[data-sch]').forEach(function (el) {
      var schIdx = Number(el.getAttribute('data-sch'));
      var schProp = el.getAttribute('data-schprop');
      el.oninput = function () { items[schIdx][schProp] = el.value; };
    });
  }
  function bindSchedAdd() {
    var btn = $('planSchedAdd');
    if (!btn) return;
    btn.addEventListener('click', function () {
      state.editingProposal.schedule = state.editingProposal.schedule || [];
      state.editingProposal.schedule.push({ phase: '', startDate: '', endDate: '', deliverable: '', owner: '' });
      renderSchedList();
    });
  }

  /* ----- 保存 / 新建 / 返回 ----- */
  function bindProposalActions() {
    var newBtn = $('planNewProposal');
    if (newBtn) newBtn.addEventListener('click', createNewProposal);
    var saveBtn = $('planSaveProposal');
    if (saveBtn) saveBtn.addEventListener('click', async function () {
      if (!state.editingProposal) return;
      try {
        // 标题从 concept.titleJp 或 titleEn 填充
        var prop = state.editingProposal;
        if (!prop.title) prop.title = prop.concept.titleJp || prop.concept.titleEn || '未命名企划';
        if (prop.id) {
          await api.updateProposal(prop.id, { proposal: prop, title: prop.title });
          A.toast && A.toast('✅ 已保存', 'success');
        } else {
          var data = await api.createProposal({ proposal: prop, title: prop.title });
          if (data && data.proposal) {
            state.editingProposal = data.proposal;
            prop.id = data.proposal.id;
          }
          A.toast && A.toast('✅ 已保存', 'success');
        }
      } catch (err) {
        A.toast && A.toast('保存失败: ' + (err && err.message || err), 'error');
      }
    });
    var backBtn = $('planProposalBack');
    if (backBtn) backBtn.addEventListener('click', showProposalList);
  }

  /* ============ 主入口 ============ */
  function enter() {
    if (state.currentMainTab === 'trending') {
      loadTrending(state.currentPlatform);
    } else if (state.currentMainTab === 'ranking') {
      loadRanking(state.currentCategory);
    } else if (state.currentMainTab === 'proposal') {
      showProposalList();
    }
    if (state.autoRefresh) startAutoRefresh();
  }

  function init() {
    bindMainTabs();
    bindPlatformTabs();
    bindCategoryTabs();
    bindTrendingRefresh();
    bindRankingRefresh();
    bindSearch();
    bindStepNav();
    bindProposalActions();
    bindCharAdd();
    bindSpAdd();
    bindSchedAdd();
  }

  init();
  window.HMPlan = { enter: enter, state: state };
})();

/* =============================================================
 * 剧本模块（HMScript）
 * 剧本列表 + 场次/镜头/对白编辑器 + 角色 + 大纲 + 版本快照 + 导出
 * ============================================================= */
(function () {
  'use strict';
  var api = window.HM && window.HM.api;
  var A = window.HMApp;
  if (!api || !A) { console.warn('[HMScript] 缺少 api 或 A'); return; }

  var state = {
    scripts: [],          // 列表
    editing: null,        // 当前编辑的完整 script 对象
    activeSceneId: null,  // 左侧选中的场次
    editingSideTab: 'scenes',
  };

  function $(id) { return document.getElementById(id); }
  function uid() { return 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  /* ========== 入口 ========== */
  function enter() {
    showListView();
    loadList();
  }

  /* ========== 列表视图 ========== */
  function showListView() {
    $('scriptListView').hidden = false;
    $('scriptEditorView').hidden = true;
    $('scriptBackBtn').hidden = true;
    $('scriptSaveBtn').hidden = true;
    $('scriptSnapshotBtn').hidden = true;
    $('scriptExportWrap').hidden = true;
    $('scriptStatusTag').hidden = true;
    $('scriptNewBtn').hidden = false;
    $('scriptPageTitle').textContent = '剧本';
  }

  function showEditorView() {
    $('scriptListView').hidden = true;
    $('scriptEditorView').hidden = false;
    $('scriptBackBtn').hidden = false;
    $('scriptSaveBtn').hidden = false;
    $('scriptSnapshotBtn').hidden = false;
    $('scriptExportWrap').hidden = false;
    $('scriptNewBtn').hidden = true;
  }

  function fmtStatus(s) {
    return { draft: '草稿', writing: '撰写中', done: '已完成' }[s] || s;
  }

  function renderList() {
    var grid = $('scriptGrid');
    var empty = $('scriptEmpty');
    if (!grid) return;
    grid.innerHTML = '';
    if (!state.scripts || state.scripts.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    state.scripts.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'hm-script-card';
      card.innerHTML =
        '<div class="hm-script-card-head">' +
          '<h4>' + (s.title || '未命名').replace(/[<>]/g, '') + '</h4>' +
          '<span class="hm-script-card-genre">' + (s.genre || '') + '</span>' +
        '</div>' +
        '<p class="hm-script-card-logline">' + ((s.logline || '').replace(/[<>]/g, '') || '（暂无梗概）').slice(0, 120) + '</p>' +
        '<div class="hm-script-card-meta">' +
          '<span>🎭 ' + (s.characterCount || 0) + ' 角色</span>' +
          '<span>🎬 ' + (s.sceneCount || 0) + ' 场次</span>' +
          '<span class="hm-script-card-status hm-sc-' + (s.status || 'draft') + '">' + fmtStatus(s.status) + '</span>' +
        '</div>' +
        '<div class="hm-script-card-actions">' +
          '<button class="hm-pill hm-pill-primary hm-pill-mini" data-open>✏️ 打开</button>' +
          '<button class="hm-pill hm-pill-mini" data-dup>📋 复制</button>' +
          '<button class="hm-pill hm-pill-mini" data-del>🗑 删除</button>' +
        '</div>';
      card.querySelector('[data-open]').addEventListener('click', function () { openScript(s.id); });
      card.querySelector('[data-dup]').addEventListener('click', function () { duplicateScript(s.id); });
      card.querySelector('[data-del]').addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.confirm('确定删除「' + s.title + '」？此操作不可恢复。')) deleteScript(s.id);
      });
      card.addEventListener('click', function () { openScript(s.id); });
      grid.appendChild(card);
    });
  }

  async function loadList() {
    try {
      var data = await api.listScripts();
      state.scripts = (data && data.items) || [];
      renderList();
    } catch (err) {
      A.toast && A.toast('加载失败: ' + (err && err.message || err), 'error');
    }
  }

  async function createScript() {
    var title = window.prompt('剧本标题？', '');
    if (title === null) return;
    try {
      var data = await api.createScript({ title: title || '未命名剧本' });
      if (data && data.script) {
        state.editing = data.script;
        state.activeSceneId = null;
        showEditorView();
        bindEditorFromState();
        renderAll();
      }
    } catch (err) {
      A.toast && A.toast('创建失败: ' + (err && err.message || err), 'error');
    }
  }

  async function openScript(id) {
    try {
      var data = await api.getScript(id);
      if (data && data.script) {
        state.editing = data.script;
        state.activeSceneId = (state.editing.scenes && state.editing.scenes.length > 0)
          ? state.editing.scenes[0].id : null;
        showEditorView();
        bindEditorFromState();
        renderAll();
      }
    } catch (err) {
      A.toast && A.toast('加载失败: ' + (err && err.message || err), 'error');
    }
  }

  async function duplicateScript(id) {
    try {
      var data = await api.getScript(id);
      if (!data || !data.script) return;
      var s = data.script;
      var copy = {
        title: (s.title || '') + ' (副本)',
        genre: s.genre, logline: s.logline, outline: s.outline,
        status: 'draft',
        characters: s.characters || [],
        scenes: s.scenes || [],
      };
      var nc = await api.createScript({ script: copy });
      if (nc && nc.script) {
        state.editing = nc.script;
        showEditorView();
        bindEditorFromState();
        renderAll();
        A.toast && A.toast('✅ 已创建副本', 'success');
      }
    } catch (err) {
      A.toast && A.toast('复制失败: ' + (err && err.message || err), 'error');
    }
  }

  async function deleteScript(id) {
    try {
      await api.deleteScript(id);
      state.editing = null;
      showListView();
      loadList();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 编辑器视图 ========== */

  function currentScene() {
    if (!state.editing || !state.editing.scenes) return null;
    return state.editing.scenes.find(function (sc) { return sc.id === state.activeSceneId; });
  }

  function bindEditorFromState() {
    if (!state.editing) return;
    $('scriptTitleInput').value = state.editing.title || '';
    $('scriptGenreSelect').value = state.editing.genre || '剧情';
    $('scriptStatusSelect').value = state.editing.status || 'draft';
    $('scriptLoglineInput').value = state.editing.logline || '';
    $('scriptOutlineText').value = state.editing.outline || '';
    // 状态标签
    var tag = $('scriptStatusTag');
    tag.hidden = false;
    tag.textContent = fmtStatus(state.editing.status);
    tag.className = 'hm-script-status hm-sc-' + state.editing.status;
    $('scriptPageTitle').textContent = state.editing.title || '剧本';

    bindSceneEditor();
  }

  function bindSceneEditor() {
    var sc = currentScene();
    var empty = $('scriptSceneEmpty');
    var edit = $('scriptSceneEdit');
    if (!sc) {
      empty.hidden = false;
      edit.hidden = true;
      return;
    }
    empty.hidden = true;
    edit.hidden = false;
    $('scNumber').value = sc.number || 1;
    $('scTitle').value = sc.title || '';
    $('scLocation').value = sc.location || '';
    $('scTime').value = sc.timeOfDay || '';
    $('scDesc').value = sc.description || '';
    renderShots();
  }

  function renderAll() {
    renderSceneList();
    renderCharList();
    renderVersionList();
    bindEditorFromState();
  }

  /* ========== 场次列表（左侧） ========== */
  function renderSceneList() {
    var list = $('scriptSceneList');
    if (!list) return;
    list.innerHTML = '';
    var scenes = (state.editing && state.editing.scenes) || [];
    if (scenes.length === 0) {
      list.innerHTML = '<div class="hm-script-side-empty">点击 ＋ 创建第一场</div>';
      return;
    }
    scenes.forEach(function (sc) {
      var item = document.createElement('div');
      item.className = 'hm-script-scene-item' + (sc.id === state.activeSceneId ? ' is-active' : '');
      item.innerHTML =
        '<div class="hm-script-scene-item-num">#' + (sc.number || 0) + '</div>' +
        '<div class="hm-script-scene-item-body">' +
          '<div class="hm-script-scene-item-title">' + (sc.title || '未命名场次').replace(/[<>]/g, '') + '</div>' +
          '<div class="hm-script-scene-item-meta">' +
            '<span>' + (sc.location || '—') + '</span>' +
            '<span class="hm-script-scene-item-shots">🎥 ' + (sc.shots ? sc.shots.length : 0) + '</span>' +
          '</div>' +
        '</div>';
      item.addEventListener('click', function () {
        state.activeSceneId = sc.id;
        renderSceneList();
        bindEditorFromState();
      });
      list.appendChild(item);
    });
  }

  async function addScene() {
    if (!state.editing) return;
    try {
      var data = await api.addScene(state.editing.id, { title: '新场次', location: '', timeOfDay: '', description: '', shots: [] });
      if (data && data.scene) {
        // 同步前端 state
        state.editing.scenes = state.editing.scenes || [];
        state.editing.scenes.push(data.scene);
        state.activeSceneId = data.scene.id;
        renderSceneList();
        bindEditorFromState();
        A.toast && A.toast('✅ 场次已添加', 'success');
      }
    } catch (err) {
      A.toast && A.toast('添加失败: ' + (err && err.message || err), 'error');
    }
  }

  async function deleteCurrentScene() {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    if (!window.confirm('确定删除场次 #' + sc.number + '「' + sc.title + '」？')) return;
    try {
      await api.deleteScene(state.editing.id, sc.id);
      state.editing.scenes = state.editing.scenes.filter(function (x) { return x.id !== sc.id; });
      state.editing.scenes.forEach(function (s, i) { s.number = i + 1; });
      state.activeSceneId = state.editing.scenes.length > 0 ? state.editing.scenes[0].id : null;
      renderSceneList();
      bindEditorFromState();
      A.toast && A.toast('已删除', 'success');
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 镜头列表（右侧） ========== */
  var SHOT_TYPES = [
    { v: 'extreme-close-up', l: '极端特写' },
    { v: 'close-up', l: '特写' },
    { v: 'medium-close-up', l: '中近景' },
    { v: 'medium', l: '中景' },
    { v: 'medium-wide', l: '中远景' },
    { v: 'wide', l: '全景' },
    { v: 'extreme-wide', l: '大全景' },
    { v: 'aerial', l: '航拍' },
    { v: 'over-shoulder', l: '过肩' },
    { v: 'two-shot', l: '双人镜头' },
    { v: 'insert', l: '插入' },
    { v: 'tracking', l: '跟拍' },
  ];
  function shotTypeLabel(v) {
    var m = SHOT_TYPES.find(function (t) { return t.v === v; });
    return m ? m.l : v;
  }

  function renderShots() {
    var list = $('scriptShots');
    var sc = currentScene();
    if (!list || !sc) return;
    list.innerHTML = '';
    var shots = sc.shots || [];
    if (shots.length === 0) {
      list.innerHTML = '<div class="hm-script-empty-state">点击「＋ 添加镜头」开始构建镜头序列</div>';
      return;
    }
    shots.forEach(function (sh) {
      var card = document.createElement('div');
      card.className = 'hm-script-shot-card';
      card.innerHTML =
        '<div class="hm-script-shot-head">' +
          '<div class="hm-script-shot-num">🎥 #' + (sh.number || 0) + '</div>' +
          '<select class="hm-script-shot-type" data-shot-type="' + sh.id + '">' +
            SHOT_TYPES.map(function (t) { return '<option value="' + t.v + '"' + (t.v === sh.type ? ' selected' : '') + '>' + t.l + '</option>'; }).join('') +
          '</select>' +
          '<input type="number" class="hm-script-shot-duration" min="0" value="' + (sh.duration || 0) + '" data-shot-dur="' + sh.id + '" placeholder="秒">' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-shot-del="' + sh.id + '">🗑</button>' +
        '</div>' +
        '<textarea class="hm-script-shot-desc" rows="2" data-shot-desc="' + sh.id + '" placeholder="镜头描述 / 构图 / 运动...">' + (sh.description || '').replace(/[<>]/g, '') + '</textarea>' +
        '<div class="hm-script-dialogues" id="dlgs_' + sh.id + '"></div>' +
        '<div class="hm-script-dlg-actions"><button class="hm-pill hm-pill-mini" data-dlg-add="' + sh.id + '">💬 添加对白</button></div>' +
        '<textarea class="hm-script-shot-notes" rows="1" data-shot-notes="' + sh.id + '" placeholder="备注 / 音效 / 转场...">' + (sh.notes || '').replace(/[<>]/g, '') + '</textarea>';
      list.appendChild(card);
    });
    // 渲染对白
    shots.forEach(function (sh) { renderDialogues(sh); });
    // 绑定事件
    list.querySelectorAll('[data-shot-type]').forEach(function (el) {
      el.addEventListener('change', function () { patchShot(sh.id, { type: el.value }); });
    });
    list.querySelectorAll('[data-shot-dur]').forEach(function (el) {
      el.addEventListener('input', function () { patchShot(sh.id, { duration: Number(el.value) }); });
    });
    list.querySelectorAll('[data-shot-desc]').forEach(function (el) {
      el.addEventListener('input', function () { patchShot(sh.id, { description: el.value }); });
    });
    list.querySelectorAll('[data-shot-notes]').forEach(function (el) {
      el.addEventListener('input', function () { patchShot(sh.id, { notes: el.value }); });
    });
    list.querySelectorAll('[data-shot-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (!window.confirm('删除镜头 #' + sh.number + '？')) return;
        deleteShot(sh.id);
      });
    });
    list.querySelectorAll('[data-dlg-add]').forEach(function (el) {
      el.addEventListener('click', function () { addDialogue(sh.id); });
    });
  }

  function renderDialogues(shot) {
    var container = $('dlgs_' + shot.id);
    if (!container) return;
    container.innerHTML = '';
    var characters = (state.editing && state.editing.characters) || [];
    var dlgs = shot.dialogue || [];
    dlgs.forEach(function (d) {
      var div = document.createElement('div');
      div.className = 'hm-script-dialogue';
      var charOptions = '<option value="">— 选择角色 —</option>' + characters.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === d.characterId ? ' selected' : '') + '>' + (c.name || '') + '</option>';
      }).join('');
      div.innerHTML =
        '<select class="hm-script-dlg-char" data-dlg-char="' + shot.id + ':' + d.id + '">' + charOptions + '</select>' +
        '<input class="hm-script-dlg-mood" placeholder="语气" value="' + (d.mood || '').replace(/[<>]/g, '') + '" data-dlg-mood="' + shot.id + ':' + d.id + '">' +
        '<textarea class="hm-script-dlg-text" rows="2" placeholder="对白...">' + (d.text || '').replace(/[<>]/g, '') + '</textarea>' +
        '<input class="hm-script-dlg-action" placeholder="动作 / 表情（括号内）" value="' + (d.action || '').replace(/[<>]/g, '') + '" data-dlg-action="' + shot.id + ':' + d.id + '">' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger" data-dlg-del="' + shot.id + ':' + d.id + '">✕</button>';
      container.appendChild(div);
    });
    // 绑定
    container.querySelectorAll('.hm-script-dialogue').forEach(function (dlgEl, i) {
      var d = dlgs[i];
      var shotId = shot.id;
      dlgEl.querySelector('[data-dlg-char]').addEventListener('change', function (e) {
        var char = characters.find(function (c) { return c.id === e.target.value; });
        patchDialogue(shotId, d.id, { characterId: e.target.value, characterName: char ? char.name : '' });
      });
      dlgEl.querySelector('.hm-script-dlg-text').addEventListener('input', function (e) {
        patchDialogue(shotId, d.id, { text: e.target.value });
      });
      dlgEl.querySelector('[data-dlg-mood]').addEventListener('input', function (e) {
        patchDialogue(shotId, d.id, { mood: e.target.value });
      });
      dlgEl.querySelector('[data-dlg-action]').addEventListener('input', function (e) {
        patchDialogue(shotId, d.id, { action: e.target.value });
      });
      dlgEl.querySelector('[data-dlg-del]').addEventListener('click', function () {
        deleteDialogue(shotId, d.id);
      });
    });
  }

  async function addShot() {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    try {
      var data = await api.addShot(state.editing.id, sc.id, { type: 'medium', duration: 3, description: '', notes: '', dialogue: [] });
      if (data && data.shot) {
        sc.shots = sc.shots || [];
        sc.shots.push(data.shot);
        renderShots();
      }
    } catch (err) {
      A.toast && A.toast('添加镜头失败: ' + (err && err.message || err), 'error');
    }
  }
  async function patchShot(shotId, patch) {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    var sh = (sc.shots || []).find(function (x) { return x.id === shotId; });
    if (!sh) return;
    Object.assign(sh, patch);
    try { await api.updateShot(state.editing.id, sc.id, shotId, patch); } catch (e) {}
  }
  async function deleteShot(shotId) {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    try {
      await api.deleteShot(state.editing.id, sc.id, shotId);
      sc.shots = (sc.shots || []).filter(function (x) { return x.id !== shotId; });
      sc.shots.forEach(function (s, i) { s.number = i + 1; });
      renderShots();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }
  async function addDialogue(shotId) {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    var sh = (sc.shots || []).find(function (x) { return x.id === shotId; });
    if (!sh) return;
    try {
      var data = await api.addDialogue(state.editing.id, sc.id, shotId, { text: '', action: '', mood: '' });
      if (data && data.dialogue) {
        sh.dialogue = sh.dialogue || [];
        sh.dialogue.push(data.dialogue);
        renderShots(); // 重绘（简单处理）
      }
    } catch (err) {
      A.toast && A.toast('添加对白失败: ' + (err && err.message || err), 'error');
    }
  }
  async function patchDialogue(shotId, did, patch) {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    var sh = (sc.shots || []).find(function (x) { return x.id === shotId; });
    if (!sh) return;
    var d = (sh.dialogue || []).find(function (x) { return x.id === did; });
    if (!d) return;
    Object.assign(d, patch);
    try { await api.updateDialogue(state.editing.id, sc.id, shotId, did, patch); } catch (e) {}
  }
  async function deleteDialogue(shotId, did) {
    var sc = currentScene();
    if (!sc || !state.editing) return;
    var sh = (sc.shots || []).find(function (x) { return x.id === shotId; });
    try {
      await api.deleteDialogue(state.editing.id, sc.id, shotId, did);
      if (sh) sh.dialogue = (sh.dialogue || []).filter(function (x) { return x.id !== did; });
      renderShots();
    } catch (err) {
      A.toast && A.toast('删除对白失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 角色侧栏 ========== */
  function renderCharList() {
    var list = $('scriptCharList');
    if (!list) return;
    list.innerHTML = '';
    var chars = (state.editing && state.editing.characters) || [];
    if (chars.length === 0) {
      list.innerHTML = '<div class="hm-script-side-empty">点击 ＋ 添加角色</div>';
      return;
    }
    chars.forEach(function (c, i) {
      var item = document.createElement('div');
      item.className = 'hm-script-char-item';
      item.innerHTML =
        '<div class="hm-script-char-avatar">' + ((c.name || '?')[0] || '?') + '</div>' +
        '<div class="hm-script-char-body">' +
          '<input class="hm-script-char-name" value="' + (c.name || '') + '" placeholder="角色名" data-cname="' + c.id + '">' +
          '<div class="hm-script-char-sub">' +
            '<input class="hm-script-char-role" value="' + (c.role || '') + '" placeholder="定位（主角/女主/反派...）" data-crole="' + c.id + '">' +
            '<span class="hm-script-char-gender">' + (c.gender || '') + '</span>' +
          '</div>' +
          '<textarea class="hm-script-char-desc" rows="2" placeholder="性格 / 外貌 / 背景...">' + (c.description || '').replace(/[<>]/g, '') + '</textarea>' +
        '</div>' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger hm-script-char-del" data-cdel="' + c.id + '">🗑</button>';
      list.appendChild(item);
    });
    list.querySelectorAll('[data-cname]').forEach(function (el) {
      el.addEventListener('input', function () { patchChar(el.getAttribute('data-cname'), { name: el.value }); });
    });
    list.querySelectorAll('[data-crole]').forEach(function (el) {
      el.addEventListener('input', function () { patchChar(el.getAttribute('data-crole'), { role: el.value }); });
    });
    list.querySelectorAll('.hm-script-char-desc').forEach(function (el, i) {
      var c = chars[i];
      el.addEventListener('input', function () { patchChar(c.id, { description: el.value }); });
    });
    list.querySelectorAll('[data-cdel]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (!window.confirm('删除角色？')) return;
        deleteChar(el.getAttribute('data-cdel'));
      });
    });
  }

  async function addChar() {
    if (!state.editing) return;
    var name = window.prompt('角色名？', '');
    if (!name) return;
    try {
      var data = await api.addCharacter(state.editing.id, { name: name, role: '', gender: '—', age: '', description: '' });
      if (data && data.character) {
        state.editing.characters = state.editing.characters || [];
        state.editing.characters.push(data.character);
        renderCharList();
        renderShots(); // 更新对白里的角色下拉
      }
    } catch (err) {
      A.toast && A.toast('添加失败: ' + (err && err.message || err), 'error');
    }
  }
  async function patchChar(cid, patch) {
    if (!state.editing) return;
    var c = (state.editing.characters || []).find(function (x) { return x.id === cid; });
    if (!c) return;
    Object.assign(c, patch);
    try { await api.updateCharacter(state.editing.id, cid, patch); } catch (e) {}
  }
  async function deleteChar(cid) {
    if (!state.editing) return;
    try {
      await api.deleteCharacter(state.editing.id, cid);
      state.editing.characters = (state.editing.characters || []).filter(function (x) { return x.id !== cid; });
      renderCharList();
      renderShots();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 版本侧栏 ========== */
  function renderVersionList() {
    var list = $('scriptVerList');
    if (!list) return;
    list.innerHTML = '';
    var versions = (state.editing && state.editing.versions) || [];
    if (versions.length === 0) {
      list.innerHTML = '<div class="hm-script-side-empty">点击 📸 创建版本快照<br>最多保存 20 个</div>';
      return;
    }
    versions.forEach(function (v) {
      var t = new Date(v.createdAt);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var tstr = pad(t.getMonth() + 1) + '/' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
      var item = document.createElement('div');
      item.className = 'hm-script-ver-item';
      item.innerHTML =
        '<div class="hm-script-ver-label">' + (v.label || '快照').replace(/[<>]/g, '') + '</div>' +
        '<div class="hm-script-ver-meta">' + tstr + ' · 🎭' + (v.characterCount || 0) + ' 🎬' + (v.sceneCount || 0) + '</div>' +
        '<div class="hm-script-ver-actions">' +
          '<button class="hm-pill hm-pill-mini" data-restore="' + v.id + '">↺ 恢复</button>' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-vdel="' + v.id + '">🗑</button>' +
        '</div>';
      list.appendChild(item);
    });
    list.querySelectorAll('[data-restore]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (!window.confirm('恢复到此版本？当前状态会先自动保存为一个快照')) return;
        restoreVersion(el.getAttribute('data-restore'));
      });
    });
    list.querySelectorAll('[data-vdel]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (!window.confirm('删除这个版本？')) return;
        deleteVersion(el.getAttribute('data-vdel'));
      });
    });
  }

  async function snapshotCurrent() {
    if (!state.editing) return;
    var label = window.prompt('版本备注（可选）', '');
    try {
      // 先保存当前
      await saveCurrent();
      var data = await api.snapshotScript(state.editing.id, label || '');
      if (data && data.version) {
        state.editing.versions = state.editing.versions || [];
        state.editing.versions.unshift(data.version);
        renderVersionList();
        A.toast && A.toast('📸 快照已保存', 'success');
      }
    } catch (err) {
      A.toast && A.toast('快照失败: ' + (err && err.message || err), 'error');
    }
  }
  async function restoreVersion(vid) {
    if (!state.editing) return;
    try {
      var data = await api.restoreVersion(state.editing.id, vid);
      if (data && data.script) {
        state.editing = data.script;
        state.activeSceneId = (state.editing.scenes && state.editing.scenes.length > 0)
          ? state.editing.scenes[0].id : null;
        renderAll();
        A.toast && A.toast('✅ 已恢复到选定版本', 'success');
      }
    } catch (err) {
      A.toast && A.toast('恢复失败: ' + (err && err.message || err), 'error');
    }
  }
  async function deleteVersion(vid) {
    if (!state.editing) return;
    try {
      await api.deleteVersion(state.editing.id, vid);
      state.editing.versions = (state.editing.versions || []).filter(function (v) { return v.id !== vid; });
      renderVersionList();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 保存 ========== */
  async function saveCurrent() {
    if (!state.editing) return;
    // 收集元信息
    var patch = {
      title: $('scriptTitleInput').value,
      genre: $('scriptGenreSelect').value,
      status: $('scriptStatusSelect').value,
      logline: $('scriptLoglineInput').value,
      outline: $('scriptOutlineText').value,
      script: { // 完整保存
        title: $('scriptTitleInput').value,
        genre: $('scriptGenreSelect').value,
        status: $('scriptStatusSelect').value,
        logline: $('scriptLoglineInput').value,
        outline: $('scriptOutlineText').value,
        characters: state.editing.characters || [],
        scenes: state.editing.scenes || [],
      },
    };
    Object.assign(state.editing, patch.script);
    try {
      await api.updateScript(state.editing.id, patch);
      A.toast && A.toast('💾 已保存', 'success');
      renderList(); // 更新列表卡片
    } catch (err) {
      A.toast && A.toast('保存失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ========== 导出 ========== */
  function doExport(fmt) {
    if (!state.editing) return;
    var url = (api.mediaUrl ? api.mediaUrl('') : '') + api.exportScript(state.editing.id, fmt);
    // 通过后端静态代理下载
    var backend = (window.HM && window.HM.api && window.HM.api._backendBase) || '';
    if (backend) url = backend + api.exportScript(state.editing.id, fmt);
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    A.toast && A.toast('📤 已开始下载', 'success');
  }

  /* ========== 绑定事件 ========== */
  function bind() {
    $('scriptNewBtn').addEventListener('click', createScript);
    $('scriptBackBtn').addEventListener('click', function () {
      state.editing = null;
      showListView();
      loadList();
    });
    $('scriptSaveBtn').addEventListener('click', saveCurrent);
    $('scriptSnapshotBtn').addEventListener('click', snapshotCurrent);
    // 导出下拉
    var exportBtn = $('scriptExportBtn');
    var exportMenu = document.querySelector('.hm-script-export-menu');
    if (exportBtn && exportMenu) {
      exportBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        exportMenu.hidden = !exportMenu.hidden;
      });
      exportMenu.addEventListener('click', function (e) {
        var a = e.target.closest('a[data-fmt]');
        if (!a) return;
        doExport(a.getAttribute('data-fmt'));
        exportMenu.hidden = true;
      });
      document.addEventListener('click', function () { exportMenu.hidden = true; });
    }
    // 左侧 Tab
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-stab]');
      if (!tab || !tab.closest('.hm-script-side-tabs')) return;
      var stab = tab.getAttribute('data-stab');
      state.editingSideTab = stab;
      document.querySelectorAll('.hm-script-side-tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
      document.querySelectorAll('.hm-script-side-panel').forEach(function (p) { p.hidden = p.id !== ('scriptPanel-' + stab); });
      if (stab === 'characters') renderCharList();
      if (stab === 'outline') $('scriptOutlineText').value = state.editing ? (state.editing.outline || '') : '';
      if (stab === 'versions') renderVersionList();
    });
    // 左侧按钮
    $('scriptAddScene').addEventListener('click', addScene);
    $('scriptAddChar').addEventListener('click', addChar);
    $('scriptNewVer').addEventListener('click', snapshotCurrent);
    // 场次编辑
    ['scNumber', 'scTitle', 'scLocation', 'scTime', 'scDesc'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var sc = currentScene();
        if (!sc || !state.editing) return;
        var patch = {};
        var fieldMap = { scNumber: 'number', scTitle: 'title', scLocation: 'location', scTime: 'timeOfDay', scDesc: 'description' };
        patch[fieldMap[id]] = el.type === 'number' ? Number(el.value) : el.value;
        Object.assign(sc, patch);
        api.updateScene(state.editing.id, sc.id, patch).catch(function () {});
      });
    });
    $('scDelete').addEventListener('click', deleteCurrentScene);
    $('scriptAddShot').addEventListener('click', addShot);
    // 元信息实时保存（debounced）
    var debounce = null;
    ['scriptTitleInput', 'scriptGenreSelect', 'scriptStatusSelect', 'scriptLoglineInput', 'scriptOutlineText'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        bindEditorFromState();
        clearTimeout(debounce);
        debounce = setTimeout(function () { saveCurrent(); }, 1500);
      });
      el.addEventListener('change', function () {
        bindEditorFromState();
        clearTimeout(debounce);
        debounce = setTimeout(function () { saveCurrent(); }, 100);
      });
    });
  }

  bind();
  window.HMScript = { enter: enter, state: state };
})();

/* =============================================================
 * 美术设定设计模块（HMArt）
 * 参考日本动画现场标准：6 大分类 + 子节 + 会审检查表
 * ============================================================= */
(function () {
  'use strict';
  var api = window.HM && window.HM.api;
  var A = window.HMApp;
  if (!api || !A) { console.warn('[HMArt] 缺少 api 或 A'); return; }

  var state = {
    categories: [],        // 从 /art/categories 加载
    arts: [],              // 列表
    activeCat: 'sekai',
    activeSection: null,   // null = 全部子节
    filterStatus: 'all',
    filterType: 'all',
    keyword: '',
    editing: null,         // 当前编辑条目
    checklist: null,       // 会审检查表
  };

  function $(id) { return document.getElementById(id); }

  /* ============ 入口 ============ */
  async function enter() {
    try {
      var data = await api.artCategories();
      state.categories = (data && data.categories) || [];
    } catch (e) { state.categories = []; }
    showListView();
    renderCatTabs();
    await loadList();
    bind();
  }

  function showListView() {
    $('artListView').hidden = false;
    $('artEditorView').hidden = true;
    $('artBackBtn').hidden = true;
  }
  function showEditorView() {
    $('artListView').hidden = true;
    $('artEditorView').hidden = false;
    $('artBackBtn').hidden = false;
  }

  /* ============ 分类 Tab ============ */
  function renderCatTabs() {
    var el = $('artCatTabs');
    if (!el) return;
    el.innerHTML = '';
    state.categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'hm-art-cat-btn' + (cat.key === state.activeCat ? ' is-active' : '');
      btn.innerHTML = '<span class="hm-art-cat-icon">' + (cat.icon || '📌') + '</span><span class="hm-art-cat-name">' + cat.name + '</span>';
      btn.addEventListener('click', function () {
        state.activeCat = cat.key;
        state.activeSection = null;
        renderCatTabs();
        renderSectionTabs();
        loadList();
      });
      el.appendChild(btn);
    });
  }

  function renderSectionTabs() {
    var el = $('artSectionTabs');
    if (!el) return;
    el.innerHTML = '';
    var cat = state.categories.find(function (c) { return c.key === state.activeCat; });
    if (!cat || !cat.sections || cat.sections.length === 0) { el.hidden = true; return; }
    el.hidden = false;

    // 全部
    var all = document.createElement('button');
    all.className = 'hm-art-sec-btn' + (state.activeSection === null ? ' is-active' : '');
    all.textContent = '全部';
    all.addEventListener('click', function () { state.activeSection = null; renderSectionTabs(); renderGrid(); });
    el.appendChild(all);

    cat.sections.forEach(function (sec) {
      var btn = document.createElement('button');
      btn.className = 'hm-art-sec-btn' + (state.activeSection === sec ? ' is-active' : '');
      btn.textContent = sec;
      btn.addEventListener('click', function () { state.activeSection = sec; renderSectionTabs(); renderGrid(); });
      el.appendChild(btn);
    });
  }

  /* ============ 加载列表 ============ */
  async function loadList() {
    try {
      var data = await api.listArts(state.activeCat);
      state.arts = (data && data.items) || [];
      renderGrid();
      renderSectionTabs();
    } catch (err) {
      A.toast && A.toast('加载失败: ' + (err && err.message || err), 'error');
    }
  }

  /* ============ 卡片网格 ============ */
  function renderGrid() {
    var grid = $('artGrid');
    var empty = $('artEmpty');
    if (!grid) return;
    grid.innerHTML = '';

    var filtered = state.arts.slice();
    if (state.activeSection) filtered = filtered.filter(function (a) { return a.section === state.activeSection; });
    if (state.filterStatus !== 'all') filtered = filtered.filter(function (a) { return a.status === state.filterStatus; });
    if (state.filterType !== 'all') filtered = filtered.filter(function (a) { return a.spec && a.spec.type === state.filterType; });
    if (state.keyword) {
      var kw = state.keyword.toLowerCase();
      filtered = filtered.filter(function (a) {
        return (a.title || '').toLowerCase().indexOf(kw) >= 0
          || (a.subtitle || '').toLowerCase().indexOf(kw) >= 0
          || (a.section || '').toLowerCase().indexOf(kw) >= 0
          || (a.tags || []).some(function (t) { return (t || '').toLowerCase().indexOf(kw) >= 0; });
      });
    }

    if (filtered.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    filtered.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'hm-art-card hm-art-st-' + (a.status || 'draft');
      var thumbHtml = '🎨';
      if (a.media && a.media.thumb) {
        try { thumbHtml = '<img src="' + (api.mediaUrl(a.media.thumb)).replace(/"/g, '&quot;') + '" alt="" loading="lazy">'; }
        catch (e) { thumbHtml = '🎨'; }
      }
      card.innerHTML =
        '<div class="hm-art-card-status"></div>' +
        '<div class="hm-art-card-thumb">' + thumbHtml + '</div>' +
        '<div class="hm-art-card-body">' +
          '<div class="hm-art-card-title">' + (a.title || '未命名').replace(/[<>]/g, '') + '</div>' +
          (a.subtitle ? '<div class="hm-art-card-sub">' + a.subtitle.replace(/[<>]/g, '') + '</div>' : '') +
          '<div class="hm-art-card-section">' + (a.section || '—').replace(/[<>]/g, '') + '</div>' +
          '<div class="hm-art-card-meta">' +
            '<span class="hm-art-card-type">' + (artTypeLabel(a.spec && a.spec.type) || '设定') + '</span>' +
            '<span class="hm-art-card-ver">' + (a.version || 'Ver1.0') + '</span>' +
          '</div>' +
          (a.tags && a.tags.length > 0 ?
            '<div class="hm-art-card-tags">' +
              a.tags.slice(0, 4).map(function (t) { return '<span>#' + t.replace(/[<>]/g, '') + '</span>'; }).join('') +
            '</div>' : '') +
        '</div>' +
        '<div class="hm-art-card-actions">' +
          '<button class="hm-pill hm-pill-mini" data-art-open>✏️</button>' +
          '<button class="hm-pill hm-pill-mini" data-art-dup>📋</button>' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-art-del>🗑</button>' +
        '</div>';
      card.querySelector('[data-art-open]').addEventListener('click', function () { openArt(a.id); });
      card.querySelector('[data-art-dup]').addEventListener('click', function (e) {
        e.stopPropagation(); duplicateArt(a.id);
      });
      card.querySelector('[data-art-del]').addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.confirm('删除「' + a.title + '」？')) deleteArt(a.id);
      });
      card.addEventListener('click', function () { openArt(a.id); });
      grid.appendChild(card);
    });
  }

  function artTypeLabel(v) {
    var m = { lineart: '线稿', painting: '彩稿', model: '三视图', color: '色卡', layout: 'Layout', doc: '文档' };
    return m[v];
  }
  function artStatusLabel(v) {
    var m = { draft: '草稿', wip: '制作中', review: '审图中', final: '定稿' };
    return m[v] || v;
  }

  /* ============ CRUD ============ */
  async function createArt() {
    var title = window.prompt('设定板标题？', '');
    if (!title && title !== '') return;
    try {
      var payload = {
        title: title || '未命名设定板',
        category: state.activeCat,
        section: state.activeSection || '',
        tags: [],
        status: 'draft', version: 'Ver1.0',
        spec: { type: 'painting', format: 'psd', resolution: '', layers: [] },
        media: { thumb: '', sources: [] },
        content: '', notes: '',
        colorSpec: { palette: [], shadows: [], highlights: [] },
      };
      var data = await api.createArt(payload);
      if (data && data.art) {
        state.editing = data.art;
        showEditorView();
        renderEditor();
        A.toast && A.toast('✅ 已创建', 'success');
      }
    } catch (err) {
      A.toast && A.toast('创建失败: ' + (err && err.message || err), 'error');
    }
  }

  async function openArt(id) {
    try {
      var data = await api.getArt(id);
      if (data && data.art) {
        state.editing = data.art;
        showEditorView();
        renderEditor();
      }
    } catch (err) {
      A.toast && A.toast('加载失败: ' + (err && err.message || err), 'error');
    }
  }

  async function duplicateArt(id) {
    try {
      var data = await api.duplicateArt(id);
      if (data && data.art) {
        loadList();
        A.toast && A.toast('✅ 已复制', 'success');
      }
    } catch (err) {
      A.toast && A.toast('复制失败: ' + (err && err.message || err), 'error');
    }
  }

  async function deleteArt(id) {
    try {
      await api.deleteArt(id);
      if (state.editing && state.editing.id === id) {
        state.editing = null;
        showListView();
      }
      loadList();
    } catch (err) {
      A.toast && A.toast('删除失败: ' + (err && err.message || err), 'error');
    }
  }

  async function saveArt() {
    if (!state.editing) return;
    var catKey = $('artCategory').value;
    var cat = state.categories.find(function (c) { return c.key === catKey; });
    var section = $('artSection').value;
    var payload = {
      title: $('artTitle').value,
      subtitle: $('artSubtitle').value,
      category: catKey,
      section: section,
      version: $('artVersion').value,
      status: $('artStatus').value,
      tags: parseTags($('artTags').value),
      spec: {
        type: $('artSpecType').value,
        format: $('artSpecFormat').value,
        resolution: $('artSpecRes').value,
        layers: [],
      },
      media: state.editing.media,
      colorSpec: state.editing.colorSpec,
      content: $('artContent').value,
      notes: $('artNotes').value,
      characterSpec: state.editing.characterSpec,
    };
    try {
      var data = await api.updateArt(state.editing.id, payload);
      if (data && data.art) {
        state.editing = data.art;
        loadList();
        A.toast && A.toast('💾 已保存', 'success');
      }
    } catch (err) {
      A.toast && A.toast('保存失败: ' + (err && err.message || err), 'error');
    }
  }

  function parseTags(str) {
    return (str || '').split(/[\s,，]+/).map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean);
  }

  /* ============ 编辑器渲染 ============ */
  function renderEditor() {
    if (!state.editing) return;
    var a = state.editing;
    $('artEditorTitle').textContent = a.title || '未命名';
    $('artEditorPath').textContent = buildPath(a);
    $('artVerTag').textContent = a.version || 'Ver1.0';

    // 分类下拉
    var catSel = $('artCategory');
    catSel.innerHTML = state.categories.map(function (c) {
      return '<option value="' + c.key + '"' + (c.key === a.category ? ' selected' : '') + '>' + c.icon + ' ' + c.name + '</option>';
    }).join('');
    catSel.onchange = updateSectionOptions;
    updateSectionOptions();

    // 填充字段
    $('artTitle').value = a.title || '';
    $('artSubtitle').value = a.subtitle || '';
    $('artSection').value = a.section || '';
    $('artVersion').value = a.version || 'Ver1.0';
    $('artStatus').value = a.status || 'draft';
    $('artSpecType').value = a.spec ? (a.spec.type || 'painting') : 'painting';
    $('artSpecFormat').value = a.spec ? (a.spec.format || '') : '';
    $('artSpecRes').value = a.spec ? (a.spec.resolution || '') : '';
    $('artTags').value = (a.tags || []).join(' ');
    $('artContent').value = a.content || '';
    $('artNotes').value = a.notes || '';

    // 色卡
    renderColorGroup('artPaletteGrid', (a.colorSpec && a.colorSpec.palette) || [], 'palette');
    renderColorGroup('artShadowGrid', (a.colorSpec && a.colorSpec.shadows) || [], 'shadows');
    renderColorGroup('artHighlightGrid', (a.colorSpec && a.colorSpec.highlights) || [], 'highlights');

    // 媒体（缩略图 + 多版本）
    renderMediaPanel();

    // 角色设定专属编辑器
    if (a.category === 'character') {
      renderCharacterEditor();
      $('artCharacterBlock').hidden = false;
    } else {
      $('artCharacterBlock').hidden = true;
    }
  }

  function updateSectionOptions() {
    var cat = state.categories.find(function (c) { return c.key === $('artCategory').value; });
    var sel = $('artSection');
    sel.innerHTML = '<option value="">— 未分配 —</option>';
    if (cat) {
      cat.sections.forEach(function (s) {
        sel.innerHTML += '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>';
      });
    }
    if (state.editing) sel.value = state.editing.section || '';
  }

  function buildPath(a) {
    var cat = state.categories.find(function (c) { return c.key === a.category; });
    var catName = cat ? cat.name : '';
    return (catName ? catName + ' / ' : '') + (a.section || '—');
  }

  function renderColorGroup(gridId, list, groupKey) {
    var grid = $(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    if (!list || list.length === 0) {
      grid.innerHTML = '<div class="hm-art-color-empty">暂无</div>';
      return;
    }
    list.forEach(function (c, i) {
      var item = document.createElement('div');
      item.className = 'hm-art-color-item';
      var hex = c.hex || '#888888';
      item.innerHTML =
        '<input type="color" class="hm-art-color-picker" value="' + hex + '" data-color-hex="' + i + '" data-group="' + groupKey + '">' +
        '<input type="text" class="hm-art-color-hex" value="' + hex + '" data-color-hex2="' + i + '" data-group="' + groupKey + '">' +
        '<input type="text" class="hm-art-color-name" placeholder="名称" value="' + (c.name || '') + '" data-color-name="' + i + '" data-group="' + groupKey + '">' +
        '<button class="hm-art-color-del" data-color-del="' + i + '" data-group="' + groupKey + '">✕</button>';
      grid.appendChild(item);
    });
    grid.querySelectorAll('[data-color-hex]').forEach(function (el) {
      el.addEventListener('input', function () {
        var g = state.editing.colorSpec[el.getAttribute('data-group')];
        g[Number(el.getAttribute('data-color-hex'))].hex = el.value;
      });
    });
    grid.querySelectorAll('[data-color-hex2]').forEach(function (el) {
      el.addEventListener('input', function () {
        var g = state.editing.colorSpec[el.getAttribute('data-group')];
        g[Number(el.getAttribute('data-color-hex2'))].hex = el.value;
        var picker = grid.querySelector('[data-color-hex="' + el.getAttribute('data-color-hex2') + '"]');
        if (picker) picker.value = el.value;
      });
    });
    grid.querySelectorAll('[data-color-name]').forEach(function (el) {
      el.addEventListener('input', function () {
        var g = state.editing.colorSpec[el.getAttribute('data-group')];
        g[Number(el.getAttribute('data-color-name'))].name = el.value;
      });
    });
    grid.querySelectorAll('[data-color-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var g = state.editing.colorSpec[el.getAttribute('data-group')];
        g.splice(Number(el.getAttribute('data-color-del')), 1);
        renderColorGroup(gridId, g, el.getAttribute('data-group'));
      });
    });
  }

  /* ============ 媒体上传 / 预览 ============ */
  function renderMediaPanel() {
    var a = state.editing;
    if (!a) return;

    // 缩略图
    var thumbBox = $('artMediaThumb');
    if (thumbBox) {
      thumbBox.innerHTML = buildThumbMediaHtml(a);
      wireThumbUpload(thumbBox);
    }

    // 多版本
    var srcBox = $('artMediaSources');
    if (srcBox) {
      srcBox.innerHTML = buildSourcesMediaHtml(a);
      wireSourcesUpload(srcBox);
    }
  }

  function buildThumbMediaHtml(a) {
    var url = (a.media && a.media.thumb) ? api.mediaUrl(a.media.thumb) : '';
    if (url) {
      return '<div class="hm-art-media-preview">' +
        '<img src="' + url + '" alt="" data-preview-click>' +
        '<div class="hm-art-media-preview-actions">' +
          '<button class="hm-pill hm-pill-mini" data-thumb-upload>🔁 更换</button>' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-thumb-clear>🗑 移除</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="hm-art-media-empty" data-thumb-upload>' +
      '<div class="hm-art-media-emoji">🖼️</div>' +
      '<div class="hm-art-media-hint">点击或拖入缩略图</div>' +
      '<div class="hm-art-media-sub">支持 PNG / JPG / WebP，≤50MB</div>' +
    '</div>';
  }

  function buildSourcesMediaHtml(a) {
    var sources = (a.media && a.media.sources) || [];
    var html = '';
    if (sources.length > 0) {
      html += '<div class="hm-art-sources-list">';
      sources.forEach(function (s, i) {
        var sUrl = api.mediaUrl(s.url || '');
        var sLabel = (s.label || '版本 ' + (i + 1)).replace(/[<>]/g, '');
        html += '<div class="hm-art-source-item">' +
          '<div class="hm-art-source-thumb"><img src="' + sUrl + '" alt="" data-preview-click></div>' +
          '<div class="hm-art-source-info">' +
            '<input class="hm-art-source-label" value="' + sLabel.replace(/"/g, '&quot;') + '" data-source-label="' + i + '">' +
            '<div class="hm-art-source-meta">' + (s.size ? formatSize(s.size) : '') + '</div>' +
          '</div>' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-source-del="' + i + '">✕</button>' +
        '</div>';
      });
      html += '</div>';
    }
    html += '<div class="hm-art-media-empty hm-art-media-empty-sm" data-source-upload>' +
      '<div class="hm-art-media-emoji">📁</div>' +
      '<div class="hm-art-media-hint">＋ 添加多版本源文件</div>' +
    '</div>';
    return html;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function wireThumbUpload(box) {
    // 清空旧事件（通过重建前移除）
    box.querySelectorAll('[data-thumb-upload]').forEach(function (el) {
      el.addEventListener('click', function () { pickAndUploadImage('thumb'); });
    });
    box.querySelectorAll('[data-thumb-clear]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!state.editing) return;
        state.editing.media.thumb = '';
        saveArt();
        renderMediaPanel();
      });
    });
    // 预览
    box.querySelectorAll('[data-preview-click]').forEach(function (el) {
      el.addEventListener('click', function () { openLightbox(el.src); });
    });
    // 拖放
    bindDrop(box, 'thumb');
  }

  function wireSourcesUpload(box) {
    box.querySelectorAll('[data-source-upload]').forEach(function (el) {
      el.addEventListener('click', function () { pickAndUploadImage('source'); });
    });
    box.querySelectorAll('[data-source-del]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!state.editing) return;
        var idx = Number(el.getAttribute('data-source-del'));
        state.editing.media.sources.splice(idx, 1);
        saveArt();
        renderMediaPanel();
      });
    });
    box.querySelectorAll('[data-source-label]').forEach(function (el) {
      el.addEventListener('input', function () {
        if (!state.editing) return;
        var idx = Number(el.getAttribute('data-source-label'));
        state.editing.media.sources[idx].label = el.value;
      });
      el.addEventListener('change', function () { saveArt(); });
    });
    box.querySelectorAll('[data-preview-click]').forEach(function (el) {
      el.addEventListener('click', function () { openLightbox(el.src); });
    });
    bindDrop(box, 'source');
  }

  function bindDrop(box, mode) {
    if (box.__dropBound) return;
    box.__dropBound = true;
    box.addEventListener('dragover', function (e) {
      e.preventDefault();
      box.classList.add('hm-art-drop-hover');
    });
    box.addEventListener('dragleave', function () { box.classList.remove('hm-art-drop-hover'); });
    box.addEventListener('drop', function (e) {
      e.preventDefault();
      box.classList.remove('hm-art-drop-hover');
      var files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFile(files[0], mode);
      }
    });
  }

  function pickAndUploadImage(mode) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = (mode === 'source');
    input.onchange = function () {
      var files = input.files;
      if (!files || files.length === 0) return;
      if (mode === 'source') {
        Array.from(files).forEach(function (f) { handleFile(f, mode); });
      } else {
        handleFile(files[0], mode);
      }
    };
    input.click();
  }

  function handleFile(file, mode) {
    if (!file || !file.type.startsWith('image/')) {
      A.toast && A.toast('请选择图片文件', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      uploadDataUrl(reader.result, mode, file);
    };
    reader.onerror = function () {
      A.toast && A.toast('读取文件失败', 'error');
    };
    reader.readAsDataURL(file);
  }

  var _uploadingMedia = false;
  function uploadDataUrl(dataUrl, mode, file) {
    if (_uploadingMedia) return;
    _uploadingMedia = true;
    var toastMsg = (mode === 'thumb') ? '正在上传缩略图...' : '正在上传源文件...';
    A.toast && A.toast(toastMsg);
    api.uploadArtMedia(dataUrl).then(function (res) {
      _uploadingMedia = false;
      if (!state.editing) return;
      if (mode === 'thumb') {
        state.editing.media.thumb = res.url;
      } else {
        state.editing.media.sources = state.editing.media.sources || [];
        state.editing.media.sources.push({
          url: res.url,
          label: (file && file.name) ? file.name.replace(/\.[^.]+$/, '') : '版本 ' + (state.editing.media.sources.length + 1),
          size: res.size,
        });
      }
      renderMediaPanel();
      saveArt();
      A.toast && A.toast('✅ 上传成功', 'success');
    }).catch(function (err) {
      _uploadingMedia = false;
      A.toast && A.toast('上传失败: ' + (err && err.message || err), 'error');
    });
  }

  /* ============ 图片预览灯箱 ============ */
  function openLightbox(src) {
    var overlay = document.createElement('div');
    overlay.className = 'hm-lightbox';
    overlay.innerHTML =
      '<button class="hm-lightbox-close" title="关闭 (ESC)">✕</button>' +
      '<img class="hm-lightbox-img" src="' + src + '" alt="">' +
      '<div class="hm-lightbox-hint">ESC / 点击空白关闭</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('hm-lightbox-close')) {
        document.body.removeChild(overlay);
      }
    });
    var onKey = function (e) {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  /* ============ 角色设定专属编辑器 ============ */
  function renderCharacterEditor() {
    var a = state.editing;
    var cs = a.characterSpec = a.characterSpec || {};
    cs.expressions = cs.expressions || [];
    cs.mouthShapes = cs.mouthShapes || [];
    cs.poses = cs.poses || [];
    cs.variants = cs.variants || [];
    cs.modelSheet = cs.modelSheet || {};

    // 基础信息填充
    $('charRole').value = cs.role || '';
    $('charGender').value = cs.gender || '';
    $('charAge').value = cs.age || '';
    $('charHeight').value = cs.height || '';
    $('charWeight').value = cs.weight || '';
    $('charVoiceActor').value = cs.voiceActor || '';
    $('charSignature').value = cs.signature || '';

    // 角色色
    bindCharColor('hairColor', cs, 'charHairColor', 'charHairHex');
    bindCharColor('eyeColor', cs, 'charEyeColor', 'charEyeHex');
    bindCharColor('skinColor', cs, 'charSkinColor', 'charSkinHex');
    bindCharColor('outfitMainColor', cs, 'charOutfitColor', 'charOutfitHex');

    // 字母头像
    renderCharAvatar();

    // Model Sheet 三视图
    renderUploadSlots();

    // 表情集
    renderCharGrid('charExpressionsGrid', cs.expressions, 'expressions');
    // 口型集
    renderCharGrid('charMouthGrid', cs.mouthShapes, 'mouthShapes');
    // 姿势集
    renderCharGrid('charPosesGrid', cs.poses, 'poses');
    // 变体
    renderVariants();

    // 基础信息输入事件
    bindCharBasicFields();

    // 添加按钮
    $('charAddPoseBtn').onclick = function () {
      cs.poses.push({ key: 'pose_' + Date.now(), label: '新姿势', url: '' });
      renderCharGrid('charPosesGrid', cs.poses, 'poses');
    };
    $('charAddVariantBtn').onclick = function () {
      cs.variants.push({ label: '新变体', url: '' });
      renderVariants();
    };
  }

  function bindCharColor(csKey, cs, pickerId, hexId) {
    var picker = $(pickerId);
    var hex = $(hexId);
    var v = cs[csKey] || '#888888';
    picker.value = v;
    hex.textContent = v;
    picker.oninput = function () {
      cs[csKey] = picker.value;
      hex.textContent = picker.value;
      saveArt();
    };
  }

  function renderCharAvatar() {
    var a = state.editing;
    var cs = a.characterSpec;
    var box = $('charAvatar');
    var initial = (a.title || '?').trim().charAt(0).toUpperCase() || '?';
    box.textContent = initial;
    box.style.background = 'linear-gradient(135deg, ' + pickFromPalette(cs) + ', ' + pickFromPalette(cs, true) + ')';
  }
  function pickFromPalette(cs, alt) {
    var arr = [cs.hairColor, cs.outfitMainColor, '#8B5CF6', '#3B82F6', '#EC4899'];
    return (alt ? arr[1] : arr[0]) || '#8B5CF6';
  }

  function bindCharBasicFields() {
    var a = state.editing;
    var cs = a.characterSpec;
    var fields = {
      charRole: 'role', charGender: 'gender', charAge: 'age',
      charHeight: 'height', charWeight: 'weight',
      charVoiceActor: 'voiceActor', charSignature: 'signature',
    };
    Object.keys(fields).forEach(function (domId) {
      var el = $(domId);
      if (!el) return;
      var key = fields[domId];
      el.oninput = function () { cs[key] = el.value; };
      el.onchange = function () { saveArt(); renderCharAvatar(); };
    });
  }

  function renderUploadSlots() {
    var slots = document.querySelectorAll('[data-upload-slot]');
    slots.forEach(function (slotEl) {
      var path = slotEl.getAttribute('data-upload-slot'); // e.g. "modelSheet.front"
      var box = slotEl.querySelector('.hm-char-ms-box');
      var currentUrl = getCharPath(path);

      if (currentUrl) {
        box.innerHTML =
          '<img src="' + api.mediaUrl(currentUrl) + '" alt="" data-preview-click>' +
          '<div class="hm-char-ms-actions">' +
            '<button class="hm-pill hm-pill-mini" data-slot-upload>🔁</button>' +
            '<button class="hm-pill hm-pill-mini hm-pill-danger" data-slot-clear>🗑</button>' +
          '</div>';
      } else {
        box.innerHTML =
          '<div class="hm-char-ms-empty" data-slot-upload>' +
            '<div class="hm-char-ms-emoji">＋</div>' +
            '<div class="hm-char-ms-hint">点击 / 拖入上传</div>' +
          '</div>';
      }

      // 上传
      slotEl.querySelectorAll('[data-slot-upload]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          pickAndUploadForSlot(path);
        });
      });
      // 清除
      slotEl.querySelectorAll('[data-slot-clear]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          setCharPath(path, '');
          saveArt();
          renderUploadSlots();
        });
      });
      // 预览
      slotEl.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function (e) {
          e.stopPropagation();
          openLightbox(img.src);
        });
      });
      // 拖放
      if (!slotEl.__msBound) {
        slotEl.__msBound = true;
        slotEl.addEventListener('dragover', function (e) { e.preventDefault(); slotEl.classList.add('hm-art-drop-hover'); });
        slotEl.addEventListener('dragleave', function () { slotEl.classList.remove('hm-art-drop-hover'); });
        slotEl.addEventListener('drop', function (e) {
          e.preventDefault();
          slotEl.classList.remove('hm-art-drop-hover');
          var f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) pickAndUploadForSlot(path, f);
        });
      }
    });
  }

  function getCharPath(path) {
    // path 如 "modelSheet.front"
    var parts = path.split('.');
    var cur = state.editing.characterSpec;
    for (var i = 0; i < parts.length; i++) {
      cur = cur && cur[parts[i]];
    }
    return cur || '';
  }
  function setCharPath(path, val) {
    var parts = path.split('.');
    var cur = state.editing.characterSpec;
    for (var i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function pickAndUploadForSlot(path, preFile) {
    if (preFile) {
      if (!preFile.type.startsWith('image/')) return;
      var reader = new FileReader();
      reader.onload = function () { uploadCharSlot(reader.result, path); };
      reader.readAsDataURL(preFile);
      return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { uploadCharSlot(r.result, path); };
      r.readAsDataURL(f);
    };
    input.click();
  }

  function uploadCharSlot(dataUrl, path) {
    A.toast && A.toast('上传中...');
    api.uploadArtMedia(dataUrl).then(function (res) {
      setCharPath(path, res.url);
      saveArt();
      renderUploadSlots();
      // 刷新对应 grid（如果是列表项）
      var parts = path.split('.');
      if (parts[0] === 'expressions') { renderCharGrid('charExpressionsGrid', state.editing.characterSpec.expressions, 'expressions'); }
      if (parts[0] === 'mouthShapes') { renderCharGrid('charMouthGrid', state.editing.characterSpec.mouthShapes, 'mouthShapes'); }
      if (parts[0] === 'poses') { renderCharGrid('charPosesGrid', state.editing.characterSpec.poses, 'poses'); }
      A.toast && A.toast('✅ 已上传', 'success');
    }).catch(function (err) {
      A.toast && A.toast('上传失败: ' + (err.message || err), 'error');
    });
  }

  function renderCharGrid(gridId, list, arrayKey) {
    var grid = $(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    if (!list || list.length === 0) return;
    list.forEach(function (item, idx) {
      var url = item.url ? api.mediaUrl(item.url) : '';
      var cell = document.createElement('div');
      cell.className = 'hm-char-cell';
      cell.innerHTML =
        '<div class="hm-char-cell-img">' +
          (url ? '<img src="' + url + '" alt="" data-preview-click>' : '<div class="hm-char-cell-empty">＋</div>') +
        '</div>' +
        '<input class="hm-char-cell-label" value="' + (item.label || '').replace(/"/g, '&quot;') + '" data-label="' + idx + '" data-array="' + arrayKey + '">' +
        '<div class="hm-char-cell-actions">' +
          '<button class="hm-pill hm-pill-mini" data-cell-upload="' + idx + '" data-array="' + arrayKey + '">📤</button>' +
          (list.length > 0 ? '<button class="hm-pill hm-pill-mini hm-pill-danger" data-cell-del="' + idx + '" data-array="' + arrayKey + '">✕</button>' : '') +
        '</div>';
      // 事件
      cell.querySelectorAll('[data-cell-upload]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-cell-upload'));
          uploadArrayItem(arrayKey, i);
        });
      });
      cell.querySelectorAll('[data-cell-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-cell-del'));
          getCsArray(arrayKey).splice(i, 1);
          saveArt();
          renderCharGrid(gridId, getCsArray(arrayKey), arrayKey);
        });
      });
      cell.querySelectorAll('[data-label]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var i = Number(inp.getAttribute('data-label'));
          getCsArray(arrayKey)[i].label = inp.value;
        });
        inp.addEventListener('change', function () { saveArt(); });
      });
      cell.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { openLightbox(img.src); });
      });
      // 点击图片也能上传（空状态）
      cell.querySelector('.hm-char-cell-img').addEventListener('click', function (e) {
        if (e.target.classList.contains('hm-char-cell-empty')) {
          var i = idx;
          uploadArrayItem(arrayKey, i);
        }
      });
      grid.appendChild(cell);
    });
  }

  function getCsArray(key) {
    return state.editing.characterSpec[key];
  }

  function uploadArrayItem(arrayKey, idx) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        A.toast && A.toast('上传中...');
        api.uploadArtMedia(r.result).then(function (res) {
          getCsArray(arrayKey)[idx].url = res.url;
          saveArt();
          // 重绘
          var gridIds = { expressions: 'charExpressionsGrid', mouthShapes: 'charMouthGrid', poses: 'charPosesGrid' };
          if (gridIds[arrayKey]) renderCharGrid(gridIds[arrayKey], getCsArray(arrayKey), arrayKey);
          A.toast && A.toast('✅ 已上传', 'success');
        }).catch(function (err) {
          A.toast && A.toast('上传失败: ' + (err.message || err), 'error');
        });
      };
      r.readAsDataURL(f);
    };
    input.click();
  }

  function renderVariants() {
    var box = $('charVariantsList');
    if (!box) return;
    var list = state.editing.characterSpec.variants || [];
    box.innerHTML = '';
    list.forEach(function (v, idx) {
      var url = v.url ? api.mediaUrl(v.url) : '';
      var row = document.createElement('div');
      row.className = 'hm-char-variant-row';
      row.innerHTML =
        '<div class="hm-char-variant-thumb">' +
          (url ? '<img src="' + url + '" alt="" data-preview-click>' : '<div class="hm-char-cell-empty">＋</div>') +
        '</div>' +
        '<input class="hm-char-variant-label" value="' + (v.label || '').replace(/"/g, '&quot;') + '" data-v-label="' + idx + '">' +
        '<div class="hm-char-variant-actions">' +
          '<button class="hm-pill hm-pill-mini" data-v-upload="' + idx + '">📤</button>' +
          '<button class="hm-pill hm-pill-mini hm-pill-danger" data-v-del="' + idx + '">✕</button>' +
        '</div>';
      row.querySelectorAll('[data-v-upload]').forEach(function (b) {
        b.addEventListener('click', function () { uploadVariant(idx); });
      });
      row.querySelectorAll('[data-v-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          list.splice(idx, 1); saveArt(); renderVariants();
        });
      });
      row.querySelectorAll('[data-v-label]').forEach(function (inp) {
        inp.addEventListener('input', function () { list[idx].label = inp.value; });
        inp.addEventListener('change', function () { saveArt(); });
      });
      row.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { openLightbox(img.src); });
      });
      box.appendChild(row);
    });
  }

  function uploadVariant(idx) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        api.uploadArtMedia(r.result).then(function (res) {
          state.editing.characterSpec.variants[idx].url = res.url;
          saveArt(); renderVariants();
        });
      };
      r.readAsDataURL(f);
    };
    input.click();
  }

  /* ============ 会审检查表 ============ */
  async function openChecklist() {
    try {
      var data = await api.getChecklist();
      state.checklist = (data && data.checklist) || null;
      renderChecklist();
      $('artChecklistOverlay').hidden = false;
    } catch (err) {
      A.toast && A.toast('加载检查表失败', 'error');
    }
  }

  function renderChecklist() {
    if (!state.checklist) return;
    var body = $('artChecklistBody');
    if (!body) return;

    var sections = [
      { key: 'sekai_board', title: '🌍 世界观氛围资料（氛围概念稿 + 世界观美术规范书）' },
      { key: 'bg_board',    title: '🏞️ 背景设定（平面/立面/透视/场景版本区分）' },
      { key: 'prop_board',  title: '🎒 道具/器物/自然物/材质光照' },
      { key: 'character_board', title: '🧑 角色设定（三视图/表情/口型/色卡）' },
      { key: 'creature_board',  title: '🦉 生物/怪物设定（并行独立板块）' },
      { key: 'mecha_board',     title: '🤖 机甲/可驾驶机械设定' },
      { key: 'effect_board',   title: '✨ 作画特效设定（角色招式，非环境）' },
      { key: 'visual_board',   title: '🎨 宣传视觉设定' },
      { key: 'logo_board',     title: '🔤 文字标识/纹章/LOGO 设定' },
      { key: 'coordination',   title: '📎 配套协同资料（色彩设计/原图基准规范/实地采风）' },
    ];

    body.innerHTML = sections.map(function (s) {
      var items = state.checklist[s.key] || [];
      var done = state.checklist.items || {};
      return '<div class="hm-art-cl-section">' +
        '<h4>' + s.title + '</h4>' +
        '<div class="hm-art-cl-items">' +
          items.map(function (txt, idx) {
            var checked = done[s.key + ':' + idx] ? ' checked' : '';
            return '<label class="hm-art-cl-item"><input type="checkbox" data-cl-key="' + s.key + '" data-cl-idx="' + idx + '"' + checked + '><span>' + txt + '</span></label>';
          }).join('') +
        '</div></div>';
    }).join('');

    // 绑定勾选
    body.querySelectorAll('[data-cl-key]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var items = state.checklist.items || (state.checklist.items = {});
        items[cb.getAttribute('data-cl-key') + ':' + cb.getAttribute('data-cl-idx')] = cb.checked;
        api.saveChecklist({ items: items }).catch(function () {});
      });
    });
  }

  /* ============ 全局绑定 ============ */
  function bind() {
    if (bind._done) return;
    bind._done = true;

    $('artNewBtn').addEventListener('click', createArt);
    $('artBackBtn').addEventListener('click', function () {
      state.editing = null;
      showListView();
      loadList();
    });
    $('artSaveBtn').addEventListener('click', saveArt);
    $('artDeleteBtn').addEventListener('click', function () {
      if (!state.editing) return;
      if (window.confirm('彻底删除「' + state.editing.title + '」？')) deleteArt(state.editing.id);
    });
    $('artChecklistBtn').addEventListener('click', openChecklist);
    $('artChecklistClose').addEventListener('click', function () {
      $('artChecklistOverlay').hidden = true;
    });
    $('artChecklistOverlay').addEventListener('click', function (e) {
      if (e.target === $('artChecklistOverlay')) $('artChecklistOverlay').hidden = true;
    });
    $('artImportBtn').addEventListener('click', openImportWizard);

    // 筛选
    var searchTimer = null;
    $('artSearch').addEventListener('input', function () {
      state.keyword = this.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderGrid, 200);
    });
    $('artStatusFilter').addEventListener('change', function () {
      state.filterStatus = this.value; renderGrid();
    });
    $('artTypeFilter').addEventListener('change', function () {
      state.filterType = this.value; renderGrid();
    });

    // 色卡 "添加颜色" 按钮（事件委托）
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-color]');
      if (!btn) return;
      var groupKey = btn.getAttribute('data-add-color');
      if (!state.editing) { A.toast && A.toast('请先进入编辑状态', 'error'); return; }
      var g = state.editing.colorSpec[groupKey];
      if (!Array.isArray(g)) g = [];
      g.push({ name: '', hex: '#ffffff' });
      state.editing.colorSpec[groupKey] = g;
      var gridId = groupKey === 'palette' ? 'artPaletteGrid' : groupKey === 'shadows' ? 'artShadowGrid' : 'artHighlightGrid';
      renderColorGroup(gridId, g, groupKey);
    });
  }

  /* ============ 批量导入向导 ============ */
  function openImportWizard() {
    var overlay = document.createElement('div');
    overlay.className = 'hm-import-overlay';
    overlay.innerHTML =
      '<div class="hm-import-modal">' +
        '<div class="hm-import-header">' +
          '<h3>📥 批量导入美术设定 / 角色</h3>' +
          '<button class="hm-import-close" title="关闭 (ESC)">✕</button>' +
        '</div>' +
        '<div class="hm-import-body">' +
          '<div class="hm-import-steps">' +
            '<div class="hm-import-step active" data-step="1">① 准备数据</div>' +
            '<div class="hm-import-step" data-step="2">② 解析预览</div>' +
            '<div class="hm-import-step" data-step="3">③ 确认导入</div>' +
          '</div>' +
          '<div class="hm-import-pane" data-pane="1">' +
            '<div class="hm-import-pane-title">输入方式</div>' +
            '<div class="hm-import-tabs">' +
              '<button class="hm-import-tab active" data-tab="json">📄 JSON 粘贴</button>' +
              '<button class="hm-import-tab" data-tab="file">📁 选择文件</button>' +
              '<button class="hm-import-tab" data-tab="template">📑 下载模板</button>' +
            '</div>' +
            '<div class="hm-import-tab-pane" data-tab-pane="json">' +
              '<textarea class="hm-import-ta" id="importJson" placeholder=\'粘贴 JSON 数组，如: [{"title":"角色A","category":"character",...}]\'></textarea>' +
              '<div class="hm-import-hint">每行 1 个对象的 JSON 数组格式，最多 500 条</div>' +
            '</div>' +
            '<div class="hm-import-tab-pane" data-tab-pane="file" hidden>' +
              '<div class="hm-import-drop" id="importDrop">📁 点击或拖入 .json 文件</div>' +
              '<input type="file" id="importFile" accept=".json,.csv" hidden>' +
            '</div>' +
            '<div class="hm-import-tab-pane" data-tab-pane="template" hidden>' +
              '<div class="hm-import-hint">下载 Excel / JSON 模板，按模板填完后上传</div>' +
              '<div class="hm-import-templates">' +
                '<button class="hm-pill" id="importTemplateChar">🧑 角色设定模板 (JSON)</button>' +
                '<button class="hm-pill" id="importTemplateSimple">📋 简易角色清单 (CSV)</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="hm-import-pane" data-pane="2" hidden>' +
            '<div class="hm-import-pane-title">解析预览</div>' +
            '<div class="hm-import-preview" id="importPreview"></div>' +
            '<div class="hm-import-summary" id="importSummary"></div>' +
          '</div>' +
          '<div class="hm-import-pane" data-pane="3" hidden>' +
            '<div class="hm-import-pane-title">确认导入</div>' +
            '<div class="hm-import-confirm" id="importConfirm"></div>' +
          '</div>' +
        '</div>' +
        '<div class="hm-import-footer">' +
          '<button class="hm-pill hm-pill-ghost" data-import-prev" hidden>← 上一步</button>' +
          '<button class="hm-pill" data-import-next>下一步 →</button>' +
          '<button class="hm-pill hm-pill-primary" data-import-go hidden>🚀 开始导入</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var state2 = { items: [], mode: 'json', step: 1 };
    var $ = overlay.querySelector.bind(overlay);

    // 关闭
    function close() { document.body.removeChild(overlay); }
    overlay.querySelector('.hm-import-close').onclick = close;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    // Tab 切换
    overlay.querySelectorAll('.hm-import-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        overlay.querySelectorAll('.hm-import-tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var tab = t.getAttribute('data-tab');
        overlay.querySelectorAll('.hm-import-tab-pane').forEach(function (p) { p.hidden = true; });
        overlay.querySelector('.hm-import-tab-pane[data-tab-pane="' + tab + '"]').hidden = false;
        state2.mode = tab;
      });
    });

    // 文件选择 / 拖放
    overlay.querySelector('#importDrop').onclick = function () {
      overlay.querySelector('#importFile').click();
    };
    overlay.querySelector('#importFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) readImportFile(f);
    };
    var drop = overlay.querySelector('#importDrop');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('active'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('active'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('active');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readImportFile(f);
    });

    function readImportFile(f) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = reader.result;
          var parsed = tryParse(text, f.name);
          state2.items = parsed.items;
          goStep(2);
        } catch (err) {
          A.toast && A.toast('解析失败: ' + err.message, 'error');
        }
      };
      reader.readAsText(f, 'utf-8');
    }

    function tryParse(text, name) {
      text = (text || '').trim();
      if (text.startsWith('[') || text.startsWith('{')) {
        var json = JSON.parse(text);
        if (Array.isArray(json)) return { items: json };
        if (Array.isArray(json.items)) return { items: json.items };
        throw new Error('JSON 需为数组或带 items 字段');
      }
      // CSV fallback
      if (name && name.toLowerCase().endsWith('.csv')) {
        return parseCSV(text);
      }
      // 自动判断是否像 CSV
      if (text.indexOf(',') >= 0 && text.indexOf('\n') >= 0 && !text.startsWith('{')) {
        return parseCSV(text);
      }
      throw new Error('无法识别格式，请用 JSON 或 CSV');
    }

    function parseCSV(text) {
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length === 0) return { items: [] };
      var headers = splitCSV(lines[0]).map(function (h) { return h.trim(); });
      var titleIdx = headers.indexOf('title');
      var items = [];
      for (var i = 1; i < lines.length; i++) {
        var row = splitCSV(lines[i]);
        var obj = { category: 'character', section: '', status: 'draft', version: 'Ver1.0', tags: [], colorSpec: { palette: [], shadows: [], highlights: [] }, characterSpec: { expressions: [], mouthShapes: [], poses: [], variants: [], modelSheet: { front: '', side: '', back: '' } } };
        var char = obj.characterSpec;
        for (var j = 0; j < headers.length; j++) {
          var h = headers[j].trim().toLowerCase();
          var v = (row[j] || '').trim();
          if (h === 'title') obj.title = v;
          else if (h === 'subtitle') obj.subtitle = v;
          else if (h === 'category') obj.category = v || 'character';
          else if (h === 'section') obj.section = v;
          else if (h === 'tags') obj.tags = v ? v.split(/[|,]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
          else if (h === 'role') char.role = v;
          else if (h === 'gender') char.gender = v;
          else if (h === 'age') char.age = v;
          else if (h === 'height') char.height = v;
          else if (h === 'weight') char.weight = v;
          else if (h === 'voiceactor' || h === 'voice_actor' || h === 'cv') char.voiceActor = v;
          else if (h === 'signature') char.signature = v;
          else if (h === 'hair' || h === 'haircolor') char.hairColor = v;
          else if (h === 'eye' || h === 'eyecolor') char.eyeColor = v;
          else if (h === 'skin' || h === 'skincolor') char.skinColor = v;
          else if (h === 'outfit' || h === 'outfitcolor') char.outfitMainColor = v;
        }
        if (obj.title) items.push(obj);
      }
      return { items: items };
    }

    function splitCSV(line) {
      var out = []; var cur = ''; var q = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') { q = !q; continue; }
        if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    }

    // 模板下载
    overlay.querySelector('#importTemplateChar').onclick = function () {
      var tpl = {
        _comment: '角色设定批量导入模板 (JSON) —— 每个对象会被独立创建，自动生成 id',
        items: [
          { title: '角色A', subtitle: '示例', category: 'character', section: 'Model Sheet', status: 'draft', version: 'Ver1.0', tags: ['主角', '男'],
            characterSpec: { role: '主角', gender: '男', age: '16', height: '172cm', weight: '58kg', voiceActor: '花泽香菜', signature: '命运的齿轮...',
              hairColor: '#8B5A2B', eyeColor: '#2E3A59', skinColor: '#FFDBAC', outfitMainColor: '#4A5568',
              modelSheet: { front: '', side: '', back: '' },
              expressions: [], mouthShapes: [], poses: [], variants: [] } }
        ]
      };
      downloadBlob(JSON.stringify(tpl, null, 2), 'character-template.json', 'application/json');
    };
    overlay.querySelector('#importTemplateSimple').onclick = function () {
      var csv = 'title,role,gender,age,height,voiceactor,signature,haircolor,eyecolor\n';
      csv += '角色A,主角,男,16,172cm,花泽香菜,命运的齿轮,#8B5A2B,#2E3A59\n';
      csv += '角色B,女主,女,15,162cm,泽城美雪,樱花纷飞,#E91E63,#4472C4\n';
      downloadBlob(csv, 'character-simple.csv', 'text/csv;charset=utf-8');
    };
    function downloadBlob(text, name, mime) {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // 步骤切换
    function goStep(step) {
      state2.step = step;
      overlay.querySelectorAll('.hm-import-pane').forEach(function (p) { p.hidden = true; });
      overlay.querySelector('.hm-import-pane[data-pane="' + step + '"]').hidden = false;
      overlay.querySelectorAll('.hm-import-step').forEach(function (s) {
        s.classList.toggle('active', Number(s.getAttribute('data-step')) <= step);
        s.classList.toggle('current', Number(s.getAttribute('data-step')) === step);
      });
      // 按钮
      $('[data-import-prev]').hidden = step <= 1;
      $('[data-import-next]').hidden = step >= 3;
      $('[data-import-go]').hidden = step < 3;
      if (step === 2) renderPreview();
      if (step === 3) renderConfirm();
    }

    function renderPreview() {
      var items = state2.items;
      var table = overlay.querySelector('#importPreview');
      var summary = overlay.querySelector('#importSummary');
      if (!items || items.length === 0) {
        table.innerHTML = '<div class="hm-import-empty">⚠️ 解析出 0 条数据，请检查输入格式</div>';
        summary.textContent = '';
        return;
      }
      summary.textContent = '✅ 解析成功：' + items.length + ' 条 · 预计创建 ' + Math.min(items.length, 500) + ' 条';
      var html = '<div class="hm-import-table"><table><thead><tr><th>#</th><th>标题</th><th>分类</th><th>子节</th><th>角色定位</th><th>状态</th></tr></thead><tbody>';
      items.slice(0, 50).forEach(function (it, i) {
        var cat = it.category || 'character';
        var role = (it.characterSpec && it.characterSpec.role) || '';
        var title = (it.title || '(无标题)').replace(/[<>]/g, '').slice(0, 30);
        html += '<tr><td>' + (i + 1) + '</td><td>' + title + '</td><td>' + cat + '</td><td>' + (it.section || '—') + '</td><td>' + role + '</td><td>' + (it.status || 'draft') + '</td></tr>';
      });
      html += '</tbody></table></div>';
      if (items.length > 50) html += '<div class="hm-import-hint">... 后 ' + (items.length - 50) + ' 条省略</div>';
      table.innerHTML = html;
    }

    function renderConfirm() {
      var box = overlay.querySelector('#importConfirm');
      var items = state2.items;
      var charCount = items.filter(function (i) { return (i.category || 'character') === 'character'; }).length;
      box.innerHTML =
        '<div class="hm-import-confirm-box">' +
          '<div class="hm-import-confirm-row"><span>总条目数</span><b>' + items.length + '</b></div>' +
          '<div class="hm-import-confirm-row"><span>角色设定</span><b>' + charCount + '</b></div>' +
          '<div class="hm-import-confirm-row"><span>其他分类</span><b>' + (items.length - charCount) + '</b></div>' +
          '<div class="hm-import-confirm-row hm-import-confirm-warn"><span>⚠️ 注意</span><span>导入后每条自动分配 ID 与 createdAt，不可回滚</span></div>' +
        '</div>';
    }

    // 下一步按钮
    overlay.querySelector('[data-import-next]').onclick = function () {
      if (state2.step === 1) {
        // 收集输入
        if (state2.mode === 'json') {
          var text = overlay.querySelector('#importJson').value.trim();
          if (!text) { A.toast && A.toast('请输入或粘贴 JSON 数组', 'error'); return; }
          try {
            var json = JSON.parse(text);
            state2.items = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : []);
          } catch (err) {
            A.toast && A.toast('JSON 解析失败: ' + err.message, 'error');
            return;
          }
        }
        if (!state2.items || state2.items.length === 0) {
          A.toast && A.toast('解析出 0 条数据', 'error');
          return;
        }
        if (state2.items.length > 500) {
          A.toast && A.toast('单次最多 500 条，已自动截断', 'error');
          state2.items = state2.items.slice(0, 500);
        }
      }
      goStep(state2.step + 1);
    };
    overlay.querySelector('[data-import-prev]').onclick = function () {
      goStep(state2.step - 1);
    };
    overlay.querySelector('[data-import-go]').onclick = async function () {
      var btn = overlay.querySelector('[data-import-go]');
      btn.disabled = true;
      btn.textContent = '⏳ 导入中...';
      try {
        var res = await api.bulkImportArts(state2.items);
        A.toast && A.toast('✅ 导入完成：' + res.inserted + ' 条' + (res.skipped ? '，跳过 ' + res.skipped + ' 条' : ''), 'success');
        close();
        loadList();
      } catch (err) {
        btn.disabled = false; btn.textContent = '🚀 开始导入';
        A.toast && A.toast('导入失败: ' + (err.message || err), 'error');
      }
    };
  }

  window.HMArt = { enter: enter, state: state };
})();

/* ========================================================================
 * HMOUA — Original Animation 原画（第一原画 / 第二原画 · 中割り）
 * ======================================================================== */
(function () {
  var A = window.HMApp;
  var state = {
    list: [], team: 'first', sortBy: 'updatedAt',
    editing: null, draft: null, saveTimer: null,
  };
  var ST_LABELS = { todo: '未开始', wip: '进行中', review: '审图中', final: '定稿' };
  var FB_LABELS = { pending: '待提交', submitted: '已提交', reviewing: '审图中', fixing: '修正中', approved: '已通过' };

  function $(id) { return document.getElementById(id); }

  function enter() {
    bindTop();
    bindTeamTabs();
    bindFilters();
    loadList();
  }

  /* ============ 事件绑定 ============ */
  function bindTop() {
    var btn = $('ouaNewBtn');
    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', createNew);
    }
    var imp = $('ouaImportBtn');
    if (imp && !imp.__bound) {
      imp.__bound = true;
      imp.addEventListener('click', openImportWizard);
    }
    var exp = $('ouaExportBtn');
    if (exp && !exp.__bound) {
      exp.__bound = true;
      exp.addEventListener('click', exportCsv);
    }
  }
  function bindTeamTabs() {
    document.querySelectorAll('#ouaTeamTabs .hm-oua-team-tab').forEach(function (el) {
      if (el.__bound) return;
      el.__bound = true;
      el.addEventListener('click', function () {
        document.querySelectorAll('#ouaTeamTabs .hm-oua-team-tab').forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
        state.team = el.getAttribute('data-team');
        // 如果有正在编辑的镜头，也要把它的 team 同步
        if (state.editing) { state.editing.team = state.team; }
        loadList();
      });
    });
  }
  function bindFilters() {
    ['ouaSearch', 'ouaStatusFilter', 'ouaShotFilter'].forEach(function (id) {
      var el = $(id); if (!el || el.__bound) return;
      el.__bound = true;
      var deb;
      el.addEventListener('input', function () {
        clearTimeout(deb); deb = setTimeout(loadList, 300);
      });
      el.addEventListener('change', function () { clearTimeout(deb); loadList(); });
    });
    document.querySelectorAll('.hm-oua-list-sort .hm-pill').forEach(function (el) {
      if (el.__bound) return;
      el.__bound = true;
      el.addEventListener('click', function () {
        state.sortBy = el.getAttribute('data-sort');
        renderGrid();
      });
    });
  }

  /* ============ 列表 ============ */
  function loadList() {
    var qp = new URLSearchParams();
    qp.set('team', state.team);
    var kw = $('ouaSearch').value.trim(); if (kw) qp.set('keyword', kw);
    var sf = $('ouaStatusFilter').value; if (sf !== 'all') qp.set('status', sf);
    var shot = $('ouaShotFilter').value.trim(); if (shot) qp.set('shotNo', shot);
    state.list = [];
    api.listOua('?' + qp.toString()).then(function (res) {
      state.list = res.items || [];
      renderGrid();
    }).catch(function (err) {
      A.toast && A.toast('加载镜头失败: ' + (err.message || err), 'error');
    });
  }

  function renderGrid() {
    var grid = $('ouaGrid');
    if (!grid) return;
    grid.innerHTML = '';
    var items = state.list.slice();
    items.sort(function (a, b) {
      if (state.sortBy === 'shotNo') return (a.shotNo || '').localeCompare(b.shotNo || '');
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
    items.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'hm-oua-card hm-oua-st-' + s.status;
      var first = s.first || {}; var second = s.second || {};
      var kCount = (first.poseKeyframes || []).length;
      var tCount = (second.tweens || []).length;
      var teamLabel = (s.team === 'second') ? '🎬 第二原画' : '🎨 第一原画';
      card.innerHTML =
        '<div class="hm-oua-card-head">' +
          '<span class="hm-oua-shotno">' + (s.shotNo || '—') + '</span>' +
          '<span class="hm-oua-status">' + ST_LABELS[s.status] + '</span>' +
        '</div>' +
        '<div class="hm-oua-card-title">' + (s.title || '(无标题)') + '</div>' +
        '<div class="hm-oua-card-info">' +
          '<div>🏷 ' + teamLabel + '</div>' +
          '<div>👤 ' + (first.director || first.animator || '—') + '</div>' +
          '<div>🎥 ' + (first.cameraMove || '固定') + '</div>' +
        '</div>' +
        '<div class="hm-oua-card-foot">' +
          '<span>🔢 K帧 ' + kCount + '</span>' +
          '<span>🎞 中割 ' + tCount + '</span>' +
        '</div>';
      card.addEventListener('click', function () { openEditor(s.id); });
      grid.appendChild(card);
    });
    $('ouaListCount').textContent = items.length + ' 镜头 · ' + teamLabelFor(state.team);
  }
  function teamLabelFor(t) { return t === 'second' ? '第二原画（動画）' : '第一原画（本番原画）'; }

  /* ============ 新建 ============ */
  function createNew() {
    var shotNo = window.prompt('镜号（如: 1-01）', ('1-' + (state.list.filter(function (s) { return s.team === state.team; }).length + 1)));
    if (shotNo === null) return;
    var payload = { shotNo: shotNo, team: state.team, status: 'todo', title: '' };
    api.createOua(payload).then(function (res) {
      openEditor(res.shot.id);
    }).catch(function (err) {
      A.toast && A.toast('新建失败: ' + (err.message || err), 'error');
    });
  }

  /* ============ 编辑器 ============ */
  function openEditor(id) {
    var listView = $('ouaListView');
    var editView = $('ouaEditorView');
    listView.hidden = true; editView.hidden = false;
    api.getOua(id).then(function (res) {
      state.editing = res.shot;
      state.draft = JSON.parse(JSON.stringify(res.shot));
      populateEditor();
      A.toast && A.toast('已加载镜号 ' + res.shot.shotNo);
    }).catch(function (err) {
      A.toast && A.toast('加载失败: ' + (err.message || err), 'error');
    });
  }

  function populateEditor() {
    var s = state.editing;
    var f = s.first = s.first || {};
    var sec = s.second = s.second || {};
    f.poseKeyframes = f.poseKeyframes || [];
    sec.tweens = sec.tweens || [];
    sec.shapeCheck = sec.shapeCheck || [];
    sec.motionCheck = sec.motionCheck || [];

    $('ouaBackBtn').onclick = function () {
      editView.hidden = true; listView.hidden = false;
      loadList(); state.editing = null; state.draft = null;
    };
    $('ouaDeleteBtn').onclick = function () {
      if (!window.confirm('确定删除 ' + s.shotNo + ' ' + (s.title || '') + ' ?')) return;
      api.deleteOua(s.id).then(function () {
        editView.hidden = true; listView.hidden = false;
        loadList(); state.editing = null; state.draft = null;
        A.toast && A.toast('已删除');
      });
    };
    $('ouaSaveBtn').onclick = function () { saveShot(); };

    // 元信息
    $('ouaShotNo').value = s.shotNo || '';
    $('ouaTitle').value = s.title || '';
    $('ouaSceneRef').value = s.sceneRef || '';
    $('ouaStatus').value = s.status || 'todo';
    $('ouaVersion').value = s.version || 'Ver1.0';
    $('ouaTags').value = (s.tags || []).join(', ');
    $('ouaEditorTitle').textContent = (s.title || '(无标题)') + ' — ' + (s.shotNo || '—');
    $('ouaShotTag').textContent = s.shotNo || '—';
    $('ouaStatusTag').textContent = ST_LABELS[s.status] || '未开始';

    // 团队 block 切换
    $('ouaFirstBlock').hidden = (s.team === 'second');
    $('ouaSecondBlock').hidden = (s.team !== 'second');
    // 同步 team tab
    document.querySelectorAll('#ouaTeamTabs .hm-oua-team-tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-team') === s.team); });
    state.team = s.team;

    // 第一原画字段
    $('ouaDirector').value = f.director || '';
    $('ouaCameraMove').value = f.cameraMove || '固定';
    $('ouaCameraDuration').value = f.cameraDuration || '';
    $('ouaTimeSheet').value = f.timeSheet || '';
    $('ouaActionFlow').value = f.actionFlow || '';
    $('ouaDialoguePoint').value = f.dialoguePoint || '';
    $('ouaSfxPoint').value = f.sfxPoint || '';
    $('ouaLayoutRef').value = (f.layoutRef || []).join(', ');
    $('ouaDrawingNotes').value = f.drawingNotes || '';

    // 第二原画字段
    $('ouaAnimator').value = sec.animator || '';
    $('ouaTotalFrames').value = sec.totalFrames || 0;
    $('ouaFeedbackStatus').value = sec.feedbackStatus || 'pending';
    $('ouaRevisionCount').value = sec.revisionCount || 0;
    $('ouaFeedbackNote').value = sec.feedbackNote || '';
    $('ouaShapeCheck').value = (Array.isArray(sec.shapeCheck) ? sec.shapeCheck.map(function (c) { return (c.frameNum ? '帧' + c.frameNum + ' ' : '') + (c.note || ''); }).join('\n') : (sec.shapeCheckText || ''));
    $('ouaMotionCheck').value = (Array.isArray(sec.motionCheck) ? sec.motionCheck.map(function (c) { return (c.frameNum ? '帧' + c.frameNum + ' ' : '') + (c.note || ''); }).join('\n') : (sec.motionCheckText || ''));

    // 公用
    $('ouaCharacterRef').value = (f.characterRef || []).map(function (r) { return r.characterId || r.name || ''; }).filter(Boolean).join(', ');

    // K帧列表 + 下拉
    renderKeyframesList();
    renderKeyframeSelects();
    renderTweensList();

    // 绑定输入 → 自动保存
    bindAutoSave();

    // 添加按钮
    $('ouaAddKeyframe').onclick = function () {
      f.poseKeyframes.push({
        frame: f.poseKeyframes.length * 4 + 0,
        second: (f.poseKeyframes.length * 0.4).toFixed(1),
        pose: 'K 帧 ' + (f.poseKeyframes.length + 1),
        url: '', note: '', keyType: 'key',
      });
      renderKeyframesList(); renderKeyframeSelects(); saveShot();
    };
    $('ouaAddTween').onclick = function () {
      var total = (sec.totalFrames || 0) + sec.tweens.length + 1;
      sec.tweens.push({
        frameNum: total,
        ratio: (sec.tweens.length + 1) / (sec.totalFrames || 12),
        url: '', note: '', issue: '',
      });
      sec.totalFrames = total;
      renderTweensList(); saveShot();
    };
  }

  function renderKeyframesList() {
    var list = $('ouaKeyframesList');
    var f = state.editing.first;
    list.innerHTML = '';
    (f.poseKeyframes || []).forEach(function (k, idx) {
      var row = document.createElement('div');
      row.className = 'hm-oua-kframe-row';
      var typeOpts = [
        ['layout', 'Layout'], ['key', 'K帧/本番'], ['breakdown', '分解帧'], ['pose', 'Pose参考']
      ].map(function (t) { return '<option value="' + t[0] + '"' + (k.keyType === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('');
      var imgCell = '';
      if (k.url) {
        imgCell = '<div class="hm-oua-kframe-img"><img src="' + api.mediaUrl(k.url) + '" alt="" data-preview-click></div>';
      } else {
        imgCell = '<div class="hm-oua-kframe-img hm-oua-kframe-empty" data-kf-upload="' + idx + '">＋</div>';
      }
      row.innerHTML =
        '<div class="hm-oua-kframe-idx">#' + (idx + 1) + '</div>' +
        imgCell +
        '<div class="hm-oua-kframe-fields">' +
          '<input class="hm-oua-kf-f" placeholder="帧" type="number" min="0" value="' + (k.frame || '') + '" data-kf-frame="' + idx + '">' +
          '<input class="hm-oua-kf-s" placeholder="秒" type="number" min="0" step="0.1" value="' + (k.second || '') + '" data-kf-sec="' + idx + '">' +
          '<select class="hm-oua-kf-type" data-kf-type="' + idx + '">' + typeOpts + '</select>' +
          '<input class="hm-oua-kf-pose" placeholder="Pose 名称" value="' + (k.pose || '').replace(/"/g, '&quot;') + '" data-kf-pose="' + idx + '">' +
          '<input class="hm-oua-kf-note" placeholder="备注" value="' + (k.note || '').replace(/"/g, '&quot;') + '" data-kf-note="' + idx + '">' +
        '</div>' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger" data-kf-del="' + idx + '">✕</button>';
      row.querySelectorAll('[data-kf-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          f.poseKeyframes.splice(idx, 1);
          renderKeyframesList(); renderKeyframeSelects(); saveShot();
        });
      });
      row.querySelectorAll('[data-kf-frame],[data-kf-sec],[data-kf-type],[data-kf-pose],[data-kf-note]').forEach(function (el) {
        el.addEventListener('input', function () {
          var key = el.getAttribute('data-kf-frame') !== null ? 'frame' :
                    el.getAttribute('data-kf-sec') !== null ? 'second' :
                    el.getAttribute('data-kf-type') !== null ? 'keyType' :
                    el.getAttribute('data-kf-pose') !== null ? 'pose' : 'note';
          if (key === 'frame') k.frame = Number(el.value) || 0;
          else if (key === 'second') k.second = Number(el.value) || 0;
          else k[key] = el.value;
          scheduleSave();
        });
      });
      row.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { window.HMArt && window.HMArt.openLightbox && window.HMArt.openLightbox(img.src); });
      });
      row.querySelectorAll('[data-kf-upload]').forEach(function (el) {
        el.addEventListener('click', function () { uploadKeyframe(idx); });
      });
      list.appendChild(row);
    });
  }

  function renderKeyframeSelects() {
    var f = state.editing.first;
    var selA = $('ouaKeyASelect'); var selB = $('ouaKeyBSelect');
    if (!selA || !selB) return;
    var opts = '<option value="-1">（未选择）</option>';
    (f.poseKeyframes || []).forEach(function (k, i) {
      opts += '<option value="' + i + '">#' + (i + 1) + ' ' + (k.pose || '') + ' @' + (k.second || '0') + 's</option>';
    });
    selA.innerHTML = opts; selB.innerHTML = opts;
    secBind('ouaKeyASelect'); secBind('ouaKeyBSelect');
  }
  function secBind(id) {
    var sel = $(id);
    if (!sel) return;
    var sec = state.editing.second;
    var val = (id === 'ouaKeyASelect') ? (sec.keyA_idx || -1) : (sec.keyB_idx || -1);
    sel.value = String(val);
    sel.onchange = function () {
      var s = state.editing.second;
      if (id === 'ouaKeyASelect') s.keyA_idx = Number(sel.value) || -1;
      else s.keyB_idx = Number(sel.value) || -1;
      saveShot();
    };
  }

  function renderTweensList() {
    var list = $('ouaTweensList');
    var sec = state.editing.second;
    list.innerHTML = '';
    (sec.tweens || []).forEach(function (t, idx) {
      var row = document.createElement('div');
      row.className = 'hm-oua-tween-row';
      var imgCell = '';
      if (t.url) {
        imgCell = '<div class="hm-oua-tween-img"><img src="' + api.mediaUrl(t.url) + '" alt="" data-preview-click></div>';
      } else {
        imgCell = '<div class="hm-oua-tween-img hm-oua-tween-empty" data-tween-upload="' + idx + '">＋</div>';
      }
      row.innerHTML =
        '<div class="hm-oua-tween-num">' + (idx + 1) + '</div>' +
        imgCell +
        '<div class="hm-oua-tween-fields">' +
          '<input class="hm-oua-tf-f" placeholder="帧" type="number" min="0" value="' + (t.frameNum || '') + '" data-tw-f="' + idx + '">' +
          '<input class="hm-oua-tf-r" placeholder="比例" type="number" min="0" max="1" step="0.01" value="' + (t.ratio || '') + '" data-tw-r="' + idx + '">' +
          '<input class="hm-oua-tf-note" placeholder="备注" value="' + (t.note || '').replace(/"/g, '&quot;') + '" data-tw-note="' + idx + '">' +
          '<input class="hm-oua-tf-issue" placeholder="问题" value="' + (t.issue || '').replace(/"/g, '&quot;') + '" data-tw-issue="' + idx + '">' +
        '</div>' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger" data-tw-del="' + idx + '">✕</button>';
      row.querySelectorAll('[data-tw-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          sec.tweens.splice(idx, 1); renderTweensList(); saveShot();
        });
      });
      row.querySelectorAll('[data-tw-f],[data-tw-r],[data-tw-note],[data-tw-issue]').forEach(function (el) {
        el.addEventListener('input', function () {
          var key = el.getAttribute('data-tw-f') !== null ? 'frameNum' :
                    el.getAttribute('data-tw-r') !== null ? 'ratio' :
                    el.getAttribute('data-tw-note') !== null ? 'note' : 'issue';
          if (key === 'frameNum' || key === 'ratio') t[key] = Number(el.value) || 0;
          else t[key] = el.value;
          scheduleSave();
        });
      });
      row.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { window.HMArt && window.HMArt.openLightbox && window.HMArt.openLightbox(img.src); });
      });
      row.querySelectorAll('[data-tween-upload]').forEach(function (el) {
        el.addEventListener('click', function () { uploadTween(idx); });
      });
      list.appendChild(row);
    });
  }

  /* ============ 图片上传（K帧 / 中割帧） ============ */
  function uploadKeyframe(idx) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        A.toast && A.toast('上传中...');
        api.uploadArtMedia(reader.result).then(function (res) {
          state.editing.first.poseKeyframes[idx].url = res.url;
          renderKeyframesList(); saveShot();
          A.toast && A.toast('✅ 已上传', 'success');
        }).catch(function (err) {
          A.toast && A.toast('上传失败: ' + (err.message || err), 'error');
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }
  function uploadTween(idx) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        A.toast && A.toast('上传中...');
        api.uploadArtMedia(reader.result).then(function (res) {
          state.editing.second.tweens[idx].url = res.url;
          renderTweensList(); saveShot();
          A.toast && A.toast('✅ 已上传', 'success');
        }).catch(function (err) {
          A.toast && A.toast('上传失败: ' + (err.message || err), 'error');
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  /* ============ 自动保存绑定 ============ */
  function bindAutoSave() {
    var ids = [
      'ouaShotNo', 'ouaTitle', 'ouaSceneRef', 'ouaStatus', 'ouaVersion', 'ouaTags',
      'ouaDirector', 'ouaCameraMove', 'ouaCameraDuration', 'ouaTimeSheet', 'ouaActionFlow',
      'ouaDialoguePoint', 'ouaSfxPoint', 'ouaLayoutRef', 'ouaDrawingNotes',
      'ouaAnimator', 'ouaTotalFrames', 'ouaFeedbackStatus', 'ouaRevisionCount',
      'ouaFeedbackNote', 'ouaShapeCheck', 'ouaMotionCheck', 'ouaCharacterRef',
    ];
    ids.forEach(function (id) {
      var el = $(id); if (!el || el.__as) return;
      el.__as = true;
      el.addEventListener('input', scheduleSave);
      el.addEventListener('change', scheduleSave);
    });
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveShot, 1200);
  }

  function saveShot() {
    if (!state.editing) return;
    var s = state.editing;
    var f = s.first = s.first || {};
    var sec = s.second = s.second || {};
    s.shotNo = $('ouaShotNo').value;
    s.title = $('ouaTitle').value;
    s.sceneRef = $('ouaSceneRef').value;
    s.status = $('ouaStatus').value;
    s.version = $('ouaVersion').value;
    s.team = state.team;
    s.tags = ($('ouaTags').value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    f.director = $('ouaDirector').value;
    f.cameraMove = $('ouaCameraMove').value;
    f.cameraDuration = $('ouaCameraDuration').value;
    f.timeSheet = $('ouaTimeSheet').value;
    f.actionFlow = $('ouaActionFlow').value;
    f.dialoguePoint = $('ouaDialoguePoint').value;
    f.sfxPoint = $('ouaSfxPoint').value;
    f.layoutRef = ($('ouaLayoutRef').value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    f.drawingNotes = $('ouaDrawingNotes').value;
    sec.animator = $('ouaAnimator').value;
    sec.totalFrames = Number($('ouaTotalFrames').value) || 0;
    sec.feedbackStatus = $('ouaFeedbackStatus').value;
    sec.revisionCount = Number($('ouaRevisionCount').value) || 0;
    sec.feedbackNote = $('ouaFeedbackNote').value;
    sec.shapeCheckText = $('ouaShapeCheck').value;
    sec.motionCheckText = $('ouaMotionCheck').value;
    var chars = ($('ouaCharacterRef').value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    f.characterRef = chars.map(function (c) { return { characterId: c, expression: '', outfit: '' }; });

    api.updateOua(s.id, s).then(function () {
      var tag = $('ouaStatusTag');
      tag.textContent = ST_LABELS[s.status] || '未开始';
      $('ouaEditorTitle').textContent = (s.title || '(无标题)') + ' — ' + (s.shotNo || '—');
    }).catch(function (err) {
      A.toast && A.toast('保存失败: ' + (err.message || err), 'error');
    });
  }

  /* ============ 导出 ============ */
  function exportCsv() {
    var url = api.exportOua(state.team);
    window.open(url, '_blank');
  }

  /* ============ 批量导入向导 ============ */
  function openImportWizard() {
    var overlay = document.createElement('div');
    overlay.className = 'hm-import-overlay';
    overlay.id = 'hmOuaImportOverlay';
    overlay.innerHTML = buildImportMarkup();
    document.body.appendChild(overlay);

    var step = 1, parsed = null, inputTextarea, inputDrop, inputFile, curTab = 'json';

    // 关闭
    overlay.querySelector('.hm-import-close').onclick = closeAll;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAll(); });
    function closeAll() { overlay.remove(); }

    // Tab 切换
    overlay.querySelectorAll('.hm-import-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        curTab = t.getAttribute('data-tab');
        overlay.querySelectorAll('.hm-import-tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        overlay.querySelectorAll('.hm-import-pane').forEach(function (p) { p.hidden = p.id !== 'hmOuaPane-' + curTab; });
      });
    });

    // JSON textarea
    inputTextarea = overlay.querySelector('#hmOuaPane-json .hm-import-ta');

    // 文件 drop zone
    inputDrop = overlay.querySelector('#hmOuaPane-file .hm-import-drop');
    inputFile = overlay.querySelector('#hmOuaPane-file input[type=file]');
    inputDrop.addEventListener('click', function () { inputFile.click(); });
    inputDrop.addEventListener('dragover', function (e) { e.preventDefault(); inputDrop.classList.add('active'); });
    inputDrop.addEventListener('dragleave', function () { inputDrop.classList.remove('active'); });
    inputDrop.addEventListener('drop', function (e) {
      e.preventDefault(); inputDrop.classList.remove('active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    inputFile.addEventListener('change', function () {
      if (inputFile.files && inputFile.files[0]) handleFile(inputFile.files[0]);
    });

    // 模板下载
    overlay.querySelector('#hmOuaTemplateJson').onclick = function () {
      downloadTemplate(getTemplateJson(), 'shot-import-template.json');
    };
    overlay.querySelector('#hmOuaTemplateCsv').onclick = function () {
      downloadTemplate(getTemplateCsv(), 'shot-import-template.csv');
    };

    function handleFile(f) {
      var reader = new FileReader();
      reader.onload = function () {
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ext === 'csv') {
          parsed = parseCsvToShots(reader.result);
        } else {
          try { parsed = normalizeShots(JSON.parse(reader.result)); }
          catch (e) { alert('JSON 解析失败: ' + e.message); return; }
        }
        step = 2; renderStep();
      };
      reader.readAsText(f, 'utf-8');
    }

    function renderStep() {
      overlay.querySelectorAll('.hm-import-step').forEach(function (s, i) {
        s.classList.toggle('current', i + 1 === step);
        s.classList.toggle('active', i + 1 < step);
      });
      var body = overlay.querySelector('.hm-import-body');
      if (step === 1) { body.innerHTML = getStep1Html(); }
      else if (step === 2) { body.innerHTML = getStep2Html(); }
      else { body.innerHTML = getStep3Html(); }

      // rebind
      overlay.querySelectorAll('.hm-import-tab').forEach(function (t) {
        t.addEventListener('click', function () {
          curTab = t.getAttribute('data-tab');
          overlay.querySelectorAll('.hm-import-tab').forEach(function (x) { x.classList.remove('active'); });
          t.classList.add('active');
          overlay.querySelectorAll('.hm-import-pane').forEach(function (p) { p.hidden = p.id !== 'hmOuaPane-' + curTab; });
        });
      });

      // 文件 drop zone rebind
      inputFile = body.querySelector('#hmOuaPane-file input[type=file]');
      inputDrop = body.querySelector('#hmOuaPane-file .hm-import-drop');
      if (inputDrop) {
        inputDrop.addEventListener('click', function () { inputFile.click(); });
        inputDrop.addEventListener('dragover', function (e) { e.preventDefault(); inputDrop.classList.add('active'); });
        inputDrop.addEventListener('dragleave', function () { inputDrop.classList.remove('active'); });
        inputDrop.addEventListener('drop', function (e) {
          e.preventDefault(); inputDrop.classList.remove('active');
          if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        });
        inputFile.addEventListener('change', function () {
          if (inputFile.files && inputFile.files[0]) handleFile(inputFile.files[0]);
        });
      }

      // Step 2 buttons
      if (step === 2) {
        overlay.querySelector('#hmOuaBackBtn').onclick = function () { step = 1; renderStep(); };
        overlay.querySelector('#hmOuaNextBtn').onclick = function () { step = 3; renderStep(); };
        renderPreviewTable();
      }
      // Step 3 buttons
      if (step === 3) {
        overlay.querySelector('#hmOuaBackBtn').onclick = function () { step = 2; renderStep(); };
        overlay.querySelector('#hmOuaImportBtn').onclick = doImport;
      }
    }

    function doImport() {
      var items = parsed.slice(0, 500);
      api.bulkOua(items).then(function (res) {
        A.toast && A.toast('✅ 成功导入 ' + res.inserted + ' 条', 'success');
        closeAll();
        loadList();
      }).catch(function (err) {
        A.toast && A.toast('导入失败: ' + (err.message || err), 'error');
      });
    }

    // 上一步按钮
    overlay.querySelector('#hmOuaBackBtn').onclick = function () { step = Math.max(1, step - 1); renderStep(); };
    // 下一步按钮
    overlay.querySelector('#hmOuaNextBtn').onclick = function () {
      if (step === 1) {
        var raw;
        if (curTab === 'json') {
          raw = inputTextarea.value.trim();
          if (!raw) { alert('请输入 JSON'); return; }
          try { parsed = normalizeShots(JSON.parse(raw)); }
          catch (e) { alert('JSON 解析失败: ' + e.message); return; }
        } else {
          var file = inputFile && inputFile.files && inputFile.files[0];
          if (!file) { alert('请选择或拖入文件'); return; }
          return; // file reader 会自动进 step 2
        }
        step = 2; renderStep();
      }
    };

    renderStep();
  }

  function buildImportMarkup() {
    return '<div class="hm-import-modal">' +
      '<div class="hm-import-header">' +
        '<h3>🎬 原画批量导入 — 镜头表</h3>' +
        '<button class="hm-import-close">✕</button>' +
      '</div>' +
      '<div class="hm-import-body">' +
        '<div class="hm-import-steps">' +
          '<div class="hm-import-step current">① 准备数据</div>' +
          '<div class="hm-import-step">② 解析预览</div>' +
          '<div class="hm-import-step">③ 确认导入</div>' +
        '</div>' +
        '<div class="hm-import-tabs">' +
          '<button class="hm-import-tab active" data-tab="json">📄 JSON 粘贴</button>' +
          '<button class="hm-import-tab" data-tab="file">📁 文件上传</button>' +
          '<button class="hm-import-tab" data-tab="tpl">📑 下载模板</button>' +
        '</div>' +

        '<div class="hm-import-pane" id="hmOuaPane-json">' +
          '<div class="hm-import-pane-title">粘贴 JSON 数组（支持 {items: [...]} 或纯数组）</div>' +
          '<textarea class="hm-import-ta" placeholder=\'[{"shotNo":"1-01","team":"first","title":"主角奔跑","director":"山田太郎","cameraMove":"前 DOLLY IN","status":"todo"}]\'></textarea>' +
          '<div class="hm-import-hint">支持字段：shotNo / team(first|second) / title / sceneRef / status / version / director / cameraMove / cameraDuration / timeSheet / actionFlow / animator / totalFrames / feedbackStatus</div>' +
        '</div>' +

        '<div class="hm-import-pane" id="hmOuaPane-file" hidden>' +
          '<div class="hm-import-pane-title">选择或拖入 .json / .csv 文件</div>' +
          '<div class="hm-import-drop">' +
            '<div style="font-size:40px;margin-bottom:10px">📂</div>' +
            '<div style="font-size:14px;font-weight:600">点击选择文件</div>' +
            '<div style="font-size:12px;margin-top:6px">或拖入到此处</div>' +
            '<input type="file" accept=".json,.csv" style="display:none">' +
          '</div>' +
          '<div class="hm-import-hint">CSV 列头：shotNo, team, title, sceneRef, status, director, cameraMove, actionFlow, animator, totalFrames...</div>' +
        '</div>' +

        '<div class="hm-import-pane" id="hmOuaPane-tpl" hidden>' +
          '<div class="hm-import-pane-title">下载 Excel 兼容模板，填完后在 📁 文件上传 里导入</div>' +
          '<div class="hm-import-templates">' +
            '<button class="hm-pill hm-pill-primary" id="hmOuaTemplateJson">📥 下载 JSON 完整模板</button>' +
            '<button class="hm-pill" id="hmOuaTemplateCsv">📥 下载 CSV 简易清单</button>' +
          '</div>' +
          '<div class="hm-import-hint" style="margin-top:14px">CSV 支持列头：shotNo, team(first/second), title, sceneRef, status(todo/wip/review/final), version, director, cameraMove(固定/PAN→/TILT/DOLLY IN/DOLLY OUT/回転/组合), cameraDuration, timeSheet, actionFlow, animator, totalFrames, feedbackStatus(pending/submitted/reviewing/fixing/approved), layoutRef(逗号分隔), drawingNotes</div>' +
        '</div>' +
      '</div>' +
      '<div class="hm-import-footer">' +
        '<button class="hm-pill hm-pill-ghost" id="hmOuaBackBtn" disabled>← 上一步</button>' +
        '<button class="hm-pill hm-pill-primary" id="hmOuaNextBtn">下一步 →</button>' +
      '</div>' +
    '</div>';
  }

  function getStep1Html() { return ''; }
  function getStep2Html() {
    var items = parsed.slice(0, 50);
    var body = '';
    var totalTeam = { first: 0, second: 0 };
    parsed.forEach(function (s) { if (s.team === 'second') totalTeam.second++; else totalTeam.first++; });
    if (!parsed || !parsed.length) {
      body = '<div class="hm-import-empty">❌ 未解析到任何镜头</div>';
    } else {
      var html = '<table><thead><tr><th>镜号</th><th>团队</th><th>标题</th><th>状态</th><th>担当</th><th>运镜/帧数</th></tr></thead><tbody>';
      items.forEach(function (s) {
        var dir = (s.first && s.first.director) || (s.second && s.second.animator) || '—';
        var cam = (s.first && s.first.cameraMove) || ((s.second && s.second.totalFrames) ? (s.second.totalFrames + ' 帧') : '—');
        var teamLabel = s.team === 'second' ? '第二原画' : '第一原画';
        html += '<tr><td>' + (s.shotNo || '—') + '</td><td>' + teamLabel + '</td><td>' + (s.title || '') + '</td><td>' + (ST_LABELS[s.status] || s.status || '未开始') + '</td><td>' + dir + '</td><td>' + cam + '</td></tr>';
      });
      html += '</tbody></table>';
      body = html + '<div class="hm-import-summary">共解析到 ' + parsed.length + ' 个镜头 · 第一原画 ' + totalTeam.first + ' · 第二原画 ' + totalTeam.second + (parsed.length > 50 ? '（表格只显示前 50 条）' : '') + '</div>';
    }
    return '<div class="hm-import-pane-title">② 预览前 50 条</div>' +
           '<div class="hm-import-table">' + body + '</div>';
  }
  function renderPreviewTable() { /* 已在上一个函数直接生成 */ }
  function getStep3Html() {
    var items = parsed.slice(0, 500);
    var totalTeam = { first: 0, second: 0 };
    items.forEach(function (s) { if (s.team === 'second') totalTeam.second++; else totalTeam.first++; });
    return '<div class="hm-import-pane-title">③ 确认导入</div>' +
           '<div class="hm-import-confirm-box">' +
             '<div class="hm-import-confirm-row"><span>📋 总条数</span><b>' + items.length + '</b></div>' +
             '<div class="hm-import-confirm-row"><span>🎨 第一原画</span><b>' + totalTeam.first + ' 镜头</b></div>' +
             '<div class="hm-import-confirm-row"><span>🎬 第二原画</span><b>' + totalTeam.second + ' 镜头</b></div>' +
             '<div class="hm-import-confirm-row"><span>🔢 单次上限</span><b>500 条</b></div>' +
             '<div class="hm-import-confirm-warn">⚠️ 导入后无法撤销。请确认以上数据正确。</div>' +
           '</div>' +
           '<button class="hm-pill hm-pill-primary" id="hmOuaImportBtn" style="margin-top:14px;padding:10px 30px">🚀 开始导入</button>';
  }

  /* CSV 解析 → Shot 数组 */
  function parseCsvToShots(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var header = splitCsv(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var items = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = splitCsv(lines[i]);
      var row = {};
      header.forEach(function (h, idx) { row[h] = (cells[idx] || '').trim(); });
      var shot = buildShotFromRow(row);
      if (shot.shotNo || shot.title) items.push(shot);
    }
    return normalizeShots(items);
  }
  function splitCsv(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ',') { out.push(cur); cur = ''; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    out.push(cur); return out;
  }
  function buildShotFromRow(r) {
    var team = (r.team || 'first').toLowerCase();
    if (team.indexOf('sec') >= 0 || team.indexOf('動画') >= 0 || team === '2') team = 'second';
    else team = 'first';

    var shot = {
      shotNo: r.shotno || r.shot_no || '',
      team: team,
      title: r.title || '',
      sceneRef: r.sceneref || r.scene_ref || '',
      status: r.status || 'todo',
      version: r.version || 'Ver1.0',
      first: {
        director: r.director || '',
        cameraMove: r.cameramove || r.camera_move || '固定',
        cameraDuration: r.cameraduration || r.camera_duration || '',
        timeSheet: r.timesheet || r.time_sheet || '',
        actionFlow: r.actionflow || r.action_flow || '',
        dialoguePoint: r.dialoguepoint || r.dialogue_point || '',
        sfxPoint: r.sfxpoint || r.sfx_point || '',
        layoutRef: (r.layoutref || r.layout_ref || '').split(/[,|]/).map(function (x) { return x.trim(); }).filter(Boolean),
        drawingNotes: r.drawingnotes || r.drawing_notes || '',
        poseKeyframes: [],
        characterRef: [],
      },
      second: {
        animator: r.animator || r.second_animator || '',
        totalFrames: Number(r.totalframes || r.total_frames || 0) || 0,
        feedbackStatus: r.feedbackstatus || r.feedback_status || 'pending',
        revisionCount: Number(r.revisioncount || r.revision_count || 0) || 0,
        feedbackNote: r.feedbacknote || r.feedback_note || '',
        tweens: [],
      },
      tags: (r.tags || '').split(/[,|]/).map(function (x) { return x.trim(); }).filter(Boolean),
    };
    return shot;
  }

  function normalizeShots(raw) {
    var arr = Array.isArray(raw) ? raw : (raw.items || []);
    return arr.map(function (r) {
      var team = (r.team || 'first').toLowerCase();
      if (team.indexOf('sec') >= 0 || team.indexOf('second') >= 0) team = 'second'; else team = 'first';
      return {
        shotNo: r.shotNo || r.shotno || '',
        team: team,
        title: r.title || '',
        sceneRef: r.sceneRef || r.sceneref || '',
        status: r.status || 'todo',
        version: r.version || 'Ver1.0',
        first: Object.assign({
          director: '', cameraMove: '固定', cameraDuration: '', timeSheet: '',
          actionFlow: '', dialoguePoint: '', sfxPoint: '', layoutRef: [], drawingNotes: '',
          poseKeyframes: [], characterRef: [],
        }, r.first || {}),
        second: Object.assign({
          animator: '', totalFrames: 0, feedbackStatus: 'pending', revisionCount: 0,
          feedbackNote: '', tweens: [],
        }, r.second || {}),
        tags: r.tags || [],
      };
    });
  }

  function getTemplateJson() {
    return JSON.stringify({
      _comment: '原画模块批量导入模板 — Shot 对象数组',
      items: [
        {
          shotNo: '1-01', team: 'first', title: '主角奔跑入场', sceneRef: 'scene_001',
          status: 'todo', version: 'Ver1.0', tags: ['主角', '奔跑'],
          first: {
            director: '山田太郎', cameraMove: '前 DOLLY IN', cameraDuration: '3.0',
            timeSheet: '0:00 起始Pose → 0:1.2 中间Pose → 0:2.8 结束Pose',
            actionFlow: '角色从左到右奔跑，途中跃过障碍...',
            dialoguePoint: '0:03.5', sfxPoint: '0:00.0', layoutRef: [], drawingNotes: '',
            poseKeyframes: [
              { frame: 0, second: 0, pose: '起始Pose', keyType: 'key', url: '', note: '' },
              { frame: 12, second: 0.5, pose: '中间Pose', keyType: 'breakdown', url: '', note: '' },
              { frame: 24, second: 1.0, pose: '结束Pose', keyType: 'key', url: '', note: '' }
            ]
          }
        },
        {
          shotNo: '1-02', team: 'second', title: '第二原画中割', status: 'wip',
          second: {
            animator: '佐々木花子', totalFrames: 12, feedbackStatus: 'pending', revisionCount: 0,
            feedbackNote: '',
            tweens: [
              { frameNum: 2, ratio: 0.25, url: '', note: '', issue: '' },
              { frameNum: 4, ratio: 0.5, url: '', note: '', issue: '' },
              { frameNum: 6, ratio: 0.75, url: '', note: '', issue: '' }
            ]
          }
        }
      ]
    }, null, 2);
  }
  function getTemplateCsv() {
    var header = 'shotNo,team,title,sceneRef,status,version,director,cameraMove,cameraDuration,timeSheet,actionFlow,animator,totalFrames,feedbackStatus';
    var row1 = '1-01,first,主角奔跑入场,scene_001,todo,Ver1.0,山田太郎,前 DOLLY IN,3.0,"0:00 Pose→0:1.2中间→0:2.8结束","角色从左到右奔跑",,,,';
    var row2 = '1-02,second,第二原画中割,scene_001,wip,Ver1.0,,,,"主角奔跑-中割",佐々木花子,12,pending';
    return '\ufeff' + header + '\n' + row1 + '\n' + row2 + '\n';
  }

  function downloadTemplate(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.HMOUA = { enter: enter };
})();



/* ========================================================================
 * HMAnimation —— 动画中间帧处理（Tweening · 帧序列 · 节奏曲线）
 * ======================================================================== */
(function () {
  var state = { list: [], editing: null, saveTimer: null };
  var ST_LABELS = { todo: '未开始', wip: '进行中', review: '审图中', final: '定稿' };
  function $(id) { return document.getElementById(id); }

  function enter() { bindTop(); bindFilters(); loadList(); }

  function bindTop() {
    var btn = $('animNewBtn');
    if (btn && !btn.__bound) { btn.__bound = true; btn.addEventListener('click', createNew); }
    var exp = $('animExportBtn');
    if (exp && !exp.__bound) { exp.__bound = true; exp.addEventListener('click', exportCsv); }
  }
  function bindFilters() {
    ['animSearch', 'animStatusFilter'].forEach(function (id) {
      var el = $(id); if (!el || el.__bound) return;
      el.__bound = true;
      var deb;
      el.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(loadList, 300); });
      el.addEventListener('change', function () { clearTimeout(deb); loadList(); });
    });
  }

  function loadList() {
    var qp = new URLSearchParams();
    var kw = $('animSearch').value.trim(); if (kw) qp.set('keyword', kw);
    var sf = $('animStatusFilter').value; if (sf !== 'all') qp.set('status', sf);
    api.listAnimation('?' + qp.toString()).then(function (res) {
      state.list = res.items || []; renderGrid();
    });
  }

  function renderGrid() {
    var grid = $('animGrid'); grid.innerHTML = '';
    state.list.forEach(function (s) {
      var kCount = (s.kfList || []).length;
      var tCount = (s.tweens || []).length;
      var totalFrames = kCount + tCount;
      var card = document.createElement('div');
      card.className = 'hm-anim-card hm-anim-st-' + s.status;
      card.innerHTML =
        '<div class="hm-anim-card-head">' +
          '<span class="hm-anim-name">' + (s.name || '未命名') + '</span>' +
          '<span class="hm-anim-status">' + ST_LABELS[s.status] + '</span>' +
        '</div>' +
        '<div class="hm-anim-card-info">' +
          '<div>🎬 镜号 ' + (s.shotNo || '—') + '</div>' +
          '<div>🎞 节奏 ' + (s.frameRate || 24) + ' fps</div>' +
          '<div>🔢 K帧 ' + kCount + ' · 🎞 中割 ' + tCount + '</div>' +
          '<div>📊 合计 ' + totalFrames + ' 帧</div>' +
        '</div>';
      card.addEventListener('click', function () { openEditor(s.id); });
      grid.appendChild(card);
    });
    $('animListCount').textContent = state.list.length + ' 序列';
  }

  function createNew() {
    var name = window.prompt('序列名称', '序列 ' + (state.list.length + 1));
    if (!name) return;
    api.createAnimation({ name: name }).then(function (res) { openEditor(res.sequence.id); });
  }

  function openEditor(id) {
    $('animListView').hidden = true; $('animEditorView').hidden = false;
    api.getAnimation(id).then(function (res) {
      state.editing = res.sequence;
      state.editing.kfList = state.editing.kfList || [];
      state.editing.tweens = state.editing.tweens || [];
      populate();
    });
  }

  function populate() {
    var s = state.editing;
    $('animBackBtn').onclick = function () {
      $('animEditorView').hidden = true; $('animListView').hidden = false;
      loadList(); state.editing = null;
    };
    $('animDeleteBtn').onclick = function () {
      if (!window.confirm('确定删除序列 ' + s.name + ' ?')) return;
      api.deleteAnimation(s.id).then(function () {
        $('animEditorView').hidden = true; $('animListView').hidden = false;
        loadList(); state.editing = null; A.toast && A.toast('已删除');
      });
    };
    $('animSaveBtn').onclick = save;
    $('animName').value = s.name || '';
    $('animShotNo').value = s.shotNo || '';
    $('animSceneRef').value = s.sceneRef || '';
    $('animStatus').value = s.status || 'todo';
    $('animFrameRate').value = String(s.frameRate || 24);
    $('animTags').value = (s.tags || []).join(', ');
    $('animNotes').value = s.notes || '';
    $('animEditorTitle').textContent = s.name || '(未命名)';
    $('animShotTag').textContent = s.shotNo || '—';
    $('animStatusTag').textContent = ST_LABELS[s.status] || '未开始';

    renderKfList(); renderTweenList(); renderTimeline();
    renderKfSelects();
    bindAutoSave();

    $('animAddKf').onclick = addKf;
    $('animAddTween').onclick = addManualTween;
    $('animGenerateBtn').onclick = autoGenerate;
    $('animTweenMarkWip').onclick = function () { bulkTweenStatus('wip'); };
    $('animTweenMarkFinal').onclick = function () { bulkTweenStatus('final'); };

    var kfs = state.editing.kfList || [];
    if (kfs.length >= 2) { $('animGenA').value = '0'; $('animGenB').value = String(kfs.length - 1); }
  }

  function bindAutoSave() {
    ['animName', 'animShotNo', 'animSceneRef', 'animStatus', 'animFrameRate', 'animTags', 'animNotes'].forEach(function (id) {
      var el = $(id); if (!el || el.__as) return;
      el.__as = true;
      el.addEventListener('input', scheduleSave);
      el.addEventListener('change', scheduleSave);
    });
  }
  function scheduleSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 1200); }

  function save() {
    if (!state.editing) return;
    var s = state.editing;
    s.name = $('animName').value;
    s.shotNo = $('animShotNo').value;
    s.sceneRef = $('animSceneRef').value;
    s.status = $('animStatus').value;
    s.frameRate = Number($('animFrameRate').value) || 24;
    s.tags = ($('animTags').value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    s.notes = $('animNotes').value;
    api.updateAnimation(s.id, s).then(function () {
      $('animStatusTag').textContent = ST_LABELS[s.status] || '未开始';
      $('animEditorTitle').textContent = s.name || '(未命名)';
    });
  }

  /* K帧 */
  function addKf() {
    var s = state.editing;
    var last = s.kfList.length ? s.kfList[s.kfList.length - 1] : null;
    var kf = {
      id: 'k_' + Math.random().toString(36).slice(2, 10),
      frame: last ? (last.frame + 12) : 0,
      second: last ? Number((Number(last.second) + 0.5).toFixed(2)) : 0,
      pose: 'K帧 ' + (s.kfList.length + 1), url: '', note: '',
    };
    api.animAddKf(s.id, kf).then(function (res) {
      s.kfList.push(res.kf);
      s.kfList.sort(function (a, b) { return (a.frame || 0) - (b.frame || 0); });
      renderKfList(); renderKfSelects(); renderTimeline();
    });
  }

  function renderKfList() {
    var list = $('animKfList'); list.innerHTML = '';
    state.editing.kfList.forEach(function (k, idx) {
      var row = document.createElement('div');
      row.className = 'hm-anim-kf-row';
      var imgCell = k.url
        ? '<div class="hm-anim-kf-img"><img src="' + api.mediaUrl(k.url) + '" data-preview-click></div>'
        : '<div class="hm-anim-kf-img hm-anim-kf-empty" data-kf-upload="' + idx + '">＋</div>';
      row.innerHTML =
        '<div class="hm-anim-kf-idx">K' + (idx + 1) + '</div>' +
        imgCell +
        '<div class="hm-anim-kf-fields">' +
          '<input type="number" placeholder="帧" value="' + (k.frame || '') + '" data-kf-frame="' + idx + '" min="0">' +
          '<input type="number" step="0.1" placeholder="秒" value="' + (k.second || '') + '" data-kf-sec="' + idx + '" min="0">' +
          '<input placeholder="Pose 名称" value="' + (k.pose || '').replace(/"/g, '&quot;') + '" data-kf-pose="' + idx + '">' +
          '<input placeholder="备注" value="' + (k.note || '').replace(/"/g, '&quot;') + '" data-kf-note="' + idx + '">' +
        '</div>' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger" data-kf-del="' + idx + '">✕</button>';
      row.querySelectorAll('[data-kf-frame],[data-kf-sec],[data-kf-pose],[data-kf-note]').forEach(function (el) {
        el.addEventListener('input', function () {
          var key = el.getAttribute('data-kf-frame') !== null ? 'frame' :
                    el.getAttribute('data-kf-sec') !== null ? 'second' :
                    el.getAttribute('data-kf-pose') !== null ? 'pose' : 'note';
          k[key] = (key === 'frame' || key === 'second') ? Number(el.value) : el.value;
          scheduleSave(); renderTimeline();
        });
      });
      row.querySelectorAll('[data-kf-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          state.editing.kfList.splice(idx, 1); scheduleSave(); renderKfList(); renderKfSelects(); renderTimeline();
        });
      });
      row.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { window.HMArt && window.HMArt.openLightbox && window.HMArt.openLightbox(img.src); });
      });
      row.querySelectorAll('[data-kf-upload]').forEach(function (el) {
        el.addEventListener('click', function () { uploadKf(idx); });
      });
      list.appendChild(row);
    });
  }

  function renderKfSelects() {
    var selA = $('animGenA'); var selB = $('animGenB');
    var opts = '';
    state.editing.kfList.forEach(function (k, i) {
      opts += '<option value="' + i + '">K' + (i + 1) + ' @' + (k.frame || 0) + 'f (' + (k.second || 0) + 's) — ' + (k.pose || '') + '</option>';
    });
    selA.innerHTML = opts; selB.innerHTML = opts;
  }

  function uploadKf(idx) {
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        api.uploadAnimMedia(reader.result).then(function (res) {
          state.editing.kfList[idx].url = res.url; renderKfList(); save();
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  /* 自动生成中割 */
  function autoGenerate() {
    var s = state.editing;
    if ((s.kfList || []).length < 2) { A.toast && A.toast('至少需要 2 个 K 帧', 'error'); return; }
    api.animGenerate(s.id, {
      prevKIdx: Number($('animGenA').value) || 0,
      nextKIdx: Number($('animGenB').value) || 1,
      count: Number($('animGenCount').value) || 2,
      timing: $('animGenTiming').value,
    }).then(function (res) {
      s.tweens = res.items.concat(s.tweens || []);
      renderTweenList(); renderTimeline();
      A.toast && A.toast('✅ 已生成 ' + res.items.length + ' 个中割帧', 'success');
    }).catch(function (err) {
      A.toast && A.toast('生成失败: ' + (err.message || err), 'error');
    });
  }

  /* 手动添加 */
  function addManualTween() {
    var s = state.editing;
    var t = {
      prevKey: '', nextKey: '', tweenIndex: (s.tweens.length + 1), totalBetween: 1,
      frameNum: 0, second: 0, timing: 'linear',
      url: '', poseRef: '', drawingRef: '', motionRef: '', note: '', status: 'todo', issue: '',
    };
    api.animAddTween(s.id, t).then(function (res) {
      s.tweens.push(res.items[0]); renderTweenList(); renderTimeline();
    });
  }

  function bulkTweenStatus(status) {
    var ids = state.editing.tweens.map(function (t) { return t.id; });
    if (!ids.length) return;
    api.animBulkTweenStatus(state.editing.id, ids, status).then(function () {
      state.editing.tweens.forEach(function (t) { t.status = status; });
      renderTweenList();
    });
  }

  /* 中割帧列表 */
  function renderTweenList() {
    var list = $('animTweenList'); list.innerHTML = '';
    (state.editing.tweens || []).slice().sort(function (a, b) { return (a.frameNum || 0) - (b.frameNum || 0); }).forEach(function (t, idx) {
      var row = document.createElement('div');
      row.className = 'hm-anim-tween-row hm-anim-tw-' + (t.status || 'todo');
      var imgCell = t.url
        ? '<div class="hm-anim-tween-img"><img src="' + api.mediaUrl(t.url) + '" data-preview-click></div>'
        : '<div class="hm-anim-tween-img hm-anim-tween-empty" data-tw-upload="' + idx + '">＋</div>';
      row.innerHTML =
        '<div class="hm-anim-tween-num">T' + (idx + 1) + '</div>' +
        imgCell +
        '<div class="hm-anim-tween-fields">' +
          '<input type="number" placeholder="帧号" value="' + (t.frameNum || '') + '" data-tw-frame="' + idx + '" min="0">' +
          '<input type="number" step="0.01" placeholder="秒" value="' + (t.second || '') + '" data-tw-sec="' + idx + '" min="0">' +
          '<select data-tw-timing="' + idx + '">' + ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'custom'].map(function (o) { return '<option value="' + o + '"' + (t.timing === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>' +
          '<select data-tw-status="' + idx + '">' + ['todo', 'wip', 'review', 'final'].map(function (o) { return '<option value="' + o + '"' + (t.status === o ? ' selected' : '') + '>' + ST_LABELS[o] + '</option>'; }).join('') + '</select>' +
          '<input placeholder="Pose 参考" value="' + (t.poseRef || '').replace(/"/g, '&quot;') + '" data-tw-pose="' + idx + '">' +
          '<input placeholder="问题" value="' + (t.issue || '').replace(/"/g, '&quot;') + '" data-tw-issue="' + idx + '">' +
          '<input placeholder="备注" value="' + (t.note || '').replace(/"/g, '&quot;') + '" data-tw-note="' + idx + '">' +
        '</div>' +
        '<button class="hm-pill hm-pill-mini hm-pill-danger" data-tw-del="' + idx + '">✕</button>';
      row.querySelectorAll('[data-tw-frame],[data-tw-sec],[data-tw-timing],[data-tw-pose],[data-tw-issue],[data-tw-note]').forEach(function (el) {
        el.addEventListener('input', function () {
          var key = el.getAttribute('data-tw-frame') !== null ? 'frameNum' :
                    el.getAttribute('data-tw-sec') !== null ? 'second' :
                    el.getAttribute('data-tw-timing') !== null ? 'timing' :
                    el.getAttribute('data-tw-pose') !== null ? 'poseRef' :
                    el.getAttribute('data-tw-issue') !== null ? 'issue' : 'note';
          if (key === 'frameNum' || key === 'second') t[key] = Number(el.value) || 0;
          else t[key] = el.value;
          scheduleSave(); renderTimeline();
        });
      });
      row.querySelectorAll('[data-tw-status]').forEach(function (el) {
        el.addEventListener('change', function () { t.status = el.value; scheduleSave(); renderTweenList(); renderTimeline(); });
      });
      row.querySelectorAll('[data-tw-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = state.editing.tweens[idx].id;
          api.animDeleteTween(state.editing.id, id).then(function () {
            state.editing.tweens.splice(idx, 1); renderTweenList(); renderTimeline();
          });
        });
      });
      row.querySelectorAll('[data-preview-click]').forEach(function (img) {
        img.addEventListener('click', function () { window.HMArt && window.HMArt.openLightbox && window.HMArt.openLightbox(img.src); });
      });
      row.querySelectorAll('[data-tw-upload]').forEach(function (el) {
        el.addEventListener('click', function () { uploadTween(idx); });
      });
      list.appendChild(row);
    });
  }

  function uploadTween(idx) {
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        api.uploadAnimMedia(reader.result).then(function (res) {
          state.editing.tweens[idx].url = res.url; renderTweenList(); save();
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  /* 时间轴预览 */
  function renderTimeline() {
    var tl = $('animTimeline');
    var frames = [];
    (state.editing.kfList || []).forEach(function (k, i) {
      frames.push({ kind: 'K', idx: i, frame: k.frame, second: k.second, label: 'K' + (i + 1), pose: k.pose, status: 'final' });
    });
    (state.editing.tweens || []).forEach(function (t, i) {
      frames.push({ kind: 'T', idx: i, frame: t.frameNum, second: t.second, label: 'T' + (i + 1), pose: (t.tweenIndex ? 'Tween-' + t.tweenIndex : ''), status: t.status });
    });
    frames.sort(function (a, b) { return (a.frame || 0) - (b.frame || 0); });
    if (!frames.length) {
      tl.innerHTML = '<div class="hm-anim-tl-empty">还没有帧 —— 先添加 K 帧，或选两个 K 帧一键生成中割</div>';
      return;
    }
    var html = '<div class="hm-anim-tl-bar"><div class="hm-anim-tl-track">';
    frames.forEach(function (f) {
      var cls = 'hm-anim-tl-f hm-anim-tl-' + f.kind + ' hm-anim-st-' + (f.status || 'todo');
      html += '<div class="' + cls + '" title="#' + f.frame + 'f @' + f.second + 's · ' + f.label + '">' +
        '<span>' + f.label + '</span><small>' + f.frame + 'f</small></div>';
    });
    html += '</div></div>';
    var fps = state.editing.frameRate || 24;
    var lastSecond = frames[frames.length - 1].second || 0;
    html += '<div class="hm-anim-tl-summary">合计 ' + frames.length + ' 帧 · 时长约 ' + lastSecond.toFixed(2) + 's · ' + fps + ' fps · 实际输出 ≈ ' + Math.ceil(lastSecond * fps) + ' 帧</div>';
    tl.innerHTML = html;
  }

  function exportCsv() {
    if (!state.editing) return;
    window.open(api.exportAnimation(state.editing.id, 'csv'), '_blank');
  }

  window.HMAnimation = { enter: enter };
})();
