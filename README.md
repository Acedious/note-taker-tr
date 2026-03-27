# Türkçe Toplantı Asistanı

Toplantı ses kayıtlarını Türkçe olarak transkribe eden ve yapılandırılmış notlar oluşturan araç.

## Özellikler

- **Transkripsiyon** — OpenAI Whisper ile Türkçe ses dosyalarını metne dönüştürür
- **Akıllı Notlar** — Claude API ile özet, ana konular, kararlar ve aksiyon maddeleri oluşturur
- **Zaman Damgalı Transkript** — Her konuşma parçasına `[MM:SS - MM:SS]` zaman damgası ekler
- **Dışa Aktarma** — Markdown veya TXT formatında dışa aktarma
- **Web Arayüzü** — Tarayıcı üzerinden kolay kullanım
- **CLI** — Terminal üzerinden tam kontrol

## Kurulum

```bash
# 1. Bağımlılıkları yükle
pip install -r requirements.txt

# 2. ffmpeg yükle (Whisper için gerekli)
# Ubuntu/Debian:
sudo apt install ffmpeg
# macOS:
brew install ffmpeg

# 3. Ortam değişkenlerini ayarla
cp .env.example .env
# .env dosyasını düzenleyip ANTHROPIC_API_KEY değerini gir
```

## Kullanım

### CLI

```bash
# Ses dosyasını transkribe et ve notlar oluştur
python cli.py transcribe toplanti.mp3

# Başlık belirt, büyük model kullan
python cli.py transcribe toplanti.mp3 --title "Haftalık Ekip Toplantısı" --model medium

# Sadece transkripsiyon (not oluşturma)
python cli.py transcribe toplanti.mp3 --no-notes

# Markdown dosyasına dışa aktar
python cli.py transcribe toplanti.mp3 --output notlar.md

# Kaydedilen toplantıları listele
python cli.py list

# Bir toplantının notlarını göster
python cli.py show meetings/2024-01-15_14-30_haftalik-ekip-toplantisi

# Dışa aktar
python cli.py export meetings/2024-01-15_14-30_... notlar.md --format md
```

### Web Arayüzü

```bash
python cli.py web
# Tarayıcıda http://127.0.0.1:5000 adresini aç
```

## Desteklenen Ses Formatları

MP3, WAV, M4A, OGG, FLAC, WEBM, MP4

## Whisper Model Seçimi

| Model  | Boyut | Hız    | Doğruluk |
|--------|-------|--------|----------|
| tiny   | 75 MB | En hızlı | Düşük   |
| base   | 142 MB| Hızlı  | İyi      |
| small  | 466 MB| Orta   | Yüksek   |
| medium | 1.5 GB| Yavaş  | Çok Yüksek |
| large  | 2.9 GB| En yavaş | En Yüksek |

Günlük kullanım için `base` önerilir. Önemli toplantılar için `medium` veya `large` kullanın.

## Toplantı Depolama

Toplantılar `meetings/` dizinine kaydedilir:

```
meetings/
└── 2024-01-15_14-30_haftalik-ekip-toplantisi/
    ├── meta.json              # Metadata (başlık, tarih, süre...)
    ├── transcript.txt         # Düz transkript
    ├── transcript_timed.txt   # Zaman damgalı transkript
    └── notes.md               # Yapay zeka notları
```
