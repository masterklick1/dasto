'use strict';
// Screenshots + mouse/keyboard control for Windows.
const { desktopCapturer, screen, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/* ---------- PowerShell helper (persistent process) ---------- */
let ps = null;
let buf = '';
let waiting = null;
let chain = Promise.resolve();

function startPS() {
  if (ps) return;
  const target = path.join(os.tmpdir(), 'dasto-input.ps1');
  fs.writeFileSync(target, fs.readFileSync(path.join(__dirname, 'input.ps1'), 'utf8'), 'utf8');
  ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', target],
    { windowsHide: true }
  );
  ps.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line !== 'OK' && !line.startsWith('ERR')) continue;
      if (!waiting) continue;
      const w = waiting;
      waiting = null;
      if (line.startsWith('ERR')) w.reject(new Error(line));
      else w.resolve();
    }
  });
  ps.stderr.on('data', () => {});
  ps.on('exit', () => {
    ps = null;
    buf = '';
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.reject(new Error('PowerShell завершился'));
    }
  });
}

function psSend(cmd) {
  const p = chain.then(
    () =>
      new Promise((resolve, reject) => {
        startPS();
        waiting = { resolve, reject };
        ps.stdin.write(cmd + '\n');
      })
  );
  chain = p.catch(() => {});
  return p;
}

function shutdown() {
  if (ps) {
    try {
      ps.kill();
    } catch (_) {}
    ps = null;
  }
}

/* ---------- Display + screenshot ---------- */
function display() {
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor || 1;
  const physW = Math.round(d.size.width * sf);
  const physH = Math.round(d.size.height * sf);
  const scale = Math.min(1, 1280 / physW, 800 / physH);
  return {
    id: d.id,
    sf,
    physW,
    physH,
    scale,
    w: Math.round(physW * scale),
    h: Math.round(physH * scale),
  };
}

async function screenshot() {
  const D = display();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: D.physW, height: D.physH },
  });
  const src = sources.find((s) => s.display_id === String(D.id)) || sources[0];
  if (!src) throw new Error('Не удалось сделать скриншот');
  let img = src.thumbnail;
  const sz = img.getSize();
  if (sz.width !== D.w || sz.height !== D.h) img = img.resize({ width: D.w, height: D.h, quality: 'good' });
  return img.toJPEG(80).toString('base64');
}

/* ---------- Keys ---------- */
const NAMED = {
  return: '{ENTER}', enter: '{ENTER}', escape: '{ESC}', esc: '{ESC}', tab: '{TAB}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}', insert: '{INSERT}',
  home: '{HOME}', end: '{END}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  page_up: '{PGUP}', pageup: '{PGUP}', prior: '{PGUP}',
  page_down: '{PGDN}', pagedown: '{PGDN}', next: '{PGDN}',
  space: ' ', minus: '-', plus: '{+}', equal: '=', comma: ',', period: '.', slash: '/',
  backslash: '\\', capslock: '{CAPSLOCK}',
};
for (let i = 1; i <= 12; i++) NAMED['f' + i] = `{F${i}}`;

const VK = {
  ctrl: 17, control: 17, shift: 16, alt: 18, super: 91, win: 91, windows: 91, meta: 91, cmd: 91,
  return: 13, enter: 13, escape: 27, esc: 27, tab: 9, space: 32, backspace: 8, delete: 46,
  left: 37, up: 38, right: 39, down: 40, home: 36, end: 35,
  page_up: 33, pageup: 33, prior: 33, page_down: 34, pagedown: 34, next: 34,
};
for (let i = 1; i <= 12; i++) VK['f' + i] = 111 + i;

const WIN_NAMES = ['super', 'win', 'windows', 'meta', 'cmd'];

function vkOf(name) {
  const n = String(name).toLowerCase();
  if (VK[n]) return VK[n];
  if (n.length === 1) return n.toUpperCase().charCodeAt(0);
  return null;
}

