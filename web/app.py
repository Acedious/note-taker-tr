"""
Flask web application for the Turkish meeting transcription tool.
"""
import os
import sys
import tempfile
import threading
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import transcriber, notes as notes_module, storage


# Job store — keyed by job_id
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    @app.route("/")
    def index():
        return render_template("index.html")

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

    @app.route("/api/transcribe", methods=["POST"])
    def api_transcribe():
        """
        Accepts a multipart upload with:
          - audio: the audio file
          - title: meeting title (optional)
          - model: whisper model name (optional, default base)
          - generate_notes: "true"/"false" (optional, default true)
        """
        if "audio" not in request.files:
            return jsonify({"error": "Ses dosyası gerekli ('audio' alanı)"}), 400

        audio_file = request.files["audio"]
        title = request.form.get("title", "").strip()
        model_name = request.form.get("model", "base")
        gen_notes = request.form.get("generate_notes", "true").lower() == "true"

        # Save upload to a temp file
        suffix = Path(audio_file.filename or "audio.wav").suffix or ".wav"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        audio_file.save(tmp.name)
        tmp.close()

        if not title:
            title = Path(audio_file.filename or "Toplantı").stem.replace("_", " ").replace("-", " ").title()

        # Run in background thread so the HTTP request can return a job_id
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

    return app
