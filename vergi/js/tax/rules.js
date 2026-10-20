// Yıllara göre gerçek kişi gelir vergisi parametreleri.
// Yeni yıl eklemek için RULES'a bir kayıt eklemek yeterli; motor ve enstrümanlar değişmez.
//
// Kaynaklar:
//  - GVK md. 103 tarifesi (2025: 332 Seri No.lu GVGT, 2026: 2026 tarifesine ilişkin GVGT; yeniden değerleme %25,49)
//  - GVK md. 86/1-c: tevkifata tabi (oranı %0 olanlar dahil) MSİ toplamı tarifenin 2. dilim tutarını
//    aşmıyorsa beyan edilmez; aşarsa tamamı beyan edilir.
//  - GVK md. 86/1-d: tevkifata ve istisnaya tabi olmayan MSİ + GMSİ toplamı yıllık sınırı aşmıyorsa beyan edilmez.
//  - GVK mük. md. 80 / md. 81: menkul kıymet satış kazancı = değer artış kazancı (DAK), tutarı ne olursa olsun beyan;
//    Yİ-ÜFE artışı %10 ve üzeriyse maliyet endekslenir. DAK istisnası menkul kıymetlere uygulanmaz.
//  - GİB "Menkul Sermaye İradı Elde Eden Gerçek Kişiler İçin Vergi Rehberi" (Şubat 2026, 2025 gelirleri).

export const RULES = {
  2025: {
    year: 2025,
    // [üst sınır, oran]; son dilimin üst sınırı Infinity.
    brackets: [[158000, 0.15], [330000, 0.20], [800000, 0.27], [4300000, 0.35], [Infinity, 0.40]],
    msiTevkifatliLimit: 330000,   // GVK 86/1-c (2. dilim)
    msiTevkifatsizLimit: 18000,   // GVK 86/1-d
    dakIstisna: 120000,           // Menkul kıymetlere uygulanmaz; bilgi amaçlı
    endekslemeEsik: 0.10,
    beyanDonemi: "Mart 2026",
    note: "2025 gelirleri – Mart 2026'da beyan edilir.",
  },
  2026: {
    year: 2026,
    brackets: [[190000, 0.15], [400000, 0.20], [1000000, 0.27], [5300000, 0.35], [Infinity, 0.40]],
    msiTevkifatliLimit: 400000,
    msiTevkifatsizLimit: 22000,
    dakIstisna: 150000,
    endekslemeEsik: 0.10,
    beyanDonemi: "Mart 2027",
    note: "2026 gelirleri – Mart 2027'de beyan edilir.",
  },
};

export const YEARS = Object.keys(RULES).map(Number).sort();

// Tanımsız yıl için en yakın yılın kuralları kullanılır (tahmini olarak işaretlenir).
export function rulesFor(year, overrides = {}) {
  let base = RULES[year];
  let estimated = false;
  if (!base) {
    const near = YEARS.reduce((a, y) => (Math.abs(y - year) < Math.abs(a - year) ? y : a), YEARS[0]);
    base = RULES[near];
    estimated = true;
  }
  return { ...base, ...(overrides[year] || {}), year, baseYear: base.year, estimated };
}

// GVK 103: kümülatif dilimli vergi.
export function incomeTax(matrah, brackets) {
  let tax = 0, prev = 0;
  for (const [limit, rate] of brackets) {
    if (matrah <= prev) break;
    tax += (Math.min(matrah, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}

export function marginalRate(matrah, brackets) {
  for (const [limit, rate] of brackets) if (matrah < limit) return rate;
  return brackets[brackets.length - 1][1];
}
