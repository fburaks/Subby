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
assert.strictEqual(by.A1.hasPsen, true);
assert.deepStrictEqual(by.A1.exclusive, ['CS']);
assert.strictEqual(by.A1.combo, 'PSEN + CS'); // PSEN tekrarı tek sayılır
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

// Gerçek makine biçimi (ekran görüntüsünden alınan satırlar)
var realMpf = [
  'N023515 AXPOS(-855.2109,274.6084,1593.9438,1133.4849,-18.9635,0,0);- Point_No--Fst-1962',
  'N023520 DONLY(1)',
  'N023525 LD(100)',
  'N023530 AXPOS(-853.2227,257.8804,1584.0010,1147.5229,-17.4536,0,0);- Point_No--Fst-1963',
  'N023535 PSEN(1,0)',
  'N023540 ;PDP(0.8,0.1,0.1,0)',
  'N023545 DNOCLAMP(1)',
  'N023550 ;PD(0)',
  'N023555 AXPOS(-864.5781,323.4490,1647.5355,1065.9790,-24.9612,0,0);- Point_No--Fst-1959',
  'N023560 PSEN(1,0)',
  'N023565 AXPOS(-867.7266,324.5959,1669.8074,1043.8428,-26.5611,0,0);- Point_No--Fst-1957',
  'N023570 NSEN(1,1,1,0)',
  'N023575 DSEN(1,1,1,0)',
  'N023580 LUP()',
  'N023585 DONLY(0)',
  'N023615 AXPOS(-864.5781,323.4490,1647.5355,1065.9790,-24.9612,0,0);- Point_No--Fst-1959',
  'N023620 PSEN(1,0)',
  'N023625 ;PDP(0.8,0.1,0.1,0)',
  'N023630 DNOCLAMP(1)',
  'N023635 ;PD(0)'
].join('\r\n');
var rm = P.parseMPF(realMpf);
assert.strictEqual(rm.stats.positions, 5);
assert.strictEqual(rm.stats.processes, 7); // NSEN, DSEN, LUP, LD ve ;PDP yorumları proses değil
assert.strictEqual(rm.blocks[0].name, 'Point_No--Fst-1962');
assert.strictEqual(rm.processes[0].args, '1');
assert.strictEqual(rm.warnings.length, 0);

// İsimler birebir eşleşir
var rf = P.parseFPDF('A,Point_No--Fst-1959,1,2,3\nB,Point_No--Fst-1957,4,5,6\nC,Point_No--Fst-1962,7,8,9\nD,Point_No--Fst-1963,1,1,1\n');
var rr = P.match(rf, rm);
var rb = {};
rr.points.forEach(function (p) { rb[p.name] = p; });
assert.strictEqual(rb['Point_No--Fst-1959'].hasPsen, true);
assert.deepStrictEqual(rb['Point_No--Fst-1959'].exclusive, ['DNOCLAMP']);
assert.strictEqual(rb['Point_No--Fst-1959'].positionCount, 2);
assert.deepStrictEqual(rb['Point_No--Fst-1959'].blocks[0].machine, [-864.5781, 323.449, 1647.5355, 1065.979, -24.9612, 0]);
assert.strictEqual(rb['Point_No--Fst-1959'].combo, 'PSEN + DNOCLAMP');
assert.strictEqual(rb['Point_No--Fst-1957'].combo, 'DONLY');
assert.strictEqual(rb['Point_No--Fst-1963'].combo, 'PSEN + DNOCLAMP');
assert.strictEqual(rr.unmatched.length, 0);
// Fark varsa eşleşmez: kısa isim veya farklı harf
assert.strictEqual(P.match(P.parseFPDF('A,Fst-1959,1,2,3\n'), rm).points[0].inMpf, false);
assert.strictEqual(P.match(P.parseFPDF('A,POINT_NO--FST-1959,1,2,3\n'), rm).points[0].inMpf, false);

console.log('gerçek biçim testleri geçti');
