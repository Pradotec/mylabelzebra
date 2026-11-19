/**
 * Bibliothèque de formes et de symboles (dessins originaux).
 * - formes géométriques : chemins construits dans la boîte (w × h) de l'élément ;
 * - symboles (entretien textile, sécurité, bougies) : chemins SVG dans un carré 100×100.
 */
export type ShapeCategory = 'forme' | 'entretien' | 'securite' | 'bougie';

type Pt = [number, number];

export interface GeoShape {
  id: string;
  label: string;
  keywords: string;
  category: 'forme';
  /** chemin dans [x,y,w,h] */
  path?: (x: number, y: number, w: number, h: number, radius: number) => Path2D;
  /** forme pleine (barre) : rendue comme un rectangle rempli */
  bar?: boolean;
  square?: boolean;
  defaults?: { w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number };
}

export interface SymbolPart {
  d?: string;
  mode: 'fill' | 'stroke' | 'knock';
  text?: string;
  tx?: number;
  ty?: number;
  size?: number;
}
export interface SymbolShape {
  id: string;
  label: string;
  keywords: string;
  category: Exclude<ShapeCategory, 'forme'>;
  parts: SymbolPart[];
}

export type ShapeDef = GeoShape | SymbolShape;

const poly = (pts: Pt[]) => (x: number, y: number, w: number, h: number) => {
  const p = new Path2D();
  pts.forEach(([px, py], i) => (i ? p.lineTo(x + px * w, y + py * h) : p.moveTo(x + px * w, y + py * h)));
  p.closePath();
  return p;
};

function regular(n: number, rot = -Math.PI / 2): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as Pt;
  });
}
function star(n: number, inner: number): Pt[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 0.5;
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as Pt;
  });
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  const p = new Path2D();
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r <= 0) {
    p.rect(x, y, w, h);
    return p;
  }
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

