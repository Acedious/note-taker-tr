"""
Live transcription session — one instance per WebSocket connection.
Buffers incoming audio chunks, transcribes with Whisper in a background
thread, and sends JSON results back through the provided send function.
"""
import json
import os
import queue
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

# ---------------------------------------------------------------------------
# Module-level Whisper model cache — loading once per model name
# ---------------------------------------------------------------------------
_model_cache: dict[str, object] = {}
_model_lock = threading.Lock()


def _get_model(model_name: str):
    import whisper
    with _model_lock:
        if model_name not in _model_cache:
            _model_cache[model_name] = whisper.load_model(model_name)
        return _model_cache[model_name]


# ---------------------------------------------------------------------------
# LiveSession
# ---------------------------------------------------------------------------

class LiveSession:
    """
    Manages a single live transcription session.

    Audio bytes are fed via add_audio(); results are sent back as JSON strings
    through the send_fn callable (thread-safe).
    """

    def __init__(self, send_fn: Callable[[str], None], model_name: str = "base"):
        self._send = send_fn
        self.model_name = model_name
        self._queue: queue.Queue = queue.Queue(maxsize=30)
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._running = False
        self.segments: list[str] = []
        self.title: str = ""
        self._started_at: datetime | None = None
        # WebM container fix: the first binary chunk contains the EBML/codec
        # headers required to decode all subsequent chunks. We prepend these
        # header bytes to every chunk before passing it to Whisper.
        self._webm_header: bytes | None = None

    # ------------------------------------------------------------------
    # Public API (called from the WebSocket thread)
    # ------------------------------------------------------------------

    def start(self, title: str = ""):
        self.title = title
        self._started_at = datetime.now()
        self._running = True
        self._thread.start()

    def add_audio(self, audio_bytes: bytes):
        if not self._running:
            return
        # First chunk is the WebM stream header — store it and also transcribe
        # it (it may already contain audio data). All later chunks are prepended
        # with this header before being written to a temp file so that Whisper
        # receives a valid, self-contained WebM file every time.
        if self._webm_header is None:
            self._webm_header = audio_bytes
        try:
            self._queue.put_nowait(("audio", audio_bytes))
        except queue.Full:
            pass  # drop chunk rather than block

    def request_notes(self):
        self._queue.put(("notes", None))

    def request_save(self):
        self._queue.put(("save", None))

    def stop(self):
        self._running = False
        self._queue.put(("stop", None))

    # ------------------------------------------------------------------
    # Worker thread
    # ------------------------------------------------------------------

    def _worker(self):
        self._status("Model yükleniyor...", "loading")
        model = _get_model(self.model_name)
        self._status("Hazır — kaydı başlatın", "ready")

        while True:
            try:
                kind, data = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue

            if kind == "stop":
                break
            elif kind == "audio":
                self._transcribe(data, model)
            elif kind == "notes":
                self._generate_notes()
            elif kind == "save":
                self._save()

    def _transcribe(self, audio_bytes: bytes, model):
        self._status("Transkribe ediliyor...", "transcribing")
        tmp_path = None
        try:
            # Prepend stored header bytes to every chunk except the very first
            # (the first chunk IS the header, so no prepend needed).
            data = audio_bytes
            if self._webm_header is not None and audio_bytes is not self._webm_header:
                data = self._webm_header + audio_bytes

            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(data)
                tmp_path = f.name

            result = model.transcribe(tmp_path, language="tr", task="transcribe")
            text = result["text"].strip()

            if text:
                self.segments.append(text)
                self._send_json({
                    "type": "transcript",
                    "delta": text,
                    "full": " ".join(self.segments),
                })
        except Exception as exc:
            self._error(f"Transkripsiyon hatası: {exc}")
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        self._status("Dinleniyor...", "recording")

    def _generate_notes(self):
        if not self.segments:
            self._status("Önce kayıt yapın.", "ready")
            return
        self._status("Notlar oluşturuluyor...", "generating")
        try:
            from app.notes import generate_notes
            notes = generate_notes(" ".join(self.segments), meeting_title=self.title)
            self._send_json({"type": "notes", "text": notes})
        except Exception as exc:
            self._error(f"Not oluşturma hatası: {exc}")
        self._status("Dinleniyor...", "recording")

    def _save(self):
        if not self.segments:
            self._error("Kaydedilecek transkript yok.")
            return
        try:
            from app import storage
            full_text = " ".join(self.segments)
            # Use a single fake segment so storage accepts the call
            meeting_dir = storage.save_meeting(
                title=self.title or "Canlı Toplantı",
                transcript=full_text,
                segments=[{"start": 0.0, "end": 0.0, "text": full_text}],
                notes="",
                audio_path="",
            )
            self._send_json({"type": "saved", "path": str(meeting_dir)})
        except Exception as exc:
            self._error(f"Kaydetme hatası: {exc}")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _send_json(self, data: dict):
        try:
            self._send(json.dumps(data, ensure_ascii=False))
        except Exception:
            pass

    def _status(self, message: str, state: str):
        self._send_json({"type": "status", "message": message, "state": state})

    def _error(self, message: str):
        self._send_json({"type": "error", "message": message})
