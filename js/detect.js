// Banka SMS'i / kart ekstresi gibi serbest metinden abonelikleri tanır.

export function normalize(s) {
  return String(s || "")
    .toLocaleLowerCase("tr")
    .replace(/i̇/g, "i").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

const DATE_RE = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/;
const CUR = "(TL|TRY|₺|USD|\\$|EUR|€)";
const NUM = "(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d{1,3}(?:,\\d{3})+\\.\\d{2}|\\d+[.,]\\d{2}|\\d+)";
const AMOUNT_AFTER = new RegExp(`${NUM}\\s*${CUR}`, "gi");
const AMOUNT_BEFORE = new RegExp(`${CUR}\\s*${NUM}`, "gi");
const AMOUNT_BARE = new RegExp(`(?<![\\d.,])(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+,\\d{2}|\\d+\\.\\d{2})(?![\\d.,])`, "g");

function toNumber(s) {
  // "1.299,90" -> 1299.90, "1,299.90" -> 1299.90, "189,99" -> 189.99
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) return parseFloat(s.replace(/\./g, "").replace(",", "."));
  return parseFloat(s.replace(/,/g, ""));
}

function toCurrency(c) {
  if (!c) return "TRY";
  c = c.toUpperCase();
  if (c === "$" || c === "USD") return "USD";
  if (c === "€" || c === "EUR") return "EUR";
  return "TRY";
}

function parseDate(line) {
  const m = DATE_RE.exec(line);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmount(line) {
  // Tarih ve saatleri temizle ki "12.09" tutar sanılmasın.
  const clean = line.replace(new RegExp(DATE_RE.source, "g"), " ").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ");
  for (const re of [AMOUNT_AFTER, AMOUNT_BEFORE]) {
    re.lastIndex = 0;
    const all = [...clean.matchAll(re)];
    if (all.length) {
      const m = all[all.length - 1];
      const [num, cur] = re === AMOUNT_AFTER ? [m[1], m[2]] : [m[2], m[1]];
      const v = toNumber(num);
      if (v > 0) return { price: v, currency: toCurrency(cur) };
    }
  }
  const bare = [...clean.matchAll(AMOUNT_BARE)];
  if (bare.length) {
    const v = toNumber(bare[bare.length - 1][1]);
    if (v > 0) return { price: v, currency: null };
  }
  return null;
}

/**
 * @returns {{id, plan, price, currency, date, count, fromText}[]}
 */
export function detectFromText(text, catalog) {
  // Uzun anahtar kelimeler önce: "youtube music" > "youtube", "vodafone net" > "vodafone".
  const keys = [];
  for (const svc of catalog) for (const k of svc.keywords) keys.push([normalize(k), svc]);
  keys.sort((a, b) => b[0].length - a[0].length);

  const results = new Map();
  const lines = String(text || "").split(/\r?\n|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/);

  for (const raw of lines) {
    const line = normalize(raw);
    // "netflix.com" gibi ifadeleri yakalamak için noktalı ve noktasız iki halini de dene.
    const variants = [` ${line} `, ` ${line.replace(/[*_\-/]/g, " ").replace(/\s+/g, " ")} `];
    const hit = keys.find(([k]) => variants.some((v) => v.includes(k)));
    if (!hit) continue;
    const svc = hit[1];
    const amount = parseAmount(raw);
    const date = parseDate(raw);
    const prev = results.get(svc.id);
    if (prev) {
      prev.count++;
      // En yeni tarihli kaydı tut.
      if (date && (!prev.date || date > prev.date)) Object.assign(prev, { date, ...(amount && pricing(svc, amount)) });
      continue;
    }
    results.set(svc.id, { id: svc.id, date, count: 1, ...pricing(svc, amount) });
  }
  return [...results.values()];
}

// Bulunan tutara en yakın paketi seç.
function pricing(svc, amount) {
  if (!amount) {
    const plan = svc.plans[0];
    return { plan, price: plan.price, currency: plan.currency, fromText: false };
  }
  const currency = amount.currency || svc.plans[0].currency;
  const candidates = svc.plans.filter((p) => p.currency === currency);
  const plan = (candidates.length ? candidates : svc.plans)
    .reduce((best, p) => (Math.abs(p.price - amount.price) < Math.abs(best.price - amount.price) ? p : best));
  return { plan, price: amount.price, currency, fromText: true };
}
