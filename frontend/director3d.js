'use strict';
/* =============================================================
 * 绘梦 · 导演台 HMDirector3D（Three.js WebGL + GLB + AI 3D 生成）
 * 依赖全局 THREE / HMOrbitControls / HMTransformControls / HMDRACOLoader / HMGLTFLoader
 * 支持：上传 .glb / .gltf 真实模型 · Tripo AI 文字/图片生成 3D
 * ============================================================= */
window.HMDirector3D = (function () {
  var THREE = window.THREE;
  if (!THREE) { console.error('[Director3D] THREE.js 未加载'); return null; }
  if (!window.HMGLTFLoader) { console.error('[Director3D] HMGLTFLoader 未加载'); return null; }

  var LS_SCENE = 'anidream.director3d.scene.v2';
  var LS_TRIPO_KEY = 'anidream.tripo.key';
  var TRIPO_API_BASE = 'https://api.tripo3d.ai/v2/openapi';

  var canvas, container, inspectorEl, objListEl, gizmoBarEl;
  var renderer, scene, camera, orbit, tControls;
  var raycaster, pointer, gltfLoader, dracoLoader;

  var active = false, bound = false, rafId = null;
  var objects = [];
  var selectedId = null, seq = 1;

  var dragMove = null;   // 在视口里直接拖动白模的状态

  var showGrid = true, camMode = false;
  var camFly = { pos: new THREE.Vector3(0, 3.5, 13), yaw: -0.65, pitch: -0.06 };
  var camOrbit = { yaw: -0.65, pitch: 0.4, dist: 17, target: new THREE.Vector3(0, 1.2, 0) };

  var ambient, dirLight, fillLight, spotLight, spotTarget;
  var spotOn = false, keys = {};

  /* ---------- 基础几何体 ---------- */
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

  /* ---------- 人偶 rig ---------- */
  function makeMannequin(name) {
    var root = new THREE.Group(); root.name = name;
    var matSkin = new THREE.MeshStandardMaterial({ color: 0xe8cfb4, roughness: 0.85 });
    var matCloth = new THREE.MeshStandardMaterial({ color: 0x7c5cf6, roughness: 0.75 });
    var matHair = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });

    var lThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 16), matCloth);
    lThigh.position.set(-0.14, 0.28, 0);
    var lHp = new THREE.Group(); lHp.position.set(-0.14, 0.5, 0); lHp.add(lThigh);
    var lShin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 16), matCloth);
    var lKn = new THREE.Group(); lShin.position.set(0, 0.28, 0); lKn.add(lShin); lThigh.add(lKn);
    var lFoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.32), matSkin); lFoot.position.set(0, 0.04, 0.08); lShin.add(lFoot);

    var rThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 16), matCloth);
    rThigh.position.set(0.14, 0.28, 0);
    var rHp = new THREE.Group(); rHp.position.set(0.14, 0.5, 0); rHp.add(rThigh);
    var rShin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 16), matCloth);
    var rKn = new THREE.Group(); rShin.position.set(0, 0.28, 0); rKn.add(rShin); rThigh.add(rKn);
    var rFoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.32), matSkin); rFoot.position.set(0, 0.04, 0.08); rShin.add(rFoot);

    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 6, 12), matCloth);
    torso.position.set(0, 0.95, 0);
    var torsoGrp = new THREE.Group(); torsoGrp.add(torso); torsoGrp.position.set(0, 0.95, 0);

    var lUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.45, 16), matCloth);
    lUpperArm.position.set(0, -0.23, 0);
    var lEl = new THREE.Group(); lEl.position.set(0, -0.45, 0); lUpperArm.add(lEl);
    var lForeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.42, 16), matSkin);
    lForeArm.position.set(0, -0.21, 0); lEl.add(lForeArm);
    var lHand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), matSkin); lHand.position.set(0, -0.45, 0); lEl.add(lHand);
    var lSh = new THREE.Group(); lSh.position.set(-0.32, 0.24, 0); lSh.add(lUpperArm);

    var rUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.45, 16), matCloth);
    rUpperArm.position.set(0, -0.23, 0);
    var rEl = new THREE.Group(); rEl.position.set(0, -0.45, 0); rUpperArm.add(rEl);
    var rForeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.42, 16), matSkin);
    rForeArm.position.set(0, -0.21, 0); rEl.add(rForeArm);
    var rHand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), matSkin); rHand.position.set(0, -0.45, 0); rEl.add(rHand);
    var rSh = new THREE.Group(); rSh.position.set(0.32, 0.24, 0); rSh.add(rUpperArm);

    torsoGrp.add(lSh); torsoGrp.add(rSh);

    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), matSkin); neck.position.set(0, 0.38, 0);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), matSkin); head.position.set(0, 0.58, 0);
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.185, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.75), matHair); hair.position.set(0, 0.62, -0.03);
    var headGrp = new THREE.Group(); headGrp.position.set(0, 1.32, 0);
    headGrp.add(neck); headGrp.add(head); headGrp.add(hair);

    torsoGrp.add(headGrp);
    root.add(lHp); root.add(rHp); root.add(torsoGrp);

    root.userData.bones = { root: root, torso: torsoGrp, head: headGrp, lSh: lSh, lEl: lEl, rSh: rSh, rEl: rEl, lHp: lHp, lKn: lKn, rHp: rHp, rKn: rKn };
    applyPose(root, POSE_PRESETS.idle);
    root.traverse(function (c) { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return root;
  }

  var POSE_PRESETS = {
    idle:   { root: [0, 0, 0], torsoY: 0, headY: 0, lShZ: 40, lEl: 10, rShZ: -40, rEl: -10, lHp: 0, lKn: 0, rHp: 0, rKn: 0 },
    walk:   { root: [0, 0, 0], torsoY: 0, headY: 0, lShZ: 20, lEl: 30, rShZ: -20, rEl: -30, lHp: -30, lKn: 20, rHp: 30, rKn: -20 },
    run:    { root: [0, 0, -0.2], torsoY: 8, headY: -2, lShZ: 60, lEl: 60, rShZ: -60, rEl: -60, lHp: -60, lKn: 40, rHp: 60, rKn: -40 },
    poseA:  { root: [0, 0.3, 0], torsoY: 10, headY: 15, lShZ: 90, lEl: 90, rShZ: -30, rEl: 30, lHp: 0, lKn: 0, rHp: 0, rKn: 0 },
    poseB:  { root: [0, 0, 0], torsoY: -8, headY: -10, lShZ: -20, lEl: -40, rShZ: 20, rEl: 40, lHp: 20, lKn: -30, rHp: -10, rKn: 0 }
  };

  function applyPose(root, pose) {
    if (!pose || !root || !root.userData.bones) return;
    var b = root.userData.bones;
    if (pose.root) root.position.set(pose.root[0], pose.root[1], pose.root[2]);
    b.torso.rotation.set((pose.torsoX || 0) * Math.PI / 180, (pose.torsoY || 0) * Math.PI / 180, 0);
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

  /* ---------- 加载真实 GLB / GLTF ---------- */
  function setupGLTFLoader() {
    gltfLoader = new window.HMGLTFLoader();
    gltfLoader.crossOrigin = 'anonymous';
    try {
      dracoLoader = new window.HMDRACOLoader();
      // draco_decoder.js / wasm 可能不存在，但 loader 会 fallback 并警告；普通模型不用 Draco 也能加载
      gltfLoader.setDRACOLoader(dracoLoader);
    } catch (e) { /* Draco 可选 */ }
  }

  // 自动归一化：居中 + 缩放到合适高度（目标 2.2 单位），并将底面贴 y=0
  function normalizeModel(root, targetHeight) {
    targetHeight = targetHeight || 2.2;
    var box = new THREE.Box3().setFromObject(root);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var scale = targetHeight / maxDim;
    root.scale.multiplyScalar(scale);
    box.setFromObject(root);
    size = box.getSize(new THREE.Vector3());
    center = box.getCenter(new THREE.Vector3());
    // 居中 XZ，让底面贴 y=0
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
  }

  function finalizeLoaded(root, name) {
    root.traverse(function (c) {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
      if (c.isMesh && c.material) {
        if (Array.isArray(c.material)) c.material.forEach(matTweak);
        else matTweak(c.material);
      }
    });
    normalizeModel(root);
    root.userData.loaded = true;
    var n = objects.length;
    root.position.x += ((n % 5) - 2) * 2.8;
    root.position.z += Math.floor(n / 5) * 2.4;
    var o = { id: 'o' + (seq++), name: name || '真实模型 ' + seq, kind: 'glb', three: root };
    objects.push(o);
    scene.add(root);
    selectObject(o.id);
    renderObjectList(); renderInspector();
    return o;
  }

  function matTweak(m) {
    // 修复部分 glTF 模型的黑色材质问题
    if (m && typeof m === 'object') {
      if ('outputColorSpace' in m) { try { m.outputColorSpace = THREE.SRGBColorSpace; } catch(e){} }
      if (m.map) { try { m.map.colorSpace = THREE.SRGBColorSpace; } catch(e){} }
    }
  }

  function loadGLBFromArrayBuffer(arrayBuffer, filename) {
    try {
      gltfLoader.parse(arrayBuffer, '', function (gltf) {
        var root = gltf.scene;
        var name = (filename || '').replace(/\.(glb|gltf)$/i, '') || '真实模型';
        finalizeLoaded(root, name);
        toast('✓ 已导入：' + name, 'success');
      }, function (err) {
        console.error('[GLTF] parse error', err);
        toast('✗ 模型解析失败：' + (err.message || '文件可能不是有效的 .glb / .gltf'), 'error');
      });
    } catch (e) {
      console.error(e);
      toast('✗ 加载异常：' + e.message, 'error');
    }
  }

  function loadGLBFromURL(url, name) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        loadGLBFromArrayBuffer(xhr.response, name);
      } else {
        toast('✗ 下载失败 HTTP ' + xhr.status, 'error');
      }
    };
    xhr.onerror = function () { toast('✗ 网络错误（可能 CORS 或 URL 不可达）', 'error'); };
    xhr.send();
  }

  /* ---------- Tripo AI 3D ---------- */
  function getTripoKey() {
    try { return localStorage.getItem(LS_TRIPO_KEY) || ''; } catch (e) { return ''; }
  }
  function setTripoKey(k) {
    try { localStorage.setItem(LS_TRIPO_KEY, k); } catch (e) {}
  }

  async function tripoTextToModel(prompt) {
    var key = getTripoKey();
    if (!key) throw new Error('请先填写并保存 Tripo API Key');
    var body = JSON.stringify({
      prompt: prompt,
      model_version: 'v1',
      form: 'mesh',
      face_limit: 40000,
      texture: true,
      pbr: true,
      auto_size: true
    });
    var resp = await fetch(TRIPO_API_BASE + '/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: body
    });
    if (!resp.ok) {
      var txt = await resp.text();
      throw new Error('提交任务失败 HTTP ' + resp.status + '：' + txt.slice(0, 300));
    }
    var json = await resp.json();
    if (!json.data || !json.data.task_id) throw new Error('响应缺少 task_id：' + JSON.stringify(json).slice(0, 300));
    return json.data.task_id;
  }

  async function tripoImageToModel(imageDataUrl) {
    var key = getTripoKey();
    if (!key) throw new Error('请先填写并保存 Tripo API Key');
    var resp = await fetch(TRIPO_API_BASE + '/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        image_urls: [imageDataUrl],
        model_version: 'v1',
        form: 'mesh',
        face_limit: 40000,
        texture: true,
        pbr: true,
        auto_size: true
      })
    });
    if (!resp.ok) {
      var txt = await resp.text();
      throw new Error('提交任务失败 HTTP ' + resp.status + '：' + txt.slice(0, 300));
    }
    var json = await resp.json();
    if (!json.data || !json.data.task_id) throw new Error('响应缺少 task_id');
    return json.data.task_id;
  }

  async function pollTripoTask(taskId, onProgress) {
    var key = getTripoKey();
    for (var i = 0; i < 60; i++) { // 最多等 5 分钟
      await new Promise(function (r) { setTimeout(r, 5000); });
      var resp = await fetch(TRIPO_API_BASE + '/task?task_id=' + encodeURIComponent(taskId), {
        headers: { 'Authorization': 'Bearer ' + key }
      });
      if (!resp.ok) throw new Error('查询失败 HTTP ' + resp.status);
      var json = await resp.json();
      var data = json.data || {};
      var st = data.status;
      if (onProgress) onProgress(st, i);
      if (st === 'succeeded') {
        var modelUrl = (data.result && data.result.model && data.result.model.url)
                   || (data.result && data.result.url)
                   || (data.model && data.model.url);
        if (!modelUrl) throw new Error('任务成功但未返回模型下载地址：' + JSON.stringify(data).slice(0, 400));
        return modelUrl;
      }
      if (st === 'failed') throw new Error('AI 生成失败：' + ((data.error || {}).message || data.message || '未知错误'));
      // 其他状态：queued / running / timeout 继续轮询
    }
    throw new Error('等待超时（5 分钟），任务可能仍在运行中');
  }

  /* ---------- 场景搭建 ---------- */
  function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e16);
    scene.fog = new THREE.Fog(0x0a0e16, 30, 80);
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    } catch (err) {
      console.error('[Director3D] WebGL 初始化失败', err);
      showWebGLFallback();
      return false;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    var grid = new THREE.GridHelper(60, 60, 0x333c52, 0x1f2638);
    grid.material.opacity = 0.7; grid.material.transparent = true;
    scene.add(grid); scene.userData.grid = grid;

    scene.add(new THREE.AxesHelper(2));

    var ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    ambient = new THREE.AmbientLight(0xffffff, 0.35); scene.add(ambient);
    dirLight = new THREE.DirectionalLight(0xfff2dc, 1.1);
    dirLight.position.set(6, 10, 5); dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.left = -14; dirLight.shadow.camera.right = 14;
    dirLight.shadow.camera.top = 14; dirLight.shadow.camera.bottom = -14;
    dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 40;
    scene.add(dirLight);
    fillLight = new THREE.DirectionalLight(0x9fb8ff, 0.4);
    fillLight.position.set(-8, 6, -5); scene.add(fillLight);
    spotLight = new THREE.SpotLight(0xffffff, 2.2, 30, Math.PI / 6, 0.5, 1.0);
    spotLight.position.set(4, 8, 4); spotLight.castShadow = true;
    spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 1, 0);
    scene.add(spotLight); scene.add(spotTarget); spotLight.visible = false;

    raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
    orbit = new window.HMOrbitControls(camera, canvas); orbit.enableDamping = true;
    orbit.target.copy(camOrbit.target);
    var initPos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(camOrbit.dist, Math.PI / 2 - camOrbit.pitch, camOrbit.yaw)).add(camOrbit.target);
    camera.position.copy(initPos);

    tControls = new window.HMTransformControls(camera, canvas);
    scene.add(tControls._group);
    setupGLTFLoader();
    return true;
  }

  function showWebGLFallback() {
    try {
      if (!container) return;
      container.style.position = 'relative';
      var tip = document.createElement('div');
      tip.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;color:#8b93a1;font-size:13px;line-height:1.7;z-index:5;background:#0a0e16';
      tip.innerHTML = '<div style="font-size:30px">🖥️</div>' +
        '<div style="color:#e6e9ef;font-weight:600">当前浏览器未启用 WebGL</div>' +
        '<div>3D 导演台需要 WebGL 渲染。<br>请在 Chrome / Edge 设置中开启「使用图形加速」，<br>或访问 <code style="color:#7ca2ff">chrome://gpu</code> 检查是否被禁用。</div>';
      container.appendChild(tip);
    } catch (e) {}
  }

  function resize() {
    if (!container || !renderer) return;
    var rect = container.getBoundingClientRect();
    var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  /* ---------- 对象管理 ---------- */
  function findObject(id) { for (var i = 0; i < objects.length; i++) if (objects[i].id === id) return objects[i]; return null; }

  /* ---------- 内置真实女性白模（CC0 · 3DAssets.dev #25411） ---------- */
  function b64ToArrayBuffer(b64) {
    var bin = atob(b64), len = bin.length, buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  function makeWhiteMaterial() {
    return new THREE.MeshStandardMaterial({ color: 0xEDF0F6, roughness: 0.85, metalness: 0.02 });
  }

  function loadBuiltinFemale(cb, failCb) {
    var b64 = window.HM_FEMALE_GLB_B64;
    if (!b64 || !gltfLoader) { failCb && failCb(); return; }
    gltfLoader.parse(b64ToArrayBuffer(b64), '', function (gltf) {
      var root = gltf.scene;
      root.traverse(function (c) {
        if (c.isMesh) {
          c.castShadow = true; c.receiveShadow = true;
          var mat = makeWhiteMaterial();
          c.material = Array.isArray(c.material) ? c.material.map(function () { return mat; }) : mat;
        }
      });
      normalizeModel(root, 1.78);
      cb(root);
    }, function (err) {
      console.warn('[Mannequin] 内置白模解析失败，回退程序化人偶', err);
      failCb && failCb();
    });
  }

  function addBuiltinMannequin() {
    loadBuiltinFemale(function (root) {
      var n = objects.length;
      root.position.x += ((n % 5) - 2) * 1.6;
      root.position.z += Math.floor(n / 5) * 1.4;
      var o = { id: 'o' + (seq++), name: '成年女性白模', kind: 'mannequin', builtin: true, three: root };
      objects.push(o); scene.add(root); selectObject(o.id);
    }, function () { addPrimitive('mannequin', true); });
  }

  function restoreBuiltinMannequin(s) {
    loadBuiltinFemale(function (root) {
      root.position.set(s.pos[0], s.pos[1], s.pos[2]);
      root.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      root.scale.set(s.scale[0], s.scale[1], s.scale[2]);
      root.userData.id = s.id;
      scene.add(root);
      objects.push({ id: s.id, name: s.name, kind: 'mannequin', builtin: true, three: root });
      renderObjectList();
    }, function () {});
  }

  function addPrimitive(kind, forceProcedural) {
    if (kind === 'mannequin' && !forceProcedural && window.HM_FEMALE_GLB_B64) { addBuiltinMannequin(); return; }
    var nameMap = { cube:'立方体', sphere:'球体', cylinder:'圆柱', cone:'圆锥', capsule:'胶囊', torus:'圆环', plane:'平面', mannequin:'人偶' };
    var three = kind === 'mannequin' ? makeMannequin(nameMap.mannequin) : makePrimitive(kind);
    var n = objects.length;
    three.position.set(((n % 5) - 2) * 2.4, kind === 'plane' ? 0 : 0, Math.floor(n / 5) * 2.2);
    three.userData.id = 'o' + seq;
    var o = { id: 'o' + (seq++), name: (nameMap[kind] || '白模') + ' ' + (seq - 1), kind: kind, three: three };
    objects.push(o); scene.add(three); selectObject(o.id); renderObjectList();
  }

  function deleteObject(id) {
    var o = findObject(id); if (!o) return;
    scene.remove(o.three);
    o.three.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (Array.isArray(c.material)) c.material.forEach(function (m){ m.dispose(); }); else c.material.dispose(); }
    });
    objects = objects.filter(function (x) { return x.id !== id; });
    if (selectedId === id) selectObject(null);
    renderObjectList(); renderInspector();
  }

  function duplicateObject(id) {
    var src = findObject(id); if (!src) return;
    var clone = src.three.clone(true);
    clone.traverse(function (c) {
      if (c.isMesh && c.material) {
        if (Array.isArray(c.material)) c.material = c.material.map(function (m){ return m.clone(); });
        else c.material = c.material.clone();
      }
    });
    clone.position.x += 1.6; clone.position.z += 1.6;
    var newId = 'o' + (seq++); clone.userData.id = newId;
    var o = { id: newId, name: src.name + ' 副本', kind: src.kind, three: clone };
    objects.push(o); scene.add(clone); selectObject(newId); renderObjectList();
  }

  function selectObject(id) {
    selectedId = id;
    var o = id ? findObject(id) : null;
    if (o) tControls.setObject(o.three); else tControls.setObject(null);
    syncGizmoBar();
    renderObjectList(); renderInspector();
  }

  /* ---------- 变换模式（3D 空间内直接操作） ---------- */
  function setGizmoMode(mode, opts) {
    if (!tControls) return;
    if (mode !== 'translate' && mode !== 'rotate' && mode !== 'scale') return;
    if (tControls.mode !== mode) tControls.setMode(mode);
    syncGizmoBar();
    renderInspector();
    if (opts && opts.announce) {
      var label = mode === 'translate' ? '移动（M）' : mode === 'rotate' ? '旋转（R）' : '缩放（S）';
      toast('模式：' + label);
    }
  }

  /* 选中物体时，在视口右上角显示 M/R/S 切换浮条 */
  function syncGizmoBar() {
    if (!gizmoBarEl) return;
    var show = !!selectedId && !!tControls && !!(tControls.getObject && tControls.getObject());
    gizmoBarEl.hidden = !show;
    if (!show) return;
    var buttons = gizmoBarEl.querySelectorAll('[data-gizmo]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-on', buttons[i].getAttribute('data-gizmo') === tControls.mode);
    }
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
      var o = findObject(obj.userData.id);
      if (o) return o;
    }
    return null;
  }

  /* 屏幕坐标 → 与地面平行、过 y 高度的平面交点（用于拖动白模） */
  function screenToGroundPlane(e, y) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var ray = raycaster.ray;
    var denom = ray.direction.y;
    if (Math.abs(denom) < 1e-6) return null;
    var t = (y - ray.origin.y) / denom;
    if (t < 0) return null;
    return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
  }

  /* 直接拖动白模：随当前模式移动 / 旋转 / 缩放（M/R/S），Shift 可上下移动 */
  function beginDragMove(e, o) {
    dragMove = {
      id: o.id,
      startPos: o.three.position.clone(),
      startRotY: o.three.rotation.y,
      startRotX: o.three.rotation.x,
      startScale: o.three.scale.clone(),
      start: screenToGroundPlane(e, o.three.position.y),
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    };
    if (container) container.classList.add('d3-dragging');
  }

  function applyDragMove(e) {
    if (!dragMove) return;
    if (!dragMove.moved) {
      var dx = e.clientX - dragMove.startX, dy = e.clientY - dragMove.startY;
      if (dx * dx + dy * dy < 9) return;   // 小于 3px 视为点击
      dragMove.moved = true;
    }
    var o = findObject(dragMove.id);
    if (!o) return;
    var mode = tControls ? tControls.mode : 'translate';
    if (mode === 'rotate') {
      // 左右拖动 → 绕 Y 轴旋转；按住 Shift 改为绕 X 轴
      if (e.shiftKey) o.three.rotation.x = dragMove.startRotX + (e.clientY - dragMove.startY) * 0.01;
      else o.three.rotation.y = dragMove.startRotY + (e.clientX - dragMove.startX) * 0.01;
    } else if (mode === 'scale') {
      // 左右拖动 → 等比缩放（向上拖动也可放大）
      var f = Math.max(0.08, 1 + (e.clientX - dragMove.startX + (dragMove.startY - e.clientY)) * 0.004);
      o.three.scale.set(
        Math.max(0.05, dragMove.startScale.x * f),
        Math.max(0.05, dragMove.startScale.y * f),
        Math.max(0.05, dragMove.startScale.z * f)
      );
    } else if (e.shiftKey) {
      o.three.position.y = Math.max(0, dragMove.startPos.y - (e.clientY - dragMove.startY) * 0.01);
    } else {
      if (!dragMove.start) return;
      var cur = screenToGroundPlane(e, o.three.position.y);
      if (!cur) return;
      o.three.position.x = dragMove.startPos.x + (cur.x - dragMove.start.x);
      o.three.position.z = dragMove.startPos.z + (cur.z - dragMove.start.z);
    }
    tControls.update();
    updateTransformFields();
  }

  /* ---------- 事件 ---------- */
  function onDown(e) {
    if (!active) return;
    if (tControls.onMouseDown(e)) { orbit.enabled = false; return; }
    if (e.button === 0) {
      var hit = pickFromEvent(e);
      if (hit) {
        selectObject(hit.id);
        orbit.enabled = false;
        // 点击白模后可直接在 3D 空间里拖动它（不必再去右侧面板改数值）
        beginDragMove(e, hit);
        return;
      }
    }
    selectObject(null);
  }
  function onMove(e) {
    if (tControls._dragging) { tControls.onMouseMove(e); updateTransformFields(); return; }
    applyDragMove(e);
  }
  function onUp() {
    if (tControls._dragging) tControls.onMouseUp();
    if (dragMove) {
      if (dragMove.moved) { updateTransformFields(); try { saveScene(); } catch (err) {} }
      dragMove = null;
      if (container) container.classList.remove('d3-dragging');
    }
    orbit.enabled = true;
  }
  function onKeyDown(e) {
    if (!active) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var key = e.key.toLowerCase();
    if (e.key === 'Escape') { if (selectedId) { selectObject(null); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedId) { e.preventDefault(); deleteObject(selectedId); } return; }
    // 快捷键按英文首字母：M=Move(移动) / R=Rotate(旋转) / S=Scale(缩放)
    // 摄像头飞行模式用 WASD 控制机位，此时让 W/A/S/D 保持控制相机。
    if (!camMode && selectedId && (key === 'm' || key === 'r' || key === 's')) {
      e.preventDefault();
      setGizmoMode(key === 'm' ? 'translate' : key === 'r' ? 'rotate' : 'scale', { announce: true });
      return;
    }
    keys[key] = true;
    if (key === 'g') { showGrid = !showGrid; scene.userData.grid.visible = showGrid; syncTopBar(); }
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  /* 只更新右侧数值框，避免拖动时整块重建 DOM */
  function updateTransformFields() {
    if (!inspectorEl || !selectedId) return;
    var o = findObject(selectedId);
    if (!o) return;
    var p = o.three.position, r = o.three.rotation, s = o.three.scale;
    var inputs = inspectorEl.querySelectorAll('input[data-prop]');
    for (var i = 0; i < inputs.length; i++) {
      var t = inputs[i];
      if (t === document.activeElement) continue;
      var prop = t.getAttribute('data-prop');
      var ax = parseInt(t.getAttribute('data-axis'), 10);
      var v = prop === 'pos' ? (ax === 0 ? p.x : ax === 1 ? p.y : p.z)
            : prop === 'rot' ? (ax === 0 ? r.x : ax === 1 ? r.y : r.z) * 180 / Math.PI
            : (ax === 0 ? s.x : ax === 1 ? s.y : s.z);
      t.value = v.toFixed(prop === 'rot' ? 1 : 2);
    }
  }

  function applyFly() {
    if (!camMode) return;
    var fwd = new THREE.Vector3(-Math.sin(camFly.yaw), 0, -Math.cos(camFly.yaw));
    var right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    var d = new THREE.Vector3();
    if (keys['w']) d.add(fwd); if (keys['s']) d.sub(fwd);
    if (keys['a']) d.sub(right); if (keys['d']) d.add(right);
    if (keys['q']) d.y -= 1; if (keys['e']) d.y += 1;
    if (d.lengthSq() > 0) camFly.pos.add(d.normalize().multiplyScalar(0.16));
    camera.position.copy(camFly.pos);
  }

  /* ---------- Inspector ---------- */
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function renderObjectList() {
    if (!objListEl) return;
    if (!objects.length) { objListEl.innerHTML = '<div class="hm-d3-list-empty">还没有物体</div>'; return; }
    objListEl.innerHTML = objects.map(function (o) {
      var glyph = o.kind === 'glb' ? '📦'
                  : o.kind === 'mannequin' ? '🧍'
                  : o.kind === 'sphere' ? '●'
                  : o.kind === 'cube' ? '■'
                  : o.kind === 'torus' ? '◯' : '▮';
      var swatchColor = { glb: '#dfe4ef', mannequin: '#e8cfb4', sphere: '#9fb0d0', cube: '#b9c4d9', torus: '#dfe4ef', cylinder:'#a6b4cc', cone:'#c3ceff', capsule:'#c6d1eb', plane:'#8f9ab0' }[o.kind] || '#e9edf4';
      return '<div class="hm-d3-obj' + (o.id === selectedId ? ' is-active' : '') + '" data-oid="' + o.id + '">' +
        '<span class="hm-d3-swatch" style="background:' + swatchColor + '">' + glyph + '</span>' +
        '<span class="hm-d3-obj-name" title="' + esc(o.name) + '">' + esc(o.name) + '</span>' +
        '<button class="hm-d3-obj-del" data-del="' + o.id + '" title="删除">✕</button></div>';
    }).join('');
  }

  function renderInspector() {
    if (!inspectorEl) return;
    var o = selectedId ? findObject(selectedId) : null;
    var html = '<div class="hm-d3-sec-title">选中物体</div>';
    if (!o) { html += '<div class="hm-d3-empty">点击画布中的物体<br>或左侧列表选中</div>'; }
    else {
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
      if (o.kind === 'mannequin' && !o.builtin) {
        html += '<div class="hm-d3-sec-title" style="margin-top:6px">Pose</div>';
        html += '<div class="hm-d3-shapes" style="grid-template-columns:1fr 1fr">' +
          '<button type="button" data-pose="idle">🌙 Idle</button>' +
          '<button type="button" data-pose="walk">🚶 Walk</button>' +
          '<button type="button" data-pose="run">🏃 Run</button>' +
          '<button type="button" data-pose="poseA">💪 Pose A</button>' +
          '<button type="button" data-pose="poseB">🎭 Pose B</button></div>';
      }
      if (o.kind === 'glb') {
        html += '<div class="hm-d3-empty">📦 真实模型，可在 Blender 等工具中进一步编辑</div>';
      }
      var mode = tControls ? tControls.mode : 'translate';
      html += '<div class="hm-d3-actions">' +
        '<button type="button" data-act="mode-t" class="' + (mode === 'translate' ? 'is-on' : '') + '">▣ 移动 <kbd>M</kbd></button>' +
        '<button type="button" data-act="mode-r" class="' + (mode === 'rotate' ? 'is-on' : '') + '">↻ 旋转 <kbd>R</kbd></button>' +
        '<button type="button" data-act="mode-s" class="' + (mode === 'scale' ? 'is-on' : '') + '">↕ 缩放 <kbd>S</kbd></button>' +
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
      else if (prop === 'scl') setXYZ(obj.three.scale, ax, Math.max(0.05, v));
    });
    inspectorEl.addEventListener('click', function (e) {
      var spotCb = e.target.closest('#d3SpotOn');
      if (spotCb) { spotOn = spotCb.checked; spotLight.visible = spotOn; renderInspector(); return; }
      var btn = e.target.closest('[data-act]');
      if (btn) {
        var act = btn.getAttribute('data-act');
        if (act === 'mode-t') setGizmoMode('translate');
        else if (act === 'mode-r') setGizmoMode('rotate');
        else if (act === 'mode-s') setGizmoMode('scale');
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
  function setXYZ(vec, axis, v) { if (axis === 0) vec.x = v; else if (axis === 1) vec.y = v; else vec.z = v; }

  /* ---------- 顶栏 / 侧栏 ---------- */
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
    // 上传 GLB
    var fileInput = document.getElementById('d3FileInput');
    var uploadBtn = document.getElementById('d3UploadBtn');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function () { loadGLBFromArrayBuffer(reader.result, f.name); };
        reader.onerror = function () { toast('✗ 文件读取失败', 'error'); };
        reader.readAsArrayBuffer(f);
        fileInput.value = ''; // 允许再选同一个文件
      });
    }

    // AI modal
    var aiBtn = document.getElementById('d3AiGenBtn');
    var aiOpenBtn = document.getElementById('d3AiOpenBtn');
    var aiModal = document.getElementById('d3AiModal');
    var aiClose = document.getElementById('d3AiClose');
    if (aiOpenBtn) aiOpenBtn.addEventListener('click', openAiModal);

    if (aiClose) aiClose.addEventListener('click', closeAiModal);
    if (aiModal) aiModal.addEventListener('click', function (e) { if (e.target === aiModal) closeAiModal(); });
    document.querySelectorAll('.hm-d3-model-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.hm-d3-model-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var tabKey = tab.getAttribute('data-ai-tab');
        var providerHint = document.querySelector('.hm-d3-gen-provider');
        if (providerHint) {
          if (tabKey === 'tripo') providerHint.textContent = '通过 Tripo 官方 API · 生成耗时 30-90 秒 · 结果为 .glb 导入当前场景';
          else providerHint.textContent = 'Trellis（微软开源）请输入自建服务 API 地址（可选）';
        }
      });
    });
    var keyInput = document.getElementById('d3TripoKey');
    if (keyInput) keyInput.value = getTripoKey();
    var keySaveBtn = document.getElementById('d3TripoKeySave');
    var keyStatus = document.getElementById('d3TripoKeyStatus');
    if (keySaveBtn) keySaveBtn.addEventListener('click', function () {
      setTripoKey(keyInput.value.trim());
      if (keyStatus) { keyStatus.hidden = false; setTimeout(function () { keyStatus.hidden = true; }, 2000); }
    });
    var modelType = document.getElementById('d3AiModelType');
    var imgField = document.getElementById('d3AiImageField');
    if (modelType && imgField) {
      modelType.addEventListener('change', function () { imgField.hidden = modelType.value !== 'image_to_model'; });
    }
    if (aiBtn) aiBtn.addEventListener('click', onGenerateAi3D);

    // 顶栏按钮
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
  }

  function openAiModal() {
    var m = document.getElementById('d3AiModal'); if (m) m.hidden = false;
  }
  function closeAiModal() {
    var m = document.getElementById('d3AiModal'); if (m) m.hidden = true;
  }

  function setAiStatus(html, cls) {
    var el = document.getElementById('d3AiResult');
    if (!el) return;
    el.innerHTML = '<div class="hm-d3-gen-status' + (cls ? ' ' + cls : '') + '">' + html + '</div>';
  }

  async function onGenerateAi3D() {
    var btn = document.getElementById('d3AiGenBtn');
    var modelType = document.getElementById('d3AiModelType').value;
    var prompt = document.getElementById('d3AiPrompt').value.trim();
    if (!prompt && modelType === 'text_to_model') { toast('请填写 Prompt', 'error'); return; }
    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';
    try {
      var taskId;
      if (modelType === 'text_to_model') {
        setAiStatus('🚀 提交任务：' + esc(prompt.slice(0, 60)) + '...');
        taskId = await tripoTextToModel(prompt);
      } else {
        var imgInput = document.getElementById('d3AiImageInput');
        var file = imgInput && imgInput.files && imgInput.files[0];
        if (!file) throw new Error('请先选择参考图');
        var dataUrl = await new Promise(function (res, rej) {
          var r = new FileReader();
          r.onload = function () { res(r.result); };
          r.onerror = rej; r.readAsDataURL(file);
        });
        setAiStatus('🚀 提交图片任务...');
        taskId = await tripoImageToModel(dataUrl);
      }
      setAiStatus('✅ 任务已提交 (task_id=' + taskId + ')，等待 Tripo 处理（通常 30-90 秒）...');
      var url = await pollTripoTask(taskId, function (st, round) {
        setAiStatus('🔄 任务状态: ' + st + ' · 第 ' + (round + 1) + ' 次查询');
      });
      setAiStatus('📥 下载模型中...');
      loadGLBFromURL(url, 'ai-' + (prompt || 'image').slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_'));
      closeAiModal();
    } catch (e) {
      console.error(e);
      setAiStatus('✗ ' + (e.message || '未知错误') + '<div style="margin-top:6px;font-size:11px;color:#7b8494">如遇 CORS 拒绝，需在自建后端做代理；也可直接到 <a href="https://platform.tripo3d.ai" target="_blank" style="color:#7ca2ff">Tripo 控制台</a> 下载 .glb 后用上方「上传 GLB」导入。</div>', 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🚀 开始生成';
    }
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
      var sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
      camFly.pos.copy(camera.position);
      camFly.yaw = sph.theta;
      camFly.pitch = sph.phi - Math.PI / 2;
      orbit.enabled = false;
    } else {
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
    if (camMode) { camFly = { pos: new THREE.Vector3(0, 3.5, 13), yaw: -0.65, pitch: -0.06 }; return; }
    camOrbit = { yaw: -0.65, pitch: 0.4, dist: 17, target: new THREE.Vector3(0, 1.2, 0) };
    var pos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(camOrbit.dist, Math.PI / 2 - camOrbit.pitch, camOrbit.yaw)).add(camOrbit.target);
    camera.position.copy(pos); orbit.target.copy(camOrbit.target);
    orbit._spherical.setFromVector3(camera.position.clone().sub(orbit.target));
    orbit._sphericalDelta.set(0, 0, 0); orbit._panOffset.set(0, 0, 0);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- 主循环 ---------- */
  function loop() {
    if (!active || !renderer) { rafId = null; return; }
    if (camMode) {
      applyFly();
      var qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), camFly.yaw);
      var qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camFly.pitch);
      camera.quaternion.copy(qy).multiply(qx);
    } else { orbit.update(); }
    tControls.update(); renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 截图 / 存档 ---------- */
  function captureShot() {
    if (!renderer) return;
    renderer.render(scene, camera);
    var url; try { url = renderer.domElement.toDataURL('image/png'); } catch (e) { return; }
    var a = document.createElement('a');
    var ts = new Date();
    var stamp = String(ts.getFullYear()) + String(ts.getMonth() + 1).padStart(2, '0') + String(ts.getDate()).padStart(2, '0') + '-' + String(ts.getHours()).padStart(2, '0') + String(ts.getMinutes()).padStart(2, '0') + String(ts.getSeconds()).padStart(2, '0');
    a.href = url; a.download = '导演台取景-' + stamp + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('已保存取景截图', 'success');
  }
  function toast(msg, kind) {
    if (window.HMApp && window.HMApp.toast) return window.HMApp.toast(msg, kind);
    try {
      var d = document.createElement('div');
      d.textContent = msg; d.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);padding:8px 16px;border-radius:8px;background:#11151f;color:#e6e9ef;font-size:13px;z-index:10000;border:1px solid #2a3142;box-shadow:0 8px 24px rgba(0,0,0,.4)';
      document.body.appendChild(d);
      setTimeout(function () { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; setTimeout(function () { d.remove(); }, 300); }, 2400);
    } catch (e) {}
  }

  function saveScene() {
    try {
      var data = {
        version: 2,
        objects: objects.map(function (o) {
          return { id: o.id, name: o.name, kind: o.kind, builtin: !!o.builtin,
            pos: [o.three.position.x, o.three.position.y, o.three.position.z],
            rot: [o.three.rotation.x, o.three.rotation.y, o.three.rotation.z],
            scale: [o.three.scale.x, o.three.scale.y, o.three.scale.z] };
        }),
        camera: { pos: [camera.position.x, camera.position.y, camera.position.z], quat: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w] },
        seq: seq
      };
      localStorage.setItem(LS_SCENE, JSON.stringify(data));
      toast('场景已保存', 'success');
    } catch (e) { toast('保存失败', 'error'); }
  }

  function loadScene() {
    try {
      var raw = localStorage.getItem(LS_SCENE); if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.objects)) {
        objects.forEach(function (o) { scene.remove(o.three); }); objects = []; selectedId = null;
        var maxSeq = 0;
        data.objects.forEach(function (s) {
          if (s.kind === 'glb') return; // glb 存档无法恢复二进制，跳过
          if (s.kind === 'mannequin' && s.builtin) { restoreBuiltinMannequin(s); return; }
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
    } catch (e) {}
  }

  /* ---------- 生命周期 ---------- */
  function init() {
    if (bound) return;
    canvas = document.getElementById('d3Canvas');
    container = document.getElementById('d3Viewport');
    inspectorEl = document.getElementById('d3Inspector');
    objListEl = document.getElementById('d3ObjList');
    gizmoBarEl = document.getElementById('d3GizmoBar');
    if (!canvas || !container) return;
    bound = true;
    if (!setupScene()) { bound = true; return; }
    loadScene();
    if (!objects.length) { addPrimitive('cube'); addPrimitive('sphere'); addPrimitive('mannequin'); selectObject(null); }
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    if (gizmoBarEl) {
      gizmoBarEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-gizmo]');
        if (!btn) return;
        setGizmoMode(btn.getAttribute('data-gizmo'), { announce: true });
      });
    }
    bindTopBar(); bindInspector(); syncTopBar(); syncGizmoBar(); renderObjectList(); renderInspector();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      try { new window.ResizeObserver(function () { resize(); }).observe(container); } catch (e) {}
    }
  }

  function enter() {
    active = true; if (!bound) init();
    if (!renderer) { syncTopBar(); return; }
    resize(); syncTopBar();
    requestAnimationFrame(resize);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function leave() {
    active = false; keys = {};
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try { saveScene(); } catch (e) {}
  }

  return { init: init, enter: enter, leave: leave };
})();
