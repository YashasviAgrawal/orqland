'use client';
import { useState } from 'react';
import { ApiError, patch, post } from '@/lib/api';
import { refreshAll, useApi, useNow } from '@/lib/hooks';
import { ago, countdown, dateTime, mapsSearch, moneyExact } from '@/lib/format';
import type { AgentCash, Order } from '@/lib/types';
import { FullPageLoader, useGate } from '@/components/shell/Shell';
import { MobileShell } from '@/components/shell/MobileShell';
import { Dialog, Empty, ErrorBox, Skeleton, Spinner, useToast } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { ActionBar } from '@/components/orders/actions';
import { headline, Pill } from '@/components/orders/status';

interface AgentSummary {
  offers: number;
  active: number;
  deliveredToday: number;
  isAvailable: boolean;
  cashInHandPaise: number;
}

function OfferTimer({ at }: { at: string }) {
  const now = useNow(1000);
  const left = new Date(at).getTime() - now;
  return (
    <Pill tone={left < 30000 ? 'red' : 'amber'}>
      <Icon name="timer" size={13} />
      {left > 0 ? <span className="expiry">{countdown(left)}</span> : 'Expired'}
    </Pill>
  );
}

function DeliveryCard({ o, ws }: { o: Order; ws: string }) {
  const h = headline(o);
  const offer = o.assignment?.status === 'OFFERED';
  const cashDue = o.paymentMethod === 'CASH' && o.status.payment !== 'PAID' ? o.amounts.totalPaise - o.amounts.codCollectedPaise : 0;
  const pickedUp = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'].includes(o.status.fulfilment);
  return (
    <article className={`mcard${offer ? ' offer' : ''}`} aria-label={o.code}>
      <div className="spread">
        <span className="ocard-code">{o.code}</span>
        {offer && o.assignment?.expiresAt ? <OfferTimer at={o.assignment.expiresAt} /> : <Pill tone={h.tone} dot>{h.text}</Pill>}
      </div>
      <div>
        <div className="ocard-title" style={{ fontSize: 18 }}>
          {o.items.map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ')}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {o.delivery.distanceKm != null ? `${o.delivery.distanceKm} km · ` : ''}
          {o.schedule.start ? `Deliver ${dateTime(o.schedule.start)}` : `Placed ${ago(o.createdAt)}`}
        </div>
      </div>
      {!pickedUp && !['DELIVERED', 'RETURNING', 'RETURNED_TO_WORKSPACE'].includes(o.status.fulfilment) && (
        <div className="tile">
          <div className="k">Pick up from</div>
          <div className="v" style={{ whiteSpace: 'normal' }}>{ws}</div>
          <div className="muted" style={{ fontSize: 12 }}>{o.status.fulfilment === 'READY' ? 'Packed and ready' : 'Still being prepared'}</div>
        </div>
      )}
      <div className="dest">
        <div className="k">{o.status.fulfilment === 'RETURNING' ? 'Return to' : 'Deliver to'}</div>
        <div className="v">{o.status.fulfilment === 'RETURNING' ? ws : `${o.customer.name}`}</div>
        {o.status.fulfilment !== 'RETURNING' && (
          <div className="s">
            <a href={mapsSearch(o.delivery.address ?? '')} target="_blank" rel="noopener noreferrer">
              {o.delivery.address}
            </a>
          </div>
        )}
      </div>
      {o.note && <div className="note"><b>Note:</b> “{o.note}”</div>}
      {cashDue > 0 && (
        <div className="callout callout-amber">
          <Icon name="cash" size={15} />
          <b>Collect {moneyExact(cashDue)} in cash</b>
        </div>
      )}
      {o.status.order === 'CANCELLED' && o.status.fulfilment === 'RETURNING' && (
        <div className="callout callout-red"><Icon name="slash" size={15} /><b>Order cancelled — bring the parcel back</b></div>
      )}
      {o.failure && o.status.fulfilment === 'DELIVERY_FAILED' && (
        <div className="callout callout-red"><Icon name="alert" size={15} /><div><b>{o.failure.reason}</b><div>Waiting for the workspace to decide next steps.</div></div></div>
      )}
      <ActionBar order={o} variant="mobile" />
    </article>
  );
}

function List({ path, ws, empty }: { path: string; ws: string; empty: { title: string; body: string } }) {
  const q = useApi<Order[]>(path, 10000);
  if (q.error && !q.data) return <ErrorBox message={q.error.message} onRetry={q.reload} />;
  if (!q.data)
    return (
      <>
        <Skeleton h={220} r={18} />
        <Skeleton h={220} r={18} />
      </>
    );
  if (!q.data.length) return <Empty icon="truck" title={empty.title}>{empty.body}</Empty>;
  return (
    <>
      {q.data.map((o) => (
        <DeliveryCard key={o.id} o={o} ws={ws} />
      ))}
    </>
  );
}

function CashTab() {
  const toast = useToast();
  const q = useApi<AgentCash>('/agent/cash', 20000);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const total = d?.inHandPaise ?? 0;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await post('/agent/cash-handovers', { declaredAmount: Number(amount), note: note || undefined });
      toast('Cash handover submitted');
      setOpen(false);
      refreshAll();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }

  if (q.error && !d) return <ErrorBox message={q.error.message} onRetry={q.reload} />;
  if (!d) return <Skeleton h={200} r={18} />;
  const mismatch = amount !== '' && Math.round(Number(amount) * 100) !== total;
  return (
    <>
      <div className="mcard cash-card">
        <div style={{ opacity: 0.7, fontSize: 13 }}>Cash in hand</div>
        <div className="title-xl num" style={{ fontSize: 36 }}>{moneyExact(total)}</div>
        <div style={{ opacity: 0.7, fontSize: 13 }}>{d.collections.length} order(s) not yet handed over</div>
        <button
          className="btn btn-lg btn-block btn-dark"
          disabled={!d.collections.length}
          onClick={() => {
            setAmount(String(total / 100));
            setOpen(true);
          }}
        >
          Submit cash handover
        </button>
      </div>
      {d.collections.map((c) => (
        <div key={c.collectionId} className="who" style={{ background: 'var(--surface)' }}>
          <Icon name="cash" />
          <div className="grow">
            <div className="n">{c.code} · {c.customerName}</div>
            <div className="p">Collected {ago(c.collectedAt)}</div>
          </div>
          <b className="num">{moneyExact(c.amountPaise)}</b>
        </div>
      ))}
      <h2 className="h2" style={{ marginTop: 8 }}>Handovers</h2>
      {!d.handovers.length && <p className="muted" style={{ margin: 0 }}>No handovers yet.</p>}
      {d.handovers.map((h) => (
        <div key={h.id} className="mcard">
          <div className="spread">
            <b>{h.code}</b>
            <Pill tone={h.status === 'DISCREPANCY' ? 'red' : h.status === 'SUBMITTED' ? 'amber' : 'green'}>
              {h.status === 'SUBMITTED' ? 'Waiting for admin' : h.status === 'DISCREPANCY' ? 'Discrepancy' : h.status === 'RESOLVED' ? 'Resolved' : 'Confirmed'}
            </Pill>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {dateTime(h.submittedAt)} · {h.orders.length} order(s) · declared {moneyExact(h.declaredPaise)}
            {h.receivedPaise != null && ` · counted ${moneyExact(h.receivedPaise)}`}
          </div>
          {h.discrepancyReason && <div className="callout callout-red"><Icon name="alert" size={15} />{h.discrepancyReason}</div>}
          {h.resolutionNote && <div className="callout callout-green"><Icon name="check" size={15} />{h.resolutionNote}</div>}
        </div>
      ))}
      {open && (
        <Dialog
          title="Submit cash handover"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-neutral" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || amount === '' || (mismatch && !note.trim())}>
                {busy && <Spinner />}Submit handover
              </button>
            </>
          }
        >
          <div className="stack" style={{ marginTop: 8 }}>
            <p className="muted" style={{ margin: 0 }}>You collected {moneyExact(total)} across {d.collections.length} order(s).</p>
            <div className="field">
              <label htmlFor="ho-amt">Amount you are handing over</label>
              <div className="input-prefix">
                <span>₹</span>
                <input id="ho-amt" className="input num" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            {mismatch && <div className="callout callout-amber"><Icon name="alert" size={15} />This differs from what you collected. Add a note so the admin knows why.</div>}
            <div className="field">
              <label htmlFor="ho-note">Note {mismatch && <span className="req">*</span>}</label>
              <textarea id="ho-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>
            {err && <div className="error-text">{err}</div>}
          </div>
        </Dialog>
      )}
    </>
  );
}

