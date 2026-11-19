import { describe, it, expect } from 'vitest';
import { generateLabelZpl, needsRaster, BX_ESCAPE } from './generate';
import { parseZpl, lintZpl } from './parse';
import { gs1ElementsToStream, gs1StreamToElements } from './code128';
import { encodeBarcode, pdf417Shape, pdf417Level, type MatrixCode, type LinearCode } from '../render/codes';
import { newDoc, makeBarcode } from '../elements';
import type { LabelDoc, BarcodeEl, Symbology } from '../types';

function docWith(sym: Symbology, value: string, extra: Partial<BarcodeEl> = {}, partial: Partial<LabelDoc> = {}) {
  const d = newDoc(partial);
  d.elements = [{ ...makeBarcode(d, sym, value), x: 20, y: 30, ...extra }];
  return d;
}
const errors = (z: string) => lintZpl(z).filter((x) => x.level === 'error');

describe('flux GS1 (FNC1)', () => {
  it('(AI)… → flux : FNC1 seulement après un AI variable qui n’est pas le dernier', () => {
    expect(gs1ElementsToStream('(01)09501101530003(17)261231(10)ABC')).toBe('010950110153000317261231' + '10ABC');
    expect(gs1ElementsToStream('(10)ABC(17)261231')).toBe('10ABC\x1d17261231');
    expect(gs1ElementsToStream('(01)09501101530003(10)AB(21)S1')).toBe('0109501101530003' + '10AB\x1d21S1');
    expect(gs1ElementsToStream('pas GS1')).toBeNull();
  });
  it('aller-retour flux ↔ (AI)…', () => {
    const s = '(01)09501101530003(10)AB(21)S1';
    expect(gs1StreamToElements(gs1ElementsToStream(s)!)).toBe(s);
  });
});

describe('PDF417 → ^B7', () => {
  it('colonnes, niveau de sécurité et hauteur de rangée identiques à l’écran', async () => {
    const value = 'MyLabelZebra PDF417';
    const doc = docWith('pdf417', value, { w: 400, h: 200 });
    const enc = encodeBarcode(value, 'pdf417') as MatrixCode;
    expect(enc.kind).toBe('matrix');
    const { columns, rows } = pdf417Shape(enc);
    expect((enc.cols - 69) % 17).toBe(0);
    expect(rows).toBeGreaterThanOrEqual(3);
    const z = generateLabelZpl(doc);
    expect(needsRaster(doc.elements[0], { doc, index: 0, resolve: true })).toBe(false);
    const m = Math.floor(Math.min(400 / enc.cols, 200 / enc.rows));
    expect(z).toContain(`^FO20,30^BY${m}^B7N,3,${pdf417Level(value)},${columns},,N^FH^FD${value}^FS`);
    expect(z).not.toContain('^GFA');
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    const op = lab.ops.find((o) => o.k === 'barcode');
    expect(op).toMatchObject({ sym: 'pdf417', data: value, module: m, height: 3 });
  });
});

describe('Aztec → ^BO', () => {
  it('module = grossissement, correction minimale 23 %', async () => {
    const doc = docWith('azteccode', 'Hello Aztec', { w: 100, h: 100 });
    const enc = encodeBarcode('Hello Aztec', 'azteccode') as MatrixCode;
    const m = Math.floor(100 / enc.cols);
    const z = generateLabelZpl(doc);
    expect(z).toContain(`^FO20,30^BON,${m},N,23,N^FH^FDHello Aztec^FS`);
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    expect(lab.ops.find((o) => o.k === 'barcode')).toMatchObject({ sym: 'azteccode', data: 'Hello Aztec', module: m });
  });

  it('module > 10 points (grossissement ^BO max.) → image ^GFA', () => {
    const doc = docWith('azteccode', 'A', { w: 380, h: 380 });
    expect(needsRaster(doc.elements[0], { doc, index: 0, resolve: true })).toBe(true);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^BO');
    expect(z).toContain('^GFA');
  });
});

