/**
 * Workflow engine — the single source of truth for:
 *   • which actions/buttons are available for an order, a fulfilment type, a status and a role (§6)
 *   • which status transitions are legal (safe status transitions, §9)
 *   • what side-effects each action has (capacity release, assignment, COD, notifications…)
 *
 * The backend uses `planAction()` to validate and execute; the frontend renders exactly the
 * descriptors returned by `availableActions()`, so the UI can never show a button the backend
 * would reject.
 */
import {
  CodStatus as C,
  FulfilmentStatus as F,
  FulfilmentStatus,
  FulfilmentType as T,
  ONLINE_METHODS,
  OrderStatus as O,
  OrderStatus,
  PaymentStatus as P,
  RefundStatus as R,
  Role,
  TERMINAL_ORDER_STATUSES,
} from './enums';
import { EXCEPTION_FULFILMENT_STATUSES, FULFILLED_STATUSES, WorkflowConfig, workflowOf } from './workflows';
import type {
  ActionCode,
  ActionDescriptor,
  ActionPlan,
  ActionTone,
  Actor,
  Audience,
  Effect,
  EngineOrder,
  FieldDef,
  OrderPatch,
} from './types';

export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'ACTION_NOT_ALLOWED'
      | 'FORBIDDEN'
      | 'VALIDATION'
      | 'UNKNOWN_ACTION'
      | 'CONFLICT',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const ADMIN = Role.ADMIN;
const STAFF = Role.STAFF;
const AGENT = Role.AGENT;
const CUSTOMER = Role.CUSTOMER;
const SYSTEM = Role.SYSTEM;

type Input = Record<string, unknown>;

