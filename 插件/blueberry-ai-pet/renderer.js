(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const lines = ["主人！蓝莓酱在这里哦～", "欸？是在叫我吗？", "今天也要一起加油呀！", "偷偷休息一下也没关系的哦。"];
  let idle = 0;
  let isTop = true;
  function say(text, mood = "期待") {
    const speech = $("speech"), moodEl = $("mood");
    if (speech) speech.textContent = text;
    if (moodEl) moodEl.textContent = `今天心情：${mood}`;
  }
  function showError(message) { say(`交互模块遇到问题：${message}`, "需要检查"); }
  function bind(id, event, handler) {
    const el = $(id);
    if (!el) { console.error(`找不到页面元素 #${id}`); return; }
    el.addEventListener(event, handler);
  }
  function init() {
    // 先绑定所有按钮，再异步检查 IPC，避免通信检测阻塞按钮初始化。
    bind("chatBtn", "click", async () => {
      say("正在打开聊天窗口……", "期待");
      try {
        if (!window.petAPI?.openChat) throw new Error("桌宠通信模块未加载");
        const ok = await window.petAPI.openChat();
        if (!ok) throw new Error("主进程未能创建聊天窗口");
      } catch (err) { showError(err.message || String(err)); }
    });
    bind("patBtn", "click", () => {
      say("欸嘿嘿……再摸一下也、也不是不可以！", "害羞");
      const p = $("portrait");
      if (p?.animate) p.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 420 });
    });
    bind("danceBtn", "click", () => {
      say("锵锵！蓝莓酱的特别表演开始啦！", "开心");
      const p = $("portrait");
      if (p?.animate) p.animate([{ transform: "rotate(0)" }, { transform: "rotate(-3deg)" }, { transform: "rotate(3deg)" }, { transform: "rotate(0)" }], { duration: 650 });
    });
    bind("hideBtn", "click", () => window.petAPI?.hide().catch(err => showError(err.message)));
    bind("quitBtn", "click", () => window.petAPI?.quit().catch(err => showError(err.message)));
    bind("topBtn", "click", async () => {
      isTop = !isTop;
      const button = $("topBtn");
      if (button) button.textContent = isTop ? "置顶" : "取消置顶";
      try { await window.petAPI?.setTop(isTop); } catch (err) { showError(err.message); }
    });
    bind("portrait", "click", () => say("呜哇！突然被戳到了！", "惊讶"));
    window.addEventListener("error", e => showError(e.message || "页面脚本错误"));
    window.addEventListener("unhandledrejection", e => showError(e.reason?.message || String(e.reason)));
    if (window.petAPI?.ping) window.petAPI.ping().then(result => {
      if (result !== "pong") showError("主进程通信测试未通过");
    }).catch(err => showError(`通信测试失败：${err.message}`));
    setInterval(() => {
      idle++;
      if (idle % 8 === 0) say(lines[Math.floor(Math.random() * lines.length)], "悠闲");
    }, 30000);
    document.addEventListener("mousemove", () => { idle = 0; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
