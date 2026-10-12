import { CATALOG, CATALOG_BY_ID, CATEGORIES } from "./catalog.js";
import * as D from "./dates.js";
import { detectFromText, normalize as norm } from "./detect.js";
import { buildICS } from "./ics.js";

// ---------------------------------------------------------------- state

const STORE_KEY = "subby.v1";
const DEFAULT_SETTINGS = {
  rates: { USD: 41.5, EUR: 48.5 },
  ratesUpdated: null,
  remindDays: 3,
  installTipHidden: false,
};

let state = load();
let ui = { tab: "home", sort: "date", query: "", calMonth: D.startOfMonth(D.today()), calSel: D.iso(D.today()) };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && Array.isArray(raw.subs)) {
      return { subs: raw.subs, settings: { ...DEFAULT_SETTINGS, ...raw.settings, rates: { ...DEFAULT_SETTINGS.rates, ...(raw.settings?.rates || {}) } } };
    }
  } catch { /* ignore */ }
  return { subs: [], settings: { ...DEFAULT_SETTINGS } };
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast("Kaydedilemedi: depolama erişilemiyor"); }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);

const fmtCache = {};
function money(v, currency = "TRY", digits) {
  const key = currency + digits;
  fmtCache[key] ??= new Intl.NumberFormat("tr-TR", {
    style: "currency", currency,
    minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2,
  });
  return fmtCache[key].format(v || 0);
}
const moneyShort = (v) => money(v, "TRY", Math.abs(v) >= 1000 ? 0 : 2);

function toTRY(amount, currency) {
  if (currency === "TRY") return amount;
  return amount * (state.settings.rates[currency] || 0);
}

export const CYCLES = [
  ["1w", "Haftalık"], ["1m", "Aylık"], ["2m", "2 ayda bir"], ["3m", "3 aylık"], ["6m", "6 aylık"], ["1y", "Yıllık"],
];
const cycleLabel = (c) => CYCLES.find(([k]) => k === c)?.[1] || c;
const cycleShort = (c) => ({ "1w": "/hf", "1m": "/ay", "2m": "/2 ay", "3m": "/3 ay", "6m": "/6 ay", "1y": "/yıl" }[c] || "");

function monthlyTRY(sub) {
  const { n, unit } = D.parseCycle(sub.cycle);
  const perMonth = unit === "w" ? 52 / 12 / n : unit === "m" ? 1 / n : 1 / (12 * n);
  return toTRY(sub.price, sub.currency) * perMonth;
}

const activeSubs = () => state.subs.filter((s) => s.active !== false);
const nextOf = (s) => D.nextOccurrence(s.startDate, s.cycle, D.today());

function relDay(date) {
  const d = D.diffDays(D.today(), date);
  if (d === 0) return "Bugün";
  if (d === 1) return "Yarın";
  if (d < 7) return `${d} gün sonra`;
  return D.human(date);
}

const PALETTE = ["#5e5ce6", "#ff375f", "#30b0c7", "#ff9f0a", "#34c759", "#af52de", "#ff6482", "#64d2ff", "#bf5af2", "#ac8e68"];
function hashColor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }

function initials(name) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || "?") + (w[1]?.[0] || "")).toLocaleUpperCase("tr");
}

function logo(sub, size = "") {
  const svc = sub.catalogId && CATALOG_BY_ID[sub.catalogId];
  const color = sub.color || svc?.color || hashColor(sub.name || "");
  const fg = sub.fg || svc?.fg || "#fff";
  const text = sub.abbr ?? svc?.abbr ?? initials(sub.name || "?");
  const fs = text.length >= 4 ? "font-size:.72em;" : text.length === 3 ? "font-size:.85em;" : "";
  return `<div class="logo ${size}" style="background:${esc(color)};color:${esc(fg)};${fs}">${esc(text)}</div>`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// ---------------------------------------------------------------- views

function render() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === ui.tab));
  const view = $("#view");
  view.innerHTML = { home: viewHome, list: viewList, calendar: viewCalendar, settings: viewSettings }[ui.tab]();
}

