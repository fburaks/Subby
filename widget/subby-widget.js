// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: credit-card;

// Subby ana ekran widget'ı (Scriptable).
// Kurulum: Scriptable'da yeni betik oluştur, adını "Subby" yap, bu kodu yapıştır.
// Veri: Subby → Ayarlar → "Widget'ı güncelle" bu betiği aboneliklerinle çalıştırır.

const APP_URL = "https://fburaks.github.io/Subby/";
const DATA_FILE = "subby-widget.json";

const fm = FileManager.local();
const dataPath = fm.joinPath(fm.documentsDirectory(), DATA_FILE);

// ---------------------------------------------------------------- tarih

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parse(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a, b) => Math.round((b - a) / 86400000);

function addMonths(d, n, anchorDay) {
  const y = d.getFullYear(), m = d.getMonth() + n;
  return new Date(y, m, Math.min(anchorDay, new Date(y, m + 1, 0).getDate()));
}

function parseCycle(c) {
  const m = /^(\d+)([wmy])$/.exec(c || "");
  return m ? { n: Math.max(1, +m[1]), unit: m[2] } : { n: 1, unit: "m" };
}

function occurrence(startIso, cycle, k) {
  const start = parse(startIso);
  const { n, unit } = parseCycle(cycle);
  if (unit === "w") return addDays(start, 7 * n * k);
  return addMonths(start, (unit === "y" ? 12 : 1) * n * k, start.getDate());
}

