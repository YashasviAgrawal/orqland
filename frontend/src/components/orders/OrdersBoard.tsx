'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { post } from '@/lib/api';
import { refreshAll, useApi, useDebounced } from '@/lib/hooks';
import { ago, day, FULFILMENT_LABEL, money, PRODUCT_TYPES, SERVICE_TYPES, time } from '@/lib/format';
import type { FulfilmentType, Order, Paged, Summary, ViewKey } from '@/lib/types';
import { Icon } from '@/components/ui/Icon';
import { Parcels3D } from '@/components/ui/Parcels3D';
import { CardSkeletons, Dialog, Drawer, Empty, ErrorBox, Spinner, useToast } from '@/components/ui/primitives';
import { ActionBar, ActionEnvProvider } from './actions';
import { OrderCard } from './OrderCard';
import { OrderDetailLoader } from './OrderDetail';
import { headline, PaymentPill, Pill } from './status';

const CARDS: Array<{ key: ViewKey; label: string; color: string }> = [
  { key: 'new', label: 'New', color: 'var(--blue)' },
  { key: 'confirmed', label: 'Confirmed', color: 'var(--violet)' },
  { key: 'in_progress', label: 'In progress', color: 'var(--amber)' },
  { key: 'completed', label: 'Completed', color: 'var(--green)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--faint)' },
  { key: 'exceptions', label: 'Exceptions', color: 'var(--red)' },
];
const TABS: Array<{ key: ViewKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'processing', label: 'Processing' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'exceptions', label: 'Exceptions' },
];
const VIEW_TITLE: Record<ViewKey, string> = {
  all: 'All orders & bookings',
  new: 'New — waiting for review',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled & rejected',
  exceptions: 'Needs attention',
  processing: 'Processing',
  ongoing: 'Ongoing',
  upcoming: 'Upcoming',
};
const VIEW_EMPTY: Record<ViewKey, string> = {
  all: 'Orders and bookings will appear here as customers place them.',
  new: 'Nothing to review. New orders and bookings will appear here.',
  confirmed: 'Nothing confirmed and waiting to start.',
  in_progress: 'Nothing is being prepared, delivered or served right now.',
  completed: 'Completed orders will appear here.',
  cancelled: 'No cancelled or rejected orders.',
  exceptions: 'No failed deliveries, payment issues or open requests.',
  processing: 'Nothing is being prepared.',
  ongoing: 'Nothing is out for delivery or in service.',
  upcoming: 'No scheduled deliveries, pickups or bookings.',
};

