/**
 * Orqland Order Management — domain enums.
 *
 * Four statuses are deliberately kept SEPARATE (requirement §9):
 *   1. OrderStatus        – the business lifecycle of the order/booking
 *   2. FulfilmentStatus   – the operational progress (prep, delivery, service…)
 *   3. PaymentStatus      – whether money has been confirmed
 *   4. CodStatus          – cash-on-delivery collection & settlement
 * plus RefundStatus, which is recorded separately when a paid order is cancelled (§7).
 *
 * This file has zero framework imports so it can be shared with the frontend
 * and unit-tested in isolation.
 */

export const OrderKind = { PRODUCT: 'PRODUCT', SERVICE: 'SERVICE' } as const;
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];

export const FulfilmentType = {
  // Products (§2A)
  DELIVERY: 'DELIVERY',
  SCHEDULED_DELIVERY: 'SCHEDULED_DELIVERY',
  TAKEAWAY: 'TAKEAWAY',
  SCHEDULED_TAKEAWAY: 'SCHEDULED_TAKEAWAY',
  DINE_IN: 'DINE_IN',
  // Services (§2B)
  AT_PROVIDER_LOCATION: 'AT_PROVIDER_LOCATION',
  AT_CUSTOMER_LOCATION: 'AT_CUSTOMER_LOCATION',
  EVENT: 'EVENT',
  WORKSHOP: 'WORKSHOP',
  CONSULTATION: 'CONSULTATION',
  ONLINE: 'ONLINE',
} as const;
export type FulfilmentType = (typeof FulfilmentType)[keyof typeof FulfilmentType];

export const BookingMode = { INSTANT: 'INSTANT', SLOT: 'SLOT' } as const;
export type BookingMode = (typeof BookingMode)[keyof typeof BookingMode];

export const OrderStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  CLARIFICATION_REQUESTED: 'CLARIFICATION_REQUESTED',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const FulfilmentStatus = {
  NOT_STARTED: 'NOT_STARTED', // awaiting admin review
  AWAITING_PREPARATION: 'AWAITING_PREPARATION',
  AWAITING_SCHEDULE: 'AWAITING_SCHEDULE', // accepted, schedule still to be confirmed (event / at-customer)
  SCHEDULED: 'SCHEDULED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURNING: 'RETURNING', // agent bringing the order back
  RETURNED_TO_WORKSPACE: 'RETURNED_TO_WORKSPACE',
  COLLECTED: 'COLLECTED', // take-away handover done
  SERVED: 'SERVED', // dine-in
  PROVIDER_EN_ROUTE: 'PROVIDER_EN_ROUTE',
  CHECKED_IN: 'CHECKED_IN', // customer attended
  IN_SERVICE: 'IN_SERVICE',
  SERVICE_COMPLETED: 'SERVICE_COMPLETED',
  NO_SHOW: 'NO_SHOW', // customer unavailable / missed appointment
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  SERVICE_FAILED: 'SERVICE_FAILED',
  RETURN_APPROVED: 'RETURN_APPROVED', // customer return after delivery – pickup arranged
  RETURN_RECEIVED: 'RETURN_RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type FulfilmentStatus = (typeof FulfilmentStatus)[keyof typeof FulfilmentStatus];

export const PaymentMethod = {
  CASH: 'CASH', // cash / COD – collected on fulfilment
  UPI: 'UPI',
  CARD: 'CARD',
  NET_BANKING: 'NET_BANKING',
  WALLET: 'WALLET',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const CodStatus = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING_COLLECTION: 'PENDING_COLLECTION',
  COLLECTED: 'COLLECTED', // cash is with the delivery agent
  HANDOVER_SUBMITTED: 'HANDOVER_SUBMITTED',
  SETTLED: 'SETTLED',
  DISCREPANCY: 'DISCREPANCY',
} as const;
export type CodStatus = (typeof CodStatus)[keyof typeof CodStatus];

export const RefundStatus = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING: 'PENDING',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const AssignmentStatus = {
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED', // reassigned / order cancelled
  COMPLETED: 'COMPLETED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const RequestType = {
  CANCELLATION: 'CANCELLATION',
  RESCHEDULE: 'RESCHEDULE',
  RETURN: 'RETURN',
} as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];

export const RequestStatus = { PENDING: 'PENDING', APPROVED: 'APPROVED', DECLINED: 'DECLINED' } as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

export const Role = {
  ADMIN: 'WORKSPACE_ADMIN',
  STAFF: 'SERVICE_PROVIDER', // service provider / workspace staff
  AGENT: 'DELIVERY_AGENT',
  CUSTOMER: 'CUSTOMER', // used only by the sample customer-simulation API
  SYSTEM: 'SYSTEM', // scheduled jobs, payment confirmations
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const HandoverStatus = {
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  DISCREPANCY: 'DISCREPANCY',
  RESOLVED: 'RESOLVED',
} as const;
export type HandoverStatus = (typeof HandoverStatus)[keyof typeof HandoverStatus];

export const SlotKind = {
  DELIVERY: 'DELIVERY',
  PICKUP: 'PICKUP',
  SERVICE: 'SERVICE',
  WORKSHOP_SESSION: 'WORKSHOP_SESSION',
} as const;
export type SlotKind = (typeof SlotKind)[keyof typeof SlotKind];

export const PRODUCT_TYPES: FulfilmentType[] = [
  FulfilmentType.DELIVERY,
  FulfilmentType.SCHEDULED_DELIVERY,
  FulfilmentType.TAKEAWAY,
  FulfilmentType.SCHEDULED_TAKEAWAY,
  FulfilmentType.DINE_IN,
];
export const SERVICE_TYPES: FulfilmentType[] = [
  FulfilmentType.AT_PROVIDER_LOCATION,
  FulfilmentType.AT_CUSTOMER_LOCATION,
  FulfilmentType.EVENT,
  FulfilmentType.WORKSHOP,
  FulfilmentType.CONSULTATION,
  FulfilmentType.ONLINE,
];

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

export const ONLINE_METHODS: PaymentMethod[] = [
  PaymentMethod.UPI,
  PaymentMethod.CARD,
  PaymentMethod.NET_BANKING,
  PaymentMethod.WALLET,
];