function nextIndex(startIso, cycle, from) {
  const start = parse(startIso);
  const { n, unit } = parseCycle(cycle);
  let k = unit === "w"
    ? Math.ceil(diffDays(start, from) / (7 * n))
    : Math.floor(((from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth()) / ((unit === "y" ? 12 : 1) * n));
  k = Math.max(0, k);
  while (occurrence(startIso, cycle, k) < from) k++;
  while (k > 0 && occurrence(startIso, cycle, k - 1) >= from) k--;
  return k;
}

function occurrencesBetween(startIso, cycle, from, to) {
  const out = [];
  for (let k = nextIndex(startIso, cycle, from), d; (d = occurrence(startIso, cycle, k)) <= to && out.length < 100; k++) out.push(d);
  return out;
}

function relDay(d) {
  const n = diffDays(today(), d);
  if (n === 0) return "Bugün";
  if (n === 1) return "Yarın";
  if (n < 7) return `${n} gün`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ---------------------------------------------------------------- para

const SYMBOL = { TRY: "₺", USD: "$", EUR: "€" };

function money(v, cur = "TRY", digits) {
  const dg = digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  const [int, dec] = Math.abs(v).toFixed(dg).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}${SYMBOL[cur] || cur + " "}${grouped}${dec ? "," + dec : ""}`;
}

// ---------------------------------------------------------------- veri

// Kompakt biçim: { v, rates: {USD, EUR}, subs: [[name, price, currency, cycle, startDate, color, fg, abbr, trialEnd]] }
function loadData() {
  if (!fm.fileExists(dataPath)) return null;
  try { return JSON.parse(fm.readString(dataPath)); } catch (e) { return null; }
}

function model(data) {
  const rates = data.rates || {};
  const toTRY = (p, c) => (c === "TRY" ? p : p * (rates[c] || 0));
  const subs = data.subs.map(([name, price, currency, cycle, startDate, color, fg, abbr, trialEnd]) =>
    ({ name, price, currency, cycle, startDate, color, fg, abbr, trialEnd }));

  let monthly = 0;
  for (const s of subs) {
    const { n, unit } = parseCycle(s.cycle);
    monthly += toTRY(s.price, s.currency) * (unit === "w" ? 52 / 12 / n : unit === "m" ? 1 / n : 1 / (12 * n));
  }

  const t = today();
  const horizon = addDays(t, 30);
  const upcoming = [];
  for (const s of subs) for (const d of occurrencesBetween(s.startDate, s.cycle, t, horizon)) upcoming.push({ s, d });
  upcoming.sort((a, b) => a.d - b.d);
  const next30 = upcoming.reduce((a, { s }) => a + toTRY(s.price, s.currency), 0);

  const trials = subs.filter((s) => s.trialEnd && diffDays(t, parse(s.trialEnd)) >= 0 && diffDays(t, parse(s.trialEnd)) <= 3);
  return { subs, monthly, upcoming, next30, trials, savedAt: data.savedAt };
}

// ---------------------------------------------------------------- görünüm

const C = {
  bg1: new Color("#5e5ce6"), bg2: new Color("#bf5af2"),
  text: Color.white(), dim: new Color("#ffffff", 0.75), faint: new Color("#ffffff", 0.18),
  warn: new Color("#ffd60a"),
};

function baseWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.url = APP_URL;
  // Gün değişince "Yarın" → "Bugün" etiketleri yenilensin.
  const t = today();
  w.refreshAfterDate = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 5);
  return w;
}

function text(stack, str, size, { weight = "regular", color = C.text, lines = 1, minScale = 0.6 } = {}) {
  const t = stack.addText(str);
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = minScale;
  return t;
}

function logo(stack, s, size) {
  const box = stack.addStack();
  box.size = new Size(size, size);
  box.cornerRadius = size * 0.25;
  box.backgroundColor = new Color(s.color || "#6f6e77");
  box.centerAlignContent();
  const label = (s.abbr || s.name[0] || "?").slice(0, 4);
  const t = box.addText(label);
  t.font = Font.heavySystemFont(size * (label.length >= 3 ? 0.32 : 0.45));
  t.textColor = new Color(s.fg || "#ffffff");
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.5;
}

function row(parent, { s, d }, size) {
  const r = parent.addStack();
  r.centerAlignContent();
  r.spacing = 8;
  logo(r, s, size);
  const mid = r.addStack();
  mid.layoutVertically();
  text(mid, s.name, size * 0.55, { weight: "semibold" });
  const n = diffDays(today(), d);
  text(mid, relDay(d), size * 0.45, { color: n <= 1 ? C.warn : C.dim, weight: n <= 1 ? "semibold" : "regular" });
  r.addSpacer();
  text(r, money(s.price, s.currency), size * 0.55, { weight: "semibold" });
}

function emptyWidget(family) {
  const w = baseWidget();
  if (family.startsWith("accessory")) {
    w.backgroundGradient = null;
    text(w, "Subby: veri yok", 12);
    return w;
  }
  text(w, "Subby", 16, { weight: "bold" });
  w.addSpacer(6);
  text(w, "Subby → Ayarlar → “Widget'ı güncelle”ye dokun.", 12, { color: C.dim, lines: 4 });
  return w;
}

function small(m) {
  const w = baseWidget();
  w.setPadding(14, 14, 14, 14);
  text(w, "Aylık", 12, { color: C.dim });
  text(w, money(m.monthly, "TRY", 0), 26, { weight: "bold", minScale: 0.5 });
  text(w, `${m.subs.length} abonelik`, 11, { color: C.dim });
  w.addSpacer();
  const next = m.upcoming[0];
  if (next) {
    const r = w.addStack();
    r.centerAlignContent();
    r.spacing = 6;
    logo(r, next.s, 22);
    const col = r.addStack();
    col.layoutVertically();
    text(col, next.s.name, 12, { weight: "semibold" });
    const n = diffDays(today(), next.d);
    text(col, `${relDay(next.d)} · ${money(next.s.price, next.s.currency)}`, 10, { color: n <= 1 ? C.warn : C.dim });
  } else {
    text(w, "30 gün içinde ödeme yok", 11, { color: C.dim, lines: 2 });
  }
  return w;
}

function listWidget(m, count) {
  const w = baseWidget();
  w.setPadding(14, 16, 14, 16);
  const head = w.addStack();
  head.bottomAlignContent();
  const left = head.addStack();
  left.layoutVertically();
  text(left, "Aylık toplam", 11, { color: C.dim });
  text(left, money(m.monthly, "TRY", 0), 22, { weight: "bold" });
  head.addSpacer();
  const right = head.addStack();
  right.layoutVertically();
  text(right, "30 gün", 11, { color: C.dim }).rightAlignText();
  text(right, money(m.next30, "TRY", 0), 15, { weight: "semibold" }).rightAlignText();

  w.addSpacer(8);
  for (const t of m.trials.slice(0, 1)) {
    const n = diffDays(today(), parse(t.trialEnd));
    text(w, `⏳ ${t.name} denemesi ${n === 0 ? "bugün" : n === 1 ? "yarın" : n + " gün sonra"} bitiyor`, 11, { color: C.warn, weight: "semibold" });
    w.addSpacer(4);
    count--;
  }
  const items = m.upcoming.slice(0, count);
  if (!items.length) text(w, "30 gün içinde ödeme yok 🎉", 12, { color: C.dim });
  items.forEach((it, i) => {
    if (i) w.addSpacer(count > 4 ? 7 : 5);
    row(w, it, count > 4 ? 26 : 22);
  });
  w.addSpacer();
  return w;
}

function accessory(m, family) {
  const w = new ListWidget();
  w.url = APP_URL;
  const next = m.upcoming[0];
  if (family === "accessoryCircular") {
    const n = next ? diffDays(today(), next.d) : null;
    w.addSpacer();
    text(w, n === null ? "–" : n === 0 ? "Bugün" : String(n), n === 0 ? 12 : 22, { weight: "bold" }).centerAlignText();
    text(w, n === null || n === 0 ? (next ? next.s.name : "") : "gün", 10).centerAlignText();
    w.addSpacer();
    return w;
  }
  if (family === "accessoryInline") {
    text(w, next ? `💳 ${next.s.name} ${relDay(next.d).toLowerCase()} ${money(next.s.price, next.s.currency)}` : `💳 ${money(m.monthly, "TRY", 0)}/ay`, 12);
    return w;
  }
  // accessoryRectangular
  text(w, `Subby · ${money(m.monthly, "TRY", 0)}/ay`, 12, { weight: "semibold" });
  for (const it of m.upcoming.slice(0, 2)) text(w, `${relDay(it.d)} · ${it.s.name} ${money(it.s.price, it.s.currency)}`, 12);
  if (!m.upcoming.length) text(w, "30 gün içinde ödeme yok", 12);
  return w;
}

function build(family) {
  const data = loadData();
  if (!data || !Array.isArray(data.subs)) return emptyWidget(family);
  const m = model(data);
  if (family.startsWith("accessory")) return accessory(m, family);
  if (family === "small") return small(m);
  if (family === "large" || family === "extraLarge") return listWidget(m, 7);
  return listWidget(m, 3);
}

// ---------------------------------------------------------------- giriş

const params = args.queryParameters || {};

if (params.data) {
  // Subby uygulamasından gelen güncelleme.
  try {
    const data = JSON.parse(params.data);
    if (!Array.isArray(data.subs)) throw new Error("subs yok");
    fm.writeString(dataPath, JSON.stringify(data));
    const a = new Alert();
    a.title = "Widget güncellendi ✓";
    a.message = `${data.subs.length} abonelik kaydedildi. Widget birkaç dakika içinde yenilenir.`;
    a.addAction("Önizle");
    a.addCancelAction("Tamam");
    if ((await a.present()) === 0) await build("medium").presentMedium();
  } catch (e) {
    const a = new Alert();
    a.title = "Güncellenemedi";
    a.message = String(e);
    a.addCancelAction("Tamam");
    await a.present();
  }
} else if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(build(config.widgetFamily || "medium"));
} else {
  // Uygulama içinde elle çalıştırıldı: önizleme göster.
  const a = new Alert();
  a.title = "Subby widget";
  a.message = loadData() ? "Hangi boyutu önizlemek istersin?" : "Henüz veri yok. Subby → Ayarlar → “Widget'ı güncelle”ye dokun.";
  a.addAction("Küçük");
  a.addAction("Orta");
  a.addAction("Büyük");
  a.addCancelAction("Kapat");
  const i = await a.present();
  if (i === 0) await build("small").presentSmall();
  if (i === 1) await build("medium").presentMedium();
  if (i === 2) await build("large").presentLarge();
}

Script.complete();
