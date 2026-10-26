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
} from './enums';

/** The slice of an order the workflow engine needs to make decisions. */
export interface EngineOrder {
  id: string;
  kind: OrderKind;
  fulfilmentType: FulfilmentType;
  orderStatus: OrderStatus;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  codStatus: CodStatus;
  refundStatus: RefundStatus;
  /** Amounts are integers in paise to avoid floating point errors. */
  totalPaise: number;
  codCollectedPaise: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  slotId: string | null;
  usesSlots: boolean;
  providerId: string | null;
  providerConfirmedAt: string | null;
  meetingLink: string | null;
  returnConfirmedAt: string | null;
  afterReturnAction: 'RESCHEDULE' | null;
  /** Agent of the completed delivery (for COD recorded after delivery). */
  deliveredByAgentId: string | null;
  activeAssignment: {
    id: string;
    agentId: string;
    status: Extract<AssignmentStatus, 'OFFERED' | 'ACCEPTED'>;
    expiresAt: string | null;
  } | null;
  openRequests: Array<{
    id: string;
    type: RequestType;
    requestedByRole: Role;
    reason: string | null;
    proposedStart: string | null;
    proposedSlotId: string | null;
  }>;
}

export interface Actor {
  id: string;
  role: Role;
  name?: string;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'datetime'
  | 'select'
  | 'agent'
  | 'provider'
  | 'schedule'
  | 'url';

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

export type ActionTone = 'primary' | 'success' | 'danger' | 'neutral' | 'warning';

export interface ActionDescriptor {
  code: ActionCode;
  label: string;
  tone: ActionTone;
  /** mutation = changes state via POST /orders/:id/actions; link = navigation / view only */
  kind: 'mutation' | 'link';
  fields: FieldDef[];
  confirm?: { title: string; body: string; cta: string };
  hint?: string;
}

export type Audience = 'CUSTOMER' | 'ADMIN' | 'AGENT' | 'PROVIDER';

export type Effect =
  | { type: 'RELEASE_SLOT' }
  | { type: 'MOVE_SCHEDULE'; slotId: string | null; start: string | null }
  | { type: 'RESTORE_STOCK' }
  | { type: 'OFFER_ASSIGNMENT'; agentId: string | null; auto: boolean; excludeAgentIds: string[] }
  | { type: 'SET_ASSIGNMENT_STATUS'; status: AssignmentStatus; reason?: string | null }
  | { type: 'CHECK_PROVIDER_AVAILABLE'; providerId: string }
  | { type: 'RESOLVE_REQUEST'; requestId: string; status: 'APPROVED' | 'DECLINED'; note?: string | null }
  | { type: 'DECLINE_ALL_OPEN_REQUESTS'; note: string }
  | {
      type: 'CREATE_REQUEST';
      requestType: RequestType;
      reason: string | null;
      proposedStart: string | null;
      proposedSlotId: string | null;
    }
  | { type: 'RECORD_COD'; amountPaise: number; agentId: string | null; settledImmediately: boolean }
  | { type: 'CREATE_PAYMENT_ATTEMPT' }
  | { type: 'NOTIFY'; audience: Audience; title: string; body: string };

export interface ActionPlan {
  patch: Partial<OrderPatch>;
  effects: Effect[];
  event: { message: string; reason?: string | null; data?: Record<string, unknown> };
}

/** Columns the engine is allowed to change on an order. */
export interface OrderPatch {
  orderStatus: OrderStatus;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
  codStatus: CodStatus;
  refundStatus: RefundStatus;
  providerId: string | null;
  providerConfirmedAt: string | null;
  meetingLink: string | null;
  meetingNotes: string | null;
  returnConfirmedAt: string | null;
  afterReturnAction: 'RESCHEDULE' | null;
  extraPrepMinutes: number; // delta to add
  prepStartedAt: string;
  readyAt: string;
  completedAt: string;
  cancelledAt: string;
  cancelReason: string | null;
  rejectReason: string | null;
  clarificationNote: string | null;
  failureReason: string | null;
  failureNotes: string | null;
  failureEvidence: string | null;
  exception: string | null;
  returnPickupAt: string | null;
}

export type ActionCode =
  // review
  | 'ACCEPT'
  | 'ACCEPT_AND_START_PREP'
  | 'REJECT'
  | 'REQUEST_CLARIFICATION'
  | 'CANCEL'
  | 'CONFIRM_CANCELLATION'
  | 'DECLINE_CANCELLATION'
  // preparation & scheduling
  | 'START_PREPARATION'
  | 'ADD_PREP_TIME'
  | 'MARK_READY'
  | 'CONFIRM_SCHEDULE'
  | 'RESCHEDULE'
  | 'APPROVE_RESCHEDULE_REQUEST'
  | 'DECLINE_RESCHEDULE_REQUEST'
  | 'VIEW_AVAILABILITY'
  | 'MANAGE_CAPACITY'
  // delivery & collection
  | 'ASSIGN_AGENT'
  | 'AUTO_ASSIGN_AGENT'
  | 'REASSIGN_AGENT'
  | 'TRACK_DELIVERY'
  | 'CONFIRM_PICKUP_HANDOVER'
  | 'CONFIRM_DELIVERED'
  | 'CONFIRM_SERVED'
  | 'CONFIRM_SERVICE_COMPLETION'
  | 'RETRY_DELIVERY'
  | 'APPROVE_RETURN'
  | 'DECLINE_RETURN'
  | 'CONFIRM_RETURN_RECEIVED'
  | 'CONFIRM_RETURN_PICKUP'
  // services
  | 'ASSIGN_PROVIDER'
  | 'REPORT_PROVIDER_UNAVAILABLE'
  | 'SET_MEETING_DETAILS'
  | 'CONFIRM_APPOINTMENT'
  | 'START_TRAVEL'
  | 'MARK_ATTENDED'
  | 'START_SERVICE'
  | 'MARK_SERVICE_COMPLETED'
  | 'REPORT_CUSTOMER_UNAVAILABLE'
  | 'MARK_SERVICE_FAILED'
  | 'REQUEST_RESCHEDULING'
  // payment
  | 'VIEW_PAYMENT_DETAILS'
  | 'RECORD_COD_COLLECTED'
  | 'RETRY_PAYMENT'
  | 'UPDATE_REFUND_STATUS'
  // delivery agent
  | 'ACCEPT_DELIVERY'
  | 'REJECT_DELIVERY'
  | 'NAVIGATE_TO_PICKUP'
  | 'NAVIGATE_TO_CUSTOMER'
  | 'CONFIRM_PICKUP'
  | 'START_DELIVERY'
  | 'CONTACT_CUSTOMER'
  | 'MARK_DELIVERED'
  | 'MARK_DELIVERY_FAILED'
  | 'RETURN_TO_WORKSPACE'
  // customer simulation (sample API — customer UI is out of scope)
  | 'CUSTOMER_REQUEST_CANCELLATION'
  | 'CUSTOMER_REQUEST_RESCHEDULE'
  | 'CUSTOMER_REQUEST_RETURN'
  | 'CUSTOMER_RESPOND_CLARIFICATION'
  // system
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'ASSIGNMENT_EXPIRED';
