import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveText, serialValue, formatDate, dateValue, batchJobs, batchCount, docUsesSerial, usesData, ctxFor, type ResolveCtx } from './resolve';
import { parseDate, parseNumber, conditionHolds, promptFields, promptSpecs, unknownFilters, calcExpr, numText, roundTo, jobPosition, serialNextStart, parseSerialAlpha, FILTERS, checkDigits, partOf, fieldKeys, isSpecialKey, conditionKey } from './resolve';
import { validatePrompt, validatePrompts, isValidGtin, gs1CheckDigit, type PromptSpec } from '../prompts';
import { newDoc, makeText, makeBarcode } from '../elements';
import type { LabelDoc, DataSet } from '../types';
import { docUsesSscc } from './resolve';
import { saveSsccSettings, loadSscc, composeSscc, getSsccConfig, nextSerial, _resetSsccForTests, type SsccDoc } from '../sscc';

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

// ====================== Analyse, filtres, conditions, saisie, compteur avancé ======================


const R = (text: string, row: Record<string, string> = {}, doc = newDoc()) => resolveText(text, ctx(doc, { row }));
/** espaces insécables → espace simple (comparaison) */
const sp = (s: string) => s.replace(/[  ]/g, ' ');
const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] : null);

describe('parseNumber', () => {
  it('formats français et anglais', () => {
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('1234.5')).toBe(1234.5);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('12,50 €')).toBe(12.5);
    expect(parseNumber('1.000.000')).toBe(1000000);
    expect(parseNumber('1,000,000')).toBe(1000000);
    expect(parseNumber('-3,5')).toBe(-3.5);
    expect(parseNumber('15%')).toBe(15);
    expect(parseNumber('3e2')).toBe(300);
  });
  it('invalide → NaN', () => {
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('12a')).toBeNaN();
    expect(parseNumber('  ')).toBeNaN();
  });
});

describe('parseDate', () => {
  it('ISO avec ou sans heure', () => {
    expect(ymd(parseDate('2026-03-05'))).toEqual([2026, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('2026-03-05T14:30:15'))).toEqual([2026, 3, 5, 14, 30, 15]);
  });
  it('jj/mm/aaaa, séparateurs . -, année sur 2 chiffres, heure', () => {
    expect(ymd(parseDate('05/03/2026'))).toEqual([2026, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('5.3.26'))).toEqual([2026, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('05-03-69'))).toEqual([2069, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('05-03-70'))).toEqual([1970, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('05/03/2026 12:00'))).toEqual([2026, 3, 5, 12, 0, 0]);
    expect(ymd(parseDate('05/03/2026 8h15'))).toEqual([2026, 3, 5, 8, 15, 0]);
  });
  it('AAAAMMJJ, série Excel, Date', () => {
    expect(ymd(parseDate('20260305'))).toEqual([2026, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('46086'))).toEqual([2026, 3, 5, 0, 0, 0]);
    expect(ymd(parseDate('46086.5'))).toEqual([2026, 3, 5, 12, 0, 0]);
    const d = new Date(2026, 0, 1);
    const c = parseDate(d)!;
    expect(c).not.toBe(d);
    expect(c.getTime()).toBe(d.getTime());
  });
  it('dates invalides → null', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('00/01/2026')).toBeNull();
    expect(parseDate('05/13/2026')).toBeNull();
    expect(parseDate('bonjour')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(new Date(NaN))).toBeNull();
    expect(parseDate('0')).toBeNull();
  });
});

describe('formatDate : jetons minuscules', () => {
  const d = new Date(2026, 2, 4, 13, 7, 2);
  it('jj/mm/aaaa = jour/mois/année (et non des minutes)', () => {
    expect(formatDate(d, 'jj/mm/aaaa')).toBe('04/03/2026');
    expect(formatDate(d, 'jj/mm/aa')).toBe('04/03/26');
    expect(formatDate(d, 'dd/mm/yyyy')).toBe('04/03/2026');
    expect(formatDate(d, 'JJ/MM/AAAA')).toBe('04/03/2026');
  });
  it('mm = minutes après HH / hh ou avant ss', () => {
    expect(formatDate(d, 'jj/mm/aaaa HH:mm')).toBe('04/03/2026 13:07');
    expect(formatDate(d, 'hh:mm:ss')).toBe('13:07:02');
    expect(formatDate(d, 'hhhmm')).toBe('13h07');
    expect(formatDate(d, 'mm:ss')).toBe('07:02');
    expect(formatDate(d, 'DD/MM/YYYY HH:mm')).toBe('04/03/2026 13:07');
  });
  it('mois en lettres en minuscules', () => {
    expect(formatDate(d, 'jj mmmm aaaa')).toBe('04 mars 2026');
    expect(formatDate(new Date(2026, 1, 1), 'mmm aa')).toBe('févr. 26');
  });
  it('filtre date avec jetons minuscules', () => {
    expect(R('{{d|date:jj/mm/aaaa}}', { d: '2026-03-05 14:30' })).toBe('05/03/2026');
  });
});

