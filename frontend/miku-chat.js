/*!
 * Miku Chat — 音乐播放器的 AI 语音聊天扩展
 * ------------------------------------------------------------------
 * 把 Blueberry-AI-Pet 桌宠里的 AI 聊天 / 语音能力，作为插件赋予
 * 初音未来胶片播放器。可单独引入，也可在任意页面里作为通用 AI 助手。
 *
 * 用法：
 *   // 在页面中先引入 miku-player.js，再引入 miku-chat.js
 *   // 引入后自动出现「AI 语音助手」按钮
 *   也可手动：
 *     var chat = MikuChat.init({ anchor: '#vinyl-widget', player: mikuPlayer });
 *     chat.ask('帮我解释一下相对论').then(function (r) { console.log(r.text); });
 *     chat.speak('主人，蓝莓酱在这里～');
 *
 * 后端：
 *   - Ollama（默认 http://localhost:11434，模型 qwen3:4b，stream:false、think:false）
 *   - 任意 OpenAI 兼容接口（/chat/completions）
 *   - 语音输入：Web Speech API（SpeechRecognition，zh-CN）
 *   - 语音朗读：SpeechSynthesis（可自动选中文音色）
 *
 * 注意（很常见）：GitHub Pages 是 HTTPS 页面，浏览器会拦截对
 * http://localhost 的混合内容请求。要让网页里的音乐播放器连本地
 * Ollama，需要：
 *   1) 用 http 页面 / 本地文件打开，或给 Ollama 配 HTTPS 反向代理；
 *   2) Ollama 启动前设置环境变量 OLLAMA_ORIGINS=*，允许跨域。
 * 桌面版桌宠（Electron）走主进程 fetch，不受该限制。
 */
