'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';
import { initials } from '@/lib/format';

// ------------------------------------------------------------------ toasts
interface ToastItem {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, text, error }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), error ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' err' : ''}`}>
            <Icon name={t.error ? 'alert' : 'check'} size={16} />
            <span>{t.text}</span>
            <button className="x" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ overlays
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Dialog({ title, onClose, children, footer, labelledBy = 'dlg-title' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('input, select, textarea, button.btn-primary, button.btn-danger');
    el?.focus();
  }, []);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="dialog-wrap" onClick={onClose}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref} onClick={(e) => e.stopPropagation()}>
          <h2 className="h2" id={labelledBy}>
            {title}
          </h2>
          {children}
          {footer && <div className="dialog-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

export function Drawer({ onClose, title, children, actions }: { onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
          <div className="grow">{title}</div>
          {actions}
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ states
export function Empty({ icon = 'orders', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">
        <Icon name={icon} size={22} />
      </div>
      <div className="t">{title}</div>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <div className="grow">
        <div style={{ fontWeight: 650 }}>Couldn’t load this</div>
        <div>{message}</div>
      </div>
      {onRetry && (
        <button className="btn btn-sm btn-neutral" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function CardSkeletons({ n = 4 }: { n?: number }) {
  return (
    <div className="cards" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 250, borderRadius: 20 }} />
      ))}
    </div>
  );
}

export function Avatar({ name, color, size = '' }: { name: string | null | undefined; color?: string | null; size?: '' | 'sm' | 'lg' }) {
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ''}`} style={{ background: color ?? undefined }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}