export const GEO_SHAPES: GeoShape[] = [
  { id: 'rect', label: 'Rectangle', keywords: 'carré rectangle cadre bordure', category: 'forme', path: (x, y, w, h) => roundRectPath(x, y, w, h, 0) },
  {
    id: 'roundrect',
    label: 'Rectangle arrondi',
    keywords: 'arrondi coins rectangle',
    category: 'forme',
    path: (x, y, w, h, r) => roundRectPath(x, y, w, h, r || Math.min(w, h) * 0.2),
  },
  {
    id: 'circle',
    label: 'Cercle',
    keywords: 'rond cercle disque',
    category: 'forme',
    square: true,
    path: (x, y, w, h) => {
      const p = new Path2D();
      p.ellipse(x + w / 2, y + h / 2, Math.max(0.1, w / 2), Math.max(0.1, h / 2), 0, 0, Math.PI * 2);
      return p;
    },
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    keywords: 'ovale ellipse',
    category: 'forme',
    defaults: { w: 200, h: 120 },
    path: (x, y, w, h) => {
      const p = new Path2D();
      p.ellipse(x + w / 2, y + h / 2, Math.max(0.1, w / 2), Math.max(0.1, h / 2), 0, 0, Math.PI * 2);
      return p;
    },
  },
  { id: 'line', label: 'Ligne horizontale', keywords: 'ligne trait séparateur horizontal', category: 'forme', bar: true, defaults: { w: 300, h: 4 } },
  { id: 'vline', label: 'Ligne verticale', keywords: 'ligne trait séparateur vertical', category: 'forme', bar: true, defaults: { w: 4, h: 200 } },
  { id: 'arrow', label: 'Flèche', keywords: 'flèche direction droite', category: 'forme', defaults: { w: 200, h: 100 }, path: poly([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]) },
  {
    id: 'darrow',
    label: 'Double flèche',
    keywords: 'flèche double',
    category: 'forme',
    defaults: { w: 240, h: 100 },
    path: poly([[0, 0.5], [0.25, 0], [0.25, 0.3], [0.75, 0.3], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.7], [0.25, 0.7], [0.25, 1]]),
  },
  { id: 'triangle', label: 'Triangle', keywords: 'triangle', category: 'forme', path: poly([[0.5, 0], [1, 1], [0, 1]]) },
  { id: 'rtriangle', label: 'Triangle rectangle', keywords: 'triangle rectangle angle', category: 'forme', path: poly([[0, 0], [1, 1], [0, 1]]) },
  { id: 'diamond', label: 'Losange', keywords: 'losange diamant', category: 'forme', path: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) },
  { id: 'pentagon', label: 'Pentagone', keywords: 'pentagone 5', category: 'forme', square: true, path: poly(regular(5)) },
  { id: 'hexagon', label: 'Hexagone', keywords: 'hexagone 6', category: 'forme', square: true, path: poly(regular(6, 0)) },
  { id: 'octagon', label: 'Octogone', keywords: 'octogone stop 8', category: 'forme', square: true, path: poly(regular(8, Math.PI / 8)) },
  { id: 'star', label: 'Étoile', keywords: 'étoile star', category: 'forme', square: true, path: poly(star(5, 0.2)) },
  { id: 'burst', label: 'Explosion', keywords: 'promo badge éclat soleil', category: 'forme', square: true, path: poly(star(12, 0.38)) },
  {
    id: 'heart',
    label: 'Cœur',
    keywords: 'coeur amour',
    category: 'forme',
    square: true,
    path: (x, y, w, h) => {
      const p = new Path2D();
      const X = (v: number) => x + v * w;
      const Y = (v: number) => y + v * h;
      p.moveTo(X(0.5), Y(0.95));
      p.bezierCurveTo(X(0.1), Y(0.65), X(0), Y(0.45), X(0), Y(0.3));
      p.bezierCurveTo(X(0), Y(0.1), X(0.2), Y(0.02), X(0.3), Y(0.02));
      p.bezierCurveTo(X(0.42), Y(0.02), X(0.5), Y(0.12), X(0.5), Y(0.2));
      p.bezierCurveTo(X(0.5), Y(0.12), X(0.58), Y(0.02), X(0.7), Y(0.02));
      p.bezierCurveTo(X(0.8), Y(0.02), X(1), Y(0.1), X(1), Y(0.3));
      p.bezierCurveTo(X(1), Y(0.45), X(0.9), Y(0.65), X(0.5), Y(0.95));
      p.closePath();
      return p;
    },
  },
  {
    id: 'plus',
    label: 'Croix',
    keywords: 'plus croix ajout',
    category: 'forme',
    square: true,
    path: poly([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]),
  },
  { id: 'chevron', label: 'Chevron', keywords: 'chevron flèche', category: 'forme', defaults: { w: 200, h: 100 }, path: poly([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]) },
  { id: 'parallelogram', label: 'Parallélogramme', keywords: 'parallélogramme', category: 'forme', defaults: { w: 220, h: 100 }, path: poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]) },
  { id: 'trapezoid', label: 'Trapèze', keywords: 'trapèze', category: 'forme', defaults: { w: 220, h: 110 }, path: poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]) },
  {
    id: 'bubble',
    label: 'Bulle',
    keywords: 'bulle dialogue commentaire',
    category: 'forme',
    defaults: { w: 220, h: 140 },
    path: (x, y, w, h) => {
      const p = new Path2D();
      const r = Math.min(w, h) * 0.15;
      const bh = h * 0.78;
      p.moveTo(x + r, y);
      p.arcTo(x + w, y, x + w, y + bh, r);
      p.arcTo(x + w, y + bh, x, y + bh, r);
      p.lineTo(x + w * 0.38, y + bh);
      p.lineTo(x + w * 0.2, y + h);
      p.lineTo(x + w * 0.24, y + bh);
      p.arcTo(x, y + bh, x, y, r);
      p.arcTo(x, y, x + w, y, r);
      p.closePath();
      return p;
    },
  },
];

