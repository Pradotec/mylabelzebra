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
  useStore.setState({ ready: true, dirty: false, selected: [], past: [], future: [], lastKey: undefined, lastTime: 0 });
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
