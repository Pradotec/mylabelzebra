import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook, parseDelimited, parseDelimitedBytes, decodeText, numberToText, parseFile, reloadSheet, canSwitchSheet, MAX_ROWS } from './data';
import { sortRows, filterRows, isValidGtinText, findRow, splitValue, splitCount, splitColumn, generateRanges, rangeCount, segmentValues, appendRows, type RowOp, type RangeSegment } from './data';
import type { DataSet } from './types';
import { parseDate, parseNumber } from './render/resolve';

type CellSpec = XLSX.CellObject;

/** Classeur XLSX en mémoire : { feuille: lignes de cellules } */
function book(sheets: Record<string, (CellSpec | string | number | null)[][]>, opts: { date1904?: boolean } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws: XLSX.WorkSheet = {};
    let maxC = 0;
    rows.forEach((r, ri) => {
      r.forEach((c, ci) => {
        if (c == null) return;
        const cell: CellSpec = typeof c === 'string' ? { t: 's', v: c } : typeof c === 'number' ? { t: 'n', v: c } : c;
        ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = cell;
        maxC = Math.max(maxC, ci);
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: maxC } });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  if (opts.date1904) wb.Workbook = { ...(wb.Workbook || {}), WBProps: { date1904: true } };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const date = (serial: number, z = 'dd/mm/yyyy'): CellSpec => ({ t: 'n', v: serial, z });

describe('Excel : dates', () => {
  it('05/03/2026 reste le 5 mars (plus de lecture US « 3/5/26 »)', async () => {
    // 46086 = 05/03/2026
    const ds = await parseWorkbook(book({ F: [['Fab'], [date(46086)], [date(46086, 'm/d/yy')], [date(46086, 'yyyy-mm-dd')]] }), 'a.xlsx');
    expect(ds.rows.map((r) => r.Fab)).toEqual(['05/03/2026', '05/03/2026', '05/03/2026']);
    const d = parseDate(ds.rows[0].Fab)!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 3, 5]);
  });

  it('heure non nulle conservée (HH:MM), secondes si présentes', async () => {
    const ds = await parseWorkbook(
      book({ F: [['T'], [date(46086 + 0.5, 'dd/mm/yyyy hh:mm')], [date(46086 + (13 * 3600 + 7 * 60 + 9) / 86400, 'dd/mm/yyyy hh:mm:ss')], [date(46086 + 0.5, 'dd/mm/yyyy')]] }),
      'a.xlsx',
    );
    expect(ds.rows.map((r) => r.T)).toEqual(['05/03/2026 12:00', '05/03/2026 13:07:09', '05/03/2026 12:00']);
    expect(parseDate(ds.rows[1].T)!.getHours()).toBe(13);
  });

  it('heure seule (format hh:mm, valeur < 1 jour)', async () => {
    const ds = await parseWorkbook(book({ F: [['H'], [date(0.75, 'hh:mm')]] }), 'a.xlsx');
    expect(ds.rows[0].H).toBe('18:00');
  });

  it('dates en fin d’année et 29 février', async () => {
    // 46022 = 31/12/2025 ; 46081 = 28/02/2026 ; 45351 = 29/02/2024
    const ds = await parseWorkbook(book({ F: [['D'], [date(46022)], [date(46081)], [date(45351)]] }), 'a.xlsx');
    expect(ds.rows.map((r) => r.D)).toEqual(['31/12/2025', '28/02/2026', '29/02/2024']);
  });

  it('cellule Date créée par SheetJS (aoa_to_sheet) relue sans décalage', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['D'], [new Date(2026, 2, 5)]], { dateNF: 'dd/mm/yyyy' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    const ds = await parseWorkbook(buf, 'a.xlsx');
    expect(ds.rows[0].D).toBe('05/03/2026');
  });
});

