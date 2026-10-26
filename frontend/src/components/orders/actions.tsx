'use client';
import { createContext, CSSProperties, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api, getSession, newKey, post } from '@/lib/api';
import { refreshAll, useApi } from '@/lib/hooks';
import { day, fromLocalInput, mapsDirections, SLOT_KIND, time, toLocalInput } from '@/lib/format';
import type { ActionDescriptor, FieldDef, Order, Slot, Staff } from '@/lib/types';
import { Icon, IconName } from '@/components/ui/Icon';
import { Dialog, Spinner, useToast } from '@/components/ui/primitives';

// ------------------------------------------------------------------ copy
/** Past-tense confirmations so the toast echoes the button the user pressed. */
const DONE: Record<string, string> = {
  ACCEPT: 'Accepted',
  ACCEPT_AND_START_PREP: 'Accepted — preparation started',
  REJECT: 'Rejected',
  REQUEST_CLARIFICATION: 'Clarification requested',
  CANCEL: 'Cancelled',
  CONFIRM_CANCELLATION: 'Cancellation confirmed',
  DECLINE_CANCELLATION: 'Cancellation declined',
  START_PREPARATION: 'Preparation started',
  ADD_PREP_TIME: 'Preparation time extended',
  MARK_READY: 'Marked ready',
  CONFIRM_SCHEDULE: 'Schedule confirmed',
  RESCHEDULE: 'Rescheduled',
  APPROVE_RESCHEDULE_REQUEST: 'New time accepted',
  DECLINE_RESCHEDULE_REQUEST: 'Reschedule declined',
  ASSIGN_AGENT: 'Delivery offered to agent',
  AUTO_ASSIGN_AGENT: 'Delivery offered to the best available agent',
  REASSIGN_AGENT: 'Agent reassigned',
  CONFIRM_PICKUP_HANDOVER: 'Handover confirmed',
  CONFIRM_DELIVERED: 'Marked delivered',
  CONFIRM_SERVED: 'Marked served',
  CONFIRM_SERVICE_COMPLETION: 'Service completed',
  RETRY_DELIVERY: 'Delivery retry started',
  APPROVE_RETURN: 'Return approved',
  DECLINE_RETURN: 'Return declined',
  CONFIRM_RETURN_RECEIVED: 'Return received',
  CONFIRM_RETURN_PICKUP: 'Return picked up',
  ASSIGN_PROVIDER: 'Provider assigned',
  REPORT_PROVIDER_UNAVAILABLE: 'Provider marked unavailable',
  SET_MEETING_DETAILS: 'Meeting details saved',
  CONFIRM_APPOINTMENT: 'Appointment confirmed',
  START_TRAVEL: 'Travel started',
  MARK_ATTENDED: 'Attendance recorded',
  START_SERVICE: 'Service started',
  MARK_SERVICE_COMPLETED: 'Service completed',
  REPORT_CUSTOMER_UNAVAILABLE: 'Reported customer unavailable',
  MARK_SERVICE_FAILED: 'Marked failed',
  REQUEST_RESCHEDULING: 'Rescheduling requested',
  RECORD_COD_COLLECTED: 'Cash collection recorded',
  RETRY_PAYMENT: 'Payment link sent again',
  UPDATE_REFUND_STATUS: 'Refund status updated',
  ACCEPT_DELIVERY: 'Delivery accepted',
  REJECT_DELIVERY: 'Delivery rejected',
  CONFIRM_PICKUP: 'Pickup confirmed',
  START_DELIVERY: 'Delivery started',
  MARK_DELIVERED: 'Marked delivered',
  MARK_DELIVERY_FAILED: 'Failed delivery reported',
  RETURN_TO_WORKSPACE: 'Return recorded',
};

const ICON: Record<string, IconName> = {
  TRACK_DELIVERY: 'navigate',
  NAVIGATE_TO_PICKUP: 'navigate',
  NAVIGATE_TO_CUSTOMER: 'navigate',
  CONTACT_CUSTOMER: 'phone',
  VIEW_PAYMENT_DETAILS: 'receipt',
  VIEW_AVAILABILITY: 'calendar',
  MANAGE_CAPACITY: 'users',
  ADD_PREP_TIME: 'timer',
  RESCHEDULE: 'calendar',
};

