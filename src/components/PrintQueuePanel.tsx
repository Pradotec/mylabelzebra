import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Pause, Play, Ban, Send, RotateCcw, ListOrdered, Trash2 } from 'lucide-react';
import { useQueue, pauseJob, resumeJob, forceJob, cancelJob, clearFinished, isActive, type QueueItem, type QueueStatus } from '../printQueue';
import { listHistory, resumeHistory, isIncomplete, plannedCount, JOB_LABELS, type HistoryEntry, type JobKind } from '../jobs';
import { getChunkSize, setChunkSize, DEFAULT_CHUNK } from '../actions';
import { NumField } from './ui';
import { t, tc, getLang } from '../i18n';

export const STATUS_LABELS: Record<QueueStatus, string> = {
  pending: 'En attente',
  running: 'En cours',
  paused: 'En pause',
  done: 'Terminé',
  error: 'Erreur',
  cancelled: 'Annulé',
};
const STATUS_COLORS: Record<QueueStatus, string> = {
  pending: 'var(--ink-3)',
  running: 'var(--accent)',
  paused: '#c07a00',
  done: 'var(--ok)',
  error: 'var(--err)',
  cancelled: 'var(--ink-3)',
};

export const kindLabel = (kind: string) => (kind === 'remote' ? t('Demande distante') : t(JOB_LABELS[kind as JobKind] ?? kind));

function StatusBadge({ s }: { s: QueueStatus }) {
  return <span style={{ background: STATUS_COLORS[s], color: '#fff', borderRadius: 999, fontSize: 11, padding: '1px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>{t(STATUS_LABELS[s])}</span>;
}

/** « Reprendre à partir de l'étiquette N » pour une entrée d'historique incomplète */
function ResumeControl({ entry, onDone }: { entry: HistoryEntry; onDone?: () => void }) {
  const total = plannedCount(entry);
  const [from, setFrom] = useState(Math.min(total, entry.count + 1));
  const [busy, setBusy] = useState(false);
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 6, marginTop: 6 }}>
      <div style={{ width: 90 }}>
        <NumField label={t('À partir de l’étiquette')} value={from} min={1} max={total} decimals={0} onChange={(v) => setFrom(Math.round(v))} />
      </div>
      <button
        className="btn sm"
        disabled={busy}
        title={t('Renvoie les étiquettes à partir de ce numéro, avec les mêmes données, valeurs saisies et SSCC')}
        onClick={async () => {
          setBusy(true);
          try {
            const r = resumeHistory(entry, from);
            onDone?.();
            await r;
          } finally {
            setBusy(false);
          }
        }}
      >
        <RotateCcw size={14} /> {t('Reprendre')}
      </button>
    </div>
  );
}

function QueueRow({ it, history }: { it: QueueItem; history: HistoryEntry[] }) {
  const entry = it.historyId ? history.find((h) => h.id === it.historyId) : undefined;
  const pct = it.total ? Math.round((it.sent / it.total) * 100) : 0;
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>
          {it.name}
        </b>
        <StatusBadge s={it.status} />
      </div>
      <div className="hint" style={{ margin: '2px 0 4px' }}>
        {kindLabel(it.kind)}
        {it.source ? ' · ' + (it.source === 'url' ? t('lien') : it.source) : ''}
        {it.total ? ' · ' + t('{x} / {n} étiquette(s)', { x: it.sent, n: it.total }) : ''}
        {it.chunks > 1 && it.status === 'running' ? ' · ' + t('paquet {i}/{n}', { i: it.chunk, n: it.chunks }) : ''}
        {it.pauseRequested ? ' · ' + t('pause au prochain paquet') : ''}
      </div>
      {it.total > 0 && isActive(it.status) && <progress value={it.sent} max={it.total} style={{ width: '100%' }} aria-label={t('{p} %', { p: pct })} />}
      {it.message && (
        <div style={{ fontSize: 12.5, fontWeight: it.problem ? 700 : 400, color: it.problem || it.status === 'error' ? 'var(--err)' : 'var(--ink-2)', margin: '4px 0' }} role={it.problem ? 'alert' : undefined}>
          {it.message}
        </div>
      )}
      {isActive(it.status) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {it.status === 'paused' ? (
            <button className="btn sm accent" onClick={() => resumeJob(it.id)} title={it.problem ? t('Vérifie à nouveau l’état de l’imprimante puis continue') : undefined}>
              <Play size={14} /> {t('Reprendre')}
            </button>
          ) : (
            <button className="btn sm" disabled={it.pauseRequested} onClick={() => pauseJob(it.id)}>
              <Pause size={14} /> {t('Pause')}
            </button>
          )}
          {it.canForce && (
            <button className="btn sm" onClick={() => forceJob(it.id)} title={t('L’état de l’imprimante n’a pas pu être lu : envoyer sans vérification')}>
              <Send size={14} /> {t('Envoyer quand même')}
            </button>
          )}
          <button className="btn sm flat" style={{ color: 'var(--err)' }} onClick={() => cancelJob(it.id)}>
            <Ban size={14} /> {tc('Annuler', 'cancel')}
          </button>
        </div>
      )}
      {!isActive(it.status) && entry && isIncomplete(entry) && <ResumeControl entry={entry} />}
    </div>
  );
}

