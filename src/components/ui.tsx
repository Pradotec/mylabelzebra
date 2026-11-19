import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { X, Pipette } from 'lucide-react';
import { t } from '../i18n';
import { isNone } from '../render/draw';
import { estimatedSignPaths } from '../render/marks';

/**
 * Icône du signe ℮ (quantité estimée) dessinée d'après le gabarit de la directive 76/211/CEE :
 * le caractère U+212E ressemble à un « e » dans la plupart des polices d'interface.
 */
const ESTIMATED_PATHS = estimatedSignPaths();
export function EstimatedSignIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-4 -4 108 108" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      {ESTIMATED_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export function useClickOutside(open: boolean, onClose: () => void, ...refs: React.RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (refs.some((r) => r.current && r.current.contains(e.target as Node))) return;
      onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h, true);
      window.removeEventListener('keydown', k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Bouton + menu déroulant ancré */
export function Dropdown({
  button,
  children,
  align = 'left',
  style,
  open: openP,
  onOpenChange,
  className = 'menu',
}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right' | 'center';
  style?: CSSProperties;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  className?: string;
}) {
  const [openS, setOpenS] = useState(false);
  const open = openP ?? openS;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOpenS(o));
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(open, () => setOpen(false), ref);
  const pos: CSSProperties =
    align === 'right' ? { right: 0 } : align === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : { left: 0 };
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {button(open, () => setOpen(!open))}
      {open && (
        <div className={className} style={{ top: 'calc(100% + 8px)', ...pos, ...style }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Éléments focalisables visibles d'un conteneur, dans l'ordre du document */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el.getClientRects?.().length > 0 || el === document.activeElement));
}

/** Pile des fenêtres ouvertes : seule la plus haute réagit à Échap et piège le focus */
const modalStack: object[] = [];

export function Modal({ title, onClose, children, footer, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [me] = useState(() => ({}));
  const isTop = () => modalStack[modalStack.length - 1] === me;

  // pile, focus initial et restitution du focus à la fermeture
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modalStack.push(me);
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      // un champ (autoFocus) a déjà pu prendre le focus ; sinon premier champ de saisie,
      // sinon la fenêtre elle-même (Entrée ne déclenche pas un bouton par mégarde, Tab
      // mène au premier contrôle)
      const body = box.querySelector('.modal-b');
      const field = focusables(box).find((el) => body?.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio');
      (field ?? box).focus({ preventScroll: true });
    }
    return () => {
      const i = modalStack.indexOf(me);
      if (i >= 0) modalStack.splice(i, 1);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    };
  }, [me]);

  // Échap (fenêtre du dessus) et focus ramené dans la fenêtre s'il en sort
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTop()) onCloseRef.current();
    };
    const fin = (e: FocusEvent) => {
      const box = ref.current;
      const target = e.target as HTMLElement;
      if (!box || !isTop() || box.contains(target)) return;
      // bandeaux non modaux (progression / annulation, demande d'impression, notifications) : accessibles
      if (target?.closest?.('.remote-banner, .toasts, [data-focus-outside-ok]')) return;
      box.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', k);
    document.addEventListener('focusin', fin);
    return () => {
      window.removeEventListener('keydown', k);
      document.removeEventListener('focusin', fin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab / Maj+Tab piégés dans la fenêtre
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const list = focusables(ref.current);
    if (!list.length) {
      e.preventDefault();
      ref.current.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={'modal' + (wide ? ' wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ outline: 'none' }}
      >
        <div className="modal-h">
          {icon}
          <div id={titleId} style={{ flex: 1 }}>
            {title}
          </div>
          <button className="icon-btn flat" onClick={onClose} aria-label={t('Fermer')}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, onClose, children, className, icon, extra }: { title: ReactNode; onClose?: () => void; children: ReactNode; className: string; icon?: ReactNode; extra?: ReactNode }) {
  return (
    <div className={'panel hide-in-preview ' + className} onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel-h">
        {icon}
        <span>{title}</span>
        <span className="spacer" />
        {extra}
        {onClose && (
          <button className="icon-btn flat sm" onClick={onClose} aria-label={t('Fermer')}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="panel-b">{children}</div>
    </div>
  );
}

/** Champ numérique tolérant à la saisie (virgule acceptée) */
export function NumField({
  value,
  onChange,
  step = 1,
  min,
  max,
  decimals = 2,
  label,
  suffix,
  title,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  label?: ReactNode;
  suffix?: string;
  title?: string;
  disabled?: boolean;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** decimals) / 10 ** decimals) : '');
  const [s, setS] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setS(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (str: string) => {
    let v = parseFloat(str.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(v);
  };
  const input = (
    <div style={{ position: 'relative' }}>
      <input
        className="inp"
        inputMode="decimal"
        value={s}
        title={title}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setS(fmt(value));
        }}
        onChange={(e) => {
          setS(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            let v = (Number.isFinite(value) ? value : 0) + k;
            if (min != null) v = Math.max(min, v);
            if (max != null) v = Math.min(max, v);
            onChange(v);
            setS(fmt(v));
          }
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        style={suffix ? { paddingRight: 26 } : undefined}
      />
      {suffix && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 11, color: 'var(--ink-3)', pointerEvents: 'none' }}>{suffix}</span>}
    </div>
  );
  if (!label) return input;
  return (
    <label className="f">
      {label}
      {input}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? 'on' : ''} title={o.title} aria-label={o.title} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const SWATCHES = ['#000000', '#ffffff', '#4a4a4a', '#9aa0a6', '#d43b2a', '#ff5a36', '#f5a524', '#f7d417', '#1f9d6a', '#14b8a6', '#2563eb', '#16213e', '#7c3aed', '#db2777', '#8b5a2b', '#e5e7eb'];

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

export function ColorPicker({ value, onChange, allowNone, label }: { value: string; onChange: (c: string) => void; allowNone?: boolean; label?: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const none = isNone(value);
  const pick = async () => {
    if (!window.EyeDropper) return;
    try {
      const r = await new window.EyeDropper().open();
      onChange(r.sRGBHex);
    } catch {
      /* annulé */
    }
  };
  return (
    <div style={{ minWidth: 0 }}>
      {label && <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 3 }}>{label}</div>}
      <Dropdown
        className="menu color-pop"
        button={(_, toggle) => (
          <button className="color-btn" onClick={toggle} aria-label={label || t('Couleur')}>
            <span className={'swatch' + (none ? ' none-swatch' : '')} style={none ? undefined : { background: value }} />
            <span className="code">{none ? t('Aucune') : value.toUpperCase()}</span>
          </button>
        )}
      >
        <div className="sw">
          {SWATCHES.map((c) => (
            <button key={c} style={{ background: c }} title={c} onClick={() => onChange(c)} />
          ))}
        </div>
        <div className="row">
          <input type="color" value={none ? '#000000' : value} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 32, border: 0, padding: 0, background: 'none' }} />
          <input
            className="inp code grow"
            value={none ? '' : hex}
            placeholder="#000000"
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button className="icon-btn flat sm" title={window.EyeDropper ? t('Pipette') : t('Pipette non prise en charge par ce navigateur')} disabled={!window.EyeDropper} onClick={pick}>
            <Pipette size={16} />
          </button>
        </div>
        {allowNone && (
          <button className="btn sm flat block" onClick={() => onChange('none')}>
            <span className="swatch none-swatch" style={{ width: 16, height: 16 }} /> {t('Aucune (transparent)')}
          </button>
        )}
      </Dropdown>
    </div>
  );
}
