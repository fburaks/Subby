// Basit CSV/TSV okuyucu: ayraç (; , tab) başlıktan anlaşılır, tırnaklı alanları destekler.

export function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return [];
  const head = lines[0];
  const delim = head.includes("\t") ? "\t" : (head.split(";").length >= head.split(",").length ? ";" : ",");
  const split = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const keys = split(head).map(normKey);
  return lines.slice(1).map((l) => {
    const vals = split(l); const row = {};
    keys.forEach((k, i) => { row[k] = vals[i] ?? ""; });
    return row;
  });
}

// "Alış Tarihi" → "alis_tarihi"
export function normKey(k) {
  return k.toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c])
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
