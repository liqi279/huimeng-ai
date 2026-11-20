const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  openChat: () => ipcRenderer.invoke("pet:chat"),
  hide: () => ipcRenderer.invoke("pet:hide"),
  show: () => ipcRenderer.invoke("pet:show"),
  quit: () => ipcRenderer.invoke("pet:quit"),
  setTop: value => ipcRenderer.invoke("pet:always-on-top", !!value),
  moveBy: (dx, dy) => ipcRenderer.invoke("pet:move", Number(dx) || 0, Number(dy) || 0),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),
  reply: (message, history) => ipcRenderer.invoke("ai:reply", message, history),
  ping: () => ipcRenderer.invoke("pet:ping")
});