export function OrdersBoard() {
  const toast = useToast();
  const [view, setView] = useState<ViewKey>('all');
  const [kind, setKind] = useState<'' | 'PRODUCT' | 'SERVICE'>('');
  const [type, setType] = useState<'' | FulfilmentType>('');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [dateField, setDateField] = useState<'created' | 'scheduled'>('created');
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const [pageSize, setPageSize] = useState(24);
  const [open, setOpen] = useState<{ id: string; focus?: string } | null>(null);
  const [acceptAll, setAcceptAll] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const q = useDebounced(search, 300);

  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    if (type) p.set('fulfilmentType', type);
    if (q.trim()) p.set('q', q.trim());
    if (date) {
      p.set('dateFrom', date);
      p.set('dateTo', date);
      p.set('dateField', dateField);
    }
    return p.toString();
  }, [kind, type, q, date, dateField]);

  const summary = useApi<Summary>(`/orders/summary?${filterQs}`, 15000);
  const list = useApi<Paged<Order>>(`/orders?view=${view}&pageSize=${pageSize}&${filterQs}`, 15000);
  const showLane = view === 'all' && !q && (summary.data?.counts.new ?? 0) > 0;
  const lane = useApi<Paged<Order>>(showLane ? `/orders?view=new&pageSize=20&${filterQs}` : null, 15000);

  const counts = summary.data?.counts;
  const typeOptions = kind === 'PRODUCT' ? PRODUCT_TYPES : kind === 'SERVICE' ? SERVICE_TYPES : [...PRODUCT_TYPES, ...SERVICE_TYPES];
  const filtersOn = !!(kind || type || q || date);
  const listItems = (list.data?.items ?? []).filter((o) => !(showLane && o.status.order === 'PENDING_REVIEW'));
  const reviewable = (lane.data?.items ?? []).filter((o) => o.status.order === 'PENDING_REVIEW');

  async function doAcceptAll() {
    setBulkBusy(true);
    try {
      const r = await post<{ accepted: number; results: Array<{ ok: boolean; error?: string }> }>('/orders/bulk-accept', { orderIds: reviewable.map((o) => o.id), startPreparation: true });
      const failed = r.results.filter((x) => !x.ok).length;
      toast(failed ? `Accepted ${r.accepted}. ${failed} could not be accepted — open them to see why.` : `Accepted ${r.accepted} ${r.accepted === 1 ? 'order' : 'orders'}`, failed > 0);
      setAcceptAll(false);
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not accept all', true);
    } finally {
      setBulkBusy(false);
    }
  }

  const env = {
    onLink: (code: string, o: Order) => {
      if (code === 'TRACK_DELIVERY') setOpen({ id: o.id, focus: 'delivery' });
      else if (code === 'VIEW_PAYMENT_DETAILS') setOpen({ id: o.id, focus: 'payment' });
    },
  };

  return (
    <ActionEnvProvider value={env}>
      {/* summary */}
      <section className="summary" aria-label="Summary">
        <div className="revenue-card">
          <div className="sub">Revenue today (paid)</div>
          <div className="big num">{summary.data ? money(summary.data.revenue.todayPaise) : '—'}</div>
          <div className="row-wrap">
            {summary.data?.revenue.changePct != null && (
              <span className="delta">
                <Icon name={summary.data.revenue.changePct >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
                {Math.abs(summary.data.revenue.changePct)}% vs yesterday
              </span>
            )}
            {summary.data && summary.data.cod.outstandingPaise > 0 && (
              <Link href="/admin/settlements" className="delta">
                <Icon name="cash" size={13} /> {money(summary.data.cod.outstandingPaise)} cash with agents
              </Link>
            )}
          </div>
          <Parcels3D className="hero-art" />
        </div>
        <div className="stat-tiles">
          {CARDS.map((c) => (
            <button key={c.key} className={`stat${view === c.key ? ' active' : ''}`} onClick={() => setView(view === c.key ? 'all' : c.key)} aria-pressed={view === c.key}>
              <span className="t">
                <i style={{ background: c.color }} />
                {c.label}
              </span>
              <span className="n num" style={c.key === 'exceptions' && (counts?.exceptions ?? 0) > 0 ? { color: 'var(--red-ink)' } : undefined}>
                {counts ? counts[c.key] : '–'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* filters */}
      <section className="stack" style={{ gap: 12 }}>
        <div className="filterbar compact">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" type="search" placeholder="Search order ID, customer, phone or item" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
          </div>
          <div className="seg" role="group" aria-label="Products or services">
            {([['', 'All'], ['PRODUCT', 'Products'], ['SERVICE', 'Services']] as const).map(([k, l]) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setType(''); }} aria-pressed={kind === k}>
                {l}
              </button>
            ))}
          </div>
          <select className="select" style={{ width: 210, maxWidth: '100%' }} value={type} onChange={(e) => setType(e.target.value as FulfilmentType | '')} aria-label="Fulfilment type">
            <option value="">All fulfilment types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {FULFILMENT_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 140 }} value={dateField} onChange={(e) => setDateField(e.target.value as 'created' | 'scheduled')} aria-label="Date type">
            <option value="created">Placed on</option>
            <option value="scheduled">Scheduled for</option>
          </select>
          <input className="input" type="date" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          {filtersOn && (
            <button className="btn btn-ghost" onClick={() => { setKind(''); setType(''); setSearch(''); setDate(''); }}>
              Clear filters
            </button>
          )}
          <div className="seg" role="group" aria-label="Layout" style={{ marginLeft: 'auto' }}>
            <button className={layout === 'cards' ? 'on' : ''} onClick={() => setLayout('cards')} aria-pressed={layout === 'cards'}>
              Cards
            </button>
            <button className={layout === 'table' ? 'on' : ''} onClick={() => setLayout('table')} aria-pressed={layout === 'table'}>
              Table
            </button>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Order stage">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={view === t.key} className={`tab${view === t.key ? ' active' : ''}`} onClick={() => setView(t.key)}>
              {t.label}
              {counts && <span className="n">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
      </section>

      {/* new entries lane (Figma) */}
      {showLane && reviewable.length > 0 && (
        <section className="panel" aria-label="New entries">
          <div className="panel-head">
            <h2 className="h2">New entries</h2>
            <span className="count-badge red">{counts?.new}</span>
            <span className="grow" />
            <button className="btn btn-sm btn-ghost" onClick={() => refreshAll()} aria-label="Refresh">
              <Icon name="refresh" size={15} />
            </button>
            <button className="btn btn-sm btn-blue" onClick={() => setAcceptAll(true)}>
              Accept all
            </button>
          </div>
          <div className="lane">
            {reviewable.map((o) => (
              <OrderCard key={o.id} o={o} variant="new" onOpen={(x) => setOpen({ id: x.id })} />
            ))}
          </div>
        </section>
      )}

      {/* main list */}
      <section className="panel" aria-label={VIEW_TITLE[view]}>
        <div className="panel-head">
          <h2 className="h2">{showLane ? 'Everything else' : VIEW_TITLE[view]}</h2>
          {list.data && <span className="count-badge">{showLane ? Math.max(list.data.total - (counts?.new ?? 0), 0) : list.data.total}</span>}
          {list.loading && list.data && <Spinner />}
        </div>
        {list.error && !list.data && <ErrorBox message={list.error.message} onRetry={list.reload} />}
        {!list.data && !list.error && <CardSkeletons n={4} />}
        {list.data && listItems.length === 0 && (
          <Empty icon={view === 'exceptions' ? 'check' : 'orders'} title={filtersOn ? 'No matches' : 'All clear'}>
            {filtersOn ? 'Try a different search or clear the filters.' : VIEW_EMPTY[view]}
          </Empty>
        )}
        {list.data && listItems.length > 0 && layout === 'cards' && (
          <div className="cards">
            {listItems.map((o) => (
              <OrderCard key={o.id} o={o} onOpen={(x) => setOpen({ id: x.id })} />
            ))}
          </div>
        )}
        {list.data && listItems.length > 0 && layout === 'table' && <OrdersTable items={listItems} onOpen={(o) => setOpen({ id: o.id })} />}
        {list.data && list.data.total > list.data.items.length && (
          <button className="btn btn-neutral" style={{ alignSelf: 'center' }} onClick={() => setPageSize((n) => Math.min(n + 24, 100))} disabled={pageSize >= 100}>
            {pageSize >= 100 ? 'Use filters to narrow down' : `Show more (${list.data.total - list.data.items.length} left)`}
          </button>
        )}
      </section>

      {open && (
        <Drawer
          onClose={() => setOpen(null)}
          title={<b>Order details</b>}
          actions={
            <Link className="btn btn-sm btn-neutral" href={`/admin/orders/${open.id}`}>
              Open full page
            </Link>
          }
        >
          <OrderDetailLoader id={open.id} focus={open.focus} />
        </Drawer>
      )}

      {acceptAll && (
        <Dialog
          title={`Accept ${reviewable.length} new ${reviewable.length === 1 ? 'entry' : 'entries'}?`}
          onClose={() => setAcceptAll(false)}
          footer={
            <>
              <button className="btn btn-neutral" onClick={() => setAcceptAll(false)}>
                Keep as is
              </button>
              <button className="btn btn-primary" onClick={doAcceptAll} disabled={bulkBusy}>
                {bulkBusy && <Spinner />}Accept all
              </button>
            </>
          }
        >
          <p className="muted">Instant product orders will move straight into preparation. Scheduled orders and bookings will be confirmed for their booked time. Each order is checked individually, so anything that can’t be accepted stays in the list.</p>
        </Dialog>
      )}
    </ActionEnvProvider>
  );
}

