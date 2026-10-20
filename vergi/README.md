# Menkul Vergi – Eurobond vergi hesaplayıcı

Türkiye'de tam mükellef gerçek kişiler için eurobond kupon ve satış kazancı vergisini hesaplayan, tarayıcıda çalışan web uygulaması. Sunucu yok; veriler yalnızca tarayıcıda (localStorage) saklanır.

## Özellikler

- **Kupon vergisi:** Portföydeki her eurobondun kupon takvimini vadeden geriye doğru çıkarır, kuponları ödeme günü kuruyla TL'ye çevirir, yıl bazında GVK 86/1-c ve 86/1-d beyan sınırlarını uygular ve GVK 103 tarifesiyle (diğer beyan edilen gelirlerin üzerine eklenerek) vergiyi hesaplar.
- **Bugün satarsam:** Seçili pozisyonlar için satış bedeli, işlemiş faiz, TL maliyet, Yİ-ÜFE endekslemesi (%10 eşiği) ve değer artış kazancını hesaplar; yılın vergisini "vadeye kadar tut" senaryosuyla karşılaştırır. Kazancı fiyat etkisi, kur etkisi ve endeksleme indirimi olarak ayrıştırır.
- **Kur ve Yİ-ÜFE:** Eksik tarihli kurları listeler, elle ya da toplu yapıştırarak girilir; internetten yaklaşık (ECB) kurla doldurma seçeneği vardır. Resmi beyan için TCMB döviz alış kuru girilmelidir.
- **Kurallar:** 2025 ve 2026 parametreleri, işlemiş faiz ve iskontolu itfa tercihleri, JSON yedek.

## Portföy formatı

İlk satır başlık; ayraç `;`, `,` veya sekme. Ondalıklarda virgül ya da nokta kullanılabilir. Her satır bir alım (lot). Örnek: `ornek/eurobond-portfoy.csv`.

| Sütun | Zorunlu | Açıklama |
| --- | --- | --- |
| `isin` | | ISIN |
| `ad` | ✓ | Tahvil adı |
| `ihracci` | | `TR_HAZINE` (varsayılan), `TR_SIRKET`, `YABANCI` |
| `para` | ✓ | `USD`, `EUR`… |
| `nominal` | ✓ | Nominal tutar |
| `kupon` | ✓ | Yıllık kupon oranı (%) |
| `siklik` | | Yıllık kupon sayısı (varsayılan 2) |
| `vade` | ✓ | Vade tarihi (`2029-04-26` ya da `26.04.2029`) |
| `alis_tarihi` | ✓ | Alış (valör) tarihi |
| `alis_fiyati` | ✓ | Alış temiz fiyatı (%) |
| `alis_kuru` | | Alış günü kuru; boşsa kur tablosundan |
| `alis_islemis_faiz` | | Alışta ödenen işlemiş faiz (döviz); boşsa hesaplanır |
| `guncel_fiyat` | | Satış senaryosu için güncel temiz fiyat (%) |
| `stopaj` | | Kuponda kesilen TR stopajı (%) |
| `yurtdisi_vergi` | | Yurt dışında kesilen vergi (%) |
| `gun_sayimi` | | `30/360` (varsayılan) ya da `ACT/ACT` |

## Vergi kuralları (özet)

- Kupon faizi menkul sermaye iradıdır (GVK 75/2-5). Hazine eurobondlarında stopaj %0'dır ama gelir tevkifata tabi sayılır; yıllık toplam 2. gelir dilimi tutarını (2025: 330.000 ₺, 2026: 400.000 ₺) aşarsa tamamı beyan edilir (GVK 86/1-c).
- Yabancı ihraççı tahvillerinin faizi tevkifatsızdır; toplam 2025'te 18.000 ₺, 2026'da 22.000 ₺'yi aşarsa beyan edilir (GVK 86/1-d). Yurt dışı vergi GVK 123'e göre mahsup edilir.
- Kupon, tahsil günündeki TCMB döviz alış kuruyla TL'ye çevrilir.
- Satış kazancı değer artış kazancıdır (GVK mük. 80); alış/satış bedeli işlem günü kurlarıyla TL'ye çevrilir, Yİ-ÜFE artışı %10 ve üzeriyse maliyet endekslenir (mük. 81). Tutarı ne olursa olsun beyan edilir.
- Vadede itfa elden çıkarma sayılmaz; anapara kur farkı vergilenmez.
- 2026 tarifesi: 190.000 / 400.000 / 1.000.000 / 5.300.000 ₺ dilimleri, %15–%40.

Kaynak: GİB, *Menkul Sermaye İradı Elde Eden Gerçek Kişiler İçin Vergi Rehberi* (Şubat 2026) ve GVK. Araç bilgi amaçlıdır; beyan öncesi mali müşavire danış.

## Yeni enstrüman eklemek

1. `js/instruments/<ad>.js` içinde `js/instruments/index.js`'teki arayüzü uygula (`csvColumns`, `fromRow`, `describe`, `incomeItems`, `saleScenario`).
2. Gelir kalemlerini `MSI_TEVKIFATLI`, `MSI_TEVKIFATSIZ` veya `DAK` sınıfıyla üret; motor (`js/tax/engine.js`) beyan sınırlarını ve vergiyi enstrümandan bağımsız hesaplar. Stopajla nihai vergilenen gelirler (mevduat, fon) için `withheldTL` doldurulur.
3. `INSTRUMENTS` listesindeki yer tutucuyu modülle değiştir.

Yeni vergi yılı: `js/tax/rules.js` içindeki `RULES`'a kayıt ekle.

## Çalıştırma ve test

```sh
python3 -m http.server 8000   # depo kökünden; http://localhost:8000/vergi/
node --test vergi/test/*.test.mjs
```
