/**
 * Integration tests against a real PostgreSQL database (TEST_DATABASE_URL).
 * They exercise the services exactly as the HTTP controllers call them, including
 * transactions, locking, DB constraints, triggers and the sample seed.
 *
 *   createdb orqland_om_test
 *   TEST_DATABASE_URL=postgres://… npm run test:e2e
 */
import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/database/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AssignmentService } from '../src/delivery/assignment.service';
import { OrderActionsService } from '../src/orders/order-actions.service';
import { OrderQueryService } from '../src/orders/order-query.service';
import { OrderCreationService, CreateOrderInput } from '../src/orders/order-creation.service';
import { ScheduleService } from '../src/schedule/schedule.service';
import { SettlementsService } from '../src/settlements/settlements.service';
import { PaymentsService } from '../src/payments/payments.service';
import { AgentController, DeliveryController, ProviderController } from '../src/delivery/delivery.controller';
import type { AuthUser } from '../src/common/auth/auth.types';
import { translateDbError } from '../src/common/errors';

const WS = '11111111-1111-4111-8111-111111111111';
const admin: AuthUser = { id: 'a0000000-0000-4000-8000-000000000001', role: 'WORKSPACE_ADMIN', name: 'Sanjay J', workspaceId: WS };
const ravi: AuthUser = { id: 'a0000000-0000-4000-8000-000000000002', role: 'DELIVERY_AGENT', name: 'Ravi Kumar', workspaceId: WS };
const suresh: AuthUser = { id: 'a0000000-0000-4000-8000-000000000003', role: 'DELIVERY_AGENT', name: 'Suresh M', workspaceId: WS };
const priya: AuthUser = { id: 'a0000000-0000-4000-8000-000000000005', role: 'SERVICE_PROVIDER', name: 'Priya S', workspaceId: WS };
const meena: AuthUser = { id: 'a0000000-0000-4000-8000-000000000007', role: 'SERVICE_PROVIDER', name: 'Meena V', workspaceId: WS };
const customer = (id: string): AuthUser => ({ id, role: 'CUSTOMER', name: 'Customer', workspaceId: WS });
const C = {
  ram: 'c0000000-0000-4000-8000-000000000001',
  prem: 'c0000000-0000-4000-8000-000000000002',
  anitha: 'c0000000-0000-4000-8000-000000000003',
  deepak: 'c0000000-0000-4000-8000-000000000004',
  kavya: 'c0000000-0000-4000-8000-000000000007',
};
const L = {
  mug: 'b0000000-0000-4000-8000-000000000001',
  coffee: 'b0000000-0000-4000-8000-000000000002',
  planter: 'b0000000-0000-4000-8000-000000000003',
  spa: 'b0000000-0000-4000-8000-000000000011',
  ac: 'b0000000-0000-4000-8000-000000000012',
  pottery: 'b0000000-0000-4000-8000-000000000014',
  consult: 'b0000000-0000-4000-8000-000000000015',
  online: 'b0000000-0000-4000-8000-000000000016',
};

let db: DatabaseService;
let actions: OrderActionsService;
let queries: OrderQueryService;
let creation: OrderCreationService;
let schedule: ScheduleService;
let settlements: SettlementsService;
let payments: PaymentsService;

async function resetDatabase() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const dir = join(__dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await c.query(readFileSync(join(dir, f), 'utf8'));
  await c.query(readFileSync(join(__dirname, '..', 'seeds', 'sample_data.sql'), 'utf8'));
  await c.end();
}

async function expectError(p: Promise<unknown>, code: string | RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string; getResponse?: () => { code?: string } };
    const got = err.getResponse?.().code ?? translateDbError(err)?.code ?? err.code ?? '';
    if (code instanceof RegExp) assert.match(`${got} ${err.message}`, code);
    else assert.equal(got, code, `expected ${code}, got ${got}: ${err.message}`);
    return;
  }
  assert.fail(`expected error ${code}`);
}

