// Menkul Vergi – arayüz. Tüm veriler tarayıcıda (localStorage) kalır.

import { INSTRUMENTS, instrument } from "./instruments/index.js";
import { annualReport, compareScenarios, TAX_CLASSES } from "./tax/engine.js";
import { RULES, YEARS, rulesFor } from "./tax/rules.js";
import { parseCSV } from "./core/csv.js";
import { parseNum, fmtTL, fmtNum, fmtCcy, fmtPct } from "./core/num.js";
import { todayISO, fmtDate, yearOf, prevMonth, normDate } from "./core/dates.js";
import { emptyMarket, getFx, setFx, importFxText, importUfeText, fetchEcbRates, fetchEcbLatest } from "./core/market.js";
import { couponsAfterPurchase } from "./instruments/eurobond.js";

const KEY = "menkul-vergi.v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- Durum ---------------------------------------------------------------

const defaultState = () => ({
  tab: "kupon",
  instrument: "eurobond",
  holdings: [],
  market: emptyMarket(),
  settings: { itfaIskonto: "msi", islemisFaizBedele: true, endekslemeEsik: 0.10 },
  taxOpts: { otherMatrahTL: 0, otherTevkifatliTL: 0, otherTevkifatsizTL: 0 },
  year: yearOf(todayISO()),
  sale: { date: todayISO(), fx: {}, sel: {}, price: {} },
  sample: false,
});

let state;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch { /* depolama kapalı olabilir */ }
  return sampleState();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* yoksay */ }
}

function sampleState() {
  const s = defaultState();
  s.holdings = importRows(parseCSV(instrument("eurobond").csvTemplate), "eurobond").holdings;
  s.market.fxCurrent = { USD: 42, EUR: 48.5 };
  s.sample = true;
  return s;
}

const ctx = () => ({ market: state.market, settings: state.settings });
const uid = () => Math.random().toString(36).slice(2, 10);

function importRows(rows, instrId) {
  const inst = instrument(instrId);
  const holdings = [], errors = [];
  rows.forEach((row, i) => {
    const { holding, errors: e } = inst.fromRow(row);
    if (e.length) errors.push(`Satır ${i + 2}: ${e.join(", ")}`);
    else holdings.push({ ...holding, id: uid() });
  });
  return { holdings, errors };
}

function allItems() {
  return state.holdings.flatMap((h) => instrument(h.instrument).incomeItems(h, ctx()));
}

const currencies = () => [...new Set(state.holdings.map((h) => h.currency))].sort();

function yearRange() {
  const now = yearOf(todayISO());
  if (!state.holdings.length) return [now];
  const min = Math.min(...state.holdings.map((h) => yearOf(h.purchaseDate)));
  const max = Math.max(...state.holdings.map((h) => yearOf(h.maturity)));
  const out = [];
  for (let y = Math.max(min, now - 5); y <= Math.min(max, now + 10); y++) out.push(y);
  return out.length ? out : [now];
}

// ---- Ortak parçalar --------------------------------------------------------

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}

function meter(label, value, limit) {
  const ratio = limit ? value / limit : 0;
  const cls = ratio > 1 ? "over" : ratio > 0.8 ? "near" : "";
  return `<div class="meter">
    <div class="meter-row"><span>${esc(label)}</span><span class="num">${fmtTL(value)} / ${fmtTL(limit)}</span></div>
    <div class="bar ${cls}"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div>
  </div>`;
}

const fxBadge = (it) => {
  if (it.missingFx) return `<span class="pill bad">kur yok</span>`;
  if (it.detail.fxSource === "current") return `<span class="pill warn">güncel kur</span>`;
  if (it.detail.fxSource && it.detail.fxSource !== "exact") return `<span class="pill">${fmtDate(it.detail.fxSource)} kuru</span>`;
  return "";
};

