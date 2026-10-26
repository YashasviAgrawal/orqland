import {
  FulfilmentStatus as F,
  FulfilmentType as T,
  FulfilmentType,
  FulfilmentStatus,
  OrderKind,
  OrderStatus,
  PaymentStatus,
  SlotKind,
} from './enums';

/**
 * Per-fulfilment-type workflow configuration (§2, §4).
 * The engine reads these flags to decide which stages and actions apply,
 * so "not every order follows the same delivery process".
 */
export interface WorkflowConfig {
  type: FulfilmentType;
  kind: OrderKind;
  label: string;
  shortLabel: string;
  description: string;
  /** Product goes through preparation (start / extra time / ready). */
  preparation: boolean;
  /** A delivery agent is required. */
  deliveryAgent: boolean;
  /** Customer collects at the business location; staff confirms handover. */
  customerCollection: boolean;
  /** Dine-in: ready-to-serve → served. */
  serve: boolean;
  /** Customer picks a date/time slot. */
  scheduled: boolean;
  /** Slot kind used for availability/capacity. */
  slotKind: SlotKind | null;
  /** Admin must always review (never auto-confirm). */
  alwaysReview: boolean;
  /** After acceptance the schedule must be explicitly confirmed by admin. */
  scheduleConfirmation: boolean;
  /** Provider travels to the customer. */
  providerTravels: boolean;
  /** Attendance can be recorded (customer comes to us / joins). */
  attendance: boolean;
  /** Online meeting details apply. */
  online: boolean;
  /** Seats/capacity per session. */
  seatCapacity: boolean;
  /** Provider-level conflict prevention (one booking per provider per time). */
  providerConflict: boolean;
  /** Address of the customer is required. */
  requiresCustomerAddress: boolean;
}

const base = {
  preparation: false,
  deliveryAgent: false,
  customerCollection: false,
  serve: false,
  scheduled: false,
  slotKind: null,
  alwaysReview: false,
  scheduleConfirmation: false,
  providerTravels: false,
  attendance: false,
  online: false,
  seatCapacity: false,
  providerConflict: false,
  requiresCustomerAddress: false,
};

export const WORKFLOWS: Record<FulfilmentType, WorkflowConfig> = {
  [T.DELIVERY]: {
    ...base,
    type: T.DELIVERY,
    kind: OrderKind.PRODUCT,
    label: 'Delivery to Customer',
    shortLabel: 'Delivery',
    description: 'Prepared and delivered by a delivery agent.',
    preparation: true,
    deliveryAgent: true,
    requiresCustomerAddress: true,
  },
  [T.SCHEDULED_DELIVERY]: {
    ...base,
    type: T.SCHEDULED_DELIVERY,
    kind: OrderKind.PRODUCT,
    label: 'Scheduled Delivery',
    shortLabel: 'Sched. delivery',
    description: 'Delivered by an agent in the slot the customer selected.',
    preparation: true,
    deliveryAgent: true,
    scheduled: true,
    slotKind: SlotKind.DELIVERY,
    requiresCustomerAddress: true,
  },
  [T.TAKEAWAY]: {
    ...base,
    type: T.TAKEAWAY,
    kind: OrderKind.PRODUCT,
    label: 'Take Away / Pick-Up',
    shortLabel: 'Take away',
    description: 'Customer collects from the business location. No agent required.',
    preparation: true,
    customerCollection: true,
  },
  [T.SCHEDULED_TAKEAWAY]: {
    ...base,
    type: T.SCHEDULED_TAKEAWAY,
    kind: OrderKind.PRODUCT,
    label: 'Scheduled Take Away',
    shortLabel: 'Sched. pickup',
    description: 'Customer collects in the pickup slot they selected.',
    preparation: true,
    customerCollection: true,
    scheduled: true,
    slotKind: SlotKind.PICKUP,
  },
  [T.DINE_IN]: {
    ...base,
    type: T.DINE_IN,
    kind: OrderKind.PRODUCT,
    label: 'Dine In',
    shortLabel: 'Dine in',
    description: 'Prepared and served at the business location.',
    preparation: true,
    serve: true,
  },
  [T.AT_PROVIDER_LOCATION]: {
    ...base,
    type: T.AT_PROVIDER_LOCATION,
    kind: OrderKind.SERVICE,
    label: 'At Your Location',
    shortLabel: 'At our location',
    description: "Service delivered at the provider's business location.",
    scheduled: true,
    slotKind: SlotKind.SERVICE,
    attendance: true,
  },
  [T.AT_CUSTOMER_LOCATION]: {
    ...base,
    type: T.AT_CUSTOMER_LOCATION,
    kind: OrderKind.SERVICE,
    label: "At Customer's Location",
    shortLabel: 'At customer',
    description: 'Provider or team travels to the customer address.',
    scheduled: true,
    slotKind: SlotKind.SERVICE,
    scheduleConfirmation: true,
    providerTravels: true,
    providerConflict: true,
    requiresCustomerAddress: true,
  },
  [T.EVENT]: {
    ...base,
    type: T.EVENT,
    kind: OrderKind.SERVICE,
    label: 'Event Service',
    shortLabel: 'Event',
    description: 'Service delivered at an event or function venue.',
    scheduled: true,
    slotKind: SlotKind.SERVICE,
    alwaysReview: true,
    scheduleConfirmation: true,
    providerTravels: true,
    requiresCustomerAddress: true,
  },
  [T.WORKSHOP]: {
    ...base,
    type: T.WORKSHOP,
    kind: OrderKind.SERVICE,
    label: 'Workshop',
    shortLabel: 'Workshop',
    description: 'Seats booked in a workshop session with limited capacity.',
    scheduled: true,
    slotKind: SlotKind.WORKSHOP_SESSION,
    attendance: true,
    seatCapacity: true,
  },
  [T.CONSULTATION]: {
    ...base,
    type: T.CONSULTATION,
    kind: OrderKind.SERVICE,
    label: 'Customer Visit / Consulting',
    shortLabel: 'Consulting',
    description: 'Consultation, demo or short visit with conflict-free scheduling.',
    scheduled: true,
    slotKind: SlotKind.SERVICE,
    attendance: true,
    providerConflict: true,
  },
  [T.ONLINE]: {
    ...base,
    type: T.ONLINE,
    kind: OrderKind.SERVICE,
    label: 'Online',
    shortLabel: 'Online',
    description: 'Virtual service via slot or instant booking.',
    scheduled: true,
    slotKind: SlotKind.SERVICE,
    attendance: true,
    online: true,
    providerConflict: true,
  },
};