interface ActionDef {
  roles: Role[];
  kind?: 'mutation' | 'link';
  tone: ActionTone | ((o: EngineOrder, a: Actor) => ActionTone);
  label: string | ((o: EngineOrder, a: Actor) => string);
  /** Returns true when allowed, or a string explaining why it is not. */
  guard: (o: EngineOrder, a: Actor, wf: WorkflowConfig) => boolean;
  fields?: (o: EngineOrder, a: Actor, wf: WorkflowConfig) => FieldDef[];
  confirm?: (o: EngineOrder, a: Actor) => { title: string; body: string; cta: string };
  hint?: (o: EngineOrder) => string | undefined;
  plan?: (o: EngineOrder, a: Actor, input: Input, wf: WorkflowConfig) => ActionPlan;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const now = () => new Date().toISOString();
const isTerminal = (o: EngineOrder) => TERMINAL_ORDER_STATUSES.includes(o.orderStatus);
const isActive = (o: EngineOrder) => !isTerminal(o);
const inReview = (o: EngineOrder) => o.orderStatus === O.PENDING_REVIEW || o.orderStatus === O.CLARIFICATION_REQUESTED;
const confirmedOrLater = (o: EngineOrder) => o.orderStatus === O.CONFIRMED || o.orderStatus === O.IN_PROGRESS;
const f = (o: EngineOrder, ...s: FulfilmentStatus[]) => s.includes(o.fulfilmentStatus);
const isProduct = (o: EngineOrder) => o.kind === 'PRODUCT';
const isService = (o: EngineOrder) => o.kind === 'SERVICE';
const isCash = (o: EngineOrder) => o.paymentMethod === 'CASH';
const isMyAssignment = (o: EngineOrder, a: Actor) => !!o.activeAssignment && o.activeAssignment.agentId === a.id;
const isMyBooking = (o: EngineOrder, a: Actor) => a.role === ADMIN || (a.role === STAFF && o.providerId === a.id);
const openRequest = (o: EngineOrder, type: 'CANCELLATION' | 'RESCHEDULE' | 'RETURN') =>
  o.openRequests.find((r) => r.type === type);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const money = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const noun = (o: EngineOrder) => (isProduct(o) ? 'order' : 'booking');

const reasonField = (label = 'Reason', required = true, placeholder?: string): FieldDef => ({
  name: 'reason',
  label,
  type: 'textarea',
  required,
  placeholder,
});
const scheduleField = (label = 'New date & time'): FieldDef => ({
  name: 'schedule',
  label,
  type: 'schedule',
  required: true,
  help: 'Only slots with remaining capacity are shown.',
});
const codAmountField = (o: EngineOrder, required: boolean, label = 'Cash collected'): FieldDef => ({
  name: 'amount',
  label,
  type: 'money',
  required,
  min: 0.01,
  defaultValue: (o.totalPaise - o.codCollectedPaise) / 100,
  help: `Amount due: ${money(o.totalPaise - o.codCollectedPaise)}`,
});

const notify = (audience: Audience, title: string, body: string): Effect => ({
  type: 'NOTIFY',
  audience,
  title,
  body,
});

/** Statuses from which an admin may cancel directly (§7 "Apply cancellation rules according to the current status"). */
const ADMIN_CANCELLABLE: FulfilmentStatus[] = [
  F.NOT_STARTED,
  F.AWAITING_PREPARATION,
  F.AWAITING_SCHEDULE,
  F.SCHEDULED,
  F.PREPARING,
  F.READY,
  F.DELIVERY_FAILED,
  F.RETURNED_TO_WORKSPACE,
  F.NO_SHOW,
  F.PROVIDER_UNAVAILABLE,
  F.SERVICE_FAILED,
];
/** Statuses from which a customer may still ask to cancel (before dispatch / service start). */
const CUSTOMER_CANCELLABLE: FulfilmentStatus[] = [
  F.NOT_STARTED,
  F.AWAITING_PREPARATION,
  F.AWAITING_SCHEDULE,
  F.SCHEDULED,
  F.PREPARING,
  F.READY,
];
const DELIVERY_ASSIGNABLE: FulfilmentStatus[] = [F.AWAITING_PREPARATION, F.SCHEDULED, F.PREPARING, F.READY];
const BEFORE_PICKUP: FulfilmentStatus[] = [F.AWAITING_PREPARATION, F.SCHEDULED, F.PREPARING, F.READY];

function parseSchedule(input: Input): { slotId: string | null; start: string | null } {
  const raw = input.schedule as unknown;
  if (raw && typeof raw === 'object') {
    const r = raw as { slotId?: unknown; start?: unknown };
    const slotId = r.slotId ? str(r.slotId) : null;
    const start = r.start ? str(r.start) : null;
    if (!slotId && !start) throw new DomainError('VALIDATION', 'Choose a new slot or date & time.');
    if (start && Number.isNaN(Date.parse(start))) throw new DomainError('VALIDATION', 'Invalid date & time.');
    return { slotId, start };
  }
  if (typeof raw === 'string' && raw) {
    if (Number.isNaN(Date.parse(raw))) return { slotId: raw, start: null };
    return { slotId: null, start: raw };
  }
  throw new DomainError('VALIDATION', 'Choose a new slot or date & time.');
}

/** Effects shared by every cancellation / rejection. */
function cancellationEffects(o: EngineOrder, keepAssignment: boolean): { patch: Partial<OrderPatch>; effects: Effect[] } {
  const effects: Effect[] = [{ type: 'RELEASE_SLOT' }];
  if (f(o, F.NOT_STARTED, F.AWAITING_PREPARATION, F.SCHEDULED, F.AWAITING_SCHEDULE) && isProduct(o)) {
    effects.push({ type: 'RESTORE_STOCK' });
  }
  if (o.activeAssignment && !keepAssignment) {
    effects.push({ type: 'SET_ASSIGNMENT_STATUS', status: 'CANCELLED', reason: 'Order cancelled' });
  }
  const patch: Partial<OrderPatch> = { cancelledAt: now() };
  if (o.paymentStatus === P.PAID && o.refundStatus === R.NOT_APPLICABLE) patch.refundStatus = R.PENDING;
  if (o.codStatus === C.PENDING_COLLECTION) patch.codStatus = C.NOT_APPLICABLE;
  return { patch, effects };
}

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------
const ACTIONS: Record<ActionCode, ActionDef> = {
  // ===================== Order & booking actions =====================
  ACCEPT: {
    roles: [ADMIN],
    tone: 'success',
    label: (o) => (isProduct(o) ? 'Accept Order' : 'Confirm Booking'),
    guard: (o) => inReview(o),
    plan: (o, _a, _i, wf) => {
      let fs: FulfilmentStatus;
      if (isProduct(o)) fs = wf.scheduled ? F.SCHEDULED : F.AWAITING_PREPARATION;
      else fs = wf.scheduleConfirmation ? F.AWAITING_SCHEDULE : F.SCHEDULED;
      return {
        patch: { orderStatus: O.CONFIRMED, fulfilmentStatus: fs, clarificationNote: null },
        effects: [notify('CUSTOMER', `${isProduct(o) ? 'Order' : 'Booking'} confirmed`, `Your ${noun(o)} has been confirmed.`)],
        event: { message: isProduct(o) ? 'Order accepted' : 'Booking confirmed' },
      };
    },
  },
  ACCEPT_AND_START_PREP: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Accept & Start Prep',
    guard: (o, _a, wf) => inReview(o) && isProduct(o) && !wf.scheduled,
    plan: () => ({
      patch: { orderStatus: O.IN_PROGRESS, fulfilmentStatus: F.PREPARING, prepStartedAt: now(), clarificationNote: null },
      effects: [notify('CUSTOMER', 'Order confirmed', 'Your order has been accepted and is being prepared.')],
      event: { message: 'Order accepted and preparation started' },
    }),
  },
  REJECT: {
    roles: [ADMIN],
    tone: 'danger',
    label: (o) => (isProduct(o) ? 'Reject Order' : 'Reject Booking'),
    guard: (o) => inReview(o),
    fields: () => [reasonField('Reason for rejection', true, 'e.g. Item out of stock, outside service area…')],
    confirm: (o) => ({
      title: `Reject this ${noun(o)}?`,
      body: 'The customer will be notified with your reason. This cannot be undone.',
      cta: 'Reject',
    }),
    plan: (o, _a, i) => {
      const c = cancellationEffects(o, false);
      return {
        patch: { ...c.patch, orderStatus: O.REJECTED, fulfilmentStatus: F.CANCELLED, rejectReason: str(i.reason) },
        effects: [...c.effects, { type: 'DECLINE_ALL_OPEN_REQUESTS', note: 'Order rejected' }, notify('CUSTOMER', `${isProduct(o) ? 'Order' : 'Booking'} rejected`, str(i.reason))],
        event: { message: `${isProduct(o) ? 'Order' : 'Booking'} rejected`, reason: str(i.reason) },
      };
    },
  },
  REQUEST_CLARIFICATION: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Request Clarification',
    guard: (o) => o.orderStatus === O.PENDING_REVIEW,
    fields: () => [{ name: 'reason', label: 'What do you need from the customer?', type: 'textarea', required: true }],
    plan: (_o, _a, i) => ({
      patch: { orderStatus: O.CLARIFICATION_REQUESTED, clarificationNote: str(i.reason) },
      effects: [notify('CUSTOMER', 'We need a few details', str(i.reason))],
      event: { message: 'Clarification requested from customer', reason: str(i.reason) },
    }),
  },
  CANCEL: {
    roles: [ADMIN],
    tone: 'danger',
    label: (o) => (isProduct(o) ? 'Cancel Order' : 'Cancel Booking'),
    // while the order is still under review the admin rejects it instead
    guard: (o) => isActive(o) && !inReview(o) && ADMIN_CANCELLABLE.includes(o.fulfilmentStatus) && !openRequest(o, 'CANCELLATION'),
    fields: () => [reasonField('Cancellation reason')],
    confirm: (o) => ({
      title: `Cancel this ${noun(o)}?`,
      body:
        o.paymentStatus === P.PAID
          ? 'Payment was already received — the refund will be marked as pending and tracked separately.'
          : 'Reserved capacity will be released and the customer notified.',
      cta: `Cancel ${noun(o)}`,
    }),
    plan: (o, _a, i) => {
      // After a failed delivery the parcel is still with the agent: it must come back first.
      const parcelWithAgent = f(o, F.DELIVERY_FAILED);
      const c = cancellationEffects(o, parcelWithAgent);
      return {
        patch: {
          ...c.patch,
          orderStatus: O.CANCELLED,
          fulfilmentStatus: parcelWithAgent ? F.RETURNING : F.CANCELLED,
          cancelReason: str(i.reason),
        },
        effects: [
          ...c.effects,
          { type: 'DECLINE_ALL_OPEN_REQUESTS', note: 'Order cancelled by workspace' },
          notify('CUSTOMER', `${isProduct(o) ? 'Order' : 'Booking'} cancelled`, str(i.reason)),
          ...(o.activeAssignment ? [notify('AGENT', 'Delivery cancelled', parcelWithAgent ? 'Please return the parcel to the workspace.' : 'This delivery was cancelled.')] : []),
          ...(o.providerId ? [notify('PROVIDER', 'Booking cancelled', str(i.reason))] : []),
        ],
        event: { message: `${isProduct(o) ? 'Order' : 'Booking'} cancelled by workspace`, reason: str(i.reason) },
      };
    },
  },
  CONFIRM_CANCELLATION: {
    roles: [ADMIN],
    tone: 'danger',
    label: 'Confirm Cancellation',
    guard: (o) => isActive(o) && !!openRequest(o, 'CANCELLATION') && ADMIN_CANCELLABLE.includes(o.fulfilmentStatus),
    hint: (o) => (openRequest(o, 'CANCELLATION')?.reason ? `Customer reason: ${openRequest(o, 'CANCELLATION')!.reason}` : undefined),
    confirm: (o) => ({
      title: 'Approve the customer’s cancellation?',
      body: o.paymentStatus === P.PAID ? 'The refund will be marked as pending.' : 'Reserved capacity will be released.',
      cta: 'Approve cancellation',
    }),
    plan: (o) => {
      const req = openRequest(o, 'CANCELLATION')!;
      const c = cancellationEffects(o, false);
      return {
        patch: { ...c.patch, orderStatus: O.CANCELLED, fulfilmentStatus: F.CANCELLED, cancelReason: req.reason ?? 'Cancelled at customer request' },
        effects: [
          ...c.effects,
          { type: 'RESOLVE_REQUEST', requestId: req.id, status: 'APPROVED' },
          { type: 'DECLINE_ALL_OPEN_REQUESTS', note: 'Order cancelled' },
          notify('CUSTOMER', 'Cancellation confirmed', `Your ${noun(o)} has been cancelled.`),
          ...(o.activeAssignment ? [notify('AGENT', 'Delivery cancelled', 'This delivery was cancelled.')] : []),
        ],
        event: { message: 'Customer cancellation approved', reason: req.reason },
      };
    },
  },
  DECLINE_CANCELLATION: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Decline Cancellation',
    guard: (o) => isActive(o) && !!openRequest(o, 'CANCELLATION'),
    fields: () => [reasonField('Reason for declining')],
    plan: (o, _a, i) => ({
      patch: {},
      effects: [
        { type: 'RESOLVE_REQUEST', requestId: openRequest(o, 'CANCELLATION')!.id, status: 'DECLINED', note: str(i.reason) },
        notify('CUSTOMER', 'Cancellation request declined', str(i.reason)),
      ],
      event: { message: 'Customer cancellation declined', reason: str(i.reason) },
    }),
  },

  // ===================== Preparation & scheduling =====================
  START_PREPARATION: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Start Preparation',
    guard: (o, _a, wf) => wf.preparation && confirmedOrLater(o) && f(o, F.AWAITING_PREPARATION, F.SCHEDULED),
    plan: () => ({
      patch: { fulfilmentStatus: F.PREPARING, prepStartedAt: now() },
      effects: [],
      event: { message: 'Preparation started' },
    }),
  },
  ADD_PREP_TIME: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Add Extra Preparation Time',
    guard: (o, _a, wf) =>
      wf.preparation && isActive(o) && f(o, F.NOT_STARTED, F.AWAITING_PREPARATION, F.SCHEDULED, F.PREPARING),
    fields: () => [
      {
        name: 'minutes',
        label: 'Extra minutes',
        type: 'select',
        required: true,
        options: ['5', '10', '15', '20', '30', '45', '60'].map((m) => ({ value: m, label: `+${m} min` })),
        defaultValue: '5',
      },
    ],
    plan: (o, _a, i) => {
      const minutes = Number(i.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new DomainError('VALIDATION', 'Extra time must be between 1 and 120 minutes.');
      return {
        patch: { extraPrepMinutes: minutes },
        effects: f(o, F.PREPARING) ? [notify('CUSTOMER', 'Updated preparation time', `Your order needs about ${minutes} more minutes.`)] : [],
        event: { message: `Preparation time extended by ${minutes} min`, data: { minutes } },
      };
    },
  },
  MARK_READY: {
    roles: [ADMIN],
    tone: 'primary',
    label: (o) => (workflowOf(o.fulfilmentType).serve ? 'Mark Ready to Serve' : workflowOf(o.fulfilmentType).customerCollection ? 'Mark Ready for Pickup' : 'Mark Ready'),
    guard: (o, _a, wf) => wf.preparation && f(o, F.PREPARING) && isActive(o),
    plan: (o, _a, _i, wf) => ({
      patch: { fulfilmentStatus: F.READY, readyAt: now() },
      effects: wf.customerCollection
        ? [notify('CUSTOMER', 'Ready for pickup', 'Your order is ready. Please collect it from the store.')]
        : wf.deliveryAgent && o.activeAssignment
          ? [notify('AGENT', 'Order ready for pickup', 'The order is packed and ready at the workspace.')]
          : [],
      event: { message: wf.serve ? 'Order ready to serve' : 'Order marked ready' },
    }),
    hint: (o) => (workflowOf(o.fulfilmentType).deliveryAgent && !o.activeAssignment ? 'No delivery agent assigned yet' : undefined),
  },
  CONFIRM_SCHEDULE: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Confirm Schedule',
    guard: (o) => confirmedOrLater(o) && f(o, F.AWAITING_SCHEDULE),
    fields: (o) => [
      {
        name: 'schedule',
        label: 'Confirmed date & time',
        type: 'schedule',
        required: false,
        help: o.scheduledStart ? 'Leave unchanged to keep the time the customer requested.' : undefined,
      },
      { name: 'providerId', label: 'Service provider', type: 'provider', required: false },
    ],
    plan: (o, _a, i) => {
      const effects: Effect[] = [];
      const patch: Partial<OrderPatch> = { fulfilmentStatus: F.SCHEDULED };
      if (i.schedule && (typeof i.schedule === 'string' || (typeof i.schedule === 'object' && Object.keys(i.schedule as object).length))) {
        const s = parseSchedule(i);
        effects.push({ type: 'MOVE_SCHEDULE', slotId: s.slotId, start: s.start });
      } else if (!o.scheduledStart) {
        throw new DomainError('VALIDATION', 'Choose the confirmed date & time.');
      }
      const providerId = str(i.providerId);
      if (providerId) {
        effects.push({ type: 'CHECK_PROVIDER_AVAILABLE', providerId });
        patch.providerId = providerId;
        patch.providerConfirmedAt = null;
        effects.push(notify('PROVIDER', 'New booking assigned', 'A booking has been scheduled for you.'));
      }
      effects.push(notify('CUSTOMER', 'Schedule confirmed', 'Your booking time is confirmed.'));
      return { patch, effects, event: { message: 'Schedule confirmed' } };
    },
  },
  RESCHEDULE: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Reschedule',
    guard: (o, _a, wf) => {
      if (!isActive(o) || openRequest(o, 'RESCHEDULE')) return false;
      if (f(o, F.DELIVERY_FAILED) || (f(o, F.RETURNED_TO_WORKSPACE) && !!o.returnConfirmedAt)) return wf.deliveryAgent;
      if (!wf.scheduled) return false;
      return f(o, F.AWAITING_SCHEDULE, F.SCHEDULED, F.NO_SHOW, F.PROVIDER_UNAVAILABLE, F.SERVICE_FAILED);
    },
    fields: () => [scheduleField(), reasonField('Reason for rescheduling')],
    confirm: () => ({ title: 'Reschedule?', body: 'The customer and anyone assigned will be notified of the new time.', cta: 'Reschedule' }),
    plan: (o, _a, i) => {
      const s = parseSchedule(i);
      const effects: Effect[] = [{ type: 'MOVE_SCHEDULE', slotId: s.slotId, start: s.start }];
      const patch: Partial<OrderPatch> = {};
      if (f(o, F.DELIVERY_FAILED)) {
        // parcel is with the agent → bring it back, then it becomes SCHEDULED on confirmation
        patch.fulfilmentStatus = F.RETURNING;
        patch.afterReturnAction = 'RESCHEDULE';
        effects.push(notify('AGENT', 'Return the parcel', 'Delivery rescheduled — please return the parcel to the workspace.'));
      } else {
        patch.fulfilmentStatus = F.SCHEDULED;
        if (o.activeAssignment) effects.push({ type: 'SET_ASSIGNMENT_STATUS', status: 'CANCELLED', reason: 'Order rescheduled' });
      }
      if (o.providerId) {
        patch.providerConfirmedAt = null;
        effects.push(notify('PROVIDER', 'Booking rescheduled', str(i.reason)));
      }
      effects.push(notify('CUSTOMER', `${isProduct(o) ? 'Order' : 'Booking'} rescheduled`, str(i.reason)));
      return { patch, effects, event: { message: 'Rescheduled', reason: str(i.reason), data: { slotId: s.slotId, start: s.start } } };
    },
  },
  APPROVE_RESCHEDULE_REQUEST: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Accept Reschedule',
    guard: (o) => isActive(o) && !!openRequest(o, 'RESCHEDULE'),
    hint: (o) => {
      const r = openRequest(o, 'RESCHEDULE');
      if (!r) return undefined;
      const who = r.requestedByRole === STAFF ? 'Provider' : 'Customer';
      return `${who} requested a new time${r.reason ? ` — “${r.reason}”` : ''}`;
    },
    fields: (o) => {
      const r = openRequest(o, 'RESCHEDULE');
      const hasProposal = !!(r?.proposedSlotId || r?.proposedStart);
      return hasProposal ? [] : [scheduleField('New date & time')];
    },
    plan: (o, _a, i) => {
      const r = openRequest(o, 'RESCHEDULE')!;
      const s = r.proposedSlotId || r.proposedStart ? { slotId: r.proposedSlotId, start: r.proposedStart } : parseSchedule(i);
      const effects: Effect[] = [
        { type: 'MOVE_SCHEDULE', slotId: s.slotId, start: s.start },
        { type: 'RESOLVE_REQUEST', requestId: r.id, status: 'APPROVED' },
        notify('CUSTOMER', 'Reschedule confirmed', 'Your new time is confirmed.'),
      ];
      const patch: Partial<OrderPatch> = {};
      if (f(o, F.NO_SHOW, F.PROVIDER_UNAVAILABLE, F.SERVICE_FAILED, F.AWAITING_SCHEDULE)) patch.fulfilmentStatus = F.SCHEDULED;
      if (o.providerId) {
        patch.providerConfirmedAt = null;
        effects.push(notify('PROVIDER', 'Booking rescheduled', 'The booking time has changed.'));
      }
      return { patch, effects, event: { message: 'Reschedule request accepted', reason: r.reason, data: s } };
    },
  },
  DECLINE_RESCHEDULE_REQUEST: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Decline Reschedule',
    guard: (o) => isActive(o) && !!openRequest(o, 'RESCHEDULE'),
    fields: () => [reasonField('Reason for declining')],
    plan: (o, _a, i) => {
      const r = openRequest(o, 'RESCHEDULE')!;
      return {
        patch: {},
        effects: [
          { type: 'RESOLVE_REQUEST', requestId: r.id, status: 'DECLINED', note: str(i.reason) },
          notify(r.requestedByRole === STAFF ? 'PROVIDER' : 'CUSTOMER', 'Reschedule request declined', str(i.reason)),
        ],
        event: { message: 'Reschedule request declined', reason: str(i.reason) },
      };
    },
  },
  VIEW_AVAILABILITY: {
    roles: [ADMIN],
    kind: 'link',
    tone: 'neutral',
    label: 'View Availability',
    guard: (o, _a, wf) => wf.scheduled && isActive(o),
  },
  MANAGE_CAPACITY: {
    roles: [ADMIN],
    kind: 'link',
    tone: 'neutral',
    label: 'Manage Capacity',
    guard: (o, _a, wf) => (wf.seatCapacity || !!o.slotId) && isActive(o),
  },

  // ===================== Delivery & collection =====================
  ASSIGN_AGENT: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Assign Delivery Agent',
    guard: (o, _a, wf) => wf.deliveryAgent && confirmedOrLater(o) && DELIVERY_ASSIGNABLE.includes(o.fulfilmentStatus) && !o.activeAssignment,
    fields: () => [{ name: 'agentId', label: 'Delivery agent', type: 'agent', required: true }],
    plan: (_o, _a, i) => ({
      patch: {},
      effects: [{ type: 'OFFER_ASSIGNMENT', agentId: str(i.agentId), auto: false, excludeAgentIds: [] }],
      event: { message: 'Delivery agent assigned manually', data: { agentId: str(i.agentId) } },
    }),
  },
  AUTO_ASSIGN_AGENT: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Auto-Assign Agent',
    guard: (o, _a, wf) => wf.deliveryAgent && confirmedOrLater(o) && DELIVERY_ASSIGNABLE.includes(o.fulfilmentStatus) && !o.activeAssignment,
    plan: () => ({
      patch: {},
      effects: [{ type: 'OFFER_ASSIGNMENT', agentId: null, auto: true, excludeAgentIds: [] }],
      event: { message: 'Delivery agent auto-assigned' },
    }),
  },
  REASSIGN_AGENT: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Reassign Agent',
    guard: (o, _a, wf) =>
      wf.deliveryAgent &&
      isActive(o) &&
      !!o.activeAssignment &&
      f(o, ...DELIVERY_ASSIGNABLE, F.PICKED_UP, F.OUT_FOR_DELIVERY, F.DELIVERY_FAILED),
    fields: (o) => [
      { name: 'agentId', label: 'New delivery agent', type: 'agent', required: true, help: 'Choose “Auto” to let the system pick the best available agent.' },
      reasonField('Reason for reassignment', f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY, F.DELIVERY_FAILED)),
    ],
    confirm: (o) =>
      f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY, F.DELIVERY_FAILED)
        ? {
            title: 'Reassign after pickup?',
            body: 'The current agent already has the parcel. Make sure it is handed back before the new agent collects it. This action is restricted to workspace admins and will be audited.',
            cta: 'Reassign',
          }
        : { title: 'Reassign this delivery?', body: 'The current agent will be removed from this order.', cta: 'Reassign' },
    plan: (o, _a, i) => {
      const prev = o.activeAssignment!;
      const agentId = str(i.agentId);
      const auto = !agentId || agentId === 'AUTO';
      const afterPickup = f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY, F.DELIVERY_FAILED);
      if (!auto && agentId === prev.agentId) throw new DomainError('VALIDATION', 'Choose a different agent.');
      return {
        patch: afterPickup ? { fulfilmentStatus: F.READY } : {},
        effects: [
          { type: 'SET_ASSIGNMENT_STATUS', status: 'CANCELLED', reason: str(i.reason) || 'Reassigned by admin' },
          { type: 'OFFER_ASSIGNMENT', agentId: auto ? null : agentId, auto, excludeAgentIds: [prev.agentId] },
        ],
        event: { message: afterPickup ? 'Agent reassigned after pickup (authorised)' : 'Agent reassigned', reason: str(i.reason) || null, data: { from: prev.agentId, to: auto ? 'AUTO' : agentId } },
      };
    },
  },
  TRACK_DELIVERY: {
    roles: [ADMIN, AGENT],
    kind: 'link',
    tone: 'neutral',
    label: 'Track Delivery',
    guard: (o, a, wf) =>
      wf.deliveryAgent &&
      (a.role === ADMIN ? !!o.activeAssignment || f(o, F.DELIVERED, F.DELIVERY_FAILED, F.RETURNING) : isMyAssignment(o, a) && f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY)),
  },
  CONFIRM_PICKUP_HANDOVER: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Pickup / Handover',
    guard: (o, _a, wf) => wf.customerCollection && isActive(o) && f(o, F.READY),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected at counter')] : []),
    confirm: () => ({ title: 'Confirm handover?', body: 'Confirm the customer has collected the order.', cta: 'Confirm handover' }),
    plan: (o, a, i) => ({
      patch: { fulfilmentStatus: F.COLLECTED },
      effects: codEffects(o, a, i, false),
      event: { message: 'Order collected by customer' },
    }),
  },
  CONFIRM_DELIVERED: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Delivered',
    guard: (o, _a, wf) => wf.deliveryAgent && isActive(o) && f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected by agent')] : []),
    confirm: () => ({ title: 'Confirm delivery?', body: 'Mark this order as delivered on behalf of the agent.', cta: 'Confirm delivered' }),
    plan: (o, a, i) => ({
      patch: { fulfilmentStatus: F.DELIVERED },
      effects: [
        { type: 'SET_ASSIGNMENT_STATUS', status: 'COMPLETED' },
        ...codEffects(o, a, i, true),
        notify('CUSTOMER', 'Delivered', 'Your order has been delivered.'),
      ],
      event: { message: 'Delivery confirmed by admin' },
    }),
  },
  CONFIRM_SERVED: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Served',
    guard: (o, _a, wf) => wf.serve && isActive(o) && f(o, F.READY),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected (if paid now)')] : []),
    plan: (o, a, i) => ({ patch: { fulfilmentStatus: F.SERVED }, effects: codEffects(o, a, i, false), event: { message: 'Order served' } }),
  },
  CONFIRM_SERVICE_COMPLETION: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Service Completion',
    guard: (o) => isService(o) && isActive(o) && f(o, F.IN_SERVICE, F.CHECKED_IN),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected (if paid now)')] : []),
    plan: (o, a, i) => ({
      patch: { fulfilmentStatus: F.SERVICE_COMPLETED },
      effects: [...codEffects(o, a, i, false), notify('CUSTOMER', 'Service completed', 'Thank you! Your service is complete.')],
      event: { message: 'Service completion confirmed' },
    }),
  },
  RETRY_DELIVERY: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Retry Delivery',
    guard: (o, _a, wf) =>
      wf.deliveryAgent && isActive(o) && ((f(o, F.DELIVERY_FAILED) && !!o.activeAssignment) || (f(o, F.RETURNED_TO_WORKSPACE) && !!o.returnConfirmedAt)),
    plan: (o) =>
      f(o, F.DELIVERY_FAILED)
        ? {
            patch: { fulfilmentStatus: F.PICKED_UP, failureReason: null, failureNotes: null, failureEvidence: null },
            effects: [notify('AGENT', 'Retry delivery', 'Please attempt the delivery again.'), notify('CUSTOMER', 'Delivery re-attempt', 'We will try delivering your order again.')],
            event: { message: 'Delivery retry requested (same agent)' },
          }
        : {
            patch: { fulfilmentStatus: F.READY, returnConfirmedAt: null, failureReason: null, failureNotes: null, failureEvidence: null },
            effects: [],
            event: { message: 'Order returned to the dispatch queue for a new delivery attempt' },
          },
  },
  APPROVE_RETURN: {
    roles: [ADMIN],
    tone: 'warning',
    label: 'Approve Return',
    guard: (o, _a, wf) =>
      (wf.deliveryAgent && isActive(o) && f(o, F.DELIVERY_FAILED) && !!o.activeAssignment) ||
      (!!openRequest(o, 'RETURN') && f(o, F.DELIVERED, F.COLLECTED)),
    fields: (o) =>
      f(o, F.DELIVERY_FAILED)
        ? [{ name: 'reason', label: 'Note for the agent', type: 'textarea', required: false }]
        : [{ name: 'pickupAt', label: 'Return pickup date', type: 'datetime', required: true }, { name: 'reason', label: 'Note', type: 'textarea', required: false }],
    confirm: (o) =>
      f(o, F.DELIVERY_FAILED)
        ? { title: 'Return parcel to workspace?', body: 'The agent will bring the parcel back. You can then retry, reschedule or cancel.', cta: 'Approve return' }
        : { title: 'Approve customer return?', body: o.paymentStatus === P.PAID ? 'Refund status will be set to pending and tracked separately.' : 'A pickup will be arranged.', cta: 'Approve return' },
    plan: (o, _a, i) => {
      if (f(o, F.DELIVERY_FAILED)) {
        return {
          patch: { fulfilmentStatus: F.RETURNING },
          effects: [notify('AGENT', 'Return to workspace', 'Please bring the parcel back to the workspace.')],
          event: { message: 'Return to workspace approved', reason: str(i.reason) || null },
        };
      }
      const req = openRequest(o, 'RETURN')!;
      const pickupAt = str(i.pickupAt);
      if (Number.isNaN(Date.parse(pickupAt))) throw new DomainError('VALIDATION', 'Choose a valid pickup date.');
      return {
        patch: { fulfilmentStatus: F.RETURN_APPROVED, returnPickupAt: pickupAt },
        effects: [
          { type: 'RESOLVE_REQUEST', requestId: req.id, status: 'APPROVED', note: str(i.reason) || null },
          notify('CUSTOMER', 'Return approved', `We will collect the item on ${new Date(pickupAt).toDateString()}.`),
        ],
        event: { message: 'Customer return approved', reason: req.reason, data: { pickupAt } },
      };
    },
  },
  DECLINE_RETURN: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Decline Return',
    guard: (o) => !!openRequest(o, 'RETURN'),
    fields: () => [reasonField('Reason for declining')],
    plan: (o, _a, i) => ({
      patch: {},
      effects: [
        { type: 'RESOLVE_REQUEST', requestId: openRequest(o, 'RETURN')!.id, status: 'DECLINED', note: str(i.reason) },
        notify('CUSTOMER', 'Return request declined', str(i.reason)),
      ],
      event: { message: 'Customer return declined', reason: str(i.reason) },
    }),
  },
  CONFIRM_RETURN_RECEIVED: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Return Received',
    guard: (o) => f(o, F.RETURNED_TO_WORKSPACE) && !o.returnConfirmedAt,
    confirm: () => ({ title: 'Parcel received back?', body: 'Confirm the agent has handed the parcel back to the workspace.', cta: 'Confirm received' }),
    plan: (o) => {
      const patch: Partial<OrderPatch> = { returnConfirmedAt: now() };
      const effects: Effect[] = [];
      if (o.activeAssignment) effects.push({ type: 'SET_ASSIGNMENT_STATUS', status: 'COMPLETED', reason: 'Returned to workspace' });
      if (o.afterReturnAction === 'RESCHEDULE' && isActive(o)) {
        patch.fulfilmentStatus = F.SCHEDULED;
        patch.afterReturnAction = null;
      }
      return { patch, effects, event: { message: 'Return to workspace confirmed' } };
    },
  },
  CONFIRM_RETURN_PICKUP: {
    roles: [ADMIN],
    tone: 'success',
    label: 'Confirm Return Pickup',
    guard: (o) => f(o, F.RETURN_APPROVED),
    plan: (o) => ({
      patch: { fulfilmentStatus: F.RETURN_RECEIVED, ...(o.paymentStatus === P.PAID && o.refundStatus === R.NOT_APPLICABLE ? { refundStatus: R.PENDING } : {}) },
      effects: [notify('CUSTOMER', 'Return received', 'We have received your returned item.')],
      event: { message: 'Returned item picked up from customer' },
    }),
  },

  // ===================== Services =====================
  ASSIGN_PROVIDER: {
    roles: [ADMIN],
    tone: 'neutral',
    label: (o) => (o.providerId ? 'Reassign Provider' : 'Assign Provider'),
    guard: (o) => isService(o) && isActive(o) && f(o, F.NOT_STARTED, F.AWAITING_SCHEDULE, F.SCHEDULED, F.PROVIDER_UNAVAILABLE, F.SERVICE_FAILED, F.NO_SHOW),
    fields: (o) => [
      { name: 'providerId', label: 'Service provider', type: 'provider', required: true },
      ...(o.providerId ? [reasonField('Reason', false)] : []),
    ],
    plan: (o, _a, i) => {
      const providerId = str(i.providerId);
      if (providerId === o.providerId) throw new DomainError('VALIDATION', 'This provider is already assigned.');
      return {
        patch: { providerId, providerConfirmedAt: null, ...(f(o, F.PROVIDER_UNAVAILABLE) ? { fulfilmentStatus: F.SCHEDULED } : {}) },
        effects: [{ type: 'CHECK_PROVIDER_AVAILABLE', providerId }, notify('PROVIDER', 'New booking assigned', 'You have been assigned a booking.')],
        event: { message: o.providerId ? 'Provider reassigned' : 'Provider assigned', reason: str(i.reason) || null, data: { from: o.providerId, to: providerId } },
      };
    },
  },
  REPORT_PROVIDER_UNAVAILABLE: {
    roles: [ADMIN],
    tone: 'warning',
    label: 'Report Provider Unavailable',
    guard: (o) => isService(o) && isActive(o) && f(o, F.SCHEDULED, F.AWAITING_SCHEDULE),
    fields: () => [reasonField()],
    confirm: () => ({ title: 'Provider unavailable?', body: 'The customer will be told the booking needs a new provider or time.', cta: 'Report' }),
    plan: (_o, _a, i) => ({
      patch: { fulfilmentStatus: F.PROVIDER_UNAVAILABLE, failureReason: str(i.reason) },
      effects: [notify('CUSTOMER', 'Booking update', 'Your provider is unavailable — we will reassign or reschedule shortly.')],
      event: { message: 'Provider unavailable', reason: str(i.reason) },
    }),
  },
  SET_MEETING_DETAILS: {
    roles: [ADMIN, STAFF],
    tone: 'neutral',
    label: (o) => (o.meetingLink ? 'Update Meeting Details' : 'Add Meeting Details'),
    guard: (o, a, wf) => wf.online && isActive(o) && isMyBooking(o, a) && !f(o, F.SERVICE_COMPLETED),
    fields: (o) => [
      { name: 'meetingLink', label: 'Meeting link', type: 'url', required: true, defaultValue: o.meetingLink ?? undefined, placeholder: 'https://meet.example.com/…' },
      { name: 'meetingNotes', label: 'Joining instructions', type: 'textarea', required: false },
    ],
    plan: (_o, _a, i) => {
      const link = str(i.meetingLink);
      if (!/^https?:\/\//i.test(link)) throw new DomainError('VALIDATION', 'Meeting link must start with http:// or https://');
      return {
        patch: { meetingLink: link, meetingNotes: str(i.meetingNotes) || null },
        effects: [notify('CUSTOMER', 'Meeting details', `Join here: ${link}`)],
        event: { message: 'Online meeting details updated' },
      };
    },
  },
  CONFIRM_APPOINTMENT: {
    roles: [STAFF],
    tone: 'success',
    label: 'Confirm Appointment',
    guard: (o, a, wf) =>
      isService(o) &&
      isMyBooking(o, a) &&
      ((o.orderStatus === O.PENDING_REVIEW && !wf.alwaysReview) || (f(o, F.SCHEDULED) && !o.providerConfirmedAt && confirmedOrLater(o))),
    plan: (o, _a, _i, wf) =>
      o.orderStatus === O.PENDING_REVIEW
        ? {
            patch: { orderStatus: O.CONFIRMED, fulfilmentStatus: wf.scheduleConfirmation ? F.AWAITING_SCHEDULE : F.SCHEDULED, providerConfirmedAt: now() },
            effects: [notify('CUSTOMER', 'Appointment confirmed', 'Your appointment is confirmed.'), notify('ADMIN', 'Appointment confirmed by provider', '')],
            event: { message: 'Appointment confirmed by provider' },
          }
        : { patch: { providerConfirmedAt: now() }, effects: [notify('ADMIN', 'Provider confirmed the appointment', '')], event: { message: 'Provider acknowledged the appointment' } },
  },
  START_TRAVEL: {
    roles: [ADMIN, STAFF],
    tone: 'primary',
    label: 'Start Travel',
    guard: (o, a, wf) => wf.providerTravels && confirmedOrLater(o) && isMyBooking(o, a) && f(o, F.SCHEDULED),
    plan: () => ({
      patch: { fulfilmentStatus: F.PROVIDER_EN_ROUTE },
      effects: [notify('CUSTOMER', 'Provider on the way', 'Your service provider is on the way.')],
      event: { message: 'Provider travelling to customer' },
    }),
  },
  MARK_ATTENDED: {
    roles: [ADMIN, STAFF],
    tone: 'success',
    label: 'Mark Customer Attended',
    guard: (o, a, wf) => wf.attendance && confirmedOrLater(o) && isMyBooking(o, a) && f(o, F.SCHEDULED),
    plan: () => ({ patch: { fulfilmentStatus: F.CHECKED_IN }, effects: [], event: { message: 'Customer attendance recorded' } }),
  },
  START_SERVICE: {
    roles: [ADMIN, STAFF],
    tone: 'primary',
    label: 'Start Service',
    // attendance-based services start after the customer is checked in
    guard: (o, a, wf) =>
      isService(o) && confirmedOrLater(o) && isMyBooking(o, a) && (wf.attendance ? f(o, F.CHECKED_IN) : f(o, F.SCHEDULED, F.PROVIDER_EN_ROUTE)),
    plan: () => ({ patch: { fulfilmentStatus: F.IN_SERVICE }, effects: [], event: { message: 'Service started' } }),
  },
  MARK_SERVICE_COMPLETED: {
    roles: [STAFF],
    tone: 'success',
    label: 'Mark Service Completed',
    guard: (o, a) => isService(o) && isActive(o) && isMyBooking(o, a) && f(o, F.IN_SERVICE, F.CHECKED_IN),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected (if paid now)')] : []),
    plan: (o, a, i) => ({
      patch: { fulfilmentStatus: F.SERVICE_COMPLETED },
      effects: [...codEffects(o, a, i, false), notify('CUSTOMER', 'Service completed', 'Thank you! Your service is complete.'), notify('ADMIN', 'Service completed', '')],
      event: { message: 'Service marked completed by provider' },
    }),
  },
  REPORT_CUSTOMER_UNAVAILABLE: {
    roles: [ADMIN, STAFF],
    tone: 'warning',
    label: 'Report Customer Unavailable',
    guard: (o, a) => isService(o) && confirmedOrLater(o) && isMyBooking(o, a) && f(o, F.SCHEDULED, F.PROVIDER_EN_ROUTE),
    fields: () => [
      {
        name: 'reason',
        label: 'What happened?',
        type: 'select',
        required: true,
        options: ['Customer did not show up', 'Customer not reachable', 'Customer not at address', 'Customer asked to come later', 'Other'].map((v) => ({ value: v, label: v })),
      },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false },
    ],
    confirm: () => ({ title: 'Mark as missed?', body: 'The booking will be flagged so the admin can reschedule or cancel.', cta: 'Report' }),
    plan: (_o, _a, i) => ({
      patch: { fulfilmentStatus: F.NO_SHOW, failureReason: str(i.reason), failureNotes: str(i.notes) || null },
      effects: [notify('CUSTOMER', 'Missed appointment', 'We missed you — please contact us to reschedule.'), notify('ADMIN', 'Customer unavailable', str(i.reason))],
      event: { message: 'Customer unavailable / missed appointment', reason: str(i.reason), data: { notes: str(i.notes) } },
    }),
  },
  MARK_SERVICE_FAILED: {
    roles: [ADMIN, STAFF],
    tone: 'danger',
    label: (o) => (o.fulfilmentType === T.ONLINE ? 'Mark Session Failed' : 'Mark Service Failed'),
    guard: (o, a) => isService(o) && confirmedOrLater(o) && isMyBooking(o, a) && f(o, F.SCHEDULED, F.PROVIDER_EN_ROUTE, F.CHECKED_IN, F.IN_SERVICE),
    fields: () => [reasonField('What went wrong?'), { name: 'notes', label: 'Notes', type: 'textarea', required: false }],
    confirm: () => ({ title: 'Mark as failed?', body: 'The admin can reschedule, reassign or cancel afterwards.', cta: 'Mark failed' }),
    plan: (_o, _a, i) => ({
      patch: { fulfilmentStatus: F.SERVICE_FAILED, failureReason: str(i.reason), failureNotes: str(i.notes) || null },
      effects: [notify('ADMIN', 'Service could not be delivered', str(i.reason)), notify('CUSTOMER', 'Booking update', 'We could not complete your service. We will contact you to rearrange.')],
      event: { message: 'Service failed', reason: str(i.reason) },
    }),
  },
  REQUEST_RESCHEDULING: {
    roles: [STAFF],
    tone: 'neutral',
    label: 'Request Rescheduling',
    guard: (o, a) =>
      isService(o) && isActive(o) && isMyBooking(o, a) && f(o, F.AWAITING_SCHEDULE, F.SCHEDULED, F.NO_SHOW, F.SERVICE_FAILED) && !openRequest(o, 'RESCHEDULE'),
    fields: () => [
      { name: 'proposedStart', label: 'Suggested new time (optional)', type: 'datetime', required: false },
      reasonField('Reason'),
    ],
    plan: (_o, _a, i) => {
      const ps = str(i.proposedStart);
      if (ps && Number.isNaN(Date.parse(ps))) throw new DomainError('VALIDATION', 'Invalid suggested time.');
      return {
        patch: {},
        effects: [
          { type: 'CREATE_REQUEST', requestType: 'RESCHEDULE', reason: str(i.reason), proposedStart: ps || null, proposedSlotId: null },
          notify('ADMIN', 'Provider requested rescheduling', str(i.reason)),
        ],
        event: { message: 'Provider requested rescheduling', reason: str(i.reason) },
      };
    },
  },

  // ===================== Payment & COD =====================
  VIEW_PAYMENT_DETAILS: {
    roles: [ADMIN],
    kind: 'link',
    tone: 'neutral',
    label: 'View Payment Details',
    guard: () => true,
  },
  RECORD_COD_COLLECTED: {
    roles: [ADMIN, AGENT],
    tone: 'success',
    label: (o) => (o.codCollectedPaise > 0 ? 'Record Remaining Cash' : 'Record COD Collected'),
    guard: (o, a, wf) => {
      if (!isCash(o) || !(o.codStatus === C.PENDING_COLLECTION || (o.codStatus === C.COLLECTED && o.paymentStatus !== P.PAID))) return false;
      if (o.orderStatus === O.CANCELLED || o.orderStatus === O.REJECTED) return false;
      if (a.role === AGENT) return f(o, F.DELIVERED) && (isMyAssignment(o, a) || o.deliveredByAgentId === a.id);
      // admin: agent orders only after delivery; counter orders any time after confirmation
      if (wf.deliveryAgent) return f(o, F.DELIVERED);
      return confirmedOrLater(o) || FULFILLED_STATUSES.includes(o.fulfilmentStatus);
    },
    fields: (o) => [codAmountField(o, true)],
    confirm: (o) => ({ title: 'Record cash collected?', body: `Amount due ${money(o.totalPaise - o.codCollectedPaise)}. Enter exactly what was collected.`, cta: 'Record' }),
    plan: (o, a, i, wf) => {
      const effects = codEffects(o, a, i, wf.deliveryAgent, true);
      return { patch: {}, effects, event: { message: 'COD collection recorded', data: { amountPaise: toPaise(i.amount) } } };
    },
  },
  RETRY_PAYMENT: {
    roles: [ADMIN],
    tone: 'primary',
    label: 'Retry Payment',
    guard: (o) => o.paymentStatus === P.FAILED && ONLINE_METHODS.includes(o.paymentMethod) && isActive(o),
    plan: () => ({
      patch: { paymentStatus: P.PENDING },
      effects: [{ type: 'CREATE_PAYMENT_ATTEMPT' }, notify('CUSTOMER', 'Complete your payment', 'Your previous payment failed. Please retry using the payment link.')],
      event: { message: 'Payment retry requested' },
    }),
  },
  UPDATE_REFUND_STATUS: {
    roles: [ADMIN],
    tone: 'neutral',
    label: 'Update Refund Status',
    guard: (o) => o.refundStatus === R.PENDING || o.refundStatus === R.FAILED,
    fields: () => [
      { name: 'status', label: 'Refund status', type: 'select', required: true, options: [{ value: 'REFUNDED', label: 'Refunded' }, { value: 'FAILED', label: 'Refund failed' }] },
      { name: 'reference', label: 'Refund reference', type: 'text', required: false, placeholder: 'Gateway / bank reference' },
      { name: 'reason', label: 'Note', type: 'textarea', required: false },
    ],
    confirm: () => ({ title: 'Update refund status?', body: 'Refund processing is handled outside this module; this records the outcome.', cta: 'Update' }),
    plan: (_o, _a, i) => {
      const s = str(i.status);
      if (s !== 'REFUNDED' && s !== 'FAILED') throw new DomainError('VALIDATION', 'Choose a refund status.');
      return { patch: { refundStatus: s as 'REFUNDED' | 'FAILED' }, effects: [], event: { message: `Refund marked ${s.toLowerCase()}`, reason: str(i.reason) || null, data: { reference: str(i.reference) } } };
    },
  },

  // ===================== Delivery agent =====================
  ACCEPT_DELIVERY: {
    roles: [AGENT],
    tone: 'success',
    label: 'Accept Delivery',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && o.activeAssignment!.status === 'OFFERED',
    plan: () => ({
      patch: {},
      effects: [{ type: 'SET_ASSIGNMENT_STATUS', status: 'ACCEPTED' }, notify('ADMIN', 'Delivery accepted', '')],
      event: { message: 'Delivery accepted by agent' },
    }),
  },
  REJECT_DELIVERY: {
    roles: [AGENT],
    tone: 'danger',
    label: 'Reject Delivery',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && f(o, ...BEFORE_PICKUP),
    fields: () => [
      {
        name: 'reason',
        label: 'Why are you rejecting?',
        type: 'select',
        required: true,
        options: ['Too far away', 'Vehicle issue', 'Already on another delivery', 'Shift ending', 'Other'].map((v) => ({ value: v, label: v })),
      },
    ],
    confirm: () => ({ title: 'Reject this delivery?', body: 'It will go back to the unassigned queue.', cta: 'Reject' }),
    plan: (o, a, i) => ({
      patch: {},
      effects: [{ type: 'SET_ASSIGNMENT_STATUS', status: 'REJECTED', reason: str(i.reason) }, notify('ADMIN', 'Delivery rejected by agent', str(i.reason))],
      event: { message: 'Delivery rejected by agent — returned to unassigned queue', reason: str(i.reason), data: { agentId: a.id, assignmentId: o.activeAssignment!.id } },
    }),
  },
  NAVIGATE_TO_PICKUP: {
    roles: [AGENT],
    kind: 'link',
    tone: 'neutral',
    label: 'Navigate to Pickup',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && o.activeAssignment!.status === 'ACCEPTED' && f(o, ...BEFORE_PICKUP),
  },
  NAVIGATE_TO_CUSTOMER: {
    roles: [AGENT],
    kind: 'link',
    tone: 'neutral',
    label: 'Navigate to Customer',
    guard: (o, a) => isMyAssignment(o, a) && f(o, F.PICKED_UP, F.OUT_FOR_DELIVERY),
  },
  CONFIRM_PICKUP: {
    roles: [AGENT],
    tone: 'primary',
    label: 'Confirm Pickup',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && o.activeAssignment!.status === 'ACCEPTED' && f(o, F.READY),
    plan: () => ({ patch: { fulfilmentStatus: F.PICKED_UP }, effects: [], event: { message: 'Parcel picked up by agent' } }),
  },
  START_DELIVERY: {
    roles: [AGENT],
    tone: 'primary',
    label: 'Start Delivery',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && f(o, F.PICKED_UP),
    plan: () => ({
      patch: { fulfilmentStatus: F.OUT_FOR_DELIVERY },
      effects: [notify('CUSTOMER', 'On the way', 'Your order is out for delivery.')],
      event: { message: 'Out for delivery' },
    }),
  },
  CONTACT_CUSTOMER: {
    roles: [AGENT, STAFF],
    kind: 'link',
    tone: 'neutral',
    label: 'Contact Customer',
    guard: (o, a) =>
      a.role === AGENT
        ? isMyAssignment(o, a) && o.activeAssignment!.status === 'ACCEPTED' && !f(o, F.DELIVERED, F.RETURNED_TO_WORKSPACE)
        : isMyBooking(o, a) && isActive(o),
  },
  MARK_DELIVERED: {
    roles: [AGENT],
    tone: 'success',
    label: 'Mark Delivered',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && f(o, F.OUT_FOR_DELIVERY, F.PICKED_UP),
    fields: (o) => (isCash(o) && o.codStatus === C.PENDING_COLLECTION ? [codAmountField(o, false, 'Cash collected from customer')] : []),
    confirm: (o) => ({
      title: 'Mark as delivered?',
      body: isCash(o) && o.codStatus === C.PENDING_COLLECTION ? `Collect ${money(o.totalPaise - o.codCollectedPaise)} in cash before confirming.` : 'Confirm the customer has received the order.',
      cta: 'Delivered',
    }),
    plan: (o, a, i) => ({
      patch: { fulfilmentStatus: F.DELIVERED },
      effects: [{ type: 'SET_ASSIGNMENT_STATUS', status: 'COMPLETED' }, ...codEffects(o, a, i, true), notify('CUSTOMER', 'Delivered', 'Your order has been delivered.'), notify('ADMIN', 'Order delivered', '')],
      event: { message: 'Delivered by agent' },
    }),
  },
  MARK_DELIVERY_FAILED: {
    roles: [AGENT],
    tone: 'danger',
    label: 'Mark Delivery Failed',
    guard: (o, a) => isActive(o) && isMyAssignment(o, a) && f(o, F.OUT_FOR_DELIVERY, F.PICKED_UP),
    fields: () => [
      {
        name: 'reason',
        label: 'Failure reason',
        type: 'select',
        required: true,
        options: ['Customer unavailable', 'Customer not reachable by phone', 'Wrong or incomplete address', 'Customer refused delivery', 'Payment not available (COD)', 'Unsafe / inaccessible location', 'Other'].map((v) => ({ value: v, label: v })),
      },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'What happened at the address?' },
      { name: 'evidence', label: 'Evidence (photo link or reference)', type: 'text', required: false },
    ],
    confirm: () => ({ title: 'Report failed delivery?', body: 'The workspace admin will decide whether to retry, reschedule, reassign or return.', cta: 'Report failure' }),
    plan: (_o, _a, i) => ({
      patch: { fulfilmentStatus: F.DELIVERY_FAILED, failureReason: str(i.reason), failureNotes: str(i.notes) || null, failureEvidence: str(i.evidence) || null },
      effects: [notify('ADMIN', 'Delivery failed', str(i.reason)), notify('CUSTOMER', 'Delivery attempt failed', 'We could not deliver your order. We will contact you shortly.')],
      event: { message: 'Delivery failed', reason: str(i.reason), data: { notes: str(i.notes), evidence: str(i.evidence) } },
    }),
  },
  RETURN_TO_WORKSPACE: {
    roles: [AGENT],
    tone: 'primary',
    label: 'Return to Workspace',
    // allowed even if the order was cancelled — the parcel still has to come back
    guard: (o, a) => isMyAssignment(o, a) && f(o, F.RETURNING),
    confirm: () => ({ title: 'Parcel returned?', body: 'Confirm you have handed the parcel back at the workspace.', cta: 'Returned' }),
    plan: () => ({
      patch: { fulfilmentStatus: F.RETURNED_TO_WORKSPACE, returnConfirmedAt: null },
      effects: [notify('ADMIN', 'Parcel returned to workspace', 'Please confirm receipt.')],
      event: { message: 'Agent returned parcel to workspace (awaiting confirmation)' },
    }),
  },

  // ===================== Customer simulation (sample API) =====================
  CUSTOMER_REQUEST_CANCELLATION: {
    roles: [CUSTOMER],
    tone: 'danger',
    label: 'Request cancellation',
    guard: (o) => isActive(o) && CUSTOMER_CANCELLABLE.includes(o.fulfilmentStatus) && !openRequest(o, 'CANCELLATION'),
    fields: () => [reasonField('Reason', true)],
    plan: (o, _a, i) => {
      if (inReview(o)) {
        // Policy: before the workspace has accepted, a customer cancellation is immediate.
        const c = cancellationEffects(o, false);
        return {
          patch: { ...c.patch, orderStatus: O.CANCELLED, fulfilmentStatus: F.CANCELLED, cancelReason: str(i.reason) },
          effects: [...c.effects, notify('ADMIN', 'Order cancelled by customer', str(i.reason))],
          event: { message: 'Cancelled by customer before acceptance', reason: str(i.reason) },
        };
      }
      return {
        patch: {},
        effects: [
          { type: 'CREATE_REQUEST', requestType: 'CANCELLATION', reason: str(i.reason), proposedStart: null, proposedSlotId: null },
          notify('ADMIN', 'Cancellation requested', str(i.reason)),
        ],
        event: { message: 'Customer requested cancellation', reason: str(i.reason) },
      };
    },
  },
  CUSTOMER_REQUEST_RESCHEDULE: {
    roles: [CUSTOMER],
    tone: 'neutral',
    label: 'Request reschedule',
    guard: (o, _a, wf) => wf.scheduled && isActive(o) && f(o, F.NOT_STARTED, F.AWAITING_SCHEDULE, F.SCHEDULED, F.NO_SHOW) && !openRequest(o, 'RESCHEDULE'),
    fields: () => [scheduleField('Preferred new time'), reasonField('Reason', false)],
    plan: (_o, _a, i) => {
      const s = parseSchedule(i);
      return {
        patch: {},
        effects: [
          { type: 'CREATE_REQUEST', requestType: 'RESCHEDULE', reason: str(i.reason) || null, proposedStart: s.start, proposedSlotId: s.slotId },
          notify('ADMIN', 'Reschedule requested', str(i.reason)),
        ],
        event: { message: 'Customer requested a reschedule', reason: str(i.reason) || null, data: s },
      };
    },
  },
  CUSTOMER_REQUEST_RETURN: {
    roles: [CUSTOMER],
    tone: 'neutral',
    label: 'Request return',
    guard: (o) => isProduct(o) && f(o, F.DELIVERED, F.COLLECTED) && !openRequest(o, 'RETURN') && o.orderStatus !== O.CANCELLED,
    fields: () => [reasonField('Reason for return')],
    plan: (_o, _a, i) => ({
      patch: {},
      effects: [
        { type: 'CREATE_REQUEST', requestType: 'RETURN', reason: str(i.reason), proposedStart: null, proposedSlotId: null },
        notify('ADMIN', 'Return requested', str(i.reason)),
      ],
      event: { message: 'Customer requested a return', reason: str(i.reason) },
    }),
  },
  CUSTOMER_RESPOND_CLARIFICATION: {
    roles: [CUSTOMER],
    tone: 'primary',
    label: 'Reply to clarification',
    guard: (o) => o.orderStatus === O.CLARIFICATION_REQUESTED,
    fields: () => [{ name: 'reason', label: 'Reply', type: 'textarea', required: true }],
    plan: (_o, _a, i) => ({
      patch: { orderStatus: O.PENDING_REVIEW },
      effects: [notify('ADMIN', 'Customer replied', str(i.reason))],
      event: { message: 'Customer replied to clarification', reason: str(i.reason) },
    }),
  },

  // ===================== System =====================
  PAYMENT_CONFIRMED: {
    roles: [SYSTEM],
    tone: 'success',
    label: 'Payment confirmed',
    guard: (o) => o.paymentStatus !== P.PAID && ONLINE_METHODS.includes(o.paymentMethod),
    plan: (o) => ({
      patch: {
        paymentStatus: P.PAID,
        ...(o.orderStatus === O.CANCELLED || o.orderStatus === O.REJECTED ? { refundStatus: R.PENDING } : {}),
      },
      effects: [],
      event: { message: 'Payment confirmed by payment provider' },
    }),
  },
  PAYMENT_FAILED: {
    roles: [SYSTEM],
    tone: 'danger',
    label: 'Payment failed',
    guard: (o) => o.paymentStatus === P.PENDING && ONLINE_METHODS.includes(o.paymentMethod),
    plan: (_o, _a, i) => ({
      patch: { paymentStatus: P.FAILED },
      effects: [notify('ADMIN', 'Payment failed', str(i.reason))],
      event: { message: 'Payment failed', reason: str(i.reason) || null },
    }),
  },
  ASSIGNMENT_EXPIRED: {
    roles: [SYSTEM],
    tone: 'neutral',
    label: 'Assignment expired',
    guard: (o) => o.activeAssignment?.status === 'OFFERED',
    plan: (o) => ({
      patch: {},
      effects: [{ type: 'SET_ASSIGNMENT_STATUS', status: 'EXPIRED', reason: 'Not accepted in time' }, notify('ADMIN', 'Assignment expired', 'The agent did not respond in time.')],
      event: { message: 'Assignment expired — returned to unassigned queue', data: { agentId: o.activeAssignment?.agentId } },
    }),
  },
};