export default function AgentApp() {
  const session = useGate(['DELIVERY_AGENT']);
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const summary = useApi<AgentSummary>(session ? '/agent/summary' : null, 10000);
  const [toggling, setToggling] = useState(false);
  if (!session) return <FullPageLoader />;
  const ws = `${session.user.workspace.name}, ${session.user.workspace.address}`;
  const s = summary.data;

  async function toggleDuty() {
    if (!s) return;
    setToggling(true);
    try {
      await patch('/agent/availability', { isAvailable: !s.isAvailable });
      toast(!s.isAvailable ? 'You are on duty — you can receive new deliveries' : 'You are off duty — no new auto-assigned deliveries');
      refreshAll();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update', true);
    } finally {
      setToggling(false);
    }
  }

  return (
    <MobileShell
      session={session}
      tab={tab}
      onTab={setTab}
      tabs={[
        { key: 'offers', label: 'Offers', icon: 'bell', count: s?.offers },
        { key: 'active', label: 'Active', icon: 'truck' },
        { key: 'cash', label: 'Cash', icon: 'cash' },
        { key: 'history', label: 'History', icon: 'history' },
      ]}
      header={
        <>
          <div className="duty">
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{s?.isAvailable ? 'On duty' : 'Off duty'}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{s?.isAvailable ? 'You can receive new delivery offers' : 'Turn on to receive delivery offers'}</div>
            </div>
            <button className={`switch${s?.isAvailable ? ' on' : ''}`} role="switch" aria-checked={!!s?.isAvailable} aria-label="On duty" onClick={toggleDuty} disabled={!s || toggling} />
          </div>
          <div className="mini-stats">
            <div className="tile"><div className="k">Active</div><div className="v num">{s?.active ?? '–'}</div></div>
            <div className="tile"><div className="k">Delivered today</div><div className="v num">{s?.deliveredToday ?? '–'}</div></div>
            <div className="tile"><div className="k">Cash in hand</div><div className="v num" style={{ fontSize: 16 }}>{s ? moneyExact(s.cashInHandPaise) : '–'}</div></div>
          </div>
        </>
      }
    >
      {tab === 'offers' && <List path="/agent/assignments?scope=offers" ws={ws} empty={{ title: 'No new offers', body: 'New delivery offers appear here. Accept them before the timer runs out.' }} />}
      {tab === 'active' && <List path="/agent/assignments?scope=active" ws={ws} empty={{ title: 'No active deliveries', body: 'Accepted deliveries appear here with every step you need.' }} />}
      {tab === 'cash' && <CashTab />}
      {tab === 'history' && <List path="/agent/assignments?scope=completed" ws={ws} empty={{ title: 'Nothing yet', body: 'Deliveries from the last 7 days appear here.' }} />}
    </MobileShell>
  );
}