export function workflowOf(type: FulfilmentType): WorkflowConfig {
  const wf = WORKFLOWS[type];
  if (!wf) throw new Error(`Unknown fulfilment type ${type}`);
  return wf;
}

/** Fulfilment statuses that count as a successful fulfilment. */
export const FULFILLED_STATUSES: FulfilmentStatus[] = [F.DELIVERED, F.COLLECTED, F.SERVED, F.SERVICE_COMPLETED];

/** Fulfilment statuses that indicate an exception needing attention. */
export const EXCEPTION_FULFILMENT_STATUSES: FulfilmentStatus[] = [
  F.DELIVERY_FAILED,
  F.RETURNING,
  F.RETURNED_TO_WORKSPACE,
  F.NO_SHOW,
  F.PROVIDER_UNAVAILABLE,
  F.SERVICE_FAILED,
  F.RETURN_APPROVED,
];

// ---------------------------------------------------------------------------
// Timeline stages (§4 "Standard Order and Booking Lifecycle", adapted per type)
// ---------------------------------------------------------------------------

export type StageState = 'done' | 'current' | 'upcoming' | 'skipped' | 'failed';
export interface Stage {
  key: string;
  label: string;
  state: StageState;
  hint?: string;
}

interface StageDef {
  key: string;
  label: string;
  /** fulfilment statuses at which this stage is the CURRENT stage */
  current: FulfilmentStatus[];
}

