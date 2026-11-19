/**
 * Fenêtre « Étiquettes transporteur » : import de ZPL / PDF / images (plusieurs fichiers,
 * glisser-déposer, .zip), conversion PDF / image → ZPL ^GFA, liste, aperçu, impression
 * Zebra (ZPL envoyé à l'identique) ou téléchargement d'un .zpl combiné.
 * La liste reste en mémoire pendant la session (fermer la fenêtre ne la vide pas).
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Truck, Upload, Printer, Download, Eye, ArrowUp, ArrowDown, Trash2, FileText, Image as ImageIcon, FileCode, AlertTriangle } from 'lucide-react';
import { Modal, Seg, Check } from './ui';
import { useStore } from '../store';
import { t } from '../i18n';
import * as zebra from '../zebra';
import { downloadBlob } from '../util';
import { CARRIER_FORMATS, DEFAULT_SETTINGS, convertItem, expandFiles, formatDots, itemBytes, makeItem, renderZplPages, zplThumb, type CarrierItem, type CarrierSettings } from '../carrier/load';
import { concatBytes } from '../carrier/zplText';
import type { Rotation } from '../carrier/raster';

interface CarrierState {
  open: boolean;
  items: CarrierItem[];
  settings: CarrierSettings;
  busy: string;
}

export const useCarrier = create<CarrierState>()(() => ({ open: false, items: [], settings: DEFAULT_SETTINGS, busy: '' }));

export const openCarrierDialog = () => useCarrier.setState({ open: true });
/** Ouvre la fenêtre et y ajoute des fichiers (dépôt sur l'éditeur) */
export function openCarrierWithFiles(files: File[]) {
  openCarrierDialog();
  return addCarrierFiles(files);
}
const closeCarrier = () => useCarrier.setState({ open: false });
const setItems = (f: (l: CarrierItem[]) => CarrierItem[]) => useCarrier.setState((s) => ({ items: f(s.items) }));
const refresh = () => setItems((l) => [...l]);

const toast = (m: string, k?: 'info' | 'ok' | 'error') => useStore.getState().toast(m, k);

/** Ajoute des fichiers (sélecteur, dépôt) : ouverture des .zip, conversion, vignettes. */
export async function addCarrierFiles(files: File[]) {
  if (!files.length) return;
  useCarrier.setState({ busy: t('Lecture des fichiers…') });
  try {
    const { files: flat, skipped } = await expandFiles(files);
    const added: CarrierItem[] = [];
    const ignored = [...skipped];
    for (const f of flat) {
      const it = makeItem(f);
      if (it) added.push(it);
      else ignored.push(f.name);
    }
    setItems((l) => [...l, ...added]);
    if (ignored.length) toast(t('Fichiers ignorés (format non reconnu) : {l}', { l: ignored.join(', ') }), 'error');
    for (const it of added) await prepare(it, (i) => useCarrier.setState({ busy: t('Conversion de {n}…', { n: i.name }) }));
  } catch (e) {
    toast(t('Import impossible : {m}', { m: (e as Error).message }), 'error');
  } finally {
    useCarrier.setState({ busy: '' });
  }
}

async function prepare(it: CarrierItem, onStart?: (it: CarrierItem) => void) {
  const s = useCarrier.getState().settings;
  onStart?.(it);
  try {
    if (it.kind === 'zpl') await zplThumb(it, s);
    else await convertItem(it, s);
    if (it.error === 'empty') it.error = t('Aucune page');
    else if (it.kind === 'zpl' && !it.pages) it.error = t('Aucune étiquette ^XA…^XZ détectée');
  } catch (e) {
    it.error = (e as Error).message || String(e);
    it.checked = false;
  }
  refresh();
}

/** Reconvertit les PDF / images après un changement de réglage (le ZPL importé ne bouge pas). */
async function reconvertAll() {
  const list = useCarrier.getState().items.filter((i) => i.kind !== 'zpl');
  if (!list.length) return;
  useCarrier.setState({ busy: t('Conversion…') });
  try {
    for (const it of list) await prepare(it);
  } finally {
    useCarrier.setState({ busy: '' });
  }
}

/** Les octets d'un ZPL Latin-1 hors ASCII ne passent pas à l'identique par Browser Print (envoi en UTF-8) */
const latin1Risk = (it: CarrierItem) => it.kind === 'zpl' && it.encoding === 'latin1' && !!it.raw && it.raw.some((b) => b >= 0x80);

function selectedItems() {
  return useCarrier.getState().items.filter((i) => i.checked && !i.error && i.zpl);
}

function downloadCombined(list = selectedItems()) {
  if (!list.length) return;
  const bytes = concatBytes(list.map(itemBytes));
  const name = list.length === 1 ? list[0].name.replace(/\.[^.]+$/, '') + '.zpl' : `etiquettes-transporteur-${new Date().toISOString().slice(0, 10)}.zpl`;
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), name);
}