describe('Excel : nombres', () => {
  it('EAN-13 en format Standard → 13 chiffres complets (pas « 3.01235E+12 »)', async () => {
    const ds = await parseWorkbook(book({ F: [['EAN'], [{ t: 'n', v: 3012345678901, z: 'General' }], [3012345678901]] }), 'a.xlsx');
    expect(ds.rows.map((r) => r.EAN)).toEqual(['3012345678901', '3012345678901']);
    expect(ds.warnings).toBeUndefined();
  });

  it('décimaux : virgule française, relus par parseNumber, sans artefact flottant', async () => {
    const ds = await parseWorkbook(book({ F: [['P'], [12.5], [0.1 + 0.2], [-3.25], [1e-7], [{ t: 'n', v: 12.5, z: '0.00' }], [{ t: 'n', v: 12, z: '#,##0.00 "€"' }]] }), 'a.xlsx');
    const v = ds.rows.map((r) => r.P);
    expect(v).toEqual(['12,5', '0,3', '-3,25', '0,0000001', '12,50', '12,00']);
    expect(v.map(parseNumber)).toEqual([12.5, 0.3, -3.25, 1e-7, 12.5, 12]);
  });

  it('pourcentages et zéros de tête du format', async () => {
    const ds = await parseWorkbook(book({ F: [['A', 'CP'], [{ t: 'n', v: 0.155, z: '0.0%' }, { t: 'n', v: 1000, z: '00000' }]] }), 'a.xlsx');
    expect(ds.rows[0]).toEqual({ A: '15,5%', CP: '01000' });
  });

  it('plus de 15 chiffres : avertissement de précision', async () => {
    const ds = await parseWorkbook(book({ F: [['Code', 'X'], [1234567890123456789, 1], [9999999999999999, 2], [123, 3]] }), 'a.xlsx');
    expect(ds.rows[0].Code).toMatch(/^\d{19}$/);
    expect(ds.rows[0].Code).not.toMatch(/e/i);
    expect(ds.warnings).toEqual([{ kind: 'precision', column: 'Code', count: 2, example: ds.rows[0].Code }]);
  });

  it('texte, booléens, cellules vides', async () => {
    const ds = await parseWorkbook(book({ F: [['T', 'B', 'V'], ['  0123 ', { t: 'b', v: true }, null], ['Crème brûlée', { t: 'b', v: false }, 'x']] }), 'a.xlsx');
    expect(ds.rows).toEqual([
      { T: '0123', B: 'VRAI', V: '' },
      { T: 'Crème brûlée', B: 'FAUX', V: 'x' },
    ]);
  });
});

describe('Excel : feuilles', () => {
  const wb = () => book({ Produits: [['Nom'], ['A']], Clients: [['Client'], ['Z'], ['Y']] });

  it('première feuille par défaut, liste des feuilles mémorisée', async () => {
    const ds = await parseWorkbook(wb(), 'c.xlsx');
    expect(ds.sheet).toBe('Produits');
    expect(ds.sheets).toEqual(['Produits', 'Clients']);
    expect(ds.columns).toEqual(['Nom']);
  });

  it('feuille choisie ; nom inconnu → première', async () => {
    const ds = await parseWorkbook(wb(), 'c.xlsx', { sheet: 'Clients' });
    expect(ds.sheet).toBe('Clients');
    expect(ds.rows.map((r) => r.Client)).toEqual(['Z', 'Y']);
    expect((await parseWorkbook(wb(), 'c.xlsx', { sheet: 'Nope' })).sheet).toBe('Produits');
  });

  it('une seule feuille : pas de liste', async () => {
    const ds = await parseWorkbook(book({ Seule: [['a'], ['1']] }), 'c.xlsx');
    expect(ds.sheet).toBe('Seule');
    expect(ds.sheets).toBeUndefined();
  });

  it('parseFile garde le classeur en mémoire pour changer de feuille', async () => {
    const f = new File([wb()], 'multi.xlsx');
    const ds = await parseFile(f);
    expect(ds.sheet).toBe('Produits');
    expect(canSwitchSheet('multi.xlsx')).toBe(true);
    expect(canSwitchSheet('autre.xlsx')).toBe(false);
    const ds2 = await reloadSheet('multi.xlsx', 'Clients');
    expect(ds2.sheet).toBe('Clients');
    await expect(reloadSheet('autre.xlsx', 'Clients')).rejects.toThrow();
  });

  it('feuille vide → erreur claire', async () => {
    await expect(parseWorkbook(book({ Vide: [] }), 'v.xlsx')).rejects.toThrow('Aucune donnée');
  });

  it('classeur au calendrier 1904', async () => {
    // 1904 : 0 = 01/01/1904 ; 44624 = 05/03/2026
    const ds = await parseWorkbook(book({ F: [['D'], [date(46086 - 1462)]] }, { date1904: true }), 'm.xlsx');
    expect(ds.rows[0].D).toBe('05/03/2026');
  });
});

describe('numberToText', () => {
  it('cas limites', () => {
    expect(numberToText(0)).toBe('0');
    expect(numberToText(-0.5)).toBe('-0,5');
    expect(numberToText(1e21)).toBe('1000000000000000000000');
    expect(numberToText(123456789.123)).toBe('123456789,123');
    expect(numberToText(5, '0.000')).toBe('5,000');
    expect(numberToText(42, '"N°" 000000')).toBe('000042'); // texte du format ignoré, zéros conservés
    expect(numberToText(NaN)).toBe('NaN');
  });
});