export function OrdersTable({ items, onOpen }: { items: Order[]; onOpen: (o: Order) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Item / service</th>
            <th>Fulfilment</th>
            <th>When</th>
            <th className="r">Amount</th>
            <th>Payment</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((o) => {
            const h = headline(o);
            const lean = { ...o, actions: o.actions.filter((a) => a.kind === 'mutation' && (a.tone === 'primary' || a.tone === 'success')).slice(0, 1) };
            return (
              <tr key={o.id} className="clickable" onClick={() => onOpen(o)}>
                <td>
                  <b>{o.code}</b>
                  <div className="faint" style={{ fontSize: 12 }}>{ago(o.createdAt)}</div>
                </td>
                <td>
                  {o.customer.name}
                  <div className="faint num" style={{ fontSize: 12 }}>{o.customer.phone}</div>
                </td>
                <td style={{ maxWidth: 220 }}>
                  <div className="ellipsis">{o.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')}</div>
                </td>
                <td>{o.fulfilmentLabel}</td>
                <td className="num">{o.schedule.start ? `${day(o.schedule.start)}, ${time(o.schedule.start)}` : '—'}</td>
                <td className="r num">
                  <b>{money(o.amounts.totalPaise)}</b>
                </td>
                <td>
                  <PaymentPill o={o} />
                </td>
                <td>
                  <Pill tone={h.tone} dot>
                    {h.text}
                  </Pill>
                </td>
                <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 150 }}>
                  {lean.actions.length > 0 && <ActionBar order={lean} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
