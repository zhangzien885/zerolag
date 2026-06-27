const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zeroLag", {
  getStatus: () => ipcRenderer.invoke("zerolag:get-status"),
  getMemory: () => ipcRenderer.invoke("zerolag:get-memory"),
  restoreDailyMode: () => ipcRenderer.invoke("zerolag:restore-daily-mode"),
  getGameLibrary: () => ipcRenderer.invoke("zerolag:get-game-library"),
  addGame: () => ipcRenderer.invoke("zerolag:add-game"),
  removeGame: (id) => ipcRenderer.invoke("zerolag:remove-game", id),
  launchGame: (id) => ipcRenderer.invoke("zerolag:launch-game", id),
  getNetworkDiagnostics: () => ipcRenderer.invoke("zerolag:get-network-diagnostics"),
  flushDns: () => ipcRenderer.invoke("zerolag:flush-dns"),
  getAppConfig: () => ipcRenderer.invoke("zerolag:get-app-config"),
  getUpdateStatus: () => ipcRenderer.invoke("zerolag:get-update-status"),
  openWebsite: () => ipcRenderer.invoke("zerolag:open-website"),
  openUpdateUrl: (url) => ipcRenderer.invoke("zerolag:open-update-url", url),
  openExternalUrl: (url) => ipcRenderer.invoke("zerolag:open-update-url", url),
  activateLicense: (code) => ipcRenderer.invoke("zerolag:activate-license", code),
  boost: () => ipcRenderer.invoke("zerolag:boost")
});