function viewHome() {
  const subs = activeSubs();
  const monthly = subs.reduce((a, s) => a + monthlyTRY(s), 0);
  const today = D.today();

  let html = `<h1 class="large-title">Subby</h1>`;

  if (isIOS() && !isStandalone() && !state.settings.installTipHidden) {
    html += `<div class="install-tip"><span>📲</span><div>Uygulama gibi kullanmak için Safari'de <b>Paylaş</b> <span aria-hidden="true">⎙</span> → <b>Ana Ekrana Ekle</b>'ye dokun.</div><button data-action="hide-tip" aria-label="Kapat">✕</button></div>`;
  }

  html += `
    <div class="hero mt">
      <div class="hero-label">Aylık toplam</div>
      <div class="hero-amount">${money(monthly)}</div>
      <div class="hero-row">
        <div class="hero-chip"><b>${moneyShort(monthly * 12)}</b><span>Yıllık</span></div>
        <div class="hero-chip"><b>${subs.length}</b><span>Aktif abonelik</span></div>
        <div class="hero-chip"><b>${moneyShort(monthly / 30)}</b><span>Günlük</span></div>
      </div>
    </div>`;

  if (!state.subs.length) {
    return html + `
      <div class="empty">
        <div class="big">🧾</div>
        <div>Henüz abonelik eklemedin.</div>
        <div class="small">Netflix, Spotify, Turkcell, Exxen ve 70'ten fazla servis hazır.</div>
        <button class="btn" data-action="add">Abonelik ekle</button>
        <div class="mt"><button class="btn secondary" data-action="detect">Banka SMS / ekstresinden tanı</button></div>
      </div>`;
  }

  // Alerts: trials ending + payments due soon
  const remind = state.settings.remindDays;
  const alerts = [];
  for (const s of subs) {
    if (s.trialEnd) {
      const d = D.diffDays(today, D.parse(s.trialEnd));
      if (d >= 0 && d <= Math.max(remind, 3)) {
        alerts.push(`<div class="alert danger" data-action="open" data-id="${s.id}">⏳ <div><b>${esc(s.name)}</b> deneme süresi ${d === 0 ? "bugün" : d === 1 ? "yarın" : d + " gün sonra"} bitiyor. İstemiyorsan iptal et!</div></div>`);
      }
    }
  }
  const dueSoon = subs.map((s) => ({ s, n: nextOf(s) })).filter(({ n }) => D.diffDays(today, n) <= Math.min(remind, 1));
  for (const { s, n } of dueSoon) {
    alerts.push(`<div class="alert" data-action="open" data-id="${s.id}">💳 <div><b>${esc(s.name)}</b> ödemesi ${relDay(n).toLocaleLowerCase("tr")}: <b>${money(s.price, s.currency)}</b></div></div>`);
  }
  html += alerts.join("");

  // Upcoming 30 days
  const horizon = D.addDays(today, 30);
  const upcoming = [];
  for (const s of subs) for (const d of D.occurrencesBetween(s.startDate, s.cycle, today, horizon)) upcoming.push({ s, d });
  upcoming.sort((a, b) => a.d - b.d);
  const upcomingTotal = upcoming.reduce((a, { s }) => a + toTRY(s.price, s.currency), 0);

  html += `<div class="section-title"><span>Önümüzdeki 30 gün</span><span>${money(upcomingTotal)}</span></div>`;
  html += upcoming.length
    ? `<div class="card">${upcoming.slice(0, 6).map(({ s, d }) => subRow(s, d)).join("")}</div>`
      + (upcoming.length > 6 ? `<div class="section-foot">+${upcoming.length - 6} ödeme daha · <a href="#" data-tab-link="calendar">Takvimde gör</a></div>` : "")
    : `<div class="card"><div class="row"><div class="row-main muted">30 gün içinde ödeme yok 🎉</div></div></div>`;

  // Category breakdown
  const byCat = {};
  for (const s of subs) byCat[s.cat] = (byCat[s.cat] || 0) + monthlyTRY(s);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length && monthly > 0) {
    html += `<div class="section-title"><span>Kategoriler (aylık)</span></div>
      <div class="card"><div class="donut-wrap">${donut(cats, monthly)}<div class="legend">${cats.map(([c, v]) => `
        <div class="legend-row"><span class="legend-dot" style="background:${CATEGORIES[c]?.color || "#999"}"></span><span class="legend-name">${CATEGORIES[c]?.icon || ""} ${esc(CATEGORIES[c]?.name || c)}</span><span class="legend-val">${moneyShort(v)}</span></div>`).join("")}
      </div></div></div>`;
  }

  // Most expensive
  const top = [...subs].sort((a, b) => monthlyTRY(b) - monthlyTRY(a)).slice(0, 3);
  if (top.length > 1) {
    html += `<div class="section-title"><span>En pahalılar</span></div><div class="card">${top.map((s) => subRow(s, null, true)).join("")}</div>
      <div class="section-foot">Bu üçü aylık harcamanın %${Math.round((top.reduce((a, s) => a + monthlyTRY(s), 0) / monthly) * 100)}'i.</div>`;
  }

  return html;
}

function donut(entries, total) {
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = entries.map(([c, v]) => {
    const len = (v / total) * C;
    const seg = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${CATEGORIES[c]?.color || "#999"}" stroke-width="20"
      stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 64 64)"/>`;
    offset += len;
    return seg;
  }).join("");
  return `<svg class="donut" viewBox="0 0 128 128" role="img" aria-label="Kategori dağılımı">${arcs}
    <text x="64" y="60" text-anchor="middle" font-size="11" fill="currentColor" opacity=".6">aylık</text>
    <text x="64" y="76" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">${esc(moneyShort(total))}</text></svg>`;
}

function subRow(s, date, showMonthly = false) {
  const n = date || nextOf(s);
  const dd = D.diffDays(D.today(), n);
  const whenCls = dd === 0 ? "today" : dd <= state.settings.remindDays ? "soon" : "";
  const trial = s.trialEnd && D.diffDays(D.today(), D.parse(s.trialEnd)) >= 0 ? `<span class="badge warn">Deneme</span>` : "";
  const paused = s.active === false ? `<span class="badge gray">Durduruldu</span>` : "";
  const sub = [s.plan, cycleLabel(s.cycle)].filter(Boolean).join(" · ");
  return `<button class="row ${s.active === false ? "paused" : ""}" data-action="open" data-id="${s.id}">
    ${logo(s)}
    <div class="row-main"><div class="row-title">${esc(s.name)}${trial}${paused}</div><div class="row-sub">${esc(sub)}</div></div>
    <div class="row-end">
      <div class="row-price">${showMonthly ? money(monthlyTRY(s)) : money(s.price, s.currency)}</div>
      <div class="row-when ${s.active === false ? "" : whenCls}">${showMonthly ? "aylık" : s.active === false ? "—" : relDay(n)}</div>
    </div></button>`;
}

