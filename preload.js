const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  togglePin: () => ipcRenderer.send('toggle-pin'),
  refreshAll: () => ipcRenderer.send('refresh-all'),
  openExternal: (id) => ipcRenderer.send('open-external', id),
  setBgAlpha: (value) => ipcRenderer.send('set-bg-alpha', value),
  hideWindow: () => ipcRenderer.send('hide-window'),
  startLogin: (id) => ipcRenderer.send('start-login', id),
  endLogin: () => ipcRenderer.send('end-login'),
  onLoginMode: (cb) => ipcRenderer.on('login-mode', (_e, payload) => cb(payload)),
  getInitState: () => ipcRenderer.invoke('get-init-state'),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_e, payload) => cb(payload)),
  onPinState: (cb) => ipcRenderer.on('pin-state', (_e, v) => cb(v)),
});