describe('CSV : encodage', () => {
  const enc1252 = (s: string) => {
    const map: Record<string, number> = { '€': 0x80, '’': 0x92, œ: 0x9c };
    return new Uint8Array(Array.from(s, (ch) => map[ch] ?? ch.charCodeAt(0)));
  };

  it('UTF-8 (avec ou sans BOM)', () => {
    const txt = 'Nom;Prix\nCrème brûlée;3,50 €\n';
    const utf8 = new TextEncoder().encode(txt);
    expect(decodeText(utf8)).toEqual({ text: txt, encoding: 'utf-8' });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    const ds = parseDelimitedBytes(bom, 'a.csv');
    expect(ds.columns).toEqual(['Nom', 'Prix']);
    expect(ds.rows[0]).toEqual({ Nom: 'Crème brûlée', Prix: '3,50 €' });
    expect(ds.warnings).toBeUndefined();
  });

  it('windows-1252 (CSV Excel français) : repli automatique + avertissement', () => {
    const bytes = enc1252('Nom;Prix\nCrème brûlée l’œuf;3,50 €\n');
    const { text, encoding } = decodeText(bytes);
    expect(encoding).toBe('windows-1252');
    expect(text).toContain('Crème brûlée l’œuf;3,50 €');
    const ds = parseDelimitedBytes(bytes, 'b.csv');
    expect(ds.rows[0].Nom).toBe('Crème brûlée l’œuf');
    expect(ds.warnings).toEqual([{ kind: 'encoding', encoding: 'windows-1252' }]);
  });

  it('parseFile lit les octets (pas file.text())', async () => {
    const f = new File([enc1252('a;b\né;€\n')], 'x.csv');
    const ds = await parseFile(f);
    expect(ds.rows[0]).toEqual({ a: 'é', b: '€' });
  });
});

describe('CSV : lignes', () => {
  it(`troncature à ${MAX_ROWS} lignes signalée`, () => {
    const txt = 'n\n' + Array.from({ length: MAX_ROWS + 7 }, (_, i) => String(i)).join('\n');
    const ds = parseDelimited(txt);
    expect(ds.rows.length).toBe(MAX_ROWS);
    expect(ds.warnings).toEqual([{ kind: 'truncated', kept: MAX_ROWS, total: MAX_ROWS + 7 }]);
  });

  it('pile 5000 lignes : pas d’avertissement', () => {
    const txt = 'n\n' + Array.from({ length: MAX_ROWS }, (_, i) => String(i)).join('\n');
    expect(parseDelimited(txt).warnings).toBeUndefined();
  });

  it('en-têtes vides et doublons, tabulations, guillemets', () => {
    const ds = parseDelimited('a\t\ta\n1\t2\t3\n"x"\t"y\tz"\t\n');
    expect(ds.columns).toEqual(['a', 'Colonne 2', 'a_2']);
    expect(ds.rows[1]).toEqual({ a: 'x', 'Colonne 2': 'y\tz', a_2: '' });
  });

  it('texte vide → erreur', () => {
    expect(() => parseDelimited('\n \n')).toThrow('Aucune donnée');
  });
});

/** Jeu de données de test (colonnes = clés de la première ligne) */
function ds(rows: Record<string, string>[], checked: boolean[] = []): DataSet {
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows, checked: rows.map((_, i) => !!checked[i]), copies: rows.map((_, i) => i + 1), source: 't' };
}

describe('sortRows (ordre naturel)', () => {
  const d = ds(
    [{ E: 'ZB1-01-10' }, { E: '' }, { E: 'ZB1-01-02' }, { E: 'ma2-01-01' }, { E: 'ZB1-01-02' }, { E: '/' }],
    [true, false, false, true],
  );
  it('croissant : ZB1-01-02 avant ZB1-01-10, casse ignorée, vides à la fin, stable', () => {
    const s = sortRows(d, 'E');
    expect(s.rows.map((r) => r.E)).toEqual(['/', 'ma2-01-01', 'ZB1-01-02', 'ZB1-01-02', 'ZB1-01-10', '']);
    // cases cochées et copies suivent leur ligne ; égalité → ordre d'origine
    expect(s.checked).toEqual([false, true, false, false, true, false]);
    expect(s.copies).toEqual([6, 4, 3, 5, 1, 2]);
    expect(d.rows[0].E).toBe('ZB1-01-10'); // l'original n'est pas modifié
  });
  it('décroissant : vides toujours à la fin', () => {
    expect(sortRows(d, 'E', 'desc').rows.map((r) => r.E)).toEqual(['ZB1-01-10', 'ZB1-01-02', 'ZB1-01-02', 'ma2-01-01', '/', '']);
  });
  it('nombres en ordre numérique', () => {
    expect(sortRows(ds([{ n: '10' }, { n: '9' }, { n: '100' }]), 'n').rows.map((r) => r.n)).toEqual(['9', '10', '100']);
  });
});