(function (global) {
  'use strict';

  if (global.MikuChat && global.MikuChat.__ready) return;

  var STORE_KEY = 'miku.chat.settings';
  var MAX_HISTORY = 12;

  var DEFAULT_SETTINGS = {
    provider: 'ollama',              // ollama | openai
    baseUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    apiKey: '',
    tts: true,                       // 自动朗读回复
    voiceURI: '',                    // 指定音色，空 = 自动选择中文音色
    duckMusic: true                  // 说话时自动暂停音乐，说完恢复
  };

  /* 与桌宠 main.js 中 SYSTEM_PROMPT 保持一致，保证跨端人格统一 */
  var SYSTEM_PROMPT = [
    '你是蓝莓酱，住在用户电脑桌面上的 AI 小伙伴，也是一位可爱、温柔、略带小傲娇的蓝发女仆。',
    '请始终使用自然、亲切的简体中文回答，除非用户明确要求其他语言。',
    '说话活泼、有陪伴感，可以偶尔使用语气词和少量颜文字，但不要每句话都卖萌。',
    '优先简洁清楚地回答；复杂问题再分点解释。不要反复自我介绍，不要无意义地复述用户问题。',
    '你可以帮助聊天、解释知识、写作和编程。不要声称自己能看到用户屏幕、听到声音或执行现实动作。',
    '称呼用户为主人，但如果用户要求其他称呼就遵从。'
  ].join('\n');

  var CSS = [
    '#miku-chat-root, #miku-chat-root * { margin:0; padding:0; box-sizing:border-box; }',
    '#miku-chat-root { position:fixed; right:0; bottom:0; z-index:100010; font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }',

    /* 悬浮按钮 */
    '#miku-chat-btn {',
    '  position:fixed; right:44px; bottom:62px; width:52px; height:52px; border-radius:50%;',
    '  border:1px solid rgba(255,255,255,.18); cursor:pointer;',
    '  background:linear-gradient(145deg, rgba(58,68,102,.92), rgba(26,30,44,.96));',
    '  backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);',
    '  box-shadow:0 8px 22px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.14);',
    '  display:flex; align-items:center; justify-content:center;',
    '  transition:transform .18s, box-shadow .18s;',
    '}',
    '#miku-chat-btn:hover { transform:translateY(-2px) scale(1.05); box-shadow:0 12px 26px rgba(0,0,0,.55); }',
    '#miku-chat-btn svg { width:24px; height:24px; fill:#dfe7ff; }',
    '#miku-chat-btn .badge {',
    '  position:absolute; right:-2px; top:-2px; width:12px; height:12px; border-radius:50%;',
    '  background:#ff5f8f; box-shadow:0 0 8px rgba(255,95,143,.9); display:none;',
    '}',
    '#miku-chat-btn.busy .badge { display:block; animation:mcPulse 1s ease-in-out infinite; }',
    '@keyframes mcPulse { 50% { opacity:.35; } }',
    '#miku-chat-root.open #miku-chat-btn { display:none; }',

    /* 聊天面板 */
    '#miku-chat-panel {',
    '  position:fixed; right:24px; bottom:24px; width:352px; max-width:calc(100vw - 32px);',
    '  height:492px; max-height:calc(100vh - 96px);',
    '  display:none; flex-direction:column; overflow:hidden;',
    '  background:rgba(18,20,30,.96); color:#e8edf8;',
    '  border:1px solid rgba(255,255,255,.14); border-radius:18px;',
    '  box-shadow:0 22px 60px rgba(0,0,0,.65);',
    '  backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);',
    '  font-size:13px;',
    '}',
    '#miku-chat-root.open #miku-chat-panel { display:flex; }',
    '#miku-chat-panel .mc-head {',
    '  display:flex; align-items:center; gap:8px; padding:12px 14px; flex:none;',
    '  background:linear-gradient(180deg, rgba(90,156,255,.18), rgba(255,95,143,.08));',
    '  border-bottom:1px solid rgba(255,255,255,.1);',
    '}',
    '#miku-chat-panel .mc-title { flex:1; min-width:0; }',
    '#miku-chat-panel .mc-title b { font-size:14px; font-weight:600; color:#fff; display:block; }',
    '#miku-chat-panel .mc-title small { font-size:11px; color:#93a0bb; display:block; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '#miku-chat-panel .mc-act {',
    '  width:28px; height:28px; flex:none; border-radius:8px; cursor:pointer;',
    '  display:flex; align-items:center; justify-content:center;',
    '  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1);',
    '}',
    '#miku-chat-panel .mc-act:hover { background:rgba(255,255,255,.14); }',
    '#miku-chat-panel .mc-act svg { width:15px; height:15px; fill:#cdd6ea; }',
    '#miku-chat-panel .mc-act.on { background:rgba(255,95,143,.24); border-color:rgba(255,95,143,.5); }',
    '#miku-chat-panel .mc-act.on svg { fill:#ffb3cb; }',

    '#miku-chat-panel .mc-body { flex:1; overflow-y:auto; padding:12px 12px 4px; scroll-behavior:smooth; }',
    '#miku-chat-panel .mc-body::-webkit-scrollbar { width:5px; }',
    '#miku-chat-panel .mc-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,.18); border-radius:3px; }',
    '#miku-chat-panel .mc-empty { color:#7f8aa4; font-size:12px; line-height:1.9; padding:6px 4px; }',
    '#miku-chat-panel .mc-empty b { color:#aab7d4; }',
    '#miku-chat-panel .mc-msg { display:flex; margin-bottom:10px; }',
    '#miku-chat-panel .mc-msg.user { justify-content:flex-end; }',
    '#miku-chat-panel .mc-bubble {',
    '  max-width:82%; padding:8px 11px; border-radius:12px; line-height:1.65;',
    '  white-space:pre-wrap; word-break:break-word; font-size:13px;',
    '}',
    '#miku-chat-panel .mc-msg.pet .mc-bubble { background:rgba(90,156,255,.18); border:1px solid rgba(90,156,255,.32); color:#e6efff; border-bottom-left-radius:4px; }',
    '#miku-chat-panel .mc-msg.user .mc-bubble { background:linear-gradient(135deg, rgba(255,95,143,.85), rgba(190,60,120,.9)); color:#fff; border-bottom-right-radius:4px; }',
    '#miku-chat-panel .mc-msg.err .mc-bubble { background:rgba(255,120,90,.16); border-color:rgba(255,120,90,.4); color:#ffc9bb; }',
    '#miku-chat-panel .mc-typing { color:#8b95a9; font-style:italic; }',

    /* 输入区 */
    '#miku-chat-panel .mc-foot { flex:none; padding:10px 12px 12px; border-top:1px solid rgba(255,255,255,.08); }',
    '#miku-chat-panel .mc-input-row { display:flex; align-items:flex-end; gap:8px; }',
    '#miku-chat-panel textarea {',
    '  flex:1; min-width:0; height:38px; max-height:96px; resize:none;',
    '  background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14);',
    '  border-radius:11px; padding:9px 11px; color:#fff; font-size:13px; line-height:1.4;',
    '  font-family:inherit; outline:none;',
    '}',
    '#miku-chat-panel textarea::placeholder { color:#6f7a92; }',
    '#miku-chat-panel textarea:focus { border-color:rgba(90,156,255,.6); }',
    '#miku-chat-panel .mc-btn {',
    '  width:38px; height:38px; flex:none; border-radius:11px; cursor:pointer; border:none;',
    '  display:flex; align-items:center; justify-content:center;',
    '  background:linear-gradient(145deg,#5a9cff,#3b7be0); box-shadow:0 4px 12px rgba(90,156,255,.35);',
    '  transition:filter .15s, transform .15s;',
    '}',
    '#miku-chat-panel .mc-btn:hover { filter:brightness(1.12); }',
    '#miku-chat-panel .mc-btn:active { transform:scale(.94); }',
    '#miku-chat-panel .mc-btn:disabled { opacity:.45; cursor:not-allowed; }',
    '#miku-chat-panel .mc-btn svg { width:17px; height:17px; fill:#fff; }',
    '#miku-chat-panel .mc-btn.mic { background:rgba(255,255,255,.1); box-shadow:none; border:1px solid rgba(255,255,255,.14); }',
    '#miku-chat-panel .mc-btn.mic svg { fill:#cfd8ec; }',
    '#miku-chat-panel .mc-btn.mic.listening { background:rgba(255,95,143,.3); border-color:#ff5f8f; animation:mcPulse 1.1s infinite; }',
    '#miku-chat-panel .mc-hint { font-size:10.5px; color:#68738a; margin-top:7px; line-height:1.55; }',
    '#miku-chat-panel .mc-hint.warn { color:#ffb37a; }',

    /* 设置抽屉 */
    '#miku-chat-panel .mc-settings { display:none; padding:12px; overflow-y:auto; flex:1; }',
    '#miku-chat-panel.settings .mc-settings { display:block; }',
    '#miku-chat-panel.settings .mc-body, #miku-chat-panel.settings .mc-foot { display:none; }',
    '#miku-chat-panel .mc-field { margin-bottom:10px; }',
    '#miku-chat-panel .mc-field label { display:block; font-size:11px; color:#93a0bb; margin-bottom:4px; }',
    '#miku-chat-panel .mc-field input, #miku-chat-panel .mc-field select {',
    '  width:100%; height:34px; border-radius:9px; padding:0 10px; font-size:12px; font-family:inherit;',
    '  background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); color:#fff; outline:none;',
    '}',
    '#miku-chat-panel .mc-field input:focus, #miku-chat-panel .mc-field select:focus { border-color:rgba(90,156,255,.6); }',
    '#miku-chat-panel .mc-field select option { background:#1a1e2c; color:#e8edf8; }',
    '#miku-chat-panel .mc-switch { display:flex; align-items:center; gap:8px; font-size:12px; color:#c4cbdb; margin-bottom:10px; cursor:pointer; }',
    '#miku-chat-panel .mc-switch input { width:15px; height:15px; accent-color:#5a9cff; }',
    '#miku-chat-panel .mc-save {',
    '  width:100%; height:36px; border-radius:10px; border:none; cursor:pointer;',
    '  background:linear-gradient(135deg,#ff5f8f,#c9407a); color:#fff; font-size:13px; font-family:inherit;',
    '  box-shadow:0 6px 16px rgba(255,95,143,.32);',
    '}',
    '#miku-chat-panel .mc-save:hover { filter:brightness(1.1); }',

    '@media (max-width:520px) {',
    '  #miku-chat-btn { right:20px; bottom:56px; width:46px; height:46px; }',
    '  #miku-chat-panel { right:12px; bottom:12px; width:calc(100vw - 24px); height:min(492px, calc(100vh - 40px)); }',
    '}'
  ].join('\n');

  /* ---------------- 工具函数 ---------------- */

  function readSettings() {
    var out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var key in DEFAULT_SETTINGS) {
          if (saved[key] !== undefined && saved[key] !== null) out[key] = saved[key];
        }
      }
    } catch (e) { /* 隐私模式 / file:// 下 localStorage 可能不可用 */ }
    return out;
  }

  function writeSettings(s) {
    try {
      global.localStorage && global.localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) { /* 忽略 */ }
  }

  /* Qwen3 / Ollama 的思考内容绝不作为聊天正文显示 */
  function cleanOllamaAnswer(content) {
    var text = String(content || '');
    text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
    text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
    var endTag = text.toLowerCase().lastIndexOf('</think>');
    if (endTag >= 0) text = text.slice(endTag + '</think>'.length);
    return text.replace(/<\/?think\b[^>]*>/gi, '').trim();
  }

  /* 朗读前清理 markdown / 表情符号，避免念出符号 */
  function speakable(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' 代码块 ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_#>|~]/g, '')
      .replace(/\[(.+?)\]\([^)]*\)/g, '$1')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function errorHint(err) {
    var raw = (err && err.message) || String(err || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
      return '无法连接 AI 服务。常见原因：\n' +
        '1) Ollama 没启动（终端执行 ollama serve）；\n' +
        '2) 页面是 HTTPS，浏览器拦截了 http://localhost 的混合内容；\n' +
        '3) Ollama 未允许跨域，启动前需设置 OLLAMA_ORIGINS=*。';
    }
    if (/timeout|abort/i.test(raw)) return '请求超时了，主人再试一次好吗？';
    if (/HTTP 40[13]|Unauthorized|api key/i.test(raw)) return '接口鉴权失败，请检查 API Key。';
    return raw || '未知错误';
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------------- 实例 ---------------- */

  function createInstance(options) {
    options = options || {};

    var root = document.createElement('div');
    root.id = 'miku-chat-root';

    var style = document.createElement('style');
    style.id = 'miku-chat-style';
    style.textContent = CSS;

    var btn = document.createElement('button');
    btn.id = 'miku-chat-btn';
    btn.type = 'button';
    btn.title = '蓝莓酱 AI 语音助手';
    btn.setAttribute('aria-label', '打开 AI 语音聊天');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 4H7v-2h6v2zm2-6H7v-2h8v2z"/></svg><span class="badge"></span>';

    var panel = document.createElement('section');
    panel.id = 'miku-chat-panel';
    panel.setAttribute('aria-label', '蓝莓酱 AI 语音聊天');
    panel.innerHTML = [
      '<div class="mc-head">',
      '  <div class="mc-title"><b>蓝莓酱 · AI 语音助手</b><small id="mc-status">本地 Ollama · qwen3:4b</small></div>',
      '  <div class="mc-act" id="mc-tts" title="自动朗读回复">',
      '    <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-8.8v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
      '  </div>',
      '  <div class="mc-act" id="mc-gear" title="设置">',
      '    <svg viewBox="0 0 24 24"><path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9.1 5.2a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.6L4.5 11a7.4 7.4 0 0 0-.1 1 7.4 7.4 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.4a.5.5 0 0 0 .6.2l2.5-1a7.3 7.3 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6a7.3 7.3 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
      '  </div>',
      '  <div class="mc-act" id="mc-close" title="关闭">',
      '    <svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
      '  </div>',
      '</div>',
      '<div class="mc-body" id="mc-body">',
      '  <div class="mc-empty">主人，想聊点什么？<br>蓝莓酱可以聊天、解释知识、写作、写代码。<br>点麦克风说句话，或直接输入。</div>',
      '</div>',
      '<div class="mc-foot">',
      '  <div class="mc-input-row">',
      '    <button class="mc-btn mic" id="mc-mic" type="button" title="语音输入">',
      '      <svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3v-5a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>',
      '    </button>',
      '    <textarea id="mc-input" rows="1" placeholder="和蓝莓酱说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>',
      '    <button class="mc-btn" id="mc-send" type="button" title="发送">',
      '      <svg viewBox="0 0 24 24"><path d="M2.4 21.6l19.2-9.6L2.4 2.4v7.2l13.2 2.4-13.2 2.4v7.2z"/></svg>',
      '    </button>',
      '  </div>',
      '  <div class="mc-hint" id="mc-hint">语音输入需浏览器支持；朗读使用系统语音。</div>',
      '</div>',
      '<div class="mc-settings">',
      '  <div class="mc-field"><label>服务提供方</label>',
      '    <select id="mc-provider"><option value="ollama">Ollama（本地）</option><option value="openai">OpenAI 兼容接口</option></select>',
      '  </div>',
      '  <div class="mc-field"><label>接口地址</label><input id="mc-base" placeholder="http://localhost:11434"></div>',
      '  <div class="mc-field"><label>模型</label><input id="mc-model" placeholder="qwen3:4b"></div>',
      '  <div class="mc-field"><label>API Key（Ollama 无需填写）</label><input id="mc-key" type="password" placeholder="sk-..."></div>',
      '  <div class="mc-field"><label>朗读音色</label><select id="mc-voice"><option value="">自动选择中文音色</option></select></div>',
      '  <label class="mc-switch"><input type="checkbox" id="mc-duck">说话时暂停音乐</label>',
      '  <button class="mc-save" id="mc-save" type="button">保存设置</button>',
      '  <div class="mc-hint" style="margin-top:10px">' +
        'Ollama 需在启动前设置 <b>OLLAMA_ORIGINS=*</b> 允许网页跨域；' +
        '若页面是 HTTPS，浏览器会拦截 http://localhost 请求，请改用 http 页面或给 Ollama 配 HTTPS 反向代理。' +
      '</div>',
      '</div>'
    ].join('');

    root.appendChild(style);
    root.appendChild(btn);
    root.appendChild(panel);

    /* 只注入一次样式，多实例共享 */
    if (!document.getElementById('miku-chat-style')) document.head.appendChild(style);
    document.body.appendChild(root);
    if (style.parentNode !== document.head) style.parentNode.removeChild(style);

    var $ = function (id) { return root.querySelector('#' + id); };
    var bodyEl = $('mc-body');
    var inputEl = $('mc-input');
    var sendEl = $('mc-send');
    var micEl = $('mc-mic');
    var statusEl = $('mc-status');
    var hintEl = $('mc-hint');
    var ttsBtn = $('mc-tts');
    var gearBtn = $('mc-gear');
    var closeBtn = $('mc-close');

    var settings = readSettings();
    var history = [];
    var busy = false;
    var listening = false;
    var recognition = null;
    var recognitionSupported = !!(global.SpeechRecognition || global.webkitSpeechRecognition);
    var speaking = false;
    var resumeAfterSpeak = false;
    var playerApi = options.player || null;
    var lastReply = '';

    /* ---- UI 状态 ---- */
    function isOpen() { return root.classList.contains('open'); }

    function open() {
      root.classList.add('open');
      panel.classList.remove('settings');
      applySettingsToUI();
      setTimeout(function () { inputEl.focus(); }, 60);
      return instance;
    }
    function close() {
      root.classList.remove('open');
      stopListening();
      return instance;
    }
    function toggle() { return isOpen() ? close() : open(); }

    function addMessage(text, who, cls) {
      var wrap = document.createElement('div');
      wrap.className = 'mc-msg ' + (who || 'pet') + (cls ? ' ' + cls : '');
      var bubble = document.createElement('div');
      bubble.className = 'mc-bubble';
      bubble.textContent = text;
      wrap.appendChild(bubble);
      bodyEl.appendChild(wrap);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      return bubble;
    }

    function setBusy(v) {
      busy = v;
      btn.classList.toggle('busy', v);
      sendEl.disabled = v;
      micEl.disabled = v;
      inputEl.disabled = v;
    }

    /* ---- 语音朗读 ---- */
    function pickChineseVoice() {
      if (!global.speechSynthesis) return null;
      var voices = global.speechSynthesis.getVoices() || [];
      if (settings.voiceURI) {
        for (var i = 0; i < voices.length; i++) {
          if (voices[i].voiceURI === settings.voiceURI) return voices[i];
        }
      }
      var zh = voices.filter(function (v) { return /^zh(-|_)/i.test(v.lang) || /Chinese|Mandarin|中文|普通话/i.test(v.name); });
      var female = zh.filter(function (v) { return /female|女|Xiaoxiao|Xiaoyi|Huihui|Yaoyao/i.test(v.name); });
      return female[0] || zh[0] || null;
    }

    function duckStart() {
      if (!settings.duckMusic || !playerApi || !playerApi.audio) return;
      resumeAfterSpeak = !playerApi.audio.paused;
      if (resumeAfterSpeak) playerApi.audio.pause();
    }
    function duckEnd() {
      if (!resumeAfterSpeak) return;
      resumeAfterSpeak = false;
      if (playerApi && playerApi.audio && playerApi.audio.src) playerApi.audio.play().catch(function () {});
    }

    function speak(text) {
      if (!global.speechSynthesis || !text) return false;
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(speakable(text));
      u.lang = 'zh-CN';
      u.rate = 1.02;
      u.pitch = 1.15;
      var voice = pickChineseVoice();
      if (voice) u.voice = voice;
      speaking = true;
      duckStart();
      u.onend = u.onerror = function () {
        speaking = false;
        duckEnd();
        refreshTtsBtn();
      };
      try { global.speechSynthesis.speak(u); } catch (e) { speaking = false; duckEnd(); }
      refreshTtsBtn();
      return true;
    }

    function stopSpeak() {
      if (global.speechSynthesis) global.speechSynthesis.cancel();
      speaking = false;
      duckEnd();
      refreshTtsBtn();
    }

    function refreshTtsBtn() {
      ttsBtn.classList.toggle('on', !!settings.tts);
      ttsBtn.title = settings.tts ? '自动朗读：开' : '自动朗读：关';
    }

    /* ---- 语音输入 ---- */
    function setHint(text, warn) {
      hintEl.textContent = text;
      hintEl.classList.toggle('warn', !!warn);
    }

    function stopListening() {
      listening = false;
      micEl.classList.remove('listening');
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
        recognition = null;
      }
    }

    function startListening() {
      if (!recognitionSupported) {
        setHint('当前浏览器不支持语音识别，请用 Chrome / Edge，或直接输入文字。', true);
        return;
      }
      if (listening) { stopListening(); return; }
      var Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
      recognition = new Ctor();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      listening = true;
      micEl.classList.add('listening');
      setHint('正在聆听……说完自动发送。', false);

      recognition.onresult = function (ev) {
        var text = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript;
        }
        text = text.trim();
        if (text) {
          inputEl.value = text;
          autoGrow();
          send(text);
        } else {
          setHint('没有听清，主人再说一次好吗？', true);
        }
      };
      recognition.onerror = function (ev) {
        listening = false;
        micEl.classList.remove('listening');
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setHint('麦克风权限被拒绝，请在浏览器地址栏允许麦克风。', true);
        } else if (ev.error === 'no-speech') {
          setHint('没有听到声音，点击麦克风再试一次。', false);
        } else {
          setHint('语音识别出错：' + ev.error, true);
        }
      };
      recognition.onend = function () {
        listening = false;
        micEl.classList.remove('listening');
        if (!busy) setHint('语音输入需浏览器支持；朗读使用系统语音。', false);
      };
      try { recognition.start(); } catch (e) {
        listening = false;
        micEl.classList.remove('listening');
        setHint('无法启动语音识别：' + (e.message || e), true);
      }
    }

    /* ---- 后端请求 ---- */
    function buildMessages(userText) {
      var msgs = [{ role: 'system', content: options.systemPrompt || SYSTEM_PROMPT }];
      var recent = history.slice(-MAX_HISTORY);
      return msgs.concat(recent, [{ role: 'user', content: userText }]);
    }

    function askOllama(userText) {
      var base = String(settings.baseUrl || '').replace(/\/+$/, '');
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 120000) : null;
      return fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
        body: JSON.stringify({
          model: settings.model || 'qwen3:4b',
          messages: buildMessages(userText),
          stream: false,
          // 实测：部分 Ollama 模型（如 qwen3 某些版本）会忽略 think:false，
          // 把推理过程直接混进 content 且不带 <think> 标签，无法过滤。
          // 改用 think:true，让推理进入独立的 message.thinking 字段，
          // 这里只取 message.content，输出始终是干净的回复。
          think: true,
          options: { temperature: 0.75, num_ctx: 4096 }
        })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error(data.error || ('Ollama HTTP ' + res.status));
          var answer = cleanOllamaAnswer(data.message && data.message.content);
          if (!answer) throw new Error('本地模型没有返回可显示的最终答复，请确认 Ollama 支持 think:false。');
          return answer;
        });
      });
    }

    function askOpenAI(userText) {
      if (!settings.apiKey) return Promise.reject(new Error('选择了 OpenAI 接口，但还没有填写 API Key'));
      var base = String(settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 120000) : null;
      return fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey
        },
        signal: ctrl ? ctrl.signal : undefined,
        body: JSON.stringify({
          model: settings.model || 'gpt-4o-mini',
          messages: buildMessages(userText),
          temperature: 0.75
        })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
          var answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!answer) throw new Error('接口没有返回内容');
          return answer;
        });
      });
    }

    function send(text) {
      var msg = String(text == null ? inputEl.value : text).trim();
      if (!msg || busy) return Promise.resolve({ error: true, text: '正在回复中，请稍候' });

      open();
      if (text == null) inputEl.value = '';
      autoGrow();
      addMessage(msg, 'user');
      history.push({ role: 'user', content: msg });

      var pending = addMessage('蓝莓酱正在想…', 'pet');
      pending.classList.add('mc-typing');
      setBusy(true);
      setHint('正在请求 AI…', false);

      var req = settings.provider === 'openai' ? askOpenAI(msg) : askOllama(msg);
      return req.then(function (answer) {
        pending.classList.remove('mc-typing');
        pending.textContent = answer;
        bodyEl.scrollTop = bodyEl.scrollHeight;
        history.push({ role: 'assistant', content: answer });
        lastReply = answer;
        setHint('语音输入需浏览器支持；朗读使用系统语音。', false);
        if (settings.tts) speak(answer);
        return { text: answer };
      }).catch(function (err) {
        var hintText = errorHint(err);
        pending.classList.remove('mc-typing');
        pending.textContent = '呜……' + hintText;
        pending.closest('.mc-msg').classList.add('err');
        setHint(hintText.split('\n')[0], true);
        return { error: true, text: hintText };
      }).then(function (result) {
        setBusy(false);
        inputEl.focus();
        return result;
      });
    }

    /* ---- 自动高度 ---- */
    function autoGrow() {
      inputEl.style.height = '38px';
      var h = Math.min(96, Math.max(38, inputEl.scrollHeight));
      inputEl.style.height = h + 'px';
    }

    /* ---- 设置 ---- */
    function syncStatus() {
      statusEl.textContent = settings.provider === 'openai'
        ? 'OpenAI 兼容 · ' + (settings.model || '未设置模型')
        : '本地 Ollama · ' + (settings.model || 'qwen3:4b');
    }

    function fillVoiceOptions(keep) {
      var sel = $('mc-voice');
      var voices = (global.speechSynthesis && global.speechSynthesis.getVoices()) || [];
      var zh = voices.filter(function (v) { return /^zh(-|_)/i.test(v.lang) || /Chinese|Mandarin/i.test(v.name); });
      var current = keep ? sel.value : settings.voiceURI;
      sel.innerHTML = '<option value="">自动选择中文音色</option>';
      zh.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = v.name + '（' + v.lang + '）';
        sel.appendChild(o);
      });
      sel.value = current || '';
      if (sel.value !== (current || '')) sel.value = '';
    }

    function applySettingsToUI() {
      $('mc-provider').value = settings.provider;
      $('mc-base').value = settings.baseUrl;
      $('mc-model').value = settings.model;
      $('mc-key').value = settings.apiKey;
      $('mc-duck').checked = !!settings.duckMusic;
      fillVoiceOptions(false);
      syncStatus();
      refreshTtsBtn();
    }

    function normalizeBase(provider, base) {
      var b = String(base || '').trim().replace(/\/+$/, '');
      if (!b) return provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1';
      if (provider === 'ollama' && /localhost|127\.0\.0\.1/.test(b) && !/^http/.test(b)) b = 'http://' + b;
      return b;
    }

    function saveSettings() {
      var provider = $('mc-provider').value === 'openai' ? 'openai' : 'ollama';
      settings = {
        provider: provider,
        baseUrl: normalizeBase(provider, $('mc-base').value),
        model: String($('mc-model').value || (provider === 'ollama' ? 'qwen3:4b' : 'gpt-4o-mini')).trim(),
        apiKey: String($('mc-key').value || '').trim(),
        tts: settings.tts,
        voiceURI: $('mc-voice').value || '',
        duckMusic: $('mc-duck').checked
      };
      writeSettings(settings);
      applySettingsToUI();
      panel.classList.remove('settings');
      addMessage('设置已保存。', 'pet');
      return settings;
    }

    function configure(patch) {
      patch = patch || {};
      var next = {};
      for (var k in settings) next[k] = settings[k];
      for (var key in patch) {
        if (patch[key] !== undefined) next[key] = patch[key];
      }
      next.provider = next.provider === 'openai' ? 'openai' : 'ollama';
      next.baseUrl = normalizeBase(next.provider, next.baseUrl);
      settings = next;
      writeSettings(settings);
      applySettingsToUI();
      return settings;
    }

    /* ---- 事件绑定 ---- */
    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    gearBtn.addEventListener('click', function () {
      panel.classList.toggle('settings');
      if (panel.classList.contains('settings')) applySettingsToUI();
    });
    ttsBtn.addEventListener('click', function () {
      if (speaking) { stopSpeak(); return; }
      settings.tts = !settings.tts;
      writeSettings(settings);
      refreshTtsBtn();
      if (settings.tts && lastReply) speak(lastReply);
    });
    sendEl.addEventListener('click', function () { send(); });
    micEl.addEventListener('click', function () { startListening(); });
    $('mc-save').addEventListener('click', saveSettings);
    $('mc-provider').addEventListener('change', function () {
      var provider = $('mc-provider').value;
      var base = $('mc-base');
      var model = $('mc-model');
      if (provider === 'ollama') {
        if (!base.value || /openai\.com/i.test(base.value)) base.value = 'http://localhost:11434';
        if (!model.value || model.value === 'gpt-4o-mini') model.value = 'qwen3:4b';
      } else {
        if (!base.value || /localhost|127\.0\.0\.1/i.test(base.value)) base.value = 'https://api.openai.com/v1';
        if (!model.value || model.value === 'qwen3:4b') model.value = 'gpt-4o-mini';
      }
    });

    inputEl.addEventListener('input', autoGrow);
    inputEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        send();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isOpen()) close();
    });

    if (global.speechSynthesis) {
      if (typeof global.speechSynthesis.onvoiceschanged !== 'undefined') {
        global.speechSynthesis.onvoiceschanged = function () { fillVoiceOptions(true); };
      }
      fillVoiceOptions(false);
    }

    if (!recognitionSupported) {
      micEl.style.display = 'none';
      setHint('当前浏览器不支持语音识别，可直接输入文字（朗读仍可用）。', false);
    }

    /* ---- 挂到播放器右键菜单 ---- */
    function attachToMenu() {
      var menu = document.getElementById('ctx-menu');
      if (!menu || menu.querySelector('[data-act="miku-chat"]')) return;
      var item = document.createElement('div');
      item.className = 'item';
      item.setAttribute('data-act', 'miku-chat');
      item.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 4H7v-2h6v2z"/></svg><span>AI 语音聊天</span>';
      item.addEventListener('click', function (ev) {
        ev.stopPropagation();
        menu.style.display = 'none';
        open();
      });
      var now = menu.querySelector('.now');
      if (now && now.nextSibling) menu.insertBefore(item, now.nextSibling);
      else menu.insertBefore(item, menu.firstChild);
    }

    attachToMenu();
    var attempts = 0;
    var menuTimer = setInterval(function () {
      attempts++;
      attachToMenu();
      if (attempts > 40 || document.getElementById('ctx-menu')) clearInterval(menuTimer);
    }, 250);

    /* 绑定播放器实例：暂停音乐 / 生命周期 */
    function bindPlayer(api) {
      playerApi = api || null;
      return instance;
    }

    var instance = {
      root: root,
      panel: panel,
      button: btn,
      open: open,
      close: close,
      toggle: toggle,
      ask: function (text) { return send(text); },
      send: send,
      speak: speak,
      stopSpeak: stopSpeak,
      listen: startListening,
      stopListen: stopListening,
      bindPlayer: bindPlayer,
      configure: configure,
      getSettings: function () { return settings; },
      setSettings: configure,
      resetHistory: function () { history = []; bodyEl.innerHTML = ''; },
      attachMenu: attachToMenu,
      setAnchor: function (el) {
        if (!el || !btn) return;
        var rect = el.getBoundingClientRect();
        if (!rect.width) return;
        btn.style.right = Math.max(12, global.innerWidth - rect.right) - 8 + 'px';
        btn.style.bottom = Math.max(12, global.innerHeight - rect.bottom - 62) + 'px';
      },
      destroy: function () {
        stopSpeak();
        stopListening();
        clearInterval(menuTimer);
        if (root.parentNode) root.parentNode.removeChild(root);
        var item = document.querySelector('#ctx-menu [data-act="miku-chat"]');
        if (item && item.parentNode) item.parentNode.removeChild(item);
        var i = instances.indexOf(instance);
        if (i >= 0) instances.splice(i, 1);
      }
    };

    if (options.anchor) {
      try {
        var anchorEl = typeof options.anchor === 'string' ? document.querySelector(options.anchor) : options.anchor;
        if (anchorEl) setTimeout(function () { instance.setAnchor(anchorEl); }, 800);
      } catch (e) {}
    }

    applySettingsToUI();
    instances.push(instance);
    if (options.open) open();
    return instance;
  }

  /* ---------------- 对外 API ---------------- */

  var instances = [];
  var primary = null;

  function getPrimary() {
    if (!primary) primary = createInstance({});
    return primary;
  }

  var API = {
    __ready: true,
    version: '1.0.0',
    instances: instances,
    init: function (options) {
      options = options || {};
      if (options.singleton !== false && instances.length) return instances[0];
      var inst = createInstance(options);
      if (!primary) primary = inst;
      return inst;
    },
    open: function () { return getPrimary().open(); },
    close: function () { return getPrimary().close(); },
    toggle: function () { return getPrimary().toggle(); },
    ask: function (text) { return getPrimary().ask(text); },
    speak: function (text) { return getPrimary().speak(text); },
    stopSpeak: function () { return getPrimary().stopSpeak(); },
    listen: function () { return getPrimary().listen(); },
    configure: function (patch) { return getPrimary().configure(patch); },
    getSettings: function () { return getPrimary().getSettings(); },
    bindPlayer: function (api) { return getPrimary().bindPlayer(api); },
    destroy: function () {
      instances.slice().forEach(function (i) { i.destroy(); });
      primary = null;
    }
  };

  global.MikuChat = API;

  /* 自动挂载：页面里引入了本脚本，就默认提供 AI 语音助手入口。
   * 如不希望自动出现，可在引入前设置 window.MIKU_CHAT_NO_AUTO = true。 */
  function autoInit() {
    if (global.MIKU_CHAT_NO_AUTO) return;
    if (instances.length) return;
    if (!document.body) return;
    var inst = createInstance({ anchor: '#vinyl-widget' });
    if (!primary) primary = inst;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(autoInit, 300); });
  } else {
    setTimeout(autoInit, 300);
  }
})(typeof window !== 'undefined' ? window : this);
