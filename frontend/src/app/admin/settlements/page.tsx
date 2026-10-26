'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AdminShell } from '@/components/shell/Shell';
import { ApiError, post } from '@/lib/api';
import { refreshAll, useApi } from '@/lib/hooks';
import { ago, dateTime, moneyExact } from '@/lib/format';
import type { Handover, SettlementOverview } from '@/lib/types';
import { Avatar, Dialog, Empty, ErrorBox, Skeleton, Spinner, useToast } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/orders/status';

const H_TONE = { SUBMITTED: 'amber', CONFIRMED: 'green', DISCREPANCY: 'red', RESOLVED: 'green' } as const;
const H_LABEL = { SUBMITTED: 'To verify', CONFIRMED: 'Confirmed', DISCREPANCY: 'Discrepancy', RESOLVED: 'Resolved' } as const;
const RESOLUTIONS = [
  { value: 'AGENT_PAID_DIFFERENCE', label: 'Agent paid the difference' },
  { value: 'RECOUNT_CORRECTED', label: 'Recounted — amount was correct' },
  { value: 'DEDUCTED_FROM_PAYOUT', label: 'Deduct from agent payout' },
  { value: 'WRITTEN_OFF', label: 'Write off the difference' },
];

type Mode = { h: Handover; kind: 'confirm' | 'discrepancy' | 'resolve' };

