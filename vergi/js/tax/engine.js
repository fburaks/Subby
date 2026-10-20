// Vergi motoru: enstrümanlardan gelen "gelir kalemleri"ni toplar, beyan sınırlarını uygular
// ve yıllık vergiyi hesaplar. Enstrümandan bağımsızdır.
//
// Gelir kalemi (income item):
// {
//   instrument: "eurobond", holdingId, label,
//   date: "YYYY-MM-DD",
//   taxClass: "MSI_TEVKIFATLI" | "MSI_TEVKIFATSIZ" | "DAK",
//   amountTL,           // brüt tutar (DAK'ta zarar negatif olabilir)
//   withheldTL,         // Türkiye'de kesilen stopaj (mahsup edilir)
//   foreignTaxTL,       // yurt dışında ödenen vergi (GVK 123, sınırlı mahsup)
//   estimated: bool,    // gelecekteki / tahmini kur ile hesaplanmış
//   detail: {...}       // enstrümana özel açıklama
// }

import { rulesFor, incomeTax, marginalRate } from "./rules.js";

export const TAX_CLASSES = {
  MSI_TEVKIFATLI: "Menkul sermaye iradı (tevkifata tabi, %0 dahil) – GVK 86/1-c",
  MSI_TEVKIFATSIZ: "Menkul sermaye iradı (tevkifata tabi olmayan) – GVK 86/1-d",
  DAK: "Değer artış kazancı – GVK mük. 80",
};

const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

/**
 * @param items  gelir kalemleri (tüm yıllar olabilir; yıla göre süzülür)
 * @param year
 * @param opts   { otherMatrahTL, otherTevkifatliTL, otherTevkifatsizTL, overrides }
 *   otherMatrahTL: aynı yıl beyan edilecek diğer gelirler (ör. kira, serbest meslek, beyana tabi ücret)
 *   otherTevkifatliTL / otherTevkifatsizTL: sınır hesabına katılan diğer MSİ/GMSİ
 */
export function annualReport(items, year, opts = {}) {
  const rules = rulesFor(year, opts.overrides);
  const yi = items.filter((i) => i.date.startsWith(String(year)));
  const by = (c) => yi.filter((i) => i.taxClass === c);

  const tevkifatli = by("MSI_TEVKIFATLI");
  const tevkifatsiz = by("MSI_TEVKIFATSIZ");
  const dak = by("DAK");

  const tevkifatliTotal = sum(tevkifatli, (i) => i.amountTL);
  const tevkifatsizTotal = sum(tevkifatsiz, (i) => i.amountTL);
  const tevkifatliTest = tevkifatliTotal + (opts.otherTevkifatliTL || 0);
  const tevkifatsizTest = tevkifatsizTotal + (opts.otherTevkifatsizTL || 0);

  const declareTevkifatli = tevkifatliTest > rules.msiTevkifatliLimit;
  const declareTevkifatsiz = tevkifatsizTest > rules.msiTevkifatsizLimit;

  // Aynı yıl içindeki DAK zararları DAK kârlarından düşülür; net zarar diğer gelirlere mahsup edilmez.
  const dakNet = sum(dak, (i) => i.amountTL);
  const dakMatrah = Math.max(0, dakNet);

  const msiMatrah = (declareTevkifatli ? tevkifatliTotal : 0) + (declareTevkifatsiz ? tevkifatsizTotal : 0);
  const matrah = msiMatrah + dakMatrah;

  const other = opts.otherMatrahTL || 0;
  const grossTax = incomeTax(other + matrah, rules.brackets) - incomeTax(other, rules.brackets);

  // Mahsuplar: beyan edilen kalemlerde kesilen stopajlar + yurt dışı vergiler (o gelire düşen TR vergisi kadar).
  const declared = [
    ...(declareTevkifatli ? tevkifatli : []),
    ...(declareTevkifatsiz ? tevkifatsiz : []),
  ];
  const withheld = sum(declared, (i) => i.withheldTL || 0);
  const avgRate = matrah > 0 ? grossTax / matrah : 0;
  const foreignCredit = sum(declared, (i) => Math.min(i.foreignTaxTL || 0, i.amountTL * avgRate));
  const netTax = Math.max(0, grossTax - withheld - foreignCredit);
  // Beyan dışı kalan kalemlerde kesilen stopaj nihai vergidir.
  const finalWithholding = sum(yi.filter((i) => !declared.includes(i) && i.taxClass !== "DAK"), (i) => i.withheldTL || 0);

  const warnings = [];
  if (rules.estimated) warnings.push(`${year} için resmi parametre tanımlı değil; ${rules.baseYear} tarifesi ve sınırları kullanıldı (tahmini).`);
  if (yi.some((i) => i.estimated)) warnings.push("Bazı kalemler gelecekte veya kuru girilmemiş; güncel kur ile tahmin edildi.");
  if (dakNet < 0) warnings.push("Yıl içi değer artışı net zararda; zarar diğer gelirlerden indirilemez ve sonraki yıla devretmez.");
  if (!declareTevkifatli && tevkifatliTotal > 0 && tevkifatliTest > rules.msiTevkifatliLimit * 0.8) {
    warnings.push(`Tevkifatlı MSİ toplamı beyan sınırına (${rules.msiTevkifatliLimit.toLocaleString("tr-TR")} ₺) yakın.`);
  }

  return {
    year, rules, items: yi,
    tevkifatli: { total: tevkifatliTotal, test: tevkifatliTest, limit: rules.msiTevkifatliLimit, declare: declareTevkifatli },
    tevkifatsiz: { total: tevkifatsizTotal, test: tevkifatsizTest, limit: rules.msiTevkifatsizLimit, declare: declareTevkifatsiz },
    dak: { net: dakNet, matrah: dakMatrah, count: dak.length },
    mustDeclare: matrah > 0,
    matrah, other, grossTax, withheld, foreignCredit, netTax, finalWithholding,
    marginal: marginalRate(other + matrah, rules.brackets),
    effective: matrah > 0 ? netTax / matrah : 0,
    warnings,
  };
}

// "Satarsam" ile "tutarsam" senaryolarının farkı.
export function compareScenarios(baseItems, saleItems, year, opts) {
  const hold = annualReport(baseItems, year, opts);
  const sell = annualReport(saleItems, year, opts);
  return { hold, sell, deltaTax: sell.netTax - hold.netTax };
}
