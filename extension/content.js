/**
 * Türkçe Toplantı Asistanı — Google Meet content script
 *
 * Injects a floating sidebar with live Turkish transcription.
 * Uses Shadow DOM to isolate styles from Google Meet's own CSS.
 *
 * Audio flow:
 *   microphone → MediaRecorder (5s chunks, WebM/Opus)
 *     → WebSocket binary frame → Python/Whisper backend
 *       → JSON transcript back → sidebar display
 */
(function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('tma-root')) return;

  // ── Constants ──────────────────────────────────────────────────────────────

  const DEFAULT_WS = 'ws://localhost:5000/ws/live';

  // ── Load settings then build sidebar ──────────────────────────────────────

  chrome.storage.local.get(['serverUrl', 'model'], (data) => {
    const wsUrl    = data.serverUrl || DEFAULT_WS;
    const model    = data.model    || 'base';
    buildSidebar(wsUrl, model);
  });

  // ── Sidebar HTML/CSS (injected into Shadow DOM) ────────────────────────────

  const SIDEBAR_CSS = `
    :host { all: initial; font-family: 'Segoe UI', system-ui, sans-serif; }

    #panel {
      position: fixed; top: 80px; right: 16px;
      width: 340px; z-index: 2147483647;
      background: #1a1d27; border: 1px solid #2e3347;
      border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.6);
      color: #e2e6f0; font-size: 13px; line-height: 1.5;
      display: flex; flex-direction: column; overflow: hidden;
      transition: height .2s;
    }
    #panel.minimized #body { display: none; }

    /* Header */
    .hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: #242838;
      border-bottom: 1px solid #2e3347; cursor: move; user-select: none;
    }
    .hdr-title { font-weight: 700; font-size: 13px; }
    .hdr-btns  { display: flex; gap: 6px; }
    .hdr-btn {
      background: none; border: 1px solid #2e3347;
      border-radius: 4px; color: #7b849e;
      cursor: pointer; font-size: 13px;
      width: 22px; height: 22px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      transition: color .2s, border-color .2s;
    }
    .hdr-btn:hover { color: #e2e6f0; border-color: #4f8ef7; }

    /* Body */
    #body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

    /* Controls */
    .ctrl-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn-rec {
      display: flex; align-items: center; gap: 6px;
      background: #242838; border: 1px solid #2e3347;
      border-radius: 6px; color: #e2e6f0;
      cursor: pointer; font-size: 12px; font-weight: 600;
      padding: 6px 12px; transition: all .2s;
    }
    .btn-rec:hover  { border-color: #4f8ef7; }
    .btn-rec.active { background: rgba(224,82,82,.15); border-color: #e05252; color: #e05252; }
    .rec-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #7b849e; transition: background .3s;
    }
    .btn-rec.active .rec-dot { background: #e05252; animation: blink 1.2s infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.25} }

    .btn-sm {
      background: #242838; border: 1px solid #2e3347;
      border-radius: 5px; color: #e2e6f0;
      cursor: pointer; font-size: 11px; font-weight: 600;
      padding: 5px 10px; transition: all .2s;
    }
    .btn-sm:hover   { border-color: #4f8ef7; color: #4f8ef7; }
    .btn-sm:disabled{ opacity: .4; cursor: not-allowed; }

    /* Status */
    .status {
      font-size: 11px; font-weight: 600;
      padding: 3px 8px; border-radius: 10px;
      border: 1px solid #2e3347; color: #7b849e;
      transition: all .3s;
    }
    .status.loading     { color: #f0a050; border-color: #f0a050; }
    .status.ready       { color: #3ecf8e; border-color: #3ecf8e; }
    .status.recording   { color: #e05252; border-color: #e05252; }
    .status.transcribing{ color: #4f8ef7; border-color: #4f8ef7; }
    .status.generating  { color: #a98ced; border-color: #a98ced; }
    .status.error       { color: #e05252; border-color: #e05252; }

    /* Transcript */
    #transcript {
      background: #0f1117; border: 1px solid #2e3347;
      border-radius: 6px; max-height: 220px; min-height: 80px;
      overflow-y: auto; padding: 10px;
      font-size: 13px; line-height: 1.7; white-space: pre-wrap;
      scroll-behavior: smooth;
    }
    .ph { color: #7b849e; font-style: italic; }
    .seg-new {
      background: rgba(79,142,247,.15);
      animation: fade 2.5s ease forwards;
    }
    @keyframes fade { to { background: transparent; } }

    /* Notes */
    #notes-area {
      background: #0f1117; border: 1px solid #2e3347;
      border-radius: 6px; max-height: 200px;
      overflow-y: auto; padding: 10px;
      font-size: 12px; line-height: 1.7;
    }
    #notes-area h2 { font-size: 12px; color: #4f8ef7; margin: 10px 0 4px; }
    #notes-area h3 { font-size: 12px; margin: 8px 0 4px; }
    #notes-area ul  { padding-left: 16px; }
    #notes-area li  { margin-bottom: 2px; }
    #notes-area hr  { border: none; border-top: 1px solid #2e3347; margin: 8px 0; }

    /* Footer */
    .footer-row {
      display: flex; justify-content: space-between;
      font-size: 11px; color: #7b849e;
    }

    .toast {
      background: #242838; border: 1px solid #3ecf8e;
      border-radius: 6px; color: #3ecf8e;
      font-size: 12px; font-weight: 600;
      padding: 6px 12px; text-align: center;
      animation: fadein .3s ease;
    }
    @keyframes fadein { from { opacity:0 } }
  `;

  const SIDEBAR_HTML = `
    <style>${SIDEBAR_CSS}</style>
    <div id="panel">
      <div class="hdr" id="drag-handle">
        <span class="hdr-title">🎙️ Toplantı Asistanı</span>
        <div class="hdr-btns">
          <button class="hdr-btn" id="btn-min" title="Küçült">−</button>
          <button class="hdr-btn" id="btn-close" title="Kapat">×</button>
        </div>
      </div>

      <div id="body">
        <div class="ctrl-row">
          <button class="btn-rec" id="btn-rec">
            <span class="rec-dot"></span>Başlat
          </button>
          <button class="btn-sm" id="btn-notes" disabled>✦ Notlar</button>
          <button class="btn-sm" id="btn-save"  disabled>💾 Kaydet</button>
        </div>

        <div class="status" id="status">Bağlanılıyor...</div>

        <div id="transcript"><span class="ph">Kaydı başlatınca transkript burada görünür...</span></div>

        <div id="notes-section" style="display:none">
          <div id="notes-area"></div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn-sm" id="btn-export-md">⬇ .md</button>
            <button class="btn-sm" id="btn-export-txt">⬇ .txt</button>
          </div>
        </div>

        <div class="footer-row">
          <span id="word-count">0 kelime</span>
          <span id="timer">00:00</span>
        </div>

        <div id="toast-area"></div>
      </div>
    </div>
  `;

  // ── Build sidebar ──────────────────────────────────────────────────────────

  function buildSidebar(wsUrl, model) {
    const host = document.createElement('div');
    host.id = 'tma-root';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = SIDEBAR_HTML;

    initSidebar(shadow, wsUrl, model);
  }

  // ── Sidebar logic ──────────────────────────────────────────────────────────

  function initSidebar(shadow, wsUrl, model) {
    const panel      = shadow.getElementById('panel');
    const btnRec     = shadow.getElementById('btn-rec');
    const btnNotes   = shadow.getElementById('btn-notes');
    const btnSaveEl  = shadow.getElementById('btn-save');
    const btnMin     = shadow.getElementById('btn-min');
    const btnClose   = shadow.getElementById('btn-close');
    const btnExpMd   = shadow.getElementById('btn-export-md');
    const btnExpTxt  = shadow.getElementById('btn-export-txt');
    const statusEl   = shadow.getElementById('status');
    const transcript = shadow.getElementById('transcript');
    const notesSection = shadow.getElementById('notes-section');
    const notesArea  = shadow.getElementById('notes-area');
    const wordCount  = shadow.getElementById('word-count');
    const timerEl    = shadow.getElementById('timer');
    const toastArea  = shadow.getElementById('toast-area');

    let ws           = null;
    let mediaRecorder = null;
    let stream       = null;
    let recording    = false;
    let timerSecs    = 0;
    let timerInterval = null;
    let fullText     = '';
    let notesMarkdown = '';
    let webmHeader   = null;   // first chunk = WebM container header bytes

    // ── WebSocket ────────────────────────────────────────────────────────────

    function connect(onReady) {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        const title = document.title.replace(' - Google Meet', '').trim();
        ws.send(JSON.stringify({ type: 'init', model, title }));
        if (onReady) onReady();
      };

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') handleMsg(JSON.parse(e.data));
      };

      ws.onerror = () => setStatus('Sunucuya bağlanılamadı', 'error');
      ws.onclose = () => { if (recording) stopRec(); };
    }

    function handleMsg(msg) {
      switch (msg.type) {
        case 'status':
          setStatus(msg.message, msg.state);
          break;
        case 'transcript':
          appendText(msg.delta);
          fullText = msg.full;
          btnNotes.disabled = false;
          btnSaveEl.disabled = false;
          break;
        case 'notes':
          notesMarkdown = msg.text;
          notesArea.innerHTML = renderMd(msg.text);
          notesSection.style.display = 'block';
          break;
        case 'saved':
          showToast('✓ Kaydedildi');
          break;
        case 'error':
          setStatus(msg.message, 'error');
          break;
      }
    }

    // ── Recording ────────────────────────────────────────────────────────────

    async function startRec() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        setStatus('Mikrofon hatası: ' + err.message, 'error');
        return;
      }

      connect(() => {
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
          .find(m => MediaRecorder.isTypeSupported(m)) || '';

        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        mediaRecorder.ondataavailable = async (e) => {
          if (e.data.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
          const buf = await e.data.arrayBuffer();
          if (webmHeader === null) {
            // First chunk: contains EBML/codec init headers + initial audio.
            // Store it so all later chunks can be prefixed before sending.
            webmHeader = buf;
            ws.send(buf);
          } else {
            // Subsequent chunks: prepend header so the server gets a valid
            // self-contained WebM file for each Whisper transcription call.
            const combined = new Uint8Array(webmHeader.byteLength + buf.byteLength);
            combined.set(new Uint8Array(webmHeader), 0);
            combined.set(new Uint8Array(buf), webmHeader.byteLength);
            ws.send(combined.buffer);
          }
        };
        mediaRecorder.start(5000);
      });

      webmHeader = null;  // reset for each new recording session
      recording = true;
      btnRec.classList.add('active');
      btnRec.innerHTML = '<span class="rec-dot"></span>Durdur';
      clearTranscript();
      startTimer();
    }

    function stopRec() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }));
        ws.close();
      }
      ws = null;
      recording = false;
      btnRec.classList.remove('active');
      btnRec.innerHTML = '<span class="rec-dot"></span>Başlat';
      stopTimer();
      setStatus('Durduruldu', 'idle');
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    function setStatus(msg, state) {
      statusEl.textContent = msg;
      statusEl.className = 'status ' + (state || 'idle');
    }

    function clearTranscript() {
      transcript.innerHTML = '';
      fullText = '';
      wordCount.textContent = '0 kelime';
    }

    function appendText(delta) {
      const ph = transcript.querySelector('.ph');
      if (ph) ph.remove();
      const span = document.createElement('span');
      span.className = 'seg-new';
      span.textContent = delta + ' ';
      transcript.appendChild(span);
      transcript.scrollTop = transcript.scrollHeight;
      const words = transcript.textContent.trim().split(/\s+/).filter(Boolean).length;
      wordCount.textContent = words + ' kelime';
    }

    function showToast(msg) {
      toastArea.innerHTML = `<div class="toast">${msg}</div>`;
      setTimeout(() => { toastArea.innerHTML = ''; }, 3000);
    }

    function startTimer() {
      timerSecs = 0;
      timerInterval = setInterval(() => {
        timerSecs++;
        const m = String(Math.floor(timerSecs / 60)).padStart(2, '0');
        const s = String(timerSecs % 60).padStart(2, '0');
        timerEl.textContent = m + ':' + s;
      }, 1000);
    }

    function stopTimer() { clearInterval(timerInterval); }

    function downloadText(content, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // ── Minimal Markdown renderer ─────────────────────────────────────────────

    function renderMd(text) {
      return text
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm,'<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
        .replace(/^---$/gm,'<hr/>')
        .replace(/^[*-] (.+)$/gm,'<li>$1</li>')
        .replace(/((?:<li>.*\n?)+)/g,'<ul>$1</ul>')
        .replace(/\n\n/g,'</p><p>');
    }

    // ── Draggable panel ────────────────────────────────────────────────────────

    const dragHandle = shadow.getElementById('drag-handle');
    let dragOffsetX = 0, dragOffsetY = 0, dragging = false;

    dragHandle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;
      panel.style.left  = x + 'px';
      panel.style.top   = y + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // ── Events ────────────────────────────────────────────────────────────────

    btnRec.addEventListener('click', () => recording ? stopRec() : startRec());

    btnNotes.addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'notes' }));
        setStatus('Notlar oluşturuluyor...', 'generating');
      }
    });

    btnSaveEl.addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'save' }));
      } else {
        showToast('Kayıt için önce durdur, sonra kaydet.');
      }
    });

    btnMin.addEventListener('click', () => panel.classList.toggle('minimized'));
    btnClose.addEventListener('click', () => {
      if (recording) stopRec();
      document.getElementById('tma-root').remove();
    });

    btnExpMd.addEventListener('click', () => {
      const title = (document.title.replace(' - Google Meet', '').trim() || 'toplanti')
        .replace(/\s+/g, '_');
      const content = `# ${title}\n\n${notesMarkdown}\n\n---\n\n## Transkript\n\n${fullText}`;
      downloadText(content, title + '.md');
    });

    btnExpTxt.addEventListener('click', () => {
      const title = (document.title.replace(' - Google Meet', '').trim() || 'toplanti')
        .replace(/\s+/g, '_');
      downloadText(fullText, title + '.txt');
    });

    // Initial connection ping to check server is alive
    setStatus('Sunucu kontrol ediliyor...', 'loading');
    const testWs = new WebSocket(wsUrl);
    testWs.onopen  = () => { setStatus('Hazır', 'ready'); testWs.close(); };
    testWs.onerror = () => setStatus('Sunucu bulunamadı — python cli.py web çalışıyor mu?', 'error');
  }

})();
