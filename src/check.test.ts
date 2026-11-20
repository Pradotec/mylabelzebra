/** Mesure de texte factice (src/test/setup.ts) : largeur = nb de caractères × taille × 0,5 */
import { describe, it, expect } from 'vitest';
import { checkBatch, checkBatchAsync, checkRows, missingColumns, issueRows, elementLabel, codeError } from './check';
import { newDoc, makeText, makeBarcode } from './elements';
import type { DataSet, LabelDoc } from './types';

function data(rows: Record<string, string>[], checked: boolean[] = []): DataSet {
  return { columns: Object.keys(rows[0]), rows, checked: rows.map((_, i) => !!checked[i]), copies: rows.map(() => 1) };
}

/** Étiquette emplacement : code EAN-13 interne, code 128 de l'emplacement, libellé produit */
function emplacementDoc(rows: Record<string, string>[], checked: boolean[] = []): LabelDoc {
  const doc = newDoc({ widthIn: 4, heightIn: 6 });
  const ean = { ...makeBarcode(doc, 'ean13', '{{Eaninterne}}'), id: 'ean' };
  const loc = { ...makeBarcode(doc, 'code128', '{{Emplacement}}'), id: 'loc' };
  const prod = { ...makeText(doc, '{{Produit}}', { fontSize: 20, w: 100, h: 22, fit: 'shrinkLine', minFontSize: 10, ellipsis: false }), id: 'prod' };
  doc.elements = [ean, loc, prod];
  doc.data = data(rows, checked);
  return doc;
}

const row = (Emplacement: string, Eaninterne: string, Produit = 'Vis') => ({ Produit, Ref: 'ART1000001', Emplacement, Fournisseur: 'F', Eaninterne });

describe('checkRows', () => {
  it('lignes cochées, sinon toutes', () => {
    const d = emplacementDoc([row('A', '1'), row('B', '2'), row('C', '3')], [false, true, true]);
    expect(checkRows(d)).toEqual([1, 2]);
    d.data!.checked = [false, false, false];
    expect(checkRows(d)).toEqual([0, 1, 2]);
    expect(checkRows(newDoc())).toEqual([]);
  });
});

describe('missingColumns', () => {
  it('colonne inconnue signalée une fois ; champs spéciaux et casse ignorés', () => {
    const d = emplacementDoc([row('A', '2000000000015')]);
    d.elements.push(makeText(d, '{{Emplacment}} {{emplacement}} {{numero}} {{date+3}} {{?Lot}} {{Emplacment|maj}}'));
    d.elements.push({ ...makeText(d, 'x'), showIf: { field: '{{Fourniseur}}', op: 'notEmpty' } });
    expect(missingColumns(d)).toEqual(['Emplacment', 'Fourniseur']);
    const list = checkBatch(d);
    expect(list.filter((x) => x.kind === 'missingColumn').map((x) => x.row)).toEqual([-1, -1]);
    expect(list[0].message).toContain('{{Emplacment}}');
  });
});

