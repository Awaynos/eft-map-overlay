// preload.js — безопасный мост (contextBridge) между страницей eft.su и основным процессом
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eftOverlay', {
  setMap: (slug) => ipcRenderer.send('set-map', slug),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  toggleClickThrough: () => ipcRenderer.send('toggle-clickthrough'),
  setToolbarCollapsed: (v) => ipcRenderer.send('set-toolbar-collapsed', v),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  openExternal: () => ipcRenderer.send('open-external'),
  onStateChange: (cb) => ipcRenderer.on('state-changed', (_e, s) => cb(s)),
});