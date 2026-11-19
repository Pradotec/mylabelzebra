import { useEffect, useState } from 'react';
import { Eye, EyeOff, Contrast, Hand, Minus, Plus, ChevronLeft, ChevronRight, Type, Barcode, QrCode, Database, MoreHorizontal, Shapes, Image as ImageIcon, Layers, LayoutTemplate, Hash, CalendarDays, ScanLine, Table2, BoxSelect, Copy } from 'lucide-react';
import { useStore, lastCopiedSystemText } from './store';
import { isQuotaError, storageErrorMessage } from './storage';
import { ProgressOverlay } from './components/Progress';
import { TopBar } from './components/TopBar';
import { SetupBar } from './components/SetupBar';
import { LeftBar } from './components/LeftBar';
import { RightBar } from './components/RightBar';
import { Editor } from './components/Editor';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ZplViewer, openZplViewer } from './components/ZplViewer';
import { SavedLabels, HelpModal, PrintDialog, ExportDialog, ZebraPanel, SheetsDialog, BarcodeTool, QrTool, PromptDialog, HistoryModal } from './components/Modals';
import { CarrierDialogHost, useCarrier, openCarrierWithFiles } from './components/CarrierDialog';
import { NutritionDialogHost } from './components/NutritionDialog';
import { Dropdown } from './components/ui';
import { nudge } from './components/ContextMenu';
import { t, tc, onLangChange } from './i18n';
import { addImageFile, addText, addQr, addBarcode, saveCurrent } from './actions';
import { applyUrlParams } from './urlParams';
import { applyRemoteUrl, installMessageApi } from './remote';
import { BASE_DPI } from './types';
import { pickFile } from './util';

const PHYS = 96 / BASE_DPI; // zoom correspondant à la taille réelle (100 %)

function ZoomBar() {
  const zoom = useStore((s) => s.zoom);
  const preview = useStore((s) => s.preview);
  const thermal = useStore((s) => s.thermal);
  const dpi = useStore((s) => s.doc.dpi);
  const hand = useStore((s) => s.hand);
  const spaceHand = useStore((s) => s.spaceHand);
  const st = useStore.getState();
  const pct = Math.round((zoom / PHYS) * 100);
  return (
    <div className="zoombar pill" role="toolbar" aria-label={t('Zoom')}>
      <button className={'icon-btn flat sm' + (preview ? ' on' : '')} title={t('Mode aperçu (masque les outils)')} aria-label={t('Mode aperçu')} onClick={() => useStore.setState({ preview: !preview, selected: [], editingTextId: null })}>
        {preview ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button
        className={'icon-btn flat sm' + (thermal ? ' on' : '')}
        title={t('Aperçu thermique : rendu noir et blanc tel que l’imprimante l’imprimera ({dpi} dpi)', { dpi })}
        aria-label={t('Aperçu thermique')}
        aria-pressed={thermal}
        onClick={() => useStore.setState({ thermal: !thermal })}
      >
        <Contrast size={16} />
      </button>
      <button
        className={'icon-btn flat sm' + (hand || spaceHand ? ' on' : '')}
        title={t('Déplacer la vue (H, ou maintenir Espace)')}
        aria-label={t('Déplacer la vue (H, ou maintenir Espace)')}
        aria-pressed={hand}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => useStore.setState({ hand: !useStore.getState().hand })}
        onDoubleClick={() => useStore.setState((s) => ({ fitRequest: s.fitRequest + 1 }))}
      >
        <Hand size={16} />
      </button>
      <button className="icon-btn flat sm" aria-label={t('Zoom arrière')} onClick={() => st.setZoom(zoom / 1.2)}>
        <Minus size={16} />
      </button>
      <input type="range" aria-label={t('Zoom')} min={10} max={800} value={pct} onChange={(e) => st.setZoom((+e.target.value / 100) * PHYS)} />
      <button className="icon-btn flat sm" aria-label={t('Zoom avant')} onClick={() => st.setZoom(zoom * 1.2)}>
        <Plus size={16} />
      </button>
      <button className="pct" title={t('Taille réelle (100 %)')} aria-label={t('Taille réelle (100 %)')} onClick={() => (st.setZoom(PHYS), useStore.setState({ pan: { x: 0, y: 0 } }))}>
        {pct}%
      </button>
    </div>
  );
}

