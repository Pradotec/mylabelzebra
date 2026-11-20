import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Database, Hash, CalendarDays, ScanLine, Upload, Link2, Trash2, Pencil, Check as CheckIcon, X, AlertTriangle, Search, Package, ListOrdered, Download, ArrowUp, ArrowDown, ShieldCheck, ChevronRight, Split, Grid3x3, Plus, CornerDownLeft } from 'lucide-react';
import { useStore, type RightPanel } from '../store';
import { Panel, NumField, Check, Modal } from './ui';
import { t, tc } from '../i18n';
import { parseDelimited, parseFile, fetchSheet, canSwitchSheet, reloadSheet, filterRows, sortRows, findRow, splitColumn, splitCount, splitValue, generateRanges, appendRows, MAX_ROWS, type DataWarning, type RowFilter, type RowOp, type SplitMode, type RangeSegment } from '../data';
import { checkBatchAsync, checkRows, issueRows, elementLabel, ISSUE_KINDS, type Issue, type IssueKind } from '../check';
import { insertToken } from '../actions';
import { pickFile, downloadText } from '../util';
import { serialValue, dateValue, formatDate, docUsesSerial, docUsesSscc, resolveText, serialDigits, parseSerialAlpha } from '../render/resolve';
import { getSsccConfig, onSsccChange, loadSscc, saveSsccSettings, nextSerial, floorSerial, isValidPrefix, serialCapacity, ssccPreview, listSsccLog, ssccLogCsv, type SsccLogEntry } from '../sscc';
import type { DataSet } from '../types';

export function RightBar() {
  const rightPanel = useStore((s) => s.rightPanel);
  const nRows = useStore((s) => s.doc.data?.rows.length ?? 0);
  const toggle = (p: RightPanel) => useStore.getState().set('rightPanel', rightPanel === p ? null : p);
  return (
    <>
      <nav className="sidebar right pill hide-in-preview" aria-label={t('Outils de données')}>
        <button className={'tool' + (rightPanel === 'data' ? ' on' : '')} onClick={() => toggle('data')} aria-label={t('Données')}>
          <Database />
          {t('Données')}
          {nRows > 0 && <span className="badge">{nRows}</span>}
        </button>
        <button className={'tool' + (rightPanel === 'number' ? ' on' : '')} onClick={() => toggle('number')} aria-label={t('Numérotation')}>
          <Hash />
          {t('Numéro')}
        </button>
        <button className={'tool' + (rightPanel === 'date' ? ' on' : '')} onClick={() => toggle('date')} aria-label={t('Dates')}>
          <CalendarDays />
          {t('Date')}
        </button>
        <button className="tool" onClick={() => useStore.getState().set('modal', 'zpl')} aria-label={t('Visionneuse ZPL')}>
          <ScanLine />
          {t('Visionneuse ZPL')}
        </button>
      </nav>
      {rightPanel === 'data' && <DataPanel />}
      {rightPanel === 'number' && <NumberPanel />}
      {rightPanel === 'date' && <DatePanel />}
    </>
  );
}

const close = () => useStore.getState().set('rightPanel', null);

/** Texte (traduit) d'un avertissement d'import */
export function warningText(w: DataWarning): string {
  switch (w.kind) {
    case 'truncated':
      return t('{k} premières lignes importées sur {n}', { k: w.kept, n: w.total });
    case 'precision':
      return t('Colonne « {c} » : {n} nombre(s) de plus de 15 chiffres (ex. {e}) — Excel a perdu les derniers chiffres. Formatez la colonne en Texte dans Excel puis réimportez.', { c: w.column, n: w.count, e: w.example });
    case 'encoding':
      return t('Fichier lu en {e} (pas en UTF-8) : vérifiez les accents.', { e: w.encoding });
  }
}

export function loadData(ds: DataSet) {
  const st = useStore.getState();
  st.setDoc((d) => void (d.data = ds));
  useStore.setState({ previewRow: 0, showData: true });
  const trunc = ds.warnings?.find((w) => w.kind === 'truncated');
  if (trunc) st.toast(t('{k} premières lignes importées sur {n} — cochez les lignes à imprimer', { k: trunc.kept, n: trunc.total }), 'error');
  else st.toast(t('{n} lignes importées — cochez les lignes à imprimer', { n: ds.rows.length }), 'ok');
}

const setData = (f: (d: DataSet) => DataSet, key?: string) => useStore.getState().setDoc((d) => void (d.data = d.data ? f(d.data) : d.data), key);

// filtre des lignes : logique pure dans data.ts (réexportée pour compatibilité)
export { filterRows, type RowOp, type RowFilter } from '../data';

/**
 * Remplace les données en gardant la ligne affichée sur le même enregistrement (tri,
 * éclatement) ; passe par setDoc : l'opération est annulable (Ctrl+Z).
 */
function replaceData(f: (d: DataSet) => DataSet) {
  const st = useStore.getState();
  const before = st.doc.data;
  if (!before) return;
  const cur = before.rows[st.previewRow];
  setData(f);
  const after = useStore.getState().doc.data;
  const k = after && cur ? after.rows.indexOf(cur) : -1;
  useStore.setState({ previewRow: k >= 0 ? k : Math.min(st.previewRow, Math.max(0, (after?.rows.length ?? 1) - 1)) });
}

/** Hauteur fixe d'une ligne du tableau (virtualisation) */
const ROW_H = 30;
const VIEW_H = 260;
const OVERSCAN = 8;
const NO_FILTER: RowFilter = { query: '', column: '', op: 'contains', value: '' };

