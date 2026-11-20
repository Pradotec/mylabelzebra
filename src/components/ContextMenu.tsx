import { useRef } from 'react';
import { Copy, ClipboardPaste, CopyPlus, Trash2, BringToFront, SendToBack, Group, Ungroup, Lock, Unlock, BoxSelect, ImagePlus, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Stamp, Images, ClipboardCheck, Paintbrush, PaintRoller, ChevronUp, ChevronDown, Eye, EyeOff, SquareDashedMousePointer } from 'lucide-react';
import { useStore } from '../store';
import { useClickOutside, EstimatedSignIcon } from './ui';
import { t } from '../i18n';
import { addImageFile, addHealthMark, addEstimatedSign } from '../actions';
import { openSideDialog } from './SideDialogs';

export interface CtxMenuState {
  x: number;
  y: number;
}

export async function pasteImageFromClipboard(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((ty) => ty.startsWith('image/'));
      if (type) {
        await addImageFile(await it.getType(type));
        return true;
      }
    }
  } catch {
    /* refus de permission ou non pris en charge */
  }
  return false;
}

export function nudge(dx: number, dy: number) {
  const st = useStore.getState();
  const ids = st.doc.elements.filter((e) => st.selected.includes(e.id) && !e.locked).map((e) => e.id);
  if (!ids.length) return;
  st.updateEls(ids, (e) => ({ x: e.x + dx, y: e.y + dy }), 'nudge');
}

export function ContextMenu({ state, onClose }: { state: CtxMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(true, onClose, ref);
  const st = useStore();
  const sel = st.doc.elements.filter((e) => st.selected.includes(e.id));
  const has = sel.length > 0;
  const locked = has && sel.every((e) => e.locked);
  const grouped = sel.some((e) => e.groups?.length);
  const hidden = has && sel.every((e) => e.hidden);
  const styleClip = st.styleClip;
  const styleTarget = !!styleClip && sel.some((e) => e.type === styleClip.type);
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  const left = Math.min(state.x, window.innerWidth - 290);
  const top = Math.max(8, Math.min(state.y, window.innerHeight - (has ? 720 : 560)));
  return (
    <div ref={ref} className="menu" style={{ position: 'fixed', left, top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }} role="menu">
      <button className="mi" disabled={!has} onClick={run(st.copySelected)}>
        <Copy size={16} /> {t('Copier')} <span className="k">Ctrl+C</span>
      </button>
      <button className="mi" onClick={run(st.paste)}>
        <ClipboardPaste size={16} /> {t('Coller')} <span className="k">Ctrl+V</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(() => st.copyStyle() && st.toast(t('Mise en forme copiée'), 'ok'))}>
        <Paintbrush size={16} /> {t('Copier la mise en forme')} <span className="k">Ctrl+Alt+C</span>
      </button>
      <button className="mi" disabled={!styleTarget} onClick={run(() => void st.pasteStyle())}>
        <PaintRoller size={16} /> {t('Coller la mise en forme')} <span className="k">Ctrl+Alt+V</span>
      </button>
      <button
        className="mi"
        onClick={run(async () => {
          if (!(await pasteImageFromClipboard())) useStore.getState().toast(t('Aucune image dans le presse-papiers (ou accès refusé).'), 'error');
        })}
      >
        <ImagePlus size={16} /> {t('Coller une image')}
      </button>
      <button className="mi" disabled={!has} onClick={run(st.duplicateSelected)}>
        <CopyPlus size={16} /> {t('Dupliquer')} <span className="k">Ctrl+D</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(st.removeSelected)}>
        <Trash2 size={16} /> {t('Supprimer')} <span className="k">Suppr</span>
      </button>
      <hr />
      <button className="mi" disabled={!has} onClick={run(() => st.reorder(st.selected, 'front'))}>
        <BringToFront size={16} /> {t('Premier plan')} <span className="k">Ctrl+Maj+]</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(() => st.reorder(st.selected, 'up'))}>
        <ChevronUp size={16} /> {t('Avancer d’un plan')} <span className="k">Ctrl+]</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(() => st.reorder(st.selected, 'down'))}>
        <ChevronDown size={16} /> {t('Reculer d’un plan')} <span className="k">Ctrl+[</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(() => st.reorder(st.selected, 'back'))}>
        <SendToBack size={16} /> {t('Arrière-plan')} <span className="k">Ctrl+Maj+[</span>
      </button>
      <button className="mi" disabled={sel.length < 2} onClick={run(st.groupSelected)}>
        <Group size={16} /> {t('Grouper')} <span className="k">Ctrl+G</span>
      </button>
      <button className="mi" disabled={!grouped} onClick={run(st.ungroupSelected)}>
        <Ungroup size={16} /> {t('Dégrouper')} <span className="k">Ctrl+Maj+G</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(st.toggleLockSelected)}>
        {locked ? <Unlock size={16} /> : <Lock size={16} />} {locked ? t('Déverrouiller') : t('Verrouiller')} <span className="k">Ctrl+Maj+L</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(st.toggleHiddenSelected)}>
        {hidden ? <Eye size={16} /> : <EyeOff size={16} />} {hidden ? t('Afficher') : t('Masquer')} <span className="k">Ctrl+Maj+H</span>
      </button>
      <button className="mi" onClick={run(() => st.select(st.doc.elements.filter((e) => !e.hidden).map((e) => e.id)))}>
        <BoxSelect size={16} /> {t('Tout sélectionner')} <span className="k">Ctrl+A</span>
      </button>
      <button className="mi" disabled={!has} onClick={run(st.selectSameType)}>
        <SquareDashedMousePointer size={16} /> {t('Sélectionner les éléments du même type')}
      </button>
      {!has && (
        <>
          <hr />
          <div className="mt">{t('Insérer')}</div>
          <button className="mi" onClick={run(addHealthMark)}>
            <Stamp size={16} /> {t('Estampille sanitaire')}
          </button>
          <button className="mi" onClick={run(addEstimatedSign)}>
            <EstimatedSignIcon size={16} /> {t('Quantité estimée')}
          </button>
          <button className="mi" onClick={run(() => openSideDialog('pictos'))}>
            <Images size={16} /> {t('Mes pictogrammes…')}
          </button>
          <button className="mi" onClick={run(() => openSideDialog('food'))}>
            <ClipboardCheck size={16} /> {t('Conformité alimentaire…')}
          </button>
        </>
      )}
      {has && (
        <>
          <hr />
          <div className="mt">{t('Décaler')}</div>
          <div className="row" style={{ justifyContent: 'center', margin: 4 }}>
            <button className="icon-btn sm flat" aria-label={t('Gauche')} onClick={() => nudge(-1, 0)}>
              <ArrowLeft size={16} />
            </button>
            <button className="icon-btn sm flat" aria-label={t('Haut')} onClick={() => nudge(0, -1)}>
              <ArrowUp size={16} />
            </button>
            <button className="icon-btn sm flat" aria-label={t('Bas')} onClick={() => nudge(0, 1)}>
              <ArrowDown size={16} />
            </button>
            <button className="icon-btn sm flat" aria-label={t('Droite')} onClick={() => nudge(1, 0)}>
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
