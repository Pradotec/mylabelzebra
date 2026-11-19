import { describe, it, expect } from 'vitest';
import { removeEmptyFieldLines, computeFlow, type FlowItem } from './flow';
import { flowElements, renderLabel, elText } from './draw';
import { newDoc, makeText, makeShape } from '../elements';
import { generateLabelZpl, generateJobsZpl } from '../zpl/generate';
import { lintZpl, parseZpl } from '../zpl/parse';
import type { LabelDoc, TextEl } from '../types';

const fake = (vals: Record<string, string>) => (line: string) => line.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k: string) => vals[k] ?? '');

describe('removeEmptyFieldLines', () => {
  it('retire les lignes dont tous les champs sont vides, les suivantes remontent', () => {
    const tpl = '{{nom}}\n{{adr1}}\n{{adr2}}\n{{cp}} {{ville}}';
    expect(removeEmptyFieldLines(tpl, fake({ nom: 'Dupont', adr1: '1 rue A', cp: '75001', ville: 'Paris' }))).toBe('{{nom}}\n{{adr1}}\n{{cp}} {{ville}}');
  });
  it('garde une ligne dont un champ seulement est vide, et les lignes sans champ', () => {
    const tpl = 'Expéditeur\n\n{{cp}} {{ville}}\n{{pays}}';
    expect(removeEmptyFieldLines(tpl, fake({ ville: 'Lyon' }))).toBe('Expéditeur\n\n{{cp}} {{ville}}');
  });
  it('ligne avec texte fixe + champ vide : conservée (le texte fixe reste)', () => {
    expect(removeEmptyFieldLines('Tél. {{tel}}\n{{x}}', fake({ x: 'a' }))).toBe('Tél. {{tel}}\n{{x}}');
  });
  it('sans champ : inchangé', () => {
    expect(removeEmptyFieldLines('a\n\nb', fake({}))).toBe('a\n\nb');
  });
});

const item = (p: Partial<FlowItem> & { id: string }): FlowItem => ({ y: 0, printed: true, empty: false, h: 10, designH: 10, ...p });

describe('computeFlow', () => {
  it('écart conservé quand l’élément du dessus grandit', () => {
    // A : y 10, h modèle 20 → bas 30 ; B à 40 → écart 10. A mesure 50 sur cette ligne → B à 70
    const m = computeFlow([item({ id: 'A', y: 10, designH: 20, h: 50 }), item({ id: 'B', y: 40, anchorTo: 'A' })]);
    expect(m.get('B')).toBe(70);
    expect(m.has('A')).toBe(false);
  });
  it('élément du dessus masqué ou vide : prend sa place', () => {
    expect(computeFlow([item({ id: 'A', y: 10, printed: false }), item({ id: 'B', y: 40, anchorTo: 'A' })]).get('B')).toBe(10);
    expect(computeFlow([item({ id: 'A', y: 10, empty: true }), item({ id: 'B', y: 40, anchorTo: 'A' })]).get('B')).toBe(10);
  });
  it('chaîne A → B → C : C remonte de toute la place libérée', () => {
    const m = computeFlow([
      item({ id: 'A', y: 0, designH: 10, h: 10 }),
      item({ id: 'B', y: 15, designH: 10, printed: false, anchorTo: 'A' }),
      item({ id: 'C', y: 30, designH: 10, anchorTo: 'B' }),
    ]);
    // A imprimé → B (masqué) reste à 15 ; C prend la place de B
    expect(m.has('B')).toBe(false);
    expect(m.get('C')).toBe(15);
  });
  it('ancre inconnue ou circulaire ignorée', () => {
    expect(computeFlow([item({ id: 'A', y: 5, anchorTo: 'zz' })]).size).toBe(0);
    const m = computeFlow([item({ id: 'A', y: 0, anchorTo: 'B' }), item({ id: 'B', y: 20, anchorTo: 'A' })]);
    expect(Number.isFinite(m.get('A') ?? 0)).toBe(true);
  });
});