export function DataPanel() {
  const data = useStore((s) => s.doc.data);
  const showData = useStore((s) => s.showData);
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [tool, setTool] = useState<null | 'split' | 'generate'>(null);
  const toast = (m: string) => useStore.getState().toast(m, 'error');

  const fromFile = async () => {
    const f = await pickFile('.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods');
    if (!f) return;
    try {
      // même fichier réimporté : on garde la feuille choisie
      const prev = useStore.getState().doc.data;
      loadData(await parseFile(f, { sheet: prev?.source === f.name ? prev.sheet : undefined }));
    } catch (e) {
      toast(t('Import impossible : {m}', { m: (e as Error).message }));
    }
  };
  const fromText = (txt: string) => {
    try {
      loadData(parseDelimited(txt));
      setPaste('');
    } catch (e) {
      toast(t('Import impossible : {m}', { m: (e as Error).message }));
    }
  };
  const fromUrl = async () => {
    setBusy(true);
    try {
      loadData(await fetchSheet(url));
    } catch (e) {
      toast(t('Lien illisible : publiez la feuille (Fichier › Partager › Publier sur le Web › CSV). {m}', { m: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const switchSheet = async (sheet: string) => {
    if (!data?.source) return;
    setBusy(true);
    try {
      loadData(await reloadSheet(data.source, sheet));
      setFilter(NO_FILTER);
    } catch (e) {
      toast(t('Import impossible : {m}', { m: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.rows;
  const columns = data?.columns;
  const checked = data?.checked;
  const active = !!(filter.query.trim() || filter.column);
  const visible = useMemo(
    () => (rows && columns ? (active ? filterRows({ rows, columns }, filter) : rows.map((_, i) => i)) : []),
    [rows, columns, filter, active],
  );
  const nChecked = useMemo(() => (checked ? checked.filter(Boolean).length : 0), [checked]);
  const checkVisible = (v: boolean) => {
    const set = new Set(visible);
    setData((d) => ({ ...d, checked: d.checked.map((c, k) => (set.has(k) ? v : c)) }));
  };

  return (
    <Panel className="rightp" title={t('Données')} icon={<Database size={17} />} onClose={close}>
      {!data && (
        <>
          <div className="hint">{t('Une ligne = une étiquette. Utilisez {{colonne}} dans un texte, un code-barres, un QR ou un tableau.')}</div>
          <button className="btn block" onClick={fromFile} style={{ marginBottom: 10 }}>
            <Upload size={16} /> {t('Importer un fichier CSV ou Excel')}
          </button>
          <label className="f" style={{ marginBottom: 10 }}>
            {t('Ou collez ici (Excel, Google Sheets, CSV) — chargement automatique')}
            <textarea
              className="inp code"
              rows={4}
              placeholder={'SKU\tDescription\tQté\nA-001\tVis 4x20\t120'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onPaste={(e) => {
                const txt = e.clipboardData.getData('text');
                if (txt && txt.includes('\n')) {
                  e.preventDefault();
                  fromText(txt);
                }
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          {paste.includes('\n') && (
            <button className="btn sm block" onClick={() => fromText(paste)} style={{ marginBottom: 10 }}>
              {t('Charger le texte')}
            </button>
          )}
          <label className="f">
            {t('Lien Google Sheets publié (CSV)')}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="inp grow" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button className="icon-btn" disabled={!url || busy} onClick={fromUrl} aria-label={t('Charger le lien')}>
                <Link2 size={16} />
              </button>
            </div>
          </label>
          <button className="btn sm flat block" onClick={() => setTool('generate')} style={{ marginTop: 6 }}>
            <Grid3x3 size={14} /> {t('Générer des emplacements…')}
          </button>
        </>
      )}
      {tool === 'generate' && createPortal(<GenerateModal onClose={() => setTool(null)} />, document.body)}
      {tool === 'split' && data && createPortal(<SplitModal data={data} onClose={() => setTool(null)} />, document.body)}
      {data && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              {data.source}
              {data.sheet && data.sheets && data.sheets.length > 1 ? ` › ${data.sheet}` : ''} · {t('{n} lignes', { n: data.rows.length })}
            </span>
            <button className="btn sm flat" style={{ color: 'var(--err)' }} onClick={() => window.confirm(t('Retirer les données de cette étiquette ?')) && useStore.getState().setDoc((d) => void (d.data = undefined))}>
              <Trash2 size={14} /> {t('Retirer')}
            </button>
          </div>
          {data.sheets && data.sheets.length > 1 && (
            <label className="f" style={{ marginBottom: 8 }}>
              {t('Feuille du classeur')}
              {canSwitchSheet(data.source) ? (
                <select className="inp" value={data.sheet} disabled={busy} onChange={(e) => switchSheet(e.target.value)}>
                  {data.sheets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="hint" style={{ margin: 0 }}>
                  {t('« {s} » — réimportez le fichier pour choisir une autre feuille.', { s: data.sheet ?? '' })}
                </span>
              )}
            </label>
          )}
          {data.warnings?.map((w, i) => (
            <div key={i} className="hint" role="alert" style={{ color: 'var(--err)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flex: 'none', marginTop: 2 }} />
              <span>{warningText(w)}</span>
            </div>
          ))}
          <div className="sec-t">{t('Colonnes — cliquez pour insérer')}</div>
          <div className="tags">
            {data.columns.map((c) => (
              <button key={c} className="tag" onClick={() => insertToken(`{{${c}}}`)} title={t('Insérer {{{c}}} dans l’élément sélectionné', { c })}>
                {`{{${c}}}`}
              </button>
            ))}
          </div>
          <Check checked={showData} onChange={(v) => useStore.getState().set('showData', v)}>
            {t('Afficher les valeurs (sinon les {{champs}})')}
          </Check>
          <RowFilterBar columns={data.columns} filter={filter} setFilter={setFilter} />
          <GoToRow data={data} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="sec-t" style={{ margin: 0 }}>
              {t('Lignes à imprimer : {n}', { n: nChecked })}
            </span>
            <span>
              {active ? (
                <>
                  <button className="btn sm flat" onClick={() => checkVisible(true)} title={t('Cocher les {n} lignes filtrées', { n: visible.length })}>
                    {t('Cocher les lignes filtrées')}
                  </button>
                  <button className="btn sm flat" onClick={() => checkVisible(false)}>
                    {t('Décocher')}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn sm flat" onClick={() => setData((d) => ({ ...d, checked: d.rows.map(() => true) }))}>
                    {t('Tout')}
                  </button>
                  <button className="btn sm flat" onClick={() => setData((d) => ({ ...d, checked: d.rows.map(() => false) }))}>
                    {t('Aucune')}
                  </button>
                </>
              )}
            </span>
          </div>
          {active && <div className="hint" style={{ margin: '0 0 4px' }}>{t('{n} ligne(s) correspondent au filtre', { n: visible.length })}</div>}
          <DataTable data={data} visible={visible} />
          <div className="hint" style={{ marginTop: 8 }}>
            {nChecked ? t('Imprimer et exporter (PDF, ZPL) produiront {n} étiquette(s).', { n: nChecked }) : t('Aucune ligne cochée : seule la ligne affichée sera imprimée.')}
          </div>
          <BatchCheck />
          <div className="sec">
            <div className="sec-t">{t('Outils')}</div>
            <button className="btn sm block" onClick={() => setTool('split')} style={{ marginBottom: 6 }} title={t('Une ligne par valeur : « A / B » ou cases multiples « ZB1-04-03-B1B5 »')}>
              <Split size={14} /> {t('Éclater la colonne…')}
            </button>
            <button className="btn sm block" onClick={() => setTool('generate')}>
              <Grid3x3 size={14} /> {t('Générer des emplacements…')}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

function RowFilterBar({ columns, filter, setFilter }: { columns: string[]; filter: RowFilter; setFilter: (f: RowFilter) => void }) {
  const set = (p: Partial<RowFilter>) => setFilter({ ...filter, ...p });
  const needsValue = filter.op === 'contains' || filter.op === 'eq' || filter.op === 'ne';
  return (
    <div style={{ margin: '6px 0' }}>
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 4 }}>
        <Search size={14} style={{ flex: 'none', color: 'var(--ink-2)' }} />
        <input className="inp grow" placeholder={t('Rechercher dans les lignes…')} aria-label={t('Rechercher dans les lignes')} value={filter.query} onChange={(e) => set({ query: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
        <select className="inp" aria-label={t('Colonne')} value={filter.column} onChange={(e) => set({ column: e.target.value })} style={{ minWidth: 0, flex: 1 }}>
          <option value="">{t('Critère : aucun')}</option>
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {filter.column && (
          <select className="inp" aria-label={t('Condition')} value={filter.op} onChange={(e) => set({ op: e.target.value as RowOp })} style={{ minWidth: 0, flex: 1 }}>
            <option value="contains">{t('contient')}</option>
            <option value="eq">=</option>
            <option value="ne">≠</option>
            <option value="empty">{t('est vide')}</option>
            <option value="notEmpty">{t('n’est pas vide')}</option>
            <option value="dup" title={t('Valeur présente sur plusieurs lignes de la colonne')}>
              {t('doublon')}
            </option>
            <option value="badGtin" title={t('Valeur non vide qui n’est pas un EAN/GTIN de 8, 12, 13 ou 14 chiffres avec une clé correcte')}>
              {t('EAN/GTIN invalide')}
            </option>
          </select>
        )}
        {filter.column && needsValue && <input className="inp" style={{ minWidth: 0, flex: 1 }} aria-label={t('Valeur')} value={filter.value} onChange={(e) => set({ value: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
        {(filter.query || filter.column) && (
          <button className="icon-btn flat sm" aria-label={t('Effacer le filtre')} onClick={() => setFilter(NO_FILTER)}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Affiche une ligne sur l'étiquette (valeurs visibles) et sélectionne éventuellement un élément */
function showRow(row: number, elementId?: string) {
  const st = useStore.getState();
  useStore.setState({ previewRow: row, showData: true });
  if (elementId && st.doc.elements.some((e) => e.id === elementId)) st.select([elementId], 'set', true);
}

/** « Aller à… » : numéro de ligne ou valeur cherchée ; Entrée = occurrence suivante */
function GoToRow({ data }: { data: DataSet }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ReturnType<typeof findRow> | undefined>(undefined);
  // lignes triées / éclatées : le résultat affiché n'est plus valable
  useEffect(() => setRes(undefined), [data.rows]);
  const go =(query: string, from: number) => {
    const r = findRow(data, query, from);
    setRes(query.trim() ? r : undefined);
    if (r) showRow(r.row);
  };
  return (
    <div style={{ margin: '0 0 6px' }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <CornerDownLeft size={14} style={{ flex: 'none', color: 'var(--ink-2)' }} />
        <input
          className="inp grow"
          placeholder={t('Aller à… (n° de ligne ou valeur)')}
          aria-label={t('Aller à une ligne')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            go(e.target.value, -1);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') go(q, res ? res.row : useStore.getState().previewRow);
            if (e.key === 'Escape') (setQ(''), setRes(undefined));
          }}
        />
      </div>
      {res !== undefined && (
        <div className="hint" style={{ margin: '2px 0 0', color: res ? undefined : 'var(--err)' }}>
          {res ? (res.count > 1 ? t('Ligne {n} — occurrence {k} sur {c} (Entrée : suivante)', { n: res.row + 1, k: res.rank, c: res.count }) : t('Ligne {n}', { n: res.row + 1 })) : t('Aucune ligne trouvée')}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<IssueKind, () => string> = {
  missingColumn: () => t('Colonnes introuvables'),
  invalidCode: () => t('Codes-barres invalides'),
  emptyField: () => t('Champs vides'),
  duplicateCode: () => t('Codes-barres en double'),
  textFit: () => t('Textes réduits ou tronqués'),
};
/** Entrées affichées par groupe (les suivantes restent accessibles par « Anomalie suivante ») */
const GROUP_MAX = 100;

/** « Vérifier le lot » : contrôle des lignes cochées, liste groupée des anomalies */
function BatchCheck() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [basis, setBasis] = useState<{ elements: unknown; rows: unknown; count: number } | null>(null);
  const run = useRef(0);
  const elements = useStore((s) => s.doc.elements);
  const rows = useStore((s) => s.doc.data?.rows);
  useEffect(() => () => void run.current++, []);

  const start = async () => {
    const doc = useStore.getState().doc;
    const id = ++run.current;
    const total = checkRows(doc).length;
    setProgress({ done: 0, total });
    setCursor(-1);
    const list = await checkBatchAsync(doc, { onProgress: (done) => run.current === id && setProgress({ done, total }), isCancelled: () => run.current !== id });
    if (!list || run.current !== id) return;
    setIssues(list);
    setBasis({ elements: doc.elements, rows: doc.data?.rows, count: total });
    setProgress(null);
  };
  const cancel = () => {
    run.current++;
    setProgress(null);
  };

  const located = useMemo(() => (issues ?? []).filter((x) => x.row >= 0), [issues]);
  const groups = useMemo(() => ISSUE_KINDS.map((k) => ({ kind: k, list: (issues ?? []).filter((x) => x.kind === k) })).filter((g) => g.list.length), [issues]);
  const stale = !!basis && (basis.elements !== elements || basis.rows !== rows);

  const open = (x: Issue) => {
    if (x.row >= 0) showRow(x.row, x.elementId);
    const k = located.indexOf(x);
    if (k >= 0) setCursor(k);
  };
  const next = () => {
    if (!located.length) return;
    const k = (cursor + 1) % located.length;
    setCursor(k);
    showRow(located[k].row, located[k].elementId);
  };
  const uncheck = () => {
    const bad = new Set(issueRows(issues ?? []));
    setData((d) => ({ ...d, checked: d.checked.map((c, i) => (bad.has(i) ? false : c)) }));
    useStore.getState().toast(t('{n} ligne(s) décochée(s) — Ctrl+Z pour annuler', { n: bad.size }), 'ok');
  };
  const els = useStore.getState().doc.elements;
  const label = (x: Issue) => {
    const el = x.elementId ? els.find((e) => e.id === x.elementId) : undefined;
    return [x.row >= 0 ? t('Ligne {n}', { n: x.row + 1 }) : '', elementLabel(el), x.message].filter(Boolean).join(' · ');
  };

  return (
    <div className="sec">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="sec-t" style={{ margin: 0 }}>
          {t('Vérification du lot')}
        </span>
        {issues && !progress && (
          <span
            className="badge"
            role="status"
            style={{ background: issues.length ? 'var(--err)' : 'var(--ok)' }}
          >
            {issues.length ? t('{n} anomalie(s)', { n: issues.length }) : t('Aucune anomalie')}
          </span>
        )}
      </div>
      {progress ? (
        <div className="row" style={{ margin: '6px 0' }}>
          <progress className="grow" max={progress.total || 1} value={progress.done} aria-label={t('Vérification du lot')} />
          <span className="hint" style={{ margin: 0 }}>
            {progress.done}/{progress.total}
          </span>
          <button className="btn sm flat" onClick={cancel}>
            {tc('Annuler', 'cancel')}
          </button>
        </div>
      ) : (
        <button className="btn sm block" onClick={start} style={{ margin: '6px 0' }} title={t('Contrôle les lignes cochées (toutes si aucune n’est cochée) : colonnes introuvables, codes invalides ou en double, champs vides, textes réduits ou tronqués')}>
          <ShieldCheck size={14} /> {issues ? t('Relancer la vérification') : t('Vérifier le lot')}
        </button>
      )}
      {issues && stale && !progress && <div className="hint">{t('L’étiquette ou les données ont changé depuis la vérification : relancez-la.')}</div>}
      {issues && !issues.length && basis && !progress && <div className="okmsg">{t('{n} ligne(s) vérifiée(s), aucune anomalie ✓', { n: basis.count })}</div>}
      {issues && issues.length > 0 && (
        <>
          <button className="btn sm block" style={{ marginBottom: 6 }} disabled={!located.length} onClick={next}>
            <ChevronRight size={14} /> {t('Anomalie suivante')}
            {cursor >= 0 && located.length ? ` (${cursor + 1}/${located.length})` : ''}
          </button>
          <button className="btn sm flat block" style={{ marginBottom: 6 }} disabled={!located.length} onClick={uncheck} title={t('Retire ces lignes de l’impression (annulable)')}>
            {t('Décocher les lignes en anomalie')}
          </button>
          <div className="scrollbox" style={{ maxHeight: 220, padding: 4 }}>
            {groups.map((g) => (
              <details key={g.kind} open={groups.length === 1 || g.kind === 'missingColumn'}>
                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '3px 2px' }}>
                  {KIND_LABEL[g.kind]()} ({g.list.length})
                </summary>
                {g.list.slice(0, GROUP_MAX).map((x, i) => (
                  <button
                    key={i}
                    className="btn sm flat block"
                    style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', whiteSpace: 'normal', fontWeight: 400, background: located[cursor] === x ? 'var(--accent-soft)' : undefined }}
                    disabled={x.row < 0}
                    onClick={() => open(x)}
                  >
                    {label(x)}
                  </button>
                ))}
                {g.list.length > GROUP_MAX && <div className="hint" style={{ margin: '2px 4px' }}>{t('… et {n} autre(s) : utilisez « Anomalie suivante ».', { n: g.list.length - GROUP_MAX })}</div>}
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SEPARATORS = ['/', ';', ',', '|'];

/** « Éclater la colonne… » : une ligne par valeur (séparateur ou cases multiples) */
function SplitModal({ data, onClose }: { data: DataSet; onClose: () => void }) {
  const [column, setColumn] = useState(() => data.columns.find((c) => /emplacement/i.test(c)) ?? data.columns[0] ?? '');
  const [kind, setKind] = useState<'sep' | 'cases'>(() => (/emplacement/i.test(column) ? 'cases' : 'sep'));
  const [sep, setSep] = useState('/');
  const mode: SplitMode = kind === 'cases' ? { kind: 'cases' } : { kind: 'sep', sep };
  const after = useMemo(() => splitCount(data, column, mode), [data, column, kind, sep]); // eslint-disable-line react-hooks/exhaustive-deps
  const example = useMemo(() => {
    const r = data.rows.find((x) => splitValue(x[column] ?? '', mode).length > 1);
    return r ? { from: r[column], to: splitValue(r[column], mode) } : null;
  }, [data, column, kind, sep]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    let lost = 0;
    replaceData((d) => {
      const r = splitColumn(d, column, mode);
      lost = r.truncated;
      return r.data;
    });
    const st = useStore.getState();
    if (lost) st.toast(t('Colonne éclatée : {n} lignes ; {k} ligne(s) au-delà de {m} ignorée(s)', { n: MAX_ROWS, k: lost, m: MAX_ROWS }), 'error');
    else st.toast(t('Colonne éclatée : {a} lignes → {b} — Ctrl+Z pour annuler', { a: data.rows.length, b: after }), 'ok');
    onClose();
  };
  return (
    <Modal
      title={t('Éclater la colonne')}
      icon={<Split size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tc('Annuler', 'cancel')}
          </button>
          <button className="btn accent" disabled={!column || after === data.rows.length} onClick={apply}>
            {t('Éclater')}
          </button>
        </>
      }
    >
      <div className="hint">{t('Chaque valeur multiple devient une ligne ; les autres colonnes, la case à cocher et les copies sont recopiées.')}</div>
      <label className="f" style={{ marginBottom: 8 }}>
        {t('Colonne')}
        <select className="inp" value={column} onChange={(e) => setColumn(e.target.value)}>
          {data.columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="check" style={{ margin: 0 }}>
          <input type="radio" checked={kind === 'sep'} onChange={() => setKind('sep')} /> {t('Séparateur')}
        </label>
        {kind === 'sep' && (
          <select className="inp" aria-label={t('Séparateur')} value={sep} onChange={(e) => setSep(e.target.value)} style={{ width: 70 }}>
            {SEPARATORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <label className="check" style={{ margin: 0 }} title={t('ZB1-04-03-B1B5C1C3 → ZB1-04-03-B1, -B5, -C1, -C3')}>
          <input type="radio" checked={kind === 'cases'} onChange={() => setKind('cases')} /> {t('Cases multiples (B1B5C1…)')}
        </label>
      </div>
      <div className="hint" role="status" style={{ fontSize: 13, color: 'var(--ink)' }}>
        <b>{t('{a} lignes → {b}', { a: data.rows.length, b: after })}</b>
        {after > MAX_ROWS && <span style={{ color: 'var(--err)' }}> — {t('limite de {m} lignes : les suivantes seront ignorées', { m: MAX_ROWS })}</span>}
      </div>
      {example ? (
        <div className="hint">
          {t('Exemple')} : <code>{example.from}</code> → {example.to.map((v, i) => <code key={i} style={{ marginRight: 6 }}>{v}</code>)}
        </div>
      ) : (
        <div className="hint">{t('Aucune valeur à éclater dans cette colonne avec ce mode.')}</div>
      )}
    </Modal>
  );
}

const DEFAULT_SEGMENTS: RangeSegment[] = [
  { name: 'Zone', kind: 'text', value: 'ZB1' },
  { name: 'Allée', kind: 'num', from: 1, to: 4, pad: 2 },
  { name: 'Travée', kind: 'num', from: 1, to: 10, pad: 2 },
  { name: 'Niveau', kind: 'alpha', from: 'A', to: 'E' },
  { name: 'Position', kind: 'num', from: 1, to: 5, pad: 0 },
];
const DEFAULT_FORMAT = '{Zone}-{Allée}-{Travée}-{Niveau}{Position}';

/** « Générer des emplacements… » : produit cartésien de segments (zone, allée, niveau…) */
function GenerateModal({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.doc.data);
  const [segs, setSegs] = useState<RangeSegment[]>(DEFAULT_SEGMENTS);
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [output, setOutput] = useState('Emplacement');
  const [append, setAppend] = useState(false);
  const gen = useMemo(() => generateRanges(segs, format, output, MAX_ROWS), [segs, format, output]);
  const room = append && data ? Math.max(0, MAX_ROWS - data.rows.length) : MAX_ROWS;
  const setSeg = (i: number, s: RangeSegment) => setSegs(segs.map((x, k) => (k === i ? s : x)));
  const changeKind = (i: number, kind: RangeSegment['kind']) => {
    const name = segs[i].name;
    setSeg(i, kind === 'text' ? { name, kind, value: '' } : kind === 'num' ? { name, kind, from: 1, to: 10, pad: 2 } : { name, kind, from: 'A', to: 'E' });
  };
  const apply = () => {
    const source = t('Générateur d’emplacements');
    let kept = 0;
    let lost = 0;
    useStore.getState().setDoc((d) => {
      const r = appendRows(append ? d.data : undefined, gen.columns, gen.rows, source);
      kept = r.data.rows.length;
      lost = r.truncated + (gen.total - gen.rows.length);
      d.data = r.data;
    });
    useStore.setState({ showData: true, ...(append ? {} : { previewRow: 0 }) });
    const st = useStore.getState();
    if (lost) st.toast(t('{n} lignes au total ; {k} combinaison(s) au-delà de {m} ignorée(s)', { n: kept, k: lost, m: MAX_ROWS }), 'error');
    else st.toast(t('{n} emplacement(s) générés — cochez les lignes à imprimer', { n: gen.rows.length }), 'ok');
    onClose();
  };
  const preview = gen.rows.slice(0, 3).map((r) => r[gen.columns[gen.columns.length - 1]]);
  return (
    <Modal
      title={t('Générer des emplacements')}
      icon={<Grid3x3 size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tc('Annuler', 'cancel')}
          </button>
          <button className="btn accent" disabled={!gen.rows.length || (append && room === 0)} onClick={apply}>
            {append ? t('Ajouter aux données') : t('Remplacer les données')}
          </button>
        </>
      }
    >
      <div className="hint">{t('Chaque segment est un texte fixe, une plage de nombres ou une plage de lettres ; toutes les combinaisons sont générées (le dernier segment varie le plus vite).')}</div>
      <table className="data-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>{t('Nom')}</th>
            <th>{t('Type')}</th>
            <th>{t('Valeurs')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {segs.map((s, i) => (
            <tr key={i}>
              <td>
                <input className="inp" style={{ minWidth: 80 }} aria-label={t('Nom du segment')} value={s.name} onChange={(e) => setSeg(i, { ...s, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              </td>
              <td>
                <select className="inp" aria-label={t('Type de segment')} value={s.kind} onChange={(e) => changeKind(i, e.target.value as RangeSegment['kind'])}>
                  <option value="text">{t('Texte fixe')}</option>
                  <option value="num">{t('Nombres')}</option>
                  <option value="alpha">{t('Lettres')}</option>
                </select>
              </td>
              <td>
                {s.kind === 'text' && <input className="inp" aria-label={t('Texte')} value={s.value} onChange={(e) => setSeg(i, { ...s, value: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
                {s.kind === 'num' && (
                  <div className="grid3" style={{ minWidth: 200 }}>
                    <NumField label={t('De')} decimals={0} value={s.from} onChange={(v) => setSeg(i, { ...s, from: Math.round(v) })} />
                    <NumField label={t('À')} decimals={0} value={s.to} onChange={(v) => setSeg(i, { ...s, to: Math.round(v) })} />
                    <NumField label={t('Chiffres')} decimals={0} min={0} max={10} value={s.pad} onChange={(v) => setSeg(i, { ...s, pad: Math.round(v) })} />
                  </div>
                )}
                {s.kind === 'alpha' && (
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input className="inp" style={{ width: 48 }} maxLength={1} aria-label={t('De')} value={s.from} onChange={(e) => setSeg(i, { ...s, from: e.target.value.toUpperCase() })} onKeyDown={(e) => e.stopPropagation()} />
                    –
                    <input className="inp" style={{ width: 48 }} maxLength={1} aria-label={t('À')} value={s.to} onChange={(e) => setSeg(i, { ...s, to: e.target.value.toUpperCase() })} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                )}
              </td>
              <td>
                <button className="icon-btn flat sm" aria-label={t('Retirer le segment')} disabled={segs.length <= 1} onClick={() => setSegs(segs.filter((_, k) => k !== i))}>
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn sm flat" style={{ marginBottom: 8 }} onClick={() => setSegs([...segs, { name: t('Segment {n}', { n: segs.length + 1 }), kind: 'num', from: 1, to: 9, pad: 0 }])}>
        <Plus size={14} /> {t('Ajouter un segment')}
      </button>
      <div className="grid2">
        <label className="f">
          {t('Modèle (noms de segments entre accolades)')}
          <input className="inp code" value={format} placeholder={DEFAULT_FORMAT} onChange={(e) => setFormat(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="f">
          {t('Colonne du résultat')}
          <input className="inp" value={output} onChange={(e) => setOutput(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </div>
      {data && (
        <div className="row" style={{ margin: '8px 0' }}>
          <label className="check" style={{ margin: 0 }}>
            <input type="radio" checked={!append} onChange={() => setAppend(false)} /> {t('Remplacer les données')}
          </label>
          <label className="check" style={{ margin: 0 }}>
            <input type="radio" checked={append} onChange={() => setAppend(true)} /> {t('Ajouter aux {n} lignes existantes', { n: data.rows.length })}
          </label>
        </div>
      )}
      <div className="hint" role="status" style={{ fontSize: 13, color: 'var(--ink)' }}>
        <b>{t('{n} combinaison(s)', { n: gen.total })}</b>
        {preview.length > 0 && (
          <>
            {' '}
            — {preview.map((v, i) => <code key={i} style={{ marginRight: 6 }}>{v}</code>)}
            {gen.total > 3 ? '…' : ''}
          </>
        )}
        {gen.total > room && <div style={{ color: 'var(--err)' }}>{t('Limite de {m} lignes : seules les {k} premières combinaisons seront gardées.', { m: MAX_ROWS, k: room })}</div>}
      </div>
    </Modal>
  );
}

/** Tableau virtualisé : seules les lignes visibles (± marge) sont rendues */
function DataTable({ data, visible }: { data: DataSet; visible: number[] }) {
  const previewRow = useStore((s) => s.previewRow);
  const [top, setTop] = useState(0);
  const [editRow, setEditRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** dernier tri appliqué depuis cet en-tête (un 2e clic inverse le sens) */
  const [sorted, setSorted] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(visible.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN);
  const slice = visible.slice(first, last);
  const cols = data.columns.length + 4;

  // ligne affichée hors de la vue (Aller à…, anomalie, curseur de l'éditeur) : on la fait défiler
  useEffect(() => {
    const el = box.current;
    const k = visible.indexOf(previewRow);
    if (!el || k < 0) return;
    const y = ROW_H * (k + 1); // + en-tête
    if (y < el.scrollTop + ROW_H || y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - el.clientHeight / 2);
  }, [previewRow, visible]);

  const sortBy = (col: string) => {
    const dir = sorted?.col === col && sorted.dir === 'asc' ? 'desc' : 'asc';
    replaceData((d) => sortRows(d, col, dir));
    setSorted({ col, dir });
    useStore.getState().toast(dir === 'asc' ? t('Lignes triées par « {c} » (croissant) — Ctrl+Z pour annuler', { c: col }) : t('Lignes triées par « {c} » (décroissant) — Ctrl+Z pour annuler', { c: col }), 'ok');
  };
  return (
    <div ref={box} className="scrollbox" style={{ maxHeight: VIEW_H }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th title={t('Copies')}>×</th>
            {data.columns.map((c) => (
              <th key={c} aria-sort={sorted?.col === c ? (sorted.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button
                  className="btn sm flat"
                  style={{ padding: '0 2px', height: 'auto', font: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}
                  title={sorted?.col === c && sorted.dir === 'asc' ? t('Trier par « {c} » (décroissant)', { c }) : t('Trier par « {c} » (croissant, ordre naturel)', { c })}
                  onClick={() => sortBy(c)}
                >
                  {c}
                  {sorted?.col === c && (sorted.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {first > 0 && (
            <tr aria-hidden="true" style={{ height: first * ROW_H }}>
              <td colSpan={cols} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {slice.map((i) =>
            editRow === i ? (
              <tr key={i} className="cur" style={{ height: ROW_H }}>
                <td colSpan={3}>
                  <button className="icon-btn flat sm" aria-label={t('Valider')} onClick={() => (setData((d) => ({ ...d, rows: d.rows.map((x, k) => (k === i ? draft : x)) })), setEditRow(null))}>
                    <CheckIcon size={14} />
                  </button>
                  <button className="icon-btn flat sm" aria-label={tc('Annuler', 'cancel')} onClick={() => setEditRow(null)}>
                    <X size={14} />
                  </button>
                </td>
                {data.columns.map((c) => (
                  <td key={c}>
                    <input className="inp" style={{ height: 24, minWidth: 80 }} value={draft[c] ?? ''} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
                  </td>
                ))}
                <td></td>
              </tr>
            ) : (
              <DataRow
                key={i}
                i={i}
                row={data.rows[i]}
                columns={data.columns}
                checked={!!data.checked[i]}
                copies={data.copies[i] ?? 1}
                current={previewRow === i}
                onEdit={(r) => {
                  setDraft({ ...r });
                  setEditRow(i);
                }}
              />
            ),
          )}
          {last < visible.length && (
            <tr aria-hidden="true" style={{ height: (visible.length - last) * ROW_H }}>
              <td colSpan={cols} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const DataRow = memo(
  function DataRow({
    i,
    row,
    columns,
    checked,
    copies,
    current,
    onEdit,
  }: {
    i: number;
    row: Record<string, string>;
    columns: string[];
    checked: boolean;
    copies: number;
    current: boolean;
    onEdit: (row: Record<string, string>) => void;
  }) {
    return (
      <tr className={current ? 'cur' : ''} style={{ height: ROW_H }} onClick={() => useStore.getState().set('previewRow', i)}>
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={t('Imprimer la ligne {n}', { n: i + 1 })}
            checked={checked}
            onChange={(e) => {
              const v = e.target.checked;
              setData((d) => ({ ...d, checked: d.checked.map((x, k) => (k === i ? v : x)) }));
            }}
            style={{ accentColor: 'var(--accent)' }}
          />
        </td>
        <td>{i + 1}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <input
            className="inp"
            style={{ width: 40, height: 22, padding: '2px 4px' }}
            inputMode="numeric"
            aria-label={t('Copies')}
            value={copies}
            onChange={(e) => {
              const v = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1));
              setData((d) => ({ ...d, copies: d.copies.map((x, k) => (k === i ? v : x)) }), 'copies');
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </td>
        {columns.map((c) => (
          <td key={c} title={row[c]}>
            {row[c]}
          </td>
        ))}
        <td onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn flat sm" title={t('Modifier la ligne')} aria-label={t('Modifier la ligne')} onClick={() => onEdit(row)}>
            <Pencil size={13} />
          </button>
        </td>
      </tr>
    );
  },
  // onEdit est recréé à chaque rendu mais ne dépend que de i et row
  (a, b) => a.i === b.i && a.row === b.row && a.columns === b.columns && a.checked === b.checked && a.copies === b.copies && a.current === b.current,
);

function NumberPanel() {
  const doc = useStore((s) => s.doc);
  const n = doc.numbering;
  const hasRows = !!doc.data?.rows.length;
  const set = (p: Partial<typeof n>) => useStore.getState().setDoc((d) => void (d.numbering = { ...d.numbering, ...p }), 'num');
  const used = docUsesSerial(doc);
  const [alphaStart, setAlphaStart] = useState<string | null>(null);
  const last = Math.max(0, Math.min(500, n.count) - 1);
  return (
    <Panel className="rightp" title={t('Numérotation')} icon={<Hash size={17} />} onClose={close}>
      <div className="hint">{t('Chaque étiquette reçoit le numéro suivant. Le champ {{numero}} peut être placé dans un texte, un code-barres ou un QR.')}</div>
      <div className="grid2">
        {n.alpha ? (
          <label className="f">
            {t('Départ (base 36)')}
            <input
              className="inp code"
              value={alphaStart ?? (n.start < 0 ? '-' : '') + serialDigits(n.start, true)}
              onChange={(e) => {
                setAlphaStart(e.target.value);
                const v = parseSerialAlpha(e.target.value);
                if (!isNaN(v)) set({ start: v });
              }}
              onBlur={() => setAlphaStart(null)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        ) : (
          <NumField label={t('Départ')} decimals={0} value={n.start} onChange={(v) => set({ start: Math.round(v) })} />
        )}
        <NumField label={t('Pas (négatif = décompte)')} decimals={0} value={n.step} onChange={(v) => set({ step: Math.round(v) || 1 })} />
        <NumField label={t('Chiffres (zéros)')} decimals={0} min={0} max={20} value={n.padding} onChange={(v) => set({ padding: Math.round(v) })} />
        <NumField label={t('Quantité (max 500)')} decimals={0} min={1} max={500} value={n.count} onChange={(v) => set({ count: Math.round(v) })} />
        <NumField label={t('Répéter chaque numéro')} decimals={0} min={1} max={500} value={n.repeat ?? 1} onChange={(v) => set({ repeat: Math.max(1, Math.round(v)) })} />
        <div style={{ alignSelf: 'end' }}>
          <Check checked={!!n.alpha} onChange={(v) => set({ alpha: v })} title={t('0-9 puis A-Z : 9, A, B … Z, 10, 11…')}>
            {t('Alphanumérique (base 36)')}
          </Check>
        </div>
        <label className="f">
          {t('Préfixe')}
          <input className="inp" value={n.prefix} onChange={(e) => set({ prefix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="f">
          {t('Suffixe')}
          <input className="inp" value={n.suffix} onChange={(e) => set({ suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </div>
      <div className="hint">
        {t('Aperçu')} : <b className="code">{serialValue(doc, 0)}</b>, <b className="code">{serialValue(doc, 1)}</b>, <b className="code">{serialValue(doc, 2)}</b> … <b className="code">{serialValue(doc, last)}</b>
      </div>
      <button className="btn accent block" onClick={() => insertToken('{{numero}}')} style={{ marginBottom: 8 }}>
        <Hash size={16} /> {t('Ajouter le numéro')}
      </button>
      <button className="btn block" onClick={() => insertToken('{{#pos}}/{{#total}}')} style={{ marginBottom: 8 }} title={t('{{#pos}} = position de l’étiquette dans le travail, {{#total}} = nombre d’étiquettes')}>
        <Hash size={16} /> {t('Ajouter « colis 1/N »')}
      </button>
      {used && <div className="okmsg">{t('Numérotation utilisée dans l’étiquette ✓')}</div>}
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Après une impression Zebra, le départ avance automatiquement pour la série suivante.')}
        {hasRows ? ' ' + t('Avec des données importées, une étiquette par ligne cochée (le numéro suit l’ordre des lignes).') : ''}
      </div>
      <SsccSection />
    </Panel>
  );
}

/** Configuration SSCC de cet appareil (préfixe, extension, prochain numéro) et journal */
function SsccSection() {
  const used = useStore((s) => docUsesSscc(s.doc));
  const [cfg, setCfg] = useState(getSsccConfig);
  const [prefix, setPrefix] = useState(cfg.prefix);
  const [ext, setExt] = useState(cfg.extension);
  const [next, setNext] = useState(nextSerial(cfg));
  const [err, setErr] = useState('');
  const [log, setLog] = useState(false);
  useEffect(() => {
    const sync = () => {
      const c = getSsccConfig();
      setCfg(c);
      setPrefix(c.prefix);
      setExt(c.extension);
      setNext(nextSerial(c));
    };
    const off = onSsccChange(sync);
    void loadSscc().catch(() => undefined);
    return off;
  }, []);
  const pairChanged = prefix !== cfg.prefix || ext !== cfg.extension;
  const dirty = pairChanged || next !== nextSerial(cfg);
  const save = async () => {
    setErr('');
    try {
      // préfixe / extension d'abord : le prochain numéro dépend du couple choisi
      if (pairChanged) await saveSsccSettings({ prefix, extension: ext });
      else await saveSsccSettings({ next });
      useStore.getState().toast(t('Réglages SSCC enregistrés'), 'ok');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const ok = isValidPrefix(cfg.prefix);
  const preview = ssccPreview(0);
  return (
    <div className="sec" style={{ marginTop: 12 }}>
      <div className="sec-t">
        <Package size={14} style={{ verticalAlign: -2 }} /> {t('SSCC (palettes, colis)')}
      </div>
      <div className="hint">{t('Code de colis GS1 à 18 chiffres, unique : extension + préfixe entreprise GS1 + numéro de série + clé. Réglages propres à cet appareil ; le numéro n’avance qu’après une impression ou un export réussi.')}</div>
      <div className="grid2">
        <label className="f">
          {t('Préfixe entreprise GS1')}
          <input className="inp code" inputMode="numeric" maxLength={10} placeholder="3012345" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="f">
          {t('Extension')}
          <select className="inp" value={ext} onChange={(e) => setExt(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <NumField
          label={t('Prochain numéro de série')}
          decimals={0}
          min={0}
          max={ok ? serialCapacity(cfg.prefix) - 1 : undefined}
          value={next}
          disabled={!ok || pairChanged}
          title={ok ? t('Minimum : {n} (numéros déjà émis)', { n: floorSerial(cfg) }) : undefined}
          onChange={(v) => setNext(Math.max(0, Math.round(v)))}
        />
        <div style={{ alignSelf: 'end' }}>
          <button className="btn sm block" disabled={!dirty} onClick={save}>
            {t('Enregistrer')}
          </button>
        </div>
      </div>
      {err && (
        <div className="hint" role="alert" style={{ color: 'var(--err)' }}>
          {err}
        </div>
      )}
      {ok ? (
        <div className="hint">
          {t('Prochain SSCC (aperçu, non réservé)')} : <b className="code">{preview ?? t('plage épuisée')}</b>
        </div>
      ) : (
        <div className="hint" style={{ color: 'var(--err)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 2 }} />
          <span>{used ? t('L’étiquette contient {{#sscc}} mais aucun préfixe GS1 n’est configuré : l’impression sera refusée.') : t('Aucun préfixe GS1 configuré.')}</span>
        </div>
      )}
      <button
        className="btn block"
        onClick={() => insertToken('{{#sscc}}')}
        style={{ marginBottom: 8 }}
        title={t('À placer dans un code-barres SSCC-18 (le « (00) » est ajouté) ou un texte. Un SSCC par ligne cochée ou par numéro de la série ; les copies gardent le même SSCC.')}
      >
        <Package size={16} /> {t('Insérer {{#sscc}}')}
      </button>
      <button className="btn sm flat block" onClick={() => setLog(true)}>
        <ListOrdered size={14} /> {t('Journal des SSCC émis')}
      </button>
      {log && <SsccLogModal onClose={() => setLog(false)} />}
    </div>
  );
}

const fmtStamp = (at: number) => new Date(at).toLocaleString();
const rowsText = (ix: number[]) => (ix.length > 6 ? ix.slice(0, 6).map((i) => i + 1).join(', ') + '…' : ix.map((i) => i + 1).join(', '));

function SsccLogModal({ onClose }: { onClose: () => void }) {
  // notPrinted : SSCC réservés par un travail interrompu mais pas (encore) imprimés (champ optionnel)
  const [list, setList] = useState<(SsccLogEntry & { notPrinted?: number })[] | null>(null);
  useEffect(() => {
    let live = true;
    listSsccLog()
      .then((l) => live && setList(l))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, []);
  const exportCsv = () => list && downloadText(ssccLogCsv(list), 'journal-sscc.csv', 'text/csv;charset=utf-8');
  const total = list ? list.reduce((a, e) => a + e.count, 0) : 0;
  return (
    <Modal
      title={t('Journal des SSCC émis')}
      icon={<ListOrdered size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" disabled={!list?.length} onClick={exportCsv}>
            <Download size={16} /> {t('Exporter en CSV')}
          </button>
          <button className="btn accent" onClick={onClose}>
            {t('Fermer')}
          </button>
        </>
      }
    >
      {!list ? (
        <div className="hint">{t('Chargement…')}</div>
      ) : !list.length ? (
        <div className="hint">{t('Aucun SSCC émis sur cet appareil.')}</div>
      ) : (
        <>
          <div className="hint">{t('{n} SSCC émis en {k} travail(s), le plus récent en tête.', { n: total, k: list.length })}</div>
          <div className="scrollbox" style={{ maxHeight: 360 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Document')}</th>
                  <th>{t('Plage')}</th>
                  <th>{t('Nombre')}</th>
                  <th>{t('Lignes / étiquettes')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtStamp(e.at)}</td>
                    <td title={e.kind}>{e.docName}</td>
                    <td className="code">
                      {e.first}
                      {e.count > 1 ? ' → ' + e.last : ''}
                    </td>
                    <td>
                      {e.count}
                      {!!e.notPrinted && (
                        <div style={{ color: 'var(--err)', fontSize: 12, whiteSpace: 'nowrap' }} title={t('Travail interrompu : les derniers SSCC de la plage restent attribués au travail et seront imprimés par sa reprise.')}>
                          {t('dont {n} réservés non imprimés', { n: e.notPrinted })}
                        </div>
                      )}
                    </td>
                    <td title={e.indices.map((i) => i + 1).join(', ')}>{rowsText(e.indices)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Construit le champ d'une date limite (DLC / DDM) : base (aujourd'hui ou colonne) + N jours */
export function shelfLifeText(kind: 'dlc' | 'ddm', base: string, days: number, format: string, withPrefix = true) {
  const src = base ? base : 'aujourdhui';
  const tok = `{{${src}${days ? `|jours:${days >= 0 ? '+' : ''}${days}` : ''}|date:${format}}}`;
  if (!withPrefix) return tok;
  return (kind === 'dlc' ? 'À consommer jusqu’au ' : 'À consommer de préférence avant le ') + tok;
}

function ShelfLifeInsert() {
  const doc = useStore((s) => s.doc);
  const previewRow = useStore((s) => s.previewRow);
  const cols = doc.data?.columns ?? [];
  const [kind, setKind] = useState<'dlc' | 'ddm'>('dlc');
  const [base, setBase] = useState('');
  const [days, setDays] = useState(5);
  const [fmt, setFmt] = useState('JJ/MM/AAAA');
  const [prefix, setPrefix] = useState(true);
  const txt = shelfLifeText(kind, base, days, fmt, prefix);
  const ctx = { doc, index: previewRow, row: doc.data?.rows[previewRow], resolve: true };
  return (
    <div className="sec">
      <div className="sec-t">{t('Date limite (DLC / DDM)')}</div>
      <div className="row">
        <label className="check" style={{ margin: 0 }}>
          <input type="radio" checked={kind === 'dlc'} onChange={() => (setKind('dlc'), setDays(days || 5))} /> {t('DLC (« À consommer jusqu’au »)')}
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="radio" checked={kind === 'ddm'} onChange={() => (setKind('ddm'), setDays(days < 30 ? 180 : days))} /> {t('DDM (« de préférence avant le »)')}
        </label>
      </div>
      <div className="grid2">
        <label className="f">
          {t('À partir de')}
          <select className="inp" value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">{t('Aujourd’hui (date d’impression)')}</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {t('Colonne « {c} »', { c })}
              </option>
            ))}
          </select>
        </label>
        <NumField label={t('+ jours')} decimals={0} min={-3650} max={3650} value={days} onChange={(v) => setDays(Math.round(v))} />
        <label className="f">
          {t('Format')}
          <select className="inp" value={fmt} onChange={(e) => setFmt(e.target.value)}>
            {['JJ/MM/AAAA', 'JJ/MM/AA', 'JJ.MM.AAAA', 'MM/AAAA', 'JJ MMMM AAAA'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div style={{ alignSelf: 'end' }}>
          <Check checked={prefix} onChange={setPrefix}>
            {t('Avec la mention')}
          </Check>
        </div>
      </div>
      <div className="hint">
        <code style={{ wordBreak: 'break-all' }}>{txt}</code>
        <br />→ <b>{resolveText(txt, ctx)}</b>
      </div>
      <button className="btn block" onClick={() => insertToken(txt)}>
        <CalendarDays size={16} /> {kind === 'dlc' ? t('Insérer la DLC') : t('Insérer la DDM')}
      </button>
    </div>
  );
}

const DATE_FORMATS = ['DD/MM/YYYY', 'DD/MM/YY', 'DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD MMM YYYY', 'DD MMMM YYYY', 'MMM YYYY', 'MM/YY', 'DD/MM/YYYY HH:mm'];

function DatePanel() {
  const doc = useStore((s) => s.doc);
  const d = doc.date;
  const set = (p: Partial<typeof d>) => useStore.getState().setDoc((x) => void (x.date = { ...x.date, ...p }), 'date');
  const [mode, setMode] = useState<'today' | 'plus'>(d.offsetDays ? 'plus' : 'today');
  return (
    <Panel className="rightp" title={t('Date')} icon={<CalendarDays size={17} />} onClose={close}>
      <div className="hint">{t('La date est calculée au moment de l’impression.')}</div>
      <label className="f" style={{ marginBottom: 8 }}>
        {t('Format')}
        <select className="inp" value={DATE_FORMATS.includes(d.format) ? d.format : '__custom'} onChange={(e) => e.target.value !== '__custom' && set({ format: e.target.value })}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatDate(new Date(), f)} — {f}
            </option>
          ))}
          <option value="__custom">{t('Personnalisé…')}</option>
        </select>
      </label>
      <label className="f" style={{ marginBottom: 8 }}>
        {t('Format personnalisé (JJ, MM, MMM, AAAA, HH:mm — jj/mm/aaaa accepté)')}
        <input className="inp code" value={d.format} onChange={(e) => set({ format: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="row">
        <label className="check" style={{ margin: 0 }}>
          <input type="radio" checked={mode === 'today'} onChange={() => (setMode('today'), set({ offsetDays: 0 }))} /> {t('Aujourd’hui')}
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="radio" checked={mode === 'plus'} onChange={() => (setMode('plus'), set({ offsetDays: d.offsetDays || 7 }))} /> {t('Aujourd’hui + N jours (DLC / DLUO)')}
        </label>
      </div>
      {mode === 'plus' && <NumField label={t('Nombre de jours')} decimals={0} min={-3650} max={3650} value={d.offsetDays} onChange={(v) => set({ offsetDays: Math.round(v) })} />}
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Aperçu')} : <b>{dateValue(doc)}</b>
      </div>
      <button className="btn accent block" onClick={() => insertToken('{{date}}')}>
        <CalendarDays size={16} /> {t('Ajouter la date')}
      </button>
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Astuce : {{date+30}} affiche la date dans 30 jours, indépendamment du réglage ci-dessus.')}
      </div>
      <ShelfLifeInsert />
    </Panel>
  );
}
