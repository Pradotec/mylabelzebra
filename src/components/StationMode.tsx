/**
 * Mode poste « scanner → imprimer » : écran plein écran pour un poste de préparation.
 * Une douchette USB (clavier, termine par Entrée) saisit un code ; la ligne de données
 * correspondante est imprimée aussitôt, par le chemin d'impression habituel (file
 * d'impression, historique, SSCC). Pas de caméra.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ScanBarcode, Volume2, VolumeX, Printer, Download, Play, Send, Ban, Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store';
import { useQueue, resumeJob, forceJob, cancelJob } from '../printQueue';
import { startJobDetailed, askPrompts, jobDoc } from '../jobs';
import { promptFields } from '../render/resolve';
import { renderLabel, labelSizeU } from '../render/draw';
import * as zebra from '../zebra';
import { NumField } from './ui';
import { t, tc, getLang } from '../i18n';
import { uid } from '../util';

/** Comparaison des codes : sans espaces, sans tenir compte de la casse */
export const normCode = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Lignes dont la colonne vaut exactement le code scanné (espaces et casse ignorés) */
export function findRows(rows: Record<string, string>[], column: string, code: string): number[] {
  const k = normCode(code);
  if (!k) return [];
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (normCode(String(r[column] ?? '')) === k) out.push(i);
  });
  return out;
}

/** Colonne de recherche proposée : la première contenant « ean », « code » ou « emplacement » */
export function guessColumn(columns: string[]): string {
  return columns.find((c) => /ean|code|emplacement/i.test(c)) ?? columns[0] ?? '';
}

const BEEP_KEY = 'mlz.station.beep';
const readBeep = () => {
  try {
    return localStorage.getItem(BEEP_KEY) !== '0';
  } catch {
    return true;
  }
};

let audio: AudioContext | null = null;
/** Bip court (WebAudio) ; silencieux si l'API est indisponible */
function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = 330;
    g.gain.value = 0.12;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.18);
  } catch {
    /* pas de son */
  }
}

interface Scan {
  id: string;
  at: number;
  code: string;
  status: 'pending' | 'ok' | 'error' | 'multi';
  msg?: string;
}

