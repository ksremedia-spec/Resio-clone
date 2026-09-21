import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { I, type IconName } from './icons';
import { initials } from './format';
import { on } from '../store/events';

// ---------- hooks ----------
export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); setM(mq.matches); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}
export const useIsCompact = () => useMediaQuery('(max-width: 900px), (orientation: portrait) and (max-width: 1100px)');

export function useKeyboardShortcut(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const [mod, key] = combo.includes('+') ? combo.split('+') : [null, combo];
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (mod === 'mod' ? (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key!.toLowerCase() : !typing && e.key === key) { e.preventDefault(); handler(e); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [combo, handler, enabled]);
}

// ---------- primitives ----------
export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & React.SVGProps<SVGSVGElement>) {
  const C = I[name];
  return <C width={size} height={size} {...rest} />;
}

export function Button({ variant = 'default', size, icon, children, className = '', loading, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'quiet'; size?: 'sm' | 'lg'; icon?: IconName; loading?: boolean }) {
  return (
    <button type="button" className={`btn ${variant === 'default' ? '' : variant} ${size ?? ''} ${!children && icon ? 'icon' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, className = '', style }: { tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'count'; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone} ${className}`} style={style}>{children}</span>;
}

const STATUS_TONES: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  lead: 'info', pre_construction: 'brand', active: 'success', on_hold: 'warning', complete: 'neutral', archived: 'neutral',
  not_started: 'neutral', in_progress: 'brand', blocked: 'danger', cancelled: 'neutral',
  draft: 'neutral', sent: 'brand', viewed: 'info', approved: 'success', declined: 'danger', paid: 'success', overdue: 'danger', partially_paid: 'warning', void: 'neutral',
  pending: 'warning', released: 'brand', submitted: 'success', suspended: 'danger', low: 'neutral', medium: 'info', high: 'danger',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} title={name}>{initials(name) || '?'}</span>;
}

export function Spinner() { return <div className="spinner" role="progressbar" aria-label="Loading" />; }
export function Skeleton({ lines = 3 }: { lines?: number }) { return <div className="stack-sm" aria-busy="true">{Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}</div>; }
export function EmptyState({ icon = 'info', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={44} /><h3>{title}</h3>{children && <p>{children}</p>}{action && <div className="mt-2">{action}</div>}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = (error as Error)?.message ?? 'Something went wrong.';
  return <div className="error-state row-between"><span>{message}</span>{retry && <Button size="sm" onClick={retry} icon="refresh">Retry</Button>}</div>;
}
export function Progress({ value }: { value: number }) { return <div className="progress" role="progressbar" aria-valuenow={value}><div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>; }

// ---------- forms ----------
export function Field({ label, hint, error, children, className = '' }: { label?: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  const generated = useId();
  // Associate the label with a single form control child so screen readers and tests can find it by label.
  const single = isValidElement(children) && typeof children.type !== 'string' || (isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type as string)) ? (children as React.ReactElement<{ id?: string }>) : null;
  const id = single?.props.id ?? generated;
  const control = single && !single.props.id ? cloneElement(single, { id }) : children;
  return <div className={`field ${className}`}>{label && <label htmlFor={id}>{label}</label>}{control}{error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>;
}
export function Input({ className = '', invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) { return <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...rest} />; }
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`select ${className}`} {...rest}>{children}</select>; }
export function Textarea({ className = '', ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) { return <textarea ref={ref} className={`textarea ${className}`} {...rest} />; }
export function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return <div className="switch"><span><label htmlFor={id} style={{ fontWeight: 600 }}>{label}</label>{hint && <div className="subtle" id={hintId}>{hint}</div>}</span><input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={hint ? hintId : undefined} onChange={(e) => onChange(e.target.checked)} /></div>;
}
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: IconName }>; ariaLabel?: string }) {
  return <div className="segmented" role="tablist" aria-label={ariaLabel}>{options.map((o) => <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.icon && <Icon name={o.icon} size={16} />}{o.label}</button>)}</div>;
}
export function SearchField({ value, onChange, placeholder = 'Search', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return <div className="search"><Icon name="search" /><input className="input" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} aria-label={placeholder} /></div>;
}
export function Stepper({ value, onChange, min = 0, max = 9999, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  return <div className="stepper" aria-label={label}><button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, value - 1))}>−</button><span>{value}</span><button type="button" aria-label="Increase" onClick={() => onChange(Math.min(max, value + 1))}>+</button></div>;
}
export function Chip({ on: active, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) { return <button type="button" className={`chip ${active ? 'on' : ''}`} onClick={onClick} aria-pressed={active}>{children}</button>; }

// ---------- layout ----------
export function Card({ title, actions, children, className = '', wide }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return <section className={`card ${wide ? 'wide' : ''} ${className}`}>{(title || actions) && <header className="card-header"><h3>{title}</h3>{actions}</header>}{children}</section>;
}
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'danger' | 'ok' }) { return <div className={`stat ${tone ?? ''}`}><div className="label">{label}</div><div className="value">{value}</div></div>; }
export function Toolbar({ title, children, leading }: { title?: ReactNode; children?: ReactNode; leading?: ReactNode }) {
  return <header className="toolbar">{leading}{title && <h1 className="truncate">{title}</h1>}<div className="spacer" />{children}</header>;
}
export function ListRow({ primary, secondary, leading, trailing, selected, onClick, as: As = 'button', ...rest }: { primary: ReactNode; secondary?: ReactNode; leading?: ReactNode; trailing?: ReactNode; selected?: boolean; onClick?: () => void; as?: 'button' | 'div' } & Record<string, unknown>) {
  return (
    <As className={`list-row ${selected ? 'selected' : ''}`} onClick={onClick} aria-current={selected ? 'true' : undefined} {...(rest as any)}>
      {leading && <span className="leading">{leading}</span>}
      <span className="grow"><div className="primary truncate">{primary}</div>{secondary && <div className="secondary truncate">{secondary}</div>}</span>
      {trailing && <span className="trailing">{trailing}</span>}
    </As>
  );
}