function viewList() {
  let html = `<h1 class="large-title">Abonelikler</h1>`;
  if (!state.subs.length) {
    return html + `<div class="empty"><div class="big">📭</div><div>Liste boş.</div><button class="btn" data-action="add">Abonelik ekle</button></div>`;
  }
  html += `<div class="search"><span>🔍</span><input id="listSearch" type="search" placeholder="Ara" value="${esc(ui.query)}" autocomplete="off"></div>
    <div class="segmented mt" role="tablist">
      ${[["date", "Ödeme tarihi"], ["price", "Tutar"], ["name", "İsim"], ["cat", "Kategori"]].map(([k, l]) => `<button data-sort="${k}" class="${ui.sort === k ? "on" : ""}">${l}</button>`).join("")}
    </div>
    <div id="listBody">${listBody()}</div>`;
  return html;
}

function listBody() {
  const q = norm(ui.query);
  let subs = state.subs.filter((s) => !q || norm(s.name + " " + (s.plan || "") + " " + (CATEGORIES[s.cat]?.name || "")).includes(q));
  const byActive = (a, b) => (a.active === false) - (b.active === false);
  const sorters = {
    date: (a, b) => byActive(a, b) || nextOf(a) - nextOf(b),
    price: (a, b) => byActive(a, b) || monthlyTRY(b) - monthlyTRY(a),
    name: (a, b) => a.name.localeCompare(b.name, "tr"),
    cat: (a, b) => (CATEGORIES[a.cat]?.name || "").localeCompare(CATEGORIES[b.cat]?.name || "", "tr") || monthlyTRY(b) - monthlyTRY(a),
  };
  subs = subs.sort(sorters[ui.sort]);
  if (!subs.length) return `<div class="empty small">Sonuç yok</div>`;

  if (ui.sort === "cat") {
    const groups = {};
    for (const s of subs) (groups[s.cat] ||= []).push(s);
    return Object.entries(groups).map(([c, list]) => `
      <div class="section-title"><span>${CATEGORIES[c]?.icon || ""} ${esc(CATEGORIES[c]?.name || c)}</span><span>${money(list.filter((s) => s.active !== false).reduce((a, s) => a + monthlyTRY(s), 0))}/ay</span></div>
      <div class="card">${list.map((s) => subRow(s)).join("")}</div>`).join("");
  }
  const total = subs.filter((s) => s.active !== false).reduce((a, s) => a + monthlyTRY(s), 0);
  return `<div class="section-title"><span>${subs.length} abonelik</span><span>${money(total)}/ay</span></div>
    <div class="card">${subs.map((s) => subRow(s)).join("")}</div>`;
}

