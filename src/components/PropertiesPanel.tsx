import { useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Lock,
  Unlock,
  Trash2,
  CopyPlus,
  BringToFront,
  SendToBack,
  FlipHorizontal2,
  FlipVertical2,
  RotateCw,
  Shrink,
  Group,
  Ungroup,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  SlidersHorizontal,
  Plus,
  Minus,
  Braces,
  ImageUp,
  Info,
} from 'lucide-react';
import { useStore } from '../store';
import type { LabelElement, TextEl, BarcodeEl, QrEl, ImageEl, ShapeEl, TableEl, CurveMode, Symbology, QrLevel } from '../types';
import { BASE_DPI } from '../types';
import { Panel, NumField, Check, Seg, ColorPicker, Dropdown } from './ui';
import { t } from '../i18n';
import { FONTS, elementLabel, TYPE_LABELS } from '../elements';
import { SYMBOLOGIES, encodeBarcode, encodeQr, qrPayload } from '../render/codes';
import { shapeDef } from '../render/shapes';
import { allergensFound } from '../render/allergens';
import { Gs1Assistant, SsccAssistant, VarEanAssistant } from './Gs1Assist';
import { resolveText, unknownFilters, FILTERS, conditionHolds, conditionValue, promptFields } from '../render/resolve';
import type { CondOp, ShowCondition } from '../types';
import { elementHeight, hasFixedHeight, layoutText, fitMode } from '../render/draw';
import type { TextFit } from '../types';
import { AlignJustify } from 'lucide-react';
import { aabb } from './Editor';
import { fileToDataUrl } from '../render/images';
import { pickFile } from '../util';

export function PropertiesPanel() {
  const st = useStore();
  const sel = st.doc.elements.filter((e) => st.selected.includes(e.id));
  if (!sel.length || st.leftPanel) return null;
  const el = sel.length === 1 ? sel[0] : undefined;
  return (
    <Panel
      className="props"
      title={el ? t(TYPE_LABELS[el.type]) : t('{n} éléments', { n: sel.length })}
      icon={<SlidersHorizontal size={16} />}
      onClose={() => st.select([])}
      extra={el && <span style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{elementLabel(el)}</span>}
    >
      <ActionsRow sel={sel} />
      {el?.type === 'text' && <TextProps el={el} />}
      {el?.type === 'barcode' && <BarcodeProps el={el} />}
      {el?.type === 'qr' && <QrProps el={el} />}
      {el?.type === 'image' && <ImageProps el={el} />}
      {el?.type === 'shape' && <ShapeProps el={el} />}
      {el?.type === 'table' && <TableProps el={el} />}
      {el && <ConditionSection el={el} />}
      {el && <Geometry el={el} />}
      {sel.length > 1 && <MultiProps sel={sel} />}
    </Panel>
  );
}

const up = (id: string, p: Partial<LabelElement>, key?: string) => useStore.getState().updateEls([id], p, key);

