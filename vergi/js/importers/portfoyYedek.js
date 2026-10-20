// Portföy uygulaması yedeği ({ surum, veri: { "portfoy-varliklar", "portfoy-varlik-islemleri", ... } })
// içinden eurobond pozisyonlarını ve döviz kuru geçmişini çıkarır.
//
// - Alış tarihleri "portfoy-varlik-islemleri"ndeki alım/satım işlemlerinden FIFO ile bulunur; her kalan alım ayrı lot olur.
// - Yedekte miktar "adet" olarak tutulur; unitNominal (varsayılan 100) ile nominale çevrilir.
// - "portfoy-varlik-fiyat-gecmisi" içindeki "Döviz__USD" gibi seriler kur tablosuna eklenir.

export const isPortfoyYedek = (obj) => !!obj?.veri?.["portfoy-varliklar"];

const day = (s) => String(s || "").slice(0, 10);

export function fromPortfoyYedek(obj, { unitNominal = 100 } = {}) {
  const v = obj.veri;
  const assets = (v["portfoy-varliklar"] || []).filter((a) => a.kategori === "Eurobond");
  const trades = (v["portfoy-varlik-islemleri"] || []).filter((t) => t.kategori === "Eurobond");
  const rows = [], errors = [];

  const byIsin = {};
  for (const a of assets) (byIsin[a.ad] ||= []).push(a);

  for (const [isin, list] of Object.entries(byIsin)) {
    const a = list[0];
    const units = list.reduce((s, x) => s + x.adet, 0);
    // FIFO: alımlar kuyruğa, satımlar en eski alımdan düşülür.
    const lots = [];
    for (const t of trades.filter((x) => x.ad === isin).sort((x, y) => day(x.tarih).localeCompare(day(y.tarih)))) {
      if (t.tur === "alim") lots.push({ date: day(t.tarih), units: t.adet, price: t.fiyat });
      else if (t.tur === "satim") {
        let left = t.adet;
        while (left > 1e-9 && lots.length) {
          const take = Math.min(left, lots[0].units);
          lots[0].units -= take; left -= take;
          if (lots[0].units <= 1e-9) lots.shift();
        }
      }
    }
    const lotUnits = lots.reduce((s, l) => s + l.units, 0);
    if (!lots.length) {
      errors.push(`${isin}: alım işlemi bulunamadı; alış tarihini elle girmen gerekiyor.`);
      continue;
    }
    if (Math.abs(lotUnits - units) > 1e-6) {
      errors.push(`${isin}: işlemlerden ${lotUnits} adet, varlıklarda ${units} adet çıktı; işlem lotları kullanıldı.`);
    }
    const year = (a.vadeTarihi || "").slice(0, 4);
    const turkey = isin.startsWith("US900123"); // T.C. Hazine eurobondlarının ISIN öneki
    for (const l of lots) {
      rows.push({
        isin,
        ad: `${turkey ? "TURKEY" : isin} %${String(a.kuponOrani).replace(".", ",")} ${year}${a.hesap ? ` · ${a.hesap}` : ""}`,
        ihracci: turkey ? "TR_HAZINE" : "",
        para: a.paraBirimi || "USD",
        nominal: l.units * unitNominal,
        kupon: a.kuponOrani,
        siklik: a.kuponSikligi || 2,
        vade: a.vadeTarihi,
        alis_tarihi: l.date,
        alis_fiyati: Math.round(l.price * 1e6) / 1e6,
        guncel_fiyat: a.guncelFiyat,
      });
    }
  }

  // Döviz kuru geçmişi: "Döviz__USD": [{ tarih, fiyat }]
  const fx = {};
  for (const [key, series] of Object.entries(v["portfoy-varlik-fiyat-gecmisi"] || {})) {
    const m = key.match(/^Döviz__([A-Z]{3})$/);
    if (!m || !Array.isArray(series)) continue;
    for (const p of series) if (p.fiyat > 0) (fx[m[1]] ||= {})[day(p.tarih)] = p.fiyat;
  }

  return { rows, fx, errors };
}
