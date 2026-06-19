// preload.js — 安全的渲染进程 ↔ 主进程 IPC 桥
// 通过 contextBridge 暴露受限 API，渲染进程无法直接访问 Node
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botAPI', {
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  getState: () => ipcRenderer.invoke('bot:getState'),
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  readConfig: () => ipcRenderer.invoke('config:read'),
  saveConfig: (content) => ipcRenderer.invoke('config:save', content),
  openConfigInEditor: () => ipcRenderer.invoke('config:openInEditor'),
  clearLog: () => ipcRenderer.invoke('log:clear'),
  getAllLog: () => ipcRenderer.invoke('log:getAll'),

  // 主进程 → 渲染进程的事件订阅
  onLog: (cb) => {
    const handler = (_e, line) => cb(line);
    ipcRenderer.on('bot:log', handler);
    return () => ipcRenderer.removeListener('bot:log', handler);
  },
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('bot:state', handler);
    return () => ipcRenderer.removeListener('bot:state', handler);
  },
  onConfigured: (cb) => {
    const handler = (_e, ok) => cb(ok);
    ipcRenderer.on('app:configured', handler);
    return () => ipcRenderer.removeListener('app:configured', handler);
  },
  // 用系统默认浏览器打开外部链接
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // ZCode: 订阅管理 API
  subsList: () => ipcRenderer.invoke('subs:list'),
  subsToggle: (id) => ipcRenderer.invoke('subs:toggle', id),
  subsDelete: (id) => ipcRenderer.invoke('subs:delete', id),
  subsAdd: (data) => ipcRenderer.invoke('subs:add', data),
  subsGetManagerId: () => ipcRenderer.invoke('subs:getManagerId'),
  subsReimport: () => ipcRenderer.invoke('subs:reimport'),
  // 推送历史
  historyList: () => ipcRenderer.invoke('history:list'),
  historyCount: () => ipcRenderer.invoke('history:count'),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  // 用户管理
  usersList: () => ipcRenderer.invoke('users:list'),
  usersAdd: (id) => ipcRenderer.invoke('users:add', id),
  usersRemove: (id) => ipcRenderer.invoke('users:remove', id),

  // X/Twitter 桥接配置
  bridgeReadConfig: () => ipcRenderer.invoke('bridge:readConfig'),
  bridgeSaveConfig: (cfg) => ipcRenderer.invoke('bridge:saveConfig', cfg),
});
