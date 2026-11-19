import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { X, Pipette } from 'lucide-react';
import { t } from '../i18n';
import { isNone } from '../render/draw';

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

export function Modal({ title, onClose, children, footer, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-h">
          {icon}
          <div style={{ flex: 1 }}>{title}</div>
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
