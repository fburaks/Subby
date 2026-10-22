# Proses 3D Görüntüleyici

FPDF dosyasındaki bağlayıcı noktalarından 3D nokta bulutu oluşturur, MPF (makine programı)
dosyasındaki prosesleri bağlayıcı ismi üzerinden bu noktalarla eşleştirir ve isteğe bağlı bir
3D model (STL / OBJ / PLY / GLB) ile birlikte gösterir.

## Çalıştırma (Windows)

Ek yazılım gerekmez. `proses3d` klasörünü bilgisayara kopyalayın ve **`index.html`** dosyasına
çift tıklayın (Chrome veya Edge önerilir). İnternet bağlantısı gerekmez; Three.js kütüphanesi
`lib/` klasöründe yer alır.

Klasörün tamamı birlikte taşınmalıdır (`index.html`, `css/`, `js/`, `lib/`, `ornek/`).

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
- Bağlayıcı ismi satırdaki `;` işaretinden sonraki metindir. Bir pozisyon satırından sonraki tüm
  prosesler, bir sonraki pozisyon satırına kadar o bağlayıcıya aittir.
- İsim kaynağı (pozisyon satırı / proses satırı / otomatik) ve anahtar kelime listeleri
  *MPF kuralları* bölümünden değiştirilebilir.

### Eşleştirme ve kurallar
- FPDF ve MPF, bağlayıcı ismi üzerinden eşleştirilir (varsayılan: büyük/küçük harf duyarsız).
- `PSEN` bir noktada 0 veya daha fazla kez olabilir.
- `CS` / `DONLY` / `DNOCLAMP` ("tekil prosesler") bir noktada en fazla **bir** kez ve yalnızca
  biri olabilir; ek olarak PSEN bulunabilir. Aksi durum **kural ihlali** olarak işaretlenir.
- FPDF'de olup MPF'de olmayan noktalar gri halka ile, MPF'de olup FPDF'de olmayan isimler
  *Uyarılar* listesinde gösterilir.

## Görselleştirme
- **Şekil** = tekil proses: daire (yok), kare (CS), üçgen (DONLY), eşkenar dörtgen (DNOCLAMP),
  yıldız (birden fazla — hata), halka (MPF'de yok).
- **Renk** = seçilebilir mod: durum (PSEN sayısı / kural ihlali), proses kombinasyonu,
  FPDF proses kodu, Z yüksekliği.
- Lejanttaki kutucuklarla kategoriler gizlenip gösterilebilir.
- Noktaya tıklayınca sağda detay paneli (MPF satır numaraları ve satır içerikleri), çift tıklayınca odaklanma.
- Arama kutusu: eşleşen noktalar vurgulanır, Enter ile ilk sonuca gidilir.
- *Tablo* ve *Uyarılar* panelleri, CSV dışa aktarma (Excel için `;` ayraçlı).
- 3D model: renk, opaklık, tel kafes, öteleme / dönme / ölçek ile noktalara hizalama.

Fare: sol tuş döndür, sağ tuş kaydır, tekerlek yakınlaştır.

## Örnek veri
`ornek/` klasöründeki dosyalar sentetik test verisidir. Uygulamadaki **Örnek veriyi göster**
düğmesi bunların `ornek-data.js` içine gömülü kopyasını kullanır.

## Geliştirme
- `js/parser.js` — FPDF/MPF ayrıştırma ve eşleştirme (tarayıcı ve Node uyumlu)
- `js/app.js` — arayüz ve Three.js sahnesi
- Ayrıştırıcı testleri: `node proses3d/test/parser.test.js`
- Three.js r147 (MIT lisansı, `lib/three-LICENSE.txt`)
