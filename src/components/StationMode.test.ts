import { describe, it, expect } from 'vitest';
import { findRows, guessColumn, normCode } from './StationMode';

describe('mode poste : recherche du code scanné', () => {
  const rows = [{ EAN: '3012345678902', Nom: 'A' }, { EAN: ' 3012 3456 78902 ', Nom: 'B' }, { EAN: 'abc-01', Nom: 'C' }, { EAN: '30123456789', Nom: 'D' }];

  it('exacte, sans tenir compte des espaces ni de la casse', () => {
    expect(normCode(' Ab c ')).toBe('abc');
    expect(findRows(rows, 'EAN', '3012345678902')).toEqual([0, 1]);
    expect(findRows(rows, 'EAN', 'ABC-01')).toEqual([2]);
    expect(findRows(rows, 'EAN', '301234567890')).toEqual([]); // pas de correspondance partielle
    expect(findRows(rows, 'EAN', '   ')).toEqual([]);
    expect(findRows(rows, 'Inconnue', 'A')).toEqual([]);
  });

  it('colonne présélectionnée : « ean », « code » ou « emplacement »', () => {
    expect(guessColumn(['Nom', 'Code article', 'Qté'])).toBe('Code article');
    expect(guessColumn(['Nom', 'EAN13'])).toBe('EAN13');
    expect(guessColumn(['Désignation', 'Emplacement'])).toBe('Emplacement');
    expect(guessColumn(['Nom', 'Qté'])).toBe('Nom');
    expect(guessColumn([])).toBe('');
  });
});
