// Eurobond enstrümanı: kupon takvimi, işlemiş faiz, kupon geliri ve satış (değer artışı) hesabı.
//
// Vergisel nitelendirme (gerçek kişi, tam mükellef):
//  - Hazine'nin yurt dışında ihraç ettiği eurobond kuponları: GVK 75/2-5 kapsamında MSİ; tevkifat oranı %0
//    olduğundan "tevkifata tabi" sayılır → GVK 86/1-c sınırı (tarifenin 2. dilimi).
//  - Türk şirket eurobondları: aynı sınıf; ödemede stopaj kesildiyse "stopaj" alanına girilir, beyanda mahsup edilir.
//  - Yabancı ihraççı tahvilleri: tevkifata tabi olmayan MSİ → GVK 86/1-d sınırı; yurt dışı vergisi GVK 123 ile mahsup.
//  - Döviz kupon TL'ye ödeme günündeki TCMB döviz alış kuru ile çevrilir.
//  - Satış: GVK mük. 80 değer artış kazancı. Alış ve satış bedeli işlem günü kurlarıyla TL'ye çevrilir,
//    Yİ-ÜFE artışı %10 ve üzeriyse maliyet (alıştan ve satıştan önceki ayların endeksiyle) endekslenir.
//  - Vadede itfa elden çıkarma sayılmaz; anapara kur farkı vergilenmez. İskontolu alımda itfa farkı ayara bağlı.

import { addMonths, isEndOfMonth, days30360, daysBetween, normDate, prevMonth, todayISO, fmtDate } from "../core/dates.js";
import { parseNum } from "../core/num.js";
import { getFx, getUfe } from "../core/market.js";

export const ISSUERS = {
  TR_HAZINE: "T.C. Hazine",
  TR_SIRKET: "Türk şirketi",
  YABANCI: "Yabancı ihraççı",
};

const ISSUER_ALIASES = {
  tr_hazine: "TR_HAZINE", hazine: "TR_HAZINE", tc: "TR_HAZINE", turkey: "TR_HAZINE", trhazine: "TR_HAZINE",
  tr_sirket: "TR_SIRKET", sirket: "TR_SIRKET", sirket_tr: "TR_SIRKET", corporate: "TR_SIRKET", ozel: "TR_SIRKET",
  yabanci: "YABANCI", foreign: "YABANCI", yd: "YABANCI",
};

const csvColumns = [
  { key: "isin", label: "ISIN", required: false, example: "XS0000000001" },
  { key: "ad", label: "Ad", required: true, example: "TURKEY 7.625 2029" },
  { key: "ihracci", label: "İhraççı", required: false, example: "TR_HAZINE", help: "TR_HAZINE | TR_SIRKET | YABANCI (boşsa TR_HAZINE)" },
  { key: "para", label: "Para birimi", required: true, example: "USD" },
  { key: "nominal", label: "Nominal", required: true, example: "50000" },
  { key: "kupon", label: "Kupon oranı (%)", required: true, example: "7,625" },
  { key: "siklik", label: "Yıllık kupon sayısı", required: false, example: "2", help: "1, 2 veya 4 (boşsa 2)" },
  { key: "vade", label: "Vade tarihi", required: true, example: "2029-04-26" },
  { key: "alis_tarihi", label: "Alış (valör) tarihi", required: true, example: "2024-03-15" },
  { key: "alis_fiyati", label: "Alış temiz fiyatı (%)", required: true, example: "101,25" },
  { key: "alis_kuru", label: "Alış günü kuru (TL)", required: false, example: "32,10", help: "Boşsa kur tablosundan alınır" },
  { key: "alis_islemis_faiz", label: "Alışta ödenen işlemiş faiz (döviz)", required: false, example: "", help: "Boşsa hesaplanır" },
  { key: "guncel_fiyat", label: "Güncel temiz fiyat (%)", required: false, example: "103,40" },
  { key: "stopaj", label: "TR stopaj oranı (%)", required: false, example: "0" },
  { key: "yurtdisi_vergi", label: "Yurt dışı vergi oranı (%)", required: false, example: "0" },
  { key: "gun_sayimi", label: "Gün sayımı", required: false, example: "30/360", help: "30/360 | ACT/ACT" },
];

// ---- Kupon takvimi -------------------------------------------------------

// Vadeden geriye doğru kupon tarihleri (vade dahil), from tarihinden bir dönem öncesine kadar.
export function schedule(h, from) {
  const step = 12 / h.frequency;
  const eom = isEndOfMonth(h.maturity);
  const dates = [];
  for (let k = 0; k < 2000; k++) {
    const d = addMonths(h.maturity, -step * k, eom);
    dates.unshift(d);
    if (d <= from) break;
  }
  return dates;
}

export function couponPeriod(h, date) {
  const sch = schedule(h, date);
  let prev = sch[0], next = sch[sch.length - 1];
  for (let i = 0; i < sch.length; i++) {
    if (sch[i] <= date) prev = sch[i];
    if (sch[i] > date) { next = sch[i]; break; }
  }
  return { prev, next };
}

export const couponAmount = (h) => (h.nominal * h.couponRate) / 100 / h.frequency;

