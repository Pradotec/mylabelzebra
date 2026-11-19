/**
 * Fenêtre « Valeurs nutritionnelles » : saisie pour 100 g / 100 ml, calcul de l'énergie
 * (annexe XIV du règlement 1169/2011), arrondis du guide de la Commission (2012), colonne
 * « par portion » facultative, insertion d'un tableau dans l'étiquette.
 */
import { useState } from 'react';
import { create } from 'zustand';
import { Apple, Plus, AlertTriangle } from 'lucide-react';
import { Modal, Seg, Check } from './ui';
import { useStore } from '../store';
import { t, getLang } from '../i18n';
import { makeTable } from '../elements';
import { BASE_DPI, type TableEl } from '../types';
import { prefGet, prefSet } from '../storage';
import { computeEnergy, nutritionRows, nutritionWarnings, roundTo, saltOf, ROW_LABELS, type NutritionInput, type NutritionRow, type NutritionWarning } from '../nutrition';

const useNutritionUi = create<{ open: boolean }>()(() => ({ open: false }));
export const openNutritionDialog = () => useNutritionUi.setState({ open: true });
const closeNutrition = () => useNutritionUi.setState({ open: false });

export function NutritionDialogHost() {
  const open = useNutritionUi((s) => s.open);
  return open ? <NutritionDialog /> : null;
}

type Field = 'fat' | 'saturates' | 'carbohydrate' | 'sugars' | 'fibre' | 'protein' | 'salt' | 'sodium' | 'polyols' | 'alcohol';

interface Form {
  values: Partial<Record<Field, string>>;
  basis: 'g' | 'ml';
  saltMode: 'salt' | 'sodium';
  portionOn: boolean;
  portion: string;
  lowStyle: 'lt' | 'zero';
}

const PREF = 'nutrition.form';
const DEFAULT_FORM: Form = { values: {}, basis: 'g', saltMode: 'salt', portionOn: false, portion: '30', lowStyle: 'lt' };