function toPaise(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(str(v));
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('VALIDATION', 'Enter the amount collected.');
  return Math.round(n * 100);
}

/**
 * COD effects. `withAgent` = the cash is with a delivery agent and must be handed over;
 * otherwise it was collected at the workspace and is settled immediately.
 */
function codEffects(o: EngineOrder, a: Actor, i: Input, withAgent: boolean, required = false): Effect[] {
  if (!isCash(o) || !(o.codStatus === C.PENDING_COLLECTION || o.codStatus === C.COLLECTED)) return [];
  if (i.amount === undefined || i.amount === null || i.amount === '') {
    if (required) throw new DomainError('VALIDATION', 'Enter the amount collected.');
    return [];
  }
  const amountPaise = toPaise(i.amount);
  const agentId = withAgent ? (a.role === AGENT ? a.id : o.activeAssignment?.agentId ?? o.deliveredByAgentId ?? null) : null;
  return [{ type: 'RECORD_COD', amountPaise, agentId, settledImmediately: !withAgent || !agentId }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ordering of buttons: primary progression first, then neutral, then destructive, then links. */
const TONE_ORDER: Record<ActionTone, number> = { primary: 0, success: 1, warning: 2, neutral: 3, danger: 4 };

function describe(code: ActionCode, def: ActionDef, o: EngineOrder, a: Actor, wf: WorkflowConfig): ActionDescriptor {
  return {
    code,
    label: typeof def.label === 'function' ? def.label(o, a) : def.label,
    tone: typeof def.tone === 'function' ? def.tone(o, a) : def.tone,
    kind: def.kind ?? 'mutation',
    fields: def.fields ? def.fields(o, a, wf) : [],
    confirm: def.confirm ? def.confirm(o, a) : undefined,
    hint: def.hint ? def.hint(o) : undefined,
  };
}

/** All buttons this actor may see for this order right now (§6 "Buttons must appear contextually"). */
export function availableActions(o: EngineOrder, a: Actor): ActionDescriptor[] {
  const wf = workflowOf(o.fulfilmentType);
  const out: ActionDescriptor[] = [];
  (Object.keys(ACTIONS) as ActionCode[]).forEach((code) => {
    const def = ACTIONS[code];
    if (!def.roles.includes(a.role)) return;
    if (!def.guard(o, a, wf)) return;
    out.push(describe(code, def, o, a, wf));
  });
  return out.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'mutation' ? -1 : 1;
    return TONE_ORDER[x.tone] - TONE_ORDER[y.tone];
  });
}