const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function viewCalendar() {
  const m = ui.calMonth;
  const first = D.startOfMonth(m);
  const last = D.endOfMonth(m);
  const today = D.today();
  const byDay = {};
  let monthTotal = 0;
  for (const s of activeSubs()) {
    for (const d of D.occurrencesBetween(s.startDate, s.cycle, first, last)) {
      (byDay[D.iso(d)] ||= []).push(s);
      monthTotal += toTRY(s.price, s.currency);
    }
  }
  const lead = (first.getDay() + 6) % 7; // Monday first
  let cells = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="cal-day other"></div>`;
  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(m.getFullYear(), m.getMonth(), day);
    const key = D.iso(date);
    const subs = byDay[key] || [];
    const cls = [D.iso(today) === key ? "today" : "", ui.calSel === key ? "sel" : ""].join(" ");
    const dots = subs.slice(0, 6).map((s) => `<i style="background:${esc(s.color || CATALOG_BY_ID[s.catalogId]?.color || hashColor(s.name))}"></i>`).join("");
    cells += `<button class="cal-day ${cls}" data-day="${key}"><span class="num">${day}</span><span class="cal-dots">${dots}</span></button>`;
  }

  const sel = byDay[ui.calSel] || [];
  const selDate = D.parse(ui.calSel);
  const inMonth = selDate.getMonth() === m.getMonth() && selDate.getFullYear() === m.getFullYear();

  return `<h1 class="large-title">Takvim</h1>
    <div class="card">
      <div class="cal-head"><button data-cal="-1" aria-label="Önceki ay">‹</button><b>${D.monthName(m)}</b><button data-cal="1" aria-label="Sonraki ay">›</button></div>
      <div class="cal-grid">${cells}</div>
    </div>
    <div class="section-foot">Bu ay toplam: <b>${money(monthTotal)}</b> · ${Object.values(byDay).flat().length} ödeme</div>
    ${inMonth ? `<div class="section-title"><span>${D.human(selDate, true)}</span><span>${money(sel.reduce((a, s) => a + toTRY(s.price, s.currency), 0))}</span></div>
      ${sel.length ? `<div class="card">${sel.map((s) => subRow(s, selDate)).join("")}</div>` : `<div class="card"><div class="row"><div class="row-main muted">Bu gün ödeme yok</div></div></div>`}` : ""}`;
}

function viewSettings() {
  const r = state.settings.rates;
  const updated = state.settings.ratesUpdated ? `Son güncelleme: ${new Date(state.settings.ratesUpdated).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}` : "Varsayılan kurlar kullanılıyor";
  return `<h1 class="large-title">Ayarlar</h1>

    <div class="section-title"><span>Döviz kurları</span><button data-action="rates">Güncelle</button></div>
    <div class="card form">
      <div class="field"><label>1 USD</label><input type="number" inputmode="decimal" step="0.01" min="0" data-rate="USD" value="${r.USD}"><span class="suffix">₺</span></div>
      <div class="field"><label>1 EUR</label><input type="number" inputmode="decimal" step="0.01" min="0" data-rate="EUR" value="${r.EUR}"><span class="suffix">₺</span></div>
    </div>
    <div class="section-foot">${esc(updated)}. Dövizli abonelikler (ChatGPT, PS Plus vb.) toplamlara bu kurla eklenir.</div>

    <div class="section-title"><span>Hatırlatma</span></div>
    <div class="card form">
      <div class="field"><label>Kaç gün önce</label>
        <select id="remindDays">${[0, 1, 2, 3, 5, 7].map((d) => `<option value="${d}" ${state.settings.remindDays === d ? "selected" : ""}>${d === 0 ? "Aynı gün" : d + " gün önce"}</option>`).join("")}</select>
      </div>
    </div>
    <div class="section-foot">Yaklaşan ödemeler bu süre içinde vurgulanır. iPhone bildirimi için aboneliklerini Takvim'e aktar — Takvim uygulaması seçtiğin gün sabah 09:00'da hatırlatır.</div>
    <div class="btn-row"><button class="btn secondary" data-action="ics-all">📅 Tümünü Takvim'e aktar</button></div>

    <div class="section-title"><span>Otomatik tanıma</span></div>
    <div class="card"><button class="row" data-action="detect"><div class="logo sm" style="background:var(--accent)">✨</div><div class="row-main"><div class="row-title">Banka SMS / ekstresinden tanı</div><div class="row-sub">Metni yapıştır, abonelikler otomatik bulunsun</div></div><span class="muted">›</span></button></div>

    <div class="section-title"><span>Yedekleme</span></div>
    <div class="card">
      <button class="row" data-action="export"><div class="logo sm" style="background:#34c759">⇪</div><div class="row-main"><div class="row-title">Yedeği dışa aktar</div><div class="row-sub">JSON dosyası olarak kaydet / paylaş</div></div></button>
      <label class="row" style="cursor:pointer"><div class="logo sm" style="background:#0a84ff">⇩</div><div class="row-main"><div class="row-title">Yedekten geri yükle</div><div class="row-sub">Daha önce aldığın JSON dosyasını seç</div></div><input id="importFile" type="file" accept="application/json,.json" hidden></label>
      <button class="row" data-action="wipe"><div class="logo sm" style="background:var(--danger)">🗑</div><div class="row-main"><div class="row-title" style="color:var(--danger)">Tüm verileri sil</div></div></button>
    </div>
    <div class="section-foot">Verilerin yalnızca bu cihazda saklanır, hiçbir sunucuya gönderilmez. Safari verilerini temizlersen kaybolur; ara sıra yedek al.</div>

    <div class="section-title"><span>Hakkında</span></div>
    <div class="card"><div class="row"><div class="row-main"><div class="row-title">Subby</div><div class="row-sub">${CATALOG.length} hazır servis · Fiyatlar yaklaşıktır</div></div><span class="muted small">v1.0</span></div></div>`;
}

// ---------------------------------------------------------------- sheet

let sheetEl = null;
function openSheet(build) {
  closeSheet(true);
  const root = $("#sheetRoot");
  root.innerHTML = `<div class="sheet-overlay"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grab"></div><div class="sheet-head"></div><div class="sheet-body"></div></div>`;
  sheetEl = $(".sheet", root);
  const overlay = $(".sheet-overlay", root);
  overlay.addEventListener("click", () => closeSheet());
  build(sheetEl);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => { overlay.classList.add("open"); sheetEl.classList.add("open"); });
}

function setSheet({ title, left = "Vazgeç", right = null, rightDisabled = false, body, onLeft, onRight }) {
  const head = $(".sheet-head", sheetEl);
  head.innerHTML = `<button class="left">${esc(left)}</button><h2>${esc(title)}</h2><button class="right" ${right ? "" : "style=visibility:hidden"} ${rightDisabled ? "disabled" : ""}>${esc(right || "")}</button>`;
  $(".left", head).onclick = onLeft || (() => closeSheet());
  if (right) $(".right", head).onclick = onRight;
  const b = $(".sheet-body", sheetEl);
  b.innerHTML = body;
  b.scrollTop = 0;
  return b;
}

function closeSheet(immediate = false) {
  const root = $("#sheetRoot");
  if (!root.firstChild) return;
  document.body.style.overflow = "";
  if (immediate) { root.innerHTML = ""; sheetEl = null; return; }
  $(".sheet", root)?.classList.remove("open");
  $(".sheet-overlay", root)?.classList.remove("open");
  const el = root.firstChild;
  setTimeout(() => { if (root.firstChild === el) { root.innerHTML = ""; sheetEl = null; } }, 300);
}

// ---------------------------------------------------------------- add / edit flow

function openAdd() {
  openSheet(() => showPicker());
}

