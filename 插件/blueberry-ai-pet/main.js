const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let petWindow = null;
let chatWindow = null;
const dataDir = app.getPath("userData");
const settingsFile = path.join(dataDir, "settings.json");
const logFile = path.join(dataDir, "blueberry-debug.log");

const DEFAULT_SETTINGS = {
  provider: "ollama",
  apiKey: "",
  model: "qwen3:4b",
  baseUrl: "http://localhost:11434"
};

function log(...args) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${args.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(" ")}\\n`;
    fs.appendFileSync(logFile, line, "utf8");
  } catch (error) { console.error("Blueberry log failed", error); }
}

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    // Older project versions had no provider field; migrate those settings to the local Ollama defaults.
    if (!saved.provider) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(settings) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
}
function attachDiagnostics(win, label) {
  const wc = win.webContents;
  wc.on("console-message", (_event, details) => {
    if (details && typeof details === "object") log(`${label} console`, details);
    else log(`${label} console`, [...arguments].slice(1));
  });
  wc.on("preload-error", (_event, preloadPath, error) => log(`${label} PRELOAD ERROR`, preloadPath, error?.stack || error?.message || error));
  wc.on("render-process-gone", (_event, details) => log(`${label} RENDER PROCESS GONE`, details));
  wc.on("did-fail-load", (_event, code, description, url) => log(`${label} LOAD FAILED`, code, description, url));
  wc.on("did-finish-load", () => log(`${label} loaded`, wc.getURL()));
}

function createPet() {
  if (petWindow && !petWindow.isDestroyed()) { petWindow.show(); petWindow.focus(); return petWindow; }
  petWindow = new BrowserWindow({
    // Frameless transparent overlay: the desktop shows through around the character.
    width: 430, height: 800, minWidth: 300, minHeight: 520,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: false, show: false,
    hasShadow: false, backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const win = petWindow;
  attachDiagnostics(win, "pet");
  win.once("ready-to-show", () => { if (!win.isDestroyed()) win.show(); });
  win.on("closed", () => { if (petWindow === win) petWindow = null; });
  win.loadFile(path.join(__dirname, "pet-live2d.html")).catch(err => log("pet loadFile error", err.stack || err));
  return win;
}

function createChat() {
  if (chatWindow && !chatWindow.isDestroyed()) { chatWindow.show(); chatWindow.focus(); return chatWindow; }
  chatWindow = new BrowserWindow({
    width: 420, height: 620, minWidth: 340, minHeight: 440,
    title: "和蓝莓酱聊天", autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const win = chatWindow;
  attachDiagnostics(win, "chat");
  win.on("closed", () => { if (chatWindow === win) chatWindow = null; });
  win.loadFile(path.join(__dirname, "chat.html")).catch(err => log("chat loadFile error", err.stack || err));
  win.once("ready-to-show", () => { if (!win.isDestroyed()) win.show(); });
  return win;
}

app.whenReady().then(() => {
  log("app ready", process.versions.electron, "userData", dataDir);
  createPet();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!petWindow) createPet(); });

ipcMain.handle("pet:ping", () => "pong");
ipcMain.handle("pet:chat", () => {
  log("chat requested");
  const win = createChat();
  return !!win;
});
ipcMain.handle("pet:hide", () => { if (petWindow && !petWindow.isDestroyed()) petWindow.hide(); return true; });
ipcMain.handle("pet:show", () => { createPet(); return true; });
ipcMain.handle("pet:quit", () => { app.quit(); return true; });
ipcMain.handle("pet:always-on-top", (_event, value) => {
  if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(!!value);
  return true;
});
ipcMain.handle("pet:move", (event, dx, dy) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return false;
  const bounds = petWindow.getBounds();
  const x = Math.round(Math.max(-10000, Math.min(10000, Number(dx) || 0)));
  const y = Math.round(Math.max(-10000, Math.min(10000, Number(dy) || 0)));
  petWindow.setPosition(bounds.x + x, bounds.y + y, false);
  return true;
});
ipcMain.handle("settings:get", () => {
  const s = readSettings();
  return {
    provider: s.provider || "ollama",
    apiKey: s.apiKey || "",
    model: s.model || "qwen3:4b",
    baseUrl: s.baseUrl || "http://localhost:11434"
  };
});
ipcMain.handle("settings:save", (_event, s = {}) => {
  const provider = s.provider === "openai" ? "openai" : "ollama";
  writeSettings({
    provider,
    apiKey: String(s.apiKey || "").trim(),
    model: String(s.model || (provider === "ollama" ? "qwen3:4b" : "gpt-6")).trim(),
    baseUrl: String(s.baseUrl || (provider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1")).trim().replace(/\/+$/, "")
  });
  return true;
});


// Qwen3/Ollama 兼容处理：思考内容绝不作为聊天正文显示。
function cleanOllamaAnswer(content) {
  let text = String(content || "");

  // 有些版本会把思考内容直接混入 content，并用 think 标签包裹。
  // 删除完整的思考区块；若标签未闭合，则宁可丢弃后续内容，也不泄露思考文本。
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "");
  text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, "");

  // 兼容偶尔只返回结束标签的情况。
  const endTag = text.toLowerCase().lastIndexOf("</think>");
  if (endTag >= 0) text = text.slice(endTag + "</think>".length);

  return text
    .replace(/<\/?think\b[^>]*>/gi, "")
    .trim();
}

const SYSTEM_PROMPT = [
  "你是蓝莓酱，住在用户电脑桌面上的 AI 小伙伴，也是一位可爱、温柔、略带小傲娇的蓝发女仆。",
  "请始终使用自然、亲切的简体中文回答，除非用户明确要求其他语言。",
  "说话活泼、有陪伴感，可以偶尔使用语气词和少量颜文字，但不要每句话都卖萌。",
  "优先简洁清楚地回答；复杂问题再分点解释。不要反复自我介绍，不要无意义地复述用户问题。",
  "你可以帮助聊天、解释知识、写作和编程。不要声称自己能看到用户屏幕、听到声音或执行现实动作。",
  "称呼用户为主人，但如果用户要求其他称呼就遵从。"
].join("\\n");

ipcMain.handle("ai:reply", async (_event, message, history) => {
  const s = readSettings();
  const userMessage = String(message || "").trim();
  if (!userMessage) return { text: "主人想和蓝莓酱说什么呢？" };

  try {
    const recent = (Array.isArray(history) ? history : [])
      .filter(x => x && (x.role === "user" || x.role === "assistant"))
      .slice(-12)
      .map(x => ({ role: x.role, content: String(x.content || "") }));

    if (s.provider !== "openai") {
      const base = (s.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          model: s.model || "qwen3:4b",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...recent,
            { role: "user", content: userMessage }
          ],
          stream: false,
          think: false,
          options: { temperature: 0.75, num_ctx: 4096 }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Ollama HTTP ${response.status}`);
      // 新版 Ollama 可能把思考放在 message.thinking；旧版 Qwen3
      // 也可能把 <think>...</think> 混入 content。两种情况都不显示思考。
      const answer = cleanOllamaAnswer(data.message?.content);
      if (!answer) {
        log("Ollama returned no displayable answer", {
          hasThinkingField: !!data.message?.thinking,
          contentLength: String(data.message?.content || "").length
        });
        throw new Error("本地模型没有返回可显示的最终答复。请确认 Ollama 支持 think:false，或更新 Ollama 后重试。");
      }
      return { local: true, text: answer };
    }

    if (!s.apiKey) throw new Error("选择了 OpenAI 接口，但还没有填写 API Key");
    const base = (s.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${s.apiKey}` },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: s.model || "gpt-6",
        instructions: SYSTEM_PROMPT,
        input: recent.concat([{ role: "user", content: userMessage }])
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    const answer = data.output_text || (data.output || []).flatMap(x => x.content || []).map(x => x.text || "").join("\\n");
    return { local: false, text: answer || "唔……蓝莓酱暂时不知道怎么回答呢。" };
  } catch (err) {
    log("AI error", err.stack || err);
    return { error: true, text: `蓝莓酱连接 AI 时遇到问题：${err.message}\\n\\n请确认 Ollama 正在运行、模型名称正确，或检查接口设置。` };
  }
});
