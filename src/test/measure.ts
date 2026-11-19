/** Mesure de texte déterministe utilisée par le canvas de test (voir setup.ts). */

/** largeur fictive d'un caractère, en fraction de la taille de police */
export const CHAR_W = 0.5;

/** Taille (px) extraite d'une chaîne CSS « bold 23.5px Arial » */
export function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 10;
}

export function fakeWidth(text: string, font: string): number {
  return Array.from(text).length * fontPx(font) * CHAR_W;
}