const PAIRABLE_DANGER = ['REJECT', 'REJECT_DELIVERY', 'MARK_DELIVERY_FAILED', 'DECLINE_CANCELLATION', 'DECLINE_RESCHEDULE_REQUEST', 'DECLINE_RETURN'];
const VISIBLE_LINKS = ['TRACK_DELIVERY', 'NAVIGATE_TO_PICKUP', 'NAVIGATE_TO_CUSTOMER', 'CONTACT_CUSTOMER'];
/** When someone is waiting for an answer, approve / decline is the decision to surface. */
const REQUEST_PAIRS: Array<[string, string]> = [
  ['CONFIRM_CANCELLATION', 'DECLINE_CANCELLATION'],
  ['APPROVE_RESCHEDULE_REQUEST', 'DECLINE_RESCHEDULE_REQUEST'],
  ['APPROVE_RETURN', 'DECLINE_RETURN'],
];

// ------------------------------------------------------------------ context
interface ActionEnv {
  /** Optional extra handling for in-app links (track, payment details, availability). */
  onLink?: (code: string, order: Order) => void;
  /** Endpoint used to perform actions (customer simulator uses its own). */
  endpoint?: (orderId: string) => string;
}
const EnvCtx = createContext<ActionEnv>({});
export function ActionEnvProvider({ value, children }: { value: ActionEnv; children: ReactNode }) {
  return <EnvCtx.Provider value={value}>{children}</EnvCtx.Provider>;
}

