/**
 * Marques réglementaires (géométrie pure, partagée par l'écran, le ZPL et le SVG/PDF).
 *
 * Estampille sanitaire / marque d'identification (règl. CE 853/2004, annexe II section I,
 * points B.6 à B.8) : marque OVALE portant le nom ou le code ISO du pays, le numéro
 * d'agrément de l'établissement et, dans l'UE, une abréviation (« CE » en français).
 *
 * Signe « ℮ » (directive 76/211/CEE, annexe I point 3.3) : « un petit e d'au moins 3 mm
 * de hauteur », de la forme du dessin de la section 3 de l'annexe II de la directive
 * 71/316/CEE (aujourd'hui 2009/34/CE, annexe II point 3.2.1 : dimensions relatives au
 * diamètre du cercle circonscrit à la lettre « e »).
 */
import type { MarkEl } from '../types';

/** Hauteur minimale du signe ℮ (directive 76/211/CEE, annexe I, 3.3) */
export const ESTIMATED_MIN_MM = 3;

// ---------------------------------------------------------------------------
// Signe ℮
// ---------------------------------------------------------------------------

/**
 * Tracé du ℮ dans une boîte 100 × 100 (le cercle circonscrit, de diamètre 100, donne
 * la hauteur). Reconstitution du gabarit : anneau d'épaisseur 10 % du diamètre, barre
 * horizontale médiane sur toute la largeur intérieure, ouverture en bas à droite entre
 * la barre et une coupe radiale à 40° sous l'horizontale.
 * Deux parties remplies séparément (anneau, barre) : pas de problème de sens de tracé.
 */
export const ESTIMATED_STROKE = 10;
export const ESTIMATED_OPEN_DEG = 40;
export function estimatedSignPaths(): string[] {
  const c = 50,
    R = 50,
    t = ESTIMATED_STROKE,
    r = R - t;
  const a = (ESTIMATED_OPEN_DEG * Math.PI) / 180;
  const P = (rad: number, ang: number) => `${(c + rad * Math.cos(ang)).toFixed(3)} ${(c + rad * Math.sin(ang)).toFixed(3)}`;
  // anneau : de 0° (droite) en passant par le haut, la gauche et le bas, jusqu'à +40° (sous l'horizontale)
  const ring = `M${P(R, 0)} A${R} ${R} 0 1 0 ${P(R, a)} L${P(r, a)} A${r} ${r} 0 1 1 ${P(r, 0)} Z`;
  const bar = `M${(c - r - 0.5).toFixed(3)} ${c - t / 2} H${c + R} V${c + t / 2} H${(c - r - 0.5).toFixed(3)} Z`;
  return [ring, bar];
}

/** Hauteur imprimée du ℮ en mm (côté du carré inscrit dans la boîte de l'élément) */
export function estimatedHeightMm(el: Pick<MarkEl, 'w' | 'h'>, baseDpi = 203): number {
  return (Math.min(el.w, el.h) / baseDpi) * 25.4;
}

// ---------------------------------------------------------------------------
// Estampille ovale
// ---------------------------------------------------------------------------

/** Lignes de l'estampille (pays, agrément, mention finale), lignes vides retirées */
export function healthMarkLines(el: Pick<MarkEl, 'country' | 'approval' | 'suffix'>, approval = el.approval): string[] {
  return [el.country, approval, el.suffix].map((s) => (s ?? '').trim()).filter(Boolean);
}

export interface OvalTextFit {
  fontSize: number;
  /** ordonnée du centre de chaque ligne, relative au centre de l'ovale */
  ys: number[];
  /** largeur disponible pour chaque ligne */
  widths: number[];
}

/** demi-hauteur des glyphes (capitales et chiffres) rapportée à la taille de police */
const HALF_GLYPH = 0.37;
export const OVAL_LINE_HEIGHT = 1.12;

/** Largeur disponible à la hauteur |y| dans une ellipse de demi-axes a, b */
export function ovalWidthAt(a: number, b: number, y: number): number {
  const k = Math.abs(y) / b;
  return k >= 1 ? 0 : 2 * a * Math.sqrt(1 - k * k);
}

/**
 * Plus grande taille de police (fonction pure) telle que chaque ligne tienne dans l'ellipse
 * intérieure de demi-axes a, b : la largeur mesurée de chaque ligne ne dépasse pas la
 * corde de l'ellipse au bord le plus éloigné du centre de ses glyphes.
 */
export function fitOvalText(lines: string[], measure: (s: string, fs: number) => number, a: number, b: number): OvalTextFit {
  const n = lines.length;
  if (!n || a <= 0 || b <= 0) return { fontSize: 0, ys: [], widths: [] };
  const place = (fs: number) => lines.map((_, i) => (i - (n - 1) / 2) * fs * OVAL_LINE_HEIGHT);
  const fits = (fs: number) => {
    const ys = place(fs);
    return lines.every((l, i) => {
      const edge = Math.abs(ys[i]) + fs * HALF_GLYPH;
      if (edge > b) return false;
      return measure(l, fs) <= ovalWidthAt(a, b, edge);
    });
  };
  let lo = 0,
    hi = 2 * b;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const fs = lo;
  const ys = place(fs);
  return { fontSize: fs, ys, widths: ys.map((y) => ovalWidthAt(a, b, Math.abs(y) + fs * HALF_GLYPH)) };
}

/** Géométrie de l'ovale dans la boîte (w, h) : contour centré dans l'épaisseur, zone de texte */
export function healthMarkGeometry(w: number, h: number, strokeWidth: number) {
  const sw = Math.max(0, Math.min(strokeWidth, Math.min(w, h) / 4));
  const pad = Math.min(w, h) * 0.07;
  return {
    sw,
    cx: w / 2,
    cy: h / 2,
    /** rayons du tracé (milieu du trait) */
    rx: Math.max(0.1, (w - sw) / 2),
    ry: Math.max(0.1, (h - sw) / 2),
    /** demi-axes de la zone de texte */
    a: Math.max(0, w / 2 - sw - pad),
    b: Math.max(0, h / 2 - sw - pad),
  };
}

export const markFont = (el: Pick<MarkEl, 'fontFamily'>, fs: number) => `bold ${fs}px ${(el.fontFamily || 'Arial').includes(' ') ? `"${el.fontFamily}"` : el.fontFamily || 'Arial'}, Arial, sans-serif`;