function showPicker(q = "", cat = "all") {
  const owned = new Set(state.subs.map((s) => s.catalogId).filter(Boolean));
  const body = setSheet({
    title: "Abonelik ekle",
    body: `
      <div class="search"><span>🔍</span><input id="pickSearch" type="search" placeholder="Netflix, Turkcell, Exxen…" value="${esc(q)}" autocomplete="off"></div>
      <div class="chips" id="pickCats">
        <button class="chip ${cat === "all" ? "on" : ""}" data-cat="all">Tümü</button>
        ${Object.entries(CATEGORIES).map(([k, c]) => `<button class="chip ${cat === k ? "on" : ""}" data-cat="${k}">${c.icon} ${esc(c.name)}</button>`).join("")}
      </div>
      <div class="card mt">
        <button class="row" data-pick="__custom"><div class="logo" style="background:var(--card-2);color:var(--accent)">＋</div><div class="row-main"><div class="row-title">Özel abonelik</div><div class="row-sub">Listede olmayan bir şey ekle</div></div><span class="muted">›</span></button>
        <button class="row" data-pick="__detect"><div class="logo" style="background:var(--accent-soft);color:var(--accent)">✨</div><div class="row-main"><div class="row-title">SMS / ekstreden tanı</div><div class="row-sub">Banka metnini yapıştır, otomatik bulalım</div></div><span class="muted">›</span></button>
      </div>
      <div id="pickList"></div>`,
  });

  const renderList = () => {
    const nq = norm(q);
    const items = CATALOG.filter((s) => (cat === "all" || s.cat === cat) && (!nq || norm(s.name).includes(nq) || s.keywords.some((k) => norm(k).includes(nq))));
    const groups = {};
    for (const s of items) (groups[s.cat] ||= []).push(s);
    $("#pickList", body).innerHTML = items.length
      ? Object.entries(groups).map(([c, list]) => `
        <div class="section-title"><span>${CATEGORIES[c].icon} ${esc(CATEGORIES[c].name)}</span></div>
        <div class="card">${list.map((s) => `
          <button class="row" data-pick="${s.id}">${logo({ catalogId: s.id, name: s.name })}
            <div class="row-main"><div class="row-title">${esc(s.name)}${owned.has(s.id) ? `<span class="badge">Ekli</span>` : ""}</div>
            <div class="row-sub">${s.plans.length > 1 ? `${s.plans.length} paket · ` : ""}${money(s.plans[0].price, s.plans[0].currency)}${cycleShort(s.plans[0].cycle)}'dan</div></div>
            <span class="muted">›</span></button>`).join("")}</div>`).join("")
      : `<div class="empty small">“${esc(q)}” bulunamadı.<br><button class="btn secondary mt" data-pick="__custom">“${esc(q)}” olarak ekle</button></div>`;
  };
  renderList();

  $("#pickSearch", body).addEventListener("input", (e) => { q = e.target.value; renderList(); });
  $("#pickCats", body).addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    cat = b.dataset.cat;
    body.querySelectorAll("#pickCats .chip").forEach((c) => c.classList.toggle("on", c === b));
    renderList();
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    const id = b.dataset.pick;
    if (id === "__detect") return showDetect(() => showPicker(q, cat));
    const back = () => showPicker(q, cat);
    if (id === "__custom") return showForm(newSub({ name: q.trim() }), { back });
    const svc = CATALOG_BY_ID[id];
    showForm(newSub({ catalogId: id, name: svc.name, cat: svc.cat, ...planFields(svc.plans[0]) }), { back });
  });
}

const planFields = (pl) => ({ plan: pl.name, price: pl.price, currency: pl.currency, cycle: pl.cycle });

function newSub(fields = {}) {
  return {
    id: uid(), catalogId: null, name: "", cat: "other", plan: "", price: 0, currency: "TRY", cycle: "1m",
    startDate: D.iso(D.today()), trialEnd: "", active: true, payment: "", notes: "", createdAt: Date.now(), ...fields,
  };
}

