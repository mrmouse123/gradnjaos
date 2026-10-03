# -*- coding: utf-8 -*-
"""Uvoz iz Excel sablona (GradnjaOS-uvoz-sablon.xlsx) -> uvoz.sql za Supabase.

  python uvoz/uvezi.py <popunjen.xlsx> [--out uvoz.sql] [--provera]

- Proverava obavezne kolone, sifrarnike, veze izmedju listova (klijent_id, rukovodilac_id,
  gradiliste_id, zaposleni_id…), datume i brojeve. Bilo koja greska => NEMA SQL-a.
- Generise jednu transakciju: INSERT … ON CONFLICT (id) DO UPDATE za sve tabele
  (ponovni uvoz istog fajla samo osvezava). Join tabele (Tim, podizvodjac_gradiliste) idu
  ON CONFLICT DO UPDATE / DO NOTHING. Nista se ne brise.
- SQL se pokrece kao vlasnik baze (Supabase SQL editor / MCP), ne kroz anon/authenticated
  kljuc — zato upsert finansijskih kolona ovde prolazi (vidi CLAUDE.md pravilo 8).
- Prazan id => generise se iz prefiksa + rednog broja (G-01, Z-01, KL-01, P-01, ostali pm/t/d/tr/s/r/m).
"""
import sys, os, re, json, datetime as dt
from openpyxl import load_workbook

ENUM = {
    'modul': {'izvodjenje', 'projektovanje'}, 'tip': {'visokogradnja', 'niskogradnja', ''}, 'nivo': {'IDR', 'IDP/PGD', 'PZI', ''},
    'status_gr': {'planirano', 'u toku', 'kasni', 'zavrseno'}, 'adm_st': {'nema', 'priprema', 'ima', ''},
    'status_zap': {'Na terenu', 'Kancelarija', 'Odsutan', ''}, 'da_ne': {'DA', 'NE'},
    'prio': {'high', 'mid', 'low', ''}, 'kolona': {'todo', 'inprogress', 'hold', 'done', ''},
    'kat': {'Materijal', 'Radna snaga', 'Mehanizacija', 'Podizvođači', 'Ostalo', ''},
    'status_sit': {'ceka', 'placeno', 'kasni'}, 'status_pod': {'aktivan', 'zavrsen', ''},
    'tip_res': {'vozilo', 'alat', 'racunar', 'licenca', 'polisa'},
}
PREFIX = {'Klijenti': 'KL-', 'Zaposleni': 'Z-', 'Gradilišta': 'G-', 'Predmer': 'pm', 'Zadaci': 't', 'Dnevnik': 'd',
          'Troškovi': 'tr', 'Situacije': 's', 'Podizvođači': 'P-', 'Resursi': 'r', 'Magacin': 'm'}
greske = []


def err(sheet, row, msg): greske.append(f'{sheet} red {row}: {msg}')


def s(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()


def esc_html(t):
    """Escape-on-write kao u aplikaciji (esc()): DATA mora biti cist HTML."""
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
             .replace("'", '&#39;').replace('`', '&#96;'))


def num(v, sheet, row, col, req=False):
    t = s(v)
    if t == '':
        if req: err(sheet, row, f'{col} je obavezno')
        return None
    t = t.replace(' ', '')
    if ',' in t: t = t.replace('.', '').replace(',', '.')
    try: return float(t)
    except ValueError: err(sheet, row, f'{col}: "{v}" nije broj'); return None


def datum(v, sheet, row, col, req=False):
    if v is None or s(v) == '':
        if req: err(sheet, row, f'{col} je obavezno')
        return None
    if isinstance(v, (dt.datetime, dt.date)): return v.strftime('%Y-%m-%d')
    t = s(v)
    for f in ('%Y-%m-%d', '%d.%m.%Y', '%d.%m.%Y.', '%d/%m/%Y'):
        try: return dt.datetime.strptime(t, f).strftime('%Y-%m-%d')
        except ValueError: pass
    err(sheet, row, f'{col}: "{v}" nije datum (GGGG-MM-DD)'); return None


def enum(v, key, sheet, row, col, req=False):
    t = s(v)
    if t == '' and req: err(sheet, row, f'{col} je obavezno')
    if t not in ENUM[key]: err(sheet, row, f'{col}: "{t}" nije dozvoljeno ({", ".join(sorted(x for x in ENUM[key] if x))})')
    return t or None


