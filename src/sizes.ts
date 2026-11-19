export interface SizePreset {
  w: number;
  h: number;
  label?: string;
  round?: boolean;
}

/** Rouleaux thermiques courants (pouces, largeur × hauteur) */
export const ROLL_PRESETS: SizePreset[] = [
  [1, 1], [1, 2], [1, 3], [1.5, 1], [2, 1], [2, 2], [2, 3], [2, 4], [2.5, 1], [2.83, 2], [2.83, 4], [3, 1], [3, 2], [3, 3],
  [4, 1], [4, 1.5], [4, 2], [4, 3], [4, 4], [4, 6], [4, 8], [5, 1], [5, 2], [6, 2], [6, 4],
].map(([w, h]) => ({ w, h }));

const mm = (v: number) => Math.round((v / 25.4) * 1000) / 1000;

export interface BrandGroup {
  brand: string;
  sizes: SizePreset[];
}

export const BRAND_PRESETS: BrandGroup[] = [
  {
    brand: 'Zebra',
    sizes: [
      { w: 4, h: 6, label: 'Expédition 4×6' },
      { w: 4, h: 2, label: '4×2' },
      { w: 4, h: 3, label: '4×3' },
      { w: 3, h: 1, label: '3×1' },
      { w: 2.25, h: 1.25, label: '2,25×1,25' },
      { w: 2.25, h: 0.75, label: '2,25×0,75 (bijoux)' },
      { w: 2, h: 1, label: '2×1' },
      { w: 1.25, h: 1, label: '1,25×1' },
    ],
  },
  {
    brand: 'Rollo',
    sizes: [
      { w: 4, h: 6, label: 'Expédition 4×6' },
      { w: 4, h: 4, label: '4×4' },
      { w: 3, h: 2, label: '3×2' },
      { w: 2.25, h: 1.25, label: '2,25×1,25' },
      { w: 2, h: 1, label: '2×1' },
    ],
  },
  {
    brand: 'DYMO',
    sizes: [
      { w: 3.5, h: 1.125, label: '30252 Adresse' },
      { w: 2.25, h: 1.25, label: '30334 Multi-usage' },
      { w: mm(89), h: mm(28), label: '99010 Adresse standard' },
      { w: 2.125, h: 1, label: '30336 Petit multi-usage' },
      { w: 4, h: 2.3125, label: '30256 Expédition' },
      { w: 2, h: 0.75, label: '30330 Adresse retour' },
      { w: 4, h: 6, label: '1744907 Expédition XL' },
    ],
  },
  {
    brand: 'Brother',
    sizes: [
      { w: mm(90), h: mm(29), label: 'DK-11201 Adresse 29×90 mm' },
      { w: mm(62), h: mm(29), label: 'DK-11209 Petite adresse 29×62 mm' },
      { w: mm(62), h: mm(100), label: 'DK-22205 Continu 62 mm (100 mm)' },
      { w: mm(62), h: mm(100), label: 'DK-11202 Expédition 62×100 mm' },
      { w: mm(54), h: mm(17), label: 'DK-11204 Multi-usage 17×54 mm' },
      { w: mm(90), h: mm(38), label: 'DK-11208 Grande adresse 38×90 mm' },
      { w: mm(24), h: mm(24), label: 'DK-11218 Rond 24 mm', round: true },
    ],
  },
  {
    // formats palette / logistique (étiquettes GS1 transport : A6, A5, 4×6, 4×8…)
    brand: 'Logistique',
    sizes: [
      { w: mm(105), h: mm(148), label: 'A6 105×148 mm (palette SSCC)' },
      { w: mm(148), h: mm(210), label: 'A5 148×210 mm' },
      { w: 4, h: 6, label: '4×6" (101,6×152,4 mm)' },
      { w: 4, h: 8, label: '4×8" (101,6×203,2 mm)' },
      { w: mm(100), h: mm(150), label: '100×150 mm' },
      { w: mm(100), h: mm(210), label: '100×210 mm' },
    ],
  },
  {
    brand: 'Ronds',
    sizes: [
      { w: 1.5, h: 1.5, label: 'Rond 1,5"', round: true },
      { w: 2, h: 2, label: 'Rond 2"', round: true },
      { w: 2.5, h: 2.5, label: 'Rond 2,5" (couvercle bocal)', round: true },
      { w: 3, h: 3, label: 'Rond 3"', round: true },
    ],
  },
];

