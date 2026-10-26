'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AdminShell } from '@/components/shell/Shell';
import { useApi, useNow } from '@/lib/hooks';
import { ago, countdown, money } from '@/lib/format';
import type { Order, Staff } from '@/lib/types';
import { Avatar, Drawer, Empty, ErrorBox, Skeleton } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { ActionBar, ActionEnvProvider } from '@/components/orders/actions';
import { OrderDetailLoader } from '@/components/orders/OrderDetail';
import { headline, Pill } from '@/components/orders/status';

interface Board {
  unassigned: Order[];
  offered: Order[];
  active: Order[];
  exceptions: Order[];
  agents: Staff[];
}

function Expiry({ at }: { at: string }) {
  const now = useNow(1000);
  const left = new Date(at).getTime() - now;
  return <span className="expiry">{left > 0 ? countdown(left) : 'expiring…'}</span>;
}

const DELIVERY_PREFER = ['ASSIGN_AGENT', 'AUTO_ASSIGN_AGENT'];

function DeliveryCard({ o, onOpen }: { o: Order; onOpen: (o: Order) => void }) {
  const h = headline(o);
  return (
    <div className="kcard">
      <button className="ocard-title-btn" onClick={() => onOpen(o)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="spread" style={{ width: '100%' }}>
          <span className="ocard-code">{o.code}</span>
          <Pill tone={h.tone} dot>
            {h.text}
          </Pill>
        </span>
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>
          {o.items[0]?.name}
          {o.items.length > 1 && <span className="muted"> +{o.items.length - 1}</span>}
        </span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {o.customer.name} · {o.delivery.distanceKm != null ? `${o.delivery.distanceKm} km` : 'distance n/a'} · {money(o.amounts.totalPaise)}
          {o.paymentMethod === 'CASH' && o.status.payment !== 'PAID' ? ' · COD' : ''}
        </span>
        <span className="row" style={{ fontSize: 12.5 }}>
          <Icon name="pin" size={14} />
          <span className="ellipsis">{o.delivery.address}</span>
        </span>
        {o.assignment && (
          <span className="row" style={{ fontSize: 12.5 }}>
            <Avatar name={o.assignment.agentName} size="sm" />
            <b style={{ whiteSpace: 'nowrap' }}>{o.assignment.agentName}</b>
            {o.assignment.status === 'OFFERED' && o.assignment.expiresAt && (
              <span className="muted">
                · expires in <Expiry at={o.assignment.expiresAt} />
              </span>
            )}
            {o.assignment.status === 'ACCEPTED' && <span className="muted">· accepted {ago(o.assignment.respondedAt)}</span>}
          </span>
        )}
        {o.failure && <span className="callout callout-red" style={{ fontSize: 12 }}><Icon name="alert" size={14} />{o.failure.reason}</span>}
      </button>
      <ActionBar order={o} prefer={DELIVERY_PREFER} />
    </div>
  );
}

const COLS: Array<{ key: keyof Omit<Board, 'agents'>; title: string; empty: string }> = [
  { key: 'unassigned', title: 'Needs an agent', empty: 'Every confirmed delivery has an agent.' },
  { key: 'offered', title: 'Waiting for agent', empty: 'No offers waiting for a reply.' },
  { key: 'active', title: 'Assigned & on the way', empty: 'No deliveries in progress.' },
  { key: 'exceptions', title: 'Failed & returns', empty: 'No failed deliveries.' },
];

export default function DeliveryPage() {
  const q = useApi<Board>('/delivery/board', 10000);
  const [open, setOpen] = useState<{ id: string; focus?: string } | null>(null);
  const b = q.data;
  return (
    <AdminShell title="Delivery">
      <ActionEnvProvider value={{ onLink: (code, o) => (code === 'TRACK_DELIVERY' || code === 'VIEW_PAYMENT_DETAILS') && setOpen({ id: o.id, focus: code === 'TRACK_DELIVERY' ? 'delivery' : 'payment' }) }}>
        <section className="stack" style={{ gap: 10 }}>
          <div className="spread">
            <h2 className="h2">Agents</h2>
            <span className="muted">Auto-assign picks the on-duty agent with the fewest active deliveries.</span>
          </div>
          {q.error && !b && <ErrorBox message={q.error.message} onRetry={q.reload} />}
          <div className="row-wrap">
            {!b && [1, 2, 3].map((i) => <Skeleton key={i} w={220} h={58} r={14} />)}
            {b?.agents.map((a) => (
              <div key={a.id} className="who" style={{ background: 'var(--surface)', border: '1px solid var(--line)', minWidth: 220 }}>
                <Avatar name={a.name} color={a.avatarColor} />
                <div className="grow">
                  <div className="n">{a.name}</div>
                  <div className="p">
                    {a.activeDeliveries} active · {a.title}
                  </div>
                </div>
                <Pill tone={a.isAvailable ? 'green' : ''}>{a.isAvailable ? 'On duty' : 'Off duty'}</Pill>
              </div>
            ))}
          </div>
        </section>

        <div className="kanban">
          {COLS.map((c) => (
            <section key={c.key} className="kcol" aria-label={c.title}>
              <div className="spread" style={{ padding: '2px 4px' }}>
                <h3 className="h3">{c.title}</h3>
                <span className={`count-badge${c.key === 'exceptions' && (b?.[c.key].length ?? 0) > 0 ? ' red' : ''}`}>{b ? b[c.key].length : '–'}</span>
              </div>
              {!b && <Skeleton h={160} r={14} />}
              {b && b[c.key].length === 0 && <p className="muted" style={{ margin: '4px', fontSize: 13 }}>{c.empty}</p>}
              {b?.[c.key].map((o) => <DeliveryCard key={o.id} o={o} onOpen={(x) => setOpen({ id: x.id })} />)}
            </section>
          ))}
        </div>
        {b && !b.unassigned.length && !b.offered.length && !b.active.length && !b.exceptions.length && (
          <Empty icon="truck" title="No deliveries right now">
            Confirmed delivery orders show up here. <Link href="/admin">Go to orders</Link>
          </Empty>
        )}
        {open && (
          <Drawer onClose={() => setOpen(null)} title={<b>Order details</b>}>
            <OrderDetailLoader id={open.id} focus={open.focus} />
          </Drawer>
        )}
      </ActionEnvProvider>
    </AdminShell>
  );
}
