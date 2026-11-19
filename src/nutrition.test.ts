import { describe, it, expect } from 'vitest';
import { computeEnergy, formatEnergy, formatNutrient, nutritionRows, nutritionWarnings, roundNutrient, roundTo, saltOf, type NutritionInput } from './nutrition';

const base: NutritionInput = { fat: 12, saturates: 3.14, carbohydrate: 54, sugars: 22, protein: 8.2, salt: 0.4 };

describe('énergie (annexe XIV)', () => {
  it('facteurs lipides 37/9, glucides 17/4, protéines 17/4', () => {
    const e = computeEnergy({ fat: 1, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0 });
    expect(e).toEqual({ kJ: 37, kcal: 9 });
    expect(computeEnergy({ fat: 0, saturates: 0, carbohydrate: 1, sugars: 0, protein: 1 })).toEqual({ kJ: 34, kcal: 8 });
  });
  it('fibres 8/2, alcool 29/7', () => {
    expect(computeEnergy({ fat: 0, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0, fibre: 1 })).toEqual({ kJ: 8, kcal: 2 });
    expect(computeEnergy({ fat: 0, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0, alcohol: 1 })).toEqual({ kJ: 29, kcal: 7 });
  });
  it('polyols 10/2,4, comptés à part des glucides qui les incluent', () => {
    const e = computeEnergy({ fat: 0, saturates: 0, carbohydrate: 10, sugars: 0, protein: 0, polyols: 4 });
    expect(e.kJ).toBeCloseTo(6 * 17 + 4 * 10);
    expect(e.kcal).toBeCloseTo(6 * 4 + 4 * 2.4);
    // polyols > glucides : bornés aux glucides
    expect(computeEnergy({ fat: 0, saturates: 0, carbohydrate: 2, sugars: 0, protein: 0, polyols: 5 }).kJ).toBeCloseTo(20);
  });
  it('exemple complet, arrondi au kJ / à la kcal', () => {
    const e = computeEnergy({ ...base, fibre: 4.5 });
    // 12×37 + 54×17 + 8,2×17 + 4,5×8 = 444 + 918 + 139,4 + 36 = 1537,4
    expect(e.kJ).toBeCloseTo(1537.4);
    // 12×9 + 54×4 + 8,2×4 + 4,5×2 = 108 + 216 + 32,8 + 9 = 365,8
    expect(e.kcal).toBeCloseTo(365.8);
    expect(formatEnergy(e)).toBe('1537 kJ / 366 kcal');
  });
  it('valeurs négatives ou absentes = 0', () => {
    expect(computeEnergy({ fat: -5, saturates: 0, carbohydrate: NaN, sugars: 0, protein: 0 })).toEqual({ kJ: 0, kcal: 0 });
  });
});

describe('sel / sodium', () => {
  it('sel saisi prioritaire, sinon sodium × 2,5', () => {
    expect(saltOf({ ...base, salt: 1.2, sodium: 9 })).toBe(1.2);
    expect(saltOf({ ...base, salt: undefined, sodium: 0.4 })).toBeCloseTo(1);
    expect(saltOf({ ...base, salt: undefined })).toBeUndefined();
  });
});

