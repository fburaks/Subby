import { test } from "node:test";
import assert from "node:assert/strict";
import { incomeTax, rulesFor } from "../js/tax/rules.js";
import { annualReport } from "../js/tax/engine.js";
import eurobond, { schedule, accrued, couponsAfterPurchase, saleCalc } from "../js/instruments/eurobond.js";
import { parseCSV } from "../js/core/csv.js";
import { parseNum } from "../js/core/num.js";
import { addMonths, days30360 } from "../js/core/dates.js";

const r26 = rulesFor(2026);

test("2026 tarifesi", () => {
  assert.equal(incomeTax(190000, r26.brackets), 28500);
  assert.equal(incomeTax(400000, r26.brackets), 28500 + 42000);
  assert.equal(incomeTax(1000000, r26.brackets), 70500 + 162000);
  assert.equal(incomeTax(6000000, r26.brackets), 232500 + 1505000 + 280000);
});

test("sayı ve tarih okuma", () => {
  assert.equal(parseNum("7,625"), 7.625);
  assert.equal(parseNum("1.234.567,89"), 1234567.89);
  assert.equal(parseNum("1,234.5"), 1234.5);
  assert.equal(parseNum("50000"), 50000);
  assert.equal(addMonths("2026-08-31", -6, true), "2026-02-28");
  assert.equal(days30360("2026-04-26", "2026-10-26"), 180);
});

const csv = `isin;ad;ihracci;para;nominal;kupon;siklik;vade;alis_tarihi;alis_fiyati;alis_kuru
XS1;TURKEY 7.625 2029;TR_HAZINE;USD;100000;7,625;2;2029-04-26;2024-03-15;101,25;32,10`;
const { holding: h } = eurobond.fromRow(parseCSV(csv)[0]);
h.id = "a";

test("kupon takvimi ve işlemiş faiz", () => {
  const cs = couponsAfterPurchase(h);
  assert.equal(cs[0], "2024-04-26");
  assert.equal(cs.at(-1), "2029-04-26");
  assert.equal(cs.length, 11);
  // 26.10.2025 → 26.01.2026 = 90 gün / 180 → yarım kupon
  assert.ok(Math.abs(accrued(h, "2026-01-26") - 100000 * 0.07625 / 4) < 1e-9);
  assert.ok(schedule(h, "2026-01-26").includes("2025-10-26"));
});

test("beyan sınırı: altında beyan yok, üstünde tamamı", () => {
  const items = (amt) => [{ date: "2026-04-26", taxClass: "MSI_TEVKIFATLI", amountTL: amt }];
  assert.equal(annualReport(items(399000), 2026).netTax, 0);
  const rep = annualReport(items(401000), 2026);
  assert.equal(rep.matrah, 401000);
  assert.equal(rep.netTax, incomeTax(401000, r26.brackets));
  const ts = annualReport([{ date: "2026-01-01", taxClass: "MSI_TEVKIFATSIZ", amountTL: 23000, foreignTaxTL: 0 }], 2026);
  assert.equal(ts.tevkifatsiz.declare, true);
});

test("DAK her tutarda beyan, diğer gelir üstüne marjinal vergi", () => {
  const rep = annualReport([{ date: "2026-06-01", taxClass: "DAK", amountTL: 10000 }], 2026, { otherMatrahTL: 500000 });
  assert.equal(Math.round(rep.netTax), 2700);
});

test("satış: endeksleme %10 eşiği", () => {
  const market = { fx: {}, fxCurrent: {}, ufe: {} };
  const p = { date: "2026-10-20", cleanPrice: 103, fx: 42, ufeBuy: 100, ufeSell: 150 };
  const d = saleCalc(h, p, { market, settings: {} });
  assert.equal(d.indexed, true);
  assert.ok(Math.abs(d.indexedCostTL - d.costTL * 1.5) < 1e-6);
  const d2 = saleCalc(h, { ...p, ufeSell: 109 }, { market, settings: {} });
  assert.equal(d2.indexed, false);
  assert.equal(d2.gainTL, d2.proceedsTL - d2.costTL);
});

import { fromPortfoyYedek } from "../js/importers/portfoyYedek.js";

test("portföy yedeği: FIFO lotlar ve kur geçmişi", () => {
  const backup = { veri: {
    "portfoy-varliklar": [{ kategori: "Eurobond", ad: "US900123XX11", adet: 15, guncelFiyat: 101, paraBirimi: "USD", kuponOrani: 6.5, kuponSikligi: 2, vadeTarihi: "2035-01-03", hesap: "Banka" }],
    "portfoy-varlik-islemleri": [
      { kategori: "Eurobond", ad: "US900123XX11", tur: "alim", tarih: "2024-01-10T00:00:00.000Z", adet: 10, fiyat: 95 },
      { kategori: "Eurobond", ad: "US900123XX11", tur: "alim", tarih: "2025-02-10T00:00:00.000Z", adet: 10, fiyat: 98 },
      { kategori: "Eurobond", ad: "US900123XX11", tur: "satim", tarih: "2025-06-01T00:00:00.000Z", adet: 5, fiyat: 99 },
    ],
    "portfoy-varlik-fiyat-gecmisi": { "Döviz__USD": [{ tarih: "2026-07-24", fiyat: 47.3 }] },
  } };
  const r = fromPortfoyYedek(backup, { unitNominal: 100 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].nominal, 500);
  assert.equal(r.rows[0].alis_tarihi, "2024-01-10");
  assert.equal(r.rows[1].nominal, 1000);
  assert.equal(r.rows[0].ihracci, "TR_HAZINE");
  assert.equal(r.fx.USD["2026-07-24"], 47.3);
});