const place = (cust: string, input: Omit<CreateOrderInput, 'customerId'>, key?: string) => creation.create(customer(cust), { customerId: cust, ...input }, key);
const detail = (id: string, user: AuthUser = admin) => queries.detail(user, id);
const act = (user: AuthUser, id: string, code: string, input: Record<string, unknown> = {}) => actions.execute(user, id, code, input);
async function slotFor(listingId: string | null, kind: string, minRemaining = 1, offsetDays = 1): Promise<string> {
  const r = await db.one<{ id: string }>(
    `SELECT id FROM slots WHERE workspace_id = $1 AND kind = $2 AND ($3::uuid IS NULL AND listing_id IS NULL OR listing_id = $3::uuid)
       AND status = 'OPEN' AND capacity - reserved >= $4 AND starts_at > now() + make_interval(days => $5) ORDER BY starts_at LIMIT 1`,
    [WS, kind, listingId, minRemaining, offsetDays],
  );
  assert.ok(r, `no ${kind} slot`);
  return r.id;
}

before(async () => {
  await resetDatabase();
  db = new DatabaseService();
  const audit = new AuditService();
  const notifications = new NotificationsService(db);
  actions = new OrderActionsService(db, audit, notifications, new AssignmentService());
  queries = new OrderQueryService(db);
  creation = new OrderCreationService(db, audit, notifications);
  schedule = new ScheduleService(db, audit, actions);
  settlements = new SettlementsService(db, audit, notifications);
  payments = new PaymentsService(db, actions, notifications);
});

after(async () => {
  await db.onModuleDestroy();
});

describe('Dashboard queries on the sample data', () => {
  test('every card / tab view loads and counts match the list totals', async () => {
    const s = await queries.summary(admin, {});
    for (const view of ['all', 'new', 'confirmed', 'in_progress', 'completed', 'cancelled', 'exceptions', 'processing', 'ongoing', 'upcoming'] as const) {
      const l = await queries.list(admin, { view, pageSize: 100 });
      assert.equal(l.total, s.counts[view], `view ${view}`);
      for (const o of l.items) assert.ok(Array.isArray(o.actions));
    }
    assert.ok(s.counts.new >= 7);
    assert.ok(s.counts.exceptions >= 6);
    assert.ok(s.cod.outstandingPaise > 0);
  });

  test('filters: kind, fulfilment type, search by code / customer, date', async () => {
    const services = await queries.list(admin, { kind: 'SERVICE', pageSize: 100 });
    assert.ok(services.items.every((o) => o.kind === 'SERVICE'));
    const takeaway = await queries.list(admin, { fulfilmentTypes: ['TAKEAWAY', 'SCHEDULED_TAKEAWAY'], pageSize: 100 });
    assert.ok(takeaway.items.length > 0 && takeaway.items.every((o) => o.fulfilmentType.includes('TAKEAWAY')));
    const byName = await queries.list(admin, { q: 'prem kumar' });
    assert.ok(byName.items.length > 0 && byName.items.every((o) => o.customer.name === 'Prem Kumar S'));
    const code = byName.items[0].code;
    const byCode = await queries.list(admin, { q: code });
    assert.equal(byCode.items[0].code, code);
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const created = await queries.list(admin, { dateFrom: today, dateTo: today, pageSize: 100 });
    assert.ok(created.total > 0);
  });

  test('role boards: delivery, agent and provider views', async () => {
    const board = await new DeliveryController(queries, schedule).board(admin);
    assert.ok(board.unassigned.length >= 1);
    assert.ok(board.offered.length >= 1);
    assert.ok(board.active.length >= 1);
    assert.ok(board.exceptions.length >= 1);
    const agentCtl = new AgentController(queries, settlements, db);
    const offers = await agentCtl.assignments(ravi, { scope: 'offers' });
    assert.ok(offers.length >= 1 && offers.every((o) => o.actions.some((a) => a.code === 'ACCEPT_DELIVERY')));
    const active = await agentCtl.assignments(suresh, { scope: 'active' });
    assert.ok(active.length >= 1);
    const summary = await agentCtl.summary(ravi);
    assert.ok(summary.cashInHandPaise > 0);
    const prov = new ProviderController(queries, db);
    const todays = await prov.bookings(priya, { scope: 'today' });
    assert.ok(todays.every((o) => o.provider?.id === priya.id));
    await prov.summary(priya);
  });

  test('agents and providers cannot open orders that are not theirs', async () => {
    const l = await queries.list(admin, { view: 'new', pageSize: 1 });
    await expectError(queries.detail(ravi, l.items[0].id), 'FORBIDDEN');
    await expectError(queries.detail(meena, (await queries.list(admin, { kind: 'PRODUCT', pageSize: 1 })).items[0].id), 'FORBIDDEN');
  });
});

