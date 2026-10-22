// Çalıştırma: node proses3d/test/parser.test.js
var assert = require('assert');
var P = require('../js/parser.js');

var fpdf = P.parseFPDF([
  '$ yorum',
  'P1,A1,0,0,0',
  'P2,A2,10,0,0',
  'P1,A3,20,0,0',
  'P1,A4,30,0,0',
  'P1,BOZUK,x,0,0'
].join('\n'));
assert.strictEqual(fpdf.points.length, 4);
assert.strictEqual(fpdf.warnings.length, 1);

var mpf = P.parseMPF([
  '$ yorum',
  'N10 AXPOS X=0 ;A1',
  'N20 PSEN(1)',
  'N30 PSEN(2)',
  'N40 CS(1)',
  'N50 LIN X=10 ;A2',
  'N60 DONLY(1)',
  'N70 DNOCLAMP(1)',
  'N80 LIN X=20 ;A3',
  'N90 G4 F1',
  'N100 LIN X=99 ;YOK',
  'N110 PSEN(1)',
  'N120 CSX(1)'
].join('\n'));
assert.strictEqual(mpf.stats.positions, 4);
assert.strictEqual(mpf.stats.processes, 6); // CSX proses sayılmaz

var r = P.match(fpdf, mpf);
var by = {};
r.points.forEach(function (p) { by[p.name] = p; });
assert.strictEqual(by.A1.psenCount, 2);
assert.deepStrictEqual(by.A1.exclusive, ['CS']);
assert.strictEqual(by.A1.combo, 'PSEN×2 + CS');
assert.strictEqual(by.A2.secondary, 'MULTI');
assert.strictEqual(by.A2.issues.length, 1);
assert.strictEqual(by.A3.inMpf, true);
assert.strictEqual(by.A3.processes.length, 0);
assert.strictEqual(by.A4.inMpf, false);
assert.strictEqual(r.unmatched.length, 1);
assert.strictEqual(r.unmatched[0].name, 'YOK');

// Sütun sırası ayarlanabilir
var f2 = P.parseFPDF('1;2;3;A9;K\n', { fpdf: { delimiter: ';', nameCol: 4, procCol: 5, xCol: 1, yCol: 2, zCol: 3 } });
assert.strictEqual(f2.points[0].name, 'A9');
assert.strictEqual(f2.points[0].z, 3);

console.log('parser testleri geçti');
