
/* ============ 【原画】尺寸选择：派系 → 纸型 + 画框 + 定位孔，另加 Field 档位 ============
   仅作用于 #view-oua；动画 / 背景 / Layout 保持静态同款样式。
   参数持久化在 localStorage，不涉及后端。 */
(function () {
  var root = document.getElementById('view-oua');
  if (!root) return;

  var STORE_KEY = 'hm.oua.size.v1';
  var RATIO = { '4:3': 4 / 3, '16:9': 16 / 9, '1.85:1': 1.85, '254×142.875': 254 / 142.875 };
  var DEFAULT = { faction: 'toei', paper: 'b4v', frame: '4:3', peg: '3', field: '12' };

  var FACTIONS = {
    toei: {
      label: '东映',
      papers: [
        { id: 'b4v', label: 'B4 257×364', w: 257, h: 364 },
        { id: 'b4h', label: 'B4横 364×257', w: 364, h: 257 }
      ],
      frames: ['4:3', '16:9']
    },
    ghibli: {
      label: '剧场版手绘（吉卜力）',
      papers: [{ id: 'b4h', label: 'B4横 364×257', w: 364, h: 257 }],
      frames: ['1.85:1']
    },
    sunrise: {
      label: '日升',
      papers: [{ id: 'b4v', label: 'B4 257×364', w: 257, h: 364 }],
      frames: ['16:9']
    },
    comix: {
      label: 'CoMix Wave',
      papers: [{ id: 'b4v', label: 'B4 257×364', w: 257, h: 364 }],
      frames: ['16:9']
    },
    mush: {
      label: '虫制作',
      papers: [{ id: 'ap', label: 'A判 176×250', w: 176, h: 250 }],
      frames: ['4:3']
    },
    aja: {
      label: 'AJA Fr01',
      papers: [{ id: 'a4h', label: 'A4横 297×210', w: 297, h: 210 }],
      frames: ['254×142.875']
    }
  };

  var FIELDS = [
    { id: '8', label: '8', mm: [203.2, 152.4], inch: '8×6' },
    { id: '9', label: '9', mm: [228.6, 171.45], inch: '9×6.75' },
    { id: '10', label: '10', mm: [254, 190.5], inch: '10×7.5' },
    { id: '12', label: '12', mm: [304.8, 228.6], inch: '12×9' },
    { id: '13', label: '13', mm: [330.2, 247.65], inch: '13×9.75' },
    { id: '15', label: '15', mm: [381, 285.75], inch: '15×11.25' },
    { id: '16', label: '16', mm: [406.4, 304.8], inch: '16×12' },
    { id: 'pan', label: 'PAN', mm: [304.8, 457.2], inch: '12×18' }
  ];

  var PGS = [
    { id: '3', label: '三孔（长孔 + 圆孔）' },
    { id: '2', label: '双孔（双圆孔）' },
    { id: '0', label: '无孔' }
  ];

  var paperEl = root.querySelector('.oua-paper');
  var stripEl = root.querySelector('.oua-pegstrip');
  var selFaction = root.querySelector('[data-oua-size="faction"]');
  var selPaper = root.querySelector('[data-oua-size="paper"]');
  var selFrame = root.querySelector('[data-oua-size="frame"]');
  var selPeg = root.querySelector('[data-oua-size="peg"]');
  var selField = root.querySelector('[data-oua-size="field"]');
  var btnReset = root.querySelector('[data-oua-size="reset"]');
  var chipPaper = root.querySelector('[data-oua-chip="paper"]');
  var chipField = root.querySelector('[data-oua-chip="field"]');
  var chipFrame = root.querySelector('[data-oua-chip="frame"]');
  var chipOverride = root.querySelector('[data-oua-chip="override"]');
  if (!paperEl || !stripEl || !selFaction) return;

  var state = load();

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    var s = {};
    for (var k in DEFAULT) s[k] = (raw && raw[k] != null) ? String(raw[k]) : DEFAULT[k];
    if (!FACTIONS[s.faction]) s.faction = DEFAULT.faction;
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function fillSelect(sel, items) {
    var buf = '';
    for (var i = 0; i < items.length; i++) {
      buf += '<option value="' + items[i].value + '">' + items[i].label + '</option>';
    }
    sel.innerHTML = buf;
  }

  function currentPaper() {
    var papers = FACTIONS[state.faction].papers;
    for (var i = 0; i < papers.length; i++) {
      if (papers[i].id === state.paper) return papers[i];
    }
    return papers[0];
  }

  function currentField() {
    for (var i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].id === state.field) return FIELDS[i];
    }
    return FIELDS[3];
  }

  function normalize() {
    var f = FACTIONS[state.faction];
    var hitPaper = false;
    for (var i = 0; i < f.papers.length; i++) if (f.papers[i].id === state.paper) hitPaper = true;
    if (!hitPaper) state.paper = f.papers[0].id;
    if (f.frames.indexOf(state.frame) < 0) state.frame = f.frames[0];
    var hitField = false;
    for (var j = 0; j < FIELDS.length; j++) if (FIELDS[j].id === state.field) hitField = true;
    if (!hitField) state.field = DEFAULT.field;
    var hitPeg = false;
    for (var p = 0; p < PGS.length; p++) if (PGS[p].id === state.peg) hitPeg = true;
    if (!hitPeg) state.peg = DEFAULT.peg;
  }

  function renderControls() {
    var f = FACTIONS[state.faction];
    fillSelect(selFaction, Object.keys(FACTIONS).map(function (id) {
      return { value: id, label: FACTIONS[id].label };
    }));
    fillSelect(selPaper, f.papers.map(function (p) {
      return { value: p.id, label: p.label };
    }));
    fillSelect(selFrame, f.frames.map(function (r) {
      return { value: r, label: r };
    }));
    fillSelect(selPeg, PGS.map(function (p) {
      return { value: p.id, label: p.label };
    }));
    fillSelect(selField, FIELDS.map(function (fd) {
      return { value: fd.id, label: fd.label };
    }));
    selFaction.value = state.faction;
    selPaper.value = state.paper;
    selFrame.value = state.frame;
    selPeg.value = state.peg;
    selField.value = state.field;
  }

  function apply() {
    normalize();
    renderControls();

    var paper = currentPaper();
    var field = currentField();
    var ratio = RATIO[state.frame] || 16 / 9;

    /* 画框比例：直接作用在纸张（画面区）上，切换后画面区比例真的改变 */
    paperEl.style.setProperty('--oua-paper-ratio', String(ratio));

    /* Field：视野相对纸面越小，画面区四周留白越多（上限 8%，避免压扁画面） */
    var pad = (1 - field.mm[0] / paper.w) * 100;
    if (!isFinite(pad) || pad < 0) pad = 0;
    if (pad > 8) pad = 8;
    paperEl.style.setProperty('--oua-field-pad', pad.toFixed(2) + '%');

    /* 定位孔类型：只在原画里覆盖 */
    stripEl.setAttribute('data-peg', state.peg);

    if (chipPaper) chipPaper.textContent = paper.label;
    if (chipField) chipField.textContent = 'FIELD ' + field.label + ' · ' + field.mm[0] + '×' + field.mm[1] + 'mm';
    if (chipFrame) chipFrame.textContent = state.frame;
    if (chipOverride) chipOverride.hidden = (state.peg === DEFAULT.peg);

    /* 供绘画工作台读取：纸面 mm 尺寸 / 画框比例 / Field */
    var info = {
      faction: state.faction,
      frame: state.frame,
      peg: state.peg,
      paper: { id: paper.id, label: paper.label, w: paper.w, h: paper.h },
      field: { id: field.id, label: field.label, mm: field.mm.slice() },
      ratio: ratio
    };
    window.HMOuaSize = {
      get: function () { return info; }
    };
    try {
      document.dispatchEvent(new CustomEvent('hm:oua-size', { detail: info }));
    } catch (e) { /* 老浏览器忽略 */ }
  }

  function commit() {
    save();
    apply();
  }

  selFaction.addEventListener('change', function () { state.faction = this.value; commit(); });
  selPaper.addEventListener('change', function () { state.paper = this.value; commit(); });
  selFrame.addEventListener('change', function () { state.frame = this.value; commit(); });
  selPeg.addEventListener('change', function () { state.peg = this.value; commit(); });
  selField.addEventListener('change', function () { state.field = this.value; commit(); });
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      for (var k in DEFAULT) state[k] = DEFAULT[k];
      commit();
    });
  }

  apply();
})();
