import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Trash2, Copy, Pencil, HelpCircle, Printer, Monitor, RefreshCw, AlertTriangle, CheckCircle2, Download, FileDown, Grid3x3, Barcode, QrCode, Plus, ExternalLink, Settings2, History, RotateCcw, FormInput, Play } from 'lucide-react';
import { useStore } from '../store';
import { Modal, NumField, Seg, Check } from './ui';
import { t, tc, getLang, setLang, LANGS } from '../i18n';
import { listSaved, deleteSaved, renameSaved, duplicateSaved, confirmDiscard, MAX_SAVED, setLabelSize } from '../actions';
import type { SavedLabel, Symbology, QrLevel, LabelDoc } from '../types';
import { batchJobs } from '../render/resolve';
import { testPrint, sheetPages } from '../export';
import { startJob, listHistory, clearHistory, deleteHistory, reprint, resumeHistory, isIncomplete, plannedCount, historyDocForEditing, JOB_LABELS, MAX_HISTORY, type HistoryEntry } from '../jobs';
import { useQueue, isActive } from '../printQueue';
import * as zebra from '../zebra';
import { SHEETS, sheetById, sizeLabel } from '../sizes';
import { SYMBOLOGIES, encodeBarcode, encodeQr, is2D } from '../render/codes';
import { renderLabel, incoPrintSummary } from '../render/draw';
import { makeBarcode, makeQr, newDoc } from '../elements';
import { canvasToBlob, downloadBlob, copyText } from '../util';
import { promptFields } from '../render/resolve';
import { encodeBase64Url, listAutoPrint, revokeAutoPrint } from '../remote';
import { BASE_DPI } from '../types';
import { validatePrompts, type PromptError, type PromptSpec } from '../prompts';
import { openSideDialog, useFoodReport } from './SideDialogs';

const closeModal = () => useStore.getState().set('modal', null);

/**
 * Lance un travail et appelle `onQueued` dès qu'il entre dans la file d'impression
 * (Zebra, « Cet ordinateur », planches, réimpression, reprise) : la fenêtre n'attend pas la
 * fin de l'envoi, qui peut rester en pause (imprimante pas prête) — le panneau de la file
 * prend le relais. Les exports de fichiers n'entrent pas dans la file : `onQueued` n'est
 * pas appelé et la promesse se résout à la fin du travail, comme avant.
 */
async function runUntilQueued<T>(start: () => Promise<T>, onQueued: (ahead: number) => void): Promise<T> {
  const before = useQueue.getState().items;
  const known = new Set(before.map((i) => i.id));
  const ahead = before.filter((i) => isActive(i.status)).length;
  let queued = false;
  const unsub = useQueue.subscribe((s) => {
    if (queued || !s.items.some((i) => !known.has(i.id))) return;
    queued = true;
    onQueued(ahead);
  });
  try {
    return await start();
  } finally {
    unsub();
  }
}

/** Message quand un travail attend son tour derrière d'autres */
const toastQueuedBehind = (ahead: number) => ahead > 0 && useStore.getState().toast(t('Ajouté à la file d’impression : {n} travail(aux) avant celui-ci.', { n: ahead }), 'info');

