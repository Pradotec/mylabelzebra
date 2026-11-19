/**
 * Assistants de saisie des codes-barres :
 * - GS1-128 : construction de la donnée à partir des identifiants d'application (AI) ;
 * - SSCC-18 : extension + préfixe entreprise + référence, clé calculée ;
 * - EAN-13 à poids / prix variable (préfixes 20–29, conventions françaises).
 */
import { useEffect, useState } from 'react';
import { Trash2, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import type { BarcodeEl, LabelElement } from '../types';
import { gs1Check, priceCheck4 } from '../render/codes';
import { t } from '../i18n';

const up = (id: string, p: Partial<LabelElement>, key?: string) => useStore.getState().updateEls([id], p, key);
const hasField = (s: string) => /\{\{/.test(s);

// ---------------------------------------------------------------------------
// GS1-128
// ---------------------------------------------------------------------------

type AiKind = 'sscc' | 'gtin' | 'text' | 'date' | 'count' | 'weight' | 'price';
interface AiDef {
  ai: string;
  label: string;
  kind: AiKind;
  /** longueur fixe des données */
  fixed?: number;
  max?: number;
}
export const AI_DEFS: AiDef[] = [
  { ai: '00', label: 'SSCC (colis / palette)', kind: 'sscc', fixed: 18 },
  { ai: '01', label: 'GTIN de l’article', kind: 'gtin', fixed: 14 },
  { ai: '02', label: 'GTIN du contenu', kind: 'gtin', fixed: 14 },
  { ai: '10', label: 'Numéro de lot', kind: 'text', max: 20 },
  { ai: '11', label: 'Date de production', kind: 'date', fixed: 6 },
  { ai: '13', label: 'Date d’emballage', kind: 'date', fixed: 6 },
  { ai: '15', label: 'DDM (à consommer de préférence avant)', kind: 'date', fixed: 6 },
  { ai: '17', label: 'DLC / date de péremption', kind: 'date', fixed: 6 },
  { ai: '21', label: 'Numéro de série', kind: 'text', max: 20 },
  { ai: '37', label: 'Nombre d’unités contenues', kind: 'count', max: 8 },
  ...[0, 1, 2, 3, 4, 5].map((n) => ({ ai: '310' + n, label: `Poids net (kg, ${n} décimale${n > 1 ? 's' : ''})`, kind: 'weight' as const, fixed: 6 })),
  ...[0, 1, 2, 3].map((n) => ({ ai: '392' + n, label: `Prix à payer (${n} décimale${n > 1 ? 's' : ''})`, kind: 'price' as const, max: 15 })),
];
const defOf = (ai: string) => AI_DEFS.find((d) => d.ai === ai);

interface AiRow {
  ai: string;
  v: string;
}

export function parseGs1(value: string): AiRow[] {
  const rows: AiRow[] = [];
  const re = /\((\d{2,4})\)((?:\{\{[^}]*\}\}|[^(])*)/g;
  for (const m of value.matchAll(re)) rows.push({ ai: m[1], v: m[2] });
  return rows;
}

const GS1_CHARS = /^[A-Za-z0-9!"%&'*+,\-./:;<=>?_]+$/;

function validDate(v: string, allowDay0: boolean) {
  if (!/^\d{6}$/.test(v)) return false;
  const mm = +v.slice(2, 4),
    dd = +v.slice(4, 6);
  return mm >= 1 && mm <= 12 && ((allowDay0 && dd === 0) || (dd >= 1 && dd <= 31));
}

/** Donnée finale d'une ligne (clé ajoutée si besoin) + message d'erreur éventuel */
export function aiData(r: AiRow): { data: string; error?: string; note?: string } {
  const d = defOf(r.ai);
  const v = r.v.trim();
  if (!v) return { data: v, error: t('Valeur manquante') };
  if (hasField(v)) return { data: v, note: t('calculé à l’impression') };
  if (!d) return { data: v, note: t('AI non contrôlé') };
  switch (d.kind) {
    case 'sscc': {
      if (!/^\d{17,18}$/.test(v)) return { data: v, error: t('17 chiffres (+ clé) attendus') };
      const full = v.slice(0, 17) + gs1Check(v.slice(0, 17));
      if (v.length === 18 && full !== v) return { data: v, error: t('Clé de contrôle incorrecte (attendue : {c})', { c: full[17] }) };
      return { data: full, note: v.length === 17 ? t('clé {c} ajoutée', { c: full[17] }) : undefined };
    }
    case 'gtin': {
      if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v)) return { data: v, error: t('GTIN : 8, 12, 13 ou 14 chiffres') };
      if (v.length === 14) {
        const ok = gs1Check(v.slice(0, 13)) === +v[13];
        return ok ? { data: v } : { data: v, error: t('Clé de contrôle incorrecte (attendue : {c})', { c: gs1Check(v.slice(0, 13)) }) };
      }
      // GTIN-8/12/13 : on considère qu'il est complet (clé comprise) et on le cadre sur 14
      if (v.length !== 13) {
        const ok = gs1Check(v.slice(0, -1)) === +v[v.length - 1];
        if (!ok) return { data: v, error: t('Clé de contrôle incorrecte (attendue : {c})', { c: gs1Check(v.slice(0, -1)) }) };
        return { data: v.padStart(14, '0'), note: t('complété à 14 chiffres') };
      }
      // 13 chiffres : EAN-13 complet (clé juste) → cadré sur 14 ; sinon base d'un GTIN-14 → clé calculée
      if (gs1Check(v.slice(0, 12)) === +v[12]) return { data: '0' + v, note: t('GTIN-13 complété à 14 chiffres') };
      const full = v + gs1Check(v);
      return { data: full, note: t('clé {c} ajoutée', { c: full[13] }) };
    }
    case 'date':
      return validDate(v, r.ai === '15' || r.ai === '17') ? { data: v } : { data: v, error: t('Date AAMMJJ attendue (6 chiffres)') };
    case 'count':
      return /^\d{1,8}$/.test(v) ? { data: v } : { data: v, error: t('1 à 8 chiffres') };
    case 'weight':
      return /^\d{6}$/.test(v) ? { data: v } : { data: v, error: t('6 chiffres attendus') };
    case 'price':
      return /^\d{1,15}$/.test(v) ? { data: v } : { data: v, error: t('1 à 15 chiffres') };
    case 'text':
      if (v.length > (d.max ?? 20)) return { data: v, error: t('{n} caractères maximum', { n: d.max ?? 20 }) };
      return GS1_CHARS.test(v) ? { data: v } : { data: v, error: t('Caractères autorisés : lettres sans accent, chiffres, ponctuation simple (pas d’espace ni de parenthèse)') };
  }
}

/** Assemble les AI : longueur fixe d'abord, variables ensuite (FNC1 ajouté automatiquement) */
export function buildGs1(rows: AiRow[]): string {
  const isFixed = (r: AiRow) => !!defOf(r.ai)?.fixed;
  const ordered = [...rows.filter(isFixed), ...rows.filter((r) => !isFixed(r))];
  return ordered
    .filter((r) => r.v.trim())
    .map((r) => `(${r.ai})${aiData(r).data}`)
    .join('');
}

const yymmdd = (iso: string) => (iso ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : '');
const isoOf = (v: string) => (/^\d{6}$/.test(v) && v.slice(4) !== '00' ? `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}` : '');

export function Gs1Assistant({ el }: { el: BarcodeEl }) {
  const [rows, setRows] = useState<AiRow[]>(() => parseGs1(el.value));
  const [open, setOpen] = useState(false);
  // resynchronise quand la valeur change ailleurs (saisie directe, annuler)
  useEffect(() => {
    if (buildGs1(rows) !== el.value) setRows(parseGs1(el.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.value]);
  const commit = (next: AiRow[]) => {
    setRows(next);
    up(el.id, { value: buildGs1(next) }, 'gs1' + el.id);
  };
  const setRow = (i: number, p: Partial<AiRow>) => commit(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const used = new Set(rows.map((r) => r.ai));
  return (
    <div className="sec gs1-assist">
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          <Wand2 size={13} style={{ verticalAlign: -2 }} /> {t('Assistant GS1-128')}
        </span>
        <button className="btn sm flat" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('Masquer') : t('Ouvrir')}
        </button>
      </div>
      {open && (
        <>
          <div className="hint">{t('Chaque ligne est un identifiant d’application (AI). Les AI à longueur fixe sont placés en premier ; le séparateur FNC1 est ajouté automatiquement. Les valeurs peuvent contenir des {{champs}}.')}</div>
          {rows.map((r, i) => {
            const d = defOf(r.ai);
            const res = aiData(r);
            const dec = d?.kind === 'weight' || d?.kind === 'price' ? +r.ai[3] : 0;
            return (
              <div key={i} className="gs1-row">
                <div className="row" style={{ margin: 0, gap: 4, flexWrap: 'nowrap' }}>
                  <select className="inp" style={{ flex: 1, minWidth: 0 }} value={r.ai} onChange={(e) => setRow(i, { ai: e.target.value })} aria-label={t('Identifiant d’application')}>
                    {!d && <option value={r.ai}>({r.ai})</option>}
                    {AI_DEFS.map((x) => (
                      <option key={x.ai} value={x.ai}>
                        ({x.ai}) {t(x.label)}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn flat sm" aria-label={t('Retirer')} onClick={() => commit(rows.filter((_, k) => k !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="row" style={{ margin: '4px 0 0', gap: 4, flexWrap: 'nowrap' }}>
                  <input className={'inp' + (res.error ? ' bad' : '')} style={{ flex: 1, minWidth: 0 }} value={r.v} placeholder={d?.kind === 'date' ? 'AAMMJJ' : ''} onChange={(e) => setRow(i, { v: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Valeur')} />
                  {d?.kind === 'date' && <input type="date" className="inp" style={{ width: 130 }} value={isoOf(r.v)} onChange={(e) => setRow(i, { v: yymmdd(e.target.value) })} aria-label={t('Choisir une date')} />}
                  {(d?.kind === 'weight' || d?.kind === 'price') && (
                    <input
                      className="inp"
                      style={{ width: 110 }}
                      placeholder={d.kind === 'weight' ? 'kg' : '€'}
                      title={t('Saisissez la valeur ({u}) ou un {{champ}} : les chiffres sont calculés automatiquement', { u: d.kind === 'weight' ? 'kg' : '€' })}
                      onChange={(e) => {
                        const x = e.target.value.trim();
                        if (!x) return;
                        if (hasField(x)) {
                          const name = x.replace(/^\{\{\s*|\s*\}\}$/g, '');
                          setRow(i, { v: `{{${name}|nombre:${dec}|chiffres${d.kind === 'weight' ? '|pad:6' : ''}}}` });
                          return;
                        }
                        const n = parseFloat(x.replace(',', '.'));
                        if (!isNaN(n)) {
                          const digits = String(Math.round(n * 10 ** dec));
                          setRow(i, { v: d.kind === 'weight' ? digits.padStart(6, '0') : digits });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      aria-label={d.kind === 'weight' ? t('Poids en kg') : t('Montant')}
                    />
                  )}
                </div>
                {res.error ? <div className="err">{res.error}</div> : res.note ? <div className="hint">{res.note}</div> : null}
              </div>
            );
          })}
          <select
            className="inp"
            value=""
            onChange={(e) => {
              const ai = e.target.value;
              if (!ai) return;
              const d = defOf(ai)!;
              const sample = d.kind === 'date' ? yymmdd(new Date().toISOString().slice(0, 10)) : '';
              commit([...rows, { ai, v: sample }]);
            }}
            aria-label={t('Ajouter un AI')}
          >
            <option value="">{t('+ Ajouter un identifiant (AI)…')}</option>
            {AI_DEFS.filter((x) => !used.has(x.ai)).map((x) => (
              <option key={x.ai} value={x.ai}>
                ({x.ai}) {t(x.label)}
              </option>
            ))}
          </select>
          <div className="hint" style={{ marginTop: 6 }}>
            {t('Dates depuis une colonne : {{fabrication|date:AAMMJJ}} ; DLC à J+21 : {{aujourdhui|jours:+21|date:AAMMJJ}}.')}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSCC-18
// ---------------------------------------------------------------------------

export function SsccAssistant({ el }: { el: BarcodeEl }) {
  const [open, setOpen] = useState(false);
  const [ext, setExt] = useState('0');
  const [prefix, setPrefix] = useState('');
  const [serial, setSerial] = useState('');
  const refLen = 16 - prefix.length;
  const serialPart = hasField(serial) ? serial.replace(/\}\}$/, `|pad:${refLen}}}`) : serial.padStart(refLen, '0');
  const body = ext + prefix + serialPart;
  const ok = /^\d$/.test(ext) && /^\d{6,12}$/.test(prefix) && (hasField(serial) || (/^\d+$/.test(serial) && serial.length <= refLen));
  const check = ok && !hasField(serial) ? gs1Check(body) : null;
  return (
    <div className="sec gs1-assist">
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          <Wand2 size={13} style={{ verticalAlign: -2 }} /> {t('Assistant SSCC')}
        </span>
        <button className="btn sm flat" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('Masquer') : t('Ouvrir')}
        </button>
      </div>
      {open && (
        <>
          <div className="grid3">
            <label className="f">
              {t('Extension')}
              <input className="inp" maxLength={1} value={ext} onChange={(e) => setExt(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <label className="f" style={{ gridColumn: 'span 2' }}>
              {t('Préfixe entreprise GS1')}
              <input className="inp" value={prefix} placeholder="3760123" onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          </div>
          <label className="f">
            {t('Référence de série ({n} chiffres max, ou {{numero}})', { n: Math.max(0, refLen) })}
            <input className="inp" value={serial} placeholder="{{numero}}" onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          {ok ? (
            <div className="hint">
              <code>{body}</code>
              {check != null ? <b> + {t('clé')} {check}</b> : <span> + {t('clé calculée à l’impression')}</span>}
            </div>
          ) : (
            <div className="err">{t('Extension : 1 chiffre ; préfixe : 6 à 12 chiffres ; référence : chiffres (17 au total sans la clé).')}</div>
          )}
          <button className="btn sm block" disabled={!ok} onClick={() => up(el.id, { value: body })}>
            {t('Utiliser ce SSCC')}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EAN-13 à poids / prix variable
// ---------------------------------------------------------------------------

type VarLayout = 'p2a5v5' | 'p1a6v5' | 'p2a5c1v4';
const LAYOUTS: { v: VarLayout; label: string; hint: string }[] = [
  { v: 'p2a5v5', label: '2X + article (5) + valeur (5)', hint: 'Préfixe 20–29, code article sur 5 chiffres, valeur sur 5 chiffres.' },
  { v: 'p1a6v5', label: '2 + article (6) + valeur (5)', hint: 'Convention française courante : « 2 » puis article sur 6 chiffres et valeur sur 5 chiffres.' },
  { v: 'p2a5c1v4', label: '2X + article (5) + clé prix + valeur (4)', hint: 'Valeur sur 4 chiffres précédée de sa clé de contrôle « prix » (pondérations GS1 2-, 2-, 3, 5-).' },
];

export function buildVarEan(layout: VarLayout, prefix: string, article: string, value: string, kind: 'poids' | 'prix', fieldUnit: 'base' | 'big'): { value: string; error?: string } {
  const vLen = layout === 'p2a5c1v4' ? 4 : 5;
  const aLen = layout === 'p1a6v5' ? 6 : 5;
  const pre = layout === 'p1a6v5' ? '2' : prefix;
  if (layout !== 'p1a6v5' && !/^2\d$/.test(pre)) return { value: '', error: t('Préfixe : 20 à 29') };
  if (!/^\d+$/.test(article) || article.length > aLen) return { value: '', error: t('Article : {n} chiffres', { n: aLen }) };
  const art = article.padStart(aLen, '0');
  let val: string;
  const v = value.trim();
  if (hasField(v)) {
    const name = v.replace(/^\{\{\s*|\s*\}\}$/g, '');
    // champ en kg / € → grammes / centimes ; sinon déjà en g / centimes
    const conv = fieldUnit === 'big' ? (kind === 'poids' ? 'nombre:3|chiffres' : 'nombre:2|chiffres') : 'nombre:0|chiffres';
    val = `{{${name}|${conv}|pad:${vLen}${vLen === 4 ? '|cleprix' : ''}}}`;
  } else {
    if (!/^\d+$/.test(v)) return { value: '', error: t('Valeur : nombre entier ({u})', { u: kind === 'poids' ? 'g' : t('centimes') }) };
    if (v.length > vLen) return { value: '', error: t('Valeur trop grande : {n} chiffres maximum', { n: vLen }) };
    const p = v.padStart(vLen, '0');
    val = vLen === 4 ? String(priceCheck4(p)) + p : p;
  }
  return { value: pre + art + val };
}

export function VarEanAssistant({ el }: { el: BarcodeEl }) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<VarLayout>('p1a6v5');
  const [prefix, setPrefix] = useState('21');
  const [article, setArticle] = useState('');
  const [kind, setKind] = useState<'poids' | 'prix'>('poids');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'base' | 'big'>('big');
  const res = buildVarEan(layout, prefix, article, value, kind, unit);
  const isField = hasField(value);
  const full = res.value && !hasField(res.value) ? res.value + gs1Check(res.value) : '';
  return (
    <div className="sec gs1-assist">
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <span className="sec-t" style={{ margin: 0 }}>
          <Wand2 size={13} style={{ verticalAlign: -2 }} /> {t('EAN-13 poids / prix variable')}
        </span>
        <button className="btn sm flat" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('Masquer') : t('Ouvrir')}
        </button>
      </div>
      {open && (
        <>
          <label className="f">
            {t('Structure')}
            <select className="inp" value={layout} onChange={(e) => setLayout(e.target.value as VarLayout)}>
              {LAYOUTS.map((l) => (
                <option key={l.v} value={l.v}>
                  {t(l.label)}
                </option>
              ))}
            </select>
          </label>
          <div className="hint">{t(LAYOUTS.find((l) => l.v === layout)!.hint)}</div>
          <div className="grid2">
            {layout !== 'p1a6v5' && (
              <label className="f">
                {t('Préfixe (20–29)')}
                <input className="inp" maxLength={2} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
              </label>
            )}
            <label className="f">
              {t('Code article')}
              <input className="inp" value={article} placeholder={layout === 'p1a6v5' ? '123456' : '12345'} onChange={(e) => setArticle(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <label className="f">
              {t('Type de valeur')}
              <select className="inp" value={kind} onChange={(e) => setKind(e.target.value as 'poids' | 'prix')}>
                <option value="poids">{t('Poids (grammes)')}</option>
                <option value="prix">{t('Prix (centimes)')}</option>
              </select>
            </label>
            <label className="f">
              {kind === 'poids' ? t('Poids en g, ou {{champ}}') : t('Prix en centimes, ou {{champ}}')}
              <input className="inp" value={value} placeholder={kind === 'poids' ? '1250' : '{{prix}}'} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          </div>
          {isField && (
            <label className="f">
              {t('Le champ contient')}
              <select className="inp" value={unit} onChange={(e) => setUnit(e.target.value as 'base' | 'big')}>
                <option value="big">{kind === 'poids' ? t('des kilogrammes (1,25)') : t('des euros (4,90)')}</option>
                <option value="base">{kind === 'poids' ? t('des grammes (1250)') : t('des centimes (490)')}</option>
              </select>
            </label>
          )}
          {res.error ? (
            <div className="err">{res.error}</div>
          ) : (
            <div className="hint">
              <code style={{ wordBreak: 'break-all' }}>{res.value}</code>
              {full ? (
                <>
                  {' '}
                  → <b>{full}</b> ({t('clé EAN calculée')})
                </>
              ) : (
                <> → {t('clé EAN calculée à l’impression')}</>
              )}
            </div>
          )}
          <button className="btn sm block" disabled={!!res.error} onClick={() => up(el.id, { value: res.value })}>
            {t('Utiliser ce code')}
          </button>
        </>
      )}
    </div>
  );
}
