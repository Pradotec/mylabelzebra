import { describe, it, expect } from 'vitest';
// fixtures de non-régression : ne JAMAIS modifier un fichier existant, en ajouter un nouveau
import v1Riche from './__fixtures__/v1-riche.mlz.json?raw';
import docNu from './__fixtures__/doc-nu.mlz.json?raw';
import v99 from './__fixtures__/v99-futur.mlz.json?raw';
import { docToJson, jsonToDoc, jsonToDocWithWarnings } from './export';
import { newDoc, normalizeDoc, elementLabel } from './elements';
import { FORMAT_VERSION, MIGRATIONS, LEGACY_FIXES, migrateFile, migrateDoc, docVersion, migrationWarningText, type VersionFields } from './migrate';
import { renderLabel } from './render/draw';
import { generateLabelZpl } from './zpl/generate';
import type { BarcodeEl, ImageEl, LabelDoc, MarkEl, QrEl, ShapeEl, TableEl, TextEl } from './types';

const byId = <T,>(d: LabelDoc, id: string) => d.elements.find((e) => e.id === id) as T;
const extra = (d: LabelDoc) => d as LabelDoc & VersionFields & Record<string, unknown>;

describe('migrate : cadre', () => {
  it('version courante et migrations ordonnées, sans trou ni doublon', () => {
    expect(FORMAT_VERSION).toBe(1);
    const froms = MIGRATIONS.map((m) => m.from);
    // une migration par version, de 1 à FORMAT_VERSION - 1
    expect([...froms].sort((a, b) => a - b)).toEqual(Array.from({ length: FORMAT_VERSION - 1 }, (_, i) => i + 1));
  });

  it('les corrections héritées sont idempotentes', () => {
    const { doc } = migrateFile(v1Riche);
    const once = JSON.stringify(doc);
    let again = JSON.parse(once);
    for (const f of LEGACY_FIXES) again = f.fix(again);
    expect(JSON.stringify(again)).toBe(once);
  });

  it('version : enveloppe, formatVersion du document, 1 à défaut', () => {
    expect(migrateFile(v1Riche).version).toBe(1);
    expect(migrateFile(docNu).version).toBe(1);
    expect(migrateFile(v99).version).toBe(99);
    expect(migrateFile({ elements: [], formatVersion: 3 }).version).toBe(3);
    expect(docVersion({})).toBe(1);
    expect(docVersion({ formatVersion: 'x' })).toBe(1);
  });

  it('accepte texte JSON ou objet ; refuse ce qui n’est pas une étiquette', () => {
    expect(migrateFile(JSON.parse(docNu)).doc.name).toBe('Fixture doc nu');
    expect(() => migrateFile('{"app":"MyLabelZebra","version":1}')).toThrow();
    expect(() => migrateFile('[]')).toThrow();
    expect(() => migrateFile('pas du json')).toThrow();
  });

  it('documents stockés (IndexedDB) : normalizeDoc applique aussi les migrations, une seule fois', () => {
    const stored = JSON.parse(docNu); // un document enregistré n'a pas d'enveloppe
    const d = normalizeDoc(stored);
    expect((byId<TextEl>(d, 't1')).fit).toBe('wrapShrink');
    expect(extra(d).formatVersion).toBe(FORMAT_VERSION);
    // repasser dans normalizeDoc (loadDoc après jsonToDoc) ne change rien
    expect(normalizeDoc(d)).toEqual(d);
    // le document d'origine n'est pas modifié
    expect(stored.elements[0].autoShrink).toBe(true);
  });

  it('un nouveau document porte la version courante', () => {
    expect(extra(newDoc()).formatVersion).toBe(FORMAT_VERSION);
    expect(migrateDoc({ ...newDoc() }).warnings).toEqual([]);
  });
});