export function StationMode({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const columns = doc.data?.columns ?? [];
  const rows = doc.data?.rows ?? [];
  const fields = useMemo(() => promptFields(doc), [doc]);
  const [column, setColumn] = useState(() => guessColumn(columns));
  const [copies, setCopies] = useState(1);
  const [sound, setSound] = useState(readBeep);
  const [prompts, setPrompts] = useState<Record<string, string> | null>(fields.length ? null : {});
  const [output, setOutput] = useState<'checking' | 'zebra' | 'zpl'>('checking');
  const [code, setCode] = useState('');
  const [choices, setChoices] = useState<{ code: string; rows: number[]; scanId: string } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [recent, setRecent] = useState<Scan[]>([]);
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const problem = useQueue((s) => s.items.find((i) => i.status === 'paused' && i.problem));

  useEffect(() => {
    if (!columns.includes(column)) setColumn(guessColumn(columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.join('\u0001')]);

  // sortie : Zebra si une imprimante est mémorisée ou définie par défaut dans Browser Print
  useEffect(() => {
    let alive = true;
    (async () => {
      let ok = !!zebra.lastPrinter();
      if (!ok) ok = !!(await zebra.getDefaultPrinter().catch(() => null));
      if (alive) setOutput(ok ? 'zebra' : 'zpl');
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Ramène le focus dans le champ de scan (sauf fenêtre de saisie ouverte ou autre champ du poste) */
  const refocus = () =>
    setTimeout(() => {
      if (document.querySelector('.overlay')) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== inputRef.current && rootRef.current?.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      inputRef.current?.focus({ preventScroll: true });
    }, 0);

  // valeurs {{?…}} : saisies une fois au début de la session
  const askValues = async () => {
    const v = await askPrompts(doc, fields, prompts ?? {});
    if (v) setPrompts(v);
    refocus();
    return v;
  };
  useEffect(() => {
    if (fields.length && !prompts) void askValues();
    refocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // retour dans la fenêtre (Alt+Tab…) : focus sur le champ de scan
  useEffect(() => {
    window.addEventListener('focus', refocus);
    return () => window.removeEventListener('focus', refocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Échap : ferme la liste de choix, sinon le mode poste. Les touches ne remontent pas
  // jusqu'aux raccourcis de l'éditeur (la douchette « tape » au clavier).
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== 'Escape' || document.querySelector('.overlay')) return;
    e.preventDefault();
    if (choices) {
      setChoices(null);
      refocus();
    } else onClose();
  };

  const pushScan = (s: Scan) => setRecent((l) => [s, ...l].slice(0, 10));
  const patchScan = (id: string, p: Partial<Scan>) => setRecent((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const fail = (text: string) => {
    setMessage({ kind: 'error', text });
    if (sound) beep();
  };

  const renderPreview = (row: number, values: Record<string, string>) => {
    try {
      const { W, H } = labelSizeU(doc);
      setPreview(renderLabel(jobDoc(doc, values), { index: row, scale: 360 / Math.max(W, H) }).toDataURL('image/png'));
    } catch {
      setPreview('');
    }
  };

  const printRow = async (row: number, scanned: string, scanId?: string) => {
    let values = prompts;
    if (!values) {
      values = await askValues();
      if (!values) {
        fail(t('Valeurs à saisir manquantes : impression annulée.'));
        if (scanId) patchScan(scanId, { status: 'error', msg: t('Valeurs à saisir manquantes') });
        return;
      }
    }
    const id = scanId ?? uid();
    if (scanId) patchScan(id, { status: 'pending', msg: undefined });
    else pushScan({ id, at: Date.now(), code: scanned, status: 'pending' });
    setMessage({ kind: 'info', text: t('Ligne {r} : impression…', { r: row + 1 }) });
    renderPreview(row, values);
    refocus();
    const kind = output === 'zebra' ? 'zebra' : 'zpl-fichier';
    const r = await startJobDetailed(kind, { doc, onlyCurrent: true, currentRow: row, copies, prompts: values, noAsk: true, source: t('Mode poste') });
    if (!r) {
      patchScan(id, { status: 'error', msg: t('Non imprimé') });
      fail(t('« {c} » : impression annulée ou en échec.', { c: scanned }));
    } else {
      setCount((n) => n + r.count);
      const partial = r.count < r.planned;
      patchScan(id, { status: partial ? 'error' : 'ok', msg: t('Ligne {r}', { r: row + 1 }) + (partial ? ' — ' + t('{n} étiquette(s) sur {t} envoyée(s)', { n: r.count, t: r.planned }) : '') });
      if (partial) fail(t('{n} étiquette(s) sur {t} envoyée(s)', { n: r.count, t: r.planned }));
      else if (kind === 'zpl-fichier') setMessage({ kind: 'ok', text: t('Ligne {r} : fichier .zpl téléchargé ({n} étiquette(s)).', { r: row + 1, n: r.count }) });
      else setMessage({ kind: 'ok', text: t('Ligne {r} imprimée ({n} étiquette(s)).', { r: row + 1, n: r.count }) });
    }
    refocus();
  };

  const onScan = (raw: string) => {
    const scanned = raw.trim();
    setCode('');
    if (!scanned) return;
    setChoices(null);
    if (output === 'checking') {
      fail(t('Recherche de l’imprimante…') + ' ' + t('Scannez à nouveau dans un instant.'));
      return;
    }
    if (!rows.length || !column) {
      fail(t('Aucune donnée importée : importez un fichier dans le panneau Données.'));
      return;
    }
    const hits = findRows(rows, column, scanned);
    if (!hits.length) {
      pushScan({ id: uid(), at: Date.now(), code: scanned, status: 'error', msg: t('Introuvable') });
      fail(t('« {c} » introuvable dans la colonne « {col} ».', { c: scanned, col: column }));
    } else if (hits.length === 1) void printRow(hits[0], scanned);
    else {
      const id = uid();
      pushScan({ id, at: Date.now(), code: scanned, status: 'multi', msg: t('{n} lignes', { n: hits.length }) });
      setChoices({ code: scanned, rows: hits, scanId: id });
      setMessage({ kind: 'info', text: t('{n} lignes correspondent à « {c} » : choisissez.', { n: hits.length, c: scanned }) });
    }
    refocus();
  };

  const fmt = (n: number) => new Date(n).toLocaleTimeString(getLang() === 'fr' ? 'fr-FR' : 'en-US');
  const rowLabel = (i: number) =>
    columns
      .slice(0, 4)
      .map((c) => rows[i]?.[c])
      .filter(Boolean)
      .join(' · ');
  const msgColor = message?.kind === 'error' ? 'var(--err)' : message?.kind === 'ok' ? 'var(--ok)' : 'var(--ink-2)';

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('Mode poste')}
      style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: 'var(--panel)', boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
        <ScanBarcode size={22} />
        <b style={{ fontSize: 17 }}>{t('Mode poste')}</b>
        <span className="hint" style={{ margin: 0 }}>
          {doc.name}
        </span>
        <span style={{ flex: 1 }} />
        <label className="f" style={{ width: 180 }}>
          {t('Colonne de recherche')}
          <select className="inp" value={column} onChange={(e) => (setColumn(e.target.value), refocus())} disabled={!columns.length}>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div style={{ width: 110 }}>
          <NumField label={t('Copies par scan')} value={copies} min={1} max={999} decimals={0} onChange={(v) => setCopies(Math.max(1, Math.round(v)))} />
        </div>
        <button
          className="btn"
          aria-pressed={sound}
          title={t('Bip en cas d’erreur')}
          onClick={() => {
            const v = !sound;
            setSound(v);
            try {
              localStorage.setItem(BEEP_KEY, v ? '1' : '0');
            } catch {
              /* ignore */
            }
            refocus();
          }}
        >
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} {sound ? t('Bip activé') : t('Bip désactivé')}
        </button>
        <button className="btn dark" onClick={onClose} title={t('Fermer le mode poste (Échap)')}>
          <X size={16} /> {t('Fermer')}
        </button>
      </header>

      <div style={{ display: 'flex', gap: 20, padding: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <section style={{ flex: '2 1 420px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', padding: 18 }}>
            <div className="hint" style={{ fontSize: 13 }}>
              {output === 'zebra' ? (
                <>
                  <Printer size={14} style={{ verticalAlign: -2 }} /> {t('Sortie : imprimante Zebra (file d’impression, état vérifié avant l’envoi).')}
                </>
              ) : output === 'zpl' ? (
                <b style={{ color: 'var(--accent)' }}>
                  <Download size={14} style={{ verticalAlign: -2 }} /> {t('Aucune imprimante Zebra configurée : chaque scan télécharge un fichier .zpl.')}
                </b>
              ) : (
                t('Recherche de l’imprimante…')
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onScan(code);
              }}
            >
              <input
                ref={inputRef}
                className="inp"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label={t('Code scanné')}
                placeholder={t('Scannez un code…')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={refocus}
                style={{ height: 64, fontSize: 28, fontFamily: 'ui-monospace, Consolas, monospace', padding: '8px 16px' }}
              />
            </form>
            {message && (
              <div
                role={message.kind === 'error' ? 'alert' : 'status'}
                style={{
                  marginTop: 12,
                  padding: message.kind === 'error' ? '14px 16px' : '8px 0',
                  borderRadius: 12,
                  fontSize: message.kind === 'error' ? 20 : 15,
                  fontWeight: 700,
                  color: message.kind === 'error' ? '#fff' : msgColor,
                  background: message.kind === 'error' ? 'var(--err)' : 'transparent',
                }}
              >
                {message.kind === 'error' ? <AlertTriangle size={20} style={{ verticalAlign: -3 }} /> : message.kind === 'ok' ? <CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> : null} {message.text}
              </div>
            )}
            {!rows.length && <div className="err" style={{ marginTop: 10 }}>{t('Aucune donnée importée : importez un fichier dans le panneau Données.')}</div>}
          </div>

          {problem && (
            <div role="alert" style={{ background: '#fff', border: '2px solid var(--err)', borderRadius: 'var(--r)', padding: 14 }}>
              <b style={{ color: 'var(--err)' }}>
                <AlertTriangle size={16} style={{ verticalAlign: -3 }} /> {problem.message}
              </b>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn accent" onClick={() => (resumeJob(problem.id), refocus())}>
                  <Play size={15} /> {t('Reprendre')}
                </button>
                {problem.canForce && (
                  <button className="btn" onClick={() => (forceJob(problem.id), refocus())}>
                    <Send size={15} /> {t('Envoyer quand même')}
                  </button>
                )}
                <button className="btn flat" style={{ color: 'var(--err)' }} onClick={() => (cancelJob(problem.id), refocus())}>
                  <Ban size={15} /> {tc('Annuler', 'cancel')}
                </button>
              </div>
            </div>
          )}

          {choices && (
            <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', padding: 14 }}>
              <b>{t('Plusieurs lignes pour « {c} »', { c: choices.code })}</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {choices.rows.map((i) => (
                  <button
                    key={i}
                    className="btn"
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => {
                      const { code: c, scanId } = choices;
                      setChoices(null);
                      // la ligne choisie met à jour l'entrée « N lignes » du scan
                      void printRow(i, c, scanId);
                    }}
                  >
                    <b>{t('Ligne {r}', { r: i + 1 })}</b> <span style={{ color: 'var(--ink-2)' }}>{rowLabel(i)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {fields.length > 0 && (
            <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ flex: 1 }}>{t('Valeurs saisies pour la session')}</b>
                <button className="btn sm" onClick={() => void askValues()}>
                  <Pencil size={14} /> {t('Modifier')}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {prompts
                  ? fields.map((f) => `${f} : ${prompts[f] ?? ''}`).join(' · ')
                  : t('Pas encore saisies : elles seront demandées au premier scan.')}
              </div>
            </div>
          )}
        </section>

        <aside style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', padding: 14, textAlign: 'center' }}>
            <div className="hint">{t('Étiquettes imprimées pendant la session')}</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
            {preview ? (
              <img src={preview} alt={t('Aperçu de la dernière étiquette')} style={{ maxWidth: '100%', maxHeight: 260, background: '#fff', boxShadow: 'var(--shadow)', borderRadius: 6 }} />
            ) : (
              <div className="hint">{t('L’aperçu de la dernière étiquette s’affichera ici.')}</div>
            )}
          </div>
          <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow)', padding: 14 }}>
            <b>{t('Derniers scans')}</b>
            {!recent.length && <div className="hint" style={{ marginTop: 6 }}>{t('Aucun scan pour l’instant.')}</div>}
            <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recent.map((s) => (
                <li key={s.id} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.at)}</span>
                  <code style={{ fontWeight: 700 }}>{s.code}</code>
                  <span style={{ flex: 1, color: s.status === 'error' ? 'var(--err)' : s.status === 'ok' ? 'var(--ok)' : 'var(--ink-2)' }}>
                    {s.status === 'pending' ? t('en cours…') : s.msg}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="hint">{t('Douchette USB (mode clavier, Entrée en fin de code) uniquement : la caméra n’est pas prise en charge.')}</div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
