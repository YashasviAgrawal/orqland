// Mirrors the API contracts documented in docs/API.md.

export type Role = 'WORKSPACE_ADMIN' | 'DELIVERY_AGENT' | 'SERVICE_PROVIDER';
export type OrderKind = 'PRODUCT' | 'SERVICE';
export type FulfilmentType =
  | 'DELIVERY'
  | 'SCHEDULED_DELIVERY'
  | 'TAKEAWAY'
  | 'SCHEDULED_TAKEAWAY'
  | 'DINE_IN'
  | 'AT_PROVIDER_LOCATION'
  | 'AT_CUSTOMER_LOCATION'
  | 'EVENT'
  | 'WORKSHOP'
  | 'CONSULTATION'
  | 'ONLINE';
export type OrderStatus = 'PENDING_REVIEW' | 'CLARIFICATION_REQUESTED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING' | 'WALLET';
export type CodStatus = 'NOT_APPLICABLE' | 'PENDING_COLLECTION' | 'COLLECTED' | 'HANDOVER_SUBMITTED' | 'SETTLED' | 'DISCREPANCY';
export type RefundStatus = 'NOT_APPLICABLE' | 'PENDING' | 'REFUNDED' | 'FAILED';

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string | null;
  phone: string | null;
  isAvailable: boolean;
  avatarColor: string | null;
  workspace: { id: string; name: string; code: string; address: string };
}

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'datetime' | 'select' | 'agent' | 'provider' | 'schedule' | 'url';
export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
  help?: string;
  defaultValue?: string | number;
}
export type Tone = 'primary' | 'success' | 'danger' | 'neutral' | 'warning';
export interface ActionDescriptor {
  code: string;
  label: string;
  tone: Tone;
  kind: 'mutation' | 'link';
  fields: FieldDef[];
  confirm?: { title: string; body: string; cta: string };
  hint?: string;
}

export interface Stage {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming' | 'skipped' | 'failed';
}

export interface Assignment {
  id: string;
  agentId: string;
  agentName: string;
  agentPhone: string | null;
  agentTitle: string | null;
  status: 'OFFERED' | 'ACCEPTED';
  method: 'MANUAL' | 'AUTO';
  offeredAt: string;
  expiresAt: string | null;
  respondedAt: string | null;
  pickedUpAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
}

export interface OpenRequest {
  id: string;
  type: 'CANCELLATION' | 'RESCHEDULE' | 'RETURN';
  requestedByRole: string;
  reason: string | null;
  proposedStart: string | null;
  proposedSlotId: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  code: string;
  kind: OrderKind;
  fulfilmentType: FulfilmentType;
  fulfilmentLabel: string;
  bookingMode: 'INSTANT' | 'SLOT';
  status: { order: OrderStatus; fulfilment: string; payment: PaymentStatus; cod: CodStatus; refund: RefundStatus };
  statusLabel: { order: string; fulfilment: string };
  exception: string | null;
  exceptionLabel: string | null;
  customer: { id: string; name: string; phone: string; email: string | null };
  items: Array<{ id: string; listingId: string; name: string; quantity: number; unitPricePaise: number; totalPaise: number; tags: string[]; durationMinutes: number }>;
  amounts: { subtotalPaise: number; deliveryFeePaise: number; discountPaise: number; totalPaise: number; codCollectedPaise: number };
  paymentMethod: PaymentMethod;
  schedule: { start: string | null; end: string | null; slotId: string | null; slotTitle: string | null; capacity: number | null; reserved: number | null; seats: number };
  delivery: { address: string | null; lat: number | null; lng: number | null; distanceKm: number | null };
  note: string | null;
  tableNumber: string | null;
  eventDetails: { venue?: string; guests?: number; occasion?: string; requirements?: string } | null;
  provider: { id: string; name: string | null; phone: string | null; confirmedAt: string | null } | null;
  meeting: { link: string | null; notes: string | null } | null;
  prep: { minutes: number; extraMinutes: number; startedAt: string | null; dueAt: string | null; readyAt: string | null } | null;
  assignment: Assignment | null;
  openRequests: OpenRequest[];
  failure: { reason: string; notes: string | null; evidence: string | null } | null;
  clarificationNote: string | null;
  cancelReason: string | null;
  rejectReason: string | null;
  returnInfo: { confirmedAt: string | null; afterReturnAction: string | null; pickupAt: string | null };
  deliveredByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  stages: Stage[];
  actions: ActionDescriptor[];
}