function stageDefsFor(type: FulfilmentType): StageDef[] {
  const wf = workflowOf(type);
  const defs: StageDef[] = [{ key: 'received', label: wf.kind === 'PRODUCT' ? 'Order received' : 'Booking received', current: [F.NOT_STARTED] }];
  defs.push({ key: 'confirmed', label: 'Confirmed', current: [F.AWAITING_SCHEDULE] });

  if (wf.kind === 'PRODUCT') {
    if (wf.scheduled) defs.push({ key: 'scheduled', label: 'Scheduled', current: [F.SCHEDULED] });
    defs.push({ key: 'preparation', label: 'Preparation', current: [F.AWAITING_PREPARATION, F.PREPARING] });
    if (wf.deliveryAgent) {
      defs.push({ key: 'ready', label: 'Ready & assigned', current: [F.READY] });
      defs.push({ key: 'in_progress', label: 'Out for delivery', current: [F.PICKED_UP, F.OUT_FOR_DELIVERY, F.DELIVERY_FAILED, F.RETURNING, F.RETURNED_TO_WORKSPACE] });
      defs.push({ key: 'fulfilment', label: 'Delivered', current: [] });
    } else if (wf.customerCollection) {
      defs.push({ key: 'ready', label: 'Ready for pickup', current: [F.READY] });
      defs.push({ key: 'fulfilment', label: 'Collected', current: [] });
    } else {
      defs.push({ key: 'ready', label: 'Ready to serve', current: [F.READY] });
      defs.push({ key: 'fulfilment', label: 'Served', current: [] });
    }
  } else {
    defs.push({ key: 'scheduled', label: 'Scheduled', current: [F.SCHEDULED, F.PROVIDER_UNAVAILABLE, F.NO_SHOW] });
    const inProgress: FulfilmentStatus[] = [F.IN_SERVICE, F.SERVICE_FAILED];
    if (wf.providerTravels) inProgress.unshift(F.PROVIDER_EN_ROUTE);
    if (wf.attendance) inProgress.unshift(F.CHECKED_IN);
    defs.push({ key: 'in_progress', label: 'In progress', current: inProgress });
    defs.push({ key: 'fulfilment', label: wf.type === T.WORKSHOP ? 'Attended & completed' : 'Service completed', current: [] });
  }
  defs.push({ key: 'payment', label: 'Payment', current: [] });
  defs.push({ key: 'completed', label: 'Completed', current: [] });
  return defs;
}

export interface StageInput {
  fulfilmentType: FulfilmentType;
  orderStatus: OrderStatus;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
}

/** Build the stepper shown in the UI. Only stages relevant to the fulfilment type are returned. */
export function stagesFor(o: StageInput): Stage[] {
  const defs = stageDefsFor(o.fulfilmentType);
  const idxOf = (k: string) => defs.findIndex((d) => d.key === k);
  let currentIdx: number;
  const fulfilled = FULFILLED_STATUSES.includes(o.fulfilmentStatus) || o.fulfilmentStatus === F.RETURN_APPROVED || o.fulfilmentStatus === F.RETURN_RECEIVED;

  if (o.orderStatus === 'COMPLETED') currentIdx = defs.length; // everything done
  else if (fulfilled) currentIdx = o.paymentStatus === 'PAID' ? idxOf('completed') : idxOf('payment');
  else {
    currentIdx = defs.findIndex((d) => d.current.includes(o.fulfilmentStatus));
    if (currentIdx < 0) currentIdx = 0;
  }

  const terminatedEarly = o.orderStatus === 'CANCELLED' || o.orderStatus === 'REJECTED';
  const failedStatuses: FulfilmentStatus[] = [F.DELIVERY_FAILED, F.NO_SHOW, F.PROVIDER_UNAVAILABLE, F.SERVICE_FAILED];

  return defs.map((d, i) => {
    let state: StageState;
    if (i < currentIdx) state = 'done';
    else if (i === currentIdx) state = failedStatuses.includes(o.fulfilmentStatus) || terminatedEarly ? 'failed' : 'current';
    else state = terminatedEarly ? 'skipped' : 'upcoming';
    if (o.orderStatus === 'COMPLETED') state = 'done';
    return { key: d.key, label: d.label, state };
  });
}

// ---------------------------------------------------------------------------
// Human labels (shared with the UI)
// ---------------------------------------------------------------------------

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_REVIEW: 'New',
  CLARIFICATION_REQUESTED: 'Awaiting customer',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export const FULFILMENT_STATUS_LABEL: Record<FulfilmentStatus, string> = {
  NOT_STARTED: 'Awaiting review',
  AWAITING_PREPARATION: 'Waiting for preparation',
  AWAITING_SCHEDULE: 'Schedule to confirm',
  SCHEDULED: 'Scheduled',
  PREPARING: 'In preparation',
  READY: 'Ready',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  RETURNING: 'Returning to workspace',
  RETURNED_TO_WORKSPACE: 'Returned to workspace',
  COLLECTED: 'Collected',
  SERVED: 'Served',
  PROVIDER_EN_ROUTE: 'Provider en route',
  CHECKED_IN: 'Customer attended',
  IN_SERVICE: 'Service in progress',
  SERVICE_COMPLETED: 'Service completed',
  NO_SHOW: 'Customer unavailable',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  SERVICE_FAILED: 'Service failed',
  RETURN_APPROVED: 'Return approved',
  RETURN_RECEIVED: 'Return received',
  CANCELLED: 'Stopped',
};