function figures(list) {
  return `<div class="figures">${list.map(([k, v, key]) => `<div class="fig${key ? " key" : ""}"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>`;
}

// ---- Sekmeler --------------------------------------------------------------

const TABS = [
  ["kupon", "Kupon vergisi"],
  ["sat", "Bugün satarsam"],
  ["portfoy", "Portföy"],
  ["veri", "Kur ve Yİ-ÜFE"],
  ["kurallar", "Kurallar"],
];

function render() {
  $("#instr").innerHTML = INSTRUMENTS.map((i) =>
    `<button data-act="instr" data-id="${i.id}" class="${i.id === state.instrument ? "on" : ""}" ${i.enabled ? "" : "disabled title=\"Yakında\""}>${esc(i.short)}${i.enabled ? "" : " · yakında"}</button>`).join("");
  $("#tabs").innerHTML = TABS.map(([id, label]) =>
    `<button role="tab" data-act="tab" data-id="${id}" class="${state.tab === id ? "on" : ""}" aria-selected="${state.tab === id}">${label}</button>`).join("");
  const view = { kupon: viewCoupons, sat: viewSale, portfoy: viewPortfolio, veri: viewData, kurallar: viewRules }[state.tab];
  $("#main").innerHTML = (state.sample ? sampleBanner() : "") + view();
}

function sampleBanner() {
  return `<div class="banner"><span><b>Örnek portföy ve örnek kurlar gösteriliyor.</b> Kendi portföyünü Portföy sekmesinden yükle.</span>
    <span class="btns"><button class="btn tiny" data-act="tab" data-id="portfoy">Portföyümü yükle</button></span></div>`;
}

// ---- Kupon vergisi ---------------------------------------------------------

function taxOptsForm() {
  const o = state.taxOpts;
  return `<details class="panel"><summary>Diğer gelirlerim (vergi dilimi ve sınır hesabı için)</summary>
    <div class="form-row" style="margin-top:12px">
      <label class="f">Aynı yıl beyan edilecek diğer gelirler (₺)
        <input type="text" inputmode="decimal" id="o-matrah" data-opt="otherMatrahTL" value="${o.otherMatrahTL || ""}" placeholder="0"></label>
      <label class="f">Diğer tevkifatlı MSİ / GMSİ (₺)
        <input type="text" inputmode="decimal" id="o-tevk" data-opt="otherTevkifatliTL" value="${o.otherTevkifatliTL || ""}" placeholder="0"></label>
      <label class="f">Diğer tevkifatsız MSİ / GMSİ (₺)
        <input type="text" inputmode="decimal" id="o-tevksiz" data-opt="otherTevkifatsizTL" value="${o.otherTevkifatsizTL || ""}" placeholder="0"></label>
    </div>
    <p class="small muted">Örn. kira geliri, serbest meslek kazancı veya birden fazla işverenden alınan ücret gibi beyana girecek gelirler. Bunlar eurobond gelirini daha yüksek dilime taşır. Mevduat faizi ve fon getirisi gibi stopajla nihai vergilenen gelirleri yazma.</p>
  </details>`;
}

function reportSummary(rep) {
  const r = rep.rules;
  return `${figures([
    ["Yıl içi kupon / MSİ", fmtTL(rep.tevkifatli.total + rep.tevkifatsiz.total)],
    ["Beyana giren matrah", fmtTL(rep.matrah)],
    ["Hesaplanan vergi", fmtTL(rep.grossTax)],
    ["Ödenecek vergi (tahmini)", fmtTL(rep.netTax), true],
    ["Marjinal oran", fmtPct(rep.marginal, 0)],
    ["Matraha göre efektif", fmtPct(rep.effective)],
  ])}
  <div class="grid2">
    <div class="panel">
      <h3>Beyan sınırları · ${rep.year}${r.estimated ? ` <span class="pill warn">${r.baseYear} parametreleri</span>` : ""}</h3>
      ${meter("Tevkifatlı MSİ (Hazine/TR şirket eurobond) – GVK 86/1-c", rep.tevkifatli.test, rep.tevkifatli.limit)}
      <p class="small">${rep.tevkifatli.total ? (rep.tevkifatli.declare
        ? `<span class="pill bad">Beyan gerekli</span> Sınır aşıldı; bu gruptaki tüm gelir beyan edilir.`
        : `<span class="pill ok">Beyan yok</span> Sınırın altında; beyan edilmez.`) : `<span class="muted">Bu yıl gelir yok.</span>`}</p>
      ${meter("Tevkifatsız MSİ (yabancı ihraççı) – GVK 86/1-d", rep.tevkifatsiz.test, rep.tevkifatsiz.limit)}
      <p class="small">${rep.tevkifatsiz.total ? (rep.tevkifatsiz.declare
        ? `<span class="pill bad">Beyan gerekli</span> Sınır aşıldı.` : `<span class="pill ok">Beyan yok</span>`) : `<span class="muted">Bu yıl gelir yok.</span>`}</p>
      ${rep.dak.count ? `<p class="small">Değer artış kazancı (net): <b class="num">${fmtTL(rep.dak.net)}</b> <span class="pill bad">Tutarı ne olursa olsun beyan</span></p>` : ""}
    </div>
    <div class="panel">
      <h3>Beyan</h3>
      <div class="kv" style="grid-template-columns:1fr">
        <div><span>Beyan dönemi</span><b>${esc(r.beyanDonemi)}</b></div>
        <div><span>Diğer beyan edilen gelir</span><b>${fmtTL(rep.other)}</b></div>
        <div><span>Mahsup: TR stopaj</span><b>${fmtTL(rep.withheld)}</b></div>
        <div><span>Mahsup: yurt dışı vergi</span><b>${fmtTL(rep.foreignCredit)}</b></div>
        <div class="strong"><span>Eurobond kaynaklı ek vergi</span><b>${fmtTL(rep.netTax)}</b></div>
      </div>
      <p class="small muted">Vergi, diğer gelirlerin üzerine eklenen kısım olarak hesaplanır (artımlı). Ödeme Mart ve Temmuz'da iki eşit taksittir.</p>
    </div>
  </div>
  ${rep.warnings.length ? `<ul class="notes">${rep.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`;
}

function viewCoupons() {
  if (!state.holdings.length) return emptyPortfolio();
  const years = yearRange();
  if (!years.includes(state.year)) state.year = years.includes(yearOf(todayISO())) ? yearOf(todayISO()) : years[0];
  const rep = annualReport(allItems(), state.year, { ...state.taxOpts });
  const items = [...rep.items].sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();
  const byH = Object.fromEntries(state.holdings.map((h) => [h.id, h]));
  return `<section class="panel">
      <div class="panel-head"><h2>Kupon gelirleri ve yıllık vergi</h2>
        <label class="f" style="grid-auto-flow:column;align-items:center">Vergi yılı
          <select id="year" data-act="year">${years.map((y) => `<option ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>
      </div>
      <p class="small muted">${esc(rep.rules.note)} Vadesine kadar elde tutma varsayımı.</p>
    </section>
    ${reportSummary(rep)}
    ${taxOptsForm()}
    <section class="panel">
      <h3>${state.year} kupon takvimi</h3>
      ${items.length ? `<div class="tbl"><table>
        <thead><tr><th>Tarih</th><th>Tahvil</th><th>Tür</th><th class="num">Döviz tutar</th><th class="num">Kur</th><th class="num">TL karşılığı</th><th>Vergi sınıfı</th></tr></thead>
        <tbody>${items.map((it) => `<tr class="${it.date > today ? "future" : ""}">
          <td class="num" style="text-align:left">${fmtDate(it.date)}</td>
          <td>${esc(byH[it.holdingId]?.name)}<span class="sub">${esc(byH[it.holdingId]?.isin)}</span></td>
          <td>${it.kind === "itfa" ? "İtfa farkı" : "Kupon"}${it.date > today ? ` <span class="pill">beklenen</span>` : ""}</td>
          <td class="num">${fmtCcy(it.detail.amountFx, it.detail.currency)}</td>
          <td class="num">${fmtNum(it.detail.fx, 4)} ${fxBadge(it)}</td>
          <td class="num">${fmtTL(it.amountTL)}</td>
          <td><span class="pill ${it.taxClass === "DAK" ? "bad" : "acc"}">${it.taxClass === "MSI_TEVKIFATSIZ" ? "MSİ · 86/1-d" : it.taxClass === "DAK" ? "DAK" : "MSİ · 86/1-c"}</span></td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="5">Toplam</td><td class="num">${fmtTL(items.reduce((a, i) => a + i.amountTL, 0))}</td><td></td></tr></tfoot>
      </table></div>` : `<p class="muted">Bu yıl kupon ödemesi yok.</p>`}
      <p class="small muted">Kupon TL karşılığı ödeme günündeki TCMB döviz alış kuruyla bulunur. Gelecek kuponlar ve kuru girilmemiş günler güncel kurla tahmin edilir. Eksik kurları Kur ve Yİ-ÜFE sekmesinden gir.</p>
    </section>`;
}

// ---- Bugün satarsam --------------------------------------------------------

function saleState() {
  const s = state.sale;
  s.date ||= todayISO();
  for (const c of currencies()) if (s.fx[c] == null) s.fx[c] = getFx(state.market, c, s.date).rate ?? null;
  for (const h of state.holdings) {
    if (s.sel[h.id] == null) s.sel[h.id] = true;
    if (s.price[h.id] == null && h.currentPrice != null) s.price[h.id] = h.currentPrice;
  }
  return s;
}

function viewSale() {
  if (!state.holdings.length) return emptyPortfolio();
  const s = saleState();
  const c = ctx();
  const year = yearOf(s.date);
  const live = state.holdings.filter((h) => h.maturity > s.date && h.purchaseDate < s.date);
  const results = live.map((h) => {
    const inst = instrument(h.instrument);
    const p = {
      date: s.date, cleanPrice: s.price[h.id], fx: s.fx[h.currency],
      ufeBuy: state.market.ufe[prevMonth(h.purchaseDate)], ufeSell: state.market.ufe[prevMonth(s.date)],
    };
    return { h, p, ...inst.saleScenario(h, p, c) };
  });
  const selected = results.filter((r) => s.sel[r.h.id]);
  const base = allItems();
  const saleItems = [
    ...state.holdings.filter((h) => !selected.some((r) => r.h.id === h.id)).flatMap((h) => instrument(h.instrument).incomeItems(h, c)),
    ...selected.flatMap((r) => r.items),
  ];
  const cmp = compareScenarios(base, saleItems, year, { ...state.taxOpts });
  const okSel = selected.filter((r) => !r.detail.errors.some((e) => !e.startsWith("Yİ-ÜFE")));
  const proceeds = okSel.reduce((a, r) => a + r.detail.proceedsTL, 0);
  const gain = okSel.reduce((a, r) => a + r.detail.gainTL, 0);
  const ufeMonths = [...new Set(live.flatMap((h) => [prevMonth(h.purchaseDate), prevMonth(s.date)]))].sort();

  return `<section class="panel">
    <div class="panel-head"><h2>Bugün satarsam ne kadar vergi öderim?</h2></div>
    <p class="small muted">Seçili eurobondları aşağıdaki fiyat ve kurla sattığında oluşan değer artış kazancı ile ${year} yılı vergini, vadeye kadar tutma senaryosuyla karşılaştırır.</p>
    <div class="form-row">
      <label class="f">Satış (valör) tarihi<input type="date" id="s-date" data-sale="date" value="${s.date}"></label>
      ${currencies().map((cc) => `<label class="f">${cc}/TRY satış kuru<input type="text" inputmode="decimal" id="s-fx-${cc}" data-sale-fx="${cc}" value="${s.fx[cc] ?? ""}" placeholder="TCMB döviz alış"></label>`).join("")}
      ${ufeMonths.map((m) => `<label class="f">Yİ-ÜFE ${m}<input type="text" inputmode="decimal" id="s-ufe-${m}" data-ufe="${m}" value="${state.market.ufe[m] ?? ""}" placeholder="TÜİK endeks"></label>`).join("")}
    </div>
    <p class="small muted">Endeksleme için alış ve satış aylarından bir önceki ayın Yİ-ÜFE değerleri gerekir (TÜİK, 2003=100). Artış %10'un altındaysa endeksleme yapılmaz.</p>
  </section>
  ${figures([
    ["Satış tutarı (seçili)", fmtTL(proceeds)],
    ["Değer artış kazancı", fmtTL(gain)],
    [`${year} vergisi · tutarsam`, fmtTL(cmp.hold.netTax)],
    [`${year} vergisi · satarsam`, fmtTL(cmp.sell.netTax)],
    ["Satışın vergi etkisi", `${cmp.deltaTax >= 0 ? "+" : ""}${fmtTL(cmp.deltaTax)}`, true],
    ["Vergi sonrası eline geçen", fmtTL(proceeds - Math.max(0, cmp.deltaTax))],
  ])}
  <p class="small muted">Vergi etkisi, satıştan sonraki ${year} kuponlarından vazgeçmeyi de içerir: satarsan o kuponlar artık senin gelirin olmaz. ${cmp.sell.tevkifatli.declare !== cmp.hold.tevkifatli.declare ? `<b>Dikkat:</b> satış, kupon gelirinin beyan sınırını aşıp aşmamasını değiştiriyor.` : ""}</p>
  ${cmp.sell.warnings.length ? `<ul class="notes">${cmp.sell.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
  <section class="sale-list">${results.map(saleCard).join("") || `<p class="muted">Bu tarihte satılabilecek pozisyon yok.</p>`}</section>`;
}

function saleCard(r) {
  const { h, detail: d } = r;
  const on = state.sale.sel[h.id];
  const sign = (v) => `<b class="${v >= 0 ? "pos" : "neg"}">${fmtTL(v)}</b>`;
  return `<article class="sale ${on ? "" : "off"}">
    <div class="sale-head">
      <label class="check"><input type="checkbox" id="sel-${h.id}" data-sel="${h.id}" ${on ? "checked" : ""}> <span class="t">${esc(h.name)}</span></label>
      <span class="pill">${esc(h.currency)} ${fmtNum(h.nominal, 0)}</span>
      <label class="f" style="grid-auto-flow:column;align-items:center">Temiz fiyat %
        <input class="cell" type="text" inputmode="decimal" id="px-${h.id}" data-price="${h.id}" value="${state.sale.price[h.id] ?? ""}" placeholder="ör. 101,5"></label>
    </div>
    ${d.errors.length ? `<ul class="notes">${d.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="kv">
      <div><span>Alış: ${fmtDate(h.purchaseDate)} · %${fmtNum(h.purchasePrice, 3)}</span><b>${fmtCcy(d.costFx, h.currency)}</b></div>
      <div><span>Alış kuru</span><b>${fmtNum(d.buyFx, 4)}</b></div>
      <div><span>Maliyet (TL)</span><b>${fmtTL(d.costTL)}</b></div>
      <div><span>Satış bedeli (döviz)</span><b>${fmtCcy(d.proceedsFx, h.currency)}</b></div>
      <div><span>İşlemiş faiz (satış)</span><b>${fmtCcy(d.sellAccrued, h.currency)}</b></div>
      <div><span>Satış bedeli (TL)</span><b>${fmtTL(d.proceedsTL)}</b></div>
      <div><span>Yİ-ÜFE ${d.ufeBuyMonth} → ${d.ufeSellMonth}</span><b>${d.ufeRatio ? fmtPct(d.ufeRatio - 1) : "–"}</b></div>
      <div><span>Endekslenmiş maliyet ${d.indexed ? `<span class="pill ok">uygulandı</span>` : `<span class="pill">yok</span>`}</span><b>${fmtTL(d.indexedCostTL)}</b></div>
      <div class="strong"><span>Değer artış kazancı</span>${sign(d.gainTL)}</div>
      <div><span>…fiyat etkisi</span>${sign(d.priceEffectTL)}</div>
      <div><span>…kur etkisi</span>${sign(d.fxEffectTL)}</div>
      <div><span>…endeksleme indirimi</span><b>${fmtTL(-d.indexBenefitTL)}</b></div>
    </div>
  </article>`;
}

// ---- Portföy ---------------------------------------------------------------

function emptyPortfolio() {
  return `<section class="panel"><h2>Portföy boş</h2><p class="muted">Eurobond portföyünü yapıştırarak ya da dosya seçerek yükle.</p>
    <div class="btns"><button class="btn" data-act="tab" data-id="portfoy">Portföy yükle</button><button class="btn ghost" data-act="sample">Örnek portföyü göster</button></div></section>`;
}

function viewPortfolio() {
  const inst = instrument(state.instrument);
  const rows = state.holdings.filter((h) => h.instrument === inst.id);
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(inst.label)} portföyü</h2>
      <div class="btns">${rows.length ? `<button class="btn ghost tiny" data-act="export-csv">CSV olarak kopyala</button><button class="btn danger tiny" data-act="clear">Portföyü temizle</button>` : ""}</div></div>
    ${rows.length ? `<div class="tbl"><table>
      <thead><tr><th>Tahvil</th><th>İhraççı</th><th class="num">Nominal</th><th class="num">Kupon</th><th>Vade</th><th>Alış</th><th class="num">Alış fiyatı</th><th class="num">Alış kuru</th><th class="num">Kalan kupon</th><th></th></tr></thead>
      <tbody>${rows.map((h) => {
        const pf = getFx(state.market, h.currency, h.purchaseDate);
        const fx = h.purchaseFx ?? (pf.source === "current" ? null : pf.rate);
        const left = couponsAfterPurchase(h).filter((d) => d > todayISO()).length;
        return `<tr><td>${esc(h.name)}<span class="sub">${esc(h.isin)} · ${h.dayCount}</span></td>
          <td>${esc(inst.describe(h).badges[0])}</td>
          <td class="num">${fmtCcy(h.nominal, h.currency)}</td>
          <td class="num">%${fmtNum(h.couponRate, 3)} × ${h.frequency}</td>
          <td class="num" style="text-align:left">${fmtDate(h.maturity)}</td>
          <td class="num" style="text-align:left">${fmtDate(h.purchaseDate)}</td>
          <td class="num">%${fmtNum(h.purchasePrice, 3)}</td>
          <td class="num">${fx ? fmtNum(fx, 4) : `<span class="pill bad">eksik</span>`}</td>
          <td class="num">${left}</td>
          <td><button class="btn danger tiny" data-act="del" data-id="${h.id}" aria-label="${esc(h.name)} sil">Sil</button></td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="muted">Henüz ${esc(inst.label.toLowerCase())} yok.</p>`}
  </section>
  <section class="panel">
    <h2>Portföy yükle</h2>
    <p class="small muted">Her satır bir alım (lot). Aynı ISIN'i farklı tarihlerde aldıysan ayrı satır yaz. Ayraç <code>;</code>, <code>,</code> ya da sekme olabilir; Excel'den kopyala-yapıştır da olur. Ondalık için virgül ya da nokta kullanabilirsin.</p>
    <textarea id="imp-text" spellcheck="false" placeholder="${esc(inst.csvTemplate)}"></textarea>
    <div class="btns">
      <button class="btn" data-act="import" data-mode="replace">Yükle (mevcutların yerine)</button>
      <button class="btn ghost" data-act="import" data-mode="append">Mevcutlara ekle</button>
      <label class="btn ghost" for="imp-file">Dosya seç (.csv / .json)</label>
      <input type="file" id="imp-file" accept=".csv,.txt,.tsv,.json" hidden>
      <button class="btn ghost" data-act="template">Şablonu kopyala</button>
    </div>
    <div id="imp-msg"></div>
    <details><summary>Sütunlar</summary>
      <div class="tbl" style="margin-top:10px"><table><thead><tr><th>Sütun</th><th>Anlamı</th><th>Örnek</th><th></th></tr></thead>
      <tbody>${inst.csvColumns.map((c) => `<tr><td><code>${c.key}</code></td><td>${esc(c.label)}${c.help ? `<span class="sub">${esc(c.help)}</span>` : ""}</td><td><code>${esc(c.example)}</code></td><td>${c.required ? `<span class="pill acc">zorunlu</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
    </details>
  </section>`;
}

function doImport(text, mode) {
  text = text.trim();
  if (!text) return toast("Önce portföy metnini yapıştır.");
  let rows;
  try {
    rows = text.startsWith("[") || text.startsWith("{") ? [].concat(JSON.parse(text)) : parseCSV(text);
  } catch (e) {
    return showImportMsg([`Okunamadı: ${e.message}`]);
  }
  // JSON yedeği (tam durum) ise geri yükle.
  if (rows.length === 1 && rows[0].holdings && rows[0].market) {
    state = { ...defaultState(), ...rows[0], tab: "portfoy" };
    save(); render();
    return toast("Yedek geri yüklendi.");
  }
  const { holdings, errors } = importRows(rows, state.instrument);
  if (!holdings.length) return showImportMsg(errors.length ? errors : ["Satır bulunamadı. İlk satır sütun başlıkları olmalı."]);
  if (state.sample) { state.holdings = []; state.market.fxCurrent = {}; state.sample = false; }
  state.holdings = mode === "append" ? [...state.holdings, ...holdings] : [...state.holdings.filter((h) => h.instrument !== state.instrument), ...holdings];
  state.sale = defaultState().sale;
  save(); render();
  showImportMsg(errors, `${holdings.length} pozisyon yüklendi.`);
}

function showImportMsg(errors, ok) {
  $("#imp-msg").innerHTML = `${ok ? `<p class="small"><span class="pill ok">Tamam</span> ${esc(ok)}</p>` : ""}${errors.length ? `<ul class="notes">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}`;
}

function exportCSV() {
  const inst = instrument(state.instrument);
  const keys = inst.csvColumns.map((c) => c.key);
  const num = (v) => (v == null ? "" : String(v).replace(".", ","));
  const lines = state.holdings.filter((h) => h.instrument === inst.id).map((h) => [
    h.isin, h.name, h.issuer, h.currency, num(h.nominal), num(h.couponRate), h.frequency, h.maturity, h.purchaseDate,
    num(h.purchasePrice), num(h.purchaseFx), num(h.purchaseAccrued), num(h.currentPrice), num(h.withholding * 100), num(h.foreignTax * 100), h.dayCount,
  ].join(";"));
  return [keys.join(";"), ...lines].join("\n");
}

// ---- Kur ve Yİ-ÜFE ---------------------------------------------------------

function missingFx() {
  const today = todayISO();
  const need = new Map();
  for (const h of state.holdings) {
    const pf = getFx(state.market, h.currency, h.purchaseDate);
    if (h.purchaseFx == null && (pf.source == null || pf.source === "current")) need.set(`${h.currency}|${h.purchaseDate}`, `${h.name} alış`);
    for (const d of couponsAfterPurchase(h)) {
      if (d > today) break;
      const fx = getFx(state.market, h.currency, d);
      if (fx.source == null || fx.source === "current") need.set(`${h.currency}|${d}`, `${h.name} kupon`);
    }
  }
  return [...need.entries()].sort((a, b) => a[0].slice(4).localeCompare(b[0].slice(4)));
}

function viewData() {
  const ccys = currencies();
  const miss = missingFx();
  const fxRows = ccys.flatMap((c) => Object.entries(state.market.fx[c] || {}).map(([d, r]) => [c, d, r])).sort((a, b) => b[1].localeCompare(a[1]));
  const ufeRows = Object.entries(state.market.ufe).sort((a, b) => b[0].localeCompare(a[0]));
  return `<section class="panel">
    <h2>Güncel kur</h2>
    <p class="small muted">Gelecek kuponlar ve kuru girilmemiş günler için kullanılır.</p>
    <div class="form-row">${ccys.map((c) => `<label class="f">${c}/TRY<input type="text" inputmode="decimal" id="cur-${c}" data-cur="${c}" value="${state.market.fxCurrent[c] ?? ""}"></label>`).join("") || `<p class="muted">Portföy boş.</p>`}</div>
    <div class="btns"><button class="btn ghost" data-act="ecb-latest">Güncel kuru internetten çek (yaklaşık)</button></div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Eksik tarihli kurlar</h2>${miss.length ? `<span class="pill warn">${miss.length} eksik</span>` : `<span class="pill ok">Tamam</span>`}</div>
    <p class="small muted">Alış günleri ve geçmiş kupon ödeme günleri için TCMB döviz alış kuru. Resmi beyanda TCMB kuru kullanılmalı; internetten çekilen ECB kurları yaklaşıktır.</p>
    ${miss.length ? `<div class="tbl"><table><thead><tr><th>Tarih</th><th>Para</th><th>Neden</th><th class="num">Kur</th></tr></thead><tbody>
      ${miss.map(([k, why]) => { const [c, d] = k.split("|"); return `<tr><td class="num" style="text-align:left">${fmtDate(d)}</td><td>${c}</td><td>${esc(why)}</td>
        <td class="num"><input class="cell" type="text" inputmode="decimal" id="fx-${c}-${d}" data-fx="${k}" placeholder="0,0000"></td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="btns"><button class="btn ghost" data-act="ecb-hist">Eksikleri internetten doldur (ECB, yaklaşık)</button></div>` : ""}
    <details><summary>Toplu kur yapıştır</summary>
      <p class="small muted" style="margin:8px 0">Her satır: <code>tarih;para;kur</code> — ör. <code>26.04.2026;USD;38,1234</code></p>
      <textarea id="fx-text" spellcheck="false"></textarea>
      <div class="btns" style="margin-top:8px"><button class="btn ghost" data-act="fx-import">Kurları ekle</button></div>
    </details>
    ${fxRows.length ? `<details><summary>Kayıtlı kurlar (${fxRows.length})</summary><div class="tbl" style="margin-top:8px;max-height:320px"><table><tbody>
      ${fxRows.map(([c, d, r]) => `<tr><td class="num" style="text-align:left">${fmtDate(d)}</td><td>${c}</td><td class="num">${fmtNum(r, 4)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  </section>
  <section class="panel">
    <h2>Yİ-ÜFE endeksi (2003=100)</h2>
    <p class="small muted">Satış kazancında maliyeti endekslemek için. Değerleri TÜİK'in Yurt İçi Üretici Fiyat Endeksi tablosundan al. Her satır: <code>yıl-ay;endeks</code> — ör. <code>2025-09;4123,45</code></p>
    <textarea id="ufe-text" spellcheck="false" placeholder="2024-02;3216,04">${ufeRows.map(([m, v]) => `${m};${String(v).replace(".", ",")}`).join("\n")}</textarea>
    <div class="btns"><button class="btn ghost" data-act="ufe-import">Kaydet</button></div>
  </section>`;
}

async function ecbLatest() {
  try {
    for (const c of currencies()) {
      const r = await fetchEcbLatest(c);
      if (r) state.market.fxCurrent[c] = Math.round(r * 10000) / 10000;
    }
    state.sale.fx = {};
    save(); render(); toast("Güncel kurlar güncellendi (ECB referans).");
  } catch (e) { toast(`Kur alınamadı: ${e.message}`); }
}

async function ecbHistory() {
  const miss = missingFx();
  const byC = {};
  for (const [k] of miss) { const [c, d] = k.split("|"); (byC[c] ||= []).push(d); }
  try {
    let n = 0;
    for (const [c, dates] of Object.entries(byC)) {
      const from = dates.reduce((a, b) => (a < b ? a : b));
      const back = new Date(`${from}T00:00:00Z`); back.setUTCDate(back.getUTCDate() - 7);
      const rates = await fetchEcbRates(c, back.toISOString().slice(0, 10));
      const days = Object.keys(rates).sort();
      for (const d of dates) {
        const use = days.filter((x) => x <= d).pop();
        if (use) { setFx(state.market, c, d, Math.round(rates[use] * 10000) / 10000); n++; }
      }
    }
    save(); render(); toast(`${n} kur dolduruldu (ECB, yaklaşık).`);
  } catch (e) { toast(`Kur alınamadı: ${e.message}`); }
}

// ---- Kurallar --------------------------------------------------------------

function viewRules() {
  const s = state.settings;
  return `<section class="panel">
    <h2>Vergi parametreleri</h2>
    <div class="tbl"><table>
      <thead><tr><th>Yıl</th><th>Gelir dilimleri (ücret dışı)</th><th class="num">86/1-c sınırı</th><th class="num">86/1-d sınırı</th><th>Beyan</th></tr></thead>
      <tbody>${YEARS.map((y) => { const r = RULES[y]; let prev = 0; return `<tr><td>${y}</td>
        <td class="small">${r.brackets.map(([l, rate]) => { const t = `${fmtNum(prev, 0)}–${l === Infinity ? "" : fmtNum(l, 0)}: %${rate * 100}`; prev = l; return t; }).join("<br>")}</td>
        <td class="num">${fmtTL(r.msiTevkifatliLimit)}</td><td class="num">${fmtTL(r.msiTevkifatsizLimit)}</td><td>${esc(r.beyanDonemi)}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="small muted">Tanımlı olmayan yıllar için en yakın yılın parametreleri kullanılır ve sonuç "tahmini" olarak işaretlenir. Yeni yıl: <code>js/tax/rules.js</code>.</p>
  </section>
  <section class="panel">
    <h2>Hesaplama tercihleri</h2>
    <label class="check"><input type="checkbox" id="set-accrued" data-set="islemisFaizBedele" ${s.islemisFaizBedele ? "checked" : ""}>
      <span>İşlemiş faizi alış ve satış bedeline dahil et (kirli fiyat). Kapalıysa yalnızca temiz fiyat kullanılır.</span></label>
    <label class="f">İskontolu alınıp vadede itfa edilen tahvilde (alış &lt; %100) itfa farkı
      <select id="set-itfa" data-set="itfaIskonto">
        ${[["msi", "Menkul sermaye iradı (döviz farkı × itfa kuru)"], ["dak", "Değer artış kazancı"], ["yok", "Vergilendirme"]].map(([v, l]) => `<option value="${v}" ${s.itfaIskonto === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></label>
    <p class="small muted">İtfada anaparanın kur farkı vergilenmez. İskonto farkının niteliği konusunda farklı özelgeler var; mali müşavirinle teyit et.</p>
  </section>
  <section class="panel prose">
    <h2>Eurobond vergilendirmesi (tam mükellef gerçek kişi)</h2>
    <ul>
      <li><b>Kupon faizi</b> menkul sermaye iradıdır (GVK 75/2-5). Hazine eurobondlarında stopaj oranı %0'dır ama gelir "tevkifata tabi" sayılır; yıllık toplamı ${fmtTL(RULES[2026].msiTevkifatliLimit)} (2026; 2025 için ${fmtTL(RULES[2025].msiTevkifatliLimit)}) sınırını aşarsa tamamı beyan edilir (GVK 86/1-c). Bu sınıra diğer stopajlı menkul ve gayrimenkul sermaye iratları da katılır.</li>
      <li><b>Yabancı ihraççı tahvilleri</b> (ör. ABD hazine tahvili) stopaja tabi değildir; toplamı ${fmtTL(RULES[2026].msiTevkifatsizLimit)} (2026) sınırını aşarsa beyan edilir. Yurt dışında ödenen vergi, o gelire düşen Türk vergisi kadar mahsup edilir (GVK 123).</li>
      <li><b>Kur:</b> Döviz kupon, tahsil edildiği günün TCMB döviz alış kuruyla TL'ye çevrilir.</li>
      <li><b>Satış kazancı</b> değer artış kazancıdır (GVK mük. 80). Alış ve satış bedelleri işlem günlerinin kuruyla TL'ye çevrilir; kur farkı kazanca dahildir. Yİ-ÜFE artışı %10 ve üzeriyse maliyet, alış ve satış aylarından bir önceki ayın endeksiyle artırılır (GVK mük. 81). Kazanç, tutarı ne olursa olsun beyan edilir; ${fmtTL(RULES[2026].dakIstisna)} istisnası menkul kıymetlere uygulanmaz. Yıl içindeki satış zararları aynı yılın değer artış kazançlarından düşülür.</li>
      <li><b>Vadede itfa</b> elden çıkarma sayılmaz; anaparadaki kur farkı vergilenmez.</li>
      <li><b>Vergi</b> GVK 103 tarifesiyle, varsa diğer beyan edilen gelirlerin üzerine eklenerek hesaplanır. Beyanname ertesi yılın Mart ayında verilir; vergi Mart ve Temmuz'da iki taksitte ödenir.</li>
    </ul>
    <p class="small muted">Kaynak: GİB, Menkul Sermaye İradı Elde Eden Gerçek Kişiler İçin Vergi Rehberi (Şubat 2026); GVK md. 75, 76, 86, 103, 123, mük. 80, 81; 2026 yılı gelir vergisi tarifesi. Bu araç bilgi amaçlıdır; beyan öncesi mali müşavir görüşü al.</p>
  </section>
  <section class="panel">
    <h2>Yedek</h2>
    <p class="small muted">Tüm veriler yalnızca bu tarayıcıda saklanır.</p>
    <div class="btns"><button class="btn ghost" data-act="backup">Yedeği panoya kopyala (JSON)</button><button class="btn danger" data-act="reset">Her şeyi sil</button></div>
    <p class="small muted">Geri yüklemek için yedeği Portföy sekmesindeki kutuya yapıştırıp Yükle'ye bas.</p>
  </section>`;
}

// ---- Olaylar ---------------------------------------------------------------

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = $("#imp-text");
    if (ta) { ta.value = text; ta.select(); toast("Kopyalanamadı; metin kutuya yazıldı, oradan kopyala."); }
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.tagName === "SELECT") return;
  const act = b.dataset.act;
  if (act === "tab") { state.tab = b.dataset.id; save(); render(); window.scrollTo(0, 0); }
  else if (act === "instr") { state.instrument = b.dataset.id; save(); render(); }
  else if (act === "import") doImport($("#imp-text").value, b.dataset.mode);
  else if (act === "template") copy(instrument(state.instrument).csvTemplate, "Şablon kopyalandı.");
  else if (act === "export-csv") copy(exportCSV(), "Portföy CSV olarak kopyalandı.");
  else if (act === "backup") copy(JSON.stringify(state), "Yedek panoya kopyalandı.");
  else if (act === "del") { state.holdings = state.holdings.filter((h) => h.id !== b.dataset.id); save(); render(); }
  else if (act === "clear") {
    if (b.dataset.confirm) { state.holdings = state.holdings.filter((h) => h.instrument !== state.instrument); state.sample = false; save(); render(); }
    else { b.dataset.confirm = "1"; b.textContent = "Emin misin? Tekrar bas"; }
  }
  else if (act === "reset") {
    if (b.dataset.confirm) { state = defaultState(); save(); render(); toast("Tüm veriler silindi."); }
    else { b.dataset.confirm = "1"; b.textContent = "Emin misin? Tekrar bas"; }
  }
  else if (act === "sample") { state = { ...sampleState(), tab: "kupon" }; save(); render(); }
  else if (act === "fx-import") { const n = importFxText(state.market, $("#fx-text").value); save(); render(); toast(`${n} kur eklendi.`); }
  else if (act === "ufe-import") { state.market.ufe = {}; const n = importUfeText(state.market, $("#ufe-text").value); save(); render(); toast(`${n} endeks kaydedildi.`); }
  else if (act === "ecb-latest") ecbLatest();
  else if (act === "ecb-hist") ecbHistory();
});

document.addEventListener("change", (e) => {
  const t = e.target;
  const d = t.dataset;
  if (t.id === "year") state.year = Number(t.value);
  else if (d.opt) state.taxOpts[d.opt] = parseNum(t.value) || 0;
  else if (d.sale === "date") { state.sale.date = normDate(t.value) || todayISO(); state.sale.fx = {}; }
  else if (d.saleFx) state.sale.fx[d.saleFx] = parseNum(t.value);
  else if (d.ufe) { const v = parseNum(t.value); if (v) state.market.ufe[d.ufe] = v; else delete state.market.ufe[d.ufe]; }
  else if (d.sel) state.sale.sel[d.sel] = t.checked;
  else if (d.price) state.sale.price[d.price] = parseNum(t.value);
  else if (d.cur) { state.market.fxCurrent[d.cur] = parseNum(t.value); state.sale.fx = {}; }
  else if (d.fx) { const [c, dt] = d.fx.split("|"); const v = parseNum(t.value); if (v) setFx(state.market, c, dt, v); }
  else if (d.set) state.settings[d.set] = t.type === "checkbox" ? t.checked : t.value;
  else if (t.id === "imp-file") {
    const f = t.files[0];
    if (f) f.text().then((txt) => { $("#imp-text").value = txt; doImport(txt, "replace"); });
    return;
  } else return;
  save();
  render();
});

state = load();
render();