describe('Product delivery with COD → settlement', () => {
  test('end-to-end lifecycle, COD handover, discrepancy and resolution', async () => {
    const o = await place(C.ram, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.mug, quantity: 1 }], paymentMethod: 'CASH', deliveryAddress: '1 Test Street' });
    let d = await detail(o.id);
    assert.equal(d.status.order, 'PENDING_REVIEW');
    assert.equal(d.status.cod, 'PENDING_COLLECTION');
    assert.ok(d.actions.some((a) => a.code === 'ACCEPT_AND_START_PREP'));

    await act(admin, o.id, 'ACCEPT_AND_START_PREP');
    await act(admin, o.id, 'ADD_PREP_TIME', { minutes: '10' });
    d = await detail(o.id);
    assert.equal(d.prep?.extraMinutes, 10);
    await act(admin, o.id, 'MARK_READY');
    await db.query(`UPDATE users SET is_available = false WHERE id <> $1 AND role = 'DELIVERY_AGENT'`, [ravi.id]);
    await act(admin, o.id, 'AUTO_ASSIGN_AGENT');
    await db.query(`UPDATE users SET is_available = true WHERE id = $1`, [suresh.id]);
    d = await detail(o.id);
    assert.equal(d.assignment?.agentId, ravi.id);
    assert.equal(d.assignment?.status, 'OFFERED');

    await act(ravi, o.id, 'ACCEPT_DELIVERY');
    await act(ravi, o.id, 'CONFIRM_PICKUP');
    await act(ravi, o.id, 'START_DELIVERY');
    await act(ravi, o.id, 'MARK_DELIVERED', { amount: 998 });
    d = await detail(o.id);
    assert.equal(d.status.order, 'COMPLETED');
    assert.equal(d.status.payment, 'PAID');
    assert.equal(d.status.cod, 'COLLECTED');
    assert.ok(d.completedAt);
    assert.ok(d.timeline.length >= 8, 'audit trail recorded');
    assert.ok(d.timeline.every((t) => t.at && t.actor.role), 'each event has timestamp & actor');

    const cash = await settlements.agentCash(ravi);
    const mine = cash.collections.find((c) => c.orderId === o.id);
    assert.ok(mine);
    const h = await settlements.submitHandover(ravi, { collectionIds: [mine.collectionId], declaredAmount: 998 });
    await expectError(settlements.submitHandover(ravi, { collectionIds: [mine.collectionId], declaredAmount: 998 }), 'NOTHING_TO_HAND_OVER');
    assert.equal((await detail(o.id)).status.cod, 'HANDOVER_SUBMITTED');

    await expectError(settlements.confirm(admin, h.id, 900), 'AMOUNT_MISMATCH');
    await settlements.recordDiscrepancy(admin, h.id, 900, 'Counted ₹900');
    assert.equal((await detail(o.id)).status.cod, 'DISCREPANCY');
    assert.equal((await detail(o.id)).exception, 'COD_DISCREPANCY');
    const ov = await settlements.overview(admin);
    assert.ok(ov.agents.find((a) => a.agentId === ravi.id)!.disputedPaise >= 99800);
    await settlements.resolve(admin, h.id, 'AGENT_PAID_DIFFERENCE', 'Ravi paid ₹98 at counter');
    d = await detail(o.id);
    assert.equal(d.status.cod, 'SETTLED');
    assert.equal(d.exception, null);
  });

  test('stock is never oversold', async () => {
    await db.query('UPDATE listings SET stock = 1 WHERE id = $1', [L.planter]);
    const results = await Promise.allSettled([
      place(C.deepak, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.planter, quantity: 1 }], paymentMethod: 'UPI', deliveryAddress: 'x' }),
      place(C.anitha, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.planter, quantity: 1 }], paymentMethod: 'UPI', deliveryAddress: 'x' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const stock = await db.one<{ stock: number }>('SELECT stock FROM listings WHERE id = $1', [L.planter]);
    assert.equal(stock?.stock, 0);
  });

  test('cancelling a paid order restores stock and marks the refund pending', async () => {
    await db.query('UPDATE listings SET stock = 5 WHERE id = $1', [L.mug]);
    const o = await place(C.kavya, { fulfilmentType: 'TAKEAWAY', items: [{ listingId: L.mug, quantity: 2 }], paymentMethod: 'UPI' });
    await payments.handleEvent({ orderId: o.id, reference: `t_${o.id}`, status: 'SUCCEEDED' });
    await act(admin, o.id, 'ACCEPT');
    await expectError(act(admin, o.id, 'CANCEL', {}), 'VALIDATION');
    await act(admin, o.id, 'CANCEL', { reason: 'Kiln broke' });
    const d = await detail(o.id);
    assert.equal(d.status.order, 'CANCELLED');
    assert.equal(d.status.refund, 'PENDING');
    assert.equal(d.exception, 'REFUND_PENDING');
    assert.equal((await db.one<{ stock: number }>('SELECT stock FROM listings WHERE id = $1', [L.mug]))?.stock, 5);
    await expectError(act(admin, o.id, 'START_PREPARATION'), 'ACTION_NOT_ALLOWED');
    // DB trigger is a second safety net
    await expectError(db.query(`UPDATE orders SET order_status = 'IN_PROGRESS' WHERE id = $1`, [o.id]), 'INVALID_STATE');
    await act(admin, o.id, 'UPDATE_REFUND_STATUS', { status: 'REFUNDED', reference: 'RFND123' });
    assert.equal((await detail(o.id)).status.refund, 'REFUNDED');
  });

  test('two admins accepting the same order at once — exactly one succeeds', async () => {
    const o = await place(C.prem, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'UPI', deliveryAddress: 'x' });
    const r = await Promise.allSettled([act(admin, o.id, 'ACCEPT'), act(admin, o.id, 'ACCEPT'), act(admin, o.id, 'ACCEPT_AND_START_PREP')]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  });

  test('stale version is rejected (optimistic concurrency)', async () => {
    const o = await place(C.prem, { fulfilmentType: 'TAKEAWAY', items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'CASH' });
    const v = (await detail(o.id)).version;
    await act(admin, o.id, 'ADD_PREP_TIME', { minutes: '5' });
    await expectError(actions.execute(admin, o.id, 'ACCEPT', {}, { expectedVersion: v }), 'STALE_ORDER');
  });
});