function RowBar() {
  const st = useStore();
  const d = st.doc.data;
  if (!d || !d.rows.length) return null;
  const n = d.rows.length;
  const i = Math.min(st.previewRow, n - 1);
  return (
    <div className="rowbar pill" role="toolbar" aria-label={t('Ligne de données affichée')}>
      <input
        type="checkbox"
        title={t('Imprimer cette ligne')}
        aria-label={t('Imprimer cette ligne')}
        checked={!!d.checked[i]}
        onChange={(e) => st.setDoc((x) => void (x.data = { ...x.data!, checked: x.data!.checked.map((v, k) => (k === i ? e.target.checked : v)) }))}
        style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
      />
      <button className="icon-btn flat sm" disabled={i <= 0} aria-label={t('Ligne précédente')} onClick={() => st.set('previewRow', i - 1)}>
        <ChevronLeft size={16} />
      </button>
      <input type="range" min={0} max={n - 1} value={i} onChange={(e) => st.set('previewRow', +e.target.value)} aria-label={t('Ligne')} />
      <button className="icon-btn flat sm" disabled={i >= n - 1} aria-label={t('Ligne suivante')} onClick={() => st.set('previewRow', i + 1)}>
        <ChevronRight size={16} />
      </button>
      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{t('Ligne {i} / {n}', { i: i + 1, n })}</span>
      <button className="btn sm flat" onClick={() => st.set('rightPanel', 'data')}>
        {t('Modifier')}
      </button>
    </div>
  );
}

/** Bandeau de confirmation d'une impression demandée par un autre outil (lien / postMessage) */
function RemoteBanner() {
  const req = useStore((s) => s.remoteRequest);
  const [remember, setRemember] = useState(false);
  if (!req) return null;
  const title = req.open ? t('Ouverture d’un modèle') : t('Demande d’impression');
  return (
    <div className="remote-banner pill" role="alertdialog" aria-label={title}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>{title}</b> — {req.source === 'url' ? t('depuis un lien') : t('depuis {o}', { o: req.source })}
        <div style={{ fontSize: 13 }}>
          {req.open ? t('Ouvrir « {d} » ({n} étiquette(s)) dans l’éditeur', { n: req.count, d: req.docName }) : t('{n} étiquette(s) « {d} » → {p}', { n: req.count, d: req.docName, p: t(req.target) })}
        </div>
        {req.unsaved && (
          <div style={{ fontSize: 12.5, color: 'var(--err)', marginTop: 2 }}>{t('L’étiquette en cours a des modifications non enregistrées : elle sera remplacée (annulable avec Ctrl+Z).')}</div>
        )}
        {!req.open && (
          <label className="check" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('Autoriser l’impression automatique pour ce modèle (sans confirmation)')}
          </label>
        )}
      </div>
      <button className="btn flat" onClick={() => (req.resolve(false, false), setRemember(false))}>
        {tc('Annuler', 'cancel')}
      </button>
      <button className="btn accent" onClick={() => (req.resolve(true, remember), setRemember(false))}>
        {req.open ? t('Ouvrir') : t('Imprimer')}
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={'toast ' + x.kind} onClick={() => useStore.getState().dismissToast(x.id)}>
          {x.msg}
        </div>
      ))}
    </div>
  );
}

