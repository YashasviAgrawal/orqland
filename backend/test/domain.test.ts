/**
 * Unit tests for the workflow engine (no database needed).
 * Run: npm run test:unit
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableActions,
  planAction,
  deriveOrderStatus,
  computeException,
  DomainError,
  ACTION_CODES,
  actionRoles,
} from '../src/domain/engine';
import { FulfilmentStatus, FulfilmentType, OrderStatus, Role } from '../src/domain/enums';
import { stagesFor, workflowOf, WORKFLOWS } from '../src/domain/workflows';
import type { ActionPlan, Actor, EngineOrder } from '../src/domain/types';

const admin: Actor = { id: 'u-admin', role: Role.ADMIN };
const agent: Actor = { id: 'u-agent', role: Role.AGENT };
const agent2: Actor = { id: 'u-agent-2', role: Role.AGENT };
const provider: Actor = { id: 'u-prov', role: Role.STAFF };
const customer: Actor = { id: 'c-1', role: Role.CUSTOMER };
const system: Actor = { id: 'system', role: Role.SYSTEM };

function order(type: FulfilmentType, over: Partial<EngineOrder> = {}): EngineOrder {
  const wf = workflowOf(type);
  return {
    id: 'o1',
    kind: wf.kind,
    fulfilmentType: type,
    orderStatus: 'PENDING_REVIEW',
    fulfilmentStatus: 'NOT_STARTED',
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    codStatus: 'NOT_APPLICABLE',
    refundStatus: 'NOT_APPLICABLE',
    totalPaise: 99800,
    codCollectedPaise: 0,
    scheduledStart: wf.scheduled ? '2026-11-01T10:00:00.000Z' : null,
    scheduledEnd: null,
    slotId: wf.scheduled ? 'slot-1' : null,
    usesSlots: wf.scheduled,
    providerId: wf.kind === 'SERVICE' ? provider.id : null,
    providerConfirmedAt: null,
    meetingLink: null,
    returnConfirmedAt: null,
    afterReturnAction: null,
    deliveredByAgentId: null,
    activeAssignment: null,
    openRequests: [],
    ...over,
  };
}

/** Minimal in-memory simulation of what the service layer does with a plan. */
function apply(o: EngineOrder, plan: ActionPlan): EngineOrder {
  const next: EngineOrder = { ...o, ...(plan.patch as Partial<EngineOrder>) };
  for (const e of plan.effects) {
    if (e.type === 'OFFER_ASSIGNMENT') next.activeAssignment = { id: 'as-1', agentId: e.agentId ?? agent.id, status: 'OFFERED', expiresAt: null };
    if (e.type === 'SET_ASSIGNMENT_STATUS' && next.activeAssignment) {
      if (e.status === 'ACCEPTED') next.activeAssignment = { ...next.activeAssignment, status: 'ACCEPTED' };
      else {
        if (e.status === 'COMPLETED') next.deliveredByAgentId = next.activeAssignment.agentId;
        next.activeAssignment = null;
      }
    }
    if (e.type === 'RECORD_COD') {
      next.codCollectedPaise += e.amountPaise;
      next.codStatus = e.settledImmediately ? 'SETTLED' : 'COLLECTED';
      if (next.codCollectedPaise >= next.totalPaise) next.paymentStatus = 'PAID';
    }
    if (e.type === 'CREATE_REQUEST') next.openRequests = [...next.openRequests, { id: 'r1', type: e.requestType, requestedByRole: Role.CUSTOMER, reason: e.reason, proposedStart: e.proposedStart, proposedSlotId: e.proposedSlotId }];
    if (e.type === 'RESOLVE_REQUEST') next.openRequests = next.openRequests.filter((r) => r.id !== e.requestId);
  }
  next.orderStatus = deriveOrderStatus(next);
  return next;
}

function run(o: EngineOrder, a: Actor, code: string, input: Record<string, unknown> = {}) {
  return apply(o, planAction(o, a, code, input));
}
const codes = (o: EngineOrder, a: Actor) => availableActions(o, a).map((x) => x.code);