async function printSelection() {
  const list = selectedItems();
  if (!list.length) return;
  // chaque entrée telle qu'importée / produite, séparée par un saut de ligne si besoin
  const text = list.map((i) => (/[\r\n]$/.test(i.zpl) ? i.zpl : i.zpl + '\n')).join('');
  useCarrier.setState({ busy: t('Envoi à l’imprimante…') });
  try {
    const dev = await zebra.sendRaw(text);
    toast(t('Envoyé à {p}', { p: dev.name }), 'ok');
  } catch (e) {
    if (e instanceof zebra.NoPrinterSelected) {
      toast(t('Aucune imprimante Zebra sélectionnée.'), 'error');
      useStore.getState().set('modal', 'zebra');
    } else if (e instanceof zebra.BrowserPrintMissing || (e as Error).name === 'TypeError' || (e as Error).name === 'AbortError') {
      toast(t('Zebra Browser Print est introuvable : le fichier .zpl est téléchargé à la place.'), 'error');
      downloadCombined(list);
    } else toast(t('Erreur d’impression : {m}', { m: (e as Error).message }), 'error');
  } finally {
    useCarrier.setState({ busy: '' });
  }
}

const KIND_ICON = { zpl: FileCode, pdf: FileText, image: ImageIcon };

export function CarrierDialogHost() {
  const open = useCarrier((s) => s.open);
  return open ? <CarrierDialog /> : null;
}

function CarrierDialog() {
  const { items, settings, busy } = useCarrier();
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  // réglages de conversion : reconversion différée des PDF / images
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const tm = setTimeout(() => void reconvertAll(), 350);
    return () => clearTimeout(tm);
  }, [settings]);

  const set = (p: Partial<CarrierSettings>) => useCarrier.setState((s) => ({ settings: { ...s.settings, ...p } }));
  const move = (i: number, d: number) =>
    setItems((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const sel = items.filter((i) => i.checked && !i.error && i.zpl);
  const pages = sel.reduce((a, i) => a + i.pages, 0);
  const allOn = items.length > 0 && items.every((i) => i.checked || i.error);
  const hasRaster = items.some((i) => i.kind !== 'zpl');
  const previewItem = items.find((i) => i.id === preview);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(false);
    void addCarrierFiles(Array.from(e.dataTransfer.files || []));
  };

  return (
    <Modal
      title={t('Étiquettes transporteur')}
      icon={<Truck size={20} />}
      wide
      onClose={closeCarrier}
      footer={
        <div className="row" style={{ width: '100%', flexWrap: 'wrap', gap: 8 }}>
          <span className="hint" style={{ margin: 0, flex: 1 }}>
            {busy || t('{n} étiquette(s) sélectionnée(s), {p} page(s)', { n: sel.length, p: pages })}
          </span>
          <button className="btn" disabled={!sel.length || !!busy} onClick={() => downloadCombined()}>
            <Download size={16} /> {t('Télécharger le .zpl combiné')}
          </button>
          <button className="btn accent" disabled={!sel.length || !!busy} onClick={() => void printSelection()}>
            <Printer size={16} /> {t('Imprimer la sélection')}
          </button>
        </div>
      }
    >
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.stopPropagation();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={{
          border: '2px dashed ' + (drag ? 'var(--accent)' : 'var(--line, #d0d5dd)'),
          borderRadius: 14,
          padding: 16,
          textAlign: 'center',
          marginBottom: 12,
          background: drag ? 'rgba(255,90,54,.06)' : undefined,
        }}
      >
        <div style={{ marginBottom: 8 }}>{t('Déposez ici vos étiquettes : ZPL (.zpl, .txt), PDF, PNG, JPG ou une archive .zip')}</div>
        <button className="btn" disabled={!!busy} onClick={() => inputRef.current?.click()}>
          <Upload size={16} /> {t('Choisir des fichiers…')}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".zpl,.txt,.prn,.pdf,.png,.jpg,.jpeg,.zip,application/pdf,image/png,image/jpeg,application/zip"
          onChange={(e) => {
            const f = Array.from(e.target.files || []);
            e.target.value = '';
            void addCarrierFiles(f);
          }}
        />
        <div className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          {t('Le ZPL transporteur est envoyé tel quel, sans aucune modification. Les PDF et images sont convertis en image ZPL (^GFA).')}
        </div>
      </div>

      <details open={hasRaster} style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('Conversion des PDF et images')}</summary>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          <span>{t('Résolution')}</span>
          <Seg value={String(settings.dpi)} onChange={(v) => set({ dpi: +v })} options={['203', '300', '600'].map((v) => ({ v, label: v + ' dpi' }))} />
          <label className="f" style={{ minWidth: 170 }}>
            {t('Format')}
            <select className="inp" value={settings.formatId} onChange={(e) => set({ formatId: e.target.value })}>
              {CARRIER_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="f" style={{ minWidth: 150 }}>
            {t('Rotation')}
            <select className="inp" value={String(settings.rotate)} onChange={(e) => set({ rotate: e.target.value === 'auto' ? 'auto' : (+e.target.value as Rotation) })}>
              <option value="auto">{t('Automatique')}</option>
              <option value="0">0°</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          <label className="f" style={{ flex: 1, minWidth: 200 }}>
            {t('Seuil noir/blanc : {v}', { v: settings.threshold })}
            <input type="range" min={20} max={240} value={settings.threshold} onChange={(e) => set({ threshold: +e.target.value })} />
          </label>
          <Check checked={settings.crop} onChange={(v) => set({ crop: v })}>
            {t('Recadrer sur le contenu')}
          </Check>
          <Check checked={settings.dither} onChange={(v) => set({ dither: v })} title={t('Tramage : pour les logos et photos en niveaux de gris')}>
            {t('Tramage')}
          </Check>
        </div>
        <div className="hint" style={{ marginBottom: 0 }}>
          {t('Format cible : {w} × {h} points.', formatDots(settings))}
        </div>
      </details>

      {items.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <Check checked={allOn} onChange={(v) => setItems((l) => l.map((i) => ({ ...i, checked: v && !i.error })))}>
            {t('Tout sélectionner')}
          </Check>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn flat" onClick={() => setItems(() => [])}>
            <Trash2 size={16} /> {t('Vider la liste')}
          </button>
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {items.map((it, i) => {
          const Icon = KIND_ICON[it.kind];
          return (
            <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 6, borderRadius: 12, border: '1px solid var(--line, #e4e7ec)' }}>
              <input type="checkbox" aria-label={t('Sélectionner {n}', { n: it.name })} checked={it.checked} disabled={!!it.error} onChange={(e) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, checked: e.target.checked } : x)))} />
              <div style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', background: '#f4f5f7', borderRadius: 8, flex: 'none' }}>
                {it.thumb ? <img src={it.thumb} alt="" style={{ maxWidth: 54, maxHeight: 54, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /> : <Icon size={22} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>
                  {it.name}
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {it.kind === 'zpl' ? t('ZPL d’origine (inchangé)') : it.kind === 'pdf' ? t('PDF → ZPL ^GFA') : t('Image → ZPL ^GFA')} · {t('{n} page(s)', { n: it.pages })}
                  {it.error && (
                    <span style={{ color: 'var(--danger, #d43b2a)' }}>
                      {' '}
                      · <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {it.error}
                    </span>
                  )}
                  {latin1Risk(it) && (
                    <span title={t('Caractères non UTF-8 : le .zpl téléchargé est identique, mais Browser Print les transmet en UTF-8.')}>
                      {' '}
                      · <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {t('Encodage Latin-1')}
                    </span>
                  )}
                </div>
              </div>
              <button className="icon-btn flat" aria-label={t('Aperçu')} title={t('Aperçu')} disabled={!it.zpl || !!it.error} onClick={() => setPreview(it.id)}>
                <Eye size={17} />
              </button>
              <button className="icon-btn flat" aria-label={t('Monter')} title={t('Monter')} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={17} />
              </button>
              <button className="icon-btn flat" aria-label={t('Descendre')} title={t('Descendre')} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={17} />
              </button>
              <button className="icon-btn flat" aria-label={t('Retirer')} title={t('Retirer')} onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}>
                <Trash2 size={17} />
              </button>
            </li>
          );
        })}
      </ul>
      {previewItem && <CarrierPreview item={previewItem} settings={settings} onClose={() => setPreview(null)} />}
    </Modal>
  );
}

