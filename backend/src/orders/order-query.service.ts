import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { AuthUser } from '../common/auth/auth.types';
import { forbidden, notFound } from '../common/errors';
import { Role } from '../domain/enums';
import { ORDER_SELECT, OrderRow, findOrderRow, iso } from './order.repository';
import { toOrderView } from './order.view';
import { workflowOf } from '../domain/workflows';

export const VIEWS = ['all', 'new', 'confirmed', 'in_progress', 'completed', 'cancelled', 'exceptions', 'processing', 'ongoing', 'upcoming'] as const;
export type OrderViewFilter = (typeof VIEWS)[number];

/** SQL predicate for each dashboard card / tab (§5). */
const VIEW_SQL: Record<OrderViewFilter, string> = {
  all: 'TRUE',
  new: `o.order_status IN ('PENDING_REVIEW','CLARIFICATION_REQUESTED')`,
  confirmed: `o.order_status = 'CONFIRMED'`,
  in_progress: `o.order_status = 'IN_PROGRESS'`,
  completed: `o.order_status = 'COMPLETED'`,
  cancelled: `o.order_status IN ('CANCELLED','REJECTED')`,
  exceptions: `o.exception IS NOT NULL`,
  processing: `o.order_status IN ('CONFIRMED','IN_PROGRESS') AND o.fulfilment_status IN ('AWAITING_PREPARATION','PREPARING','READY')`,
  ongoing: `o.order_status IN ('CONFIRMED','IN_PROGRESS') AND o.fulfilment_status IN ('PICKED_UP','OUT_FOR_DELIVERY','PROVIDER_EN_ROUTE','CHECKED_IN','IN_SERVICE')`,
  upcoming: `o.order_status IN ('CONFIRMED','IN_PROGRESS') AND o.fulfilment_status IN ('SCHEDULED','AWAITING_SCHEDULE')`,
};

