'use strict';
/* HMTransformControls —— 选中物体后显示 XYZ gizmo，支持 translate/rotate/scale
 * 依赖全局 THREE。用法：new HMTransformControls(camera, domElement) */
(function (global) {
  var THREE = global.THREE;
  function TransformControls(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = 'translate';
    this.axis = null;
    this.enabled = true;
    this.size = 1;

    this._object = null;
    this._dragging = false;
    this._startPoint = new THREE.Vector3();
    this._startObjPos = new THREE.Vector3();
    this._startObjQuat = new THREE.Quaternion();
    this._startObjScale = new THREE.Vector3();
    this._rotStart = 0;
    this._screenStart = new THREE.Vector2();

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Line = { threshold: 0.01 };
    this._pointer = new THREE.Vector2();

    var g = new THREE.Group();
    this._group = g;
    this._makeAxes();
  }

  TransformControls.prototype._makeAxes = function () {
    var g = this._group;
    while (g.children.length) g.remove(g.children[0]);

    if (this.mode === 'translate') {
      var len = 1, head = 0.2, headR = 0.07;
      var mkAxis = function (axis, color) {
        var grp = new THREE.Group();
        grp.name = 'axis_' + axis;
        var dir = axis === 'x' ? new THREE.Vector3(1, 0, 0)
               : axis === 'y' ? new THREE.Vector3(0, 1, 0)
               : new THREE.Vector3(0, 0, 1);
        var geo = new THREE.CylinderGeometry(0.02, 0.02, len, 10);
        geo.translate(0, len / 2, 0);
        var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color }));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.name = 'line';
        grp.add(mesh);
        var cone = new THREE.Mesh(new THREE.ConeGeometry(headR, head, 16),
          new THREE.MeshBasicMaterial({ color: color }));
        cone.position.copy(dir).multiplyScalar(len);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        cone.name = 'head';
        grp.add(cone);
        return grp;
      };
      g.add(mkAxis('x', 0xff5c7a));
      g.add(mkAxis('y', 0x52c41a));
      g.add(mkAxis('z', 0x4f8cff));
    } else if (this.mode === 'rotate') {
      var ringR = 0.9, ringSeg = 64;
      var mkRing = function (axis, color) {
        var grp = new THREE.Group();
        grp.name = 'axis_' + axis;
        var pts = [];
        for (var i = 0; i <= ringSeg; i++) {
          var a = (i / ringSeg) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * ringR, Math.sin(a) * ringR, 0));
        }
        var geo = new THREE.BufferGeometry().setFromPoints(pts);
        var line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: color, linewidth: 2 }));
        if (axis === 'x') line.rotation.y = Math.PI / 2;
        if (axis === 'y') line.rotation.x = Math.PI / 2;
        grp.add(line);
        return grp;
      };
      g.add(mkRing('x', 0xff5c7a));
      g.add(mkRing('y', 0x52c41a));
      g.add(mkRing('z', 0x4f8cff));
    } else if (this.mode === 'scale') {
      var sLen = 1, sSize = 0.12;
      var mkS = function (axis, color) {
        var grp = new THREE.Group();
        grp.name = 'axis_' + axis;
        var dir = axis === 'x' ? new THREE.Vector3(1, 0, 0)
               : axis === 'y' ? new THREE.Vector3(0, 1, 0)
               : new THREE.Vector3(0, 0, 1);
        var mat = new THREE.LineBasicMaterial({ color: color });
        var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(sLen)
        ]), mat);
        grp.add(line);
        var box = new THREE.Mesh(new THREE.BoxGeometry(sSize, sSize, sSize),
          new THREE.MeshBasicMaterial({ color: color }));
        box.position.copy(dir).multiplyScalar(sLen);
        grp.add(box);
        return grp;
      };
      g.add(mkS('x', 0xff5c7a));
      g.add(mkS('y', 0x52c41a));
      g.add(mkS('z', 0x4f8cff));
    }

    // 把 gizmo 缩放到合理屏幕大小（update 时会再缩）
    g.scale.setScalar(1);
    g.traverse(function (o) {
      o.raycast = function () { /* 禁用子节点 raycast，只靠 group.children 整体 */ };
    });
  };

  TransformControls.prototype.setObject = function (obj) {
    this._object = obj;
    if (obj) {
      this._group.position.copy(obj.position);
      this._group.quaternion.copy(obj.quaternion);
      this._group.visible = true;
    } else {
      this._group.visible = false;
      this.axis = null;
    }
  };

  TransformControls.prototype.setMode = function (mode) {
    this.mode = mode;
    this._makeAxes();
    this.setObject(this._object);
  };

  TransformControls.prototype.getObject = function () { return this._object; };

  TransformControls.prototype.getRaycaster = function () {
    return this._raycaster;
  };

  TransformControls.prototype.update = function () {
    if (!this._object) return;
    this._group.position.copy(this._object.position);
    if (this.mode !== 'rotate') {
      this._group.quaternion.copy(this.camera.quaternion);
    }
    // 根据屏幕距离缩放
    var dist = this.camera.position.distanceTo(this._group.position);
    var fov = this.camera.fov * Math.PI / 180;
    var viewH = 2 * Math.tan(fov / 2) * dist;
    var scale = viewH / 12 * this.size;
    this._group.scale.setScalar(scale);
    // 让选中轴高亮
    var self = this;
    this._group.children.forEach(function (axisGrp) {
      var hl = axisGrp.name === ('axis_' + self.axis);
      axisGrp.children.forEach(function (child) {
        if (child.material) {
          var c = hl ? 0xffffff : child.userData._origColor != null ? child.userData._origColor : child.material.color.getHex();
          child.userData._origColor = hl ? child.material.color.getHex() : c;
          child.material.color.setHex(c);
        }
      });
    });
  };

  TransformControls.prototype._setPointer = function (e) {
    var rect = this.domElement.getBoundingClientRect();
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  // 返回命中的 axis name 或 null
  TransformControls.prototype.pickAxis = function (e) {
    if (!this._object) return null;
    this._setPointer(e);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    var hits = this._raycaster.intersectObjects(this._group.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.parent && !o.name.startsWith('axis_')) o = o.parent;
      if (o && o.name.startsWith('axis_')) return o.name.split('_')[1];
    }
    return null;
  };

  TransformControls.prototype.onMouseDown = function (e) {
    if (!this.enabled || !this._object) return false;
    var axis = this.pickAxis(e);
    if (!axis) return false;
    this.axis = axis;
    this._dragging = true;
    this._startObjPos.copy(this._object.position);
    this._startObjQuat.copy(this._object.quaternion);
    this._startObjScale.copy(this._object.scale);
    this._screenStart.set(e.clientX, e.clientY);
    if (this.mode === 'translate') {
      // 构造平移平面：过 object 中心，平行相机方向的轴 = 选中 axis，另外两个平面轴
      var dirVec = axis === 'x' ? new THREE.Vector3(1, 0, 0)
                : axis === 'y' ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
      this._planeNormal = new THREE.Vector3().subVectors(this.camera.position, this._object.position).normalize();
      var p1 = new THREE.Vector3().crossVectors(this._planeNormal, dirVec).normalize();
      if (p1.lengthSq() < 1e-4) p1.set(1, 0, 0);
      var p2 = new THREE.Vector3().crossVectors(dirVec, p1).normalize();
      this._planeU = p1; this._planeV = p2;
      // 初始屏幕点反投影到物体平面
      var hit = this._intersectPlane(e.clientX, e.clientY);
      if (hit) this._startPoint.copy(hit);
    } else if (this.mode === 'rotate') {
      this._rotStart = this._screenStart.clone();
    }
    this.update();
    return true;
  };

  TransformControls.prototype.onMouseMove = function (e) {
    if (!this._dragging || !this.axis || !this._object) return;
    if (this.mode === 'translate') {
      var hit = this._intersectPlane(e.clientX, e.clientY);
      if (!hit) return;
      var delta = hit.clone().sub(this._startPoint);
      this._object.position.copy(this._startObjPos).add(delta);
    } else if (this.mode === 'rotate') {
      var dx = e.clientX - this._rotStart.x;
      var dy = e.clientY - this._rotStart.y;
      var rotVec = axisVec(this.axis);
      // 屏幕 x/y 做旋转角估计
      var worldUp = axisVec(this.axis).applyQuaternion(this._object.quaternion).length() > 0.5
        ? axisVec(this.axis).applyQuaternion(this._startObjQuat).normalize()
        : new THREE.Vector3();
      var angle = (dx - dy) * 0.008;
      var q = new THREE.Quaternion().setFromAxisAngle(rotVec, angle);
      this._object.quaternion.copy(this._startObjQuat).premultiply(q);
      this._object.quaternion.normalize();
    } else if (this.mode === 'scale') {
      var dx2 = e.clientX - this._screenStart.x;
      var scaleFactor = 1 + dx2 * 0.004;
      this._object.scale.copy(this._startObjScale).multiplyScalar(scaleFactor);
      this._object.scale.x = Math.max(0.05, this._object.scale.x);
      this._object.scale.y = Math.max(0.05, this._object.scale.y);
      this._object.scale.z = Math.max(0.05, this._object.scale.z);
    }
    this.update();
    if (this.onChange) this.onChange(this._object);
  };

  TransformControls.prototype.onMouseUp = function () {
    this._dragging = false;
    this.axis = null;
    this.update();
  };

  function axisVec(a) {
    return a === 'x' ? new THREE.Vector3(1, 0, 0)
         : a === 'y' ? new THREE.Vector3(0, 1, 0)
         : new THREE.Vector3(0, 0, 1);
  }

  // 把屏幕坐标(x,y)反投影到物体本地平面，返回世界坐标交点
  TransformControls.prototype._intersectPlane = function (clientX, clientY) {
    var rect = this.domElement.getBoundingClientRect();
    var sx = ((clientX - rect.left) / rect.width) * 2 - 1;
    var sy = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(new THREE.Vector2(sx, sy), this.camera);

    // 平面：过物体中心，法向量 = 相机方向
    var origin = this._object.position;
    var normal = this._planeNormal || new THREE.Vector3().subVectors(this.camera.position, origin).normalize();
    var ray = this._raycaster.ray;
    var denom = ray.direction.dot(normal);
    if (Math.abs(denom) < 1e-6) return null;
    var t = origin.clone().sub(ray.origin).dot(normal) / denom;
    if (t < 0) return null;
    return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
  };

  TransformControls.prototype.dispose = function () {};

  global.HMTransformControls = TransformControls;
})(typeof window !== 'undefined' ? window : self);