const num = (s: string | undefined) => {
  if (s == null || !s.trim()) return undefined;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

const FIELDS: { k: Field; label: string; indent?: boolean; optional?: boolean }[] = [
  { k: 'fat', label: 'Matières grasses' },
  { k: 'saturates', label: 'dont acides gras saturés', indent: true },
  { k: 'carbohydrate', label: 'Glucides' },
  { k: 'sugars', label: 'dont sucres', indent: true },
  { k: 'polyols', label: 'dont polyols', indent: true, optional: true },
  { k: 'fibre', label: 'Fibres alimentaires', optional: true },
  { k: 'protein', label: 'Protéines' },
  { k: 'alcohol', label: 'Alcool (éthanol)', optional: true },
];

const WARN: Record<NutritionWarning, string> = {
  negative: 'Valeur négative',
  saturatesGtFat: 'Les acides gras saturés dépassent les matières grasses.',
  sugarsGtCarbs: 'Les sucres dépassent les glucides.',
  polyolsGtCarbs: 'Les polyols dépassent les glucides (ils en font partie).',
  sumGt100: 'La somme des nutriments dépasse 100 g.',
};

function NutritionDialog() {
  const [f, setF] = useState<Form>(() => ({ ...DEFAULT_FORM, ...prefGet<Partial<Form>>(PREF, {}) }));
  const upd = (p: Partial<Form>) =>
    setF((o) => {
      const n = { ...o, ...p };
      prefSet(PREF, n);
      return n;
    });
  const setV = (k: Field, v: string) => upd({ values: { ...f.values, [k]: v } });

  const input: NutritionInput = {
    fat: num(f.values.fat) ?? 0,
    saturates: num(f.values.saturates) ?? 0,
    carbohydrate: num(f.values.carbohydrate) ?? 0,
    sugars: num(f.values.sugars) ?? 0,
    protein: num(f.values.protein) ?? 0,
    fibre: num(f.values.fibre),
    polyols: num(f.values.polyols),
    alcohol: num(f.values.alcohol),
    ...(f.saltMode === 'salt' ? { salt: num(f.values.salt) ?? 0 } : { sodium: num(f.values.sodium) ?? 0 }),
  };
  const portion = f.portionOn ? num(f.portion) : undefined;
  const dec = getLang() === 'fr' ? ',' : '.';
  const labels = Object.fromEntries(Object.entries(ROW_LABELS).map(([k, v]) => [k, t(v)])) as Record<NutritionRow['key'], string>;
  const rows = nutritionRows(input, { portion, lowStyle: f.lowStyle, dec, labels });
  const warnings = nutritionWarnings(input);
  const energy = computeEnergy(input);
  const unit = f.basis;
  const colPer100 = t('Pour 100 {u}', { u: unit });
  const colPortion = portion ? t('Par portion de {p} {u}', { p: String(portion).replace('.', dec), u: unit }) : '';
  const missingPortion = f.portionOn && !(portion && portion > 0);

  const insert = () => {
    const st = useStore.getState();
    const header = [t('Valeurs nutritionnelles moyennes'), colPer100, ...(portion ? [colPortion] : [])];
    const cells = [header, ...rows.map((r) => [r.label, r.per100, ...(portion ? [r.perPortion ?? ''] : [])])];
    const cols = header.length;
    const el: TableEl = makeTable(st.doc, cells.length, cols);
    const docW = st.doc.widthIn * BASE_DPI;
    const docH = st.doc.heightIn * BASE_DPI;
    const w = Math.round(docW * 0.92);
    let fontSize = Math.max(10, Math.min(28, Math.round(w / (cols === 3 ? 26 : 20))));
    const rowH = (fs: number) => Math.round(fs * 1.7);
    while (fontSize > 8 && rowH(fontSize) * cells.length > docH * 0.92) fontSize--;
    const h = rowH(fontSize) * cells.length;
    Object.assign(el, {
      name: t('Valeurs nutritionnelles'),
      cells,
      rows: cells.length,
      cols,
      w,
      h,
      x: Math.round((docW - w) / 2),
      y: Math.max(0, Math.round((docH - h) / 2)),
      fontSize,
      strokeWidth: 2,
      headerRow: true,
      colWidths: cols === 3 ? [1.6, 1, 1] : [1.5, 1],
      rowHeights: Array(cells.length).fill(1),
    });
    st.addElements([el]);
    st.toast(t('Tableau nutritionnel inséré'), 'ok');
    closeNutrition();
  };

  const field = (k: Field, label: string, indent?: boolean, optional?: boolean) => (
    <label key={k} className="f" style={{ paddingLeft: indent ? 14 : 0 }}>
      <span>
        {t(label)}
        {optional && <span style={{ color: 'var(--ink-3)' }}> ({t('facultatif')})</span>}
      </span>
      <div style={{ position: 'relative' }}>
        <input className="inp" inputMode="decimal" value={f.values[k] ?? ''} placeholder={optional ? '—' : '0'} onChange={(e) => setV(k, e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ paddingRight: 26 }} />
        <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 11, color: 'var(--ink-3)', pointerEvents: 'none' }}>g</span>
      </div>
    </label>
  );

  return (
    <Modal
      title={t('Valeurs nutritionnelles')}
      icon={<Apple size={20} />}
      wide
      onClose={closeNutrition}
      footer={
        <div className="row" style={{ width: '100%', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => upd({ values: {} })}>
            {t('Effacer')}
          </button>
          <button className="btn accent" disabled={missingPortion} onClick={insert}>
            <Plus size={16} /> {t('Insérer')}
          </button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <span>{t('Valeurs saisies pour 100')}</span>
            <Seg value={f.basis} onChange={(v) => upd({ basis: v })} options={[{ v: 'g', label: 'g' }, { v: 'ml', label: 'ml' }]} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
            {FIELDS.map((x) => field(x.k, x.label, x.indent, x.optional))}
            <div>
              <Seg value={f.saltMode} onChange={(v) => upd({ saltMode: v })} options={[{ v: 'salt', label: t('Sel') }, { v: 'sodium', label: t('Sodium') }]} />
              {f.saltMode === 'salt' ? field('salt', 'Sel') : field('sodium', 'Sodium')}
              {f.saltMode === 'sodium' && (
                <div className="hint" style={{ margin: 0 }}>
                  {t('Sel = sodium × 2,5 = {v} g', { v: String(roundTo(saltOf(input) ?? 0, 3)).replace('.', dec) })}
                </div>
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
            <Check checked={f.portionOn} onChange={(v) => upd({ portionOn: v })}>
              {t('Ajouter une colonne par portion de')}
            </Check>
            <input className="inp" style={{ width: 80 }} inputMode="decimal" disabled={!f.portionOn} value={f.portion} onChange={(e) => upd({ portion: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Portion')} />
            <span>{unit}</span>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span>{t('Valeurs négligeables')}</span>
            <Seg value={f.lowStyle} onChange={(v) => upd({ lowStyle: v })} options={[{ v: 'lt', label: t('« <0,5 g »') }, { v: 'zero', label: t('« 0 g »') }]} />
          </div>
        </div>
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={cellS(true)}>{t('Valeurs nutritionnelles moyennes')}</th>
                <th style={cellS(true)}>{colPer100}</th>
                {portion ? <th style={cellS(true)}>{colPortion}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ ...cellS(false), paddingLeft: /^(saturates|sugars|polyols)$/.test(r.key) ? 16 : 6 }}>{r.label}</td>
                  <td style={cellS(false)}>{r.per100}</td>
                  {portion ? <td style={cellS(false)}>{r.perPortion}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 8 }}>
            {t('Énergie calculée (annexe XIV) : {kj} kJ / {kcal} kcal avant arrondi.', { kj: roundTo(energy.kJ, 1), kcal: roundTo(energy.kcal, 1) })}{' '}
            {t('Arrondis : guide de la Commission européenne sur les tolérances (décembre 2012).')}
          </div>
          {missingPortion && <div className="hint" style={{ color: 'var(--danger, #d43b2a)' }}>{t('Indiquez la taille de la portion.')}</div>}
          {warnings.map((w) => (
            <div key={w} className="hint" style={{ color: 'var(--danger, #d43b2a)', margin: '4px 0' }}>
              <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {t(WARN[w])}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const cellS = (head: boolean): React.CSSProperties => ({ border: '1px solid #c8ccd2', padding: '4px 6px', textAlign: 'left', fontWeight: head ? 700 : 400, background: head ? '#f4f5f7' : undefined });
