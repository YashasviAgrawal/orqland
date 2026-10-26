'use client';
import type { Order } from '@/lib/types';
import { ago, countdown, dateTime, money, PAYMENT_METHOD_LABEL, plural, time, timeRange, day } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { getSession } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/primitives';
import { ActionBar, QuickAction } from './actions';
import { headline, Pill, PaymentPill } from './status';

const PREP_ACTIVE = ['AWAITING_PREPARATION', 'PREPARING'];

export function PrepRing({ order, size = 104 }: { order: Order; size?: number }) {
  const now = useNow(1000);
  const p = order.prep;
  if (!p) return null;
  const total = (p.minutes + p.extraMinutes) * 60000;
  const running = order.status.fulfilment === 'PREPARING' && p.startedAt;
  const left = running ? new Date(p.dueAt!).getTime() - now : total;
  const frac = running ? Math.max(0, Math.min(1, left / Math.max(total, 1))) : 1;
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const late = running && left < 0;
  return (
    <div className={`ring${late ? ' late' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={late ? 'Preparation overdue' : `Preparation ends in ${countdown(left)}`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={8} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={late ? 'var(--red)' : 'var(--blue)'}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={late ? 0 : circ * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="c">
        <small>{late ? 'Overdue' : running ? 'Ends in' : 'Prep time'}</small>
        <b>{running ? countdown(left) : `${p.minutes + p.extraMinutes}m`}</b>
        {p.extraMinutes > 0 && <em>+{p.extraMinutes} min</em>}
      </div>
    </div>
  );
}

/** The black block from the Figma — where / when this order is fulfilled. */
export function Destination({ o }: { o: Order }) {
  const ws = getSession()?.user.workspace;
  let k = 'Destination';
  let v: React.ReactNode = o.delivery.address ?? '—';
  let s: React.ReactNode = null;
  switch (o.fulfilmentType) {
    case 'DELIVERY':
      k = 'Deliver to';
      s = o.delivery.distanceKm != null ? `${o.delivery.distanceKm} km away` : null;
      break;
    case 'SCHEDULED_DELIVERY':
      k = 'Deliver to';
      s = o.schedule.start ? `Slot ${timeRange(o.schedule.start, o.schedule.end)}` : null;
      break;
    case 'TAKEAWAY':
      k = 'Customer pickup';
      v = 'At the counter';
      s = ws?.name ?? null;
      break;
    case 'SCHEDULED_TAKEAWAY':
      k = 'Customer pickup';
      v = timeRange(o.schedule.start, o.schedule.end);
      s = ws?.name ?? null;
      break;
    case 'DINE_IN':
      k = 'Dine in';
      v = o.tableNumber ? `Table ${o.tableNumber}` : 'Table not set';
      break;
    case 'AT_CUSTOMER_LOCATION':
      k = 'Visit at';
      s = timeRange(o.schedule.start, o.schedule.end);
      break;
    case 'EVENT':
      k = 'Event venue';
      v = o.eventDetails?.venue ?? o.delivery.address ?? '—';
      s = `${dateTime(o.schedule.start)}${o.eventDetails?.guests ? ` · ${o.eventDetails.guests} guests` : ''}`;
      break;
    case 'ONLINE':
      k = 'Online session';
      v = timeRange(o.schedule.start, o.schedule.end);
      s = o.meeting?.link ? (
        <a href={o.meeting.link} target="_blank" rel="noopener noreferrer">
          Meeting link
        </a>
      ) : (
        'Meeting link not added yet'
      );
      break;
    case 'WORKSHOP':
      k = o.schedule.slotTitle ?? 'Workshop session';
      v = timeRange(o.schedule.start, o.schedule.end);
      s = o.schedule.capacity ? `${plural(o.schedule.seats, 'seat')} · ${o.schedule.reserved}/${o.schedule.capacity} booked` : plural(o.schedule.seats, 'seat');
      break;
    default:
      k = 'At our location';
      v = timeRange(o.schedule.start, o.schedule.end);
      s = ws?.name ?? null;
  }
  return (
    <div className="dest">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function Callouts({ o }: { o: Order }) {
  const out: React.ReactNode[] = [];
  for (const r of o.openRequests) {
    const who = r.requestedByRole === 'SERVICE_PROVIDER' ? 'Provider' : 'Customer';
    const what = r.type === 'CANCELLATION' ? 'wants to cancel' : r.type === 'RETURN' ? 'requested a return' : 'requested a new time';
    out.push(
      <div key={r.id} className="callout callout-blue">
        <Icon name="info" size={15} />
        <div>
          <b>
            {who} {what}
          </b>
          {r.proposedStart && <> · {dateTime(r.proposedStart)}</>}
          {r.reason && <div>“{r.reason}”</div>}
        </div>
      </div>,
    );
  }
  if (o.failure && ['DELIVERY_FAILED', 'NO_SHOW', 'SERVICE_FAILED', 'PROVIDER_UNAVAILABLE'].includes(o.status.fulfilment)) {
    out.push(
      <div key="fail" className="callout callout-red">
        <Icon name="alert" size={15} />
        <div>
          <b>{o.failure.reason}</b>
          {o.failure.notes && <div>{o.failure.notes}</div>}
        </div>
      </div>,
    );
  }
  if (o.status.order === 'CLARIFICATION_REQUESTED' && o.clarificationNote) {
    out.push(
      <div key="clar" className="callout callout-amber">
        <Icon name="clock" size={15} />
        <div>
          <b>Waiting for customer</b>
          <div>{o.clarificationNote}</div>
        </div>
      </div>,
    );
  }
  if (o.status.payment === 'FAILED') {
    out.push(
      <div key="pay" className="callout callout-red">
        <Icon name="alert" size={15} />
        <b>Payment failed — ask the customer to retry</b>
      </div>,
    );
  }
  if (o.exception === 'COD_DISCREPANCY') {
    out.push(
      <div key="cod" className="callout callout-red">
        <Icon name="cash" size={15} />
        <b>Cash handover discrepancy — see COD settlement</b>
      </div>,
    );
  }
  if (o.exception === 'RETURN_TO_CONFIRM' || o.exception === 'RETURNING') {
    out.push(
      <div key="ret" className="callout callout-amber">
        <Icon name="undo" size={15} />
        <b>{o.exception === 'RETURNING' ? 'Parcel is on its way back to the workspace' : 'Agent says the parcel is back — confirm receipt'}</b>
      </div>,
    );
  }
  return out.length ? <>{out}</> : null;
}

export function OrderCard({ o, onOpen, variant = 'standard' }: { o: Order; onOpen: (o: Order) => void; variant?: 'standard' | 'new' }) {
  const h = headline(o);
  const item = o.items[0];
  const moreItems = o.items.length - 1;
  const qty = o.items.reduce((n, i) => n + i.quantity, 0);
  const showRing = !!o.prep && PREP_ACTIVE.includes(o.status.fulfilment) && variant !== 'new';
  const isNew = o.status.order === 'PENDING_REVIEW';

  return (
    <article className={`ocard${o.exception && o.status.order !== 'COMPLETED' ? ' flagged' : ''}`} aria-label={`${o.code} ${item?.name ?? ''}`}>
      <div className="ocard-left">
        <div className="spread">
          <span className="ocard-code">{o.code}</span>
          {isNew ? (
            <span className="row" style={{ color: 'var(--blue-ink)', fontSize: 12.5, fontWeight: 600 }}>
              <span className="dot" style={{ width: 7, height: 7, borderRadius: 9, background: 'var(--blue)', display: 'inline-block' }} />
              Received {ago(o.createdAt)}
            </span>
          ) : (
            <Pill tone={h.tone} dot>
              {h.text}
            </Pill>
          )}
        </div>
        <button className="ocard-title-btn" onClick={() => onOpen(o)}>
          <h3 className="ocard-title">
            {item?.name}
            {moreItems > 0 && <span className="muted" style={{ fontWeight: 600, fontSize: 15 }}> +{moreItems} more</span>}
          </h3>
        </button>
        <div className="row">
          <span className="ocard-price num">{money(o.amounts.totalPaise)}</span>
          <span className="ocard-qty">{o.fulfilmentType === 'WORKSHOP' ? plural(o.schedule.seats, 'seat') : `${qty} pcs`}</span>
        </div>
        {item?.tags?.length ? (
          <div className="row-wrap">
            {item.tags.slice(0, 3).map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {showRing ? (
          <div className="row" style={{ gap: 14, marginTop: 'auto' }}>
            <PrepRing order={o} />
            <div className="stack" style={{ gap: 6, fontSize: 12.5 }}>
              <div>
                <span className="muted">Type </span>
                <b>{o.fulfilmentLabel}</b>
              </div>
              {o.prep?.dueAt && (
                <div>
                  <span className="muted">Ready by </span>
                  <b>{time(o.prep.dueAt)}</b>
                </div>
              )}
              <QuickAction order={o} code="ADD_PREP_TIME" input={{ minutes: '5' }} className="btn btn-sm btn-neutral">
                <Icon name="plus" size={13} />5 min
              </QuickAction>
            </div>
          </div>
        ) : (
          <Destination o={o} />
        )}
      </div>

      <div className="ocard-right">
        <div className="who" style={{ alignItems: 'flex-start' }}>
          <Avatar name={o.customer.name} size="sm" />
          <div className="grow">
            <div className="n ellipsis">{o.customer.name}</div>
            <div className="row-wrap" style={{ gap: 6, marginTop: 2 }}>
              <span className="p num" style={{ whiteSpace: 'nowrap' }}>{o.customer.phone}</span>
              <PaymentPill o={o} />
            </div>
          </div>
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="k">Fulfilment</div>
            <div className="v">{o.fulfilmentLabel}</div>
          </div>
          <div className="tile">
            <div className="k">{o.prep && isNew ? 'Prep time' : o.schedule.start ? 'Scheduled' : 'Placed'}</div>
            <div className="v num">
              {o.prep && isNew ? (
                <span className="row" style={{ gap: 6 }}>
                  {o.prep.minutes + o.prep.extraMinutes} min
                  <QuickAction order={o} code="ADD_PREP_TIME" input={{ minutes: '5' }} className="btn btn-sm btn-neutral">
                    +5
                  </QuickAction>
                </span>
              ) : o.schedule.start ? (
                `${day(o.schedule.start)}, ${time(o.schedule.start)}`
              ) : (
                ago(o.createdAt)
              )}
            </div>
          </div>
          {o.assignment ? (
            <div className="tile" style={{ gridColumn: '1 / -1' }}>
              <div className="k">{o.assignment.status === 'OFFERED' ? 'Offered to' : 'Delivery agent'}</div>
              <div className="v">
                {o.assignment.agentName}
                {o.assignment.status === 'OFFERED' && <span className="muted" style={{ fontWeight: 500 }}> · awaiting acceptance</span>}
              </div>
            </div>
          ) : o.provider ? (
            <div className="tile" style={{ gridColumn: '1 / -1' }}>
              <div className="k">Provider</div>
              <div className="v">
                {o.provider.name}
                {!o.provider.confirmedAt && o.status.order !== 'COMPLETED' && <span className="muted" style={{ fontWeight: 500 }}> · not yet confirmed</span>}
              </div>
            </div>
          ) : (
            <div className="tile" style={{ gridColumn: '1 / -1' }}>
              <div className="k">Payment</div>
              <div className="v">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</div>
            </div>
          )}
        </div>
        {o.note && (
          <div className="note">
            <b>Note:</b> “{o.note}”
          </div>
        )}
        <Callouts o={o} />
        <ActionBar order={o} hide={o.prep ? ['ADD_PREP_TIME'] : []} />
      </div>
    </article>
  );
}