describe('checkBatch', () => {
  it('lot propre : aucune anomalie', () => {
    const d = emplacementDoc([row('ZB1-01-01-A1', '2000000000015'), row('ZB1-01-01-A2', '2000000000022')]);
    expect(checkBatch(d)).toEqual([]);
  });

  it('code invalide, code « / », texte vide, doublon de code', () => {
    const d = emplacementDoc(
      [
        row('ZB1-01-01-A1', '2000000000015'),
        row('/', '2000000000016'), // emplacement « / », EAN à clé fausse
        row('ZB1-01-01-A1', '2000000000022', ''), // emplacement en double, produit vide
      ],
      [true, true, true],
    );
    const list = checkBatch(d);
    const brief = list.map((x) => [x.row, x.elementId, x.kind]);
    expect(brief).toEqual([
      [1, 'ean', 'invalidCode'],
      [1, 'loc', 'emptyField'],
      [2, 'loc', 'duplicateCode'],
      [2, 'prod', 'emptyField'],
    ]);
    expect(list[0].message).toContain('2000000000016');
    expect(list[2].message).toContain('1'); // première ligne du doublon
    expect(issueRows(list)).toEqual([1, 2]);
  });

  it('seules les lignes cochées sont contrôlées', () => {
    const d = emplacementDoc([row('A1', '2000000000015'), row('/', 'x')], [true, false]);
    expect(checkBatch(d)).toEqual([]);
  });

  it('code fixe identique partout : pas de doublon ; élément masqué ou non imprimé ignoré', () => {
    const d = emplacementDoc([row('A1', '2000000000015'), row('A2', '2000000000022')]);
    d.elements.push({ ...makeBarcode(d, 'code128', 'FIXE'), id: 'fixe' });
    d.elements.push({ ...makeBarcode(d, 'ean13', '{{Ref}}'), id: 'hid', hidden: true });
    d.elements.push({ ...makeBarcode(d, 'ean13', '{{Ref}}'), id: 'cond', showIf: { field: 'Fournisseur', op: 'eq', value: 'autre' } });
    expect(checkBatch(d)).toEqual([]);
  });

  it('texte réduit à sa taille minimale ou tronqué (mise en page réelle)', () => {
    // boîte de 100 : à 20 px, 10 caractères ; à 10 px (minimum), 20 caractères
    const d = emplacementDoc([row('A1', '2000000000015', 'Vis courte'), row('A2', '2000000000022', 'Produit au nom un peu long'), row('A3', '2000000000039', 'abcdefghijklmnopqrst'), row('A4', '2000000000046', 'abcdefghijklmno')]);
    const fits = checkBatch(d).filter((x) => x.kind === 'textFit');
    expect(fits.map((x) => x.row)).toEqual([1, 2]);
    expect(fits[0].message).toMatch(/tronqué/);
    expect(fits[1].message).toMatch(/minimale/);
    expect(checkBatch(d, { layout: false }).filter((x) => x.kind === 'textFit')).toEqual([]);
  });
});

describe('checkBatchAsync', () => {
  it('5 000 lignes par tranches, avec progression, même résultat que la version synchrone', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(`ZB1-${String(i % 50).padStart(2, '0')}-${String(Math.floor(i / 50)).padStart(2, '0')}-A1`, i === 10 ? 'bad' : '2000000000015'));
    const d = emplacementDoc(rows);
    const progress: number[] = [];
    const t0 = Date.now();
    const list = await checkBatchAsync(d, { budgetMs: 5, onProgress: (n) => progress.push(n) });
    const ms = Date.now() - t0;
    expect(progress[progress.length - 1]).toBe(5000);
    expect(list).toEqual(checkBatch(d));
    expect(list!.filter((x) => x.kind === 'invalidCode').map((x) => x.row)).toEqual([10]);
    // même EAN partout : un doublon par ligne après la première (sauf la ligne invalide qui compte aussi)
    expect(list!.filter((x) => x.kind === 'duplicateCode' && x.elementId === 'ean').length).toBe(4998);
    expect(ms).toBeLessThan(15000);
  }, 20000);
  it('annulation', async () => {
    const d = emplacementDoc(Array.from({ length: 3000 }, (_, i) => row('E' + i, '2000000000015')));
    expect(await checkBatchAsync(d, { budgetMs: 0, isCancelled: () => true })).toBeNull();
  });
});

describe('codeError', () => {
  it('validation rapide ou encodage complet selon la symbologie', () => {
    expect(codeError('2000000000015', 'ean13')).toBeNull();
    expect(codeError('2000000000016', 'ean13')).toMatch(/clé/);
    expect(codeError('ZB1-01-01-A1', 'code128')).toBeNull();
    expect(codeError('(01)03012345678902', 'gs1-128')).toBeNull();
    expect(codeError('(01)03012345678901', 'gs1-128')).toMatch(/clé/);
  });
});

describe('elementLabel', () => {
  it('nom, sinon contenu abrégé', () => {
    const d = newDoc();
    expect(elementLabel({ ...makeText(d, 'Bonjour'), name: 'Titre' })).toBe('Titre');
    expect(elementLabel(makeText(d, '{{Produit}}'))).toBe('{{Produit}}');
    expect(elementLabel(undefined)).toBe('');
  });
});
