'use strict';
/* =============================================================
 * 绘梦 · 导演台 HMDirector3D（Three.js WebGL 版）
 * 依赖全局 THREE、HMOrbitControls、HMTransformControls
 * 入口：侧边栏 data-rail="director3d"
 * ============================================================= */
window.HMDirector3D = (function () {
  var THREE = window.THREE;
  if (!THREE) {
    console.error('[Director3D] THREE.js 未加载');
    return null;
  }

  var LS_SCENE = 'anidream.director3d.scene.v2';

  var canvas = null, container = null, inspectorEl = null, objListEl = null;
  var renderer, scene, camera;
  var orbit, tControls;
  var raycaster, pointer;

  var active = false, bound = false, rafId = null;
  var objects = [];      // { id, name, kind, three }
  var selectedId = null;
  var seq = 1;

  var showGrid = true;
  var camMode = false;
  var camFly = { pos: new THREE.Vector3(0, 3.5, 13), yaw: -0.65, pitch: -0.06 };
  var camOrbit = { yaw: -0.65, pitch: 0.4, dist: 17, target: new THREE.Vector3(0, 1.2, 0) };

  var ambient, dirLight, fillLight, spotLight, spotTarget;
  var spotOn = false;
  var keys = {};

  /* ---------- 人偶 rig ---------- */
  var POSE_PRESETS = {
    idle: { root: [0, 0, 0], torsoY: 0, torsoX: 0, headY: 0, headX: 0, lShZ: 40, lShX: 0, lEl: 10, rShZ: -40, rShX: 0, rEl: -10, lHp: 0, lKn: 0, rHp: 0, rKn: 0 },
    walk: { root: [0, 0, 0], torsoY: 0, torsoX: 0, headY: 0, headX: 0, lShZ: 20, lShX: -10, lEl: 30, rShZ: -20, rShX: -10, rEl: -30, lHp: -30, lKn: 20, rHp: 30, rKn: -20 },
    run: { root: [0, 0, -0.2], torsoY: 8, torsoX: 0, headY: -2, headX: 0, lShZ: 60, lShX: -20, lEl: 60, rShZ: -60, rShX: -20, rEl: -60, lHp: -60, lKn: 40, rHp: 60, rKn: -40 },
    poseA: { root: [0, 0.3, 0], torsoY: 10, torsoX: 0, headY: 15, headX: 0, lShZ: 90, lShX: -10, lEl: 90, rShZ: -30, rShX: -10, rEl: 30, lHp: 0, lKn: 0, rHp: 0, rKn: 0 },
    poseB: { root: [0, 0, 0], torsoY: -8, torsoX: -5, headY: -10, headX: 5, lShZ: -20, lShX: 20, lEl: -40, rShZ: 20, rShX: -20, rEl: 40, lHp: 20, lKn: -30, rHp: -10, rKn: 0 }
  };

  function makeMannequin(name) {
    var root = new THREE.Group();
    root.name = name;

    var matSkin = new THREE.MeshStandardMaterial({ color: 0xe8cfb4, roughness: 0.85, metalness: 0.02 });
    var matCloth = new THREE.MeshStandardMaterial({ color: 0x7c5cf6, roughness: 0.75, metalness: 0.02 });
    var matHair = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });

    // 大腿
    var lThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 16), matCloth);
    lThigh.position.set(-0.14, 0.28, 0);
    var lHp = new THREE.Group(); lHp.position.set(-0.14, 0.5, 0); lHp.add(lThigh);
    var lShin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 16), matCloth);
    lShin.position.set(0, -0.5, 0);
    var lKn = new THREE.Group(); lShin.position.set(0, 0.28, 0); lKn.add(lShin); lThigh.add(lKn);
    var lFoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.32), matSkin);
    lFoot.position.set(0, 0.04, 0.08);
    lShin.add(lFoot);

    var rThigh = lThigh.clone(); rThigh.scale.x = -1;
    var rHp = new THREE.Group(); rHp.position.set(0.14, 0.5, 0); rHp.add(rThigh);
    var rShin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 16), matCloth);
    rShin.position.set(0, -0.5, 0);
    var rKn = new THREE.Group(); rShin.position.set(0, 0.28, 0); rKn.add(rShin); rThigh.add(rKn);
    var rFoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.32), matSkin);
    rFoot.position.set(0, 0.04, 0.08);
    rShin.add(rFoot);

    // 躯干
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 6, 12), matCloth);
    torso.position.set(0, 0.95, 0);
    var torsoGrp = new THREE.Group(); torsoGrp.add(torso); torsoGrp.position.set(0, 0.95, 0);

    // 手臂
    var lUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.45, 16), matCloth);
    lUpperArm.position.set(0, -0.23, 0);
    var lEl = new THREE.Group(); lEl.position.set(0, -0.45, 0); lUpperArm.add(lEl);
    var lForeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.42, 16), matSkin);
    lForeArm.position.set(0, -0.21, 0); lEl.add(lForeArm);
    var lHand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), matSkin); lHand.position.set(0, -0.45, 0); lEl.add(lHand);
    var lSh = new THREE.Group(); lSh.position.set(-0.32, 0.24, 0); lSh.add(lUpperArm);

    var rUpperArm = lUpperArm.clone();
    var rEl = new THREE.Group(); rEl.position.set(0, -0.45, 0); rUpperArm.add(rEl);
    var rForeArm = lForeArm.clone(); rForeArm.position.set(0, -0.21, 0); rEl.add(rForeArm);
    var rHand = lHand.clone(); rHand.position.set(0, -0.45, 0); rEl.add(rHand);
    var rSh = new THREE.Group(); rSh.position.set(0.32, 0.24, 0); rSh.add(rUpperArm);

    torsoGrp.add(lSh); torsoGrp.add(rSh);

    // 头
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), matSkin);
    neck.position.set(0, 0.38, 0);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), matSkin);
    head.position.set(0, 0.58, 0);
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.185, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.75), matHair);
    hair.position.set(0, 0.62, -0.03);
    var headGrp = new THREE.Group(); headGrp.position.set(0, 1.32, 0);
    headGrp.add(neck); headGrp.add(head); headGrp.add(hair);

    torsoGrp.add(headGrp);
    root.add(lHp); root.add(rHp); root.add(torsoGrp);

    root.userData.bones = {
      root: root, torso: torsoGrp, head: headGrp,
      lSh: lSh, lEl: lEl, rSh: rSh, rEl: rEl,
      lHp: lHp, lKn: lKn, rHp: rHp, rKn: rKn
    };
    applyPose(root, POSE_PRESETS.idle);
    return root;
  }

  function applyPose(root, pose) {
    if (!pose || !root || !root.userData.bones) return;
    var b = root.userData.bones;
    if (pose.root) root.position.set(pose.root[0], pose.root[1], pose.root[2]);
    b.torso.rotation.set(0, (pose.torsoY || 0) * Math.PI / 180, 0);
    b.torso.rotation.x = (pose.torsoX || 0) * Math.PI / 180;
    b.head.rotation.set((pose.headX || 0) * Math.PI / 180, (pose.headY || 0) * Math.PI / 180, 0);
    b.lSh.rotation.z = (pose.lShZ || 0) * Math.PI / 180;
    b.lSh.rotation.x = (pose.lShX || 0) * Math.PI / 180;
    b.lEl.rotation.x = (pose.lEl || 0) * Math.PI / 180;
    b.rSh.rotation.z = (pose.rShZ || 0) * Math.PI / 180;
    b.rSh.rotation.x = (pose.rShX || 0) * Math.PI / 180;
    b.rEl.rotation.x = (pose.rEl || 0) * Math.PI / 180;
    b.lHp.rotation.x = (pose.lHp || 0) * Math.PI / 180;
    b.lKn.rotation.x = (pose.lKn || 0) * Math.PI / 180;
    b.rHp.rotation.x = (pose.rHp || 0) * Math.PI / 180;
    b.rKn.rotation.x = (pose.rKn || 0) * Math.PI / 180;
  }

  /* ---------- 几何体工厂 ---------- */
  function makePrimitive(kind) {
    var mat = new THREE.MeshStandardMaterial({ color: 0xe9edf4, roughness: 0.7, metalness: 0.05 });
    var geo;
    switch (kind) {
      case 'sphere': geo = new THREE.SphereGeometry(0.9, 32, 24); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.8, 0.9, 2, 32); geo.translate(0, 1, 0); break;
      case 'cone': geo = new THREE.ConeGeometry(1, 2, 32); geo.translate(0, 1, 0); break;
      case 'capsule': geo = new THREE.CapsuleGeometry(0.55, 1.1, 10, 18); geo.translate(0, 0.95, 0); break;
      case 'torus': geo = new THREE.TorusGeometry(0.9, 0.25, 16, 48); geo.rotateX(Math.PI / 2); geo.translate(0, 1, 0); break;
      case 'plane': geo = new THREE.PlaneGeometry(2, 2); break;
      case 'cube':
      default: geo = new THREE.BoxGeometry(1.8, 2, 1.8); geo.translate(0, 1, 0); break;
    }
    var m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---------- 场景搭建 ---------- */
  function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e16);
    scene.fog = new THREE.Fog(0x0a0e16, 30, 80);

    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    var grid = new THREE.GridHelper(60, 60, 0x333c52, 0x1f2638);
    grid.material.opacity = 0.7; grid.material.transparent = true;
    scene.add(grid);
    scene.userData.grid = grid;

    var axes = new THREE.AxesHelper(2);
    axes.position.set(0, 0.001, 0);
    scene.add(axes);

    // 地面接收阴影
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    dirLight = new THREE.DirectionalLight(0xfff2dc, 1.1);
    dirLight.position.set(6, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.left = -14; dirLight.shadow.camera.right = 14;
    dirLight.shadow.camera.top = 14; dirLight.shadow.camera.bottom = -14;
    dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 40;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    fillLight = new THREE.DirectionalLight(0x9fb8ff, 0.4);
    fillLight.position.set(-8, 6, -5);
    scene.add(fillLight);

    spotLight = new THREE.SpotLight(0xffffff, 2.2, 30, Math.PI / 6, 0.5, 1.0);
    spotLight.position.set(4, 8, 4);
    spotLight.target = spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 1, 0);
    scene.add(spotLight); scene.add(spotTarget);
    spotLight.castShadow = true;
    spotLight.visible = false;

    raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.1 };
    pointer = new THREE.Vector2();

    orbit = new window.HMOrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.target.copy(camOrbit.target);
    var initPos = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(camOrbit.dist, camOrbit.pitch + Math.PI / 2, camOrbit.yaw)
    ).add(camOrbit.target);
    camera.position.copy(initPos);

    tControls = new window.HMTransformControls(camera, canvas);
    scene.add(tControls._group);
  }

  function resize() {
    if (!container || !renderer) return;
    var rect = container.getBoundingClientRect();
    var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  /* ---------- 对象管理 ---------- */
  function findObject(id) {
    for (var i = 0; i < objects.length; i++) if (objects[i].id === id) return objects[i];
    return null;
  }

  function addPrimitive(kind) {
    var nameMap = {
      cube: '立方体', sphere: '球体', cylinder: '圆柱', cone: '圆锥',
      capsule: '胶囊', torus: '圆环', plane: '平面', mannequin: '人偶'
    };
    var threeObj = kind === 'mannequin' ? makeMannequin(nameMap.mannequin + ' ' + (seq + 1)) : makePrimitive(kind);
    var n = objects.length;
    threeObj.position.set(((n % 5) - 2) * 2.4, kind === 'plane' ? 0 : 0, Math.floor(n / 5) * 2.2);
    threeObj.userData.id = 'o' + (seq);
    var o = {
      id: 'o' + (seq++),
      name: (nameMap[kind] || '白模') + ' ' + (seq - 1),
      kind: kind,
      three: threeObj
    };
    objects.push(o);
    scene.add(threeObj);
    selectObject(o.id);
    renderObjectList();
  }

  function deleteObject(id) {
    var o = findObject(id);
    if (!o) return;
    scene.remove(o.three);
    o.three.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(function (m) { m.dispose(); });
        else c.material.dispose();
      }
    });
    objects = objects.filter(function (x) { return x.id !== id; });
    if (selectedId === id) selectObject(null);
    renderObjectList(); renderInspector();
  }

  function duplicateObject(id) {
    var src = findObject(id);
    if (!src) return;
    var clone = src.three.clone(true);
    clone.traverse(function (c) {
      if (c.isMesh && c.geometry && src.three.geometry !== c.geometry) {}
      if (c.isMesh && !c.geometry) {}
    });
    // 深拷贝材质
    clone.traverse(function (c) {
      if (c.isMesh && c.material) {
        if (Array.isArray(c.material)) c.material = c.material.map(function (m) { return m.clone(); });
        else c.material = c.material.clone();
      }
    });
    clone.position.x += 1.6; clone.position.z += 1.6;
    var newId = 'o' + (seq++);
    clone.userData.id = newId;
    var o = { id: newId, name: src.name + ' 副本', kind: src.kind, three: clone };
    objects.push(o);
    scene.add(clone);
    selectObject(newId);
    renderObjectList();
  }

  function selectObject(id) {
    selectedId = id;
    var o = id ? findObject(id) : null;
    if (o) {
      tControls.setObject(o.three);
    } else {
      tControls.setObject(null);
    }
    renderObjectList(); renderInspector();
  }

  /* ---------- 拾取 ---------- */
  function pickFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var roots = objects.map(function (o) { return o.three; });
    var hits = raycaster.intersectObjects(roots, true);
    for (var i = 0; i < hits.length; i++) {
      var obj = hits[i].object;
      while (obj.parent && roots.indexOf(obj) < 0) obj = obj.parent;
      var id = obj.userData.id;
      var o = findObject(id);
      if (o) return o;
    }
    return null;
  }

  /* ---------- 事件 ---------- */
  function onDown(e) {
    if (!active) return;
    // gizmo 先尝试
    if (tControls.onMouseDown(e)) {
      orbit.enabled = false;
      return;
    }
    if (e.button === 0) {
      var hit = pickFromEvent(e);
      if (hit) { selectObject(hit.id); orbit.enabled = false; return; }
    }
    selectObject(null);
  }
  function onMove(e) {
    if (tControls._dragging) tControls.onMouseMove(e);
  }
  function onUp() {
    if (tControls._dragging) tControls.onMouseUp();
    orbit.enabled = true;
  }

  function onKeyDown(e) {
    if (!active) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) { e.preventDefault(); deleteObject(selectedId); }
      return;
    }
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'g') { showGrid = !showGrid; scene.userData.grid.visible = showGrid; syncTopBar(); }
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  /* ---------- 飞航 ---------- */
  function applyFly() {
    if (!camMode) return;
    var fwd = new THREE.Vector3(-Math.sin(camFly.yaw), 0, -Math.cos(camFly.yaw));
    var right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    var d = new THREE.Vector3();
    if (keys['w']) d.add(fwd);
    if (keys['s']) d.sub(fwd);
    if (keys['a']) d.sub(right);
    if (keys['d']) d.add(right);
    if (keys['q']) d.y -= 1;
    if (keys['e']) d.y += 1;
    if (d.lengthSq() > 0) {
      d.normalize().multiplyScalar(0.16);
      camFly.pos.add(d);
    }
    camera.position.copy(camFly.pos);
  }

  /* ---------- Inspector ---------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderObjectList() {
    if (!objListEl) return;
    if (!objects.length) {
      objListEl.innerHTML = '<div class="hm-d3-list-empty">左侧选几何体或添加人偶</div>';
      return;
    }
    objListEl.innerHTML = objects.map(function (o) {
      var glyph = o.kind === 'mannequin' ? '🧍'
                  : o.kind === 'sphere' ? '●'
                  : o.kind === 'cube' ? '■'
                  : o.kind === 'torus' ? '◯' : '▮';
      return '<div class="hm-d3-obj' + (o.id === selectedId ? ' is-active' : '') + '" data-oid="' + o.id + '">' +
        '<span class="hm-d3-swatch" style="background:' + ({ cube: '#b9c4d9', sphere: '#9fb0d0', cylinder: '#a6b4cc', cone: '#c3ceff', capsule: '#c6d1eb', torus: '#dfe4ef', plane: '#8f9ab0', mannequin: '#e8cfb4' }[o.kind] || '#e9edf4') + '">' + glyph + '</span>' +
        '<span class="hm-d3-obj-name" title="' + esc(o.name) + '">' + esc(o.name) + '</span>' +
        '<button class="hm-d3-obj-del" data-del="' + o.id + '" title="删除">✕</button></div>';
    }).join('');
  }

  function renderInspector() {
    if (!inspectorEl) return;
    var o = selectedId ? findObject(selectedId) : null;
    var html = '<div class="hm-d3-sec-title">选中物体</div>';
    if (!o) {
      html += '<div class="hm-d3-empty">点击画布中的白模<br>或左侧列表选中后<br>即可调整</div>';
    } else {
      var p = o.three.position, r = o.three.rotation, s = o.three.scale;
      html += '<div class="hm-d3-xyz">' +
        '<div><span>X</span><input type="number" step="0.1" data-prop="pos" data-axis="0" value="' + p.x.toFixed(2) + '"></div>' +
        '<div><span>Y</span><input type="number" step="0.1" data-prop="pos" data-axis="1" value="' + p.y.toFixed(2) + '"></div>' +
        '<div><span>Z</span><input type="number" step="0.1" data-prop="pos" data-axis="2" value="' + p.z.toFixed(2) + '"></div></div>';
      html += '<div class="hm-d3-xyz">' +
        '<div><span>RX°</span><input type="number" step="1" data-prop="rot" data-axis="0" value="' + (r.x * 180 / Math.PI).toFixed(1) + '"></div>' +
        '<div><span>RY°</span><input type="number" step="1" data-prop="rot" data-axis="1" value="' + (r.y * 180 / Math.PI).toFixed(1) + '"></div>' +
        '<div><span>RZ°</span><input type="number" step="1" data-prop="rot" data-axis="2" value="' + (r.z * 180 / Math.PI).toFixed(1) + '"></div></div>';
      html += '<div class="hm-d3-xyz">' +
        '<div><span>SX</span><input type="number" step="0.05" min="0.05" data-prop="scl" data-axis="0" value="' + s.x.toFixed(2) + '"></div>' +
        '<div><span>SY</span><input type="number" step="0.05" min="0.05" data-prop="scl" data-axis="1" value="' + s.y.toFixed(2) + '"></div>' +
        '<div><span>SZ</span><input type="number" step="0.05" min="0.05" data-prop="scl" data-axis="2" value="' + s.z.toFixed(2) + '"></div></div>';
      if (o.kind === 'mannequin') {
        html += '<div class="hm-d3-sec-title" style="margin-top:6px">Pose</div>';
        html += '<div class="hm-d3-shapes" style="grid-template-columns:1fr 1fr">' +
          '<button type="button" data-pose="idle">🌙 Idle</button>' +
          '<button type="button" data-pose="walk">🚶 Walk</button>' +
          '<button type="button" data-pose="run">🏃 Run</button>' +
          '<button type="button" data-pose="poseA">💪 Pose A</button>' +
          '<button type="button" data-pose="poseB">🎭 Pose B</button></div>';
      }
      html += '<div class="hm-d3-actions">' +
        '<button type="button" data-act="mode-t">▣ 移动</button>' +
        '<button type="button" data-act="mode-r">↻ 旋转</button>' +
        '<button type="button" data-act="mode-s">↕ 缩放</button>' +
        '</div>';
      html += '<div class="hm-d3-actions">' +
        '<button type="button" data-act="dup">复制</button>' +
        '<button type="button" data-act="del">删除</button></div>';
    }
    html += '<div class="hm-d3-sec-title" style="margin-top:10px">灯光</div>';
    html += '<div class="hm-d3-row"><label>环境光</label><input type="range" min="0" max="1" step="0.02" data-light="ambient" value="' + ambient.intensity.toFixed(2) + '"></div>';
    html += '<div class="hm-d3-row"><label>主光强度</label><input type="range" min="0" max="3" step="0.02" data-light="dirIntensity" value="' + dirLight.intensity.toFixed(2) + '"></div>';
    html += '<div class="hm-d3-row"><label>主光方位</label><input type="range" min="-180" max="180" step="1" data-light="dirAzim" value="45"></div>';
    html += '<div class="hm-d3-row"><label>主光高度</label><input type="range" min="-30" max="90" step="1" data-light="dirElev" value="50"></div>';
    html += '<div class="hm-d3-row"><label>补光强度</label><input type="range" min="0" max="2" step="0.02" data-light="fill" value="' + fillLight.intensity.toFixed(2) + '"></div>';
    html += '<div class="hm-d3-row"><label>聚光灯</label>' +
      '<input type="checkbox" id="d3SpotOn" style="margin-left:auto">' +
      '<span style="font-size:11px;color:#7b8494">' + (spotOn ? '开' : '关') + '</span></div>';
    if (spotOn) {
      html += '<div class="hm-d3-row"><label>锥角</label><input type="range" min="5" max="60" step="1" data-light="spotAngle" value="30"></div>';
      html += '<div class="hm-d3-row"><label>强度</label><input type="range" min="0" max="4" step="0.05" data-light="spotI" value="' + spotLight.intensity.toFixed(2) + '"></div>';
    }
    html += '<div class="hm-d3-row"><label>曝光</label><input type="range" min="0.4" max="1.6" step="0.02" data-light="exposure" value="' + renderer.toneMappingExposure.toFixed(2) + '"></div>';
    inspectorEl.innerHTML = html;
  }

  function bindInspector() {
    if (!inspectorEl) return;
    inspectorEl.addEventListener('input', function (e) {
      var t = e.target; if (!t) return;
      var lp = t.getAttribute('data-light');
      if (lp) {
        var v = parseFloat(t.value);
        if (lp === 'ambient') ambient.intensity = v;
        else if (lp === 'dirIntensity') dirLight.intensity = v;
        else if (lp === 'dirAzim' || lp === 'dirElev') {
          var az = parseFloat(inspectorEl.querySelector('[data-light="dirAzim"]').value) * Math.PI / 180;
          var el = parseFloat(inspectorEl.querySelector('[data-light="dirElev"]').value) * Math.PI / 180;
          var r = 12;
          dirLight.position.set(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
          dirLight.target.position.set(0, 1, 0);
          dirLight.target.updateMatrixWorld();
          dirLight.shadow.camera.updateProjectionMatrix();
        } else if (lp === 'fill') fillLight.intensity = v;
        else if (lp === 'spotAngle') spotLight.angle = v * Math.PI / 180;
        else if (lp === 'spotI') spotLight.intensity = v;
        else if (lp === 'exposure') renderer.toneMappingExposure = v;
        return;
      }
      var prop = t.getAttribute('data-prop');
      if (!prop || !selectedId) return;
      var obj = findObject(selectedId);
      var ax = parseInt(t.getAttribute('data-axis'), 10);
      var v = parseFloat(t.value); if (!isFinite(v)) return;
      if (prop === 'pos') setXYZ(obj.three.position, ax, v);
      else if (prop === 'rot') setXYZ(obj.three.rotation, ax, v * Math.PI / 180);
      else if (prop === 'scl') { setXYZ(obj.three.scale, ax, Math.max(0.05, v)); }
    });
    inspectorEl.addEventListener('click', function (e) {
      var spotCb = e.target.closest('#d3SpotOn');
      if (spotCb) {
        spotOn = spotCb.checked;
        spotLight.visible = spotOn;
        renderInspector(); return;
      }
      var btn = e.target.closest('[data-act]');
      if (btn) {
        var act = btn.getAttribute('data-act');
        if (act === 'mode-t') tControls.setMode('translate');
        else if (act === 'mode-r') tControls.setMode('rotate');
        else if (act === 'mode-s') tControls.setMode('scale');
        else if (act === 'dup') duplicateObject(selectedId);
        else if (act === 'del') deleteObject(selectedId);
        return;
      }
      var pose = e.target.closest('[data-pose]');
      if (pose && selectedId) {
        var o = findObject(selectedId);
        if (o && o.kind === 'mannequin') applyPose(o.three, POSE_PRESETS[pose.getAttribute('data-pose')] || POSE_PRESETS.idle);
      }
    });
  }

  function setXYZ(vec, axis, v) {
    if (axis === 0) vec.x = v;
    else if (axis === 1) vec.y = v;
    else if (axis === 2) vec.z = v;
  }

  /* ---------- 侧栏 / 顶栏 ---------- */
  function bindTopBar() {
    var shapes = document.getElementById('d3Shapes');
    if (shapes) shapes.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-shape]'); if (!btn) return;
      addPrimitive(btn.getAttribute('data-shape'));
    });
    if (objListEl) objListEl.addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) { deleteObject(del.getAttribute('data-del')); return; }
      var row = e.target.closest('[data-oid]');
      if (row) selectObject(row.getAttribute('data-oid'));
    });

    var camBtn = document.getElementById('d3CameraBtn');
    if (camBtn) camBtn.addEventListener('click', toggleCamMode);
    var shotBtn = document.getElementById('d3ShotBtn');
    if (shotBtn) shotBtn.addEventListener('click', captureShot);
    var gridBtn = document.getElementById('d3GridBtn');
    if (gridBtn) gridBtn.addEventListener('click', function () { showGrid = !showGrid; scene.userData.grid.visible = showGrid; syncTopBar(); });
    var resetBtn = document.getElementById('d3ResetCamBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetCamera);
    var saveBtn = document.getElementById('d3SaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveScene);

    // 切换 gizmo 模式按钮
    document.querySelectorAll('.hm-d3-btn[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { tControls.setMode(b.getAttribute('data-mode')); });
    });
  }

  function syncTopBar() {
    var gridBtn = document.getElementById('d3GridBtn');
    if (gridBtn) gridBtn.classList.toggle('is-on', showGrid);
    var camBtn = document.getElementById('d3CameraBtn');
    if (camBtn) camBtn.classList.toggle('is-on', camMode);
    var shotBtn = document.getElementById('d3ShotBtn');
    if (shotBtn) shotBtn.disabled = !camMode;
    var frame = document.getElementById('d3CamFrame');
    if (frame) frame.hidden = !camMode;
  }

  function toggleCamMode() {
    camMode = !camMode;
    if (camMode) {
      // 从轨道相机状态过渡到飞航
      var sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
      camFly.pos.copy(camera.position);
      camFly.yaw = sph.theta;
      camFly.pitch = sph.phi - Math.PI / 2;
      orbit.enabled = false;
    } else {
      // 回到轨道相机
      var target = new THREE.Vector3(0, 1.2, 0);
      var dir = camera.position.clone().sub(target).normalize();
      camOrbit.yaw = Math.atan2(dir.x, dir.z);
      camOrbit.pitch = Math.asin(clamp(dir.y, -1, 1));
      camOrbit.dist = camera.position.distanceTo(target);
      orbit.target.copy(target);
      resetCamera();
      orbit.enabled = true;
    }
    syncTopBar();
  }

  function resetCamera() {
    if (camMode) {
      camFly = { pos: new THREE.Vector3(0, 3.5, 13), yaw: -0.65, pitch: -0.06 };
    } else {
      camOrbit = { yaw: -0.65, pitch: 0.4, dist: 17, target: new THREE.Vector3(0, 1.2, 0) };
      var pos = new THREE.Vector3().setFromSpherical(
        new THREE.Spherical(camOrbit.dist, camOrbit.pitch + Math.PI / 2, camOrbit.yaw)
      ).add(camOrbit.target);
      camera.position.copy(pos);
      orbit.target.copy(camOrbit.target);
      // 让 orbit 立刻进入稳定状态
      orbit._spherical.setFromVector3(camera.position.clone().sub(orbit.target));
      orbit._sphericalDelta.set(0, 0, 0);
      orbit._panOffset.set(0, 0, 0);
    }
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- 主循环 ---------- */
  function loop() {
    if (!active) { rafId = null; return; }
    if (camMode) {
      applyFly();
      // 飞航：先 yaw，再 pitch
      var qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), camFly.yaw);
      var qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camFly.pitch);
      camera.quaternion.copy(qy).multiply(qx);
    } else {
      orbit.update();
    }
    tControls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 截图 / 存档 ---------- */
  function captureShot() {
    var url = null;
    try { renderer.render(scene, camera); url = renderer.domElement.toDataURL('image/png'); } catch (e) { return; }
    var a = document.createElement('a');
    var ts = new Date();
    var stamp = String(ts.getFullYear()) + String(ts.getMonth() + 1).padStart(2, '0') + String(ts.getDate()).padStart(2, '0') +
      '-' + String(ts.getHours()).padStart(2, '0') + String(ts.getMinutes()).padStart(2, '0') + String(ts.getSeconds()).padStart(2, '0');
    a.href = url; a.download = '导演台取景-' + stamp + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('已保存取景截图', 'success');
  }
  function toast(msg, kind) {
    if (window.HMApp && window.HMApp.toast) return window.HMApp.toast(msg, kind);
  }

  function saveScene() {
    try {
      var data = {
        version: 2,
        objects: objects.map(function (o) {
          return {
            id: o.id, name: o.name, kind: o.kind,
            pos: [o.three.position.x, o.three.position.y, o.three.position.z],
            rot: [o.three.rotation.x, o.three.rotation.y, o.three.rotation.z],
            scale: [o.three.scale.x, o.three.scale.y, o.three.scale.z]
          };
        }),
        camera: {
          pos: [camera.position.x, camera.position.y, camera.position.z],
          quat: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w]
        },
        seq: seq
      };
      localStorage.setItem(LS_SCENE, JSON.stringify(data));
      toast('场景已保存到本地', 'success');
    } catch (e) { toast('保存失败', 'error'); }
  }

  function loadScene() {
    var raw = null;
    try { raw = localStorage.getItem(LS_SCENE); } catch (e) { return; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.objects)) {
        objects.forEach(function (o) { scene.remove(o.three); });
        objects = []; selectedId = null;
        var maxSeq = 0;
        data.objects.forEach(function (s) {
          var threeObj;
          if (s.kind === 'mannequin') threeObj = makeMannequin(s.name);
          else threeObj = makePrimitive(s.kind);
          threeObj.position.set(s.pos[0], s.pos[1], s.pos[2]);
          threeObj.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
          threeObj.scale.set(s.scale[0], s.scale[1], s.scale[2]);
          threeObj.userData.id = s.id;
          scene.add(threeObj);
          objects.push({ id: s.id, name: s.name, kind: s.kind, three: threeObj });
          var n = parseInt(String(s.id).replace(/\D/g, ''), 10);
          if (n > maxSeq) maxSeq = n;
        });
        seq = Math.max(maxSeq + 1, seq);
        if (data.camera) {
          camera.position.set(data.camera.pos[0], data.camera.pos[1], data.camera.pos[2]);
          camera.quaternion.set(data.camera.quat[0], data.camera.quat[1], data.camera.quat[2], data.camera.quat[3]);
        }
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- 生命周期 ---------- */
  function init() {
    if (bound) return;
    canvas = document.getElementById('d3Canvas');
    container = document.getElementById('d3Viewport');
    inspectorEl = document.getElementById('d3Inspector');
    objListEl = document.getElementById('d3ObjList');
    if (!canvas || !container) return;
    setupScene();
    bound = true;
    loadScene();
    if (!objects.length) {
      addPrimitive('cube'); addPrimitive('sphere'); addPrimitive('mannequin');
      selectObject(null);
    }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    bindTopBar();
    bindInspector();
    syncTopBar();
    renderObjectList();
    renderInspector();
  }

  function enter() {
    active = true;
    if (!bound) init();
    resize();
    syncTopBar();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function leave() {
    active = false;
    keys = {};
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    // 保存当前状态
    try { saveScene(); } catch (e) {}
  }

  return { init: init, enter: enter, leave: leave };
})();
