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
  var DISABLED_RAILS = { canvas: true, works: true, tools: true, assets: true, writing: true, forum: true };

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
    prevView = view;

    if (view === 'canvas') renderCanvas();
    if (view === 'assets') renderAssetPage();
    if (view === 'writing') loadDraft();
    if (view === 'forum') renderForum();
    if (view === 'modeling' && window.BlenderBridge) {
      try { window.BlenderBridge.enter(); } catch (e) { /* ignore */ }
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

  /* 参考主体上传区：按模式动态更新提示文案、accept 格式、限制说明 */
  function updateRefDropForMode(mode) {
    var emptyText = document.getElementById('refEmptyText');
    var hintText = document.getElementById('refHintText');
    var input = document.getElementById('refInput');
    var limits = document.getElementById('refLimits');
    var limitsText = document.getElementById('refLimitsText');

    if (mode === 'video') {
      if (emptyText) emptyText.textContent = '拖入或上传参考主体（图片/视频/音频）';
      if (hintText) hintText.textContent = '图片 ≤10MB·最多10张 · 视频 ≤50MB·最多3个 · 音频 ≤10MB·最多3个';
      if (input) input.setAttribute('accept', 'image/*,video/*,audio/*');
      if (limits && limitsText) {
        limits.hidden = false;
        limitsText.textContent = '视频参考主体：图片 ≤10MB 最多10张 · 视频 ≤50MB 最多3个 · 音频 ≤10MB 最多3个';
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
      { id: 'sora-2', name: 'Sora 2', minDuration: 5, maxDuration: 15, free: false, resolutions: ['720p', '1080p', '2k'] },
      { id: 'sora-2-pro', name: 'Sora 2 Pro', minDuration: 5, maxDuration: 15, free: false, resolutions: ['720p', '1080p', '2k'] },
      { id: 'veo-3', name: 'Veo 3', minDuration: 5, maxDuration: 30, free: false, resolutions: ['720p', '1080p'] },
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
        var badge = m.free ? '<small class="hm-free-badge">免费</small>' : '<small class="hm-pay-badge">RayinAPI</small>';
        return '<button data-vmodel="' + m.id + '">' + m.name + badge + '</button>';
      }).join('') +
      '</div>' +
      '<p class="hm-menu-note">视频为异步任务 · 由 Node 后端代理生成</p>';

    menu.querySelectorAll('[data-vmodel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.videoModel = btn.getAttribute('data-vmodel');
        A.persistPrefs();
        A.syncEngineUI();
        renderDurationControls();
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

  /* 绑定视频时长滑块的 input/change 事件（只绑一次，避免重复） */
  function bindDurationSlider() {
    var slider = document.getElementById('durationSlider');
    if (!slider || slider._hmBound) return;
    slider._hmBound = true;

    var label = document.getElementById('durationSliderLabel');
    var update = function () {
      var val = Number(slider.value);
      state.duration = val;
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

  /* duration 控件：按当前模型动态范围渲染 slider */
  function renderDurationControls() {
    var modelId = state.videoModel;
    var meta = mediaCatalog.video.find(function (m) { return m.id === modelId; }) || mediaCatalog.video[0];
    var min = meta.minDuration || 5;
    var max = meta.maxDuration || 10;

    /* 更新下拉菜单（保留用于兼容） */
    var menu = document.getElementById('durationMenu');
    if (menu) {
      menu.innerHTML = '';
      /* 生成 5 秒间隔的选项 */
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
    /* 同时更新 slider（如果存在） */
    var slider = document.getElementById('durationSlider');
    if (slider) {
      slider.min = min;
      slider.max = max;
      slider.value = Math.max(min, Math.min(max, state.duration));
      slider.step = 5;
      var label = document.getElementById('durationSliderLabel');
      if (label) label.textContent = slider.value + ' 秒';
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
    return '<article class="hm-asset-card" data-asset="' + esc(asset.id) + '">' +
      assetThumb(asset) +
      '<div class="hm-asset-meta"><span>' + esc(asset.name || '素材') + '</span><span>' + assetKindLabel(asset.kind) + '</span></div>' +
      '<div class="hm-asset-actions">' +
        '<button data-aact="use" title="用作参考图">' + ICON_EYE + '</button>' +
        '<button data-aact="delete" title="删除">' + ICON_TRASH + '</button>' +
      '</div>' +
    '</article>';
  }

  function filteredAssets(filter) {
    if (!filter) return assets;
    return assets.filter(function (asset) {
      return [asset.name, asset.kind].join(' ').toLowerCase().indexOf(filter) >= 0;
    });
  }

  function renderAssetPage() {
    var grid = document.getElementById('assetsGrid');
    var empty = document.getElementById('assetsEmpty');
    var total = document.getElementById('assetsTotal');
    if (!grid) return;

    var list = filteredAssets(pageFilter);
    if (total) total.textContent = String(assets.length);
    if (empty) empty.hidden = list.length > 0;
    grid.innerHTML = list.map(assetCard).join('');
  }

  function renderAssetModal() {
    var grid = document.getElementById('assetModalGrid');
    var empty = document.getElementById('assetModalEmpty');
    var count = document.getElementById('assetModalCount');
    if (!grid) return;

    var list = filteredAssets(modalFilter);
    if (count) count.textContent = assets.length + ' 项';
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

  function bindAssetUI() {
    var importInput = document.getElementById('assetsImportInput');
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
      source: asset.source || 'local'
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
      if (file.size > 8 * 1024 * 1024) {
        A.toast('「' + file.name + '」超过 8MB，已跳过', 'error');
        continue;
      }
      try {
        var dataUrl = await readFileAsDataUrl(file);
        var kind = kindOfMime(file.type || '');
        if (api && api.online) {
          var res = await api.addAsset({ dataUrl: dataUrl, name: file.name, kind: kind });
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
            source: 'local'
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
      A.toast('已导入 ' + added + ' 个素材', 'success');
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