describe('arrondis (guide Commission 2012)', () => {
  it('roundTo sans artefact binaire', () => {
    expect(roundTo(0.15, 1)).toBe(0.2);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.45, 1)).toBe(2.5);
    expect(roundTo(1537.5, 0)).toBe(1538);
  });

  it('macronutriments : ≥10 g au gramme, >0,5 g à 0,1 g, ≤0,5 g négligeable', () => {
    expect(formatNutrient('macro', 12.4)).toBe('12 g');
    expect(formatNutrient('macro', 12.5)).toBe('13 g');
    expect(formatNutrient('macro', 10)).toBe('10 g');
    expect(formatNutrient('macro', 9.94)).toBe('9,9 g');
    expect(formatNutrient('macro', 9.96)).toBe('10,0 g');
    expect(formatNutrient('macro', 3)).toBe('3,0 g');
    expect(formatNutrient('macro', 0.51)).toBe('0,5 g');
    expect(formatNutrient('macro', 0.5)).toBe('<0,5 g');
    expect(formatNutrient('macro', 0.2)).toBe('<0,5 g');
    expect(formatNutrient('macro', 0.2, 'zero')).toBe('0 g');
    expect(formatNutrient('macro', 0)).toBe('0 g');
  });

  it('acides gras saturés : seuil 0,1 g', () => {
    expect(formatNutrient('saturates', 3.14)).toBe('3,1 g');
    expect(formatNutrient('saturates', 0.11)).toBe('0,1 g');
    expect(formatNutrient('saturates', 0.1)).toBe('<0,1 g');
    expect(formatNutrient('saturates', 0.05, 'zero')).toBe('0 g');
    expect(formatNutrient('saturates', 15.6)).toBe('16 g');
  });

  it('sel : ≥1 g à 0,1 g, >0,0125 g à 0,01 g, sinon « <0,01 g »', () => {
    expect(formatNutrient('salt', 1.24)).toBe('1,2 g');
    expect(formatNutrient('salt', 1)).toBe('1,0 g');
    expect(formatNutrient('salt', 0.996)).toBe('1,00 g');
    expect(formatNutrient('salt', 0.4)).toBe('0,40 g');
    expect(formatNutrient('salt', 0.013)).toBe('0,01 g');
    expect(formatNutrient('salt', 0.0125)).toBe('<0,01 g');
    expect(formatNutrient('salt', 0.01, 'zero')).toBe('0 g');
  });

  it('sodium : seuil 0,005 g', () => {
    expect(formatNutrient('sodium', 2.34)).toBe('2,3 g');
    expect(formatNutrient('sodium', 0.256)).toBe('0,26 g');
    expect(formatNutrient('sodium', 0.005)).toBe('<0,005 g');
    expect(roundNutrient('sodium', 0.004)).toEqual({ value: 0, decimals: 0, negligible: true });
  });

  it('séparateur décimal configurable', () => {
    expect(formatNutrient('macro', 3.14, 'lt', '.')).toBe('3.1 g');
    expect(formatNutrient('macro', 0.3, 'lt', '.')).toBe('<0.5 g');
  });
});

describe('tableau', () => {
  it('lignes dans l’ordre de l’annexe XV, sans fibres ni polyols si absents', () => {
    const rows = nutritionRows(base);
    expect(rows.map((r) => r.key)).toEqual(['energy', 'fat', 'saturates', 'carbohydrate', 'sugars', 'protein', 'salt']);
    expect(rows.map((r) => r.per100)).toEqual(['1501 kJ / 357 kcal', '12 g', '3,1 g', '54 g', '22 g', '8,2 g', '0,40 g']);
    expect(rows[0].perPortion).toBeUndefined();
  });

  it('fibres et polyols si renseignés', () => {
    const rows = nutritionRows({ ...base, fibre: 0, polyols: 2 });
    expect(rows.map((r) => r.key)).toEqual(['energy', 'fat', 'saturates', 'carbohydrate', 'sugars', 'polyols', 'fibre', 'protein', 'salt']);
    expect(rows.find((r) => r.key === 'fibre')!.per100).toBe('0 g');
  });

  it('portion calculée sur les valeurs non arrondies', () => {
    const rows = nutritionRows(base, { portion: 30 });
    const p = Object.fromEntries(rows.map((r) => [r.key, r.perPortion]));
    // énergie 100 g : 1501,4 kJ / 356,8 kcal → 30 g : 450,42 / 107,04
    expect(p.energy).toBe('450 kJ / 107 kcal');
    expect(p.fat).toBe('3,6 g');
    expect(p.saturates).toBe('0,9 g');
    expect(p.carbohydrate).toBe('16 g'); // 16,2 ≥ 10
    expect(p.sugars).toBe('6,6 g');
    expect(p.protein).toBe('2,5 g'); // 2,46
    expect(p.salt).toBe('0,12 g');
  });

  it('sel calculé depuis le sodium', () => {
    const rows = nutritionRows({ ...base, salt: undefined, sodium: 0.6 });
    expect(rows.find((r) => r.key === 'salt')!.per100).toBe('1,5 g');
  });

  it('libellés traduits', () => {
    const rows = nutritionRows(base, { labels: { energy: 'Energy' } });
    expect(rows[0].label).toBe('Energy');
    expect(rows[1].label).toBe('Matières grasses');
  });
});

describe('contrôles de saisie', () => {
  it('aucun avertissement pour des valeurs cohérentes', () => {
    expect(nutritionWarnings(base)).toEqual([]);
  });
  it('incohérences', () => {
    expect(nutritionWarnings({ ...base, saturates: 13 })).toContain('saturatesGtFat');
    expect(nutritionWarnings({ ...base, sugars: 60 })).toContain('sugarsGtCarbs');
    expect(nutritionWarnings({ ...base, polyols: 60 })).toContain('polyolsGtCarbs');
    expect(nutritionWarnings({ ...base, fat: 60 })).toContain('sumGt100');
    expect(nutritionWarnings({ ...base, protein: -1 })).toContain('negative');
  });
});
