import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore, flushAutosave, lastCopiedSystemText } from './store';
import { newDoc, makeShape, makeText } from './elements';
import type { LabelDoc } from './types';

const S = () => useStore.getState();
const ids = () => S().doc.elements.map((e) => e.id);

function load() {
  const d = newDoc({ widthIn: 4, heightIn: 2 });
  d.elements = [
    { ...makeShape(d, 'rect'), id: 'a', x: 10, y: 10 },
    { ...makeText(d, 'bonjour'), id: 'b', x: 100, y: 10 },
  ];
  S().loadDoc(d);
  useStore.setState({ ready: true, dirty: false, selected: [], past: [], future: [], lastKey: undefined, lastTime: 0, styleClip: null });
}

beforeEach(() => {
  localStorage.clear();
  load();
});

describe('annuler / rétablir', () => {
  it('annule puis rétablit une modification', () => {
    S().updateEls(['a'], { x: 50 });
    expect(S().doc.elements[0].x).toBe(50);
    S().undo();
    expect(S().doc.elements[0].x).toBe(10);
    expect(S().future).toHaveLength(1);
    S().redo();
    expect(S().doc.elements[0].x).toBe(50);
    expect(S().future).toHaveLength(0);
  });

  it('fusionne les étapes de même clé rapprochées dans le temps', () => {
    S().updateEls(['a'], { x: 11 }, 'drag');
    S().updateEls(['a'], { x: 12 }, 'drag');
    S().updateEls(['a'], { x: 13 }, 'drag');
    expect(S().past).toHaveLength(1);
    S().updateEls(['a'], { y: 99 }, 'autre');
    expect(S().past).toHaveLength(2);
    S().undo();
    S().undo();
    expect(S().doc.elements[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('ne fusionne pas sans clé', () => {
    S().updateEls(['a'], { x: 11 });
    S().updateEls(['a'], { x: 12 });
    expect(S().past).toHaveLength(2);
  });

  it('une nouvelle modification vide la pile « rétablir »', () => {
    S().updateEls(['a'], { x: 11 });
    S().undo();
    S().updateEls(['a'], { x: 20 });
    expect(S().future).toHaveLength(0);
  });

  it('sélection filtrée après annuler', () => {
    S().addElements([{ ...makeText(S().doc, 'nouveau'), id: 'c' }]);
    expect(S().selected).toEqual(['c']);
    S().undo();
    expect(S().selected).toEqual([]);
  });

  it('sélection filtrée après rétablir (éléments supprimés)', () => {
    S().select(['a']);
    S().removeSelected();
    expect(ids()).toEqual(['b']);
    S().undo();
    S().select(['a', 'b']);
    S().redo();
    expect(ids()).toEqual(['b']);
    expect(S().selected).toEqual(['b']);
  });

  it('édition de texte abandonnée si l’élément disparaît', () => {
    S().select(['b']);
    S().removeSelected();
    S().undo();
    useStore.setState({ editingTextId: 'b' });
    S().redo();
    expect(S().editingTextId).toBeNull();
  });
});

describe('modifications non enregistrées (dirty)', () => {
  it('une modification marque le document modifié', () => {
    S().updateEls(['a'], { x: 1 });
    expect(S().dirty).toBe(true);
  });

  it('zoomer ne marque pas le document modifié', () => {
    S().setZoom(2);
    expect(S().zoom).toBe(2);
    expect(S().doc.zoom).toBe(2);
    expect(S().dirty).toBe(false);
    expect(S().past).toHaveLength(0);
  });

  it('annuler / rétablir marquent le document modifié', () => {
    S().updateEls(['a'], { x: 1 });
    useStore.setState({ dirty: false });
    S().undo();
    expect(S().dirty).toBe(true);
  });
});

describe('dupliquer / copier', () => {
  it('dupliquer ne touche pas aux éléments copiés', () => {
    S().select(['a']);
    S().copySelected();
    S().select(['b']);
    S().duplicateSelected();
    expect(S().doc.elements).toHaveLength(3);
    S().paste();
    const pasted = S().doc.elements[3];
    expect(pasted.type).toBe('shape'); // c'est bien « a » qui est collé
  });

  it('la copie écrit le texte des éléments dans le presse-papiers système', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    S().select(['b']);
    S().copySelected();
    expect(writeText).toHaveBeenCalledWith('bonjour');
    await Promise.resolve();
    await Promise.resolve();
    expect(lastCopiedSystemText()).toBe('bonjour');
  });

  it('écriture refusée : texte système inconnu', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refus')) }, configurable: true });
    S().select(['b']);
    S().copySelected();
    await new Promise((r) => setTimeout(r, 0));
    expect(lastCopiedSystemText()).toBeNull();
  });
});

describe('copier / coller la mise en forme', () => {
  function withTexts() {
    const d = S().doc;
    S().addElements(
      [
        { ...makeText(d, 'source'), id: 's', x: 5, y: 6, w: 77, fontSize: 40, bold: true, italic: true, underline: true, color: '#d43b2a', align: 'right' },
        { ...makeText(d, 'cible'), id: 't', x: 300, y: 50, w: 120, fontSize: 12, bold: false, underline: undefined },
      ],
      false,
    );
    useStore.setState({ past: [] });
  }

  it('copie la mise en forme sans le contenu, la position ni la taille', () => {
    withTexts();
    S().select(['s']);
    expect(S().copyStyle()).toBe(true);
    const clip = S().styleClip!;
    expect(clip.type).toBe('text');
    expect(clip.style).toMatchObject({ fontSize: 40, bold: true, color: '#d43b2a', align: 'right' });
    for (const k of ['text', 'x', 'y', 'w', 'h', 'id', 'rotation']) expect(clip.style).not.toHaveProperty(k);
  });

  it('sans sélection, rien n’est copié', () => {
    expect(S().copyStyle()).toBe(false);
    expect(S().styleClip).toBeNull();
  });

  it('applique aux seuls éléments du même type, en une étape d’annulation', () => {
    withTexts();
    S().select(['s']);
    S().copyStyle();
    S().select(['t', 'a']); // « a » est une forme : ignorée
    expect(S().pasteStyle()).toBe(1);
    const t = S().doc.elements.find((e) => e.id === 't')!;
    expect(t).toMatchObject({ text: 'cible', x: 300, y: 50, w: 120, fontSize: 40, bold: true, italic: true, underline: true, color: '#d43b2a', align: 'right' });
    const a = S().doc.elements.find((e) => e.id === 'a')!;
    expect(a).toMatchObject({ x: 10, y: 10 });
    expect(S().past).toHaveLength(1);
    S().undo();
    expect(S().doc.elements.find((e) => e.id === 't')).toMatchObject({ fontSize: 12, bold: false });
  });

  it('efface les propriétés absentes de la source', () => {
    withTexts();
    S().updateEls(['s'], { underline: undefined });
    S().updateEls(['t'], { underline: true });
    S().select(['s']);
    S().copyStyle();
    S().select(['t']);
    S().pasteStyle();
    expect(S().doc.elements.find((e) => e.id === 't')!).toMatchObject({ underline: undefined });
  });

  it('aucun élément compatible : rien ne change', () => {
    withTexts();
    S().select(['s']);
    S().copyStyle();
    S().select(['a']);
    expect(S().pasteStyle()).toBe(0);
    expect(S().past).toHaveLength(0);
  });

  it('formes : l’arrondi ne s’applique qu’aux rectangles', () => {
    const d = S().doc;
    S().addElements([{ ...makeShape(d, 'roundrect'), id: 'r', radius: 12, fill: '#2563eb' }, { ...makeShape(d, 'ellipse'), id: 'e', fill: 'none' }], false);
    S().select(['r']);
    S().copyStyle();
    S().select(['a', 'e']);
    expect(S().pasteStyle()).toBe(2);
    const a = S().doc.elements.find((e) => e.id === 'a')!;
    const e = S().doc.elements.find((x) => x.id === 'e')!;
    expect(a).toMatchObject({ kind: 'roundrect', radius: 12, fill: '#2563eb' });
    expect(e).toMatchObject({ kind: 'ellipse', fill: '#2563eb' });
    expect(e).not.toHaveProperty('radius', 12);
  });
});

describe('élément suivant / précédent (Tab)', () => {
  // ordre des calques : du premier plan (dernier élément) vers l'arrière-plan
  it('sans sélection, sélectionne le premier (ou le dernier en arrière)', () => {
    expect(S().selectStep(1)).toBe(true);
    expect(S().selected).toEqual(['b']);
    useStore.setState({ selected: [] });
    expect(S().selectStep(-1)).toBe(true);
    expect(S().selected).toEqual(['a']);
  });

  it('avance, recule, puis vide la sélection au-delà du bout', () => {
    S().select(['b']);
    expect(S().selectStep(1)).toBe(true);
    expect(S().selected).toEqual(['a']);
    expect(S().selectStep(1)).toBe(false);
    expect(S().selected).toEqual([]);
    S().select(['a']);
    expect(S().selectStep(-1)).toBe(true);
    expect(S().selected).toEqual(['b']);
    expect(S().selectStep(-1)).toBe(false);
    expect(S().selected).toEqual([]);
  });

  it('saute les éléments masqués et traite un groupe comme un seul élément', () => {
    const d = S().doc;
    S().addElements(
      [
        { ...makeText(d, 'g1'), id: 'g1', groups: ['G'] },
        { ...makeText(d, 'g2'), id: 'g2', groups: ['G'] },
        { ...makeText(d, 'cache'), id: 'h', hidden: true },
      ],
      false,
    );
    // ordre : h (masqué), [g2, g1], b, a
    S().selectStep(1);
    expect(S().selected.sort()).toEqual(['g1', 'g2']);
    S().selectStep(1);
    expect(S().selected).toEqual(['b']);
    S().selectStep(-1);
    expect(S().selected.sort()).toEqual(['g1', 'g2']);
  });

  it('ne crée pas d’étape d’annulation', () => {
    S().selectStep(1);
    expect(S().past).toHaveLength(0);
  });
});

describe('dupliquer en décalant (Alt+flèche)', () => {
  it('copie la sélection décalée, sélectionne la copie, une étape d’annulation', () => {
    S().select(['a']);
    S().duplicateBy(20, 0);
    expect(S().doc.elements).toHaveLength(3);
    const copy = S().doc.elements[2];
    expect(copy.id).not.toBe('a');
    expect(copy).toMatchObject({ type: 'shape', x: 30, y: 10 });
    expect(S().selected).toEqual([copy.id]);
    S().duplicateBy(0, -5);
    expect(S().doc.elements[3]).toMatchObject({ x: 30, y: 5 });
    expect(S().past).toHaveLength(2);
    S().undo();
    expect(S().doc.elements).toHaveLength(3);
  });

  it('sans sélection, ne fait rien', () => {
    S().duplicateBy(10, 10);
    expect(S().doc.elements).toHaveLength(2);
    expect(S().past).toHaveLength(0);
  });

  it('la copie est déverrouillée', () => {
    S().updateEls(['a'], { locked: true });
    S().select(['a']);
    S().duplicateBy(0, 10);
    expect(S().doc.elements[2].locked).toBe(false);
  });
});

describe('verrouiller / masquer / même type', () => {
  it('bascule le verrouillage et le masquage de la sélection', () => {
    S().select(['a', 'b']);
    S().toggleLockSelected();
    expect(S().doc.elements.every((e) => e.locked)).toBe(true);
    S().toggleLockSelected();
    expect(S().doc.elements.some((e) => e.locked)).toBe(false);
    S().toggleHiddenSelected();
    expect(S().doc.elements.every((e) => e.hidden)).toBe(true);
    S().toggleHiddenSelected();
    expect(S().doc.elements.some((e) => e.hidden)).toBe(false);
  });

  it('sélectionne les éléments visibles du même type', () => {
    const d = S().doc;
    S().addElements([{ ...makeText(d, 'x'), id: 'c' }, { ...makeText(d, 'y'), id: 'h', hidden: true }], false);
    S().select(['b']);
    S().selectSameType();
    expect(S().selected).toEqual(['b', 'c']);
  });
});

describe('sauvegarde automatique', () => {
  it('ne persiste que le document courant (pas l’historique d’annulation)', async () => {
    S().updateEls(['a'], { x: 1 });
    S().updateEls(['a'], { x: 2 });
    await flushAutosave();
    const saved = JSON.parse(localStorage.getItem('mlz.current') || 'null');
    expect(saved.doc.elements[0].x).toBe(2);
    expect(saved.past).toBeUndefined();
    expect(saved.future).toBeUndefined();
    expect(saved.dirty).toBe(true);
  });

  it('restaure le document au rechargement, ignore un ancien historique persisté', async () => {
    const doc: LabelDoc = { ...newDoc(), id: 'restaure', name: 'Restauré' };
    localStorage.setItem('mlz.current', JSON.stringify({ doc, past: [newDoc(), newDoc()], future: [newDoc()], previewRow: 0, dirty: true }));
    await S().init();
    expect(S().doc.id).toBe('restaure');
    expect(S().past).toEqual([]);
    expect(S().future).toEqual([]);
    expect(S().dirty).toBe(true);
  });
});
