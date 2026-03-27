#!/usr/bin/env python3
"""
Türkçe Toplantı Transkripsiyon ve Not Alma Aracı — CLI
"""
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

# Ensure the project root is on the path so `config` and `app` are importable
sys.path.insert(0, str(Path(__file__).parent))

from app import transcriber, notes as notes_module, storage, exporter

console = Console()


# ---------------------------------------------------------------------------
# Main group
# ---------------------------------------------------------------------------

@click.group()
def cli():
    """Türkçe toplantı transkripsiyon ve not alma aracı."""


# ---------------------------------------------------------------------------
# transcribe — full pipeline (transcribe → notes → save)
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("audio_file", type=click.Path(exists=True))
@click.option("--title", "-t", default="", help="Toplantı başlığı")
@click.option("--model", "-m", default="base",
              type=click.Choice(["tiny", "base", "small", "medium", "large"]),
              help="Whisper model boyutu (varsayılan: base)")
@click.option("--no-notes", is_flag=True, default=False,
              help="Yapay zeka notları oluşturma (sadece transkripsiyon)")
@click.option("--save/--no-save", default=True, help="Toplantıyı kaydet (varsayılan: kaydet)")
@click.option("--output", "-o", default="", help="Notları bu dosyaya dışa aktar (.md veya .txt)")
def transcribe(audio_file: str, title: str, model: str, no_notes: bool, save: bool, output: str):
    """Ses dosyasını transkribe et ve toplantı notları oluştur."""

    audio_path = Path(audio_file)
    if not title:
        title = audio_path.stem.replace("_", " ").replace("-", " ").title()

    console.print(Panel.fit(
        f"[bold cyan]Toplantı:[/] {title}\n[bold cyan]Dosya:[/] {audio_path.name}\n[bold cyan]Model:[/] {model}",
        title="[bold]Türkçe Toplantı Asistanı[/]",
        border_style="cyan",
    ))

    # 1. Transcription
    whisper_model = None
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), console=console) as p:
        p.add_task("Whisper modeli yükleniyor...", total=None)
        whisper_model = transcriber.load_model(model)

    result = None
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), console=console) as p:
        p.add_task(f"[yellow]{audio_path.name}[/yellow] transkribe ediliyor (Türkçe)...", total=None)
        result = transcriber.transcribe(str(audio_path), model=whisper_model)

    console.print(f"\n[green]✓[/green] Transkripsiyon tamamlandı — {len(result['text'].split())} kelime\n")

    timed = transcriber.format_transcript_with_timestamps(result["segments"])
    console.print(Panel(timed or result["text"], title="[bold]Transkript[/]", border_style="blue"))

    # 2. Notes generation
    meeting_notes = ""
    if not no_notes:
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), console=console) as p:
            p.add_task("Claude ile toplantı notları oluşturuluyor...", total=None)
            try:
                meeting_notes = notes_module.generate_notes(result["text"], meeting_title=title)
            except RuntimeError as e:
                console.print(f"[yellow]⚠[/yellow]  {e}")
                meeting_notes = ""

        if meeting_notes:
            console.print("\n")
            console.print(Markdown(meeting_notes))

    # 3. Save
    meeting_dir = None
    if save:
        meeting_dir = storage.save_meeting(
            title=title,
            transcript=result["text"],
            segments=result["segments"],
            notes=meeting_notes,
            audio_path=str(audio_path.resolve()),
        )
        console.print(f"\n[green]✓[/green] Toplantı kaydedildi: [dim]{meeting_dir}[/dim]")

    # 4. Export
    if output and meeting_dir:
        meeting_data = storage.load_meeting(str(meeting_dir))
        out_path = Path(output)
        if out_path.suffix.lower() == ".md":
            exporter.export_markdown(meeting_data, output)
        else:
            exporter.export_txt(meeting_data, output)
        console.print(f"[green]✓[/green] Dışa aktarıldı: [dim]{output}[/dim]")


# ---------------------------------------------------------------------------
# list — show saved meetings
# ---------------------------------------------------------------------------

@cli.command("list")
def list_meetings():
    """Kaydedilen toplantıları listele."""
    meetings = storage.list_meetings()
    if not meetings:
        console.print("[yellow]Henüz kaydedilmiş toplantı yok.[/yellow]")
        return

    table = Table(title="Kaydedilen Toplantılar", border_style="cyan")
    table.add_column("#", style="dim", width=4)
    table.add_column("Başlık", style="bold")
    table.add_column("Tarih")
    table.add_column("Süre")
    table.add_column("Kelime")
    table.add_column("Yol", style="dim")

    for i, m in enumerate(meetings, 1):
        duration = _fmt_duration(m.get("duration_seconds", 0))
        words = str(m.get("word_count", "—"))
        date = m.get("created_at", "")[:16].replace("T", " ")
        table.add_row(str(i), m.get("title", "—"), date, duration, words, m.get("path", ""))

    console.print(table)


# ---------------------------------------------------------------------------
# show — display a saved meeting
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("meeting_path", type=click.Path(exists=True))
@click.option("--transcript", "-t", is_flag=True, help="Transkripti de göster")
def show(meeting_path: str, transcript: bool):
    """Kaydedilmiş bir toplantının notlarını göster."""
    meeting = storage.load_meeting(meeting_path)
    console.print(Markdown(meeting["notes"]))
    if transcript:
        console.print("\n")
        console.print(Panel(
            meeting.get("transcript_timed", meeting.get("transcript", "")),
            title="[bold]Transkript[/]",
            border_style="blue",
        ))


# ---------------------------------------------------------------------------
# export — export a saved meeting
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("meeting_path", type=click.Path(exists=True))
@click.argument("output_file")
@click.option("--format", "fmt", default="md", type=click.Choice(["md", "txt"]),
              help="Çıktı formatı: md (Markdown) veya txt")
@click.option("--transcript-only", is_flag=True, help="Sadece transkripti dışa aktar")
def export(meeting_path: str, output_file: str, fmt: str, transcript_only: bool):
    """Toplantıyı dosyaya dışa aktar."""
    meeting = storage.load_meeting(meeting_path)
    out = Path(output_file)

    if transcript_only:
        exporter.export_transcript(meeting, str(out))
    elif fmt == "md":
        exporter.export_markdown(meeting, str(out))
    else:
        exporter.export_txt(meeting, str(out))

    console.print(f"[green]✓[/green] Dışa aktarıldı: [dim]{out.resolve()}[/dim]")


# ---------------------------------------------------------------------------
# web — launch the web UI
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--host", default="127.0.0.1", help="Sunucu adresi")
@click.option("--port", default=5000, help="Port numarası")
@click.option("--debug", is_flag=True)
def web(host: str, port: int, debug: bool):
    """Web arayüzünü başlat."""
    from web.app import create_app
    app = create_app()
    console.print(Panel.fit(
        f"[bold green]Web arayüzü başlatıldı[/]\nhttp://{host}:{port}",
        border_style="green",
    ))
    app.run(host=host, port=port, debug=debug)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_duration(seconds: float) -> str:
    if not seconds:
        return "—"
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}d {s:02d}s"


if __name__ == "__main__":
    cli()