export function isKnownAction(code: string): code is ActionCode {
  return Object.prototype.hasOwnProperty.call(ACTIONS, code);
}

function validateInput(fields: FieldDef[], input: Input): Input {
  const clean: Input = { ...input };
  for (const fd of fields) {
    const v = input[fd.name];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);
    if (empty) {
      if (fd.required) throw new DomainError('VALIDATION', `${fd.label} is required.`, { field: fd.name });
      continue;
    }
    if (typeof v === 'string' && v.length > 2000) throw new DomainError('VALIDATION', `${fd.label} is too long.`, { field: fd.name });
    if (fd.type === 'number' || fd.type === 'money') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new DomainError('VALIDATION', `${fd.label} must be a number.`, { field: fd.name });
      if (fd.min !== undefined && n < fd.min) throw new DomainError('VALIDATION', `${fd.label} must be at least ${fd.min}.`, { field: fd.name });
      if (fd.max !== undefined && n > fd.max) throw new DomainError('VALIDATION', `${fd.label} must be at most ${fd.max}.`, { field: fd.name });
    }
    if (fd.type === 'select' && fd.options && !fd.options.some((op) => op.value === String(v))) {
      throw new DomainError('VALIDATION', `${fd.label} has an invalid value.`, { field: fd.name });
    }
    if (fd.type === 'datetime' && Number.isNaN(Date.parse(String(v)))) {
      throw new DomainError('VALIDATION', `${fd.label} must be a valid date & time.`, { field: fd.name });
    }
  }
  return clean;
}

