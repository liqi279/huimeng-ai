'use strict';

/* =============================================================
 * CSP作画模块插件 · HMCSPBridge（独立版）
 * 绘梦 AI 动漫创作平台 ↔ 本地 CLIP STUDIO PAINT 联动接口。
 *
 * 合规说明：
 *   本插件只唤起用户电脑上【已正版安装】的 CLIP STUDIO PAINT，
 *   不包含、也不要求任何破解补丁 / 激活绕过内容。
 *   桌面软件无法在浏览器内运行，作画过程在本机 CSP 窗口进行。
 *
 * 用法：
 *   <script src="huimeng-csp-bridge.js"></script>
 *   HMCSPBridge.launch();              // 唤起本地 CSP
 *   HMCSPBridge.status();              // unknown|launching|launched|notfound
 *   HMCSPBridge.importFiles(files);    // 导入完成稿（需平台 HMUI.importAssets）
 *   HMCSPBridge.openAssets();          // 跳转平台资产模块
 *   HMCSPBridge.onStatusChange(fn);    // 订阅状态变化
 * ============================================================= */
(function (global) {
  var state = 'unknown';
  var listeners = [];

  function setState(next) {
    state = next;
    listeners.forEach(function (fn) {
      try { fn(next); } catch (err) { /* ignore */ }
    });
  }

  function launch() {
    if (state === 'launching') return;
    setState('launching');
    var decided = false;

    function onBlur() {
      if (decided) return;
      decided = true;
      setState('launched');
    }
    global.addEventListener('blur', onBlur, { once: true });

    var probe = document.createElement('iframe');
    probe.style.display = 'none';
    probe.setAttribute('aria-hidden', 'true');
    probe.src = 'clipstudio://open';
    document.body.appendChild(probe);

    global.setTimeout(function () {
      try { probe.remove(); } catch (err) { /* ignore */ }
      global.removeEventListener('blur', onBlur);
      if (decided) return;
      decided = true;
      setState('notfound');
    }, 1800);
  }

  var bridge = {
    launch: launch,
    status: function () { return state; },
    onStatusChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    importFiles: function (files) {
      if (global.HMUI && typeof global.HMUI.importAssets === 'function') {
        return global.HMUI.importAssets(files);
      }
      throw new Error('平台资产接口不可用（需要绘梦平台环境）');
    },
    openAssets: function () {
      if (global.HMApp && global.HMApp.switchView) global.HMApp.switchView('assets');
    }
  };

  global.HMCSPBridge = global.HMCSPBridge || bridge;
})(typeof window !== 'undefined' ? window : this);
