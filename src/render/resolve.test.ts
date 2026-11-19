import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveText, serialValue, formatDate, dateValue, batchJobs, batchCount, docUsesSerial, usesData, ctxFor, type ResolveCtx } from './resolve';
import { newDoc, makeText, makeBarcode } from '../elements';
import type { LabelDoc, DataSet } from '../types';

const ctx = (doc: LabelDoc, extra: Partial<ResolveCtx> = {}): ResolveCtx => ({ doc, index: 0, resolve: true, ...extra });

function data(rows: Record<string, string>[], checked: boolean[] = [], copies: number[] = []): DataSet {
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows, checked: rows.map((_, i) => !!checked[i]), copies: rows.map((_, i) => copies[i] ?? 1) };
}

describe('resolveText — champs {{colonne}}', () => {
  const doc = newDoc();
  const row = { Nom: 'Dupont', 'Code postal': '75001', prix: '9,90' };

  it('remplace les colonnes de la ligne', () => {
    expect(resolveText('{{Nom}} — {{prix}} €', ctx(doc, { row }))).toBe('Dupont — 9,90 €');
  });
  it('espaces autour du nom tolérés, nom avec espace', () => {
    expect(resolveText('{{ Code postal }}', ctx(doc, { row }))).toBe('75001');
  });
  it('insensible à la casse si pas de correspondance exacte', () => {
    expect(resolveText('{{nom}} {{PRIX}}', ctx(doc, { row }))).toBe('Dupont 9,90');
  });
  it('colonne inconnue → vide quand une ligne existe', () => {
    expect(resolveText('[{{inconnu}}]', ctx(doc, { row }))).toBe('[]');
  });
  it('sans ligne de données → le champ reste tel quel', () => {
    expect(resolveText('a {{Nom}} b', ctx(doc))).toBe('a {{Nom}} b');
  });
  it('resolve: false → texte brut', () => {
    expect(resolveText('{{Nom}} {{#}}', ctx(doc, { row, resolve: false }))).toBe('{{Nom}} {{#}}');
  });
  it('texte sans champ inchangé', () => {
    expect(resolveText('rien { } {x}', ctx(doc, { row }))).toBe('rien { } {x}');
  });
});

describe('numérotation', () => {
  it('début / pas / zéros / préfixe / suffixe', () => {
    const doc = newDoc({ numbering: { start: 7, step: 3, padding: 5, prefix: 'LOT-', suffix: '/A', count: 10 } });
    expect(serialValue(doc, 0)).toBe('LOT-00007/A');
    expect(serialValue(doc, 2)).toBe('LOT-00013/A');
  });
  it('alias {{numero}} {{numéro}} {{#}} {{serial}}', () => {
    const doc = newDoc({ numbering: { start: 1, step: 1, padding: 3, prefix: '', suffix: '', count: 10 } });
    expect(resolveText('{{numero}} {{Numéro}} {{#}} {{ serial }}', ctx(doc, { index: 4 }))).toBe('005 005 005 005');
  });
  it('la numérotation prime sur une colonne homonyme', () => {
    const doc = newDoc();
    expect(resolveText('{{#}}', ctx(doc, { row: { '#': 'colonne' } }))).toBe('0001');
  });
  it('pas négatif et valeurs négatives', () => {
    const doc = newDoc({ numbering: { start: 2, step: -1, padding: 3, prefix: 'N', suffix: '', count: 10 } });
    expect([0, 1, 2, 3].map((i) => serialValue(doc, i))).toEqual(['N002', 'N001', 'N000', 'N-001']);
  });
  it('pas 0 → 1 par défaut, padding 0', () => {
    const doc = newDoc({ numbering: { start: 10, step: 0, padding: 0, prefix: '', suffix: '', count: 10 } });
    expect(serialValue(doc, 2)).toBe('12');
  });
});