function MobileBar() {
  const st = useStore();
  const image = async () => {
    const f = await pickFile('image/*');
    if (f) addImageFile(f);
  };
  return (
    <nav className="mobilebar pill hide-in-preview" aria-label={t('Outils')}>
      <button className="tool" onClick={() => addText()}>
        <Type />
        {t('Texte')}
      </button>
      <button className="tool" onClick={() => addBarcode()}>
        <Barcode />
        {t('Code-barres')}
      </button>
      <button className="tool" onClick={() => addQr()}>
        <QrCode />
        QR
      </button>
      <button className={'tool' + (st.rightPanel === 'data' ? ' on' : '')} onClick={() => st.set('rightPanel', st.rightPanel === 'data' ? null : 'data')}>
        <Database />
        {t('Données')}
      </button>
      <Dropdown
        align="right"
        style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}
        button={(_, toggle) => (
          <button className="tool" onClick={toggle}>
            <MoreHorizontal />
            {t('Plus')}
          </button>
        )}
      >
        {(close) => {
          const go = (f: () => void) => () => (close(), f());
          return (
            <>
              <button className="mi" onClick={go(image)}>
                <ImageIcon size={16} /> {t('Image')}
              </button>
              <button className="mi" onClick={go(() => st.set('leftPanel', 'shapes'))}>
                <Shapes size={16} /> {t('Forme')}
              </button>
              <button className="mi" onClick={go(() => st.set('leftPanel', 'table'))}>
                <Table2 size={16} /> {t('Tableau')}
              </button>
              <button className="mi" onClick={go(() => st.set('leftPanel', 'templates'))}>
                <LayoutTemplate size={16} /> {t('Modèles')}
              </button>
              <button className="mi" onClick={go(() => st.set('leftPanel', 'layers'))}>
                <Layers size={16} /> {t('Calques')}
              </button>
              <button className="mi" onClick={go(() => st.set('rightPanel', 'number'))}>
                <Hash size={16} /> {t('Numéro')}
              </button>
              <button className="mi" onClick={go(() => st.set('rightPanel', 'date'))}>
                <CalendarDays size={16} /> {t('Date')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'zpl'))}>
                <ScanLine size={16} /> {t('Visionneuse ZPL')}
              </button>
              <hr />
              <div className="mt">{t('Réglages')}</div>
              <button className="mi" onClick={go(() => st.select(st.doc.elements.filter((e) => !e.hidden).map((e) => e.id)))}>
                <BoxSelect size={16} /> {t('Tout sélectionner')}
              </button>
              <button
                className={'mi' + (st.doc.sheet?.mode === 'same' ? ' on' : '')}
                onClick={go(() => st.set('modal', 'sheets'))}
              >
                <Copy size={16} /> {t('Même étiquette partout (planche)')}
              </button>
            </>
          );
        }}
      </Dropdown>
    </nav>
  );
}

/** Longueur maximale d'un texte collé depuis une autre application */
const MAX_PASTE_TEXT = 10_000;

