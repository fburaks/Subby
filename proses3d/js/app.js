/* Proses 3D Görüntüleyici - arayüz ve 3D sahne */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'proses3d.settings.v1';

  // Paylaşım dosyası için sayfanın kendisi şablon olarak saklanır. Bu yalnızca tüm kaynakların
  // gömülü olduğu tek dosyalık Proses3D.html sürümünde mümkündür.
  var TEMPLATE = (function () {
    if (document.querySelector('script[src], link[rel=stylesheet]')) return null;
    var root = document.documentElement.cloneNode(true);
    var old = root.querySelector('#paylasimVeri');
    if (old) old.remove();
    return '<!doctype html>\n' + root.outerHTML;
  })();

  // ------------------------------------------------------------------ durum
  var state = {
    settings: loadSettings(),
    files: { fpdf: null, mpf: null },      // File nesneleri (kodlama değişince yeniden okunur)
    text: { fpdf: '', mpf: '' },
    names: { fpdf: '', mpf: '' },
    fpdf: null, mpf: null, result: null,
    warnings: [],
    hiddenShapes: {}, hiddenColors: {},
    selected: null,
    visible: [],          // ekranda çizilen noktalar (seçim için)
    visiblePos: null,     // Float32Array x,y,z
    searchHits: [],
    sort: { key: 'name', dir: 1 },
    drawerMode: null,
    firstFit: true
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return Proses.mergeSettings(JSON.parse(raw));
    } catch (e) { /* depolama yoksa varsayılanlar */ }
    return Proses.mergeSettings();
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.settings)); } catch (e) { /* yok say */ }
  }

  // ------------------------------------------------------------------ şekiller
  // Şekil = noktadaki tekil proses (CS / DONLY / DNOCLAMP); renk = seçilen moda göre.
  var SHAPE_DRAWERS = {
    circle: function (c, r) { c.arc(0, 0, r, 0, Math.PI * 2); },
    square: function (c, r) { r *= 0.85; c.rect(-r, -r, 2 * r, 2 * r); },
    triangle: function (c, r) { poly(c, 3, r * 1.1, -Math.PI / 2, 0.18 * r); },
    diamond: function (c, r) { poly(c, 4, r * 1.05, -Math.PI / 2); },
    pentagon: function (c, r) { poly(c, 5, r, -Math.PI / 2); },
    hexagon: function (c, r) { poly(c, 6, r, 0); },
    star: function (c, r) {
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r * 1.05;
        i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
    },
    ring: function (c, r) { c.arc(0, 0, r * 0.95, 0, Math.PI * 2); c.moveTo(r * 0.5, 0); c.arc(0, 0, r * 0.5, 0, Math.PI * 2, true); }
  };
  function poly(c, n, r, rot, dy) {
    dy = dy || 0;
    for (var i = 0; i < n; i++) {
      var a = rot + i * 2 * Math.PI / n;
      i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r + dy) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r + dy);
    }
    c.closePath();
  }
  var EXTRA_SHAPES = ['square', 'triangle', 'diamond', 'pentagon', 'hexagon'];

  function drawShape(canvas, shape, fill, stroke) {
    var s = canvas.width, c = canvas.getContext('2d');
    c.clearRect(0, 0, s, s);
    c.save();
    c.translate(s / 2, s / 2);
    c.beginPath();
    SHAPE_DRAWERS[shape](c, s * 0.40);
    c.fillStyle = fill;
    c.fill('evenodd');
    c.lineWidth = Math.max(1, s * 0.07);
    c.strokeStyle = stroke;
    c.stroke();
    c.restore();
  }

  var textureCache = {};
  function shapeTexture(shape) {
    if (textureCache[shape]) return textureCache[shape];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    drawShape(cv, shape, '#ffffff', 'rgba(0,0,0,0.85)');
    var t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter;
    return (textureCache[shape] = t);
  }

  // Şekil anahtarları ve etiketleri
  function shapeDefs() {
    var excl = Proses.keywordList(state.settings.mpf.exclusiveKeywords);
    var defs = [{ key: 'NONE', label: 'Tekil proses yok', shape: 'circle' }];
    excl.forEach(function (k, i) { defs.push({ key: k, label: k, shape: EXTRA_SHAPES[i % EXTRA_SHAPES.length] }); });
    defs.push({ key: 'MULTI', label: 'Birden fazla tekil (hata)', shape: 'star' });
    defs.push({ key: 'OUT', label: 'MPF\'de yok', shape: 'ring' });
    return defs;
  }
  function shapeKeyOf(pt) { return pt.inMpf ? pt.secondary : 'OUT'; }

  // ------------------------------------------------------------------ renkler
  var PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
    '#9c755f', '#bab0ac', '#17becf', '#bcbd22', '#8c564b', '#e377c2', '#1f77b4', '#2ca02c'];
  var STATUS = [
    { key: 'out', label: 'MPF\'de yok', color: '#5f6b78' },
    { key: 'p0', label: 'PSEN yok', color: '#29b6f6' },
    { key: 'p1', label: 'PSEN ×1', color: '#66bb6a' },
    { key: 'p2', label: 'PSEN ×2', color: '#ffa726' },
    { key: 'p3', label: 'PSEN ×3+', color: '#ec407a' },
    { key: 'err', label: 'Kural ihlali', color: '#ff1744' }
  ];

  function statusKey(pt) {
    if (pt.issues.length) return 'err';
    if (!pt.inMpf) return 'out';
    return pt.psenCount >= 3 ? 'p3' : 'p' + pt.psenCount;
  }

  // Seçili moda göre {key -> {label,color,count}} kategori listesi ve nokta->anahtar fonksiyonu
  function colorScheme() {
    var mode = $('colorMode').value;
    var pts = state.result ? state.result.points : [];
    var cats = [], keyOf;
    if (mode === 'status') {
      keyOf = statusKey;
      cats = STATUS.map(function (s) { return { key: s.key, label: s.label, color: s.color }; });
    } else if (mode === 'combo' || mode === 'fpdf' || mode === 'type') {
      keyOf = mode === 'combo' ? function (p) { return p.combo; }
        : mode === 'type' ? function (p) { return p.type || '(boş)'; }
        : function (p) { return p.fpdfProc || '(boş)'; };
      var seen = {};
      pts.forEach(function (p) { var k = keyOf(p); seen[k] = (seen[k] || 0) + 1; });
      Object.keys(seen).sort(naturalCmp).forEach(function (k, i) {
        var col = PALETTE[i % PALETTE.length];
        if (mode === 'combo' && k === 'MPF\'de yok') col = '#5f6b78';
        if (mode === 'combo' && k.indexOf('ÇOKLU') >= 0) col = '#ff1744';
        cats.push({ key: k, label: k, color: col });
      });
    } else { // z
      var zmin = Infinity, zmax = -Infinity;
      pts.forEach(function (p) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; });
      return { continuous: true, zmin: zmin, zmax: zmax, keyOf: function () { return 'z'; },
        colorOf: function (p) { return rampColor(zmax > zmin ? (p.z - zmin) / (zmax - zmin) : 0.5); } };
    }
    var map = {};
    cats.forEach(function (c) { c.count = 0; map[c.key] = c; });
    pts.forEach(function (p) { var c = map[keyOf(p)]; if (c) c.count++; });
    return { cats: cats, map: map, keyOf: keyOf, colorOf: function (p) { var c = map[keyOf(p)]; return c ? c.color : '#ffffff'; } };
  }

  function rampColor(t) { // mavi -> camgöbeği -> yeşil -> sarı -> kırmızı
    var stops = [[0, [49, 54, 149]], [0.25, [69, 160, 220]], [0.5, [102, 189, 99]], [0.75, [253, 204, 72]], [1, [215, 48, 39]]];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
        return 'rgb(' + [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * f); }).join(',') + ')';
      }
    }
    return 'rgb(215,48,39)';
  }

  function naturalCmp(a, b) { return String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' }); }

  // ------------------------------------------------------------------ 3D sahne
  var viewport = $('viewport');
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x0f1419);
  renderer.domElement.className = 'gl';
  viewport.insertBefore(renderer.domElement, viewport.firstChild);

  THREE.Object3D.DefaultUp.set(0, 0, 1); // makine koordinatları: Z yukarı
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  camera.up.set(0, 0, 1);
  camera.position.set(500, -800, 600);
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.75));
  var headLight = new THREE.DirectionalLight(0xffffff, 0.6);
  camera.add(headLight);
  headLight.position.set(1, 1, 2);
  scene.add(camera);

  var helpers = new THREE.Group();
  scene.add(helpers);
  var pointGroup = new THREE.Group();
  scene.add(pointGroup);
  var modelRoot = new THREE.Group();
  scene.add(modelRoot);
  var model = null;
  var modelMaterial = new THREE.MeshPhongMaterial({ color: 0x8aa4c8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, shininess: 20 });

  // Seçim vurgusu
  var hlGeom = new THREE.BufferGeometry();
  hlGeom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  var hlTex = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var c = cv.getContext('2d');
    c.strokeStyle = '#ffd54a'; c.lineWidth = 7;
    c.beginPath(); c.arc(32, 32, 26, 0, Math.PI * 2); c.stroke();
    return new THREE.CanvasTexture(cv);
  })();
  var highlight = new THREE.Points(hlGeom, new THREE.PointsMaterial({ size: 34, sizeAttenuation: false, map: hlTex, transparent: true, depthTest: false }));
  highlight.renderOrder = 10;
  highlight.visible = false;
  scene.add(highlight);
  // Arama sonuçları vurgusu
  var searchPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 26, sizeAttenuation: false, map: hlTex, transparent: true, depthTest: false, color: 0x00e5ff }));
  searchPts.renderOrder = 9;
  scene.add(searchPts);

  function rebuildHelpers(box) {
    helpers.clear();
    var size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(1000, 1000, 1000);
    var center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    var span = Math.max(size.x, size.y, 1);
    var step = Math.pow(10, Math.floor(Math.log10(span / 5)));
    var gsize = Math.ceil(span * 1.4 / step) * step;
    var divisions = Math.round(gsize / step);
    var grid = new THREE.GridHelper(gsize, divisions, 0x3a4655, 0x232c36);
    grid.rotation.x = Math.PI / 2; // XY düzlemi
    grid.position.set(Math.round(center.x / step) * step, Math.round(center.y / step) * step, box ? box.min.z : 0);
    helpers.add(grid);
    var axes = new THREE.AxesHelper(span * 0.15);
    axes.position.set(box ? box.min.x : 0, box ? box.min.y : 0, box ? box.min.z : 0);
    helpers.add(axes);
    helpers.visible = $('chkAxes').checked;
  }
  rebuildHelpers(null);

  function resize() {
    var w = viewport.clientWidth, h = viewport.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updateLabel();
  }

  // ------------------------------------------------------------------ nokta bulutu
  function rebuildPoints() {
    pointGroup.children.forEach(function (o) { o.geometry.dispose(); o.material.dispose(); });
    pointGroup.clear();
    state.visible = [];
    if (!state.result) { state.visiblePos = null; return; }

    var scheme = colorScheme();
    var size = +$('ptSize').value;
    var onTop = $('chkOnTop').checked;
    var groups = {};
    var col = new THREE.Color();
    state.result.points.forEach(function (p) {
      var sk = shapeKeyOf(p);
      if (state.hiddenShapes[sk]) return;
      if (!scheme.continuous && state.hiddenColors[scheme.keyOf(p)]) return;
      (groups[sk] = groups[sk] || []).push(p);
    });
    var defs = shapeDefs(), shapeOf = {};
    defs.forEach(function (d) { shapeOf[d.key] = d.shape; });

    Object.keys(groups).forEach(function (sk) {
      var list = groups[sk];
      var pos = new Float32Array(list.length * 3), cols = new Float32Array(list.length * 3);
      list.forEach(function (p, i) {
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col.setStyle(scheme.colorOf(p));
        cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
        state.visible.push(p);
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      var m = new THREE.PointsMaterial({
        size: size, sizeAttenuation: false, map: shapeTexture(shapeOf[sk] || 'circle'),
        vertexColors: true, alphaTest: 0.5, depthTest: !onTop
      });
      var pts = new THREE.Points(g, m);
      pts.renderOrder = onTop ? 5 : 0;
      pointGroup.add(pts);
    });

    var vp = new Float32Array(state.visible.length * 3);
    state.visible.forEach(function (p, i) { vp[i * 3] = p.x; vp[i * 3 + 1] = p.y; vp[i * 3 + 2] = p.z; });
    state.visiblePos = vp;
    updateSearchMarkers();
  }

  // Ekran uzayında en yakın noktayı bul (piksel cinsinden)
  var _m = new THREE.Matrix4();
  function pickAt(clientX, clientY) {
    var vp = state.visiblePos;
    if (!vp || !vp.length) return null;
    var rect = renderer.domElement.getBoundingClientRect();
    var mx = clientX - rect.left, my = clientY - rect.top;
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    var e = _m.elements, w2 = rect.width / 2, h2 = rect.height / 2;
    var radius = Math.max(6, +$('ptSize').value / 2 + 2), r2 = radius * radius;
    var best = -1, bestD = Infinity, bestZ = Infinity;
    for (var i = 0, n = vp.length / 3; i < n; i++) {
      var x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
      var cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) continue;
      var sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
      var sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
      var px = (sx + 1) * w2, py = (1 - sy) * h2;
      var dx = px - mx, dy = py - my, d = dx * dx + dy * dy;
      if (d > r2) continue;
      // Kursöre en yakın; eşit sayılacak kadar yakınsa kameraya yakın olan
      if (d < bestD - 4 || (Math.abs(d - bestD) <= 4 && cw < bestZ)) { best = i; bestD = d; bestZ = cw; }
    }
    return best >= 0 ? state.visible[best] : null;
  }

  // ------------------------------------------------------------------ kamera
  function dataBox(includeModel) {
    var box = new THREE.Box3();
    if (state.result) state.result.points.forEach(function (p) { box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z)); });
    if (includeModel && model && model.visible) box.expandByObject(modelRoot);
    return box.isEmpty() ? null : box;
  }

  function setView(kind) {
    var box = dataBox(true);
    if (!box) return;
    var c = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var r = Math.max(size.length() / 2, 1);
    var dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    var dir = {
      top: [0, -0.0001, 1], front: [0, -1, 0], side: [1, 0, 0], iso: [1, -1, 0.9], fit: null
    }[kind];
    if (!dir) {
      dir = camera.position.clone().sub(controls.target).normalize().toArray();
      if (!isFinite(dir[0])) dir = [1, -1, 0.9];
    }
    var d = new THREE.Vector3().fromArray(dir).normalize();
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(d, dist);
    camera.near = Math.max(dist / 1000, 0.01);
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function focusPoint(p) {
    var t = new THREE.Vector3(p.x, p.y, p.z);
    var offset = camera.position.clone().sub(controls.target);
    var box = dataBox(false);
    var span = box ? box.getSize(new THREE.Vector3()).length() : 1000;
    if (offset.length() > span * 0.5) offset.setLength(span * 0.35);
    controls.target.copy(t);
    camera.position.copy(t).add(offset);
    controls.update();
  }

  // ------------------------------------------------------------------ işleme
  function process() {
    if (!state.text.fpdf) { state.result = null; refreshAll(); return; }
    var s = state.settings;
    state.fpdf = Proses.parseFPDF(state.text.fpdf, s);
    state.mpf = Proses.parseMPF(state.text.mpf || '', s);
    state.result = Proses.match(state.fpdf, state.mpf, s);
    state.warnings = state.fpdf.warnings.concat(state.mpf.warnings, state.result.warnings);
    if (state.selected) {
      var sel = state.selected;
      state.selected = state.result.points.filter(function (p) { return p.line === sel.line; })[0] || null;
    }
    refreshAll();
    if (state.firstFit && state.result.points.length) { setView('iso'); state.firstFit = false; }
  }

  function refreshAll() {
    $('empty').hidden = !!state.result;
    var box = dataBox(true);
    rebuildHelpers(box);
    buildLegend();
    rebuildPoints();
    updateStats();
    updatePreview();
    showInfo(state.selected);
    renderSummary();
    if (state.drawerMode) renderDrawer();
    var wc = state.warnings.length;
    $('warnCount').textContent = wc;
    $('warnCount').className = 'badge' + (wc ? '' : ' zero');
  }

  function updateStats() {
    var el = $('stats');
    if (!state.result) { el.innerHTML = ''; return; }
    var s = state.result.summary, m = state.mpf.stats;
    var shown = state.visible.length;
    el.innerHTML =
      'FPDF: <b>' + s.total + '</b> nokta &nbsp;·&nbsp; MPF: <b>' + m.positions + '</b> pozisyon, <b>' + m.processes + '</b> proses<br>' +
      'MPF ile eşleşen: <b>' + s.inMpf + '</b> &nbsp;·&nbsp; MPF\'de yok: <b>' + s.notInMpf + '</b> &nbsp;·&nbsp; FPDF\'de olmayan isim: <b>' + state.result.unmatched.length + '</b>' +
      ' &nbsp;·&nbsp; Kural ihlali: <b style="color:' + (s.withIssues ? 'var(--warn)' : 'inherit') + '">' + s.withIssues + '</b><br>' +
      'Gösterilen: <b>' + shown + '</b>';
  }

  // ------------------------------------------------------------------ lejant
  function legendCanvas(shape, color) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    drawShape(cv, shape, color, 'rgba(0,0,0,.8)');
    return cv;
  }

  function buildLegend() {
    var ls = $('legendShape'), lc = $('legendColor');
    ls.innerHTML = ''; lc.innerHTML = '';
    var pts = state.result ? state.result.points : [];
    var counts = {};
    pts.forEach(function (p) { var k = shapeKeyOf(p); counts[k] = (counts[k] || 0) + 1; });

    addTitle(ls, 'Şekil: tekil proses');
    shapeDefs().forEach(function (d) {
      if (!counts[d.key] && (d.key === 'MULTI' || d.key === 'OUT')) return;
      ls.appendChild(legendItem(legendCanvas(d.shape, '#c9d3de'), d.label, counts[d.key] || 0, state.hiddenShapes, d.key));
    });

    var scheme = colorScheme();
    addTitle(lc, 'Renk: ' + $('colorMode').selectedOptions[0].textContent);
    if (scheme.continuous) {
      var bar = document.createElement('div');
      bar.style.cssText = 'height:12px;border-radius:3px;background:linear-gradient(90deg,' +
        [0, .25, .5, .75, 1].map(rampColor).join(',') + ')';
      lc.appendChild(bar);
      var lbl = document.createElement('div');
      lbl.className = 'muted';
      lbl.style.cssText = 'display:flex;justify-content:space-between;font-size:11px';
      lbl.innerHTML = '<span>' + fmt(scheme.zmin) + '</span><span>Z</span><span>' + fmt(scheme.zmax) + '</span>';
      lc.appendChild(lbl);
      return;
    }
    scheme.cats.forEach(function (c) {
      if (!c.count && $('colorMode').value === 'status' && c.key === 'err') return;
      var sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = c.color;
      lc.appendChild(legendItem(sw, c.label, c.count, state.hiddenColors, c.key));
    });
  }

  function addTitle(el, t) { var d = document.createElement('div'); d.className = 'title'; d.textContent = t; el.appendChild(d); }

  function legendItem(icon, label, count, hiddenMap, key) {
    var l = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !hiddenMap[key];
    l.className = cb.checked ? '' : 'off';
    cb.onchange = function () {
      if (cb.checked) delete hiddenMap[key]; else hiddenMap[key] = true;
      l.className = cb.checked ? '' : 'off';
      rebuildPoints(); updateStats();
      if (state.drawerMode === 'table') renderDrawer();
    };
    var t = document.createElement('span'); t.textContent = label;
    var n = document.createElement('span'); n.className = 'cnt'; n.textContent = count;
    l.appendChild(cb); l.appendChild(icon); l.appendChild(t); l.appendChild(n);
    return l;
  }

  // ------------------------------------------------------------------ bilgi paneli
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function select(p, focus) {
    state.selected = p;
    if (p) {
      hlGeom.attributes.position.setXYZ(0, p.x, p.y, p.z);
      hlGeom.attributes.position.needsUpdate = true;
      hlGeom.computeBoundingSphere();
      if (focus) focusPoint(p);
    }
    highlight.visible = !!p;
    showInfo(p);
    if (state.drawerMode === 'table') markTableSelection();
  }

  function showInfo(p) {
    var box = $('info');
    if (!p) { box.hidden = true; highlight.visible = false; return; }
    var excl = p.exclusive.length ? p.exclusive.join(', ') : '—';
    var html = '<h3>' + esc(p.name || '(isimsiz)') + '</h3>' +
      '<table class="kv">' +
      '<tr><td>FPDF proses</td><td>' + esc(p.fpdfProc) + '</td></tr>' +
      '<tr><td>Bağlayıcı tipi</td><td>' + esc(p.type) + '</td></tr>' +
      '<tr><td>X / Y / Z</td><td>' + fmt(p.x) + ' / ' + fmt(p.y) + ' / ' + fmt(p.z) + '</td></tr>' +
      '<tr><td>FPDF satırı</td><td>' + p.line + '</td></tr>' +
      '<tr><td>MPF pozisyon</td><td>' + p.positionCount + ' kez</td></tr>' +
      '<tr><td>PSEN</td><td>' + p.psenCount + ' kez</td></tr>' +
      '<tr><td>Tekil proses</td><td>' + esc(excl) + '</td></tr>' +
      '<tr><td>Kombinasyon</td><td>' + esc(p.combo) + '</td></tr>' +
      '</table>';
    p.issues.forEach(function (i) { html += '<div class="issue">⚠ ' + esc(i) + '</div>'; });
    if (p.processes.length) {
      html += '<div class="muted" style="margin-top:8px">MPF prosesleri</div>';
      p.processes.forEach(function (pr) {
        html += '<div class="proc"><b>' + esc(pr.code + (pr.args !== '' ? '(' + pr.args + ')' : '')) + '</b> <span class="muted">satır ' + pr.line +
          (pr.blockLine ? ' (pozisyon satır ' + pr.blockLine + ')' : '') + '</span><br><code>' + esc(pr.text) + '</code></div>';
      });
    } else if (!p.inMpf) {
      html += '<div class="muted">Bu bağlayıcı MPF dosyasında bulunamadı.</div>';
    }
    html += '<div class="row" style="margin-top:10px"><button class="btn" id="btnFocus">Odakla</button></div>';
    $('infoBody').innerHTML = html;
    $('btnFocus').onclick = function () { focusPoint(p); };
    box.hidden = false;
  }

  var _v = new THREE.Vector3();
  function updateLabel() {
    var el = $('label3d'), p = state.selected;
    if (!p || !$('chkLabels').checked) { el.hidden = true; return; }
    _v.set(p.x, p.y, p.z).project(camera);
    if (_v.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = p.name;
    el.style.left = ((_v.x + 1) / 2 * viewport.clientWidth) + 'px';
    el.style.top = ((1 - _v.y) / 2 * viewport.clientHeight) + 'px';
  }

  // ------------------------------------------------------------------ fare
  var tooltip = $('tooltip');
  var down = null, hoverQueued = false, lastMove = null;
  renderer.domElement.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!down) return;
    var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    down = null;
    if (moved > 4 || e.button !== 0) return;
    select(pickAt(e.clientX, e.clientY), false);
  });
  renderer.domElement.addEventListener('dblclick', function (e) {
    var p = pickAt(e.clientX, e.clientY);
    if (p) select(p, true);
  });
  renderer.domElement.addEventListener('pointermove', function (e) {
    lastMove = e;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(function () {
      hoverQueued = false;
      var ev = lastMove;
      if (ev.buttons) { tooltip.hidden = true; return; }
      var p = pickAt(ev.clientX, ev.clientY);
      if (!p) { tooltip.hidden = true; renderer.domElement.style.cursor = ''; return; }
      renderer.domElement.style.cursor = 'pointer';
      var procs = p.processes.map(function (x) { return x.code + (x.args !== '' ? '(' + x.args + ')' : ''); }).join(', ') || (p.inMpf ? 'proses yok' : 'MPF\'de yok');
      tooltip.innerHTML = '<div class="t">' + esc(p.name) + '</div>' + esc(procs) +
        '<div class="muted">' + fmt(p.x) + ', ' + fmt(p.y) + ', ' + fmt(p.z) + '</div>';
      var r = viewport.getBoundingClientRect();
      tooltip.style.left = (ev.clientX - r.left + 14) + 'px';
      tooltip.style.top = (ev.clientY - r.top + 14) + 'px';
      tooltip.hidden = false;
    });
  });
  renderer.domElement.addEventListener('pointerleave', function () { tooltip.hidden = true; });

  // ------------------------------------------------------------------ arama
  function runSearch() {
    var q = $('search').value.trim().toUpperCase();
    state.searchHits = [];
    if (q && state.result) {
      state.searchHits = state.result.points.filter(function (p) { return String(p.name).toUpperCase().indexOf(q) >= 0; });
    }
    updateSearchMarkers();
  }
  function updateSearchMarkers() {
    var hits = state.searchHits;
    var pos = new Float32Array(hits.length * 3);
    hits.forEach(function (p, i) { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
    searchPts.geometry.dispose();
    searchPts.geometry = new THREE.BufferGeometry();
    searchPts.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }
  $('search').addEventListener('input', runSearch);
  $('search').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !state.searchHits.length) return;
    var q = $('search').value.trim().toUpperCase();
    var exact = state.searchHits.filter(function (p) { return String(p.name).toUpperCase() === q; })[0];
    select(exact || state.searchHits[0], true);
  });

  // ------------------------------------------------------------------ alt panel
  var COLS = [
    { key: 'name', label: 'Bağlayıcı' },
    { key: 'type', label: 'Tip' },
    { key: 'fpdfProc', label: 'FPDF proses' },
    { key: 'x', label: 'X', num: true }, { key: 'y', label: 'Y', num: true }, { key: 'z', label: 'Z', num: true },
    { key: 'psenCount', label: 'PSEN', num: true },
    { key: 'exclusiveStr', label: 'Tekil proses' },
    { key: 'combo', label: 'Kombinasyon' },
    { key: 'issueStr', label: 'Uyarı' }
  ];

  function openDrawer(mode) {
    if (state.drawerMode === mode) { closeDrawer(); return; }
    state.drawerMode = mode;
    $('drawer').hidden = false;
    $('btnTable').classList.toggle('active', mode === 'table');
    $('btnWarn').classList.toggle('active', mode === 'warn');
    renderDrawer();
  }
  function closeDrawer() {
    state.drawerMode = null;
    $('drawer').hidden = true;
    $('btnTable').classList.remove('active');
    $('btnWarn').classList.remove('active');
  }

  function renderDrawer() {
    var body = $('drawerBody'), q = $('drawerFilter').value.trim().toUpperCase();
    var LIMIT = 3000;
    if (state.drawerMode === 'table') {
      $('drawerTitle').textContent = 'Nokta tablosu';
      var visibleSet = new Set(state.visible);
      var rows = (state.result ? state.result.points : []).filter(function (p) {
        if (!visibleSet.has(p)) return false;
        if (!q) return true;
        return (p.name + ' ' + p.fpdfProc + ' ' + p.combo).toUpperCase().indexOf(q) >= 0;
      });
      rows.forEach(function (p) { p.exclusiveStr = p.exclusive.join(', '); p.issueStr = p.issues.join('; '); });
      var sk = state.sort.key, dir = state.sort.dir;
      rows.sort(function (a, b) {
        var va = a[sk], vb = b[sk];
        return (typeof va === 'number' ? va - vb : naturalCmp(va, vb)) * dir;
      });
      $('drawerInfo').textContent = rows.length + ' satır' + (rows.length > LIMIT ? ' (ilk ' + LIMIT + ' gösteriliyor)' : '');
      var scheme = colorScheme();
      var html = '<table><thead><tr>' + COLS.map(function (c) {
        return '<th data-k="' + c.key + '">' + c.label + (sk === c.key ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
      }).join('') + '</tr></thead><tbody>';
      rows.slice(0, LIMIT).forEach(function (p) {
        html += '<tr class="clickable" data-id="' + p.id + '">' + COLS.map(function (c) {
          var v = p[c.key];
          if (c.key === 'name') return '<td><span class="dot" style="background:' + scheme.colorOf(p) + '"></span>' + esc(v) + '</td>';
          if (c.num) return '<td class="num">' + (c.key === 'psenCount' ? v : fmt(v)) + '</td>';
          return '<td' + (c.key === 'issueStr' && v ? ' class="bad"' : '') + '>' + esc(v) + '</td>';
        }).join('') + '</tr>';
      });
      body.innerHTML = html + '</tbody></table>';
      body.querySelectorAll('th').forEach(function (th) {
        th.onclick = function () {
          var k = th.getAttribute('data-k');
          state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
          renderDrawer();
        };
      });
      markTableSelection();
    } else if (state.drawerMode === 'warn') {
      $('drawerTitle').textContent = 'Uyarılar';
      var ws = state.warnings.filter(function (w) { return !q || (w.msg + ' ' + (w.text || '')).toUpperCase().indexOf(q) >= 0; });
      $('drawerInfo').textContent = ws.length + ' uyarı';
      var h = '<table><thead><tr><th>Tür</th><th>Satır</th><th>Mesaj</th><th>Satır içeriği</th></tr></thead><tbody>';
      ws.slice(0, LIMIT).forEach(function (w, i) {
        h += '<tr class="' + (w.name ? 'clickable' : '') + '" data-w="' + i + '"><td>' + esc(warnLabel(w.type)) + '</td><td class="num">' +
          (w.line || '') + '</td><td>' + esc(w.msg) + '</td><td class="muted">' + esc(w.text || '') + '</td></tr>';
      });
      body.innerHTML = h + '</tbody></table>';
      body._ws = ws;
    }
  }

  function warnLabel(t) {
    return {
      'fpdf-short': 'FPDF eksik alan', 'fpdf-coord': 'FPDF koordinat', 'fpdf-noname': 'FPDF isim', 'fpdf-dup': 'FPDF tekrar',
      'mpf-orphan': 'MPF sahipsiz', 'mpf-noname': 'MPF isim', 'mpf-namediff': 'MPF isim farkı', 'mpf-unmatched': 'FPDF\'de yok',
      'rule-exclusive': 'Kural ihlali', 'match-suffix': 'Sonek eşleşme'
    }[t] || t;
  }

  function markTableSelection() {
    var sel = state.selected;
    $('drawerBody').querySelectorAll('tr.sel').forEach(function (r) { r.classList.remove('sel'); });
    if (!sel) return;
    var row = $('drawerBody').querySelector('tr[data-id="' + sel.id + '"]');
    if (row) row.classList.add('sel');
  }

  $('drawerBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr || !state.result) return;
    if (tr.hasAttribute('data-id')) {
      select(state.result.points[+tr.getAttribute('data-id')], true);
    } else if (tr.hasAttribute('data-w')) {
      var w = $('drawerBody')._ws[+tr.getAttribute('data-w')];
      if (!w || !w.name) return;
      var p = state.result.points.filter(function (x) { return x.name === w.name; })[0];
      if (p) select(p, true);
    }
  });
  $('drawerFilter').addEventListener('input', renderDrawer);
  $('btnTable').onclick = function () { openDrawer('table'); };
  $('btnWarn').onclick = function () { openDrawer('warn'); };
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.onclick = function () {
      if (b.getAttribute('data-close') === 'drawer') closeDrawer();
      else select(null);
    };
  });

  // ------------------------------------------------------------------ FPDF önizleme
  function updatePreview() {
    var el = $('fpdfPreview');
    if (!state.text.fpdf) { el.innerHTML = ''; return; }
    var cfg = state.settings.fpdf;
    var delim = cfg.delimiter === '\\t' ? '\t' : (cfg.delimiter || ',');
    var lines = state.text.fpdf.split(/\r\n|\r|\n/).filter(function (l) { l = l.trim(); return l && l.indexOf(cfg.commentPrefix) !== 0; }).slice(0, 5);
    if (!lines.length) { el.innerHTML = ''; return; }
    var rows = lines.map(function (l) { return l.trim().split(delim); });
    var n = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var role = {};
    role[cfg.procCol] = 'Proses'; role[cfg.nameCol] = 'İsim'; role[cfg.xCol] = 'X'; role[cfg.yCol] = 'Y'; role[cfg.zCol] = 'Z';
    var html = '<div class="muted">İlk satırlar (sütun numaraları):</div><table><tr>';
    for (var i = 1; i <= n; i++) html += '<th class="' + (role[i] ? 'sel' : '') + '">' + i + (role[i] ? ' ' + role[i] : '') + '</th>';
    html += '</tr>';
    rows.forEach(function (r) {
      html += '<tr>';
      for (var i = 0; i < n; i++) html += '<td>' + esc(r[i] !== undefined ? r[i] : '') + '</td>';
      html += '</tr>';
    });
    el.innerHTML = html + '</table>';
  }

  // ------------------------------------------------------------------ ayarlar formu
  var FORM = [
    ['cfgDelim', 'fpdf', 'delimiter'], ['cfgProc', 'fpdf', 'procCol', true], ['cfgName', 'fpdf', 'nameCol', true],
    ['cfgX', 'fpdf', 'xCol', true], ['cfgY', 'fpdf', 'yCol', true], ['cfgZ', 'fpdf', 'zCol', true],
    ['cfgType', 'fpdf', 'typeCol', 'zero'],
    ['cfgPos', 'mpf', 'positionKeywords'], ['cfgProcKw', 'mpf', 'processKeywords'],
    ['cfgExcl', 'mpf', 'exclusiveKeywords'], ['cfgRep', 'mpf', 'repeatableKeyword'], ['cfgNameSrc', 'mpf', 'nameSource']
  ];
  function settingsToForm() {
    FORM.forEach(function (f) { $(f[0]).value = state.settings[f[1]][f[2]]; });
    $('cfgCI').checked = state.settings.matchCaseInsensitive;
    $('cfgSuffix').checked = state.settings.suffixMatch;
  }
  function formToSettings() {
    FORM.forEach(function (f) {
      var v = $(f[0]).value;
      if (f[3]) { v = parseInt(v, 10); if (!(v >= (f[3] === 'zero' ? 0 : 1))) return; }
      state.settings[f[1]][f[2]] = v;
    });
    state.settings.matchCaseInsensitive = $('cfgCI').checked;
    state.settings.suffixMatch = $('cfgSuffix').checked;
    saveSettings();
  }
  settingsToForm();
  $('btnApply').onclick = function () { formToSettings(); state.hiddenShapes = {}; process(); };
  $('btnReset').onclick = function () { state.settings = Proses.mergeSettings(); settingsToForm(); saveSettings(); process(); };
  // Sütun numaraları değiştikçe önizlemeyi güncelle
  ['cfgDelim', 'cfgProc', 'cfgName', 'cfgX', 'cfgY', 'cfgZ', 'cfgType'].forEach(function (id) {
    $(id).addEventListener('change', function () { formToSettings(); process(); });
  });

  $('btnSettingsExport').onclick = function () {
    download('proses3d-ayarlar.json', JSON.stringify(state.settings, null, 2), 'application/json');
  };
  $('inSettings').onchange = function (e) {
    var f = e.target.files[0];
    if (f) readSettingsFile(f);
    e.target.value = '';
  };
  function readSettingsFile(f) {
    var r = new FileReader();
    r.onload = function () {
      try {
        state.settings = Proses.mergeSettings(JSON.parse(r.result));
        settingsToForm(); saveSettings(); process();
      } catch (err) { alert('Ayar dosyası okunamadı: ' + err.message); }
    };
    r.readAsText(f);
  }

  // ------------------------------------------------------------------ gösterim kontrolleri
  $('colorMode').onchange = function () { state.hiddenColors = {}; buildLegend(); rebuildPoints(); updateStats(); renderSummary(); if (state.drawerMode) renderDrawer(); };
  $('chkSummary').onchange = renderSummary;
  $('mapTitle').addEventListener('input', renderSummary);
  $('ptSize').oninput = function () {
    $('ptSizeVal').textContent = this.value;
    rebuildPoints();
  };
  $('chkAxes').onchange = function () { helpers.visible = this.checked; };
  $('chkOnTop').onchange = rebuildPoints;
  $('chkLabels').onchange = updateLabel;
  document.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { setView(b.getAttribute('data-view')); }; });

  // ------------------------------------------------------------------ 3D model
  function applyModelMaterial() {
    modelMaterial.color.set($('mdlColor').value);
    var op = +$('mdlOpacity').value;
    modelMaterial.opacity = op;
    modelMaterial.transparent = op < 1;
    modelMaterial.depthWrite = op >= 1;
    modelMaterial.wireframe = $('mdlWire').checked;
    modelMaterial.needsUpdate = true;
    if (model) model.visible = $('mdlVisible').checked;
  }
  function applyModelTransform() {
    var n = function (id) { var v = parseFloat($(id).value); return isFinite(v) ? v : 0; };
    modelRoot.position.set(n('mdlTx'), n('mdlTy'), n('mdlTz'));
    var d = THREE.MathUtils.degToRad;
    modelRoot.rotation.set(d(n('mdlRx')), d(n('mdlRy')), d(n('mdlRz')));
    var s = parseFloat($('mdlScale').value);
    modelRoot.scale.setScalar(isFinite(s) && s !== 0 ? s : 1);
  }
  ['mdlColor', 'mdlOpacity', 'mdlWire', 'mdlVisible'].forEach(function (id) { $(id).addEventListener('input', applyModelMaterial); });
  ['mdlTx', 'mdlTy', 'mdlTz', 'mdlRx', 'mdlRy', 'mdlRz', 'mdlScale'].forEach(function (id) { $(id).addEventListener('input', applyModelTransform); });
  $('mdlRemove').onclick = function () { setModel(null, ''); state.modelSrc = null; };

  function setModel(obj, name) {
    if (model) {
      modelRoot.remove(model);
      model.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    model = obj;
    $('lblModel').textContent = name || '—';
    $('lblModel').className = 'fname' + (name ? ' ok' : '');
    if (obj) {
      obj.traverse(function (o) { if (o.isMesh) o.material = modelMaterial; });
      modelRoot.add(obj);
      applyModelMaterial();
      applyModelTransform();
      if (!state.result) setView('iso');
    }
    rebuildHelpers(dataBox(true));
  }

  function meshFromGeometry(g) {
    if (!g.attributes.normal) g.computeVertexNormals();
    return new THREE.Mesh(g, modelMaterial);
  }

  var MODEL_EXTS = ['stl', 'wrl', 'vrml', 'obj', 'ply', 'glb'];
  var TEXT_MODELS = ['wrl', 'vrml', 'obj'];

  function loadModelFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    var r = new FileReader();
    r.onerror = function () { alert('Model okunamadı'); };
    r.onload = function () { loadModelData(ext, r.result, file.name); };
    if (TEXT_MODELS.indexOf(ext) >= 0) r.readAsText(file); else r.readAsArrayBuffer(file);
  }

  function loadModelData(ext, data, name) {
    // Paylaşım dosyasına gömebilmek için ham veriyi sakla
    state.modelSrc = { ext: ext, name: name, data: data };
    try {
      if (ext === 'wrl' || ext === 'vrml') {
        if (typeof data !== 'string') data = new TextDecoder().decode(data);
        if (/^\s*#VRML V1/i.test(data)) throw new Error('VRML 1.0 desteklenmiyor; CATIA\'dan VRML 97 (V2.0) olarak kaydedin');
        setModel(new THREE.VRMLLoader().parse(data, ''), name);
      } else if (ext === 'stl') setModel(meshFromGeometry(new THREE.STLLoader().parse(data)), name);
      else if (ext === 'ply') setModel(meshFromGeometry(new THREE.PLYLoader().parse(data)), name);
      else if (ext === 'obj') setModel(new THREE.OBJLoader().parse(data), name);
      else if (ext === 'glb' || ext === 'gltf') {
        new THREE.GLTFLoader().parse(data, '', function (gltf) { setModel(gltf.scene, name); },
          function (err) { alert('GLTF/GLB okunamadı: ' + (err && err.message || err)); });
      } else { state.modelSrc = null; alert('Desteklenmeyen model biçimi: ' + ext); }
    } catch (err) {
      state.modelSrc = null;
      alert('Model okunamadı: ' + err.message);
    }
  }

  // ------------------------------------------------------------------ dosya yükleme
  function readText(kind) {
    var f = state.files[kind];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      state.text[kind] = r.result;
      state.names[kind] = f.name;
      var lbl = $(kind === 'fpdf' ? 'lblFpdf' : 'lblMpf');
      lbl.textContent = f.name;
      lbl.className = 'fname ok';
      process();
    };
    r.readAsText(f, $('encoding').value);
  }
  function setFile(kind, f) { state.files[kind] = f; if (kind === 'fpdf') state.firstFit = true; readText(kind); }

  $('inFpdf').onchange = function (e) { if (e.target.files[0]) setFile('fpdf', e.target.files[0]); e.target.value = ''; };
  $('inMpf').onchange = function (e) { if (e.target.files[0]) setFile('mpf', e.target.files[0]); e.target.value = ''; };
  $('inModel').onchange = function (e) { if (e.target.files[0]) loadModelFile(e.target.files[0]); e.target.value = ''; };
  $('encoding').onchange = function () { readText('fpdf'); readText('mpf'); };

  function routeFile(f) {
    var ext = f.name.split('.').pop().toLowerCase();
    if (ext === 'fpdf') setFile('fpdf', f);
    else if (ext === 'mpf' || ext === 'spf') setFile('mpf', f);
    else if (MODEL_EXTS.indexOf(ext) >= 0) loadModelFile(f);
    else if (ext === 'json') readSettingsFile(f);
    else alert('"' + f.name + '" için dosya türü anlaşılamadı. Lütfen sol paneldeki düğmeleri kullanın.');
  }
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; $('dropHint').hidden = false; });
  window.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').hidden = true; } });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true;
    Array.prototype.forEach.call(e.dataTransfer.files, routeFile);
  });

  // Örnek veri (ornek/ornek-data.js içine gömülü; file:// altında fetch çalışmadığı için)
  $('btnDemo').onclick = function () {
    var D = window.ORNEK_VERI;
    if (!D) { alert('Örnek veri bulunamadı'); return; }
    state.text.fpdf = D.fpdf; state.text.mpf = D.mpf;
    state.names = { fpdf: 'ornek.fpdf', mpf: 'ornek.mpf' };
    $('lblFpdf').textContent = 'ornek.fpdf'; $('lblFpdf').className = 'fname ok';
    $('lblMpf').textContent = 'ornek.mpf'; $('lblMpf').className = 'fname ok';
    state.firstFit = true;
    process();
    if (D.stlBase64) {
      loadModelData('stl', b64ToBuf(D.stlBase64), 'ornek_panel.stl');
    }
  };

  // ------------------------------------------------------------------ dışa aktarma
  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function baseName() { return (state.names.fpdf || 'proses').replace(/\.[^.]+$/, ''); }

  $('btnCsv').onclick = function () {
    if (!state.result) return;
    var rows = [['Baglayici', 'Tip', 'FPDF_Proses', 'X', 'Y', 'Z', 'FPDF_Satir', 'MPF_Pozisyon', 'PSEN_Sayisi', 'Tekil_Proses', 'Kombinasyon', 'MPF_Prosesler', 'Uyari']];
    state.result.points.forEach(function (p) {
      rows.push([p.name, p.type, p.fpdfProc, p.x, p.y, p.z, p.line, p.positionCount, p.psenCount, p.exclusive.join(','), p.combo,
        p.processes.map(function (x) { return x.code + '@' + x.line; }).join(' '), p.issues.join(' | ')]);
    });
    state.result.unmatched.forEach(function (u) {
      rows.push([u.name, '', '', '', '', '', '', '', '', '', 'FPDF\'de yok', u.processes.map(function (x) { return x.code + '@' + x.line; }).join(' '), 'FPDF\'de yok']);
    });
    download(baseName() + '_noktalar.csv', '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'), 'text/csv');
  };
  $('btnWarnCsv').onclick = function () {
    var rows = [['Tur', 'Satir', 'Mesaj', 'Icerik']];
    state.warnings.forEach(function (w) { rows.push([warnLabel(w.type), w.line || '', w.msg, w.text || '']); });
    download(baseName() + '_uyarilar.csv', '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'), 'text/csv');
  };

  // ------------------------------------------------------------------ özet lejantı
  // Harita üzerindeki özet: bağlayıcı tipleri, toplamlar ve PSEN sayıları.
  // Aynı satır listesi hem HTML panelde hem PNG çıktısında kullanılır.
  function summaryLines() {
    var r = state.result, pts = r.points;
    var types = {}, psenPts = 0, psenOps = 0, excl = {};
    pts.forEach(function (p) {
      var t = p.type || '(boş)';
      types[t] = (types[t] || 0) + 1;
      if (p.psenCount) { psenPts++; psenOps += p.psenCount; }
      p.exclusive.filter(function (c, i, a) { return a.indexOf(c) === i; }).forEach(function (c) { excl[c] = (excl[c] || 0) + 1; });
    });
    var typeColors = $('colorMode').value === 'type' ? colorScheme() : null;
    var defs = shapeDefs(), lines = [];
    var meta = [state.names.fpdf, state.names.mpf].filter(Boolean).join(' · ');
    var when = state.shared ? new Date(state.shared.created) : new Date();
    lines.push({ kind: 'title', label: $('mapTitle').value.trim() || 'Proses haritası' });
    lines.push({ kind: 'meta', label: (meta ? meta + ' · ' : '') + when.toLocaleDateString('tr-TR') });
    lines.push({ kind: 'row', label: 'Toplam bağlayıcı', value: pts.length });
    lines.push({ kind: 'row', big: true, label: 'PSEN olan nokta', value: psenPts });
    lines.push({ kind: 'row', label: 'Toplam PSEN işlemi', value: psenOps });
    lines.push({ kind: 'sec', label: 'Bağlayıcı tipleri' });
    Object.keys(types).sort(naturalCmp).forEach(function (t) {
      lines.push({ kind: 'row', label: t, value: types[t], color: typeColors && typeColors.map[t] ? typeColors.map[t].color : null });
    });
    lines.push({ kind: 'sec', label: 'Tekil prosesler (nokta)' });
    defs.forEach(function (d) {
      if (d.key === 'NONE' || d.key === 'MULTI' || d.key === 'OUT') return;
      lines.push({ kind: 'row', label: d.label, value: excl[d.key] || 0, shape: d.shape });
    });
    lines.push({ kind: 'sec', label: 'Kontrol' });
    lines.push({ kind: 'row', label: 'MPF\'de olmayan nokta', value: r.summary.notInMpf, shape: 'ring' });
    lines.push({ kind: 'row', label: 'FPDF\'de olmayan isim', value: r.unmatched.length });
    if (r.summary.withIssues) lines.push({ kind: 'row', label: 'Kural ihlali', value: r.summary.withIssues, shape: 'star', color: '#ff1744' });
    return lines;
  }

  function renderSummary() {
    var el = $('summary');
    if (!state.result || !$('chkSummary').checked) { el.hidden = true; return; }
    var html = '';
    summaryLines().forEach(function (l) {
      if (l.kind === 'title') html += '<h4>' + esc(l.label) + '</h4>';
      else if (l.kind === 'meta') html += '<div class="meta">' + esc(l.label) + '</div>';
      else if (l.kind === 'sec') html += '<div class="sec">' + esc(l.label) + '</div>';
      else {
        var icon = l.shape ? '<canvas data-shape="' + l.shape + '" data-color="' + (l.color || '#c9d3de') + '"></canvas>'
          : l.color ? '<span class="sw" style="background:' + l.color + '"></span>' : '';
        html += '<div class="ln' + (l.big ? ' big' : '') + '">' + icon + '<span>' + esc(l.label) + '</span><span class="v">' + l.value + '</span></div>';
      }
    });
    el.innerHTML = html;
    el.querySelectorAll('canvas[data-shape]').forEach(function (cv) {
      cv.width = cv.height = 26;
      drawShape(cv, cv.getAttribute('data-shape'), cv.getAttribute('data-color'), 'rgba(0,0,0,.8)');
    });
    el.hidden = false;
  }

  // PNG çıktısı için özeti 2D tuvale çizer
  function drawSummaryCanvas(c, pr) {
    var lines = summaryLines();
    var pad = 12 * pr, lh = 18 * pr, w = 0, h = pad * 2;
    var font = function (l) {
      return (l.kind === 'title' ? '600 ' + 15 * pr : l.big ? '600 ' + 13 * pr : (l.kind === 'meta' || l.kind === 'sec' ? 11 : 12) * pr) + 'px "Segoe UI", sans-serif';
    };
    lines.forEach(function (l) {
      c.font = font(l);
      var lw = c.measureText(l.label).width + (l.kind === 'row' ? 70 * pr : 0);
      w = Math.max(w, lw);
      h += l.kind === 'sec' ? lh * 1.3 : lh;
    });
    w = Math.max(w + pad * 2, 220 * pr);
    var x0 = 10 * pr, y0 = 10 * pr;
    c.fillStyle = 'rgba(23,30,38,.92)';
    c.strokeStyle = '#2c3845';
    c.lineWidth = pr;
    c.fillRect(x0, y0, w, h);
    c.strokeRect(x0, y0, w, h);
    var y = y0 + pad;
    lines.forEach(function (l) {
      if (l.kind === 'sec') y += lh * 0.3;
      c.font = font(l);
      c.textBaseline = 'middle';
      var cy = y + lh / 2, x = x0 + pad;
      c.fillStyle = l.kind === 'meta' || l.kind === 'sec' ? '#8796a8' : '#dbe3ec';
      if (l.kind === 'row') {
        var s = 12 * pr;
        if (l.shape) {
          var ic = document.createElement('canvas');
          ic.width = ic.height = Math.round(s * 2);
          drawShape(ic, l.shape, l.color || '#c9d3de', 'rgba(0,0,0,.8)');
          c.drawImage(ic, x, cy - s / 2, s, s);
          x += s + 6 * pr;
        } else if (l.color) {
          c.fillStyle = l.color;
          c.fillRect(x, cy - s / 2, s, s);
          c.fillStyle = '#dbe3ec';
          x += s + 6 * pr;
        }
        c.fillText(l.label, x, cy);
        c.textAlign = 'right';
        c.fillStyle = l.big ? '#66bb6a' : '#dbe3ec';
        c.fillText(String(l.value), x0 + w - pad, cy);
        c.textAlign = 'left';
      } else {
        c.fillText(l.kind === 'sec' ? l.label.toUpperCase() : l.label, x, cy);
      }
      y += lh;
    });
  }

  $('btnPng').onclick = function () {
    if (!state.result) return;
    renderer.render(scene, camera); // çizim tamponu silinmeden hemen kopyala
    var src = renderer.domElement, pr = renderer.getPixelRatio();
    var cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    var c = cv.getContext('2d');
    c.drawImage(src, 0, 0);
    if ($('chkSummary').checked) drawSummaryCanvas(c, pr);
    cv.toBlob(function (b) { download(shareName() + '.png', b, 'image/png'); });
  };

  // ------------------------------------------------------------------ paylaşım
  function bufToB64(buf) {
    var b = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return btoa(s);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64), buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  function shareName() {
    var t = $('mapTitle').value.trim() || baseName();
    return t.replace(/[\\/:*?"<>|]+/g, '_') + '_harita';
  }

  var VIEW_INPUTS = ['colorMode', 'ptSize', 'chkAxes', 'chkOnTop', 'chkLabels', 'chkSummary', 'mapTitle',
    'mdlColor', 'mdlOpacity', 'mdlWire', 'mdlVisible', 'mdlTx', 'mdlTy', 'mdlTz', 'mdlRx', 'mdlRy', 'mdlRz', 'mdlScale'];

  function collectShare() {
    var inputs = {};
    VIEW_INPUTS.forEach(function (id) { var el = $(id); inputs[id] = el.type === 'checkbox' ? el.checked : el.value; });
    var m = null, src = state.modelSrc;
    if (src && model && $('shareModel').checked) {
      m = { name: src.name, ext: src.ext };
      if (typeof src.data === 'string') m.text = src.data; else m.b64 = bufToB64(src.data);
    }
    return {
      app: 'proses3d', v: 1, created: new Date().toISOString(),
      viewerOnly: $('shareViewer').checked,
      names: state.names, fpdf: state.text.fpdf, mpf: state.text.mpf,
      settings: state.settings, inputs: inputs,
      hiddenShapes: state.hiddenShapes, hiddenColors: state.hiddenColors,
      camera: { position: camera.position.toArray(), target: controls.target.toArray() },
      model: m
    };
  }

  $('btnShare').onclick = function () {
    if (!state.result) { alert('Önce FPDF dosyasını yükleyin.'); return; }
    if (!TEMPLATE) {
      alert('Harita dosyası yalnızca tek dosyalık "Proses3D.html" sürümünden kaydedilebilir.');
      return;
    }
    var json = JSON.stringify(collectShare()).replace(/</g, '\\u003c');
    var tag = '<script id="paylasimVeri" type="application/json">' + json + '</' + 'script>\n';
    // Yerine koyma metninde "$" kalıpları yorumlanmasın diye fonksiyon kullanılıyor
    var html = TEMPLATE.replace('</head>', function () { return tag + '</head>'; });
    download(shareName() + '.html', html, 'text/html');
  };

  function applyShare(d) {
    state.shared = d;
    if (d.viewerOnly) {
      // Yalnızca 3D görünüm ve lejant; düzenleme paneli gizlenir
      document.body.classList.add('viewer');
      if (d.inputs) d.inputs.chkSummary = true;
      resize();
    }
    state.settings = Proses.mergeSettings(d.settings);
    settingsToForm();
    var inputs = d.inputs || {};
    Object.keys(inputs).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!inputs[id]; else el.value = inputs[id];
    });
    $('ptSizeVal').textContent = $('ptSize').value;
    helpers.visible = $('chkAxes').checked;
    state.text.fpdf = d.fpdf || '';
    state.text.mpf = d.mpf || '';
    state.names = d.names || { fpdf: '', mpf: '' };
    [['lblFpdf', state.names.fpdf], ['lblMpf', state.names.mpf]].forEach(function (x) {
      $(x[0]).textContent = x[1] || '—';
      $(x[0]).className = 'fname' + (x[1] ? ' ok' : '');
    });
    state.hiddenShapes = d.hiddenShapes || {};
    state.hiddenColors = d.hiddenColors || {};
    state.firstFit = false;
    process();
    if (d.model) loadModelData(d.model.ext, d.model.text !== undefined ? d.model.text : b64ToBuf(d.model.b64), d.model.name);
    if (d.camera) {
      camera.position.fromArray(d.camera.position);
      controls.target.fromArray(d.camera.target);
      var dist = camera.position.distanceTo(controls.target);
      camera.near = Math.max(dist / 1000, 0.01);
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.update();
    } else setView('iso');
    document.title = ($('mapTitle').value.trim() || 'Proses haritası') + ' - Proses 3D';
  }

  // ------------------------------------------------------------------ başlat
  resize();
  animate();
  refreshAll();
  // Paylaşılmış harita dosyası olarak açıldıysa gömülü veriyi yükle
  var shared = document.getElementById('paylasimVeri');
  if (shared) {
    try { applyShare(JSON.parse(shared.textContent)); }
    catch (err) { alert('Harita verisi okunamadı: ' + err.message); }
  }
  // Test / hata ayıklama için
  window.proses3d = { state: state, process: process, select: select, setView: setView, camera: camera };
})();
