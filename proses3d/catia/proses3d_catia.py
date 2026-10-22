# -*- coding: utf-8 -*-
"""
Proses 3D -> CATIA V5 aktarımı

Proses 3D'nin "CATIA CSV" düğmesiyle kaydedilen dosyadaki noktaları açık CATIA oturumundaki
Part dokümanına renk ve sembolleriyle birlikte aktarır.

Gereksinimler (Windows):
    - CATIA V5 açık olmalı
    - Python 3 ve pywin32:  pip install pywin32

Kullanım:
    python proses3d_catia.py harita_catia.csv           -> aktif Part dokümanına aktarır
    python proses3d_catia.py harita_catia.csv --yeni    -> yeni bir Part oluşturup oraya aktarır
    python proses3d_catia.py --sembol-testi             -> CATIA sembol numaralarını gösteren test noktaları

Yapı: "Proses3D_<başlık>" adlı bir geometrik set ve içinde her kategori için bir alt set oluşturulur.
Nokta adları: <nokta adı>-<bağlayıcı tipi>-<proses>
"""
import csv
import sys

import win32com.client

# Proses 3D şekil adı -> CATIA nokta sembolü (VisPropertySet.SetSymbolType numarası).
# Numaraların karşılığı CATIA sürümüne göre değişebilir. Emin olmak için önce
# "--sembol-testi" ile test noktalarını oluşturup Graphic Properties'teki sembollerle
# karşılaştırın ve gerekirse aşağıdaki numaraları değiştirin.
SEMBOLLER = {
    'circle': 7,     # dolu daire
    'square': 8,     # dolu kare
    'triangle': 9,   # dolu üçgen
    'diamond': 4,    # iç içe daire
    'star': 6,       # yıldız (*)
    'ring': 3,       # boş daire
    'pentagon': 2,   # artı (+)
    'hexagon': 1,    # çarpı (X)
}
VARSAYILAN_SEMBOL = 7


def catia_baglan():
    try:
        return win32com.client.GetActiveObject('CATIA.Application')
    except Exception:
        sys.exit('CATIA bulunamadı. Önce CATIA V5\'i açın.')


def part_al(catia, yeni):
    if yeni:
        return catia.Documents.Add('Part').Part
    try:
        doc = catia.ActiveDocument
    except Exception:
        doc = None
    if doc is None or not doc.Name.lower().endswith('.catpart'):
        sys.exit('Aktif doküman bir CATPart değil. Part dokümanını açın veya --yeni kullanın.')
    return doc.Part


def csv_oku(yol):
    with open(yol, newline='', encoding='utf-8-sig') as f:
        satirlar = list(csv.DictReader(f, delimiter=';'))
    gerekli = {'Ad', 'X', 'Y', 'Z', 'R', 'G', 'B', 'Sekil', 'Grup'}
    if not satirlar or not gerekli.issubset(satirlar[0].keys()):
        sys.exit('CSV biçimi tanınmadı. Dosyayı Proses 3D\'deki "CATIA CSV" düğmesiyle kaydedin.')
    return satirlar


def guvenli_ad(ad):
    # CATIA ağacında sorun çıkarabilecek karakterleri değiştir
    for c in '\\/:*?"<>|':
        ad = ad.replace(c, '_')
    return ad.strip() or 'Nokta'


def aktar(csv_yolu, yeni=False):
    satirlar = csv_oku(csv_yolu)
    catia = catia_baglan()
    part = part_al(catia, yeni)
    doc = part.Parent
    hsf = part.HybridShapeFactory

    baslik = satirlar[0].get('Harita') or 'Harita'
    ana_set = part.HybridBodies.Add()
    ana_set.Name = guvenli_ad('Proses3D_' + baslik)

    # Grupları CSV'deki sırayla oluştur
    gruplar = {}
    for s in satirlar:
        g = s['Grup']
        if g not in gruplar:
            alt = ana_set.HybridBodies.Add()
            alt.Name = guvenli_ad(g)
            gruplar[g] = {'set': alt, 'noktalar': [], 'renk': (int(s['R']), int(s['G']), int(s['B'])),
                          'sembol': SEMBOLLER.get(s['Sekil'], VARSAYILAN_SEMBOL)}

    print('%d nokta, %d grup aktarılıyor...' % (len(satirlar), len(gruplar)))
    for i, s in enumerate(satirlar, 1):
        g = gruplar[s['Grup']]
        nokta = hsf.AddNewPointCoord(float(s['X']), float(s['Y']), float(s['Z']))
        g['set'].AppendHybridShape(nokta)
        nokta.Name = guvenli_ad(s['Ad'])
        g['noktalar'].append(nokta)
        if i % 500 == 0:
            print('  %d / %d' % (i, len(satirlar)))
    part.Update()

    # Renk ve sembolü her grup için tek seçimle uygula
    sel = doc.Selection
    for ad, g in gruplar.items():
        sel.Clear()
        for n in g['noktalar']:
            sel.Add(n)
        vis = sel.VisProperties
        vis.SetRealColor(g['renk'][0], g['renk'][1], g['renk'][2], 1)
        vis.SetSymbolType(g['sembol'])
        print('  %-28s %5d nokta  RGB%s  sembol %d' % (ad, len(g['noktalar']), g['renk'], g['sembol']))
    sel.Clear()
    print('Tamamlandı: "%s"' % ana_set.Name)


def sembol_testi():
    """1..13 arası her sembol numarası için bir nokta oluşturur (X ekseni boyunca 10 mm aralıkla)."""
    catia = catia_baglan()
    part = catia.Documents.Add('Part').Part
    hsf = part.HybridShapeFactory
    hb = part.HybridBodies.Add()
    hb.Name = 'Sembol_Testi'
    noktalar = []
    for n in range(1, 14):
        p = hsf.AddNewPointCoord(n * 10.0, 0.0, 0.0)
        hb.AppendHybridShape(p)
        p.Name = 'Sembol_%d' % n
        noktalar.append((n, p))
    part.Update()
    sel = part.Parent.Selection
    for n, p in noktalar:
        sel.Clear()
        sel.Add(p)
        sel.VisProperties.SetSymbolType(n)
    sel.Clear()
    print('Sembol_1 ... Sembol_13 noktaları oluşturuldu. SEMBOLLER tablosunu buna göre düzenleyin.')


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--sembol-testi' in argv:
        sembol_testi()
    elif not [a for a in argv if not a.startswith('--')]:
        print(__doc__)
    else:
        aktar([a for a in argv if not a.startswith('--')][0], yeni='--yeni' in argv)
