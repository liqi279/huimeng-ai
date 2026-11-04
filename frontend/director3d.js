'use strict';
/* =============================================================
 * 绘梦 · 导演台 HMDirector3D（3D 无限画布）
 * 纯 Canvas2D 软件渲染：白模几何体、轨道相机、基础打光、取景截图
 * 容器在 index.html 的 #view-director3d
 * 入口：侧边栏 data-rail="director3d"
 * ============================================================= */
window.HMDirector3D = (function () {
  var RAD = Math.PI / 180;
  var LS_SCENE = 'anidream.director3d.scene.v1';
  var FOV = 50;

  var canvas = null;
  var ctx = null;
  var viewport = null;
  var inspectorEl = null;
  var objListEl = null;

  var active = false;
  var bound = false;
  var running = false;
  var raf = null;
  var VW = 0, VH = 0, DPR = 1;

  /* ---------------- 场景状态 ---------------- */
  var objects = [];
  var selectedId = null;
  var seq = 1;
  var showGrid = true;
  var camMode = false;

  var camOrbit = { yaw: -0.65, pitch: 0.36, dist: 17, target: [0, 1.1, 0] };
  var camFly = { pos: [0, 3.2, 12], yaw: -0.65, pitch: -0.06 };
  var light = { azimuth: 42, elevation: 48, intensity: 1.05, ambient: 0.34 };

  var pickBoxes = [];
  var gizmoAxes = [];
  var drag = null;
  var keys = {};

  /* ---------------- 向量工具 ---------------- */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function normalize(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------------- 网格生成 ---------------- */
  /* 所有白模统一：底面在 y=0，高度 2，中心线 x=z=0 */

  function makeCube() {
    var v = [
      [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [-1, 2, -1], [1, 2, -1], [1, 2, 1], [-1, 2, 1]
    ];
    var f = [
      [0, 1, 2, 3], [4, 7, 6, 5],
      [3, 2, 6, 7], [1, 0, 4, 5],
      [0, 3, 7, 4], [2, 1, 5, 6]
    ];
    return { verts: v, faces: f };
  }

  function makePlane() {
    var v = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]];
    return { verts: v, faces: [[0, 1, 2, 3], [3, 2, 1, 0]] };
  }

  /* 旋转体：profile 为 [[radius, y], ...]，绕 Y 轴旋转 seg 段 */
  function lathe(profile, seg) {
    var verts = [];
    var rings = [];
    for (var i = 0; i < profile.length; i++) {
      var r = profile[i][0];
      var y = profile[i][1];
      var ring = { start: verts.length, count: 0 };
      if (r <= 1e-6) {
        verts.push([0, y, 0]);
        ring.count = 1;
      } else {
        for (var j = 0; j < seg; j++) {
          var a = (j / seg) * Math.PI * 2;
          verts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
        }
        ring.count = seg;
      }
      rings.push(ring);
    }
    var faces = [];
    for (var k = 0; k < rings.length - 1; k++) {
      var A = rings[k], B = rings[k + 1];
      for (var s = 0; s < seg; s++) {
        var s2 = (s + 1) % seg;
        if (A.count === 1 && B.count === seg) {
          faces.push([A.start, B.start + s, B.start + s2]);
        } else if (A.count === seg && B.count === 1) {
          faces.push([A.start + s, B.start, A.start + s2]);
        } else if (A.count === seg && B.count === seg) {
          faces.push([A.start + s, A.start + s2, B.start + s2, B.start + s]);
        }
      }
    }
    /* 底面 / 顶面封口 */
    if (profile[0][0] > 1e-6) {
      var base = [];
      for (var b = 0; b < seg; b++) base.push(rings[0].start + b);
      faces.push(base);
    }
    var lastRing = rings[rings.length - 1];
    if (profile[profile.length - 1][0] > 1e-6) {
      var top = [];
      for (var t = 0; t < seg; t++) top.push(lastRing.start + t);
      faces.push(top);
    }
    return { verts: verts, faces: faces };
  }

  function makeSphere() {
    var N = 10, prof = [];
    for (var i = 0; i <= N; i++) {
      var t = (i / N) * Math.PI;
      prof.push([Math.sin(t), 1 - Math.cos(t)]);
    }
    return lathe(prof, 16);
  }

  function makeCylinder() {
    return lathe([[0.9, 0], [0.9, 2]], 18);
  }

  function makeCone() {
    return lathe([[1, 0], [0, 2]], 20);
  }

  function makeCapsule() {
    var r = 0.55, y0 = 0.55, y1 = 1.45, N = 4, prof = [];
    prof.push([0, 0]);
    for (var i = 1; i <= N; i++) {
      var t = (i / N) * (Math.PI / 2);
      prof.push([r * Math.sin(t), y0 - r * Math.cos(t)]);
    }
    prof.push([r, y1]);
    for (var j = 1; j < N; j++) {
      var t2 = (j / N) * (Math.PI / 2);
      prof.push([r * Math.cos(t2), y1 + r * Math.sin(t2)]);
    }
    prof.push([0, y1 + r]);
    return lathe(prof, 16);
  }

  var MESH_CACHE = {};
  var SHAPES = {
    cube: { name: '立方体', build: makeCube },
    sphere: { name: '球体', build: makeSphere },
    cylinder: { name: '圆柱', build: makeCylinder },
    cone: { name: '圆锥', build: makeCone },
    capsule: { name: '胶囊', build: makeCapsule },
    plane: { name: '平面', build: makePlane }
  };

  function getMesh(type) {
    if (!MESH_CACHE[type]) {
      var def = SHAPES[type] || SHAPES.cube;
      MESH_CACHE[type] = def.build();
    }
    return MESH_CACHE[type];
  }

  /* ---------------- 变换 ---------------- */
  function rotatePoint(p, rot) {
    var rx = rot[0] * RAD, ry = rot[1] * RAD, rz = rot[2] * RAD;
    var x = p[0], y = p[1], z = p[2];
    var cy = Math.cos(rx), sy = Math.sin(rx);
    var y1 = y * cy - z * sy, z1 = y * sy + z * cy;
    var cx = Math.cos(ry), sx = Math.sin(ry);
    var x2 = x * cx + z1 * sx, z2 = -x * sx + z1 * cx;
    var cz = Math.cos(rz), sz = Math.sin(rz);
    var x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
    return [x3, y3, z2];
  }

  function transformVertex(local, obj) {
    var p = [local[0] * obj.scale[0], local[1] * obj.scale[1], local[2] * obj.scale[2]];
    p = rotatePoint(p, obj.rot);
    return [p[0] + obj.pos[0], p[1] + obj.pos[1], p[2] + obj.pos[2]];
  }

  function objectCenter(obj) {
    var c = [0, obj.type === 'plane' ? 0 : 1, 0];
    c = rotatePoint([c[0] * obj.scale[0], c[1] * obj.scale[1], c[2] * obj.scale[2]], obj.rot);
    return [c[0] + obj.pos[0], c[1] + obj.pos[1], c[2] + obj.pos[2]];
  }

  /* ---------------- 相机 ---------------- */
  function orbitEye() {
    var y = camOrbit.yaw, p = camOrbit.pitch, d = camOrbit.dist;
    return [
      camOrbit.target[0] + Math.cos(p) * Math.sin(y) * d,
      camOrbit.target[1] + Math.sin(p) * d,
      camOrbit.target[2] + Math.cos(p) * Math.cos(y) * d
    ];
  }

  function getCamera() {
    var eye, yaw, pitch;
    if (camMode) {
      eye = camFly.pos.slice();
      yaw = camFly.yaw;
      pitch = camFly.pitch;
    } else {
      eye = orbitEye();
      yaw = camOrbit.yaw;
      pitch = camOrbit.pitch;
    }
    var forward = normalize([
      -Math.cos(pitch) * Math.sin(yaw),
      -Math.sin(pitch),
      -Math.cos(pitch) * Math.cos(yaw)
    ]);
    var worldUp = [0, 1, 0];
    var right = normalize(cross(forward, worldUp));
    var up = cross(right, forward);
    return { eye: eye, forward: forward, right: right, up: up };
  }

  function focalLength() {
    return (VH / 2) / Math.tan(FOV * RAD / 2);
  }

  function projectPoint(p, cam) {
    var v = sub(p, cam.eye);
    var zr = dot(v, cam.forward);
    if (zr <= 0.08) return null;
    var xr = dot(v, cam.right);
    var yr = dot(v, cam.up);
    var f = focalLength();
    return { x: VW / 2 + (xr / zr) * f, y: VH / 2 - (yr / zr) * f, z: zr };
  }

  /* ---------------- 渲染 ---------------- */
  function resize() {
    if (!canvas || !viewport) return;
    var rect = viewport.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr) && VW === w && VH === h) return;
    VW = w; VH = h; DPR = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function lightVector() {
    var az = light.azimuth * RAD, el = light.elevation * RAD;
    return normalize([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
  }

  function shadeColor(n) {
    var L = lightVector();
    var lum = light.ambient + light.intensity * Math.max(0, dot(n, L));
    lum = clamp(lum, 0, 1.5);
    var base = [233, 237, 243], dark = [96, 108, 132];
    var k = Math.min(1, lum);
    var r = dark[0] + (base[0] - dark[0]) * k;
    var g = dark[1] + (base[1] - dark[1]) * k;
    var b = dark[2] + (base[2] - dark[2]) * k;
    if (lum > 1) {
      var e = (lum - 1) * 0.75;
      r += (255 - r) * e; g += (255 - g) * e; b += (255 - b) * e;
    }
    return 'rgb(' + Math.round(clamp(r, 0, 255)) + ',' +
      Math.round(clamp(g, 0, 255)) + ',' + Math.round(clamp(b, 0, 255)) + ')';
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0e1522');
    g.addColorStop(0.55, '#0a0e17');
    g.addColorStop(1, '#06080e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    /* 地平线柔光 */
    var hg = ctx.createRadialGradient(VW / 2, VH * 0.62, 10, VW / 2, VH * 0.62, Math.max(VW, VH) * 0.8);
    hg.addColorStop(0, 'rgba(79,140,255,0.10)');
    hg.addColorStop(1, 'rgba(79,140,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, VW, VH);
  }

  function drawGrid(cam) {
    if (!showGrid) return;
    var ext = 18;
    var step = 1;
    var baseX = Math.round(camMode ? camFly.pos[0] : camOrbit.target[0]);
    var baseZ = Math.round(camMode ? camFly.pos[2] : camOrbit.target[2]);
    var i, x0, z0, a, b, major;
    for (i = -ext; i <= ext; i += step) {
      /* 沿 Z 方向的线（固定 x） */
      x0 = baseX + i;
      a = projectPoint([x0, 0, baseZ - ext], cam);
      b = projectPoint([x0, 0, baseZ + ext], cam);
      major = (x0 % 5 === 0);
      strokeSeg(a, b, major, Math.abs(i));
      /* 沿 X 方向的线（固定 z） */
      z0 = baseZ + i;
      a = projectPoint([baseX - ext, 0, z0], cam);
      b = projectPoint([baseX + ext, 0, z0], cam);
      major = (z0 % 5 === 0);
      strokeSeg(a, b, major, Math.abs(i));
    }
    /* 坐标轴 */
    var o = projectPoint([baseX, 0, baseZ], cam);
    var px = projectPoint([baseX + 3, 0, baseZ], cam);
    var pz = projectPoint([baseX, 0, baseZ + 3], cam);
    if (o && px) {
      ctx.strokeStyle = 'rgba(255,92,122,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(px.x, px.y); ctx.stroke();
    }
    if (o && pz) {
      ctx.strokeStyle = 'rgba(79,140,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(pz.x, pz.y); ctx.stroke();
    }
  }

  function strokeSeg(a, b, major, distIndex) {
    if (!a || !b) return;
    var fade = clamp(1 - distIndex / 20, 0.06, 1);
    if (major) {
      ctx.strokeStyle = 'rgba(120,140,170,' + (0.26 * fade).toFixed(3) + ')';
      ctx.lineWidth = 1;
    } else {
      ctx.strokeStyle = 'rgba(96,112,140,' + (0.13 * fade).toFixed(3) + ')';
      ctx.lineWidth = 1;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function draw() {
    if (!canvas || !ctx) return;
    resize();
    if (VW <= 0 || VH <= 0) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground();
    var cam = getCamera();
    drawGrid(cam);

    /* 收集所有面 */
    var polys = [];
    pickBoxes = [];
    var objCenter, mesh, verts, i, j;
    for (i = 0; i < objects.length; i++) {
      var obj = objects[i];
      mesh = getMesh(obj.type);
      verts = [];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var depthSum = 0, depthCount = 0;
      for (j = 0; j < mesh.verts.length; j++) {
        var wp = transformVertex(mesh.verts[j], obj);
        var sp = projectPoint(wp, cam);
        verts.push({ w: wp, s: sp });
        if (sp) {
          if (sp.x < minX) minX = sp.x;
          if (sp.y < minY) minY = sp.y;
          if (sp.x > maxX) maxX = sp.x;
          if (sp.y > maxY) maxY = sp.y;
          depthSum += sp.z; depthCount++;
        }
      }
      objCenter = objectCenter(obj);
      if (depthCount) {
        pickBoxes.push({
          id: obj.id,
          x0: minX, y0: minY, x1: maxX, y1: maxY,
          depth: depthSum / depthCount
        });
      }
      /* 面 */
      for (j = 0; j < mesh.faces.length; j++) {
        var face = mesh.faces[j];
        var pts = [];
        var ok = true;
        for (var k = 0; k < face.length; k++) {
          var sv = verts[face[k]];
          if (!sv || !sv.s) { ok = false; break; }
          pts.push(sv.s);
        }
        if (!ok || pts.length < 3) continue;
        /* 世界法线：按面中心朝外 */
        var w0 = verts[face[0]].w, w1 = verts[face[1]].w, w2 = verts[face[2]].w;
        var n = normalize(cross(sub(w1, w0), sub(w2, w0)));
        var fc = [0, 0, 0];
        for (var q = 0; q < face.length; q++) {
          var wq = verts[face[q]].w;
          fc[0] += wq[0]; fc[1] += wq[1]; fc[2] += wq[2];
        }
        fc = mul(fc, 1 / face.length);
        if (dot(n, sub(fc, objCenter)) < 0) n = mul(n, -1);
        /* 背面剔除 */
        if (dot(n, sub(cam.eye, fc)) <= 0) continue;
        var dsum = 0;
        for (var m = 0; m < pts.length; m++) dsum += pts[m].z;
        polys.push({ pts: pts, depth: dsum / pts.length, normal: n, id: obj.id });
      }
    }

    polys.sort(function (a, b) { return b.depth - a.depth; });

    for (i = 0; i < polys.length; i++) {
      var poly = polys[i];
      var selected = (poly.id === selectedId);
      ctx.beginPath();
      ctx.moveTo(poly.pts[0].x, poly.pts[0].y);
      for (j = 1; j < poly.pts.length; j++) ctx.lineTo(poly.pts[j].x, poly.pts[j].y);
      ctx.closePath();
      ctx.fillStyle = shadeColor(poly.normal);
      ctx.fill();
      ctx.lineWidth = selected ? 1.4 : 1;
      ctx.strokeStyle = selected ? 'rgba(79,140,255,0.85)' : 'rgba(255,255,255,0.10)';
      ctx.stroke();
    }

    drawGizmo(cam);
    drawSelectionBadge(cam);
  }

  function drawSelectionBadge(cam) {
    if (!selectedId) return;
    var obj = findObject(selectedId);
    if (!obj) return;
    var sp = projectPoint(objectCenter(obj), cam);
    if (!sp) return;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(79,140,255,0.9)';
    ctx.fillText(obj.name, sp.x + 12, sp.y - 12);
  }

  function drawGizmo(cam) {
    gizmoAxes = [];
    if (!selectedId) return;
    var obj = findObject(selectedId);
    if (!obj) return;
    var origin = objectCenter(obj);
    var originSp = projectPoint(origin, cam);
    if (!originSp) return;
    var axes = [
      { key: 'x', dir: [1, 0, 0], color: '#ff5c7a' },
      { key: 'y', dir: [0, 1, 0], color: '#52c41a' },
      { key: 'z', dir: [0, 0, 1], color: '#4f8cff' }
    ];
    var L = 1.8;
    for (var i = 0; i < axes.length; i++) {
      var ax = axes[i];
      var end = add(origin, mul(ax.dir, L));
      var endSp = projectPoint(end, cam);
      if (!endSp) continue;
      ctx.strokeStyle = ax.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(originSp.x, originSp.y);
      ctx.lineTo(endSp.x, endSp.y);
      ctx.stroke();
      /* 轴端小球 */
      ctx.beginPath();
      ctx.arc(endSp.x, endSp.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = ax.color;
      ctx.fill();
      gizmoAxes.push({
        key: ax.key,
        ox: originSp.x, oy: originSp.y,
        ex: endSp.x, ey: endSp.y,
        dir: ax.dir
      });
    }
  }

  /* ---------------- 拾取 ---------------- */
  function localPoint(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pickObject(x, y) {
    var best = null;
    for (var i = 0; i < pickBoxes.length; i++) {
      var b = pickBoxes[i];
      var pad = 4;
      if (x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad) {
        if (!best || b.depth < best.depth) best = b;
      }
    }
    return best;
  }

  function hitGizmoAxis(x, y) {
    var best = null, bestDist = 10;
    for (var i = 0; i < gizmoAxes.length; i++) {
      var a = gizmoAxes[i];
      var dx = a.ex - a.ox, dy = a.ey - a.oy;
      var l2 = dx * dx + dy * dy;
      var t = l2 ? ((x - a.ox) * dx + (y - a.oy) * dy) / l2 : 0;
      t = clamp(t, 0, 1);
      var px = a.ox + dx * t, py = a.oy + dy * t;
      var d = Math.hypot(x - px, y - py);
      if (d < bestDist) { bestDist = d; best = a; }
    }
    return best;
  }

  /* ---------------- 交互 ---------------- */
  function onMouseDown(e) {
    if (!canvas) return;
    e.preventDefault();
    var p = localPoint(e);
    /* 右键 / 中键：平移视图 */
    if (e.button === 2 || e.button === 1) {
      drag = { mode: 'pan', x: e.clientX, y: e.clientY };
      return;
    }
    /* gizmo 轴优先 */
    var axis = hitGizmoAxis(p.x, p.y);
    if (axis) {
      var obj = findObject(selectedId);
      if (obj) {
        drag = {
          mode: 'axis',
          axis: axis,
          obj: obj,
          startPos: obj.pos.slice(),
          sx: e.clientX,
          sy: e.clientY
        };
        return;
      }
    }
    /* 选中物体 */
    var hit = pickObject(p.x, p.y);
    if (hit) {
      selectObject(hit.id);
      drag = { mode: 'move', x: e.clientX, y: e.clientY, depth: hit.depth };
      return;
    }
    /* 空白 */
    if (camMode) {
      drag = { mode: 'look', x: e.clientX, y: e.clientY };
    } else {
      drag = { mode: 'orbit', x: e.clientX, y: e.clientY };
    }
    selectObject(null);
  }

  function onMouseMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    var cam = getCamera();
    if (drag.mode === 'orbit') {
      camOrbit.yaw -= dx * 0.006;
      camOrbit.pitch = clamp(camOrbit.pitch + dy * 0.006, -1.45, 1.45);
      drag.x = e.clientX; drag.y = e.clientY;
    } else if (drag.mode === 'look') {
      camFly.yaw -= dx * 0.005;
      camFly.pitch = clamp(camFly.pitch - dy * 0.005, -1.45, 1.45);
      drag.x = e.clientX; drag.y = e.clientY;
    } else if (drag.mode === 'pan') {
      var k = (camMode ? 0.02 : camOrbit.dist / 900);
      var move = add(mul(cam.right, -dx * k), mul(cam.up, dy * k));
      if (camMode) {
        camFly.pos = add(camFly.pos, move);
      } else {
        camOrbit.target = add(camOrbit.target, move);
      }
      drag.x = e.clientX; drag.y = e.clientY;
    } else if (drag.mode === 'move') {
      var obj = findObject(selectedId);
      if (obj) {
        var f = focalLength() || 1;
        var scale = (drag.depth || 1) / f;
        var d = add(mul(cam.right, dx * scale), mul(cam.up, -dy * scale));
        obj.pos = add(obj.pos, d);
        syncInspectorValues(obj);
      }
      drag.x = e.clientX; drag.y = e.clientY;
    } else if (drag.mode === 'axis') {
      var a = drag.axis;
      var sx = a.ex - a.ox, sy = a.ey - a.oy;
      var l = Math.hypot(sx, sy);
      if (l > 1) {
        var proj = ((e.clientX - drag.sx) * sx + (e.clientY - drag.sy) * sy) / l;
        var world = proj * (1.8 / l);
        var o = drag.obj;
        o.pos = [
          drag.startPos[0] + a.dir[0] * world,
          drag.startPos[1] + a.dir[1] * world,
          drag.startPos[2] + a.dir[2] * world
        ];
        syncInspectorValues(o);
      }
    }
  }

  function onMouseUp() {
    drag = null;
  }

  function onWheel(e) {
    if (!canvas) return;
    e.preventDefault();
    var delta = e.deltaY > 0 ? 1 : -1;
    if (camMode) {
      camFly.pos = add(camFly.pos, mul(getCamera().forward, delta * 1.2));
    } else {
      camOrbit.dist = clamp(camOrbit.dist * (delta > 0 ? 1.12 : 0.89), 2, 120);
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) {
        e.preventDefault();
        deleteObject(selectedId);
      }
      return;
    }
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'g') {
      showGrid = !showGrid;
      syncToolButtons();
    }
  }

  function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
  }

  function applyFly() {
    if (!camMode) return;
    var cam = getCamera();
    var speed = 0.14;
    var right = [cam.right[0], 0, cam.right[2]];
    if (len(right) < 0.2) right = [1, 0, 0];
    right = normalize(right);
    var fwd = [cam.forward[0], 0, cam.forward[2]];
    if (len(fwd) < 0.2) fwd = [0, 0, -1];
    fwd = normalize(fwd);
    var d = [0, 0, 0];
    if (keys['w']) d = add(d, fwd);
    if (keys['s']) d = add(d, mul(fwd, -1));
    if (keys['a']) d = add(d, mul(right, -1));
    if (keys['d']) d = add(d, right);
    if (keys['q']) d = add(d, [0, -1, 0]);
    if (keys['e']) d = add(d, [0, 1, 0]);
    if (len(d) > 0) camFly.pos = add(camFly.pos, mul(normalize(d), speed));
  }

  /* ---------------- 场景操作 ---------------- */
  function findObject(id) {
    for (var i = 0; i < objects.length; i++) {
      if (objects[i].id === id) return objects[i];
    }
    return null;
  }

  function addShape(type) {
    var def = SHAPES[type] || SHAPES.cube;
    var obj = {
      id: 'o' + (seq++),
      type: type in SHAPES ? type : 'cube',
      name: (def.name || '白模') + ' ' + seq,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1]
    };
    /* 沿 X 轴错开摆放，避免重叠 */
    var n = objects.length;
    obj.pos = [(n % 6 - 2) * 2.6, 0, Math.floor(n / 6) * 2.6];
    objects.push(obj);
    selectObject(obj.id);
    renderObjectList();
  }

  function deleteObject(id) {
    objects = objects.filter(function (o) { return o.id !== id; });
    if (selectedId === id) selectedId = null;
    renderObjectList();
    renderInspector();
  }

  function duplicateObject(id) {
    var src = findObject(id);
    if (!src) return;
    var obj = {
      id: 'o' + (seq++),
      type: src.type,
      name: src.name + ' 副本',
      pos: [src.pos[0] + 1.6, src.pos[1], src.pos[2] + 1.6],
      rot: src.rot.slice(),
      scale: src.scale.slice()
    };
    objects.push(obj);
    selectObject(obj.id);
    renderObjectList();
  }

  function selectObject(id) {
    selectedId = id;
    renderObjectList();
    renderInspector();
  }

  /* ---------------- 侧栏 / 属性面板 ---------------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderObjectList() {
    if (!objListEl) return;
    if (!objects.length) {
      objListEl.innerHTML = '<div class="hm-d3-list-empty">还没有白模，点击左侧添加</div>';
      return;
    }
    objListEl.innerHTML = objects.map(function (o) {
      return '<div class="hm-d3-obj' + (o.id === selectedId ? ' is-active' : '') + '" data-oid="' + o.id + '">' +
        '<span class="hm-d3-swatch"></span>' +
        '<span class="hm-d3-obj-name" title="' + esc(o.name) + '">' + esc(o.name) + '</span>' +
        '<button class="hm-d3-obj-del" data-del="' + o.id + '" title="删除">✕</button>' +
        '</div>';
    }).join('');
  }

  function numRow(label, key, axis, value) {
    return '<div class="hm-d3-row"><label>' + label + '</label>' +
      '<input type="number" step="0.1" data-prop="' + key + '" data-axis="' + axis + '" value="' + value + '"></div>';
  }

  function renderInspector() {
    if (!inspectorEl) return;
    var obj = selectedId ? findObject(selectedId) : null;
    var html = '';
    html += '<div class="hm-d3-sec-title">选中物体</div>';
    if (!obj) {
      html += '<div class="hm-d3-empty">点击画布中的白模<br>或左侧列表选中后<br>即可调整位置 / 旋转 / 缩放</div>';
    } else {
      var p = obj.pos, r = obj.rot, s = obj.scale;
      html += '<div class="hm-d3-xyz">' +
        '<div><span>位置 X</span><input type="number" step="0.1" data-prop="pos" data-axis="0" value="' + p[0].toFixed(2) + '"></div>' +
        '<div><span>位置 Y</span><input type="number" step="0.1" data-prop="pos" data-axis="1" value="' + p[1].toFixed(2) + '"></div>' +
        '<div><span>位置 Z</span><input type="number" step="0.1" data-prop="pos" data-axis="2" value="' + p[2].toFixed(2) + '"></div>' +
        '</div>';
      html += '<div class="hm-d3-xyz">' +
        '<div><span>旋转 X°</span><input type="number" step="1" data-prop="rot" data-axis="0" value="' + r[0].toFixed(1) + '"></div>' +
        '<div><span>旋转 Y°</span><input type="number" step="1" data-prop="rot" data-axis="1" value="' + r[1].toFixed(1) + '"></div>' +
        '<div><span>旋转 Z°</span><input type="number" step="1" data-prop="rot" data-axis="2" value="' + r[2].toFixed(1) + '"></div>' +
        '</div>';
      html += '<div class="hm-d3-xyz">' +
        '<div><span>缩放 X</span><input type="number" step="0.05" min="0.05" data-prop="scale" data-axis="0" value="' + s[0].toFixed(2) + '"></div>' +
        '<div><span>缩放 Y</span><input type="number" step="0.05" min="0.05" data-prop="scale" data-axis="1" value="' + s[1].toFixed(2) + '"></div>' +
        '<div><span>缩放 Z</span><input type="number" step="0.05" min="0.05" data-prop="scale" data-axis="2" value="' + s[2].toFixed(2) + '"></div>' +
        '</div>';
      html += '<div class="hm-d3-actions">' +
        '<button type="button" data-act="dup">复制</button>' +
        '<button type="button" data-act="reset">复位</button>' +
        '<button type="button" data-act="del">删除</button>' +
        '</div>';
    }
    html += '<div class="hm-d3-sec-title" style="margin-top:8px">打光</div>';
    html += '<div class="hm-d3-row"><label>主光方位</label><input type="range" min="0" max="360" step="1" data-light="azimuth" value="' + light.azimuth + '"></div>';
    html += '<div class="hm-d3-row"><label>主光高度</label><input type="range" min="-20" max="90" step="1" data-light="elevation" value="' + light.elevation + '"></div>';
    html += '<div class="hm-d3-row"><label>主光强度</label><input type="range" min="0" max="2" step="0.02" data-light="intensity" value="' + light.intensity + '"></div>';
    html += '<div class="hm-d3-row"><label>环境光</label><input type="range" min="0" max="1" step="0.02" data-light="ambient" value="' + light.ambient + '"></div>';
    inspectorEl.innerHTML = html;
  }

  /* 拖拽时同步数字输入框，避免整块重绘导致焦点丢失 */
  function syncInspectorValues(obj) {
    if (!inspectorEl) return;
    ['pos', 'rot', 'scale'].forEach(function (key) {
      var inputs = inspectorEl.querySelectorAll('[data-prop="' + key + '"]');
      for (var i = 0; i < inputs.length; i++) {
        var ax = parseInt(inputs[i].getAttribute('data-axis'), 10);
        var v = obj[key][ax];
        if (document.activeElement !== inputs[i]) {
          inputs[i].value = v.toFixed(2);
        }
      }
    });
  }

  function bindInspector() {
    if (!inspectorEl) return;
    inspectorEl.addEventListener('input', function (e) {
      var t = e.target;
      if (!t) return;
      var lp = t.getAttribute('data-light');
      if (lp) {
        light[lp] = parseFloat(t.value);
        return;
      }
      var prop = t.getAttribute('data-prop');
      if (!prop || !selectedId) return;
      var obj = findObject(selectedId);
      if (!obj) return;
      var ax = parseInt(t.getAttribute('data-axis'), 10);
      var v = parseFloat(t.value);
      if (!isFinite(v)) return;
      if (prop === 'scale') v = Math.max(0.05, v);
      obj[prop][ax] = v;
    });
    inspectorEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || !selectedId) return;
      var act = btn.getAttribute('data-act');
      if (act === 'dup') duplicateObject(selectedId);
      else if (act === 'del') deleteObject(selectedId);
      else if (act === 'reset') {
        var obj = findObject(selectedId);
        if (obj) {
          obj.rot = [0, 0, 0];
          obj.scale = [1, 1, 1];
          renderInspector();
        }
      }
    });
  }

  /* ---------------- 顶部工具栏 ---------------- */
  function syncToolButtons() {
    var gridBtn = document.getElementById('d3GridBtn');
    if (gridBtn) gridBtn.classList.toggle('is-on', showGrid);
    var camBtn = document.getElementById('d3CameraBtn');
    if (camBtn) camBtn.classList.toggle('is-on', camMode);
    var shotBtn = document.getElementById('d3ShotBtn');
    if (shotBtn) shotBtn.disabled = !camMode;
    var frame = document.getElementById('d3CamFrame');
    if (frame) frame.hidden = !camMode;
  }

  function bindToolbar() {
    var shapes = document.getElementById('d3Shapes');
    if (shapes) {
      shapes.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-shape]');
        if (!btn) return;
        addShape(btn.getAttribute('data-shape'));
      });
    }
    if (objListEl) {
      objListEl.addEventListener('click', function (e) {
        var del = e.target.closest('[data-del]');
        if (del) {
          deleteObject(del.getAttribute('data-del'));
          return;
        }
        var row = e.target.closest('[data-oid]');
        if (row) selectObject(row.getAttribute('data-oid'));
      });
    }
    var camBtn = document.getElementById('d3CameraBtn');
    if (camBtn) {
      camBtn.addEventListener('click', function () {
        camMode = !camMode;
        if (camMode) {
          camFly.pos = orbitEye();
          camFly.yaw = camOrbit.yaw;
          camFly.pitch = camOrbit.pitch;
        } else {
          /* 退出取景时回到轨道视角，保持看向同一方向 */
          camOrbit.yaw = camFly.yaw;
          camOrbit.pitch = clamp(camFly.pitch, -1.45, 1.45);
        }
        syncToolButtons();
      });
    }
    var shotBtn = document.getElementById('d3ShotBtn');
    if (shotBtn) shotBtn.addEventListener('click', captureShot);
    var gridBtn = document.getElementById('d3GridBtn');
    if (gridBtn) {
      gridBtn.addEventListener('click', function () {
        showGrid = !showGrid;
        syncToolButtons();
      });
    }
    var resetBtn = document.getElementById('d3ResetCamBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (camMode) {
          camFly.pos = [0, 3.2, 12];
          camFly.yaw = -0.65;
          camFly.pitch = -0.06;
        } else {
          camOrbit = { yaw: -0.65, pitch: 0.36, dist: 17, target: [0, 1.1, 0] };
        }
      });
    }
    var saveBtn = document.getElementById('d3SaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveScene);
  }

  /* ---------------- 截图 / 存档 ---------------- */
  function captureShot() {
    if (!canvas) return;
    var url;
    try { url = canvas.toDataURL('image/png'); } catch (e) { return; }
    var a = document.createElement('a');
    var ts = new Date();
    var stamp = String(ts.getFullYear()) +
      String(ts.getMonth() + 1).padStart(2, '0') +
      String(ts.getDate()).padStart(2, '0') + '-' +
      String(ts.getHours()).padStart(2, '0') +
      String(ts.getMinutes()).padStart(2, '0') +
      String(ts.getSeconds()).padStart(2, '0');
    a.href = url;
    a.download = '导演台取景-' + stamp + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (window.HMApp && window.HMApp.toast) window.HMApp.toast('已保存取景截图', 'success');
  }

  function saveScene() {
    try {
      localStorage.setItem(LS_SCENE, JSON.stringify({ objects: objects, seq: seq, light: light }));
      if (window.HMApp && window.HMApp.toast) window.HMApp.toast('场景已保存到本地', 'success');
    } catch (e) {
      if (window.HMApp && window.HMApp.toast) window.HMApp.toast('保存失败：本地存储不可用', 'error');
    }
  }

  function loadScene() {
    var raw = null;
    try { raw = localStorage.getItem(LS_SCENE); } catch (e) { return; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.objects)) {
        objects = data.objects.filter(function (o) {
          return o && o.type && SHAPES[o.type] && Array.isArray(o.pos);
        }).map(function (o) {
          return {
            id: o.id || ('o' + (seq++)),
            type: o.type,
            name: o.name || '白模',
            pos: o.pos.slice(0, 3),
            rot: Array.isArray(o.rot) ? o.rot.slice(0, 3) : [0, 0, 0],
            scale: Array.isArray(o.scale) ? o.scale.slice(0, 3) : [1, 1, 1]
          };
        });
        if (typeof data.seq === 'number') seq = data.seq;
        if (data.light) {
          light.azimuth = data.light.azimuth != null ? data.light.azimuth : light.azimuth;
          light.elevation = data.light.elevation != null ? data.light.elevation : light.elevation;
          light.intensity = data.light.intensity != null ? data.light.intensity : light.intensity;
          light.ambient = data.light.ambient != null ? data.light.ambient : light.ambient;
        }
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 主循环 ---------------- */
  function loop() {
    if (!active) { running = false; return; }
    applyFly();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* ---------------- 生命周期 ---------------- */
  function init() {
    if (bound) return;
    canvas = document.getElementById('d3Canvas');
    viewport = document.getElementById('d3Viewport');
    inspectorEl = document.getElementById('d3Inspector');
    objListEl = document.getElementById('d3ObjList');
    if (!canvas || !viewport) return;
    ctx = canvas.getContext('2d');
    bound = true;

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    bindToolbar();
    bindInspector();
    loadScene();
    if (!objects.length) {
      addShape('cube');
      addShape('sphere');
      addShape('capsule');
    }
    selectedId = null;
    renderObjectList();
    renderInspector();
    syncToolButtons();
    draw();
  }

  function enter() {
    active = true;
    if (!bound) init();
    resize();
    renderObjectList();
    renderInspector();
    syncToolButtons();
    startLoop();
  }

  function leave() {
    active = false;
    keys = {};
    drag = null;
    stopLoop();
  }

  return {
    init: init,
    enter: enter,
    leave: leave,
    addShape: addShape,
    saveScene: saveScene
  };
})();
