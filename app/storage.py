"""
Meeting storage — saves transcripts and notes as JSON + Markdown files.
"""
import json
import re
from datetime import datetime
from pathlib import Path

from config import MEETINGS_DIR


def _meetings_dir() -> Path:
    d = Path(MEETINGS_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slug(title: str) -> str:
    """Turn a title into a safe directory name."""
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    slug = re.sub(r"[\s_-]+", "-", slug).strip("-")
    return slug or "meeting"


def save_meeting(
    title: str,
    transcript: str,
    segments: list[dict],
    notes: str,
    audio_path: str = "",
) -> Path:
    """
    Persist a meeting to disk.

    Creates:
      meetings/<date>-<slug>/
        ├── meta.json         — metadata
        ├── transcript.txt    — plain transcript
        ├── transcript_timed.txt — timestamped transcript
        └── notes.md          — generated notes
    """
    timestamp = datetime.now()
    date_str = timestamp.strftime("%Y-%m-%d_%H-%M")
    slug = _slug(title)
    meeting_dir = _meetings_dir() / f"{date_str}_{slug}"
    meeting_dir.mkdir(parents=True, exist_ok=True)

    # Timestamped transcript
    timed_lines = []
    for seg in segments:
        start = _fmt(seg["start"])
        end = _fmt(seg["end"])
        timed_lines.append(f"[{start} - {end}]  {seg['text']}")
    timed_transcript = "\n".join(timed_lines)

    meta = {
        "title": title,
        "created_at": timestamp.isoformat(),
        "audio_file": str(audio_path),
        "word_count": len(transcript.split()),
        "duration_seconds": segments[-1]["end"] if segments else 0,
    }

    (meeting_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (meeting_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    (meeting_dir / "transcript_timed.txt").write_text(timed_transcript, encoding="utf-8")

    notes_content = f"# {title}\n\n*Tarih: {timestamp.strftime('%d %B %Y, %H:%M')}*\n\n{notes}"
    (meeting_dir / "notes.md").write_text(notes_content, encoding="utf-8")

    return meeting_dir


def list_meetings() -> list[dict]:
    """Return metadata for all saved meetings, newest first."""
    meetings = []
    for meta_file in sorted(_meetings_dir().glob("*/meta.json"), reverse=True):
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
            data["path"] = str(meta_file.parent)
            meetings.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return meetings


def load_meeting(meeting_path: str) -> dict:
    """Load a saved meeting from its directory path."""
    d = Path(meeting_path)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    meta["transcript"] = (d / "transcript.txt").read_text(encoding="utf-8")
    meta["transcript_timed"] = (d / "transcript_timed.txt").read_text(encoding="utf-8")
    meta["notes"] = (d / "notes.md").read_text(encoding="utf-8")
    meta["path"] = str(d)
    return meta


def _fmt(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"
