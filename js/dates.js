// Yerel saat dilimiyle çalışan, saat bilgisi olmayan tarih yardımcıları.

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parse(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return today();
  return new Date(y, m - 1, d);
}

const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Ay sonu taşmasını engeller: 31 Ocak + 1 ay = 28/29 Şubat.
export function addMonths(d, n, anchorDay = d.getDate()) {
  const y = d.getFullYear(), m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(anchorDay, last));
}

export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export const diffDays = (a, b) => Math.round((b - a) / 86400000);

export function parseCycle(c) {
  const m = /^(\d+)([wmy])$/.exec(c || "");
  return m ? { n: Math.max(1, +m[1]), unit: m[2] } : { n: 1, unit: "m" };
}

// k. ödeme tarihi (k=0 başlangıç), negatif k geriye gider.
export function occurrence(startIso, cycle, k) {
  const start = parse(startIso);
  const { n, unit } = parseCycle(cycle);
  if (unit === "w") return addDays(start, 7 * n * k);
  return addMonths(start, (unit === "y" ? 12 : 1) * n * k, start.getDate());
}

// from tarihinde ya da sonrasındaki ilk ödemenin sırası (başlangıçtan önceye gitmez).
function nextIndex(startIso, cycle, from) {
  const start = parse(startIso);
  const { n, unit } = parseCycle(cycle);
  let k;
  if (unit === "w") k = Math.ceil(diffDays(start, from) / (7 * n));
  else {
    const months = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
    k = Math.floor(months / ((unit === "y" ? 12 : 1) * n));
  }
  k = Math.max(0, k);
  while (occurrence(startIso, cycle, k) < from) k++;
  while (k > 0 && occurrence(startIso, cycle, k - 1) >= from) k--;
  return k;
}

export const nextOccurrence = (startIso, cycle, from) => occurrence(startIso, cycle, nextIndex(startIso, cycle, from));

export function occurrencesBetween(startIso, cycle, from, to) {
  const out = [];
  for (let k = nextIndex(startIso, cycle, from), d; (d = occurrence(startIso, cycle, k)) <= to && out.length < 400; k++) out.push(d);
  return out;
}

export function human(d, withYear = false) {
  const base = `${d.getDate()} ${withYear ? MONTHS[d.getMonth()] : MONTHS_SHORT[d.getMonth()]}`;
  if (!withYear) return base;
  return `${base} ${d.getFullYear()}, ${DAYS[d.getDay()]}`;
}

export const monthName = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