export interface ListFilters {
  view?: OrderViewFilter;
  kind?: 'PRODUCT' | 'SERVICE';
  fulfilmentTypes?: string[];
  orderStatus?: string;
  paymentStatus?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'created' | 'scheduled';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class OrderQueryService {
  constructor(private readonly db: DatabaseService) {}

  /** Scope rows to what the user may see (RBAC on reads). */
  private scope(user: AuthUser, params: unknown[]): string {
    if (user.role === Role.ADMIN) return 'TRUE';
    if (user.role === Role.AGENT) {
      params.push(user.id);
      return `EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id AND da.agent_id = $${params.length})`;
    }
    if (user.role === Role.STAFF) {
      params.push(user.id);
      return `o.provider_id = $${params.length}`;
    }
    return 'FALSE';
  }

  private where(user: AuthUser, f: ListFilters, params: unknown[], skipView = false): string {
    params.push(user.workspaceId);
    const parts = [`o.workspace_id = $${params.length}`, this.scope(user, params)];
    if (!skipView) parts.push(VIEW_SQL[f.view ?? 'all']);
    if (f.kind) {
      params.push(f.kind);
      parts.push(`o.kind = $${params.length}`);
    }
    if (f.fulfilmentTypes?.length) {
      params.push(f.fulfilmentTypes);
      parts.push(`o.fulfilment_type = ANY($${params.length}::text[])`);
    }
    if (f.orderStatus) {
      params.push(f.orderStatus.split(','));
      parts.push(`o.order_status = ANY($${params.length}::text[])`);
    }
    if (f.paymentStatus) {
      params.push(f.paymentStatus);
      parts.push(`o.payment_status = $${params.length}`);
    }
    if (f.q?.trim()) {
      params.push(`%${f.q.trim()}%`);
      const p = `$${params.length}`;
      parts.push(`(o.code ILIKE ${p} OR c.name ILIKE ${p} OR c.phone ILIKE ${p} OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.name ILIKE ${p}))`);
    }
    const col = f.dateField === 'scheduled' ? 'o.scheduled_start' : 'o.created_at';
    if (f.dateFrom) {
      params.push(f.dateFrom);
      parts.push(`${col} >= ist_day_start($${params.length}::date)`);
    }
    if (f.dateTo) {
      params.push(f.dateTo);
      parts.push(`${col} < ist_day_start($${params.length}::date + 1)`);
    }
    return parts.join(' AND ');
  }

  async list(user: AuthUser, f: ListFilters) {
    const params: unknown[] = [];
    const where = this.where(user, f, params);
    const pageSize = Math.min(Math.max(f.pageSize ?? 24, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const order =
      f.view === 'upcoming'
        ? 'o.scheduled_start ASC NULLS LAST, o.created_at DESC'
        : f.view === 'new'
          ? 'o.created_at ASC'
          : `CASE WHEN o.order_status IN ('PENDING_REVIEW','CLARIFICATION_REQUESTED') THEN 0 ELSE 1 END, o.created_at DESC`;
    const countRow = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where}`,
      params,
    );
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.db.query<OrderRow>(
      `${ORDER_SELECT} WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map((r) => toOrderView(r, user)), total: countRow?.n ?? 0, page, pageSize };
  }

  /** Counts for the summary cards and tabs, respecting the kind/type/search filters. */
  async summary(user: AuthUser, f: ListFilters) {
    const params: unknown[] = [];
    const where = this.where(user, f, params, true);
    const cols = (Object.keys(VIEW_SQL) as OrderViewFilter[]).map((v) => `count(*) FILTER (WHERE ${VIEW_SQL[v]})::int AS "${v}"`).join(', ');
    const counts = await this.db.one<Record<OrderViewFilter, number>>(
      `SELECT ${cols} FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where}`,
      params,
    );
    const money = await this.db.one<{ today: number; yesterday: number; outstanding_cod: number; pending_handovers: number; refunds_pending: number }>(
      `SELECT
         COALESCE(sum(total_paise) FILTER (WHERE payment_status = 'PAID' AND order_status NOT IN ('CANCELLED','REJECTED')
            AND created_at >= ist_day_start(ist_today())), 0)::bigint AS today,
         COALESCE(sum(total_paise) FILTER (WHERE payment_status = 'PAID' AND order_status NOT IN ('CANCELLED','REJECTED')
            AND created_at >= ist_day_start(ist_today() - 1) AND created_at < ist_day_start(ist_today())), 0)::bigint AS yesterday,
         (SELECT COALESCE(sum(amount_paise),0)::bigint FROM cod_collections cc JOIN orders o2 ON o2.id = cc.order_id
            WHERE o2.workspace_id = $1 AND NOT cc.settled AND cc.agent_id IS NOT NULL) AS outstanding_cod,
         (SELECT count(*)::int FROM cash_handovers h WHERE h.workspace_id = $1 AND h.status IN ('SUBMITTED','DISCREPANCY')) AS pending_handovers,
         count(*) FILTER (WHERE refund_status = 'PENDING')::int AS refunds_pending
       FROM orders WHERE workspace_id = $1`,
      [user.workspaceId],
    );
    const today = money?.today ?? 0;
    const yesterday = money?.yesterday ?? 0;
    return {
      counts,
      revenue: {
        todayPaise: today,
        yesterdayPaise: yesterday,
        changePct: yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 1000) / 10 : null,
      },
      cod: { outstandingPaise: money?.outstanding_cod ?? 0, pendingHandovers: money?.pending_handovers ?? 0 },
      refundsPending: money?.refunds_pending ?? 0,
    };
  }

  /** Generic helper for role-specific boards. `where` may use $2.. for `params`. */
  async listWhere(user: AuthUser, where: string, params: unknown[], orderBy: string, limit = 100) {
    const rows = await this.db.query<OrderRow>(
      `${ORDER_SELECT} WHERE o.workspace_id = $1 AND (${where}) ORDER BY ${orderBy} LIMIT ${Math.min(limit, 200)}`,
      [user.workspaceId, ...params],
    );
    return rows.map((r) => toOrderView(r, user));
  }

  async assertCanView(user: AuthUser, row: OrderRow): Promise<void> {
    if (user.role === Role.ADMIN) return;
    if (user.role === Role.STAFF && row.provider_id === user.id) return;
    if (user.role === Role.AGENT) {
      const ok = await this.db.one('SELECT 1 FROM delivery_assignments WHERE order_id = $1 AND agent_id = $2 LIMIT 1', [row.id, user.id]);
      if (ok) return;
    }
    throw forbidden('This order is not assigned to you');
  }