/**
 * Validate an action and compute the resulting patch + side-effects.
 * Throws DomainError if the transition is not allowed for this order/role/status.
 */
export function planAction(o: EngineOrder, a: Actor, code: string, input: Input = {}): ActionPlan & { code: ActionCode } {
  if (!isKnownAction(code)) throw new DomainError('UNKNOWN_ACTION', `Unknown action “${code}”.`);
  const def = ACTIONS[code];
  const wf = workflowOf(o.fulfilmentType);
  if (!def.roles.includes(a.role)) throw new DomainError('FORBIDDEN', 'Your role is not allowed to perform this action.');
  if ((def.kind ?? 'mutation') === 'link') throw new DomainError('VALIDATION', 'This action does not change the order.');
  if (!def.guard(o, a, wf)) {
    throw new DomainError(
      'ACTION_NOT_ALLOWED',
      `“${describe(code, def, o, a, wf).label}” is not available while the ${noun(o)} is ${o.orderStatus.toLowerCase().replace(/_/g, ' ')} / ${o.fulfilmentStatus.toLowerCase().replace(/_/g, ' ')}.`,
      { orderStatus: o.orderStatus, fulfilmentStatus: o.fulfilmentStatus },
    );
  }
  const fields = def.fields ? def.fields(o, a, wf) : [];
  const clean = validateInput(fields, input);
  const plan = def.plan!(o, a, clean, wf);
  return { ...plan, code };
}

