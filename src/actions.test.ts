import { describe, it, expect, beforeEach } from 'vitest';
import { setLabelSize, setResizeMode, getResizeMode, distributeSelected, distributePatches, sameSizeSelected, sameSizePatches } from './actions';
import { useStore } from './store';
import { newDoc, makeShape, makeText } from './elements';
import type { ShapeEl, TextEl } from './types';

const S = () => useStore.getState();
const els = () => S().doc.elements;

function load() {
  const d = newDoc({ widthIn: 4, heightIn: 2 }); // 812 × 406 u
  const r: ShapeEl = { ...makeShape(d, 'rect'), id: 'r', x: 100, y: 50, w: 100, h: 100, strokeWidth: 4 };
  const t: TextEl = { ...makeText(d, 'abc'), id: 't', x: 400, y: 200, w: 200, h: 40, fontSize: 30, minFontSize: 10 };
  d.elements = [r, t];
  d.guides = { x: [406], y: [] };
  S().loadDoc(d);
}

beforeEach(() => {
  localStorage.clear();
  load();
});

describe('setLabelSize — mode « scale »', () => {
  it('mode par défaut', () => {
    expect(getResizeMode()).toBe('scale');
  });

  it('réduit proportionnellement : positions, tailles, polices, traits, repères', () => {
    setLabelSize(2, 1);
    const [r, t] = els() as [ShapeEl, TextEl];
    expect(S().doc.widthIn).toBe(2);
    expect(S().doc.heightIn).toBe(1);
    expect(r).toMatchObject({ x: 50, y: 25, w: 50, h: 50, strokeWidth: 2 });
    expect(t).toMatchObject({ x: 200, y: 100, w: 100, fontSize: 15, minFontSize: 5 });
    expect(S().doc.guides.x).toEqual([203]);
  });

  it('change de proportions : échelle minimale et recentrage', () => {
    setLabelSize(4, 4); // s = min(1, 2) = 1 ; dy = (812 − 406) / 2
    const r = els()[0];
    expect(r).toMatchObject({ x: 100, y: 50 + 203, w: 100 });
  });

  it('non cumulatif pendant la saisie : 4 → 1 → 12 → 4 revient à l’état initial', () => {
    setLabelSize(1, 0.5);
    setLabelSize(12, 6);
    setLabelSize(4, 2);
    const r = els()[0];
    expect(r.x).toBeCloseTo(100, 9);
    expect(r.w).toBeCloseTo(100, 9);
    setLabelSize(2, 1);
    expect(els()[0].w).toBeCloseTo(50, 9);
  });

  it('une autre modification entre deux saisies devient la nouvelle base', () => {
    setLabelSize(2, 1); // w : 100 → 50
    S().updateEls(['r'], { w: 80 });
    setLabelSize(4, 2); // base = 2 × 1 pouces avec w = 80 → ×2
    expect(els()[0].w).toBeCloseTo(160, 9);
  });

  it('bornes : 0,25 à 40 pouces', () => {
    setLabelSize(0.01, 100);
    expect(S().doc.widthIn).toBe(0.25);
    expect(S().doc.heightIn).toBe(40);
  });
});

describe('répartir / uniformiser', () => {
  function loadRow() {
    const d = newDoc({ widthIn: 4, heightIn: 2 });
    const sh = (id: string, x: number, y: number, w: number, h: number): ShapeEl => ({ ...makeShape(d, 'rect'), id, x, y, w, h });
    // ordre de sélection volontairement différent de l'ordre spatial
    d.elements = [sh('a', 0, 0, 50, 40), sh('c', 400, 100, 100, 20), sh('b', 90, 30, 30, 60), sh('d', 200, 10, 20, 20)];
    S().loadDoc(d);
    S().select(['b', 'a', 'd', 'c']);
  }
  const get = (id: string) => els().find((e) => e.id === id)!;

  it('répartir horizontalement : extrêmes fixes, espaces égaux, une seule annulation', () => {
    loadRow();
    const before = S().past.length;
    distributeSelected('h');
    // étendue 0 → 500, largeurs 50+30+20+100 = 200 → écart (500 − 200) / 3 = 100
    expect(get('a').x).toBe(0);
    expect(get('b').x).toBeCloseTo(150, 9);
    expect(get('d').x).toBeCloseTo(280, 9);
    expect(get('c').x).toBe(400);
    expect(S().past.length).toBe(before + 1);
    S().undo();
    expect(get('b').x).toBe(90);
    expect(get('d').x).toBe(200);
  });

  it('répartir verticalement (centres triés) ; moins de 3 éléments : rien', () => {
    loadRow();
    distributeSelected('v');
    // tri par centre : a (20), d (20, ex æquo : ordre de sélection), b (60), c (110) ;
    // étendue 0 → 120, hauteurs 140 → écart −20/3
    const [a, d, b, c] = ['a', 'd', 'b', 'c'].map((id) => get(id));
    const gap = (120 - 140) / 3;
    expect(a.y).toBe(0);
    expect(d.y).toBeCloseTo(40 + gap, 9);
    expect(b.y).toBeCloseTo(d.y + 20 + gap, 9);
    expect(c.y).toBe(100);
    expect(distributePatches(els().slice(0, 2), 'h', (e) => e).size).toBe(0);
  });

  it('élément verrouillé : non déplacé', () => {
    loadRow();
    S().updateEls(['b'], { locked: true });
    distributeSelected('h');
    expect(get('b').x).toBe(90);
    expect(get('d').x).toBeCloseTo(280, 9);
  });

  it('même largeur / même hauteur que le premier sélectionné, annulable en une fois', () => {
    loadRow();
    const before = S().past.length;
    sameSizeSelected('w');
    expect(els().map((e) => e.w)).toEqual([30, 30, 30, 30]);
    expect(S().past.length).toBe(before + 1);
    sameSizeSelected('h');
    expect(els().map((e) => e.h)).toEqual([60, 60, 60, 60]);
    S().undo();
    S().undo();
    expect(get('c')).toMatchObject({ w: 100, h: 20 });
  });

  it('texte à hauteur automatique : hauteur inchangée', () => {
    const d = newDoc();
    const a = { ...makeShape(d, 'rect'), id: 'a', h: 90 };
    const tx: TextEl = { ...makeText(d, 'x'), id: 't', fit: 'wrapGrow', h: 30 };
    expect(sameSizePatches([a, tx], 'h', a).size).toBe(0);
    expect(sameSizePatches([a, { ...tx, fit: 'none' }], 'h', a).get('t')).toEqual({ h: 90 });
  });
});

describe('setLabelSize — mode « keep »', () => {
  beforeEach(() => setResizeMode('keep'));

  it('mode mémorisé', () => {
    expect(getResizeMode()).toBe('keep');
  });

  it('tailles conservées, éléments ramenés dans l’étiquette', () => {
    setLabelSize(2, 1); // 406 × 203 u
    const [r, t] = els() as [ShapeEl, TextEl];
    expect(r).toMatchObject({ x: 100, y: 50, w: 100, h: 100, strokeWidth: 4 }); // tient déjà
    expect(t).toMatchObject({ x: 406 - 200, y: 203 - 40, w: 200, fontSize: 30 });
  });

  it('non cumulatif : réduire puis ré-agrandir rend les positions d’origine', () => {
    setLabelSize(1, 1);
    setLabelSize(4, 2);
    expect(els()[1]).toMatchObject({ x: 400, y: 200 });
  });
});