describe('Delivery to Customer', () => {
  test('full happy path with COD collection and completion', () => {
    let o = order('DELIVERY', { paymentMethod: 'CASH', paymentStatus: 'PENDING', codStatus: 'PENDING_COLLECTION' });
    assert.ok(codes(o, admin).includes('ACCEPT_AND_START_PREP'));
    o = run(o, admin, 'ACCEPT_AND_START_PREP');
    assert.equal(o.orderStatus, 'IN_PROGRESS');
    assert.equal(o.fulfilmentStatus, 'PREPARING');

    o = run(o, admin, 'ADD_PREP_TIME', { minutes: '5' });
    o = run(o, admin, 'MARK_READY');
    assert.equal(o.fulfilmentStatus, 'READY');
    assert.ok(codes(o, admin).includes('ASSIGN_AGENT'));
    assert.ok(codes(o, admin).includes('AUTO_ASSIGN_AGENT'));

    o = run(o, admin, 'ASSIGN_AGENT', { agentId: agent.id });
    assert.deepEqual(codes(o, agent).filter((c) => ['ACCEPT_DELIVERY', 'REJECT_DELIVERY'].includes(c)).sort(), ['ACCEPT_DELIVERY', 'REJECT_DELIVERY']);
    assert.equal(codes(o, agent2).length, 0, 'other agents see nothing');

    o = run(o, agent, 'ACCEPT_DELIVERY');
    assert.ok(codes(o, agent).includes('NAVIGATE_TO_PICKUP'));
    o = run(o, agent, 'CONFIRM_PICKUP');
    o = run(o, agent, 'START_DELIVERY');
    assert.equal(o.fulfilmentStatus, 'OUT_FOR_DELIVERY');
    assert.ok(codes(o, admin).includes('TRACK_DELIVERY'));
    assert.ok(codes(o, agent).includes('CONTACT_CUSTOMER'));

    o = run(o, agent, 'MARK_DELIVERED');
    assert.equal(o.fulfilmentStatus, 'DELIVERED');
    assert.equal(o.orderStatus, 'IN_PROGRESS', 'not complete until cash is recorded');
    assert.equal(computeException(o), 'PAYMENT_PENDING');
    assert.ok(codes(o, agent).includes('RECORD_COD_COLLECTED'));

    o = run(o, agent, 'RECORD_COD_COLLECTED', { amount: 998 });
    assert.equal(o.codStatus, 'COLLECTED');
    assert.equal(o.paymentStatus, 'PAID');
    assert.equal(o.orderStatus, 'COMPLETED');
  });

  test('cannot cancel once out for delivery; can after failure', () => {
    let o = order('DELIVERY', { orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'OUT_FOR_DELIVERY', activeAssignment: { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } });
    assert.ok(!codes(o, admin).includes('CANCEL'));
    assert.throws(() => planAction(o, admin, 'CANCEL', { reason: 'x' }), (e: DomainError) => e.code === 'ACTION_NOT_ALLOWED');

    o = run(o, agent, 'MARK_DELIVERY_FAILED', { reason: 'Customer unavailable', notes: 'Rang twice' });
    assert.equal(o.fulfilmentStatus, 'DELIVERY_FAILED');
    const opts = codes(o, admin);
    for (const c of ['RETRY_DELIVERY', 'RESCHEDULE', 'REASSIGN_AGENT', 'APPROVE_RETURN', 'CANCEL']) assert.ok(opts.includes(c as never), `missing ${c}`);
    assert.equal(computeException(o), 'DELIVERY_FAILED');
  });

  test('failed delivery → approve return → agent returns → admin confirms → retry', () => {
    let o = order('DELIVERY', { orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'DELIVERY_FAILED', activeAssignment: { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } });
    o = run(o, admin, 'APPROVE_RETURN');
    assert.equal(o.fulfilmentStatus, 'RETURNING');
    o = run(o, agent, 'RETURN_TO_WORKSPACE');
    assert.equal(o.fulfilmentStatus, 'RETURNED_TO_WORKSPACE');
    assert.ok(!codes(o, admin).includes('RETRY_DELIVERY'), 'must confirm receipt first');
    o = run(o, admin, 'CONFIRM_RETURN_RECEIVED');
    o = { ...o, returnConfirmedAt: new Date().toISOString() };
    o = run(o, admin, 'RETRY_DELIVERY');
    assert.equal(o.fulfilmentStatus, 'READY');
    assert.ok(codes(o, admin).includes('ASSIGN_AGENT'));
  });

  test('cancelling after a failed delivery still lets the agent return the parcel', () => {
    let o = order('DELIVERY', { orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'DELIVERY_FAILED', activeAssignment: { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } });
    o = run(o, admin, 'CANCEL', { reason: 'Customer unreachable for 2 days' });
    assert.equal(o.orderStatus, 'CANCELLED');
    assert.equal(o.fulfilmentStatus, 'RETURNING');
    assert.equal(o.refundStatus, 'PENDING', 'paid order → refund pending recorded separately');
    assert.ok(codes(o, agent).includes('RETURN_TO_WORKSPACE'));
    assert.ok(!codes(o, admin).includes('START_PREPARATION'));
  });

  test('reassignment after pickup requires a reason', () => {
    const o = order('DELIVERY', { orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'PICKED_UP', activeAssignment: { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } });
    assert.throws(() => planAction(o, admin, 'REASSIGN_AGENT', { agentId: agent2.id }), (e: DomainError) => e.code === 'VALIDATION');
    const plan = planAction(o, admin, 'REASSIGN_AGENT', { agentId: agent2.id, reason: 'Bike breakdown' });
    assert.equal(plan.patch.fulfilmentStatus, 'READY');
    assert.ok(!availableActions(o, agent).some((x) => x.code === 'REASSIGN_AGENT'), 'agents cannot reassign');
  });

  test('agent rejection returns order to the unassigned queue', () => {
    let o = order('DELIVERY', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'READY', activeAssignment: { id: 'a', agentId: agent.id, status: 'OFFERED', expiresAt: null } });
    assert.throws(() => planAction(o, agent, 'REJECT_DELIVERY', {}), /required/);
    o = run(o, agent, 'REJECT_DELIVERY', { reason: 'Too far away' });
    assert.equal(o.activeAssignment, null);
    assert.ok(codes(o, admin).includes('ASSIGN_AGENT'));
  });
});

