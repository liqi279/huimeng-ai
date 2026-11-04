'use strict';
/* HMOrbitControls —— 轨道相机 + 平移 + 缩放，依赖全局 THREE */
(function (global) {
  var THREE = global.THREE;
  function OrbitControls(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3(0, 1.2, 0);
    this.minDistance = 2;
    this.maxDistance = 120;
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.enablePan = true;
    this.enableRotate = true;
    this.enableZoom = true;
    this.rotateSpeed = 1;
    this.panSpeed = 1;
    this.zoomSpeed = 0.9;

    this._spherical = new THREE.Spherical();
    this._sphericalDelta = new THREE.Spherical();
    this._panOffset = new THREE.Vector3();
    this._scale = 1;

    this._state = 'none';
    this._rotateStart = { x: 0, y: 0 };
    this._panStart = { x: 0, y: 0 };

    this._updateSpherical();
    this._bind();
  }

  OrbitControls.prototype._updateSpherical = function () {
    var offset = this.camera.position.clone().sub(this.target);
    this._spherical.setFromVector3(offset);
  };

  OrbitControls.prototype._bind = function () {
    var self = this;
    var el = this.domElement;
    this._onDown = function (e) {
      if (!self.enabled) return;
      if (e.button === 0) self._state = 'rotate';
      else if (e.button === 2) self._state = 'pan';
      else return;
      if (self._state === 'rotate') self._rotateStart.set(e.clientX, e.clientY);
      if (self._state === 'pan') self._panStart.set(e.clientX, e.clientY);
      e.preventDefault();
    };
    this._onMove = function (e) {
      if (self._state === 'rotate' && self.enableRotate) {
        var dx = e.clientX - self._rotateStart.x;
        var dy = e.clientY - self._rotateStart.y;
        self._sphericalDelta.theta -= dx * 0.005 * self.rotateSpeed;
        self._sphericalDelta.phi -= dy * 0.005 * self.rotateSpeed;
        self._rotateStart.set(e.clientX, e.clientY);
      } else if (self._state === 'pan' && self.enablePan) {
        var dx2 = e.clientX - self._panStart.x;
        var dy2 = e.clientY - self._panStart.y;
        self._panLeftRight(-2 * dx2 / self.domElement.clientWidth);
        self._panUpDown(2 * dy2 / self.domElement.clientHeight);
        self._panStart.set(e.clientX, e.clientY);
      }
    };
    this._onUp = function () { self._state = 'none'; };
    this._onWheel = function (e) {
      if (!self.enableZoom) return;
      e.preventDefault();
      self._scale *= e.deltaY < 0 ? self.zoomSpeed : 1 / self.zoomSpeed;
    };
    this._onContext = function (e) { e.preventDefault(); };

    el.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContext);
  };

  OrbitControls.prototype.dispose = function () {
    var el = this.domElement;
    el.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onContext);
  };

  OrbitControls.prototype._panLeftRight = function (delta) {
    var offset = this.camera.position.clone().sub(this.target);
    var targetDistance = offset.length() * Math.tan((this.camera.fov / 2) * Math.PI / 180);
    var panX = 2 * delta * targetDistance;
    var v = new THREE.Vector3();
    v.setFromMatrixColumn(this.camera.matrix, 0);
    v.multiplyScalar(-panX);
    this._panOffset.add(v);
  };

  OrbitControls.prototype._panUpDown = function (delta) {
    var offset = this.camera.position.clone().sub(this.target);
    var targetDistance = offset.length() * Math.tan((this.camera.fov / 2) * Math.PI / 180);
    var panY = 2 * delta * targetDistance;
    var v = new THREE.Vector3();
    v.setFromMatrixColumn(this.camera.matrix, 1);
    v.multiplyScalar(panY);
    this._panOffset.add(v);
  };

  OrbitControls.prototype.update = function () {
    var offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
    var spherical = this._spherical.clone().setFromVector3(offset);
    spherical.theta += this._sphericalDelta.theta;
    spherical.phi += this._sphericalDelta.phi;
    spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
    spherical.radius *= this._scale;
    spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, spherical.radius));

    this.target.add(this._panOffset);
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);

    if (this.enableDamping) {
      this._sphericalDelta.theta *= (1 - this.dampingFactor);
      this._sphericalDelta.phi *= (1 - this.dampingFactor);
      this._panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this._sphericalDelta.set(0, 0, 0);
      this._panOffset.set(0, 0, 0);
    }
    this._scale = 1;
  };

  global.HMOrbitControls = OrbitControls;
})(typeof window !== 'undefined' ? window : self);