describe('GS1 DataMatrix → ^BX avec FNC1', () => {
  const v = '(01)09501101530003(10)ABC123(17)261231';
  it('FNC1 de tête et séparateur après l’AI variable, caractère d’échappement explicite', () => {
    const doc = docWith('gs1datamatrix', v);
    const z = generateLabelZpl(doc);
    const e = BX_ESCAPE;
    // ordre saisi conservé ; (10) variable suivi d'un autre AI → FNC1
    expect(z).toMatch(new RegExp(`\\^BXN,\\d+,200,0,0,1,${e}\\^FH\\^FD${e}10109501101530003` + `10ABC123${e}117261231\\^FS`));
    expect(errors(z)).toEqual([]);
  });

  it('relu par la visionneuse comme GS1 DataMatrix « (AI)… »', async () => {
    const z = generateLabelZpl(docWith('gs1datamatrix', v));
    const [lab] = await parseZpl(z);
    expect(lab.ops.find((o) => o.k === 'barcode')).toMatchObject({ sym: 'gs1datamatrix', data: v });
  });

  it('écran : symbole carré encodé', () => {
    const enc = encodeBarcode(v, 'gs1datamatrix') as MatrixCode;
    expect(enc.error).toBeUndefined();
    expect(enc.kind).toBe('matrix');
    expect(enc.cols).toBe(enc.rows);
  });

  it('GTIN à clé fausse → erreur GS1 lisible, aucun code émis', () => {
    const enc = encodeBarcode('(01)09501101530004', 'gs1datamatrix');
    expect(enc.error).toMatch(/clé de contrôle/);
    expect(generateLabelZpl(docWith('gs1datamatrix', '(01)09501101530004'))).not.toMatch(/\^BX|\^GFA/);
  });
});

describe('QR GS1', () => {
  it('QR GS1 Digital Link → ^BQ natif (URL ordinaire), correction M', async () => {
    const url = 'https://id.gs1.org/01/09501101530003/10/ABC123?17=261231';
    const doc = docWith('gs1dlqrcode', url, { w: 140, h: 140 });
    const z = generateLabelZpl(doc);
    expect(z).toMatch(/\^FO20,30\^BQN,2,\d+\^FH\^FDMA,https:\/\/id\.gs1\.org\/01\/09501101530003\/10\/ABC123\?17=261231\^FS/);
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    expect(lab.ops.find((o) => o.k === 'qr')).toMatchObject({ data: url, level: 'M' });
  });

  it('Digital Link invalide (clé GTIN) → erreur', () => {
    expect(encodeBarcode('https://id.gs1.org/01/09501101530004', 'gs1dlqrcode').error).toMatch(/clé/);
    expect(encodeBarcode('https://exemple.fr/produit', 'gs1dlqrcode').error).toBeDefined();
  });

  it('GS1 QR Code (FNC1 non documenté pour ^BQ) → image ^GFA', () => {
    const doc = docWith('gs1qrcode', '(01)09501101530003(10)ABC');
    expect(needsRaster(doc.elements[0])).toBe(true);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^BQ');
    expect(z).toContain('^GFA');
    expect(errors(z)).toEqual([]);
  });
});

describe('GS1 DataBar → ^GFA', () => {
  it('omnidirectionnel : GTIN complété et clé calculée ; texte lisible (01)…', () => {
    const enc = encodeBarcode('0950110153000', 'databaromni') as LinearCode;
    expect(enc.kind).toBe('linear');
    expect(enc.text).toBe('(01)09501101530003');
    expect(encodeBarcode('(01)09501101530004', 'databaromni').error).toMatch(/clé/);
  });

  it('empilé omnidirectionnel et expanded encodés', () => {
    expect((encodeBarcode('09501101530003', 'databarstackedomni') as MatrixCode).kind).toBe('matrix');
    const x = encodeBarcode('(01)09501101530003(3103)001250', 'databarexpanded') as LinearCode;
    expect(x.kind).toBe('linear');
  });

  it('jamais en ^BR (format de données et hauteur non documentés) : image à la place du code', () => {
    for (const [s, v] of [
      ['databaromni', '(01)09501101530003'],
      ['databarstackedomni', '(01)09501101530003'],
      ['databarexpanded', '(01)09501101530003(10)AB'],
    ] as [Symbology, string][]) {
      const z = generateLabelZpl(docWith(s, v));
      expect(z).not.toContain('^BR');
      expect(z).toMatch(/\^FO\d+,\d+\^GFA,/);
      expect(errors(z)).toEqual([]);
    }
  });
});
