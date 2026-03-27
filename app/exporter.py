"""
Export meeting notes to various formats.
"""
from pathlib import Path


def export_markdown(meeting: dict, output_path: str) -> Path:
    """Export notes as a standalone Markdown file."""
    out = Path(output_path)
    out.write_text(meeting["notes"], encoding="utf-8")
    return out


def export_txt(meeting: dict, output_path: str, include_transcript: bool = True) -> Path:
    """Export notes and optionally the transcript as plain text."""
    out = Path(output_path)
    lines = [meeting["notes"]]
    if include_transcript:
        lines += [
            "\n\n" + "=" * 60,
            "ZAMAN DAMGALI TRANSKRİPT",
            "=" * 60,
            meeting.get("transcript_timed", meeting.get("transcript", "")),
        ]
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def export_transcript(meeting: dict, output_path: str, timed: bool = True) -> Path:
    """Export just the transcript."""
    out = Path(output_path)
    content = meeting.get("transcript_timed" if timed else "transcript", "")
    out.write_text(content, encoding="utf-8")
    return out