describe('filtres existants', () => {
  const row = { nom: '  élodie martin ', vide: '', prix: '12,5', poids: '1.250', ref: 'AB-12-CD', d: '05/03/2026', code: '42', neg: '-7' };
  it('defaut / maj / min / cap / trim', () => {
    expect(R('{{vide|defaut:N/A}}|{{nom|trim|defaut:x}}', row)).toBe('N/A|élodie martin');
    expect(R('{{nom|trim|maj}}', row)).toBe('ÉLODIE MARTIN');
    expect(R('{{ref|min}}', row)).toBe('ab-12-cd');
    expect(R('{{nom|trim|cap}}', row)).toBe('Élodie martin');
    expect(R('{{vide|cap}}', row)).toBe('');
  });
  it('tronquer / pad', () => {
    expect(R('{{ref|tronquer:2}}', row)).toBe('AB');
    expect(R('{{ref|tronquer:x}}', row)).toBe('AB-12-CD');
    expect(R('{{code|pad:5}}', row)).toBe('00042');
    expect(R('{{neg|pad:4}}', row)).toBe('-007');
    expect(R('{{ref|pad:2}}', row)).toBe('AB-12-CD');
  });
  it('nombre / prix / chiffres / cleprix', () => {
    expect(R('{{prix|nombre:2}}', row)).toBe('12,50');
    expect(R('{{prix|nombre}}', row)).toBe('12,50');
    expect(R('{{poids|nombre:3}}', row)).toBe('1,250');
    expect(sp(R('{{prix|nombre:0}}', { prix: '12345,6' }))).toBe('12 346');
    expect(sp(R('{{prix|prix}}', row))).toBe('12,50 €');
    expect(R('{{ref|prix}}', row)).toBe('AB-12-CD');
    expect(R('{{prix|nombre:2|chiffres}}', row)).toBe('1250');
    expect(R('{{prix|nombre:2|chiffres|pad:4|cleprix}}', row)).toMatch(/^\d1250$/);
    expect(R('{{vide|cleprix}}', row)).toBe('');
  });
  it('date / jours / remplacer', () => {
    expect(R('{{d|jours:+30|date:JJ/MM/AAAA}}', row)).toBe('04/04/2026');
    expect(R('{{d|jours:-5|date:JJ/MM}}', row)).toBe('28/02');
    expect(R('{{ref|date}}', row)).toBe('AB-12-CD');
    expect(R('{{ref|remplacer:-:/}}', row)).toBe('AB/12/CD');
    expect(R('{{ref|remplacer:-}}', row)).toBe('AB12CD');
  });
  it('alias et filtre inconnu', () => {
    expect(R('{{ref|upper}} {{vide|défaut:z}}', row)).toBe('AB-12-CD z');
    expect(R('{{ref|bidule}}', row)).toBe('AB-12-CD');
    expect(unknownFilters('{{a|bidule|maj}} {{b|truc:1}}')).toEqual(['bidule', 'truc']);
    expect(unknownFilters('{{a|calc:*2|arrondi:1|sous:1,2|si:x|sinon:y|prixkg:p}}')).toEqual([]);
  });
  it('chaque filtre de l’aide a un exemple', () => {
    for (const f of FILTERS) expect(f.example).toContain('|' + f.name);
  });
});

