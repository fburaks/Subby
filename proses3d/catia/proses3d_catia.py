# -*- coding: utf-8 -*-
"""
Proses 3D -> CATIA V5 aktarımı

Proses 3D'nin "CATIA CSV" düğmesiyle kaydedilen dosyadaki noktaları açık CATIA oturumundaki
Part dokümanına renk ve sembolleriyle birlikte aktarır.

Gereksinimler (Windows):
    - CATIA V5 açık olmalı
    - Python 3 ve pywin32:  py -m pip install pywin32

Kullanım:
    Çift tıklama                                       -> CSV dosyası seçme penceresi açılır
    py proses3d_catia.py harita_catia.csv              -> aktif Part dokümanına aktarır
    py proses3d_catia.py harita_catia.csv --yeni       -> yeni bir Part oluşturup oraya aktarır
    py proses3d_catia.py --sembol-testi                -> CATIA sembol numaralarını gösteren test noktaları

Python kurulu değilse aynı işi CATIA içinden çalışan Proses3D_CATIA.CATScript makrosu yapar.

Yapı: "Proses3D_<başlık>" adlı bir geometrik set ve içinde her kategori için bir alt set oluşturulur.
Nokta adları: <nokta adı>,<bağlayıcı tipi>,<proses>
"""
import csv
import sys
import traceback

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


class Hata(Exception):
    """Kullanıcıya gösterilecek, açıklaması belli hata."""


def win32_yukle():
    try:
        import win32com.client
    except ImportError:
        raise Hata('pywin32 kurulu değil. Komut isteminde şunu çalıştırın:\n'
                   '    py -m pip install pywin32\n'
                   '(İnternet yoksa Proses3D_CATIA.CATScript makrosunu kullanın.)')
    return win32com.client


def catia_baglan():
    client = win32_yukle()
    print('CATIA\'ya bağlanılıyor...')
    try:
        catia = client.GetActiveObject('CATIA.Application')
    except Exception as e:
        raise Hata('Açık bir CATIA V5 bulunamadı (%s).\n'
                   'CATIA\'yı açın. CATIA yönetici olarak çalışıyorsa bu betiği de yönetici olarak çalıştırın.' % e)
    print('  CATIA bulundu.')
    return catia


def part_al(catia, yeni):
    if not yeni:
        try:
            doc = catia.ActiveDocument
        except Exception:
            doc = None
        if doc is not None and doc.Name.lower().endswith('.catpart'):
            print('  Aktif doküman: %s' % doc.Name)
            return doc.Part
        ad = doc.Name if doc is not None else '(açık doküman yok)'
        if not evet_mi('Aktif doküman bir CATPart değil: %s\nYeni bir Part oluşturulsun mu?' % ad):
            raise Hata('İptal edildi. Hedef CATPart\'ı açıp tekrar çalıştırın.')
    doc = catia.Documents.Add('Part')
    print('  Yeni Part oluşturuldu: %s' % doc.Name)
    return doc.Part


def evet_mi(soru):
    try:
        from tkinter import Tk, messagebox
        kok = Tk()
        kok.withdraw()
        cevap = messagebox.askyesno('Proses 3D -> CATIA', soru)
        kok.destroy()
        return cevap
    except Exception:
        return input(soru + ' [e/h] ').strip().lower().startswith('e')


def csv_sec():
    try:
        from tkinter import Tk, filedialog
        kok = Tk()
        kok.withdraw()
        yol = filedialog.askopenfilename(title='Proses 3D CATIA CSV dosyasını seçin',
                                         filetypes=[('CATIA CSV', '*.csv'), ('Tüm dosyalar', '*.*')])
        kok.destroy()
        return yol
    except Exception:
        return input('CSV dosyasının yolu: ').strip().strip('"')


def csv_oku(yol):
    print('CSV okunuyor: %s' % yol)
    try:
        with open(yol, newline='', encoding='utf-8-sig') as f:
            satirlar = list(csv.DictReader(f, delimiter=';'))
    except OSError as e:
        raise Hata('CSV açılamadı: %s' % e)
    gerekli = {'Ad', 'X', 'Y', 'Z', 'R', 'G', 'B', 'Sekil', 'Grup'}
    if not satirlar or not gerekli.issubset(satirlar[0].keys()):
        raise Hata('CSV biçimi tanınmadı. Dosyayı Proses 3D\'deki "CATIA CSV" düğmesiyle kaydedin '
                   '("Nokta listesi (CSV)" farklı bir dosyadır).')
    print('  %d nokta okundu.' % len(satirlar))
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

    print('%d nokta, %d grup oluşturuluyor...' % (len(satirlar), len(gruplar)))
    for i, s in enumerate(satirlar, 1):
        g = gruplar[s['Grup']]
        nokta = hsf.AddNewPointCoord(float(s['X']), float(s['Y']), float(s['Z']))
        g['set'].AppendHybridShape(nokta)
        nokta.Name = guvenli_ad(s['Ad'])
        g['noktalar'].append(nokta)
        if i % 500 == 0:
            print('  %d / %d' % (i, len(satirlar)))
    print('Part güncelleniyor...')
    part.Update()

    # Renk ve sembolü her grup için tek seçimle uygula
    print('Renk ve semboller uygulanıyor...')
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
    print('Tamamlandı: "%s" geometrik seti, %d nokta.' % (ana_set.Name, len(satirlar)))


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


def main(argv):
    dosyalar = [a for a in argv if not a.startswith('--')]
    if '--sembol-testi' in argv:
        sembol_testi()
        return
    if not dosyalar:
        # Çift tıklamayla açıldı: dosya seçtir
        yol = csv_sec()
        if not yol:
            raise Hata('CSV dosyası seçilmedi.')
        dosyalar = [yol]
    aktar(dosyalar[0], yeni='--yeni' in argv)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Hata as e:
        print('\nHATA: %s' % e)
    except Exception:
        print('\nBeklenmeyen hata:')
        traceback.print_exc()
    # Çift tıklamayla açılan pencere hemen kapanmasın
    try:
        input('\nKapatmak için Enter\'a basın...')
    except EOFError:
        pass
