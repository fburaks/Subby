/*
 * FPDF / MPF ayrıştırıcı ve eşleştirici.
 * Tarayıcıda `window.Proses` olarak, Node'da `require()` ile kullanılabilir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Proses = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Varsayılan ayarlar. Sütun numaraları 1'den başlar.
  var DEFAULTS = {
    fpdf: {
      delimiter: ',',
      commentPrefix: '$',
      procCol: 1,
      nameCol: 2,
      xCol: 3,
      yCol: 4,
      zCol: 5,
      // Bağlayıcı tipi sütunu; 0 = proses kodu sütununu kullan
      typeCol: 0
    },
    mpf: {
      commentPrefix: '$',
      positionKeywords: 'AXPOS,LIN',
      processKeywords: 'PSEN,CS,DONLY,DNOCLAMP',
      // Bir noktada en fazla bir kez bulunabilecek prosesler
      exclusiveKeywords: 'CS,DONLY,DNOCLAMP',
      repeatableKeyword: 'PSEN',
      // 'auto' | 'position' | 'process'
      nameSource: 'auto'
    },
    // İsimler birebir eşleşmeli; true yapılırsa büyük/küçük harf farkı yok sayılır
    matchCaseInsensitive: false
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeSettings(s) {
    var out = clone(DEFAULTS);
    if (!s) return out;
    ['fpdf', 'mpf'].forEach(function (k) {
      if (s[k]) for (var key in s[k]) if (s[k][key] !== undefined && s[k][key] !== '') out[k][key] = s[k][key];
    });
    if (s.matchCaseInsensitive !== undefined) out.matchCaseInsensitive = !!s.matchCaseInsensitive;
    return out;
  }

  function splitLines(text) {
    return String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  }

  function keywordList(str) {
    return String(str || '').split(/[,;\s]+/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Satır başında anahtar kelimeyi bulan regex (ör. "PSEN(" veya "CS " eşleşir, "CSX" eşleşmez)
  function keywordRegex(list) {
    if (!list.length) return null;
    // Uzun kelimeler önce denensin
    var sorted = list.slice().sort(function (a, b) { return b.length - a.length; });
    return new RegExp('^(' + sorted.map(escapeRe).join('|') + ')(?![A-Z0-9_])', 'i');
  }

  function normName(name, ci) {
    var n = String(name || '').trim().replace(/\s+/g, ' ');
    return ci ? n.toUpperCase() : n;
  }

  function parseNum(s) {
    if (s === undefined || s === null) return NaN;
    var t = String(s).trim();
    if (t === '') return NaN;
    return Number(t);
  }

  function stripQuotes(s) {
    s = String(s).trim();
    if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
      return s.slice(1, -1).trim();
    }
    return s;
  }

  // ---------------------------------------------------------------- FPDF
  function parseFPDF(text, settings) {
    var cfg = mergeSettings(settings).fpdf;
    var delim = cfg.delimiter === '\\t' ? '\t' : (cfg.delimiter || ',');
    var lines = splitLines(text);
    var points = [];
    var warnings = [];
    var commentCount = 0, emptyCount = 0;
    var cols = {
      proc: (+cfg.procCol) - 1, name: (+cfg.nameCol) - 1,
      x: (+cfg.xCol) - 1, y: (+cfg.yCol) - 1, z: (+cfg.zCol) - 1,
      type: (+cfg.typeCol || 0) - 1
    };
    var maxCol = Math.max(cols.proc, cols.name, cols.x, cols.y, cols.z, cols.type);

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (!line) { emptyCount++; continue; }
      if (cfg.commentPrefix && line.indexOf(cfg.commentPrefix) === 0) { commentCount++; continue; }

      var fields = line.split(delim).map(stripQuotes);
      var lineNo = i + 1;
      if (fields.length <= maxCol) {
        warnings.push({ type: 'fpdf-short', line: lineNo, msg: 'FPDF satır ' + lineNo + ': ' + fields.length + ' alan var, en az ' + (maxCol + 1) + ' gerekli', text: line });
        continue;
      }
      var x = parseNum(fields[cols.x]), y = parseNum(fields[cols.y]), z = parseNum(fields[cols.z]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        warnings.push({ type: 'fpdf-coord', line: lineNo, msg: 'FPDF satır ' + lineNo + ': koordinat sayı değil (' + [fields[cols.x], fields[cols.y], fields[cols.z]].join(', ') + ')', text: line });
        continue;
      }
      var name = fields[cols.name];
      if (!name) {
        warnings.push({ type: 'fpdf-noname', line: lineNo, msg: 'FPDF satır ' + lineNo + ': bağlayıcı ismi boş', text: line });
      }
      points.push({
        id: points.length,
        name: name,
        fpdfProc: fields[cols.proc],
        type: cols.type >= 0 ? fields[cols.type] : fields[cols.proc],
        x: x, y: y, z: z,
        line: lineNo,
        fields: fields
      });
    }
    return {
      points: points,
      warnings: warnings,
      stats: { totalLines: lines.length, comments: commentCount, empty: emptyCount, points: points.length }
    };
  }

  // ---------------------------------------------------------------- MPF
  function parseMPF(text, settings) {
    var cfg = mergeSettings(settings).mpf;
    var posRe = keywordRegex(keywordList(cfg.positionKeywords));
    var procRe = keywordRegex(keywordList(cfg.processKeywords));
    var lines = splitLines(text);
    var blocks = [];      // pozisyon blokları
    var processes = [];   // tüm proses kayıtları
    var warnings = [];
    var cur = null;
    var stats = { totalLines: lines.length, comments: 0, empty: 0, positions: 0, processes: 0, ignored: 0 };

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var lineNo = i + 1;
      if (!line) { stats.empty++; continue; }
      if (cfg.commentPrefix && line.indexOf(cfg.commentPrefix) === 0) { stats.comments++; continue; }

      // Satırı kod ve ";" sonrası açıklama olarak ayır
      var semi = line.indexOf(';');
      var code = (semi >= 0 ? line.slice(0, semi) : line).trim();
      // ";- Point_No--Fst-1962" -> "Point_No--Fst-1962" (baştaki tire ve boşluklar atılır)
      var tail = semi >= 0 ? line.slice(semi + 1).replace(/^[\s\-]+/, '').trim() : '';
      // Siemens blok numarası (N10 ...) varsa at
      // "N023540 ;PDP(...)" gibi yoruma alınmış satırlarda kod kısmı boş kalır
      code = code.replace(/^N\d+\s*/i, '');
      if (!code) { stats.ignored++; continue; }

      var m;
      if (posRe && (m = code.match(posRe))) {
        stats.positions++;
        // AXPOS(x,y,z,i,j,k,...) / LIN(...) değerleri makine eksenindedir; yalnızca bilgi için saklanır
        var nums = ((code.slice(m[1].length).match(/\(([^)]*)\)/) || [])[1] || '').split(',').map(Number);
        cur = { index: blocks.length, keyword: m[1].toUpperCase(), line: lineNo, text: line, name: tail, processes: [],
          machine: nums.length >= 3 && nums.slice(0, 6).every(isFinite) ? nums.slice(0, 6) : null };
        blocks.push(cur);
        continue;
      }
      if (procRe && (m = code.match(procRe))) {
        stats.processes++;
        var name, blockName = cur ? cur.name : '';
        if (cfg.nameSource === 'position') name = blockName;
        else if (cfg.nameSource === 'process') name = tail;
        else name = blockName || tail;

        if (!cur) {
          warnings.push({ type: 'mpf-orphan', line: lineNo, msg: 'MPF satır ' + lineNo + ': ' + m[1].toUpperCase() + ' öncesinde pozisyon satırı (AXPOS/LIN) yok', text: line });
        }
        if (cfg.nameSource === 'auto' && blockName && tail && normName(blockName, true) !== normName(tail, true)) {
          warnings.push({ type: 'mpf-namediff', line: lineNo, msg: 'MPF satır ' + lineNo + ': proses satırındaki isim "' + tail + '" pozisyon satırındaki "' + blockName + '" ile farklı; pozisyon ismi kullanıldı', text: line });
        }
        if (!name) {
          warnings.push({ type: 'mpf-noname', line: lineNo, msg: 'MPF satır ' + lineNo + ': ' + m[1].toUpperCase() + ' için bağlayıcı ismi bulunamadı', text: line });
        }
        var p = {
          code: m[1].toUpperCase(),
          args: (code.slice(m[1].length).match(/^\s*\(([^)]*)\)/) || [])[1] || '',
          name: name,
          line: lineNo,
          text: line,
          blockIndex: cur ? cur.index : -1,
          blockLine: cur ? cur.line : null
        };
        processes.push(p);
        if (cur) cur.processes.push(p);
        continue;
      }
      stats.ignored++;
    }
    return { blocks: blocks, processes: processes, warnings: warnings, stats: stats };
  }

  // ---------------------------------------------------------------- Eşleştirme
  /*
   * Her FPDF noktasına MPF proseslerini isim üzerinden bağlar ve kuralları kontrol eder:
   *  - PSEN 0..n kez olabilir
   *  - CS / DONLY / DNOCLAMP'ten en fazla BİRİ, en fazla BİR kez olabilir
   */
  function match(fpdf, mpf, settings) {
    var s = mergeSettings(settings);
    var ci = s.matchCaseInsensitive;
    var exclusive = keywordList(s.mpf.exclusiveKeywords);
    var repeatable = String(s.mpf.repeatableKeyword || 'PSEN').toUpperCase();
    var warnings = [];

    var byName = Object.create(null);
    fpdf.points.forEach(function (pt) {
      var key = normName(pt.name, ci);
      pt.processes = [];
      pt.psenCount = 0;       // PSEN satırı sayısı (yalnızca bilgi)
      pt.hasPsen = false;     // sayımlar ve gösterim bunu kullanır: PSEN yapılan pozisyon
      pt.exclusive = [];      // bulunan özel prosesler (CS/DONLY/DNOCLAMP)
      pt.issues = [];
      pt.positionCount = 0;   // MPF'de bu isme ait pozisyon satırı sayısı
      pt.blocks = [];
      if (!byName[key]) byName[key] = [];
      else if (byName[key].length === 1) {
        warnings.push({ type: 'fpdf-dup', line: pt.line, msg: 'FPDF: "' + pt.name + '" ismi birden fazla satırda var (satır ' + byName[key][0].line + ', ' + pt.line + '...)' });
      }
      byName[key].push(pt);
    });

    function lookup(name) { return byName[normName(name, ci)] || null; }

    mpf.blocks.forEach(function (b) {
      var t = lookup(b.name);
      if (t) t.forEach(function (pt) { pt.positionCount++; pt.blocks.push(b); });
    });

    var unmatched = Object.create(null); // MPF'de olup FPDF'de olmayan isimler
    mpf.processes.forEach(function (proc) {
      var key = normName(proc.name, ci);
      var targets = lookup(proc.name);
      if (!targets) {
        if (!unmatched[key]) unmatched[key] = { name: proc.name, processes: [] };
        unmatched[key].processes.push(proc);
        return;
      }
      targets.forEach(function (pt) {
        pt.processes.push(proc);
        if (proc.code === repeatable) { pt.psenCount++; pt.hasPsen = true; }
        if (exclusive.indexOf(proc.code) >= 0) pt.exclusive.push(proc.code);
      });
    });

    var summary = { total: fpdf.points.length, inMpf: 0, notInMpf: 0, withIssues: 0, byCombo: {} };
    fpdf.points.forEach(function (pt) {
      if (pt.exclusive.length > 1) {
        var uniq = pt.exclusive.filter(function (c, i, a) { return a.indexOf(c) === i; });
        var msg = uniq.length > 1
          ? 'Birden fazla tekil proses: ' + pt.exclusive.join(', ')
          : uniq[0] + ' prosesi ' + pt.exclusive.length + ' kez tekrarlanmış';
        pt.issues.push(msg);
        warnings.push({ type: 'rule-exclusive', line: pt.line, name: pt.name, msg: '"' + pt.name + '": ' + msg });
      }
      // Aynı noktanın proseslerinin farklı pozisyon bloklarına dağılması bilgisi
      var blocksSeen = {};
      pt.processes.forEach(function (p) { blocksSeen[p.blockIndex] = true; });
      pt.blockCount = Object.keys(blocksSeen).length;

      pt.inMpf = pt.processes.length > 0 || pt.positionCount > 0;
      pt.secondary = pt.exclusive.length === 0 ? 'NONE' : (pt.exclusive.length === 1 ? pt.exclusive[0] : 'MULTI');
      pt.combo = comboKey(pt);
      summary.byCombo[pt.combo] = (summary.byCombo[pt.combo] || 0) + 1;
      if (pt.inMpf) summary.inMpf++; else summary.notInMpf++;
      if (pt.issues.length) summary.withIssues++;
    });

    var unmatchedList = Object.keys(unmatched).map(function (k) { return unmatched[k]; });
    unmatchedList.forEach(function (u) {
      warnings.push({ type: 'mpf-unmatched', line: u.processes[0].line, name: u.name, msg: 'MPF: "' + (u.name || '(isimsiz)') + '" FPDF\'de yok (' + u.processes.length + ' proses, ilk satır ' + u.processes[0].line + ')' });
    });

    return { points: fpdf.points, unmatched: unmatchedList, warnings: warnings, summary: summary };
  }

  // "PSEN + CS" gibi okunabilir kombinasyon anahtarı (PSEN kaç kez olursa olsun bir kez sayılır)
  function comboKey(pt) {
    if (!pt.inMpf) return 'MPF\'de yok';
    var parts = [];
    if (pt.hasPsen) parts.push('PSEN');
    if (pt.secondary === 'MULTI') parts.push('ÇOKLU');
    else if (pt.secondary !== 'NONE') parts.push(pt.secondary);
    return parts.join(' + ') || '(proses yok)';
  }

  return {
    DEFAULTS: DEFAULTS,
    mergeSettings: mergeSettings,
    parseFPDF: parseFPDF,
    parseMPF: parseMPF,
    match: match,
    keywordList: keywordList
  };
});
