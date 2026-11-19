import { useState } from 'react';
import { Printer, ChevronDown, Ruler, Grid3x3, Monitor, Check } from 'lucide-react';
import { useStore, type Printer as P } from '../store';
import { Dropdown, NumField, Check as Chk, ColorPicker, Seg } from './ui';
import { t } from '../i18n';
import { ROLL_PRESETS, BRAND_PRESETS, sizeLabel } from '../sizes';
import { setLabelSize, getResizeMode, setResizeMode, type ResizeMode } from '../actions';
import { BASE_DPI } from '../types';
import { inToMm, mmToIn, round } from '../util';
import { isNone } from '../render/draw';
import { RollColumnsSetting } from './PropertiesPanel';

const PRINTERS: { id: P; label: string }[] = [
  { id: 'computer', label: 'Cet ordinateur' },
  { id: 'zebra', label: 'Imprimante Zebra' },
];

export function SetupBar() {
  const st = useStore();
  const { doc, grid } = st;
  const [unit, setUnit] = useState<'in' | 'mm'>(grid.unit);
  const [brand, setBrand] = useState<string>('Rouleaux');
  const [resizeMode, setRM] = useState<ResizeMode>(getResizeMode);
  const dots = (w: number, h: number) => `${Math.round(w * doc.dpi)}×${Math.round(h * doc.dpi)}`;
  const conv = (v: number) => (unit === 'mm' ? round(inToMm(v), 1) : round(v, 3));
  const back = (v: number) => (unit === 'mm' ? mmToIn(v) : v);
  const isCur = (w: number, h: number) => Math.abs(w - doc.widthIn) < 0.005 && Math.abs(h - doc.heightIn) < 0.005;

  return (
    <div className="setupbar pill hide-in-preview" role="toolbar" aria-label={t('Configuration de l’étiquette')}>
      <Dropdown
        button={(_, toggle) => (
          <button className="chip-btn" onClick={toggle} aria-label={t('Choisir une imprimante')}>
            {st.printer === 'computer' ? <Monitor size={16} /> : <Printer size={16} />}
            <span className="hide-sm">{st.printer === 'none' ? t('Choisir une imprimante') : t(PRINTERS.find((p) => p.id === st.printer)!.label)}</span>
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="mt">{t('Imprimer sur')}</div>
            {PRINTERS.map((p) => (
              <button
                key={p.id}
                className={'mi' + (st.printer === p.id ? ' on' : '')}
                onClick={() => {
                  st.set('printer', p.id);
                  close();
                  if (p.id === 'zebra') st.set('modal', 'zebra');
                }}
              >
                {p.id === 'computer' ? <Monitor size={16} /> : <Printer size={16} />} {t(p.label)}
                {st.printer === p.id && <Check size={15} className="k" />}
              </button>
            ))}
            <hr />
            <button
              className="mi"
              onClick={() => {
                close();
                st.set('modal', 'zebra');
              }}
            >
              <Printer size={16} /> {t('Réglages Zebra / Browser Print…')}
            </button>
          </>
        )}
      </Dropdown>
      <span className="sep" />
      <Dropdown
        align="center"
        style={{ width: 340 }}
        button={(_, toggle) => (
          <button className="chip-btn" onClick={toggle} aria-label={t('Taille de l’étiquette')}>
            <Ruler size={16} /> {sizeLabel(doc.widthIn, doc.heightIn)}
            {doc.round && <span className="hide-sm">{t('rond')}</span>}
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <div style={{ padding: 6 }}>
            <div className="tags">
              {['Rouleaux', ...BRAND_PRESETS.map((b) => b.brand)].map((b) => (
                <button key={b} className={'tag' + (brand === b ? ' on' : '')} onClick={() => setBrand(b)}>
                  {b === 'Rouleaux' ? t('Rouleaux') : t(b)}
                </button>
              ))}
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto', marginBottom: 8 }}>
              {(brand === 'Rouleaux' ? ROLL_PRESETS : BRAND_PRESETS.find((b) => b.brand === brand)!.sizes).map((p, i) => (
                <button
                  key={i}
                  className={'mi' + (isCur(p.w, p.h) ? ' on' : '')}
                  onClick={() => {
                    setLabelSize(p.w, p.h, !!p.round);
                    close();
                  }}
                >
                  {p.label ? t(p.label) : sizeLabel(p.w, p.h)}
                  <span className="k">
                    {p.label ? sizeLabel(p.w, p.h) + ' · ' : ''}
                    {dots(p.w, p.h)} pts
                  </span>
                </button>
              ))}
            </div>
            <div className="sec">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="sec-t" style={{ margin: 0 }}>
                  {t('Taille personnalisée')}
                </span>
                <Seg value={unit} onChange={setUnit} options={[{ v: 'in', label: 'in' }, { v: 'mm', label: 'mm' }]} />
              </div>
              <div className="grid2">
                <NumField label={t('Largeur')} suffix={unit} value={conv(doc.widthIn)} step={unit === 'mm' ? 1 : 0.1} min={unit === 'mm' ? 6 : 0.25} onChange={(v) => setLabelSize(back(v), doc.heightIn, doc.round)} />
                <NumField label={t('Hauteur')} suffix={unit} value={conv(doc.heightIn)} step={unit === 'mm' ? 1 : 0.1} min={unit === 'mm' ? 6 : 0.25} onChange={(v) => setLabelSize(doc.widthIn, back(v), doc.round)} />
              </div>
              <div className="row">
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{t('Résolution')}</span>
                <Seg
                  value={String(doc.dpi)}
                  onChange={(v) => st.setDoc((d) => void (d.dpi = +v))}
                  options={[
                    { v: '203', label: '203 dpi' },
                    { v: '300', label: '300 dpi' },
                    { v: '600', label: '600 dpi' },
                  ]}
                />
              </div>
              <div className="row">
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{t('Contenu')}</span>
                <Seg
                  value={resizeMode}
                  onChange={(v) => {
                    setResizeMode(v as ResizeMode);
                    setRM(v as ResizeMode);
                  }}
                  options={[
                    { v: 'scale', label: t('Adapter à la taille') },
                    { v: 'keep', label: t('Garder la taille') },
                  ]}
                />
              </div>
              <Chk checked={!!doc.round} onChange={(v) => st.setDoc((d) => void (d.round = v))}>
                {t('Étiquette ronde')}
              </Chk>
              <div className="hint">
                {t('{w} × {h} points à {dpi} dpi', { w: Math.round(doc.widthIn * doc.dpi), h: Math.round(doc.heightIn * doc.dpi), dpi: doc.dpi })}
              </div>
            </div>
            <RollColumnsSetting preview={false} />
          </div>
        )}
      </Dropdown>
      <span className="sep" />
      <Dropdown
        align="center"
        style={{ width: 270, padding: 12 }}
        button={(open, toggle) => (
          <button className={'icon-btn flat' + (grid.show || open ? ' on' : '')} onClick={toggle} aria-label={t('Grille et fond')} title={t('Grille, règles et fond')}>
            <Grid3x3 size={18} />
          </button>
        )}
      >
        <div className="sec-t">{t('Grille et repères')}</div>
        <Chk checked={grid.show} onChange={(v) => st.setGrid({ show: v })}>
          {t('Afficher la grille')}
        </Chk>
        <Chk checked={grid.snap} onChange={(v) => st.setGrid({ snap: v })}>
          {t('Aimanter à la grille')}
        </Chk>
        <div className="row">
          <span style={{ fontSize: 12.5, flex: 1 }}>{t('Pas de la grille')}</span>
          <div style={{ width: 110 }}>
            <NumField
              value={grid.unit === 'mm' ? round((grid.size / BASE_DPI) * 25.4, 2) : round(grid.size / BASE_DPI, 3)}
              suffix={grid.unit}
              step={grid.unit === 'mm' ? 0.5 : 0.05}
              min={0.01}
              decimals={3}
              onChange={(v) => st.setGrid({ size: grid.unit === 'mm' ? (v / 25.4) * BASE_DPI : v * BASE_DPI })}
            />
          </div>
        </div>
        <Chk checked={grid.objects} onChange={(v) => st.setGrid({ objects: v })}>
          {t('Repères intelligents (bords et centres)')}
        </Chk>
        <Chk checked={grid.rulers} onChange={(v) => st.setGrid({ rulers: v })}>
          {t('Afficher les règles')}
        </Chk>
        <div className="row">
          <span style={{ fontSize: 12.5, flex: 1 }}>{t('Unité')}</span>
          <Seg value={grid.unit} onChange={(v) => st.setGrid({ unit: v })} options={[{ v: 'mm', label: 'mm' }, { v: 'in', label: 'in' }]} />
        </div>
        <div className="hint">{t('Tirez depuis une règle pour créer un repère ; ramenez-le sur la règle pour le supprimer.')}</div>
        {(doc.guides.x.length > 0 || doc.guides.y.length > 0) && (
          <button className="btn sm block" onClick={() => st.setDoc((d) => void (d.guides = { x: [], y: [] }))}>
            {t('Effacer les repères ({n})', { n: doc.guides.x.length + doc.guides.y.length })}
          </button>
        )}
        <div className="sec">
          <ColorPicker label={t('Couleur de fond')} value={doc.background} onChange={(c) => st.setDoc((d) => void (d.background = isNone(c) ? '#ffffff' : c), 'bg')} />
        </div>
      </Dropdown>
      <ColorSwatchButton />
      <button className="btn accent" style={{ marginLeft: 4, boxShadow: 'none' }} onClick={() => st.set('modal', 'print')} aria-label={t('Imprimer')}>
        <Printer size={17} /> {t('Imprimer')}
      </button>
    </div>
  );
}

function ColorSwatchButton() {
  const st = useStore();
  return (
    <div style={{ width: 40 }} title={t('Couleur de fond')} className="hide-sm">
      <Dropdown
        align="center"
        className="menu color-pop"
        button={(_, toggle) => (
          <button className="icon-btn flat" onClick={toggle} aria-label={t('Couleur de fond')}>
            <span className="swatch" style={{ background: st.doc.background }} />
          </button>
        )}
      >
        <ColorPicker value={st.doc.background} onChange={(c) => st.setDoc((d) => void (d.background = isNone(c) ? '#ffffff' : c), 'bg')} />
        <div className="hint" style={{ marginTop: 8 }}>
          {t('Les imprimantes thermiques n’impriment qu’en noir : un fond foncé est imprimé noir.')}
        </div>
      </Dropdown>
    </div>
  );
}