describe('dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 30, 8, 5, 9)); // 30 janv. 2026 08:05:09 (heure locale)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formatDate : jetons', () => {
    const d = new Date(2026, 2, 4, 13, 7, 2);
    expect(formatDate(d, 'DD/MM/YYYY HH:mm:ss')).toBe('04/03/2026 13:07:02');
    expect(formatDate(d, 'YY-MM-DD')).toBe('26-03-04');
    expect(formatDate(d, 'DD MMM YYYY')).toBe('04 mars 2026');
    expect(formatDate(d, 'DD MMMM')).toBe('04 mars');
    expect(formatDate(new Date(2026, 7, 1), 'MMMM MMM')).toBe('août août');
  });

  it('{{date}} : aujourd’hui avec le décalage du document', () => {
    const doc = newDoc({ date: { format: 'DD/MM/YYYY', offsetDays: 0 } });
    expect(resolveText('{{date}}', ctx(doc))).toBe('30/01/2026');
    const doc2 = newDoc({ date: { format: 'YYYY-MM-DD', offsetDays: 3 } });
    expect(resolveText('{{date}}', ctx(doc2))).toBe('2026-02-02');
  });

  it('{{date+N}} / {{date-N}} : décalage explicite (ignore celui du document)', () => {
    const doc = newDoc({ date: { format: 'DD/MM/YYYY', offsetDays: 100 } });
    expect(resolveText('{{date+2}}', ctx(doc))).toBe('01/02/2026');
    expect(resolveText('{{ date - 31 }}', ctx(doc))).toBe('30/12/2025');
    expect(resolveText('{{DATE+0}}', ctx(doc))).toBe('30/01/2026');
    expect(dateValue(doc)).toBe('10/05/2026');
  });

  it('format vide → DD/MM/YYYY', () => {
    expect(dateValue(newDoc({ date: { format: '', offsetDays: 0 } }))).toBe('30/01/2026');
  });
});

describe('batchJobs', () => {
  it('lignes cochées avec copies', () => {
    const doc = newDoc({ data: data([{ a: '1' }, { a: '2' }, { a: '3' }, { a: '4' }], [false, true, false, true], [1, 3, 1, 0]) });
    expect(batchJobs(doc)).toEqual([
      { index: 1, copies: 3 },
      { index: 3, copies: 1 }, // 0 copie → 1
    ]);
  });

  it('aucune ligne cochée → la ligne affichée (bornée)', () => {
    const doc = newDoc({ data: data([{ a: '1' }, { a: '2' }], [], [4, 2]) });
    expect(batchJobs(doc, 1)).toEqual([{ index: 1, copies: 2 }]);
    expect(batchJobs(doc, 9)).toEqual([{ index: 1, copies: 2 }]);
  });

  it('pas de données + numérotation utilisée → série de « count » étiquettes', () => {
    const doc = newDoc({ copies: 2, numbering: { start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 4 } });
    doc.elements = [makeText(doc, 'N° {{#}}')];
    expect(docUsesSerial(doc)).toBe(true);
    expect(batchJobs(doc)).toEqual([0, 1, 2, 3].map((index) => ({ index, copies: 2 })));
  });

  it('série plafonnée à 500, au moins 1', () => {
    const doc = newDoc({ numbering: { start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 9999 } });
    doc.elements = [makeBarcode(doc, 'code128', '{{serial}}')];
    expect(batchCount(doc)).toBe(500);
    doc.numbering.count = 0;
    expect(batchCount(doc)).toBe(1);
  });

  it('ni données ni numérotation → une étiquette, copies du document', () => {
    const doc = newDoc({ copies: 5 });
    doc.elements = [makeText(doc, 'fixe')];
    expect(batchJobs(doc)).toEqual([{ index: 0, copies: 5 }]);
  });

  it('données présentes : la numérotation n’ajoute pas d’étiquettes', () => {
    const doc = newDoc({ data: data([{ a: '1' }, { a: '2' }], [true, true]) });
    doc.elements = [makeText(doc, '{{#}}')];
    expect(batchCount(doc)).toBe(2);
  });

  it('ctxFor : ligne de données de l’index', () => {
    const doc = newDoc({ data: data([{ a: 'x' }, { a: 'y' }]) });
    expect(resolveText('{{a}}', ctxFor(doc, 1))).toBe('y');
  });

  it('usesData', () => {
    const doc = newDoc();
    expect(usesData(makeText(doc, '{{a}}'))).toBe(true);
    expect(usesData(makeText(doc, 'a'))).toBe(false);
  });
});