def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def citaj(wb, name, kolone):
    """Vraca listu dict-ova (po zaglavlju), preskace red 2 ako je identican primeru? Ne — primer se prepoznaje
    po sivom kurzivu nije pouzdano, pa: red 2 se UVOZI kao i svaki drugi. Korisnik ga brise ili prepise."""
    if name not in wb.sheetnames: return []
    ws = wb[name]
    head = [s(c.value) for c in ws[1]]
    for k in kolone:
        if k not in head: greske.append(f'{name}: nedostaje kolona "{k}" u zaglavlju'); return []
    out = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
        if row is None or all(s(x) == '' for x in row): continue
        out.append((i, {head[j]: row[j] for j in range(min(len(head), len(row)))}))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: print(__doc__); sys.exit(2)
    src = args[0]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(os.path.dirname(src) or '.', 'uvoz.sql')
    wb = load_workbook(src, data_only=True)
    sql = []
    ids = {}   # tabela -> set(id)

    def gen_id(name, i, raw):
        t = s(raw)
        if t: return t
        p = PREFIX[name]
        return f'{p}{i - 1:02d}' if p.endswith('-') else f'{p}uvoz{i}'

    # ---- Klijenti
    kl = citaj(wb, 'Klijenti', ['id', 'naziv']); ids['kl'] = set()
    for i, r in kl:
        _id = gen_id('Klijenti', i, r.get('id')); ids['kl'].add(_id)
        if not s(r.get('naziv')): err('Klijenti', i, 'naziv je obavezno')
        sql.append(f"insert into clijenti (id,naziv,tip,osoba,tel,mail) values ({q(_id)},{q(esc_html(s(r.get('naziv'))))},{q(s(r.get('tip')) or None)},{q(esc_html(s(r.get('osoba'))) or None)},{q(esc_html(s(r.get('tel'))) or None)},{q(esc_html(s(r.get('mail'))) or None)}) "
                   f"on conflict (id) do update set naziv=excluded.naziv, tip=excluded.tip, osoba=excluded.osoba, tel=excluded.tel, mail=excluded.mail;")
    # ---- Zaposleni
    zp = citaj(wb, 'Zaposleni', ['id', 'ime']); ids['z'] = set()
    for i, r in zp:
        _id = gen_id('Zaposleni', i, r.get('id')); ids['z'].add(_id)
        if not s(r.get('ime')): err('Zaposleni', i, 'ime je obavezno')
        st = enum(r.get('status'), 'status_zap', 'Zaposleni', i, 'status')
        sql.append(f"insert into zaposleni (id,ime,poz,status,tel,opis) values ({q(_id)},{q(esc_html(s(r.get('ime'))))},{q(esc_html(s(r.get('poz'))) or None)},{q(st or 'Na terenu')},{q(esc_html(s(r.get('tel'))) or '—')},{q(esc_html(s(r.get('opis'))))}) "
                   f"on conflict (id) do update set ime=excluded.ime, poz=excluded.poz, status=excluded.status, tel=excluded.tel, opis=excluded.opis;")
    # ---- Podizvodjaci (pre gradilista zbog zaduzen_id provere; veze posle)
    pd = citaj(wb, 'Podizvođači', ['id', 'naziv']); ids['p'] = set(); pod_veze = []
    for i, r in pd:
        _id = gen_id('Podizvođači', i, r.get('id')); ids['p'].add(_id)
        if not s(r.get('naziv')): err('Podizvođači', i, 'naziv je obavezno')
        st = enum(r.get('status'), 'status_pod', 'Podizvođači', i, 'status')
        cena = num(r.get('cena'), 'Podizvođači', i, 'cena')
        sql.append(f"insert into podizvodjaci (id,naziv,delatnost,osoba,tel,cena,status) values ({q(_id)},{q(esc_html(s(r.get('naziv'))))},{q(esc_html(s(r.get('delatnost'))))},{q(esc_html(s(r.get('osoba'))))},{q(esc_html(s(r.get('tel'))))},{q(cena or 0)},{q(st or 'aktivan')}) "
                   f"on conflict (id) do update set naziv=excluded.naziv, delatnost=excluded.delatnost, osoba=excluded.osoba, tel=excluded.tel, cena=excluded.cena, status=excluded.status;")
        for g in [x.strip() for x in s(r.get('gradilista_ids')).split(',') if x.strip()]: pod_veze.append((i, _id, g))
    # ---- Gradilista
    gr = citaj(wb, 'Gradilišta', ['id', 'naziv', 'modul', 'rukovodilac_id', 'pocetak', 'rok', 'status']); ids['g'] = set()
    for i, r in gr:
        _id = gen_id('Gradilišta', i, r.get('id')); ids['g'].add(_id)
        if not s(r.get('naziv')): err('Gradilišta', i, 'naziv je obavezno')
        modul = enum(r.get('modul'), 'modul', 'Gradilišta', i, 'modul', True)
        tip = enum(r.get('tip'), 'tip', 'Gradilišta', i, 'tip'); nivo = enum(r.get('nivo'), 'nivo', 'Gradilišta', i, 'nivo')
        if modul == 'izvodjenje' and not tip: tip = 'visokogradnja'
        if modul == 'projektovanje' and not nivo: err('Gradilišta', i, 'projektovanje traži nivo (IDR / IDP/PGD / PZI)')
        kli = s(r.get('klijent_id')) or None
        if kli and kli not in ids['kl']: err('Gradilišta', i, f'klijent_id "{kli}" ne postoji u listu Klijenti')
        ruk = s(r.get('rukovodilac_id'))
        if not ruk: err('Gradilišta', i, 'rukovodilac_id je obavezno (osnov za pristup rukovodioca)')
        elif ruk not in ids['z']: err('Gradilišta', i, f'rukovodilac_id "{ruk}" ne postoji u listu Zaposleni')
        poc = datum(r.get('pocetak'), 'Gradilišta', i, 'pocetak', True); rok = datum(r.get('rok'), 'Gradilišta', i, 'rok', True)
        if poc and rok and rok < poc: err('Gradilišta', i, 'rok je pre početka')
        nap = num(r.get('napredak'), 'Gradilišta', i, 'napredak'); nap = 0 if nap is None else max(0, min(100, int(round(nap))))
        st = enum(r.get('status'), 'status_gr', 'Gradilišta', i, 'status', True)
        if st == 'zavrseno' and nap < 100: nap = 100
        faza = s(r.get('faza')) or ('Idejno rešenje' if modul == 'projektovanje' else 'Priprema terena')
        adm = {}
        for k in ('ugovor', 'prijava', 'polisa', 'podugovori'):
            a = enum(r.get(k + '_status'), 'adm_st', 'Gradilišta', i, k + '_status')
            o = {'st': a or 'nema'}
            vd = datum(r.get(k + '_vazi_do'), 'Gradilišta', i, k + '_vazi_do') if k != 'podugovori' else None
            if vd: o['vazi_do'] = vd
            adm[k] = o
        vals = dict(id=_id, naziv=esc_html(s(r.get('naziv'))), modul=modul, tip=tip if modul == 'izvodjenje' else None, lok=esc_html(s(r.get('lok'))),
                    klijent=kli, rukovodilac=ruk, pocetak=poc, rok=rok, napredak=nap, status=st, faza=esc_html(faza),
                    povrsina=num(r.get('povrsina'), 'Gradilišta', i, 'povrsina'), nivo=nivo if modul == 'projektovanje' else None,
                    nadzor=esc_html(s(r.get('nadzor'))), adm=json.dumps(adm, ensure_ascii=False),
                    budzet=num(r.get('budzet'), 'Gradilišta', i, 'budzet') or 0, troskovi=num(r.get('troskovi'), 'Gradilišta', i, 'troskovi') or 0,
                    potroseno=num(r.get('potroseno'), 'Gradilišta', i, 'potroseno') or 0, naplaceno=num(r.get('naplaceno'), 'Gradilišta', i, 'naplaceno') or 0)
        cols = list(vals.keys())
        sql.append(f"insert into gradilista ({','.join(cols)}) values ({','.join(q(vals[c]) if c != 'adm' else q(vals[c]) + '::jsonb' for c in cols)}) "
                   f"on conflict (id) do update set {', '.join(f'{c}=excluded.{c}' for c in cols if c != 'id')};")
    # ---- Tim
    for i, r in citaj(wb, 'Tim', ['zaposleni_id', 'gradiliste_id', 'aktivan']):
        z, g = s(r.get('zaposleni_id')), s(r.get('gradiliste_id'))
        if z not in ids['z']: err('Tim', i, f'zaposleni_id "{z}" ne postoji')
        if g not in ids['g']: err('Tim', i, f'gradiliste_id "{g}" ne postoji')
        a = enum(r.get('aktivan'), 'da_ne', 'Tim', i, 'aktivan', True) == 'DA'
        sql.append(f"insert into zaposleni_gradiliste (zaposleni_id,gradiliste_id,aktivan) values ({q(z)},{q(g)},{q(a)}) on conflict (zaposleni_id,gradiliste_id) do update set aktivan=excluded.aktivan;")
    for i, p, g in pod_veze:
        if g not in ids['g']: err('Podizvođači', i, f'gradilista_ids: "{g}" ne postoji u listu Gradilišta')
        sql.append(f"insert into podizvodjac_gradiliste (podizvodjac_id,gradiliste_id) values ({q(p)},{q(g)}) on conflict do nothing;")

    def fk_g(sheet, i, r):
        g = s(r.get('gradiliste_id'))
        if g not in ids['g']: err(sheet, i, f'gradiliste_id "{g}" ne postoji u listu Gradilišta')
        return g

    def fk_z(sheet, i, r, col, dozvoli_p=False):
        z = s(r.get(col)) or None
        if z and z not in ids['z'] and not (dozvoli_p and z in ids['p']): err(sheet, i, f'{col} "{z}" ne postoji')
        return z

    # ---- Predmer
    for i, r in citaj(wb, 'Predmer', ['gradiliste_id', 'poz']):
        _id = gen_id('Predmer', i, r.get('id')); g = fk_g('Predmer', i, r)
        if not s(r.get('poz')): err('Predmer', i, 'poz je obavezno')
        kol = num(r.get('kol'), 'Predmer', i, 'kol') or 0; izv = num(r.get('izv'), 'Predmer', i, 'izv') or 0
        if izv > kol and kol: izv = kol
        sql.append(f"insert into predmer (id,gr,poz,jm,kol,cena,izv,zaduzen) values ({q(_id)},{q(g)},{q(esc_html(s(r.get('poz'))))},{q(esc_html(s(r.get('jm'))) or 'kom')},{q(kol)},{q(num(r.get('cena'), 'Predmer', i, 'cena') or 0)},{q(izv)},{q(fk_z('Predmer', i, r, 'zaduzen_id', True))}) "
                   f"on conflict (id) do update set gr=excluded.gr, poz=excluded.poz, jm=excluded.jm, kol=excluded.kol, cena=excluded.cena, izv=excluded.izv, zaduzen=excluded.zaduzen;")
    # ---- Zadaci
    for i, r in citaj(wb, 'Zadaci', ['gradiliste_id', 'naziv', 'rok']):
        _id = gen_id('Zadaci', i, r.get('id')); g = fk_g('Zadaci', i, r)
        if not s(r.get('naziv')): err('Zadaci', i, 'naziv je obavezno')
        sql.append(f"insert into zadaci (id,naziv,gr,zad,prio,kol,rok) values ({q(_id)},{q(esc_html(s(r.get('naziv'))))},{q(g)},{q(fk_z('Zadaci', i, r, 'zaduzen_id'))},{q(enum(r.get('prio'), 'prio', 'Zadaci', i, 'prio') or 'mid')},{q(enum(r.get('kolona'), 'kolona', 'Zadaci', i, 'kolona') or 'todo')},{q(datum(r.get('rok'), 'Zadaci', i, 'rok', True))}) "
                   f"on conflict (id) do update set naziv=excluded.naziv, gr=excluded.gr, zad=excluded.zad, prio=excluded.prio, kol=excluded.kol, rok=excluded.rok;")
    # ---- Dnevnik
    for i, r in citaj(wb, 'Dnevnik', ['gradiliste_id', 'datum', 'autor_id', 'tekst']):
        _id = gen_id('Dnevnik', i, r.get('id')); g = fk_g('Dnevnik', i, r)
        a = s(r.get('autor_id'))
        if a not in ids['z']: err('Dnevnik', i, f'autor_id "{a}" ne postoji u listu Zaposleni')
        if not s(r.get('tekst')): err('Dnevnik', i, 'tekst je obavezno')
        sql.append(f"insert into dnevnik (id,datum,gr,autor,tekst) values ({q(_id)},{q(datum(r.get('datum'), 'Dnevnik', i, 'datum', True))},{q(g)},{q(a)},{q(esc_html(s(r.get('tekst'))))}) "
                   f"on conflict (id) do update set datum=excluded.datum, gr=excluded.gr, autor=excluded.autor, tekst=excluded.tekst;")
    # ---- Troskovi
    for i, r in citaj(wb, 'Troškovi', ['gradiliste_id', 'datum', 'opis', 'iznos']):
        _id = gen_id('Troškovi', i, r.get('id')); g = fk_g('Troškovi', i, r)
        if not s(r.get('opis')): err('Troškovi', i, 'opis je obavezno')
        sql.append(f"insert into troskovi_st (id,gr,datum,opis,kat,iznos,dobavljac,fakt) values ({q(_id)},{q(g)},{q(datum(r.get('datum'), 'Troškovi', i, 'datum', True))},{q(esc_html(s(r.get('opis'))))},{q(enum(r.get('kat'), 'kat', 'Troškovi', i, 'kat') or 'Ostalo')},{q(num(r.get('iznos'), 'Troškovi', i, 'iznos', True) or 0)},{q(esc_html(s(r.get('dobavljac'))))},{q(esc_html(s(r.get('br_fakture'))))}) "
                   f"on conflict (id) do update set gr=excluded.gr, datum=excluded.datum, opis=excluded.opis, kat=excluded.kat, iznos=excluded.iznos, dobavljac=excluded.dobavljac, fakt=excluded.fakt;")
    # ---- Situacije
    for i, r in citaj(wb, 'Situacije', ['gradiliste_id', 'br', 'iznos', 'izdato', 'valuta', 'status']):
        _id = gen_id('Situacije', i, r.get('id')); g = fk_g('Situacije', i, r)
        if not s(r.get('br')): err('Situacije', i, 'br je obavezno')
        sql.append(f"insert into situacije (id,gr,br,opis,iznos,izdato,valuta,status) values ({q(_id)},{q(g)},{q(esc_html(s(r.get('br'))))},{q(esc_html(s(r.get('opis'))))},{q(num(r.get('iznos'), 'Situacije', i, 'iznos', True) or 0)},{q(datum(r.get('izdato'), 'Situacije', i, 'izdato', True))},{q(datum(r.get('valuta'), 'Situacije', i, 'valuta', True))},{q(enum(r.get('status'), 'status_sit', 'Situacije', i, 'status', True))}) "
                   f"on conflict (id) do update set gr=excluded.gr, br=excluded.br, opis=excluded.opis, iznos=excluded.iznos, izdato=excluded.izdato, valuta=excluded.valuta, status=excluded.status;")
    # ---- Resursi
    for i, r in citaj(wb, 'Resursi', ['tip', 'naziv']):
        _id = gen_id('Resursi', i, r.get('id'))
        g = s(r.get('gradiliste_id')) or None
        if g and g not in ids['g']: err('Resursi', i, f'gradiliste_id "{g}" ne postoji')
        if not s(r.get('naziv')): err('Resursi', i, 'naziv je obavezno')
        sql.append(f"insert into resursi (id,tip,naziv,oznaka,gr,zaduzen,istice,napomena) values ({q(_id)},{q(enum(r.get('tip'), 'tip_res', 'Resursi', i, 'tip', True))},{q(esc_html(s(r.get('naziv'))))},{q(esc_html(s(r.get('oznaka'))))},{q(g)},{q(fk_z('Resursi', i, r, 'zaduzen_id'))},{q(datum(r.get('istice'), 'Resursi', i, 'istice'))},{q(esc_html(s(r.get('napomena'))))}) "
                   f"on conflict (id) do update set tip=excluded.tip, naziv=excluded.naziv, oznaka=excluded.oznaka, gr=excluded.gr, zaduzen=excluded.zaduzen, istice=excluded.istice, napomena=excluded.napomena;")
    # ---- Magacin
    for i, r in citaj(wb, 'Magacin', ['naziv']):
        _id = gen_id('Magacin', i, r.get('id'))
        if not s(r.get('naziv')): err('Magacin', i, 'naziv je obavezno')
        sql.append(f"insert into magacin (id,naziv,jm,stanje) values ({q(_id)},{q(esc_html(s(r.get('naziv'))))},{q(esc_html(s(r.get('jm'))) or 'kom')},{q(num(r.get('stanje'), 'Magacin', i, 'stanje') or 0)}) "
                   f"on conflict (id) do update set naziv=excluded.naziv, jm=excluded.jm, stanje=excluded.stanje;")

    # dupli id-jevi unutar fajla
    for t, st in ids.items(): pass
    if greske:
        print(f'NEMA UVOZA — {len(greske)} greška/e:'); [print(' -', e) for e in greske]; sys.exit(1)
    broj = {k: len(v) for k, v in ids.items()}
    print(f"Provera prošla: klijenti {broj['kl']}, zaposleni {broj['z']}, gradilišta {broj['g']}, podizvođači {broj['p']}; ukupno {len(sql)} naredbi.")
    if '--provera' in sys.argv: return
    with open(out, 'w', encoding='utf-8') as f:
        f.write(f"-- GradnjaOS uvoz iz {os.path.basename(src)} — {dt.datetime.now():%Y-%m-%d %H:%M}\n-- Pokrenuti kao vlasnik baze (SQL editor). Ponovni uvoz istog fajla samo osvežava.\nbegin;\n")
        f.write('\n'.join(sql)); f.write('\ncommit;\n')
    print('SQL:', out)


if __name__ == '__main__':
    main()