/** Planches A4 / US Letter (dimensions approximatives, compatibles Avery) */
export interface SheetDef {
  id: string;
  label: string;
  pageW: number;
  pageH: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  left: number;
  top: number;
  hgap: number;
  vgap: number;
  round?: boolean;
}

export const SHEETS: SheetDef[] = [
  { id: '5160', label: 'Avery 5160 — Adresse 1" × 2⅝" (30/planche)', pageW: 8.5, pageH: 11, w: 2.625, h: 1, cols: 3, rows: 10, left: 0.1875, top: 0.5, hgap: 0.125, vgap: 0 },
  { id: '5161', label: 'Avery 5161 — Adresse 1" × 4" (20/planche)', pageW: 8.5, pageH: 11, w: 4, h: 1, cols: 2, rows: 10, left: 0.15625, top: 0.5, hgap: 0.1875, vgap: 0 },
  { id: '5162', label: 'Avery 5162 — Adresse 1⅓" × 4" (14/planche)', pageW: 8.5, pageH: 11, w: 4, h: 1.333, cols: 2, rows: 7, left: 0.15625, top: 0.8333, hgap: 0.1875, vgap: 0 },
  { id: '5163', label: 'Avery 5163 — Expédition 2" × 4" (10/planche)', pageW: 8.5, pageH: 11, w: 4, h: 2, cols: 2, rows: 5, left: 0.15625, top: 0.5, hgap: 0.1875, vgap: 0 },
  { id: '5164', label: 'Avery 5164 — Expédition 3⅓" × 4" (6/planche)', pageW: 8.5, pageH: 11, w: 4, h: 3.333, cols: 2, rows: 3, left: 0.15625, top: 0.5, hgap: 0.1875, vgap: 0 },
  { id: '5167', label: 'Avery 5167 — Retour ½" × 1¾" (80/planche)', pageW: 8.5, pageH: 11, w: 1.75, h: 0.5, cols: 4, rows: 20, left: 0.28125, top: 0.5, hgap: 0.3125, vgap: 0 },
  { id: '5126', label: 'Avery 5126 — Demi-page 5½" × 8½" (2/planche)', pageW: 8.5, pageH: 11, w: 8.5, h: 5.5, cols: 1, rows: 2, left: 0, top: 0, hgap: 0, vgap: 0 },
  { id: '22806', label: 'Avery 22806 — Carré 2" × 2" (12/planche)', pageW: 8.5, pageH: 11, w: 2, h: 2, cols: 3, rows: 4, left: 0.625, top: 0.625, hgap: 0.625, vgap: 0.583 },
  { id: '22807', label: 'Avery 22807 — Rond 2" (12/planche)', pageW: 8.5, pageH: 11, w: 2, h: 2, cols: 3, rows: 4, left: 0.625, top: 0.625, hgap: 0.625, vgap: 0.583, round: true },
  { id: '8293', label: 'Avery 8293 — Rond 1½" (20/planche)', pageW: 8.5, pageH: 11, w: 1.5, h: 1.5, cols: 4, rows: 5, left: 0.5, top: 0.75, hgap: 0.5, vgap: 0.5, round: true },
  { id: 'L7160', label: 'A4 L7160 — 63,5 × 38,1 mm (21/planche)', pageW: mm(210), pageH: mm(297), w: mm(63.5), h: mm(38.1), cols: 3, rows: 7, left: mm(7.2), top: mm(15.1), hgap: mm(2.5), vgap: 0 },
  { id: 'L7163', label: 'A4 L7163 — 99,1 × 38,1 mm (14/planche)', pageW: mm(210), pageH: mm(297), w: mm(99.1), h: mm(38.1), cols: 2, rows: 7, left: mm(4.6), top: mm(15.1), hgap: mm(2.5), vgap: 0 },
];

export const sheetById = (id?: string) => SHEETS.find((s) => s.id === id);

export function sizeLabel(w: number, h: number) {
  const f = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');
  return `${f(w)}" × ${f(h)}"`;
}