// ---------- Mes étiquettes ----------
export function SavedLabels() {
  const st = useStore();
  const [list, setList] = useState<SavedLabel[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const refresh = () => listSaved().then(setList);
  useEffect(() => {
    refresh();
  }, [st.savedVersion]);
  return (
    <Modal title={t('Mes étiquettes')} wide icon={<FolderOpen size={20} />} onClose={closeModal}>
      <div className="hint">
        {t('Enregistrées dans ce navigateur (jusqu’à {n}). Les plus récentes en premier.', { n: MAX_SAVED })} {list ? `${list.length}/${MAX_SAVED}` : ''}
      </div>
      {list && !list.length && <div className="hint">{t('Aucune étiquette enregistrée. Cliquez sur « Enregistrer » en haut à droite.')}</div>}
      <div className="gallery">
        {list?.map((s) => (
          <div key={s.doc.id} className="card" style={{ cursor: 'default' }}>
            <button
              className="thumb"
              style={{ border: 0, cursor: 'pointer' }}
              onClick={() => {
                if (!confirmDiscard()) return;
                st.loadDoc(s.doc, true);
                closeModal();
              }}
              title={t('Ouvrir')}
            >
              {s.thumb ? <img src={s.thumb} alt="" /> : null}
            </button>
            {renaming === s.doc.id ? (
              <input
                className="inp"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={async (e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    await renameSaved(s.doc.id, name);
                    setRenaming(null);
                    refresh();
                  }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={async () => {
                  await renameSaved(s.doc.id, name);
                  setRenaming(null);
                  refresh();
                }}
              />
            ) : (
              <div className="t">{s.doc.name}</div>
            )}
            <div className="s">
              {sizeLabel(s.doc.widthIn, s.doc.heightIn)} · {new Date(s.savedAt).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
            <div className="row" style={{ margin: 0, gap: 2 }}>
              <button className="icon-btn flat sm" title={t('Renommer')} aria-label={t('Renommer')} onClick={() => (setRenaming(s.doc.id), setName(s.doc.name))}>
                <Pencil size={14} />
              </button>
              <button className="icon-btn flat sm" title={t('Dupliquer')} aria-label={t('Dupliquer')} onClick={async () => (await duplicateSaved(s.doc.id), refresh())}>
                <Copy size={14} />
              </button>
              <button
                className="icon-btn flat sm"
                title={t('Supprimer')}
                aria-label={t('Supprimer')}
                style={{ color: 'var(--err)' }}
                onClick={async () => {
                  if (!window.confirm(t('Supprimer « {n} » ?', { n: s.doc.name }))) return;
                  await deleteSaved(s.doc.id);
                  refresh();
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Saisie à l'impression ({{?Nom}}) ----------
/**
 * Fenêtre de saisie des champs {{?Nom}} : un contrôle par type de champ (liste, GTIN,
 * nombre borné, texte), champs obligatoires marqués « * ». Mode douchette : Entrée passe
 * au champ suivant et valide sur le dernier. La validation est bloquée tant qu'une valeur
 * est refusée (message sous le champ, focus sur le premier champ en erreur).
 */
export function PromptDialog() {
  const ask = useStore((s) => s.promptAsk);
  const [vals, setVals] = useState<Record<string, string>>(ask?.values ?? {});
  const [errs, setErrs] = useState<Record<string, PromptError>>({});
  const refs = useRef<(HTMLInputElement | HTMLSelectElement | null)[]>([]);
  useEffect(() => {
    setVals(ask?.values ?? {});
    setErrs({});
  }, [ask]);
  if (!ask) return null;
  const specs: PromptSpec[] = ask.fields.map((f) => ask.specs?.find((s) => s.name === f) ?? { name: f, type: 'text', required: false });
  const ok = () => {
    const e = validatePrompts(specs, vals);
    setErrs(e);
    const first = specs.findIndex((s) => e[s.name]);
    if (first >= 0) {
      refs.current[first]?.focus();
      return;
    }
    ask.resolve(vals);
  };
  const set = (name: string, v: string) => {
    setVals({ ...vals, [name]: v });
    if (errs[name]) {
      const n = { ...errs };
      delete n[name];
      setErrs(n);
    }
  };
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') ask.resolve(null);
    else if (e.key === 'Enter') {
      // douchette : le lecteur envoie Entrée après chaque code
      e.preventDefault();
      if (i < specs.length - 1) refs.current[i + 1]?.focus();
      else ok();
    }
  };
  return (
    <Modal
      title={t('Valeurs à saisir pour cette impression')}
      icon={<FormInput size={20} />}
      onClose={() => ask.resolve(null)}
      footer={
        <>
          <button className="btn flat" onClick={() => ask.resolve(null)}>
            {tc('Annuler', 'cancel')}
          </button>
          <button className="btn accent" onClick={ok}>
            <Printer size={16} /> {t('Continuer')}
          </button>
        </>
      }
    >
      <div className="hint">{t('Ces valeurs s’appliquent à toutes les étiquettes de ce travail. Les dernières valeurs sont mémorisées pour cette étiquette.')}</div>
      {specs.some((s) => s.required) && <div className="hint">{t('* champ obligatoire')}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
        noValidate
      >
        {specs.map((sp, i) => {
          const f = sp.name;
          const err = errs[f];
          const errId = `prompt-err-${i}`;
          const common = {
            className: 'inp' + (err ? ' bad' : ''),
            autoFocus: i === 0,
            onKeyDown: onKey(i),
            'aria-label': f,
            'aria-required': sp.required || undefined,
            'aria-invalid': err ? true : undefined,
            'aria-describedby': err ? errId : undefined,
          };
          return (
            <label key={f} className="f" style={{ marginBottom: 8 }}>
              <span>
                {f}
                {sp.required && <span style={{ color: '#e53e3e' }}> *</span>}
                {sp.type === 'gtin' && <span className="k" style={{ color: 'var(--ink-3)', fontSize: 12 }}> · GTIN</span>}
                {sp.type === 'number' && (sp.min != null || sp.max != null) && (
                  <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                    {' · '}
                    {sp.min != null && sp.max != null
                      ? t('entre {a} et {b}', { a: String(sp.min).replace('.', ','), b: String(sp.max).replace('.', ',') })
                      : sp.min != null
                        ? t('minimum {a}', { a: String(sp.min).replace('.', ',') })
                        : t('maximum {b}', { b: String(sp.max).replace('.', ',') })}
                  </span>
                )}
              </span>
              {sp.type === 'list' && sp.choices?.length ? (
                <select {...common} ref={(el) => void (refs.current[i] = el)} value={vals[f] ?? ''} onChange={(e) => set(f, e.target.value)}>
                  <option value="">{t('— Choisir —')}</option>
                  {/* valeur mémorisée hors liste : affichée pour être corrigée */}
                  {vals[f] && !sp.choices.includes(vals[f]) && <option value={vals[f]}>{vals[f]}</option>}
                  {sp.choices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : sp.type === 'number' ? (
                <input {...common} ref={(el) => void (refs.current[i] = el)} type="number" inputMode="decimal" step="any" min={sp.min} max={sp.max} value={vals[f] ?? ''} onChange={(e) => set(f, e.target.value)} />
              ) : (
                <input
                  {...common}
                  ref={(el) => void (refs.current[i] = el)}
                  inputMode={sp.type === 'gtin' ? 'numeric' : undefined}
                  autoComplete="off"
                  maxLength={sp.type === 'gtin' ? 14 : undefined}
                  value={vals[f] ?? ''}
                  onChange={(e) => set(f, e.target.value)}
                />
              )}
              {err && (
                <div className="err" id={errId} role="alert">
                  {t(err.msg, err.vars)}
                </div>
              )}
            </label>
          );
        })}
        <button type="submit" style={{ display: 'none' }} />
      </form>
    </Modal>
  );
}

// ---------- Historique d'impression ----------
export function HistoryModal() {
  const st = useStore();
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [busy, setBusy] = useState('');
  /** entrée incomplète dont on règle le numéro de reprise */
  const [resumeAt, setResumeAt] = useState<{ id: string; from: number } | null>(null);
  const refresh = () => listHistory().then(setList);
  useEffect(() => {
    refresh();
  }, []);
  // réimpression / reprise : boutons bloqués jusqu'à l'entrée dans la file seulement (un
  // envoi Zebra en pause ne bloque pas la fenêtre) ; liste relue à la fin du travail
  const launch = async (id: string, start: () => Promise<unknown>) => {
    setBusy(id);
    let queued = false;
    try {
      await runUntilQueued(start, (ahead) => {
        queued = true;
        setBusy('');
        toastQueuedBehind(ahead);
      });
    } finally {
      if (!queued) setBusy('');
      refresh();
    }
  };
  const fmt = (n: number) => new Date(n).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'medium' });
  const rowsLabel = (e: HistoryEntry) => {
    if (!e.rows.length) return '';
    const r = e.rows.map((i) => i + 1);
    return r.length > 8 ? `${r.slice(0, 8).join(', ')}… (${r.length})` : r.join(', ');
  };
  return (
    <Modal
      title={t('Historique d’impression')}
      wide
      icon={<History size={20} />}
      onClose={closeModal}
      footer={
        <button
          className="btn flat"
          style={{ color: 'var(--err)' }}
          disabled={!list?.length}
          onClick={async () => {
            if (!window.confirm(t('Effacer tout l’historique d’impression ?'))) return;
            await clearHistory();
            refresh();
          }}
        >
          <Trash2 size={15} /> {t('Effacer l’historique')}
        </button>
      }
    >
      <div className="hint">
        {t('Conservé dans ce navigateur ({n} derniers travaux). « Réimprimer » reproduit exactement le travail (mêmes données, valeurs saisies et dates).', { n: MAX_HISTORY })}
      </div>
      {list && !list.length && <div className="hint">{t('Aucune impression pour l’instant.')}</div>}
      {!!list?.length && (
        <div className="scrollbox" style={{ maxHeight: '60vh' }}>
          <table className="data-table history-table">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Étiquette')}</th>
                <th>{t('Sortie')}</th>
                <th>{t('Nb')}</th>
                <th>{t('Lignes')}</th>
                <th>{t('Valeurs saisies')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const incomplete = isIncomplete(e);
                const planned = plannedCount(e);
                return (
                <Fragment key={e.id}>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(e.at)}</td>
                  <td title={e.name}>
                    {e.name}
                    {e.reprintOf ? <span className="k"> · {t('réimpression')}</span> : null}
                    {e.resumeOf ? <span className="k"> · {t('reprise')}</span> : null}
                    {e.source ? <span className="k"> · {e.source === 'url' ? t('lien') : e.source}</span> : null}
                  </td>
                  <td>{t(JOB_LABELS[e.kind])}</td>
                  <td style={incomplete ? { whiteSpace: 'nowrap', color: 'var(--err)', fontWeight: 700 } : undefined} title={incomplete ? t('{n} étiquette(s) sur {t} envoyée(s)', { n: e.count, t: planned }) : undefined}>
                    {incomplete ? t('{x} / {n} étiquette(s)', { x: e.count, n: planned }) : e.count}
                  </td>
                  <td title={e.rows.map((i) => i + 1).join(', ')}>{rowsLabel(e)}</td>
                  <td>
                    {Object.entries(e.prompts)
                      .map(([k, v]) => `${k} : ${v}`)
                      .join(' · ')}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {incomplete && (
                      <button
                        className="btn sm flat"
                        disabled={!!busy}
                        aria-expanded={resumeAt?.id === e.id}
                        title={t('Renvoie les étiquettes à partir de ce numéro, avec les mêmes données, valeurs saisies et SSCC')}
                        onClick={() => setResumeAt(resumeAt?.id === e.id ? null : { id: e.id, from: Math.min(planned, e.count + 1) })}
                      >
                        <Play size={14} /> {t('Reprendre à partir de l’étiquette…')}
                      </button>
                    )}
                    <button className="btn sm flat" disabled={!!busy} title={t('Réimprimer à l’identique')} onClick={() => launch(e.id, () => reprint(e))}>
                      <RotateCcw size={14} /> {t('Réimprimer')}
                    </button>
                    <button
                      className="btn sm flat"
                      title={t('Ouvrir cette version dans l’éditeur')}
                      onClick={() => {
                        if (!confirmDiscard()) return;
                        st.loadDoc(historyDocForEditing(e), true);
                        closeModal();
                      }}
                    >
                      <FolderOpen size={14} /> {t('Ouvrir')}
                    </button>
                    <button className="icon-btn flat sm" aria-label={t('Supprimer')} title={t('Supprimer')} onClick={async () => (await deleteHistory(e.id), refresh())}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
                {resumeAt?.id === e.id && (
                  <tr>
                    <td colSpan={7}>
                      <div className="row" style={{ alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ width: 130 }}>
                          <NumField label={t('À partir de l’étiquette')} value={resumeAt.from} min={1} max={planned} decimals={0} onChange={(v) => setResumeAt({ id: e.id, from: Math.max(1, Math.min(planned, Math.round(v))) })} />
                        </div>
                        <span className="hint" style={{ margin: 0 }}>
                          {t('Étiquettes {a} à {b} : mêmes données, valeurs saisies, date et SSCC.', { a: resumeAt.from, b: planned })}
                        </span>
                        <button
                          className="btn sm accent"
                          disabled={!!busy}
                          onClick={() => {
                            const from = resumeAt.from;
                            setResumeAt(null);
                            void launch(e.id, () => resumeHistory(e, from));
                          }}
                        >
                          <Play size={14} /> {t('Reprendre')}
                        </button>
                        <button className="btn sm flat" onClick={() => setResumeAt(null)}>
                          {tc('Annuler', 'cancel')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---------- Aide ----------
export function HelpModal() {
  const K = ({ k }: { k: string }) => <span className="kbd">{k}</span>;
  const rows: [string, string][] = [
    ['Ctrl+Z', 'Annuler (80 étapes, effacées au rechargement de la page)'],
    ['Ctrl+Y / Ctrl+Maj+Z', 'Rétablir'],
    ['Ctrl+C / Ctrl+V', 'Copier / coller (images comprises)'],
    ['Ctrl+Alt+C / Ctrl+Alt+V', 'Copier / coller la mise en forme (éléments du même type)'],
    ['Ctrl+D', 'Dupliquer'],
    ['Alt+flèche', 'Dupliquer en décalant d’un pas de grille'],
    ['Ctrl+G / Ctrl+Maj+G', 'Grouper / dégrouper'],
    ['Ctrl+] / Ctrl+[', 'Avancer / reculer d’un plan (AZERTY : Ctrl+$ / Ctrl+^)'],
    ['Ctrl+Maj+] / Ctrl+Maj+[', 'Premier plan / arrière-plan'],
    ['Ctrl+Maj+L', 'Verrouiller / déverrouiller'],
    ['Ctrl+Maj+H', 'Masquer / afficher'],
    ['Ctrl+A', 'Tout sélectionner'],
    ['Tab / Maj+Tab', 'Élément suivant / précédent (ordre des calques)'],
    ['Suppr', 'Supprimer la sélection'],
    ['Flèches', 'Déplacer de 1 point (Maj : 10 points)'],
    ['Ctrl + molette', 'Zoomer'],
    ['Ctrl+= / Ctrl+-', 'Zoom avant / arrière'],
    ['Ctrl+0', 'Ajuster à la fenêtre'],
    ['Molette', 'Faire défiler'],
    ['H', 'Outil Main : déplacer la vue (bascule)'],
    ['Espace maintenu', 'Main temporaire : glisser pour déplacer la vue'],
    ['Clic molette maintenu', 'Déplacer la vue (quel que soit l’outil)'],
    ['Clic droit + glisser', 'Déplacer la vue (clic droit simple : menu contextuel)'],
    ['V / Échap', 'Revenir à la sélection'],
    ['Double-clic sur la main', 'Recadrer la vue'],
    ['Maj + clic', 'Ajouter / retirer de la sélection'],
    ['Alt + clic', 'Sélectionner un élément dans un groupe'],
    ['Alt pendant un déplacement', 'Désactiver l’aimantation'],
    ['Double-clic', 'Modifier un texte ou une cellule'],
    ['Échap', 'Désélectionner / fermer'],
  ];
  const [tab, setTab] = useState<'aide' | 'integration'>('aide');
  return (
    <Modal title={t('Aide')} wide={tab === 'integration'} icon={<HelpCircle size={20} />} onClose={closeModal}>
      <div className="row" style={{ marginTop: 0 }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: 'aide', label: t('Aide et raccourcis') },
            { v: 'integration', label: t('Intégration') },
          ]}
        />
      </div>
      {tab === 'integration' ? <IntegrationHelp /> : <>
      <p style={{ marginTop: 0 }}>{t('MyLabelZebra est un éditeur d’étiquettes gratuit qui fonctionne entièrement dans votre navigateur : aucune donnée n’est envoyée sur un serveur.')}</p>
      <div className="sec-t">{t('Raccourcis clavier')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '5px 0', width: '45%' }}>
                <K k={t(k)} />
              </td>
              <td>{t(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sec">
        <div className="sec-t">{t('Bon à savoir')}</div>
        <ul style={{ paddingLeft: 18, lineHeight: 1.55, fontSize: 13, margin: 0 }}>
          <li>{t('Glissez-déposez ou collez (Ctrl+V) une image directement sur l’étiquette.')}</li>
          <li>{t('Données : importez un CSV/Excel ou collez depuis Google Sheets, puis cochez les lignes à imprimer.')}</li>
          <li>{t('Impression navigateur : choisissez la taille de papier de l’étiquette et une mise à l’échelle de 100 % (« taille réelle »).')}</li>
          <li>{t('Imprimante Zebra : installez Zebra Browser Print, puis choisissez « Imprimante Zebra ».')}</li>
          <li>{t('Liens pré-remplis : ?barcode=123&type=code128, ?qr=https://…, ?seq=SKU-{n}&start=1&count=50, ?lang=en')}</li>
        </ul>
      </div>
      <div className="sec">
        <div className="sec-t">{t('Langue')}</div>
        <Seg value={getLang()} onChange={(v) => setLang(v)} options={LANGS.map((l) => ({ v: l.id, label: l.label }))} />
      </div>
      </>}
    </Modal>
  );
}

/** Bloc de code copiable */
function CodeBlock({ code }: { code: string }) {
  const st = useStore();
  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <pre className="inp code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11.5, margin: 0, padding: '8px 10px', height: 'auto', maxHeight: 260, overflow: 'auto' }}>{code}</pre>
      <button className="btn sm" style={{ position: 'absolute', top: 6, right: 6 }} onClick={async () => (await copyText(code)) && st.toast(t('Copié'), 'ok')}>
        <Copy size={13} /> {t('Copier')}
      </button>
    </div>
  );
}

/** Page « Intégration » : piloter l'impression depuis un autre outil (lien, postMessage) */
function IntegrationHelp() {
  const st = useStore();
  const [, refresh] = useState(0);
  const name = st.doc.name || 'Mon étiquette';
  const fields = promptFields(st.doc);
  const cols = st.doc.data?.columns.length ? st.doc.data.columns : ['nom', 'prix'];
  const sampleRows = [Object.fromEntries(cols.map((c) => [c, st.doc.data?.rows[0]?.[c] ?? 'exemple']))];
  const base = location.origin + location.pathname;
  const invite = fields.map((f) => `&invite.${encodeURIComponent(f)}=${encodeURIComponent('valeur')}`).join('');
  const link = `${base}?modele=${encodeURIComponent(name)}&data=${encodeBase64Url(JSON.stringify(sampleRows))}&imprimer=zebra&copies=1${invite}`;
  const js = `// Ouvre l'éditeur dans un nouvel onglet puis envoie la demande dès qu'il est prêt
const mlz = window.open('${base}', 'mylabelzebra');
window.addEventListener('message', (e) => {
  if (e.source !== mlz) return;
  if (e.data?.type === 'mlz.ready') {
    mlz.postMessage({
      type: 'mlz.print',
      id: 'commande-1042',            // renvoyé tel quel dans la réponse
      modele: ${JSON.stringify(name)},   // nom ou identifiant dans « Mes étiquettes »
      rows: ${JSON.stringify(sampleRows)},
      prompts: ${JSON.stringify(Object.fromEntries(fields.map((f) => [f, 'valeur'])))},
      imprimer: 'zebra',              // zebra | ordinateur | pdf | zpl
      copies: 1,
    }, '${location.origin}');
  }
  if (e.data?.type === 'mlz.result') {
    console.log(e.data.ok ? \`\${e.data.count} étiquette(s) imprimée(s)\` : 'Échec : ' + e.data.error);
  }
});`;
  const py = `# Construire le lien depuis un script (Python)
import base64, json, urllib.parse
rows = ${JSON.stringify(sampleRows)}
data = base64.urlsafe_b64encode(json.dumps(rows).encode()).decode().rstrip('=')
url = '${base}?modele=' + urllib.parse.quote(${JSON.stringify(name)}) + '&data=' + data + '&imprimer=pdf'`;
  const perms = Object.entries(listAutoPrint());
  return (
    <>
      <p style={{ marginTop: 0 }}>
        {t('Un autre outil (back-office, tableur, script) peut demander une impression à MyLabelZebra, sans serveur : tout se passe dans ce navigateur. Le modèle doit être enregistré dans « Mes étiquettes ».')}
      </p>
      <div className="sec-t">{t('1. Par un lien')}</div>
      <table className="data-table" style={{ marginBottom: 8 }}>
        <tbody>
          {[
            ['modele', t('nom ou identifiant de l’étiquette enregistrée (obligatoire)')],
            ['data', t('lignes de données : tableau JSON d’objets, encodé en base64url (une étiquette par objet, toutes cochées)')],
            ['imprimer', t('zebra, ordinateur, pdf ou zpl (sans ce paramètre, l’étiquette est seulement ouverte)')],
            ['copies', t('copies par ligne (ou de l’étiquette seule)')],
            ['invite.Nom', t('valeur d’un champ {{?Nom}} saisi à l’impression')],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ maxWidth: 'none', width: 110 }}>
                <code>{k}</code>
              </td>
              <td style={{ maxWidth: 'none', whiteSpace: 'normal' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CodeBlock code={link} />
      <CodeBlock code={py} />
      <div className="sec-t">{t('2. Par window.postMessage (application qui ouvre ou intègre l’éditeur)')}</div>
      <div className="hint">{t('L’éditeur envoie { type: "mlz.ready" } à la fenêtre qui l’a ouvert (ou à la page qui l’intègre dans une iframe), puis répond à chaque demande par { type: "mlz.result", ok, count, error, id }.')}</div>
      <CodeBlock code={js} />
      <div className="sec-t">{t('Sécurité')}</div>
      <ul style={{ paddingLeft: 18, lineHeight: 1.55, fontSize: 13, marginTop: 0 }}>
        <li>{t('Au premier usage, un bandeau demande toujours confirmation (origine, modèle, nombre d’étiquettes, imprimante).')}</li>
        <li>{t('« Autoriser l’impression automatique pour ce modèle » supprime la confirmation pour ce modèle et cette origine uniquement.')}</li>
        <li>{t('Les champs {{?Nom}} non fournis sont demandés dans la fenêtre de saisie.')}</li>
        <li>{t('Chaque impression est inscrite dans l’historique d’impression (Options).')}</li>
      </ul>
      <div className="sec-t">{t('Impressions automatiques autorisées')}</div>
      {!perms.length && <div className="hint">{t('Aucune.')}</div>}
      {perms.map(([k, p]) => (
        <div key={k} className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13 }}>
            « {p.name} » — {p.source === 'url' ? t('liens') : p.source}
          </span>
          <button className="btn sm flat" style={{ color: 'var(--err)' }} onClick={() => (revokeAutoPrint(k), refresh((x) => x + 1))}>
            {t('Retirer')}
          </button>
        </div>
      ))}
    </>
  );
}

// ---------- Impression ----------
export function PrintDialog() {
  const st = useStore();
  const { doc } = st;
  const jobs = batchJobs(doc, st.previewRow);
  const total = jobs.reduce((a, j) => a + j.copies, 0);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const hasBatch = jobs.length > 1 || !!doc.data?.rows.length;
  const printer = st.printer;
  const sheet = sheetById(doc.sheet?.id);
  // mentions obligatoires INCO trop petites sur les étiquettes du lot
  const inco = useMemo(() => incoPrintSummary(doc, jobs), [doc, st.previewRow]); // eslint-disable-line react-hooks/exhaustive-deps
  // mentions alimentaires (rôles attribués) : avertissement, sans bloquer
  const food = useFoodReport();
  const foodIssues = food.missing.length + food.dateIssues.length;

  // la fenêtre se ferme dès que le travail entre dans la file (après la saisie des champs
  // {{?…}}) : un envoi Zebra en pause ne la bloque pas, le panneau de la file prend le relais
  const run = async (onlyCurrent: boolean) => {
    setBusy(true);
    let queued = false;
    try {
      const n = await runUntilQueued(
        () => startJob(printer === 'zebra' ? 'zebra' : 'ordinateur', { onlyCurrent, copies }),
        (ahead) => {
          queued = true;
          closeModal();
          toastQueuedBehind(ahead);
        },
      );
      if (n != null && !queued) closeModal();
    } finally {
      if (!queued) setBusy(false);
    }
  };

  return (
    <Modal title={t('Imprimer')} icon={<Printer size={20} />} onClose={closeModal}>
      <div className="sec-t">{t('Imprimante')}</div>
      <div className="row">
        <Seg
          value={printer === 'none' ? 'computer' : printer}
          onChange={(v) => st.set('printer', v)}
          options={[
            { v: 'computer', label: <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Monitor size={15} /> {t('Cet ordinateur')}</span> },
            { v: 'zebra', label: <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Printer size={15} /> {t('Imprimante Zebra')}</span> },
          ]}
        />
        {printer === 'zebra' && (
          <button className="btn sm flat" onClick={() => st.set('modal', 'zebra')}>
            <Settings2 size={14} /> {t('Réglages Zebra')}
          </button>
        )}
      </div>
      {printer !== 'zebra' && (
        <div className="hint" style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 10, color: 'var(--ink)' }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2, color: 'var(--accent)' }} />{' '}
          {sheet
            ? t('Planche {s} : imprimez sur papier {w}×{h}" à 100 % (« taille réelle »), sans marges.', { s: sheet.id, w: sheet.pageW, h: sheet.pageH })
            : t('Dans la fenêtre d’impression, choisissez le papier {w} × {h} et une échelle de 100 % (désactivez « Ajuster à la page »). Orientation : {o}.', {
                w: sizeLabel(doc.widthIn, doc.heightIn).split(' × ')[0],
                h: sizeLabel(doc.widthIn, doc.heightIn).split(' × ')[1],
                o: doc.widthIn > doc.heightIn ? t('paysage') : t('portrait'),
              })}
        </div>
      )}
      {inco.labels > 0 && (
        <div className="err" style={{ marginTop: 8 }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          {t('Mention obligatoire (INCO) sous la hauteur de x minimale sur {n} étiquette(s) du lot ({e} texte(s) concerné(s)). Voir le panneau de propriétés.', { n: inco.labels, e: inco.elements })}
        </div>
      )}
      {food.used && foodIssues > 0 && (
        <div className="err" style={{ marginTop: 8 }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          {food.missing.length > 0 && t('Étiquetage alimentaire : mention(s) obligatoire(s) absente(s) : {l}.', { l: food.missing.map((m) => t(m.label)).join(', ') })}{' '}
          {food.dateIssues.length > 0 && t('Date limite de consommation sans le jour.')}{' '}
          <button className="btn sm flat" onClick={() => openSideDialog('food')}>
            {t('Vérifier…')}
          </button>
        </div>
      )}
      <div className="sec">
        <div className="sec-t">{t('Cette étiquette')}</div>
        <div className="row">
          <div style={{ width: 110 }}>
            <NumField label={t('Copies')} decimals={0} min={1} max={9999} value={copies} onChange={(v) => setCopies(Math.round(v))} />
          </div>
          <button className="btn" style={{ alignSelf: 'end' }} disabled={busy} onClick={() => run(true)}>
            <Printer size={16} /> {t('Imprimer ceci')}
          </button>
        </div>
      </div>
      {hasBatch && (
        <div className="sec">
          <div className="sec-t">{t('Tout le lot')}</div>
          <div className="hint">
            {doc.data?.rows.length
              ? t('{n} ligne(s) cochée(s), {c} étiquette(s) avec les copies.', { n: doc.data.checked.filter(Boolean).length || 1, c: total })
              : t('Série numérotée : {n} étiquette(s).', { n: total })}
          </div>
          <button className="btn accent" disabled={busy} onClick={() => run(false)}>
            <Printer size={16} /> {t('Imprimer {n} étiquette(s)', { n: total })}
          </button>
        </div>
      )}
      <div className="sec">
        <div className="row">
          <button className="btn sm flat" onClick={() => testPrint(doc)} title={t('Imprime les contours numérotés des étiquettes sur papier ordinaire pour vérifier l’alignement')}>
            {t('Impression test (contours)')}
          </button>
          <button className="btn sm flat" onClick={() => st.set('modal', 'sheets')}>
            <Grid3x3 size={14} /> {t('Planches Avery…')}
          </button>
          <button className="btn sm flat" onClick={() => st.set('modal', 'export')}>
            <FileDown size={14} /> {t('PDF…')}
          </button>
          <button className="btn sm flat" onClick={() => openSideDialog('food')}>
            <CheckCircle2 size={14} /> {t('Conformité alimentaire…')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Export PDF ----------
export function ExportDialog() {
  const st = useStore();
  const { doc } = st;
  const [dpi, setDpi] = useState(String(Math.max(300, doc.dpi)));
  const [mode, setMode] = useState<'current' | 'batch'>('batch');
  const [busy, setBusy] = useState(false);
  const jobs = mode === 'current' ? [{ index: st.previewRow, copies: 1 }] : batchJobs(doc, st.previewRow);
  const go = async (zip: boolean) => {
    setBusy(true);
    try {
      const n = await startJob(zip ? 'pdf-zip' : 'pdf', { dpi: +dpi, onlyCurrent: mode === 'current', copies: 1 });
      if (n != null) closeModal();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Télécharger en PDF')} icon={<FileDown size={20} />} onClose={closeModal}>
      <div className="hint">{t('Page à la taille exacte de l’étiquette ({s}).', { s: sizeLabel(doc.widthIn, doc.heightIn) })}</div>
      <div className="row">
        <span>{t('Résolution')}</span>
        <Seg value={dpi} onChange={setDpi} options={['203', '300', '600'].map((v) => ({ v, label: v + ' dpi' }))} />
      </div>
      <div className="row">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { v: 'current', label: t('Étiquette affichée') },
            { v: 'batch', label: t('Lot ({n})', { n: batchJobs(doc, st.previewRow).reduce((a, j) => a + j.copies, 0) }) },
          ]}
        />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn accent" disabled={busy} onClick={() => go(false)}>
          <Download size={16} /> {t('Un PDF multipage')}
        </button>
        <button className="btn" disabled={busy || jobs.length < 2} onClick={() => go(true)}>
          <Download size={16} /> {t('Un PDF par étiquette (.zip)')}
        </button>
      </div>
    </Modal>
  );
}

// ---------- Zebra ----------
export function ZebraPanel() {
  const st = useStore();
  const [state, setState] = useState<'checking' | 'missing' | 'ok'>('checking');
  const [printers, setPrinters] = useState<zebra.ZebraDevice[]>([]);
  const [cur, setCur] = useState<zebra.ZebraDevice | null>(zebra.lastPrinter());
  const [settings, setSettings] = useState<zebra.PrinterSettings>(cur ? zebra.savedSettings(cur) : {});
  const [status, setStatus] = useState<zebra.PrinterStatus | null>(null);
  const [busy, setBusy] = useState('');

  const detect = async () => {
    setState('checking');
    try {
      const list = await zebra.listPrinters();
      let def: zebra.ZebraDevice | null = null;
      try {
        def = await zebra.getDefaultPrinter();
      } catch {
        /* ignore */
      }
      const all = [...list];
      if (def && !all.some((p) => p.uid === def!.uid)) all.unshift(def);
      setPrinters(all);
      setState('ok');
      if (!cur && all[0]) choose(all.find((p) => p.uid === def?.uid) ?? all[0]);
    } catch {
      setState('missing');
    }
  };
  useEffect(() => {
    detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (p: zebra.ZebraDevice) => {
    setCur(p);
    zebra.rememberPrinter(p);
    const s = zebra.savedSettings(p);
    setSettings(s);
    if (s.dpi && s.dpi !== st.doc.dpi && [203, 300, 600].includes(s.dpi)) {
      st.setDoc((d) => void (d.dpi = s.dpi!));
      st.toast(t('Résolution réglée sur {d} dpi pour {p}', { d: s.dpi, p: p.name }));
    }
    st.set('printer', 'zebra');
  };
  const read = async () => {
    if (!cur) return;
    setBusy('read');
    try {
      const s = await zebra.readSettings(cur);
      const merged = { ...settings, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) };
      setSettings(merged);
      zebra.saveSettings(cur, merged);
      if (s.dpi && [203, 300, 600].includes(s.dpi) && s.dpi !== st.doc.dpi) {
        st.setDoc((d) => void (d.dpi = s.dpi!));
        st.toast(t('Résolution détectée : {d} dpi', { d: s.dpi }), 'ok');
      }
      if (s.widthDots && s.lengthDots && s.dpi && window.confirm(t('Utiliser la taille configurée dans l’imprimante ({w} × {h}) ?', { w: (s.widthDots / s.dpi).toFixed(2) + '"', h: (s.lengthDots / s.dpi).toFixed(2) + '"' })))
        setLabelSize(s.widthDots / s.dpi, s.lengthDots / s.dpi);
    } catch (e) {
      st.toast(t('Lecture impossible : {m}', { m: (e as Error).message }), 'error');
    } finally {
      setBusy('');
    }
  };
  const checkStatus = async () => {
    if (!cur) return;
    setBusy('status');
    try {
      setStatus(await zebra.getStatus(cur));
    } catch (e) {
      st.toast(t('État indisponible : {m}', { m: (e as Error).message }), 'error');
    } finally {
      setBusy('');
    }
  };
  const apply = async () => {
    if (!cur) return;
    zebra.saveSettings(cur, settings);
    try {
      await zebra.write(cur, zebra.settingsZpl(settings));
      st.toast(t('Réglages envoyés et mémorisés pour {p}', { p: cur.name }), 'ok');
    } catch (e) {
      st.toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title={t('Imprimante Zebra')} icon={<Printer size={20} />} onClose={closeModal}>
      {state === 'checking' && <div className="hint">{t('Recherche de Zebra Browser Print…')}</div>}
      {state === 'missing' && (
        <div>
          <p style={{ marginTop: 0 }}>
            <AlertTriangle size={16} style={{ verticalAlign: -3, color: 'var(--accent)' }} /> <b>{t('Zebra Browser Print n’est pas détecté.')}</b>
          </p>
          <ol style={{ paddingLeft: 18, lineHeight: 1.6, fontSize: 13 }}>
            <li>
              {t('Téléchargez et installez Zebra Browser Print (Windows ou macOS) :')}{' '}
              <a href={zebra.BROWSER_PRINT_URL} target="_blank" rel="noreferrer">
                zebra.com <ExternalLink size={12} />
              </a>
            </li>
            <li>{t('Lancez-le : son icône apparaît dans la barre des tâches.')}</li>
            <li>{t('Branchez l’imprimante en USB ou ajoutez-la par le réseau dans Browser Print.')}</li>
            <li>{t('Ouvrez https://127.0.0.1:9101/ssl_support une fois dans le navigateur et acceptez le certificat si demandé.')}</li>
            <li>{t('À la première impression, autorisez ce site dans la fenêtre de Browser Print.')}</li>
          </ol>
          <p className="hint">{t('En attendant, vous pouvez imprimer via « Cet ordinateur » ou télécharger le fichier .zpl.')}</p>
          <button className="btn" onClick={detect}>
            <RefreshCw size={15} /> {t('Réessayer')}
          </button>
        </div>
      )}
      {state === 'ok' && (
        <>
          <div className="sec-t">{t('Imprimantes')}</div>
          {!printers.length && <div className="hint">{t('Browser Print est actif mais aucune imprimante n’est configurée.')}</div>}
          {printers.map((p) => (
            <button key={p.uid} className={'btn flat block' + (cur?.uid === p.uid ? ' accent' : '')} style={{ justifyContent: 'space-between', marginBottom: 4 }} onClick={() => choose(p)}>
              <span>{p.name}</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>{p.connection}</span>
            </button>
          ))}
          <button className="btn sm flat" onClick={detect}>
            <RefreshCw size={14} /> {t('Actualiser')}
          </button>
          {cur && (
            <div className="sec">
              <div className="sec-t">{t('Réglages de {p}', { p: cur.name })}</div>
              <div className="row">
                <button className="btn sm" disabled={!!busy} onClick={read}>
                  {t('Lire les réglages de l’imprimante')}
                </button>
                <button className="btn sm" disabled={!!busy} onClick={checkStatus}>
                  {t('Vérifier l’état')}
                </button>
              </div>
              {settings.model && <div className="hint">{t('Modèle : {m}', { m: settings.model })}</div>}
              <div className="grid3">
                <NumField label={t('Noirceur (0–30)')} decimals={0} min={0} max={30} value={settings.darkness ?? NaN} onChange={(v) => setSettings({ ...settings, darkness: v })} />
                <NumField label={t('Vitesse (ips)')} decimals={0} min={1} max={14} value={settings.speed ?? NaN} onChange={(v) => setSettings({ ...settings, speed: v })} />
                <label className="f">
                  DPI
                  <select className="inp" value={settings.dpi ?? ''} onChange={(e) => setSettings({ ...settings, dpi: +e.target.value || undefined })}>
                    <option value="">—</option>
                    <option value="203">203</option>
                    <option value="300">300</option>
                    <option value="600">600</option>
                  </select>
                </label>
              </div>
              <button className="btn sm accent" onClick={apply}>
                {t('Appliquer et mémoriser')}
              </button>
              {status && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  {status.ok ? (
                    <span className="okmsg">
                      <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> {t('Prête')}
                    </span>
                  ) : (
                    <span className="err">
                      <AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {[status.headOpen && t('Tête ouverte'), status.paperOut && t('Plus de papier'), status.ribbonOut && t('Plus de ruban'), status.paused && t('En pause')].filter(Boolean).join(' · ') || t('État inconnu')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- Planches Avery ----------
export function SheetsDialog() {
  const st = useStore();
  const { doc } = st;
  const cfg = doc.sheet;
  const sheet = sheetById(cfg?.id);
  const prevRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const setCfg = (p: Partial<NonNullable<LabelDoc['sheet']>>) => st.setDoc((d) => void (d.sheet = { id: SHEETS[0].id, mode: 'same', howMany: 0, startAt: 1, textOnly: false, ...d.sheet, ...p }), 'sheet');

  useEffect(() => {
    let alive = true;
    if (!sheet || !prevRef.current) return;
    sheetPages(doc, st.previewRow, 60).then((ps) => {
      if (!alive || !prevRef.current) return;
      setPages(ps.length);
      prevRef.current.innerHTML = '';
      const cv = ps[0];
      if (cv) {
        cv.style.width = '100%';
        cv.style.boxShadow = '0 2px 10px rgba(0,0,0,.15)';
        prevRef.current.appendChild(cv);
      }
    });
    return () => {
      alive = false;
    };
  }, [doc, sheet, st.previewRow]);

  return (
    <Modal
      title={t('Planches A4 / Letter (Avery)')}
      wide
      icon={<Grid3x3 size={20} />}
      onClose={closeModal}
      footer={
        sheet && (
          <>
            <button className="btn flat" style={{ color: 'var(--err)' }} onClick={() => (st.setDoc((d) => void (d.sheet = undefined)), closeModal())}>
              {t('Revenir au rouleau')}
            </button>
            <button className="btn flat" onClick={() => testPrint(doc)}>
              {t('Impression test')}
            </button>
            <button className="btn" onClick={() => startJob('planches-pdf')}>
              <Download size={16} /> {t('Télécharger le PDF ({n} page(s))', { n: pages })}
            </button>
            <button className="btn accent" onClick={() => (st.set('printer', 'computer'), startJob('planches'))}>
              <Printer size={16} /> {t('Imprimer')}
            </button>
          </>
        )
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 18 }}>
        <div>
          <label className="f" style={{ marginBottom: 10 }}>
            {t('Planche')}
            <select
              className="inp"
              value={cfg?.id ?? ''}
              onChange={(e) => {
                const s = sheetById(e.target.value);
                if (!s) return;
                setCfg({ id: s.id });
                setLabelSize(s.w, s.h, !!s.round);
              }}
            >
              <option value="">{t('— Choisir une planche —')}</option>
              {SHEETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {sheet && cfg && (
            <>
              <div className="row">
                <Seg
                  value={cfg.mode}
                  onChange={(v) => setCfg({ mode: v })}
                  options={[
                    { v: 'same', label: t('Même étiquette partout') },
                    { v: 'each', label: t('Une étiquette par ligne') },
                  ]}
                />
              </div>
              {cfg.mode === 'same' ? (
                <div className="grid2">
                  <NumField label={t('Combien (0 = planche pleine)')} decimals={0} min={0} max={5000} value={cfg.howMany} onChange={(v) => setCfg({ howMany: Math.round(v) })} />
                  <NumField label={t('Commencer à l’étiquette n°')} decimals={0} min={1} max={sheet.cols * sheet.rows} value={cfg.startAt} onChange={(v) => setCfg({ startAt: Math.round(v) })} />
                </div>
              ) : (
                <>
                  <div className="hint">{t('Remplit chaque case avec une ligne de données (ligne 1 → case 1…) ou la série numérotée, sur autant de planches que nécessaire.')}</div>
                  <NumField label={t('Commencer à l’étiquette n°')} decimals={0} min={1} max={sheet.cols * sheet.rows} value={cfg.startAt} onChange={(v) => setCfg({ startAt: Math.round(v) })} />
                </>
              )}
              <div className="hint">{t('Les cases avant le n° de départ restent vierges (planche entamée).')}</div>
              <Check checked={cfg.textOnly} onChange={(v) => setCfg({ textOnly: v })}>
                {t('Texte uniquement (sans codes ni images)')}
              </Check>
              <div className="hint">
                {sheet.cols} × {sheet.rows} = {sheet.cols * sheet.rows} {t('étiquettes par planche')} · {sizeLabel(sheet.w, sheet.h)}
              </div>
              <div className="sec">
                <div className="sec-t">{t('Calibrage de l’imprimante')}</div>
                <div className="grid2">
                  <NumField label={t('Décalage horizontal')} suffix="mm" step={0.5} min={-10} max={10} decimals={1} value={cfg.offsetXmm || 0} onChange={(v) => setCfg({ offsetXmm: v })} />
                  <NumField label={t('Décalage vertical')} suffix="mm" step={0.5} min={-10} max={10} decimals={1} value={cfg.offsetYmm || 0} onChange={(v) => setCfg({ offsetYmm: v })} />
                </div>
                <div className="hint">
                  {t('Faites une impression test sur papier ordinaire à 100 % (sans « ajuster à la page »), posez-la sur une planche à contre-jour, puis corrigez le décalage : + = vers la droite / vers le bas.')}
                </div>
              </div>
            </>
          )}
        </div>
        <div ref={prevRef} style={{ background: 'var(--bg)', borderRadius: 12, padding: 10, minHeight: 200 }} />
      </div>
    </Modal>
  );
}

// ---------- Outils : générateurs ----------
function PreviewCanvas({ doc }: { doc: LabelDoc }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    const cv = renderLabel(doc, { scale: 1 });
    cv.style.maxWidth = '100%';
    cv.style.maxHeight = '260px';
    ref.current.appendChild(cv);
  }, [doc]);
  return <div ref={ref} style={{ display: 'grid', placeItems: 'center', background: 'var(--bg)', borderRadius: 12, padding: 14, minHeight: 160 }} />;
}

export function BarcodeTool() {
  const st = useStore();
  const [sym, setSym] = useState<Symbology>('code128');
  const [val, setVal] = useState(SYMBOLOGIES[0].sample);
  const [text, setText] = useState(true);
  const enc = encodeBarcode(val, sym);
  const doc = useMemo(() => {
    const d = newDoc({ widthIn: 3, heightIn: is2D(sym) ? 3 : 1.5, dpi: 300 });
    const b = makeBarcode(d, sym, val);
    b.x = 20;
    b.y = 20;
    b.w = d.widthIn * BASE_DPI - 40;
    b.h = d.heightIn * BASE_DPI - 40;
    b.showText = text && !is2D(sym);
    d.elements = [b];
    return d;
  }, [sym, val, text]);
  const png = async () => downloadBlob(await canvasToBlob(renderLabel(doc, { scale: 600 / BASE_DPI })), `code-${sym}.png`);
  return (
    <Modal
      title={t('Générateur de code-barres')}
      icon={<Barcode size={20} />}
      onClose={closeModal}
      footer={
        <>
          <button className="btn" disabled={enc.error !== undefined} onClick={png}>
            <Download size={16} /> PNG
          </button>
          <button className="btn accent" disabled={enc.error !== undefined} onClick={() => (st.addElements([makeBarcode(st.doc, sym, val)]), closeModal())}>
            <Plus size={16} /> {t('Ajouter à l’étiquette')}
          </button>
        </>
      }
    >
      <div className="grid2">
        <label className="f">
          {t('Symbologie')}
          <select className="inp" value={sym} onChange={(e) => (setSym(e.target.value as Symbology), setVal(SYMBOLOGIES.find((s) => s.id === e.target.value)!.sample))}>
            {SYMBOLOGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          {t('Valeur')}
          <input className={'inp' + (enc.error !== undefined ? ' bad' : '')} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </div>
      {enc.error !== undefined ? <div className="err">{enc.error}</div> : <div className="hint">{t(SYMBOLOGIES.find((s) => s.id === sym)!.hint)}</div>}
      <Check checked={text} onChange={setText}>
        {t('Afficher le texte lisible')}
      </Check>
      <PreviewCanvas doc={doc} />
    </Modal>
  );
}

export function QrTool() {
  const st = useStore();
  const [type, setType] = useState<'text' | 'wifi' | 'vcard'>('text');
  const [val, setVal] = useState('https://exemple.fr');
  const [ssid, setSsid] = useState('');
  const [pw, setPw] = useState('');
  const [enc, setEnc] = useState<'WPA' | 'WEP' | 'nopass'>('WPA');
  const [vc, setVc] = useState({ firstName: '', lastName: '', org: '', title: '', phone: '', email: '', url: '', address: '' });
  const [level, setLevel] = useState<QrLevel>('M');
  const build = (d: LabelDoc) => {
    const q = makeQr(d, val);
    q.qrType = type;
    q.level = level;
    q.wifi = { ssid, password: pw, enc, hidden: false };
    q.vcard = vc;
    return q;
  };
  const doc = useMemo(() => {
    const d = newDoc({ widthIn: 2, heightIn: 2, dpi: 300 });
    const q = build(d);
    q.x = q.y = 10;
    q.w = q.h = 2 * BASE_DPI - 20;
    d.elements = [q];
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, val, ssid, pw, enc, vc, level]);
  const err = encodeQr(type === 'text' ? val : 'x', level).error;
  const png = async () => downloadBlob(await canvasToBlob(renderLabel(doc, { scale: 600 / BASE_DPI })), 'qr.png');
  const vf = (k: keyof typeof vc, label: string) => (
    <label className="f">
      {label}
      <input className="inp" value={vc[k]} onChange={(e) => setVc({ ...vc, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  );
  return (
    <Modal
      title={t('Générateur de QR code')}
      icon={<QrCode size={20} />}
      onClose={closeModal}
      footer={
        <>
          <button className="btn" onClick={png} disabled={!!err}>
            <Download size={16} /> PNG
          </button>
          <button className="btn accent" disabled={!!err} onClick={() => (st.addElements([build(st.doc)]), closeModal())}>
            <Plus size={16} /> {t('Ajouter à l’étiquette')}
          </button>
        </>
      }
    >
      <div className="row">
        <Seg value={type} onChange={setType} options={[{ v: 'text', label: t('URL / texte') }, { v: 'wifi', label: 'Wi-Fi' }, { v: 'vcard', label: 'vCard' }]} />
        <select className="inp" style={{ width: 120 }} value={level} onChange={(e) => setLevel(e.target.value as QrLevel)} aria-label={t('Correction d’erreur')}>
          <option value="L">L 7 %</option>
          <option value="M">M 15 %</option>
          <option value="Q">Q 25 %</option>
          <option value="H">H 30 %</option>
        </select>
      </div>
      {type === 'text' && <textarea className={'inp' + (err ? ' bad' : '')} rows={2} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ marginBottom: 8 }} />}
      {type === 'wifi' && (
        <div className="grid3">
          <label className="f">
            SSID
            <input className="inp" value={ssid} onChange={(e) => setSsid(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="f">
            {t('Mot de passe')}
            <input className="inp" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="f">
            {t('Sécurité')}
            <select className="inp" value={enc} onChange={(e) => setEnc(e.target.value as 'WPA')}>
              <option value="WPA">WPA</option>
              <option value="WEP">WEP</option>
              <option value="nopass">{t('Aucune')}</option>
            </select>
          </label>
        </div>
      )}
      {type === 'vcard' && (
        <div className="grid2">
          {vf('firstName', t('Prénom'))}
          {vf('lastName', t('Nom'))}
          {vf('org', t('Société'))}
          {vf('phone', t('Téléphone'))}
          {vf('email', t('E-mail'))}
          {vf('url', t('Site web'))}
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <PreviewCanvas doc={doc} />
    </Modal>
  );
}
