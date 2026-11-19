/**
 * Fenêtres ouvertes depuis le panneau de propriétés, le menu contextuel ou la fenêtre
 * d'impression : conformité alimentaire et bibliothèque de pictogrammes personnels.
 * Petit état global indépendant du store principal (montées par l'éditeur).
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CheckCircle2, AlertTriangle, Info, ClipboardCheck, Images, Upload, Trash2, Pencil, Plus } from 'lucide-react';
import { Modal } from './ui';
import { t, num } from '../i18n';
import { useStore } from '../store';
import { analyzeFood, type FoodReport } from '../food';
import { elementLabel } from '../elements';
import { listPictos, addPicto, renamePicto, deletePicto, pictoNameFromFile, isPictoType, PICTO_ACCEPT, PICTO_MAX_BYTES, type Picto } from '../pictos';
import { addImageSrc } from '../actions';
import { fileToDataUrl } from '../render/images';
import { pickFile } from '../util';
import { batchJobs } from '../render/resolve';

type Side = 'food' | 'pictos' | null;
export const useSideDialog = create<{ open: Side }>(() => ({ open: null }));
export const openSideDialog = (open: Side) => useSideDialog.setState({ open });

export function SideDialogs() {
  const open = useSideDialog((s) => s.open);
  // portail en fin de <body> : au-dessus des autres fenêtres (ex. ouverte depuis « Imprimer »)
  if (open === 'food') return createPortal(<FoodComplianceDialog onClose={() => openSideDialog(null)} />, document.body);
  if (open === 'pictos') return createPortal(<PictoLibraryDialog onClose={() => openSideDialog(null)} />, document.body);
  return null;
}

const mm = (v: number) => num(v);

/** Rapport de conformité du document courant (étiquettes du lot pour la hauteur de x) */
export function useFoodReport(): FoodReport {
  const doc = useStore((s) => s.doc);
  const row = useStore((s) => s.previewRow);
  return useMemo(() => analyzeFood(doc, { indices: batchJobs(doc, row).map((j) => j.index) }), [doc, row]);
}

