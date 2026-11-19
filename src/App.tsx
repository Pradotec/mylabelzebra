import { useEffect, useState } from 'react';
import { Eye, EyeOff, Minus, Plus, ChevronLeft, ChevronRight, Type, Barcode, QrCode, Database, MoreHorizontal, Shapes, Image as ImageIcon, Layers, LayoutTemplate, Hash, CalendarDays, ScanLine, Table2, BoxSelect, Copy } from 'lucide-react';
import { useStore } from './store';
import { TopBar } from './components/TopBar';
import { SetupBar } from './components/SetupBar';
import { LeftBar } from './components/LeftBar';
import { RightBar } from './components/RightBar';
import { Editor } from './components/Editor';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ZplViewer } from './components/ZplViewer';
import { SavedLabels, HelpModal, PrintDialog, ExportDialog, ZebraPanel, SheetsDialog, BarcodeTool, QrTool } from './components/Modals';
import { Dropdown } from './components/ui';
import { nudge } from './components/ContextMenu';
import { t, onLangChange } from './i18n';
import { addImageFile, addText, addQr, addBarcode, saveCurrent } from './actions';
import { applyUrlParams } from './urlParams';
import { BASE_DPI } from './types';
import { pickFile } from './util';

const PHYS = 96 / BASE_DPI; // zoom correspondant à la taille réelle (100 %)

function ZoomBar() {
  const zoom = useStore((s) => s.zoom);
  const preview = useStore((s) => s.preview);
  const st = useStore.getState();
  const pct = Math.round((zoom / PHYS) * 100);
  return (
    <div className="zoombar pill" role="toolbar" aria-label={t('Zoom')}>
      <button className={'icon-btn flat sm' + (preview ? ' on' : '')} title={t('Mode aperçu (masque les outils)')} aria-label={t('Mode aperçu')} onClick={() => useStore.setState({ preview: !preview, selected: [], editingTextId: null })}>
        {preview ? <EyeOff size={16} /> : <Eye size={16} />}
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

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
      const st = useStore.getState();
      if (st.modal) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) return e.preventDefault(), st.undo();
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), st.redo();
      if (mod && k === 'c') return st.selected.length ? (e.preventDefault(), st.copySelected()) : undefined;
      if (mod && k === 'x') return st.selected.length ? (e.preventDefault(), st.copySelected(), st.removeSelected()) : undefined;
      if (mod && k === 'd') return e.preventDefault(), st.duplicateSelected();
      if (mod && k === 'a') return e.preventDefault(), st.select(st.doc.elements.filter((x) => !x.hidden).map((x) => x.id));
      if (mod && k === 'g') return e.preventDefault(), e.shiftKey ? st.ungroupSelected() : st.groupSelected();
      if (mod && k === 's') return e.preventDefault(), saveCurrent();
      if (mod && k === 'p') return e.preventDefault(), st.set('modal', 'print');
      if (k === 'delete' || k === 'backspace') return st.selected.length ? (e.preventDefault(), st.removeSelected()) : undefined;
      if (k === 'escape') {
        if (st.preview) return useStore.setState({ preview: false });
        return useStore.setState({ selected: [], leftPanel: null, rightPanel: null });
      }
      if (k === 'enter' && st.selected.length === 1) {
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
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
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
      useStore.getState().paste();
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      e.preventDefault();
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
        else if (/\.zpl$/i.test(f.name)) useStore.getState().set('modal', 'zpl');
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
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
      .then(() => applyUrlParams());
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
      <Toasts />
    </div>
  );
}