describe('filterRows', () => {
  const d = ds([
    { Ref: 'A', Ean: '2000000000015' },
    { Ref: 'B', Ean: '2000000000016' },
    { Ref: 'a', Ean: '' },
    { Ref: 'C', Ean: '/' },
    { Ref: 'D', Ean: '96385074' },
  ]);
  const f = (column: string, op: RowOp, value = '', query = '') => filterRows(d, { query, column, op, value });
  it('≠, = et contient (sans casse ni accents)', () => {
    expect(f('Ref', 'ne', 'a')).toEqual([1, 3, 4]);
    expect(f('Ref', 'eq', 'A')).toEqual([0, 2]);
    expect(f('Ean', 'contains', '20000')).toEqual([0, 1]);
    expect(f('', 'contains', '', 'b')).toEqual([1]);
  });
  it('doublon : valeur non vide présente plusieurs fois', () => {
    expect(f('Ref', 'dup')).toEqual([0, 2]);
    expect(f('Ean', 'dup')).toEqual([]);
  });
  it('EAN/GTIN invalide : longueur 8/12/13/14 + clé, vides exclus', () => {
    expect(f('Ean', 'badGtin')).toEqual([1, 3]);
    expect(isValidGtinText('2000000000015')).toBe(true);
    expect(isValidGtinText('96385074')).toBe(true);
    expect(isValidGtinText('036000291452')).toBe(true);
    expect(isValidGtinText('10614141000040')).toBe(true);
    expect(isValidGtinText('1234567')).toBe(false);
  });
});

describe('findRow (Aller à…)', () => {
  const d = ds([{ E: 'ZB1-01-01-A1' }, { E: 'ZB1-01-01-A2' }, { E: 'ZB1-02-01-A1' }]);
  it('numéro de ligne', () => {
    expect(findRow(d, '2')).toEqual({ row: 1, rank: 1, count: 1 });
  });
  it('valeur : occurrence suivante, en boucle', () => {
    expect(findRow(d, 'a1')).toEqual({ row: 0, rank: 1, count: 2 });
    expect(findRow(d, 'a1', 0)).toEqual({ row: 2, rank: 2, count: 2 });
    expect(findRow(d, 'a1', 2)).toEqual({ row: 0, rank: 1, count: 2 });
    expect(findRow(d, 'zz')).toBeNull();
    expect(findRow(d, '  ')).toBeNull();
  });
  it('nombre hors bornes : cherché comme valeur', () => {
    expect(findRow(ds([{ E: 'A' }, { E: 'X-99' }]), '99')).toEqual({ row: 1, rank: 1, count: 1 });
    expect(findRow(d, '99')).toBeNull();
  });
});

describe('splitColumn (éclater une colonne)', () => {
  it('mode cases : préfixe conservé, motifs lettre + chiffres', () => {
    expect(splitValue('ZB1-04-03-B1B5C1C3', { kind: 'cases' })).toEqual(['ZB1-04-03-B1', 'ZB1-04-03-B5', 'ZB1-04-03-C1', 'ZB1-04-03-C3']);
    expect(splitValue('ZB1-01-01-A1', { kind: 'cases' })).toEqual(['ZB1-01-01-A1']);
    expect(splitValue('/', { kind: 'cases' })).toEqual(['/']);
    expect(splitValue('ZB1-04-03-B1x', { kind: 'cases' })).toEqual(['ZB1-04-03-B1x']);
  });
  it('mode séparateur : morceaux sans espaces, vides ignorés', () => {
    expect(splitValue('ART1000001 (CMR) / ART1000002', { kind: 'sep', sep: '/' })).toEqual(['ART1000001 (CMR)', 'ART1000002']);
    expect(splitValue('a;;b', { kind: 'sep', sep: ';' })).toEqual(['a', 'b']);
    expect(splitValue('/', { kind: 'sep', sep: '/' })).toEqual(['/']);
  });
  it('une ligne par valeur, autres colonnes, cases et copies recopiées', () => {
    const d = ds([{ P: 'x', E: 'ZB1-04-03-B1B5' }, { P: 'y', E: 'ZB1-01-01-A1' }], [true, false]);
    expect(splitCount(d, 'E', { kind: 'cases' })).toBe(3);
    const r = splitColumn(d, 'E', { kind: 'cases' });
    expect(r.truncated).toBe(0);
    expect(r.data.rows).toEqual([
      { P: 'x', E: 'ZB1-04-03-B1' },
      { P: 'x', E: 'ZB1-04-03-B5' },
      { P: 'y', E: 'ZB1-01-01-A1' },
    ]);
    expect(r.data.checked).toEqual([true, true, false]);
    expect(r.data.copies).toEqual([1, 1, 2]);
    expect(r.data.columns).toEqual(['P', 'E']);
  });
  it('plafond de lignes', () => {
    const d = ds([{ E: 'a/b/c' }, { E: 'd/e' }]);
    const r = splitColumn(d, 'E', { kind: 'sep', sep: '/' }, 4);
    expect(r.data.rows.map((x) => x.E)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.truncated).toBe(1);
  });
});

