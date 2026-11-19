import type { LabelDoc, LabelElement, TextEl, BarcodeEl, ShapeEl, QrEl, TableEl, Symbology, Align } from './types';
import { newDoc } from './elements';
import { uid } from './util';
import { gs1Check } from './render/codes';

type TOpts = Partial<TextEl>;
const NL = String.fromCharCode(10);
/** Texte de modèle : par défaut la police se réduit pour tenir (valeurs de données variables) */
const T = (text: string, x: number, y: number, w: number, fontSize: number, o: TOpts = {}): TextEl => ({
  id: uid(),
  type: 'text',
  x,
  y,
  w,
  h: text.split(NL).length * fontSize * (o.lineHeight ?? 1.1) + 2,
  fit: text.includes(NL) ? 'wrapShrink' : 'shrinkLine',
  minFontSize: Math.max(6, Math.round(fontSize * 0.35)),
  ellipsis: true,
  rotation: 0,
  text,
  fontFamily: 'Arial',
  fontSize,
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.1,
  color: '#000000',
  invert: false,
  ...o,
});
const B = (value: string, x: number, y: number, w: number, h: number, symbology: Symbology = 'code128', o: Partial<BarcodeEl> = {}): BarcodeEl => ({
  id: uid(),
  type: 'barcode',
  x,
  y,
  w,
  h,
  rotation: 0,
  value,
  symbology,
  showText: symbology !== 'datamatrix',
  fontSize: 22,
  color: '#000000',
  ...o,
});
const S = (kind: string, x: number, y: number, w: number, h: number, o: Partial<ShapeEl> = {}): ShapeEl => ({
  id: uid(),
  type: 'shape',
  kind,
  x,
  y,
  w,
  h,
  rotation: 0,
  fill: kind === 'line' || kind === 'vline' ? '#000000' : 'none',
  stroke: kind === 'line' || kind === 'vline' ? 'none' : '#000000',
  strokeWidth: 4,
  radius: 0,
  ...o,
});
const Q = (value: string, x: number, y: number, side: number, o: Partial<QrEl> = {}): QrEl => ({
  id: uid(),
  type: 'qr',
  qrType: 'text',
  x,
  y,
  w: side,
  h: side,
  rotation: 0,
  value,
  level: 'M',
  color: '#000000',
  ...o,
});
const TB = (cells: string[][], x: number, y: number, w: number, h: number, o: Partial<TableEl> = {}): TableEl => ({
  id: uid(),
  type: 'table',
  x,
  y,
  w,
  h,
  rotation: 0,
  rows: cells.length,
  cols: cells[0].length,
  cells,
  fontSize: 20,
  fontFamily: 'Arial',
  strokeWidth: 2,
  headerRow: true,
  align: 'left' as Align,
  colWidths: Array(cells[0].length).fill(1),
  rowHeights: Array(cells.length).fill(1),
  ...o,
});

export type TemplateCategory = 'entrepot' | 'expedition' | 'produit' | 'qr' | 'alimentaire' | 'prix' | 'adresse' | 'cable' | 'bijoux';

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'entrepot', label: 'Entrepôt' },
  { id: 'expedition', label: 'Expédition' },
  { id: 'produit', label: 'Produit' },
  { id: 'qr', label: 'QR' },
  { id: 'alimentaire', label: 'Alimentaire' },
  { id: 'prix', label: 'Prix' },
  { id: 'adresse', label: 'Adresse' },
  { id: 'cable', label: 'Câbles' },
  { id: 'bijoux', label: 'Bijoux' },
];

export interface Template {
  id: string;
  name: string;
  categories: TemplateCategory[];
  brands: string[];
  build: () => LabelDoc;
}

const doc = (name: string, w: number, h: number, elements: LabelElement[], extra: Partial<LabelDoc> = {}) => newDoc({ name, widthIn: w, heightIn: h, elements, ...extra });

export function demoDoc(): LabelDoc {
  return doc('Étiquette inventaire entrepôt', 4, 2, [
    S('rect', 589, 0, 223, 171, { fill: '#000000', stroke: 'none', name: 'Bloc QTÉ' }),
    T('PART #', 28, 18, 300, 22, { bold: true }),
    T('SKU-00045-AX', 26, 46, 560, 72, { bold: true }),
    T('Boulon hexagonal inox 1/4" x 1"', 28, 140, 540, 30),
    B('SKU00045AX', 22, 186, 540, 192, 'code128', { fontSize: 24 }),
    S('vline', 563, 196, 5, 188),
    T('QTÉ', 607, 18, 190, 22, { bold: true, color: '#ffffff' }),
    T('240', 604, 46, 200, 96, { bold: true, color: '#ffffff' }),
    T('EMPLACEMENT', 589, 192, 220, 20, { bold: true }),
    T('A-12-03', 588, 214, 220, 44, { bold: true }),
    T('CASIER', 589, 290, 220, 20, { bold: true }),
    T('B-07', 588, 312, 220, 44, { bold: true }),
  ]);
}

