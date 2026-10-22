# Proses 3D Görüntüleyici

FPDF dosyasındaki bağlayıcı noktalarından 3D nokta bulutu oluşturur, MPF (makine programı)
dosyasındaki prosesleri bağlayıcı ismi üzerinden bu noktalarla eşleştirir ve isteğe bağlı bir
3D model (STL / VRML / OBJ / PLY / GLB) ile birlikte gösterir.

## Çalıştırma (Windows)

Ek yazılım gerekmez. **`Proses3D.html`** dosyasını bilgisayara kopyalayıp çift tıklayın
(Chrome veya Edge önerilir). Tüm kütüphaneler dosyanın içine gömülüdür; internet bağlantısı
ya da başka bir dosya gerekmez.

`index.html` geliştirme sürümüdür (kaynakları `css/`, `js/`, `lib/` klasörlerinden okur).
Kaynaklar değiştirildikten sonra tek dosya `node proses3d/build.js` ile yeniden üretilir.

## Dosya kuralları

### FPDF
- `$` ile başlayan satırlar yorumdur, boş satırlar atlanır.
- Diğer satırlar virgülle (ayarlanabilir) ayrılır.
- Proses kodu, bağlayıcı ismi, X, Y, Z sütunlarının **kaçıncı alan olduğu** sol paneldeki
  *FPDF sütunları* bölümünden ayarlanır (1'den başlar). Ayarlar tarayıcıda saklanır, ayrıca
  JSON olarak dışa/içe aktarılabilir.

### MPF
- `$` ile başlayan satırlar yorumdur. Satır başındaki `N123` blok numaraları yok sayılır.
- `AXPOS` veya `LIN` ile başlayan satırlar **pozisyon** satırıdır.
- Pozisyondan sonra gelen `PSEN`, `CS`, `DONLY`, `DNOCLAMP` satırları **proses**tir.
- Örnek satır: `N023515 AXPOS(-855.2109,274.6084,1593.9438,1133.4849,-18.9635,0,0);- Point_No--Fst-1962`
- `N023540 ;PDP(...)` gibi `;` ile yoruma alınmış komutlar yok sayılır. `NSEN`, `DSEN`, `LUP`, `LD`
  gibi diğer komutlar proses sayılmaz.
- Bağlayıcı ismi satırdaki `;` işaretinden sonraki metindir (baştaki `-` ve boşluklar atılır). Bir pozisyon satırından sonraki tüm
  prosesler, bir sonraki pozisyon satırına kadar o bağlayıcıya aittir.
- İsim kaynağı (pozisyon satırı / proses satırı / otomatik) ve anahtar kelime listeleri
  *MPF kuralları* bölümünden değiştirilebilir.

### Eşleştirme ve kurallar
- FPDF ve MPF, bağlayıcı ismi üzerinden eşleştirilir (varsayılan: büyük/küçük harf duyarsız).
  Tam eşleşme yoksa sonek ile eşleştirilir: MPF'deki `Point_No--Fst-1962`, FPDF'deki `Fst-1962`
  ile eşleşir (veya tersi). *MPF kuralları → Sonek eşleşme* ile kapatılabilir.
- `PSEN` bir noktada 0 veya daha fazla kez olabilir.
- `CS` / `DONLY` / `DNOCLAMP` ("tekil prosesler") bir noktada en fazla **bir** kez ve yalnızca
  biri olabilir; ek olarak PSEN bulunabilir. Aksi durum **kural ihlali** olarak işaretlenir.
- FPDF'de olup MPF'de olmayan noktalar gri halka ile, MPF'de olup FPDF'de olmayan isimler
  *Uyarılar* listesinde gösterilir.

## Görselleştirme
- **Şekil** = tekil proses: daire (yok), kare (CS), üçgen (DONLY), eşkenar dörtgen (DNOCLAMP),
  yıldız (birden fazla — hata), halka (MPF'de yok).
- **Renk** = varsayılan olarak bağlayıcı tipi; ayrıca durum (PSEN sayısı / kural ihlali),
  proses kombinasyonu, FPDF proses kodu, Z yüksekliği seçilebilir.
- Lejanttaki kutucuklarla kategoriler gizlenip gösterilebilir.
- Noktaya tıklayınca sağda detay paneli (MPF satır numaraları ve satır içerikleri), çift tıklayınca odaklanma.
- Arama kutusu: eşleşen noktalar vurgulanır, Enter ile ilk sonuca gidilir.
- *Tablo* ve *Uyarılar* panelleri, CSV dışa aktarma (Excel için `;` ayraçlı).
- 3D model: renk, opaklık, tel kafes, öteleme / dönme / ölçek ile noktalara hizalama.
- **Özet lejantı** (harita üzerinde): harita başlığı, toplam bağlayıcı, PSEN olan nokta ve toplam
  PSEN işlemi, bağlayıcı tiplerine göre sayılar, tekil proses sayıları ve kontrol sayıları.
  Bağlayıcı tipi varsayılan olarak FPDF proses kodu sütunudur; *FPDF sütunları* bölümünden
  ayrı bir sütun seçilebilir.

## 3D model (CATIA)
CGR kapalı bir format olduğu için doğrudan okunamaz. CATIA'dan:
- **CATPart → STL** (Save As → stl)
- **CATProduct → VRML** (Save As → wrl, VRML 97 / V2.0)

## Kaydetme ve paylaşma
*Kaydet / Paylaş* bölümünden:
- **Haritayı kaydet (HTML)**: FPDF/MPF verisi, ayarlar, filtreler, kamera açısı, başlık ve
  (isteğe bağlı) 3D model tek bir HTML dosyasına gömülür. Alıcı dosyayı çift tıklayarak açar ve
  haritayı aynı görünümde inceler. *Sadece 3D görünüm ve lejant* seçiliyse (varsayılan) alıcı
  yalnızca 3D pencereyi, özet lejantını ve görünüm düğmelerini görür; düzenleme paneli gizlenir.
  Bu özellik yalnızca `Proses3D.html` sürümünde çalışır.
- **Görüntü (PNG)**: o anki görünüm + özet lejantı.
- **CSV**: nokta listesi ve uyarılar.

Fare: sol tuş döndür, sağ tuş kaydır, tekerlek yakınlaştır.

## Örnek veri
`ornek/` klasöründeki dosyalar sentetik test verisidir. Uygulamadaki **Örnek veriyi göster**
düğmesi bunların `ornek-data.js` içine gömülü kopyasını kullanır.

## Geliştirme
- `js/parser.js` — FPDF/MPF ayrıştırma ve eşleştirme (tarayıcı ve Node uyumlu)
- `js/app.js` — arayüz ve Three.js sahnesi
- Ayrıştırıcı testleri: `node proses3d/test/parser.test.js`
- `build.js` — tek dosyalık `Proses3D.html` üretir
- Three.js r147 (MIT lisansı, `lib/three-LICENSE.txt`), chevrotain 9 (Apache-2.0, VRML ayrıştırma için)