/** Row with iPad-style swipe actions (touch) and a context menu (long-press / right-click). */
export function SwipeRow({ children, actions }: { children: ReactNode; actions: Array<{ label: string; tone?: 'danger' | 'brand' | 'success'; onSelect: () => void }> }) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const width = actions.length * 88;
  const colors = { danger: 'var(--danger)', brand: 'var(--brand)', success: 'var(--success)' };
  return (
    <div className="swipe" onTouchStart={(e) => { start.current = e.touches[0]!.clientX + offset; }} onTouchMove={(e) => { if (start.current == null) return; const dx = e.touches[0]!.clientX - start.current; setOffset(Math.max(-width, Math.min(0, dx))); }} onTouchEnd={() => { setOffset((o) => (o < -width / 2 ? -width : 0)); start.current = null; }}>
      <div className="swipe-actions">{actions.map((a) => <button key={a.label} style={{ background: colors[a.tone ?? 'brand'] }} onClick={() => { setOffset(0); a.onSelect(); }}>{a.label}</button>)}</div>
      <div className="swipe-content" style={{ transform: `translateX(${offset}px)` }}>{children}</div>
    </div>
  );
}

// ---------- overlays ----------
export function Sheet({ open, onClose, title, children, footer, size, leading }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'lg' | 'full'; leading?: ReactNode }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="sheet-header">{leading ?? <Button variant="quiet" onClick={onClose}>Cancel</Button>}<h2>{title}</h2><span style={{ width: 72 }} /></header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </div>, document.body);
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; message: string; confirmLabel?: string; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
      <p>{message}</p>
    </Sheet>
  );
}

export interface MenuItem { label: string; icon?: IconName; danger?: boolean; onSelect: () => void; separator?: boolean }
export function Popover({ anchor, open, onClose, children, align = 'end' }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 240; const h = ref.current?.offsetHeight ?? 200;
    let left = align === 'end' ? r.right - w : r.left; left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [open, anchor, align]);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); }; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('mousedown', h); document.addEventListener('touchstart', h); window.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); window.removeEventListener('keydown', k); }; }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(<div ref={ref} className="popover" style={pos} role="menu">{children}</div>, document.body);
}
export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return <>{items.map((it, i) => it.separator ? <div key={i} className="menu-sep" /> : <button key={i} className={`menu-item ${it.danger ? 'danger' : ''}`} role="menuitem" onClick={() => { onClose(); it.onSelect(); }}>{it.icon && <Icon name={it.icon} size={18} />}{it.label}</button>)}</>;
}
/** Button that opens a menu; also wires long-press / right-click on `target` for context menus. */
export function MenuButton({ items, icon = 'more', label = 'More', children }: { items: MenuItem[]; icon?: IconName; label?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button ref={ref} type="button" className={`btn quiet ${children ? '' : 'icon'}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{children ?? <Icon name={icon} />}</button>
    <Popover anchor={ref.current} open={open} onClose={close}><Menu items={items} onClose={close} /></Popover>
  </>;
}
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const timer = useRef<number | null>(null);
  const bind = (items: MenuItem[]) => ({
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); setState({ x: e.clientX, y: e.clientY, items }); },
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]!; timer.current = window.setTimeout(() => setState({ x: t.clientX, y: t.clientY, items }), 500); },
    onTouchEnd: () => { if (timer.current) window.clearTimeout(timer.current); },
    onTouchMove: () => { if (timer.current) window.clearTimeout(timer.current); },
  });
  const element = state ? createPortal(<div className="sheet-backdrop" style={{ background: 'transparent' }} onMouseDown={() => setState(null)} onTouchStart={() => setState(null)}><div className="popover" style={{ top: Math.min(state.y, window.innerHeight - 260), left: Math.min(state.x, window.innerWidth - 240) }} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}><Menu items={state.items} onClose={() => setState(null)} /></div></div>, document.body) : null;
  return { bind, element };
}

// ---------- toasts ----------
interface Toast { id: number; message: string; tone?: 'error' | 'success'; action?: { label: string; onClick: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => { const id = Date.now() + Math.random(); setToasts((ts) => [...ts.slice(-2), { ...t, id }]); window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4000); }, []);
  useEffect(() => on('toast', push), [push]);
  return <ToastCtx.Provider value={push}>{children}<div className="toast-host" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ''}`} role="status"><span>{t.message}</span>{t.action && <button onClick={t.action.onClick}>{t.action.label}</button>}</div>)}</div></ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Standard error → toast helper. */
export function useErrorToast() {
  const toast = useToast();
  return useCallback((err: unknown, fallback = 'Something went wrong.') => toast({ message: (err as Error)?.message || fallback, tone: 'error' }), [toast]);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const useSafeState = <T,>(initial: T) => { const [s, set] = useState(initial); const mounted = useRef(true); useEffect(() => () => { mounted.current = false; }, []); return [s, (v: T) => { if (mounted.current) set(v); }] as const; };
export const noop = () => {};
export { useMemo };