export const TEMPLATES: Template[] = [
  { id: 'inventaire', name: 'Inventaire entrepôt 4×2', categories: ['entrepot'], brands: ['Zebra', 'Rollo'], build: demoDoc },
  {
    id: 'expedition',
    name: 'Expédition 4×6',
    categories: ['expedition', 'adresse'],
    brands: ['Zebra', 'Rollo', 'DYMO'],
    build: () =>
      doc('Étiquette expédition 4×6', 4, 6, [
        T('EXPÉDITEUR', 28, 24, 360, 20, { bold: true }),
        T('Atelier Martin\n12 rue des Lilas\n69003 Lyon, FRANCE', 28, 48, 420, 24, { lineHeight: 1.2 }),
        S('rect', 600, 24, 184, 120, { strokeWidth: 4 }),
        T('PRIORITAIRE', 606, 64, 172, 26, { bold: true, align: 'center' }),
        S('line', 0, 180, 812, 6),
        T('DESTINATAIRE', 28, 204, 360, 22, { bold: true }),
        T('{{nom}}\n{{adresse}}\n{{cp}} {{ville}}', 28, 236, 756, 44, { bold: true, lineHeight: 1.15 }),
        S('line', 0, 470, 812, 6),
        T('N° DE SUIVI', 28, 494, 360, 22, { bold: true }),
        B('1Z999AA10123456784', 40, 528, 732, 260, 'code128', { fontSize: 28 }),
        S('line', 0, 840, 812, 6),
        T('Poids : 2,4 kg', 28, 866, 360, 34, { bold: true }),
        T('Colis 1/1', 430, 866, 354, 34, { bold: true, align: 'right' }),
        B('(00)00614141000000001', 70, 940, 672, 220, 'sscc18', { fontSize: 26 }),
      ]),
  },
  {
    id: 'produit',
    name: 'Produit EAN-13 2×2',
    categories: ['produit', 'prix'],
    brands: ['Zebra', 'Rollo'],
    build: () =>
      doc('Étiquette produit', 2, 2, [
        T('Miel de lavande', 16, 16, 374, 34, { bold: true, align: 'center' }),
        T('Pot 250 g — Récolte 2026', 16, 58, 374, 22, { align: 'center' }),
        T('8,90 €', 16, 92, 374, 64, { bold: true, align: 'center' }),
        B('590123412345', 40, 186, 326, 190, 'ean13', { fontSize: 24 }),
      ]),
  },
  {
    id: 'qr22',
    name: 'Étiquette QR 2×2',
    categories: ['qr'],
    brands: ['Zebra', 'Rollo'],
    build: () =>
      doc('Étiquette QR', 2, 2, [
        Q('https://exemple.fr/produit/42', 78, 20, 250),
        T('Scannez-moi', 16, 290, 374, 32, { bold: true, align: 'center' }),
        T('exemple.fr/produit/42', 16, 334, 374, 22, { align: 'center' }),
      ]),
  },
  {
    id: 'nutrition',
    name: 'Valeurs nutritionnelles 2×3',
    categories: ['alimentaire'],
    brands: ['Zebra'],
    build: () =>
      doc('Valeurs nutritionnelles', 2, 3, [
        T('Valeurs nutritionnelles', 12, 12, 382, 30, { bold: true }),
        T('pour 100 g', 12, 48, 382, 20),
        S('line', 12, 76, 382, 8),
        TB(
          [
            ['Énergie', '1 520 kJ / 360 kcal'],
            ['Matières grasses', '12 g'],
            ['dont saturés', '3,1 g'],
            ['Glucides', '54 g'],
            ['dont sucres', '22 g'],
            ['Fibres', '4,5 g'],
            ['Protéines', '8,2 g'],
            ['Sel', '0,4 g'],
          ],
          12,
          92,
          382,
          400,
          { headerRow: false, fontSize: 19, strokeWidth: 2, colWidths: [1.1, 1] },
        ),
        T('À consommer de préférence avant le {{date+180}}', 12, 512, 382, 18),
        T('Lot {{numero}}', 12, 560, 382, 18, { bold: true }),
      ]),
  },
  {
    id: 'bijou',
    name: 'Étiquette bijou 1,5×1',
    categories: ['bijoux', 'prix'],
    brands: ['Zebra'],
    build: () =>
      doc('Étiquette bijou', 1.5, 1, [
        T('Bague argent 925', 8, 8, 288, 24, { bold: true, align: 'center' }),
        T('49,00 €', 8, 38, 288, 46, { bold: true, align: 'center' }),
        B('BJ-2041', 40, 112, 224, 80, 'code128', { fontSize: 16 }),
      ]),
  },
  {
    id: 'etagere',
    name: 'Étiquette d’étagère 3×1',
    categories: ['prix', 'entrepot'],
    brands: ['Zebra', 'Rollo'],
    build: () =>
      doc('Étiquette étagère', 3, 1, [
        T('Café grains Éthiopie 1 kg', 12, 10, 380, 28, { bold: true }),
        T('Réf. CAF-ETH-1000', 12, 46, 380, 20),
        B('CAFETH1000', 12, 80, 360, 110, 'code128', { fontSize: 18 }),
        S('rect', 404, 10, 194, 183, { fill: '#000000', stroke: 'none' }),
        T('18,50 €', 404, 60, 194, 50, { bold: true, align: 'center', color: '#ffffff' }),
        T('18,50 €/kg', 404, 128, 194, 20, { align: 'center', color: '#ffffff' }),
      ]),
  },
  {
    id: 'cable',
    name: 'Étiquette câble 2×1',
    categories: ['cable', 'entrepot'],
    brands: ['Zebra', 'Brother'],
    build: () =>
      doc('Étiquette câble', 2, 1, [
        T('ID', 10, 8, 80, 18, { bold: true }),
        T('NET-{{numero}}', 10, 28, 386, 40, { bold: true }),
        S('line', 10, 76, 386, 3),
        T('DE', 10, 88, 60, 18, { bold: true }),
        T('Baie A / Port 12', 70, 86, 326, 24),
        T('VERS', 10, 128, 60, 18, { bold: true }),
        T('Bureau 2.14 / Prise 3', 70, 126, 326, 24),
        B('NET-{{numero}}', 10, 160, 386, 36, 'code128', { showText: false }),
      ], { numbering: { start: 1, step: 1, padding: 4, prefix: '', suffix: '', count: 24 } }),
  },
  {
    id: 'bocal',
    name: 'Couvercle de bocal (rond)',
    categories: ['alimentaire'],
    brands: ['Ronds'],
    build: () =>
      doc('Couvercle de bocal', 2.5, 2.5, [
        S('circle', 8, 8, 491, 491, { strokeWidth: 4 }),
        T('CONFITURE MAISON', 30, 30, 447, 447, { bold: true, curve: 'circle', fontSize: 38, h: 447 }),
        T('Fraise\n& rhubarbe', 100, 190, 307, 48, { bold: true, align: 'center', lineHeight: 1.05 }),
        T('Mis en pot le {{date}}', 100, 320, 307, 22, { align: 'center' }),
      ], { round: true }),
  },
  {
    id: 'cupcake',
    name: 'Topper cupcake (rond)',
    categories: ['alimentaire'],
    brands: ['Ronds'],
    build: () =>
      doc('Topper cupcake', 2, 2, [
        S('circle', 6, 6, 394, 394, { strokeWidth: 6 }),
        S('heart', 158, 70, 90, 90, { fill: '#000000', stroke: 'none' }),
        T('JOYEUX', 40, 40, 326, 160, { bold: true, curve: 'arcTop', bend: 40, fontSize: 40, h: 160 }),
        T('Anniversaire', 30, 190, 346, 50, { bold: true, align: 'center', italic: true }),
        T('Léa · 6 ans', 30, 260, 346, 30, { align: 'center' }),
      ], { round: true }),
  },
  {
    id: 'asset',
    name: 'Étiquette d’inventaire (QR) 2×1',
    categories: ['qr', 'entrepot'],
    brands: ['Zebra', 'Brother'],
    build: () =>
      doc('Étiquette matériel', 2, 1, [
        Q('https://parc.exemple.fr/asset/{{numero}}', 12, 12, 180),
        T('PROPRIÉTÉ DE', 204, 14, 196, 18, { bold: true }),
        T('ACME SAS', 204, 36, 196, 30, { bold: true }),
        T('N° {{numero}}', 204, 90, 196, 34, { bold: true }),
        T('Ne pas retirer', 204, 150, 196, 18, { italic: true }),
      ], { numbering: { start: 1, step: 1, padding: 5, prefix: 'PC-', suffix: '', count: 50 } }),
  },
  {
    id: 'adresse',
    name: 'Adresse DYMO 30252',
    categories: ['adresse'],
    brands: ['DYMO'],
    build: () =>
      doc('Étiquette adresse', 3.5, 1.125, [
        T('{{nom}}\n{{adresse}}\n{{cp}} {{ville}}', 30, 26, 650, 52, { lineHeight: 1.15, fit: 'wrapShrink', h: 176, vAlign: 'middle' }),
      ]),
  },
  {
    id: 'prix',
    name: 'Étiquette prix 2×1',
    categories: ['prix'],
    brands: ['Zebra', 'Rollo'],
    build: () =>
      doc('Étiquette prix', 2, 1, [
        S('burst', 8, 8, 120, 120, { fill: '#000000', stroke: 'none' }),
        T('-20%', 8, 50, 120, 32, { bold: true, align: 'center', color: '#ffffff' }),
        T('T-shirt bio', 136, 12, 262, 28, { bold: true }),
        T('19,90 €', 136, 48, 262, 62, { bold: true }),
        B('370012345678', 136, 124, 262, 76, 'ean13', { showText: false }),
      ]),
  },
  {
    id: 'alimentaire',
    name: 'Étiquette produit alimentaire 4×3',
    categories: ['alimentaire', 'produit'],
    brands: ['Zebra', 'Rollo'],
    build: () =>
      doc('Étiquette produit alimentaire', 4, 3, [
        T('Confiture extra de fraises', 20, 16, 772, 44, { bold: true, name: 'Dénomination' }),
        T(
          'Ingrédients : fraises 55 %, sucre de canne, jus de citron, gélifiant : pectine de fruits. Peut contenir des traces de fruits à coque et de lait. Préparée avec 55 g de fruits pour 100 g.',
          20,
          74,
          772,
          24,
          { fit: 'wrapShrink', h: 172, vAlign: 'top', boldAllergens: true, name: 'Ingrédients' },
        ),
        S('line', 20, 254, 772, 3),
        T('Poids net : 370 g', 20, 270, 430, 32, { bold: true, name: 'Poids net' }),
        T('Lot : {{?Lot}}', 20, 318, 430, 26, { name: 'Lot' }),
        T('À consommer jusqu’au {{aujourdhui|jours:+21|date:JJ/MM/AAAA}}', 20, 356, 430, 24, { bold: true, name: 'DLC' }),
        T('À conserver au réfrigérateur après ouverture et à consommer dans les 3 semaines.', 20, 396, 430, 20, { fit: 'wrapShrink', h: 70, vAlign: 'top', name: 'Conservation' }),
        B('376012345678', 470, 268, 322, 200, 'ean13', { fontSize: 24, name: 'EAN-13' }),
        S('line', 20, 548, 772, 2),
        T('Atelier Exemple — 12 rue des Lilas, 69003 Lyon — FR', 20, 562, 772, 20, { align: 'center', name: 'Fabricant' }),
      ]),
  },
  {
    id: 'gs1-colis',
    name: 'Colis / palette GS1-128 4×6',
    categories: ['expedition', 'entrepot', 'alimentaire'],
    brands: ['Zebra', 'Rollo'],
    build: () => {
      const gtin = '0376012345000';
      const g14 = gtin + gs1Check(gtin);
      return doc('Étiquette logistique GS1-128', 4, 6, [
        T('Atelier Exemple', 24, 20, 764, 40, { bold: true, name: 'Expéditeur' }),
        T('12 rue des Lilas — 69003 Lyon — FRANCE', 24, 66, 764, 24),
        S('line', 0, 106, 812, 5),
        T('COLIS N°', 24, 122, 300, 22, { bold: true }),
        T('{{numero}}', 24, 148, 764, 34, { bold: true, name: 'Numéro de colis' }),
        T('CONTENU', 24, 198, 360, 20, { bold: true }),
        T(g14, 24, 222, 360, 30, { name: 'GTIN' }),
        T('QUANTITÉ', 420, 198, 360, 20, { bold: true }),
        T('24', 420, 222, 360, 30),
        T('LOT', 24, 268, 360, 20, { bold: true }),
        T('{{?Lot}}', 24, 292, 360, 30),
        T('DLC', 420, 268, 360, 20, { bold: true }),
        T('{{aujourdhui|jours:+21|date:JJ/MM/AAAA}}', 420, 292, 360, 30),
        S('line', 0, 344, 812, 5),
        B(`(02)${g14}(17){{aujourdhui|jours:+21|date:AAMMJJ}}(37)24`, 40, 372, 732, 230, 'gs1-128', { fontSize: 24, name: 'GS1-128 contenu' }),
        B('(10){{?Lot}}', 40, 640, 732, 200, 'gs1-128', { fontSize: 24, name: 'GS1-128 lot' }),
        B('0376012340000000{{numero}}', 40, 890, 732, 260, 'sscc18', { fontSize: 26, name: 'SSCC' }),
      ], { numbering: { start: 1, step: 1, padding: 0, prefix: '', suffix: '', count: 1 } });
    },
  },
];
