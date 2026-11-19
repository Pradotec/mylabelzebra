import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Trash2, Copy, Pencil, HelpCircle, Printer, Monitor, RefreshCw, AlertTriangle, CheckCircle2, Download, FileDown, Grid3x3, Barcode, QrCode, Plus, ExternalLink, Settings2 } from 'lucide-react';
import { useStore } from '../store';
import { Modal, NumField, Seg, Check } from './ui';
import { t, getLang, setLang, LANGS } from '../i18n';
import { listSaved, deleteSaved, renameSaved, duplicateSaved, confirmDiscard, sendToZebra, MAX_SAVED, setLabelSize } from '../actions';
import type { SavedLabel, Symbology, QrLevel, LabelDoc } from '../types';
import { batchJobs } from '../render/resolve';
import { printOnComputer, testPrint, downloadPdf, downloadPdfZip, downloadSheetsPdf, sheetPages } from '../export';
import { generateBatchZpl } from '../zpl/generate';
import * as zebra from '../zebra';
import { SHEETS, sheetById, sizeLabel } from '../sizes';
import { SYMBOLOGIES, encodeBarcode, encodeQr } from '../render/codes';
import { renderLabel } from '../render/draw';
import { makeBarcode, makeQr, newDoc } from '../elements';
import { canvasToBlob, downloadBlob } from '../util';
import { BASE_DPI } from '../types';

const closeModal = () => useStore.getState().set('modal', null);

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

// ---------- Aide ----------
export function HelpModal() {
  const K = ({ k }: { k: string }) => <span className="kbd">{k}</span>;
  const rows: [string, string][] = [
    ['Ctrl+Z', 'Annuler'],
    ['Ctrl+Y / Ctrl+Maj+Z', 'Rétablir'],
    ['Ctrl+C / Ctrl+V', 'Copier / coller (images comprises)'],
    ['Ctrl+D', 'Dupliquer'],
    ['Ctrl+G / Ctrl+Maj+G', 'Grouper / dégrouper'],
    ['Ctrl+A', 'Tout sélectionner'],
    ['Suppr', 'Supprimer la sélection'],
    ['Flèches', 'Déplacer de 1 point (Maj : 10 points)'],
    ['Ctrl + molette', 'Zoomer'],
    ['Molette', 'Faire défiler'],
    ['Maj + clic', 'Ajouter / retirer de la sélection'],
    ['Alt + clic', 'Sélectionner un élément dans un groupe'],
    ['Alt pendant un déplacement', 'Désactiver l’aimantation'],
    ['Double-clic', 'Modifier un texte ou une cellule'],
    ['Échap', 'Désélectionner / fermer'],
  ];
  return (
    <Modal title={t('Aide')} icon={<HelpCircle size={20} />} onClose={closeModal}>
      <p style={{ marginTop: 0 }}>{t('MyLabelZebra est un éditeur d’étiquettes gratuit qui fonctionne entièrement dans votre navigateur : aucune donnée n’est envoyée sur un serveur.')}</p>
      <div className="sec-t">{t('Raccourcis clavier')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '5px 0', width: '45%' }}>
                <K k={k} />
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
    </Modal>
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

  const run = async (onlyCurrent: boolean) => {
    setBusy(true);
    try {
      const list = onlyCurrent ? [{ index: st.previewRow, copies }] : jobs;
      if (printer === 'zebra') {
        const zpl = onlyCurrent ? generateBatchZpl(doc, st.previewRow, true, copies) : generateBatchZpl(doc, st.previewRow);
        const ok = await sendToZebra(zpl, !onlyCurrent);
        if (ok) closeModal();
      } else {
        await printOnComputer(doc, list, st.previewRow);
        closeModal();
      }
    } finally {
      setBusy(false);
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
      if (zip) await downloadPdfZip(doc, jobs, +dpi);
      else await downloadPdf(doc, jobs, +dpi);
      closeModal();
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
            <button className="btn" onClick={() => downloadSheetsPdf(doc, st.previewRow)}>
              <Download size={16} /> {t('Télécharger le PDF ({n} page(s))', { n: pages })}
            </button>
            <button className="btn accent" onClick={() => (st.set('printer', 'computer'), printOnComputer(doc, [], st.previewRow))}>
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
    const d = newDoc({ widthIn: 3, heightIn: sym === 'datamatrix' ? 3 : 1.5, dpi: 300 });
    const b = makeBarcode(d, sym, val);
    b.x = 20;
    b.y = 20;
    b.w = d.widthIn * BASE_DPI - 40;
    b.h = d.heightIn * BASE_DPI - 40;
    b.showText = text && sym !== 'datamatrix';
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
