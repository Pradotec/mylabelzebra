import { describe, it, expect } from 'vitest';
import { analyzeFood, dateFormatsIn, formatHasDay, FOOD_REQUIREMENTS } from './food';
import { newDoc, makeText, makeMark } from './elements';
import { incoPrintSummary, isIncoMandatory } from './render/draw';
import type { FoodRole, LabelDoc, TextEl } from './types';

function doc(roles: [FoodRole, string, Partial<TextEl>?][]): LabelDoc {
  const d = newDoc();
  d.elements = roles.map(([role, text, extra], i) => ({ ...makeText(d, text), id: 'e' + i, x: 0, y: i * 40, w: 600, fontSize: 30, role, ...extra }));
  return d;
}

describe('dateFormatsIn', () => {
  it('filtre date, {{date}} et {{aujourdhui}}', () => {
    expect(dateFormatsIn('À consommer jusqu’au {{date+5}}', 'DD/MM/YYYY')).toEqual(['DD/MM/YYYY']);
    expect(dateFormatsIn('{{dlc|date:MM/AAAA}}', 'DD/MM/YYYY')).toEqual(['MM/AAAA']);
    expect(dateFormatsIn('{{aujourdhui|jours:+3|date:jj/mm}}', 'X')).toEqual(['jj/mm']);
    expect(dateFormatsIn('{{lot}}', 'DD/MM/YYYY')).toEqual([]);
  });
  it('jour présent', () => {
    expect(formatHasDay('JJ/MM')).toBe(true);
    expect(formatHasDay('dd.mm.yy')).toBe(true);
    expect(formatHasDay('MM/AAAA')).toBe(false);
  });
});

describe('analyzeFood', () => {
  it('document vide : toutes les mentions toujours obligatoires manquent', () => {
    const r = analyzeFood(newDoc());
    expect(r.used).toBe(false);
    expect(r.missing.map((m) => m.id)).toEqual(['denomination', 'ingredients', 'allergens', 'netQuantity', 'date', 'operator', 'nutrition']);
    // chaque mention toujours obligatoire indique ses exemptions
    for (const q of FOOD_REQUIREMENTS) expect(q.note.length).toBeGreaterThan(5);
  });

  it('étiquette complète ; allergènes couverts par la liste en gras ; DDM suffit pour la date', () => {
    const d = doc([
      ['denomination', 'Rillettes'],
      ['ingredients', 'Porc, sel, lait', { boldAllergens: true }],
      ['netQuantity', '200 g'],
      ['bestBefore', 'À consommer de préférence avant fin {{date|date:MM/AAAA}}'],
      ['operator', 'SARL X, 1 rue Y, 75001 Paris'],
      ['nutrition', 'Énergie 1200 kJ'],
    ]);
    const r = analyzeFood(d);
    expect(r.missing).toEqual([]);
    expect(r.items.find((i) => i.req.id === 'allergens')!.coveredBy).toBe('ingredients');
    // DDM sans jour : pas d'alerte (seule la DLC exige le jour)
    expect(r.dateIssues).toEqual([]);
    expect(r.sameField).toEqual(['denomination', 'netQuantity']);
  });

  it('DLC sans jour signalée', () => {
    const d = doc([['useBy', 'À consommer jusqu’au {{date|date:MM/AA}}']]);
    const r = analyzeFood(d);
    expect(r.dateIssues).toHaveLength(1);
    expect(r.dateIssues[0].format).toBe('MM/AA');
    const d2 = doc([['useBy', '{{date}}']]);
    d2.date.format = 'MM/YYYY';
    expect(analyzeFood(d2).dateIssues).toHaveLength(1);
  });

  it('élément masqué non compté ; condition d’affichage → « conditionnel »', () => {
    const d = doc([
      ['denomination', 'A', { hidden: true }],
      ['operator', 'B', { showIf: { field: 'x', op: 'notEmpty' } }],
    ]);
    const r = analyzeFood(d);
    expect(r.missing.map((m) => m.id)).toContain('denomination');
    expect(r.items.find((i) => i.req.id === 'operator')).toMatchObject({ present: true, conditional: true });
  });

  it('rôle de l’art. 9 ⇒ contrôle INCO de hauteur de x automatique (pas pour le lot)', () => {
    const d = doc([
      ['denomination', 'Petit texte', { fontSize: 4 }],
      ['lot', 'Lot 12', { fontSize: 4 }],
    ]);
    expect(isIncoMandatory(d.elements[0])).toBe(true);
    expect(isIncoMandatory(d.elements[1])).toBe(false);
    const r = analyzeFood(d);
    expect(r.inco.map((i) => i.el.id)).toEqual(['e0']);
    expect(r.inco[0].thresholdMm).toBe(1.2);
    expect(incoPrintSummary(d, [{ index: 0, copies: 3 }])).toEqual({ labels: 3, elements: 1 });
  });

  it('estampille : rôle conditionnel présent', () => {
    const d = newDoc();
    d.elements = [makeMark(d, 'health')];
    expect(analyzeFood(d).items.find((i) => i.req.id === 'healthMark')!.present).toBe(true);
  });
});