// İşlemiş (birikmiş) faiz, döviz cinsinden.
export function accrued(h, date) {
  if (date >= h.maturity) return 0;
  const { prev, next } = couponPeriod(h, date);
  const frac = h.dayCount === "ACT/ACT"
    ? daysBetween(prev, date) / daysBetween(prev, next)
    : days30360(prev, date) / (360 / h.frequency);
  return couponAmount(h) * Math.max(0, Math.min(1, frac));
}

// Alıştan sonra (alış günü hariç) vadeye kadar tahsil edilecek kuponlar.
export function couponsAfterPurchase(h) {
  return schedule(h, h.purchaseDate).filter((d) => d > h.purchaseDate && d <= h.maturity);
}

// ---- İçe aktarma ---------------------------------------------------------

function fromRow(row) {
  const errors = [];
  const g = (...keys) => { for (const k of keys) if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim(); return ""; };

  const issuerRaw = g("ihracci", "issuer", "tip").toLowerCase().replace(/[^a-z_]/g, "");
  const issuer = ISSUER_ALIASES[issuerRaw] || (issuerRaw ? null : "TR_HAZINE");
  if (!issuer) errors.push(`Bilinmeyen ihraççı tipi: ${g("ihracci")}`);

  const h = {
    instrument: "eurobond",
    isin: g("isin").toUpperCase(),
    name: g("ad", "name", "aciklama") || g("isin"),
    issuer: issuer || "TR_HAZINE",
    currency: (g("para", "para_birimi", "currency", "doviz") || "USD").toUpperCase(),
    nominal: parseNum(g("nominal", "adet", "tutar")),
    couponRate: parseNum(g("kupon", "kupon_orani", "coupon")),
    frequency: parseNum(g("siklik", "kupon_sayisi", "frequency")) || 2,
    maturity: normDate(g("vade", "vade_tarihi", "maturity")),
    purchaseDate: normDate(g("alis_tarihi", "valor", "purchase_date")),
    purchasePrice: parseNum(g("alis_fiyati", "fiyat", "purchase_price")),
    purchaseFx: parseNum(g("alis_kuru", "kur")),
    purchaseAccrued: parseNum(g("alis_islemis_faiz", "islemis_faiz")),
    currentPrice: parseNum(g("guncel_fiyat", "piyasa_fiyati", "current_price")),
    withholding: (parseNum(g("stopaj")) || 0) / 100,
    foreignTax: (parseNum(g("yurtdisi_vergi")) || 0) / 100,
    dayCount: /act/i.test(g("gun_sayimi")) ? "ACT/ACT" : "30/360",
  };

  if (!h.nominal || h.nominal <= 0) errors.push("Nominal geçersiz");
  if (h.couponRate == null || h.couponRate < 0) errors.push("Kupon oranı geçersiz");
  if (![1, 2, 4, 12].includes(h.frequency)) errors.push("Kupon sıklığı 1, 2, 4 veya 12 olmalı");
  if (!h.maturity) errors.push("Vade tarihi okunamadı");
  if (!h.purchaseDate) errors.push("Alış tarihi okunamadı");
  if (!h.purchasePrice || h.purchasePrice <= 0) errors.push("Alış fiyatı geçersiz");
  if (h.maturity && h.purchaseDate && h.purchaseDate >= h.maturity) errors.push("Alış tarihi vadeden sonra");
  if (!/^[A-Z]{3}$/.test(h.currency)) errors.push("Para birimi 3 harfli olmalı (USD, EUR…)");

  return { holding: h, errors };
}

function describe(h) {
  return {
    title: h.name,
    sub: `${h.isin ? h.isin + " · " : ""}${h.currency} ${h.nominal?.toLocaleString("tr-TR")} · %${h.couponRate} · vade ${fmtDate(h.maturity)}`,
    badges: [ISSUERS[h.issuer]],
  };
}

const taxClassOf = (h) => (h.issuer === "YABANCI" ? "MSI_TEVKIFATSIZ" : "MSI_TEVKIFATLI");

// ---- Gelir kalemleri -----------------------------------------------------

function couponItem(h, date, market) {
  const amountFx = couponAmount(h);
  const fx = getFx(market, h.currency, date);
  const amountTL = fx.rate != null ? amountFx * fx.rate : 0;
  return {
    instrument: "eurobond", holdingId: h.id, label: `${h.name} kupon`,
    kind: "kupon", date, taxClass: taxClassOf(h),
    amountTL, withheldTL: amountTL * h.withholding, foreignTaxTL: amountTL * h.foreignTax,
    estimated: fx.estimated || date > todayISO(), missingFx: fx.rate == null,
    detail: { amountFx, currency: h.currency, fx: fx.rate, fxSource: fx.source },
  };
}

