// Piyasa verisi: döviz kurları (TCMB döviz alış) ve Yİ-ÜFE endeksi.
// Kullanıcının girdiği / içe aktardığı veriler localStorage'da saklanır.

import { todayISO, addMonths, normDate } from "./dates.js";
import { parseNum } from "./num.js";

export function emptyMarket() {
  return { fx: {}, fxCurrent: {}, ufe: {} };
}

export function setFx(market, ccy, date, rate) {
  (market.fx[ccy] ||= {})[date] = rate;
}

// Ödeme günündeki kur; yoksa geriye doğru en fazla 10 gün içindeki son kur (hafta sonu/tatil).
// Gelecek tarih ya da veri yoksa güncel kur (tahmini).
export function getFx(market, ccy, date) {
  if (ccy === "TRY") return { rate: 1, source: "exact", estimated: false };
  const table = market.fx[ccy] || {};
  if (table[date] != null) return { rate: table[date], source: "exact", estimated: false };
  if (date <= todayISO()) {
    for (let i = 1; i <= 10; i++) {
      const d = addDays(date, -i);
      if (table[d] != null) return { rate: table[d], source: d, estimated: false };
    }
  }
  const cur = market.fxCurrent[ccy];
  if (cur != null) return { rate: cur, source: "current", estimated: true };
  return { rate: null, source: null, estimated: true };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const getUfe = (market, ym) => market.ufe[ym] ?? null;

// "2026-04-24;USD;38,1234" ya da "24.04.2026 USD 38.1234" satırları.
export function importFxText(market, text) {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[;\t ]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const date = normDate(parts[0]);
    const ccy = parts[1].toUpperCase();
    const rate = parseNum(parts.slice(2).join(""));
    if (date && /^[A-Z]{3}$/.test(ccy) && rate) { setFx(market, ccy, date, rate); n++; }
  }
  return n;
}

// "2025-09;4321,12" ya da "09.2025 4321.12" satırları.
export function importUfeText(market, text) {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4})[-./](\d{1,2})[\s;,\t]+(.+)$/) || line.trim().match(/^(\d{1,2})[-./](\d{4})[\s;,\t]+(.+)$/);
    if (!m) continue;
    const [y, mo] = m[1].length === 4 ? [m[1], m[2]] : [m[2], m[1]];
    const v = parseNum(m[3]);
    if (v) { market.ufe[`${y}-${String(mo).padStart(2, "0")}`] = v; n++; }
  }
  return n;
}

// Yaklaşık kur doldurma: ECB referans kurları (frankfurter.dev, CORS açık).
// TCMB döviz alış kuru ile birebir aynı değildir; resmi beyan için TCMB kuru girilmelidir.
export async function fetchEcbRates(ccy, from, to = todayISO()) {
  const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=${ccy}&symbols=TRY`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kur servisi yanıt vermedi (${res.status})`);
  const data = await res.json();
  const out = {};
  for (const [d, r] of Object.entries(data.rates || {})) if (r.TRY) out[d] = r.TRY;
  return out;
}

export async function fetchEcbLatest(ccy) {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${ccy}&symbols=TRY`);
  if (!res.ok) throw new Error(`Kur servisi yanıt vermedi (${res.status})`);
  const data = await res.json();
  return data.rates?.TRY ?? null;
}

export const monthsBack = (n) => addMonths(todayISO(), -n);
