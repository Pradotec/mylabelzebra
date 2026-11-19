import { Undo2, Redo2, HelpCircle, Plus, FolderOpen, Save, FileText, FileDown, FileUp, Image as ImageIcon, FileType, Copy, Download, ScanLine, ClipboardCopy, ClipboardPaste, Languages, Barcode, QrCode, Grid3x3, Printer, Check, History, Truck, Apple } from 'lucide-react';
import { useStore } from '../store';
import { Dropdown } from './ui';
import { t, getLang, setLang, LANGS } from '../i18n';
import { newLabel, saveCurrent, importJsonText } from '../actions';
import { exportJson, docToJson } from '../export';
import { startJob } from '../jobs';
import { copyText, pickFile } from '../util';
import { openCarrierDialog } from './CarrierDialog';
import { openNutritionDialog } from './NutritionDialog';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <clipPath id="mlzc">
          <path d="M4 7a3 3 0 0 1 3-3h14l7 7v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
        </clipPath>
      </defs>
      <path d="M4 7a3 3 0 0 1 3-3h14l7 7v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#16213e" />
      <g clipPath="url(#mlzc)" fill="#fff">
        <path d="M2 20 14 4h4L6 20z" />
        <path d="M8 28 24 6h3L11 28z" />
        <path d="M16 30 30 12v4L19 30z" />
      </g>
      <circle cx="22.5" cy="9.5" r="2.5" fill="#ff5a36" />
    </svg>
  );
}

