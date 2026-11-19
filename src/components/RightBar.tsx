import { useState } from 'react';
import { Database, Hash, CalendarDays, ScanLine, Upload, Link2, Trash2, Pencil, Check as CheckIcon, X } from 'lucide-react';
import { useStore, type RightPanel } from '../store';
import { Panel, NumField, Check } from './ui';
import { t } from '../i18n';
import { parseDelimited, parseFile, fetchSheet } from '../data';
import { insertToken } from '../actions';
import { pickFile } from '../util';
import { serialValue, dateValue, formatDate, docUsesSerial, resolveText } from '../render/resolve';
import type { DataSet } from '../types';

export function RightBar() {
  const st = useStore();
  const toggle = (p: RightPanel) => st.set('rightPanel', st.rightPanel === p ? null : p);
  const nRows = st.doc.data?.rows.length ?? 0;
  return (
    <>
      <nav className="sidebar right pill hide-in-preview" aria-label={t('Outils de données')}>
        <button className={'tool' + (st.rightPanel === 'data' ? ' on' : '')} onClick={() => toggle('data')} aria-label={t('Données')}>
          <Database />
          {t('Données')}
          {nRows > 0 && <span className="badge">{nRows}</span>}
        </button>
        <button className={'tool' + (st.rightPanel === 'number' ? ' on' : '')} onClick={() => toggle('number')} aria-label={t('Numérotation')}>
          <Hash />
          {t('Numéro')}
        </button>
        <button className={'tool' + (st.rightPanel === 'date' ? ' on' : '')} onClick={() => toggle('date')} aria-label={t('Dates')}>
          <CalendarDays />
          {t('Date')}
        </button>
        <button className="tool" onClick={() => st.set('modal', 'zpl')} aria-label={t('Visionneuse ZPL')}>
          <ScanLine />
          {t('Visionneuse ZPL')}
        </button>
      </nav>
      {st.rightPanel === 'data' && <DataPanel />}
      {st.rightPanel === 'number' && <NumberPanel />}
      {st.rightPanel === 'date' && <DatePanel />}
    </>
  );
}

const close = () => useStore.getState().set('rightPanel', null);

export function loadData(ds: DataSet) {
  const st = useStore.getState();
  st.setDoc((d) => void (d.data = ds));
  useStore.setState({ previewRow: 0, showData: true });
  st.toast(t('{n} lignes importées — cochez les lignes à imprimer', { n: ds.rows.length }), 'ok');
}

export function DataPanel() {
  const st = useStore();
  const data = st.doc.data;
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editRow, setEditRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const fromFile = async () => {
    const f = await pickFile('.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods');
    if (!f) return;
    try {
      loadData(await parseFile(f));
    } catch (e) {
      st.toast(t('Import impossible : {m}', { m: (e as Error).message }), 'error');
    }
  };
  const fromText = (txt: string) => {
    try {
      loadData(parseDelimited(txt));
      setPaste('');
    } catch (e) {
      st.toast(t('Import impossible : {m}', { m: (e as Error).message }), 'error');
    }
  };
  const fromUrl = async () => {
    setBusy(true);
    try {
      loadData(await fetchSheet(url));
    } catch (e) {
      st.toast(t('Lien illisible : publiez la feuille (Fichier › Partager › Publier sur le Web › CSV). {m}', { m: (e as Error).message }), 'error');
    } finally {
      setBusy(false);
    }
  };
  const setData = (f: (d: DataSet) => DataSet, key?: string) => st.setDoc((d) => void (d.data = d.data ? f(d.data) : d.data), key);
  const nChecked = data ? data.checked.filter(Boolean).length : 0;

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
              {data.source} · {t('{n} lignes', { n: data.rows.length })}
            </span>
            <button className="btn sm flat" style={{ color: 'var(--err)' }} onClick={() => window.confirm(t('Retirer les données de cette étiquette ?')) && st.setDoc((d) => void (d.data = undefined))}>
              <Trash2 size={14} /> {t('Retirer')}
            </button>
          </div>
          <div className="sec-t">{t('Colonnes — cliquez pour insérer')}</div>
          <div className="tags">
            {data.columns.map((c) => (
              <button key={c} className="tag" onClick={() => insertToken(`{{${c}}}`)} title={t('Insérer {{{c}}} dans l’élément sélectionné', { c })}>
                {`{{${c}}}`}
              </button>
            ))}
          </div>
          <Check checked={st.showData} onChange={(v) => st.set('showData', v)}>
            {t('Afficher les valeurs (sinon les {{champs}})')}
          </Check>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="sec-t" style={{ margin: 0 }}>
              {t('Lignes à imprimer : {n}', { n: nChecked })}
            </span>
            <span>
              <button className="btn sm flat" onClick={() => setData((d) => ({ ...d, checked: d.rows.map(() => true) }))}>
                {t('Tout')}
              </button>
              <button className="btn sm flat" onClick={() => setData((d) => ({ ...d, checked: d.rows.map(() => false) }))}>
                {t('Aucune')}
              </button>
            </span>
          </div>
          <div className="scrollbox">
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
                {data.rows.map((r, i) =>
                  editRow === i ? (
                    <tr key={i} className="cur">
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
                          <input className="inp" style={{ height: 26, minWidth: 80 }} value={draft[c] ?? ''} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
                        </td>
                      ))}
                      <td></td>
                    </tr>
                  ) : (
                    <tr key={i} className={st.previewRow === i ? 'cur' : ''} onClick={() => st.set('previewRow', i)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t('Imprimer la ligne {n}', { n: i + 1 })}
                          checked={!!data.checked[i]}
                          onChange={(e) => setData((d) => ({ ...d, checked: d.checked.map((v, k) => (k === i ? e.target.checked : v)) }))}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                      </td>
                      <td>{i + 1}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          className="inp"
                          style={{ width: 40, height: 24, padding: '2px 4px' }}
                          inputMode="numeric"
                          aria-label={t('Copies')}
                          value={data.copies[i] ?? 1}
                          onChange={(e) => setData((d) => ({ ...d, copies: d.copies.map((v, k) => (k === i ? Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)) : v)) }), 'copies')}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </td>
                      {data.columns.map((c) => (
                        <td key={c} title={r[c]}>
                          {r[c]}
                        </td>
                      ))}
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn flat sm"
                          title={t('Modifier la ligne')}
                          aria-label={t('Modifier la ligne')}
                          onClick={() => {
                            setDraft({ ...r });
                            setEditRow(i);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {nChecked ? t('Imprimer et exporter (PDF, ZPL) produiront {n} étiquette(s).', { n: nChecked }) : t('Aucune ligne cochée : seule la ligne affichée sera imprimée.')}
          </div>
        </>
      )}
    </Panel>
  );
}

