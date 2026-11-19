import { memo, useEffect, useMemo, useState } from 'react';
import { Database, Hash, CalendarDays, ScanLine, Upload, Link2, Trash2, Pencil, Check as CheckIcon, X, AlertTriangle, Search, Package, ListOrdered, Download } from 'lucide-react';
import { useStore, type RightPanel } from '../store';
import { Panel, NumField, Check, Modal } from './ui';
import { t } from '../i18n';
import { parseDelimited, parseFile, fetchSheet, canSwitchSheet, reloadSheet, type DataWarning } from '../data';
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

/** Comparaison sans accents ni casse */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export type RowOp = 'contains' | 'eq' | 'empty' | 'notEmpty';
export interface RowFilter {
  /** recherche dans toutes les colonnes */
  query: string;
  /** colonne du critère ('' = aucun critère) */
  column: string;
  op: RowOp;
  value: string;
}

/** Indices des lignes qui passent la recherche et le critère de colonne */
export function filterRows(data: DataSet, f: RowFilter): number[] {
  const q = fold(f.query);
  const v = fold(f.value);
  const out: number[] = [];
  data.rows.forEach((r, i) => {
    if (q && !data.columns.some((c) => fold(r[c] ?? '').includes(q))) return;
    if (f.column) {
      const x = fold(r[f.column] ?? '');
      if (f.op === 'contains' && v && !x.includes(v)) return;
      if (f.op === 'eq' && x !== v) return;
      if (f.op === 'empty' && x !== '') return;
      if (f.op === 'notEmpty' && x === '') return;
    }
    out.push(i);
  });
  return out;
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
    () => (rows && columns ? (active ? filterRows({ rows, columns, checked: [], copies: [] }, filter) : rows.map((_, i) => i)) : []),
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
        </>
      )}
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
        </>
      )}
    </Panel>
  );
}

function RowFilterBar({ columns, filter, setFilter }: { columns: string[]; filter: RowFilter; setFilter: (f: RowFilter) => void }) {
  const set = (p: Partial<RowFilter>) => setFilter({ ...filter, ...p });
  const needsValue = filter.op === 'contains' || filter.op === 'eq';
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
            <option value="empty">{t('est vide')}</option>
            <option value="notEmpty">{t('n’est pas vide')}</option>
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

/** Tableau virtualisé : seules les lignes visibles (± marge) sont rendues */
function DataTable({ data, visible }: { data: DataSet; visible: number[] }) {
  const previewRow = useStore((s) => s.previewRow);
  const [top, setTop] = useState(0);
  const [editRow, setEditRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(visible.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN);
  const slice = visible.slice(first, last);
  const cols = data.columns.length + 4;
  return (
    <div className="scrollbox" style={{ maxHeight: VIEW_H }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th title={t('Copies')}>×</th>
            {data.columns.map((c) => (
              <th key={c}>{c}</th>
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
                  <button className="icon-btn flat sm" aria-label={t('Annuler')} onClick={() => setEditRow(null)}>
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
  const [list, setList] = useState<SsccLogEntry[] | null>(null);
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
                    <td>{e.count}</td>
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
