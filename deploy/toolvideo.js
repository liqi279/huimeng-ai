/* ============================================================
 * 免费生视频 HMTOOLVIDEO（零成本本地生成流水线）
 * 流程：提示词 → 生成 Python 代码（Pillow 平涂赛璐璐渲染器）
 *      → 逐帧渲染为 PNG（浏览器内同源 canvas 渲染，与 Python 脚本一致）
 *      → 连续帧预览 → 导出 GIF / WebM(MP4) / PNG 序列 ZIP / 单帧 PNG / Python 脚本
 * 不调用付费接口，不消耗积分。
 * ============================================================ */
window.HMToolVideo = (function () {
  'use strict';

  var DEFAULT_PROMPT = '深蓝夜空里，星光粒子缓缓汇聚成一颗发光的星球';
  var MAX_FRAMES = 96;

  var SHOT_LABELS = { close: '特写', medium: '近景', full: '全景', wide: '远景' };
  var CAM_LABELS = { auto: '自动运镜', dolly: '推镜', pull: '拉镜', pan: '摇镜', orbit: '环绕', follow: '跟拍', static: '固定' };
  var GRADE_LABELS = { cinema: '电影宽银幕', filmic: '胶片动漫', neon: '霓虹', soft: '柔光', clean: '通透' };

  var el = {};
  var inited = false;

  var spec = null;          // 当前场景规格
  var code = '';            // 生成的 Python 代码
  var frameUrls = [];       // PNG dataURL 帧序列
  var frameImgs = [];       // 已解码的帧图片
  var cur = 0;              // 当前预览帧
  var playing = false;
  var rafId = 0;
  var lastTick = 0;
  var busy = false;
  var gifBusy = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }
  function pad(n, len) { var s = String(n); while (s.length < (len || 3)) s = '0' + s; return s; }

  /* ---------------- 提示词编译（本地确定性，零成本） ---------------- */
  var THEMES = [
    { style: 'character', bg1: '#1b1730', bg2: '#07050f', palette: ['#8ab4ff', '#f2f4ff', '#9d7bf7', '#ffffff'],
      keys: ['萝莉', '白毛', '白发', '黑发', '金发', '粉发', '蓝发', '银发', '紫发', '红发', '棕发', '茶发',
        '双马尾', '猫耳', '猫娘', '呆毛', '校服', '水手服', '女仆', '和服', '汉服', '婚纱',
        '少女', '女孩', '女生', '男孩', '少年', '人物', '角色', '立绘', '头像', '二次元',
        'loli', 'girl', 'anime', 'character', 'waifu', 'neko'] },
    { style: 'particles', bg1: '#0b1330', bg2: '#02040c', palette: ['#8ab4ff', '#c7d2fe', '#67e8f9', '#ffffff'],
      keys: ['星', '夜空', '银河', '宇宙', '太空', 'star', 'space', 'galaxy'] },
    { style: 'rain', bg1: '#071320', bg2: '#01060b', palette: ['#7dd3fc', '#38bdf8', '#bae6fd'],
      keys: ['雨', '水滴', '暴雨', 'rain', 'storm'] },
    { style: 'city', bg1: '#160b2a', bg2: '#05010f', palette: ['#f472b6', '#22d3ee', '#fbbf24', '#a78bfa'],
      keys: ['城市', '都市', '霓虹', '赛博', 'city', 'cyber', 'neon'] },
    { style: 'blocks', bg1: '#101a2b', bg2: '#05080f', palette: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa'],
      keys: ['方块', '像素', '几何', '马赛克', '网格', 'block', 'pixel', 'grid'] },
    { style: 'wave', bg1: '#071e2f', bg2: '#020a12', palette: ['#38bdf8', '#22d3ee', '#a5f3fc', '#0ea5e9'],
      keys: ['浪', '海', '水波', '湖', 'wave', 'ocean', 'sea'] },
    { style: 'ripple', bg1: '#120c22', bg2: '#05030d', palette: ['#c4b5fd', '#a78bfa', '#f0abfc'],
      keys: ['涟漪', '圆环', '光环', '扩散', 'ripple', 'ring'] },
    { style: 'orbit', bg1: '#0a1228', bg2: '#03050f', palette: ['#93c5fd', '#fda4af', '#fef3c7', '#a7f3d0'],
      keys: ['轨道', '旋转', '星球', '行星', '卫星', 'orbit', 'planet', 'spin'] },
    { style: 'fireworks', bg1: '#0b0a1a', bg2: '#02020a', palette: ['#fbbf24', '#f472b6', '#60a5fa', '#4ade80', '#ffffff'],
      keys: ['烟花', '爆', '焰火', '火花', 'firework', 'fire'] }
  ];

  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function themeForStyle(style) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].style === style) return THEMES[i];
    return THEMES[1];
  }

  /* 角色外观解析：把「白毛萝莉」「银发双马尾猫耳少女」等描述翻成可绘制的参数 */
  var HAIR_COLORS = [
    { c: '#f6f8ff', s: '#c7d1f0', k: ['白毛', '白发', '银发', '银毛', '白金发', '雪白', 'white hair', 'silver hair'] },
    { c: '#2f2a42', s: '#171326', k: ['黑毛', '黑发', '黑长直', 'black hair'] },
    { c: '#ffd66b', s: '#dca42c', k: ['金毛', '金发', '黄发', 'blonde', 'gold hair'] },
    { c: '#ff9fd0', s: '#e06aa8', k: ['粉毛', '粉发', '粉色头发', 'pink hair'] },
    { c: '#79c6ff', s: '#3f8ede', k: ['蓝毛', '蓝发', '水色发', 'blue hair'] },
    { c: '#c4a6ff', s: '#8f68e6', k: ['紫毛', '紫发', 'purple hair', 'violet hair'] },
    { c: '#ff8f8f', s: '#d65a5a', k: ['红毛', '红发', 'red hair'] },
    { c: '#c28d5f', s: '#8d5b31', k: ['棕发', '茶发', '褐发', 'brown hair'] },
    { c: '#9fe8b0', s: '#5dbd7a', k: ['绿毛', '绿发', 'green hair'] },
    { c: '#cdd4e4', s: '#98a2ba', k: ['灰毛', '灰发', '银灰', 'grey hair', 'gray hair'] }
  ];

  var EYE_COLORS = [
    { c: '#ff5e6c', k: ['红瞳', '红眼', '血瞳', 'red eye', 'red eyes'] },
    { c: '#ffc24a', k: ['金瞳', '黄瞳', '琥珀瞳', 'gold eye', 'gold eyes'] },
    { c: '#b48bff', k: ['紫瞳', '紫眼', 'violet eye'] },
    { c: '#4fd88a', k: ['绿瞳', '绿眼', 'green eye'] },
    { c: '#5aa9ff', k: ['蓝瞳', '蓝眼', 'blue eye'] }
  ];

  var DRESS_COLORS = [
    { c: '#2b3f6e', s: '#1b2a4d', k: ['校服', '水手服', '制服', 'jk', 'school uniform'] },
    { c: '#3a3550', s: '#232034', k: ['女仆', 'maid'] },
    { c: '#e2607a', s: '#a83a55', k: ['和服', '浴衣', '汉服', 'kimono'] },
    { c: '#f2f4ff', s: '#c9d3f2', k: ['婚纱', '白裙', 'wedding'] },
    { c: '#3d4a63', s: '#232b3d', k: ['机甲', '战斗服', '战衣', 'armor'] },
    { c: '#a78bfa', s: '#7c5ce0', k: ['连衣裙', '裙子', '裙', 'dress'] }
  ];

  function matchColor(list, text) {
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].k.length; j++) {
        if (text.indexOf(list[i].k[j]) >= 0) return list[i];
      }
    }
    return null;
  }

  function hasAny(text, keys) {
    for (var i = 0; i < keys.length; i++) if (text.indexOf(keys[i]) >= 0) return true;
    return false;
  }

  var BACKDROPS = [
    { id: 'sakura', bg1: '#2a1626', bg2: '#0d0613', k: ['樱花', '花瓣', 'sakura'] },
    { id: 'night', bg1: '#0b1330', bg2: '#02040c', k: ['星空', '夜空', '星', '夜', 'night', 'star'] },
    { id: 'city', bg1: '#160b2a', bg2: '#05010f', k: ['城市', '霓虹', '赛博', '街', 'city', 'neon', 'cyber'] },
    { id: 'room', bg1: '#2a1d18', bg2: '#0f0806', k: ['教室', '房间', '室内', '窗边', '窗', 'room', 'classroom'] },
    { id: 'sea', bg1: '#0a2233', bg2: '#020a12', k: ['海', '沙滩', '海边', 'sea', 'beach'] },
    { id: 'forest', bg1: '#0d2418', bg2: '#04100a', k: ['森林', '树下', '草地', '自然', 'forest'] }
  ];

  function compileCharacter(text, accent) {
    var hair = matchColor(HAIR_COLORS, text) || { c: '#f2f4ff', s: '#c6cff0' };
    var eye = matchColor(EYE_COLORS, text);
    var dress = matchColor(DRESS_COLORS, text) || { c: '#9d7bf7', s: '#7048d8' };
    var back = null;
    for (var i = 0; i < BACKDROPS.length && !back; i++) {
      if (hasAny(text, BACKDROPS[i].k)) back = BACKDROPS[i];
    }
    if (!back) back = { id: 'studio', bg1: '#1b1730', bg2: '#07050f' };
    var outfit = 'dress';
    if (hasAny(text, ['校服', '水手服', '制服', 'sailor', 'school uniform'])) outfit = 'sailor';
    else if (hasAny(text, ['女仆', 'maid'])) outfit = 'maid';
    else if (hasAny(text, ['和服', '浴衣', 'kimono', 'yukata'])) outfit = 'kimono';
    return {
      hair: hair.c, shade: hair.s,
      eye: eye ? eye.c : (accent || '#8ab4ff'),
      dress: dress.c, dressShade: dress.s,
      outfit: outfit,
      twin: hasAny(text, ['双马尾', '双尾', '双辫', 'twintail', 'twin tail', 'pigtail']),
      catEars: hasAny(text, ['猫耳', '猫娘', 'neko', 'catgirl']),
      ahoge: hasAny(text, ['呆毛', 'ahoge', '翘毛']),
      chibi: hasAny(text, ['萝莉', 'loli', '幼女', '小女孩', 'q版', 'chibi', '矮']),
      bow: hasAny(text, ['蝴蝶结', '发带', '发饰', '头饰', 'ribbon', 'bow']) || hasAny(text, ['萝莉', 'loli', '少女', 'girl']),
      shortHair: hasAny(text, ['短发', '短毛', 'short hair']),
      backdrop: back.id,
      bg1: back.bg1, bg2: back.bg2
    };
  }

  /* 主流视频模型风格预设：对齐其运动幅度/运镜习惯/色彩与颗粒特征 */
  var MODEL_PROFILES = [
    { id: 'seedance', name: 'Seedance 1.0', fps: 24, motion: 0.90, camera: 'dolly', grade: 'filmic', grain: 0.035 },
    { id: 'vidu', name: 'Vidu 2', fps: 24, motion: 0.70, camera: 'static', grade: 'clean', grain: 0 },
    { id: 'minimax-h3', name: 'MiniMax H3', fps: 30, motion: 1.00, camera: 'orbit', grade: 'neon', grain: 0.02 },
    { id: 'sora2', name: 'Sora 2', fps: 30, motion: 0.80, camera: 'pan', grade: 'cinema', grain: 0.05 },
    { id: 'wan', name: 'Wan 2.1', fps: 16, motion: 0.60, camera: 'dolly', grade: 'soft', grain: 0.01 }
  ];

  function modelProfile(id) {
    for (var i = 0; i < MODEL_PROFILES.length; i++) if (MODEL_PROFILES[i].id === id) return MODEL_PROFILES[i];
    return MODEL_PROFILES[0];
  }

  /* 文本语义解析：景别 / 运镜 / 动作 / 影调 */
  function detectShot(text) {
    if (hasAny(text, ['特写', '脸部', 'close-up', 'closeup'])) return 'close';
    if (hasAny(text, ['近景', '半身', 'medium shot'])) return 'medium';
    if (hasAny(text, ['远景', '大景', 'wide shot', 'long shot'])) return 'wide';
    if (hasAny(text, ['全景', '全身', 'full body'])) return 'full';
    return 'medium';
  }

  function detectCamera(text) {
    if (hasAny(text, ['推镜', '推进', '推近', 'zoom in', 'dolly in'])) return 'dolly';
    if (hasAny(text, ['拉镜', '拉远', 'zoom out', 'dolly out'])) return 'pull';
    if (hasAny(text, ['摇镜', '横移', '平移', ' pan', 'pan '])) return 'pan';
    if (hasAny(text, ['环绕', '旋转镜头', 'orbit'])) return 'orbit';
    if (hasAny(text, ['跟拍', '跟随', 'follow'])) return 'follow';
    if (hasAny(text, ['固定', '静止镜头', 'static'])) return 'static';
    return '';
  }

  function detectAction(text) {
    if (hasAny(text, ['挥手', '招手', 'wave'])) return 'wave';
    if (hasAny(text, ['奔跑', '冲刺', ' run', 'run '])) return 'run';
    if (hasAny(text, ['转身', '回头', 'turn'])) return 'turn';
    if (hasAny(text, ['漂浮', '悬浮', '飘浮', 'float'])) return 'float';
    if (hasAny(text, ['微笑', '笑容', 'smile'])) return 'smile';
    return 'idle';
  }

  function detectGrade(text, profile) {
    if (hasAny(text, ['电影感', '宽银幕', 'cinematic'])) return 'cinema';
    if (hasAny(text, ['赛璐璐', '动漫', '二次元', 'anime'])) return 'filmic';
    if (hasAny(text, ['霓虹', '赛博', 'neon', 'cyber'])) return 'neon';
    if (hasAny(text, ['柔和', '水彩', '柔光', 'soft'])) return 'soft';
    if (hasAny(text, ['通透', '写实', 'clean'])) return 'clean';
    return profile.grade;
  }

  function compilePrompt(prompt, opts) {
    var text = String(prompt || '').toLowerCase();
    var chosen = null;
    for (var i = 0; i < THEMES.length && !chosen; i++) {
      var t = THEMES[i];
      for (var k = 0; k < t.keys.length; k++) {
        if (text.indexOf(t.keys[k].toLowerCase()) >= 0) { chosen = t; break; }
      }
    }
    if (!chosen) chosen = THEMES[0];
    var style = opts && opts.style && opts.style !== 'auto' ? opts.style : chosen.style;
    var theme = themeForStyle(style);
    var profile = modelProfile(opts && opts.model);
    var seed = opts && opts.seed ? Number(opts.seed) : (hashStr(prompt) % 99991);
    var hash = hashStr(prompt + '#' + seed);
    var w = Number(opts && opts.w) || 960;
    var h = Number(opts && opts.h) || 540;
    var fps = Number(opts && opts.fps) || profile.fps;
    var frames = Math.min(MAX_FRAMES, Math.max(8, Number(opts && opts.frames) || 36));
    var motion = opts && opts.motion != null ? Number(opts.motion) : profile.motion;
    motion = Math.max(0, Math.min(1, motion));

    var camType = opts && opts.camera && opts.camera !== 'auto' ? opts.camera : (detectCamera(text) || profile.camera);
    var shot = detectShot(text);
    var action = detectAction(text);
    var grade = detectGrade(text, profile);
    var negative = String((opts && opts.negative) || '');

    var palette = theme.palette.slice();
    if (opts && opts.accent) palette[0] = opts.accent;
    var charSpec = null;
    if (style === 'character') {
      charSpec = compileCharacter(text, opts && opts.accent);
      palette = [charSpec.eye, charSpec.hair, charSpec.dress, '#ffffff'];
    }
    return {
      w: w, h: h,
      fps: fps,
      frames: frames,
      duration: Math.round(frames / fps * 10) / 10,
      seed: seed,
      style: style,
      model: profile.id,
      modelLabel: profile.name,
      motion: motion,
      camera: { type: camType, strength: motion },
      shot: shot,
      action: action,
      grade: grade,
      grain: profile.grain,
      negative: negative,
      bg1: charSpec ? charSpec.bg1 : theme.bg1,
      bg2: charSpec ? charSpec.bg2 : theme.bg2,
      palette: palette,
      char: charSpec,
      count: 70 + (hash % 130),
      speed: 0.55 + (hash % 60) / 100,
      cols: 12 + (hash % 7),
      rows: 7 + (hash % 4),
      prompt: String(prompt || '')
    };
  }

  /* ---------------- 精致二维赛璐璐角色（线稿 / 底色 / 阴影 / 高光 分层合成） ---------------- */
  function drawCelCharacter(ctx, spec, t) {
    var w = spec.w, h = spec.h;
    var ch = spec.char || {};
    var seed = spec.seed || 1;
    var motion = spec.motion == null ? 0.7 : Math.max(0, Math.min(1, spec.motion));
    var act = spec.action || 'idle';
    var outfit = ch.outfit || 'dress';
    var chibi = !!ch.chibi;

    function rgbOf(hex) {
      var str = String(hex || '#ffffff');
      var mm = str.match(/rgba?\(([^)]+)\)/);
      if (mm) {
        var pp = mm[1].split(',');
        return [parseInt(pp[0], 10) || 0, parseInt(pp[1], 10) || 0, parseInt(pp[2], 10) || 0];
      }
      var s = str.replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
    }
    function mix(a, b, k) {
      var A = rgbOf(a), B = rgbOf(b);
      return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * k) + ',' + Math.round(A[1] + (B[1] - A[1]) * k) + ',' + Math.round(A[2] + (B[2] - A[2]) * k) + ')';
    }
    function al(a, k) { var c = rgbOf(a); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + k + ')'; }
    function rnd(i) { var x = Math.sin(seed * 9283.17 + i * 269.31) * 43758.5453; return x - Math.floor(x); }

    var H = ch.hair || '#f7f9ff';
    var HS = ch.shade || mix(H, '#7c89bd', 0.46);
    var HL = mix(H, '#b6c8f2', 0.40);
    var EYE = ch.eye || '#7fb0ff';
    var LINE = '#3a2b4d';
    var HLN = mix(H, '#2a1d3c', 0.88);
    var SKIN = '#ffe9de', SKINS = '#f8cab8', SKIND = '#eab0a1', SLN = '#cb8e83';
    var cloth = ch.dress || '#ab8df2';
    var clothS = ch.dressShade || mix(cloth, '#553c8f', 0.55);
    var blouse = outfit === 'sailor' || outfit === 'maid' ? '#fdfdff' : cloth;
    var blouseS = outfit === 'sailor' || outfit === 'maid' ? '#dadef3' : clothS;
    var skirt = outfit === 'sailor' ? '#303a63' : outfit === 'maid' ? '#2a2234' : cloth;
    var skirtS = outfit === 'sailor' ? '#1d2443' : outfit === 'maid' ? '#1a1424' : clothS;
    var accent = mix(EYE, '#ff5c86', 0.55);

    var cs = Math.min(w, h);
    var R = cs * (chibi ? 0.205 : 0.185);
    var cx = w * 0.5;
    var bob = Math.sin(t * 6.2832) * R * 0.028 * (act === 'float' ? 2.4 : 1) * (0.6 + motion);
    var cy = h * (chibi ? 0.415 : 0.40) + bob;
    var LW = Math.max(1.3, R * 0.023);
    var sway = Math.sin(t * 6.2832) * 0.045 * (0.5 + motion);
    var ph = ((t + rnd(7)) % 1);
    var blink = ph > 0.905 && ph < 0.945;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function pathStroke(width, color, alpha) {
      ctx.strokeStyle = color || LINE;
      ctx.lineWidth = width || LW;
      if (alpha != null) ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function lock(x0, y0, c1x, c1y, c2x, c2y, px, py, wid) {
      var dx = px - x0, dy = py - y0;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(x0 + nx * wid, y0 + ny * wid);
      ctx.quadraticCurveTo(c1x + nx * wid * 0.62, c1y + ny * wid * 0.62, px, py);
      ctx.quadraticCurveTo(c2x - nx * wid * 0.62, c2y - ny * wid * 0.62, x0 - nx * wid, y0 - ny * wid);
      ctx.closePath();
    }

    /* ============ 背景（分层赛璐璐绘景） ============ */
    (function () {
      var kind = ch.backdrop || 'studio';
      var i, g;
      if (kind === 'sakura') {
        // 平涂天空：三层硬边色块，不做渐变
        ctx.fillStyle = '#ffe6ef';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#a6d4ff';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 0.30);
        ctx.fillStyle = '#fff8f2';
        ctx.fillRect(-w * 0.3, h * 0.62, w * 1.6, h * 1.2);
        for (i = 0; i < 5; i++) {
          ctx.fillStyle = al('#ffd8e6', 0.55);
          ctx.beginPath();
          ctx.ellipse(w * (0.08 + rnd(i + 11) * 0.84), h * (0.10 + rnd(i + 12) * 0.20), w * 0.16, h * 0.10, 0, 0, 6.2832);
          ctx.fill();
        }
        for (i = 0; i < 7; i++) {
          ctx.fillStyle = al('#f6b9d4', 0.42);
          ctx.beginPath();
          ctx.ellipse(-w * 0.05 + rnd(i + 21) * w * 0.28, h * (0.30 + rnd(i + 22) * 0.30), w * 0.13, h * 0.13, 0, 0, 6.2832);
          ctx.fill();
        }
        for (i = 0; i < 14; i++) {
          var bx = rnd(i + 31) * w, by = rnd(i + 32) * h * 0.7;
          ctx.fillStyle = al('#ffffff', 0.10 + rnd(i + 33) * 0.16);
          ctx.beginPath(); ctx.arc(bx, by, 14 + rnd(i + 34) * 40, 0, 6.2832); ctx.fill();
        }
        for (i = 0; i < 16; i++) {
          var px = ((rnd(i + 41) + t * (0.5 + rnd(i + 42) * 0.5)) % 1.1) * w;
          var py = ((rnd(i + 43) + t * 0.35) % 1.1) * h * 1.1 - h * 0.05;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(t * 3 + i);
          ctx.fillStyle = al(i % 3 ? '#ffc2d9' : '#ffd9e7', 0.92);
          ctx.beginPath(); ctx.ellipse(0, 0, R * 0.12, R * 0.06, 0, 0, 6.2832); ctx.fill();
          ctx.restore();
        }
      } else if (kind === 'night') {
        ctx.fillStyle = '#101a42';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#25245a';
        ctx.fillRect(-w * 0.3, h * 0.44, w * 1.6, h * 0.30);
        ctx.fillStyle = '#3a2c58';
        ctx.fillRect(-w * 0.3, h * 0.74, w * 1.6, h * 0.8);
        for (i = 0; i < 70; i++) {
          var sx = rnd(i + 51) * w, sy = rnd(i + 52) * h * 0.75;
          ctx.fillStyle = al(i % 5 ? '#dbe7ff' : '#ffe9b8', 0.3 + 0.6 * Math.abs(Math.sin(t * 6.2832 + i)));
          ctx.beginPath(); ctx.arc(sx, sy, 0.8 + rnd(i + 53) * 1.8, 0, 6.2832); ctx.fill();
        }
        var mx = w * 0.76, my = h * 0.24, mr = h * 0.085;
        // 月亮光晕改为同心平涂圆环
        ctx.fillStyle = 'rgba(255,244,214,0.14)';
        ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,244,214,0.20)';
        ctx.beginPath(); ctx.arc(mx, my, mr * 1.9, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#fff6dc';
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
        ctx.fillStyle = al('#e8d9a8', 0.5);
        ctx.beginPath(); ctx.arc(mx + mr * 0.25, my - mr * 0.15, mr * 0.24, 0, 6.2832); ctx.fill();
        for (i = 0; i < 9; i++) {
          var bw = w * 0.12, bh = h * (0.10 + rnd(i + 61) * 0.22);
          var bxx = i * w * 0.12 - w * 0.03;
          ctx.fillStyle = al('#141a38', 0.9);
          ctx.fillRect(bxx, h * 0.72 - bh, bw, bh + h * 0.3);
          ctx.fillStyle = al(i % 2 ? '#ffd479' : '#8fe4ff', 0.7);
          for (var k = 0; k < 3; k++) ctx.fillRect(bxx + 6 + k * 9, h * 0.72 - bh + 8 + (i % 2) * 10, 4, 5);
        }
      } else if (kind === 'city') {
        ctx.fillStyle = '#2a1745';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#6d2a63';
        ctx.fillRect(-w * 0.3, h * 0.34, w * 1.6, h * 0.30);
        ctx.fillStyle = '#1a0e2c';
        ctx.fillRect(-w * 0.3, h * 0.62, w * 1.6, h * 0.9);
        for (i = 0; i < 12; i++) {
          var nw = w * (0.06 + rnd(i + 71) * 0.08), nh = h * (0.18 + rnd(i + 72) * 0.30);
          var nx2 = i * w * 0.085 - w * 0.02;
          ctx.fillStyle = al('#171029', 0.92);
          ctx.fillRect(nx2, h * 0.80 - nh, nw, nh + h * 0.3);
          ctx.fillStyle = al(i % 3 ? '#ff5fb0' : '#44e0ff', 0.55 + 0.35 * Math.abs(Math.sin(t * 6.2832 + i)));
          ctx.fillRect(nx2 + 5, h * 0.80 - nh + 6, nw * 0.5, 4);
        }
        for (i = 0; i < 10; i++) {
          ctx.fillStyle = al(i % 2 ? '#ff7fc8' : '#63e6ff', 0.10 + rnd(i + 81) * 0.10);
          ctx.beginPath(); ctx.arc(rnd(i + 82) * w, rnd(i + 83) * h, 18 + rnd(i + 84) * 46, 0, 6.2832); ctx.fill();
        }
      } else if (kind === 'room') {
        ctx.fillStyle = '#fff5e2';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#f4dcc0';
        ctx.fillRect(-w * 0.3, h * 0.50, w * 1.6, h * 0.2);
        ctx.fillStyle = '#e8c8a8';
        ctx.fillRect(-w * 0.3, h * 0.62, w * 1.6, h * 0.9);
        ctx.fillStyle = al('#bfe6ff', 0.85);
        ctx.fillRect(w * 0.58, h * 0.10, w * 0.30, h * 0.40);
        ctx.strokeStyle = al('#fff8e6', 0.9);
        ctx.lineWidth = Math.max(3, R * 0.05);
        ctx.strokeRect(w * 0.58, h * 0.10, w * 0.30, h * 0.40);
        ctx.beginPath();
        ctx.moveTo(w * 0.73, h * 0.10); ctx.lineTo(w * 0.73, h * 0.50);
        ctx.moveTo(w * 0.58, h * 0.30); ctx.lineTo(w * 0.88, h * 0.30);
        ctx.stroke();
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#fff3cf';
        ctx.beginPath();
        ctx.moveTo(w * 0.58, h * 0.12);
        ctx.lineTo(w * 0.30, h * 1.0);
        ctx.lineTo(w * 0.62, h * 1.0);
        ctx.lineTo(w * 0.78, h * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = al('#e0b98e', 0.7);
        ctx.fillRect(w * 0.62, h * 0.62, w * 0.30, h * 0.02);
      } else if (kind === 'sea') {
        ctx.fillStyle = '#bfe9ff';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#f7fcff';
        ctx.fillRect(-w * 0.3, h * 0.44, w * 1.6, h * 0.08);
        ctx.fillStyle = '#74cbe3';
        ctx.fillRect(-w * 0.3, h * 0.52, w * 1.6, h * 0.24);
        ctx.fillStyle = '#2f8eb8';
        ctx.fillRect(-w * 0.3, h * 0.76, w * 1.6, h * 0.9);
        for (i = 0; i < 12; i++) {
          ctx.fillStyle = al('#ffffff', 0.9);
          ctx.beginPath();
          ctx.ellipse(w * (0.15 + rnd(i + 91) * 0.7), h * (0.10 + rnd(i + 92) * 0.16), w * 0.06, h * 0.022, 0, 0, 6.2832);
          ctx.fill();
        }
        for (i = 0; i < 6; i++) {
          ctx.strokeStyle = al('#eafdff', 0.55);
          ctx.lineWidth = Math.max(2, R * 0.03);
          ctx.beginPath();
          for (var xx = -w * 0.2; xx <= w * 1.2; xx += 12) {
            var yy = h * (0.60 + i * 0.055) + Math.sin(xx / w * 9 + t * 6.2832 + i) * h * 0.008;
            if (xx <= -w * 0.19) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
      } else if (kind === 'forest') {
        ctx.fillStyle = '#e9f7dd';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#cfe9c0';
        ctx.fillRect(-w * 0.3, h * 0.55, w * 1.6, h * 0.2);
        ctx.fillStyle = '#a9cf9c';
        ctx.fillRect(-w * 0.3, h * 0.75, w * 1.6, h * 0.9);
        for (i = 0; i < 8; i++) {
          var tx = i * w * 0.14 - w * 0.05 + rnd(i + 101) * 20;
          ctx.fillStyle = al('#2f5b3c', 0.55);
          ctx.fillRect(tx, -h * 0.1, w * 0.035, h * 1.1);
        }
        for (i = 0; i < 9; i++) {
          ctx.fillStyle = al(i % 2 ? '#7fc08a' : '#a8d8a0', 0.30);
          ctx.beginPath(); ctx.arc(rnd(i + 111) * w, rnd(i + 112) * h * 0.9, 26 + rnd(i + 113) * 54, 0, 6.2832); ctx.fill();
        }
        ctx.save();
        ctx.globalAlpha = 0.20;
        ctx.fillStyle = '#fff7cf';
        for (i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(w * (0.10 + i * 0.25), -h * 0.05);
          ctx.lineTo(w * (0.02 + i * 0.25), h);
          ctx.lineTo(w * (0.16 + i * 0.25), h);
          ctx.lineTo(w * (0.24 + i * 0.25), -h * 0.05);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      } else {
        // 棚拍背景：同心平涂圆，无渐变
        ctx.fillStyle = '#b9a9e0';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
        ctx.fillStyle = '#d6c8f2';
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.34, Math.max(w, h) * 0.62, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#e8ddff';
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.34, Math.max(w, h) * 0.44, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#ffeaf4';
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.34, Math.max(w, h) * 0.26, 0, 6.2832); ctx.fill();
        for (i = 0; i < 12; i++) {
          ctx.fillStyle = al(i % 2 ? '#ffffff' : '#ffc7e0', 0.12 + rnd(i + 121) * 0.14);
          ctx.beginPath();
          ctx.arc(rnd(i + 122) * w, rnd(i + 123) * h, 20 + rnd(i + 124) * 56, 0, 6.2832);
          ctx.fill();
        }
      }
    })();

    /* ============ 后发 ============ */
    function backHairPath() {
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.12, cy - R * 0.12);
      ctx.bezierCurveTo(cx - R * 1.36, cy - R * 1.06, cx - R * 0.58, cy - R * 1.46, cx, cy - R * 1.44);
      ctx.bezierCurveTo(cx + R * 0.58, cy - R * 1.46, cx + R * 1.36, cy - R * 1.06, cx + R * 1.12, cy - R * 0.12);
      var deep = ch.shortHair ? cy + R * 1.05 : cy + R * 1.95;
      ctx.bezierCurveTo(cx + R * 1.26, cy + R * 0.55, cx + R * 1.20, cy + R * 1.30, cx + R * 1.28, deep);
      ctx.quadraticCurveTo(cx + R * 0.98, deep - R * 0.26, cx + R * 0.76, deep + R * 0.05);
      ctx.quadraticCurveTo(cx + R * 0.56, deep - R * 0.34, cx + R * 0.38, deep - R * 0.02);
      ctx.quadraticCurveTo(cx + R * 0.16, deep - R * 0.30, cx, deep - R * 0.10);
      ctx.quadraticCurveTo(cx - R * 0.16, deep - R * 0.30, cx - R * 0.38, deep - R * 0.02);
      ctx.quadraticCurveTo(cx - R * 0.56, deep - R * 0.34, cx - R * 0.76, deep + R * 0.05);
      ctx.quadraticCurveTo(cx - R * 0.98, deep - R * 0.26, cx - R * 1.28, deep);
      ctx.bezierCurveTo(cx - R * 1.20, cy + R * 1.30, cx - R * 1.26, cy + R * 0.55, cx - R * 1.12, cy - R * 0.12);
      ctx.closePath();
    }
    ctx.save();
    backHairPath();
    ctx.fillStyle = H;
    ctx.fill();
    ctx.save();
    backHairPath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.62, cy + R * 0.92, R * 1.05, R * 1.00, 0, 0, 6.2832);
    ctx.fillStyle = HS;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.85, cy + R * 0.30, R * 0.26, R * 0.80, 0, 0, 6.2832);
    ctx.fillStyle = al(HS, 0.65);
    ctx.fill();
    ctx.restore();
    pathStroke(LW * 1.15, HLN);
    ctx.restore();

    // 双马尾（后层）
    if (ch.twin) {
      for (var sd = -1; sd <= 1; sd += 2) {
        ctx.save();
        ctx.translate(cx + sd * R * 1.26, cy - R * 0.18);
        ctx.rotate(sd * sway * 1.6);
        ctx.beginPath();
        ctx.moveTo(sd * R * 0.16, 0);
        ctx.bezierCurveTo(sd * R * 0.92, R * 0.55, sd * R * 0.82, R * 1.55, sd * R * 0.52, R * 2.02);
        ctx.quadraticCurveTo(sd * R * 0.30, R * 1.60, sd * R * 0.18, R * 1.16);
        ctx.closePath();
        ctx.fillStyle = H;
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sd * R * 0.16, 0);
        ctx.bezierCurveTo(sd * R * 0.92, R * 0.55, sd * R * 0.82, R * 1.55, sd * R * 0.52, R * 2.02);
        ctx.quadraticCurveTo(sd * R * 0.30, R * 1.60, sd * R * 0.18, R * 1.16);
        ctx.closePath();
        ctx.clip();
        ctx.beginPath();
        ctx.ellipse(sd * R * 0.74, R * 1.10, R * 0.42, R * 1.05, 0, 0, 6.2832);
        ctx.fillStyle = HS;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(sd * R * 0.16, 0);
        ctx.bezierCurveTo(sd * R * 0.92, R * 0.55, sd * R * 0.82, R * 1.55, sd * R * 0.52, R * 2.02);
        ctx.quadraticCurveTo(sd * R * 0.30, R * 1.60, sd * R * 0.18, R * 1.16);
        ctx.closePath();
        pathStroke(LW * 1.1, HLN);
        ctx.strokeStyle = al(HLN, 0.5);
        ctx.lineWidth = LW * 0.55;
        ctx.beginPath();
        ctx.moveTo(sd * R * 0.34, R * 0.20);
        ctx.quadraticCurveTo(sd * R * 0.72, R * 1.05, sd * R * 0.56, R * 1.85);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.ellipse(0, R * 0.10, R * 0.24, R * 0.12, sd * 0.3, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = LINE;
        ctx.lineWidth = LW * 0.8;
        ctx.stroke();
        ctx.restore();
      }
    }

    /* ============ 颈与身体 ============ */
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.31, cy + R * 0.80);
    ctx.lineTo(cx - R * 0.37, cy + R * 1.42);
    ctx.lineTo(cx + R * 0.37, cy + R * 1.42);
    ctx.lineTo(cx + R * 0.31, cy + R * 0.80);
    ctx.closePath();
    ctx.fillStyle = SKIN;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.84, R * 0.38, R * 0.115, 0, 0, 6.2832);
    ctx.fillStyle = al(SKINS, 0.95);
    ctx.fill();
    ctx.restore();
    pathStroke(LW * 0.8, SLN);

    // 胸口肤色（V 领内）
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.30, cy + R * 1.10);
    ctx.lineTo(cx - R * 0.42, cy + R * 1.86);
    ctx.lineTo(cx + R * 0.42, cy + R * 1.86);
    ctx.lineTo(cx + R * 0.30, cy + R * 1.10);
    ctx.closePath();
    ctx.fillStyle = SKIN;
    ctx.fill();

    // 手臂（先画，躯干压住肩部）
    function arm(side2, wave) {
      ctx.save();
      ctx.translate(cx + side2 * R * 1.12, cy + R * 1.56);
      ctx.rotate(wave ? side2 * -2.30 + Math.sin(t * 12.566) * 0.14 : side2 * 0.13);
      var L = R * 1.16, aw = R * 0.175;
      ctx.beginPath();
      ctx.moveTo(-aw, 0);
      ctx.quadraticCurveTo(-aw * 1.22, L * 0.55, -aw * 0.86, L);
      ctx.quadraticCurveTo(0, L + aw * 0.24, aw * 0.86, L);
      ctx.quadraticCurveTo(aw * 1.22, L * 0.55, aw, 0);
      ctx.closePath();
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = SKINS;
      ctx.beginPath();
      ctx.ellipse(aw * 0.95, L * 0.62, aw * 0.9, L * 0.55, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = SLN;
      ctx.lineWidth = LW * 0.75;
      ctx.stroke();
      // 手
      ctx.beginPath();
      ctx.ellipse(0, L + aw * 0.20, aw * 0.94, aw * 0.84, 0, 0, 6.2832);
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.strokeStyle = SLN;
      ctx.lineWidth = LW * 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-aw * 0.50, L + aw * 0.02);
      ctx.quadraticCurveTo(-aw * 0.30, L + aw * 0.30, -aw * 0.02, L + aw * 0.22);
      ctx.stroke();
      // 袖口
      ctx.beginPath();
      ctx.moveTo(-aw * 1.30, -R * 0.02);
      ctx.quadraticCurveTo(0, R * 0.24, aw * 1.30, -R * 0.02);
      ctx.lineTo(aw * 1.10, -R * 0.30);
      ctx.quadraticCurveTo(0, -R * 0.08, -aw * 1.10, -R * 0.30);
      ctx.closePath();
      ctx.fillStyle = outfit === 'sailor' || outfit === 'maid' ? blouse : cloth;
      ctx.fill();
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 0.9;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = outfit === 'sailor' || outfit === 'maid' ? blouseS : clothS;
      ctx.beginPath();
      ctx.ellipse(aw * 0.9, R * 0.06, aw * 1.0, R * 0.16, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
    arm(-1, false);
    arm(1, act === 'wave');

    // 躯干
    function torsoPath() {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.22, cy + R * 1.10);
      ctx.quadraticCurveTo(cx - R * 0.94, cy + R * 1.14, cx - R * 1.16, cy + R * 1.58);
      ctx.quadraticCurveTo(cx - R * 1.28, cy + R * 1.96, cx - R * 1.12, cy + R * 2.56);
      ctx.lineTo(cx + R * 1.12, cy + R * 2.56);
      ctx.quadraticCurveTo(cx + R * 1.28, cy + R * 1.96, cx + R * 1.16, cy + R * 1.58);
      ctx.quadraticCurveTo(cx + R * 0.94, cy + R * 1.14, cx + R * 0.22, cy + R * 1.10);
      ctx.lineTo(cx + R * 0.20, cy + R * 1.42);
      ctx.lineTo(cx, cy + R * 1.72);
      ctx.lineTo(cx - R * 0.20, cy + R * 1.42);
      ctx.closePath();
    }
    torsoPath();
    ctx.fillStyle = blouse;
    ctx.fill();
    ctx.save();
    torsoPath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx + R * 1.42, cy + R * 1.98, R * 0.58, R * 1.02, 0, 0, 6.2832);
    ctx.fillStyle = blouseS;
    ctx.fill();
    ctx.restore();
    torsoPath();
    pathStroke(LW * 1.05, LINE);

    if (outfit === 'sailor' || outfit === 'maid') {
      // 水手领
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.24, cy + R * 1.08);
      ctx.lineTo(cx - R * 1.02, cy + R * 1.26);
      ctx.lineTo(cx - R * 0.98, cy + R * 1.66);
      ctx.lineTo(cx - R * 0.20, cy + R * 1.44);
      ctx.closePath();
      ctx.fillStyle = '#2f3a63';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + R * 0.24, cy + R * 1.08);
      ctx.lineTo(cx + R * 1.02, cy + R * 1.26);
      ctx.lineTo(cx + R * 0.98, cy + R * 1.66);
      ctx.lineTo(cx + R * 0.20, cy + R * 1.44);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 0.9;
      ctx.stroke();
      ctx.strokeStyle = al('#ffffff', 0.9);
      ctx.lineWidth = LW * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.30, cy + R * 1.20); ctx.lineTo(cx - R * 0.92, cy + R * 1.30);
      ctx.moveTo(cx + R * 0.30, cy + R * 1.20); ctx.lineTo(cx + R * 0.92, cy + R * 1.30);
      ctx.moveTo(cx - R * 0.32, cy + R * 1.30); ctx.lineTo(cx - R * 0.94, cy + R * 1.40);
      ctx.moveTo(cx + R * 0.32, cy + R * 1.30); ctx.lineTo(cx + R * 0.94, cy + R * 1.40);
      ctx.stroke();
      // 领结
      ctx.beginPath();
      ctx.moveTo(cx, cy + R * 1.62);
      ctx.lineTo(cx - R * 0.24, cy + R * 1.50);
      ctx.lineTo(cx - R * 0.24, cy + R * 1.78);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy + R * 1.62);
      ctx.lineTo(cx + R * 0.24, cy + R * 1.50);
      ctx.lineTo(cx + R * 0.24, cy + R * 1.78);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + R * 1.63, R * 0.075, 0, 6.2832);
      ctx.fillStyle = mix(accent, '#ffffff', 0.3);
      ctx.fill();
      ctx.stroke();
    } else if (outfit === 'kimono') {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.22, cy + R * 1.10);
      ctx.lineTo(cx + R * 0.30, cy + R * 1.94);
      ctx.lineTo(cx + R * 0.44, cy + R * 1.86);
      ctx.lineTo(cx - R * 0.06, cy + R * 1.06);
      ctx.closePath();
      ctx.fillStyle = mix(cloth, '#ffffff', 0.35);
      ctx.fill();
      pathStroke(LW * 0.85, LINE);
      ctx.beginPath();
      ctx.moveTo(cx + R * 0.22, cy + R * 1.10);
      ctx.lineTo(cx - R * 0.30, cy + R * 1.94);
      ctx.lineTo(cx - R * 0.44, cy + R * 1.86);
      ctx.lineTo(cx + R * 0.06, cy + R * 1.06);
      ctx.closePath();
      ctx.fillStyle = mix(cloth, '#ffffff', 0.55);
      ctx.fill();
      pathStroke(LW * 0.85, LINE);
      // 腰带
      ctx.fillStyle = accent;
      ctx.fillRect(cx - R * 1.10, cy + R * 2.28, R * 2.20, R * 0.30);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 0.8;
      ctx.strokeRect(cx - R * 1.10, cy + R * 2.28, R * 2.20, R * 0.30);
    } else {
      // 连衣裙胸线
      ctx.strokeStyle = al(clothS, 0.8);
      ctx.lineWidth = LW * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.90, cy + R * 1.72);
      ctx.quadraticCurveTo(cx, cy + R * 1.96, cx + R * 0.90, cy + R * 1.72);
      ctx.stroke();
      if (outfit === 'maid') {
        ctx.fillStyle = '#fbfbff';
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.66, cy + R * 1.74);
        ctx.quadraticCurveTo(cx, cy + R * 1.92, cx + R * 0.66, cy + R * 1.74);
        ctx.lineTo(cx + R * 0.52, cy + R * 2.56);
        ctx.lineTo(cx - R * 0.52, cy + R * 2.56);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = LINE;
        ctx.lineWidth = LW * 0.8;
        ctx.stroke();
      }
    }

    // 裙子
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.06, cy + R * 2.52);
    ctx.lineTo(cx + R * 1.06, cy + R * 2.52);
    ctx.quadraticCurveTo(cx + R * 1.30, cy + R * 3.10, cx + R * 1.44, cy + R * 3.70);
    ctx.lineTo(cx - R * 1.44, cy + R * 3.70);
    ctx.quadraticCurveTo(cx - R * 1.30, cy + R * 3.10, cx - R * 1.06, cy + R * 2.52);
    ctx.closePath();
    ctx.fillStyle = skirt;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx + R * 1.18, cy + R * 3.20, R * 0.70, R * 1.20, 0, 0, 6.2832);
    ctx.fillStyle = skirtS;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = LW;
    ctx.stroke();
    // 裙褶
    ctx.strokeStyle = al(skirtS, 0.95);
    ctx.lineWidth = LW * 0.7;
    for (var pl = -2; pl <= 2; pl++) {
      ctx.beginPath();
      ctx.moveTo(cx + pl * R * 0.42, cy + R * 2.54);
      ctx.lineTo(cx + pl * R * 0.58, cy + R * 3.68);
      ctx.stroke();
    }

    /* ============ 头部 ============ */
    function facePath() {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.86, cy - R * 0.55);
      ctx.bezierCurveTo(cx - R * 0.94, cy + R * 0.12, cx - R * 0.76, cy + R * 0.62, cx - R * 0.34, cy + R * 0.90);
      ctx.quadraticCurveTo(cx, cy + R * 1.04, cx + R * 0.34, cy + R * 0.90);
      ctx.bezierCurveTo(cx + R * 0.76, cy + R * 0.62, cx + R * 0.94, cy + R * 0.12, cx + R * 0.86, cy - R * 0.55);
      ctx.quadraticCurveTo(cx, cy - R * 0.98, cx - R * 0.86, cy - R * 0.55);
      ctx.closePath();
    }
    // 耳朵
    for (var er = -1; ch.shortHair && er <= 1; er += 2) {
      ctx.beginPath();
      ctx.ellipse(cx + er * R * 0.80, cy - R * 0.02, R * 0.075, R * 0.115, er * 0.16, 0, 6.2832);
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.strokeStyle = SLN;
      ctx.lineWidth = LW * 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + er * R * 0.80, cy - R * 0.02, R * 0.04, -0.8, 1.4);
      ctx.strokeStyle = al(SKIND, 0.9);
      ctx.lineWidth = LW * 0.5;
      ctx.stroke();
    }
    facePath();
    ctx.fillStyle = SKIN;
    ctx.fill();
    ctx.save();
    facePath();
    ctx.clip();
    // 侧脸阴影（硬边）
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.88, cy + R * 0.10, R * 0.52, R * 1.02, 0, 0, 6.2832);
    ctx.fillStyle = SKINS;
    ctx.fill();
    // 刘海投影
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.92, cy - R * 0.34);
    ctx.quadraticCurveTo(cx - R * 0.40, cy - R * 0.06, cx - R * 0.04, cy - R * 0.20);
    ctx.quadraticCurveTo(cx + R * 0.40, cy - R * 0.05, cx + R * 0.92, cy - R * 0.36);
    ctx.lineTo(cx + R * 0.92, cy - R * 0.80);
    ctx.lineTo(cx - R * 0.92, cy - R * 0.80);
    ctx.closePath();
    ctx.fillStyle = al(SKINS, 0.95);
    ctx.fill();
    // 下颌阴影
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 1.02, R * 0.42, R * 0.20, 0, 0, 6.2832);
    ctx.fillStyle = al(SKIND, 0.55);
    ctx.fill();
    ctx.restore();
    facePath();
    pathStroke(LW * 0.95, SLN);

    // 腮红
    for (var bl = -1; bl <= 1; bl += 2) {
      ctx.beginPath();
      ctx.ellipse(cx + bl * R * 0.58, cy + R * 0.52, R * 0.20, R * 0.10, 0, 0, 6.2832);
      ctx.fillStyle = al('#ff9fb4', 0.30);
      ctx.fill();
      ctx.strokeStyle = al('#ff7d96', 0.45);
      ctx.lineWidth = LW * 0.5;
      for (var bh = 0; bh < 3; bh++) {
        ctx.beginPath();
        ctx.moveTo(cx + bl * R * (0.50 + bh * 0.07), cy + R * 0.48);
        ctx.lineTo(cx + bl * R * (0.46 + bh * 0.07), cy + R * 0.58);
        ctx.stroke();
      }
    }

    // 眼睛
    var eW = R * 0.293, eH = R * 0.320, eyeDX = R * 0.385, eyeY = cy + R * 0.215;
    function drawEye(side) {
      var ex = cx + side * eyeDX;
      ctx.save();
      ctx.translate(ex, eyeY);
      ctx.scale(side, 1);
      if (blink) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = LW * 2.1;
        ctx.beginPath();
        ctx.moveTo(-eW * 0.95, eH * 0.02);
        ctx.quadraticCurveTo(0, eH * 0.52, eW * 0.94, -eH * 0.04);
        ctx.stroke();
        ctx.lineWidth = LW * 0.7;
        ctx.beginPath();
        ctx.moveTo(eW * 0.62, eH * 0.22);
        ctx.quadraticCurveTo(eW * 0.86, eH * 0.16, eW * 1.02, -eH * 0.02);
        ctx.stroke();
        ctx.restore();
        return;
      }
      // 眼白
      ctx.beginPath();
      ctx.moveTo(-eW, eH * 0.10);
      ctx.quadraticCurveTo(-eW * 0.86, -eH * 0.58, -eW * 0.16, -eH * 0.86);
      ctx.quadraticCurveTo(eW * 0.54, -eH * 1.04, eW * 0.96, -eH * 0.26);
      ctx.quadraticCurveTo(eW * 1.02, eH * 0.24, eW * 0.58, eH * 0.66);
      ctx.quadraticCurveTo(eW * 0.08, eH * 0.96, -eW * 0.52, eH * 0.60);
      ctx.quadraticCurveTo(-eW * 1.0, eH * 0.40, -eW, eH * 0.10);
      ctx.closePath();
      var wg = ctx.createLinearGradient(0, -eH, 0, eH);
      wg.addColorStop(0, mix(EYE, '#8c7fb8', 0.55));
      wg.addColorStop(0.42, '#ffffff');
      wg.addColorStop(1, '#ffffff');
      ctx.fillStyle = wg;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // 虹膜
      var ix = eW * 0.02, iy = eH * 0.06, irx = eW * 0.70, iry = eH * 0.80;
      var ig = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
      ig.addColorStop(0, mix(EYE, '#171128', 0.66));
      ig.addColorStop(0.40, EYE);
      ig.addColorStop(0.80, mix(EYE, '#ffffff', 0.42));
      ig.addColorStop(1, mix(EYE, '#ffffff', 0.78));
      ctx.beginPath();
      ctx.ellipse(ix, iy, irx, iry, 0, 0, 6.2832);
      ctx.fillStyle = ig;
      ctx.fill();
      // 瞳孔
      ctx.beginPath();
      ctx.ellipse(ix, iy - iry * 0.04, irx * 0.40, iry * 0.50, 0, 0, 6.2832);
      ctx.fillStyle = mix(EYE, '#140e22', 0.86);
      ctx.fill();
      // 下部反光
      ctx.beginPath();
      ctx.ellipse(ix, iy + iry * 0.46, irx * 0.54, iry * 0.18, 0, 0, 6.2832);
      ctx.fillStyle = al(mix(EYE, '#ffffff', 0.92), 0.9);
      ctx.fill();
      // 上部阴影
      ctx.beginPath();
      ctx.ellipse(ix, iy - iry * 0.72, irx * 0.92, iry * 0.30, 0, 0, 6.2832);
      ctx.fillStyle = al(mix(EYE, '#140e22', 0.75), 0.45);
      ctx.fill();
      // 高光
      ctx.beginPath();
      ctx.arc(ix - irx * 0.34, iy - iry * 0.42, irx * 0.28, 0, 6.2832);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ix + irx * 0.30, iy + iry * 0.34, irx * 0.13, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.restore();
      // 虹膜轮廓
      ctx.beginPath();
      ctx.ellipse(ix, iy, irx, iry, 0, 0, 6.2832);
      ctx.strokeStyle = al(LINE, 0.85);
      ctx.lineWidth = LW * 0.8;
      ctx.stroke();
      // 上眼睑（粗眼线）
      ctx.beginPath();
      ctx.moveTo(-eW * 1.0, eH * 0.04);
      ctx.quadraticCurveTo(-eW * 0.84, -eH * 0.62, -eW * 0.12, -eH * 0.88);
      ctx.quadraticCurveTo(eW * 0.56, -eH * 1.03, eW * 1.02, -eH * 0.24);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 2.5;
      ctx.stroke();
      // 眼尾翘起
      ctx.beginPath();
      ctx.moveTo(eW * 0.94, -eH * 0.30);
      ctx.quadraticCurveTo(eW * 1.22, -eH * 0.52, eW * 1.36, -eH * 0.10);
      ctx.lineWidth = LW * 1.5;
      ctx.stroke();
      // 下眼睑细线
      ctx.beginPath();
      ctx.moveTo(eW * 0.24, eH * 0.90);
      ctx.quadraticCurveTo(eW * 0.64, eH * 0.80, eW * 0.94, eH * 0.36);
      ctx.lineWidth = LW * 0.75;
      ctx.stroke();
      // 双眼皮线
      ctx.beginPath();
      ctx.moveTo(-eW * 0.52, -eH * 1.10);
      ctx.quadraticCurveTo(eW * 0.06, -eH * 1.34, eW * 0.68, -eH * 0.98);
      ctx.strokeStyle = al(LINE, 0.55);
      ctx.lineWidth = LW * 0.6;
      ctx.stroke();
      ctx.restore();
    }
    drawEye(-1);
    drawEye(1);

    // 眉毛
    for (var br = -1; br <= 1; br += 2) {
      ctx.beginPath();
      ctx.moveTo(cx + br * R * 0.24, eyeY - R * 0.52);
      ctx.quadraticCurveTo(cx + br * R * 0.42, eyeY - R * 0.61, cx + br * R * 0.58, eyeY - R * 0.50);
      ctx.strokeStyle = mix(H, '#2a1d3c', 0.86);
      ctx.lineWidth = LW * 1.5;
      ctx.stroke();
    }

    // 鼻子
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.035, cy + R * 0.40);
    ctx.lineTo(cx + R * 0.005, cy + R * 0.46);
    ctx.strokeStyle = al(SLN, 0.9);
    ctx.lineWidth = LW * 0.7;
    ctx.stroke();

    // 嘴
    var smile = act === 'smile' || (act !== 'idle' && act !== 'turn');
    ctx.beginPath();
    if (smile) {
      ctx.moveTo(cx - R * 0.12, cy + R * 0.68);
      ctx.quadraticCurveTo(cx, cy + R * 0.86, cx + R * 0.12, cy + R * 0.68);
      ctx.quadraticCurveTo(cx, cy + R * 0.78, cx - R * 0.12, cy + R * 0.68);
      ctx.fillStyle = '#b8546b';
      ctx.fill();
      ctx.strokeStyle = '#7c3346';
      ctx.lineWidth = LW * 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy + R * 0.76, R * 0.05, R * 0.022, 0, 0, 6.2832);
      ctx.fillStyle = '#e58ba0';
      ctx.fill();
    } else {
      ctx.moveTo(cx - R * 0.09, cy + R * 0.70);
      ctx.quadraticCurveTo(cx, cy + R * 0.77, cx + R * 0.09, cy + R * 0.70);
      ctx.strokeStyle = '#c1677d';
      ctx.lineWidth = LW * 0.9;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.045, cy + R * 0.775);
      ctx.quadraticCurveTo(cx, cy + R * 0.80, cx + R * 0.045, cy + R * 0.775);
      ctx.strokeStyle = al('#f0a0ae', 0.8);
      ctx.lineWidth = LW * 0.5;
      ctx.stroke();
    }

    /* ============ 前发（刘海 + 侧发 + 高光） ============ */
    // 头顶发盖
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.05, cy - R * 0.18);
    ctx.bezierCurveTo(cx - R * 1.22, cy - R * 1.16, cx - R * 0.45, cy - R * 1.46, cx, cy - R * 1.44);
    ctx.bezierCurveTo(cx + R * 0.45, cy - R * 1.46, cx + R * 1.22, cy - R * 1.16, cx + R * 1.05, cy - R * 0.18);
    ctx.quadraticCurveTo(cx, cy - R * 1.02, cx - R * 1.05, cy - R * 0.18);
    ctx.closePath();
    ctx.fillStyle = H;
    ctx.fill();
    ctx.strokeStyle = HLN;
    ctx.lineWidth = LW * 1.1;
    ctx.stroke();

    // 刘海底色（填补发绺间隙，避免露出额头断层）
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.02, cy - R * 0.22);
    ctx.bezierCurveTo(cx - R * 1.20, cy - R * 1.10, cx - R * 0.45, cy - R * 1.44, cx, cy - R * 1.42);
    ctx.bezierCurveTo(cx + R * 0.45, cy - R * 1.44, cx + R * 1.20, cy - R * 1.10, cx + R * 1.02, cy - R * 0.22);
    ctx.quadraticCurveTo(cx + R * 0.64, cy - R * 0.34, cx + R * 0.36, cy - R * 0.08);
    ctx.quadraticCurveTo(cx + R * 0.12, cy - R * 0.28, cx - R * 0.12, cy - R * 0.04);
    ctx.quadraticCurveTo(cx - R * 0.44, cy - R * 0.28, cx - R * 0.70, cy - R * 0.06);
    ctx.quadraticCurveTo(cx - R * 0.90, cy - R * 0.30, cx - R * 1.02, cy - R * 0.22);
    ctx.closePath();
    ctx.fillStyle = H;
    ctx.fill();
    ctx.strokeStyle = HLN;
    ctx.lineWidth = LW * 0.9;
    ctx.stroke();

    // 刘海发绺（尖角形，带发丝线）
    var bangs = [
      [-1.02, -0.96, -1.14, -0.42, -0.94, 0.02, -0.84, 0.12, 0.20],
      [-0.74, -1.16, -0.90, -0.54, -0.56, -0.12, -0.46, -0.16, 0.22],
      [-0.38, -1.26, -0.56, -0.58, -0.24, -0.02, -0.10, 0.10, 0.24],
      [0.02, -1.28, -0.14, -0.60, 0.16, 0.00, 0.30, -0.18, 0.23],
      [0.40, -1.20, 0.26, -0.56, 0.54, -0.04, 0.60, 0.10, 0.21],
      [0.78, -1.06, 0.82, -0.46, 0.98, 0.00, 1.02, 0.10, 0.19]
    ];
    for (var bi = 0; bi < bangs.length; bi++) {
      var b = bangs[bi];
      lock(cx + b[0] * R, cy + b[1] * R, cx + b[2] * R, cy + b[3] * R, cx + b[4] * R, cy + b[5] * R, cx + b[6] * R, cy + b[7] * R, R * b[8]);
      ctx.fillStyle = H;
      ctx.fill();
      ctx.strokeStyle = HLN;
      ctx.lineWidth = LW * 0.95;
      ctx.stroke();
      ctx.strokeStyle = al(HLN, 0.55);
      ctx.lineWidth = LW * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + b[0] * R * 0.94, cy + b[1] * R * 0.98);
      ctx.quadraticCurveTo(cx + b[2] * R, cy + b[3] * R, cx + b[6] * R * 0.98, cy + b[7] * R * 0.96);
      ctx.stroke();
    }

    // 侧发（框脸）
    for (var sl = -1; sl <= 1; sl += 2) {
      ctx.save();
      ctx.translate(cx + sl * R * 0.92, cy - R * 0.24);
      ctx.rotate(sl * sway * 1.1);
      ctx.beginPath();
      ctx.moveTo(-sl * R * 0.24, R * 0.00);
      ctx.quadraticCurveTo(sl * R * 0.36, R * 0.72, sl * R * 0.14, R * 1.58);
      ctx.quadraticCurveTo(-sl * R * 0.10, R * 0.74, -sl * R * 0.38, R * 0.02);
      ctx.closePath();
      ctx.fillStyle = H;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = HS;
      ctx.beginPath();
      ctx.ellipse(sl * R * 0.24, R * 1.05, R * 0.30, R * 0.62, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = HLN;
      ctx.lineWidth = LW * 0.95;
      ctx.stroke();
      ctx.strokeStyle = al(HLN, 0.5);
      ctx.lineWidth = LW * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, R * 0.30);
      ctx.quadraticCurveTo(sl * R * 0.10, R * 1.05, sl * R * 0.02, R * 1.48);
      ctx.stroke();
      ctx.restore();
    }

    // 猫耳（画在前发之上，避免被刘海盖住）
    if (ch.catEars) {
      for (var ce = -1; ce <= 1; ce += 2) {
        ctx.beginPath();
        ctx.moveTo(cx + ce * R * 0.34, cy - R * 1.00);
        ctx.quadraticCurveTo(cx + ce * R * 1.04, cy - R * 1.66, cx + ce * R * 0.94, cy - R * 0.72);
        ctx.quadraticCurveTo(cx + ce * R * 0.64, cy - R * 0.88, cx + ce * R * 0.34, cy - R * 1.00);
        ctx.closePath();
        ctx.fillStyle = H;
        ctx.fill();
        ctx.strokeStyle = HLN;
        ctx.lineWidth = LW * 1.05;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + ce * R * 0.52, cy - R * 0.98);
        ctx.quadraticCurveTo(cx + ce * R * 0.82, cy - R * 1.32, cx + ce * R * 0.82, cy - R * 0.86);
        ctx.closePath();
        ctx.fillStyle = al('#ffa7c2', 0.88);
        ctx.fill();
      }
    }

    // 发丝高光（天使环）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.90, Math.PI * 1.10, Math.PI * 1.62);
    ctx.strokeStyle = al(HL, 0.92);
    ctx.lineWidth = R * 0.16;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.93, Math.PI * 1.14, Math.PI * 1.58);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = R * 0.045;
    ctx.stroke();
    // 用底色切断高光，形成分段赛璐璐反光
    ctx.strokeStyle = H;
    ctx.lineWidth = R * 0.05;
    for (var hb = 0; hb < 6; hb++) {
      var ha = Math.PI * (1.12 + hb * 0.085);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ha) * R * 0.80, cy + Math.sin(ha) * R * 0.80);
      ctx.lineTo(cx + Math.cos(ha + 0.02) * R * 1.03, cy + Math.sin(ha + 0.02) * R * 1.03);
      ctx.stroke();
    }
    ctx.restore();

    // 呆毛
    if (ch.ahoge) {
      ctx.save();
      ctx.translate(cx + R * 0.02, cy - R * 1.40);
      ctx.rotate(Math.sin(t * 6.2832) * 0.10);
      ctx.beginPath();
      ctx.moveTo(-R * 0.03, R * 0.04);
      ctx.quadraticCurveTo(R * 0.16, -R * 0.44, R * 0.50, -R * 0.20);
      ctx.quadraticCurveTo(R * 0.30, -R * 0.26, R * 0.05, R * 0.06);
      ctx.closePath();
      ctx.fillStyle = H;
      ctx.fill();
      ctx.strokeStyle = HLN;
      ctx.lineWidth = LW * 0.9;
      ctx.stroke();
      ctx.restore();
    }

    // 蝴蝶结发饰
    if (ch.bow) {
      var bowX = cx - R * 0.80, bowY = cy - R * 0.66;
      ctx.save();
      ctx.translate(bowX, bowY);
      ctx.rotate(-0.18);
      for (var bw2 = -1; bw2 <= 1; bw2 += 2) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(bw2 * R * 0.34, -R * 0.28, bw2 * R * 0.40, -R * 0.02);
        ctx.quadraticCurveTo(bw2 * R * 0.36, R * 0.24, 0, R * 0.06);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.strokeStyle = LINE;
        ctx.lineWidth = LW * 0.9;
        ctx.stroke();
        ctx.strokeStyle = al('#ffffff', 0.6);
        ctx.lineWidth = LW * 0.5;
        ctx.beginPath();
        ctx.moveTo(bw2 * R * 0.10, -R * 0.02);
        ctx.quadraticCurveTo(bw2 * R * 0.28, -R * 0.16, bw2 * R * 0.34, -R * 0.02);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, R * 0.02, R * 0.085, R * 0.075, 0, 0, 6.2832);
      ctx.fillStyle = mix(accent, '#ffffff', 0.25);
      ctx.fill();
      ctx.strokeStyle = LINE;
      ctx.lineWidth = LW * 0.8;
      ctx.stroke();
      ctx.restore();
    }

    // 轮廓光
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = R * 0.045;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.16, -0.62, 0.62);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 星芒闪光
    for (var sp = 0; sp < 9; sp++) {
      var spx = cx + (rnd(sp + 131) - 0.5) * w * 1.1;
      var spy = cy + (rnd(sp + 132) - 0.42) * h * 0.95;
      var sa = 0.2 + 0.6 * Math.abs(Math.sin(t * 6.2832 + sp * 1.1));
      var sr = R * (0.03 + rnd(sp + 133) * 0.06);
      ctx.globalAlpha = sa;
      ctx.fillStyle = sp % 3 ? '#ffffff' : mix(EYE, '#ffffff', 0.4);
      ctx.beginPath();
      ctx.moveTo(spx, spy - sr * 2.2);
      ctx.quadraticCurveTo(spx + sr * 0.5, spy - sr * 0.5, spx + sr * 2.2, spy);
      ctx.quadraticCurveTo(spx + sr * 0.5, spy + sr * 0.5, spx, spy + sr * 2.2);
      ctx.quadraticCurveTo(spx - sr * 0.5, spy + sr * 0.5, spx - sr * 2.2, spy);
      ctx.quadraticCurveTo(spx - sr * 0.5, spy - sr * 0.5, spx, spy - sr * 2.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }


  /* ---------------- 场景渲染（单一渲染入口，禁止外部依赖） ---------------- */
  function renderScene(ctx, spec, t) {
    var w = spec.w, h = spec.h;
    t = ((t % 1) + 1) % 1;
    var pal = (spec.palette && spec.palette.length) ? spec.palette : ['#93c5fd'];
    function col(i) { return pal[((i % pal.length) + pal.length) % pal.length]; }
    function rnd(i) {
      var x = Math.sin((spec.seed || 1) * 9283.17 + i * 269.31) * 43758.5453;
      return x - Math.floor(x);
    }
    function rgba(hex, a) {
      var s = String(hex || '').replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var r = parseInt(s.slice(0, 2), 16) || 0;
      var g = parseInt(s.slice(2, 4), 16) || 0;
      var b = parseInt(s.slice(4, 6), 16) || 0;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // 背景
    var lg = ctx.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, spec.bg1 || '#0b1330');
    lg.addColorStop(1, spec.bg2 || '#02040c');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);

    var style = spec.style || 'particles';
    var i, x, y;

    // 摄像机：景别基准缩放 + 运镜（推/拉/摇/环绕/跟拍）
    var cam = spec.camera || { type: 'static', strength: 0.6 };
    var prog = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    var cst = Math.max(0, Math.min(1, cam.strength == null ? 0.6 : cam.strength));
    var baseZ = spec.shot === 'close' ? 1.42 : spec.shot === 'wide' ? 0.86 : 1;
    var zoom = baseZ, offX = 0, offY = 0, rotC = 0;
    if (cam.type === 'dolly') { zoom = baseZ * (1 + 0.16 * cst * prog); }
    else if (cam.type === 'pull') { zoom = baseZ * (1 + 0.16 * cst * (1 - prog)); }
    else if (cam.type === 'pan') { offX = -w * 0.085 * cst * (prog - 0.5); zoom = baseZ * 1.05; }
    else if (cam.type === 'orbit') { rotC = (prog - 0.5) * 0.10 * cst; offX = w * 0.02 * cst * Math.sin(prog * 6.2832); }
    else if (cam.type === 'follow') { offY = -h * 0.05 * cst * prog; zoom = baseZ * 1.03; }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotC);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2 + offX, -h / 2 + offY);

    if (style === 'character') {
      drawCelCharacter(ctx, spec, t);
    } else if (style === 'particles') {
      var n = spec.count || 120;
      var cx = w * 0.5, cy = h * 0.52, maxR = Math.min(w, h) * 0.46;
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.6);
      cg.addColorStop(0, rgba(col(0), 0.5));
      cg.addColorStop(0.45, rgba(col(0), 0.1));
      cg.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);
      for (i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + t * Math.PI * 2 * (spec.speed || 1) * 0.9;
        var rr = maxR * (0.34 + 0.66 * rnd(i)) * (0.78 + 0.22 * Math.sin(t * 6.2832 + i * 0.7));
        x = cx + Math.cos(a) * rr * 1.28;
        y = cy + Math.sin(a) * rr * 0.9;
        var pr = 1 + rnd(i + 50) * 3;
        var pa = 0.35 + 0.65 * Math.abs(Math.sin(t * 6.2832 + i * 0.33));
        ctx.globalAlpha = pa;
        ctx.fillStyle = col(i);
        ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = pa * 0.15;
        ctx.beginPath(); ctx.arc(x, y, pr * 4.2, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'blocks') {
      var cols = spec.cols || 16, rows = spec.rows || 9;
      var cw = w / cols, ch = h / rows, gap = Math.min(cw, ch) * 0.16;
      for (var by = 0; by < rows; by++) {
        for (var bx = 0; bx < cols; bx++) {
          var ph = t * 6.2832 + (bx + by) * 0.42;
          var s = 0.18 + 0.82 * Math.abs(Math.sin(ph));
          ctx.save();
          ctx.translate(bx * cw + cw / 2, by * ch + ch / 2);
          ctx.scale(s, s);
          ctx.globalAlpha = 0.25 + 0.75 * s;
          ctx.fillStyle = col(bx * 3 + by * 5);
          ctx.fillRect(-(cw - gap) / 2, -(ch - gap) / 2, cw - gap, ch - gap);
          ctx.restore();
        }
      }
    } else if (style === 'rain') {
      var nr = spec.count || 140;
      ctx.lineCap = 'round';
      for (i = 0; i < nr; i++) {
        var rx = rnd(i) * w * 1.1 - w * 0.05;
        var sp = 0.5 + rnd(i + 30) * 0.9;
        var prog = ((rnd(i + 11) + t * (spec.speed || 1) * sp * 2.4) % 1.15) - 0.05;
        var ry = prog * (h + 80) - 40;
        var len = 10 + rnd(i + 70) * 26;
        ctx.globalAlpha = 0.22 + rnd(i + 5) * 0.5;
        ctx.strokeStyle = col(i);
        ctx.lineWidth = 1 + rnd(i + 9) * 2;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + 2, ry + len); ctx.stroke();
      }
      var gg = ctx.createLinearGradient(0, h * 0.82, 0, h);
      gg.addColorStop(0, rgba(col(1), 0));
      gg.addColorStop(1, rgba(col(1), 0.35));
      ctx.globalAlpha = 1;
      ctx.fillStyle = gg;
      ctx.fillRect(0, h * 0.82, w, h * 0.18);
    } else if (style === 'wave') {
      for (var k = 0; k < 5; k++) {
        ctx.beginPath();
        for (x = 0; x <= w; x += 8) {
          var ny = h * (0.42 + k * 0.072) + Math.sin((x / w) * 6.2832 * 2 + t * 6.2832 + k * 0.8) * h * 0.055;
          if (x === 0) ctx.moveTo(x, ny); else ctx.lineTo(x, ny);
        }
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.globalAlpha = 0.1 + k * 0.06;
        ctx.fillStyle = col(k);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'ripple') {
      var rcx = w * 0.5, rcy = h * 0.5, rmax = Math.max(w, h) * 0.62, rings = 9;
      for (i = 0; i < rings; i++) {
        var rph = (t + i / rings) % 1;
        ctx.globalAlpha = (1 - rph) * 0.55;
        ctx.strokeStyle = col(i);
        ctx.lineWidth = 2 + (1 - rph) * 7;
        ctx.beginPath(); ctx.arc(rcx, rcy, rph * rmax, 0, 6.2832); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col(2);
      ctx.beginPath(); ctx.arc(rcx, rcy, 8, 0, 6.2832); ctx.fill();
    } else if (style === 'orbit') {
      var ocx = w * 0.5, ocy = h * 0.5, R = Math.min(w, h) * 0.3;
      var og = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, R * 0.95);
      og.addColorStop(0, rgba(col(0), 0.85));
      og.addColorStop(0.45, rgba(col(0), 0.22));
      og.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(ocx, ocy, R * 0.95, 0, 6.2832); ctx.fill();
      ctx.fillStyle = col(0);
      ctx.beginPath(); ctx.arc(ocx, ocy, R * 0.26, 0, 6.2832); ctx.fill();
      var on = spec.count || 90;
      for (i = 0; i < on; i++) {
        var orbit = 0.45 + (i % 4) * 0.16;
        var oa = (i / on) * Math.PI * 2 * 3 + t * 6.2832 * (spec.speed || 1) * 1.6;
        var orr = R * orbit;
        x = ocx + Math.cos(oa) * orr * 1.35;
        y = ocy + Math.sin(oa) * orr * 0.68;
        ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 6.2832 + i));
        ctx.fillStyle = col(i);
        ctx.beginPath(); ctx.arc(x, y, 1.6 + rnd(i) * 2.4, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === 'city') {
      var horizon = h * 0.72;
      var sg = ctx.createRadialGradient(w * 0.5, horizon, 0, w * 0.5, horizon, w * 0.55);
      sg.addColorStop(0, rgba(col(0), 0.3));
      sg.addColorStop(1, rgba(col(0), 0));
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, horizon);
      for (var layer = 0; layer < 2; layer++) {
        var baseY = horizon + layer * h * 0.06;
        for (i = 0; i < 14; i++) {
          var bw = (w / 16) * (0.6 + rnd(i + layer * 20) * 0.8);
          var bxx = i * w / 14 + rnd(i + layer * 13) * 10;
          var bh = h * (0.12 + rnd(i + layer * 7) * 0.3);
          ctx.globalAlpha = 1;
          ctx.fillStyle = layer === 0 ? 'rgba(6,10,22,0.95)' : 'rgba(10,16,32,0.9)';
          ctx.fillRect(bxx, baseY - bh, bw, bh);
          var winCols = Math.max(1, Math.floor(bw / 14));
          for (var wy = 0; wy < Math.floor(bh / 16); wy++) {
            for (var wx = 0; wx < winCols; wx++) {
              var blink = Math.sin(t * 12.566 + (wx + wy * 3 + i) * 0.7 + layer);
              if (blink < 0.15) continue;
              ctx.globalAlpha = 0.3 + 0.55 * blink;
              ctx.fillStyle = col(wx + wy + i);
              ctx.fillRect(bxx + 4 + wx * 14, baseY - bh + 6 + wy * 16, 5, 7);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      var sweep = ((t * 1.6) % 1) * (w * 1.4) - w * 0.2;
      var swg = ctx.createLinearGradient(sweep - 60, 0, sweep + 60, 0);
      swg.addColorStop(0, rgba(col(1), 0));
      swg.addColorStop(0.5, rgba(col(1), 0.16));
      swg.addColorStop(1, rgba(col(1), 0));
      ctx.fillStyle = swg;
      ctx.fillRect(0, 0, w, horizon);
    } else {
      var bursts = 3;
      for (var b = 0; b < bursts; b++) {
        var bph = (t + b / bursts) % 1;
        var fcx = w * (0.18 + rnd(b + 3) * 0.64);
        var fcy = h * (0.16 + rnd(b + 8) * 0.42);
        var fmax = Math.min(w, h) * (0.18 + rnd(b + 1) * 0.22);
        var frad = fmax * Math.pow(bph, 0.55);
        var falpha = Math.max(0, 1 - bph * 1.1);
        for (var p = 0; p < 36; p++) {
          var fa = (p / 36) * 6.2832 + rnd(b * 10 + p) * 0.5;
          x = fcx + Math.cos(fa) * frad;
          y = fcy + Math.sin(fa) * frad + bph * bph * h * 0.12;
          ctx.globalAlpha = falpha * (0.45 + 0.55 * rnd(p));
          ctx.fillStyle = col(p + b);
          ctx.beginPath(); ctx.arc(x, y, 1.6 + rnd(p + 20) * 2, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // 电影宽银幕黑边（纯平涂，任何风格都保留）
    var grade = spec.grade || 'clean';
    if (grade === 'cinema') {
      var bar = Math.round(h * 0.052);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
    }

    // 赛璐璐人物：跳过渐变影调、胶片颗粒与暗角，保持传统平涂
    if (style !== 'character') {
      if (grade === 'cinema') {
        var g1 = ctx.createLinearGradient(0, 0, 0, h);
        g1.addColorStop(0, 'rgba(255,176,110,0.10)');
        g1.addColorStop(0.55, 'rgba(0,0,0,0)');
        g1.addColorStop(1, 'rgba(0,86,132,0.14)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, bar, w, h - bar * 2);
      } else if (grade === 'filmic') {
        var g2 = ctx.createLinearGradient(0, 0, 0, h);
        g2.addColorStop(0, 'rgba(255,210,150,0.08)');
        g2.addColorStop(0.5, 'rgba(120,80,200,0.05)');
        g2.addColorStop(1, 'rgba(20,10,40,0.12)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
      } else if (grade === 'neon') {
        var g3 = ctx.createLinearGradient(0, 0, w, h);
        g3.addColorStop(0, 'rgba(244,114,182,0.10)');
        g3.addColorStop(0.5, 'rgba(0,0,0,0)');
        g3.addColorStop(1, 'rgba(34,211,238,0.12)');
        ctx.fillStyle = g3;
        ctx.fillRect(0, 0, w, h);
      } else if (grade === 'soft') {
        ctx.fillStyle = 'rgba(255,228,240,0.055)';
        ctx.fillRect(0, 0, w, h);
      }

      // 胶片颗粒（逐帧变化，模拟模型输出的质感）
      var grain = Number(spec.grain) || 0;
      if (grain > 0) {
        var gn = Math.round(w * h * grain / 70);
        var fseed = Math.floor(t * 997);
        for (i = 0; i < gn; i++) {
          x = rnd(i + fseed * 31) * w;
          y = rnd(i + fseed * 31 + 7) * h;
          ctx.globalAlpha = 0.05 + rnd(i + 5) * 0.10;
          ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
          ctx.fillRect(x, y, 1.2, 1.2);
        }
        ctx.globalAlpha = 1;
      }

      var vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------------- 生成 Python 代码（Pillow 平涂赛璐璐渲染器） ---------------- */
  var PY_SOURCE = [
'#!/usr/bin/env python3',
'# -*- coding: utf-8 -*-',
'"""',
'绘梦 AI · 免费生视频 —— 二维赛璐璐平涂渲染器（Python + Pillow）',
'提示词 → Python 场景脚本 → PNG 连续帧 → GIF / MP4',
'',
'风格约定：全部为平涂色块 + 硬边阴影 + 一层高光，不使用任何渐变。',
'',
'依赖：pip install pillow',
'用法：',
'    python scene_cel.py                    # 输出 frames/ 与 scene.gif',
'    python scene_cel.py --frames 48 --fps 24 --out demo',
'    python scene_cel.py --preview 2        # 只渲染前 2 帧',
'转 MP4（需已安装 ffmpeg）：',
'    ffmpeg -framerate 24 -i frames/frame_%03d.png -pix_fmt yuv420p scene.mp4',
'"""',
'',
'import argparse',
'import json',
'import math',
'import os',
'',
'from PIL import Image, ImageChops, ImageDraw',
'',
"SPEC = json.loads(r'''__SPEC__''')",
'',
'LINE = (58, 43, 77)',
'',
'',
'def rgb(h):',
'    if isinstance(h, (tuple, list)):',
'        return tuple(h[:3])',
'    h = str(h or "#ffffff").lstrip("#")',
'    if len(h) == 3:',
'        h = h[0] * 2 + h[1] * 2 + h[2] * 2',
'    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))',
'',
'',
'def mix(a, b, k):',
'    A, B = rgb(a), rgb(b)',
'    return tuple(int(round(A[i] + (B[i] - A[i]) * k)) for i in range(3))',
'',
'',
'def rnd(i, seed):',
'    x = math.sin(seed * 9283.17 + i * 269.31) * 43758.5453',
'    return x - math.floor(x)',
'',
'',
'def bez(p0, p1, p2, p3, n=22):',
'    out = []',
'    for s in range(n + 1):',
'        u = s / n',
'        v = 1 - u',
'        out.append((v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],',
'                    v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]))',
'    return out',
'',
'',
'def quad(p0, p1, p2, n=18):',
'    out = []',
'    for s in range(n + 1):',
'        u = s / n',
'        v = 1 - u',
'        out.append((v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0],',
'                    v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1]))',
'    return out',
'',
'',
'def ell(cx, cy, rx, ry, rot=0.0, n=44):',
'    out = []',
'    ca, sa = math.cos(rot), math.sin(rot)',
'    for i in range(n):',
'        a = 2 * math.pi * i / n',
'        x, y = math.cos(a) * rx, math.sin(a) * ry',
'        out.append((cx + x * ca - y * sa, cy + x * sa + y * ca))',
'    return out',
'',
'',
'def rot(pts, ang, dx, dy):',
'    ca, sa = math.cos(ang), math.sin(ang)',
'    return [(dx + x * ca - y * sa, dy + x * sa + y * ca) for (x, y) in pts]',
'',
'',
'def disk(d, cx, cy, rx, ry, color, rot=0.0, n=44):',
'    d.polygon(ell(cx, cy, rx, ry, rot, n), fill=color)',
'',
'',
'def ink(d, pts, color=LINE, w=2, close=True):',
'    p = list(pts) + ([pts[0]] if close else [])',
'    d.line(p, fill=color, width=max(1, int(round(w))), joint="curve")',
'',
'',
'def shape(d, pts, color, w=2, line=LINE):',
'    d.polygon(pts, fill=color)',
'    if w:',
'        ink(d, pts, line, w)',
'',
'',
'def clip_fill(img, clip_pts, pts, color):',
'    outside = Image.new("L", img.size, 0)',
'    ImageDraw.Draw(outside).polygon(clip_pts, fill=255)',
'    inner = Image.new("L", img.size, 0)',
'    ImageDraw.Draw(inner).polygon(pts, fill=255)',
'    mask = ImageChops.multiply(outside, inner)',
'    layer = Image.new("RGB", img.size, color)',
'    img.paste(layer, (0, 0), mask)',
'',
'',
'def sparkle(d, cx, cy, r, color):',
'    d.polygon([(cx, cy - r), (cx + r * 0.28, cy - r * 0.28), (cx + r, cy),',
'               (cx + r * 0.28, cy + r * 0.28), (cx, cy + r),',
'               (cx - r * 0.28, cy + r * 0.28), (cx - r, cy),',
'               (cx - r * 0.28, cy - r * 0.28)], fill=color)',
'',
'',
'def draw_bg(d, w, h, kind, t, R, seed):',
'    if kind == "sakura":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(255, 230, 239))',
'        d.rectangle([-w, -h, w * 2, h * 0.30], fill=(166, 212, 255))',
'        d.rectangle([-w, h * 0.62, w * 2, h * 2], fill=(255, 248, 242))',
'        for i in range(5):',
'            disk(d, w * (0.08 + rnd(i + 11, seed) * 0.84), h * (0.10 + rnd(i + 12, seed) * 0.20),',
'                 w * 0.16, h * 0.10, (255, 216, 230), n=20)',
'        for i in range(14):',
'            disk(d, rnd(i + 31, seed) * w, rnd(i + 32, seed) * h * 0.7,',
'                 14 + rnd(i + 34, seed) * 40, 14 + rnd(i + 34, seed) * 40, (255, 246, 250), n=16)',
'        for i in range(16):',
'            px = ((rnd(i + 41, seed) + t * (0.5 + rnd(i + 42, seed) * 0.5)) % 1.1) * w',
'            py = ((rnd(i + 43, seed) + t * 0.35) % 1.1) * h * 1.1 - h * 0.05',
'            disk(d, px, py, R * 0.12, R * 0.06,',
'                 (255, 194, 217) if i % 3 else (255, 217, 231), rot=t * 3 + i, n=12)',
'    elif kind == "night":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(16, 26, 66))',
'        d.rectangle([-w, h * 0.44, w * 2, h * 0.74], fill=(37, 36, 90))',
'        d.rectangle([-w, h * 0.74, w * 2, h * 2], fill=(58, 44, 88))',
'        for i in range(70):',
'            r = 0.8 + rnd(i + 53, seed) * 1.8',
'            disk(d, rnd(i + 51, seed) * w, rnd(i + 52, seed) * h * 0.75, r, r,',
'                 (255, 233, 184) if i % 5 == 0 else (219, 231, 255), n=10)',
'        mx, my, mr = w * 0.76, h * 0.24, h * 0.085',
'        disk(d, mx, my, mr * 3.2, mr * 3.2, mix((16, 26, 66), (255, 244, 214), 0.14), n=40)',
'        disk(d, mx, my, mr * 1.9, mr * 1.9, mix((16, 26, 66), (255, 244, 214), 0.28), n=40)',
'        disk(d, mx, my, mr, mr, (255, 246, 220), n=40)',
'        disk(d, mx + mr * 0.25, my - mr * 0.15, mr * 0.24, mr * 0.24, (232, 217, 168), n=20)',
'        for i in range(9):',
'            bh = h * (0.10 + rnd(i + 61, seed) * 0.22)',
'            bx = i * w * 0.12 - w * 0.03',
'            d.rectangle([bx, h * 0.72 - bh, bx + w * 0.12, h * 1.02], fill=(20, 26, 56))',
'            for k in range(3):',
'                d.rectangle([bx + 6 + k * 9, h * 0.72 - bh + 8 + (i % 2) * 10,',
'                             bx + 10 + k * 9, h * 0.72 - bh + 13 + (i % 2) * 10],',
'                            fill=(255, 212, 121) if i % 2 else (143, 228, 255))',
'    elif kind == "city":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(42, 23, 69))',
'        d.rectangle([-w, h * 0.34, w * 2, h * 0.62], fill=(109, 42, 99))',
'        d.rectangle([-w, h * 0.62, w * 2, h * 2], fill=(26, 14, 44))',
'        for i in range(12):',
'            nh = h * (0.18 + rnd(i + 72, seed) * 0.30)',
'            nx = i * w * 0.085 - w * 0.02',
'            d.rectangle([nx, h * 0.80 - nh, nx + w * 0.06 + rnd(i + 71, seed) * w * 0.08, h * 1.10],',
'                        fill=(23, 16, 41))',
'            d.rectangle([nx + 5, h * 0.80 - nh + 6, nx + 5 + w * 0.04, h * 0.80 - nh + 10],',
'                        fill=(255, 95, 176) if i % 3 else (68, 224, 255))',
'    elif kind == "room":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(255, 245, 226))',
'        d.rectangle([-w, h * 0.50, w * 2, h * 0.62], fill=(244, 220, 192))',
'        d.rectangle([-w, h * 0.62, w * 2, h * 2], fill=(232, 200, 168))',
'        d.rectangle([w * 0.58, h * 0.10, w * 0.88, h * 0.50], fill=(191, 230, 255))',
'        ink(d, [(w * 0.58, h * 0.10), (w * 0.88, h * 0.10), (w * 0.88, h * 0.50), (w * 0.58, h * 0.50)],',
'            (255, 248, 230), max(3, R * 0.05))',
'        ink(d, [(w * 0.73, h * 0.10), (w * 0.73, h * 0.50)], (255, 248, 230), max(3, R * 0.05), False)',
'        ink(d, [(w * 0.58, h * 0.30), (w * 0.88, h * 0.30)], (255, 248, 230), max(3, R * 0.05), False)',
'    elif kind == "sea":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(191, 233, 255))',
'        d.rectangle([-w, h * 0.44, w * 2, h * 0.52], fill=(247, 252, 255))',
'        d.rectangle([-w, h * 0.52, w * 2, h * 0.76], fill=(116, 203, 227))',
'        d.rectangle([-w, h * 0.76, w * 2, h * 2], fill=(47, 142, 184))',
'        for i in range(12):',
'            disk(d, w * (0.15 + rnd(i + 91, seed) * 0.7), h * (0.10 + rnd(i + 92, seed) * 0.16),',
'                 w * 0.06, h * 0.022, (255, 255, 255), n=16)',
'        for i in range(5):',
'            pts = [(xx, h * (0.60 + i * 0.055) + math.sin(xx / w * 9 + t * 6.2832 + i) * h * 0.008)',
'                   for xx in range(int(-w * 0.2), int(w * 1.2), 14)]',
'            ink(d, pts, (234, 253, 255), max(2, R * 0.03), False)',
'    elif kind == "forest":',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(233, 247, 221))',
'        d.rectangle([-w, h * 0.55, w * 2, h * 0.75], fill=(207, 233, 192))',
'        d.rectangle([-w, h * 0.75, w * 2, h * 2], fill=(169, 207, 156))',
'        for i in range(8):',
'            tx = i * w * 0.14 - w * 0.05 + rnd(i + 101, seed) * 20',
'            d.rectangle([tx, -h * 0.1, tx + w * 0.035, h * 1.0], fill=(120, 160, 118))',
'        for i in range(9):',
'            disk(d, rnd(i + 111, seed) * w, rnd(i + 112, seed) * h * 0.9,',
'                 26 + rnd(i + 113, seed) * 54, 26 + rnd(i + 113, seed) * 54,',
'                 (150, 205, 158) if i % 2 else (176, 220, 166), n=18)',
'    else:',
'        d.rectangle([-w, -h, w * 2, h * 2], fill=(185, 169, 224))',
'        disk(d, w * 0.5, h * 0.34, max(w, h) * 0.62, max(w, h) * 0.62, (214, 200, 242), n=48)',
'        disk(d, w * 0.5, h * 0.34, max(w, h) * 0.44, max(w, h) * 0.44, (232, 221, 255), n=48)',
'        disk(d, w * 0.5, h * 0.34, max(w, h) * 0.26, max(w, h) * 0.26, (255, 234, 244), n=48)',
'',
'',
'def draw_character(d, img, spec, t):',
'    w, h = spec["w"], spec["h"]',
'    ch = spec.get("char") or {}',
'    seed = spec.get("seed") or 1',
'    motion = float(spec.get("motion") if spec.get("motion") is not None else 0.7)',
'    action = spec.get("action") or "idle"',
'    outfit = ch.get("outfit") or "dress"',
'    chibi = bool(ch.get("chibi"))',
'',
'    H = rgb(ch.get("hair") or "#f7f9ff")',
'    HS = rgb(ch.get("shade")) if ch.get("shade") else mix(H, "#7c89bd", 0.46)',
'    HL = mix(H, "#b6c8f2", 0.40)',
'    HLN = mix(H, "#2a1d3c", 0.88)',
'    EYE = rgb(ch.get("eye") or "#7fb0ff")',
'    SKIN, SKINS, SKIND, SLN = (255, 233, 222), (248, 202, 184), (234, 176, 161), (203, 142, 131)',
'    cloth = rgb(ch.get("dress") or "#ab8df2")',
'    clothS = rgb(ch.get("dressShade")) if ch.get("dressShade") else mix(cloth, "#553c8f", 0.55)',
'    is_uni = outfit in ("sailor", "maid")',
'    blouse = (253, 253, 255) if is_uni else cloth',
'    blouseS = (218, 222, 243) if is_uni else clothS',
'    skirt = (48, 58, 99) if outfit == "sailor" else ((42, 34, 52) if outfit == "maid" else cloth)',
'    skirtS = (29, 36, 67) if outfit == "sailor" else ((26, 20, 36) if outfit == "maid" else clothS)',
'    accent = mix(EYE, "#ff5c86", 0.55)',
'',
'    cs = min(w, h)',
'    R = cs * (0.205 if chibi else 0.185)',
'    cx = w * 0.5',
'    bob = math.sin(t * 6.2832) * R * 0.028 * (2.4 if action == "float" else 1) * (0.6 + motion)',
'    cy = h * (0.415 if chibi else 0.40) + bob',
'    LW = max(1.3, R * 0.023)',
'    sway = math.sin(t * 6.2832) * 0.045 * (0.5 + motion)',
'    ph = (t + rnd(7, seed)) % 1',
'    blink = 0.905 < ph < 0.945',
'',
'    deep = cy + R * (1.05 if ch.get("shortHair") else 1.95)',
'',
'    # 后发',
'    bh = [(cx - R * 1.12, cy - R * 0.12)]',
'    bh += bez((cx - R * 1.12, cy - R * 0.12), (cx - R * 1.36, cy - R * 1.06), (cx - R * 0.58, cy - R * 1.46), (cx, cy - R * 1.44))',
'    bh += bez((cx, cy - R * 1.44), (cx + R * 0.58, cy - R * 1.46), (cx + R * 1.36, cy - R * 1.06), (cx + R * 1.12, cy - R * 0.12))',
'    bh += bez((cx + R * 1.12, cy - R * 0.12), (cx + R * 1.26, cy + R * 0.55), (cx + R * 1.20, cy + R * 1.30), (cx + R * 1.28, deep))',
'    bh += quad((cx + R * 1.28, deep), (cx + R * 0.98, deep - R * 0.26), (cx + R * 0.76, deep + R * 0.05))',
'    bh += quad((cx + R * 0.76, deep + R * 0.05), (cx + R * 0.56, deep - R * 0.34), (cx + R * 0.38, deep - R * 0.02))',
'    bh += quad((cx + R * 0.38, deep - R * 0.02), (cx + R * 0.16, deep - R * 0.30), (cx, deep - R * 0.10))',
'    bh += quad((cx, deep - R * 0.10), (cx - R * 0.16, deep - R * 0.30), (cx - R * 0.38, deep - R * 0.02))',
'    bh += quad((cx - R * 0.38, deep - R * 0.02), (cx - R * 0.56, deep - R * 0.34), (cx - R * 0.76, deep + R * 0.05))',
'    bh += quad((cx - R * 0.76, deep + R * 0.05), (cx - R * 0.98, deep - R * 0.26), (cx - R * 1.28, deep))',
'    bh += bez((cx - R * 1.28, deep), (cx - R * 1.20, cy + R * 1.30), (cx - R * 1.26, cy + R * 0.55), (cx - R * 1.12, cy - R * 0.12))',
'    shape(d, bh, H, LW * 1.15, HLN)',
'    clip_fill(img, bh, ell(cx + R * 0.62, cy + R * 0.92, R * 1.05, R * 1.00, n=30), HS)',
'    clip_fill(img, bh, ell(cx - R * 0.85, cy + R * 0.30, R * 0.26, R * 0.80, n=24), mix(HS, H, 0.35))',
'',
'    # 双马尾',
'    if ch.get("twin"):',
'        for sd in (-1, 1):',
'            tx, ty = cx + sd * R * 1.26, cy - R * 0.18',
'            ang = sd * sway * 1.6',
'            tp = [(sd * R * 0.16, 0)]',
'            tp += bez((sd * R * 0.16, 0), (sd * R * 0.92, R * 0.55), (sd * R * 0.82, R * 1.55), (sd * R * 0.52, R * 2.02))',
'            tp += quad((sd * R * 0.52, R * 2.02), (sd * R * 0.30, R * 1.60), (sd * R * 0.18, R * 1.16))',
'            pts = rot(tp, ang, tx, ty)',
'            shape(d, pts, H, LW * 1.1, HLN)',
'            clip_fill(img, pts, rot(ell(sd * R * 0.84, R * 1.05, R * 0.24, R * 0.78, n=20), ang, tx, ty), HS)',
'            ink(d, rot([(sd * R * 0.34, R * 0.20), (sd * R * 0.72, R * 1.05), (sd * R * 0.56, R * 1.85)], ang, tx, ty),',
'                mix(HLN, H, 0.5), LW * 0.55, False)',
'            clip_fill(img, pts, rot(ell(0, R * 0.10, R * 0.24, R * 0.12, sd * 0.3, 20), ang, tx, ty), accent)',
'            clip_fill(img, pts, rot(ell(0, R * 0.10, R * 0.24, R * 0.12, sd * 0.3, 20), ang, tx, ty), accent)',
'',
'    # 颈',
'    neck = [(cx - R * 0.31, cy + R * 0.80), (cx - R * 0.37, cy + R * 1.42),',
'            (cx + R * 0.37, cy + R * 1.42), (cx + R * 0.31, cy + R * 0.80)]',
'    shape(d, neck, SKIN, LW * 0.8, SLN)',
'    clip_fill(img, neck, ell(cx, cy + R * 0.84, R * 0.38, R * 0.115, n=20), SKINS)',
'',
'    # 胸口肤色',
'    d.polygon([(cx - R * 0.30, cy + R * 1.10), (cx - R * 0.42, cy + R * 1.86),',
'               (cx + R * 0.42, cy + R * 1.86), (cx + R * 0.30, cy + R * 1.10)], fill=SKIN)',
'',
'    # 手臂',
'    for sd in (-1, 1):',
'        tx, ty = cx + sd * R * 1.12, cy + R * 1.56',
'        wave = sd == 1 and action == "wave"',
'        ang = (sd * -2.30 + math.sin(t * 12.566) * 0.14) if wave else sd * 0.13',
'        L, aw = R * 1.16, R * 0.175',
'        ap = [(-aw, 0)]',
'        ap += quad((-aw, 0), (-aw * 1.22, L * 0.55), (-aw * 0.86, L))',
'        ap += quad((-aw * 0.86, L), (0, L + aw * 0.24), (aw * 0.86, L))',
'        ap += quad((aw * 0.86, L), (aw * 1.22, L * 0.55), (aw, 0))',
'        apts = rot(ap, ang, tx, ty)',
'        shape(d, apts, SKIN, LW * 0.75, SLN)',
'        clip_fill(img, apts, rot(ell(aw * 0.95, L * 0.62, aw * 0.9, L * 0.55, n=20), ang, tx, ty), SKINS)',
'        shape(d, rot(ell(0, L + aw * 0.20, aw * 0.94, aw * 0.84, n=20), ang, tx, ty), SKIN, LW * 0.7, SLN)',
'        cp = [(-aw * 1.30, -R * 0.02)]',
'        cp += quad((-aw * 1.30, -R * 0.02), (0, R * 0.24), (aw * 1.30, -R * 0.02))',
'        cp += [(aw * 1.10, -R * 0.30)]',
'        cp += quad((aw * 1.10, -R * 0.30), (0, -R * 0.08), (-aw * 1.10, -R * 0.30))',
'        cpts = rot(cp, ang, tx, ty)',
'        shape(d, cpts, blouse, LW * 0.9, LINE)',
'        clip_fill(img, cpts, rot(ell(aw * 0.9, R * 0.06, aw * 1.0, R * 0.16, n=16), ang, tx, ty), blouseS)',
'',
'    # 躯干',
'    tp = [(cx - R * 0.22, cy + R * 1.10)]',
'    tp += quad((cx - R * 0.22, cy + R * 1.10), (cx - R * 0.94, cy + R * 1.14), (cx - R * 1.16, cy + R * 1.58))',
'    tp += quad((cx - R * 1.16, cy + R * 1.58), (cx - R * 1.28, cy + R * 1.96), (cx - R * 1.12, cy + R * 2.56))',
'    tp += [(cx + R * 1.12, cy + R * 2.56)]',
'    tp += quad((cx + R * 1.12, cy + R * 2.56), (cx + R * 1.28, cy + R * 1.96), (cx + R * 1.16, cy + R * 1.58))',
'    tp += quad((cx + R * 1.16, cy + R * 1.58), (cx + R * 0.94, cy + R * 1.14), (cx + R * 0.22, cy + R * 1.10))',
'    tp += [(cx + R * 0.20, cy + R * 1.42), (cx, cy + R * 1.72), (cx - R * 0.20, cy + R * 1.42)]',
'    shape(d, tp, blouse, LW * 1.05, LINE)',
'    clip_fill(img, tp, ell(cx + R * 1.42, cy + R * 1.98, R * 0.58, R * 1.02, n=30), blouseS)',
'',
'    if is_uni:',
'        for sd in (-1, 1):',
'            col = [(cx + sd * R * 0.24, cy + R * 1.08), (cx + sd * R * 1.02, cy + R * 1.26),',
'                   (cx + sd * R * 0.98, cy + R * 1.66), (cx + sd * R * 0.20, cy + R * 1.44)]',
'            shape(d, col, (47, 58, 99), LW * 0.9, LINE)',
'        ink(d, [(cx - R * 0.30, cy + R * 1.20), (cx - R * 0.92, cy + R * 1.30)], (255, 255, 255), LW * 0.6, False)',
'        ink(d, [(cx + R * 0.30, cy + R * 1.20), (cx + R * 0.92, cy + R * 1.30)], (255, 255, 255), LW * 0.6, False)',
'        for sd in (-1, 1):',
'            d.polygon([(cx, cy + R * 1.62), (cx + sd * R * 0.24, cy + R * 1.50),',
'                       (cx + sd * R * 0.24, cy + R * 1.78)], fill=accent)',
'        shape(d, ell(cx, cy + R * 1.63, R * 0.075, R * 0.075, n=16), mix(accent, "#ffffff", 0.3), LW * 0.8, LINE)',
'    elif outfit == "kimono":',
'        d.polygon([(cx - R * 0.22, cy + R * 1.10), (cx + R * 0.30, cy + R * 1.94),',
'                   (cx + R * 0.44, cy + R * 1.86), (cx - R * 0.06, cy + R * 1.06)], fill=mix(cloth, "#ffffff", 0.35))',
'        d.polygon([(cx + R * 0.22, cy + R * 1.10), (cx - R * 0.30, cy + R * 1.94),',
'                   (cx - R * 0.44, cy + R * 1.86), (cx + R * 0.06, cy + R * 1.06)], fill=mix(cloth, "#ffffff", 0.55))',
'        d.rectangle([cx - R * 1.10, cy + R * 2.28, cx + R * 1.10, cy + R * 2.58], fill=accent)',
'        ink(d, [(cx - R * 1.10, cy + R * 2.28), (cx + R * 1.10, cy + R * 2.28),',
'                (cx + R * 1.10, cy + R * 2.58), (cx - R * 1.10, cy + R * 2.58)], LINE, LW * 0.8)',
'    else:',
'        ink(d, [(cx - R * 0.90, cy + R * 1.72), (cx, cy + R * 1.96), (cx + R * 0.90, cy + R * 1.72)],',
'            mix(clothS, cloth, 0.2), LW * 0.8, False)',
'',
'    # 裙子',
'    sk = [(cx - R * 1.06, cy + R * 2.52), (cx + R * 1.06, cy + R * 2.52)]',
'    sk += quad((cx + R * 1.06, cy + R * 2.52), (cx + R * 1.30, cy + R * 3.10), (cx + R * 1.44, cy + R * 3.70))',
'    sk += [(cx - R * 1.44, cy + R * 3.70)]',
'    sk += quad((cx - R * 1.44, cy + R * 3.70), (cx - R * 1.30, cy + R * 3.10), (cx - R * 1.06, cy + R * 2.52))',
'    shape(d, sk, skirt, LW, LINE)',
'    clip_fill(img, sk, ell(cx + R * 1.18, cy + R * 3.20, R * 0.70, R * 1.20, n=28), skirtS)',
'    for pl in range(-2, 3):',
'        ink(d, [(cx + pl * R * 0.42, cy + R * 2.54), (cx + pl * R * 0.58, cy + R * 3.68)], skirtS, LW * 0.7, False)',
'',
'    # 脸',
'    fp = [(cx - R * 0.86, cy - R * 0.55)]',
'    fp += bez((cx - R * 0.86, cy - R * 0.55), (cx - R * 0.94, cy + R * 0.12), (cx - R * 0.76, cy + R * 0.62), (cx - R * 0.34, cy + R * 0.90))',
'    fp += quad((cx - R * 0.34, cy + R * 0.90), (cx, cy + R * 1.04), (cx + R * 0.34, cy + R * 0.90))',
'    fp += bez((cx + R * 0.34, cy + R * 0.90), (cx + R * 0.76, cy + R * 0.62), (cx + R * 0.94, cy + R * 0.12), (cx + R * 0.86, cy - R * 0.55))',
'    fp += quad((cx + R * 0.86, cy - R * 0.55), (cx, cy - R * 0.98), (cx - R * 0.86, cy - R * 0.55))',
'    shape(d, fp, SKIN, LW * 0.95, SLN)',
'    clip_fill(img, fp, ell(cx + R * 0.88, cy + R * 0.10, R * 0.52, R * 1.02, n=28), SKINS)',
'    bshadow = [(cx - R * 0.92, cy - R * 0.34)]',
'    bshadow += quad((cx - R * 0.92, cy - R * 0.34), (cx - R * 0.40, cy - R * 0.06), (cx - R * 0.04, cy - R * 0.20))',
'    bshadow += quad((cx - R * 0.04, cy - R * 0.20), (cx + R * 0.40, cy - R * 0.05), (cx + R * 0.92, cy - R * 0.36))',
'    bshadow += [(cx + R * 0.92, cy - R * 0.80), (cx - R * 0.92, cy - R * 0.80)]',
'    clip_fill(img, fp, bshadow, SKINS)',
'    clip_fill(img, fp, ell(cx, cy + R * 1.02, R * 0.42, R * 0.20, n=26), SKIND)',
'',
'    # 耳朵',
'    if ch.get("shortHair"):',
'        for er in (-1, 1):',
'            disk(d, cx + er * R * 0.80, cy - R * 0.02, R * 0.075, R * 0.115, SKIN, rot=er * 0.16, n=16)',
'            ink(d, ell(cx + er * R * 0.80, cy - R * 0.02, R * 0.075, R * 0.115, er * 0.16, 16), SLN, LW * 0.7)',
'',
'    # 腮红',
'    for bl in (-1, 1):',
'        clip_fill(img, fp, ell(cx + bl * R * 0.58, cy + R * 0.52, R * 0.20, R * 0.10, n=20), mix(SKIN, "#ff9fb4", 0.35))',
'        for bh2 in range(3):',
'            ink(d, [(cx + bl * R * (0.50 + bh2 * 0.07), cy + R * 0.48),',
'                    (cx + bl * R * (0.46 + bh2 * 0.07), cy + R * 0.58)], mix(SKIN, "#e2708a", 0.55), LW * 0.5, False)',
'',
'    # 眼睛',
'    eW, eH, eyeDX, eyeY = R * 0.293, R * 0.320, R * 0.385, cy + R * 0.215',
'    iris_dark = mix(EYE, "#140e22", 0.62)',
'    for side in (-1, 1):',
'        ex = cx + side * eyeDX',
'        def mp(pts):',
'            return [(ex + side * x, eyeY + y) for (x, y) in pts]',
'        if blink:',
'            ink(d, mp([(-eW * 0.95, eH * 0.02), (0, eH * 0.52), (eW * 0.94, -eH * 0.04)]), LINE, LW * 2.1, False)',
'            continue',
'        wpts = [(-eW, eH * 0.10)]',
'        wpts += quad((-eW, eH * 0.10), (-eW * 0.86, -eH * 0.58), (-eW * 0.16, -eH * 0.86))',
'        wpts += quad((-eW * 0.16, -eH * 0.86), (eW * 0.54, -eH * 1.04), (eW * 0.96, -eH * 0.26))',
'        wpts += quad((eW * 0.96, -eH * 0.26), (eW * 1.02, eH * 0.24), (eW * 0.58, eH * 0.66))',
'        wpts += quad((eW * 0.58, eH * 0.66), (eW * 0.08, eH * 0.96), (-eW * 0.52, eH * 0.60))',
'        wpts += quad((-eW * 0.52, eH * 0.60), (-eW * 1.0, eH * 0.40), (-eW, eH * 0.10))',
'        d.polygon(mp(wpts), fill=(255, 255, 255))',
'        ix, iy, irx, iry = ex + side * eW * 0.02, eyeY + eH * 0.06, eW * 0.70, eH * 0.80',
'        iris = ell(ix, iy, irx, iry, n=36)',
'        d.polygon(iris, fill=EYE)',
'        clip_fill(img, iris, ell(ix, iy - iry * 0.78, irx * 1.05, iry * 0.42, n=24), iris_dark)',
'        disk(d, ix, iy + iry * 0.46, irx * 0.54, iry * 0.16, mix(EYE, "#ffffff", 0.85), n=20)',
'        disk(d, ix, iy - iry * 0.04, irx * 0.42, iry * 0.52, mix(EYE, "#140e22", 0.86), n=24)',
'        disk(d, ix - irx * 0.34, iy - iry * 0.42, irx * 0.28, irx * 0.28, (255, 255, 255), n=16)',
'        disk(d, ix + irx * 0.30, iy + iry * 0.34, irx * 0.13, irx * 0.13, (255, 255, 255), n=12)',
'        ink(d, iris, mix(LINE, EYE, 0.2), LW * 0.8)',
'        ink(d, mp([(-eW * 1.0, eH * 0.04), (-eW * 0.84, -eH * 0.62), (-eW * 0.12, -eH * 0.88),',
'                   (eW * 0.56, -eH * 1.03), (eW * 1.02, -eH * 0.24)]), LINE, LW * 2.5, False)',
'        ink(d, mp([(eW * 0.94, -eH * 0.30), (eW * 1.22, -eH * 0.52), (eW * 1.36, -eH * 0.10)]), LINE, LW * 1.5, False)',
'        ink(d, mp([(eW * 0.24, eH * 0.90), (eW * 0.64, eH * 0.80), (eW * 0.94, eH * 0.36)]), LINE, LW * 0.75, False)',
'        ink(d, mp([(-eW * 0.52, -eH * 1.10), (eW * 0.06, -eH * 1.34), (eW * 0.68, -eH * 0.98)]),',
'            mix(LINE, SKIN, 0.45), LW * 0.6, False)',
'',
'    # 眉毛 / 鼻子 / 嘴',
'    for br in (-1, 1):',
'        ink(d, [(cx + br * R * 0.24, eyeY - R * 0.52), (cx + br * R * 0.42, eyeY - R * 0.61),',
'                (cx + br * R * 0.58, eyeY - R * 0.50)], mix(H, "#2a1d3c", 0.86), LW * 1.5, False)',
'    ink(d, [(cx + R * 0.035, cy + R * 0.40), (cx + R * 0.005, cy + R * 0.46)], mix(SKIN, SLN, 0.6), LW * 0.7, False)',
'    smile = action in ("smile", "wave", "run", "float")',
'    if smile:',
'        mo = [(cx - R * 0.12, cy + R * 0.68)]',
'        mo += quad((cx - R * 0.12, cy + R * 0.68), (cx, cy + R * 0.88), (cx + R * 0.12, cy + R * 0.68))',
'        mo += quad((cx + R * 0.12, cy + R * 0.68), (cx, cy + R * 0.78), (cx - R * 0.12, cy + R * 0.68))',
'        shape(d, mo, (184, 84, 107), LW * 0.6, (124, 51, 70))',
'    else:',
'        ink(d, [(cx - R * 0.09, cy + R * 0.70), (cx, cy + R * 0.77), (cx + R * 0.09, cy + R * 0.70)],',
'            (193, 103, 125), LW * 0.9, False)',
'',
'    # 前发',
'    cap = [(cx - R * 1.05, cy - R * 0.18)]',
'    cap += bez((cx - R * 1.05, cy - R * 0.18), (cx - R * 1.22, cy - R * 1.16), (cx - R * 0.45, cy - R * 1.46), (cx, cy - R * 1.44))',
'    cap += bez((cx, cy - R * 1.44), (cx + R * 0.45, cy - R * 1.46), (cx + R * 1.22, cy - R * 1.16), (cx + R * 1.05, cy - R * 0.18))',
'    cap += quad((cx + R * 1.05, cy - R * 0.18), (cx, cy - R * 1.02), (cx - R * 1.05, cy - R * 0.18))',
'    shape(d, cap, H, LW * 1.1, HLN)',
'',
'    base = [(cx - R * 1.02, cy - R * 0.22)]',
'    base += bez((cx - R * 1.02, cy - R * 0.22), (cx - R * 1.20, cy - R * 1.10), (cx - R * 0.45, cy - R * 1.44), (cx, cy - R * 1.42))',
'    base += bez((cx, cy - R * 1.42), (cx + R * 0.45, cy - R * 1.44), (cx + R * 1.20, cy - R * 1.10), (cx + R * 1.02, cy - R * 0.22))',
'    base += quad((cx + R * 1.02, cy - R * 0.22), (cx + R * 0.64, cy - R * 0.34), (cx + R * 0.36, cy - R * 0.08))',
'    base += quad((cx + R * 0.36, cy - R * 0.08), (cx + R * 0.12, cy - R * 0.28), (cx - R * 0.12, cy - R * 0.04))',
'    base += quad((cx - R * 0.12, cy - R * 0.04), (cx - R * 0.44, cy - R * 0.28), (cx - R * 0.70, cy - R * 0.06))',
'    base += quad((cx - R * 0.70, cy - R * 0.06), (cx - R * 0.90, cy - R * 0.30), (cx - R * 1.02, cy - R * 0.22))',
'    shape(d, base, H, LW * 0.9, HLN)',
'',
'    bangs = [',
'        (-1.02, -0.96, -1.14, -0.42, -0.94, 0.02, -0.84, 0.12, 0.20),',
'        (-0.74, -1.16, -0.90, -0.54, -0.56, -0.12, -0.46, -0.16, 0.22),',
'        (-0.38, -1.26, -0.56, -0.58, -0.24, -0.02, -0.10, 0.10, 0.24),',
'        (0.02, -1.28, -0.14, -0.60, 0.16, 0.00, 0.30, -0.18, 0.23),',
'        (0.40, -1.20, 0.26, -0.56, 0.54, -0.04, 0.60, 0.10, 0.21),',
'        (0.78, -1.06, 0.82, -0.46, 0.98, 0.00, 1.02, 0.10, 0.19)',
'    ]',
'    for b in bangs:',
'        x0, y0 = cx + b[0] * R, cy + b[1] * R',
'        c1x, c1y = cx + b[2] * R, cy + b[3] * R',
'        c2x, c2y = cx + b[4] * R, cy + b[5] * R',
'        px, py = cx + b[6] * R, cy + b[7] * R',
'        wid = R * b[8]',
'        dx, dy = px - x0, py - y0',
'        ln = math.sqrt(dx * dx + dy * dy) or 1',
'        nx, ny = -dy / ln, dx / ln',
'        lock = [(x0 + nx * wid, y0 + ny * wid)]',
'        lock += quad((x0 + nx * wid, y0 + ny * wid), (c1x + nx * wid * 0.62, c1y + ny * wid * 0.62), (px, py))',
'        lock += quad((px, py), (c2x - nx * wid * 0.62, c2y - ny * wid * 0.62), (x0 - nx * wid, y0 - ny * wid))',
'        shape(d, lock, H, LW * 0.95, HLN)',
'        ink(d, [(cx + b[0] * R * 0.94, cy + b[1] * R * 0.98), (cx + b[2] * R, cy + b[3] * R),',
'                (cx + b[6] * R * 0.98, cy + b[7] * R * 0.96)], mix(HLN, H, 0.55), LW * 0.5, False)',
'',
'    # 侧发',
'    for sl in (-1, 1):',
'        tx, ty = cx + sl * R * 0.92, cy - R * 0.24',
'        ang = sl * sway * 1.1',
'        sp = [(-sl * R * 0.24, 0)]',
'        sp += quad((-sl * R * 0.24, 0), (sl * R * 0.36, R * 0.72), (sl * R * 0.14, R * 1.58))',
'        sp += quad((sl * R * 0.14, R * 1.58), (-sl * R * 0.10, R * 0.74), (-sl * R * 0.38, R * 0.02))',
'        spts = rot(sp, ang, tx, ty)',
'        shape(d, spts, H, LW * 0.95, HLN)',
'        clip_fill(img, spts, rot(ell(sl * R * 0.24, R * 1.05, R * 0.30, R * 0.62, n=18), ang, tx, ty), HS)',
'        ink(d, rot([(0, R * 0.30), (sl * R * 0.10, R * 1.05), (sl * R * 0.02, R * 1.48)], ang, tx, ty),',
'            mix(HLN, H, 0.5), LW * 0.5, False)',
'',
'    # 猫耳',
'    if ch.get("catEars"):',
'        for ce in (-1, 1):',
'            ear = [(cx + ce * R * 0.34, cy - R * 1.00)]',
'            ear += quad((cx + ce * R * 0.34, cy - R * 1.00), (cx + ce * R * 1.04, cy - R * 1.66), (cx + ce * R * 0.94, cy - R * 0.72))',
'            ear += quad((cx + ce * R * 0.94, cy - R * 0.72), (cx + ce * R * 0.64, cy - R * 0.88), (cx + ce * R * 0.34, cy - R * 1.00))',
'            shape(d, ear, H, LW * 1.05, HLN)',
'            inner = [(cx + ce * R * 0.52, cy - R * 0.98)]',
'            inner += quad((cx + ce * R * 0.52, cy - R * 0.98), (cx + ce * R * 0.82, cy - R * 1.32), (cx + ce * R * 0.82, cy - R * 0.86))',
'            d.polygon(inner, fill=(255, 167, 194))',
'',
'    # 天使环高光（分段平涂）',
'    d.arc([cx - R * 0.90, cy - R * 0.90, cx + R * 0.90, cy + R * 0.90], 198, 292, fill=HL, width=max(2, int(R * 0.16)))',
'    d.arc([cx - R * 0.93, cy - R * 0.93, cx + R * 0.93, cy + R * 0.93], 205, 284, fill=(255, 255, 255), width=max(1, int(R * 0.045)))',
'    for hb in range(6):',
'        ha = math.pi * (1.12 + hb * 0.085)',
'        ink(d, [(cx + math.cos(ha) * R * 0.80, cy + math.sin(ha) * R * 0.80),',
'                (cx + math.cos(ha + 0.02) * R * 1.03, cy + math.sin(ha + 0.02) * R * 1.03)], H, R * 0.05, False)',
'',
'    # 呆毛',
'    if ch.get("ahoge"):',
'        tx, ty = cx + R * 0.02, cy - R * 1.40',
'        ang = math.sin(t * 6.2832) * 0.10',
'        aho = [(-R * 0.03, R * 0.04)]',
'        aho += quad((-R * 0.03, R * 0.04), (R * 0.16, -R * 0.44), (R * 0.50, -R * 0.20))',
'        aho += quad((R * 0.50, -R * 0.20), (R * 0.30, -R * 0.26), (R * 0.05, R * 0.06))',
'        shape(d, rot(aho, ang, tx, ty), H, LW * 0.9, HLN)',
'',
'    # 蝴蝶结发饰',
'    if ch.get("bow"):',
'        bx, by, ang = cx - R * 0.80, cy - R * 0.66, -0.18',
'        for bw in (-1, 1):',
'            bp = [(0, 0)]',
'            bp += quad((0, 0), (bw * R * 0.34, -R * 0.28), (bw * R * 0.40, -R * 0.02))',
'            bp += quad((bw * R * 0.40, -R * 0.02), (bw * R * 0.36, R * 0.24), (0, R * 0.06))',
'            shape(d, rot(bp, ang, bx, by), accent, LW * 0.9, LINE)',
'        shape(d, rot(ell(0, R * 0.02, R * 0.085, R * 0.075, n=14), ang, bx, by),',
'              mix(accent, "#ffffff", 0.25), LW * 0.8, LINE)',
'',
'    # 轮廓光',
'    d.arc([cx - R * 1.16, cy - R * 1.16, cx + R * 1.16, cy + R * 1.16], -35, 35,',
'          fill=mix(H, "#ffffff", 0.65), width=max(1, int(R * 0.045)))',
'',
'    # 星芒',
'    for i in range(5):',
'        a = t * 6.2832 * 0.6 + i * 1.25',
'        rr = R * (1.22 + 0.24 * rnd(i + 131, seed))',
'        sparkle(d, cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.9,',
'                R * (0.06 + 0.05 * rnd(i + 141, seed)), mix(H, "#ffffff", 0.45))',
'',
'',
'def draw_abstract(d, spec, t):',
'    w, h = spec["w"], spec["h"]',
'    seed = spec.get("seed") or 1',
'    pal = spec.get("palette") or ["#8ab4ff"]',
'    d.rectangle([0, 0, w, h], fill=rgb(spec.get("bg1") or "#0b1330"))',
'    d.rectangle([0, h * 0.55, w, h], fill=rgb(spec.get("bg2") or "#02040c"))',
'    level = 0',
'    for i in range(5):',
'        level = i',
'        d.polygon([(0, h * (0.42 + i * 0.10)), (w, h * (0.36 + i * 0.10)), (w, h * (0.40 + i * 0.10)),',
'                   (0, h * (0.46 + i * 0.10))], fill=mix(rgb(spec.get("bg1") or "#0b1330"), rgb(pal[0]), 0.06 + i * 0.05))',
'    n = 64',
'    for i in range(n):',
'        a = (i / n) * math.pi * 2 + t * math.pi * 2',
'        rr = min(w, h) * 0.44 * (0.34 + 0.66 * rnd(i, seed)) * (0.78 + 0.22 * math.sin(t * 6.2832 + i * 0.7))',
'        x = w * 0.5 + math.cos(a) * rr * 1.28',
'        y = h * 0.52 + math.sin(a) * rr * 0.9',
'        r = 2 + rnd(i + 50, seed) * 5',
'        disk(d, x, y, r, r, rgb(pal[i % len(pal)]), n=14)',
'',
'',
'def render_frame(spec, t):',
'    w, h = spec["w"], spec["h"]',
'    img = Image.new("RGB", (w, h), rgb(spec.get("bg2") or "#02040c"))',
'    d = ImageDraw.Draw(img)',
'    seed = spec.get("seed") or 1',
'    Rs = min(w, h) * 0.185',
'    style = spec.get("style") or "particles"',
'    if style == "character":',
'        ch = spec.get("char") or {}',
'        draw_bg(d, w, h, ch.get("backdrop") or "studio", t, Rs, seed)',
'    else:',
'        draw_bg(d, w, h, "studio", t, Rs, seed)',
'    if spec.get("grade") == "cinema":',
'        bar = int(h * 0.052)',
'        d.rectangle([0, 0, w, bar], fill=(0, 0, 0))',
'        d.rectangle([0, h - bar, w, h], fill=(0, 0, 0))',
'    if style == "character":',
'        draw_character(d, img, spec, t)',
'    else:',
'        draw_abstract(d, spec, t)',
'    return img',
'',
'',
'def main():',
'    ap = argparse.ArgumentParser(description="二维赛璐璐平涂生视频（Pillow）")',
'    ap.add_argument("--frames", type=int, default=int(SPEC.get("frames") or 36))',
'    ap.add_argument("--fps", type=int, default=int(SPEC.get("fps") or 24))',
'    ap.add_argument("--out", default="scene")',
'    ap.add_argument("--preview", type=int, default=0)',
'    args = ap.parse_args()',
'    spec = dict(SPEC)',
'    spec["frames"] = max(8, args.frames)',
'    spec["fps"] = max(4, args.fps)',
'    outdir = "frames"',
'    os.makedirs(outdir, exist_ok=True)',
'    total = args.preview or spec["frames"]',
'    imgs = []',
'    for i in range(total):',
'        imgs.append(render_frame(spec, i / total))',
'        imgs[-1].save(os.path.join(outdir, "frame_%03d.png" % i))',
'        print("\\r渲染 %d/%d" % (i + 1, total), end="", flush=True)',
'    print()',
'    if not args.preview:',
'        gif = args.out + ".gif"',
'        imgs[0].save(gif, save_all=True, append_images=imgs[1:],',
'                     duration=int(1000 / spec["fps"]), loop=0, disposal=2)',
'        print("GIF: %s · %d×%d · %d 帧 · %d fps" % (gif, spec["w"], spec["h"], total, spec["fps"]))',
'        print("MP4: ffmpeg -framerate %d -i %s/frame_%%03d.png -pix_fmt yuv420p %s.mp4"',
'              % (spec["fps"], outdir, args.out))',
'',
'',
'if __name__ == "__main__":',
'    main()',
''
  ].join('\n');

  function buildPython(s) {
    var json = JSON.stringify(s, null, 2).replace(/'/g, '\\u0027');
    return PY_SOURCE.replace('__SPEC__', json);
  }

  /* ---------------- 帧序列 ---------------- */
  async function renderFramesAsync() {
    if (!spec) return;
    if (busy) return;
    busy = true;
    frameUrls = [];
    frameImgs = [];
    cur = 0;
    stopPlay();
    clearThumbs();
    setStep(1, 'done', '已生成');
    setStep(2, 'run', '渲染中');
    setStep(3, '', '待合成');
    setProgress(0);
    setStatusHint('');
    status('正在把 Python 场景逐帧渲染为 PNG…');
    setExportsEnabled(false);

    var total = spec.frames;
    var urls = [];
    var cv2 = document.createElement('canvas');
    cv2.width = spec.w;
    cv2.height = spec.h;
    var ctx2 = cv2.getContext('2d');
    for (var j = 0; j < total; j++) {
      renderScene(ctx2, spec, j / total);
      urls.push(cv2.toDataURL('image/png'));
      setProgress(Math.round((j + 1) / total * 100));
      if (j % 6 === 5) await sleep(0);
    }

    frameUrls = urls;
    setProgress(100);
    status('正在解码 ' + urls.length + ' 帧…');
    frameImgs = await loadImages(urls);
    setStep(2, 'done', urls.length + ' 帧');
    setStep(3, 'run', '可合成');
    status('帧序列就绪：' + (spec.modelLabel || '') + ' · ' + spec.w + '×' + spec.h + ' · ' + urls.length +
      ' 帧 · ' + spec.fps + ' fps · ' + (Math.round(urls.length / spec.fps * 10) / 10) + ' 秒');
    setExportsEnabled(true);
    renderThumbs();
    el.scrub.max = String(Math.max(0, urls.length - 1));
    el.scrub.value = '0';
    showFrame(0);
    busy = false;
    startPlay();
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function loadImages(urls) {
    return Promise.all(urls.map(function (u) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = u;
      });
    }));
  }

  /* ---------------- 预览 / 播放 ---------------- */
  function showFrame(i) {
    if (!frameImgs.length) return;
    cur = Math.max(0, Math.min(frameImgs.length - 1, i));
    var img = frameImgs[cur];
    var cv = el.preview;
    if (cv.width !== spec.w || cv.height !== spec.h) { cv.width = spec.w; cv.height = spec.h; }
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, spec.w, spec.h);
    if (img) ctx.drawImage(img, 0, 0, spec.w, spec.h);
    el.scrub.value = String(cur);
    el.frameInfo.textContent = (cur + 1) + ' / ' + frameImgs.length;
    el.stageEmpty.hidden = true;
  }

  function startPlay() {
    if (!frameImgs.length || playing) return;
    playing = true;
    lastTick = 0;
    el.playBtn.textContent = '⏸ 暂停';
    var step = 1000 / (spec.fps || 18);
    function tick(ts) {
      if (!playing) return;
      if (!lastTick) lastTick = ts;
      var dt = ts - lastTick;
      if (dt >= step) {
        lastTick = ts - (dt % step);
        showFrame((cur + 1) % frameImgs.length);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopPlay() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (el.playBtn) el.playBtn.textContent = '▶ 播放';
  }

  function clearThumbs() {
    if (el.thumbs) el.thumbs.innerHTML = '';
  }

  function renderThumbs() {
    if (!el.thumbs) return;
    var html = '';
    for (var i = 0; i < frameUrls.length; i++) {
      html += '<img class="hm-gv-thumb" data-frame="' + i + '" src="' + frameUrls[i] + '" alt="帧' + (i + 1) + '">';
    }
    el.thumbs.innerHTML = html;
  }

  /* ---------------- 生成流程 ---------------- */
  function generateCode(opts) {
    var prompt = el.prompt.value.trim() || DEFAULT_PROMPT;
    var themeSel = el.theme ? el.theme.value : 'auto';
    var dim = frameSize();
    spec = compilePrompt(prompt, {
      w: dim.w,
      h: dim.h,
      fps: Number(el.fps.value) || 24,
      frames: Number(el.frames.value) || 36,
      seed: Number(el.seed.value) || 0,
      style: themeSel,
      accent: el.accent ? el.accent.value : '',
      model: el.model ? el.model.value : 'seedance',
      camera: el.camera ? el.camera.value : 'auto',
      motion: el.motion ? Number(el.motion.value) / 100 : 0.8,
      negative: el.neg ? el.neg.value : ''
    });
    code = buildPython(spec);
    el.code.value = code;
    setStep(1, 'done', 'Python 已生成');
    status('已生成 Python 代码（' + spec.modelLabel + ' · ' + spec.w + '×' + spec.h + ' · ' + spec.duration + ' 秒 @ ' + spec.fps + 'fps）');
    setStatusHint('语义解析：' + SHOT_LABELS[spec.shot] + ' · ' + CAM_LABELS[spec.camera.type] +
      ' · ' + (GRADE_LABELS[spec.grade] || spec.grade) +
      (spec.negative ? ' · 已应用反向提示词' : ''));
    renderFramesAsync();
  }

  /* 画幅换算：分辨率下拉给短边，画幅决定宽高比 */
  function frameSize() {
    var shortSide = Number(String(el.res.value || '960x540').split('x')[1]) || 540;
    var aspect = el.aspect ? el.aspect.value : '16:9';
    var w, h;
    if (aspect === '9:16') { w = shortSide; h = Math.round(shortSide * 16 / 9); }
    else if (aspect === '1:1') { w = shortSide; h = shortSide; }
    else if (aspect === '4:3') { w = Math.round(shortSide * 4 / 3); h = shortSide; }
    else { w = Math.round(shortSide * 16 / 9); h = shortSide; }
    return { w: w - (w % 2), h: h - (h % 2) };
  }

  function applyCode() {
    var text = el.code.value.trim();
    if (!text) { toast('代码为空', 'error'); return; }
    var m = text.match(/SPEC\s*=\s*json\.loads\(r'''([\s\S]*?)'''\)/);
    if (!m) { toast('未找到场景规格 SPEC，请使用上方生成或保持格式', 'error'); return; }
    var parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { toast('SPEC 解析失败：' + e.message, 'error'); return; }
    if (!parsed || !parsed.w || !parsed.h) { toast('SPEC 缺少尺寸信息', 'error'); return; }
    spec = parsed;
    spec.frames = Math.min(MAX_FRAMES, Math.max(8, Number(spec.frames) || 36));
    spec.fps = Math.max(4, Number(spec.fps) || 18);
    code = text;
    renderFramesAsync();
  }

  /* ---------------- 导出 ---------------- */
  function safeName() {
    var p = String(el.prompt.value || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 16);
    return p || 'video';
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function exportGif() {
    if (!frameImgs.length || gifBusy) return;
    gifBusy = true;
    var btn = el.exportGif;
    btn.disabled = true;
    btn.textContent = 'GIF 合成中…';
    status('正在合成 GIF（' + (el.gifSize.value || 480) + 'px 宽）…');
    try {
      var gw = Math.min(spec.w, Number(el.gifSize.value) || 480);
      var gh = Math.round(gw * spec.h / spec.w);
      var cvs = document.createElement('canvas');
      cvs.width = gw;
      cvs.height = gh;
      var ctx = cvs.getContext('2d');
      var delay = Math.max(2, Math.round(100 / spec.fps));
      var all = [];
      for (var i = 0; i < frameImgs.length; i++) {
        ctx.clearRect(0, 0, gw, gh);
        if (frameImgs[i]) ctx.drawImage(frameImgs[i], 0, 0, gw, gh);
        var data = ctx.getImageData(0, 0, gw, gh).data;
        var idx = new Uint8Array(gw * gh);
        for (var p = 0, o = 0; p < idx.length; p++, o += 4) {
          idx[p] = ((data[o] >> 5) << 5) | ((data[o + 1] >> 5) << 2) | (data[o + 2] >> 6);
        }
        all.push(idx);
        btn.textContent = 'GIF ' + Math.round((i + 1) / frameImgs.length * 100) + '%';
        if (i % 4 === 3) await sleep(0);
      }
      var bytes = gifEncode(all, gw, gh, delay);
      download(new Blob([bytes], { type: 'image/gif' }), safeName() + '.gif');
      status('GIF 已导出：' + gw + '×' + gh + ' · ' + frameImgs.length + ' 帧');
      toast('GIF 已导出', 'success');
    } catch (e) {
      toast('GIF 导出失败：' + (e && e.message || e), 'error');
    } finally {
      gifBusy = false;
      btn.disabled = false;
      btn.textContent = '导出 GIF';
    }
  }

  function pickVideoMime() {
    var list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < list.length; i++) {
      try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) { /* ignore */ }
    }
    return '';
  }

  function exportVideo() {
    if (!frameImgs.length) return;
    if (!window.MediaRecorder) { toast('当前浏览器不支持视频录制，请改用 GIF', 'error'); return; }
    var mime = pickVideoMime();
    var isMp4 = /mp4/.test(mime);
    var cvs = document.createElement('canvas');
    cvs.width = spec.w;
    cvs.height = spec.h;
    var ctx = cvs.getContext('2d');
    if (!cvs.captureStream) { toast('当前浏览器不支持画布录制，请改用 GIF', 'error'); return; }
    var stream = cvs.captureStream(spec.fps);
    var rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(12000000, Math.max(2000000, spec.w * spec.h * 4)) })
        : new MediaRecorder(stream);
    } catch (e) {
      toast('视频录制初始化失败', 'error');
      return;
    }
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var ext = isMp4 ? 'mp4' : 'webm';
      download(new Blob(chunks, { type: mime || 'video/webm' }), safeName() + '.' + ext);
      status('视频已导出：.' + ext + ' · ' + frameImgs.length + ' 帧');
      toast('视频已导出（.' + ext + '）', 'success');
      el.exportVideo.disabled = false;
      el.exportVideo.textContent = isMp4 ? '导出 MP4' : '导出 WebM';
    };
    el.exportVideo.disabled = true;
    el.exportVideo.textContent = '录制中…';
    status('正在录制 ' + (isMp4 ? 'MP4' : 'WebM') + '…');
    rec.start();
    var i = 0;
    var step = 1000 / spec.fps;
    var timer = setInterval(function () {
      if (i >= frameImgs.length) {
        clearInterval(timer);
        setTimeout(function () { try { rec.stop(); } catch (e) { /* ignore */ } }, 240);
        return;
      }
      ctx.drawImage(frameImgs[i], 0, 0, spec.w, spec.h);
      i++;
    }, step);
  }

  function exportZip() {
    if (!frameUrls.length) return;
    if (!window.JSZip) { toast('ZIP 组件未加载', 'error'); return; }
    status('正在打包 PNG 帧序列…');
    var zip = new window.JSZip();
    frameUrls.forEach(function (u, i) {
      zip.file('frame_' + pad(i) + '.png', String(u).split(',')[1], { base64: true });
    });
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      download(blob, safeName() + '_frames.zip');
      status('已导出 ' + frameUrls.length + ' 张 PNG（ZIP）');
      toast('PNG 帧序列已导出', 'success');
    }, function (err) {
      toast('打包失败：' + (err && err.message || err), 'error');
    });
  }

  function exportPng() {
    if (!frameUrls.length) return;
    var a = document.createElement('a');
    a.href = frameUrls[cur] || frameUrls[0];
    a.download = safeName() + '_frame_' + pad(cur) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('当前帧已导出', 'success');
  }

  function exportPython() {
    if (!code) return;
    download(new Blob([code], { type: 'text/x-python;charset=utf-8' }), safeName() + '_scene_cel.py');
    toast('Python 脚本已导出', 'success');
  }

  /* ---------------- 细节 UI ---------------- */
  function status(msg) { if (el.status) el.status.textContent = msg; }
  function setStatusHint(hint) { if (el.statusHint) el.statusHint.textContent = hint; }
  function setProgress(p) { if (el.progress) el.progress.style.width = Math.max(0, Math.min(100, p)) + '%'; }
  function setStep(n, cls, text) {
    var node = el['step' + n];
    if (!node) return;
    node.classList.remove('is-run', 'is-done');
    if (cls) node.classList.add('is-' + cls);
    var em = node.querySelector('em');
    if (em && text) em.textContent = text;
  }
  function setExportsEnabled(on) {
    [el.exportGif, el.exportVideo, el.exportZip, el.exportPng, el.exportPy].forEach(function (b) {
      if (b) b.disabled = !on;
    });
  }

  /* ---------------- GIF 编码（3-3-2 调色板 + LZW） ---------------- */
  function gifEncode(framesIdx, w, h, delayCs) {
    var out = [];
    function push() { for (var i = 0; i < arguments.length; i++) out.push(arguments[i]); }
    // Header + Logical Screen Descriptor
    push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    push(w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 0xF7, 0x00, 0x00);
    // Global Color Table: 8×8×4 = 256
    for (var r = 0; r < 8; r++) {
      for (var g = 0; g < 8; g++) {
        for (var b = 0; b < 4; b++) {
          push(Math.round(r * 255 / 7), Math.round(g * 255 / 7), Math.round(b * 255 / 3));
        }
      }
    }
    // NETSCAPE 循环扩展
    push(0x21, 0xFF, 0x0B);
    var ns = 'NETSCAPE2.0';
    for (var i = 0; i < ns.length; i++) push(ns.charCodeAt(i));
    push(0x03, 0x01, 0x00, 0x00, 0x00);

    for (var f = 0; f < framesIdx.length; f++) {
      // Graphic Control Extension
      push(0x21, 0xF9, 0x04, 0x04, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00);
      // Image Descriptor
      push(0x2C, 0x00, 0x00, 0x00, 0x00, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 0x00);
      var data = lzwEncode(framesIdx[f], 8);
      push(0x08);
      var pos = 0;
      while (pos < data.length) {
        var chunk = Math.min(255, data.length - pos);
        push(chunk);
        for (var c = 0; c < chunk; c++) push(data[pos + c]);
        pos += chunk;
      }
      push(0x00);
    }
    push(0x3B);
    return out;
  }

  function lzwEncode(indices, minCodeSize) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var nextCode = eoiCode + 1;
    var dict = new Map();
    var out = [];
    var curByte = 0, curBits = 0;
    function emit(code) {
      curByte |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) {
        out.push(curByte & 0xff);
        curByte >>= 8;
        curBits -= 8;
      }
      // GIF 解码表比编码表慢一拍：码宽应在本次写出后、下一次写出前提升
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    }
    emit(clearCode);
    var code = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var key = code * 512 + k;
      var found = dict.get(key);
      if (found !== undefined) {
        code = found;
      } else {
        emit(code);
        if (nextCode < 4096) {
          dict.set(key, nextCode);
          nextCode++;
        } else {
          emit(clearCode);
          dict = new Map();
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
        }
        code = k;
      }
    }
    emit(code);
    emit(eoiCode);
    while (curBits > 0) { out.push(curByte & 0xff); curByte >>= 8; curBits -= 8; }
    return out;
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    if (inited) return;
    inited = true;
    el.prompt = $('gvPrompt');
    el.theme = $('gvTheme');
    el.res = $('gvRes');
    el.frames = $('gvFrames');
    el.framesVal = $('gvFramesVal');
    el.fps = $('gvFps');
    el.seed = $('gvSeed');
    el.accent = $('gvAccent');
    el.genBtn = $('gvGen');
    el.ideaBtn = $('gvIdea');
    el.applyBtn = $('gvApply');
    el.code = $('gvCode');
    el.preview = $('gvPreview');
    el.stageEmpty = $('gvStageEmpty');
    el.playBtn = $('gvPlay');
    el.scrub = $('gvScrub');
    el.frameInfo = $('gvFrameInfo');
    el.thumbs = $('gvThumbs');
    el.status = $('gvStatus');
    el.statusHint = $('gvStatusHint');
    el.progress = $('gvProgress');
    el.step1 = $('gvStep1');
    el.step2 = $('gvStep2');
    el.step3 = $('gvStep3');
    el.exportGif = $('gvGif');
    el.exportVideo = $('gvVideo');
    el.exportZip = $('gvZip');
    el.exportPng = $('gvPng');
    el.exportPy = $('gvPy');
    el.gifSize = $('gvGifSize');
    el.back = $('gvBack');
    el.model = $('gvModel');
    el.camera = $('gvCamera');
    el.duration = $('gvDuration');
    el.aspect = $('gvAspect');
    el.neg = $('gvNeg');
    el.motion = $('gvMotion');
    el.motionVal = $('gvMotionVal');

    function syncFramesFromDuration() {
      var fps = Number(el.fps.value) || 24;
      var dur = Number(el.duration.value) || 3;
      var f = Math.min(MAX_FRAMES, Math.max(8, Math.round(fps * dur)));
      el.frames.value = String(f);
      el.framesVal.textContent = String(f);
    }
    function safeRegen() {
      if (busy) { setStatusHint('渲染中，完成后再点「生成 Python 代码」应用新设置'); return; }
      generateCode();
    }

    el.genBtn.addEventListener('click', function () { if (!busy) generateCode(); });
    el.ideaBtn.addEventListener('click', randomIdea);
    el.applyBtn.addEventListener('click', function () { if (!busy) applyCode(); });
    el.frames.addEventListener('input', function () {
      el.framesVal.textContent = el.frames.value;
    });
    el.model.addEventListener('change', function () {
      el.fps.value = String(modelProfile(el.model.value).fps);
      syncFramesFromDuration();
      safeRegen();
    });
    el.camera.addEventListener('change', safeRegen);
    el.aspect.addEventListener('change', safeRegen);
    el.duration.addEventListener('change', function () { syncFramesFromDuration(); safeRegen(); });
    el.fps.addEventListener('change', function () { syncFramesFromDuration(); safeRegen(); });
    el.motion.addEventListener('input', function () { el.motionVal.textContent = el.motion.value; });
    el.motion.addEventListener('change', safeRegen);
    el.playBtn.addEventListener('click', function () { if (playing) stopPlay(); else startPlay(); });
    el.scrub.addEventListener('input', function () { stopPlay(); showFrame(Number(el.scrub.value) || 0); });
    el.thumbs.addEventListener('click', function (e) {
      var t = e.target.closest('[data-frame]');
      if (!t) return;
      stopPlay();
      showFrame(Number(t.getAttribute('data-frame')) || 0);
    });
    el.exportGif.addEventListener('click', exportGif);
    el.exportVideo.addEventListener('click', exportVideo);
    el.exportZip.addEventListener('click', exportZip);
    el.exportPng.addEventListener('click', exportPng);
    el.exportPy.addEventListener('click', exportPython);
    el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });

    syncFramesFromDuration();
    var mime = pickVideoMime();
    el.exportVideo.textContent = /mp4/.test(mime) ? '导出 MP4' : '导出 WebM';
    el.exportVideo.title = /mp4/.test(mime)
      ? '使用浏览器原生 MP4 编码导出'
      : '当前浏览器仅支持 WebM 编码（可直接上传或转码为 MP4）';
    setExportsEnabled(false);
  }

  var IDEAS = [
    '白毛萝莉，红色蝴蝶结，樱花缓缓飘落',
    '银发双马尾少女，猫耳，霓虹灯下微笑',
    '金发少女穿水手服，教室窗边回眸',
    '黑长直女孩，红瞳，星空背景',
    '深蓝夜空里，星光粒子缓缓汇聚成一颗发光的星球',
    '霓虹城市雨夜，粉蓝色灯带在楼群间流动',
    '像素方块随节拍跳动，呈现几何节奏动画',
    '海面波浪层层推进，青蓝色水纹不断翻涌',
    '紫罗兰色涟漪从中心扩散，如同心跳的脉动',
    '行星环绕恒星旋转，拖出细碎光轨',
    '金色烟花在夜空连续绽放，火星随风飘落'
  ];

  function randomIdea() {
    var cur = el.prompt.value.trim();
    var idx = 0;
    for (var i = 0; i < IDEAS.length; i++) if (IDEAS[i] === cur) { idx = i; break; }
    var next = IDEAS[(idx + 1) % IDEAS.length];
    el.prompt.value = next;
    el.seed.value = String((hashStr(next) % 99991));
    if (!busy) generateCode();
  }

  /* ---------------- 生命周期 ---------------- */
  function enter() {
    init();
    if (!code) {
      el.prompt.value = DEFAULT_PROMPT;
      el.seed.value = '';
      generateCode();
    } else {
      showFrame(cur);
    }
  }

  function leave() {
    stopPlay();
  }

  return { init: init, enter: enter, leave: leave };
})();
