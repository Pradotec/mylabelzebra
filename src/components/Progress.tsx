import { useEffect, useState } from 'react';
import { useProgress, cancelProgress } from '../progress';
import { t } from '../i18n';

/** Délai avant affichage : les petits exports se terminent sans clignotement */
const SHOW_AFTER = 400;

/** Barre de progression des traitements longs, avec bouton « Annuler » */
export function ProgressOverlay() {
  const { label, done, total, cancelRequested, token } = useProgress();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (label == null) return;
    const h = setTimeout(() => setVisible(true), SHOW_AFTER);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, label == null]);
  if (label == null || !visible) return null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="remote-banner pill" role="status" aria-live="polite" aria-label={label} style={{ zIndex: 1000 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>{label}</b>
        <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {total ? t('{x} / {n}', { x: done, n: total }) : t('En cours…')}
          {cancelRequested ? ' — ' + t('Annulation…') : ''}
        </div>
        <progress value={done} max={total || 1} style={{ width: '100%', marginTop: 4 }} aria-label={t('{p} %', { p: pct })} />
      </div>
      <button className="btn flat" disabled={cancelRequested} onClick={cancelProgress}>
        {t('Annuler')}
      </button>
    </div>
  );
}