describe('Delivery agent exceptions', () => {
  async function readyDelivery(): Promise<string> {
    const o = await place(C.anitha, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.coffee, quantity: 2 }], paymentMethod: 'UPI', deliveryAddress: '7 Gandhi Road' });
    await act(admin, o.id, 'ACCEPT_AND_START_PREP');
    await act(admin, o.id, 'MARK_READY');
    return o.id;
  }

  test('agent rejection is recorded and the order is auto-offered to another agent', async () => {
    const id = await readyDelivery();
    await act(admin, id, 'ASSIGN_AGENT', { agentId: ravi.id });
    await expectError(act(ravi, id, 'REJECT_DELIVERY', {}), 'VALIDATION');
    await act(ravi, id, 'REJECT_DELIVERY', { reason: 'Too far away' });
    const d = await detail(id);
    assert.ok(d.assignment && d.assignment.agentId !== ravi.id, 're-offered to someone else');
    assert.equal(d.assignments.find((a) => a.agentId === ravi.id)?.status, 'REJECTED');
    assert.equal(d.assignments.find((a) => a.agentId === ravi.id)?.reason, 'Too far away');
  });

  test('unaccepted offers expire after the configured period', async () => {
    await db.query(`UPDATE workspaces SET settings = settings || '{"assignmentExpirySeconds":1,"autoReassignOnReject":false}'::jsonb WHERE id = $1`, [WS]);
    const id = await readyDelivery();
    await act(admin, id, 'ASSIGN_AGENT', { agentId: suresh.id });
    await new Promise((r) => setTimeout(r, 1300));
    await expectError(act(suresh, id, 'ACCEPT_DELIVERY'), 'OFFER_EXPIRED');
    const d = await detail(id);
    assert.equal(d.assignment, null);
    assert.equal(d.assignments[0].status, 'EXPIRED');
    assert.ok(d.actions.some((a) => a.code === 'ASSIGN_AGENT'), 'back in the unassigned queue');
    // the background sweep does the same without anyone touching the order
    const id2 = await readyDelivery();
    await act(admin, id2, 'ASSIGN_AGENT', { agentId: suresh.id });
    await new Promise((r) => setTimeout(r, 1300));
    assert.ok((await actions.expireDueAssignments()) >= 1);
    assert.equal((await detail(id2)).assignment, null);
    await db.query(`UPDATE workspaces SET settings = settings || '{"assignmentExpirySeconds":180,"autoReassignOnReject":true}'::jsonb WHERE id = $1`, [WS]);
  });

  test('failed delivery → approve return → agent returns → confirm → reschedule', async () => {
    const id = await readyDelivery();
    await act(admin, id, 'ASSIGN_AGENT', { agentId: ravi.id });
    await act(ravi, id, 'ACCEPT_DELIVERY');
    await act(ravi, id, 'CONFIRM_PICKUP');
    await expectError(act(admin, id, 'REASSIGN_AGENT', { agentId: suresh.id }), 'VALIDATION'); // reason needed after pickup
    await act(ravi, id, 'START_DELIVERY');
    await act(ravi, id, 'MARK_DELIVERY_FAILED', { reason: 'Customer unavailable', notes: 'Door locked', evidence: 'photo-123' });
    let d = await detail(id);
    assert.equal(d.exception, 'DELIVERY_FAILED');
    assert.equal(d.failure?.evidence, 'photo-123');
    await act(admin, id, 'APPROVE_RETURN');
    await act(ravi, id, 'RETURN_TO_WORKSPACE');
    d = await detail(id);
    assert.equal(d.exception, 'RETURN_TO_CONFIRM');
    await act(admin, id, 'CONFIRM_RETURN_RECEIVED');
    const slot = await slotFor(null, 'DELIVERY');
    await act(admin, id, 'RESCHEDULE', { schedule: { slotId: slot }, reason: 'Customer asked for tomorrow' });
    d = await detail(id);
    assert.equal(d.status.fulfilment, 'SCHEDULED');
    assert.equal(d.schedule.slotId, slot);
    assert.equal(d.exception, null);
  });

  test('agent cannot act on someone else’s delivery', async () => {
    const id = await readyDelivery();
    await act(admin, id, 'ASSIGN_AGENT', { agentId: ravi.id });
    await expectError(act(suresh, id, 'ACCEPT_DELIVERY'), 'ACTION_NOT_ALLOWED');
  });
});