function linkHref(code: string, o: Order): { href: string; external: boolean } | null {
  const ws = getSession()?.user.workspace;
  switch (code) {
    case 'NAVIGATE_TO_PICKUP':
      return ws ? { href: mapsDirections(ws.address), external: true } : null;
    case 'NAVIGATE_TO_CUSTOMER':
      return o.delivery.address ? { href: mapsDirections(o.delivery.address, ws?.address), external: true } : null;
    case 'CONTACT_CUSTOMER':
      return { href: `tel:${o.customer.phone.replace(/\s+/g, '')}`, external: false };
    case 'VIEW_AVAILABILITY': {
      const listing = o.items[0]?.listingId ?? '';
      return { href: `/admin/schedule?listing=${listing}&date=${(o.schedule.start ?? new Date().toISOString()).slice(0, 10)}`, external: false };
    }
    case 'MANAGE_CAPACITY':
      return { href: o.schedule.slotId ? `/admin/schedule?slot=${o.schedule.slotId}` : `/admin/schedule?listing=${o.items[0]?.listingId ?? ''}`, external: false };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ hook
export function useActionRunner(order: Order, onDone?: (code: string) => void) {
  const toast = useToast();
  const env = useContext(EnvCtx);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<ActionDescriptor | null>(null);

  async function execute(a: ActionDescriptor, input: Record<string, unknown>): Promise<string | null> {
    setBusy(a.code);
    try {
      const url = env.endpoint ? env.endpoint(order.id) : `/orders/${order.id}/actions`;
      await post(url, { action: a.code, input, expectedVersion: env.endpoint ? undefined : order.version }, newKey());
      toast(DONE[a.code] ?? `${a.label} — done`);
      setOpen(null);
      refreshAll();
      onDone?.(a.code);
      return null;
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'STALE_ORDER') {
        toast('This order just changed. Showing the latest status.', true);
        setOpen(null);
        refreshAll();
        return null;
      }
      const msg = err?.message ?? 'Something went wrong.';
      if (!open && !(a.fields.length || a.confirm)) toast(msg, true);
      return msg;
    } finally {
      setBusy(null);
    }
  }

  function trigger(a: ActionDescriptor) {
    if (a.kind === 'link') {
      env.onLink?.(a.code, order);
      return;
    }
    if (a.fields.length || a.confirm) setOpen(a);
    else void execute(a, {});
  }

  const dialog = open ? (
    <ActionDialog
      key={open.code}
      order={order}
      action={open}
      onClose={() => setOpen(null)}
      onSubmit={(input) => execute(open, input)}
      busy={busy === open.code}
    />
  ) : null;

  return { trigger, busy, dialog, execute };
}

// ------------------------------------------------------------------ buttons
function btnClass(a: ActionDescriptor, extra = ''): string {
  const tone = a.kind === 'link' ? 'neutral' : a.tone;
  return `btn btn-${tone} ${extra}`.trim();
}

function ActionButton({ a, order, runner, className = '', size = '' }: { a: ActionDescriptor; order: Order; runner: ReturnType<typeof useActionRunner>; className?: string; size?: '' | 'sm' | 'lg' }) {
  const cls = btnClass(a, `${size ? `btn-${size}` : ''} ${className}`);
  if (a.kind === 'link') {
    const l = linkHref(a.code, order);
    if (l) {
      return (
        <a className={cls} href={l.href} target={l.external ? '_blank' : undefined} rel={l.external ? 'noopener noreferrer' : undefined}>
          {ICON[a.code] && <Icon name={ICON[a.code]} size={15} />}
          {a.label}
        </a>
      );
    }
  }
  return (
    <button type="button" className={cls} onClick={() => runner.trigger(a)} disabled={!!runner.busy} title={a.hint}>
      {runner.busy === a.code ? <Spinner /> : ICON[a.code] && <Icon name={ICON[a.code]} size={15} />}
      {a.label}
    </button>
  );
}

/**
 * Renders exactly the actions the backend says are allowed for this order, role and status.
 * - card: one main action, one pair (e.g. Accept / Decline), helpful links, the rest under “More”.
 * - full: every action, grouped by importance (detail panel).
 */
export function ActionBar({ order, variant = 'card', hide = [], prefer = [], onDone, onDetails }: { order: Order; variant?: 'card' | 'full' | 'mobile'; hide?: string[]; prefer?: string[]; onDone?: (code: string) => void; onDetails?: () => void }) {
  const runner = useActionRunner(order, onDone);
  const actions = order.actions.filter((a) => !hide.includes(a.code));
  const [menu, setMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !popRef.current?.contains(t)) setMenu(false);
    };
    // the menu is portalled with fixed coordinates, so close it rather than let it drift on scroll/resize
    const close = () => setMenu(false);
    document.addEventListener('mousedown', h);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', h);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  /** Places the menu next to the “More” button, opening up or down and left or right to stay on screen. */
  function toggleMenu(btn: HTMLElement, items: number) {
    if (menu) return setMenu(false);
    const r = btn.getBoundingClientRect();
    const w = 240;
    const h = items * 38 + 14;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const pos: CSSProperties = { left, width: w };
    if (r.top > h + 12 && window.innerHeight - r.bottom < h + 12) pos.bottom = window.innerHeight - r.top + 6;
    else pos.top = r.bottom + 6;
    setMenuPos(pos);
    setMenu(true);
  }

  const layout = useMemo(() => {
    const muts = actions.filter((a) => a.kind === 'mutation');
    const links = actions.filter((a) => a.kind === 'link');
    if (variant === 'full') return { main: [] as ActionDescriptor[], pair: [] as ActionDescriptor[], links, rest: [] as ActionDescriptor[], all: muts };
    const preferred = prefer.map((c) => muts.find((a) => a.code === c)).filter((a): a is ActionDescriptor => !!a);
    const main = preferred.length ? preferred.slice(0, 1) : muts.filter((a) => a.tone === 'primary').slice(0, 1);
    const remaining = muts.filter((a) => !main.includes(a));
    const pair: ActionDescriptor[] = [];
    const req = REQUEST_PAIRS.map(([y, n]) => [remaining.find((a) => a.code === y), remaining.find((a) => a.code === n)]).find(([y, n]) => y && n);
    if (preferred.length > 1) pair.push(...preferred.slice(1, 3));
    else if (req) pair.push(req[0]!, req[1]!);
    else {
      const a1 = remaining.find((a) => a.tone === 'success') ?? remaining.find((a) => a.tone === 'warning') ?? (main.length ? undefined : remaining.find((a) => a.tone === 'neutral'));
      if (a1) pair.push(a1);
      const a2 = remaining.find((a) => PAIRABLE_DANGER.includes(a.code));
      if (a2) pair.push(a2);
      if (!main.length && pair.length < 2) {
        const extra = remaining.find((a) => !pair.includes(a) && a.tone !== 'danger');
        if (extra) pair.unshift(extra);
      }
    }
    const shownLinks = links.filter((l) => VISIBLE_LINKS.includes(l.code));
    const rest = [...remaining.filter((a) => !pair.includes(a)), ...links.filter((l) => !shownLinks.includes(l))];
    return { main, pair, links: shownLinks, rest, all: [] as ActionDescriptor[] };
  }, [actions, variant, prefer]);

  if (!actions.length && !onDetails) return null;

  if (variant === 'full') {
    const groups: Array<[string, ActionDescriptor[]]> = [
      ['Next steps', layout.all.filter((a) => a.tone === 'primary' || a.tone === 'success')],
      ['Other actions', layout.all.filter((a) => a.tone === 'neutral' || a.tone === 'warning')],
      ['Cancel or decline', layout.all.filter((a) => a.tone === 'danger')],
      ['Open', layout.links],
    ];
    return (
      <div className="stack" style={{ gap: 14 }}>
        {groups
          .filter(([, xs]) => xs.length)
          .map(([title, xs]) => (
            <div key={title} className="stack" style={{ gap: 8 }}>
              <div className="label">{title}</div>
              <div className="row-wrap">
                {xs.map((a) => (
                  <ActionButton key={a.code} a={a} order={order} runner={runner} />
                ))}
              </div>
              {xs.filter((a) => a.hint).map((a) => (
                <div key={`h-${a.code}`} className="help">
                  {a.label}: {a.hint}
                </div>
              ))}
            </div>
          ))}
        {runner.dialog}
      </div>
    );
  }

  const size = variant === 'mobile' ? 'lg' : '';
  return (
    <div className="actions">
      {layout.main.map((a) => (
        <ActionButton key={a.code} a={a} order={order} runner={runner} className="wide" size={size} />
      ))}
      {layout.pair.map((a) => (
        <ActionButton key={a.code} a={a} order={order} runner={runner} size={size} />
      ))}
      {layout.links.map((a) => (
        <ActionButton key={a.code} a={a} order={order} runner={runner} size={size} />
      ))}
      {(layout.rest.length > 0 || onDetails) && (
        <div className="more-wrap" ref={menuRef}>
          <button type="button" className={`btn btn-neutral icon-btn${size ? ` btn-${size}` : ''}`} aria-haspopup="menu" aria-expanded={menu} aria-label="More actions" onClick={(e) => toggleMenu(e.currentTarget, layout.rest.length + (onDetails ? 1 : 0))}>
            <Icon name="more" />
          </button>
          {menu && createPortal(
            <div className="menu floating" role="menu" ref={popRef} style={menuPos}>
              {onDetails && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onDetails();
                  }}
                >
                  <Icon name="eye" size={15} />
                  View details
                </button>
              )}
              {layout.rest.map((a) => {
                const l = a.kind === 'link' ? linkHref(a.code, order) : null;
                if (l)
                  return (
                    <a key={a.code} role="menuitem" href={l.href} target={l.external ? '_blank' : undefined} rel="noopener noreferrer">
                      <Icon name={ICON[a.code] ?? 'chevronRight'} size={15} />
                      {a.label}
                    </a>
                  );
                return (
                  <button
                    key={a.code}
                    role="menuitem"
                    className={a.tone === 'danger' ? 'danger' : ''}
                    onClick={() => {
                      setMenu(false);
                      runner.trigger(a);
                    }}
                  >
                    <Icon name={ICON[a.code] ?? (a.tone === 'danger' ? 'slash' : 'chevronRight')} size={15} />
                    {a.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
        </div>
      )}
      {runner.dialog}
    </div>
  );
}

// ------------------------------------------------------------------ dialog
type Values = Record<string, unknown>;

export function ActionDialog({ order, action, onClose, onSubmit, busy }: { order: Order; action: ActionDescriptor; onClose: () => void; onSubmit: (input: Values) => Promise<string | null>; busy: boolean }) {
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of action.fields) {
      if (f.defaultValue !== undefined) v[f.name] = f.type === 'select' ? String(f.defaultValue) : f.defaultValue;
    }
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const missing = action.fields.filter((f) => f.required && isEmpty(values[f.name]));
  const danger = action.tone === 'danger';

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (missing.length) {
      setError(`${missing[0].label} is required.`);
      return;
    }
    setError(null);
    const out: Values = {};
    for (const f of action.fields) {
      const v = values[f.name];
      if (isEmpty(v)) continue;
      out[f.name] = f.type === 'datetime' && typeof v === 'string' ? fromLocalInput(v) : f.type === 'money' || f.type === 'number' ? Number(v) : v;
    }
    const err = await onSubmit(out);
    if (err) setError(err);
  }

  return (
    <Dialog
      title={action.confirm?.title ?? action.label}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Keep as is
          </button>
          <button type="submit" form="action-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy && <Spinner />}
            {action.confirm?.cta ?? action.label}
          </button>
        </>
      }
    >
      <form id="action-form" className="stack" style={{ gap: 14, marginTop: 6 }} onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>
          <b style={{ color: 'var(--ink)' }}>{order.code}</b> · {order.items.map((i) => i.name).join(', ')} · {order.customer.name}
        </p>
        {action.confirm?.body && <div className={`callout ${danger ? 'callout-red' : 'callout-blue'}`}><Icon name="info" size={15} />{action.confirm.body}</div>}
        {action.hint && <div className="callout callout-amber"><Icon name="info" size={15} />{action.hint}</div>}
        {action.fields.map((f) => (
          <FieldInput key={f.name} f={f} order={order} action={action} value={values[f.name]} invalid={touched && f.required && isEmpty(values[f.name])} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
        ))}
        {error && <div className="error-text" role="alert">{error}</div>}
      </form>
    </Dialog>
  );
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function FieldInput({ f, order, action, value, onChange, invalid }: { f: FieldDef; order: Order; action: ActionDescriptor; value: unknown; onChange: (v: unknown) => void; invalid: boolean }) {
  const id = `f-${f.name}`;
  const cls = invalid ? ' invalid' : '';
  let control: ReactNode;
  switch (f.type) {
    case 'textarea':
      control = <textarea id={id} className={`textarea${cls}`} value={(value as string) ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} maxLength={1000} />;
      break;
    case 'select':
      control = (
        <select id={id} className={`select${cls}`} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'money':
      control = (
        <div className="input-prefix">
          <span>₹</span>
          <input id={id} className={`input num${cls}`} type="number" inputMode="decimal" step="0.01" min={f.min} value={(value as string | number) ?? ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case 'number':
      control = <input id={id} className={`input num${cls}`} type="number" min={f.min} max={f.max} value={(value as string | number) ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'datetime':
      control = <input id={id} className={`input${cls}`} type="datetime-local" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'agent':
      control = <AgentSelect id={id} value={(value as string) ?? ''} onChange={onChange} allowAuto={action.code === 'REASSIGN_AGENT'} exclude={order.assignment?.agentId} invalid={invalid} />;
      break;
    case 'provider':
      control = <ProviderSelect id={id} value={(value as string) ?? ''} onChange={onChange} exclude={action.code === 'ASSIGN_PROVIDER' ? order.provider?.id : undefined} invalid={invalid} />;
      break;
    case 'schedule':
      control = <SchedulePicker order={order} value={value as { slotId?: string; start?: string } | undefined} onChange={onChange} />;
      break;
    default:
      control = <input id={id} className={`input${cls}`} type={f.type === 'url' ? 'url' : 'text'} value={(value as string) ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} maxLength={500} />;
  }
  return (
    <div className="field">
      <label htmlFor={id}>
        {f.label}
        {f.required && <span className="req" aria-hidden>*</span>}
      </label>
      {control}
      {f.help && <div className="help">{f.help}</div>}
    </div>
  );
}

function AgentSelect({ id, value, onChange, allowAuto, exclude, invalid }: { id: string; value: string; onChange: (v: string) => void; allowAuto: boolean; exclude?: string; invalid: boolean }) {
  const q = useApi<Staff[]>('/delivery/agents');
  const agents = (q.data ?? []).filter((a) => a.id !== exclude);
  return (
    <select id={id} className={`select${invalid ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={q.loading && !q.data}>
      <option value="">{q.loading && !q.data ? 'Loading agents…' : 'Choose an agent…'}</option>
      {allowAuto && <option value="AUTO">Auto — best available agent</option>}
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {a.isAvailable ? 'on duty' : 'off duty'} · {a.activeDeliveries} active
        </option>
      ))}
    </select>
  );
}

function ProviderSelect({ id, value, onChange, exclude, invalid }: { id: string; value: string; onChange: (v: string) => void; exclude?: string; invalid: boolean }) {
  const q = useApi<Staff[]>('/schedule/providers');
  return (
    <select id={id} className={`select${invalid ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{q.loading && !q.data ? 'Loading…' : 'Choose a provider…'}</option>
      {(q.data ?? [])
        .filter((p) => p.id !== exclude)
        .map((p) => (
          <option key={p.id} value={p.id} disabled={!p.isAvailable}>
            {p.name}
            {p.title ? ` · ${p.title}` : ''}
            {p.isAvailable ? '' : ' · unavailable'}
          </option>
        ))}
    </select>
  );
}

/** Slot picker with remaining capacity; falls back to a custom date & time. */
export function SchedulePicker({ order, value, onChange }: { order: Pick<Order, 'fulfilmentType' | 'items' | 'schedule'>; value: { slotId?: string; start?: string } | undefined; onChange: (v: unknown) => void }) {
  const kind = SLOT_KIND[order.fulfilmentType];
  const listing = order.items[0]?.listingId;
  const listingParam = kind === 'DELIVERY' || kind === 'PICKUP' ? '' : `&listingId=${listing}`;
  const to = useMemo(() => new Date(Date.now() + 8 * 86400000).toISOString(), []);
  const q = useApi<Slot[]>(kind ? `/schedule/slots?kind=${kind}${listingParam}&available=true&to=${encodeURIComponent(to)}` : null);
  const [custom, setCustom] = useState(!kind);
  const slots = (q.data ?? []).filter((s) => s.id !== order.schedule.slotId);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = day(s.startsAt);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].slice(0, 5);
  }, [slots]);

  if (custom) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <input
          className="input"
          type="datetime-local"
          aria-label="Date and time"
          value={value?.start ? toLocalInput(value.start) : ''}
          onChange={(e) => onChange(e.target.value ? { start: fromLocalInput(e.target.value) } : {})}
        />
        {kind && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCustom(false)}>
            Choose from available slots
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {q.loading && !q.data && <div className="help">Loading availability…</div>}
      {q.error && <div className="error-text">{q.error.message}</div>}
      {q.data && !slots.length && <div className="help">No open slots in the next 8 days.</div>}
      {byDay.map(([d, xs]) => (
        <div key={d}>
          <div className="label" style={{ marginBottom: 6 }}>{d}</div>
          <div className="row-wrap">
            {xs.slice(0, 12).map((s) => (
              <button
                type="button"
                key={s.id}
                className={`btn btn-sm ${value?.slotId === s.id ? 'btn-primary' : 'btn-neutral'}`}
                onClick={() => onChange({ slotId: s.id })}
                aria-pressed={value?.slotId === s.id}
              >
                {time(s.startsAt)}
                <span className="faint" style={{ fontWeight: 500 }}>· {s.remaining} left</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCustom(true)}>
        Use a custom date & time
      </button>
    </div>
  );
}

/** One-click quick action (e.g. "+5 min" on the prep timer). Only rendered if the backend allows it. */
export function QuickAction({ order, code, input, children, className = 'btn btn-sm btn-neutral' }: { order: Order; code: string; input: Values; children: ReactNode; className?: string }) {
  const a = order.actions.find((x) => x.code === code);
  const runner = useActionRunner(order);
  if (!a) return null;
  return (
    <button type="button" className={className} disabled={!!runner.busy} onClick={() => void runner.execute(a, input)} title={a.label}>
      {runner.busy ? <Spinner /> : children}
    </button>
  );
}

export async function fetchOrder(id: string) {
  return api<Order>(`/orders/${id}`);
}