describe('nouveaux filtres', () => {
  it('calc : opérations sur la valeur, virgule française', () => {
    expect(R('{{p|calc:*1,2}}', { p: '10' })).toBe('12');
    expect(R('{{p|calc:*1.2}}', { p: '12,5' })).toBe('15');
    expect(R('{{p|calc:/1000}}', { p: '1250' })).toBe('1,25');
    expect(R('{{p|calc:+5}}', { p: '1,5' })).toBe('6,5');
    expect(R('{{p|calc:-3}}', { p: '1' })).toBe('-2');
    expect(R('{{p|calc:(x-10)/2}}', { p: '20' })).toBe('5');
    expect(R('{{p|calc:x*x}}', { p: '3' })).toBe('9');
    expect(R('{{p|calc:*1.1}}', { p: '0,1' })).toBe('0,11');
    expect(R('{{p|calc:*1,2|nombre:2}}', { p: '10' })).toBe('12,00');
  });
  it('calc : entrées invalides → valeur inchangée', () => {
    expect(R('{{p|calc:/0}}', { p: '10' })).toBe('10');
    expect(R('{{p|calc:*2}}', { p: 'abc' })).toBe('abc');
    expect(R('{{p|calc:alert(1)}}', { p: '1' })).toBe('1');
    expect(R('{{p|calc:*}}', { p: '1' })).toBe('1');
    expect(R('{{p|calc:(1+2}}', { p: '1' })).toBe('1');
    expect(R('{{p|calc:}}', { p: '1' })).toBe('1');
  });
  it('calcExpr / numText / roundTo', () => {
    expect(calcExpr('2+3*4', 0)).toBe(14);
    expect(calcExpr('(2+3)*4', 0)).toBe(20);
    expect(calcExpr('(-x)', 5)).toBe(-5);
    expect(calcExpr('-x', 5)).toBe(0); // opérateur en tête = appliqué à la valeur : x-x
    expect(calcExpr('valeur÷2', 5)).toBe(2.5);
    expect(calcExpr('1/0', 0)).toBeNaN();
    expect(calcExpr('constructor', 0)).toBeNaN();
    expect(numText(-0)).toBe('0');
    expect(numText(1e-7)).toBe('0,0000001');
    expect(numText(1e21)).toBe('1000000000000000000000');
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(1234, -2)).toBe(1200);
  });
  it('arrondi:N', () => {
    expect(R('{{p|arrondi:2}}', { p: '1,005' })).toBe('1,01');
    expect(R('{{p|arrondi:2}}', { p: '12.5' })).toBe('12,50');
    expect(R('{{p|arrondi}}', { p: '2,5' })).toBe('3');
    expect(R('{{p|arrondi:0}}', { p: '-2,5' })).toBe('-3');
    expect(R('{{p|arrondi:-2}}', { p: '1234' })).toBe('1200');
    expect(R('{{p|arrondi:2}}', { p: '1 234,567' })).toBe('1234,57');
    expect(R('{{p|arrondi:x}}', { p: '1,5' })).toBe('1,5');
    expect(R('{{p|arrondi:1}}', { p: 'n/a' })).toBe('n/a');
  });
  it('sous:début,longueur', () => {
    const row = { r: 'ABCDEFGH' };
    expect(R('{{r|sous:3,4}}', row)).toBe('CDEF');
    expect(R('{{r|sous:3}}', row)).toBe('CDEFGH');
    expect(R('{{r|sous:-3}}', row)).toBe('FGH');
    expect(R('{{r|sous:-3,2}}', row)).toBe('FG');
    expect(R('{{r|sous:1,0}}', row)).toBe('');
    expect(R('{{r|sous:20,2}}', row)).toBe('');
    expect(R('{{r|sous:-20,2}}', row)).toBe('AB');
    expect(R('{{r|sous:0,2}}', row)).toBe('AB');
    expect(R('{{r|sous:x}}', row)).toBe('ABCDEFGH');
    expect(R('{{r|sous:2;2}}', { r: 'éèà' })).toBe('èà');
  });
  it('si / sinon', () => {
    expect(R('{{lot|si:Avec lot}}', { lot: 'L1' })).toBe('Avec lot');
    expect(R('{{lot|si:Avec lot}}', { lot: '  ' })).toBe('');
    expect(R('{{lot|si:Avec lot|sinon:Sans lot}}', { lot: '' })).toBe('Sans lot');
    expect(R('{{lot|si:Avec lot|sinon:Sans lot}}', { lot: 'x' })).toBe('Avec lot');
    expect(R('{{lot|sinon:—}}', { lot: 'L2' })).toBe('L2');
    expect(R('{{lot|sinon:—}}', { lot: '' })).toBe('—');
  });
  it('prixkg:colonne poids', () => {
    expect(R('{{prix|prixkg:Poids}}', { prix: '9,99', Poids: '0,333' })).toBe('30,00');
    expect(sp(R('{{prix|prixkg:Poids|prix}}', { prix: '5', Poids: '0.250' }))).toBe('20,00 €');
    expect(R('{{prix|prixkg:poids,g}}', { prix: '3', poids: '500' })).toBe('6,00');
    expect(R('{{prix|prixkg:Poids}}', { prix: '3', Poids: '0' })).toBe('');
    expect(R('{{prix|prixkg:Poids}}', { prix: '3', Poids: '' })).toBe('');
    expect(R('{{prix|prixkg:Absent}}', { prix: '3' })).toBe('');
    expect(R('{{prix|prixkg:Poids}}', { prix: 'n/a', Poids: '1' })).toBe('n/a');
    expect(R('{{prix|prixkg:}}', { prix: '3' })).toBe('3');
  });
  it('prixkg avec un champ saisi à l’impression', () => {
    const doc = newDoc();
    doc.promptValues = { Poids: '2' };
    expect(R('{{prix|prixkg:?Poids}}', { prix: '7' }, doc)).toBe('3,50');
  });
});