function showForm(sub, { back, isEdit = false } = {}) {
  const svc = sub.catalogId && CATALOG_BY_ID[sub.catalogId];
  const draft = { ...sub };
  const body = setSheet({
    title: isEdit ? "Düzenle" : svc ? svc.name : "Özel abonelik",
    left: back ? "‹ Geri" : "Vazgeç",
    onLeft: back || (() => closeSheet()),
    right: isEdit ? "Kaydet" : "Ekle",
    onRight: () => submit(),
    body: `
      <div class="detail-head" id="fHead"></div>
      ${svc && svc.plans.length > 1 ? `<div class="section-title"><span>Paket</span></div>
        <div class="plan-grid" id="fPlans">${svc.plans.map((pl, i) => `<button class="plan" data-plan="${i}"><b>${esc(pl.name)}</b><span>${money(pl.price, pl.currency)}${cycleShort(pl.cycle)}</span></button>`).join("")}</div>` : ""}
      <div class="section-title"><span>Bilgiler</span></div>
      <div class="card form">
        <div class="field"><label>İsim</label><input id="fName" value="${esc(draft.name)}" placeholder="Örn. Netflix" autocomplete="off"></div>
        ${svc ? `<div class="field"><label>Paket</label><input id="fPlan" value="${esc(draft.plan)}" placeholder="İsteğe bağlı"></div>` : ""}
        <div class="field"><label>Tutar</label><input id="fPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${draft.price || ""}" placeholder="0,00">
          <select id="fCur" style="flex:none;width:auto;padding-left:6px">${["TRY", "USD", "EUR"].map((c) => `<option ${draft.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><label>Yenilenme</label><select id="fCycle">${CYCLES.map(([k, l]) => `<option value="${k}" ${draft.cycle === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Ödeme günü</label><input id="fDate" type="date" value="${esc(draft.startDate)}"></div>
        <div class="field"><label>Kategori</label><select id="fCat">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${draft.cat === k ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select></div>
      </div>
      <div class="section-foot">Son ödediğin ya da bir sonraki ödeme tarihini gir; sonraki ödemeler otomatik hesaplanır.</div>

      <div class="section-title"><span>Deneme süresi</span></div>
      <div class="card form">
        <div class="field toggle"><label>Ücretsiz deneme</label><label class="switch"><input id="fTrial" type="checkbox" ${draft.trialEnd ? "checked" : ""}><span></span></label></div>
        <div class="field" id="fTrialRow" ${draft.trialEnd ? "" : "hidden"}><label>Bitiş tarihi</label><input id="fTrialEnd" type="date" value="${esc(draft.trialEnd || D.iso(D.addDays(D.today(), 7)))}"></div>
      </div>

      <div class="section-title"><span>Ek</span></div>
      <div class="card form">
        <div class="field"><label>Ödeme yöntemi</label><input id="fPay" value="${esc(draft.payment)}" placeholder="Örn. Bonus kart, Apple"></div>
        <div class="field col"><label>Not</label><textarea id="fNotes" placeholder="Paylaşılan hesap, iptal notu…">${esc(draft.notes)}</textarea></div>
      </div>
      ${isEdit ? "" : `<div class="btn-row"><button class="btn block" id="fSubmit">${svc ? svc.name + " ekle" : "Ekle"}</button></div>`}`,
  });

  const head = $("#fHead", body);
  const refreshHead = () => {
    head.innerHTML = `${logo({ ...draft, abbr: svc ? undefined : initials(draft.name || "?") }, "lg")}
      <div class="price">${money(draft.price, draft.currency)}<span class="muted small" style="font-weight:500">${cycleShort(draft.cycle)}</span></div>
      <div class="sub">${draft.currency !== "TRY" || draft.cycle !== "1m" ? `≈ ${money(monthlyTRY(draft))} / ay` : `${money(monthlyTRY(draft) * 12)} / yıl`}</div>`;
    body.querySelectorAll("[data-plan]").forEach((b) => {
      const pl = svc.plans[+b.dataset.plan];
      b.classList.toggle("on", pl.name === draft.plan && pl.price === draft.price && pl.cycle === draft.cycle);
    });
    const ok = draft.name.trim() && draft.price > 0 && draft.startDate;
    sheetEl.querySelector(".sheet-head .right").disabled = !ok;
    const s = $("#fSubmit", body); if (s) s.disabled = !ok;
  };

  const bind = (id, key, fn = (v) => v) => {
    const el = $(id, body); if (!el) return;
    el.addEventListener("input", () => { draft[key] = fn(el.value); refreshHead(); });
    el.addEventListener("change", () => { draft[key] = fn(el.value); refreshHead(); });
  };
  bind("#fName", "name");
  bind("#fPlan", "plan");
  bind("#fPrice", "price", (v) => Math.max(0, parseFloat(String(v).replace(",", ".")) || 0));
  bind("#fCur", "currency");
  bind("#fCycle", "cycle");
  bind("#fDate", "startDate");
  bind("#fCat", "cat");
  bind("#fTrialEnd", "trialEnd");
  bind("#fPay", "payment");
  bind("#fNotes", "notes");

  $("#fTrial", body).addEventListener("change", (e) => {
    $("#fTrialRow", body).hidden = !e.target.checked;
    draft.trialEnd = e.target.checked ? $("#fTrialEnd", body).value : "";
    refreshHead();
  });
  $("#fPlans", body)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-plan]"); if (!b) return;
    Object.assign(draft, planFields(svc.plans[+b.dataset.plan]));
    $("#fPrice", body).value = draft.price;
    $("#fCur", body).value = draft.currency;
    $("#fCycle", body).value = draft.cycle;
    if ($("#fPlan", body)) $("#fPlan", body).value = draft.plan;
    refreshHead();
  });
  $("#fSubmit", body)?.addEventListener("click", () => submit());

  function submit() {
    if (!draft.name.trim() || !(draft.price > 0)) return toast("İsim ve tutar gerekli");
    draft.name = draft.name.trim();
    const i = state.subs.findIndex((s) => s.id === draft.id);
    if (i >= 0) state.subs[i] = draft; else state.subs.push(draft);
    save();
    closeSheet();
    render();
    toast(isEdit ? "Kaydedildi" : `${draft.name} eklendi ✓`);
  }

  refreshHead();
}

// ---------------------------------------------------------------- detail

function openDetail(id) {
  const s = state.subs.find((x) => x.id === id);
  if (!s) return;
  openSheet(() => showDetail(s));
}