export function TopBar() {
  const st = useStore();
  const { doc } = st;
  const copyZpl = () => startJob('zpl-copie');
  const dlZpl = () => startJob('zpl-fichier');
  const importLabel = async () => {
    const f = await pickFile('.json,.mlz.json,application/json');
    if (f) importJsonText(await f.text());
  };
  const pasteJson = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      await importJsonText(txt);
    } catch {
      st.toast(t('Lecture du presse-papiers refusée'), 'error');
    }
  };

  return (
    <header className="topbar hide-in-preview">
      <div className="brand" title="MyLabelZebra">
        <Logo />
        <span>
          MyLabel<b>Zebra</b>
        </span>
      </div>
      <div className="group pill" style={{ padding: 2 }}>
        <button className="icon-btn flat" aria-label={t('Annuler')} title={t('Annuler (Ctrl+Z)')} disabled={!st.past.length} onClick={st.undo}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn flat" aria-label={t('Rétablir')} title={t('Rétablir (Ctrl+Y)')} disabled={!st.future.length} onClick={st.redo}>
          <Redo2 size={18} />
        </button>
      </div>
      <button className="icon-btn hide-sm" aria-label={t('Aide')} title={t('Aide')} onClick={() => st.set('modal', 'help')}>
        <HelpCircle size={18} />
      </button>
      <button className="btn" onClick={newLabel} aria-label={t('Nouvelle étiquette')}>
        <Plus size={17} /> <span className="hide-sm">{t('Nouvelle étiquette')}</span>
      </button>
      <input
        className="docname"
        aria-label={t('Nom du document')}
        placeholder={t('Étiquette sans titre')}
        value={doc.name}
        onChange={(e) => st.setDoc((d) => void (d.name = e.target.value), 'name')}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="spacer" />
      <button className="icon-btn hide-sm" aria-label={t('Mes étiquettes')} title={t('Mes étiquettes')} onClick={() => st.set('modal', 'saved')}>
        <FolderOpen size={18} />
      </button>
      <button className="btn" onClick={saveCurrent} aria-label={t('Enregistrer')}>
        <Save size={17} /> <span className="hide-sm">{t('Enregistrer')}</span>
        {st.dirty && <span className="status-dot" style={{ background: 'var(--accent)' }} title={t('Modifications non enregistrées')} />}
      </button>
      <Dropdown
        align="right"
        button={(open, toggle) => (
          <button className={'btn dark'} onClick={toggle} aria-expanded={open} aria-label={t('Options')}>
            <FileText size={17} /> <span className="hide-sm">{t('Options')}</span>
          </button>
        )}
      >
        {(close) => {
          const go = (f: () => unknown) => () => {
            close();
            void f();
          };
          return (
            <>
              <button className="mi" onClick={go(() => st.set('modal', 'saved'))}>
                <FolderOpen size={16} /> {t('Mes étiquettes')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'history'))}>
                <History size={16} /> {t('Historique d’impression')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'help'))}>
                <HelpCircle size={16} /> {t('Aide et raccourcis')}
              </button>
              <hr />
              <div className="mt">{t('Design modifiable')}</div>
              <button className="mi" onClick={go(async () => (await copyText(docToJson(doc))) && st.toast(t('Étiquette copiée (JSON)'), 'ok'))}>
                <ClipboardCopy size={16} /> {t('Copier l’étiquette (JSON)')}
              </button>
              <button className="mi" onClick={go(pasteJson)}>
                <ClipboardPaste size={16} /> {t('Coller une étiquette (JSON)')}
              </button>
              <button className="mi" onClick={go(() => exportJson(doc))}>
                <FileDown size={16} /> {t('Exporter l’étiquette')}
              </button>
              <button className="mi" onClick={go(importLabel)}>
                <FileUp size={16} /> {t('Importer une étiquette')}
              </button>
              <hr />
              <div className="mt">{t('Image / document')}</div>
              <button className="mi" onClick={go(() => startJob('png'))}>
                <ImageIcon size={16} /> {t('Télécharger en PNG')}
              </button>
              <button className="mi" onClick={go(() => startJob('jpg'))}>
                <ImageIcon size={16} /> {t('Télécharger en JPG')}
              </button>
              <button className="mi" onClick={go(() => startJob('svg'))}>
                <FileType size={16} /> {t('Télécharger en SVG')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'export'))}>
                <FileDown size={16} /> {t('Télécharger en PDF…')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'sheets'))}>
                <Grid3x3 size={16} /> {t('Planches A4 / Letter (Avery)…')}
              </button>
              <hr />
              <div className="mt">{t('Zebra / ZPL')}</div>
              <button className="mi" onClick={go(copyZpl)}>
                <Copy size={16} /> {t('Copier le ZPL')}
              </button>
              <button className="mi" onClick={go(dlZpl)}>
                <Download size={16} /> {t('Télécharger le ZPL (.zpl)')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'zpl'))}>
                <ScanLine size={16} /> {t('Visionneuse ZPL')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'zebra'))}>
                <Printer size={16} /> {t('Imprimante Zebra…')}
              </button>
              <button className={'mi' + (doc.zplRaster ? ' on' : '')} onClick={go(() => st.setDoc((d) => void (d.zplRaster = !d.zplRaster)))} title={t('Envoie toute l’étiquette comme une image ^GFA : rendu identique à l’écran, fichier plus lourd')}>
                {doc.zplRaster ? <Check size={16} /> : <span style={{ width: 16 }} />} {t('ZPL : tout en image (^GFA)')}
              </button>
              <hr />
              <div className="mt">{t('Outils')}</div>
              <button className="mi" onClick={go(() => st.set('modal', 'tool-barcode'))}>
                <Barcode size={16} /> {t('Générateur de code-barres')}
              </button>
              <button className="mi" onClick={go(() => st.set('modal', 'tool-qr'))}>
                <QrCode size={16} /> {t('Générateur de QR code')}
              </button>
              <button className="mi" onClick={go(openCarrierDialog)}>
                <Truck size={16} /> {t('Étiquettes transporteur…')}
              </button>
              <button className="mi" onClick={go(openNutritionDialog)}>
                <Apple size={16} /> {t('Valeurs nutritionnelles…')}
              </button>
              <hr />
              <div className="mt">
                <Languages size={12} style={{ verticalAlign: -2 }} /> {t('Langue')}
              </div>
              {LANGS.map((l) => (
                <button key={l.id} className={'mi' + (getLang() === l.id ? ' on' : '')} onClick={go(() => setLang(l.id))}>
                  {getLang() === l.id ? <Check size={16} /> : <span style={{ width: 16 }} />} {l.label}
                </button>
              ))}
            </>
          );
        }}
      </Dropdown>
    </header>
  );
}