function NumberPanel() {
  const st = useStore();
  const n = st.doc.numbering;
  const set = (p: Partial<typeof n>) => st.setDoc((d) => void (d.numbering = { ...d.numbering, ...p }), 'num');
  const used = docUsesSerial(st.doc);
  return (
    <Panel className="rightp" title={t('Numérotation')} icon={<Hash size={17} />} onClose={close}>
      <div className="hint">{t('Chaque étiquette reçoit le numéro suivant. Le champ {{numero}} peut être placé dans un texte, un code-barres ou un QR.')}</div>
      <div className="grid2">
        <NumField label={t('Départ')} decimals={0} value={n.start} onChange={(v) => set({ start: Math.round(v) })} />
        <NumField label={t('Pas')} decimals={0} value={n.step} onChange={(v) => set({ step: Math.round(v) || 1 })} />
        <NumField label={t('Chiffres (zéros)')} decimals={0} min={0} max={20} value={n.padding} onChange={(v) => set({ padding: Math.round(v) })} />
        <NumField label={t('Quantité (max 500)')} decimals={0} min={1} max={500} value={n.count} onChange={(v) => set({ count: Math.round(v) })} />
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
        {t('Aperçu')} : <b className="code">{serialValue(st.doc, 0)}</b>, <b className="code">{serialValue(st.doc, 1)}</b> … <b className="code">{serialValue(st.doc, Math.max(0, Math.min(500, n.count) - 1))}</b>
      </div>
      <button className="btn accent block" onClick={() => insertToken('{{numero}}')} style={{ marginBottom: 8 }}>
        <Hash size={16} /> {t('Ajouter le numéro')}
      </button>
      {used && <div className="okmsg">{t('Numérotation utilisée dans l’étiquette ✓')}</div>}
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Après une impression Zebra, le départ avance automatiquement pour la série suivante.')}
        {st.doc.data?.rows.length ? ' ' + t('Avec des données importées, une étiquette par ligne cochée (le numéro suit l’ordre des lignes).') : ''}
      </div>
    </Panel>
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
  const st = useStore();
  const cols = st.doc.data?.columns ?? [];
  const [kind, setKind] = useState<'dlc' | 'ddm'>('dlc');
  const [base, setBase] = useState('');
  const [days, setDays] = useState(5);
  const [fmt, setFmt] = useState('JJ/MM/AAAA');
  const [prefix, setPrefix] = useState(true);
  const txt = shelfLifeText(kind, base, days, fmt, prefix);
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
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
  const st = useStore();
  const d = st.doc.date;
  const set = (p: Partial<typeof d>) => st.setDoc((x) => void (x.date = { ...x.date, ...p }), 'date');
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
        {t('Format personnalisé (DD, MM, MMM, YYYY, HH, mm)')}
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
        {t('Aperçu')} : <b>{dateValue(st.doc)}</b>
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