function showDetail(s) {
  const svc = s.catalogId && CATALOG_BY_ID[s.catalogId];
  const next = nextOf(s);
  const m = monthlyTRY(s);
  const trialDays = s.trialEnd ? D.diffDays(D.today(), D.parse(s.trialEnd)) : null;
  const upcoming = D.occurrencesBetween(s.startDate, s.cycle, D.today(), D.addDays(D.today(), 366)).slice(0, 4);
  const body = setSheet({
    title: "", left: "Kapat", right: "Düzenle",
    onRight: () => showForm(s, { isEdit: true, back: () => showDetail(state.subs.find((x) => x.id === s.id) || s) }),
    body: `
      <div class="detail-head">${logo(s, "lg")}<h3>${esc(s.name)}</h3>
        <div class="sub">${esc([s.plan, CATEGORIES[s.cat]?.name].filter(Boolean).join(" · "))}</div>
        <div class="price">${money(s.price, s.currency)}<span class="muted small" style="font-weight:500">${cycleShort(s.cycle)}</span></div>
        ${s.currency !== "TRY" ? `<div class="sub">≈ ${money(toTRY(s.price, s.currency))}</div>` : ""}
      </div>
      ${trialDays !== null && trialDays >= 0 ? `<div class="alert danger">⏳ <div>Deneme süresi <b>${D.human(D.parse(s.trialEnd), true)}</b> tarihinde bitiyor (${trialDays} gün).</div></div>` : ""}
      <div class="section-title"><span>Özet</span></div>
      <div class="card">
        <div class="row"><div class="row-main">Sonraki ödeme</div><div class="row-end"><b>${s.active === false ? "Durduruldu" : D.human(next, true)}</b><div class="row-when">${s.active === false ? "" : relDay(next)}</div></div></div>
        <div class="row"><div class="row-main">Yenilenme</div><div class="row-end">${cycleLabel(s.cycle)}</div></div>
        <div class="row"><div class="row-main">Aylık maliyet</div><div class="row-end">${money(m)}</div></div>
        <div class="row"><div class="row-main">Yıllık maliyet</div><div class="row-end"><b>${money(m * 12)}</b></div></div>
        ${s.payment ? `<div class="row"><div class="row-main">Ödeme yöntemi</div><div class="row-end">${esc(s.payment)}</div></div>` : ""}
      </div>
      ${s.notes ? `<div class="section-title"><span>Not</span></div><div class="card"><div class="row"><div class="row-main" style="white-space:pre-wrap">${esc(s.notes)}</div></div></div>` : ""}
      ${s.active !== false && upcoming.length ? `<div class="section-title"><span>Gelecek ödemeler</span></div>
        <div class="card">${upcoming.map((d) => `<div class="row"><div class="row-main">${D.human(d, true)}</div><div class="row-end muted">${money(s.price, s.currency)}</div></div>`).join("")}</div>` : ""}
      <div class="btn-row"><button class="btn secondary" data-d="ics">📅 Takvime ekle</button>
        ${svc?.url ? `<a class="btn secondary" href="${esc(svc.url)}" target="_blank" rel="noopener">Hesabı yönet ↗</a>` : ""}</div>
      <div class="btn-row"><button class="btn secondary" data-d="toggle">${s.active === false ? "▶︎ Devam ettir" : "⏸ Durdur"}</button>
        <button class="btn danger" data-d="delete">Sil</button></div>
      <div class="section-foot">“Durdur”: iptal ettiğin ama kaydını tutmak istediğin abonelikler için. Toplamlara dahil edilmez.</div>`,
  });
  body.addEventListener("click", (e) => {
    const a = e.target.closest("[data-d]")?.dataset.d;
    if (a === "ics") shareICS([s], `${s.name}.ics`);
    if (a === "toggle") {
      s.active = s.active === false;
      save(); render(); showDetail(s);
      toast(s.active ? "Devam ettiriliyor" : "Durduruldu");
    }
    if (a === "delete" && confirm(`${s.name} silinsin mi?`)) {
      state.subs = state.subs.filter((x) => x.id !== s.id);
      save(); closeSheet(); render(); toast("Silindi");
    }
  });
}

// ---------------------------------------------------------------- detect from text

function showDetect(back) {
  const body = setSheet({
    title: "Metinden tanı", left: back ? "‹ Geri" : "Kapat", onLeft: back || (() => closeSheet()),
    body: `
      <p class="muted small">Banka SMS'lerini, kredi kartı ekstresini veya App Store / Google Play faturalarını buraya yapıştır. Netflix, Spotify, Exxen, Turkcell gibi ${CATALOG.length} servis tutar ve tarihleriyle birlikte otomatik tanınır. Metin cihazından dışarı çıkmaz.</p>
      <textarea id="dText" class="textarea-big" placeholder="Örn.\n12.09.2026 NETFLIX.COM 289,99 TL\n15.09.2026 SPOTIFY P2A3F4 99,00 TL\nKartinizdan EXXEN isyerinde 249,90 TL harcama yapilmistir."></textarea>
      <div class="btn-row"><button class="btn secondary" id="dPaste">📋 Panodan yapıştır</button><button class="btn" id="dScan">Tara</button></div>
      <div id="dResults"></div>`,
  });
  const ta = $("#dText", body);
  $("#dPaste", body).addEventListener("click", async () => {
    try { ta.value = await navigator.clipboard.readText(); scan(); }
    catch { toast("Pano okunamadı — uzun bas ve Yapıştır'ı seç"); ta.focus(); }
  });
  $("#dScan", body).addEventListener("click", scan);

  function scan() {
    const found = detectFromText(ta.value, CATALOG);
    const owned = new Set(state.subs.map((s) => s.catalogId));
    const out = $("#dResults", body);
    if (!found.length) {
      out.innerHTML = `<div class="empty small">Tanınan abonelik bulunamadı.<br>Listede olmayanları “Özel abonelik” ile ekleyebilirsin.</div>`;
      return;
    }
    out.innerHTML = `<div class="section-title"><span>${found.length} abonelik bulundu</span></div>
      <div class="card">${found.map((f, i) => {
        const svc = CATALOG_BY_ID[f.id];
        return `<label class="row" style="cursor:pointer">
          <input type="checkbox" class="check" data-i="${i}" ${owned.has(f.id) ? "" : "checked"}>
          ${logo({ catalogId: f.id, name: svc.name })}
          <div class="row-main"><div class="row-title">${esc(svc.name)}${owned.has(f.id) ? `<span class="badge gray">Zaten ekli</span>` : ""}</div>
            <div class="row-sub">${esc(f.plan.name)} · ${f.date ? D.human(D.parse(f.date)) : "tarih yok"}${f.count > 1 ? ` · ${f.count} kez` : ""}</div></div>
          <div class="row-end"><div class="row-price">${money(f.price, f.currency)}</div><div class="row-when">${f.fromText ? "metinden" : "tahmini"}</div></div>
        </label>`;
      }).join("")}</div>
      <div class="btn-row"><button class="btn block" id="dAdd">Seçilenleri ekle</button></div>
      <div class="section-foot">Eklendikten sonra her birine dokunarak tarih ve paketi düzenleyebilirsin.</div>`;
    $("#dAdd", out).addEventListener("click", () => {
      const picked = [...out.querySelectorAll(".check:checked")].map((c) => found[+c.dataset.i]);
      if (!picked.length) return toast("Hiçbiri seçilmedi");
      for (const f of picked) {
        const svc = CATALOG_BY_ID[f.id];
        state.subs.push(newSub({
          catalogId: f.id, name: svc.name, cat: svc.cat, plan: f.plan.name,
          price: f.price, currency: f.currency, cycle: f.plan.cycle, startDate: f.date || D.iso(D.today()),
        }));
      }
      save(); closeSheet(); ui.tab = "list"; render();
      toast(`${picked.length} abonelik eklendi ✓`);
    });
  }
}