/**
 * Apply a patch in memory and derive the order status and exception flag.
 * Order status is derived from fulfilment + payment so the four statuses never contradict.
 */
export function deriveOrderStatus(next: {
  orderStatus: OrderStatus;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: EngineOrder['paymentStatus'];
}): OrderStatus {
  const s = next.orderStatus;
  if (s === O.CANCELLED || s === O.REJECTED || s === O.PENDING_REVIEW || s === O.CLARIFICATION_REQUESTED) return s;
  if (s === O.COMPLETED) return s;
  if (FULFILLED_STATUSES.includes(next.fulfilmentStatus) && next.paymentStatus === P.PAID) return O.COMPLETED;
  const waiting: FulfilmentStatus[] = [F.AWAITING_PREPARATION, F.AWAITING_SCHEDULE, F.SCHEDULED, F.NOT_STARTED];
  if (waiting.includes(next.fulfilmentStatus)) return O.CONFIRMED;
  return O.IN_PROGRESS;
}

/** Single exception code (or null) used for the "Exceptions" dashboard card and filters (§5). */
export function computeException(o: {
  orderStatus: OrderStatus;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: EngineOrder['paymentStatus'];
  paymentMethod: EngineOrder['paymentMethod'];
  codStatus: EngineOrder['codStatus'];
  refundStatus: EngineOrder['refundStatus'];
  returnConfirmedAt?: string | null;
  openRequests: Array<{ type: string }>;
}): string | null {
  const active = !TERMINAL_ORDER_STATUSES.includes(o.orderStatus);
  if (o.codStatus === C.DISCREPANCY) return 'COD_DISCREPANCY';
  if (o.fulfilmentStatus === F.RETURNING) return 'RETURNING';
  if (o.fulfilmentStatus === F.RETURNED_TO_WORKSPACE && !o.returnConfirmedAt) return 'RETURN_TO_CONFIRM';
  if (active && EXCEPTION_FULFILMENT_STATUSES.includes(o.fulfilmentStatus) && o.fulfilmentStatus !== F.RETURN_APPROVED) return o.fulfilmentStatus;
  if (o.fulfilmentStatus === F.RETURN_APPROVED) return 'RETURN_IN_PROGRESS';
  const req = o.openRequests[0];
  if (req) return `${req.type}_REQUESTED`;
  if (active && o.paymentStatus === P.FAILED) return 'PAYMENT_FAILED';
  if (o.refundStatus === R.PENDING || o.refundStatus === R.FAILED) return o.refundStatus === R.FAILED ? 'REFUND_FAILED' : 'REFUND_PENDING';
  if (o.codStatus === C.COLLECTED && o.paymentStatus !== P.PAID) return 'COD_SHORT_COLLECTED';
  if (FULFILLED_STATUSES.includes(o.fulfilmentStatus) && o.paymentStatus !== P.PAID && o.orderStatus !== O.CANCELLED) return 'PAYMENT_PENDING';
  return null;
}

export const EXCEPTION_LABEL: Record<string, string> = {
  COD_DISCREPANCY: 'COD discrepancy',
  RETURNING: 'Returning to workspace',
  RETURN_TO_CONFIRM: 'Return to confirm',
  DELIVERY_FAILED: 'Delivery failed',
  RETURNED_TO_WORKSPACE: 'Returned — action needed',
  NO_SHOW: 'Customer unavailable',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  SERVICE_FAILED: 'Service failed',
  RETURN_IN_PROGRESS: 'Return in progress',
  CANCELLATION_REQUESTED: 'Cancellation requested',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
  RETURN_REQUESTED: 'Return requested',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_PENDING: 'Refund pending',
  REFUND_FAILED: 'Refund failed',
  COD_SHORT_COLLECTED: 'Cash short-collected',
  PAYMENT_PENDING: 'Payment pending',
};

/** Exposed for documentation generation & tests. */
export const ACTION_CODES = Object.keys(ACTIONS) as ActionCode[];
export function actionRoles(code: ActionCode): Role[] {
  return ACTIONS[code].roles;
}
export function actionKind(code: ActionCode): 'mutation' | 'link' {
  return ACTIONS[code].kind ?? 'mutation';
}
