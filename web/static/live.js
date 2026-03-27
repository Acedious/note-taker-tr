'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btnRecord     = document.getElementById('btn-record');
const btnNotes      = document.getElementById('btn-notes');
const btnSave       = document.getElementById('btn-save');
const btnExportMd   = document.getElementById('btn-export-md');
const btnExportTxt  = document.getElementById('btn-export-txt');
const btnCloseNotes = document.getElementById('btn-close-notes');
const statusBadge   = document.getElementById('status-badge');
const transcriptBox = document.getElementById('transcript-box');
const wordCountEl   = document.getElementById('word-count');
const timerEl       = document.getElementById('timer');
const notesPanel    = document.getElementById('notes-panel');
const notesContent  = document.getElementById('notes-content');
const waveEl        = document.getElementById('wave');
const toastEl       = document.getElementById('toast');
const titleInput    = document.getElementById('meeting-title');
const modelSelect   = document.getElementById('model-select');
const serverUrlInput = document.getElementById('server-url');

// ── State ─────────────────────────────────────────────────────────────────────

let ws           = null;
let mediaRecorder = null;
let stream       = null;
let recording    = false;
let timerInterval = null;
let timerSeconds = 0;
let lastSavedPath = null;
let fullTranscript = '';

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  const url = serverUrlInput.value.trim() || 'ws://localhost:5000/ws/live';
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    // Send init message
    ws.send(JSON.stringify({
      type: 'init',
      model: modelSelect.value,
      title: titleInput.value.trim(),
    }));
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      handleServerMessage(JSON.parse(event.data));
    }
  };

  ws.onerror = () => setStatus('Bağlantı hatası — sunucu çalışıyor mu?', 'error');
  ws.onclose = () => {
    if (recording) stopRecording();
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'status':
      setStatus(msg.message, msg.state);
      break;

    case 'transcript':
      appendTranscript(msg.delta);
      fullTranscript = msg.full;
      btnNotes.disabled = false;
      btnSave.disabled  = false;
      break;

    case 'notes':
      showNotes(msg.text);
      break;

    case 'saved':
      lastSavedPath = msg.path;
      showToast('✓ Toplantı kaydedildi');
      break;

    case 'error':
      setStatus(msg.message, 'error');
      break;
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    setStatus('Mikrofon erişimi reddedildi: ' + err.message, 'error');
    return;
  }

  connectWS();

  // Pick best supported format
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

  // Send each chunk (every 5 s) as binary over WebSocket
  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const buf = await e.data.arrayBuffer();
      ws.send(buf);
    }
  };

  mediaRecorder.start(5000);   // timeslice = 5 seconds
  recording = true;
  startTimer();
  btnRecord.textContent = '';
  btnRecord.innerHTML = '<span class="rec-dot"></span> Kaydı Durdur';
  btnRecord.classList.add('active');
  waveEl.classList.remove('hidden');
  clearTranscript();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }));
    ws.close();
  }
  ws = null;
  recording = false;
  stopTimer();
  btnRecord.innerHTML = '<span class="rec-dot"></span> Kaydı Başlat';
  btnRecord.classList.remove('active');
  waveEl.classList.add('hidden');
  setStatus('Durduruldu', 'idle');
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus(message, state) {
  statusBadge.textContent = message;
  statusBadge.className = 'status-badge status-' + (state || 'idle');
}

function clearTranscript() {
  transcriptBox.innerHTML = '';
  fullTranscript = '';
  wordCountEl.textContent = '0 kelime';
}

function appendTranscript(delta) {
  // Remove placeholder if present
  const placeholder = transcriptBox.querySelector('.placeholder-text');
  if (placeholder) placeholder.remove();

  const span = document.createElement('span');
  span.className = 'segment-new';
  span.textContent = delta + ' ';
  transcriptBox.appendChild(span);

  // Auto-scroll to bottom
  transcriptBox.scrollTop = transcriptBox.scrollHeight;

  // Word count
  const words = transcriptBox.textContent.trim().split(/\s+/).filter(Boolean).length;
  wordCountEl.textContent = words + ' kelime';
}

function showNotes(markdown) {
  notesContent.innerHTML = renderMarkdown(markdown);
  notesPanel.classList.remove('hidden');
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const s = (timerSeconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

// ── Export ────────────────────────────────────────────────────────────────────

function downloadText(content, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  a.download = filename;
  a.click();
}

function buildExportContent(fmt) {
  const title = titleInput.value.trim() || 'Toplantı';
  const notes  = notesContent.textContent ? notesContent.innerText : '';
  if (fmt === 'md') {
    return `# ${title}\n\n${notes || '_Not oluşturulmadı._'}\n\n---\n\n## Transkript\n\n${fullTranscript}`;
  }
  return `${title}\n${'='.repeat(title.length)}\n\n${notes || 'Not oluşturulmadı.'}\n\n--- TRANSKRİPT ---\n\n${fullTranscript}`;
}

// ── Markdown renderer (minimal) ───────────────────────────────────────────────

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm,  '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^- \[ \] (.+)$/gm, '<li>☐ $1</li>')
    .replace(/^- \[x\] (.+)/gmi, '<li>☑ $1</li>')
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul]|<\/[hul]|<hr)(.+)$/gm, '$1');
}

// ── Event listeners ───────────────────────────────────────────────────────────

btnRecord.addEventListener('click', () => {
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
});

btnNotes.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'notes' }));
    setStatus('Notlar oluşturuluyor...', 'generating');
  }
});

btnSave.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'save' }));
  } else {
    // Already disconnected — save via export
    showToast('Toplantı kaydı için önce kaydı durdurun.');
  }
});

btnExportMd.addEventListener('click', () => {
  const title = titleInput.value.trim() || 'toplanti';
  downloadText(buildExportContent('md'), title + '.md');
});

btnExportTxt.addEventListener('click', () => {
  const title = titleInput.value.trim() || 'toplanti';
  downloadText(buildExportContent('txt'), title + '.txt');
});

btnCloseNotes.addEventListener('click', () => notesPanel.classList.add('hidden'));
