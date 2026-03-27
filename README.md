# Türkçe Toplantı Asistanı

Toplantıları gerçek zamanlı olarak Türkçe transkribe eden ve yapılandırılmış notlar oluşturan araç.
Google Meet entegrasyonu için Chrome eklentisi içerir.

## Özellikler

- **Canlı Transkripsiyon** — Mikrofonu dinler, 5 saniyelik parçaları Whisper ile Türkçe olarak metne çevirir
- **Google Meet Entegrasyonu** — Chrome eklentisi, Meet toplantısı açıkken sağ tarafa sidebar ekler
- **Akıllı Notlar** — Claude API ile özet, ana konular, kararlar ve aksiyon maddeleri üretir
- **Web Arayüzü** — Tarayıcı üzerinden bağımsız canlı transkripsiyon sayfası (`/live`)
- **Dosya Yükleme** — Önceden kaydedilmiş ses dosyalarını da transkribe edebilir
- **Dışa Aktarma** — Markdown veya TXT formatında anlık indirme

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

### 1. Sunucuyu Başlat

```bash
python cli.py web
# → http://127.0.0.1:5000
```

### 2a. Web Arayüzü — Canlı Transkripsiyon

`http://localhost:5000/live` adresini açın:

1. Toplantı başlığı ve model seçin
2. **Kaydı Başlat** butonuna basın → tarayıcı mikrofon izni ister
3. Konuşma metne dönüşür (her ~5 saniyede bir güncellenir)
4. **✦ Notlar Oluştur** → Claude ile yapılandırılmış notlar
5. **💾 Kaydet** → sunucuya kaydeder
6. **⬇ Markdown / TXT** → anında indirme

### 2b. Chrome Eklentisi — Google Meet

1. Chrome'da `chrome://extensions` sayfasını açın
2. **"Geliştirici modu"**nu etkinleştirin
3. **"Paketlenmemişi yükle"** → `extension/` klasörünü seçin
4. Google Meet toplantısına katılın
5. Sağ üstte **🎙️ Toplantı Asistanı** sidebar'ı otomatik çıkar
6. **Başlat** → mikrofon izni verin ve kayıt başlar

> **Not:** Sidebar, Google Meet'teki kendi ses düzenini (hoparlörler dahil) değil,
> yalnızca **mikrofonu** dinler. Hem siz hem karşı taraf konuşurken mikrofondan
> geçen sesi alır.

### 2c. CLI — Dosya Transkripsiyon

```bash
# Ses dosyasından transkripsiyon + notlar
python cli.py transcribe toplanti.mp3 --title "Ekip Toplantısı"

# Kaydedilen toplantıları listele
python cli.py list

# Bir toplantıyı göster
python cli.py show meetings/2024-01-15_14-30_ekip-toplantisi

# Dışa aktar
python cli.py export meetings/... notlar.md --format md
```

## WebSocket Protokolü

Canlı transkripsiyon, `ws://localhost:5000/ws/live` üzerinden çalışır.

| Yön | Format | İçerik |
|-----|--------|--------|
| İstemci → Sunucu | JSON | `{"type":"init","model":"base","title":"..."}` |
| İstemci → Sunucu | Binary | Ham ses verisi (WebM/Opus, 5s parça) |
| İstemci → Sunucu | JSON | `{"type":"notes"}` — not oluştur |
| İstemci → Sunucu | JSON | `{"type":"save"}` — diske kaydet |
| İstemci → Sunucu | JSON | `{"type":"stop"}` — oturumu kapat |
| Sunucu → İstemci | JSON | `{"type":"transcript","delta":"...","full":"..."}` |
| Sunucu → İstemci | JSON | `{"type":"notes","text":"..."}` |
| Sunucu → İstemci | JSON | `{"type":"saved","path":"..."}` |
| Sunucu → İstemci | JSON | `{"type":"status","message":"...","state":"..."}` |

## Desteklenen Ses Formatları (Dosya Yükleme)

MP3, WAV, M4A, OGG, FLAC, WEBM, MP4

## Whisper Model Seçimi

| Model  | Boyut  | Hız       | Doğruluk   |
|--------|--------|-----------|------------|
| tiny   | 75 MB  | En hızlı  | Düşük      |
| base   | 142 MB | Hızlı     | İyi        |
| small  | 466 MB | Orta      | Yüksek     |
| medium | 1.5 GB | Yavaş     | Çok yüksek |
| large  | 2.9 GB | En yavaş  | En yüksek  |

Günlük kullanım için `base` önerilir.

## Toplantı Depolama

```
meetings/
└── 2024-01-15_14-30_ekip-toplantisi/
    ├── meta.json              # Metadata
    ├── transcript.txt         # Düz transkript
    ├── transcript_timed.txt   # Zaman damgalı transkript
    └── notes.md               # Claude notları
```

## Mimari

```
browser / extension
  │  WebSocket (binary audio + JSON control)
  ▼
web/app.py  ──── Flask + flask-sock
  │
  ├── /live          → web/templates/live.html
  ├── /ws/live       → web/live_session.py → LiveSession
  │                        │
  │                        ├── Whisper (app/transcriber.py)
  │                        └── Claude  (app/notes.py)
  │
  └── /api/...       → REST (dosya yükleme, toplantı listeleme)
```