describe('conditionHolds', () => {
  const doc = newDoc();
  const c = (field: string, op: 'empty' | 'notEmpty' | 'eq' | 'ne' | 'contains', value = '', row: Record<string, string> = {}) => conditionHolds({ field, op, value }, ctx(doc, { row }));
  it('opérateurs', () => {
    expect(c('lot', 'empty', '', { lot: '' })).toBe(true);
    expect(c('lot', 'notEmpty', '', { lot: 'x' })).toBe(true);
    expect(c('{{pays}}', 'eq', 'france', { pays: 'France ' })).toBe(true);
    expect(c('pays', 'eq', 'Équateur', { pays: 'equateur' })).toBe(true); // sans accents ni casse
    expect(c('pays', 'ne', 'France', { pays: 'Italie' })).toBe(true);
    expect(c('pays', 'contains', 'tal', { pays: 'Italie' })).toBe(true);
    expect(c('pays', 'contains', '', { pays: 'Italie' })).toBe(true);
    expect(c('pays', 'contains', 'zz', { pays: 'Italie' })).toBe(false);
  });
  it('champ vide, condition absente, valeur résolue, filtres', () => {
    expect(conditionHolds(undefined, ctx(doc))).toBe(true);
    expect(c('  ', 'eq', 'x')).toBe(true);
    expect(c('a', 'eq', '{{b}}', { a: 'x', b: 'X' })).toBe(true);
    expect(c('p|calc:*2', 'eq', '10', { p: '5' })).toBe(true);
    expect(c('inconnu', 'empty')).toBe(true);
    expect(conditionHolds({ field: 'a', op: 'bizarre' as 'eq' }, ctx(doc, { row: { a: '1' } }))).toBe(true);
  });
});

describe('promptFields / promptSpecs', () => {
  it('ordre d’apparition, dédoublonnage, éléments masqués ignorés, conditions', () => {
    const doc = newDoc();
    const hidden = makeText(doc, '{{?Caché}}');
    hidden.hidden = true;
    const withCond = makeText(doc, 'x');
    withCond.showIf = { field: '{{?Pays}}', op: 'notEmpty' };
    doc.elements = [makeText(doc, '{{?Lot}} {{ ? Poids |nombre:2}} {{?Lot|maj}}'), hidden, withCond, makeBarcode(doc, 'code128', '{{?Lot}}{{?}}')];
    expect(promptFields(doc)).toEqual(['Lot', 'Poids', 'Pays']);
  });
  it('options : liste, obligatoire, gtin, regex, min, max (fusionnées)', () => {
    const doc = newDoc();
    doc.elements = [
      makeText(doc, '{{?Atelier|liste:A; B ;C|obligatoire}} {{?GTIN|gtin}} {{?Lot|regex:[A-Z][A-Z][0-9]+}}'),
      makeText(doc, '{{?Poids|min:0,1|max:30|nombre:2}} {{?Atelier|liste:D}} {{?Nom|min}}'),
    ];
    const specs = promptSpecs(doc);
    expect(specs.map((s) => s.name)).toEqual(['Atelier', 'GTIN', 'Lot', 'Poids', 'Nom']);
    expect(specs.find((s) => s.name === 'Atelier')).toEqual({ name: 'Atelier', type: 'list', required: true, choices: ['A', 'B', 'C', 'D'] });
    expect(specs.find((s) => s.name === 'GTIN')).toEqual({ name: 'GTIN', type: 'gtin', required: false });
    expect(specs.find((s) => s.name === 'Lot')).toEqual({ name: 'Lot', type: 'text', required: false, pattern: '[A-Z][A-Z][0-9]+' });
    expect(specs.find((s) => s.name === 'Poids')).toEqual({ name: 'Poids', type: 'number', required: false, min: 0.1, max: 30 });
    // « min » sans argument = filtre minuscules, pas une option
    expect(specs.find((s) => s.name === 'Nom')).toEqual({ name: 'Nom', type: 'text', required: false });
    expect(unknownFilters('{{?Atelier|liste:A;B|obligatoire|gtin|min:1|max:2}}')).toEqual([]);
    expect(unknownFilters('{{Atelier|liste:A;B}}')).toEqual(['liste']); // options seulement sur {{?…}}
  });
  it('les options ne modifient pas la valeur affichée ; les vrais filtres oui', () => {
    const doc = newDoc();
    doc.promptValues = { Poids: '2,5', Nom: 'ABC' };
    expect(resolveText('{{?Poids|min:0|max:30|nombre:2}} {{?Nom|min}} {{?Nom|obligatoire}}', ctx(doc))).toBe('2,50 abc ABC');
  });
});

