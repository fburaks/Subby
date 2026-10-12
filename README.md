# Subby – Abonelik Takibi

iPhone'da ana ekrana eklenip uygulama gibi çalışan (PWA) abonelik takip uygulaması. Türkiye'de yaygın kullanılan abonelikleri tanır.

## Özellikler

- **77 hazır servis**, paketleri ve yaklaşık TL fiyatlarıyla: Netflix, Disney+, Amazon Prime, HBO Max (BluTV), Exxen, Gain, TV+, TOD, Digiturk, D-Smart, Tivibu, S Sport Plus, Spotify, YouTube Premium, fizy, Apple Music, Turkcell, Vodafone, Türk Telekom, Superonline, TurkNet, iCloud+, Google One, Lifebox, Xbox Game Pass, PS Plus, Hepsiburada Premium, ChatGPT, Claude, Microsoft 365, Duolingo, Storytel, MACFit, elektrik/doğalgaz/su faturaları, aidat ve daha fazlası.
- **Banka SMS'i / ekstresinden otomatik tanıma**: metni yapıştır; servis, tutar, para birimi ve tarih otomatik bulunur (örn. `12.09.2026 NETFLIX.COM 289,99 TL`). Metin cihazdan çıkmaz.
- Aylık / yıllık / günlük toplam, kategori grafiği, en pahalı abonelikler.
- Haftalık, aylık, 2–3–6 aylık ve yıllık yenilenme; ay sonu (31 → 28/29/30) doğru hesaplanır.
- Ücretsiz deneme süresi takibi ve bitiş uyarısı.
- Ödeme takvimi (aylık görünüm).
- **iPhone Takvim'e aktarma (.ics)**: tekrarlayan etkinlik + seçtiğin gün kadar önce 09:00'da hatırlatma bildirimi.
- USD / EUR abonelikler (ChatGPT, PS Plus…) için kur dönüşümü; kurlar tek dokunuşla güncellenir.
- JSON yedekleme / geri yükleme, açık/koyu mod, çevrimdışı çalışma.
- Tüm veriler yalnızca cihazda (localStorage) saklanır; sunucu yok, hesap yok.

## iPhone'a kurulum

1. Uygulamayı bir HTTPS adresinde yayınla (aşağıya bak).
2. iPhone'da **Safari** ile adresi aç.
3. **Paylaş** (⎙) → **Ana Ekrana Ekle**.
4. Ana ekrandaki Subby ikonuyla tam ekran uygulama olarak aç.

## Yayınlama

### GitHub Pages (önerilen)
1. Bu dalı `main`'e birleştir.
2. GitHub'da **Settings → Pages → Build and deployment → Source: GitHub Actions** seç.
3. `.github/workflows/pages.yml` her `main` push'unda siteyi yayınlar: `https://<kullanıcı>.github.io/<repo>/`.

> Not: Özel (private) repolarda GitHub Pages ücretli plan gerektirir. Alternatif olarak klasörü [Netlify Drop](https://app.netlify.com/drop)'a sürükleyip bırakabilir ya da Cloudflare Pages / Vercel kullanabilirsin — derleme adımı yok, dosyalar olduğu gibi yayınlanır.

### Yerelde çalıştırma
```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Yapı

| Dosya | Açıklama |
| --- | --- |
| `index.html` | Uygulama iskeleti, iOS meta etiketleri |
| `css/style.css` | iOS tarzı arayüz, açık/koyu mod |
| `js/app.js` | Ekranlar, ekleme/düzenleme, ayarlar |
| `js/catalog.js` | Türkiye servis kataloğu (fiyatlar, paketler, tanıma anahtar kelimeleri) |
| `js/detect.js` | SMS / ekstre metninden abonelik tanıma |
| `js/dates.js` | Yenilenme tarihi hesapları |
| `js/ics.js` | Takvim (.ics) dışa aktarma |
| `sw.js` | Çevrimdışı önbellek (dosya değişince `VERSION`'ı artır) |

Katalogdaki fiyatlar yaklaşıktır; ekleme sırasında düzenlenebilir. Yeni servis eklemek için `js/catalog.js`'e bir satır eklemen yeterli.
