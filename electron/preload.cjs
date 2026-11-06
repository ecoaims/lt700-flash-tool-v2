const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lt700', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  listFirmware: (target) => ipcRenderer.invoke('firmware:list', target),
  attachFirmware: (target) => ipcRenderer.invoke('firmware:attach', target),
  readFirmware: (id) => ipcRenderer.invoke('firmware:read', id),
  readRamBsl: () => ipcRenderer.invoke('firmware:ram-bsl'),
  listOnline: () => ipcRenderer.invoke('online:list'),
  downloadOnline: (item) => ipcRenderer.invoke('online:download', item),
  logStart: (operation, details) => ipcRenderer.invoke('log:start', operation, details),
  logWrite: (id, line) => ipcRenderer.invoke('log:write', id, line),
  logFinish: (id, result) => ipcRenderer.invoke('log:finish', id, result),
  openLogFolder: () => ipcRenderer.invoke('log:open-folder'),
  openGuide: () => ipcRenderer.invoke('guide:open'),
  getPlatform: () => process.platform,
});
