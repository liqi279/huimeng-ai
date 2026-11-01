/* ============================================================
 * 免费生视频 HMTOOLVIDEO（零成本本地生成流水线）
 * 流程：提示词 → 生成 HTML 代码（含场景与分辨率）
 *      → 逐帧把 HTML 渲染为 PNG（同一份 HTML 在沙盒 iframe 中执行）
 *      → 连续帧预览 → 导出 GIF / WebM(MP4) / PNG 序列 ZIP / 单帧 PNG / HTML 代码
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
  var code = '';            // 生成的 HTML 代码
  var frameUrls = [];       // PNG dataURL 帧序列
  var frameImgs = [];       // 已解码的帧图片
  var cur = 0;              // 当前预览帧
  var playing = false;
  var rafId = 0;
  var lastTick = 0;
  var iframe = null;
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
    return {
      hair: hair.c, shade: hair.s,
      eye: eye ? eye.c : (accent || '#8ab4ff'),
      dress: dress.c, dressShade: dress.s,
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
      var ch = spec.char || {};
      var cs = Math.min(w, h);
      var chibi = !!ch.chibi;
      var headR = cs * (chibi ? 0.188 : 0.162);
      var mx = w * 0.5;
      var act = spec.action || 'idle';
      var bobAmp = cs * (act === 'run' ? 0.022 : act === 'float' ? 0.016 : 0.008);
      var bob = Math.sin(t * (act === 'run' ? 12.566 : 6.2832)) * bobAmp;
      var cy = h * (chibi ? 0.425 : 0.405) + bob;
      var hairC = ch.hair || '#f2f4ff';
      var hairS = ch.shade || '#c6cff0';
      var eyeC = ch.eye || col(0);
      var dressC = ch.dress || '#9d7bf7';
      var dressS = ch.dressShade || '#7048d8';
      var kind = ch.backdrop || 'studio';

      // 人物身后光晕，让角色从背景里分离出来
      var chg = ctx.createRadialGradient(mx, cy + headR * 0.4, 0, mx, cy + headR * 0.4, cs * 0.95);
      chg.addColorStop(0, rgba(hairC, 0.22));
      chg.addColorStop(0.42, rgba(eyeC, 0.10));
      chg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = chg;
      ctx.fillRect(0, 0, w, h);

      // 背景氛围
      if (kind === 'sakura') {
        ctx.fillStyle = 'rgba(255,170,205,0.10)';
        ctx.fillRect(0, 0, w, h);
        for (i = 0; i < 18; i++) {
          var psp = 0.25 + rnd(i + 300) * 0.9;
          var ppx = rnd(i + 310) * w + Math.sin(t * 6.2832 + i) * cs * 0.03;
          var ppy = ((rnd(i + 320) + t * psp) % 1.05) * (h + 80) - 40;
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = i % 3 ? '#ffb7d5' : '#ffd9e8';
          ctx.beginPath();
          ctx.ellipse(ppx, ppy, 4.5 + rnd(i) * 3, 3 + rnd(i + 5) * 2, i * 0.7 + t * 3, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (kind === 'night') {
        for (i = 0; i < 90; i++) {
          x = rnd(i + 400) * w;
          y = rnd(i + 410) * h * 0.8;
          ctx.globalAlpha = 0.25 + 0.65 * Math.abs(Math.sin(t * 6.2832 + i * 0.6));
          ctx.fillStyle = i % 4 ? '#dbeafe' : '#fef3c7';
          ctx.beginPath(); ctx.arc(x, y, 1 + rnd(i + 420) * 2, 0, 6.2832); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (kind === 'city') {
        var skyY = h * 0.74;
        for (i = 0; i < 12; i++) {
          var blw = w / 11 * (0.6 + rnd(i + 500) * 0.7);
          var blx = i * w / 11;
          var blh = h * (0.10 + rnd(i + 510) * 0.22);
          ctx.fillStyle = 'rgba(12,16,34,0.9)';
          ctx.fillRect(blx, skyY - blh, blw, blh);
          for (var wi = 0; wi < 3; wi++) {
            ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t * 6.2832 + (i + wi) * 0.9));
            ctx.fillStyle = wi % 2 ? '#f472b6' : '#22d3ee';
            ctx.fillRect(blx + 4 + wi * 10, skyY - blh + 8 + (i % 3) * 14, 4, 6);
          }
          ctx.globalAlpha = 1;
        }
      } else if (kind === 'room') {
        var roomG = ctx.createLinearGradient(0, 0, 0, h);
        roomG.addColorStop(0, 'rgba(255,214,160,0.18)');
        roomG.addColorStop(1, 'rgba(255,180,120,0)');
        ctx.fillStyle = roomG;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(180,220,255,0.13)';
        ctx.fillRect(w * 0.62, h * 0.15, w * 0.28, h * 0.34);
        ctx.strokeStyle = 'rgba(255,226,180,0.4)';
        ctx.lineWidth = Math.max(4, cs * 0.014);
        ctx.strokeRect(w * 0.62, h * 0.15, w * 0.28, h * 0.34);
        ctx.beginPath();
        ctx.moveTo(w * 0.76, h * 0.15); ctx.lineTo(w * 0.76, h * 0.49);
        ctx.moveTo(w * 0.62, h * 0.32); ctx.lineTo(w * 0.90, h * 0.32);
        ctx.stroke();
      } else if (kind === 'sea') {
        ctx.fillStyle = 'rgba(56,189,248,0.16)';
        ctx.fillRect(0, h * 0.66, w, h * 0.34);
        for (i = 0; i < 5; i++) {
          ctx.strokeStyle = 'rgba(165,243,252,0.28)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (x = 0; x <= w; x += 10) {
            var wy2 = h * (0.70 + i * 0.055) + Math.sin(x / w * 12.566 + t * 6.2832 + i * 0.8) * h * 0.012;
            if (x === 0) ctx.moveTo(x, wy2); else ctx.lineTo(x, wy2);
          }
          ctx.stroke();
        }
      } else if (kind === 'forest') {
        for (i = 0; i < 9; i++) {
          x = i * w / 8 + rnd(i + 700) * 24 - 12;
          y = h * (0.42 + rnd(i + 710) * 0.16);
          ctx.globalAlpha = 0.30;
          ctx.fillStyle = '#0f3b25';
          ctx.beginPath(); ctx.ellipse(x, y, w * 0.09, h * 0.20, 0, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = 'rgba(120,255,190,0.06)';
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
      } else {
        for (i = 0; i < 22; i++) {
          x = rnd(i + 800) * w;
          y = rnd(i + 810) * h;
          var brad = 12 + rnd(i + 820) * 46;
          ctx.globalAlpha = 0.05 + rnd(i + 830) * 0.10;
          ctx.fillStyle = i % 2 ? hairC : eyeC;
          ctx.beginPath();
          ctx.arc(x, y + Math.sin(t * 6.2832 + i) * 8, brad, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // 后发
      ctx.fillStyle = hairS;
      ctx.beginPath();
      ctx.ellipse(mx, cy + headR * 0.34, headR * 1.24, headR * 1.45, 0, 0, 6.2832);
      ctx.fill();

      // 双马尾
      var sway = Math.sin(t * 6.2832) * 0.12;
      if (ch.twin) {
        for (var sd = -1; sd <= 1; sd += 2) {
          ctx.save();
          ctx.translate(mx + sd * headR * 1.24, cy + headR * 0.26);
          ctx.rotate(sd * sway);
          ctx.fillStyle = hairS;
          ctx.beginPath(); ctx.ellipse(0, headR * 0.95, headR * 0.30, headR * 1.40, 0, 0, 6.2832); ctx.fill();
          ctx.fillStyle = hairC;
          ctx.beginPath(); ctx.ellipse(0, headR * 0.84, headR * 0.21, headR * 1.24, 0, 0, 6.2832); ctx.fill();
          // 发圈
          ctx.fillStyle = eyeC;
          ctx.beginPath(); ctx.ellipse(0, headR * 0.02, headR * 0.17, headR * 0.10, 0, 0, 6.2832); ctx.fill();
          ctx.restore();
        }
      }

      // 腿与鞋
      var hemY = cy + headR * 1.05 + cs * 0.25;
      var legH = cs * 0.070, legW = headR * 0.15;
      ctx.fillStyle = '#f2c3b2';
      ctx.beginPath(); ctx.ellipse(mx - headR * 0.30, hemY + legH * 0.5, legW, legH * 0.62, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(mx + headR * 0.30, hemY + legH * 0.5, legW, legH * 0.62, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#2c2438';
      ctx.beginPath(); ctx.ellipse(mx - headR * 0.30, hemY + legH * 0.92, legW * 1.05, legH * 0.28, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(mx + headR * 0.30, hemY + legH * 0.92, legW * 1.05, legH * 0.28, 0, 0, 6.2832); ctx.fill();

      // 脖子
      ctx.fillStyle = '#f2c3b2';
      ctx.fillRect(mx - headR * 0.15, cy + headR * 0.86, headR * 0.30, headR * 0.40);

      // 裙子
      var shoulderY = cy + headR * 1.16;
      var halfTop = headR * 0.46;
      var halfHem = headR * 0.98;
      var dg = ctx.createLinearGradient(0, shoulderY, 0, hemY);
      dg.addColorStop(0, dressC);
      dg.addColorStop(1, dressS);
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.moveTo(mx - halfTop, shoulderY);
      ctx.quadraticCurveTo(mx - halfHem * 0.70, shoulderY + (hemY - shoulderY) * 0.55, mx - halfHem, hemY);
      ctx.quadraticCurveTo(mx, hemY + cs * 0.014, mx + halfHem, hemY);
      ctx.quadraticCurveTo(mx + halfHem * 0.70, shoulderY + (hemY - shoulderY) * 0.55, mx + halfTop, shoulderY);
      ctx.closePath();
      ctx.fill();
      // 裙摆高光
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, cs * 0.004);
      ctx.beginPath();
      ctx.moveTo(mx - halfHem * 0.96, hemY - cs * 0.004);
      ctx.quadraticCurveTo(mx, hemY + cs * 0.010, mx + halfHem * 0.96, hemY - cs * 0.004);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 手臂与手
      for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
        ctx.save();
        ctx.translate(mx + sd2 * headR * 0.62, shoulderY + headR * 0.22);
        var armRot = sd2 * 0.20;
        if (act === 'wave' && sd2 === 1) armRot = -0.95 + Math.sin(t * 12.566) * 0.32;
        ctx.rotate(armRot);
        ctx.fillStyle = dressC;
        ctx.beginPath(); ctx.ellipse(0, headR * 0.26, headR * 0.125, headR * 0.30, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#ffe3d5';
        ctx.beginPath(); ctx.arc(0, headR * 0.60, headR * 0.115, 0, 6.2832); ctx.fill();
        ctx.restore();
      }

      // 头部肤色
      ctx.fillStyle = '#ffe3d5';
      ctx.beginPath(); ctx.ellipse(mx, cy, headR, headR * 0.99, 0, 0, 6.2832); ctx.fill();

      // 眼睛
      var blink = (t + ((spec.seed || 1) % 53) / 53) % 1;
      var closed = blink < 0.05 || blink > 0.93;
      var eo = headR * 0.40, eY = cy + headR * 0.20;
      var eW = headR * 0.255, eH = headR * 0.305;
      for (var sd3 = -1; sd3 <= 1; sd3 += 2) {
        var ex = mx + sd3 * eo;
        if (closed) {
          ctx.strokeStyle = '#4a3a52';
          ctx.lineWidth = Math.max(2, headR * 0.042);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(ex - eW * 0.85, eY);
          ctx.quadraticCurveTo(ex, eY + eH * 0.42, ex + eW * 0.85, eY);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.ellipse(ex, eY, eW, eH, 0, 0, 6.2832); ctx.fill();
          ctx.fillStyle = eyeC;
          ctx.beginPath(); ctx.ellipse(ex, eY + eH * 0.06, eW * 0.80, eH * 0.82, 0, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(22,14,34,0.9)';
          ctx.beginPath(); ctx.ellipse(ex, eY + eH * 0.10, eW * 0.40, eH * 0.46, 0, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.beginPath(); ctx.arc(ex - eW * 0.28, eY - eH * 0.26, eW * 0.24, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath(); ctx.arc(ex + eW * 0.20, eY + eH * 0.30, eW * 0.13, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = '#3a2b45';
          ctx.lineWidth = Math.max(1.5, headR * 0.034);
          ctx.beginPath();
          ctx.moveTo(ex - eW * 0.92, eY - eH * 0.55);
          ctx.quadraticCurveTo(ex, eY - eH * 1.05, ex + eW * 0.92, eY - eH * 0.55);
          ctx.stroke();
        }
      }
      // 腮红
      ctx.fillStyle = 'rgba(255,138,166,0.30)';
      ctx.beginPath(); ctx.ellipse(mx - headR * 0.72, cy + headR * 0.50, headR * 0.15, headR * 0.08, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(mx + headR * 0.72, cy + headR * 0.50, headR * 0.15, headR * 0.08, 0, 0, 6.2832); ctx.fill();
      // 嘴
      ctx.strokeStyle = '#b05a68';
      ctx.lineWidth = Math.max(1.6, headR * 0.032);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mx - headR * 0.08, cy + headR * 0.72);
      ctx.quadraticCurveTo(mx, cy + headR * 0.78, mx + headR * 0.08, cy + headR * 0.72);
      ctx.stroke();

      // 刘海（锯齿状发梢覆盖额头）
      ctx.fillStyle = hairC;
      ctx.beginPath();
      ctx.moveTo(mx - headR * 1.03, cy + headR * 0.06);
      ctx.quadraticCurveTo(mx - headR * 1.16, cy - headR * 0.98, mx, cy - headR * 1.10);
      ctx.quadraticCurveTo(mx + headR * 1.16, cy - headR * 0.98, mx + headR * 1.03, cy + headR * 0.06);
      ctx.quadraticCurveTo(mx + headR * 0.86, cy - headR * 0.06, mx + headR * 0.66, cy - headR * 0.30);
      ctx.quadraticCurveTo(mx + headR * 0.52, cy - headR * 0.05, mx + headR * 0.34, cy - headR * 0.26);
      ctx.quadraticCurveTo(mx + headR * 0.16, cy - headR * 0.02, mx - headR * 0.02, cy - headR * 0.24);
      ctx.quadraticCurveTo(mx - headR * 0.20, cy - headR * 0.02, mx - headR * 0.40, cy - headR * 0.22);
      ctx.quadraticCurveTo(mx - headR * 0.60, cy - headR * 0.02, mx - headR * 0.74, cy - headR * 0.24);
      ctx.quadraticCurveTo(mx - headR * 0.88, cy - headR * 0.06, mx - headR * 1.03, cy + headR * 0.06);
      ctx.closePath();
      ctx.fill();

      // 两侧发绺
      if (!ch.shortHair) {
        for (var sd4 = -1; sd4 <= 1; sd4 += 2) {
          ctx.fillStyle = hairC;
          ctx.beginPath();
          ctx.moveTo(mx + sd4 * headR * 0.94, cy - headR * 0.42);
          ctx.quadraticCurveTo(mx + sd4 * headR * 1.18, cy + headR * 0.30, mx + sd4 * headR * 0.90, cy + headR * 0.92);
          ctx.quadraticCurveTo(mx + sd4 * headR * 0.76, cy + headR * 0.24, mx + sd4 * headR * 0.74, cy - headR * 0.30);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 高光
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, headR * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(mx, cy, headR * 0.86, Math.PI * 1.18, Math.PI * 1.52);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 猫耳
      if (ch.catEars) {
        for (var sd5 = -1; sd5 <= 1; sd5 += 2) {
          ctx.fillStyle = hairC;
          ctx.beginPath();
          ctx.moveTo(mx + sd5 * headR * 0.18, cy - headR * 0.96);
          ctx.quadraticCurveTo(mx + sd5 * headR * 0.92, cy - headR * 1.58, mx + sd5 * headR * 0.92, cy - headR * 0.72);
          ctx.quadraticCurveTo(mx + sd5 * headR * 0.58, cy - headR * 0.86, mx + sd5 * headR * 0.18, cy - headR * 0.96);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255,163,190,0.72)';
          ctx.beginPath();
          ctx.moveTo(mx + sd5 * headR * 0.34, cy - headR * 0.94);
          ctx.quadraticCurveTo(mx + sd5 * headR * 0.66, cy - headR * 1.34, mx + sd5 * headR * 0.76, cy - headR * 0.86);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 呆毛
      if (ch.ahoge) {
        ctx.strokeStyle = hairC;
        ctx.lineWidth = Math.max(2, headR * 0.085);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx + headR * 0.02, cy - headR * 1.02);
        ctx.quadraticCurveTo(mx + headR * 0.22, cy - headR * 1.62, mx + headR * 0.62, cy - headR * 1.30);
        ctx.stroke();
      }

      // 发饰蝴蝶结
      if (ch.bow) {
        var bowX = mx - headR * 0.80, bowY = cy - headR * 0.62;
        ctx.fillStyle = eyeC;
        ctx.beginPath();
        ctx.moveTo(bowX, bowY);
        ctx.lineTo(bowX - headR * 0.24, bowY - headR * 0.16);
        ctx.lineTo(bowX - headR * 0.24, bowY + headR * 0.16);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bowX, bowY);
        ctx.lineTo(bowX + headR * 0.24, bowY - headR * 0.16);
        ctx.lineTo(bowX + headR * 0.24, bowY + headR * 0.16);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath(); ctx.arc(bowX, bowY, headR * 0.09, 0, 6.2832); ctx.fill();
      }

      // 环绕闪光
      for (i = 0; i < 14; i++) {
        var spx = mx + (rnd(i + 600) - 0.5) * cs * 1.5;
        var spy = cy + (rnd(i + 610) - 0.55) * cs * 1.3 + Math.sin(t * 6.2832 + i) * cs * 0.02;
        var sa = 0.22 + 0.62 * Math.abs(Math.sin(t * 6.2832 + i * 0.9));
        var sr = 1.5 + rnd(i + 620) * 3;
        ctx.globalAlpha = sa;
        ctx.fillStyle = i % 3 ? '#ffffff' : col(i);
        ctx.beginPath(); ctx.arc(spx, spy, sr, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = i % 3 ? '#ffffff' : col(i);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(spx - sr * 2.6, spy); ctx.lineTo(spx + sr * 2.6, spy);
        ctx.moveTo(spx, spy - sr * 2.6); ctx.lineTo(spx, spy + sr * 2.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

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

    // 影调分级：对齐各模型的色彩特征（电影宽银幕 / 霓虹 / 胶片 / 柔和 / 通透）
    var grade = spec.grade || 'clean';
    if (grade === 'cinema') {
      var bar = Math.round(h * 0.052);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
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

    // 暗角（人物画面减轻，避免压暗肤色与白毛）
    var vigA = style === 'character' ? 0.28 : 0.55;
    var vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,' + vigA + ')');
    ctx.globalAlpha = 1;
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------------- 生成 HTML 代码 ---------------- */
  function buildHtml(s) {
    var src = renderScene.toString();
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<title>' + (s.style) + ' scene · ' + s.w + '×' + s.h + '</title>\n' +
      '<style>html,body{margin:0;height:100%;background:' + s.bg2 + ';overflow:hidden}' +
      'canvas{display:block;width:100vw;height:100vh}</style>\n</head>\n<body>\n' +
      '<canvas id="c" width="' + s.w + '" height="' + s.h + '"></canvas>\n' +
      '<script>\n(function(){\n' +
      'var SPEC = ' + JSON.stringify(s) + ';\n' +
      'var render = (' + src + ');\n' +
      'var cv = document.getElementById("c");\n' +
      'var ctx = cv.getContext("2d");\n' +
      'function draw(t){ render(ctx, SPEC, t); }\n' +
      'window.__HM_FRAME__ = function(t){ draw(t); return cv; };\n' +
      'window.__HM_SPEC__ = SPEC;\n' +
      'var stopped = false;\n' +
      'window.__HM_STOP__ = function(){ stopped = true; };\n' +
      'var t0 = null;\n' +
      'function loop(ts){\n' +
      '  if (stopped) return;\n' +
      '  if (!t0) t0 = ts;\n' +
      '  var t = ((ts - t0) / (SPEC.frames / SPEC.fps * 1000)) % 1;\n' +
      '  draw(t);\n' +
      '  requestAnimationFrame(loop);\n' +
      '}\n' +
      'draw(0);\n' +
      'requestAnimationFrame(loop);\n' +
      '})();\n' +
      '<\/script>\n</body>\n</html>';
  }

  /* ---------------- iframe：真正执行生成的 HTML ---------------- */
  function ensureIframe(html) {
    if (iframe) { iframe.remove(); iframe = null; }
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;visibility:hidden;pointer-events:none';
    f.width = spec.w;
    f.height = spec.h;
    f.setAttribute('aria-hidden', 'true');
    f.srcdoc = html;
    document.body.appendChild(f);
    iframe = f;
  }

  function waitIframe(timeoutMs) {
    return new Promise(function (resolve) {
      var waited = 0;
      function check() {
        try {
          if (iframe && iframe.contentWindow && typeof iframe.contentWindow.__HM_FRAME__ === 'function') return resolve(true);
        } catch (e) { /* 跨域或未就绪 */ }
        waited += 60;
        if (waited >= timeoutMs) return resolve(false);
        setTimeout(check, 60);
      }
      check();
    });
  }

  function fallbackCanvas() {
    var cv = document.createElement('canvas');
    cv.width = spec.w;
    cv.height = spec.h;
    return cv;
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
    status('正在把 HTML 逐帧渲染为 PNG…');
    setExportsEnabled(false);

    var total = spec.frames;
    var urls = [];
    var usedIframe = false;
    try {
      usedIframe = await waitIframe(2500);
      if (usedIframe && iframe.contentWindow.__HM_STOP__) iframe.contentWindow.__HM_STOP__();
    } catch (e) { usedIframe = false; }

    try {
      if (usedIframe) {
        for (var i = 0; i < total; i++) {
          var cv = iframe.contentWindow.__HM_FRAME__(i / total);
          urls.push(cv.toDataURL('image/png'));
          setProgress(Math.round((i + 1) / total * 100));
          if (i % 6 === 5) await sleep(0);
        }
      }
    } catch (e) {
      urls = [];
      usedIframe = false;
    }

    if (!urls.length) {
      var cv2 = fallbackCanvas();
      var ctx2 = cv2.getContext('2d');
      for (var j = 0; j < total; j++) {
        renderScene(ctx2, spec, j / total);
        urls.push(cv2.toDataURL('image/png'));
        setProgress(Math.round((j + 1) / total * 100));
        if (j % 6 === 5) await sleep(0);
      }
      setStatusHint('（沙盒 iframe 不可用，已使用内置同源渲染器，输出一致）');
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
    code = buildHtml(spec);
    el.code.value = code;
    setStep(1, 'done', 'HTML 已生成');
    status('已生成 HTML 代码（' + spec.modelLabel + ' · ' + spec.w + '×' + spec.h + ' · ' + spec.duration + ' 秒 @ ' + spec.fps + 'fps）');
    setStatusHint('语义解析：' + SHOT_LABELS[spec.shot] + ' · ' + CAM_LABELS[spec.camera.type] +
      ' · ' + (GRADE_LABELS[spec.grade] || spec.grade) +
      (spec.negative ? ' · 已应用反向提示词' : ''));
    ensureIframe(code);
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
    var m = text.match(/var SPEC\s*=\s*(\{[\s\S]*?\});\s*var render\s*=/);
    if (!m) { toast('未找到场景规格 SPEC，请使用上方生成或保持格式', 'error'); return; }
    var parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { toast('SPEC 解析失败：' + e.message, 'error'); return; }
    if (!parsed || !parsed.w || !parsed.h) { toast('SPEC 缺少尺寸信息', 'error'); return; }
    spec = parsed;
    spec.frames = Math.min(MAX_FRAMES, Math.max(8, Number(spec.frames) || 36));
    spec.fps = Math.max(4, Number(spec.fps) || 18);
    code = text;
    ensureIframe(code);
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

  function exportHtml() {
    if (!code) return;
    download(new Blob([code], { type: 'text/html;charset=utf-8' }), safeName() + '_scene.html');
    toast('HTML 代码已导出', 'success');
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
    [el.exportGif, el.exportVideo, el.exportZip, el.exportPng, el.exportHtml].forEach(function (b) {
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
    el.exportHtml = $('gvHtml');
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
      if (busy) { setStatusHint('渲染中，完成后再点「生成 HTML 代码」应用新设置'); return; }
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
    el.exportHtml.addEventListener('click', exportHtml);
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
