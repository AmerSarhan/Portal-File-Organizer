const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getRules: () => ipcRenderer.invoke("get-rules"),
  addRule: (rule) => ipcRenderer.invoke("add-rule", rule),
  updateRule: (rule) => ipcRenderer.invoke("update-rule", rule),
  deleteRule: (id) => ipcRenderer.invoke("delete-rule", id),
  toggleRule: (id) => ipcRenderer.invoke("toggle-rule", id),
  getActivity: () => ipcRenderer.invoke("get-activity"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  onFileMoved: (callback) => {
    ipcRenderer.on("file-moved", (_event, entry) => callback(entry));
  },
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  // API key
  getApiKey: () => ipcRenderer.invoke("get-api-key"),
  saveApiKey: (key) => ipcRenderer.invoke("save-api-key", key),
  // AI
  aiCreateRule: (prompt) => ipcRenderer.invoke("ai-create-rule", prompt),
  // Stats & Undo
  getStats: () => ipcRenderer.invoke("get-stats"),
  undoLastMove: () => ipcRenderer.invoke("undo-last-move"),
  // Organize Now
  organizeNow: () => ipcRenderer.invoke("organize-now"),
  // Auto-start
  getAutoStart: () => ipcRenderer.invoke("get-auto-start"),
  setAutoStart: (enabled) => ipcRenderer.invoke("set-auto-start", enabled),
  // Settings (conflict mode etc.)
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
});
