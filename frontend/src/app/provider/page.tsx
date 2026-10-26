'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { dateTime, mapsSearch, moneyExact, plural, timeRange } from '@/lib/format';
import type { Order } from '@/lib/types';
import { FullPageLoader, useGate } from '@/components/shell/Shell';
import { MobileShell } from '@/components/shell/MobileShell';
import { Empty, ErrorBox, Skeleton } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { ActionBar } from '@/components/orders/actions';
import { headline, Pill, TypeTag } from '@/components/orders/status';

interface ProviderSummary {
  today: number;
  upcoming: number;
  inProgress: number;
  completedToday: number;
}

function BookingCard({ o, ws }: { o: Order; ws: string }) {
  const h = headline(o);
  const where =
    o.fulfilmentType === 'ONLINE'
      ? null
      : o.fulfilmentType === 'AT_CUSTOMER_LOCATION' || o.fulfilmentType === 'EVENT'
        ? o.delivery.address
        : ws;
  const cashDue = o.paymentMethod === 'CASH' && o.status.payment !== 'PAID' ? o.amounts.totalPaise - o.amounts.codCollectedPaise : 0;
  return (
    <article className="mcard" aria-label={o.code}>
      <div className="spread">
        <span className="ocard-code">{o.code}</span>
        <Pill tone={h.tone} dot>{h.text}</Pill>
      </div>
      <div>
        <div className="ocard-title" style={{ fontSize: 18 }}>{o.items[0]?.name}</div>
        <div className="row-wrap" style={{ marginTop: 6 }}>
          <TypeTag o={o} />
          {o.fulfilmentType === 'WORKSHOP' && <Pill>{plural(o.schedule.seats, 'seat')}</Pill>}
        </div>
      </div>
      <div className="dest">
        <div className="k">When</div>
        <div className="v">{timeRange(o.schedule.start, o.schedule.end)}</div>
        {where && (
          <div className="s">
            <a href={mapsSearch(where)} target="_blank" rel="noopener noreferrer">{where}</a>
          </div>
        )}
        {o.fulfilmentType === 'ONLINE' && (
          <div className="s">{o.meeting?.link ? <a href={o.meeting.link} target="_blank" rel="noopener noreferrer">Open meeting link</a> : 'Add the meeting link before the session'}</div>
        )}
      </div>
      <div className="who">
        <Icon name="user" />
        <div className="grow">
          <div className="n">{o.customer.name}</div>
          <div className="p num">{o.customer.phone}</div>
        </div>
        {o.provider && !o.provider.confirmedAt && ['CONFIRMED', 'PENDING_REVIEW'].includes(o.status.order) && <Pill tone="amber">Please confirm</Pill>}
      </div>
      {o.eventDetails && (
        <div className="note">
          <b>{o.eventDetails.occasion ?? 'Event'}</b>
          {o.eventDetails.guests ? ` · ${o.eventDetails.guests} guests` : ''}
          {o.eventDetails.requirements && <div>{o.eventDetails.requirements}</div>}
        </div>
      )}
      {o.note && <div className="note"><b>Note:</b> “{o.note}”</div>}
      {cashDue > 0 && o.status.fulfilment !== 'SCHEDULED' && (
        <div className="callout callout-amber"><Icon name="cash" size={15} /><b>Collect {moneyExact(cashDue)} when the service is completed</b></div>
      )}
      {o.failure && ['NO_SHOW', 'SERVICE_FAILED', 'PROVIDER_UNAVAILABLE'].includes(o.status.fulfilment) && (
        <div className="callout callout-red"><Icon name="alert" size={15} /><div><b>{o.failure.reason}</b><div>The workspace admin will reschedule or cancel.</div></div></div>
      )}
      {o.openRequests.map((r) => (
        <div key={r.id} className="callout callout-blue"><Icon name="clock" size={15} />Reschedule request {r.proposedStart ? `for ${dateTime(r.proposedStart)} ` : ''}is waiting for the admin</div>
      ))}
      <ActionBar order={o} variant="mobile" />
    </article>
  );
}

const EMPTY: Record<string, { title: string; body: string }> = {
  today: { title: 'Nothing scheduled today', body: 'Today’s appointments, sessions and visits appear here.' },
  upcoming: { title: 'No upcoming bookings', body: 'Bookings assigned to you for the coming days appear here.' },
  attention: { title: 'All caught up', body: 'Bookings that need your confirmation or a follow-up appear here.' },
  past: { title: 'No past bookings', body: 'Completed and cancelled bookings appear here.' },
};

export default function ProviderApp() {
  const session = useGate(['SERVICE_PROVIDER']);
  const [tab, setTab] = useState('today');
  const summary = useApi<ProviderSummary>(session ? '/provider/summary' : null, 20000);
  const attention = useApi<Order[]>(session ? '/provider/bookings?scope=attention' : null, 20000);
  const list = useApi<Order[]>(session ? `/provider/bookings?scope=${tab}` : null, 15000);
  if (!session) return <FullPageLoader />;
  const ws = `${session.user.workspace.name}, ${session.user.workspace.address}`;
  const s = summary.data;
  return (
    <MobileShell
      session={session}
      tab={tab}
      onTab={setTab}
      tabs={[
        { key: 'today', label: 'Today', icon: 'calendar' },
        { key: 'upcoming', label: 'Upcoming', icon: 'clock' },
        { key: 'attention', label: 'To do', icon: 'alert', count: attention.data?.length },
        { key: 'past', label: 'Past', icon: 'history' },
      ]}
      header={
        <div className="mini-stats">
          <div className="tile"><div className="k">Today</div><div className="v num">{s?.today ?? '–'}</div></div>
          <div className="tile"><div className="k">In progress</div><div className="v num">{s?.inProgress ?? '–'}</div></div>
          <div className="tile"><div className="k">Done today</div><div className="v num">{s?.completedToday ?? '–'}</div></div>
        </div>
      }
    >
      {list.error && !list.data && <ErrorBox message={list.error.message} onRetry={list.reload} />}
      {!list.data && !list.error && (
        <>
          <Skeleton h={240} r={18} />
          <Skeleton h={240} r={18} />
        </>
      )}
      {list.data && !list.data.length && <Empty icon="calendar" title={EMPTY[tab].title}>{EMPTY[tab].body}</Empty>}
      {list.data?.map((o) => <BookingCard key={o.id} o={o} ws={ws} />)}
    </MobileShell>
  );
}
