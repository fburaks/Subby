// Tek dosyalık sürümü üretir: node proses3d/build.js  ->  proses3d/Proses3D.html
// index.html içindeki tüm CSS ve JS dosyaları sayfaya gömülür; böylece dosya tek başına
// açılabilir ve "Haritayı kaydet" özelliği sayfanın kendisini şablon olarak kullanabilir.
var fs = require('fs'), path = require('path');
var dir = __dirname;
var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
var expected = (html.match(/<link rel="stylesheet" href=|<script src=/g) || []).length, inlined = 0;

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, href) {
  inlined++;
  return '<style>\n' + fs.readFileSync(path.join(dir, href), 'utf8') + '\n</style>';
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
  inlined++;
  var js = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>/* ' + src + ' */\n' + js + '\n</script>';
});
if (inlined !== expected) throw new Error('Gömülemeyen kaynak kaldı');

var out = path.join(dir, 'Proses3D.html');
fs.writeFileSync(out, html);
console.log(out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