export default function SettlementsPage() {
  const q = useApi<SettlementOverview>('/settlements', 20000);
  const history = useApi<Handover[]>('/settlements/handovers?status=CONFIRMED,RESOLVED');
  const [mode, setMode] = useState<Mode | null>(null);
  const d = q.data;

  return (
    <AdminShell title="COD settlement">
      {q.error && !d && <ErrorBox message={q.error.message} onRetry={q.reload} />}
      <section className="stat-tiles four" aria-label="Cash totals">
        {[
          ['Outstanding cash', d?.totals.outstandingPaise, 'var(--ink)'],
          ['With agents', d?.totals.inHand, 'var(--blue)'],
          ['Handed over, to verify', d?.totals.inHandover, 'var(--amber)'],
          ['Disputed', d?.totals.disputed, 'var(--red)'],
        ].map(([label, v, c]) => (
          <div key={label as string} className="stat" style={{ cursor: 'default' }}>
            <span className="t">
              <i style={{ background: c as string }} />
              {label as string}
            </span>
            <span className="n num" style={{ fontSize: 'clamp(19px, 4vw, 26px)' }}>{d ? moneyExact(v as number) : '–'}</span>
          </div>
        ))}
      </section>

      <section className="panel" aria-label="Handovers to verify">
        <div className="panel-head">
          <h2 className="h2">Handovers to verify</h2>
          {d && <span className={`count-badge${d.pendingHandovers.length ? ' red' : ''}`}>{d.pendingHandovers.length}</span>}
        </div>
        {!d && <Skeleton h={150} r={18} />}
        {d && !d.pendingHandovers.length && <Empty icon="check" title="Nothing to verify">Cash handovers submitted by agents will appear here.</Empty>}
        <div className="cards">
          {d?.pendingHandovers.map((h) => (
            <article key={h.id} className="box stack" style={{ gap: 10 }}>
              <div className="spread">
                <div className="row">
                  <Avatar name={h.agentName} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{h.agentName}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {h.code} · submitted {ago(h.submittedAt)}
                    </div>
                  </div>
                </div>
                <Pill tone={H_TONE[h.status]} dot>{H_LABEL[h.status]}</Pill>
              </div>
              <div className="tiles" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="tile"><div className="k">Collected</div><div className="v num">{moneyExact(h.expectedPaise)}</div></div>
                <div className="tile"><div className="k">Declared</div><div className="v num">{moneyExact(h.declaredPaise)}</div></div>
                <div className="tile"><div className="k">Counted</div><div className="v num" style={h.receivedPaise != null && h.receivedPaise !== h.expectedPaise ? { color: 'var(--red-ink)' } : undefined}>{h.receivedPaise != null ? moneyExact(h.receivedPaise) : '—'}</div></div>
              </div>
              {h.agentNote && <div className="note"><b>Agent:</b> “{h.agentNote}”</div>}
              {h.discrepancyReason && <div className="callout callout-red"><Icon name="alert" size={15} /><div><b>{h.differencePaise < 0 ? `Short by ${moneyExact(-h.differencePaise)}` : `Over by ${moneyExact(h.differencePaise)}`}</b><div>{h.discrepancyReason}</div></div></div>}
              <div className="kv">
                {h.orders.map((o) => (
                  <Row key={o.orderId} k={<Link href={`/admin/orders/${o.orderId}`}><b>{o.code}</b> · {o.customerName}</Link>} v={moneyExact(o.amountPaise)} />
                ))}
              </div>
              <div className="actions">
                {h.status === 'SUBMITTED' && (
                  <>
                    <button className="btn btn-primary wide" onClick={() => setMode({ h, kind: 'confirm' })}>Confirm cash received</button>
                    <button className="btn btn-danger" onClick={() => setMode({ h, kind: 'discrepancy' })}>Record discrepancy</button>
                  </>
                )}
                {h.status === 'DISCREPANCY' && <button className="btn btn-primary wide" onClick={() => setMode({ h, kind: 'resolve' })}>Resolve discrepancy</button>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="stack" style={{ gap: 10 }} aria-label="Outstanding cash by agent">
          <h2 className="h2">Outstanding by agent</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Agent</th><th className="r">With agent</th><th className="r">To verify</th><th className="r">Disputed</th></tr></thead>
              <tbody>
                {d?.agents.map((a) => (
                  <tr key={a.agentId}>
                    <td><span className="row"><Avatar name={a.agentName} color={a.avatarColor} size="sm" />{a.agentName}</span><div className="faint" style={{ fontSize: 12 }}>{a.ordersInHand} order(s) in hand</div></td>
                    <td className="r num">{moneyExact(a.inHandPaise)}</td>
                    <td className="r num">{moneyExact(a.inHandoverPaise)}</td>
                    <td className="r num" style={a.disputedPaise ? { color: 'var(--red-ink)', fontWeight: 700 } : undefined}>{moneyExact(a.disputedPaise)}</td>
                  </tr>
                ))}
                {!d && <tr><td colSpan={4}><Skeleton h={60} /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="stack" style={{ gap: 10 }} aria-label="Outstanding cash by order">
          <h2 className="h2">Outstanding by order</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order</th><th>Agent</th><th>Stage</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {d?.outstanding.map((o) => (
                  <tr key={o.collectionId}>
                    <td><Link href={`/admin/orders/${o.orderId}`}><b>{o.code}</b></Link><div className="faint" style={{ fontSize: 12 }}>{o.customerName} · {ago(o.collectedAt)}</div></td>
                    <td>{o.agentName}</td>
                    <td>{o.handoverStatus ? <Pill tone={H_TONE[o.handoverStatus as Handover['status']]}>{o.handoverCode}</Pill> : <Pill tone="blue">With agent</Pill>}</td>
                    <td className="r num">{moneyExact(o.amountPaise)}</td>
                  </tr>
                ))}
                {d && !d.outstanding.length && <tr><td colSpan={4} className="muted">No unsettled cash.</td></tr>}
              </tbody>
            </table>
          </div>
          {d && d.awaitingCollection.length > 0 && (
            <>
              <h3 className="h3" style={{ marginTop: 6 }}>Cash still to be collected</h3>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {d.awaitingCollection.map((o) => (
                      <tr key={o.orderId}>
                        <td><Link href={`/admin/orders/${o.orderId}`}><b>{o.code}</b></Link><div className="faint" style={{ fontSize: 12 }}>{o.customerName}</div></td>
                        <td>{o.agentName ?? 'Counter'}</td>
                        <td>{o.fulfilmentStatus.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="r num">{moneyExact(o.duePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="stack" style={{ gap: 10 }} aria-label="Settled handovers">
        <h2 className="h2">Settled handovers</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Handover</th><th>Agent</th><th>Verified</th><th>Outcome</th><th className="r">Received</th></tr></thead>
            <tbody>
              {history.data?.map((h) => (
                <tr key={h.id}>
                  <td><b>{h.code}</b><div className="faint" style={{ fontSize: 12 }}>{dateTime(h.submittedAt)}</div></td>
                  <td>{h.agentName}</td>
                  <td>{h.verifiedByName ?? '—'}<div className="faint" style={{ fontSize: 12 }}>{dateTime(h.resolvedAt ?? h.verifiedAt)}</div></td>
                  <td><Pill tone={H_TONE[h.status]}>{h.resolution ? RESOLUTIONS.find((r) => r.value === h.resolution)?.label : H_LABEL[h.status]}</Pill></td>
                  <td className="r num">{h.receivedPaise != null ? moneyExact(h.receivedPaise) : '—'}</td>
                </tr>
              ))}
              {history.data && !history.data.length && <tr><td colSpan={5} className="muted">No settled handovers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {mode && <HandoverDialog mode={mode} onClose={() => setMode(null)} />}
    </AdminShell>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <>
      <div>{k}</div>
      <div>{v}</div>
    </>
  );
}

function HandoverDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const toast = useToast();
  const { h, kind } = mode;
  const [amount, setAmount] = useState(String(h.expectedPaise / 100));
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = kind === 'confirm' ? 'Confirm cash received' : kind === 'discrepancy' ? 'Record a discrepancy' : 'Resolve discrepancy';

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (kind === 'confirm') await post(`/settlements/handovers/${h.id}/confirm`, { receivedAmount: Number(amount) });
      if (kind === 'discrepancy') await post(`/settlements/handovers/${h.id}/discrepancy`, { receivedAmount: Number(amount), reason });
      if (kind === 'resolve') await post(`/settlements/handovers/${h.id}/resolve`, { resolution, note: reason });
      toast(kind === 'confirm' ? 'Cash received — settled' : kind === 'discrepancy' ? 'Discrepancy recorded — settlement stays pending' : 'Discrepancy resolved — settled');
      refreshAll();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  const valid = kind === 'resolve' ? !!resolution && !!reason.trim() : Number(amount) >= 0 && amount !== '' && (kind === 'confirm' || !!reason.trim());

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-neutral" onClick={onClose}>Keep as is</button>
          <button className={`btn ${kind === 'discrepancy' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy || !valid}>
            {busy && <Spinner />}{title}
          </button>
        </>
      }
    >
      <div className="stack" style={{ marginTop: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {h.agentName} · {h.code} · collected {moneyExact(h.expectedPaise)}
          {h.receivedPaise != null && ` · counted ${moneyExact(h.receivedPaise)}`}
        </p>
        {kind !== 'resolve' && (
          <div className="field">
            <label htmlFor="amt">Amount you counted</label>
            <div className="input-prefix">
              <span>₹</span>
              <input id="amt" className="input num" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            {kind === 'confirm' && <div className="help">Must match the collected amount. If it doesn’t, record a discrepancy instead.</div>}
          </div>
        )}
        {kind === 'resolve' && (
          <div className="field">
            <label htmlFor="res">How was it resolved?</label>
            <select id="res" className="select" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              <option value="">Choose…</option>
              {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}
        {kind !== 'confirm' && (
          <div className="field">
            <label htmlFor="why">{kind === 'resolve' ? 'Resolution note' : 'What’s different?'}</label>
            <textarea id="why" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'resolve' ? 'e.g. Ravi paid ₹100 at the counter' : 'e.g. ₹100 short in the envelope'} />
          </div>
        )}
        {err && <div className="error-text">{err}</div>}
      </div>
    </Dialog>
  );
}