  async detail(user: AuthUser, id: string) {
    const row = await findOrderRow(this.db.pool, user.workspaceId, id);
    if (!row) throw notFound('Order');
    await this.assertCanView(user, row);
    const isAdmin = user.role === Role.ADMIN;

    const [timeline, payments, collections, assignments, requests] = await Promise.all([
      this.db.query<{ id: number; action: string; message: string; actor_role: string; actor_name: string | null; reason: string | null; data: unknown; from_state: unknown; to_state: unknown; created_at: Date }>(
        `SELECT id, action, message, actor_role, actor_name, reason, data, from_state, to_state, created_at
         FROM audit_logs WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
        [id],
      ),
      isAdmin
        ? this.db.query<{ id: string; attempt: number; method: string; amount_paise: number; status: string; provider: string; provider_reference: string | null; failure_reason: string | null; created_at: Date; confirmed_at: Date | null }>(
            'SELECT * FROM payments WHERE order_id = $1 ORDER BY attempt',
            [id],
          )
        : Promise.resolve([]),
      this.db.query<{ id: string; agent_id: string | null; agent_name: string | null; amount_paise: number; collected_at: Date; settled: boolean; handover_id: string | null; handover_code: string | null; handover_status: string | null }>(
        `SELECT cc.id, cc.agent_id, u.name AS agent_name, cc.amount_paise, cc.collected_at, cc.settled, cc.handover_id, h.code AS handover_code, h.status AS handover_status
         FROM cod_collections cc LEFT JOIN users u ON u.id = cc.agent_id LEFT JOIN cash_handovers h ON h.id = cc.handover_id
         WHERE cc.order_id = $1 ORDER BY cc.collected_at`,
        [id],
      ),
      this.db.query<{ id: string; agent_id: string; agent_name: string; status: string; method: string; offered_at: Date; expires_at: Date | null; responded_at: Date | null; picked_up_at: Date | null; closed_at: Date | null; reason: string | null }>(
        `SELECT a.id, a.agent_id, u.name AS agent_name, a.status, a.method, a.offered_at, a.expires_at, a.responded_at, a.picked_up_at, a.closed_at, a.reason
         FROM delivery_assignments a JOIN users u ON u.id = a.agent_id WHERE a.order_id = $1 ORDER BY a.offered_at`,
        [id],
      ),
      this.db.query<{ id: string; type: string; status: string; requested_by_role: string; reason: string | null; proposed_start: Date | null; resolution_note: string | null; created_at: Date; resolved_at: Date | null }>(
        'SELECT * FROM order_requests WHERE order_id = $1 ORDER BY created_at',
        [id],
      ),
    ]);

    const wf = workflowOf(row.fulfilment_type);
    return {
      ...toOrderView(row, user),
      workflow: { label: wf.label, description: wf.description, deliveryAgent: wf.deliveryAgent, scheduled: wf.scheduled, online: wf.online, attendance: wf.attendance },
      timeline: timeline.map((t) => ({
        id: t.id,
        action: t.action,
        message: t.message,
        actor: { role: t.actor_role, name: t.actor_name },
        reason: t.reason,
        data: t.data,
        fromState: t.from_state,
        toState: t.to_state,
        at: iso(t.created_at),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        attempt: p.attempt,
        method: p.method,
        amountPaise: p.amount_paise,
        status: p.status,
        provider: p.provider,
        reference: p.provider_reference,
        failureReason: p.failure_reason,
        createdAt: iso(p.created_at),
        confirmedAt: iso(p.confirmed_at),
      })),
      codCollections: collections.map((c) => ({
        id: c.id,
        agentId: c.agent_id,
        agentName: c.agent_name,
        amountPaise: c.amount_paise,
        collectedAt: iso(c.collected_at),
        settled: c.settled,
        handover: c.handover_id ? { id: c.handover_id, code: c.handover_code, status: c.handover_status } : null,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        agentId: a.agent_id,
        agentName: a.agent_name,
        status: a.status,
        method: a.method,
        offeredAt: iso(a.offered_at),
        expiresAt: iso(a.expires_at),
        respondedAt: iso(a.responded_at),
        pickedUpAt: iso(a.picked_up_at),
        closedAt: iso(a.closed_at),
        reason: a.reason,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        requestedByRole: r.requested_by_role,
        reason: r.reason,
        proposedStart: iso(r.proposed_start),
        resolutionNote: r.resolution_note,
        createdAt: iso(r.created_at),
        resolvedAt: iso(r.resolved_at),
      })),
    };
  }
}
