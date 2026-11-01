/* ============================================================
 * 右侧 AI 聊天面板 HMCHAT
 * - 可点击显示/隐藏，左侧内容区自适应宽度
 * - 可拖拽左边缘改变面板宽度
 * - 支持选择多种大语言模型（OpenAI 兼容接口），API Key 存本机
 * - 通过后端 /api/chat 代理转发，规避浏览器 CORS
 * ============================================================ */
window.HMChat = (function () {
  'use strict';

  var LS = {
    open: 'anidream.chat.open',
    width: 'anidream.chat.width',
    provider: 'anidream.chat.provider',
    model: 'anidream.chat.model',
    key: function (id) { return 'anidream.chat.key.' + id; },
    msgs: 'anidream.chat.messages'
  };

  var PROVIDERS = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    { id: 'moonshot', name: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
    { id: 'qwen', name: '通义千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'] },
    { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas', models: ['glm-4', 'glm-4-flash', 'glm-4-plus', 'glm-3-turbo'] },
    { id: 'doubao', name: '豆包 Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-1-5-pro-32k'] },
    { id: 'custom', name: '自定义 (OpenAI 兼容)', baseUrl: '', models: [] }
  ];

  var state = {
    open: false,
    width: 380,
    provider: 'deepseek',
    model: '',
    customBase: '',
    customModel: '',
    messages: [],
    sending: false,
    abortCtrl: null
  };

  var el = {};
  var inited = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  function getProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return PROVIDERS[0];
  }

  function currentBaseUrl() {
    var p = getProvider(state.provider);
    if (p.id === 'custom') return state.customBase;
    return p.baseUrl;
  }
  function currentModel() {
    var p = getProvider(state.provider);
    if (p.id === 'custom') return state.customModel;
    return state.model || (p.models[0] || '');
  }
  function currentKey() {
    try { return localStorage.getItem(LS.key(state.provider)) || ''; } catch (e) { return ''; }
  }

  /* ---------- 持久化 ---------- */
  function load() {
    try { state.open = localStorage.getItem(LS.open) === '1'; } catch (e) {}
    try {
      var w = parseInt(localStorage.getItem(LS.width), 10);
      if (!isNaN(w) && w >= 280 && w <= 900) state.width = w;
    } catch (e) {}
    try {
      var p = localStorage.getItem(LS.provider);
      if (p && getProvider(p)) state.provider = p;
    } catch (e) {}
    try { state.model = localStorage.getItem(LS.model) || ''; } catch (e) {}
    try { state.customBase = localStorage.getItem(LS.key('customBase')) || ''; } catch (e) {}
    try { state.customModel = localStorage.getItem(LS.key('customModel')) || ''; } catch (e) {}
    try {
      var raw = localStorage.getItem(LS.msgs);
      if (raw) state.messages = JSON.parse(raw);
    } catch (e) {}
  }
  function saveOpen() { try { localStorage.setItem(LS.open, state.open ? '1' : '0'); } catch (e) {} }
  function saveWidth() { try { localStorage.setItem(LS.width, String(state.width)); } catch (e) {} }
  function saveProvider() { try { localStorage.setItem(LS.provider, state.provider); } catch (e) {} }
  function saveModel() { try { localStorage.setItem(LS.model, state.model); } catch (e) {} }
  function saveMessages() {
    try { localStorage.setItem(LS.msgs, JSON.stringify(state.messages.slice(-80))); } catch (e) {}
  }

  /* ---------- 渲染 ---------- */
  function renderProviders() {
    var opts = PROVIDERS.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === state.provider ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    el.providerSel.innerHTML = opts;
    renderModelField();
    el.keyInput.value = currentKey();
  }

  function renderModelField() {
    var p = getProvider(state.provider);
    if (p.id === 'custom') {
      el.modelWrap.innerHTML =
        '<input type="text" id="chatCustomBase" placeholder="API 地址，如 https://xxx.com/v1" value="' + (state.customBase || '').replace(/"/g, '&quot;') + '">' +
        '<input type="text" id="chatCustomModel" placeholder="模型名称，如 gpt-4o" value="' + (state.customModel || '').replace(/"/g, '&quot;') + '">';
    } else {
      var opts = p.models.map(function (m) {
        return '<option value="' + m + '"' + (m === state.model ? ' selected' : '') + '>' + m + '</option>';
      }).join('');
      el.modelWrap.innerHTML = '<select id="chatModelSel">' + opts + '</select>';
    }
  }

  function renderMessages() {
    if (!el.messages) return;
    if (state.messages.length === 0) {
      el.messages.innerHTML = '<div class="hm-chat-empty">选择模型并填入 API Key，开始与 AI 对话。<br><small>API Key 仅保存在本机浏览器。</small></div>';
      return;
    }
    var html = '';
    state.messages.forEach(function (m, idx) {
      html += '<div class="hm-chat-msg hm-chat-' + m.role + '">' +
        '<div class="hm-chat-bubble">' + escapeHtml(m.content) + '</div>' +
        (m.role === 'user' ? '<button class="hm-chat-del" data-idx="' + idx + '" title="删除">×</button>' : '') +
        '</div>';
    });
    el.messages.innerHTML = html;
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  /* ---------- 发送消息 ---------- */
  function send() {
    if (state.sending) return;
    var text = el.input.value.trim();
    if (!text) return;
    if (!currentKey()) { toast('请先填入 API Key', 'error'); el.keyInput.focus(); return; }
    if (!currentModel()) { toast('请选择或填写模型名称', 'error'); return; }

    state.messages.push({ role: 'user', content: text });
    el.input.value = '';
    saveMessages();
    renderMessages();

    state.sending = true;
    el.sendBtn.disabled = true;
    el.sendBtn.textContent = '…';

    // 追加一个空 assistant 消息用于流式填充
    state.messages.push({ role: 'assistant', content: '' });
    renderMessages();

    var reqBody = {
      baseUrl: currentBaseUrl(),
      apiKey: currentKey(),
      model: currentModel(),
      messages: state.messages.map(function (m) { return { role: m.role, content: m.content }; }),
      stream: true,
      temperature: 0.7,
      maxTokens: 2048
    };

    var url = (window.HM && HM.api && HM.api.base ? HM.api.base : '/api') + '/chat';
    state.abortCtrl = new AbortController();

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: state.abortCtrl.signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error(t || 'HTTP ' + res.status); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.startsWith('data: ')) continue;
            var data = line.slice(6).trim();
            if (data === '[DONE]') { state.sending = false; finish(); return; }
            try {
              var obj = JSON.parse(data);
              var delta = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
              if (delta) {
                state.messages[state.messages.length - 1].content += delta;
                renderMessages();
              }
            } catch (e) {}
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        state.messages[state.messages.length - 1].content += '\n[已停止]';
      } else {
        state.messages[state.messages.length - 1].content = '⚠️ 请求失败：' + (err && err.message ? err.message : String(err));
      }
      state.sending = false;
      finish();
    });
  }

  function finish() {
    el.sendBtn.disabled = false;
    el.sendBtn.textContent = '发送';
    saveMessages();
    renderMessages();
  }

  function stop() {
    if (state.abortCtrl) { try { state.abortCtrl.abort(); } catch (e) {} }
  }

  function clearChat() {
    if (!state.messages.length) return;
    if (!confirm('清空全部对话记录？')) return;
    state.messages = [];
    saveMessages();
    renderMessages();
  }

  function deleteMsg(idx) {
    state.messages.splice(idx, 1);
    saveMessages();
    renderMessages();
  }

  /* ---------- 面板开关与缩放 ---------- */
  function applyLayout() {
    document.body.classList.toggle('hm-chat-open', state.open);
    document.documentElement.style.setProperty('--hm-chat-width', state.width + 'px');
    if (el.toggle) el.toggle.classList.toggle('is-active', state.open);
  }

  function toggle() {
    state.open = !state.open;
    saveOpen();
    applyLayout();
  }
  function openPanel() { if (!state.open) toggle(); }
  function closePanel() { if (state.open) toggle(); }

  function startDrag(e) {
    e.preventDefault();
    var startX = e.clientX;
    var startW = state.width;
    function move(ev) {
      var w = startW - (ev.clientX - startX);
      if (w < 280) w = 280;
      if (w > 900) w = 900;
      state.width = w;
      document.documentElement.style.setProperty('--hm-chat-width', w + 'px');
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveWidth();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    el.toggle.addEventListener('click', toggle);
    el.closeBtn.addEventListener('click', closePanel);
    el.dragHandle.addEventListener('mousedown', startDrag);

    el.providerSel.addEventListener('change', function () {
      state.provider = el.providerSel.value;
      saveProvider();
      renderModelField();
      el.keyInput.value = currentKey();
    });

    el.modelWrap.addEventListener('change', function (e) {
      if (e.target.id === 'chatModelSel') {
        state.model = e.target.value;
        saveModel();
      }
    });
    el.modelWrap.addEventListener('input', function (e) {
      if (e.target.id === 'chatCustomBase') {
        state.customBase = e.target.value;
        try { localStorage.setItem(LS.key('customBase'), state.customBase); } catch (err) {}
      } else if (e.target.id === 'chatCustomModel') {
        state.customModel = e.target.value;
        try { localStorage.setItem(LS.key('customModel'), state.customModel); } catch (err) {}
      }
    });

    el.keySave.addEventListener('click', function () {
      var k = el.keyInput.value.trim();
      try {
        if (k) localStorage.setItem(LS.key(state.provider), k);
        else localStorage.removeItem(LS.key(state.provider));
      } catch (e) {}
      toast(k ? 'API Key 已保存' : '已清空 API Key', k ? 'success' : 'info');
    });

    el.sendBtn.addEventListener('click', send);
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el.stopBtn.addEventListener('click', stop);
    el.clearBtn.addEventListener('click', clearChat);
    el.messages.addEventListener('click', function (e) {
      var b = e.target.closest('.hm-chat-del');
      if (b) deleteMsg(parseInt(b.getAttribute('data-idx'), 10));
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (inited) return;
    inited = true;
    el.toggle = $('chatToggle');
    el.panel = $('chatPanel');
    el.closeBtn = $('chatClose');
    el.dragHandle = $('chatDrag');
    el.providerSel = $('chatProvider');
    el.modelWrap = $('chatModelWrap');
    el.keyInput = $('chatKey');
    el.keySave = $('chatKeySave');
    el.messages = $('chatMessages');
    el.input = $('chatInput');
    el.sendBtn = $('chatSend');
    el.stopBtn = $('chatStop');
    el.clearBtn = $('chatClear');

    load();
    renderProviders();
    renderMessages();
    applyLayout();
    bind();
  }

  return { init: init, open: openPanel, close: closePanel, toggle: toggle };
})();
