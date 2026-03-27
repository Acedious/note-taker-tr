"""
Meeting note generation using Claude API.
Produces Turkish-language summaries, action items, and key points.
"""
import anthropic
from config import ANTHROPIC_API_KEY

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


_SYSTEM_PROMPT = """Sen bir profesyonel toplantı asistanısın. Türkçe toplantı transkriptlerini analiz ederek
yapılandırılmış toplantı notları oluşturursun. Yanıtlarını her zaman Türkçe olarak ver.

Toplantı notlarını aşağıdaki formatta oluştur:

## Toplantı Özeti
[2-3 cümlelik kısa özet]

## Ana Konular
[Toplantıda ele alınan başlıca konuların maddeli listesi]

## Önemli Kararlar
[Toplantıda alınan kararlar]

## Aksiyon Maddeleri
[Yapılacak işler - mümkünse sorumlu kişi ve son tarihi belirt]
- [ ] Görev | Sorumlu: ... | Son Tarih: ...

## Önemli Notlar
[Dikkat çekici diğer bilgiler, riskler veya takip edilmesi gereken konular]"""


def generate_notes(transcript: str, meeting_title: str = "") -> str:
    """
    Generate structured meeting notes from a Turkish transcript.

    Args:
        transcript: The full meeting transcript text.
        meeting_title: Optional title to provide context.

    Returns:
        Markdown-formatted meeting notes in Turkish.
    """
    if not ANTHROPIC_API_KEY:
        raise RuntimeError(
            "ANTHROPIC_API_KEY environment variable is not set. "
            "Please add it to your .env file."
        )

    title_context = f'Toplantı başlığı: "{meeting_title}"\n\n' if meeting_title else ""
    user_message = f"{title_context}Aşağıdaki toplantı transkriptini analiz et ve yapılandırılmış notlar oluştur:\n\n{transcript}"

    client = _get_client()
    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    return message.content[0].text


def generate_summary(transcript: str) -> str:
    """Generate a brief one-paragraph summary of the meeting."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable is not set.")

    client = _get_client()
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": (
                    "Aşağıdaki Türkçe toplantı transkriptini 2-3 cümleyle özetle. "
                    "Yanıtını Türkçe ver.\n\n" + transcript
                ),
            }
        ],
    )
    return message.content[0].text
