"""
Flask web application for the Turkish meeting transcription tool.
Supports both file-upload (async job) and live WebSocket transcription.
"""
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from flask_sock import Sock

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import transcriber, notes as notes_module, storage
from web.live_session import LiveSession


# Job store for file-upload transcription — keyed by job_id
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB
    sock = Sock(app)

    # ------------------------------------------------------------------
    # Static pages
    # ------------------------------------------------------------------

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/live")
    def live():
        return render_template("live.html")

    # ------------------------------------------------------------------
    # Meetings REST API
    # ------------------------------------------------------------------

    @app.route("/api/meetings")
    def api_list_meetings():
        meetings = storage.list_meetings()
        return jsonify(meetings)

    @app.route("/api/meetings/<path:meeting_path>")
    def api_get_meeting(meeting_path: str):
        try:
            meeting = storage.load_meeting("/" + meeting_path)
            return jsonify(meeting)
        except (FileNotFoundError, OSError) as e:
            return jsonify({"error": str(e)}), 404

    @app.route("/api/meetings/<path:meeting_path>/export")
    def api_export_meeting(meeting_path: str):
        fmt = request.args.get("format", "md")
        try:
            meeting = storage.load_meeting("/" + meeting_path)
        except (FileNotFoundError, OSError) as e:
            return jsonify({"error": str(e)}), 404

        tmp = tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".md" if fmt == "md" else ".txt",
        )
        tmp.close()

        if fmt == "md":
            from app.exporter import export_markdown
            export_markdown(meeting, tmp.name)
            mimetype = "text/markdown"
        else:
            from app.exporter import export_txt
            export_txt(meeting, tmp.name)
            mimetype = "text/plain"

        title_slug = meeting.get("title", "toplanti").replace(" ", "_")
        return send_file(
            tmp.name,
            mimetype=mimetype,
            as_attachment=True,
            download_name=f"{title_slug}.{fmt}",
        )

    # ------------------------------------------------------------------
    # File-upload transcription (async job)
    # ------------------------------------------------------------------

    @app.route("/api/transcribe", methods=["POST"])
    def api_transcribe():
        if "audio" not in request.files:
            return jsonify({"error": "Ses dosyası gerekli ('audio' alanı)"}), 400

        audio_file = request.files["audio"]
        title = request.form.get("title", "").strip()
        model_name = request.form.get("model", "base")
        gen_notes = request.form.get("generate_notes", "true").lower() == "true"

        suffix = Path(audio_file.filename or "audio.wav").suffix or ".wav"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        audio_file.save(tmp.name)
        tmp.close()

        if not title:
            title = Path(audio_file.filename or "Toplantı").stem.replace("_", " ").replace("-", " ").title()

        import uuid
        job_id = str(uuid.uuid4())
        with _jobs_lock:
            _jobs[job_id] = {"status": "running", "progress": "Başlatılıyor..."}

        def run():
            try:
                with _jobs_lock:
                    _jobs[job_id]["progress"] = "Transkripsiyon yapılıyor..."

                model = transcriber.load_model(model_name)
                result = transcriber.transcribe(tmp.name, model=model)

                meeting_notes = ""
                if gen_notes:
                    with _jobs_lock:
                        _jobs[job_id]["progress"] = "Notlar oluşturuluyor..."
                    try:
                        meeting_notes = notes_module.generate_notes(result["text"], meeting_title=title)
                    except RuntimeError:
                        meeting_notes = ""

                meeting_dir = storage.save_meeting(
                    title=title,
                    transcript=result["text"],
                    segments=result["segments"],
                    notes=meeting_notes,
                    audio_path=tmp.name,
                )

                with _jobs_lock:
                    _jobs[job_id] = {
                        "status": "done",
                        "meeting_path": str(meeting_dir),
                        "title": title,
                        "transcript": result["text"],
                        "notes": meeting_notes,
                    }
            except Exception as exc:
                with _jobs_lock:
                    _jobs[job_id] = {"status": "error", "error": str(exc)}
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

        threading.Thread(target=run, daemon=True).start()
        return jsonify({"job_id": job_id}), 202

    @app.route("/api/jobs/<job_id>")
    def api_job_status(job_id: str):
        with _jobs_lock:
            job = _jobs.get(job_id)
        if job is None:
            return jsonify({"error": "İş bulunamadı"}), 404
        return jsonify(job)

    # ------------------------------------------------------------------
    # Live transcription WebSocket
    # ------------------------------------------------------------------

    @sock.route("/ws/live")
    def ws_live(ws):
        """
        WebSocket endpoint for real-time transcription.

        Protocol (client → server):
          TEXT  {"type": "init",  "model": "base", "title": "..."}
          BINARY  raw audio bytes (WebM/Opus, one chunk per message)
          TEXT  {"type": "notes"}   — generate notes from accumulated transcript
          TEXT  {"type": "save"}    — persist meeting to disk
          TEXT  {"type": "stop"}    — end session

        Protocol (server → client):
          TEXT  {"type": "transcript", "delta": "...", "full": "..."}
          TEXT  {"type": "notes",      "text": "..."}
          TEXT  {"type": "saved",      "path": "..."}
          TEXT  {"type": "status",     "message": "...", "state": "..."}
          TEXT  {"type": "error",      "message": "..."}
        """
        session: LiveSession | None = None
        try:
            while True:
                data = ws.receive()
                if data is None:
                    break

                if isinstance(data, str):
                    msg = json.loads(data)
                    kind = msg.get("type")

                    if kind == "init":
                        if session:
                            session.stop()
                        session = LiveSession(
                            send_fn=ws.send,
                            model_name=msg.get("model", "base"),
                        )
                        session.start(title=msg.get("title", ""))

                    elif kind == "notes" and session:
                        session.request_notes()

                    elif kind == "save" and session:
                        session.request_save()

                    elif kind == "stop":
                        if session:
                            session.stop()
                        break

                elif isinstance(data, bytes) and session:
                    session.add_audio(data)

        except Exception:
            pass
        finally:
            if session:
                session.stop()

    return app