describe('Product fulfilment variants', () => {
  test('take away has no delivery agent and confirms handover', () => {
    let o = order('TAKEAWAY');
    o = run(o, admin, 'ACCEPT');
    assert.equal(o.fulfilmentStatus, 'AWAITING_PREPARATION');
    o = run(o, admin, 'START_PREPARATION');
    o = run(o, admin, 'MARK_READY');
    const c = codes(o, admin);
    assert.ok(!c.includes('ASSIGN_AGENT'));
    assert.ok(c.includes('CONFIRM_PICKUP_HANDOVER'));
    o = run(o, admin, 'CONFIRM_PICKUP_HANDOVER');
    assert.equal(o.orderStatus, 'COMPLETED');
  });

  test('scheduled take away starts in SCHEDULED and can be rescheduled', () => {
    let o = order('SCHEDULED_TAKEAWAY');
    o = run(o, admin, 'ACCEPT');
    assert.equal(o.fulfilmentStatus, 'SCHEDULED');
    assert.ok(!codes(o, admin).includes('ACCEPT_AND_START_PREP'));
    assert.ok(codes(o, admin).includes('RESCHEDULE'));
    const plan = planAction(o, admin, 'RESCHEDULE', { schedule: { slotId: 'slot-2' }, reason: 'Kitchen closed' });
    assert.ok(plan.effects.some((e) => e.type === 'MOVE_SCHEDULE'));
  });

  test('dine in is served and payment collected at counter', () => {
    let o = order('DINE_IN', { paymentMethod: 'CASH', paymentStatus: 'PENDING', codStatus: 'PENDING_COLLECTION' });
    o = run(o, admin, 'ACCEPT_AND_START_PREP');
    o = run(o, admin, 'MARK_READY');
    o = run(o, admin, 'CONFIRM_SERVED', { amount: 998 });
    assert.equal(o.codStatus, 'SETTLED', 'counter cash needs no agent handover');
    assert.equal(o.orderStatus, 'COMPLETED');
  });

  test('scheduled delivery customer reschedule request is accepted by admin', () => {
    let o = order('SCHEDULED_DELIVERY', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED' });
    o = run(o, customer, 'CUSTOMER_REQUEST_RESCHEDULE', { schedule: { slotId: 'slot-9' } });
    assert.equal(computeException(o), 'RESCHEDULE_REQUESTED');
    const plan = planAction(o, admin, 'APPROVE_RESCHEDULE_REQUEST');
    assert.deepEqual(plan.effects[0], { type: 'MOVE_SCHEDULE', slotId: 'slot-9', start: null });
  });
});

describe('Review, cancellation & rejection', () => {
  test('reject requires a reason and releases capacity', () => {
    const o = order('CONSULTATION');
    assert.throws(() => planAction(o, admin, 'REJECT', {}), (e: DomainError) => e.code === 'VALIDATION');
    const plan = planAction(o, admin, 'REJECT', { reason: 'Fully booked' });
    assert.equal(plan.patch.orderStatus, 'REJECTED');
    assert.ok(plan.effects.some((e) => e.type === 'RELEASE_SLOT'));
    assert.equal(plan.patch.refundStatus, 'PENDING');
  });

  test('rejected and cancelled orders cannot progress', () => {
    for (const s of ['CANCELLED', 'REJECTED'] as OrderStatus[]) {
      const o = order('DELIVERY', { orderStatus: s, fulfilmentStatus: 'CANCELLED' });
      const c = codes(o, admin).filter((x) => !['VIEW_PAYMENT_DETAILS'].includes(x));
      assert.deepEqual(c, [], `${s} should expose no progression actions, got ${c}`);
    }
  });

  test('customer cancellation before acceptance is immediate; afterwards needs confirmation', () => {
    let o = order('DELIVERY');
    o = run(o, customer, 'CUSTOMER_REQUEST_CANCELLATION', { reason: 'Ordered by mistake' });
    assert.equal(o.orderStatus, 'CANCELLED');

    let o2 = order('DELIVERY', { orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'PREPARING' });
    o2 = run(o2, customer, 'CUSTOMER_REQUEST_CANCELLATION', { reason: 'Ordered by mistake' });
    assert.equal(o2.orderStatus, 'IN_PROGRESS');
    assert.ok(codes(o2, admin).includes('CONFIRM_CANCELLATION'));
    o2 = run(o2, admin, 'CONFIRM_CANCELLATION');
    assert.equal(o2.orderStatus, 'CANCELLED');
  });

  test('clarification round-trip', () => {
    let o = order('EVENT');
    o = run(o, admin, 'REQUEST_CLARIFICATION', { reason: 'How many guests?' });
    assert.equal(o.orderStatus, 'CLARIFICATION_REQUESTED');
    o = run(o, customer, 'CUSTOMER_RESPOND_CLARIFICATION', { reason: '80 guests' });
    assert.equal(o.orderStatus, 'PENDING_REVIEW');
  });
});

describe('Services', () => {
  test('event service always needs admin review and schedule confirmation', () => {
    let o = order('EVENT');
    assert.ok(!codes(o, provider).includes('CONFIRM_APPOINTMENT'));
    o = run(o, admin, 'ACCEPT');
    assert.equal(o.fulfilmentStatus, 'AWAITING_SCHEDULE');
    o = run(o, admin, 'CONFIRM_SCHEDULE');
    assert.equal(o.fulfilmentStatus, 'SCHEDULED');
    o = run(o, provider, 'START_TRAVEL');
    o = run(o, provider, 'START_SERVICE');
    o = run(o, provider, 'MARK_SERVICE_COMPLETED');
    assert.equal(o.orderStatus, 'COMPLETED');
  });

  test('consultation can be confirmed by the provider and supports no-show → reschedule', () => {
    let o = order('CONSULTATION');
    o = run(o, provider, 'CONFIRM_APPOINTMENT');
    assert.equal(o.orderStatus, 'CONFIRMED');
    o = run(o, provider, 'REPORT_CUSTOMER_UNAVAILABLE', { reason: 'Customer did not show up' });
    assert.equal(o.fulfilmentStatus, 'NO_SHOW');
    assert.equal(computeException(o), 'NO_SHOW');
    o = run(o, admin, 'RESCHEDULE', { schedule: { start: '2026-11-03T09:00:00Z' }, reason: 'Customer asked' });
    assert.equal(o.fulfilmentStatus, 'SCHEDULED');
    assert.equal(o.orderStatus, 'CONFIRMED');
  });

  test('provider unavailable → reassign provider', () => {
    let o = order('AT_PROVIDER_LOCATION', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED' });
    o = run(o, admin, 'REPORT_PROVIDER_UNAVAILABLE', { reason: 'Sick leave' });
    o = run(o, admin, 'ASSIGN_PROVIDER', { providerId: 'u-prov-2' });
    assert.equal(o.fulfilmentStatus, 'SCHEDULED');
    assert.equal(o.providerId, 'u-prov-2');
  });

  test('workshop attendance then completion; other providers see nothing', () => {
    let o = order('WORKSHOP', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED' });
    assert.deepEqual(codes(o, { id: 'someone-else', role: Role.STAFF }), []);
    o = run(o, provider, 'MARK_ATTENDED');
    assert.equal(o.fulfilmentStatus, 'CHECKED_IN');
    o = run(o, provider, 'MARK_SERVICE_COMPLETED');
    assert.equal(o.orderStatus, 'COMPLETED');
  });

  test('online session needs a valid meeting link and supports failed sessions', () => {
    let o = order('ONLINE', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED' });
    assert.throws(() => planAction(o, provider, 'SET_MEETING_DETAILS', { meetingLink: 'zoom' }), /http/);
    o = run(o, provider, 'SET_MEETING_DETAILS', { meetingLink: 'https://meet.example.com/abc' });
    assert.equal(o.meetingLink, 'https://meet.example.com/abc');
    o = run(o, provider, 'MARK_SERVICE_FAILED', { reason: 'Customer audio not working' });
    assert.equal(o.fulfilmentStatus, 'SERVICE_FAILED');
    assert.ok(codes(o, admin).includes('RESCHEDULE'));
  });

  test('provider can request rescheduling, admin decides', () => {
    let o = order('AT_CUSTOMER_LOCATION', { orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED' });
    o = { ...apply(o, planAction(o, provider, 'REQUEST_RESCHEDULING', { reason: 'Clash with another job', proposedStart: '2026-11-05T10:00:00Z' })) };
    assert.ok(codes(o, admin).includes('APPROVE_RESCHEDULE_REQUEST'));
    assert.ok(!codes(o, provider).includes('REQUEST_RESCHEDULING'), 'no duplicate requests');
  });
});

describe('Payments', () => {
  test('duplicate payment confirmation is rejected', () => {
    const o = order('DELIVERY', { paymentStatus: 'PAID' });
    assert.throws(() => planAction(o, system, 'PAYMENT_CONFIRMED'), (e: DomainError) => e.code === 'ACTION_NOT_ALLOWED');
  });

  test('admin cannot mark online payment as paid manually', () => {
    const o = order('DELIVERY', { paymentStatus: 'PENDING' });
    assert.throws(() => planAction(o, admin, 'PAYMENT_CONFIRMED'), (e: DomainError) => e.code === 'FORBIDDEN');
  });

  test('payment failure → retry', () => {
    let o = order('DELIVERY', { paymentStatus: 'PENDING', orderStatus: 'CONFIRMED', fulfilmentStatus: 'AWAITING_PREPARATION' });
    o = run(o, system, 'PAYMENT_FAILED', { reason: 'Insufficient funds' });
    assert.equal(o.paymentStatus, 'FAILED');
    assert.equal(computeException(o), 'PAYMENT_FAILED');
    const plan = planAction(o, admin, 'RETRY_PAYMENT');
    assert.equal(plan.patch.paymentStatus, 'PENDING');
    assert.ok(plan.effects.some((e) => e.type === 'CREATE_PAYMENT_ATTEMPT'));
  });

  test('short COD collection keeps payment pending', () => {
    let o = order('DELIVERY', { paymentMethod: 'CASH', paymentStatus: 'PENDING', codStatus: 'PENDING_COLLECTION', orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'OUT_FOR_DELIVERY', activeAssignment: { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } });
    o = run(o, agent, 'MARK_DELIVERED', { amount: 500 });
    assert.equal(o.paymentStatus, 'PENDING');
    assert.equal(computeException(o), 'COD_SHORT_COLLECTED');
    assert.ok(codes(o, admin).includes('RECORD_COD_COLLECTED'));
  });
});

describe('Engine invariants', () => {
  test('every action has at least one role', () => {
    for (const c of ACTION_CODES) assert.ok(actionRoles(c).length > 0, c);
  });

  test('availableActions never throws for any type × status × role combination, and every listed mutation is plannable or needs input', () => {
    const roles = [admin, agent, provider, customer];
    const orderStatuses = Object.values(OrderStatus);
    const fStatuses = Object.values(FulfilmentStatus);
    let combos = 0;
    for (const type of Object.keys(WORKFLOWS) as FulfilmentType[]) {
      for (const os of orderStatuses) {
        for (const fs of fStatuses) {
          for (const withAssignment of [false, true]) {
            const o = order(type, {
              orderStatus: os,
              fulfilmentStatus: fs,
              activeAssignment: withAssignment ? { id: 'a', agentId: agent.id, status: 'ACCEPTED', expiresAt: null } : null,
            });
            for (const r of roles) {
              const acts = availableActions(o, r);
              combos++;
              for (const act of acts) {
                if (act.kind !== 'mutation') continue;
                if (act.fields.some((fd) => fd.required)) continue;
                // actions without required inputs must be plannable as offered
                try {
                  planAction(o, r, act.code, {});
                } catch (e) {
                  const err = e as DomainError;
                  assert.ok(err.code === 'VALIDATION', `${type}/${os}/${fs}/${r.role}: ${act.code} offered but threw ${err.code}: ${err.message}`);
                }
              }
            }
          }
        }
      }
    }
    assert.ok(combos > 10000);
  });

  test('stages only include steps relevant to the fulfilment type', () => {
    const take = stagesFor({ fulfilmentType: 'TAKEAWAY', orderStatus: 'IN_PROGRESS', fulfilmentStatus: 'READY', paymentStatus: 'PAID' });
    assert.ok(!take.some((s) => s.label.includes('delivery')));
    assert.equal(take.find((s) => s.state === 'current')?.key, 'ready');
    const done = stagesFor({ fulfilmentType: 'DELIVERY', orderStatus: 'COMPLETED', fulfilmentStatus: 'DELIVERED', paymentStatus: 'PAID' });
    assert.ok(done.every((s) => s.state === 'done'));
    const ws = stagesFor({ fulfilmentType: 'WORKSHOP', orderStatus: 'CONFIRMED', fulfilmentStatus: 'SCHEDULED', paymentStatus: 'PAID' });
    assert.ok(!ws.some((s) => s.key === 'preparation'));
  });
});