// ---------------------------------------------------------------- export / ics

async function shareFile(content, filename, type) {
  const file = new File([content], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function shareICS(subs, filename) {
  const list = subs.filter((s) => s.active !== false);
  if (!list.length) return toast("Aktif abonelik yok");
  const ics = buildICS(list, { remindDays: state.settings.remindDays, money, nextOf });
  // iOS Safari: text/calendar içeriğine gitmek "Takvime ekle" ekranını açar.
  if (isIOS()) {
    window.location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    return;
  }
  shareFile(ics, filename, "text/calendar");
}

async function updateRates() {
  toast("Kurlar alınıyor…");
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/TRY", { cache: "no-store" });
    const j = await r.json();
    if (j.result !== "success") throw new Error();
    state.settings.rates = { USD: +(1 / j.rates.USD).toFixed(2), EUR: +(1 / j.rates.EUR).toFixed(2) };
    state.settings.ratesUpdated = Date.now();
    save(); render(); toast("Kurlar güncellendi ✓");
  } catch {
    toast("Kurlar alınamadı — elle girebilirsin");
  }
}

// ---------------------------------------------------------------- events

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }

  const tabLink = e.target.closest("[data-tab-link]");
  if (tabLink) { e.preventDefault(); ui.tab = tabLink.dataset.tabLink; render(); window.scrollTo(0, 0); return; }

  if (e.target.closest("#addBtn")) return openAdd();
  if (e.target.closest("#sheetRoot")) return;

  const sortBtn = e.target.closest("[data-sort]");
  if (sortBtn) {
    ui.sort = sortBtn.dataset.sort;
    document.querySelectorAll("[data-sort]").forEach((b) => b.classList.toggle("on", b === sortBtn));
    $("#listBody").innerHTML = listBody();
    return;
  }

  const calNav = e.target.closest("[data-cal]");
  if (calNav) {
    ui.calMonth = D.addMonths(ui.calMonth, +calNav.dataset.cal);
    const t = D.today();
    ui.calSel = D.iso(ui.calMonth.getMonth() === t.getMonth() && ui.calMonth.getFullYear() === t.getFullYear() ? t : ui.calMonth);
    render(); return;
  }
  const day = e.target.closest("[data-day]");
  if (day) { ui.calSel = day.dataset.day; render(); return; }

  const act = e.target.closest("[data-action]");
  if (!act) return;
  switch (act.dataset.action) {
    case "add": return openAdd();
    case "open": return openDetail(act.dataset.id);
    case "detect": return openSheet(() => showDetect());
    case "hide-tip": state.settings.installTipHidden = true; save(); return render();
    case "rates": return updateRates();
    case "ics-all": return shareICS(state.subs, "subby-abonelikler.ics");
    case "export":
      return shareFile(JSON.stringify({ app: "subby", version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2),
        `subby-yedek-${D.iso(D.today())}.json`, "application/json");
    case "wipe":
      if (confirm("Tüm abonelikler silinsin mi? Bu işlem geri alınamaz.")) {
        state = { subs: [], settings: { ...DEFAULT_SETTINGS } }; save(); render(); toast("Tüm veriler silindi");
      }
      return;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "listSearch") { ui.query = e.target.value; $("#listBody").innerHTML = listBody(); }
  if (e.target.dataset.rate) {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.settings.rates[e.target.dataset.rate] = v; save(); }
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "remindDays") { state.settings.remindDays = +e.target.value; save(); toast("Kaydedildi"); }
  if (e.target.id === "importFile") {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.subs)) throw new Error();
      if (!confirm(`${data.subs.length} abonelik içe aktarılacak ve mevcut veriler değiştirilecek. Devam?`)) return;
      state = { subs: data.subs, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
      save(); render(); toast("Yedek geri yüklendi ✓");
    } catch { toast("Geçersiz yedek dosyası"); }
    e.target.value = "";
  }
});

// Refresh "today" relative labels when returning to the app on a new day.
let lastDay = D.iso(D.today());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && D.iso(D.today()) !== lastDay) { lastDay = D.iso(D.today()); render(); }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

render();