const X = 'M18 18 L82 82 M82 18 L18 82';
const CIRCLE = (r: number) => `M${50 - r} 50 A${r} ${r} 0 1 0 ${50 + r} 50 A${r} ${r} 0 1 0 ${50 - r} 50`;
const TUB = 'M8 32 Q20 24 32 32 T56 32 T80 32 Q86 29 92 30 M10 32 L20 84 H80 L90 32';
const TRI = 'M50 10 L94 88 H6 Z';
const SQ = 'M10 10 H90 V90 H10 Z';
const IRON = 'M14 78 H88 L84 46 Q82 34 70 34 H42 Q26 34 18 56 Z M44 34 Q46 20 62 20 H76';
const PROHIB = CIRCLE(44) + ' M19 19 L81 81';
const DIAMOND = 'M50 4 L96 50 L50 96 L4 50 Z';
const dot = (cx: number, cy: number, r = 5) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy}`;

export const SYMBOLS: SymbolShape[] = [
  // --- Entretien textile ---
  { id: 'care-wash30', label: 'Lavage 30 °C', keywords: 'entretien care lavage laver 30 machine', category: 'entretien', parts: [{ d: TUB, mode: 'stroke' }, { mode: 'fill', text: '30', tx: 50, ty: 60, size: 28 }] },
  { id: 'care-wash40', label: 'Lavage 40 °C', keywords: 'entretien care lavage laver 40 machine', category: 'entretien', parts: [{ d: TUB, mode: 'stroke' }, { mode: 'fill', text: '40', tx: 50, ty: 60, size: 28 }] },
  { id: 'care-wash60', label: 'Lavage 60 °C', keywords: 'entretien care lavage laver 60 machine', category: 'entretien', parts: [{ d: TUB, mode: 'stroke' }, { mode: 'fill', text: '60', tx: 50, ty: 60, size: 28 }] },
  {
    id: 'care-handwash',
    label: 'Lavage à la main',
    keywords: 'entretien care lavage main hand',
    category: 'entretien',
    parts: [{ d: TUB, mode: 'stroke' }, { d: 'M36 70 V52 Q36 46 41 46 Q46 46 46 52 V44 Q46 38 51 38 Q56 38 56 44 V50 Q56 46 61 46 Q66 46 66 52 V70 Z', mode: 'stroke' }],
  },
  { id: 'care-nowash', label: 'Ne pas laver', keywords: 'entretien care lavage interdit ne pas laver', category: 'entretien', parts: [{ d: TUB, mode: 'stroke' }, { d: X, mode: 'stroke' }] },
  { id: 'care-bleach', label: 'Blanchiment autorisé', keywords: 'entretien care javel blanchiment', category: 'entretien', parts: [{ d: TRI, mode: 'stroke' }] },
  { id: 'care-nobleach', label: 'Pas de javel', keywords: 'entretien care javel blanchiment interdit', category: 'entretien', parts: [{ d: TRI, mode: 'stroke' }, { d: 'M22 30 L78 86 M78 30 L22 86', mode: 'stroke' }] },
  { id: 'care-tumble', label: 'Sèche-linge', keywords: 'entretien care séchage sèche-linge tambour', category: 'entretien', parts: [{ d: SQ + ' ' + CIRCLE(30), mode: 'stroke' }] },
  { id: 'care-tumblelow', label: 'Sèche-linge basse temp.', keywords: 'entretien care séchage sèche-linge basse', category: 'entretien', parts: [{ d: SQ + ' ' + CIRCLE(30), mode: 'stroke' }, { d: dot(50, 50, 6), mode: 'fill' }] },
  { id: 'care-notumble', label: 'Pas de sèche-linge', keywords: 'entretien care séchage interdit', category: 'entretien', parts: [{ d: SQ + ' ' + CIRCLE(30), mode: 'stroke' }, { d: X, mode: 'stroke' }] },
  { id: 'care-linedry', label: 'Séchage sur fil', keywords: 'entretien care séchage fil', category: 'entretien', parts: [{ d: SQ + ' M10 26 Q50 50 90 26', mode: 'stroke' }] },
  { id: 'care-iron1', label: 'Repassage doux', keywords: 'entretien care fer repassage 110', category: 'entretien', parts: [{ d: IRON, mode: 'stroke' }, { d: dot(50, 60), mode: 'fill' }] },
  { id: 'care-iron2', label: 'Repassage moyen', keywords: 'entretien care fer repassage 150', category: 'entretien', parts: [{ d: IRON, mode: 'stroke' }, { d: dot(40, 60) + ' ' + dot(60, 60), mode: 'fill' }] },
  { id: 'care-iron3', label: 'Repassage chaud', keywords: 'entretien care fer repassage 200', category: 'entretien', parts: [{ d: IRON, mode: 'stroke' }, { d: dot(34, 60) + ' ' + dot(50, 60) + ' ' + dot(66, 60), mode: 'fill' }] },
  { id: 'care-noiron', label: 'Ne pas repasser', keywords: 'entretien care fer repassage interdit', category: 'entretien', parts: [{ d: IRON, mode: 'stroke' }, { d: 'M20 22 L82 84 M82 22 L20 84', mode: 'stroke' }] },
  { id: 'care-dryclean', label: 'Nettoyage à sec', keywords: 'entretien care pressing nettoyage sec', category: 'entretien', parts: [{ d: CIRCLE(40), mode: 'stroke' }, { mode: 'fill', text: 'P', tx: 50, ty: 52, size: 44 }] },
  { id: 'care-nodryclean', label: 'Pas de nettoyage à sec', keywords: 'entretien care pressing nettoyage sec interdit', category: 'entretien', parts: [{ d: CIRCLE(40), mode: 'stroke' }, { d: 'M22 22 L78 78 M78 22 L22 78', mode: 'stroke' }] },
  // --- Pictogrammes de danger (style CLP, dessins originaux) ---
  {
    id: 'clp-exclamation',
    label: 'Danger : point d’exclamation',
    keywords: 'sécurité danger clp ghs irritant exclamation',
    category: 'securite',
    parts: [{ d: DIAMOND, mode: 'stroke' }, { d: 'M44 24 H56 L54 62 H46 Z ' + dot(50, 73, 6), mode: 'fill' }],
  },
  {
    id: 'clp-flammable',
    label: 'Danger : inflammable',
    keywords: 'sécurité danger clp ghs inflammable feu flamme',
    category: 'securite',
    parts: [
      { d: DIAMOND, mode: 'stroke' },
      { d: 'M50 20 C60 34 70 42 66 58 C64 68 57 74 50 74 C41 74 33 67 35 55 C36 46 43 43 44 33 C50 40 51 46 48 53 C56 49 57 34 50 20 Z M30 79 H70 V83 H30 Z', mode: 'fill' },
    ],
  },
  {
    id: 'clp-environment',
    label: 'Danger : environnement',
    keywords: 'sécurité danger clp ghs environnement poisson arbre aquatique',
    category: 'securite',
    parts: [
      { d: DIAMOND, mode: 'stroke' },
      { d: 'M34 70 V36 M34 50 L24 38 M34 44 L44 32 M22 74 H78', mode: 'stroke' },
      { d: 'M46 64 Q58 54 70 64 Q58 74 46 64 Z M68 64 L77 57 V71 Z', mode: 'fill' },
    ],
  },
  {
    id: 'clp-health',
    label: 'Danger : santé',
    keywords: 'sécurité danger clp ghs santé cmr toxique',
    category: 'securite',
    parts: [
      { d: DIAMOND, mode: 'stroke' },
      { d: dot(50, 32, 9) + ' M30 76 Q30 46 50 46 Q70 46 70 76 Z', mode: 'fill' },
      { d: 'M50 52 L53 60 L61 60 L55 65 L57 73 L50 68 L43 73 L45 65 L39 60 L47 60 Z', mode: 'knock' },
    ],
  },
  {
    id: 'clp-corrosive',
    label: 'Danger : corrosif',
    keywords: 'sécurité danger clp ghs corrosif acide',
    category: 'securite',
    parts: [{ d: DIAMOND, mode: 'stroke' }, { d: 'M30 30 L40 30 L38 46 L32 46 Z M56 30 H70 L66 46 H58 Z M28 70 H72 V76 H28 Z', mode: 'fill' }, { d: 'M35 50 V60 M62 50 V60', mode: 'stroke' }],
  },
  // --- Avertissements bougies ---
  {
    id: 'candle-unattended',
    label: 'Ne jamais laisser une bougie allumée sans surveillance',
    keywords: 'bougie sécurité surveillance allumée flamme',
    category: 'bougie',
    parts: [{ d: 'M43 44 H57 V80 H43 Z M50 18 C56 27 57 33 50 38 C43 33 44 27 50 18 Z', mode: 'fill' }, { d: PROHIB, mode: 'stroke' }],
  },
  {
    id: 'candle-children',
    label: 'Tenir hors de portée des enfants',
    keywords: 'bougie sécurité enfants enfant',
    category: 'bougie',
    parts: [{ d: dot(50, 30, 8) + ' M40 42 H60 L58 62 H54 V78 H46 V62 H42 Z', mode: 'fill' }, { d: PROHIB, mode: 'stroke' }],
  },
  {
    id: 'candle-pets',
    label: 'Tenir hors de portée des animaux',
    keywords: 'bougie sécurité animaux chien chat patte',
    category: 'bougie',
    parts: [{ d: dot(35, 40, 6) + ' ' + dot(46, 32, 6) + ' ' + dot(58, 32, 6) + ' ' + dot(68, 41, 6) + ' M38 66 Q38 50 52 50 Q66 50 66 66 Q66 74 52 72 Q38 74 38 66 Z', mode: 'fill' }, { d: PROHIB, mode: 'stroke' }],
  },
  {
    id: 'candle-noteat',
    label: 'Ne pas manger',
    keywords: 'bougie sécurité manger comestible',
    category: 'bougie',
    parts: [{ d: 'M38 26 V44 M33 26 V40 Q33 47 38 47 Q43 47 43 40 V26 M38 47 V78 M62 26 Q70 36 66 54 H62 Z M62 54 V78', mode: 'stroke' }, { d: PROHIB, mode: 'stroke' }],
  },
];

export const ALL_SHAPES: ShapeDef[] = [...GEO_SHAPES, ...SYMBOLS];
const byId = new Map(ALL_SHAPES.map((s) => [s.id, s]));
export const shapeDef = (id: string) => byId.get(id);
export const isSymbol = (id: string) => byId.get(id)?.category !== 'forme' && byId.has(id);

export const CATEGORY_LABELS: Record<ShapeCategory, string> = {
  forme: 'Formes',
  entretien: 'Entretien textile',
  securite: 'Sécurité / danger',
  bougie: 'Bougies',
};

export function searchShapes(q: string): ShapeDef[] {
  const s = q
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!s) return ALL_SHAPES;
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ALL_SHAPES.filter((d) => s.split(/\s+/).every((w) => norm(d.label + ' ' + d.keywords + ' ' + d.category).includes(w)));
}

const pathCache = new Map<string, Path2D>();
function svgPath(d: string) {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

/** Dessine un symbole centré dans (w,h), conserve le ratio. */
export function drawSymbol(c: CanvasRenderingContext2D, def: SymbolShape, w: number, h: number, color: string, strokeWidth: number, knockColor: string) {
  const side = Math.min(w, h);
  c.save();
  c.translate((w - side) / 2, (h - side) / 2);
  c.scale(side / 100, side / 100);
  c.lineWidth = Math.max(1, (strokeWidth * 100) / side);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (const p of def.parts) {
    if (p.text) {
      c.fillStyle = color;
      c.font = `bold ${p.size ?? 30}px Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(p.text, p.tx ?? 50, p.ty ?? 50);
      continue;
    }
    if (!p.d) continue;
    const path = svgPath(p.d);
    if (p.mode === 'stroke') {
      c.strokeStyle = color;
      c.stroke(path);
    } else {
      c.fillStyle = p.mode === 'knock' ? knockColor : color;
      c.fill(path);
    }
  }
  c.restore();
}

/** Petit SVG d'aperçu pour la palette */
export function symbolSvg(def: SymbolShape): string {
  const inner = def.parts
    .map((p) =>
      p.text
        ? `<text x="${p.tx ?? 50}" y="${(p.ty ?? 50) + (p.size ?? 30) * 0.35}" font-size="${p.size ?? 30}" font-weight="bold" font-family="Arial" text-anchor="middle" fill="currentColor">${p.text}</text>`
        : p.mode === 'stroke'
          ? `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`
          : `<path d="${p.d}" fill="${p.mode === 'knock' ? '#fff' : 'currentColor'}"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
