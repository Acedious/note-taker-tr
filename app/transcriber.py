"""
Audio transcription using OpenAI Whisper with Turkish language support.
"""
import os
import whisper
from pathlib import Path


SUPPORTED_FORMATS = {".mp3", ".mp4", ".wav", ".m4a", ".ogg", ".flac", ".webm"}


def load_model(model_name: str = "base") -> whisper.Whisper:
    """Load a Whisper model. Models: tiny, base, small, medium, large."""
    return whisper.load_model(model_name)


def transcribe(audio_path: str, model: whisper.Whisper | None = None, model_name: str = "base") -> dict:
    """
    Transcribe an audio file in Turkish.

    Returns a dict with:
      - text: full transcript string
      - segments: list of timed segments [{start, end, text}, ...]
      - language: detected language code
    """
    path = Path(audio_path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise ValueError(
            f"Unsupported format '{suffix}'. Supported: {', '.join(SUPPORTED_FORMATS)}"
        )

    if model is None:
        model = load_model(model_name)

    result = model.transcribe(
        str(path),
        language="tr",
        task="transcribe",
        verbose=False,
    )

    return {
        "text": result["text"].strip(),
        "segments": [
            {
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
                "text": seg["text"].strip(),
            }
            for seg in result.get("segments", [])
        ],
        "language": result.get("language", "tr"),
    }


def format_transcript_with_timestamps(segments: list[dict]) -> str:
    """Return a readable timestamped transcript string."""
    lines = []
    for seg in segments:
        start = _format_time(seg["start"])
        end = _format_time(seg["end"])
        lines.append(f"[{start} - {end}]  {seg['text']}")
    return "\n".join(lines)


def _format_time(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"
