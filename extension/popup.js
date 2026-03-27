'use strict';

const serverUrlInput = document.getElementById('server-url');
const modelSelect    = document.getElementById('model');
const btnSave        = document.getElementById('btn-save');
const btnOpenLive    = document.getElementById('btn-open-live');
const statusMsg      = document.getElementById('status-msg');

// Load saved settings
chrome.storage.local.get(['serverUrl', 'model'], (data) => {
  serverUrlInput.value = data.serverUrl || 'ws://localhost:5000/ws/live';
  modelSelect.value    = data.model    || 'base';
});

// Save settings
btnSave.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim() || 'ws://localhost:5000/ws/live';
  const model     = modelSelect.value;

  chrome.storage.local.set({ serverUrl, model }, () => {
    statusMsg.textContent = 'Ayarlar kaydedildi ✓';
    statusMsg.className = 'status-msg';
    setTimeout(() => statusMsg.classList.add('hidden'), 2000);
  });
});

// Open the full web UI
btnOpenLive.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim() || 'ws://localhost:5000/ws/live';
  chrome.runtime.sendMessage({ type: 'openLivePage', serverUrl });
  window.close();
});