/** Panneau de la file d'impression (travaux en cours, en attente, terminés ; travaux incomplets) */
export function PrintQueuePanel({ onClose }: { onClose: () => void }) {
  const items = useQueue((s) => s.items);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [chunk, setChunk] = useState(getChunkSize());
  // l'historique est relu quand un travail se termine (entrée incomplète, reprise)
  const finished = items.filter((i) => !isActive(i.status)).length;
  useEffect(() => {
    let alive = true;
    listHistory()
      .then((l) => alive && setHistory(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [finished]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.overlay') && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const active = items.filter((i) => isActive(i.status));
  const done = items.filter((i) => !isActive(i.status)).reverse();
  const inQueue = new Set(items.map((i) => i.historyId));
  const incomplete = history.filter((h) => isIncomplete(h) && !inQueue.has(h.id)).slice(0, 10);
  const fmt = (n: number) => new Date(n).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });

  return createPortal(
    <div
      className="panel"
      role="dialog"
      aria-label={t('File d’impression')}
      data-focus-outside-ok
      style={{ position: 'fixed', right: 16, top: 70, width: 'min(400px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 90px)', zIndex: 85, boxShadow: 'var(--shadow-lg)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose();
      }}
    >
      <div className="panel-h">
        <ListOrdered size={18} />
        <span>{t('File d’impression')}</span>
        <span className="spacer" />
        <button className="icon-btn flat sm" onClick={onClose} aria-label={t('Fermer')}>
          <X size={16} />
        </button>
      </div>
      <div className="panel-b">
        <div className="hint">{t('Impressions de l’éditeur, du mode poste et des demandes d’autres outils, une à la fois. Envoi Zebra par paquets, état de l’imprimante vérifié avant chaque paquet.')}</div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <div style={{ width: 130 }}>
            <NumField
              label={t('Paquet (étiquettes)')}
              value={chunk}
              min={1}
              max={1000}
              decimals={0}
              title={t('Nombre d’étiquettes envoyées entre deux vérifications de l’imprimante (défaut : {n})', { n: DEFAULT_CHUNK })}
              onChange={(v) => {
                setChunk(Math.round(v));
                setChunkSize(v);
              }}
            />
          </div>
        </div>
        {!items.length && !incomplete.length && <div className="hint" style={{ marginTop: 10 }}>{t('Aucun travail dans la file.')}</div>}
        {active.map((it) => (
          <QueueRow key={it.id} it={it} history={history} />
        ))}
        {!!done.length && (
          <>
            <div className="sec-t" style={{ marginTop: 12, display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{t('Terminés')}</span>
              <button className="btn sm flat" onClick={clearFinished}>
                <Trash2 size={13} /> {t('Vider')}
              </button>
            </div>
            {done.map((it) => (
              <QueueRow key={it.id} it={it} history={history} />
            ))}
          </>
        )}
        {!!incomplete.length && (
          <>
            <div className="sec-t" style={{ marginTop: 12 }}>
              {t('Travaux incomplets (historique)')}
            </div>
            {incomplete.map((h) => (
              <div key={h.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
                <b>{h.name}</b>
                <div className="hint" style={{ margin: '2px 0 0' }}>
                  {fmt(h.at)} · {kindLabel(h.kind)} · {t('{n} étiquette(s) sur {t} envoyée(s)', { n: h.count, t: plannedCount(h) })}
                </div>
                <ResumeControl entry={h} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