describe('generateRanges (générateur d’emplacements)', () => {
  const segs: RangeSegment[] = [
    { name: 'Zone', kind: 'text', value: 'ZB1' },
    { name: 'Allée', kind: 'num', from: 1, to: 2, pad: 2 },
    { name: 'Travée', kind: 'num', from: 9, to: 10, pad: 2 },
    { name: 'Niveau', kind: 'alpha', from: 'A', to: 'B' },
    { name: 'Position', kind: 'num', from: 1, to: 1, pad: 0 },
  ];
  it('produit cartésien, une colonne par segment + Emplacement formaté', () => {
    const r = generateRanges(segs, '{Zone}-{Allée}-{Travée}-{Niveau}{Position}');
    expect(r.total).toBe(8);
    expect(rangeCount(segs)).toBe(8);
    expect(r.columns).toEqual(['Zone', 'Allée', 'Travée', 'Niveau', 'Position', 'Emplacement']);
    expect(r.rows.map((x) => x.Emplacement)).toEqual([
      'ZB1-01-09-A1',
      'ZB1-01-09-B1',
      'ZB1-01-10-A1',
      'ZB1-01-10-B1',
      'ZB1-02-09-A1',
      'ZB1-02-09-B1',
      'ZB1-02-10-A1',
      'ZB1-02-10-B1',
    ]);
    expect(r.rows[0]).toMatchObject({ Zone: 'ZB1', Allée: '01', Travée: '09', Niveau: 'A', Position: '1' });
  });
  it('plages décroissantes, lettres, modèle vide, champ inconnu', () => {
    expect(segmentValues({ name: 'n', kind: 'num', from: 3, to: 1, pad: 0 })).toEqual(['3', '2', '1']);
    expect(segmentValues({ name: 'l', kind: 'alpha', from: 'c', to: 'a' })).toEqual(['C', 'B', 'A']);
    expect(segmentValues({ name: 'l', kind: 'alpha', from: '1', to: 'B' })).toEqual([]);
    const r = generateRanges(segs.slice(0, 2), '');
    expect(r.rows.map((x) => x.Emplacement)).toEqual(['ZB101', 'ZB102']);
    expect(generateRanges(segs.slice(0, 1), '{Zone}/{X}').rows[0].Emplacement).toBe('ZB1/{X}');
  });
  it('plafond et noms en double', () => {
    const big: RangeSegment[] = [
      { name: 'A', kind: 'num', from: 1, to: 100, pad: 0 },
      { name: 'A', kind: 'num', from: 1, to: 100, pad: 0 },
    ];
    const r = generateRanges(big, '', 'A', 50);
    expect(r.total).toBe(10000);
    expect(r.rows.length).toBe(50);
    expect(r.columns).toEqual(['A', 'A_2', 'A_3']);
  });
  it('appendRows : ajoute ou crée, colonnes réunies, plafond', () => {
    const d = ds([{ P: 'x' }], [true]);
    const r = appendRows(d, ['E'], [{ E: '1' }, { E: '2' }], 'g', 2);
    expect(r.data.columns).toEqual(['P', 'E']);
    expect(r.data.rows).toEqual([
      { P: 'x', E: '' },
      { P: '', E: '1' },
    ]);
    expect(r.data.checked).toEqual([true, false]);
    expect(r.truncated).toBe(1);
    const n = appendRows(undefined, ['E'], [{ E: '1' }], 'Générateur');
    expect(n.data.source).toBe('Générateur');
    expect(n.data.rows).toEqual([{ E: '1' }]);
  });
});