describe('Bookings, capacity & availability', () => {
  test('workshop seats can never be overbooked, even with concurrent requests', async () => {
    const s = await schedule.createSlot(admin, {
      listingId: L.pottery,
      kind: 'WORKSHOP_SESSION',
      providerId: meena.id,
      startsAt: new Date(Date.now() + 9 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 9 * 86400000 + 3 * 3600000).toISOString(),
      capacity: 3,
      title: 'Test session',
    });
    const who = [C.ram, C.prem, C.anitha, C.deepak, C.kavya];
    const r = await Promise.allSettled(who.map((c) => place(c, { fulfilmentType: 'WORKSHOP', items: [{ listingId: L.pottery, quantity: 1 }], paymentMethod: 'UPI', slotId: s.id })));
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 3);
    const slot = await schedule.slot(admin, s.id);
    assert.equal(slot.reserved, 3);
    assert.equal(slot.remaining, 0);
    assert.equal(slot.attendees.length, 3);
    // capacity cannot be reduced below bookings
    await expectError(schedule.updateSlot(admin, s.id, { capacity: 2 }), 'CAPACITY_BELOW_BOOKINGS');
    await schedule.updateSlot(admin, s.id, { capacity: 4 });
    // duplicate booking by the same customer is refused
    const booked = r.findIndex((x) => x.status === 'fulfilled');
    await expectError(place(who[booked], { fulfilmentType: 'WORKSHOP', items: [{ listingId: L.pottery, quantity: 1 }], paymentMethod: 'UPI', slotId: s.id }), 'DUPLICATE_BOOKING');
    // cancellation frees the seat
    const first = (r[booked] as PromiseFulfilledResult<{ id: string }>).value.id;
    await act(admin, first, 'CANCEL', { reason: 'Customer moved city' });
    assert.equal((await schedule.slot(admin, s.id)).reserved, 2);
  });

  test('idempotency key returns the same order instead of creating a duplicate', async () => {
    const input = { fulfilmentType: 'TAKEAWAY' as const, items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'CASH' as const };
    const a = await place(C.kavya, input, 'checkout-abc-123');
    const b = await place(C.kavya, input, 'checkout-abc-123');
    assert.equal(a.id, b.id);
    assert.equal(b.duplicate, true);
  });

  test('instant-confirm listing auto-confirms; provider conflicts are blocked by the database', async () => {
    const slot = await slotFor(L.consult, 'SERVICE', 1, 2);
    const a = await place(C.ram, { fulfilmentType: 'CONSULTATION', items: [{ listingId: L.consult, quantity: 1 }], paymentMethod: 'UPI', slotId: slot });
    assert.equal((await detail(a.id)).status.order, 'PENDING_REVIEW');
    await act(meena, a.id, 'CONFIRM_APPOINTMENT');
    let d = await detail(a.id);
    assert.equal(d.status.order, 'CONFIRMED');
    assert.ok(d.provider?.confirmedAt);
    // an online session for Meena at exactly the same time must be refused
    const online = await place(C.prem, { fulfilmentType: 'ONLINE', items: [{ listingId: L.online, quantity: 1 }], paymentMethod: 'UPI', slotId: await slotFor(L.online, 'SERVICE', 1, 3) });
    d = await detail(online.id);
    assert.equal(d.status.order, 'CONFIRMED', 'online review listing is instant-confirm');
    assert.ok(d.meeting?.link);
    await expectError(act(admin, online.id, 'RESCHEDULE', { schedule: { start: (await detail(a.id)).schedule.start }, reason: 'move' }), 'PROVIDER_CONFLICT');
  });

  test('no-show → reschedule via slot; provider requests rescheduling; customer reschedule request', async () => {
    const slot = await slotFor(L.spa, 'SERVICE', 1, 1);
    const b = await place(C.deepak, { fulfilmentType: 'AT_PROVIDER_LOCATION', items: [{ listingId: L.spa, quantity: 1 }], paymentMethod: 'CASH', slotId: slot });
    let d = await detail(b.id);
    assert.equal(d.status.order, 'CONFIRMED');
    await act(priya, b.id, 'REPORT_CUSTOMER_UNAVAILABLE', { reason: 'Customer did not show up' });
    assert.equal((await detail(b.id)).exception, 'NO_SHOW');
    const newSlot = await slotFor(L.spa, 'SERVICE', 1, 2);
    await act(admin, b.id, 'RESCHEDULE', { schedule: { slotId: newSlot }, reason: 'Customer called' });
    d = await detail(b.id);
    assert.equal(d.status.fulfilment, 'SCHEDULED');
    assert.equal(d.schedule.slotId, newSlot);
    // old slot was released
    assert.equal((await db.one<{ reserved: number }>('SELECT reserved FROM slots WHERE id = $1', [slot]))?.reserved, 0);

    await act(priya, b.id, 'REQUEST_RESCHEDULING', { reason: 'Training day', proposedStart: new Date(Date.now() + 4 * 86400000).toISOString() });
    await expectError(act(priya, b.id, 'REQUEST_RESCHEDULING', { reason: 'again' }), 'ACTION_NOT_ALLOWED');
    assert.equal((await detail(b.id)).exception, 'RESCHEDULE_REQUESTED');
    await act(admin, b.id, 'DECLINE_RESCHEDULE_REQUEST', { reason: 'Covered by another stylist' });
    assert.equal((await detail(b.id)).exception, null);

    await act(customer(C.deepak), b.id, 'CUSTOMER_REQUEST_RESCHEDULE', { schedule: { slotId: await slotFor(L.spa, 'SERVICE', 1, 3) } });
    await act(admin, b.id, 'APPROVE_RESCHEDULE_REQUEST');
    d = await detail(b.id);
    assert.equal(d.requests.filter((r) => r.status === 'APPROVED').length, 1);

    // attendance → service → completion with cash collected at the counter
    await db.query(`UPDATE orders SET scheduled_start = now(), scheduled_end = now() + interval '1 hour' WHERE id = $1`, [b.id]);
    await act(priya, b.id, 'MARK_ATTENDED');
    await act(priya, b.id, 'START_SERVICE');
    await act(priya, b.id, 'MARK_SERVICE_COMPLETED', { amount: 1800 });
    d = await detail(b.id);
    assert.equal(d.status.order, 'COMPLETED');
    assert.equal(d.status.cod, 'SETTLED');
  });

  test('event booking: always reviewed, schedule confirmed, provider assigned', async () => {
    const e = await place(C.kavya, {
      fulfilmentType: 'EVENT',
      items: [{ listingId: 'b0000000-0000-4000-8000-000000000013', quantity: 1 }],
      paymentMethod: 'UPI',
      scheduledStart: new Date(Date.now() + 20 * 86400000).toISOString(),
      eventDetails: { venue: 'Beach Resort, ECR', guests: 120, occasion: 'Engagement', requirements: 'Pastel décor' },
    });
    let d = await detail(e.id);
    assert.equal(d.status.order, 'PENDING_REVIEW');
    assert.equal(d.eventDetails?.venue, 'Beach Resort, ECR');
    await act(admin, e.id, 'ACCEPT');
    assert.equal((await detail(e.id)).status.fulfilment, 'AWAITING_SCHEDULE');
    await act(admin, e.id, 'CONFIRM_SCHEDULE', { providerId: 'a0000000-0000-4000-8000-000000000006' });
    d = await detail(e.id);
    assert.equal(d.status.fulfilment, 'SCHEDULED');
    assert.equal(d.provider?.name, 'Karthik R');
  });

  test('workshop session completion marks attendees completed and absentees as no-show', async () => {
    const s = await schedule.createSlot(admin, {
      listingId: L.pottery,
      kind: 'WORKSHOP_SESSION',
      providerId: meena.id,
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      capacity: 5,
    });
    const x = await place(C.ram, { fulfilmentType: 'WORKSHOP', items: [{ listingId: L.pottery, quantity: 2 }], paymentMethod: 'UPI', slotId: s.id });
    const y = await place(C.prem, { fulfilmentType: 'WORKSHOP', items: [{ listingId: L.pottery, quantity: 1 }], paymentMethod: 'UPI', slotId: s.id });
    assert.equal((await schedule.slot(admin, s.id)).reserved, 3);
    await payments.handleEvent({ orderId: x.id, reference: `w_${x.id}`, status: 'SUCCEEDED' });
    await db.query(`UPDATE slots SET starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' WHERE id = $1`, [s.id]);
    await act(meena, x.id, 'MARK_ATTENDED');
    const res = await schedule.completeSession(admin, s.id);
    assert.deepEqual([res.completed, res.noShows], [1, 1]);
    assert.equal((await detail(x.id)).status.order, 'COMPLETED');
    assert.equal((await detail(y.id)).status.fulfilment, 'NO_SHOW');
  });
});

