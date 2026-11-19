/**
 * Mesure de texte factice (src/test/setup.ts) : largeur = nb de caractères × taille × 0,5.
 * À 20 px, un caractère fait donc 10 px : une boîte de 100 px contient 10 caractères.
 */
import { describe, it, expect } from 'vitest';
import { layoutText, wrapLines, ellipsize, fitMode, textOffsetY, measure, fontString, justifyWords, type TextLayout } from './textLayout';
import { newDoc, makeText } from '../elements';
import type { TextEl } from '../types';

const doc = newDoc();
const el = (extra: Partial<TextEl> = {}): TextEl =>
  makeText(doc, '', { fontSize: 20, w: 100, h: 22, lineHeight: 1.1, minFontSize: 4, ellipsis: false, maxLines: 0, ...extra });

const texts = (L: TextLayout) => L.lines.map((l) => l.text);
const fitsWidth = (L: TextLayout, w: number) => L.lines.every((l) => l.width <= w + 0.5);

describe('mesure factice', () => {
  it('est bien déterministe', () => {
    expect(measure('abcd', fontString({ bold: true, italic: false, fontFamily: 'Arial' }, 20))).toBe(40);
  });
});

describe('wrapLines / ellipsize', () => {
  const f = '20px Arial';
  it('coupe aux espaces', () => {
    expect(wrapLines('aaaa bbbb cccc', f, 100, true).map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc']);
  });
  it('coupe un mot trop long caractère par caractère', () => {
    expect(wrapLines('abcdefghijklmnopqrstuvwxy', f, 100, true).map((l) => l.text)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxy']);
  });
  it('respecte les paragraphes et lignes vides ; « last » en fin de paragraphe', () => {
    const L = wrapLines('aaaa bbbb cccc\n\nz', f, 100, true);
    expect(L.map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc', '', 'z']);
    expect(L.map((l) => l.last)).toEqual([false, true, true, true]);
  });
  it('sans retour automatique : une ligne par paragraphe', () => {
    expect(wrapLines('aaaa bbbb cccc', f, 100, false).map((l) => l.text)).toEqual(['aaaa bbbb cccc']);
  });
  it('ellipsize : tient dans la largeur avec « … »', () => {
    const s = ellipsize('abcdefghijklmnop', f, 100);
    expect(s.endsWith('…')).toBe(true);
    expect(measure(s, f)).toBeLessThanOrEqual(100);
    expect(s).toBe('abcdefghi…');
    expect(ellipsize('court', f, 100)).toBe('court');
  });
  it('justifyWords : répartit l’espace, dernière ligne non justifiée', () => {
    const [l1, l2] = wrapLines('aa bb cccc dd', f, 100, true);
    const jw = justifyWords(l1, f, 100)!;
    expect(jw.map((w) => w.word)).toEqual(['aa', 'bb', 'cccc']);
    expect(jw[0].x).toBe(0);
    expect(jw[2].x + 40).toBeCloseTo(100, 9);
    expect(justifyWords(l2, f, 100)).toBeNull();
  });
});

describe('layoutText — wrapGrow', () => {
  it('texte court : 1 ligne, taille inchangée, hauteur = 1 ligne', () => {
    const L = layoutText(el({ fit: 'wrapGrow' }), 'court');
    expect(texts(L)).toEqual(['court']);
    expect(L.fontSize).toBe(20);
    expect(L.h).toBeCloseTo(22, 9);
    expect(L.truncated).toBe(false);
  });
  it('texte long : retour à la ligne, la hauteur suit', () => {
    const L = layoutText(el({ fit: 'wrapGrow' }), 'aaaa bbbb cccc dddd eeee');
    expect(texts(L)).toEqual(['aaaa bbbb', 'cccc dddd', 'eeee']);
    expect(L.fontSize).toBe(20);
    expect(L.h).toBeCloseTo(66, 9);
  });
  it('maxLines : coupe, avec « … » si demandé', () => {
    const a = layoutText(el({ fit: 'wrapGrow', maxLines: 2 }), 'aaaa bbbb cccc dddd eeee');
    expect(texts(a)).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(a.truncated).toBe(true);
    expect(a.h).toBeCloseTo(44, 9);
    const b = layoutText(el({ fit: 'wrapGrow', maxLines: 2, ellipsis: true }), 'aaaa bbbb cccc dddd eeee');
    expect(b.lines).toHaveLength(2);
    expect(b.lines[1].text.endsWith('…')).toBe(true);
    expect(fitsWidth(b, 100)).toBe(true);
    expect(b.lines[1].last).toBe(true);
  });
  it('texte vide : une ligne vide', () => {
    const L = layoutText(el({ fit: 'wrapGrow' }), '');
    expect(texts(L)).toEqual(['']);
    expect(L.h).toBeCloseTo(22, 9);
  });
  it('mode hérité : autoShrink → wrapShrink, sinon wrapGrow', () => {
    expect(fitMode(el({ fit: undefined, autoShrink: true }))).toBe('wrapShrink');
    expect(fitMode(el({ fit: undefined }))).toBe('wrapGrow');
  });
});

describe('layoutText — shrinkLine', () => {
  it('valeur courte : taille conservée', () => {
    const L = layoutText(el({ fit: 'shrinkLine' }), 'abcdefghij');
    expect(L.fontSize).toBe(20);
    expect(L.lines).toHaveLength(1);
    expect(L.truncated).toBe(false);
  });
  it('valeur longue : jamais de retour à la ligne, police réduite pour tenir en largeur', () => {
    const L = layoutText(el({ fit: 'shrinkLine' }), 'abcdefghij klmnopqrs'); // 20 caractères → ≤ 10 px
    expect(L.lines).toHaveLength(1);
    expect(L.fontSize).toBeLessThanOrEqual(10.05); // tolérance de 0,5 px sur la largeur
    expect(L.fontSize).toBeGreaterThan(9.5); // la plus grande taille qui tient
    expect(fitsWidth(L, 100)).toBe(true);
    expect(L.h).toBe(22);
    expect(L.truncated).toBe(false);
  });
  it('plusieurs paragraphes : réduit aussi pour tenir en hauteur', () => {
    const L = layoutText(el({ fit: 'shrinkLine' }), 'a\nb');
    expect(L.lines).toHaveLength(2);
    expect(L.lines.length * L.lh).toBeLessThanOrEqual(22.5);
    expect(L.fontSize).toBeGreaterThan(9.5);
  });
  it('minFontSize atteint sans « … » : texte débordant signalé tronqué', () => {
    const L = layoutText(el({ fit: 'shrinkLine', minFontSize: 8 }), 'x'.repeat(200));
    expect(L.fontSize).toBe(8);
    expect(L.lines[0].text).toBe('x'.repeat(200));
    expect(L.truncated).toBe(true);
  });
  it('minFontSize atteint avec « … » : ligne raccourcie qui tient', () => {
    const L = layoutText(el({ fit: 'shrinkLine', minFontSize: 8, ellipsis: true }), 'x'.repeat(200));
    expect(L.fontSize).toBe(8);
    expect(L.lines[0].text.endsWith('…')).toBe(true);
    expect(fitsWidth(L, 100)).toBe(true);
    expect(L.truncated).toBe(true);
  });
  it('minFontSize jamais au-dessus de la taille de base', () => {
    const L = layoutText(el({ fit: 'shrinkLine', fontSize: 6, minFontSize: 30 }), 'x'.repeat(200));
    expect(L.fontSize).toBe(6);
  });
});

describe('layoutText — wrapShrink', () => {
  const box = { fit: 'wrapShrink' as const, h: 44 }; // 2 lignes à 20 px
  it('valeur courte : taille conservée', () => {
    const L = layoutText(el(box), 'aaaa bbbb');
    expect(L.fontSize).toBe(20);
    expect(L.truncated).toBe(false);
  });
  it('valeur longue : retour à la ligne puis réduction jusqu’à tenir en hauteur', () => {
    const L = layoutText(el(box), 'aaaa bbbb cccc dddd eeee');
    expect(L.fontSize).toBeLessThan(20);
    expect(L.fontSize).toBeGreaterThanOrEqual(13);
    expect(L.lines.length * L.lh).toBeLessThanOrEqual(44.5);
    expect(fitsWidth(L, 100)).toBe(true);
    expect(L.h).toBe(44);
    expect(L.truncated).toBe(false);
  });
  it('maxLines : réduit jusqu’à tenir sur N lignes', () => {
    const L = layoutText(el({ ...box, maxLines: 1 }), 'aaaa bbbb cccc');
    expect(L.lines).toHaveLength(1);
    expect(L.fontSize).toBeLessThanOrEqual(100 / 14 / 0.5);
  });
  it('minFontSize atteint : lignes coupées à la hauteur, « … » si demandé', () => {
    const long = Array.from({ length: 60 }, (_, i) => 'mot' + i).join(' ');
    const a = layoutText(el({ ...box, minFontSize: 12 }), long);
    expect(a.fontSize).toBe(12);
    expect(a.lines.length * a.lh).toBeLessThanOrEqual(44.5);
    expect(a.truncated).toBe(true);
    const b = layoutText(el({ ...box, minFontSize: 12, ellipsis: true }), long);
    expect(b.lines[b.lines.length - 1].text.endsWith('…')).toBe(true);
    expect(fitsWidth(b, 100)).toBe(true);
  });
});

describe('layoutText — none', () => {
  it('taille fixe, débordement rogné à la hauteur de la boîte', () => {
    const L = layoutText(el({ fit: 'none', h: 44 }), 'aaaa bbbb cccc dddd eeee');
    expect(L.fontSize).toBe(20);
    expect(texts(L)).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(L.h).toBe(44);
    expect(L.truncated).toBe(true);
  });
  it('texte court : rien de rogné', () => {
    const L = layoutText(el({ fit: 'none', h: 44 }), 'aaaa');
    expect(L.truncated).toBe(false);
  });
  it('au moins une ligne même si la boîte est trop basse', () => {
    const L = layoutText(el({ fit: 'none', h: 5 }), 'aaaa bbbb cccc');
    expect(L.lines).toHaveLength(1);
  });
});

describe('texte inversé et alignement vertical', () => {
  it('invert : marge intérieure, largeur utile réduite', () => {
    const L = layoutText(el({ fit: 'wrapGrow', invert: true }), 'aaaa bbbb');
    expect(L.pad).toBe(Math.round(20 * 0.18));
    // largeur utile 100 − 2×4 = 92 : 9 caractères (90 px) tiennent encore
    expect(L.lines).toHaveLength(1);
    const L2 = layoutText(el({ fit: 'wrapGrow', invert: true }), 'aaaa bbbbb'); // 100 px > 92
    expect(L2.lines).toHaveLength(2);
  });
  it('textOffsetY : haut / milieu / bas pour une boîte de hauteur fixe ; 0 en wrapGrow', () => {
    const base = { fit: 'none' as const, h: 66 };
    const L = layoutText(el(base), 'a');
    expect(textOffsetY(el({ ...base, vAlign: 'top' }), L)).toBe(0);
    expect(textOffsetY(el({ ...base, vAlign: 'middle' }), L)).toBeCloseTo(22, 9);
    expect(textOffsetY(el({ ...base, vAlign: 'bottom' }), L)).toBeCloseTo(44, 9);
    expect(textOffsetY(el({ fit: 'wrapGrow', vAlign: 'bottom' }), L)).toBe(0);
  });
});
