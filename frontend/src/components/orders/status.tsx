import type { Order } from '@/lib/types';
import { Icon, IconName } from '@/components/ui/Icon';

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'dark' | '';

const ORDER_TONE: Record<string, Tone> = {
  PENDING_REVIEW: 'blue',
  CLARIFICATION_REQUESTED: 'amber',
  CONFIRMED: 'violet',
  IN_PROGRESS: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'red',
  REJECTED: 'red',
};

const FULFIL_TONE: Record<string, Tone> = {
  DELIVERED: 'green',
  COLLECTED: 'green',
  SERVED: 'green',
  SERVICE_COMPLETED: 'green',
  RETURN_RECEIVED: 'green',
  OUT_FOR_DELIVERY: 'green',
  PROVIDER_EN_ROUTE: 'green',
  IN_SERVICE: 'green',
  CHECKED_IN: 'green',
  PICKED_UP: 'green',
  READY: 'blue',
  PREPARING: 'amber',
  AWAITING_PREPARATION: 'blue',
  SCHEDULED: 'violet',
  AWAITING_SCHEDULE: 'amber',
  DELIVERY_FAILED: 'red',
  NO_SHOW: 'red',
  SERVICE_FAILED: 'red',
  PROVIDER_UNAVAILABLE: 'red',
  RETURNING: 'amber',
  RETURNED_TO_WORKSPACE: 'amber',
  RETURN_APPROVED: 'amber',
  CANCELLED: 'red',
};

export function Pill({ tone = '', children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`pill${tone ? ` pill-${tone}` : ''}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/** The headline status shown on a card: the most specific thing that is true right now. */
export function headline(o: Order): { text: string; tone: Tone } {
  if (o.status.order === 'PENDING_REVIEW') return { text: o.kind === 'PRODUCT' ? 'New order' : 'New booking', tone: 'blue' };
  if (o.status.order === 'CLARIFICATION_REQUESTED') return { text: 'Awaiting customer', tone: 'amber' };
  if (o.status.order === 'CANCELLED') return { text: o.status.fulfilment === 'RETURNING' ? 'Cancelled · parcel returning' : 'Cancelled', tone: 'red' };
  if (o.status.order === 'REJECTED') return { text: 'Rejected', tone: 'red' };
  const req = o.openRequests[0];
  if (req) return { text: req.type === 'CANCELLATION' ? 'Cancel requested' : req.type === 'RETURN' ? 'Return requested' : 'Reschedule requested', tone: 'red' };
  if (o.assignment?.status === 'OFFERED') return { text: 'Waiting for agent', tone: 'amber' };
  return { text: o.statusLabel.fulfilment, tone: FULFIL_TONE[o.status.fulfilment] ?? '' };
}

export function OrderStatusPill({ o }: { o: Order }) {
  return (
    <Pill tone={ORDER_TONE[o.status.order]} dot>
      {o.statusLabel.order}
    </Pill>
  );
}

export function PaymentPill({ o }: { o: Order }) {
  const s = o.status.payment;
  const label = s === 'PAID' ? 'Paid' : s === 'FAILED' ? 'Payment failed' : o.paymentMethod === 'CASH' ? 'Cash to collect' : 'Payment pending';
  return <Pill tone={s === 'PAID' ? 'green' : s === 'FAILED' ? 'red' : 'amber'}>{label}</Pill>;
}

export const COD_LABEL: Record<string, string> = {
  NOT_APPLICABLE: 'Not applicable',
  PENDING_COLLECTION: 'To collect',
  COLLECTED: 'With agent',
  HANDOVER_SUBMITTED: 'Handover submitted',
  SETTLED: 'Settled',
  DISCREPANCY: 'Discrepancy',
};
export const REFUND_LABEL: Record<string, string> = { NOT_APPLICABLE: 'None', PENDING: 'Refund pending', REFUNDED: 'Refunded', FAILED: 'Refund failed' };
export const PAYMENT_LABEL: Record<string, string> = { PENDING: 'Pending', PAID: 'Paid', FAILED: 'Failed' };

export function kindIcon(o: Pick<Order, 'fulfilmentType' | 'kind'>): IconName {
  switch (o.fulfilmentType) {
    case 'DELIVERY':
    case 'SCHEDULED_DELIVERY':
      return 'truck';
    case 'TAKEAWAY':
    case 'SCHEDULED_TAKEAWAY':
      return 'package';
    case 'DINE_IN':
      return 'store';
    case 'ONLINE':
      return 'video';
    case 'WORKSHOP':
      return 'users';
    case 'EVENT':
      return 'calendar';
    default:
      return 'briefcase';
  }
}

export function TypeTag({ o }: { o: Pick<Order, 'fulfilmentType' | 'kind' | 'fulfilmentLabel'> }) {
  return (
    <span className="pill pill-outline">
      <Icon name={kindIcon(o)} size={13} />
      {o.fulfilmentLabel}
    </span>
  );
}