// "ctrl+shift+t" -> list of PowerShell commands
function comboCommands(spec) {
  const parts = spec.split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [];
  const key = parts.pop();
  const mods = parts.map((m) => m.toLowerCase());
  const lower = key.toLowerCase();
  const useVk =
    mods.some((m) => WIN_NAMES.includes(m)) ||
    WIN_NAMES.includes(lower) ||
    (mods.includes('alt') && lower === 'tab');

  if (useVk) {
    const seq = [...mods, lower].map(vkOf);
    if (seq.some((v) => v == null)) throw new Error('Неизвестная клавиша: ' + spec);
    return [
      ...seq.map((v) => `kev|${v}|0`),
      ...[...seq].reverse().map((v) => `kev|${v}|2`),
    ];
  }

  const prefix = mods
    .map((m) => (m === 'ctrl' || m === 'control' ? '^' : m === 'shift' ? '+' : m === 'alt' ? '%' : ''))
    .join('');
  let k;
  if (NAMED[lower] !== undefined) k = NAMED[lower];
  else if (key.length === 1) k = '+^%~(){}[]'.includes(key) ? `{${key}}` : prefix ? lower : key;
  else throw new Error('Неизвестная клавиша: ' + spec);
  return [`keys|${b64(prefix + k)}`];
}

/* ---------- Actions ---------- */
async function perform(input) {
  const D = display();
  const act = input.action;
  let text = null;

  const toPhys = (c) => {
    if (!Array.isArray(c) || c.length < 2) throw new Error('Нужны координаты [x, y]');
    return {
      x: clamp(Math.round(c[0] / D.scale), 0, D.physW - 1),
      y: clamp(Math.round(c[1] / D.scale), 0, D.physH - 1),
    };
  };
  const moveTo = async (c) => {
    const p = toPhys(c);
    await psSend(`move|${p.x}|${p.y}`);
    await sleep(60);
  };
  const click = async (down, up, n) => {
    for (let i = 0; i < n; i++) {
      await psSend(`btn|${down}`);
      await psSend(`btn|${up}`);
      if (i < n - 1) await sleep(50);
    }
  };

  switch (act) {
    case 'screenshot':
      break;
    case 'cursor_position': {
      const p = screen.dipToScreenPoint(screen.getCursorScreenPoint());
      text = `X=${Math.round(p.x * D.scale)},Y=${Math.round(p.y * D.scale)}`;
      break;
    }
    case 'mouse_move':
      await moveTo(input.coordinate);
      break;
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click': {
      if (input.coordinate) await moveTo(input.coordinate);
      const [down, up] = act === 'right_click' ? [8, 16] : act === 'middle_click' ? [32, 64] : [2, 4];
      const n = act === 'double_click' ? 2 : act === 'triple_click' ? 3 : 1;
      await click(down, up, n);
      break;
    }
    case 'left_mouse_down':
      if (input.coordinate) await moveTo(input.coordinate);
      await psSend('btn|2');
      break;
    case 'left_mouse_up':
      if (input.coordinate) await moveTo(input.coordinate);
      await psSend('btn|4');
      break;
    case 'left_click_drag':
      if (input.start_coordinate) await moveTo(input.start_coordinate);
      await psSend('btn|2');
      await sleep(120);
      await moveTo(input.coordinate);
      await sleep(120);
      await psSend('btn|4');
      break;
    case 'scroll': {
      if (input.coordinate) await moveTo(input.coordinate);
      const n = clamp(Number(input.scroll_amount) || 3, 1, 50);
      const dir = input.scroll_direction || 'down';
      const flag = dir === 'left' || dir === 'right' ? 0x1000 : 0x0800;
      const sign = dir === 'up' || dir === 'right' ? 1 : -1;
      await psSend(`wheel|${flag}|${sign * 120 * n}`);
      break;
    }
    case 'type': {
      const t = String(input.text ?? '');
      const old = clipboard.readText();
      clipboard.writeText(t);
      await psSend('keys|' + b64('^v'));
      await sleep(200);
      clipboard.writeText(old);
      break;
    }
    case 'key': {
      for (const spec of String(input.text || '').split(/\s+/).filter(Boolean)) {
        for (const cmd of comboCommands(spec)) await psSend(cmd);
        await sleep(80);
      }
      break;
    }
    case 'wait':
      await sleep(clamp(Number(input.duration) || 1, 0, 30) * 1000);
      break;
    default:
      throw new Error('Неподдерживаемое действие: ' + act);
  }

  if (act !== 'screenshot') await sleep(700); // let the UI settle
  const image = await screenshot();
  return { image, text };
}

module.exports = { display, screenshot, perform, shutdown };
