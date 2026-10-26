import { availableActions, EXCEPTION_LABEL } from '../domain/engine';
import { FULFILMENT_STATUS_LABEL, ORDER_STATUS_LABEL, stagesFor, workflowOf } from '../domain/workflows';
import type { Actor } from '../domain/types';
import { iso, OrderRow, toEngineOrder } from './order.repository';

/** Public API shape of an order/booking. Shared by list and detail endpoints. */
export function toOrderView(r: OrderRow, actor: Actor) {
  const wf = workflowOf(r.fulfilment_type);
  const prepTotal = r.prep_minutes + r.extra_prep_minutes;
  const prepDueAt = r.prep_started_at ? new Date(new Date(r.prep_started_at).getTime() + prepTotal * 60_000).toISOString() : null;
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    fulfilmentType: r.fulfilment_type,
    fulfilmentLabel: wf.label,
    bookingMode: r.booking_mode,
    status: {
      order: r.order_status,
      fulfilment: r.fulfilment_status,
      payment: r.payment_status,
      cod: r.cod_status,
      refund: r.refund_status,
    },
    statusLabel: {
      order: ORDER_STATUS_LABEL[r.order_status],
      fulfilment: FULFILMENT_STATUS_LABEL[r.fulfilment_status],
    },
    exception: r.exception,
    exceptionLabel: r.exception ? EXCEPTION_LABEL[r.exception] ?? r.exception : null,
    customer: { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, email: r.customer_email },
    items: r.items,
    amounts: {
      subtotalPaise: r.subtotal_paise,
      deliveryFeePaise: r.delivery_fee_paise,
      discountPaise: r.discount_paise,
      totalPaise: r.total_paise,
      codCollectedPaise: r.cod_collected_paise,
    },
    paymentMethod: r.payment_method,
    schedule: {
      start: iso(r.scheduled_start),
      end: iso(r.scheduled_end),
      slotId: r.slot_id,
      slotTitle: r.slot_title,
      capacity: r.slot_capacity,
      reserved: r.slot_reserved,
      seats: r.seats,
    },
    delivery: { address: r.delivery_address, lat: r.delivery_lat, lng: r.delivery_lng, distanceKm: r.distance_km },
    note: r.customer_note,
    tableNumber: r.table_number,
    eventDetails: r.event_details,
    provider: r.provider_id ? { id: r.provider_id, name: r.provider_name, phone: r.provider_phone, confirmedAt: iso(r.provider_confirmed_at) } : null,
    meeting: wf.online ? { link: r.meeting_link, notes: r.meeting_notes } : null,
    prep: wf.preparation
      ? { minutes: r.prep_minutes, extraMinutes: r.extra_prep_minutes, startedAt: iso(r.prep_started_at), dueAt: prepDueAt, readyAt: iso(r.ready_at) }
      : null,
    assignment: r.assignment,
    openRequests: r.open_requests,
    failure: r.failure_reason ? { reason: r.failure_reason, notes: r.failure_notes, evidence: r.failure_evidence } : null,
    clarificationNote: r.clarification_note,
    cancelReason: r.cancel_reason,
    rejectReason: r.reject_reason,
    returnInfo: {
      confirmedAt: iso(r.return_confirmed_at),
      afterReturnAction: r.after_return_action,
      pickupAt: iso(r.return_pickup_at),
    },
    deliveredByAgentId: r.delivered_by_agent_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    completedAt: iso(r.completed_at),
    cancelledAt: iso(r.cancelled_at),
    version: r.version,
    stages: stagesFor({
      fulfilmentType: r.fulfilment_type,
      orderStatus: r.order_status,
      fulfilmentStatus: r.fulfilment_status,
      paymentStatus: r.payment_status,
    }),
    actions: availableActions(toEngineOrder(r), actor),
  };
}

export type OrderView = ReturnType<typeof toOrderView>;
