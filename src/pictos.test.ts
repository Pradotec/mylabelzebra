import { describe, it, expect } from 'vitest';
import { listPictos, addPicto, renamePicto, deletePicto, pictoNameFromFile, isPictoType } from './pictos';

const SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

describe('bibliothèque de pictogrammes personnels', () => {
  it('ajout, liste triée, renommage, suppression (stockage local)', async () => {
    const a = await addPicto('Triman', SVG);
    const b = await addPicto('Info-tri', SVG);
    expect(a.error).toBeUndefined();
    expect((await listPictos()).map((p) => p.name)).toEqual(['Info-tri', 'Triman']);
    expect(await renamePicto(a.picto!.id, 'Triman FR')).toBeNull();
    expect((await listPictos()).map((p) => p.name)).toEqual(['Info-tri', 'Triman FR']);
    expect(await deletePicto(b.picto!.id)).toBeNull();
    expect((await listPictos()).map((p) => p.name)).toEqual(['Triman FR']);
  });
  it('nom tiré du fichier, types acceptés', () => {
    expect(pictoNameFromFile('nutri-score-A.svg')).toBe('nutri-score-A');
    expect(isPictoType('image/svg+xml')).toBe(true);
    expect(isPictoType('image/png')).toBe(true);
    expect(isPictoType('', 'logo.SVG')).toBe(true);
    expect(isPictoType('application/pdf', 'a.pdf')).toBe(false);
  });
});
