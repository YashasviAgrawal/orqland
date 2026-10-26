import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Db } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import { NotificationsService, NewNotification } from '../notifications/notifications.service';
import { AssignmentService, loadSettings } from '../delivery/assignment.service';
import { badRequest, conflict, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth/auth.types';
import { DomainError, deriveOrderStatus, planAction } from '../domain/engine';
import { workflowOf } from '../domain/workflows';
import type { ActionPlan, Effect, OrderPatch } from '../domain/types';
import type { FulfilmentStatus, OrderStatus, PaymentStatus } from '../domain/enums';
import { findOrderRow, OrderRow, toEngineOrder } from './order.repository';

/** Engine patch keys → database columns. */
const COLUMN: Partial<Record<keyof OrderPatch, string>> = {
  orderStatus: 'order_status',
  fulfilmentStatus: 'fulfilment_status',
  paymentStatus: 'payment_status',
  codStatus: 'cod_status',
  refundStatus: 'refund_status',
  providerId: 'provider_id',
  providerConfirmedAt: 'provider_confirmed_at',
  meetingLink: 'meeting_link',
  meetingNotes: 'meeting_notes',
  returnConfirmedAt: 'return_confirmed_at',
  afterReturnAction: 'after_return_action',
  prepStartedAt: 'prep_started_at',
  readyAt: 'ready_at',
  completedAt: 'completed_at',
  cancelledAt: 'cancelled_at',
  cancelReason: 'cancel_reason',
  rejectReason: 'reject_reason',
  clarificationNote: 'clarification_note',
  failureReason: 'failure_reason',
  failureNotes: 'failure_notes',
  failureEvidence: 'failure_evidence',
  returnPickupAt: 'return_pickup_at',
};

export interface ActionOptions {
  expectedVersion?: number;
}

interface Ctx {
  db: Db;
  row: OrderRow;
  actor: AuthUser;
  plan: ActionPlan & { code: string };
  set: Record<string, unknown>;
  notes: NewNotification[];
  extraEvents: Array<{ message: string; data?: Record<string, unknown>; reason?: string | null }>;
  eventData: Record<string, unknown>;
}

/**
 * Executes workflow actions atomically:
 *  1. lock the order row (serialises concurrent clicks / users)
 *  2. optional optimistic version check
 *  3. ask the workflow engine whether the action is allowed and what it does
 *  4. apply side-effects (capacity, assignments, COD, requests, notifications)
 *  5. write the new statuses and an audit log entry — all in one transaction
 */
@Injectable()
export class OrderActionsService {
  private readonly logger = new Logger(OrderActionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly assignments: AssignmentService,
  ) {}

  async execute(actor: AuthUser, orderId: string, code: string, input: Record<string, unknown> = {}, opts: ActionOptions = {}): Promise<void> {
    const notes: NewNotification[] = [];
    // Expire a stale delivery offer in its own transaction first, so the expiry is kept
    // even when the requested action is then refused.
    if (code !== 'ASSIGNMENT_EXPIRED') {
      await this.db.tx(async (tx) => {
        const row = await findOrderRow(tx, actor.workspaceId, orderId, true);
        if (row && isExpiredOffer(row)) await this.runPlan(tx, row, systemActor(actor.workspaceId), 'ASSIGNMENT_EXPIRED', {}, notes);
      });
    }
    await this.db.tx((tx) => this.executeInTx(tx, actor, orderId, code, input, opts, notes));
    this.notifications.dispatch(notes);
  }

  async executeInTx(
    db: Db,
    actor: AuthUser,
    orderId: string,
    code: string,
    input: Record<string, unknown>,
    opts: ActionOptions,
    notes: NewNotification[],
  ): Promise<void> {
    let row = await findOrderRow(db, actor.workspaceId, orderId, true);
    if (!row) throw notFound('Order');

    if (opts.expectedVersion !== undefined && opts.expectedVersion !== null && row.version !== Number(opts.expectedVersion)) {
      throw conflict('STALE_ORDER', 'This order was just updated by someone else. Refresh to see the latest status.', {
        currentVersion: row.version,
      });
    }

    // An agent can never accept an expired offer (execute() normally expires it beforehand).
    if (code !== 'ASSIGNMENT_EXPIRED' && isExpiredOffer(row)) {
      if (code === 'ACCEPT_DELIVERY' || code === 'REJECT_DELIVERY') {
        throw conflict('OFFER_EXPIRED', 'This delivery offer has expired and was returned to the queue.');
      }
      await this.runPlan(db, row, systemActor(actor.workspaceId), 'ASSIGNMENT_EXPIRED', {}, notes);
      row = (await findOrderRow(db, actor.workspaceId, orderId))!;
    }
    // the offer was already expired by the pre-step: tell the agent clearly
    if ((code === 'ACCEPT_DELIVERY' || code === 'REJECT_DELIVERY') && actor.role === 'DELIVERY_AGENT' && !row.assignment) {
      const lastMine = await db.query<{ status: string }>(
        `SELECT status FROM delivery_assignments WHERE order_id = $1 AND agent_id = $2 ORDER BY offered_at DESC LIMIT 1`,
        [orderId, actor.id],
      );
      if (lastMine.rows[0]?.status === 'EXPIRED') throw conflict('OFFER_EXPIRED', 'This delivery offer has expired and was returned to the queue.');
    }

    await this.runPlan(db, row, actor, code, input, notes);
  }

  private async runPlan(db: Db, row: OrderRow, actor: AuthUser, code: string, input: Record<string, unknown>, notes: NewNotification[]): Promise<void> {
    const plan = planAction(toEngineOrder(row), { id: actor.id, role: actor.role, name: actor.name }, code, input);
    const ctx: Ctx = { db, row, actor, plan, set: {}, notes, extraEvents: [], eventData: { ...(plan.event.data ?? {}) } };

    // 1. patch from the engine
    for (const [key, value] of Object.entries(plan.patch) as Array<[keyof OrderPatch, unknown]>) {
      if (key === 'extraPrepMinutes') {
        ctx.set.extra_prep_minutes = row.extra_prep_minutes + Number(value);
        continue;
      }
      const col = COLUMN[key];
      if (col) ctx.set[col] = value;
    }

    // 2. side-effects
    for (const effect of plan.effects) await this.applyEffect(ctx, effect);

    // record pickup time on the assignment
    if (ctx.set.fulfilment_status === 'PICKED_UP' && row.assignment) {
      await db.query('UPDATE delivery_assignments SET picked_up_at = COALESCE(picked_up_at, now()) WHERE id = $1', [row.assignment.id]);
    }

    // 3. derive order status from fulfilment + payment so the statuses never contradict
    const next = {
      orderStatus: (ctx.set.order_status as OrderStatus | undefined) ?? row.order_status,
      fulfilmentStatus: (ctx.set.fulfilment_status as FulfilmentStatus | undefined) ?? row.fulfilment_status,
      paymentStatus: (ctx.set.payment_status as PaymentStatus | undefined) ?? row.payment_status,
    };
    const derived = deriveOrderStatus(next);
    if (derived !== row.order_status || ctx.set.order_status) ctx.set.order_status = derived;
    if (derived === 'COMPLETED' && row.order_status !== 'COMPLETED') ctx.set.completed_at = new Date().toISOString();

    // 4. write
    const cols = Object.keys(ctx.set);
    if (cols.length) {
      const assignments = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await db.query(`UPDATE orders SET ${assignments} WHERE id = $1`, [row.id, ...cols.map((c) => ctx.set[c])]);
    } else {
      await db.query('UPDATE orders SET updated_at = now() WHERE id = $1', [row.id]);
    }

    // 5. audit
    const after = {
      orderStatus: (ctx.set.order_status as string) ?? row.order_status,
      fulfilmentStatus: (ctx.set.fulfilment_status as string) ?? row.fulfilment_status,
      paymentStatus: (ctx.set.payment_status as string) ?? row.payment_status,
      codStatus: (ctx.set.cod_status as string) ?? row.cod_status,
      refundStatus: (ctx.set.refund_status as string) ?? row.refund_status,
    };
    await this.audit.log(db, {
      workspaceId: row.workspace_id,
      entityType: 'ORDER',
      entityId: row.id,
      orderId: row.id,
      action: code,
      message: plan.event.message,
      actor: ctx.actor,
      reason: plan.event.reason ?? null,
      fromState: {
        orderStatus: row.order_status,
        fulfilmentStatus: row.fulfilment_status,
        paymentStatus: row.payment_status,
        codStatus: row.cod_status,
        refundStatus: row.refund_status,
      },
      toState: after,
      data: Object.keys(ctx.eventData).length ? ctx.eventData : null,
    });
    for (const e of ctx.extraEvents) {
      await this.audit.log(db, {
        workspaceId: row.workspace_id,
        entityType: 'ORDER',
        entityId: row.id,
        orderId: row.id,
        action: 'SYSTEM_NOTE',
        message: e.message,
        actor: { id: 'system', role: 'SYSTEM', name: 'System' },
        reason: e.reason ?? null,
        data: e.data ?? null,
      });
    }
  }

  // -------------------------------------------------------------------------
  private async applyEffect(ctx: Ctx, e: Effect): Promise<void> {
    const { db, row } = ctx;
    switch (e.type) {
      case 'RELEASE_SLOT': {
        if (row.slot_id) {
          await db.query('UPDATE slots SET reserved = GREATEST(reserved - $2, 0) WHERE id = $1', [row.slot_id, row.seats]);
          ctx.set.slot_id = null;
        }
        return;
      }

      case 'MOVE_SCHEDULE':
        return this.moveSchedule(ctx, e.slotId, e.start);

      case 'RESTORE_STOCK': {
        await db.query(
          `UPDATE listings l SET stock = l.stock + i.quantity FROM order_items i
           WHERE i.order_id = $1 AND l.id = i.listing_id AND l.stock IS NOT NULL`,
          [row.id],
        );
        return;
      }

      case 'OFFER_ASSIGNMENT': {
        const offered = await this.assignments.offer(db, row, ctx.actor, e);
        ctx.eventData.agentId = offered.agentId;
        ctx.eventData.agentName = offered.agentName;
        ctx.eventData.expiresAt = offered.expiresAt;
        ctx.plan.event.message = `${ctx.plan.event.message} — offered to ${offered.agentName}`;
        ctx.notes.push(
          await this.notifications.create(db, {
            workspaceId: row.workspace_id,
            audience: 'AGENT',
            recipientUserId: offered.agentId,
            orderId: row.id,
            title: 'New delivery offer',
            body: `${row.code} · ${row.distance_km ?? '—'} km · accept within ${Math.round((Date.parse(offered.expiresAt) - Date.now()) / 60000)} min`,
          }),
        );
        return;
      }

      case 'SET_ASSIGNMENT_STATUS': {
        const a = row.assignment;
        if (!a) return;
        const closing = ['REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED'].includes(e.status);
        await db.query(
          `UPDATE delivery_assignments SET status = $2,
             responded_at = CASE WHEN $2 IN ('ACCEPTED','REJECTED') THEN now() ELSE responded_at END,
             closed_at = CASE WHEN $3 THEN now() ELSE closed_at END,
             reason = COALESCE($4, reason)
           WHERE id = $1`,
          [a.id, e.status, closing, e.reason ?? null],
        );
        if (e.status === 'COMPLETED' && ctx.set.fulfilment_status === 'DELIVERED') {
          ctx.set.delivered_by_agent_id = a.agentId;
        }
        if (e.status === 'REJECTED' || e.status === 'EXPIRED') {
          ctx.eventData.agentName = a.agentName;
          await this.maybeAutoReassign(ctx, a.agentId);
        }
        return;
      }

      case 'CHECK_PROVIDER_AVAILABLE': {
        const p = await db.query<{ is_available: boolean; name: string }>(
          `SELECT is_available, name FROM users WHERE id = $1 AND workspace_id = $2 AND role = 'SERVICE_PROVIDER' AND is_active`,
          [e.providerId, row.workspace_id],
        );
        if (!p.rows[0]) throw badRequest('Choose an active service provider.');
        if (!p.rows[0].is_available) throw conflict('PROVIDER_UNAVAILABLE', `${p.rows[0].name} is marked unavailable.`);
        ctx.eventData.providerName = p.rows[0].name;
        // blocks_provider bookings are protected by the orders_provider_no_overlap exclusion constraint
        return;
      }

      case 'RESOLVE_REQUEST': {
        await db.query(
          `UPDATE order_requests SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1 AND status = 'PENDING'`,
          [e.requestId, e.status, isUuid(ctx.actor.id) ? ctx.actor.id : null, e.note ?? null],
        );
        return;
      }

      case 'DECLINE_ALL_OPEN_REQUESTS': {
        await db.query(
          `UPDATE order_requests SET status = 'DECLINED', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE order_id = $1 AND status = 'PENDING'`,
          [row.id, isUuid(ctx.actor.id) ? ctx.actor.id : null, e.note],
        );
        return;
      }

      case 'CREATE_REQUEST': {
        let proposedStart = e.proposedStart;
        if (e.proposedSlotId) {
          const s = await db.query<{ starts_at: Date; remaining: number; status: string }>(
            'SELECT starts_at, capacity - reserved AS remaining, status FROM slots WHERE id = $1 AND workspace_id = $2',
            [e.proposedSlotId, row.workspace_id],
          );
          const slot = s.rows[0];
          if (!slot || slot.status !== 'OPEN' || slot.remaining < row.seats) throw conflict('SLOT_UNAVAILABLE', 'That slot is no longer available.');
          proposedStart = new Date(slot.starts_at).toISOString();
        }
        await db.query(
          `INSERT INTO order_requests (order_id, type, requested_by_role, requested_by_id, reason, proposed_start, proposed_slot_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [row.id, e.requestType, ctx.actor.role, isUuid(ctx.actor.id) ? ctx.actor.id : null, e.reason, proposedStart, e.proposedSlotId],
        );
        return;
      }

      case 'RECORD_COD': {
        const due = row.total_paise - row.cod_collected_paise;
        if (e.amountPaise > due) throw badRequest(`Amount is more than the amount due (₹${(due / 100).toFixed(2)}).`);
        const collected = row.cod_collected_paise + e.amountPaise;
        await db.query(
          `INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, settled) VALUES ($1,$2,$3,$4,$5)`,
          [row.id, e.agentId, e.amountPaise, isUuid(ctx.actor.id) ? ctx.actor.id : null, e.settledImmediately],
        );
        ctx.set.cod_collected_paise = collected;
        ctx.set.cod_status = e.settledImmediately ? 'SETTLED' : 'COLLECTED';
        if (collected >= row.total_paise) {
          ctx.set.payment_status = 'PAID';
          await db.query(
            `INSERT INTO payments (order_id, attempt, method, amount_paise, status, provider, confirmed_at)
             VALUES ($1, COALESCE((SELECT max(attempt) FROM payments WHERE order_id = $1), 0) + 1, 'CASH', $2, 'SUCCEEDED', 'cash', now())`,
            [row.id, row.total_paise],
          );
        }
        ctx.eventData.amountPaise = e.amountPaise;
        ctx.eventData.collectedPaise = collected;
        ctx.plan.event.message = `${ctx.plan.event.message} (₹${(e.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })})`;
        if (collected < row.total_paise) {
          ctx.extraEvents.push({ message: `Cash short-collected — ₹${((row.total_paise - collected) / 100).toFixed(2)} still due` });
        }
        return;
      }

      case 'CREATE_PAYMENT_ATTEMPT': {
        const r = await db.query<{ attempt: number }>(
          `INSERT INTO payments (order_id, attempt, method, amount_paise, status, provider)
           VALUES ($1, COALESCE((SELECT max(attempt) FROM payments WHERE order_id = $1), 0) + 1, $2, $3, 'PENDING', 'sample')
           RETURNING attempt`,
          [row.id, row.payment_method, row.total_paise],
        );
        ctx.eventData.attempt = r.rows[0].attempt;
        return;
      }

      case 'NOTIFY': {
        const providerId = (ctx.set.provider_id as string | undefined) ?? row.provider_id;
        const agentId = row.assignment?.agentId ?? row.delivered_by_agent_id;
        let recipientUserId: string | null = null;
        if (e.audience === 'AGENT') {
          if (!agentId) return;
          recipientUserId = agentId;
        }
        if (e.audience === 'PROVIDER') {
          if (!providerId || providerId === ctx.actor.id) return;
          recipientUserId = providerId;
        }
        if (e.audience === 'ADMIN' && ctx.actor.role === 'WORKSPACE_ADMIN') return; // don't notify yourself
        ctx.notes.push(
          await this.notifications.create(db, {
            workspaceId: row.workspace_id,
            audience: e.audience,
            recipientUserId,
            recipientCustomerId: e.audience === 'CUSTOMER' ? row.customer_id : null,
            orderId: row.id,
            title: e.title,
            body: e.body ? `${row.code} · ${e.body}` : row.code,
          }),
        );
        return;
      }
    }
  }

  /** Reschedule: reserve the new slot (capacity-checked) before releasing the old one. */
  private async moveSchedule(ctx: Ctx, slotId: string | null, start: string | null): Promise<void> {
    const { db, row } = ctx;
    const wf = workflowOf(row.fulfilment_type);
    const durationMin = row.scheduled_start && row.scheduled_end
      ? Math.round((new Date(row.scheduled_end).getTime() - new Date(row.scheduled_start).getTime()) / 60000)
      : row.items[0]?.durationMinutes ?? 60;

    if (slotId) {
      if (slotId === row.slot_id) throw badRequest('Choose a different slot.');
      const s = await db.query<{ id: string; kind: string; listing_id: string | null; provider_id: string | null; starts_at: Date; ends_at: Date; status: string }>(
        'SELECT id, kind, listing_id, provider_id, starts_at, ends_at, status FROM slots WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [slotId, row.workspace_id],
      );
      const slot = s.rows[0];
      if (!slot) throw notFound('Slot');
      const expectedKind = wf.slotKind ?? (wf.deliveryAgent ? 'DELIVERY' : null);
      if (expectedKind && slot.kind !== expectedKind) throw badRequest('That slot is for a different kind of booking.');
      if (slot.listing_id && !row.items.some((i) => i.listingId === slot.listing_id)) throw badRequest('That slot belongs to a different listing.');
      if (slot.status !== 'OPEN') throw conflict('SLOT_CLOSED', 'That slot is closed.');
      if (new Date(slot.starts_at).getTime() <= Date.now()) throw badRequest('That slot has already started.');
      const reserved = await db.query(
        'UPDATE slots SET reserved = reserved + $2 WHERE id = $1 AND reserved + $2 <= capacity RETURNING id',
        [slot.id, row.seats],
      );
      if (!reserved.rowCount) throw conflict('CAPACITY_EXCEEDED', 'That slot is full. Choose another time.');
      if (row.slot_id) await db.query('UPDATE slots SET reserved = GREATEST(reserved - $2, 0) WHERE id = $1', [row.slot_id, row.seats]);
      ctx.set.slot_id = slot.id;
      ctx.set.scheduled_start = new Date(slot.starts_at).toISOString();
      ctx.set.scheduled_end = new Date(slot.ends_at).toISOString();
      if (wf.kind === 'SERVICE' && slot.provider_id && slot.provider_id !== row.provider_id) {
        ctx.set.provider_id = slot.provider_id;
        ctx.set.provider_confirmed_at = null;
      }
      ctx.eventData.newStart = ctx.set.scheduled_start;
      return;
    }

    if (!start) throw badRequest('Choose a new date & time.');
    const t = new Date(start);
    if (Number.isNaN(t.getTime())) throw badRequest('Invalid date & time.');
    if (t.getTime() < Date.now() - 60_000) throw badRequest('The new time must be in the future.');
    if (row.slot_id) await db.query('UPDATE slots SET reserved = GREATEST(reserved - $2, 0) WHERE id = $1', [row.slot_id, row.seats]);
    ctx.set.slot_id = null;
    ctx.set.scheduled_start = t.toISOString();
    ctx.set.scheduled_end = new Date(t.getTime() + durationMin * 60_000).toISOString();
    ctx.eventData.newStart = ctx.set.scheduled_start;
  }

  /** After an agent rejects or lets an offer expire, optionally offer it to the next agent. */
  private async maybeAutoReassign(ctx: Ctx, previousAgentId: string): Promise<void> {
    const settings = await loadSettings(ctx.db, ctx.row.workspace_id);
    const wf = workflowOf(ctx.row.fulfilment_type);
    const active = !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(ctx.row.order_status);
    if (!settings.autoReassignOnReject || !wf.deliveryAgent || !active) {
      ctx.extraEvents.push({ message: 'Order returned to the unassigned delivery queue' });
      return;
    }
    try {
      // a nested savepoint keeps the main action valid even if no agent is free
      await ctx.db.query('SAVEPOINT auto_reassign');
      const offered = await this.assignments.offer(ctx.db, ctx.row, systemActor(ctx.row.workspace_id), {
        agentId: null,
        auto: true,
        excludeAgentIds: [previousAgentId],
      });
      await ctx.db.query('RELEASE SAVEPOINT auto_reassign');
      ctx.extraEvents.push({ message: `Automatically re-offered to ${offered.agentName}`, data: { agentId: offered.agentId } });
      ctx.notes.push(
        await this.notifications.create(ctx.db, {
          workspaceId: ctx.row.workspace_id,
          audience: 'AGENT',
          recipientUserId: offered.agentId,
          orderId: ctx.row.id,
          title: 'New delivery offer',
          body: `${ctx.row.code} · ${ctx.row.distance_km ?? '—'} km`,
        }),
      );
    } catch (err) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT auto_reassign');
      if (err instanceof DomainError) throw err;
      ctx.extraEvents.push({ message: 'No other agent available — order returned to the unassigned queue' });
    }
  }

  /** "Accept all" on the dashboard: accept each new order independently. */
  async bulkAccept(actor: AuthUser, orderIds: string[], startPrep: boolean) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of orderIds.slice(0, 50)) {
      try {
        let code = 'ACCEPT';
        if (startPrep) {
          const row = await findOrderRow(this.db.pool, actor.workspaceId, id);
          if (row && row.kind === 'PRODUCT' && !workflowOf(row.fulfilment_type).scheduled) code = 'ACCEPT_AND_START_PREP';
        }
        await this.execute(actor, id, code);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }
    return { results, accepted: results.filter((r) => r.ok).length };
  }

  /** Sweep job helper: expire offers that were not accepted in time. */
  async expireDueAssignments(): Promise<number> {
    const due = await this.db.query<{ order_id: string; workspace_id: string }>(
      `SELECT a.order_id, o.workspace_id FROM delivery_assignments a JOIN orders o ON o.id = a.order_id
       WHERE a.status = 'OFFERED' AND a.expires_at <= now() ORDER BY a.expires_at LIMIT 50`,
    );
    let n = 0;
    for (const d of due) {
      try {
        await this.execute(systemActor(d.workspace_id), d.order_id, 'ASSIGNMENT_EXPIRED');
        n++;
      } catch (err) {
        this.logger.warn(`Could not expire assignment for ${d.order_id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return n;
  }
}

export function systemActor(workspaceId: string): AuthUser {
  return { id: 'system', role: 'SYSTEM', name: 'System', workspaceId };
}

function isExpiredOffer(row: OrderRow): boolean {
  return row.assignment?.status === 'OFFERED' && !!row.assignment.expiresAt && Date.parse(row.assignment.expiresAt) <= Date.now();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