describe('validatePrompt', () => {
  const spec = (p: Partial<PromptSpec>): PromptSpec => ({ name: 'X', type: 'text', required: false, ...p });
  it('obligatoire', () => {
    expect(validatePrompt(spec({ required: true }), '  ')).toEqual({ msg: 'Champ obligatoire' });
    expect(validatePrompt(spec({}), '')).toBeNull();
    expect(validatePrompt(spec({ type: 'gtin' }), '')).toBeNull();
  });
  it('liste', () => {
    const s = spec({ type: 'list', choices: ['A', 'B'] });
    expect(validatePrompt(s, 'B')).toBeNull();
    expect(validatePrompt(s, 'C')?.msg).toBe('Choisissez une valeur de la liste');
  });
  it('GTIN 8 / 12 / 13 / 14 avec clé', () => {
    const s = spec({ type: 'gtin' });
    expect(validatePrompt(s, '3017620422003')).toBeNull(); // EAN-13
    expect(validatePrompt(s, '96385074')).toBeNull(); // EAN-8
    expect(validatePrompt(s, '036000291452')).toBeNull(); // UPC-A
    expect(validatePrompt(s, '13017620422000')).toBeNull(); // GTIN-14
    expect(validatePrompt(s, '3017620422004')).toEqual({ msg: 'Clé de contrôle GTIN incorrecte (attendue : {k})', vars: { k: 3 } });
    expect(validatePrompt(s, '301762042200')?.msg).toBe('Clé de contrôle GTIN incorrecte (attendue : {k})');
    expect(validatePrompt(s, '12345')).toEqual({ msg: 'Le GTIN doit faire 8, 12, 13 ou 14 chiffres ({n} saisis)', vars: { n: 5 } });
    expect(validatePrompt(s, '30176204220A3')?.msg).toBe('Le GTIN ne doit contenir que des chiffres');
    expect(isValidGtin('3017620422003')).toBe(true);
    expect(isValidGtin('301762042200')).toBe(false);
    expect(gs1CheckDigit('301762042200')).toBe(3);
  });
  it('min / max', () => {
    const s = spec({ type: 'number', min: 0.1, max: 30 });
    expect(validatePrompt(s, '1,5')).toBeNull();
    expect(validatePrompt(s, '30')).toBeNull();
    expect(validatePrompt(s, '0,05')).toEqual({ msg: 'Valeur minimale : {n}', vars: { n: '0,1' } });
    expect(validatePrompt(s, '31')).toEqual({ msg: 'Valeur maximale : {n}', vars: { n: '30' } });
    expect(validatePrompt(s, 'abc')).toEqual({ msg: 'Nombre attendu' });
  });
  it('regex (ancrée), regex invalide ignorée', () => {
    const s = spec({ pattern: '[A-Z]{2}[0-9]+' });
    expect(validatePrompt(s, 'AB12')).toBeNull();
    expect(validatePrompt(s, 'xAB12')).toEqual({ msg: 'Format attendu : {p}', vars: { p: '[A-Z]{2}[0-9]+' } });
    expect(validatePrompt(spec({ pattern: '([' }), 'x')).toBeNull();
  });
  it('validatePrompts : toutes les erreurs', () => {
    const specs = [spec({ name: 'A', required: true }), spec({ name: 'B', type: 'gtin' }), spec({ name: 'C' })];
    expect(validatePrompts(specs, { A: '', B: '123', C: 'ok' })).toEqual({
      A: { msg: 'Champ obligatoire' },
      B: { msg: 'Le GTIN doit faire 8, 12, 13 ou 14 chiffres ({n} saisis)', vars: { n: 3 } },
    });
    expect(validatePrompts(specs, { A: 'x', B: '96385074' })).toEqual({});
  });
});

