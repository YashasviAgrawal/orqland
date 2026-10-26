'use client';
import { useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/shell/Shell';
import { ApiError, newKey, post } from '@/lib/api';
import { refreshAll, useApi } from '@/lib/hooks';
import { ago, FULFILMENT_LABEL, fromLocalInput, money, PAYMENT_METHOD_LABEL } from '@/lib/format';
import type { FulfilmentType, Listing, Order, PaymentMethod } from '@/lib/types';
import { Empty, ErrorBox, Skeleton, Spinner, useToast } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { ActionBar, ActionEnvProvider, SchedulePicker } from '@/components/orders/actions';
import { headline, PaymentPill, Pill } from '@/components/orders/status';

interface Catalog {
  listings: Listing[];
  customers: Array<{ id: string; name: string; phone: string; defaultAddress: string | null }>;
}

const NEEDS_SLOT: FulfilmentType[] = ['SCHEDULED_DELIVERY', 'SCHEDULED_TAKEAWAY', 'AT_PROVIDER_LOCATION', 'AT_CUSTOMER_LOCATION', 'WORKSHOP', 'CONSULTATION'];
const NEEDS_ADDRESS: FulfilmentType[] = ['DELIVERY', 'SCHEDULED_DELIVERY', 'AT_CUSTOMER_LOCATION'];

export default function SimulatorPage() {
  const toast = useToast();
  const cat = useApi<Catalog>('/simulator/catalog');
  const [customerId, setCustomerId] = useState('');
  const [listingId, setListingId] = useState('');
  const [type, setType] = useState<FulfilmentType | ''>('');
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [schedule, setSchedule] = useState<{ slotId?: string; start?: string } | undefined>();
  const [address, setAddress] = useState('');
  const [table, setTable] = useState('');
  const [note, setNote] = useState('');
  const [event, setEvent] = useState({ venue: '', guests: '', occasion: '', requirements: '', date: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const listing = cat.data?.listings.find((l) => l.id === listingId);
  const customer = cat.data?.customers.find((c) => c.id === customerId);
  useEffect(() => {
    if (cat.data && !customerId) setCustomerId(cat.data.customers[0]?.id ?? '');
  }, [cat.data, customerId]);
  useEffect(() => {
    setType(listing?.fulfilmentTypes[0] ?? '');
    setSchedule(undefined);
  }, [listingId, listing]);
  useEffect(() => setAddress(customer?.defaultAddress ?? ''), [customer]);
  useEffect(() => setSchedule(undefined), [type]);

  const orders = useApi<Order[]>(customerId ? `/simulator/orders?customerId=${customerId}` : null, 10000);
  const pseudoOrder = useMemo(
    () => ({ fulfilmentType: (type || 'DELIVERY') as FulfilmentType, items: listingId ? [{ id: 'x', listingId, name: '', quantity: 1, unitPricePaise: 0, totalPaise: 0, tags: [], durationMinutes: 60 }] : [], schedule: { start: null, end: null, slotId: null, slotTitle: null, capacity: null, reserved: null, seats: 1 } }),
    [type, listingId],
  );

  async function place(e: React.FormEvent) {
    e.preventDefault();
    if (!listing || !type) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        customerId,
        fulfilmentType: type,
        items: [{ listingId, quantity: Number(qty) || 1 }],
        paymentMethod: method,
        note: note || undefined,
      };
      if (schedule?.slotId) body.slotId = schedule.slotId;
      if (NEEDS_ADDRESS.includes(type)) body.deliveryAddress = address;
      if (type === 'DINE_IN') body.tableNumber = table;
      if (type === 'EVENT') {
        body.scheduledStart = event.date ? fromLocalInput(event.date) : undefined;
        body.eventDetails = { venue: event.venue, guests: event.guests ? Number(event.guests) : undefined, occasion: event.occasion || undefined, requirements: event.requirements || undefined };
      }
      const r = await post<{ code: string }>('/simulator/orders', body, newKey());
      toast(`${r.code} placed as ${customer?.name}`);
      setNote('');
      setSchedule(undefined);
      refreshAll();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not place the order');
    } finally {
      setBusy(false);
    }
  }

  async function pay(o: Order, outcome: 'SUCCEEDED' | 'FAILED') {
    try {
      await post(`/simulator/orders/${o.id}/payment`, { outcome });
      toast(outcome === 'SUCCEEDED' ? `Payment confirmed for ${o.code}` : `Payment failed for ${o.code}`);
      refreshAll();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Payment simulation failed', true);
    }
  }

  return (
    <AdminShell title="Customer simulator">
      <div className="callout callout-blue">
        <Icon name="flask" size={16} />
        <div>
          The customer-facing app is outside this module’s scope. Use this page to act as a customer — place orders and bookings of every fulfilment type, ask to cancel, reschedule or return, and simulate payment results — then handle them from the admin, agent and provider views.
        </div>
      </div>
      {cat.error && <ErrorBox message={cat.error.message} onRetry={cat.reload} />}
      <div className="two-col" style={{ alignItems: 'start' }}>
        <form className="box stack" onSubmit={place} style={{ gap: 14 }}>
          <h2 className="h2">Place an order or booking</h2>
          {!cat.data && <Skeleton h={300} />}
          {cat.data && (
            <>
              <div className="field">
                <label htmlFor="cust">Customer</label>
                <select id="cust" className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  {cat.data.customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="lst">Listing<span className="req">*</span></label>
                <select id="lst" className="select" value={listingId} onChange={(e) => setListingId(e.target.value)}>
                  <option value="">Choose a product or service…</option>
                  <optgroup label="Products">
                    {cat.data.listings.filter((l) => l.kind === 'PRODUCT').map((l) => <option key={l.id} value={l.id}>{l.name} · {money(l.pricePaise)}{l.stock != null ? ` · ${l.stock} in stock` : ''}</option>)}
                  </optgroup>
                  <optgroup label="Services">
                    {cat.data.listings.filter((l) => l.kind === 'SERVICE').map((l) => <option key={l.id} value={l.id}>{l.name} · {money(l.pricePaise)}{l.autoConfirm ? ' · instant confirmation' : ''}</option>)}
                  </optgroup>
                </select>
              </div>
              {listing && (
                <div className="two-col" style={{ gap: 10 }}>
                  <div className="field">
                    <label htmlFor="typ">Fulfilment</label>
                    <select id="typ" className="select" value={type} onChange={(e) => setType(e.target.value as FulfilmentType)}>
                      {listing.fulfilmentTypes.map((t) => <option key={t} value={t}>{FULFILMENT_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="qty">{type === 'WORKSHOP' ? 'Seats' : 'Quantity'}</label>
                    <input id="qty" className="input num" type="number" min={1} max={listing.kind === 'SERVICE' && type !== 'WORKSHOP' ? 1 : 20} value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                </div>
              )}
              {listing && type && NEEDS_SLOT.includes(type) && (
                <div className="field">
                  <label>Slot<span className="req">*</span></label>
                  <SchedulePicker order={pseudoOrder} value={schedule} onChange={(v) => setSchedule(v as { slotId?: string })} />
                </div>
              )}
              {listing && type === 'ONLINE' && <div className="help">This listing books instantly — the session starts now.</div>}
              {type && NEEDS_ADDRESS.includes(type) && (
                <div className="field">
                  <label htmlFor="adr">Address<span className="req">*</span></label>
                  <input id="adr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              )}
              {type === 'DINE_IN' && (
                <div className="field">
                  <label htmlFor="tbl">Table</label>
                  <input id="tbl" className="input" value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. T3" />
                </div>
              )}
              {type === 'EVENT' && (
                <>
                  <div className="field"><label htmlFor="ev-v">Venue<span className="req">*</span></label><input id="ev-v" className="input" value={event.venue} onChange={(e) => setEvent({ ...event, venue: e.target.value })} /></div>
                  <div className="two-col" style={{ gap: 10 }}>
                    <div className="field"><label htmlFor="ev-d">Event date & time<span className="req">*</span></label><input id="ev-d" className="input" type="datetime-local" value={event.date} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></div>
                    <div className="field"><label htmlFor="ev-g">Guests</label><input id="ev-g" className="input num" type="number" value={event.guests} onChange={(e) => setEvent({ ...event, guests: e.target.value })} /></div>
                  </div>
                  <div className="field"><label htmlFor="ev-o">Occasion</label><input id="ev-o" className="input" value={event.occasion} onChange={(e) => setEvent({ ...event, occasion: e.target.value })} /></div>
                  <div className="field"><label htmlFor="ev-r">Requirements</label><textarea id="ev-r" className="textarea" value={event.requirements} onChange={(e) => setEvent({ ...event, requirements: e.target.value })} /></div>
                </>
              )}
              {listing && (
                <>
                  <div className="field">
                    <label htmlFor="pm">Payment</label>
                    <select id="pm" className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                      {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="nt">Note to the business</label>
                    <input id="nt" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                  </div>
                </>
              )}
              {err && <div className="error-text" role="alert">{err}</div>}
              <button className="btn btn-primary btn-lg" disabled={busy || !listing || !type}>
                {busy && <Spinner />}Place as {customer?.name.split(' ')[0] ?? 'customer'}
              </button>
            </>
          )}
        </form>

        <section className="stack" aria-label="Customer orders">
          <h2 className="h2">{customer ? `${customer.name}’s orders` : 'Orders'}</h2>
          {orders.error && <ErrorBox message={orders.error.message} onRetry={orders.reload} />}
          {!orders.data && !orders.error && <Skeleton h={200} r={18} />}
          {orders.data && !orders.data.length && <Empty title="No orders yet">Place one on the left.</Empty>}
          <ActionEnvProvider value={{ endpoint: (id) => `/simulator/orders/${id}/actions` }}>
            {orders.data?.map((o) => {
              const h = headline(o);
              const online = o.paymentMethod !== 'CASH' && o.status.payment === 'PENDING';
              return (
                <article key={o.id} className="box stack" style={{ gap: 10 }}>
                  <div className="spread">
                    <div>
                      <b>{o.code}</b> · {o.items.map((i) => i.name).join(', ')}
                      <div className="muted" style={{ fontSize: 12.5 }}>{o.fulfilmentLabel} · {ago(o.createdAt)} · {money(o.amounts.totalPaise)}</div>
                    </div>
                    <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                      <Pill tone={h.tone} dot>{h.text}</Pill>
                      <PaymentPill o={o} />
                    </div>
                  </div>
                  {o.clarificationNote && o.status.order === 'CLARIFICATION_REQUESTED' && (
                    <div className="callout callout-amber"><Icon name="info" size={15} /><div><b>The business asks:</b> {o.clarificationNote}</div></div>
                  )}
                  <div className="row-wrap">
                    {online && (
                      <>
                        <button className="btn btn-sm btn-success" onClick={() => pay(o, 'SUCCEEDED')}>Simulate payment success</button>
                        <button className="btn btn-sm btn-danger" onClick={() => pay(o, 'FAILED')}>Simulate payment failure</button>
                      </>
                    )}
                  </div>
                  <ActionBar order={o} variant="full" />
                </article>
              );
            })}
          </ActionEnvProvider>
        </section>
      </div>
    </AdminShell>
  );
}
