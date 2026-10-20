// Sayı okuma ve biçimlendirme (Türkçe "1.234,56" ve İngilizce "1,234.56" ikisi de okunur).

export function parseNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s|%|₺|TL/gi, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) {
    s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lc > -1) {
    // Tek tür ayraç: "1,234,567" binlik; "7,625" ondalık.
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (ld > -1 && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const tl = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtTL = (n) => (n == null || !Number.isFinite(n) ? "–" : `${tl.format(n)} ₺`);
export const fmtNum = (n, d = 2) => (n == null || !Number.isFinite(n) ? "–"
  : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n));
export const fmtCcy = (n, ccy) => (n == null || !Number.isFinite(n) ? "–" : `${fmtNum(n)} ${ccy}`);
export const fmtPct = (n, d = 2) => (n == null || !Number.isFinite(n) ? "–" : `%${fmtNum(n * 100, d)}`);

export const round2 = (n) => Math.round(n * 100) / 100;