describe('compteur avancé', () => {
  const num = (p: Partial<LabelDoc['numbering']>) => newDoc({ numbering: { start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 10, ...p } });
  it('compatibilité : sans repeat/alpha, comportement inchangé', () => {
    const doc = num({ start: 7, step: 3, padding: 5 });
    expect([0, 1, 2].map((i) => serialValue(doc, i))).toEqual(['00007', '00010', '00013']);
  });
  it('répétition : même numéro N étiquettes de suite', () => {
    const doc = num({ start: 1, step: 1, repeat: 3, padding: 2 });
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => serialValue(doc, i))).toEqual(['01', '01', '01', '02', '02', '02', '03']);
    expect(serialValue(num({ repeat: 0 }), 1)).toBe('2'); // 0 → 1
  });
  it('pas négatif + répétition', () => {
    const doc = num({ start: 10, step: -5, repeat: 2 });
    expect([0, 1, 2, 3, 4, 5].map((i) => serialValue(doc, i))).toEqual(['10', '10', '5', '5', '0', '0']);
    expect(serialValue(doc, 6)).toBe('-5');
  });
  it('base 36 majuscules, zéros, préfixe', () => {
    const doc = num({ start: 34, alpha: true, padding: 3, prefix: 'C-' });
    expect([0, 1, 2, 3].map((i) => serialValue(doc, i))).toEqual(['C-00Y', 'C-00Z', 'C-010', 'C-011']);
    expect(serialValue(num({ start: -11, alpha: true }), 0)).toBe('-B');
    expect(parseSerialAlpha('a0')).toBe(360);
    expect(parseSerialAlpha('Z')).toBe(35);
    expect(parseSerialAlpha('é')).toBeNaN();
    expect(parseSerialAlpha('')).toBeNaN();
  });
  it('départ suivant après une série', () => {
    expect(serialNextStart({ start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 10 }, 10)).toBe(11);
    expect(serialNextStart({ start: 1, step: 2, padding: 0, prefix: '', suffix: '', count: 10, repeat: 3 }, 10)).toBe(9); // 4 numéros consommés
    expect(serialNextStart({ start: 100, step: -1, padding: 0, prefix: '', suffix: '', count: 5, repeat: 2 }, 6)).toBe(97);
  });
});

describe('colis {{#pos}}/{{#total}}', () => {
  it('série numérotée sans données : 1/N … N/N', () => {
    const doc = newDoc({ numbering: { start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 3 } });
    doc.elements = [makeText(doc, 'Colis {{#pos}}/{{#total}}')];
    expect(docUsesSerial(doc)).toBe(true);
    expect(batchJobs(doc).map((j) => resolveText('{{#pos}}/{{#total}}', ctxFor(doc, j.index)))).toEqual(['1/3', '2/3', '3/3']);
  });
  it('lignes cochées : position parmi les lignes cochées', () => {
    const doc = newDoc({ data: data([{ a: '1' }, { a: '2' }, { a: '3' }, { a: '4' }], [true, false, true, true]) });
    doc.elements = [makeText(doc, '{{#colis}}/{{#nb}}')];
    expect(batchJobs(doc).map((j) => resolveText('{{#colis}}/{{#nb}}', ctxFor(doc, j.index)))).toEqual(['1/3', '2/3', '3/3']);
    expect(jobPosition(doc, 1)).toEqual({ pos: 2, total: 3 }); // ligne non cochée (aperçu) : bornée
  });
  it('aucune ligne cochée : 1/1', () => {
    const doc = newDoc({ data: data([{ a: '1' }, { a: '2' }]) });
    expect(resolveText('{{#pos}}/{{#total}}', ctxFor(doc, 1))).toBe('1/1');
  });
  it('prime sur une colonne homonyme, insensible à la casse', () => {
    const doc = newDoc({ data: data([{ '#total': 'col' }], [true]) });
    expect(resolveText('{{#TOTAL}}', ctxFor(doc, 0))).toBe('1');
  });
});

