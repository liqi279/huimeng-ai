/* ============================================================
 * 动漫生图工坊 HMTOOLIMAGE（WebUI 式桌面 · 纯本地渲染）
 * 流程：提示词 + Checkpoint → LoRA 叠加 → 本地逐笔渲染 PNG
 * 画风：日式赛璐璐二维平涂 / 半厚涂 / 厚涂
 * 不调用付费接口，不消耗积分。
 * ============================================================ */
window.HMToolImage = (function () {
  'use strict';

  var CKPTS = [
    { id: 'anything-v5', name: 'Anything V5', family: 'SD1.5 · 二次元通用', site: 'HuggingFace',
      url: 'https://huggingface.co/stablediffusionapi/anything-v5',
      note: '泛用二次元底模，线条干净、配色通透',
      look: { line: '#33243f', contrast: 1.00, soft: 0.10, sat: 1.00 } },
    { id: 'counterfeit-v3', name: 'Counterfeit V3.0', family: 'SD1.5 · 日式赛璐璐', site: 'HuggingFace',
      url: 'https://huggingface.co/gsdf/Counterfeit-V3.0',
      note: '传统日式赛璐璐，硬边阴影与细线稿',
      look: { line: '#2a1d33', contrast: 1.05, soft: 0.02, sat: 1.04 } },
    { id: 'meinamix', name: 'MeinaMix V11', family: 'SD1.5 · 柔和动漫', site: 'HuggingFace',
      url: 'https://huggingface.co/Meina/MeinaMix',
      note: '柔和过渡，适合半厚涂与粉彩',
      look: { line: '#443650', contrast: 0.93, soft: 0.32, sat: 1.00 } },
    { id: 'anilora', name: 'AnyLoRA', family: 'SD1.5 · 线稿清晰', site: 'HuggingFace',
      url: 'https://huggingface.co/Lykon/AnyLoRA',
      note: '干净线稿与大面积平涂',
      look: { line: '#241a2e', contrast: 1.02, soft: 0.06, sat: 1.00 } },
    { id: 'aom3', name: 'AbyssOrangeMix3', family: 'SD1.5 · 高饱和', site: 'HuggingFace',
      url: 'https://huggingface.co/WarpRealm/AbyssOrangeMix3',
      note: '高饱和厚涂质感与强对比',
      look: { line: '#2a1526', contrast: 1.08, soft: 0.22, sat: 1.16 } },
    { id: 'pony-v6', name: 'Pony Diffusion V6 XL', family: 'SDXL · 风格化', site: 'Civitai',
      url: 'https://civitai.com/models/257749',
      note: '强烈风格化，厚涂与平涂都能吃',
      look: { line: '#33204a', contrast: 1.06, soft: 0.18, sat: 1.10 } },
    { id: 'animagine-xl', name: 'Animagine XL 4.0', family: 'SDXL · 动漫插画', site: 'Civitai',
      url: 'https://civitai.com/models/1181119',
      note: '细节丰富的动漫插画底模',
      look: { line: '#2b2038', contrast: 1.00, soft: 0.12, sat: 1.04 } },
    { id: 'dreamshaper-anime', name: 'DreamShaper Anime', family: 'SD1.5 · 半写实', site: 'Civitai',
      url: 'https://civitai.com/models/4384',
      note: '半写实光影，适合厚涂笔触',
      look: { line: '#4a3b52', contrast: 0.95, soft: 0.40, sat: 1.05 } }
  ];

  var LORAS = [
    { id: 'cel', name: 'Cel Shading Flat', site: 'Civitai', url: 'https://civitai.com/models/169936',
      desc: '强化硬边平涂与阴影分界', w: 0.80, fx: { hard: 0.35, line: 1.05, soft: -0.20 } },
    { id: 'japan-cel', name: 'Japanese Animation', site: 'Civitai', url: 'https://civitai.com/models/119229',
      desc: '日式作画阴影与一层高光', w: 0.70, fx: { hard: 0.25, line: 1.08, soft: -0.10 } },
    { id: 'semi-thick', name: 'Semi-Realistic Paint', site: 'Civitai', url: 'https://civitai.com/models/7933',
      desc: '体积感与柔和过渡（半厚涂）', w: 0.70, fx: { soft: 0.35, hard: -0.15, texture: 1.0 } },
    { id: 'impasto', name: 'Oil Impasto Brush', site: 'LiblibAI', url: 'https://www.liblib.art/',
      desc: '厚涂堆叠笔触与画布质感', w: 0.80, fx: { soft: 0.50, texture: 2.0, hard: -0.25 } },
    { id: 'lineart', name: 'Lineart Sharp', site: 'HuggingFace', url: 'https://huggingface.co/',
      desc: '加粗并锐化角色轮廓线', w: 0.60, fx: { line: 1.25 } },
    { id: 'detail', name: 'Anime Detail Tweaker', site: 'Civitai', url: 'https://civitai.com/models/122359',
      desc: '发丝、衣褶与瞳孔细节增强', w: 0.70, fx: { detail: 1.4, line: 1.05 } },
    { id: 'glow', name: 'Backlight Glow', site: 'Civitai', url: 'https://civitai.com/models/16271',
      desc: '逆光轮廓光与体积光', w: 0.65, fx: { glow: 0.60 } },
    { id: 'sakura', name: 'Sakura Petals', site: 'LiblibAI', url: 'https://www.liblib.art/',
      desc: '樱花飘落与花瓣前景', w: 0.80, fx: { petals: 1.0 } },
    { id: 'pastel', name: 'Pastel Soft', site: 'HuggingFace', url: 'https://huggingface.co/',
      desc: '降低对比、粉彩倾向', w: 0.70, fx: { soft: 0.20, sat: 0.90 } },
    { id: 'eyes', name: 'Detailed Eyes', site: 'Civitai', url: 'https://civitai.com/models/18086',
      desc: '瞳孔高光与虹膜层次', w: 0.75, fx: { eyes: 1.0 } }
  ];

  var SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DDIM', 'UniPC'];
  var STYLES = {
    cel: { label: '日式赛璐璐二维平涂', short: '赛璐璐平涂' },
    semi: { label: '半厚涂', short: '半厚涂' },
    impasto: { label: '厚涂', short: '厚涂' }
  };

  var HAIR_COLORS = [
    { c: '#f6f8ff', s: '#c7d1f0', k: ['白毛', '白发', '银发', '银毛', '雪白', 'white hair', 'silver hair'] },
    { c: '#2f2a42', s: '#171326', k: ['黑毛', '黑发', '黑长直', 'black hair'] },
    { c: '#ffd66b', s: '#dca42c', k: ['金毛', '金发', '黄发', 'blonde', 'gold hair'] },
    { c: '#ff9fd0', s: '#e06aa8', k: ['粉毛', '粉发', '粉色头发', 'pink hair'] },
    { c: '#79c6ff', s: '#3f8ede', k: ['蓝毛', '蓝发', '水色发', 'blue hair'] },
    { c: '#c4a6ff', s: '#8f68e6', k: ['紫毛', '紫发', 'purple hair'] },
    { c: '#ff8f8f', s: '#d65a5a', k: ['红毛', '红发', 'red hair'] },
    { c: '#c28d5f', s: '#8d5b31', k: ['棕发', '茶发', '褐发', 'brown hair'] },
    { c: '#9fe8b0', s: '#5dbd7a', k: ['绿毛', '绿发', 'green hair'] },
    { c: '#cdd4e4', s: '#98a2ba', k: ['灰毛', '灰发', '银灰', 'grey hair', 'gray hair'] }
  ];
  var EYE_COLORS = [
    { c: '#ff5e6c', k: ['红瞳', '红眼', '血瞳', 'red eye'] },
    { c: '#ffc24a', k: ['金瞳', '黄瞳', '琥珀瞳', 'gold eye'] },
    { c: '#b48bff', k: ['紫瞳', '紫眼', 'violet eye'] },
    { c: '#4fd88a', k: ['绿瞳', '绿眼', 'green eye'] },
    { c: '#5aa9ff', k: ['蓝瞳', '蓝眼', 'blue eye'] }
  ];
  var BACKDROPS = [
    { id: 'sakura', k: ['樱花', '花瓣', 'sakura'] },
    { id: 'night', k: ['星空', '夜空', '星', '夜', 'night', 'star'] },
    { id: 'city', k: ['城市', '霓虹', '赛博', '街', 'city', 'neon', 'cyber'] },
    { id: 'room', k: ['教室', '房间', '室内', '窗边', '窗', 'room', 'classroom'] },
    { id: 'sea', k: ['海', '沙滩', '海边', 'sea', 'beach'] },
    { id: 'forest', k: ['森林', '树下', '草地', '自然', 'forest'] }
  ];

  var state = {
    style: 'cel',
    ckpt: 'anything-v5',
    loras: [],
    seed: 0,
    w: 768, h: 1024,
    sampler: 'DPM++ 2M Karras',
    steps: 28,
    cfg: 7,
    prompt: '白毛萝莉，猫耳，水手服，樱花缓缓飘落',
    neg: 'lowres, bad anatomy, extra fingers, watermark, text',
    generated: false,
    look: null,
    palette: null,
    R: 1
  };

  var el = {};
  var inited = false;
  var bound = false;
  var timer = null;
  var history = [];

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------------- 颜色工具 ---------------- */
  function rgbOf(hex) {
    if (typeof hex !== 'string') return [0, 0, 0];
    var s = hex.trim();
    var m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(',');
      return [parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0];
    }
    var h = s.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  function hexOf(r, g, b) {
    function p(v) {
      if (!isFinite(v)) v = 0;
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }
    return '#' + p(r) + p(g) + p(b);
  }
  function mix(a, b, t) {
    var A = rgbOf(a), B = rgbOf(b);
    return hexOf(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function alpha(hex, a) {
    var c = rgbOf(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function adjust(hex) {
    var look = state.look || { sat: 1, contrast: 1 };
    var c = rgbOf(hex);
    var avg = (c[0] + c[1] + c[2]) / 3;
    for (var i = 0; i < 3; i++) {
      c[i] = avg + (c[i] - avg) * look.sat;
      c[i] = 128 + (c[i] - 128) * look.contrast;
    }
    return hexOf(c[0], c[1], c[2]);
  }

  /* ---------------- 确定性随机 ---------------- */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------------- 几何 ---------------- */
  function quadC(p0, p1, p2, n) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return out;
  }
  function ellPts(cx, cy, rx, ry, rot, n) {
    var out = [], ca = Math.cos(rot || 0), sa = Math.sin(rot || 0);
    for (var i = 0; i < n; i++) {
      var a = Math.PI * 2 * i / n;
      var x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      out.push([cx + x * ca - y * sa, cy + x * sa + y * ca]);
    }
    return out;
  }
  function bbox(pts) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][0] < x0) x0 = pts[i][0];
      if (pts[i][1] < y0) y0 = pts[i][1];
      if (pts[i][0] > x1) x1 = pts[i][0];
      if (pts[i][1] > y1) y1 = pts[i][1];
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  var ctx = null;

  function pathPts(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function strokesIn(box, color, count, rand, len, width, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    for (var i = 0; i < count; i++) {
      var x = box.x + rand() * box.w, y = box.y + rand() * box.h;
      var ang = rand() * Math.PI * 2;
      var l = len * (0.5 + rand() * 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 统一绘制：按画风决定底色 / 阴影 / 高光 / 线稿 */
  function paint(pts, base, shade, opt) {
    if (!pts || pts.length < 3) return;
    var look = state.look;
    opt = opt || {};
    var bb = bbox(pts);
    var lw = state.R * 0.030 * look.lineW;

    ctx.save();
    pathPts(pts);
    if (look.soft > 0.45) {
      var g = ctx.createLinearGradient(0, bb.y, 0, bb.y + Math.max(1, bb.h));
      g.addColorStop(0, mix(base, '#ffffff', 0.16 * look.soft));
      g.addColorStop(0.55, base);
      g.addColorStop(1, mix(base, '#1a1226', 0.18 * look.soft));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = base;
    }
    ctx.fill();

    ctx.save();
    pathPts(pts);
    ctx.clip();

    if (opt.shadow) {
      var s = opt.shadow, sc = opt.shade || shade;
      ctx.fillStyle = sc;
      if (look.hard < 0.5 && look.soft > 0.3) {
        for (var k = 3; k >= 1; k--) {
          ctx.globalAlpha = 0.16 + (3 - k) * 0.10;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, s.rx * (1 + k * 0.15), s.ry * (1 + k * 0.15), s.rot || 0, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = s.alpha === undefined ? 1 : s.alpha;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.rx, s.ry, s.rot || 0, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (opt.light) {
      var li = opt.light;
      ctx.globalAlpha = look.hard > 0.5 ? 0.90 : (0.30 + look.soft * 0.18);
      ctx.fillStyle = li.color || mix(base, '#ffffff', 0.72);
      ctx.beginPath();
      ctx.ellipse(li.x, li.y, li.rx, li.ry, li.rot || 0, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (look.texture > 0.25) {
      var r2 = rng(state.seed + 131);
      strokesIn(bb, mix(base, '#ffffff', 0.30), Math.round(20 * look.texture), r2, state.R * 0.30, state.R * 0.055, 0.11 * look.texture);
      strokesIn(bb, mix(base, '#1a1226', 0.40), Math.round(18 * look.texture), r2, state.R * 0.34, state.R * 0.045, 0.10 * look.texture);
    }
    ctx.restore();

    if (look.outline && lw > 0.3) {
      ctx.strokeStyle = opt.line || state.palette.line;
      ctx.lineWidth = Math.max(1, lw);
      ctx.lineJoin = 'round';
      pathPts(pts);
      ctx.stroke();
    } else if (look.texture > 0.3) {
      // 厚涂：不画硬线，用柔边暗部收住轮廓，避免与浅背景糊在一起
      ctx.strokeStyle = alpha(mix(base, '#1a1226', 0.55), 0.22 + look.texture * 0.12);
      ctx.lineWidth = Math.max(1.4, state.R * 0.018);
      ctx.lineJoin = 'round';
      pathPts(pts);
      ctx.stroke();
    }
    ctx.restore();
  }

  function fillPts(pts, color, a) {
    ctx.save();
    ctx.globalAlpha = a === undefined ? 1 : a;
    pathPts(pts);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function strokeLine(pts, color, w, a) {
    ctx.save();
    ctx.globalAlpha = a === undefined ? 1 : a;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, w);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 提示词解析 ---------------- */
  function hasAny(text, keys) {
    for (var i = 0; i < keys.length; i++) if (text.indexOf(keys[i]) >= 0) return true;
    return false;
  }

  function compile(prompt) {
    var text = String(prompt || '').toLowerCase();
    var hair = null, eye = null;
    for (var i = 0; i < HAIR_COLORS.length && !hair; i++) {
      if (hasAny(text, HAIR_COLORS[i].k)) hair = HAIR_COLORS[i];
    }
    for (var j = 0; j < EYE_COLORS.length && !eye; j++) {
      if (hasAny(text, EYE_COLORS[j].k)) eye = EYE_COLORS[j];
    }
    if (!hair) hair = { c: '#f2f4ff', s: '#c6cff0' };
    var back = null;
    for (var b = 0; b < BACKDROPS.length && !back; b++) {
      if (hasAny(text, BACKDROPS[b].k)) back = BACKDROPS[b];
    }
    var outfit = 'dress';
    if (hasAny(text, ['校服', '水手服', '制服', 'jk', 'sailor', 'school uniform'])) outfit = 'sailor';
    else if (hasAny(text, ['女仆', 'maid'])) outfit = 'maid';
    else if (hasAny(text, ['和服', '浴衣', 'kimono', 'yukata'])) outfit = 'kimono';

    var isScene = !hasAny(text, ['少女', '女孩', '女生', '男孩', '少年', '人物', '角色', '立绘', '头像', '二次元',
      '萝莉', 'loli', 'girl', 'anime', 'character', 'waifu', 'neko', '猫娘', '猫耳']) &&
      hasAny(text, ['风景', '海边', '天空', '森林', '城市', '山', '夕阳', 'landscape', 'scenery']);

    var accent = mix(eye ? eye.c : '#8ab4ff', '#ff5c86', 0.55);
    return {
      hair: hair.c,
      shade: hair.s,
      eye: eye ? eye.c : '#8ab4ff',
      dress: outfit === 'sailor' ? '#2b3f6e' : (outfit === 'maid' ? '#3a3550' : '#7c9cd9'),
      dressShade: outfit === 'sailor' ? '#1b2a4d' : '#4c6b9c',
      outfit: outfit,
      twin: hasAny(text, ['双马尾', '双尾', '双辫', 'twintail', 'twin tail', 'pigtail']),
      catEars: hasAny(text, ['猫耳', '猫娘', 'neko', 'catgirl']),
      ahoge: hasAny(text, ['呆毛', 'ahoge', '翘毛']),
      chibi: hasAny(text, ['萝莉', 'loli', '幼女', 'chibi', 'q版']),
      bow: hasAny(text, ['蝴蝶结', '发带', '发饰', '头饰', 'ribbon', 'bow']) || hasAny(text, ['少女', 'girl', '萝莉', 'loli']),
      backdrop: back ? back.id : 'studio',
      isScene: isScene,
      accent: accent,
      line: mix(hair.c, '#2a1d3c', 0.88)
    };
  }

  /* ---------------- 画风参数 ---------------- */
  function resolveLook() {
    var ck = null;
    for (var i = 0; i < CKPTS.length; i++) if (CKPTS[i].id === state.ckpt) ck = CKPTS[i];
    if (!ck) ck = CKPTS[0];
    var l = { hard: 1, soft: 0, texture: 0, lineW: 1, outline: true,
      glow: 0, petals: 0, detail: 0, eyes: 0, sat: 1, contrast: 1,
      line: ck.look.line };
    if (state.style === 'semi') { l.hard = 0.25; l.soft = 0.62; l.texture = 0.22; l.lineW = 0.60; l.outline = true; }
    else if (state.style === 'impasto') { l.hard = 0; l.soft = 0.86; l.texture = 1; l.lineW = 0; l.outline = false; }

    l.soft += ck.look.soft || 0;
    l.sat *= ck.look.sat || 1;
    l.contrast *= ck.look.contrast || 1;

    for (var k = 0; k < state.loras.length; k++) {
      var item = state.loras[k], meta = null;
      for (var m = 0; m < LORAS.length; m++) if (LORAS[m].id === item.id) meta = LORAS[m];
      if (!meta) continue;
      var fx = meta.fx, w = item.weight;
      if (fx.hard) l.hard += fx.hard * w;
      if (fx.soft) l.soft += fx.soft * w;
      if (fx.texture) l.texture += fx.texture * w * 0.5;
      if (fx.line) l.lineW *= (1 + (fx.line - 1) * w);
      if (fx.glow) l.glow += fx.glow * w;
      if (fx.petals) l.petals += fx.petals * w;
      if (fx.detail) l.detail += fx.detail * w;
      if (fx.eyes) l.eyes += fx.eyes * w;
      if (fx.sat) l.sat *= (1 + (fx.sat - 1) * w);
    }
    l.hard = Math.max(0, Math.min(1, l.hard));
    l.soft = Math.max(0, Math.min(1, l.soft));
    l.texture = Math.max(0, Math.min(1.6, l.texture));
    l.lineW = Math.max(0, Math.min(1.5, l.lineW));
    l.outline = l.lineW > 0.22;
    return l;
  }

  /* ---------------- 背景 ---------------- */
  function band(x, y, w, h, c1, c2) {
    if (state.look.soft > 0.45 && c2) {
      var g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = c1;
    }
    ctx.fillRect(x, y, w, h);
  }

  function softCircle(x, y, r, c, a) {
    ctx.save();
    ctx.globalAlpha = a === undefined ? 1 : a;
    if (state.look.soft > 0.45) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, alpha(c, 0));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = c;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function drawBg(kind, w, h, rand) {
    var look = state.look;
    if (kind === 'sakura') {
      band(0, 0, w, h * 0.30, '#a6d4ff', '#d6eeff');
      band(0, h * 0.30, w, h * 0.34, '#ffe6ef', '#fff3f8');
      band(0, h * 0.64, w, h * 0.36, '#fff8f2', '#fffdfb');
      for (var i = 0; i < 5; i++) {
        var x = w * (0.10 + rand() * 0.80), y = h * (0.10 + rand() * 0.22), r = w * 0.13;
        softCircle(x, y, r, '#ffe9f2', 0.9);
        softCircle(x + r * 0.25, y - r * 0.12, r * 0.7, '#fff8fb', 0.9);
      }
      for (var p = 0; p < 10; p++) {
        softCircle(rand() * w, rand() * h * 0.55, 5 + rand() * 9, '#ffc2d9', 0.8);
      }
    } else if (kind === 'night') {
      band(0, 0, w, h * 0.42, '#101a42', '#1b2452');
      band(0, h * 0.42, w, h * 0.28, '#25245a', '#2c2b62');
      band(0, h * 0.70, w, h * 0.30, '#3a2c58', '#473566');
      var mx = w * 0.74, my = h * 0.22, mr = h * 0.062;
      softCircle(mx, my, mr * 3.2, alpha('#fff4d6', 0.20), 1);
      softCircle(mx, my, mr * 1.9, alpha('#fff4d6', 0.35), 1);
      softCircle(mx, my, mr, '#fff6dc', 1);
      for (var s = 0; s < 60; s++) {
        ctx.globalAlpha = 0.4 + rand() * 0.6;
        ctx.fillStyle = s % 5 === 0 ? '#ffe9b8' : '#dbe7ff';
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h * 0.62, 1 + rand() * 1.7, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (var b = 0; b < 8; b++) {
        var bw = w * 0.11, bh = h * (0.08 + rand() * 0.14);
        ctx.fillStyle = '#141c38';
        ctx.fillRect(b * w * 0.13 - w * 0.02, h * 0.74 - bh, bw, bh + h * 0.30);
      }
    } else if (kind === 'city') {
      band(0, 0, w, h * 0.34, '#2a1745', '#3b1e58');
      band(0, h * 0.34, w, h * 0.30, '#6d2a63', '#7c3370');
      band(0, h * 0.64, w, h * 0.36, '#1a0e2c', '#241238');
      for (var c = 0; c < 9; c++) {
        var cw = w * 0.12, ch = h * (0.16 + rand() * 0.22);
        ctx.fillStyle = '#25123d';
        ctx.fillRect(c * w * 0.115 - w * 0.02, h * 0.66 - ch, cw, ch + h * 0.34);
        for (var n = 0; n < 4; n++) {
          ctx.fillStyle = rand() > 0.45 ? '#ffcf7a' : '#7ce7ff';
          ctx.fillRect(c * w * 0.115 + w * 0.012, h * 0.66 - ch + n * h * 0.05, cw * 0.20, h * 0.022);
        }
      }
    } else if (kind === 'room') {
      band(0, 0, w, h * 0.58, '#fff5e2', '#f7e5cd');
      band(0, h * 0.58, w, h * 0.42, '#f4dcc0', '#e8c8a8');
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(w * 0.52, h * 0.10, w * 0.34, h * 0.32);
      ctx.strokeStyle = '#c2a98c';
      ctx.lineWidth = Math.max(2, w * 0.008);
      ctx.strokeRect(w * 0.52, h * 0.10, w * 0.34, h * 0.32);
      ctx.beginPath();
      ctx.moveTo(w * 0.69, h * 0.10); ctx.lineTo(w * 0.69, h * 0.42);
      ctx.moveTo(w * 0.52, h * 0.26); ctx.lineTo(w * 0.86, h * 0.26);
      ctx.stroke();
    } else if (kind === 'sea') {
      band(0, 0, w, h * 0.38, '#bfe9ff', '#e7f8ff');
      band(0, h * 0.38, w, h * 0.20, '#f7fcff', '#ffffff');
      band(0, h * 0.58, w, h * 0.42, '#74cbe3', '#2f8eb8');
      softCircle(w * 0.22, h * 0.20, h * 0.14, '#fff6d9', 0.85);
      for (var wv = 0; wv < 6; wv++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(2, h * 0.006);
        ctx.beginPath();
        ctx.arc(w * (0.1 + wv * 0.16), h * (0.70 + (wv % 2) * 0.06), w * 0.09, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
    } else if (kind === 'forest') {
      band(0, 0, w, h * 0.36, '#e9f7dd', '#f5fbef');
      band(0, h * 0.36, w, h * 0.28, '#cfe9c0', '#dff1d2');
      band(0, h * 0.64, w, h * 0.36, '#a9cf9c', '#bcdcaa');
      for (var t = 0; t < 7; t++) {
        var tx = w * (0.05 + t * 0.15), th = h * (0.16 + rand() * 0.12);
        ctx.fillStyle = '#8fbd82';
        ctx.beginPath();
        ctx.moveTo(tx, h * 0.60 - th);
        ctx.lineTo(tx - w * 0.07, h * 0.62);
        ctx.lineTo(tx + w * 0.07, h * 0.62);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      band(0, 0, w, h, '#e8ddff', '#d6c8f2');
      var rings = ['#b9a9e0', '#d6c8f2', '#e8ddff', '#ffeaf4'];
      for (var g2 = 0; g2 < 4; g2++) {
        softCircle(w * 0.5, h * 0.36, h * 0.30 + g2 * h * 0.12, rings[g2], 1);
      }
    }

    if (look.texture > 0.3) {
      strokesIn({ x: 0, y: 0, w: w, h: h }, '#ffffff', Math.round(70 * look.texture), rand, w * 0.05, w * 0.004, 0.07 * look.texture);
    }
  }

  function drawSceneBg(w, h, rand) {
    var kind = state.palette.backdrop;
    if (kind === 'studio') {
      band(0, 0, w, h * 0.55, '#efe3ff', '#e2d3ff');
      band(0, h * 0.55, w, h * 0.45, '#f7ecff', '#efe2ff');
      softCircle(w * 0.5, h * 0.32, h * 0.34, '#d9c7f4', 0.9);
      softCircle(w * 0.5, h * 0.32, h * 0.24, '#ffe6f2', 0.95);
      for (var r = 0; r < 12; r++) {
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#ffffff';
        ctx.translate(w * 0.5, h * 0.32);
        ctx.rotate(r * Math.PI / 6);
        ctx.fillRect(-w * 0.5, -h * 0.02, w * 1.0, h * 0.04);
        ctx.restore();
      }
    } else {
      drawBg(kind, w, h, rand);
    }
  }

  /* ---------------- 角色 ---------------- */
  function lockPts(x0, y0, c1x, c1y, tx, ty, w) {
    var pts = [[x0 - w, y0]];
    pts = pts.concat(quadC([x0 - w, y0], [c1x - w * 0.55, c1y], [tx, ty], 10));
    pts = pts.concat(quadC([tx, ty], [c1x + w * 0.70, c1y + (ty - y0) * 0.40], [x0 + w, y0], 10));
    return pts;
  }

  function drawEye(ex, ey, rx, ry, iris, rand, outer) {
    var look = state.look, lw = state.R * 0.026;
    ctx.save();

    // 眼白
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx, ry, 0, 0, 6.2832);
    ctx.fillStyle = '#fcfcff';
    ctx.fill();

    // 虹膜（裁剪在眼白内）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx, ry, 0, 0, 6.2832);
    ctx.clip();
    var irx = rx * 0.76, iry = ry * 0.84, icy = ey + ry * 0.10;

    if (look.soft > 0.45) {
      var g = ctx.createLinearGradient(0, icy - iry, 0, icy + iry);
      g.addColorStop(0, mix(iris, '#101726', 0.55));
      g.addColorStop(0.45, iris);
      g.addColorStop(0.80, mix(iris, '#ffffff', 0.35));
      g.addColorStop(1, mix(iris, '#ffffff', 0.62));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(ex, icy, irx, iry, 0, 0, 6.2832);
      ctx.fill();
    } else {
      ctx.fillStyle = mix(iris, '#181029', 0.42);
      ctx.beginPath();
      ctx.ellipse(ex, icy, irx, iry, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.ellipse(ex, icy + iry * 0.10, irx * 0.86, iry * 0.84, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = mix(iris, '#ffffff', 0.45);
      ctx.beginPath();
      ctx.ellipse(ex, icy + iry * 0.34, irx * 0.58, iry * 0.42, 0, 0, 6.2832);
      ctx.fill();
    }

    // 瞳孔
    ctx.fillStyle = mix(iris, '#120d1e', 0.80);
    ctx.beginPath();
    ctx.ellipse(ex, icy - iry * 0.04, irx * 0.36, iry * 0.50, 0, 0, 6.2832);
    ctx.fill();

    // 高光
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex - irx * 0.34, icy - iry * 0.40, irx * 0.30, iry * 0.24, -0.45, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(ex + irx * 0.42, icy + iry * 0.34, irx * 0.13, iry * 0.10, 0.4, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (look.eyes > 0.3) {
      ctx.fillStyle = alpha('#ffffff', 0.75);
      ctx.beginPath();
      ctx.arc(ex + irx * 0.10, icy + iry * 0.52, irx * 0.09, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    // 上眼睑 / 睫毛
    ctx.strokeStyle = mix(state.palette.line, '#000000', 0.2);
    ctx.lineWidth = Math.max(2, lw * (look.hard > 0.5 ? 2.2 : 1.5));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx, ry, 0, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();

    if (outer) {
      ctx.fillStyle = mix(state.palette.line, '#000000', 0.2);
      // 外眼角睫毛
      var lx = ex + rx * 1.02, ly = ey - ry * 0.12;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + rx * 0.34, ly - ry * 0.30);
      ctx.lineTo(lx + rx * 0.06, ly + ry * 0.10);
      ctx.closePath();
      ctx.fill();
    }

    // 下眼线（淡）
    ctx.strokeStyle = alpha(mix(iris, '#3a2a44', 0.6), 0.55);
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx * 0.92, ry * 0.88, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  function drawCharacter(R, cx, cy, rand) {
    var p = state.palette, look = state.look;
    var H = adjust(p.hair), HS = adjust(p.shade), HLN = p.line;
    var SKIN = adjust('#ffe9de'), SKINS = adjust('#f7cbbd'), SKIND = adjust('#e8a99b');
    var dress = adjust(p.dress), dressS = adjust(p.dressShade);
    var accent = adjust(p.accent);
    var lw = R * 0.028;

    // 后发
    paint(ellPts(cx, cy - 0.06 * R, 1.00 * R, 1.04 * R, 0, 44), H, HS, {
      shadow: { x: cx + 0.56 * R, y: cy + 0.50 * R, rx: 0.66 * R, ry: 0.92 * R, rot: 0.12 },
      light: { x: cx - 0.34 * R, y: cy - 0.60 * R, rx: 0.36 * R, ry: 0.22 * R, rot: -0.5 }
    });
    // 长发披肩
    paint([[cx - 0.98 * R, cy], [cx - 1.24 * R, cy + 1.42 * R], [cx - 0.62 * R, cy + 1.68 * R],
      [cx + 0.62 * R, cy + 1.68 * R], [cx + 1.24 * R, cy + 1.42 * R], [cx + 0.98 * R, cy]],
      H, HS, { shadow: { x: cx + 0.88 * R, y: cy + 1.10 * R, rx: 0.30 * R, ry: 0.52 * R, rot: 0.10 } });

    // 双马尾
    if (p.twin) {
      for (var sd = -1; sd <= 1; sd += 2) {
        var ox = cx + sd * 1.02 * R, oy = cy - 0.16 * R;
        var tp = [[ox, oy]];
        tp = tp.concat(quadC([ox, oy], [cx + sd * 1.82 * R, cy + 0.50 * R], [cx + sd * 1.62 * R, cy + 1.24 * R], 10));
        tp = tp.concat(quadC([cx + sd * 1.62 * R, cy + 1.24 * R], [cx + sd * 1.52 * R, cy + 1.70 * R], [cx + sd * 1.16 * R, cy + 1.52 * R], 10));
        tp = tp.concat(quadC([cx + sd * 1.16 * R, cy + 1.52 * R], [cx + sd * 0.96 * R, cy + 0.66 * R], [ox, oy], 10));
        paint(tp, H, HS, {
          shadow: { x: cx + sd * 1.58 * R, y: cy + 1.06 * R, rx: 0.20 * R, ry: 0.52 * R, rot: sd * 0.16 },
          light: { x: cx + sd * 1.20 * R, y: cy + 0.30 * R, rx: 0.10 * R, ry: 0.34 * R, rot: sd * 0.30 }
        });
      }
    }

    // 颈
    var neck = [[cx - 0.30 * R, cy + 0.76 * R], [cx - 0.34 * R, cy + 1.32 * R],
      [cx + 0.34 * R, cy + 1.32 * R], [cx + 0.30 * R, cy + 0.76 * R]];
    paint(neck, SKIN, SKINS, { shadow: { x: cx, y: cy + 0.80 * R, rx: 0.36 * R, ry: 0.14 * R } });

    // 胸口肤色
    fillPts([[cx - 0.34 * R, cy + 1.02 * R], [cx - 0.48 * R, cy + 1.76 * R],
      [cx + 0.48 * R, cy + 1.76 * R], [cx + 0.34 * R, cy + 1.02 * R]], SKIN);

    // 躯干（衣服）
    var torso = [[cx - 0.56 * R, cy + 0.78 * R], [cx - 1.16 * R, cy + 0.96 * R],
      [cx - 1.48 * R, cy + 1.48 * R], [cx - 1.62 * R, cy + 2.40 * R],
      [cx + 1.62 * R, cy + 2.40 * R], [cx + 1.48 * R, cy + 1.48 * R],
      [cx + 1.16 * R, cy + 0.96 * R], [cx + 0.56 * R, cy + 0.78 * R],
      [cx + 0.38 * R, cy + 1.04 * R], [cx, cy + 1.34 * R], [cx - 0.38 * R, cy + 1.04 * R]];
    var bodyBase = p.outfit === 'kimono' ? mix(dress, '#ffffff', 0.20) : (p.outfit === 'maid' ? '#3a3550' : '#fbfbff');
    paint(torso, bodyBase, p.outfit === 'maid' ? '#232034' : '#dbe2f3', {
      shadow: { x: cx + 1.42 * R, y: cy + 1.90 * R, rx: 0.52 * R, ry: 0.94 * R, rot: 0.04 },
      light: { x: cx - 1.20 * R, y: cy + 1.24 * R, rx: 0.20 * R, ry: 0.30 * R, rot: 0.2 }
    });

    // 水手领 / 连衣裙领口
    if (p.outfit === 'sailor') {
      for (var cs = -1; cs <= 1; cs += 2) {
        paint([[cx + cs * 0.26 * R, cy + 1.02 * R], [cx + cs * 1.06 * R, cy + 1.22 * R],
          [cx + cs * 1.02 * R, cy + 1.62 * R], [cx + cs * 0.22 * R, cy + 1.40 * R]],
          '#2b3f6e', '#1b2a4d', { shadow: { x: cx + cs * 0.92 * R, y: cy + 1.48 * R, rx: 0.16 * R, ry: 0.24 * R } });
      }
      strokeLine([[cx - 0.30 * R, cy + 1.16 * R], [cx - 0.94 * R, cy + 1.28 * R]], '#ffffff', lw * 0.8, 0.9);
      strokeLine([[cx + 0.30 * R, cy + 1.16 * R], [cx + 0.94 * R, cy + 1.28 * R]], '#ffffff', lw * 0.8, 0.9);
    } else if (p.outfit === 'kimono') {
      fillPts([[cx - 0.24 * R, cy + 1.02 * R], [cx + 0.30 * R, cy + 1.86 * R],
        [cx + 0.46 * R, cy + 1.78 * R], [cx - 0.06 * R, cy + 1.00 * R]], mix(dress, '#ffffff', 0.35));
      fillPts([[cx + 0.24 * R, cy + 1.02 * R], [cx - 0.30 * R, cy + 1.86 * R],
        [cx - 0.46 * R, cy + 1.78 * R], [cx + 0.06 * R, cy + 1.00 * R]], mix(dress, '#ffffff', 0.55));
    } else {
      strokeLine([[cx - 0.92 * R, cy + 1.70 * R], [cx, cy + 1.94 * R], [cx + 0.92 * R, cy + 1.70 * R]],
        mix(dressS, dress, 0.25), lw * 0.9, 0.85);
    }

    // 胸前蝴蝶结
    fillPts([[cx, cy + 1.52 * R], [cx - 0.24 * R, cy + 1.40 * R], [cx - 0.24 * R, cy + 1.72 * R]], accent);
    fillPts([[cx, cy + 1.52 * R], [cx + 0.24 * R, cy + 1.40 * R], [cx + 0.24 * R, cy + 1.72 * R]], accent);
    fillPts(ellPts(cx, cy + 1.55 * R, 0.095 * R, 0.095 * R, 0, 18), mix(accent, '#ffffff', 0.30));
    if (state.look.outline) {
      strokeLine([[cx - 0.24 * R, cy + 1.40 * R], [cx, cy + 1.52 * R], [cx - 0.24 * R, cy + 1.72 * R]], p.line, lw * 0.6, 0.9);
      strokeLine([[cx + 0.24 * R, cy + 1.40 * R], [cx, cy + 1.52 * R], [cx + 0.24 * R, cy + 1.72 * R]], p.line, lw * 0.6, 0.9);
    }

    // 脸
    paint(ellPts(cx, cy + 0.10 * R, 0.66 * R, 0.76 * R, 0, 40), SKIN, SKINS, {
      shadow: { x: cx + 0.56 * R, y: cy + 0.18 * R, rx: 0.22 * R, ry: 0.52 * R, rot: 0.06, alpha: 0.55 },
      light: { x: cx - 0.10 * R, y: cy - 0.30 * R, rx: 0.30 * R, ry: 0.18 * R, rot: -0.2 }
    });

    // 耳朵
    for (var er = -1; er <= 1; er += 2) {
      paint(ellPts(cx + er * 0.67 * R, cy + 0.18 * R, 0.11 * R, 0.17 * R, 0, 18), SKIN, SKINS, {
        shadow: { x: cx + er * 0.69 * R, y: cy + 0.22 * R, rx: 0.05 * R, ry: 0.08 * R }
      });
    }

    // 眼睛
    var eyeY = cy + 0.24 * R, eyeDX = 0.315 * R, eRx = 0.205 * R, eRy = 0.245 * R;
    drawEye(cx - eyeDX, eyeY, eRx, eRy, adjust(p.eye), rand, false);
    drawEye(cx + eyeDX, eyeY, eRx, eRy, adjust(p.eye), rand, true);

    // 眉毛
    var browCol = mix(p.line, '#000000', 0.15);
    for (var bw = -1; bw <= 1; bw += 2) {
      strokeLine([[cx + bw * 0.44 * R, cy + 0.03 * R], [cx + bw * 0.30 * R, cy - 0.02 * R]],
        browCol, lw * 0.8, 0.75);
    }

    // 鼻子与嘴
    fillPts([[cx - 0.015 * R, cy + 0.50 * R], [cx + 0.02 * R, cy + 0.53 * R], [cx - 0.02 * R, cy + 0.54 * R]],
      mix(SKIND, p.line, 0.35), 0.8);
    ctx.strokeStyle = mix(p.line, SKIN, 0.35);
    ctx.lineWidth = Math.max(1.4, lw * 0.7);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 0.09 * R, cy + 0.62 * R);
    ctx.quadraticCurveTo(cx, cy + 0.68 * R, cx + 0.09 * R, cy + 0.62 * R);
    ctx.stroke();

    // 腮红
    if (look.hard > 0.5) {
      fillPts(ellPts(cx - 0.46 * R, cy + 0.49 * R, 0.13 * R, 0.055 * R, -0.1, 16), alpha('#ff9db2', 0.55));
      fillPts(ellPts(cx + 0.46 * R, cy + 0.49 * R, 0.13 * R, 0.055 * R, 0.1, 16), alpha('#ff9db2', 0.55));
    } else {
      softCircle(cx - 0.46 * R, cy + 0.49 * R, 0.15 * R, alpha('#ff8fa6', 0.55), 1);
      softCircle(cx + 0.46 * R, cy + 0.49 * R, 0.15 * R, alpha('#ff8fa6', 0.55), 1);
    }

    // 猫耳（画在发帽之下，只露出耳尖）
    if (p.catEars) {
      for (var ce = -1; ce <= 1; ce += 2) {
        var ear = [[cx + ce * 0.36 * R, cy - 0.92 * R], [cx + ce * 0.60 * R, cy - 1.40 * R], [cx + ce * 0.78 * R, cy - 0.88 * R]];
        paint(ear, H, HS, { shadow: { x: cx + ce * 0.62 * R, y: cy - 0.94 * R, rx: 0.08 * R, ry: 0.16 * R } });
        fillPts([[cx + ce * 0.46 * R, cy - 0.96 * R], [cx + ce * 0.60 * R, cy - 1.24 * R],
          [cx + ce * 0.70 * R, cy - 0.94 * R]], '#ffb3c8');
      }
    }

    // 前发：整块发帽 + 齐刘海（发梢止于眼上，不遮眼）
    var cap = [
      [cx - 0.80 * R, cy - 0.18 * R],
      [cx - 0.94 * R, cy - 0.62 * R],
      [cx - 0.76 * R, cy - 1.02 * R],
      [cx - 0.36 * R, cy - 1.14 * R],
      [cx, cy - 1.16 * R],
      [cx + 0.36 * R, cy - 1.14 * R],
      [cx + 0.76 * R, cy - 1.02 * R],
      [cx + 0.94 * R, cy - 0.62 * R],
      [cx + 0.80 * R, cy - 0.18 * R],
      [cx + 0.54 * R, cy + 0.06 * R],
      [cx + 0.34 * R, cy - 0.14 * R],
      [cx + 0.13 * R, cy + 0.05 * R],
      [cx - 0.10 * R, cy - 0.12 * R],
      [cx - 0.32 * R, cy + 0.06 * R],
      [cx - 0.54 * R, cy - 0.10 * R]
    ];
    paint(cap, H, HS, {
      shadow: { x: cx + 0.64 * R, y: cy - 0.52 * R, rx: 0.24 * R, ry: 0.36 * R, rot: 0.18 },
      light: { x: cx - 0.42 * R, y: cy - 0.84 * R, rx: 0.32 * R, ry: 0.10 * R, rot: -0.18 }
    });

    // 侧发：贴脸框发（发尾收尖）
    for (var sl = -1; sl <= 1; sl += 2) {
      var sx = cx + sl * 0.74 * R, sy = cy - 0.42 * R;
      var spts = [[sx - sl * 0.06 * R, sy]];
      spts = spts.concat(quadC([sx - sl * 0.06 * R, sy], [sx + sl * 0.20 * R, sy + 0.62 * R], [sx + sl * 0.14 * R, sy + 1.28 * R], 9));
      spts = spts.concat(quadC([sx + sl * 0.14 * R, sy + 1.28 * R], [sx - sl * 0.02 * R, sy + 1.00 * R], [sx - sl * 0.10 * R, sy + 0.32 * R], 9));
      paint(spts, H, HS, {
        shadow: { x: sx + sl * 0.12 * R, y: sy + 0.92 * R, rx: 0.07 * R, ry: 0.28 * R, rot: 0 },
        light: { x: sx - sl * 0.04 * R, y: sy + 0.24 * R, rx: 0.03 * R, ry: 0.16 * R }
      });
    }

    // 呆毛
    if (p.ahoge) {
      var aho = [[cx - 0.02 * R, cy - 1.10 * R]];
      aho = aho.concat(quadC([cx - 0.02 * R, cy - 1.10 * R], [cx + 0.18 * R, cy - 1.60 * R], [cx + 0.50 * R, cy - 1.34 * R], 9));
      aho = aho.concat(quadC([cx + 0.50 * R, cy - 1.34 * R], [cx + 0.26 * R, cy - 1.30 * R], [cx + 0.06 * R, cy - 1.06 * R], 9));
      paint(aho, H, HS, {});
    }

    // 蝴蝶结发饰
    if (p.bow) {
      var bx = cx - 0.78 * R, by = cy - 0.72 * R;
      for (var bw2 = -1; bw2 <= 1; bw2 += 2) {
        var bp = [[bx, by]];
        bp = bp.concat(quadC([bx, by], [bx + bw2 * 0.28 * R, by - 0.26 * R], [bx + bw2 * 0.36 * R, by], 8));
        bp = bp.concat(quadC([bx + bw2 * 0.36 * R, by], [bx + bw2 * 0.30 * R, by + 0.20 * R], [bx, by + 0.06 * R], 8));
        paint(bp, accent, mix(accent, '#000000', 0.25), {
          shadow: { x: bx + bw2 * 0.22 * R, y: by + 0.12 * R, rx: 0.08 * R, ry: 0.10 * R }
        });
      }
      paint(ellPts(bx, by + 0.02 * R, 0.07 * R, 0.065 * R, 0, 14), mix(accent, '#ffffff', 0.30), mix(accent, '#000000', 0.2), {});
    }

    // 逆光轮廓光
    if (look.glow > 0.1) {
      ctx.save();
      ctx.globalAlpha = 0.20 + look.glow * 0.45;
      ctx.strokeStyle = '#fff4d6';
      ctx.lineWidth = R * 0.020;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 0.06 * R, 1.05 * R, 1.08 * R, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.restore();
    }

    // 发丝线
    if (look.detail > 0.2 || look.hard > 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = mix(HLN, H, 0.45);
      ctx.lineWidth = Math.max(1, lw * 0.5);
      for (var hs = 0; hs < 5; hs++) {
        var hx = cx + (-0.7 + hs * 0.35) * R;
        ctx.beginPath();
        ctx.moveTo(hx, cy - 0.86 * R);
        ctx.quadraticCurveTo(hx + 0.06 * R, cy - 0.40 * R, hx + 0.02 * R, cy - 0.10 * R);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- 风景模式 ---------------- */
  function drawScenery(w, h, rand) {
    var kind = state.palette.backdrop === 'studio' ? 'sea' : state.palette.backdrop;
    drawBg(kind, w, h, rand);
    // 远山 / 剪影
    fillPts([[0, h * 0.72], [w * 0.22, h * 0.52], [w * 0.40, h * 0.70], [w * 0.62, h * 0.48],
      [w * 0.86, h * 0.68], [w, h * 0.58], [w, h], [0, h]], alpha('#2f4d6e', 0.35));
  }

  /* ---------------- 前景 ---------------- */
  function drawForeground(w, h, rand) {
    var look = state.look;
    var petals = look.petals > 0.2 || state.palette.backdrop === 'sakura';
    if (petals) {
      var count = Math.round((look.petals > 0.2 ? 14 : 8) * (0.6 + look.petals * 0.4));
      for (var i = 0; i < count; i++) {
        var x = rand() * w, y = rand() * h;
        var r = Math.min(w, h) * (0.012 + rand() * 0.018);
        ctx.save();
        ctx.globalAlpha = 0.55 + rand() * 0.45;
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI * 2);
        ctx.fillStyle = i % 3 === 0 ? '#ffb6cf' : '#ffd3e2';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.7, r * 0.75, 0, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
    }
    if (look.glow > 0.1) {
      var g = ctx.createRadialGradient(w * 0.5, h * 0.12, 0, w * 0.5, h * 0.12, w * 0.7);
      g.addColorStop(0, 'rgba(255,244,214,' + (0.10 + look.glow * 0.20) + ')');
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // 统一画风：厚涂叠一层可见笔触
    if (look.texture > 0.55) {
      strokesIn({ x: 0, y: 0, w: w, h: h }, '#ffffff', 90, rand, w * 0.045, w * 0.0035, 0.05 * look.texture);
      strokesIn({ x: 0, y: 0, w: w, h: h }, '#241a33', 60, rand, w * 0.05, w * 0.003, 0.045 * look.texture);
    }
  }

  /* ---------------- 整图渲染 ---------------- */
  function renderImage() {
    var cv = el.preview;
    if (!cv) return;
    var w = state.w, h = state.h;
    cv.width = w;
    cv.height = h;
    ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    state.look = resolveLook();
    state.palette = compile(state.prompt);
    var rand = rng(state.seed || 1);
    var R = Math.min(w * 0.30, h * 0.235);
    state.R = R;
    var cx = w * 0.5, cy = h * 0.40;

    if (state.palette.isScene) {
      drawScenery(w, h, rand);
    } else {
      drawSceneBg(w, h, rand);
      drawCharacter(R, cx, cy, rand);
    }
    drawForeground(w, h, rand);

    state.generated = true;
    if (el.empty) el.empty.hidden = true;
    if (el.badge) el.badge.textContent = STYLES[state.style].short + ' · ' + ckptName();
    if (el.status) el.status.textContent = '完成 · ' + w + '×' + h + ' · seed ' + state.seed;
    pushHistory(cv.toDataURL('image/png'));
  }

  function ckptName() {
    for (var i = 0; i < CKPTS.length; i++) if (CKPTS[i].id === state.ckpt) return CKPTS[i].name;
    return CKPTS[0].name;
  }

  /* ---------------- 参数与历史 ---------------- */
  function loraTags() {
    var out = [];
    for (var i = 0; i < state.loras.length; i++) {
      var it = state.loras[i], meta = null;
      for (var k = 0; k < LORAS.length; k++) if (LORAS[k].id === it.id) meta = LORAS[k];
      if (meta) out.push('<lora:' + meta.name.replace(/\s+/g, '_') + ':' + it.weight.toFixed(2) + '>');
    }
    return out.join(', ');
  }

  function metaText() {
    var tags = loraTags();
    var head = 'masterpiece, best quality' + (tags ? ', ' + tags : '') + ', ' + state.prompt;
    return head + '\nNegative prompt: ' + state.neg +
      '\nSteps: ' + state.steps + ', Sampler: ' + state.sampler +
      ', CFG scale: ' + state.cfg + ', Seed: ' + state.seed +
      ', Size: ' + state.w + 'x' + state.h + ', Model: ' + ckptName() +
      ', Style: ' + STYLES[state.style].label + ', Clip skip: 2';
  }

  function pushHistory(dataUrl) {
    history.unshift({ url: dataUrl, style: state.style, ckpt: ckptName(), seed: state.seed });
    if (history.length > 6) history.length = 6;
    renderHistory();
  }

  function renderHistory() {
    if (!el.history) return;
    if (!history.length) {
      el.history.innerHTML = '<div class="hm-iw-hist-empty">还没有生成记录</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < history.length; i++) {
      html += '<button class="hm-iw-hist" data-hist="' + i + '" title="' + history[i].style + ' · ' + history[i].seed + '">' +
        '<img src="' + history[i].url + '" alt="生成记录">' +
        '<span>' + history[i].seed + '</span></button>';
    }
    el.history.innerHTML = html;
  }

  function bindHistory() {
    if (!el.history) return;
    el.history.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-hist]');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-hist'), 10);
      var item = history[idx];
      if (!item) return;
      var img = new Image();
      img.onload = function () {
        var cv = el.preview;
        cv.width = img.width;
        cv.height = img.height;
        var c2 = cv.getContext('2d');
        c2.clearRect(0, 0, cv.width, cv.height);
        c2.drawImage(img, 0, 0);
        state.w = img.width;
        state.h = img.height;
        state.seed = item.seed;
        if (el.seed) el.seed.value = item.seed;
        if (el.status) el.status.textContent = '已载入历史 · seed ' + item.seed;
        if (el.empty) el.empty.hidden = true;
        if (el.badge) el.badge.textContent = item.ckpt + ' · ' + item.style;
      };
      img.src = item.url;
    });
  }

  /* ---------------- UI ---------------- */
  function fillCkptSelect() {
    if (!el.ckpt) return;
    var html = '';
    for (var i = 0; i < CKPTS.length; i++) {
      html += '<option value="' + CKPTS[i].id + '"' + (CKPTS[i].id === state.ckpt ? ' selected' : '') + '>' +
        CKPTS[i].name + ' · ' + CKPTS[i].family + '</option>';
    }
    el.ckpt.innerHTML = html;
    renderCkptMeta();
  }

  function renderCkptMeta() {
    if (!el.ckptMeta) return;
    var ck = CKPTS[0];
    for (var i = 0; i < CKPTS.length; i++) if (CKPTS[i].id === state.ckpt) ck = CKPTS[i];
    el.ckptMeta.innerHTML = '<span class="hm-iw-tag">' + ck.family + '</span>' +
      '<p>' + ck.note + '</p>' +
      '<a href="' + ck.url + '" target="_blank" rel="noopener">来源：' + ck.site + ' ↗</a>';
  }

  function renderLoras() {
    if (!el.loraList) return;
    if (el.loraCount) el.loraCount.textContent = String(state.loras.length);
    if (!state.loras.length) {
      el.loraList.innerHTML = '<div class="hm-iw-lora-empty">未叠加 LoRA · 点击下方从模型站添加</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.loras.length; i++) {
      var it = state.loras[i], meta = null;
      for (var k = 0; k < LORAS.length; k++) if (LORAS[k].id === it.id) meta = LORAS[k];
      if (!meta) continue;
      html += '<div class="hm-iw-lora" data-lora="' + meta.id + '">' +
        '<div class="hm-iw-lora-head"><b>' + meta.name + '</b>' +
        '<button data-rm="' + meta.id + '" title="移除">×</button></div>' +
        '<div class="hm-iw-lora-meta"><a href="' + meta.url + '" target="_blank" rel="noopener">' + meta.site + ' ↗</a> · ' + meta.desc + '</div>' +
        '<div class="hm-iw-lora-row"><input type="range" min="0" max="150" step="5" value="' + Math.round(it.weight * 100) + '" data-w="' + meta.id + '">' +
        '<span class="hm-iw-lora-w" id="lw-' + meta.id + '">' + it.weight.toFixed(2) + '</span></div>' +
        '</div>';
    }
    el.loraList.innerHTML = html;
  }

  function renderLoraLib() {
    if (!el.loraLib) return;
    var html = '<div class="hm-iw-lib-head">模型站 LoRA 库 <button data-close-lib>收起</button></div>';
    for (var i = 0; i < LORAS.length; i++) {
      var l = LORAS[i];
      var added = false;
      for (var k = 0; k < state.loras.length; k++) if (state.loras[k].id === l.id) added = true;
      html += '<div class="hm-iw-lib-item">' +
        '<div><b>' + l.name + '</b><span>' + l.site + ' · 权重 ' + l.w.toFixed(2) + '</span>' +
        '<p>' + l.desc + '</p></div>' +
        '<div class="hm-iw-lib-act"><a href="' + l.url + '" target="_blank" rel="noopener">查看 ↗</a>' +
        '<button data-add="' + l.id + '"' + (added ? ' disabled' : '') + '>' + (added ? '已添加' : '添加') + '</button></div>' +
        '</div>';
    }
    el.loraLib.innerHTML = html;
  }

  function renderSources() {
    if (!el.sources) return;
    var html = '';
    var used = [];
    for (var i = 0; i < CKPTS.length; i++) used.push({ name: CKPTS[i].name, site: CKPTS[i].site, url: CKPTS[i].url, type: 'Checkpoint' });
    for (var j = 0; j < LORAS.length; j++) used.push({ name: LORAS[j].name, site: LORAS[j].site, url: LORAS[j].url, type: 'LoRA' });
    for (var u = 0; u < used.length; u++) {
      html += '<a class="hm-iw-src" href="' + used[u].url + '" target="_blank" rel="noopener">' +
        '<span>' + used[u].type + '</span><b>' + used[u].name + '</b><em>' + used[u].site + ' ↗</em></a>';
    }
    el.sources.innerHTML = html;
  }

  function addLora(id) {
    for (var i = 0; i < state.loras.length; i++) if (state.loras[i].id === id) return;
    var meta = null;
    for (var k = 0; k < LORAS.length; k++) if (LORAS[k].id === id) meta = LORAS[k];
    if (!meta) return;
    state.loras.push({ id: id, weight: meta.w });
    renderLoras();
    renderLoraLib();
    toast('已添加 LoRA：' + meta.name);
    if (state.generated) generate(true);
  }

  function removeLora(id) {
    for (var i = 0; i < state.loras.length; i++) {
      if (state.loras[i].id === id) { state.loras.splice(i, 1); break; }
    }
    renderLoras();
    renderLoraLib();
    if (state.generated) generate(true);
  }

  /* ---------------- 生成 ---------------- */
  function readInputs() {
    if (el.prompt) state.prompt = el.prompt.value;
    if (el.neg) state.neg = el.neg.value;
    if (el.ckpt) state.ckpt = el.ckpt.value;
    if (el.sampler) state.sampler = el.sampler.value;
    if (el.steps) state.steps = parseInt(el.steps.value, 10) || 28;
    if (el.cfg) state.cfg = parseFloat(el.cfg.value) || 7;
    if (el.size) {
      var parts = el.size.value.split('x');
      state.w = parseInt(parts[0], 10) || 768;
      state.h = parseInt(parts[1], 10) || 1024;
    }
  }

  function generate(quick) {
    readInputs();
    var seedVal = parseInt(el.seed && el.seed.value, 10);
    state.seed = (seedVal && seedVal > 0) ? seedVal : Math.floor(Math.random() * 999999) + 1;
    if (el.seed) el.seed.value = state.seed;

    if (el.empty) el.empty.hidden = true;
    if (el.badge) el.badge.textContent = '采样中…';
    var total = state.steps;
    var done = 0;
    if (timer) clearInterval(timer);

    if (quick) {
      renderImage();
      return;
    }

    el.status.textContent = '采样 0/' + total + ' · ' + state.sampler;
    timer = setInterval(function () {
      done++;
      if (el.status) el.status.textContent = '采样 ' + done + '/' + total + ' · ' + state.sampler + ' · CFG ' + state.cfg;
      if (done >= total) {
        clearInterval(timer);
        timer = null;
        renderImage();
      }
    }, Math.max(12, Math.round(700 / total)));
  }

  function savePng() {
    if (!state.generated || !el.preview) { toast('先生成一张图片', 'error'); return; }
    var name = 'huimeng_' + state.ckpt + '_' + state.seed + '.png';
    var a = document.createElement('a');
    a.href = el.preview.toDataURL('image/png');
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('已保存 ' + name);
  }

  function copyParams() {
    var text = metaText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('参数已复制'); },
        function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('参数已复制'); } catch (e) { toast('复制失败', 'error'); }
    document.body.removeChild(ta);
  }

  function switchStyle(style) {
    if (!STYLES[style] || state.style === style) return;
    state.style = style;
    var btns = document.querySelectorAll('#iwStyles [data-style]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-active', btns[i].getAttribute('data-style') === style);
    if (el.styleTag) el.styleTag.textContent = STYLES[style].label;
    if (state.generated) generate(true);
  }

  /* ---------------- 初始化 ---------------- */
  var initedListeners = false;

  function init() {
    if (inited) return;
    inited = true;

    el.prompt = $('iwPrompt');
    el.neg = $('iwNeg');
    el.ckpt = $('iwCkpt');
    el.ckptMeta = $('iwCkptMeta');
    el.loraList = $('iwLoraList');
    el.loraLib = $('iwLoraLib');
    el.loraCount = $('iwLoraCount');
    el.sampler = $('iwSampler');
    el.steps = $('iwSteps');
    el.stepsVal = $('iwStepsVal');
    el.cfg = $('iwCfg');
    el.cfgVal = $('iwCfgVal');
    el.seed = $('iwSeed');
    el.size = $('iwSize');
    el.preview = $('iwPreview');
    el.empty = $('iwEmpty');
    el.badge = $('iwBadge');
    el.status = $('iwStatus');
    el.history = $('iwHistory');
    el.sources = $('iwSources');
    el.styleTag = $('iwStyleTag');
    el.gen = $('iwGen');
    el.save = $('iwSave');
    el.paramsBtn = $('iwParams');
    el.dice = $('iwDice');
    el.back = $('iwBack');
    el.loraAdd = $('iwLoraAdd');

    if (el.prompt) el.prompt.value = state.prompt;
    if (el.neg) el.neg.value = state.neg;
    if (el.steps) { el.steps.value = state.steps; }
    if (el.stepsVal) el.stepsVal.textContent = state.steps;
    if (el.cfg) { el.cfg.value = state.cfg; }
    if (el.cfgVal) el.cfgVal.textContent = state.cfg;
    if (el.sampler) {
      var sh = '';
      for (var s = 0; s < SAMPLERS.length; s++) {
        sh += '<option value="' + SAMPLERS[s] + '"' + (SAMPLERS[s] === state.sampler ? ' selected' : '') + '>' + SAMPLERS[s] + '</option>';
      }
      el.sampler.innerHTML = sh;
    }
    if (el.styleTag) el.styleTag.textContent = STYLES[state.style].label;

    fillCkptSelect();
    renderLoras();
    renderLoraLib();
    renderSources();
    renderHistory();
    bindListeners();
  }

  function bindListeners() {
    if (initedListeners) return;
    initedListeners = true;

    if (el.back) el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });

    var styleBtns = document.querySelectorAll('#iwStyles [data-style]');
    for (var i = 0; i < styleBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { switchStyle(btn.getAttribute('data-style')); });
      })(styleBtns[i]);
    }

    if (el.ckpt) el.ckpt.addEventListener('change', function () {
      state.ckpt = el.ckpt.value;
      renderCkptMeta();
      if (state.generated) generate(true);
    });

    if (el.steps) el.steps.addEventListener('input', function () {
      if (el.stepsVal) el.stepsVal.textContent = el.steps.value;
      state.steps = parseInt(el.steps.value, 10) || 28;
    });
    if (el.cfg) el.cfg.addEventListener('input', function () {
      if (el.cfgVal) el.cfgVal.textContent = el.cfg.value;
      state.cfg = parseFloat(el.cfg.value) || 7;
    });

    if (el.gen) el.gen.addEventListener('click', function () { generate(false); });
    if (el.save) el.save.addEventListener('click', savePng);
    if (el.paramsBtn) el.paramsBtn.addEventListener('click', copyParams);
    if (el.dice) el.dice.addEventListener('click', function () {
      var n = Math.floor(Math.random() * 999999) + 1;
      if (el.seed) el.seed.value = n;
      state.seed = n;
      if (state.generated) generate(true);
    });

    if (el.loraAdd) el.loraAdd.addEventListener('click', function () {
      if (!el.loraLib) return;
      el.loraLib.hidden = !el.loraLib.hidden;
      if (!el.loraLib.hidden) renderLoraLib();
    });

    if (el.loraLib) {
      el.loraLib.addEventListener('click', function (e) {
        var add = e.target.closest('[data-add]');
        if (add) { addLora(add.getAttribute('data-add')); return; }
        if (e.target.closest('[data-close-lib]')) { el.loraLib.hidden = true; }
      });
    }

    if (el.loraList) {
      el.loraList.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-rm]');
        if (rm) removeLora(rm.getAttribute('data-rm'));
      });
      el.loraList.addEventListener('input', function (e) {
        var inp = e.target.closest('[data-w]');
        if (!inp) return;
        var id = inp.getAttribute('data-w');
        var val = parseInt(inp.value, 10) / 100;
        for (var k = 0; k < state.loras.length; k++) {
          if (state.loras[k].id === id) state.loras[k].weight = val;
        }
        var lab = $('lw-' + id);
        if (lab) lab.textContent = val.toFixed(2);
        if (state.generated) generate(true);
      });
    }

    bindHistory();
  }

  function enter() {
    init();
    if (!state.generated) {
      generate(false);
    }
  }

  function leave() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    enter: enter,
    leave: leave
  };
})();
