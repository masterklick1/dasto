'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, Notification, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const settings = require('./src/settings');
const computer = require('./src/computer');
const { Agent } = require('./src/agent');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('app.dasto.desktop');

let win = null;
let agent = null;
let pendingAsk = null;
let prevBounds = null;

const logDir = () => path.join(app.getPath('userData'), 'logs');

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function log(type, text) {
  const entry = { type, text: String(text), time: new Date().toISOString() };
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    fs.appendFileSync(path.join(logDir(), entry.time.slice(0, 10) + '.log'), `${entry.time} [${type}] ${entry.text}\n`);
  } catch (_) {}
  send('log', entry);
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 380,
    minHeight: 460,
    backgroundColor: '#0b0d12',
    title: 'Dasto',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setContentProtection(true); // window is invisible on the agent's screenshots
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
    if (agent) agent.stop();
  });
}

// Small click-through panel while the agent works
function enterMini() {
  if (!win) return;
  prevBounds = win.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({ width: 400, height: 480, x: wa.x + wa.width - 412, y: wa.y + wa.height - 492 });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
}

function exitMini() {
  if (!win) return;
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(false);
  if (prevBounds) win.setBounds(prevBounds);
  prevBounds = null;
}

function ask(kind, message) {
  return new Promise((resolve) => {
    pendingAsk = { resolve };
    if (win) {
      win.setIgnoreMouseEvents(false);
      win.show();
      win.focus();
    }
    send('ask', { kind, message });
    try {
      new Notification({ title: 'Dasto: нужна твоя помощь', body: String(message).slice(0, 200) }).show();
    } catch (_) {}
    shell.beep();
  });
}

function cancelAsk() {
  if (pendingAsk) {
    pendingAsk.resolve({ value: 'stop' });
    pendingAsk = null;
  }
}

ipcMain.handle('settings:get', () => settings.publicSettings());
ipcMain.handle('settings:save', (_e, patch) => {
  settings.update(patch || {});
  return settings.publicSettings();
});

ipcMain.handle('task:start', (_e, task) => {
  task = String(task || '').trim();
  if (agent) return { ok: false, error: 'Задача уже выполняется' };
  if (!task) return { ok: false, error: 'Напиши, что нужно сделать' };
  if (!settings.getApiKey()) return { ok: false, error: 'Сначала укажи API-ключ в ⚙ Настройках' };

  agent = new Agent({
    getSettings: settings.load,
    getApiKey: settings.getApiKey,
    ui: {
      log,
      ask,
      cancelAsk,
      usage: (u) => send('usage', u),
    },
  });
  const current = agent;
  enterMini();
  send('state', { running: true });
  log('info', 'Задача: ' + task);

  current
    .run(task)
    .catch((e) => log('error', e.message))
    .finally(() => {
      if (agent === current) agent = null;
      cancelAsk();
      exitMini();
      send('state', { running: false });
    });
  return { ok: true };
});

ipcMain.handle('task:stop', () => {
  if (agent) {
    log('info', 'Остановка…');
    agent.stop();
  }
});

ipcMain.handle('ask:answer', (_e, v) => {
  if (pendingAsk) {
    pendingAsk.resolve(v || {});
    pendingAsk = null;
  }
  if (agent && win) win.setIgnoreMouseEvents(true);
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  createWindow();
  const ok = globalShortcut.register('CommandOrControl+Shift+X', () => {
    if (agent) {
      log('info', 'Аварийная остановка (Ctrl+Shift+X)');
      agent.stop();
    }
  });
  if (!ok) log('error', 'Не удалось зарегистрировать Ctrl+Shift+X');
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  computer.shutdown();
});