describe('SSCC {{#sscc}} — aperçu et travail', () => {
  beforeEach(async () => {
    localStorage.clear();
    _resetSsccForTests();
    await loadSscc();
  });

  it('non configuré : le champ reste affiché tel quel', () => {
    expect(resolveText('{{#sscc}}', ctx(newDoc()))).toBe('{{#sscc}}');
  });

  it('aperçu : prochain SSCC prévu par étiquette, sans réservation', async () => {
    await saveSsccSettings({ prefix: '3012345', extension: 1 });
    await saveSsccSettings({ next: 10 });
    const doc = newDoc();
    doc.elements = [makeBarcode(doc, 'sscc18', '{{#sscc}}')];
    doc.numbering = { ...doc.numbering, count: 3 };
    expect(docUsesSscc(doc)).toBe(true);
    expect(batchJobs(doc)).toHaveLength(3);
    expect(resolveText('{{#sscc}}', ctxFor(doc, 0))).toBe(composeSscc(1, '3012345', 10));
    expect(resolveText('{{#sscc}}', ctxFor(doc, 2))).toBe(composeSscc(1, '3012345', 12));
    expect(resolveText('{{ #SSCC }}', ctxFor(doc, 0))).toHaveLength(18);
    expect(nextSerial(getSsccConfig())).toBe(10);
  });

  it('aperçu avec données : rang parmi les lignes cochées', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    const doc = newDoc();
    doc.data = data([{ a: '1' }, { a: '2' }, { a: '3' }], [true, false, true]);
    expect(resolveText('{{#sscc}}', ctxFor(doc, 2))).toBe(composeSscc(0, '3012345', 1));
  });

  it('travail : SSCC de la plage réservée, identique pour les copies, différent par ligne', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    const doc = newDoc() as SsccDoc;
    doc.data = data([{ a: '1' }, { a: '2' }, { a: '3' }], [true, true, true], [3, 1, 2]);
    doc.jobDate = Date.now();
    doc.ssccJob = { prefix: '7654321', extension: 9, start: 500, indices: [0, 2] };
    expect(resolveText('{{#sscc}}', ctxFor(doc, 0))).toBe(composeSscc(9, '7654321', 500));
    expect(resolveText('{{#sscc}}', ctxFor(doc, 2))).toBe(composeSscc(9, '7654321', 501));
    expect(resolveText('[{{#sscc}}]', ctxFor(doc, 1))).toBe('[]'); // hors plage : jamais de numéro non réservé
  });

  it('document de travail sans plage réservée : aucun numéro (pas l’aperçu)', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    const doc = newDoc();
    doc.jobDate = Date.now();
    expect(resolveText('{{#sscc}}', ctxFor(doc, 0))).toBe('{{#sscc}}');
  });

  it('élément masqué : non compté', () => {
    const doc = newDoc();
    doc.elements = [{ ...makeText(doc, '{{#sscc}}'), hidden: true }];
    expect(docUsesSscc(doc)).toBe(false);
  });
});

