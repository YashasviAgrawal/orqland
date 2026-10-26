'use client';
import { useEffect } from 'react';
import type { OrderDetail as Detail } from '@/lib/types';
import { useApi, useNow } from '@/lib/hooks';
import { ago, countdown, dateTime, mapsSearch, money, moneyExact, PAYMENT_METHOD_LABEL, plural, timeRange } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { Avatar, ErrorBox, Skeleton } from '@/components/ui/primitives';
import { ActionBar, ActionEnvProvider } from './actions';
import { COD_LABEL, headline, PAYMENT_LABEL, Pill, REFUND_LABEL, TypeTag } from './status';
import { PrepRing } from './OrderCard';

export function Stepper({ stages }: { stages: Detail['stages'] }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {stages.map((s) => (
        <li key={s.key} className={`step ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="b">{s.state === 'done' ? <Icon name="check" size={13} /> : s.state === 'failed' ? <Icon name="x" size={13} /> : null}</span>
          <span className="l">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

const ROLE_KIND: Record<string, string> = {
  WORKSPACE_ADMIN: 'admin',
  DELIVERY_AGENT: 'agent',
  SERVICE_PROVIDER: 'provider',
  CUSTOMER: 'customer',
  SYSTEM: 'system',
};
const ROLE_NAME: Record<string, string> = {
  WORKSPACE_ADMIN: 'Admin',
  DELIVERY_AGENT: 'Agent',
  SERVICE_PROVIDER: 'Provider',
  CUSTOMER: 'Customer',
  SYSTEM: 'System',
};

export function Timeline({ items }: { items: Detail['timeline'] }) {
  return (
    <ol className="timeline">
      {[...items].reverse().map((t) => (
        <li key={t.id} className={`k-${ROLE_KIND[t.actor.role] ?? 'system'}`}>
          <span className="d" />
          <div>
            <div className="m">{t.message}</div>
            <div className="meta">
              {t.actor.name && t.actor.name !== ROLE_NAME[t.actor.role] ? `${t.actor.name} · ` : ''}
              {ROLE_NAME[t.actor.role] ?? t.actor.role} · {dateTime(t.at)}
            </div>
            {t.reason && <div className="r">“{t.reason}”</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useNow(1000);
  const left = new Date(expiresAt).getTime() - now;
  return <span className="expiry">{left > 0 ? `expires in ${countdown(left)}` : 'expired — returning to queue'}</span>;
}

export function OrderDetailView({ d, focus }: { d: Detail; focus?: string }) {
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`sec-${focus}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  const h = headline(d);
  const qty = d.items.reduce((n, i) => n + i.quantity, 0);
  const scrollTo = (code: string) => {
    const sec = code === 'TRACK_DELIVERY' ? 'delivery' : code === 'VIEW_PAYMENT_DETAILS' ? 'payment' : null;
    if (sec) document.getElementById(`sec-${sec}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <ActionEnvProvider value={{ onLink: scrollTo }}>
    <div className="detail-grid">
      <div className="box">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-wrap">
              <Pill tone={h.tone} dot>
                {h.text}
              </Pill>
              <TypeTag o={d} />
              {d.exceptionLabel && d.status.order !== 'COMPLETED' && <Pill tone="red">{d.exceptionLabel}</Pill>}
            </div>
            <h2 className="h1" style={{ fontSize: 24 }}>
              {d.items.map((i) => i.name).join(', ')}
            </h2>
            <div className="muted">
              {d.code} · placed {ago(d.createdAt)} · {d.workflow.description}
            </div>
          </div>
          {d.prep && ['PREPARING', 'AWAITING_PREPARATION'].includes(d.status.fulfilment) && <PrepRing order={d} size={96} />}
        </div>
        <hr className="sep" />
        <Stepper stages={d.stages} />
      </div>

      {d.actions.length > 0 && (
        <div className="box">
          <ActionBar order={d} variant="full" />
        </div>
      )}

      <div className="status-quad">
        <div className="tile">
          <div className="k">Order</div>
          <div className="v">{d.statusLabel.order}</div>
        </div>
        <div className="tile">
          <div className="k">Fulfilment</div>
          <div className="v">{d.statusLabel.fulfilment}</div>
        </div>
        <div className="tile">
          <div className="k">Payment</div>
          <div className="v">{PAYMENT_LABEL[d.status.payment]}</div>
        </div>
        <div className="tile">
          <div className="k">{d.paymentMethod === 'CASH' ? 'COD settlement' : 'Refund'}</div>
          <div className="v">{d.paymentMethod === 'CASH' ? COD_LABEL[d.status.cod] : REFUND_LABEL[d.status.refund]}</div>
        </div>
      </div>

      {(d.openRequests.length > 0 || d.failure || d.cancelReason || d.rejectReason || d.clarificationNote) && (
        <div className="box">
          <div className="box-head">
            <Icon name="alert" />
            <h3 className="h3">Needs attention</h3>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {d.openRequests.map((r) => (
              <div key={r.id} className="callout callout-blue">
                <Icon name="info" size={15} />
                <div>
                  <b>
                    {r.requestedByRole === 'SERVICE_PROVIDER' ? 'Provider' : 'Customer'} {r.type === 'CANCELLATION' ? 'asked to cancel' : r.type === 'RETURN' ? 'requested a return' : 'requested a new time'}
                  </b>{' '}
                  · {ago(r.createdAt)}
                  {r.proposedStart && <div>Proposed: {dateTime(r.proposedStart)}</div>}
                  {r.reason && <div>“{r.reason}”</div>}
                </div>
              </div>
            ))}
            {d.failure && (
              <div className="callout callout-red">
                <Icon name="alert" size={15} />
                <div>
                  <b>{d.failure.reason}</b>
                  {d.failure.notes && <div>{d.failure.notes}</div>}
                  {d.failure.evidence && <div>Evidence: {d.failure.evidence}</div>}
                </div>
              </div>
            )}
            {d.clarificationNote && d.status.order === 'CLARIFICATION_REQUESTED' && (
              <div className="callout callout-amber">
                <Icon name="clock" size={15} />
                <div>
                  <b>Asked the customer</b>
                  <div>{d.clarificationNote}</div>
                </div>
              </div>
            )}
            {d.rejectReason && <div className="callout callout-red"><Icon name="slash" size={15} /><div><b>Rejected</b><div>{d.rejectReason}</div></div></div>}
            {d.cancelReason && <div className="callout callout-red"><Icon name="slash" size={15} /><div><b>Cancelled</b><div>{d.cancelReason}</div></div></div>}
          </div>
        </div>
      )}

      <div className="two-col">
        <div className="box">
          <div className="box-head">
            <Icon name="package" />
            <h3 className="h3">{d.kind === 'PRODUCT' ? 'Items' : 'Service'}</h3>
          </div>
          <div className="kv">
            {d.items.map((i) => (
              <ItemRow key={i.id} name={`${i.name} × ${i.quantity}`} value={money(i.totalPaise)} />
            ))}
            {d.amounts.deliveryFeePaise > 0 && <ItemRow name="Delivery fee" value={money(d.amounts.deliveryFeePaise)} />}
            {d.amounts.discountPaise > 0 && <ItemRow name="Discount" value={`− ${money(d.amounts.discountPaise)}`} />}
            <ItemRow name={<b style={{ color: 'var(--ink)' }}>Total</b>} value={<span className="title-xl num" style={{ fontSize: 18 }}>{moneyExact(d.amounts.totalPaise)}</span>} />
          </div>
          {d.note && (
            <div className="note" style={{ marginTop: 10 }}>
              <b>Note:</b> “{d.note}”
            </div>
          )}
        </div>

        <div className="box">
          <div className="box-head">
            <Icon name="user" />
            <h3 className="h3">Customer & fulfilment</h3>
          </div>
          <div className="kv">
            <div>Customer</div>
            <div>{d.customer.name}</div>
            <div>Contact</div>
            <div>
              <a href={`tel:${d.customer.phone.replace(/\s+/g, '')}`} className="num">
                {d.customer.phone}
              </a>
            </div>
            <div>Type</div>
            <div>{d.fulfilmentLabel}</div>
            {d.schedule.start && (
              <>
                <div>{d.kind === 'PRODUCT' ? 'Slot' : 'Time'}</div>
                <div>{timeRange(d.schedule.start, d.schedule.end)}</div>
              </>
            )}
            {d.fulfilmentType === 'WORKSHOP' && (
              <>
                <div>Seats</div>
                <div>
                  {d.schedule.seats}
                  {d.schedule.capacity != null && <span className="muted"> · {d.schedule.reserved}/{d.schedule.capacity} booked</span>}
                </div>
              </>
            )}
            {d.delivery.address && (
              <>
                <div>{d.fulfilmentType === 'EVENT' ? 'Venue' : 'Address'}</div>
                <div>
                  <a href={mapsSearch(d.delivery.address)} target="_blank" rel="noopener noreferrer">
                    {d.delivery.address}
                  </a>
                  {d.delivery.distanceKm != null && <span className="muted"> · {d.delivery.distanceKm} km</span>}
                </div>
              </>
            )}
            {d.tableNumber && (
              <>
                <div>Table</div>
                <div>{d.tableNumber}</div>
              </>
            )}
            {d.provider && (
              <>
                <div>Provider</div>
                <div>
                  {d.provider.name}
                  <div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{d.provider.confirmedAt ? `Confirmed ${ago(d.provider.confirmedAt)}` : 'Not yet confirmed by provider'}</div>
                </div>
              </>
            )}
            {d.meeting && (
              <>
                <div>Meeting</div>
                <div>
                  {d.meeting.link ? (
                    <a href={d.meeting.link} target="_blank" rel="noopener noreferrer">
                      Join link
                    </a>
                  ) : (
                    <span className="muted">Not added</span>
                  )}
                  {d.meeting.notes && <div className="muted" style={{ fontWeight: 500 }}>{d.meeting.notes}</div>}
                </div>
              </>
            )}
            {d.eventDetails && (
              <>
                <div>Occasion</div>
                <div>{d.eventDetails.occasion ?? '—'}</div>
                <div>Guests</div>
                <div>{d.eventDetails.guests ?? '—'}</div>
                <div>Requirements</div>
                <div style={{ fontWeight: 500 }}>{d.eventDetails.requirements ?? '—'}</div>
              </>
            )}
            {d.returnInfo.pickupAt && (
              <>
                <div>Return pickup</div>
                <div>{dateTime(d.returnInfo.pickupAt)}</div>
              </>
            )}
            {d.kind === 'PRODUCT' && !d.workflow.deliveryAgent && (
              <>
                <div>Quantity</div>
                <div>{qty} pcs</div>
              </>
            )}
          </div>
        </div>
      </div>

      {d.workflow.deliveryAgent && (
        <div className="box" id="sec-delivery">
          <div className="box-head">
            <Icon name="truck" />
            <h3 className="h3">Delivery & tracking</h3>
          </div>
          {d.assignment ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="who">
                <Avatar name={d.assignment.agentName} />
                <div className="grow">
                  <div className="n">{d.assignment.agentName}</div>
                  <div className="p">
                    {d.assignment.agentTitle} · {d.assignment.method === 'AUTO' ? 'auto-assigned' : 'assigned manually'}
                  </div>
                </div>
                {d.assignment.status === 'OFFERED' ? (
                  <Pill tone="amber">{d.assignment.expiresAt ? <OfferCountdown expiresAt={d.assignment.expiresAt} /> : 'Awaiting'}</Pill>
                ) : (
                  <Pill tone="green">Accepted</Pill>
                )}
                {d.assignment.agentPhone && (
                  <a className="btn btn-sm btn-neutral" href={`tel:${d.assignment.agentPhone.replace(/\s+/g, '')}`}>
                    <Icon name="phone" size={14} />
                    Call
                  </a>
                )}
              </div>
              <div className="tiles">
                <div className="tile">
                  <div className="k">Accepted</div>
                  <div className="v">{d.assignment.respondedAt ? ago(d.assignment.respondedAt) : '—'}</div>
                </div>
                <div className="tile">
                  <div className="k">Picked up</div>
                  <div className="v">{d.assignment.pickedUpAt ? ago(d.assignment.pickedUpAt) : '—'}</div>
                </div>
              </div>
              <div className="callout callout-blue">
                <Icon name="navigate" size={15} />
                <div>
                  <b>{d.statusLabel.fulfilment}</b>
                  {d.assignment.lastLocationAt && d.assignment.lastLat != null ? (
                    <>
                      {' '}· last position {ago(d.assignment.lastLocationAt)} ·{' '}
                      <a href={mapsSearch(`${d.assignment.lastLat},${d.assignment.lastLng}`)} target="_blank" rel="noopener noreferrer">
                        open map
                      </a>
                    </>
                  ) : (
                    <div>Progress is tracked by delivery status updates. Live GPS can be connected once agreed with OpenPurpl.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {['DELIVERED'].includes(d.status.fulfilment) ? 'Delivered.' : 'No delivery agent assigned yet.'}
            </p>
          )}
          {d.assignments.length > 0 && (
            <>
              <hr className="sep" />
              <div className="label" style={{ marginBottom: 6 }}>Assignment history</div>
              <div className="kv">
                {d.assignments.map((a) => (
                  <ItemRow
                    key={a.id}
                    name={`${a.agentName} · ${a.method === 'AUTO' ? 'auto' : 'manual'} · ${dateTime(a.offeredAt)}`}
                    value={
                      <span>
                        {a.status.charAt(0) + a.status.slice(1).toLowerCase()}
                        {a.reason && <span className="muted" style={{ fontWeight: 500 }}> · {a.reason}</span>}
                      </span>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="box" id="sec-payment">
        <div className="box-head">
          <Icon name="receipt" />
          <h3 className="h3">Payment</h3>
          <Pill tone={d.status.payment === 'PAID' ? 'green' : d.status.payment === 'FAILED' ? 'red' : 'amber'}>{PAYMENT_LABEL[d.status.payment]}</Pill>
        </div>
        <div className="kv">
          <div>Method</div>
          <div>{PAYMENT_METHOD_LABEL[d.paymentMethod]}</div>
          <div>Amount</div>
          <div className="num">{moneyExact(d.amounts.totalPaise)}</div>
          {d.paymentMethod === 'CASH' && (
            <>
              <div>Cash collected</div>
              <div className="num">{moneyExact(d.amounts.codCollectedPaise)}</div>
              <div>Settlement</div>
              <div>{COD_LABEL[d.status.cod]}</div>
            </>
          )}
          {d.status.refund !== 'NOT_APPLICABLE' && (
            <>
              <div>Refund</div>
              <div>{REFUND_LABEL[d.status.refund]}</div>
            </>
          )}
        </div>
        {d.payments.length > 0 && (
          <>
            <hr className="sep" />
            <div className="label" style={{ marginBottom: 6 }}>Payment attempts</div>
            <div className="kv">
              {d.payments.map((p) => (
                <ItemRow
                  key={p.id}
                  name={`#${p.attempt} · ${p.method}${p.reference ? ` · ${p.reference}` : ''}`}
                  value={
                    <span>
                      {p.status === 'SUCCEEDED' ? 'Succeeded' : p.status === 'FAILED' ? 'Failed' : 'Pending'} · {moneyExact(p.amountPaise)}
                      {p.failureReason && <div className="muted" style={{ fontWeight: 500 }}>{p.failureReason}</div>}
                    </span>
                  }
                />
              ))}
            </div>
          </>
        )}
        {d.codCollections.length > 0 && (
          <>
            <hr className="sep" />
            <div className="label" style={{ marginBottom: 6 }}>Cash collections</div>
            <div className="kv">
              {d.codCollections.map((c) => (
                <ItemRow
                  key={c.id}
                  name={`${c.agentName ?? 'Workspace counter'} · ${dateTime(c.collectedAt)}`}
                  value={
                    <span>
                      {moneyExact(c.amountPaise)} · {c.settled ? 'settled' : c.handover ? `${c.handover.code} (${c.handover.status.toLowerCase()})` : 'with agent'}
                    </span>
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="box">
        <div className="box-head">
          <Icon name="history" />
          <h3 className="h3">Activity</h3>
          <span className="muted">{plural(d.timeline.length, 'event')}</span>
        </div>
        <Timeline items={d.timeline} />
      </div>
    </div>
    </ActionEnvProvider>
  );
}

function ItemRow({ name, value }: { name: React.ReactNode; value: React.ReactNode }) {
  return (
    <>
      <div>{name}</div>
      <div>{value}</div>
    </>
  );
}

/** Loads and shows one order; used inside the drawer and on the full page. */
export function OrderDetailLoader({ id, focus }: { id: string; focus?: string }) {
  const q = useApi<Detail>(`/orders/${id}`, 15000);
  if (q.error && !q.data) return <ErrorBox message={q.error.message} onRetry={q.reload} />;
  if (!q.data)
    return (
      <div className="stack">
        <Skeleton h={180} r={18} />
        <Skeleton h={90} r={18} />
        <Skeleton h={240} r={18} />
      </div>
    );
  return <OrderDetailView d={q.data} focus={focus} />;
}