function addrDoc(): LabelDoc {
  const d = newDoc({ widthIn: 4, heightIn: 3 });
  const addr: TextEl = { ...makeText(d, '{{nom}}\n{{adr2}}\n{{ville}}'), id: 'addr', x: 10, y: 10, w: 400, fontSize: 30, lineHeight: 1, removeEmptyLines: true, fit: 'wrapGrow' };
  const below: TextEl = { ...makeText(d, 'Lot {{lot}}'), id: 'lot', x: 10, y: 120, w: 400, fontSize: 30, fit: 'wrapGrow', anchorTo: 'addr' };
  d.elements = [addr, below];
  d.data = {
    columns: ['nom', 'adr2', 'ville', 'lot'],
    rows: [
      { nom: 'A', adr2: 'Bât. 2', ville: 'Paris', lot: '1' },
      { nom: 'B', adr2: '', ville: 'Lyon', lot: '2' },
    ],
    checked: [true, true],
    copies: [1, 1],
  };
  return d;
}

describe('positionnement relatif : écran, ZPL', () => {
  it('texte : ligne vide retirée pour la ligne 2 seulement', () => {
    const d = addrDoc();
    const el = d.elements[0] as TextEl;
    expect(elText(el, { doc: d, index: 0, row: d.data!.rows[0], resolve: true })).toBe('A\nBât. 2\nParis');
    expect(elText(el, { doc: d, index: 1, row: d.data!.rows[1], resolve: true })).toBe('B\nLyon');
    // modèle (champs non résolus) : rien n'est retiré
    expect(elText(el, { doc: d, index: 1, resolve: false })).toBe(el.text);
  });

  it('flowElements : l’élément ancré remonte d’une ligne quand l’adresse en perd une', () => {
    const d = addrDoc();
    const y0 = flowElements(d, { doc: d, index: 0, row: d.data!.rows[0], resolve: true }).find((e) => e.id === 'lot')!.y;
    const y1 = flowElements(d, { doc: d, index: 1, row: d.data!.rows[1], resolve: true }).find((e) => e.id === 'lot')!.y;
    expect(y0).toBe(120); // adresse complète : même hauteur que le modèle
    expect(y0 - y1).toBeCloseTo(30, 5); // une ligne de 30 u en moins
    // le document n'est pas modifié
    expect(d.elements[1].y).toBe(120);
  });

  it('ZPL : ^FO du lot remonte pour la ligne 2, adresse sur 2 lignes, lint sans erreur', async () => {
    const d = addrDoc();
    const z0 = generateLabelZpl(d, { index: 0 });
    const z1 = generateLabelZpl(d, { index: 1 });
    const yOf = (z: string, txt: string) => Number(new RegExp(`\\^FO\\d+,(\\d+)[^\\n]*\\^FD${txt}\\^FS`).exec(z)![1]);
    expect(yOf(z0, 'Lot 1') - yOf(z1, 'Lot 2')).toBe(30);
    expect(z1).not.toContain('^FD^FS');
    expect(z1.match(/\^FD(B|Lyon)\^FS/g)).toHaveLength(2);
    const all = generateJobsZpl(d, [
      { index: 0, copies: 1 },
      { index: 1, copies: 1 },
    ]);
    expect(lintZpl(all).filter((x) => x.level === 'error')).toEqual([]);
    const labels = await parseZpl(all);
    expect(labels).toHaveLength(2);
  });

  it('élément du dessus masqué par une condition : le suivant prend sa place (rendu)', () => {
    const d = newDoc();
    const a = { ...makeShape(d, 'rect'), id: 'a', x: 0, y: 20, w: 50, h: 50, showIf: { field: 'x', op: 'notEmpty' as const } };
    const b = { ...makeShape(d, 'rect'), id: 'b', x: 0, y: 100, w: 50, h: 50, anchorTo: 'a' };
    d.elements = [a, b];
    d.data = { columns: ['x'], rows: [{ x: '' }, { x: '1' }], checked: [true, true], copies: [1, 1] };
    expect(flowElements(d, { doc: d, index: 0, row: d.data.rows[0], resolve: true }).map((e) => [e.id, e.y])).toEqual([['b', 20]]);
    expect(flowElements(d, { doc: d, index: 1, row: d.data.rows[1], resolve: true }).map((e) => [e.id, e.y])).toEqual([
      ['a', 20],
      ['b', 100],
    ]);
    // le rendu suit : pixels noirs de b en haut pour la ligne 1
    const cv = renderLabel(d, { index: 0, scale: 1 });
    const px = cv.getContext('2d')!.getImageData(2, 22, 1, 1).data;
    expect(px[0]).toBeLessThan(128);
  });
});