describe('Payments', () => {
  test('failure → retry → success; webhooks are idempotent; no double success', async () => {
    const o = await place(C.anitha, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'CARD', deliveryAddress: 'x' });
    await payments.handleEvent({ orderId: o.id, reference: 'ref-fail-1', status: 'FAILED', reason: 'Declined' });
    let d = await detail(o.id);
    assert.equal(d.status.payment, 'FAILED');
    assert.equal(d.exception, 'PAYMENT_FAILED');
    assert.ok(d.actions.some((a) => a.code === 'RETRY_PAYMENT'));
    await act(admin, o.id, 'RETRY_PAYMENT');
    d = await detail(o.id);
    assert.equal(d.status.payment, 'PENDING');
    assert.equal(d.payments.length, 2);
    await payments.handleEvent({ orderId: o.id, reference: 'ref-ok-1', status: 'SUCCEEDED' });
    const dup = await payments.handleEvent({ orderId: o.id, reference: 'ref-ok-1', status: 'SUCCEEDED' });
    assert.equal(dup.duplicate, true);
    await expectError(payments.handleEvent({ orderId: o.id, reference: 'ref-ok-2', status: 'SUCCEEDED' }), /NO_PENDING_PAYMENT|ACTION_NOT_ALLOWED/);
    d = await detail(o.id);
    assert.equal(d.status.payment, 'PAID');
    assert.equal(d.payments.filter((p) => p.status === 'SUCCEEDED').length, 1);
  });

  test('admin cannot set an online payment to paid', async () => {
    const o = await place(C.anitha, { fulfilmentType: 'TAKEAWAY', items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'UPI' });
    await expectError(act(admin, o.id, 'PAYMENT_CONFIRMED'), 'FORBIDDEN');
    await expectError(act(admin, o.id, 'RECORD_COD_COLLECTED', { amount: 60 }), 'ACTION_NOT_ALLOWED');
  });
});