describe('filtres partie / extraire / clegtin / controle (emplacements)', () => {
  const row = { Emplacement: 'ZB1-01-01-A1', Ref: 'ART1000001 (CMR) / ART1000002', Liste: 'a, b ,c', Mots: 'un  deux trois', Ean: '200000000001', Vide: '' };
  it('partie : N-ième morceau, négatif depuis la fin, espaces retirés', () => {
    expect(R('{{Emplacement|partie:4,-}}', row)).toBe('A1');
    expect(R('{{Emplacement|partie:1,-}}', row)).toBe('ZB1');
    expect(R('{{Emplacement|partie:-2,-}}', row)).toBe('01');
    expect(R('{{Ref|partie:1,/}}', row)).toBe('ART1000001 (CMR)');
    expect(R('{{Ref|partie:-1,/}}', row)).toBe('ART1000002');
  });
  it('partie : morceau inexistant → vide, N illisible → inchangé', () => {
    expect(R('[{{Emplacement|partie:9,-}}]', row)).toBe('[]');
    expect(R('[{{Emplacement|partie:0,-}}]', row)).toBe('[]');
    expect(R('{{Emplacement|partie:x,-}}', row)).toBe('ZB1-01-01-A1');
    expect(R('[{{Vide|partie:1,-}}]', row)).toBe('[]');
  });
  it('partie : séparateur virgule, entre guillemets, ou espaces par défaut', () => {
    expect(R('{{Liste|partie:2,,}}', row)).toBe('b');
    expect(R('{{Emplacement|partie:2,"-0"}}', row)).toBe('1');
    expect(R('{{Mots|partie:2}}', row)).toBe('deux');
    expect(R('{{Mots|partie:-1, }}', row)).toBe('trois');
  });
  it('extraire : correspondance, groupe 1, vide sinon, regex invalide → inchangé', () => {
    expect(R('{{Ref|extraire:^[^ (]+}}', row)).toBe('ART1000001');
    expect(R('{{Ref|extraire:\\((\\w+)\\)}}', row)).toBe('CMR');
    expect(R('[{{Ref|extraire:^ZZZ}}]', row)).toBe('[]');
    expect(R('{{Ref|extraire:(}}', row)).toBe('ART1000001 (CMR) / ART1000002');
    expect(R('{{Emplacement|extraire:[A-Z]\\d+$}}', row)).toBe('A1');
  });
  it('clegtin : ajoute la clé GS1 aux longueurs connues seulement', () => {
    expect(R('{{Ean|clegtin}}', row)).toBe('2000000000015');
    expect(R('{{c|clegtin}}', { c: '1234567' })).toBe('12345670');
    expect(R('{{c|clegtin}}', { c: '03600029145' })).toBe('036000291452');
    expect(R('{{c|clegtin}}', { c: '1061414100004' })).toBe('10614141000040');
    expect(R('{{c|clegtin}}', { c: '00614141123456789' })).toBe('006141411234567890');
    expect(R('{{c|clegtin}}', { c: '2000000000015' })).toBe('20000000000158');
    expect(R('{{c|clegtin}}', { c: '12345' })).toBe('12345');
    expect(R('{{c|clegtin}}', { c: '12A4567' })).toBe('12A4567');
    expect(R('[{{Vide|clegtin}}]', row)).toBe('[]');
  });
  it('controle : chiffres stables (FNV-1a), 2 par défaut, bornés 1 à 4', () => {
    expect(R('{{Emplacement|controle}}', row)).toBe('37');
    expect(R('{{Emplacement|controle:2}}', row)).toBe('37');
    expect(R('{{Emplacement|controle:3}}', row)).toBe('837');
    expect(R('{{e|controle:4}}', { e: 'ZB1-04-03-B1' })).toBe('0363');
    expect(R('{{e|controle:9}}', { e: 'ZB1-04-03-B1' })).toBe('0363');
    expect(R('{{e|controle:0}}', { e: 'a' })).toBe('0');
    expect(R('{{e|controle}}', { e: ' ZB1-01-01-A2 ' })).toBe('80');
    expect(checkDigits('a', 4)).toBe('2220');
    expect(checkDigits('é', 2)).toBe('17');
    expect(R('[{{Vide|controle}}]', row)).toBe('[]');
    expect(R('{{e|controle:x}}', { e: 'a' })).toBe('a');
  });
  it('enchaînement et filtres connus', () => {
    expect(R('{{Emplacement|partie:4,-|controle:2}}', row)).toBe(checkDigits('A1', 2));
    expect(unknownFilters('{{a|partie:1,-|extraire:x|clegtin|controle:2}}')).toEqual([]);
    expect(partOf('A/B', '2,/')).toBe('B');
  });
});

describe('fieldKeys / isSpecialKey / conditionKey', () => {
  it('liste les clés des champs', () => {
    expect(fieldKeys('{{Ref|partie:1,/}} {{ Emplacement }} {{numero}}')).toEqual(['Ref', 'Emplacement', 'numero']);
    expect(fieldKeys('sans champ')).toEqual([]);
  });
  it('reconnaît les champs calculés', () => {
    for (const k of ['numero', '#', '#pos', '#total', '#sscc', 'date', 'date+30', 'aujourdhui', '?Lot']) expect(isSpecialKey(k)).toBe(true);
    expect(isSpecialKey('Emplacement')).toBe(false);
  });
  it('clé d’une condition', () => {
    expect(conditionKey({ field: '{{poids|arrondi:0}}', op: 'empty' })).toBe('poids');
    expect(conditionKey({ field: 'lot', op: 'empty' })).toBe('lot');
  });
});