/** Cible clavier qui gère elle-même Entrée (bouton, lien, champ éditable…) */
function isInteractiveTarget(tg: HTMLElement | null): boolean {
  if (!tg || !tg.tagName) return false;
  if (tg.isContentEditable) return true;
  return !!tg.closest?.('button, a[href], a, input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="tab"], [role="option"]');
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
      const st = useStore.getState();
      if (st.modal) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // outil Main : Espace maintenu (temporaire), H (bascule), V (retour à la sélection)
      if (!st.editingTextId && !mod && !e.altKey) {
        if (e.code === 'Space' || k === ' ') {
          // Espace sur un bouton / lien focalisé garde son action d'origine
          if (isInteractiveTarget(tg)) return;
          e.preventDefault(); // pas de défilement de la page
          if (!st.spaceHand) useStore.setState({ spaceHand: true });
          return;
        }
        if (k === 'h' && !e.repeat) return e.preventDefault(), useStore.setState({ hand: !st.hand });
        if (k === 'v' && !e.repeat) return st.hand ? (e.preventDefault(), useStore.setState({ hand: false })) : undefined;
      }
      if (mod && k === 'z' && !e.shiftKey) return e.preventDefault(), st.undo();
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), st.redo();
      if (mod && k === 'c') return st.selected.length ? (e.preventDefault(), st.copySelected()) : undefined;
      if (mod && k === 'x') return st.selected.length ? (e.preventDefault(), st.copySelected(), st.removeSelected()) : undefined;
      if (mod && k === 'd') return e.preventDefault(), st.duplicateSelected();
      if (mod && k === 'a') return e.preventDefault(), st.select(st.doc.elements.filter((x) => !x.hidden).map((x) => x.id));
      if (mod && k === 'g') return e.preventDefault(), e.shiftKey ? st.ungroupSelected() : st.groupSelected();
      if (mod && k === 's')
        return (
          e.preventDefault(),
          void saveCurrent().catch((err) => useStore.getState().toast(storageErrorMessage(err), 'error'))
        );
      if (mod && k === 'p') return e.preventDefault(), st.set('modal', 'print');
      // zoom : Ctrl+0 ajuste à la fenêtre, Ctrl+= / Ctrl++ / Ctrl+- (aussi pavé numérique)
      if (mod && !e.altKey && (k === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) return e.preventDefault(), useStore.setState({ fitRequest: st.fitRequest + 1 });
      if (mod && !e.altKey && (k === '=' || k === '+' || e.code === 'NumpadAdd' || e.code === 'Equal')) return e.preventDefault(), st.setZoom(st.zoom * 1.2);
      if (mod && !e.altKey && (k === '-' || k === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus')) return e.preventDefault(), st.setZoom(st.zoom / 1.2);
      if (k === 'delete' || k === 'backspace') return st.selected.length ? (e.preventDefault(), st.removeSelected()) : undefined;
      if (k === 'escape') {
        if (st.preview) return useStore.setState({ preview: false });
        if (st.hand) return useStore.setState({ hand: false });
        return useStore.setState({ selected: [], leftPanel: null, rightPanel: null });
      }
      // Entrée sur un bouton / lien focalisé : action du bouton, pas d'édition du texte sélectionné
      if (k === 'enter' && st.selected.length === 1 && !isInteractiveTarget(tg)) {
        const el = st.doc.elements.find((x) => x.id === st.selected[0]);
        if (el?.type === 'text' && !el.locked) return e.preventDefault(), useStore.setState({ editingTextId: el.id });
      }
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
      if (arrows[k] && st.selected.length) {
        e.preventDefault();
        nudge(...arrows[k]);
      }
    };
    // Ctrl+V : image du presse-papiers, sinon éléments copiés
    const onPaste = (e: ClipboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      if (useStore.getState().modal) return;
      const items = Array.from(e.clipboardData?.items || []);
      const img = items.find((i) => i.type.startsWith('image/'));
      if (img) {
        const f = img.getAsFile();
        if (f) {
          e.preventDefault();
          addImageFile(f);
          return;
        }
      }
      const txt = e.clipboardData?.getData('text') || '';
      if (/^\s*<svg[\s>]/i.test(txt)) {
        e.preventDefault();
        addImageFile(new Blob([txt], { type: 'image/svg+xml' }));
        return;
      }
      e.preventDefault();
      // Texte plus récent que la dernière copie d'éléments (copié dans une autre application) :
      // il devient un élément texte, au lieu de recoller d'anciens éléments.
      const plain = txt.replace(/\r\n?/g, '\n').trim();
      if (plain && plain !== (lastCopiedSystemText() ?? '').replace(/\r\n?/g, '\n').trim()) {
        if (plain.length > MAX_PASTE_TEXT) {
          useStore.getState().toast(t('Texte collé trop long ({n} caractères, {max} au maximum).', { n: plain.length, max: MAX_PASTE_TEXT }), 'error');
          return;
        }
        addText(plain);
        return;
      }
      useStore.getState().paste();
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      e.preventDefault();
      // Étiquettes transporteur : un .pdf ou un .zip, plusieurs .zpl, ou fenêtre transporteur déjà
      // ouverte → les fichiers d'étiquettes (ZPL, PDF, images, .zip) y partent ensemble.
      // Sinon : un .zpl seul ouvre la visionneuse ZPL, une image est insérée dans l'étiquette.
      const isData = (f: File) => /\.(csv|tsv|xlsx|xls|ods|txt|json)$/i.test(f.name);
      const nZpl = files.filter((f) => /\.zpl$/i.test(f.name)).length;
      if (useCarrier.getState().open || nZpl > 1 || files.some((f) => /\.(pdf|zip)$/i.test(f.name))) {
        const labels = files.filter((f) => !isData(f));
        if (labels.length) void openCarrierWithFiles(labels);
        files.splice(0, files.length, ...files.filter(isData));
      }
      for (const f of files) {
        if (f.type.startsWith('image/')) addImageFile(f);
        else if (/\.(csv|tsv|xlsx|xls|ods|txt)$/i.test(f.name))
          import('./data').then(async (m) => {
            const { loadData } = await import('./components/RightBar');
            try {
              loadData(await m.parseFile(f));
            } catch (err) {
              useStore.getState().toast((err as Error).message, 'error');
            }
          });
        else if (/\.json$/i.test(f.name)) f.text().then((txt) => import('./actions').then((a) => a.importJsonText(txt)));
        else if (/\.zpl$/i.test(f.name)) f.text().then((txt) => openZplViewer(txt));
      }
    };
    // Écriture refusée par le stockage (quota) non interceptée par l'appelant
    // (ex. « Enregistrer ») : message clair plutôt qu'un échec silencieux
    const onRejection = (e: PromiseRejectionEvent) => {
      if (!isQuotaError(e.reason)) return;
      e.preventDefault();
      useStore.getState().toast(storageErrorMessage(e.reason), 'error');
    };
    // fin de la main temporaire : Espace relâché ou fenêtre quittée pendant l'appui
    const endSpace = (e: KeyboardEvent | FocusEvent) => {
      if (e instanceof KeyboardEvent && e.code !== 'Space' && e.key !== ' ') return;
      if (useStore.getState().spaceHand) useStore.setState({ spaceHand: false });
    };
    window.addEventListener('keyup', endSpace);
    window.addEventListener('blur', endSpace);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keyup', endSpace);
      window.removeEventListener('blur', endSpace);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const modal = useStore((s) => s.modal);
  const preview = useStore((s) => s.preview);
  const [, force] = useState(0);
  useEffect(() => onLangChange(() => force((x) => x + 1)), []);
  useEffect(() => {
    useStore
      .getState()
      .init()
      .then(() => {
        installMessageApi();
        if (!applyRemoteUrl()) applyUrlParams();
      });
  }, []);
  useShortcuts();
  if (!ready) return null;
  return (
    <div className={preview ? 'preview-mode' : ''} style={{ position: 'absolute', inset: 0 }}>
      <Editor />
      <TopBar />
      <SetupBar />
      <LeftBar />
      <RightBar />
      <PropertiesPanel />
      <ZoomBar />
      <RowBar />
      <MobileBar />
      {modal === 'zpl' && <ZplViewer />}
      {modal === 'saved' && <SavedLabels />}
      {modal === 'help' && <HelpModal />}
      {modal === 'print' && <PrintDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'zebra' && <ZebraPanel />}
      {modal === 'sheets' && <SheetsDialog />}
      {modal === 'tool-barcode' && <BarcodeTool />}
      {modal === 'tool-qr' && <QrTool />}
      {modal === 'history' && <HistoryModal />}
      <CarrierDialogHost />
      <NutritionDialogHost />
      <PromptDialog />
      <RemoteBanner />
      <ProgressOverlay />
      <Toasts />
    </div>
  );
}

