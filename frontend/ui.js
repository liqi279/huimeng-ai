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
    credit: 'anidream.credit.v1'
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
  var canvasCleared = false;

  var credit = { total: 300, used: 0 };

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

  function bindTheme() {
    var btn = document.getElementById('themeBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        applyTheme(theme === 'light' ? 'dark' : 'light');
        writeJSON(LS.theme, theme);
        A.toast(theme === 'light' ? '已切换到浅色主题' : '已切换到深色主题', 'info');
      });
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
      var view = item.getAttribute('data-rail');
      if (!view) return;
      if (item.disabled || DISABLED_RAILS[view]) {
        A.toast && A.toast('「' + item.querySelector('span')?.textContent + '」功能开发中，敬请期待', 'info');
        return;
      }
      event.preventDefault();
      A.switchView(view);
    });
  }

  function updateRailBadges() {
    var badge = document.getElementById('railWorksBadge');
    if (badge) badge.textContent = String((A.state.works || []).length);
    updateCredit();
  }

  var prevView = null;

  function onView(view) {
    document.querySelectorAll('[data-rail]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-rail') === view);
    });
    updateRailBadges();

    if (prevView === 'modeling' && view !== 'modeling' && window.BlenderBridge) {
      try { window.BlenderBridge.leave(); } catch (e) { /* ignore */ }
    }
    if (prevView === 'director' && view !== 'director' && window.HMDirector) {
      try { window.HMDirector.pause(); } catch (e) { /* ignore */ }
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
    prevView = view;

    if (view === 'canvas') renderCanvas();
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
  }

  function onRenderWorks() {
    canvasCleared = false;
    updateRailBadges();
    if (state.view === 'canvas') renderCanvas();
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

  /* ---------------- 画布 ---------------- */
  function bindCanvas() {
    var zoom = document.getElementById('canvasZoom');
    if (zoom) {
      zoom.addEventListener('input', function () { setBoardZoom(Number(zoom.value)); });
      setBoardZoom(Number(zoom.value));
    }

    var clear = document.getElementById('canvasClear');
    if (clear) {
      clear.addEventListener('click', function () {
        if (!A.state.works.length) return;
        if (!window.confirm('清空画布展示？作品仍会保留在「成片」中。')) return;
        canvasCleared = true;
        renderCanvas();
        A.toast('画布已清空，作品仍在成片', 'info');
      });
    }

    var board = document.getElementById('canvasBoard');
    if (board) {
      board.addEventListener('click', function (event) {
        var card = event.target.closest('[data-board]');
        if (!card) return;
        var work = A.state.works.find(function (item) { return item.id === card.getAttribute('data-board'); });
        if (!work) return;
        var action = event.target.closest('[data-bact]');
        if (action && action.getAttribute('data-bact') === 'download') {
          A.downloadImage(work.url || work.thumb, A.fileNameFor(work));
          return;
        }
        A.openLightbox(work);
      });
    }
  }

  function setBoardZoom(value) {
    var board = document.getElementById('canvasBoard');
    var label = document.getElementById('canvasZoomVal');
    var zoom = Math.max(60, Math.min(160, value || 100));
    if (board) board.style.setProperty('--board-min', Math.round(220 * zoom / 100) + 'px');
    if (label) label.textContent = zoom + '%';
  }

  function boardCard(work) {
    var wide = work.type === 'video';
    var url = esc(work.url || work.thumb || '');
    var media;
    if (work.type === 'video') {
      media = '<video src="' + url + '" muted playsinline preload="metadata"></video>';
    } else if (work.type === 'audio') {
      media = '<audio src="' + url + '" controls preload="metadata"></audio>';
    } else {
      media = '<img src="' + esc(work.thumb || work.url) + '" alt="' + esc(work.prompt) + '" loading="lazy">';
    }
    return '<figure class="hm-board-card' + (wide ? ' is-wide' : '') + '" data-board="' + esc(work.id) + '">' +
      media +
      '<div class="hm-board-actions">' +
        '<button data-bact="download" title="下载">' + ICON_DOWNLOAD + '</button>' +
      '</div>' +
      '<figcaption><span>' + esc(work.modelName || 'AI') + '</span><span>' + (work.type === 'video' ? '视频' : work.type === 'audio' ? '音频' : '图片') + '</span></figcaption>' +
    '</figure>';
  }

  function renderCanvas() {
    var board = document.getElementById('canvasBoard');
    var empty = document.getElementById('canvasEmpty');
    if (!board) return;

    var works = (A.state.works || []).slice(0, 48);
    if (canvasCleared || !works.length) {
      board.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    board.innerHTML = works.map(boardCard).join('');
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
    if (!window.confirm('清理本地作品与写作草稿？此操作不可撤销。')) return;
    A.state.works = [];
    A.saveWorks();
    A.renderWorks();
    try { localStorage.removeItem(LS.draft); } catch (err) { /* 忽略 */ }
    var input = document.getElementById('writingInput');
    if (input) input.value = '';
    var count = document.getElementById('writingCount');
    if (count) count.textContent = '0 / 6000';
    canvasCleared = false;
    renderCanvas();
    A.toast('本地作品与草稿已清理', 'success');
  }

  /* ---------------- 初始化 ---------------- */
  function readPrefs() {
    applyTheme(readJSON(LS.theme, 'dark'));
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
    bindTheme();
    bindModes();
    bindPresetModal();
    bindAssetUI();
    bindWriting();
    bindForum();
    bindCanvas();
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

    /* 右侧 AI 聊天面板初始化 */
    if (window.HMChat) {
      try { window.HMChat.init(); } catch (e) { console.error('[Chat] init failed', e); }
    }
  }

  window.HMUI = {
    init: init,
    onView: onView,
    onRenderWorks: onRenderWorks,
    runMedia: runMedia,
    setMode: setMode,
    openPresetModal: openPresetModal,
    openAssetModal: openAssetModal,
    openEditor: function () {
      var expand = document.getElementById('expandPrompt');
      if (expand) expand.click();
    },
    renderCanvas: renderCanvas
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

  window.HMArt = { enter: enter, state: state };
})();
