'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/shell/Shell';
import { ApiError, patch, post } from '@/lib/api';
import { refreshAll, useApi } from '@/lib/hooks';
import { day, fromLocalInput, SLOT_KIND_LABEL, time } from '@/lib/format';
import type { Listing, Slot, SlotDetail, Staff } from '@/lib/types';
import { Dialog, Drawer, Empty, ErrorBox, Skeleton, Spinner, useToast } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/orders/status';

const TZ = 'Asia/Kolkata';
function istDate(offset: number): string {
  const d = new Date(Date.now() + 330 * 60000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}
function startOf(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+05:30`).toISOString();
}
function endOf(dateStr: string): string {
  return new Date(new Date(`${dateStr}T00:00:00+05:30`).getTime() + 86400000).toISOString();
}

export default function SchedulePage() {
  const toast = useToast();
  const [date, setDate] = useState(istDate(0));
  const [kind, setKind] = useState('');
  const [listing, setListing] = useState('');
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [adding, setAdding] = useState(false);

  // deep links from orders: ?listing=…&date=…&slot=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('listing')) setListing(p.get('listing')!);
    if (p.get('date')) setDate(p.get('date')!);
    if (p.get('slot')) setOpenSlot(p.get('slot'));
  }, []);

  const listings = useApi<Listing[]>('/schedule/listings');
  const qs = new URLSearchParams({ from: startOf(date), to: endOf(date) });
  if (kind) qs.set('kind', kind);
  if (listing) qs.set('listingId', listing);
  const slots = useApi<Slot[]>(`/schedule/slots?${qs.toString()}`, 20000);

  const days = useMemo(() => Array.from({ length: 8 }, (_, i) => istDate(i)), []);
  const groups = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) {
      const k = s.listingName ?? SLOT_KIND_LABEL[s.kind];
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [slots.data]);
  const serviceListings = (listings.data ?? []).filter((l) => l.kind === 'SERVICE');

  async function toggle(s: Slot) {
    try {
      await patch(`/schedule/slots/${s.id}`, { status: s.status === 'OPEN' ? 'CLOSED' : 'OPEN' });
      toast(s.status === 'OPEN' ? 'Slot closed for new bookings' : 'Slot reopened');
      refreshAll();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the slot', true);
    }
  }

  return (
    <AdminShell
      title="Availability & capacity"
      actions={
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Add slot
        </button>
      }
    >
      <div className="day-strip" role="tablist" aria-label="Day">
        {days.map((d) => {
          const dt = new Date(`${d}T12:00:00+05:30`);
          return (
            <button key={d} role="tab" aria-selected={date === d} className={`day-btn${date === d ? ' on' : ''}`} onClick={() => setDate(d)}>
              <small>{d === days[0] ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ })}</small>
              <b>{dt.toLocaleDateString('en-IN', { day: 'numeric', timeZone: TZ })}</b>
            </button>
          );
        })}
      </div>
      <div className="filterbar compact">
        <div className="seg" role="group" aria-label="Slot type">
          {([['', 'Everything'], ['DELIVERY', 'Delivery'], ['PICKUP', 'Pickup'], ['SERVICE', 'Services'], ['WORKSHOP_SESSION', 'Workshops']] as const).map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>
              {l}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 240, maxWidth: '100%' }} value={listing} onChange={(e) => setListing(e.target.value)} aria-label="Service">
          <option value="">All listings</option>
          {(listings.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {slots.error && !slots.data && <ErrorBox message={slots.error.message} onRetry={slots.reload} />}
      {!slots.data && !slots.error && <Skeleton h={300} r={18} />}
      {slots.data && slots.data.length === 0 && (
        <Empty icon="calendar" title="No slots on this day">
          Add a slot to open bookings, or pick another day.
        </Empty>
      )}
      {groups.map(([name, xs]) => {
        const booked = xs.reduce((n, s) => n + s.reserved, 0);
        const cap = xs.reduce((n, s) => n + s.capacity, 0);
        return (
          <section key={name} className="table-wrap" aria-label={name}>
            <div className="spread" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <h2 className="h3">{name}</h2>
              <span className="muted num">
                {booked}/{cap} booked
              </span>
            </div>
            {xs.map((s) => {
              const pct = s.capacity ? Math.round((s.reserved / s.capacity) * 100) : 0;
              return (
                <div key={s.id} className="slot-row">
                  <div>
                    <b className="num">{time(s.startsAt)}</b>
                    <div className="faint num" style={{ fontSize: 12 }}>until {time(s.endsAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.title ?? s.providerName ?? SLOT_KIND_LABEL[s.kind]}</div>
                    <div className="row-wrap" style={{ marginTop: 4 }}>
                      {s.status === 'CLOSED' && <Pill tone="red">Closed</Pill>}
                      {s.status === 'COMPLETED' && <Pill tone="green">Completed</Pill>}
                      {s.isPast && s.status === 'OPEN' && <Pill>{new Date(s.endsAt).getTime() <= Date.now() ? 'Ended' : 'In progress'}</Pill>}
                      {s.remaining === 0 && s.status === 'OPEN' && <Pill tone="amber">Full</Pill>}
                      {s.providerName && s.title && <span className="muted" style={{ fontSize: 12.5 }}>{s.providerName}</span>}
                    </div>
                  </div>
                  <div className="meter-col">
                    <div className="spread" style={{ fontSize: 12.5, marginBottom: 4 }}>
                      <span className="num">
                        <b>{s.reserved}</b>/{s.capacity} {s.kind === 'WORKSHOP_SESSION' ? 'seats' : 'booked'}
                      </span>
                      <span className="muted">{s.remaining} left</span>
                    </div>
                    <div className={`meter${pct >= 100 ? ' full' : pct >= 75 ? ' high' : ''}`} role="meter" aria-valuenow={s.reserved} aria-valuemax={s.capacity} aria-label="Capacity used">
                      <i style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                  <div className="row slot-actions" style={{ justifyContent: 'flex-end' }}>
                    {s.bookings > 0 && (
                      <button className="btn btn-sm btn-neutral" onClick={() => setOpenSlot(s.id)}>
                        {s.bookings} {s.bookings === 1 ? 'booking' : 'bookings'}
                      </button>
                    )}
                    {s.kind === 'WORKSHOP_SESSION' && s.isPast && s.status === 'OPEN' && s.bookings > 0 && (
                      <button className="btn btn-sm btn-primary" onClick={() => setOpenSlot(s.id)}>
                        Complete session
                      </button>
                    )}
                    {s.status !== 'COMPLETED' && new Date(s.endsAt).getTime() > Date.now() && (
                      <>
                        <button className="btn btn-sm btn-neutral" onClick={() => setEditing(s)}>
                          Capacity
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => toggle(s)}>
                          {s.status === 'OPEN' ? 'Close' : 'Reopen'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {editing && <CapacityDialog slot={editing} onClose={() => setEditing(null)} />}
      {adding && <AddSlotDialog listings={serviceListings} date={date} onClose={() => setAdding(false)} />}
      {openSlot && <SlotDrawer id={openSlot} onClose={() => setOpenSlot(null)} />}
    </AdminShell>
  );
}

function CapacityDialog({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const toast = useToast();
  const [cap, setCap] = useState(String(slot.capacity));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(cap);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await patch(`/schedule/slots/${slot.id}`, { capacity: n, reason: reason || undefined });
      toast('Capacity updated');
      refreshAll();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Manage capacity"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-neutral" onClick={onClose}>Keep as is</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !Number.isInteger(n) || n < 1}>
            {busy && <Spinner />}Save capacity
          </button>
        </>
      }
    >
      <div className="stack" style={{ marginTop: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {slot.listingName ?? SLOT_KIND_LABEL[slot.kind]} · {time(slot.startsAt)}–{time(slot.endsAt)} · {slot.reserved} already booked
        </p>
        <div className="field">
          <label htmlFor="cap">Capacity</label>
          <input id="cap" className="input num" type="number" min={Math.max(slot.reserved, 1)} max={500} value={cap} onChange={(e) => setCap(e.target.value)} />
          <div className="help">Can’t be lower than the {slot.reserved} place(s) already booked.</div>
        </div>
        <div className="field">
          <label htmlFor="cap-r">Reason (optional)</label>
          <input id="cap-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. extra stylist on shift" />
        </div>
        {err && <div className="error-text">{err}</div>}
      </div>
    </Dialog>
  );
}

function AddSlotDialog({ listings, date, onClose }: { listings: Listing[]; date: string; onClose: () => void }) {
  const toast = useToast();
  const providers = useApi<Staff[]>('/schedule/providers');
  const [kind, setKind] = useState<'DELIVERY' | 'PICKUP' | 'SERVICE' | 'WORKSHOP_SESSION'>('SERVICE');
  const [listingId, setListingId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [start, setStart] = useState(`${date}T10:00`);
  const [end, setEnd] = useState(`${date}T11:00`);
  const [cap, setCap] = useState('1');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsListing = kind === 'SERVICE' || kind === 'WORKSHOP_SESSION';
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await post('/schedule/slots', {
        kind,
        listingId: needsListing ? listingId || undefined : undefined,
        providerId: providerId || undefined,
        startsAt: fromLocalInput(start),
        endsAt: fromLocalInput(end),
        capacity: Number(cap),
        title: title || undefined,
      });
      toast('Slot added');
      refreshAll();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not add the slot');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Add availability"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-neutral" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (needsListing && !listingId)}>
            {busy && <Spinner />}Add slot
          </button>
        </>
      }
    >
      <div className="stack" style={{ marginTop: 8 }}>
        <div className="field">
          <label htmlFor="k">Type</label>
          <select id="k" className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="SERVICE">Service slot</option>
            <option value="WORKSHOP_SESSION">Workshop session</option>
            <option value="DELIVERY">Delivery window</option>
            <option value="PICKUP">Pickup window</option>
          </select>
        </div>
        {needsListing && (
          <div className="field">
            <label htmlFor="l">Service<span className="req">*</span></label>
            <select id="l" className="select" value={listingId} onChange={(e) => setListingId(e.target.value)}>
              <option value="">Choose…</option>
              {listings
                .filter((l) => (kind === 'WORKSHOP_SESSION' ? l.fulfilmentTypes.includes('WORKSHOP') : !l.fulfilmentTypes.includes('WORKSHOP')))
                .map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
            </select>
          </div>
        )}
        {needsListing && (
          <div className="field">
            <label htmlFor="p">Provider</label>
            <select id="p" className="select" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Listing default</option>
              {(providers.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="two-col" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="s">Starts</label>
            <input id="s" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e">Ends</label>
            <input id="e" className="input" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="two-col" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="c">{kind === 'WORKSHOP_SESSION' ? 'Seats' : 'Capacity'}</label>
            <input id="c" className="input num" type="number" min={1} max={500} value={cap} onChange={(e) => setCap(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="t">Title (optional)</label>
            <input id="t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        {err && <div className="error-text">{err}</div>}
      </div>
    </Dialog>
  );
}

function SlotDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const q = useApi<SlotDetail>(`/schedule/slots/${id}`);
  const [busy, setBusy] = useState(false);
  const s = q.data;
  async function complete() {
    setBusy(true);
    try {
      const r = await post<{ completed: number; noShows: number }>(`/schedule/slots/${id}/complete`, {});
      toast(`Session completed — ${r.completed} attended, ${r.noShows} no-show`);
      refreshAll();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not complete the session', true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer onClose={onClose} title={<b>{s ? s.listingName ?? SLOT_KIND_LABEL[s.kind] : 'Slot'}</b>}>
      {q.error && <ErrorBox message={q.error.message} onRetry={q.reload} />}
      {!s && !q.error && <Skeleton h={200} r={18} />}
      {s && (
        <div className="stack">
          <div className="box">
            <div className="tiles">
              <div className="tile"><div className="k">Time</div><div className="v">{day(s.startsAt)}, {time(s.startsAt)} – {time(s.endsAt)}</div></div>
              <div className="tile"><div className="k">Booked</div><div className="v num">{s.reserved}/{s.capacity}</div></div>
              <div className="tile"><div className="k">Provider</div><div className="v">{s.providerName ?? '—'}</div></div>
              <div className="tile"><div className="k">Status</div><div className="v">{s.status === 'OPEN' ? (s.isPast ? 'Started' : 'Open') : s.status === 'CLOSED' ? 'Closed' : 'Completed'}</div></div>
            </div>
            {s.kind === 'WORKSHOP_SESSION' && s.isPast && s.status !== 'COMPLETED' && (
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <div className="callout callout-blue"><Icon name="info" size={15} />Completing the session completes checked-in attendees and marks anyone not checked in as a no-show.</div>
                <button className="btn btn-primary" onClick={complete} disabled={busy}>
                  {busy && <Spinner />}Mark session completed
                </button>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Booking</th><th>Customer</th><th>Seats</th><th>Status</th></tr>
              </thead>
              <tbody>
                {s.attendees.map((a) => (
                  <tr key={a.orderId}>
                    <td><Link href={`/admin/orders/${a.orderId}`}><b>{a.code}</b></Link></td>
                    <td>{a.customerName}<div className="faint num" style={{ fontSize: 12 }}>{a.customerPhone}</div></td>
                    <td className="num">{a.seats}</td>
                    <td><Pill tone={a.orderStatus === 'COMPLETED' ? 'green' : a.orderStatus === 'CANCELLED' || a.orderStatus === 'REJECTED' ? 'red' : 'violet'}>{a.fulfilmentStatus.replace(/_/g, ' ').toLowerCase()}</Pill></td>
                  </tr>
                ))}
                {!s.attendees.length && (
                  <tr><td colSpan={4} className="muted">No bookings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}