function ActionsRow({ sel }: { sel: LabelElement[] }) {
  const st = useStore();
  const ids = sel.map((e) => e.id);
  const locked = sel.every((e) => e.locked);
  const grouped = sel.some((e) => e.groups?.length);
  const W = st.doc.widthIn * BASE_DPI,
    H = st.doc.heightIn * BASE_DPI;
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
  const shrink = () => {
    st.updateEls(ids, (e) => {
      const h = elementHeight(e, ctx);
      const k = Math.min(1, (W * 0.98) / e.w, (H * 0.98) / h);
      const p: Record<string, number> = { w: e.w * k };
      if (e.type === 'text') p.fontSize = e.fontSize * k;
      else p.h = e.h * k;
      p.x = Math.min(Math.max(0, e.x), W - e.w * k);
      p.y = Math.min(Math.max(0, e.y), H - h * k);
      return p as Partial<LabelElement>;
    });
  };
  return (
    <div className="row" style={{ gap: 2, marginBottom: 10 }}>
      <button className="icon-btn flat sm" title={t('Dupliquer (Ctrl+D)')} aria-label={t('Dupliquer')} onClick={st.duplicateSelected}>
        <CopyPlus size={16} />
      </button>
      <button className="icon-btn flat sm" title={locked ? t('Déverrouiller') : t('Verrouiller')} aria-label={locked ? t('Déverrouiller') : t('Verrouiller')} onClick={() => st.updateEls(ids, { locked: !locked })}>
        {locked ? <Lock size={16} /> : <Unlock size={16} />}
      </button>
      <button className="icon-btn flat sm" title={t('Premier plan')} aria-label={t('Premier plan')} onClick={() => st.reorder(ids, 'front')}>
        <BringToFront size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Arrière-plan')} aria-label={t('Arrière-plan')} onClick={() => st.reorder(ids, 'back')}>
        <SendToBack size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Pivoter de 90°')} aria-label={t('Pivoter de 90°')} onClick={() => st.updateEls(ids, (e) => ({ rotation: ((e.rotation || 0) + 90) % 360 }))}>
        <RotateCw size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Miroir horizontal')} aria-label={t('Miroir horizontal')} onClick={() => st.updateEls(ids, (e) => ({ flipX: !e.flipX }))}>
        <FlipHorizontal2 size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Miroir vertical')} aria-label={t('Miroir vertical')} onClick={() => st.updateEls(ids, (e) => ({ flipY: !e.flipY }))}>
        <FlipVertical2 size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Réduire pour tenir dans l’étiquette')} aria-label={t('Réduire pour tenir')} onClick={shrink}>
        <Shrink size={16} />
      </button>
      {sel.length > 1 && (
        <button className="icon-btn flat sm" title={t('Grouper (Ctrl+G)')} aria-label={t('Grouper')} onClick={st.groupSelected}>
          <Group size={16} />
        </button>
      )}
      {grouped && (
        <button className="icon-btn flat sm" title={t('Dégrouper (Ctrl+Maj+G)')} aria-label={t('Dégrouper')} onClick={st.ungroupSelected}>
          <Ungroup size={16} />
        </button>
      )}
      <button className="icon-btn flat sm" title={t('Supprimer (Suppr)')} aria-label={t('Supprimer')} onClick={st.removeSelected} style={{ color: 'var(--err)' }}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function AlignTools({ onAlign }: { onAlign: (mode: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => void }) {
  return (
    <div className="row" style={{ gap: 2 }}>
      <button className="icon-btn flat sm" title={t('Aligner à gauche')} aria-label={t('Aligner à gauche')} onClick={() => onAlign('l')}>
        <AlignStartVertical size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Centrer horizontalement')} aria-label={t('Centrer horizontalement')} onClick={() => onAlign('c')}>
        <AlignCenterVertical size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Aligner à droite')} aria-label={t('Aligner à droite')} onClick={() => onAlign('r')}>
        <AlignEndVertical size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Aligner en haut')} aria-label={t('Aligner en haut')} onClick={() => onAlign('t')}>
        <AlignStartHorizontal size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Centrer verticalement')} aria-label={t('Centrer verticalement')} onClick={() => onAlign('m')}>
        <AlignCenterHorizontal size={16} />
      </button>
      <button className="icon-btn flat sm" title={t('Aligner en bas')} aria-label={t('Aligner en bas')} onClick={() => onAlign('b')}>
        <AlignEndHorizontal size={16} />
      </button>
    </div>
  );
}

function alignEls(sel: LabelElement[], mode: 'l' | 'c' | 'r' | 't' | 'm' | 'b', toLabel: boolean) {
  const st = useStore.getState();
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
  const boxes = new Map(sel.map((e) => [e.id, aabb(e, elementHeight(e, ctx))]));
  let ref: { x: number; y: number; w: number; h: number };
  if (toLabel) ref = { x: 0, y: 0, w: st.doc.widthIn * BASE_DPI, h: st.doc.heightIn * BASE_DPI };
  else {
    const bs = Array.from(boxes.values());
    const x = Math.min(...bs.map((b) => b.x)),
      y = Math.min(...bs.map((b) => b.y));
    ref = { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  }
  st.updateEls(
    sel.filter((e) => !e.locked).map((e) => e.id),
    (e) => {
      const b = boxes.get(e.id)!;
      const offX = e.x - b.x,
        offY = e.y - b.y;
      switch (mode) {
        case 'l':
          return { x: ref.x + offX };
        case 'c':
          return { x: ref.x + (ref.w - b.w) / 2 + offX };
        case 'r':
          return { x: ref.x + ref.w - b.w + offX };
        case 't':
          return { y: ref.y + offY };
        case 'm':
          return { y: ref.y + (ref.h - b.h) / 2 + offY };
        case 'b':
          return { y: ref.y + ref.h - b.h + offY };
      }
    },
  );
}

function MultiProps({ sel }: { sel: LabelElement[] }) {
  return (
    <>
      <div className="sec">
        <div className="sec-t">{t('Aligner entre eux')}</div>
        <AlignTools onAlign={(m) => alignEls(sel, m, false)} />
      </div>
      <div className="sec">
        <div className="sec-t">{t('Aligner sur l’étiquette')}</div>
        <AlignTools onAlign={(m) => alignEls(sel, m, true)} />
      </div>
    </>
  );
}

const COND_OPS: { v: CondOp; label: string }[] = [
  { v: 'notEmpty', label: 'n’est pas vide' },
  { v: 'empty', label: 'est vide' },
  { v: 'eq', label: '=' },
  { v: 'ne', label: '≠' },
  { v: 'contains', label: 'contient' },
];

/** « Afficher seulement si … » : condition évaluée pour chaque ligne de données */
function ConditionSection({ el }: { el: LabelElement }) {
  const st = useStore();
  const c = el.showIf;
  const cols = st.doc.data?.columns ?? [];
  const prompts = promptFields(st.doc).map((p) => '?' + p);
  const set = (p: Partial<ShowCondition> | undefined) => up(el.id, { showIf: p === undefined ? undefined : ({ field: '', op: 'notEmpty', ...c, ...p } as ShowCondition) }, 'cond' + el.id);
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
  const listId = 'cond-fields-' + el.id;
  return (
    <div className="sec">
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <span className="sec-t" style={{ margin: 0 }}>{t('Afficher seulement si…')}</span>
        {c ? (
          <button className="btn sm flat" onClick={() => set(undefined)}>
            {t('Retirer')}
          </button>
        ) : (
          <button className="btn sm flat" onClick={() => set({ field: cols[0] ?? '', op: 'notEmpty' })}>
            <Plus size={14} /> {t('Condition')}
          </button>
        )}
      </div>
      {c && (
        <>
          <div className="grid2" style={{ marginTop: 6 }}>
            <label className="f">
              {t('Colonne ou champ')}
              <input className="inp" list={listId} value={c.field} placeholder="lot" onChange={(e) => set({ field: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <datalist id={listId}>
                {[...cols, 'numero', ...prompts].map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="f">
              {t('Condition')}
              <select className="inp" value={c.op} onChange={(e) => set({ op: e.target.value as CondOp })}>
                {COND_OPS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(c.op === 'eq' || c.op === 'ne' || c.op === 'contains') && (
            <label className="f">
              {t('Valeur')}
              <input className="inp" value={c.value ?? ''} onChange={(e) => set({ value: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          )}
          <div className={conditionHolds(c, ctx) ? 'okmsg' : 'hint'} style={{ marginTop: 4 }}>
            {t('Ligne affichée : « {v} » → {r}', { v: conditionValue(c, ctx), r: conditionHolds(c, ctx) ? t('imprimé') : t('non imprimé') })}
          </div>
          <div className="hint">{t('Comparaison sans tenir compte des majuscules ni des accents. Évaluée pour chaque ligne (impression, PDF, ZPL, planches).')}</div>
        </>
      )}
    </div>
  );
}

function Geometry({ el }: { el: LabelElement }) {
  const st = useStore();
  const unit = st.grid.unit;
  const k = unit === 'mm' ? 25.4 / BASE_DPI : 1 / BASE_DPI;
  const dec = unit === 'mm' ? 2 : 3;
  const autoH = el.type === 'text' && !hasFixedHeight(el);
  const h = elementHeight(el, { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: st.showData });
  return (
    <div className="sec">
      <div className="sec-t">{t('Position et taille')}</div>
      <div className="grid2">
        <NumField label="X" suffix={unit} decimals={dec} step={unit === 'mm' ? 0.5 : 0.01} value={el.x * k} onChange={(v) => up(el.id, { x: v / k }, 'x')} />
        <NumField label="Y" suffix={unit} decimals={dec} step={unit === 'mm' ? 0.5 : 0.01} value={el.y * k} onChange={(v) => up(el.id, { y: v / k }, 'y')} />
        <NumField label={t('Largeur')} suffix={unit} decimals={dec} min={0.1} step={unit === 'mm' ? 0.5 : 0.01} value={el.w * k} onChange={(v) => up(el.id, { w: v / k }, 'w')} />
        <NumField
          label={t('Hauteur') + (autoH ? ' (auto)' : '')}
          suffix={unit}
          decimals={dec}
          min={0.1}
          disabled={autoH}
          step={unit === 'mm' ? 0.5 : 0.01}
          value={h * k}
          onChange={(v) => up(el.id, { h: v / k }, 'h')}
        />
        <NumField label={t('Rotation')} suffix="°" decimals={1} step={1} value={el.rotation} onChange={(v) => up(el.id, { rotation: ((v % 360) + 360) % 360 }, 'rot')} />
        <label className="f">
          {t('Nom du calque')}
          <input className="inp" value={el.name || ''} placeholder={elementLabel(el)} onChange={(e) => up(el.id, { name: e.target.value }, 'name' + el.id)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </div>
      <div className="sec-t" style={{ marginTop: 6 }}>
        {t('Aligner sur l’étiquette')}
      </div>
      <AlignTools onAlign={(m) => alignEls([el], m, true)} />
      <Check checked={!!el.locked} onChange={(v) => up(el.id, { locked: v })}>
        {t('Verrouiller (empêche de déplacer)')}
      </Check>
    </div>
  );
}

/** Aide « Formats disponibles » : bouton (à côté de « {} Champ ») + encadré dépliable */
export function useFormatsHelp() {
  const [open, setOpen] = useState(false);
  const button = (
    <button className={'icon-btn flat sm' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title={t('Formats disponibles')} aria-label={t('Formats disponibles')} aria-expanded={open}>
      <Info size={15} />
    </button>
  );
  const box = open ? (
    <div className="formats-help" style={{ background: 'var(--bg)', borderRadius: 10, padding: '8px 10px', margin: '6px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <span className="sec-t" style={{ margin: 0 }}>{t('Formats disponibles')}</span>
        <button className="btn sm flat" onClick={() => setOpen(false)}>{t('Fermer')}</button>
      </div>
      <div className="hint">{t('Ajoutez des filtres après le nom du champ, séparés par « | ». Ils s’appliquent de gauche à droite.')}</div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          {FILTERS.map((f) => (
            <tr key={f.name} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '4px 0' }}>
                <code style={{ fontSize: 11.5, userSelect: 'all', wordBreak: 'break-all' }}>{f.example}</code>
                <div style={{ color: 'var(--ink-2)' }}>{t(f.help)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 6 }}>
        {t('Champs spéciaux : {{numero}}, {{date}}, {{date+30}}, {{aujourdhui}}. {{?Nom}} : valeur demandée au moment d’imprimer.')}
      </div>
      <div className="hint">{t('Dates : JJ (jour), MM (mois), MMM / MMMM (mois en lettres), AA / AAAA (année), HH:mm.')}</div>
    </div>
  ) : null;
  return { button, box };
}

/** Avertissement : filtre inconnu dans un {{champ}} */
export function FilterWarning({ text }: { text: string }) {
  const bad = unknownFilters(text);
  if (!bad.length) return null;
  return <div className="err">{t('Format inconnu ignoré : {f}', { f: bad.join(', ') })}</div>;
}

/** Menu d'insertion de champs {{…}} */
export function FieldMenu({ onInsert }: { onInsert: (tok: string) => void }) {
  const cols = useStore((s) => s.doc.data?.columns ?? []);
  return (
    <Dropdown
      align="right"
      style={{ minWidth: 200 }}
      button={(_, toggle) => (
        <button className="btn sm flat" onClick={toggle} title={t('Insérer un champ de données')}>
          <Braces size={14} /> {t('Champ')}
        </button>
      )}
    >
      {(close) => (
        <>
          {cols.length > 0 && <div className="mt">{t('Colonnes')}</div>}
          {cols.map((c) => (
            <button key={c} className="mi" onClick={() => (onInsert(`{{${c}}}`), close())}>
              {`{{${c}}}`}
            </button>
          ))}
          <div className="mt">{t('Automatique')}</div>
          <button className="mi" onClick={() => (onInsert('{{numero}}'), close())}>
            {'{{numero}}'} <span className="k">{t('numéro')}</span>
          </button>
          <button className="mi" onClick={() => (onInsert('{{date}}'), close())}>
            {'{{date}}'} <span className="k">{t('date')}</span>
          </button>
          <button className="mi" onClick={() => (onInsert('{{date+30}}'), close())}>
            {'{{date+30}}'} <span className="k">{t('date + 30 j')}</span>
          </button>
          <button className="mi" onClick={() => (onInsert('{{aujourdhui|date:JJ/MM/AAAA}}'), close())}>
            {'{{aujourdhui}}'} <span className="k">{t('date du jour')}</span>
          </button>
          <button className="mi" onClick={() => (onInsert('{{?Lot}}'), close())}>
            {'{{?Lot}}'} <span className="k">{t('saisi à l’impression')}</span>
          </button>
          {!cols.length && <div className="hint" style={{ padding: '4px 10px' }}>{t('Importez des données (panneau Données) pour voir vos colonnes ici.')}</div>}
        </>
      )}
    </Dropdown>
  );
}

const FIT_OPTIONS: { v: TextFit; label: string; hint: string }[] = [
  { v: 'shrinkLine', label: 'Une ligne — réduire la police', hint: 'Jamais de retour à la ligne : la police diminue jusqu’à ce que le texte tienne dans la boîte.' },
  { v: 'wrapShrink', label: 'Retour à la ligne — réduire si déborde', hint: 'Coupe aux espaces ; si le texte dépasse la hauteur de la boîte, la police diminue.' },
  { v: 'wrapGrow', label: 'Retour à la ligne illimité', hint: 'Coupe aux espaces à la taille choisie ; la hauteur de la boîte suit le contenu.' },
  { v: 'none', label: 'Aucun (taille fixe, débordement rogné)', hint: 'La boîte garde sa taille ; ce qui dépasse n’est pas imprimé.' },
];

function TextFitSection({ el }: { el: TextEl }) {
  const st = useStore();
  const mode = fitMode(el);
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
  const L = layoutText(el, resolveText(el.text, ctx), st.doc.allergensExtra);
  const opt = FIT_OPTIONS.find((o) => o.v === mode)!;
  const setMode = (v: TextFit) => {
    const patch: Partial<TextEl> = { fit: v, autoShrink: undefined };
    // en passant à une hauteur fixe, on garde la hauteur actuelle du contenu
    if (v !== 'wrapGrow' && mode === 'wrapGrow') patch.h = Math.max(L.h, el.fontSize * (el.lineHeight || 1.1));
    up(el.id, patch);
  };
  return (
    <div className="sec">
      <div className="sec-t">{t('Ajustement du texte')}</div>
      <select className="inp" value={mode} onChange={(e) => setMode(e.target.value as TextFit)} style={{ marginBottom: 6 }} aria-label={t('Ajustement du texte')}>
        {FIT_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <div className="hint">{t(opt.hint)}</div>
      <div className="grid2">
        {(mode === 'shrinkLine' || mode === 'wrapShrink') && (
          <NumField label={t('Taille minimale')} suffix="pt" decimals={1} min={2} max={el.fontSize} value={el.minFontSize ?? Math.max(4, el.fontSize * 0.3)} onChange={(v) => up(el.id, { minFontSize: v }, 'minfs')} />
        )}
        {mode !== 'shrinkLine' && (
          <NumField label={t('Lignes max (0 = illimité)')} decimals={0} min={0} max={200} value={el.maxLines ?? 0} onChange={(v) => up(el.id, { maxLines: Math.round(v) || undefined }, 'maxl')} />
        )}
      </div>
      <Check checked={el.ellipsis !== false && !!el.ellipsis} onChange={(v) => up(el.id, { ellipsis: v })}>
        {t('Tronquer avec « … » si le texte ne tient pas')}
      </Check>
      {hasFixedHeight(el) && (
        <div className="row">
          <span style={{ fontSize: 12.5 }}>{t('Alignement vertical')}</span>
          <Seg
            value={el.vAlign || 'middle'}
            onChange={(v) => up(el.id, { vAlign: v })}
            options={[
              { v: 'top', label: t('Haut') },
              { v: 'middle', label: t('Milieu') },
              { v: 'bottom', label: t('Bas') },
            ]}
          />
        </div>
      )}
      <div className={L.truncated ? 'err' : 'hint'}>
        {t('Ligne affichée : {fs} pt, {n} ligne(s)', { fs: Math.round(L.fontSize * 10) / 10, n: L.lines.length })}
        {L.fontSize < el.fontSize - 0.05 ? ' · ' + t('police réduite') : ''}
        {L.truncated ? ' · ' + t('texte tronqué') : ''}
      </div>
    </div>
  );
}

/** Allergènes en gras (INCO) + liste complémentaire propre à l'étiquette */
function AllergenSection({ el }: { el: TextEl }) {
  const st = useStore();
  const extra = st.doc.allergensExtra ?? [];
  const [draft, setDraft] = useState(extra.join(', '));
  const ctx = { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true };
  const found = el.boldAllergens ? allergensFound(resolveText(el.text, ctx), extra) : [];
  return (
    <div className="sec">
      <Check checked={!!el.boldAllergens} onChange={(v) => up(el.id, { boldAllergens: v })} title={t('Met en gras les 14 allergènes du règlement INCO (UE 1169/2011) et leurs variantes')}>
        {t('Allergènes en gras (INCO)')}
      </Check>
      {el.boldAllergens && (
        <>
          {el.bold && <div className="hint">{t('Le texte est déjà entièrement en gras : désactivez « Gras » pour faire ressortir les allergènes.')}</div>}
          <div className="hint">{found.length ? t('Repérés : {l}', { l: found.join(', ') }) : t('Aucun allergène repéré dans la ligne affichée.')}</div>
          <label className="f">
            {t('Allergènes supplémentaires (séparés par des virgules)')}
            <input
              className="inp"
              value={draft}
              placeholder="ex. : chocolat, kiwi"
              onChange={(e) => {
                setDraft(e.target.value);
                const list = e.target.value
                  .split(/[,;\n]/)
                  .map((x) => x.trim())
                  .filter(Boolean);
                st.setDoc((d) => void (d.allergensExtra = list.length ? list : undefined), 'allergens');
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </>
      )}
    </div>
  );
}

function TextProps({ el }: { el: TextEl }) {
  const curve = el.curve || 'none';
  const help = useFormatsHelp();
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          {t('Texte')}
        </span>
        <span className="row" style={{ margin: 0, gap: 2 }}>
          {help.button}
          <FieldMenu onInsert={(tok) => up(el.id, { text: el.text + tok })} />
        </span>
      </div>
      {help.box}
      <textarea className="inp" rows={3} value={el.text} onChange={(e) => up(el.id, { text: e.target.value }, 'text' + el.id)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Texte')} />
      <FilterWarning text={el.text} />
      <div className="hint">{t('Double-cliquez sur le texte dans l’étiquette pour le modifier directement.')}</div>
      <div className="grid2">
        <label className="f">
          {t('Police')}
          <select className="inp" value={el.fontFamily} onChange={(e) => up(el.id, { fontFamily: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <NumField label={t('Taille')} suffix="pt" decimals={1} min={4} max={2000} value={el.fontSize} onChange={(v) => up(el.id, { fontSize: v }, 'fs')} />
      </div>
      <div className="row">
        <Seg
          value={el.align}
          onChange={(v) => up(el.id, { align: v })}
          options={[
            { v: 'left', label: <AlignLeft size={15} />, title: t('Gauche') },
            { v: 'center', label: <AlignCenter size={15} />, title: t('Centré') },
            { v: 'right', label: <AlignRight size={15} />, title: t('Droite') },
            { v: 'justify', label: <AlignJustify size={15} />, title: t('Justifié') },
          ]}
        />
        <div className="seg">
          <button className={el.bold ? 'on' : ''} title={t('Gras')} aria-label={t('Gras')} onClick={() => up(el.id, { bold: !el.bold })}>
            <Bold size={15} />
          </button>
          <button className={el.italic ? 'on' : ''} title={t('Italique')} aria-label={t('Italique')} onClick={() => up(el.id, { italic: !el.italic })}>
            <Italic size={15} />
          </button>
          <button className={el.underline ? 'on' : ''} title={t('Souligné')} aria-label={t('Souligné')} onClick={() => up(el.id, { underline: !el.underline })}>
            <Underline size={15} />
          </button>
        </div>
      </div>
      <div className="grid2">
        <ColorPicker label={el.invert ? t('Couleur du fond') : t('Couleur')} value={el.color} onChange={(c) => up(el.id, { color: c === 'none' ? '#000000' : c }, 'color')} />
        <NumField label={t('Interligne')} decimals={2} step={0.05} min={0.6} max={4} value={el.lineHeight} onChange={(v) => up(el.id, { lineHeight: v }, 'lh')} />
      </div>
      <Check checked={el.invert} onChange={(v) => up(el.id, { invert: v })}>
        {t('Inverser (texte blanc sur fond noir)')}
      </Check>
      <AllergenSection el={el} />
      <TextFitSection el={el} />
      <div className="sec">
        <div className="sec-t">{t('Texte courbé')}</div>
        <select
          className="inp"
          value={curve}
          onChange={(e) => {
            const v = e.target.value as CurveMode;
            up(el.id, { curve: v, h: v !== 'none' ? Math.max(el.h, el.w * (v === 'circle' ? 1 : 0.45)) : el.h, bend: el.bend ?? 50 });
          }}
          style={{ marginBottom: 8 }}
        >
          <option value="none">{t('Aucune courbe')}</option>
          <option value="arcTop">{t('Arc vers le haut')}</option>
          <option value="arcBottom">{t('Arc vers le bas (bas d’étiquette ronde)')}</option>
          <option value="circle">{t('Cercle complet')}</option>
        </select>
        {(curve === 'arcTop' || curve === 'arcBottom') && (
          <label className="f">
            {t('Courbure')} : {el.bend ?? 50}
            <input type="range" min={1} max={100} value={el.bend ?? 50} onChange={(e) => up(el.id, { bend: +e.target.value }, 'bend')} />
          </label>
        )}
      </div>
      <Check checked={!!el.zplAsImage} onChange={(v) => up(el.id, { zplAsImage: v })} title={t('Le texte est envoyé comme image ^GFA : police exacte, impression plus lente')}>
        {t('ZPL : envoyer ce texte en image')}
      </Check>
    </>
  );
}

function BarcodeProps({ el }: { el: BarcodeEl }) {
  const st = useStore();
  const info = SYMBOLOGIES.find((s) => s.id === el.symbology)!;
  const resolved = resolveText(el.value, { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true });
  const enc = encodeBarcode(resolved, el.symbology);
  const twoD = el.symbology === 'datamatrix';
  const help = useFormatsHelp();
  return (
    <>
      <label className="f" style={{ marginBottom: 8 }}>
        {t('Symbologie')}
        <select
          className="inp"
          value={el.symbology}
          onChange={(e) => {
            const s = e.target.value as Symbology;
            const d2 = s === 'datamatrix';
            const sample = SYMBOLOGIES.find((x) => x.id === s)!.sample;
            const ok = encodeBarcode(el.value, s).error === undefined || /\{\{/.test(el.value);
            up(el.id, { symbology: s, value: ok ? el.value : sample, showText: d2 ? false : el.showText, ...(d2 !== twoD ? { h: d2 ? el.w * 0.4 : 130, w: d2 ? el.w * 0.4 : Math.max(el.w, 300) } : {}) });
          }}
        >
          {SYMBOLOGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          {t('Valeur')}
        </span>
        <span className="row" style={{ margin: 0, gap: 2 }}>
          {help.button}
          <FieldMenu onInsert={(tok) => up(el.id, { value: tok })} />
        </span>
      </div>
      {help.box}
      <input className={'inp' + (enc.error !== undefined ? ' bad' : '')} value={el.value} onChange={(e) => up(el.id, { value: e.target.value }, 'val' + el.id)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Valeur du code-barres')} style={{ marginBottom: 6 }} />
      <FilterWarning text={el.value} />
      {enc.error !== undefined ? <div className="err">{enc.error}</div> : <div className="hint">{t(info.hint)}</div>}
      {resolved !== el.value && enc.error === undefined && <div className="hint">→ {resolved}</div>}
      {el.symbology === 'gs1-128' && <Gs1Assistant el={el} />}
      {el.symbology === 'sscc18' && <SsccAssistant el={el} />}
      {el.symbology === 'ean13' && <VarEanAssistant el={el} />}
      {!twoD && (
        <>
          <Check checked={el.showText} onChange={(v) => up(el.id, { showText: v })}>
            {t('Afficher le texte lisible')}
          </Check>
          {el.showText && <NumField label={t('Taille du texte')} suffix="pt" min={6} max={200} value={el.fontSize} onChange={(v) => up(el.id, { fontSize: v }, 'bfs')} />}
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <ColorPicker label={t('Couleur')} value={el.color} onChange={(c) => up(el.id, { color: c === 'none' ? '#000000' : c })} />
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Les barres sont calculées en points entiers à {dpi} dpi pour rester lisibles par les scanners.', { dpi: st.doc.dpi })}
      </div>
    </>
  );
}

function QrProps({ el }: { el: QrEl }) {
  const st = useStore();
  const payload = resolveText(qrPayload(el), { doc: st.doc, index: st.previewRow, row: st.doc.data?.rows[st.previewRow], resolve: true });
  const q = encodeQr(payload, el.level);
  const wifi = el.wifi || { ssid: '', password: '', enc: 'WPA' as const, hidden: false };
  const vc = el.vcard || { firstName: '', lastName: '', org: '', title: '', phone: '', email: '', url: '', address: '' };
  const setW = (p: Partial<typeof wifi>) => up(el.id, { wifi: { ...wifi, ...p } }, 'wifi' + el.id);
  const setV = (p: Partial<typeof vc>) => up(el.id, { vcard: { ...vc, ...p } }, 'vcard' + el.id);
  const help = useFormatsHelp();
  const vf = (k: keyof typeof vc, label: string) => (
    <label className="f">
      {label}
      <input className="inp" value={vc[k]} onChange={(e) => setV({ [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  );
  return (
    <>
      <div className="row">
        <Seg
          value={el.qrType}
          onChange={(v) => up(el.id, { qrType: v })}
          options={[
            { v: 'text', label: t('URL / texte') },
            { v: 'wifi', label: 'Wi-Fi' },
            { v: 'vcard', label: 'vCard' },
          ]}
        />
      </div>
      {el.qrType === 'text' && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="sec-t" style={{ margin: 0 }}>
              {t('Contenu')}
            </span>
            <span className="row" style={{ margin: 0, gap: 2 }}>
              {help.button}
              <FieldMenu onInsert={(tok) => up(el.id, { value: el.value + tok })} />
            </span>
          </div>
          {help.box}
          <textarea className={'inp' + (q.error !== undefined ? ' bad' : '')} rows={2} value={el.value} onChange={(e) => up(el.id, { value: e.target.value }, 'qr' + el.id)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Contenu du QR code')} />
          <FilterWarning text={el.value} />
        </>
      )}
      {el.qrType === 'wifi' && (
        <div className="grid2">
          <label className="f">
            {t('Nom du réseau (SSID)')}
            <input className="inp" value={wifi.ssid} onChange={(e) => setW({ ssid: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="f">
            {t('Mot de passe')}
            <input className="inp" value={wifi.password} onChange={(e) => setW({ password: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="f">
            {t('Sécurité')}
            <select className="inp" value={wifi.enc} onChange={(e) => setW({ enc: e.target.value as 'WPA' })}>
              <option value="WPA">WPA/WPA2/WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">{t('Aucune')}</option>
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <Check checked={wifi.hidden} onChange={(v) => setW({ hidden: v })}>
              {t('Réseau masqué')}
            </Check>
          </div>
        </div>
      )}
      {el.qrType === 'vcard' && (
        <div className="grid2">
          {vf('firstName', t('Prénom'))}
          {vf('lastName', t('Nom'))}
          {vf('org', t('Société'))}
          {vf('title', t('Fonction'))}
          {vf('phone', t('Téléphone'))}
          {vf('email', t('E-mail'))}
          {vf('url', t('Site web'))}
          {vf('address', t('Adresse'))}
        </div>
      )}
      {q.error !== undefined && <div className="err">{q.error}</div>}
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="f">
          {t('Correction d’erreur')}
          <select className="inp" value={el.level} onChange={(e) => up(el.id, { level: e.target.value as QrLevel })}>
            <option value="L">L — 7 %</option>
            <option value="M">M — 15 %</option>
            <option value="Q">Q — 25 %</option>
            <option value="H">H — 30 %</option>
          </select>
        </label>
        <ColorPicker label={t('Couleur')} value={el.color} onChange={(c) => up(el.id, { color: c === 'none' ? '#000000' : c })} />
      </div>
    </>
  );
}

function ImageProps({ el }: { el: ImageEl }) {
  const replace = async () => {
    const f = await pickFile('image/*');
    if (f) up(el.id, { src: await fileToDataUrl(f) });
  };
  return (
    <>
      <button className="btn sm block" onClick={replace} style={{ marginBottom: 10 }}>
        <ImageUp size={15} /> {t('Remplacer l’image')}
      </button>
      <Check checked={el.keepRatio} onChange={(v) => up(el.id, { keepRatio: v })}>
        {t('Conserver les proportions')}
      </Check>
      <div className="sec">
        <div className="sec-t">{t('Conversion noir et blanc (impression)')}</div>
        <label className="f">
          {t('Seuil')} : {el.threshold}
          <input type="range" min={10} max={245} value={el.threshold} onChange={(e) => up(el.id, { threshold: +e.target.value }, 'thr')} />
        </label>
        <Check checked={el.dither} onChange={(v) => up(el.id, { dither: v })}>
          {t('Tramage (photos, dégradés)')}
        </Check>
        <div className="hint">{t('Activez l’aperçu (œil, en bas à droite) pour voir le rendu imprimé.')}</div>
      </div>
    </>
  );
}

function ShapeProps({ el }: { el: ShapeEl }) {
  const def = shapeDef(el.kind);
  const symbol = def && def.category !== 'forme';
  const bar = def && def.category === 'forme' && def.bar;
  return (
    <>
      <div className="hint">{def ? t(def.label) : el.kind}</div>
      {symbol ? (
        <div className="grid2">
          <ColorPicker label={t('Couleur')} value={el.stroke} onChange={(c) => up(el.id, { stroke: c === 'none' ? '#000000' : c })} />
          <NumField label={t('Épaisseur du trait')} min={0.5} max={60} value={el.strokeWidth} onChange={(v) => up(el.id, { strokeWidth: v }, 'sw')} />
        </div>
      ) : bar ? (
        <ColorPicker label={t('Couleur')} value={el.fill === 'none' ? el.stroke : el.fill} onChange={(c) => up(el.id, { fill: c === 'none' ? '#000000' : c })} />
      ) : (
        <>
          <div className="grid2">
            <ColorPicker label={t('Remplissage')} allowNone value={el.fill} onChange={(c) => up(el.id, { fill: c })} />
            <ColorPicker label={t('Bordure')} allowNone value={el.stroke} onChange={(c) => up(el.id, { stroke: c })} />
          </div>
          <div className="grid2">
            <NumField label={t('Épaisseur de bordure')} min={0} max={200} value={el.strokeWidth} onChange={(v) => up(el.id, { strokeWidth: v }, 'sw')} />
            {(el.kind === 'roundrect' || el.kind === 'rect') && <NumField label={t('Arrondi des coins')} min={0} max={500} value={el.radius || 0} onChange={(v) => up(el.id, { radius: v, kind: v > 0 ? 'roundrect' : 'rect' }, 'rad')} />}
          </div>
        </>
      )}
    </>
  );
}

function TableProps({ el }: { el: TableEl }) {
  const [cell, setCell] = useState<[number, number] | null>(null);
  const setCells = (cells: string[][], key?: string) => up(el.id, { cells }, key);
  const resize = (rows: number, cols: number) => {
    rows = Math.max(1, Math.min(30, rows));
    cols = Math.max(1, Math.min(12, cols));
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => el.cells[r]?.[c] ?? ''));
    const colWidths = Array.from({ length: cols }, (_, c) => el.colWidths?.[c] ?? 1 / cols);
    const rowHeights = Array.from({ length: rows }, (_, r) => el.rowHeights?.[r] ?? 1 / rows);
    up(el.id, { rows, cols, cells, colWidths, rowHeights, h: (el.h / el.rows) * rows });
  };
  return (
    <>
      <div className="grid2">
        <label className="f">
          {t('Lignes')}
          <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            <button className="icon-btn flat sm" aria-label={t('Retirer une ligne')} onClick={() => resize(el.rows - 1, el.cols)}>
              <Minus size={14} />
            </button>
            <b style={{ minWidth: 20, textAlign: 'center' }}>{el.rows}</b>
            <button className="icon-btn flat sm" aria-label={t('Ajouter une ligne')} onClick={() => resize(el.rows + 1, el.cols)}>
              <Plus size={14} />
            </button>
          </div>
        </label>
        <label className="f">
          {t('Colonnes')}
          <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            <button className="icon-btn flat sm" aria-label={t('Retirer une colonne')} onClick={() => resize(el.rows, el.cols - 1)}>
              <Minus size={14} />
            </button>
            <b style={{ minWidth: 20, textAlign: 'center' }}>{el.cols}</b>
            <button className="icon-btn flat sm" aria-label={t('Ajouter une colonne')} onClick={() => resize(el.rows, el.cols + 1)}>
              <Plus size={14} />
            </button>
          </div>
        </label>
      </div>
      <Check checked={el.headerRow} onChange={(v) => up(el.id, { headerRow: v })}>
        {t('Ligne d’en-tête (gras)')}
      </Check>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          {t('Cellules')}
        </span>
        <FieldMenu
          onInsert={(tok) => {
            const [r, c] = cell ?? [el.headerRow && el.rows > 1 ? 1 : 0, 0];
            const cells = el.cells.map((x) => [...x]);
            cells[r][c] = (cells[r][c] || '') + tok;
            setCells(cells);
          }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${el.cols}, minmax(0,1fr))`, gap: 3, marginBottom: 8 }}>
        {el.cells.map((row, r) =>
          row.map((v, c) => (
            <input
              key={r + '-' + c}
              className="inp"
              style={{ height: 28, fontSize: 12, fontWeight: el.headerRow && r === 0 ? 700 : 400, padding: '4px 5px' }}
              value={v}
              onFocus={() => setCell([r, c])}
              onChange={(e) => {
                const cells = el.cells.map((x) => [...x]);
                cells[r][c] = e.target.value;
                setCells(cells, `cell-${el.id}-${r}-${c}`);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`${t('Cellule')} ${r + 1},${c + 1}`}
            />
          )),
        )}
      </div>
      <FilterWarning text={el.cells.flat().join(' ')} />
      <div className="hint">{t('Double-cliquez une cellule sur l’étiquette pour la saisir ; tirez les séparateurs pour redimensionner.')}</div>
      <div className="grid2">
        <NumField label={t('Taille du texte')} suffix="pt" min={4} max={300} value={el.fontSize} onChange={(v) => up(el.id, { fontSize: v }, 'tfs')} />
        <NumField label={t('Épaisseur des traits')} min={0} max={40} value={el.strokeWidth} onChange={(v) => up(el.id, { strokeWidth: v }, 'tsw')} />
        <label className="f">
          {t('Police')}
          <select className="inp" value={el.fontFamily} onChange={(e) => up(el.id, { fontFamily: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="f">
          {t('Alignement')}
          <Seg
            value={el.align}
            onChange={(v) => up(el.id, { align: v })}
            options={[
              { v: 'left', label: <AlignLeft size={14} /> },
              { v: 'center', label: <AlignCenter size={14} /> },
              { v: 'right', label: <AlignRight size={14} /> },
            ]}
          />
        </label>
      </div>
      <button className="btn sm block" onClick={() => up(el.id, { colWidths: Array(el.cols).fill(1), rowHeights: Array(el.rows).fill(1) })}>
        {t('Égaliser lignes et colonnes')}
      </button>
    </>
  );
}

