import type { FulfilmentType, PaymentMethod } from './types';

const TZ = 'Asia/Kolkata';

export function money(paise: number | null | undefined, opts: { compact?: boolean } = {}): string {
  const v = (paise ?? 0) / 100;
  if (opts.compact && Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function moneyExact(paise: number | null | undefined): string {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayDiff(d: Date): number {
  const fmt = (x: Date) => new Date(x.toLocaleString('en-US', { timeZone: TZ })).setHours(0, 0, 0, 0);
  return Math.round((fmt(d) - fmt(new Date())) / 86400000);
}

export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = dayDiff(d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${day(iso)}, ${time(iso)}`;
}

export function timeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return 'Not scheduled';
  return end ? `${day(start)}, ${time(start)} – ${time(end)}` : dateTime(start);
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function countdown(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${neg ? '−' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash / COD',
  UPI: 'UPI',
  CARD: 'Card',
  NET_BANKING: 'Net banking',
  WALLET: 'Wallet',
};

export function paymentLabel(method: PaymentMethod, status: string): string {
  const m = PAYMENT_METHOD_LABEL[method] ?? method;
  if (status === 'PAID') return `${m} · Paid`;
  if (status === 'FAILED') return `${m} · Failed`;
  return method === 'CASH' ? `${m} · To collect` : `${m} · Pending`;
}

export const FULFILMENT_LABEL: Record<FulfilmentType, string> = {
  DELIVERY: 'Delivery to Customer',
  SCHEDULED_DELIVERY: 'Scheduled Delivery',
  TAKEAWAY: 'Take Away',
  SCHEDULED_TAKEAWAY: 'Scheduled Take Away',
  DINE_IN: 'Dine In',
  AT_PROVIDER_LOCATION: 'At Our Location',
  AT_CUSTOMER_LOCATION: "At Customer's Location",
  EVENT: 'Event Service',
  WORKSHOP: 'Workshop',
  CONSULTATION: 'Visit / Consulting',
  ONLINE: 'Online',
};

export const PRODUCT_TYPES: FulfilmentType[] = ['DELIVERY', 'SCHEDULED_DELIVERY', 'TAKEAWAY', 'SCHEDULED_TAKEAWAY', 'DINE_IN'];
export const SERVICE_TYPES: FulfilmentType[] = ['AT_PROVIDER_LOCATION', 'AT_CUSTOMER_LOCATION', 'EVENT', 'WORKSHOP', 'CONSULTATION', 'ONLINE'];

/** Which availability slots a fulfilment type books against. */
export const SLOT_KIND: Partial<Record<FulfilmentType, string>> = {
  DELIVERY: 'DELIVERY',
  SCHEDULED_DELIVERY: 'DELIVERY',
  SCHEDULED_TAKEAWAY: 'PICKUP',
  AT_PROVIDER_LOCATION: 'SERVICE',
  AT_CUSTOMER_LOCATION: 'SERVICE',
  CONSULTATION: 'SERVICE',
  ONLINE: 'SERVICE',
  WORKSHOP: 'WORKSHOP_SESSION',
};

export const SLOT_KIND_LABEL: Record<string, string> = {
  DELIVERY: 'Delivery windows',
  PICKUP: 'Pickup windows',
  SERVICE: 'Service slots',
  WORKSHOP_SESSION: 'Workshop sessions',
};

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function mapsSearch(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
export function mapsDirections(dest: string, origin?: string): string {
  return `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}&destination=${encodeURIComponent(dest)}`;
}

/** Local value for <input type="datetime-local"> in IST. */
export function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600000);
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string {
  // datetime-local is entered in IST
  return new Date(`${v}:00+05:30`).toISOString();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