const MAX_PREVIEW = 30;

function CarrierPreview({ item, settings, onClose }: { item: CarrierItem; settings: CarrierSettings; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const { w, h } = formatDots(settings);
    // relu avec le parseur ZPL interne : ce qui s'affiche est ce que décrit le ZPL envoyé
    renderZplPages(item.zpl, w, h, MAX_PREVIEW)
      .then((cvs) => {
        const el = box.current;
        if (!alive || !el) return;
        el.innerHTML = '';
        if (!cvs.length) setErr(t('Aucune étiquette ^XA…^XZ détectée'));
        for (const cv of cvs) {
          cv.style.maxWidth = '100%';
          cv.style.maxHeight = '60vh';
          cv.style.boxShadow = '0 2px 12px rgba(0,0,0,.18)';
          cv.style.background = '#fff';
          el.appendChild(cv);
        }
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [item, settings]);
  return (
    <Modal title={t('Aperçu — {n}', { n: item.name })} icon={<Eye size={20} />} wide onClose={onClose}>
      {item.pages > MAX_PREVIEW && <div className="hint">{t('Seules les {n} premières pages sont affichées.', { n: MAX_PREVIEW })}</div>}
      {item.kind === 'zpl' && <div className="hint">{t('Aperçu approximatif (rendu interne) ; le ZPL envoyé est celui du fichier, sans modification.')}</div>}
      {err && <div className="hint" style={{ color: 'var(--danger, #d43b2a)' }}>{err}</div>}
      <div ref={box} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }} />
    </Modal>
  );
}
