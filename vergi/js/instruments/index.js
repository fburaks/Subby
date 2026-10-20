// Enstrüman kayıt defteri. Yeni bir enstrüman (hisse, fon, mevduat, kripto...) eklemek için
// aynı arayüzü uygulayan bir modül yazıp burada register etmek yeterli.
//
// Enstrüman arayüzü:
//   id, label, short, enabled
//   csvColumns: [{ key, label, required, example, help }]
//   fromRow(row, ctx)  → { holding, errors[] }       içe aktarılan satırı pozisyona çevirir
//   describe(holding)  → { title, sub, badges[] }
//   incomeItems(holding, ctx)        → gelir kalemleri (elde tutma senaryosu)
//   saleScenario(holding, params, ctx) → { items, detail }  "bugün satarsam" senaryosu
//   saleInputs(holding, ctx)         → satış formunda istenecek alanlar ve varsayılanlar

import eurobond from "./eurobond.js";

const placeholder = (id, label, short) => ({ id, label, short, enabled: false });

export const INSTRUMENTS = [
  eurobond,
  placeholder("hisse", "Hisse senedi (BIST / yurt dışı)", "Hisse"),
  placeholder("fon", "Yatırım fonu", "Fon"),
  placeholder("mevduat", "Mevduat / DTH", "Mevduat"),
  placeholder("tahvil", "Devlet tahvili / Özel sektör tahvili (TL)", "Tahvil"),
];

export const instrument = (id) => INSTRUMENTS.find((i) => i.id === id);
