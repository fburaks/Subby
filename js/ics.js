// Abonelikleri tekrarlayan takvim etkinlikleri (.ics) olarak dışa aktarır.
// iPhone Takvim uygulaması bunları içe aktarıp hatırlatma bildirimi gösterir.

import * as D from "./dates.js";

const icsEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const ymd = (d) => D.iso(d).replace(/-/g, "");

function fold(line) {
  // RFC 5545: satırlar 75 oktetten uzun olmamalı.
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "", len = 0;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function rrule(start, cycle) {
  const { n, unit } = D.parseCycle(cycle);
  if (unit === "w") return `FREQ=WEEKLY;INTERVAL=${n}`;
  const freq = unit === "y" ? "YEARLY" : "MONTHLY";
  const day = start.getDate();
  let r = `FREQ=${freq};INTERVAL=${n}`;
  if (day > 28) {
    // Ay sonu: 31'i olmayan aylarda son güne kaydır.
    const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
    r += unit === "y" ? `;BYMONTH=${start.getMonth() + 1}` : "";
    r += `;BYMONTHDAY=${days};BYSETPOS=-1`;
  }
  return r;
}

export function buildICS(subs, { remindDays, money, nextOf }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Subby//Abonelik Takibi//TR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Abonelikler"];
  for (const s of subs) {
    const start = D.parse(s.startDate);
    const next = nextOf(s);
    // Ay sonu kuralının doğru kalması için başlangıç gününü koru; geçmişteyse sonraki ödemeden başlat.
    const dtstart = start >= next ? start : next;
    const trigger = remindDays === 0 ? "PT9H" : `-PT${remindDays * 24 - 9}H`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@subby`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(dtstart)}`,
      `DTEND;VALUE=DATE:${ymd(D.addDays(dtstart, 1))}`,
      `RRULE:${rrule(start, s.cycle)}`,
      fold(`SUMMARY:${icsEscape(`💳 ${s.name} – ${money(s.price, s.currency)}`)}`),
      fold(`DESCRIPTION:${icsEscape([s.plan, s.payment && "Ödeme: " + s.payment, s.notes].filter(Boolean).join("\n") || "Subby aboneliği")}`),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold(`DESCRIPTION:${icsEscape(`${s.name} ödemesi yaklaşıyor`)}`),
      `TRIGGER:${trigger}`,
      "END:VALARM",
      "END:VEVENT",
    );
    if (s.trialEnd) {
      const t = D.parse(s.trialEnd);
      lines.push(
        "BEGIN:VEVENT", `UID:${s.id}-trial@subby`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(t)}`, `DTEND;VALUE=DATE:${ymd(D.addDays(t, 1))}`,
        fold(`SUMMARY:${icsEscape(`⏳ ${s.name} deneme süresi bitiyor`)}`),
        "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${icsEscape(`${s.name} denemesi bitiyor — istemiyorsan iptal et`)}`),
        "TRIGGER:-PT39H", "END:VALARM", "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
