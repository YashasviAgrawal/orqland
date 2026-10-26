import { Injectable } from '@nestjs/common';
import { DatabaseService, Db } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import { NotificationsService, NewNotification } from '../notifications/notifications.service';
import { badRequest, conflict, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth/auth.types';

export type Resolution = 'AGENT_PAID_DIFFERENCE' | 'RECOUNT_CORRECTED' | 'WRITTEN_OFF' | 'DEDUCTED_FROM_PAYOUT';

interface HandoverRow {
  id: string;
  code: string;
  agent_id: string;
  agent_name: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'DISCREPANCY' | 'RESOLVED';
  expected_paise: number;
  declared_paise: number;
  received_paise: number | null;
  agent_note: string | null;
  discrepancy_reason: string | null;
  resolution: Resolution | null;
  resolution_note: string | null;
  submitted_at: Date;
  verified_at: Date | null;
  verified_by_name: string | null;
  resolved_at: Date | null;
  orders: Array<{ orderId: string; code: string; customerName: string; amountPaise: number; collectedAt: string }>;
}

const HANDOVER_SELECT = `
SELECT h.*, a.name AS agent_name, v.name AS verified_by_name,
  COALESCE((SELECT json_agg(json_build_object('orderId', o.id, 'code', o.code, 'customerName', c.name, 'amountPaise', cc.amount_paise, 'collectedAt', cc.collected_at) ORDER BY cc.collected_at)
    FROM cod_collections cc JOIN orders o ON o.id = cc.order_id JOIN customers c ON c.id = o.customer_id WHERE cc.handover_id = h.id), '[]'::json) AS orders
FROM cash_handovers h JOIN users a ON a.id = h.agent_id LEFT JOIN users v ON v.id = h.verified_by`;

const toHandover = (r: HandoverRow) => ({
  id: r.id,
  code: r.code,
  agentId: r.agent_id,
  agentName: r.agent_name,
  status: r.status,
  expectedPaise: r.expected_paise,
  declaredPaise: r.declared_paise,
  receivedPaise: r.received_paise,
  differencePaise: (r.received_paise ?? r.declared_paise) - r.expected_paise,
  agentNote: r.agent_note,
  discrepancyReason: r.discrepancy_reason,
  resolution: r.resolution,
  resolutionNote: r.resolution_note,
  submittedAt: new Date(r.submitted_at).toISOString(),
  verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
  verifiedByName: r.verified_by_name,
  resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  orders: r.orders,
});

/**
 * COD collection & cash settlement (§7 "COD Discrepancy / Pending Settlement"):
 *  agent collects → submits handover → admin confirms or records a discrepancy → admin resolves.
 * Settlement stays pending until resolved, and outstanding cash is tracked by agent and by order.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Admin overview: outstanding cash by agent and by order. */
  async overview(user: AuthUser) {
    const agents = await this.db.query<{ agent_id: string; agent_name: string; avatar_color: string | null; in_hand: number; in_handover: number; disputed: number; orders_in_hand: number }>(
      `SELECT u.id AS agent_id, u.name AS agent_name, u.avatar_color,
         COALESCE(sum(cc.amount_paise) FILTER (WHERE cc.handover_id IS NULL), 0)::bigint AS in_hand,
         COALESCE(sum(cc.amount_paise) FILTER (WHERE h.status = 'SUBMITTED'), 0)::bigint AS in_handover,
         COALESCE(sum(cc.amount_paise) FILTER (WHERE h.status = 'DISCREPANCY'), 0)::bigint AS disputed,
         count(cc.id) FILTER (WHERE cc.handover_id IS NULL)::int AS orders_in_hand
       FROM users u
       LEFT JOIN cod_collections cc ON cc.agent_id = u.id AND NOT cc.settled
       LEFT JOIN cash_handovers h ON h.id = cc.handover_id
       WHERE u.workspace_id = $1 AND u.role = 'DELIVERY_AGENT'
       GROUP BY u.id, u.name, u.avatar_color ORDER BY COALESCE(sum(cc.amount_paise), 0) DESC, u.name`,
      [user.workspaceId],
    );
    const outstanding = await this.db.query<{ id: string; order_id: string; code: string; customer_name: string; agent_name: string; amount_paise: number; collected_at: Date; handover_code: string | null; handover_status: string | null; cod_status: string }>(
      `SELECT cc.id, o.id AS order_id, o.code, c.name AS customer_name, u.name AS agent_name, cc.amount_paise, cc.collected_at,
              h.code AS handover_code, h.status AS handover_status, o.cod_status
       FROM cod_collections cc JOIN orders o ON o.id = cc.order_id JOIN customers c ON c.id = o.customer_id
       JOIN users u ON u.id = cc.agent_id LEFT JOIN cash_handovers h ON h.id = cc.handover_id
       WHERE o.workspace_id = $1 AND NOT cc.settled AND cc.agent_id IS NOT NULL
       ORDER BY cc.collected_at`,
      [user.workspaceId],
    );
    const pendingCollection = await this.db.query<{ id: string; code: string; customer_name: string; total_paise: number; collected: number; agent_name: string | null; fulfilment_status: string }>(
      `SELECT o.id, o.code, c.name AS customer_name, o.total_paise, o.cod_collected_paise AS collected, u.name AS agent_name, o.fulfilment_status
       FROM orders o JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = COALESCE(o.delivered_by_agent_id, (SELECT agent_id FROM delivery_assignments WHERE order_id = o.id AND status IN ('OFFERED','ACCEPTED') LIMIT 1))
       WHERE o.workspace_id = $1 AND o.payment_method = 'CASH' AND o.cod_status IN ('PENDING_COLLECTION','COLLECTED')
         AND o.payment_status <> 'PAID' AND o.order_status NOT IN ('CANCELLED','REJECTED')
         AND o.fulfilment_status IN ('DELIVERED','PICKED_UP','OUT_FOR_DELIVERY','COLLECTED','SERVED','SERVICE_COMPLETED')
       ORDER BY o.created_at`,
      [user.workspaceId],
    );
    const handovers = await this.handovers(user, ['SUBMITTED', 'DISCREPANCY']);
    const totals = agents.reduce(
      (t, a) => ({ inHand: t.inHand + Number(a.in_hand), inHandover: t.inHandover + Number(a.in_handover), disputed: t.disputed + Number(a.disputed) }),
      { inHand: 0, inHandover: 0, disputed: 0 },
    );
    return {
      totals: { ...totals, outstandingPaise: totals.inHand + totals.inHandover + totals.disputed },
      agents: agents.map((a) => ({
        agentId: a.agent_id,
        agentName: a.agent_name,
        avatarColor: a.avatar_color,
        inHandPaise: Number(a.in_hand),
        inHandoverPaise: Number(a.in_handover),
        disputedPaise: Number(a.disputed),
        ordersInHand: a.orders_in_hand,
      })),
      outstanding: outstanding.map((o) => ({
        collectionId: o.id,
        orderId: o.order_id,
        code: o.code,
        customerName: o.customer_name,
        agentName: o.agent_name,
        amountPaise: o.amount_paise,
        collectedAt: new Date(o.collected_at).toISOString(),
        handoverCode: o.handover_code,
        handoverStatus: o.handover_status,
        codStatus: o.cod_status,
      })),
      awaitingCollection: pendingCollection.map((o) => ({
        orderId: o.id,
        code: o.code,
        customerName: o.customer_name,
        duePaise: o.total_paise - o.collected,
        agentName: o.agent_name,
        fulfilmentStatus: o.fulfilment_status,
      })),
      pendingHandovers: handovers,
    };
  }

  async handovers(user: AuthUser, statuses?: string[], agentId?: string) {
    const params: unknown[] = [user.workspaceId];
    let where = 'h.workspace_id = $1';
    if (statuses?.length) {
      params.push(statuses);
      where += ` AND h.status = ANY($${params.length}::text[])`;
    }
    if (agentId) {
      params.push(agentId);
      where += ` AND h.agent_id = $${params.length}`;
    }
    const rows = await this.db.query<HandoverRow>(`${HANDOVER_SELECT} WHERE ${where} ORDER BY h.submitted_at DESC LIMIT 100`, params);
    return rows.map(toHandover);
  }

  /** Agent view: cash currently in hand + handover history. */
  async agentCash(user: AuthUser) {
    const inHand = await this.db.query<{ id: string; order_id: string; code: string; customer_name: string; amount_paise: number; collected_at: Date }>(
      `SELECT cc.id, o.id AS order_id, o.code, c.name AS customer_name, cc.amount_paise, cc.collected_at
       FROM cod_collections cc JOIN orders o ON o.id = cc.order_id JOIN customers c ON c.id = o.customer_id
       WHERE cc.agent_id = $1 AND o.workspace_id = $2 AND cc.handover_id IS NULL AND NOT cc.settled ORDER BY cc.collected_at`,
      [user.id, user.workspaceId],
    );
    return {
      inHandPaise: inHand.reduce((s, r) => s + r.amount_paise, 0),
      collections: inHand.map((r) => ({
        collectionId: r.id,
        orderId: r.order_id,
        code: r.code,
        customerName: r.customer_name,
        amountPaise: r.amount_paise,
        collectedAt: new Date(r.collected_at).toISOString(),
      })),
      handovers: await this.handovers(user, undefined, user.id),
    };
  }

  /** Agent submits the cash they hold. Collections are locked so they can't be handed over twice. */
  async submitHandover(user: AuthUser, dto: { collectionIds?: string[]; declaredAmount: number; note?: string }) {
    const notes: NewNotification[] = [];
    const result = await this.db.tx(async (tx) => {
      const params: unknown[] = [user.id, user.workspaceId];
      let filter = '';
      if (dto.collectionIds?.length) {
        params.push(dto.collectionIds);
        filter = ` AND cc.id = ANY($3::uuid[])`;
      }
      const rows = (
        await tx.query<{ id: string; order_id: string; amount_paise: number }>(
          `SELECT cc.id, cc.order_id, cc.amount_paise FROM cod_collections cc JOIN orders o ON o.id = cc.order_id
           WHERE cc.agent_id = $1 AND o.workspace_id = $2 AND cc.handover_id IS NULL AND NOT cc.settled${filter}
           FOR UPDATE OF cc`,
          params,
        )
      ).rows;
      if (!rows.length) throw conflict('NOTHING_TO_HAND_OVER', 'There is no collected cash to hand over.');
      if (dto.collectionIds?.length && rows.length !== new Set(dto.collectionIds).size) {
        throw conflict('COLLECTION_UNAVAILABLE', 'Some selected collections were already handed over. Refresh and try again.');
      }
      const declared = Math.round(Number(dto.declaredAmount) * 100);
      if (!Number.isFinite(declared) || declared < 0) throw badRequest('Enter the amount you are handing over.');
      const expected = rows.reduce((s, r) => s + r.amount_paise, 0);
      if (declared !== expected && !dto.note?.trim()) throw badRequest('Add a note explaining why the amount differs from what you collected.');

      const h = (
        await tx.query<{ id: string; code: string }>(
          `INSERT INTO cash_handovers (workspace_id, agent_id, status, expected_paise, declared_paise, agent_note)
           VALUES ($1,$2,'SUBMITTED',$3,$4,$5) RETURNING id, code`,
          [user.workspaceId, user.id, expected, declared, dto.note?.trim() || null],
        )
      ).rows[0];
      await tx.query('UPDATE cod_collections SET handover_id = $1 WHERE id = ANY($2::uuid[])', [h.id, rows.map((r) => r.id)]);
      const orderIds = [...new Set(rows.map((r) => r.order_id))];
      await tx.query(`UPDATE orders SET cod_status = 'HANDOVER_SUBMITTED' WHERE id = ANY($1::uuid[]) AND cod_status = 'COLLECTED'`, [orderIds]);
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'HANDOVER',
        entityId: h.id,
        action: 'SUBMIT_CASH_HANDOVER',
        message: `Cash handover ${h.code} submitted: ${rupees(declared)} for ${orderIds.length} order(s)`,
        actor: user,
        reason: dto.note ?? null,
        data: { expectedPaise: expected, declaredPaise: declared },
      });
      for (const oid of orderIds) {
        await this.audit.log(tx, {
          workspaceId: user.workspaceId,
          entityType: 'ORDER',
          entityId: oid,
          orderId: oid,
          action: 'SUBMIT_CASH_HANDOVER',
          message: `Cash handed over in ${h.code}`,
          actor: user,
          toState: { codStatus: 'HANDOVER_SUBMITTED' },
        });
      }
      notes.push(
        await this.notifications.create(tx, {
          workspaceId: user.workspaceId,
          audience: 'ADMIN',
          title: 'Cash handover to verify',
          body: `${user.name} · ${rupees(declared)} · ${h.code}`,
        }),
      );
      return { id: h.id, code: h.code, expectedPaise: expected, declaredPaise: declared };
    });
    this.notifications.dispatch(notes);
    return result;
  }

  private async lockHandover(tx: Db, user: AuthUser, id: string) {
    const h = (await tx.query<{ id: string; code: string; status: string; agent_id: string; expected_paise: number; declared_paise: number; received_paise: number | null }>(
      'SELECT id, code, status, agent_id, expected_paise, declared_paise, received_paise FROM cash_handovers WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
      [id, user.workspaceId],
    )).rows[0];
    if (!h) throw notFound('Handover');
    return h;
  }

  private async settleOrders(tx: Db, user: AuthUser, handoverId: string, codStatus: 'SETTLED' | 'DISCREPANCY', message: string, reason?: string | null) {
    const orders = (await tx.query<{ order_id: string }>('SELECT DISTINCT order_id FROM cod_collections WHERE handover_id = $1', [handoverId])).rows.map((r) => r.order_id);
    if (codStatus === 'SETTLED') await tx.query('UPDATE cod_collections SET settled = true WHERE handover_id = $1', [handoverId]);
    await tx.query(`UPDATE orders SET cod_status = $2 WHERE id = ANY($1::uuid[])`, [orders, codStatus]);
    for (const oid of orders) {
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'ORDER',
        entityId: oid,
        orderId: oid,
        action: codStatus === 'SETTLED' ? 'COD_SETTLED' : 'RECORD_DISCREPANCY',
        message,
        actor: user,
        reason: reason ?? null,
        toState: { codStatus },
      });
    }
  }

  /** Admin counted the cash and it matches. */
  async confirm(user: AuthUser, id: string, receivedAmount: number) {
    return this.db.tx(async (tx) => {
      const h = await this.lockHandover(tx, user, id);
      if (h.status !== 'SUBMITTED') throw conflict('INVALID_STATE', `Handover is already ${h.status.toLowerCase()}.`);
      const received = Math.round(Number(receivedAmount) * 100);
      if (!Number.isFinite(received) || received < 0) throw badRequest('Enter the amount received.');
      if (received !== h.expected_paise) {
        throw conflict('AMOUNT_MISMATCH', `Received ${rupees(received)} but ${rupees(h.expected_paise)} was collected — record a discrepancy instead.`);
      }
      await tx.query(`UPDATE cash_handovers SET status = 'CONFIRMED', received_paise = $2, verified_by = $3, verified_at = now() WHERE id = $1`, [id, received, user.id]);
      await this.audit.log(tx, { workspaceId: user.workspaceId, entityType: 'HANDOVER', entityId: id, action: 'CONFIRM_CASH_RECEIVED', message: `Cash received for ${h.code}: ${rupees(received)}`, actor: user });
      await this.settleOrders(tx, user, id, 'SETTLED', `Cash received and settled (${h.code})`);
      await this.notifications.create(tx, { workspaceId: user.workspaceId, audience: 'AGENT', recipientUserId: h.agent_id, title: 'Cash handover confirmed', body: `${h.code} · ${rupees(received)}` });
      return { ok: true };
    });
  }

  /** Admin counted a different amount — settlement stays pending until resolved. */
  async recordDiscrepancy(user: AuthUser, id: string, receivedAmount: number, reason: string) {
    if (!reason?.trim()) throw badRequest('Describe the discrepancy.');
    return this.db.tx(async (tx) => {
      const h = await this.lockHandover(tx, user, id);
      if (h.status !== 'SUBMITTED') throw conflict('INVALID_STATE', `Handover is already ${h.status.toLowerCase()}.`);
      const received = Math.round(Number(receivedAmount) * 100);
      if (!Number.isFinite(received) || received < 0) throw badRequest('Enter the amount received.');
      if (received === h.expected_paise) throw conflict('NO_DIFFERENCE', 'The amount matches — confirm the handover instead.');
      await tx.query(
        `UPDATE cash_handovers SET status = 'DISCREPANCY', received_paise = $2, discrepancy_reason = $3, verified_by = $4, verified_at = now() WHERE id = $1`,
        [id, received, reason.trim(), user.id],
      );
      const diff = received - h.expected_paise;
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'HANDOVER',
        entityId: id,
        action: 'RECORD_DISCREPANCY',
        message: `Discrepancy on ${h.code}: received ${rupees(received)}, expected ${rupees(h.expected_paise)} (${diff < 0 ? 'short' : 'over'} ${rupees(Math.abs(diff))})`,
        actor: user,
        reason,
      });
      await this.settleOrders(tx, user, id, 'DISCREPANCY', `Cash handover discrepancy recorded (${h.code})`, reason);
      await this.notifications.create(tx, { workspaceId: user.workspaceId, audience: 'AGENT', recipientUserId: h.agent_id, title: 'Cash handover discrepancy', body: `${h.code} · ${reason.trim()}` });
      return { ok: true };
    });
  }

  async resolve(user: AuthUser, id: string, resolution: Resolution, note: string) {
    if (!note?.trim()) throw badRequest('Add a resolution note.');
    const allowed: Resolution[] = ['AGENT_PAID_DIFFERENCE', 'RECOUNT_CORRECTED', 'WRITTEN_OFF', 'DEDUCTED_FROM_PAYOUT'];
    if (!allowed.includes(resolution)) throw badRequest('Choose how the discrepancy was resolved.');
    return this.db.tx(async (tx) => {
      const h = await this.lockHandover(tx, user, id);
      if (h.status !== 'DISCREPANCY') throw conflict('INVALID_STATE', 'Only handovers with a discrepancy can be resolved.');
      const finalReceived = resolution === 'AGENT_PAID_DIFFERENCE' || resolution === 'RECOUNT_CORRECTED' ? h.expected_paise : h.received_paise;
      await tx.query(
        `UPDATE cash_handovers SET status = 'RESOLVED', resolution = $2, resolution_note = $3, received_paise = $4, resolved_by = $5, resolved_at = now() WHERE id = $1`,
        [id, resolution, note.trim(), finalReceived, user.id],
      );
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'HANDOVER',
        entityId: id,
        action: 'RESOLVE_DISCREPANCY',
        message: `Discrepancy on ${h.code} resolved: ${resolution.replace(/_/g, ' ').toLowerCase()}`,
        actor: user,
        reason: note,
      });
      await this.settleOrders(tx, user, id, 'SETTLED', `Settlement completed after discrepancy resolution (${h.code})`, note);
      await this.notifications.create(tx, { workspaceId: user.workspaceId, audience: 'AGENT', recipientUserId: h.agent_id, title: 'Discrepancy resolved', body: `${h.code} · ${note.trim()}` });
      return { ok: true };
    });
  }
}

function rupees(p: number): string {
  return `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
