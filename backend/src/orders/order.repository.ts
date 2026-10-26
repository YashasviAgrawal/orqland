import type { Db } from '../database/database.service';
import type { EngineOrder } from '../domain/types';
import type {
  AssignmentStatus,
  CodStatus,
  FulfilmentStatus,
  FulfilmentType,
  OrderKind,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  RequestType,
  Role,
  BookingMode,
} from '../domain/enums';

/** Raw row returned by ORDER_SELECT. */
export interface OrderRow {
  id: string;
  code: string;
  workspace_id: string;
  customer_id: string;
  kind: OrderKind;
  fulfilment_type: FulfilmentType;
  booking_mode: BookingMode;
  order_status: OrderStatus;
  fulfilment_status: FulfilmentStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  cod_status: CodStatus;
  refund_status: RefundStatus;
  subtotal_paise: number;
  delivery_fee_paise: number;
  discount_paise: number;
  total_paise: number;
  cod_collected_paise: number;
  slot_id: string | null;
  seats: number;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  distance_km: number | null;
  customer_note: string | null;
  table_number: string | null;
  event_details: Record<string, unknown> | null;
  provider_id: string | null;
  provider_confirmed_at: Date | null;
  blocks_provider: boolean;
  meeting_link: string | null;
  meeting_notes: string | null;
  prep_minutes: number;
  extra_prep_minutes: number;
  prep_started_at: Date | null;
  ready_at: Date | null;
  delivered_by_agent_id: string | null;
  clarification_note: string | null;
  cancel_reason: string | null;
  reject_reason: string | null;
  failure_reason: string | null;
  failure_notes: string | null;
  failure_evidence: string | null;
  return_confirmed_at: Date | null;
  after_return_action: 'RESCHEDULE' | null;
  return_pickup_at: Date | null;
  exception: string | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  // joins
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  slot_capacity: number | null;
  slot_reserved: number | null;
  slot_title: string | null;
  items: Array<{ id: string; listingId: string; name: string; quantity: number; unitPricePaise: number; totalPaise: number; tags: string[]; durationMinutes: number }>;
  assignment: null | {
    id: string;
    agentId: string;
    agentName: string;
    agentPhone: string | null;
    agentTitle: string | null;
    status: Extract<AssignmentStatus, 'OFFERED' | 'ACCEPTED'>;
    method: 'MANUAL' | 'AUTO';
    offeredAt: string;
    expiresAt: string | null;
    respondedAt: string | null;
    pickedUpAt: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastLocationAt: string | null;
  };
  open_requests: Array<{
    id: string;
    type: RequestType;
    requestedByRole: Role;
    reason: string | null;
    proposedStart: string | null;
    proposedSlotId: string | null;
    createdAt: string;
  }>;
}

export const ORDER_SELECT = `
SELECT o.*,
  c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
  p.name AS provider_name, p.phone AS provider_phone,
  s.capacity AS slot_capacity, s.reserved AS slot_reserved, s.title AS slot_title,
  COALESCE((
    SELECT json_agg(json_build_object('id', i.id, 'listingId', i.listing_id, 'name', i.name, 'quantity', i.quantity,
      'unitPricePaise', i.unit_price_paise, 'totalPaise', i.total_paise, 'tags', l.tags, 'durationMinutes', l.duration_minutes) ORDER BY i.name)
    FROM order_items i JOIN listings l ON l.id = i.listing_id WHERE i.order_id = o.id), '[]'::json) AS items,
  (SELECT json_build_object('id', a.id, 'agentId', a.agent_id, 'agentName', u.name, 'agentPhone', u.phone, 'agentTitle', u.title,
      'status', a.status, 'method', a.method, 'offeredAt', a.offered_at, 'expiresAt', a.expires_at, 'respondedAt', a.responded_at,
      'pickedUpAt', a.picked_up_at, 'lastLat', a.last_lat, 'lastLng', a.last_lng, 'lastLocationAt', a.last_location_at)
   FROM delivery_assignments a JOIN users u ON u.id = a.agent_id
   WHERE a.order_id = o.id AND a.status IN ('OFFERED','ACCEPTED') LIMIT 1) AS assignment,
  COALESCE((
    SELECT json_agg(json_build_object('id', r.id, 'type', r.type, 'requestedByRole', r.requested_by_role, 'reason', r.reason,
      'proposedStart', r.proposed_start, 'proposedSlotId', r.proposed_slot_id, 'createdAt', r.created_at) ORDER BY r.created_at)
    FROM order_requests r WHERE r.order_id = o.id AND r.status = 'PENDING'), '[]'::json) AS open_requests
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN users p ON p.id = o.provider_id
LEFT JOIN slots s ON s.id = o.slot_id`;

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function toEngineOrder(r: OrderRow): EngineOrder {
  return {
    id: r.id,
    kind: r.kind,
    fulfilmentType: r.fulfilment_type,
    orderStatus: r.order_status,
    fulfilmentStatus: r.fulfilment_status,
    paymentStatus: r.payment_status,
    paymentMethod: r.payment_method,
    codStatus: r.cod_status,
    refundStatus: r.refund_status,
    totalPaise: r.total_paise,
    codCollectedPaise: r.cod_collected_paise,
    scheduledStart: iso(r.scheduled_start),
    scheduledEnd: iso(r.scheduled_end),
    slotId: r.slot_id,
    usesSlots: !!r.slot_id || r.booking_mode === 'SLOT',
    providerId: r.provider_id,
    providerConfirmedAt: iso(r.provider_confirmed_at),
    meetingLink: r.meeting_link,
    returnConfirmedAt: iso(r.return_confirmed_at),
    afterReturnAction: r.after_return_action,
    deliveredByAgentId: r.delivered_by_agent_id,
    activeAssignment: r.assignment
      ? { id: r.assignment.id, agentId: r.assignment.agentId, status: r.assignment.status, expiresAt: r.assignment.expiresAt }
      : null,
    openRequests: r.open_requests.map((q) => ({
      id: q.id,
      type: q.type,
      requestedByRole: q.requestedByRole,
      reason: q.reason,
      proposedStart: q.proposedStart,
      proposedSlotId: q.proposedSlotId,
    })),
  };
}

export async function findOrderRow(db: Db, workspaceId: string, id: string, lock = false): Promise<OrderRow | null> {
  if (lock) {
    // lock the order row first (serialises concurrent actions on the same order)
    const locked = await db.query('SELECT id FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, workspaceId]);
    if (!locked.rows.length) return null;
  }
  const res = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1 AND o.workspace_id = $2`, [id, workspaceId]);
  return res.rows[0] ?? null;
}

export { iso };
