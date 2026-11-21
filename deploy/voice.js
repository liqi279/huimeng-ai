'use strict';

/* =============================================================
 * 绘梦 · 配音模块（HMVoice）
 * 台词配音台：角色音色预设 + 逐条试听 + 连续整段配音
 * 语音输出使用浏览器 Speech Synthesis（中文语音，免后端）
 * ============================================================= */
(function () {
  var LS_KEY = 'anidream.voice.v1';

  /* 角色音色预设：pitch/rate 为相对全局参数的偏移 */
  var PRESETS = [
    { id: 'c-shonen', name: '少年', pitch: 1.3, rate: 1.05, color: '#6ea8fe', desc: '热血 / 朝气' },
    { id: 'c-shojo', name: '少女', pitch: 1.6, rate: 1.0, color: '#f472b6', desc: '清亮 / 甜美' },
    { id: 'c-onee', name: '御姐', pitch: 1.1, rate: 0.92, color: '#c084fc', desc: '成熟 / 从容' },
    { id: 'c-ossan', name: '大叔', pitch: 0.7, rate: 0.95, color: '#f2c14e', desc: '低沉 / 厚重' },
    { id: 'c-rojin', name: '老者', pitch: 0.6, rate: 0.8, color: '#9fd3a0', desc: '苍老 / 缓慢' },
    { id: 'c-kaiju', name: '反派', pitch: 0.5, rate: 0.9, color: '#fb7185', desc: '阴郁 / 压迫' },
    { id: 'c-narr', name: '旁白', pitch: 0.9, rate: 1.0, color: '#8fd3ff', desc: '平稳 / 叙述' }
  ];

  var state = {
    cast: [],          // 当前项目的角色（由预设初始化，可增删）
    lines: [],         // {id, castId, text}
    rate: 1, pitch: 1, gap: 0.4,
    playingAll: false,
    playingIdx: -1,
    seq: 1
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cast: state.cast, lines: state.lines,
        rate: state.rate, pitch: state.pitch, gap: state.gap, seq: state.seq
      }));
    } catch (e) {}
  }

  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (Array.isArray(d.cast) && d.cast.length) state.cast = d.cast;
      if (Array.isArray(d.lines)) state.lines = d.lines;
      if (d.rate) state.rate = d.rate;
      if (d.pitch) state.pitch = d.pitch;
      if (d.gap != null) state.gap = d.gap;
      if (d.seq) state.seq = d.seq;
    } catch (e) {}
  }

  function castOf(id) {
    for (var i = 0; i < state.cast.length; i++) {
      if (state.cast[i].id === id) return state.cast[i];
    }
    return state.cast[0] || null;
  }

  /* 中文环境下每秒约 4~5 个字，按语速折算 */
  function estSec(text, rateMul) {
    var n = String(text || '').replace(/\s/g, '').length;
    return Math.max(0.5, Math.round((n / (4.5 * state.rate * rateMul)) * 10) / 10);
  }

  function renderStats() {
    var chars = 0, secs = 0;
    state.lines.forEach(function (l) {
      var c = castOf(l.castId);
      var r = c ? c.rate : 1;
      chars += String(l.text || '').replace(/\s/g, '').length;
      secs += estSec(l.text, r);
    });
    var s = $('vcStats');
    if (s) s.textContent = state.lines.length + ' 条台词 · ' + chars + ' 字 · 预计 ' + Math.round(secs) + ' 秒';
  }

  function renderCast() {
    var box = $('vcCast');
    if (!box) return;
    box.innerHTML = state.cast.map(function (c) {
      return '<div class="vc-cast-item" data-cast="' + esc(c.id) + '" style="--cc:' + esc(c.color) + '">'
        + '<span class="vc-cast-dot"></span>'
        + '<span class="vc-cast-name">' + esc(c.name) + '</span>'
        + '<span class="vc-cast-desc">' + esc(c.desc || '') + '</span>'
        + '<button class="vc-cast-del" data-del="' + esc(c.id) + '" title="删除角色">×</button>'
        + '</div>';
    }).join('');
    var sel = $('vcNewCast');
    if (sel) {
      sel.innerHTML = state.cast.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('');
    }
  }

  function renderLines() {
    var box = $('vcLines');
    if (!box) return;
    if (!state.lines.length) {
      box.innerHTML = '<div class="vc-empty">还没有台词。在下方输入第一句，或点击「从剧本导入」。</div>';
      renderStats();
      return;
    }
    box.innerHTML = state.lines.map(function (l, i) {
      var c = castOf(l.castId);
      var color = c ? c.color : '#8a93a6';
      var name = c ? c.name : '？';
      return '<div class="vc-line' + (state.playingIdx === i ? ' is-speaking' : '') + '" data-idx="' + i + '">'
        + '<span class="vc-col-idx">' + (i + 1) + '</span>'
        + '<span class="vc-col-cast"><span class="vc-tag" style="--cc:' + esc(color) + '">' + esc(name) + '</span></span>'
        + '<span class="vc-col-text" data-edit="' + i + '" title="点击编辑">' + esc(l.text) + '</span>'
        + '<span class="vc-col-time">' + estSec(l.text, c ? c.rate : 1) + 's</span>'
        + '<span class="vc-col-ops">'
        + '<button class="vc-op" data-play="' + i + '" title="试听">▶</button>'
        + '<button class="vc-op" data-up="' + i + '" title="上移">↑</button>'
        + '<button class="vc-op" data-down="' + i + '" title="下移">↓</button>'
        + '<button class="vc-op vc-op-del" data-del-line="' + i + '" title="删除">×</button>'
        + '</span></div>';
    }).join('');
    renderStats();
  }

  /* ---------------- 语音合成 ---------------- */
  function speak(text, cast, onend) {
    if (!('speechSynthesis' in window)) {
      if (window.HMApp && window.HMApp.toast) window.HMApp.toast('当前浏览器不支持语音合成', 'error');
      if (onend) onend();
      return;
    }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = Math.min(4, Math.max(0.1, state.rate * (cast ? cast.rate : 1)));
    u.pitch = Math.min(2, Math.max(0, state.pitch * (cast ? cast.pitch : 1)));
    var voices = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < voices.length; i++) {
      if (/zh|中文|Chinese/i.test(voices[i].lang + voices[i].name)) { u.voice = voices[i]; break; }
    }
    u.onend = function () { if (onend) onend(); };
    u.onerror = function () { if (onend) onend(); };
    window.speechSynthesis.speak(u);
  }

  function stopSpeak() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    state.playingAll = false;
    state.playingIdx = -1;
    var btn = $('vcPlayAllBtn');
    if (btn) btn.textContent = '▶ 连续配音';
    renderLines();
  }

  function playOne(i) {
    stopSpeak();
    var l = state.lines[i];
    if (!l) return;
    state.playingIdx = i;
    renderLines();
    speak(l.text, castOf(l.castId), function () {
      state.playingIdx = -1;
      renderLines();
    });
  }

  function playAll() {
    if (state.playingAll) { stopSpeak(); return; }
    if (!state.lines.length) return;
    state.playingAll = true;
    var btn = $('vcPlayAllBtn');
    if (btn) btn.textContent = '⏹ 停止配音';
    var i = 0;
    (function next() {
      if (!state.playingAll || i >= state.lines.length) { stopSpeak(); return; }
      var l = state.lines[i];
      state.playingIdx = i;
      renderLines();
      speak(l.text, castOf(l.castId), function () {
        i++;
        window.setTimeout(next, state.gap * 1000);
      });
    })();
  }

  /* ---------------- 增删改 ---------------- */
  function addLine(castId, text) {
    text = String(text || '').trim();
    if (!text) return false;
    state.lines.push({ id: 'l' + (state.seq++), castId: castId, text: text });
    persist(); renderLines();
    return true;
  }

  function importFromScript() {
    var text = '';
    try {
      var raw = localStorage.getItem('anidream.draft.v1');
      if (raw) {
        var d = JSON.parse(raw);
        text = d && (d.script || d.text || d.content) || '';
      }
    } catch (e) {}
    if (!text) {
      text = window.prompt('粘贴剧本文本（每行一句，可用「角色：台词」格式）：', '');
      if (!text) return;
    }
    var rows = String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var added = 0;
    rows.forEach(function (row) {
      var m = row.match(/^(.{1,8})[：:]\s*(.+)$/);
      var castName = m ? m[1] : '旁白';
      var lineText = m ? m[2] : row;
      var cast = null;
      state.cast.forEach(function (c) { if (c.name === castName) cast = c; });
      if (!cast) {
        var base = PRESETS.find(function (p) { return p.name === castName; }) || PRESETS[6];
        cast = { id: 'c' + (state.seq++), name: castName, pitch: base.pitch, rate: base.rate, color: base.color, desc: '导入角色' };
        state.cast.push(cast);
      }
      if (addLine(cast.id, lineText)) added++;
    });
    renderCast();
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast('已导入 ' + added + ' 条台词', 'success');
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    var addBtn = $('vcAddLineBtn'), input = $('vcNewText'), sel = $('vcNewCast');
    if (addBtn) addBtn.addEventListener('click', function () {
      if (addLine(sel.value, input.value)) input.value = '';
    });
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && addLine(sel.value, input.value)) input.value = '';
    });

    var lines = $('vcLines');
    if (lines) lines.addEventListener('click', function (e) {
      var t = e.target.closest('[data-play],[data-up],[data-down],[data-del-line],[data-edit]');
      if (!t) return;
      if (t.dataset.play != null) playOne(+t.dataset.play);
      else if (t.dataset.delLine != null) {
        state.lines.splice(+t.dataset.delLine, 1); persist(); renderLines();
      } else if (t.dataset.up != null) {
        var i = +t.dataset.up;
        if (i > 0) { var tmp = state.lines[i - 1]; state.lines[i - 1] = state.lines[i]; state.lines[i] = tmp; persist(); renderLines(); }
      } else if (t.dataset.down != null) {
        var j = +t.dataset.down;
        if (j < state.lines.length - 1) { var tp = state.lines[j + 1]; state.lines[j + 1] = state.lines[j]; state.lines[j] = tp; persist(); renderLines(); }
      } else if (t.dataset.edit != null) {
        var k = +t.dataset.edit;
        var nv = window.prompt('编辑台词：', state.lines[k].text);
        if (nv != null && nv.trim()) { state.lines[k].text = nv.trim(); persist(); renderLines(); }
      }
    });

    var playAllBtn = $('vcPlayAllBtn');
    if (playAllBtn) playAllBtn.addEventListener('click', playAll);
    var clearBtn = $('vcClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (window.confirm('确定清空全部台词？')) { stopSpeak(); state.lines = []; persist(); renderLines(); }
    });
    var importBtn = $('vcImportBtn');
    if (importBtn) importBtn.addEventListener('click', importFromScript);

    var castBox = $('vcCast');
    if (castBox) castBox.addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (!del) return;
      var id = del.dataset.del;
      if (state.lines.some(function (l) { return l.castId === id; })) {
        window.alert('该角色仍有台词，无法删除'); return;
      }
      state.cast = state.cast.filter(function (c) { return c.id !== id; });
      persist(); renderCast();
    });

    var addCastBtn = $('vcAddCastBtn');
    if (addCastBtn) addCastBtn.addEventListener('click', function () {
      var name = window.prompt('角色名：', '');
      if (!name || !name.trim()) return;
      name = name.trim();
      if (state.cast.some(function (c) { return c.name === name; })) return;
      var base = PRESETS[state.cast.length % PRESETS.length];
      state.cast.push({ id: 'c' + (state.seq++), name: name, pitch: base.pitch, rate: base.rate, color: base.color, desc: '自定义' });
      persist(); renderCast();
    });

    [['vcRate', 'vcRateVal', 'rate', function (v) { return v.toFixed(1); }],
     ['vcPitch', 'vcPitchVal', 'pitch', function (v) { return v.toFixed(1); }],
     ['vcGap', 'vcGapVal', 'gap', function (v) { return v.toFixed(1) + 's'; }]].forEach(function (cfg) {
      var el = $(cfg[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        state[cfg[2]] = parseFloat(el.value);
        $(cfg[1]).textContent = cfg[3](state[cfg[2]]);
        persist(); renderStats();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (document.body.dataset.view !== 'voice') return;
      if (e.key === 'Escape') stopSpeak();
    });
    window.addEventListener('beforeunload', stopSpeak);
  }

  function init() {
    restore();
    if (!state.cast.length) {
      state.cast = PRESETS.slice(0, 5).map(function (p) { return Object.assign({}, p); });
    }
    $('vcRate') && ($('vcRate').value = state.rate);
    $('vcPitch') && ($('vcPitch').value = state.pitch);
    $('vcGap') && ($('vcGap').value = state.gap);
    $('vcRateVal') && ($('vcRateVal').textContent = state.rate.toFixed(1));
    $('vcPitchVal') && ($('vcPitchVal').textContent = state.pitch.toFixed(1));
    $('vcGapVal') && ($('vcGapVal').textContent = state.gap.toFixed(1) + 's');
    renderCast();
    renderLines();
    bind();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices(); /* 预热语音列表 */
    }
  }

  window.HMVoice = {
    stop: stopSpeak,
    leave: stopSpeak
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