function redemptionItem(h, market, settings) {
  const mode = settings.itfaIskonto || "msi";
  const diffFx = (h.nominal * (100 - h.purchasePrice)) / 100;
  if (mode === "yok" || diffFx <= 0) return null;
  const fx = getFx(market, h.currency, h.maturity);
  const amountTL = fx.rate != null ? diffFx * fx.rate : 0;
  return {
    instrument: "eurobond", holdingId: h.id, label: `${h.name} itfa farkı (iskonto)`,
    kind: "itfa", date: h.maturity, taxClass: mode === "dak" ? "DAK" : taxClassOf(h),
    amountTL, withheldTL: 0, foreignTaxTL: 0,
    estimated: fx.estimated || h.maturity > todayISO(), missingFx: fx.rate == null,
    detail: { amountFx: diffFx, currency: h.currency, fx: fx.rate, fxSource: fx.source },
  };
}

function incomeItems(h, { market, settings }) {
  const items = couponsAfterPurchase(h).map((d) => couponItem(h, d, market));
  const r = redemptionItem(h, market, settings);
  if (r) items.push(r);
  return items;
}

// ---- Satış senaryosu -----------------------------------------------------

function saleInputs(h, { market }) {
  const date = todayISO();
  return {
    date,
    cleanPrice: h.currentPrice ?? null,
    fx: getFx(market, h.currency, date).rate,
    ufeBuy: getUfe(market, prevMonth(h.purchaseDate)),
    ufeSell: getUfe(market, prevMonth(date)),
  };
}

export function saleCalc(h, p, { market, settings }) {
  const errors = [];
  const includeAccrued = settings.islemisFaizBedele !== false;
  const pf = getFx(market, h.currency, h.purchaseDate);
  const buyFx = h.purchaseFx ?? (pf.source === "current" ? null : pf.rate);
  if (!buyFx) errors.push(`${fmtDate(h.purchaseDate)} alış kuru yok (Ayarlar → Kurlar ya da portföyde alis_kuru)`);
  if (!p.cleanPrice) errors.push("Satış fiyatı girilmeli");
  if (!p.fx) errors.push("Satış kuru girilmeli");
  if (p.date >= h.maturity) errors.push("Satış tarihi vadeden önce olmalı");

  const buyAccrued = h.purchaseAccrued ?? accrued(h, h.purchaseDate);
  const sellAccrued = accrued(h, p.date);
  const costFx = (h.nominal * h.purchasePrice) / 100 + (includeAccrued ? buyAccrued : 0);
  const proceedsFx = (h.nominal * (p.cleanPrice || 0)) / 100 + (includeAccrued ? sellAccrued : 0);
  const costTL = costFx * (buyFx || 0);
  const proceedsTL = proceedsFx * (p.fx || 0);

  const ufeRatio = p.ufeBuy && p.ufeSell ? p.ufeSell / p.ufeBuy : null;
  const threshold = settings.endekslemeEsik ?? 0.10;
  const indexed = ufeRatio != null && ufeRatio - 1 >= threshold;
  const indexedCostTL = indexed ? costTL * ufeRatio : costTL;
  const gainTL = proceedsTL - indexedCostTL;
  if (ufeRatio == null) errors.push(`Yİ-ÜFE eksik (${prevMonth(h.purchaseDate)} / ${prevMonth(p.date)}); endeksleme yapılmadan hesaplandı`);

  // Bilgi amaçlı ayrıştırma: fiyat etkisi (alış kuruyla) + kur etkisi.
  const priceEffectTL = (proceedsFx - costFx) * (buyFx || 0);
  const fxEffectTL = proceedsFx * ((p.fx || 0) - (buyFx || 0));

  return {
    errors, includeAccrued, buyFx, buyAccrued, sellAccrued, costFx, proceedsFx, costTL, proceedsTL,
    ufeRatio, indexed, indexedCostTL, indexBenefitTL: indexedCostTL - costTL, gainTL, priceEffectTL, fxEffectTL,
    ufeBuyMonth: prevMonth(h.purchaseDate), ufeSellMonth: prevMonth(p.date),
  };
}

function saleScenario(h, p, ctx) {
  const detail = saleCalc(h, p, ctx);
  const coupons = couponsAfterPurchase(h).filter((d) => d <= p.date).map((d) => couponItem(h, d, ctx.market));
  const fatal = detail.errors.some((e) => !e.startsWith("Yİ-ÜFE"));
  const dak = fatal ? [] : [{
    instrument: "eurobond", holdingId: h.id, label: `${h.name} satış`,
    kind: "satis", date: p.date, taxClass: "DAK",
    amountTL: detail.gainTL, withheldTL: 0, foreignTaxTL: 0,
    estimated: false, detail,
  }];
  return { items: [...coupons, ...dak], detail };
}

const csvTemplate = [
  csvColumns.map((c) => c.key).join(";"),
  "XS0000000001;TURKEY 7.625 2029;TR_HAZINE;USD;50000;7,625;2;2029-04-26;2024-03-15;101,25;32,10;;103,40;0;0;30/360",
  "XS0000000002;TURKEY 5.875 2030;TR_HAZINE;EUR;20000;5,875;1;2030-05-21;2025-01-10;99,10;36,85;;101,20;0;0;ACT/ACT",
].join("\n");

export default {
  id: "eurobond",
  label: "Eurobond",
  short: "Eurobond",
  enabled: true,
  csvColumns,
  csvTemplate,
  fromRow,
  describe,
  incomeItems,
  saleInputs,
  saleScenario,
};
