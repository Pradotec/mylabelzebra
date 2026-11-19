import { describe, it, expect, afterEach } from 'vitest';
import { t, tc, setLang } from './i18n';
import { EN } from './i18n.en';

describe('i18n', () => {
  afterEach(() => setLang('fr'));

  it('tc : « Annuler » au sens Cancel distinct de l’annulation (Undo)', () => {
    expect(tc('Annuler', 'cancel')).toBe('Annuler');
    setLang('en');
    expect(t('Annuler')).toBe('Undo');
    expect(tc('Annuler', 'cancel')).toBe('Cancel');
    // contexte inconnu : retombe sur la traduction simple
    expect(tc('Annuler', 'inconnu')).toBe('Undo');
  });

  it('les variables {x} des traductions anglaises sont celles du texte français (les {{champs}} d’exemple peuvent être traduits)', () => {
    const ph = (s: string) => (s.match(/(?<!\{)\{[a-z]+\}(?!\})/gi) ?? []).sort().join(',');
    const bad = Object.entries(EN).filter(([fr, en]) => ph(fr.replace(/\|[a-z]+$/, '')) !== ph(en));
    expect(bad).toEqual([]);
  });
});