describe('fixture v1 riche', () => {
  const d = jsonToDoc(v1Riche);

  it('se charge sans avertissement', () => {
    expect(jsonToDocWithWarnings(v1Riche).warnings).toEqual([]);
    expect(d.elements).toHaveLength(10);
  });

  it('document : dimensions, numérotation, date, données, rouleau…', () => {
    expect(d).toMatchObject({ id: 'fixture-v1-riche', name: 'Fixture v1 riche', widthIn: 4, heightIn: 3, dpi: 300, zoom: 1.5, copies: 4, updatedAt: 1700000000000 });
    expect(d.numbering).toEqual({ start: 100, step: 5, padding: 6, prefix: 'N-', suffix: '-X', count: 25, repeat: 2, alpha: false });
    expect(d.date).toEqual({ format: 'JJ/MM/AAAA', offsetDays: 3 });
    expect(d.data?.columns).toEqual(['Article', 'Energie']);
    expect(d.data?.rows[1]).toEqual({ Article: 'Article B', Energie: '1200' });
    expect(d.data?.checked).toEqual([true, false, true]);
    expect(d.data?.copies).toEqual([2, 1, 3]);
    expect(d.guides).toEqual({ x: [100, 400], y: [50] });
    expect(d.roll).toEqual({ columns: 2, gapMm: 3, leftMm: 1.5 });
    expect(d.allergensExtra).toEqual(['lupin fictif']);
  });

  it('textes : fit conservé, autoShrink migré (true → wrapShrink, false → wrapGrow)', () => {
    const fit = byId<TextEl>(d, 't-fit');
    expect(fit).toMatchObject({ fit: 'shrinkLine', minFontSize: 12, ellipsis: true, role: 'denomination', vAlign: 'middle', name: 'Dénomination' });
    expect(fit.showIf).toEqual({ field: 'Article', op: 'notEmpty' });
    const a = byId<TextEl>(d, 't-autoshrink-vrai');
    expect(a.fit).toBe('wrapShrink');
    expect('autoShrink' in a).toBe(false);
    expect(a.text).toBe('Lot : {{?Lot}} – saisi à l’impression');
    const b = byId<TextEl>(d, 't-autoshrink-faux');
    expect(b.fit).toBe('wrapGrow');
    expect('autoShrink' in b).toBe(false);
    expect(b).toMatchObject({ rotation: 90, italic: true, invert: true, align: 'center', anchorTo: 't-autoshrink-vrai' });
  });

  it('codes, image, forme, tableau, marques', () => {
    expect(byId<BarcodeEl>(d, 'bc')).toMatchObject({ symbology: 'gs1-128', value: '(01)03012345678900(10){{?Lot}}', groups: ['g-codes'] });
    expect(byId<QrEl>(d, 'qr')).toMatchObject({ qrType: 'wifi', level: 'Q', wifi: { ssid: 'ReseauFictif', enc: 'WPA' } });
    const img = byId<ImageEl>(d, 'img');
    expect(img).toMatchObject({ threshold: 140, dither: false, keepRatio: true, flipX: true });
    expect(img.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(byId<ShapeEl>(d, 'sh')).toMatchObject({ kind: 'roundrect', radius: 20, locked: true });
    const tb = byId<TableEl>(d, 'tb');
    expect(tb.cells[1]).toEqual(['Énergie', '{{Energie}} kJ']);
    expect(tb.colWidths).toEqual([2, 1]);
    expect(byId<MarkEl>(d, 'mk')).toMatchObject({ kind: 'health', country: 'FR', approval: '99.999.999', suffix: 'CE', role: 'healthMark' });
    expect(byId<MarkEl>(d, 'mk-e')).toMatchObject({ kind: 'estimated', hidden: true });
  });

  it('ordre des éléments (plan) conservé', () => {
    expect(d.elements.map((e) => e.id)).toEqual(['t-fit', 't-autoshrink-vrai', 't-autoshrink-faux', 'bc', 'qr', 'img', 'sh', 'tb', 'mk', 'mk-e']);
  });

  it('aller-retour jsonToDoc(docToJson(doc)) stable', () => {
    const json = docToJson(d);
    expect(JSON.parse(json)).toMatchObject({ app: 'MyLabelZebra', version: FORMAT_VERSION });
    expect(jsonToDoc(json)).toEqual(d);
    expect(docToJson(jsonToDoc(json))).toBe(json);
  });

  it('se rend et produit du ZPL', () => {
    expect(() => renderLabel(d, { scale: 0.5 })).not.toThrow();
    expect(generateLabelZpl(d)).toMatch(/^\^XA[\s\S]*\^XZ\s*$/);
  });
});

describe('fixture doc nu (sans enveloppe)', () => {
  const d = jsonToDoc(docNu);

  it('se charge comme une version 1 et complète les champs manquants', () => {
    expect(d.name).toBe('Fixture doc nu');
    expect(d).toMatchObject({ widthIn: 2.25, heightIn: 1.25, dpi: 203, zplRaster: true });
    expect(d.numbering).toEqual({ ...newDoc().numbering, start: 7 });
    expect(d.date).toEqual(newDoc().date);
    expect(d.guides).toEqual({ x: [], y: [] });
    expect(byId<TextEl>(d, 't1').fit).toBe('wrapShrink');
    expect(byId<TextEl>(d, 't1').text).toBe('Ancien fichier {{?Poids}} kg');
    expect(byId<BarcodeEl>(d, 'b1')).toMatchObject({ rotation: 0, symbology: 'ean13', value: '1234567890128' });
    const mark = d.elements[2] as MarkEl;
    expect(mark.id).toBeTruthy();
    expect(mark).toMatchObject({ country: '', approval: '', suffix: '', color: '#000000', strokeWidth: 3 });
  });

  it('aller-retour stable', () => {
    expect(jsonToDoc(docToJson(d))).toEqual(d);
  });
});

describe('fixture version 99 (plus récente)', () => {
  const { doc: d, warnings } = jsonToDocWithWarnings(v99);

  it('s’ouvre avec des avertissements', () => {
    expect(warnings).toEqual([
      { kind: 'newerVersion', version: 99, current: FORMAT_VERSION },
      { kind: 'unknownElements', count: 1, types: ['hologramme'] },
    ]);
    for (const w of warnings) expect(migrationWarningText(w)).toBeTruthy();
    // jsonToDoc (signature historique) ouvre le même document
    expect(jsonToDoc(v99)).toEqual(d);
  });

  it('champs inconnus conservés', () => {
    expect(extra(d).champDuFutur).toEqual({ mode: 'hologramme', niveau: 3 });
    expect((d.numbering as unknown as Record<string, unknown>).base).toBe('futur');
    expect((d.elements[0] as unknown as Record<string, unknown>).proprieteFuture).toBe('conservée');
    expect(extra(d).formatVersion).toBe(99);
  });

  it('élément de type inconnu : retiré du rendu, conservé à part', () => {
    expect(d.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(extra(d).unknownElements).toEqual([{ index: 1, element: expect.objectContaining({ id: 'holo', type: 'hologramme', intensite: 7 }) }]);
    expect(() => renderLabel(d, { scale: 0.5 })).not.toThrow();
    expect(() => generateLabelZpl(d)).not.toThrow();
    expect(d.elements.map(elementLabel)).toHaveLength(2);
  });

  it('réexport : version 99 conservée, élément inconnu remis à sa place', () => {
    const out = JSON.parse(docToJson(d));
    expect(out.version).toBe(99);
    expect(out.doc.elements.map((e: { id: string }) => e.id)).toEqual(['a', 'holo', 'b']);
    expect(out.doc.unknownElements).toBeUndefined();
    expect(out.doc.champDuFutur).toEqual({ mode: 'hologramme', niveau: 3 });
    // et la réouverture redonne le même document
    expect(jsonToDoc(docToJson(d))).toEqual(d);
  });

  it('un document stocké avec un élément inconnu ne garde pas de doublon après plusieurs normalisations', () => {
    expect(normalizeDoc(normalizeDoc(d))).toEqual(d);
  });
});
