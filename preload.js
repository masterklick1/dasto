'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['log', 'ask', 'state', 'usage'];

contextBridge.exposeInMainWorld('dasto', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  start: (task) => ipcRenderer.invoke('task:start', task),
  stop: () => ipcRenderer.invoke('task:stop'),
  answer: (v) => ipcRenderer.invoke('ask:answer', v),
  on: (channel, fn) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
