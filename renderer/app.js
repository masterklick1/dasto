'use strict';
const $ = (id) => document.getElementById(id);
const api = window.dasto;

function setRunning(v) {
  $('btnStart').disabled = v;
  $('btnStop').disabled = !v;
  $('task').disabled = v;
  $('dot').className = 'dot' + (v ? ' on' : '');
  $('status').textContent = v ? 'Работает' : 'Готов';
}

function addLog(e) {
  const row = document.createElement('div');
  row.className = 'item ' + e.type;
  const t = document.createElement('span');
  t.className = 'time';
  t.textContent = new Date(e.time).toLocaleTimeString();
  const m = document.createElement('span');
  m.textContent = e.text;
  row.append(t, m);
  const box = $('log');
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

/* ---------- ask dialog ---------- */
function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = cls;
  b.onclick = onClick;
  $('askActions').appendChild(b);
}

function answer(payload) {
  $('ask').classList.add('hidden');
  api.answer(payload);
}

function showAsk({ kind, message }) {
  $('askTitle').textContent =
    kind === 'confirm' ? 'Нужно подтверждение' : kind === 'handoff' ? 'Нужна твоя помощь' : 'Вопрос';
  $('askMsg').textContent = message;
  $('askActions').innerHTML = '';
  const input = $('askInput');
  input.value = '';
  input.classList.toggle('hidden', kind !== 'question');

  if (kind === 'confirm') {
    button('Да, разрешаю', 'primary', () => answer({ value: 'yes' }));
    button('Нет', 'ghost', () => answer({ value: 'no' }));
  } else if (kind === 'handoff') {
    button('Я сделал, продолжай', 'primary', () => answer({ value: 'done' }));
  } else {
    button('Ответить', 'primary', () => answer({ value: 'text', text: input.value }));
  }
  button('Остановить задачу', 'danger', () => answer({ value: 'stop' }));
  $('ask').classList.remove('hidden');
  if (kind === 'question') input.focus();
}

/* ---------- settings ---------- */
async function openSettings() {
  const s = await api.getSettings();
  $('apiKey').value = '';
  $('apiKey').placeholder = s.hasKey ? '•••••••• (сохранён)' : 'sk-ant-...';
  $('model').value = s.model;
  $('maxSteps').value = s.maxSteps;
  $('maxTokens').value = s.maxTokens;
  $('toolVersion').value = s.toolVersion;
  $('beta').value = s.beta;
  $('settings').classList.remove('hidden');
}

$('btnSettings').onclick = openSettings;
$('btnClose').onclick = () => $('settings').classList.add('hidden');
$('btnSave').onclick = async () => {
  await api.saveSettings({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    maxSteps: $('maxSteps').value,
    maxTokens: $('maxTokens').value,
    toolVersion: $('toolVersion').value,
    beta: $('beta').value,
  });
  $('settings').classList.add('hidden');
  addLog({ type: 'info', text: 'Настройки сохранены', time: Date.now() });
};

/* ---------- task ---------- */
$('btnStart').onclick = async () => {
  const r = await api.start($('task').value);
  if (r && !r.ok) addLog({ type: 'error', text: r.error, time: Date.now() });
};
$('btnStop').onclick = () => api.stop();

api.on('log', addLog);
api.on('ask', showAsk);
api.on('state', (s) => setRunning(!!s.running));
api.on('usage', (u) => {
  $('usage').textContent = `Шагов: ${u.steps} · Токенов: ${(u.input + u.output).toLocaleString('ru-RU')}`;
});

api.getSettings().then((s) => {
  if (!s.hasKey) addLog({ type: 'info', text: 'Начни с ⚙ Настроек: вставь API-ключ Anthropic.', time: Date.now() });
});