describe('Customer requests', () => {
  test('cancellation request → admin confirms; return request → approve → pickup → refund pending', async () => {
    const o = await place(C.prem, { fulfilmentType: 'DELIVERY', items: [{ listingId: L.coffee, quantity: 1 }], paymentMethod: 'UPI', deliveryAddress: 'x' });
    await payments.handleEvent({ orderId: o.id, reference: `c_${o.id}`, status: 'SUCCEEDED' });
    await act(admin, o.id, 'ACCEPT_AND_START_PREP');
    await act(customer(C.prem), o.id, 'CUSTOMER_REQUEST_CANCELLATION', { reason: 'Ordered by mistake' });
    let d = await detail(o.id);
    assert.equal(d.exception, 'CANCELLATION_REQUESTED');
    assert.ok(d.actions.some((a) => a.code === 'CONFIRM_CANCELLATION'));
    await act(admin, o.id, 'CONFIRM_CANCELLATION');
    d = await detail(o.id);
    assert.equal(d.status.order, 'CANCELLED');
    assert.equal(d.cancelReason, 'Ordered by mistake');

    // delivered order from the seed with an open return request
    const ret = (await queries.list(admin, { view: 'exceptions', pageSize: 100 })).items.find((x) => x.exception === 'RETURN_REQUESTED')!;
    await act(admin, ret.id, 'APPROVE_RETURN', { pickupAt: new Date(Date.now() + 86400000).toISOString() });
    await act(admin, ret.id, 'CONFIRM_RETURN_PICKUP');
    d = await detail(ret.id);
    assert.equal(d.status.fulfilment, 'RETURN_RECEIVED');
    assert.equal(d.status.refund, 'PENDING');
  });

  test('bulk accept (“Accept all”)', async () => {
    const news = (await queries.list(admin, { view: 'new', pageSize: 100 })).items.filter((o) => o.status.order === 'PENDING_REVIEW').map((o) => o.id);
    const r = await actions.bulkAccept(admin, news, true);
    assert.equal(r.accepted, news.length);
    assert.equal((await queries.summary(admin, {})).counts.new, 1, 'only the clarification-requested order remains');
  });
});
