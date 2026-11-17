'use strict';
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'settings.json');

const defaults = {
  model: 'claude-sonnet-5-5',
  maxSteps: 150,
  maxTokens: 3000000,
  toolVersion: 'computer_20250124',
  beta: 'computer-use-2025-01-24',
  apiKeyEnc: '',
  apiKeyPlain: '',
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch (_) {
    return { ...defaults };
  }
}

function save(s) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
}

function getApiKey() {
  const s = load();
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
    } catch (_) {}
  }
  return s.apiKeyPlain || '';
}

function setApiKey(key) {
  const s = load();
  if (safeStorage.isEncryptionAvailable()) {
    s.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    s.apiKeyPlain = '';
  } else {
    s.apiKeyPlain = key;
    s.apiKeyEnc = '';
  }
  save(s);
}

function publicSettings() {
  const s = load();
  delete s.apiKeyEnc;
  delete s.apiKeyPlain;
  return { ...s, hasKey: !!getApiKey() };
}

function update(patch) {
  const s = load();
  if (patch.apiKey) setApiKey(patch.apiKey);
  const s2 = load();
  for (const k of ['model', 'toolVersion', 'beta']) {
    if (typeof patch[k] === 'string' && patch[k].trim()) s2[k] = patch[k].trim();
  }
  for (const k of ['maxSteps', 'maxTokens']) {
    const n = Number(patch[k]);
    if (Number.isFinite(n) && n > 0) s2[k] = Math.round(n);
  }
  save(s2);
  void s;
}

module.exports = { load, getApiKey, publicSettings, update };