// ---------- Conformité alimentaire ----------
export function FoodComplianceDialog({ onClose }: { onClose: () => void }) {
  const r = useFoodReport();
  const st = useStore();
  const pick = (id: string) => {
    st.select([id]);
    onClose();
  };
  const ElLinks = ({ ids }: { ids: { id: string; label: string }[] }) => (
    <>
      {ids.map((e) => (
        <button key={e.id} className="btn sm flat" style={{ padding: '0 6px' }} onClick={() => pick(e.id)} title={t('Sélectionner')}>
          {e.label}
        </button>
      ))}
    </>
  );
  return (
    <Modal title={t('Conformité alimentaire')} icon={<ClipboardCheck size={20} />} onClose={onClose} wide>
      <div className="hint">
        {t('Mentions obligatoires du règlement (UE) n° 1169/2011 (art. 9 et 13), d’après le rôle attribué à chaque élément (panneau de propriétés, « Rôle réglementaire »). Aide à la vérification : ne remplace pas un contrôle réglementaire.')}
      </div>
      {!r.used && <div className="err">{t('Aucun élément n’a de rôle réglementaire : sélectionnez chaque mention et choisissez son rôle.')}</div>}
      {r.missing.length > 0 && (
        <div className="err">
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {t('Mentions toujours obligatoires absentes : {l}. Vérifiez si une exemption s’applique (détail ci-dessous).', { l: r.missing.map((m) => t(m.label)).join(', ') })}
        </div>
      )}
      <div className="sec-t">{t('Mentions')}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {r.items.map((it) => {
          const ok = it.present;
          const always = it.req.kind === 'always';
          const Icon = ok ? CheckCircle2 : always ? AlertTriangle : Info;
          const color = ok ? 'var(--ok, #2f855a)' : always ? '#e53e3e' : 'var(--ink-3)';
          return (
            <div key={it.req.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 6, alignItems: 'start' }}>
              <Icon size={16} style={{ color, marginTop: 2 }} aria-label={ok ? t('présent') : t('absent')} />
              <div>
                <div>
                  <b>{t(it.req.label)}</b> <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{t(it.req.ref)}</span>{' '}
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{always ? t('toujours obligatoire') : t('selon le produit')}</span>
                </div>
                {it.elements.length > 0 && <ElLinks ids={it.elements.map((e) => ({ id: e.id, label: elementLabel(e) }))} />}
                {it.coveredBy === 'ingredients' && <div className="okmsg">{t('Couverts par la liste des ingrédients (allergènes en gras).')}</div>}
                {it.conditional && <div className="hint">{t('Présente seulement sous condition d’affichage : vérifiez qu’elle s’imprime sur chaque étiquette.')}</div>}
                {!ok && <div className="hint">{t(it.req.note)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {r.dateIssues.length > 0 && (
        <div className="sec">
          {r.dateIssues.map((d) => (
            <div key={d.el.id} className="err">
              {t('« {n} » : date limite de consommation au format {f}, sans le jour. L’annexe X exige au moins le jour et le mois (« à consommer jusqu’au … »).', { n: elementLabel(d.el), f: d.format })}
            </div>
          ))}
        </div>
      )}
      {r.inco.length > 0 && (
        <div className="sec">
          {r.inco.map((i) => (
            <div key={i.el.id} className="err">
              {t('« {n} » : hauteur de x {v} mm, sous le minimum de {s} mm sur {k} étiquette(s) (art. 13 §2 et annexe IV).', { n: elementLabel(i.el), v: mm(i.minMm), s: mm(i.thresholdMm), k: i.failing })}{' '}
              <button className="btn sm flat" onClick={() => pick(i.el.id)}>
                {t('Sélectionner')}
              </button>
            </div>
          ))}
        </div>
      )}
      {r.sameField.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          <Info size={13} style={{ verticalAlign: -2 }} /> {t('Rappel (art. 13 §5) : la dénomination, la quantité nette et, pour les boissons alcoolisées, le titre alcoométrique doivent figurer dans le même champ visuel.')}
        </div>
      )}
      <div className="hint">{t('Les mentions obligatoires de l’art. 9 sont automatiquement soumises au contrôle de hauteur de x (1,2 mm, ou 0,9 mm si la plus grande face mesure moins de 80 cm²).')}</div>
    </Modal>
  );
}

// ---------- Pictogrammes personnels ----------
export function PictoLibraryDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Picto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => listPictos().then(setList);
  useEffect(() => {
    refresh();
  }, []);
  const toast = useStore((s) => s.toast);

  const importFile = async () => {
    const f = await pickFile(PICTO_ACCEPT);
    if (!f) return;
    if (!isPictoType(f.type, f.name)) return setErr(t('Format non pris en charge (SVG, PNG, JPG)'));
    if (f.size > PICTO_MAX_BYTES) return setErr(t('Fichier trop volumineux (maximum {n} Mo)', { n: (PICTO_MAX_BYTES / 1e6).toLocaleString('fr-FR') }));
    const src = await fileToDataUrl(f);
    const res = await addPicto(pictoNameFromFile(f.name), src);
    if (res.error) setErr(res.error);
    else {
      setErr(null);
      refresh();
    }
  };
  const insert = async (p: Picto) => {
    await addImageSrc(p.src, { name: p.name });
    onClose();
  };
  const rename = async (p: Picto) => {
    const name = window.prompt(t('Nom du pictogramme'), p.name);
    if (name == null) return;
    const e = await renamePicto(p.id, name);
    if (e) toast(e, 'error');
    refresh();
  };
  const remove = async (p: Picto) => {
    if (!window.confirm(t('Supprimer « {n} » de la bibliothèque ? Les étiquettes qui l’utilisent gardent leur image.', { n: p.name }))) return;
    const e = await deletePicto(p.id);
    if (e) toast(e, 'error');
    refresh();
  };

  return (
    <Modal
      title={t('Mes pictogrammes')}
      icon={<Images size={20} />}
      onClose={onClose}
      wide
      footer={
        <button className="btn accent" onClick={importFile}>
          <Upload size={16} /> {t('Importer un pictogramme (SVG, PNG)')}
        </button>
      }
    >
      <div className="hint">
        {t('Importez vos propres fichiers (Triman / Info-tri, Nutri-Score, logos…) : ils sont conservés dans ce navigateur et réutilisables dans toutes vos étiquettes. Les logos officiels ne sont pas fournis : utilisez les fichiers remis par leurs titulaires (Citeo, Santé publique France…) en respectant leurs chartes d’utilisation.')}
      </div>
      {err && <div className="err">{err}</div>}
      {list && !list.length && <div className="hint">{t('Aucun pictogramme pour l’instant.')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 8 }}>
        {(list ?? []).map((p) => (
          <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, display: 'grid', gap: 6 }}>
            <button className="btn flat" style={{ height: 90, padding: 4, display: 'grid', placeItems: 'center' }} onClick={() => insert(p)} title={t('Ajouter à l’étiquette')}>
              <img src={p.src} alt={p.name} style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }} />
            </button>
            <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
              {p.name}
            </div>
            <div className="row" style={{ margin: 0, gap: 2 }}>
              <button className="icon-btn flat sm" onClick={() => insert(p)} title={t('Ajouter à l’étiquette')} aria-label={t('Ajouter à l’étiquette')}>
                <Plus size={14} />
              </button>
              <button className="icon-btn flat sm" onClick={() => rename(p)} title={t('Renommer')} aria-label={t('Renommer')}>
                <Pencil size={14} />
              </button>
              <button className="icon-btn flat sm" onClick={() => remove(p)} title={t('Supprimer')} aria-label={t('Supprimer')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
