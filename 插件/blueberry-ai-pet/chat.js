(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const history = [];
  function add(text, who) {
    const d = document.createElement("div");
    d.className = `bubble ${who}`;
    d.textContent = text;
    $("messages").appendChild(d);
    $("messages").scrollTop = $("messages").scrollHeight;
    return d;
  }
  $("form").addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("input");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    add(msg, "user");
    const priorHistory = history.slice();
    history.push({ role: "user", content: msg });
    const pending = add("蓝莓酱正在想…", "pet");
    const send = $("form").querySelector("button");
    if (send) send.disabled = true;
    try {
      if (!window.petAPI?.reply) throw new Error("聊天通信模块未加载");
      const result = await window.petAPI.reply(msg, priorHistory);
      pending.textContent = result?.text || "蓝莓酱暂时没有收到回复。";
      history.push({ role: "assistant", content: pending.textContent });
    } catch (err) {
      pending.textContent = `呜……连接出了点小问题：${err.message || err}`;
    } finally { if (send) send.disabled = false; input.focus(); }
  });
  $("settingsBtn").addEventListener("click", async () => {
    try {
      const s = await window.petAPI.getSettings();
      $("provider").value = s.provider || "ollama";
      $("apiKey").value = s.apiKey || "";
      $("model").value = s.model || "qwen3:4b";
      $("baseUrl").value = s.baseUrl || "http://localhost:11434";
      updateProviderFields();
      $("settings").classList.remove("hidden");
    } catch (err) { add(`读取设置失败：${err.message}`, "pet"); }
  });
  $("cancel").addEventListener("click", () => $("settings").classList.add("hidden"));
  function updateProviderFields() {
    const local = $("provider").value === "ollama";
    $("apiKeyLabel").style.opacity = local ? "0.55" : "1";
    $("apiKey").disabled = local;
    if (local) {
      if (!$("baseUrl").value || $("baseUrl").value.includes("openai.com")) $("baseUrl").value = "http://localhost:11434";
      if (!$("model").value || $("model").value === "gpt-6") $("model").value = "qwen3:4b";
    } else {
      if (!$("baseUrl").value || $("baseUrl").value.includes("localhost")) $("baseUrl").value = "https://api.openai.com/v1";
      if (!$("model").value || $("model").value === "qwen3:4b") $("model").value = "gpt-6";
    }
  }
  $("provider").addEventListener("change", updateProviderFields);
  $("save").addEventListener("click", async () => {
    try {
      const provider = $("provider").value;
      await window.petAPI.saveSettings({ provider, apiKey: $("apiKey").value, model: $("model").value, baseUrl: $("baseUrl").value });
      $("settings").classList.add("hidden");
      $("connectionHint").textContent = provider === "ollama"
        ? `本地 Ollama · ${$("model").value}（无需 API Key）`
        : `远程接口 · ${$("model").value}`;
      add("设置保存好啦！蓝莓酱准备好继续聊天啦～", "pet");
    } catch (err) { add(`保存设置失败：${err.message}`, "pet"); }
  });
})();