export interface OrderDetail extends Order {
  workflow: { label: string; description: string; deliveryAgent: boolean; scheduled: boolean; online: boolean; attendance: boolean };
  timeline: Array<{ id: number; action: string; message: string; actor: { role: string; name: string | null }; reason: string | null; data: Record<string, unknown> | null; at: string }>;
  payments: Array<{ id: string; attempt: number; method: string; amountPaise: number; status: string; provider: string; reference: string | null; failureReason: string | null; createdAt: string; confirmedAt: string | null }>;
  codCollections: Array<{ id: string; agentId: string | null; agentName: string | null; amountPaise: number; collectedAt: string; settled: boolean; handover: { id: string; code: string; status: string } | null }>;
  assignments: Array<{ id: string; agentId: string; agentName: string; status: string; method: string; offeredAt: string; expiresAt: string | null; respondedAt: string | null; pickedUpAt: string | null; closedAt: string | null; reason: string | null }>;
  requests: Array<{ id: string; type: string; status: string; requestedByRole: string; reason: string | null; proposedStart: string | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }>;
}

export type ViewKey = 'all' | 'new' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'exceptions' | 'processing' | 'ongoing' | 'upcoming';

export interface Summary {
  counts: Record<ViewKey, number>;
  revenue: { todayPaise: number; yesterdayPaise: number; changePct: number | null };
  cod: { outstandingPaise: number; pendingHandovers: number };
  refundsPending: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Slot {
  id: string;
  listingId: string | null;
  listingName: string | null;
  kind: 'DELIVERY' | 'PICKUP' | 'SERVICE' | 'WORKSHOP_SESSION';
  providerId: string | null;
  providerName: string | null;
  title: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
  remaining: number;
  status: 'OPEN' | 'CLOSED' | 'COMPLETED';
  bookings: number;
  isPast: boolean;
}

export interface SlotDetail extends Slot {
  attendees: Array<{ orderId: string; code: string; customerName: string; customerPhone: string; seats: number; orderStatus: string; fulfilmentStatus: string; paymentStatus: string }>;
}

export interface Staff {
  id: string;
  name: string;
  phone: string | null;
  title: string | null;
  isAvailable: boolean;
  avatarColor: string | null;
  activeDeliveries: number;
  bookingsToday: number;
}

export interface Listing {
  id: string;
  kind: OrderKind;
  name: string;
  description: string | null;
  tags: string[];
  pricePaise: number;
  fulfilmentTypes: FulfilmentType[];
  bookingMode: 'INSTANT' | 'SLOT';
  autoConfirm: boolean;
  prepMinutes: number;
  durationMinutes: number;
  stock: number | null;
}

export interface Handover {
  id: string;
  code: string;
  agentId: string;
  agentName: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'DISCREPANCY' | 'RESOLVED';
  expectedPaise: number;
  declaredPaise: number;
  receivedPaise: number | null;
  differencePaise: number;
  agentNote: string | null;
  discrepancyReason: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  verifiedByName: string | null;
  resolvedAt: string | null;
  orders: Array<{ orderId: string; code: string; customerName: string; amountPaise: number; collectedAt: string }>;
}

export interface SettlementOverview {
  totals: { inHand: number; inHandover: number; disputed: number; outstandingPaise: number };
  agents: Array<{ agentId: string; agentName: string; avatarColor: string | null; inHandPaise: number; inHandoverPaise: number; disputedPaise: number; ordersInHand: number }>;
  outstanding: Array<{ collectionId: string; orderId: string; code: string; customerName: string; agentName: string; amountPaise: number; collectedAt: string; handoverCode: string | null; handoverStatus: string | null; codStatus: string }>;
  awaitingCollection: Array<{ orderId: string; code: string; customerName: string; duePaise: number; agentName: string | null; fulfilmentStatus: string }>;
  pendingHandovers: Handover[];
}

export interface AgentCash {
  inHandPaise: number;
  collections: Array<{ collectionId: string; orderId: string; code: string; customerName: string; amountPaise: number; collectedAt: string }>;
  handovers: Handover[];
}

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  orderId: string | null;
  orderCode: string | null;
  read: boolean;
  createdAt: string;
}
