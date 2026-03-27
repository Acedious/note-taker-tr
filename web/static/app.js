'use strict';

// ── Utility ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function renderMarkdown(text) {
  // Minimal markdown → HTML renderer (headings, lists, bold, horizontal rules)
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headings
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr />')
    // Checkbox list items
    .replace(/^- \[ \] (.+)$/gm, '<li>☐ $1</li>')
    .replace(/^- \[x\] (.+)/gmi, '<li>☑ $1</li>')
    // Unordered list items
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> blocks in <ul>
    .replace(/(<li>[\s\S]*?<\/li>)(?=\s*<li>|$)/g, (match) => match)
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (/^<[hlu]|^<\/[hlu]|^<hr|^<li/.test(line)) return line;
      return line;
    })
    .replace(/<\/h[123]>\n/g, '</h2>')
    // Wrap li sequences
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

const dropZone = $('drop-zone');
const fileInput = $('audio-file');
const fileNameEl = $('file-name');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    fileNameEl.textContent = e.dataTransfer.files[0].name;
  }
});
fileInput.addEventListener('change', () => {
  fileNameEl.textContent = fileInput.files[0]?.name || '';
});

// ── Form submit ───────────────────────────────────────────────────────────────

const form      = $('upload-form');
const submitBtn = $('submit-btn');
const progressArea = $('progress-area');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const resultSection = $('result-section');

let currentMeetingPath = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) return;

  submitBtn.disabled = true;
  progressArea.classList.remove('hidden');
  resultSection.classList.add('hidden');
  setProgress(10, 'Dosya yükleniyor...');

  const fd = new FormData(form);
  fd.set('generate_notes', $('generate-notes').checked ? 'true' : 'false');

  let res;
  try {
    res = await fetch('/api/transcribe', { method: 'POST', body: fd });
  } catch (err) {
    showError('Sunucuya bağlanılamadı: ' + err.message);
    return;
  }

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    showError(d.error || 'Bilinmeyen hata');
    return;
  }

  const { job_id } = await res.json();
  pollJob(job_id);
});

async function pollJob(jobId) {
  const maxWait = 600;   // seconds
  const start = Date.now();

  while ((Date.now() - start) / 1000 < maxWait) {
    await sleep(2000);

    let data;
    try {
      const r = await fetch(`/api/jobs/${jobId}`);
      data = await r.json();
    } catch (_) {
      continue;
    }

    if (data.status === 'running') {
      const progress = data.progress || 'İşleniyor...';
      const fake = Math.min(20 + ((Date.now() - start) / 1000) * 0.5, 80);
      setProgress(fake, progress);
      continue;
    }

    if (data.status === 'error') {
      showError(data.error || 'Bir hata oluştu');
      return;
    }

    if (data.status === 'done') {
      setProgress(100, 'Tamamlandı!');
      currentMeetingPath = data.meeting_path;
      showResult(data);
      loadMeetingsList();
      return;
    }
  }

  showError('Zaman aşımı — işlem çok uzun sürdü.');
}

function showResult(data) {
  $('result-title').textContent = data.title || 'Toplantı';
  $('notes-content').innerHTML = renderMarkdown(data.notes || '_Not oluşturulmadı._');
  $('transcript-content').textContent = data.transcript || '';
  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });

  // Reset tab to notes
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.tab[data-tab="notes"]').classList.add('active');
  $('tab-notes').classList.remove('hidden');
  $('tab-transcript').classList.add('hidden');
}

function showError(msg) {
  setProgress(0, `Hata: ${msg}`);
  progressFill.style.background = '#e05252';
  submitBtn.disabled = false;
}

function setProgress(pct, text) {
  progressFill.style.width = pct + '%';
  progressText.textContent = text;
  if (pct >= 100) {
    setTimeout(() => {
      progressArea.classList.add('hidden');
      submitBtn.disabled = false;
    }, 1200);
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.remove('hidden');
  });
});

// ── Export ────────────────────────────────────────────────────────────────────

$('export-md-btn').addEventListener('click', () => exportMeeting('md'));
$('export-txt-btn').addEventListener('click', () => exportMeeting('txt'));

function exportMeeting(fmt) {
  if (!currentMeetingPath) return;
  // Strip leading slash for URL path
  const urlPath = currentMeetingPath.replace(/^\//, '');
  window.location = `/api/meetings/${urlPath}/export?format=${fmt}`;
}

// ── Meetings list ─────────────────────────────────────────────────────────────

async function loadMeetingsList() {
  const container = $('meetings-list');
  try {
    const res  = await fetch('/api/meetings');
    const meetings = await res.json();

    if (!meetings.length) {
      container.innerHTML = '<p class="muted">Henüz kaydedilmiş toplantı yok.</p>';
      return;
    }

    const rows = meetings.map(m => {
      const date     = (m.created_at || '').slice(0, 16).replace('T', ' ');
      const duration = fmtDuration(m.duration_seconds || 0);
      const words    = m.word_count ? m.word_count + ' kelime' : '—';
      const path     = (m.path || '').replace(/^\//, '');
      return `<tr data-path="${path}">
        <td>${m.title || '—'}</td>
        <td class="muted">${date}</td>
        <td class="muted">${duration}</td>
        <td class="muted">${words}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="meetings-table">
        <thead><tr><th>Başlık</th><th>Tarih</th><th>Süre</th><th>Kelime</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    container.querySelectorAll('tr[data-path]').forEach(row => {
      row.addEventListener('click', () => openSavedMeeting(row.dataset.path));
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">Toplantılar yüklenemedi: ${err.message}</p>`;
  }
}

async function openSavedMeeting(path) {
  try {
    const res  = await fetch(`/api/meetings/${path}`);
    const data = await res.json();
    if (data.error) return;
    currentMeetingPath = data.path;
    showResult({ title: data.title, notes: data.notes, transcript: data.transcript_timed || data.transcript });
  } catch (_) {}
}

function fmtDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}d ${String(s).padStart(2,'0')}s`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ──────────────────────────────────────────────────────────────────────

loadMeetingsList();
