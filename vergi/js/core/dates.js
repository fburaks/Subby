// Tarih yardımcıları. Tüm tarihler "YYYY-MM-DD" metni olarak taşınır (saat dilimi kayması olmasın).

export const pad = (n) => String(n).padStart(2, "0");

export function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// "2026-04-26", "26.04.2026", "26/04/2026" → "2026-04-26"
export function normDate(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Ay ekler; gün o ayda yoksa ay sonuna çeker (31 Ağu - 6 ay → 28/29 Şub).
// endOfMonth: kaynak tarih ay sonuysa sonuç da ay sonu olur.
export function addMonths(iso, n, endOfMonth = false) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const dim = daysInMonth(ny, nm);
  const day = endOfMonth ? dim : Math.min(d, dim);
  return `${ny}-${pad(nm + 1)}-${pad(day)}`;
}

export const isEndOfMonth = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return d === daysInMonth(y, m - 1);
};

export const yearOf = (iso) => Number(iso.slice(0, 4));

export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

// 30/360 (US / Bond Basis) gün sayımı – eurobondların çoğunda kullanılır.
export function days30360(a, b) {
  let [y1, m1, d1] = a.split("-").map(Number);
  let [y2, m2, d2] = b.split("-").map(Number);
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 >= 30) d2 = 30;
  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

// Bir önceki ay "YYYY-MM" (endeksleme: alış/satış ayından önceki ayın Yİ-ÜFE'si).
export function prevMonth(iso) {
  return addMonths(`${iso.slice(0, 7)}-01`, -1).slice(0, 7);
}

export function fmtDate(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
