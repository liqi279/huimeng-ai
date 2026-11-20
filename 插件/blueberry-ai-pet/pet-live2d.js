(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const api = window.petAPI;
  const fallback = $("modelFallback");
  const status = $("runtimeStatus");
  const speech = $("speech");
  let app = null;
  let model = null;
  let lastTap = 0;
  let pointerStart = null;
  let dragging = false;
  let lastPointer = null;

  function say(message) {
    speech.textContent = message;
    speech.hidden = false;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => { speech.hidden = true; }, 2600);
  }
  function bind(id, event, handler) {
    const node = $(id);
    if (node) node.addEventListener(event, handler);
  }

  async function loadModel() {
    const modelUrl = "live2d/model/blueberry.model3.json";
    if (!window.PIXI || !window.PIXI.live2d || !window.Live2DCubismCore) {
      status.textContent = "缺少 Cubism Core / Pixi Live2D 运行库；请按 LIVE2D-接入说明 配置";
      return;
    }
    try {
      app = new PIXI.Application({
        view: $("live2dCanvas"),
        width: Math.max(300, window.innerWidth),
        height: Math.max(420, window.innerHeight),
        transparent: true,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true
      });
      model = await PIXI.live2d.Live2DModel.from(modelUrl, { autoInteract: false });
      model.anchor.set(0.5, 0.5);
      model.x = app.renderer.width / 2;
      model.y = app.renderer.height / 2;
      const scale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.88;
      model.scale.set(scale);
      app.stage.addChild(model);
      fallback.hidden = true;
      status.textContent = "Live2D 模型已加载";
      model.on("hit", hitAreas => {
        if (hitAreas?.length) say("欸嘿！主人摸到蓝莓酱啦～");
      });
      window.addEventListener("resize", resizeModel);
    } catch (error) {
      status.textContent = `模型加载失败：${error.message}`;
      console.error("Live2D model load failed", error);
      if (app) { app.destroy(true, { children: true, texture: true, baseTexture: true }); app = null; }
    }
  }
  function resizeModel() {
    if (!app || !model) return;
    app.renderer.resize(window.innerWidth, window.innerHeight);
    model.x = app.renderer.width / 2;
    model.y = app.renderer.height / 2;
    model.scale.set(Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.88);
  }

  bind("chatBtn", "click", () => api?.openChat?.());
  bind("speechBtn", "click", () => say("主人！今天也请多关照啦～"));
  bind("hideBtn", "click", () => api?.hide?.());
  bind("quitBtn", "click", () => api?.quit?.());
  bind("modelStage", "pointerdown", event => {
    pointerStart = { x: event.clientX, y: event.clientY, at: Date.now(), moved: 0 };
    lastPointer = { x: event.screenX, y: event.screenY };
    dragging = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  });
  bind("modelStage", "pointermove", event => {
    if (!dragging || !lastPointer) return;
    const dx = Math.round(event.screenX - lastPointer.x);
    const dy = Math.round(event.screenY - lastPointer.y);
    if (dx || dy) {
      if (pointerStart) pointerStart.moved += Math.hypot(dx, dy);
      api?.moveBy?.(dx, dy);
      lastPointer = { x: event.screenX, y: event.screenY };
    }
  });
  bind("modelStage", "pointerup", event => {
    if (!pointerStart) return;
    const elapsed = Date.now() - pointerStart.at;
    const moved = pointerStart.moved;
    pointerStart = null;
    lastPointer = null;
    dragging = false;
    if (moved < 5 && elapsed < 350) {
      const now = Date.now();
      if (now - lastTap < 330) api?.openChat?.();
      else if (model) say("主人！被戳到了啦～");
      lastTap = now;
    }
  });
  bind("modelStage", "pointercancel", () => { pointerStart = null; lastPointer = null; dragging = false; });
  window.addEventListener("error", event => { if (status) status.textContent = `运行错误：${event.message}`; });
  loadModel();
})();
