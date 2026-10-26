import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Db } from '../database/database.service';
import type { AuthUser } from '../common/auth/auth.types';
import { Role } from '../domain/enums';
import type { Audience } from '../domain/types';

export interface NewNotification {
  workspaceId: string;
  audience: Audience;
  recipientUserId?: string | null;
  recipientCustomerId?: string | null;
  orderId?: string | null;
  title: string;
  body?: string | null;
}

/**
 * Outbound channel adapter. External notification providers (SMS, WhatsApp, push, email) are
 * out of scope until agreed with OpenPurpl (§11); implement this interface to add one.
 */
export interface NotificationChannel {
  readonly name: string;
  supports(n: NewNotification): boolean;
  send(n: NewNotification): Promise<void>;
}

/** In-app notifications for workspace users — stored and shown in the bell menu. */
class InAppChannel implements NotificationChannel {
  readonly name = 'IN_APP';
  supports(n: NewNotification) {
    return n.audience !== 'CUSTOMER';
  }
  async send(): Promise<void> {
    /* persisted by NotificationsService; nothing else to do */
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly channels: NotificationChannel[] = [new InAppChannel()];

  constructor(private readonly db: DatabaseService) {}

  /** Register an external provider at bootstrap (see integration guide). */
  registerChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /** Persist inside the caller's transaction; dispatch happens after commit via `dispatch`. */
  async create(db: Db, n: NewNotification): Promise<NewNotification> {
    const channel = n.audience === 'CUSTOMER' ? 'CUSTOMER' : 'IN_APP';
    const external = this.channels.find((c) => c.name !== 'IN_APP' && c.supports(n));
    const status = n.audience === 'CUSTOMER' ? (external ? 'QUEUED' : 'SKIPPED') : 'SENT';
    await db.query(
      `INSERT INTO notifications (workspace_id, audience, recipient_user_id, recipient_customer_id, order_id, title, body, channel, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [n.workspaceId, n.audience, n.recipientUserId ?? null, n.recipientCustomerId ?? null, n.orderId ?? null, n.title, n.body ?? null, channel, status],
    );
    return n;
  }

  /** Fire-and-forget delivery through external channels. Failures never break the order flow. */
  dispatch(list: NewNotification[]): void {
    for (const n of list) {
      for (const c of this.channels) {
        if (c.name === 'IN_APP' || !c.supports(n)) continue;
        c.send(n).catch((e: Error) => this.logger.warn(`Channel ${c.name} failed: ${e.message}`));
      }
    }
  }

  async listFor(user: AuthUser, limit = 30) {
    const params: unknown[] = [user.workspaceId, limit];
    let who: string;
    if (user.role === Role.ADMIN) who = `audience = 'ADMIN'`;
    else {
      params.push(user.id);
      who = `recipient_user_id = $3`;
    }
    const rows = await this.db.query<{ id: string; title: string; body: string | null; order_id: string | null; order_code: string | null; read_at: Date | null; created_at: Date }>(
      `SELECT n.id, n.title, n.body, n.order_id, o.code AS order_code, n.read_at, n.created_at
       FROM notifications n LEFT JOIN orders o ON o.id = n.order_id
       WHERE n.workspace_id = $1 AND ${who} ORDER BY n.created_at DESC LIMIT $2`,
      params,
    );
    const unread = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND read_at IS NULL AND ${
        user.role === Role.ADMIN ? `audience = 'ADMIN'` : 'recipient_user_id = $2'
      }`,
      user.role === Role.ADMIN ? [user.workspaceId] : [user.workspaceId, user.id],
    );
    return {
      unread: unread?.n ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        orderId: r.order_id,
        orderCode: r.order_code,
        read: !!r.read_at,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  async markRead(user: AuthUser, id?: string): Promise<void> {
    const params: unknown[] = [user.workspaceId];
    let sql = `UPDATE notifications SET read_at = now() WHERE workspace_id = $1 AND read_at IS NULL`;
    if (user.role === Role.ADMIN) sql += ` AND audience = 'ADMIN'`;
    else {
      params.push(user.id);
      sql += ` AND recipient_user_id = $${params.length}`;
    }
    if (id) {
      params.push(id);
      sql += ` AND id = $${params.length}`;
    }
    await this.db.query(sql, params);
  }

  /** Customer-side notifications (shown in the demo simulator only). */
  async forCustomer(workspaceId: string, customerId: string) {
    return this.db.query(
      `SELECT n.id, n.title, n.body, o.code AS "orderCode", n.delivery_status AS "deliveryStatus", n.created_at AS "createdAt"
       FROM notifications n LEFT JOIN orders o ON o.id = n.order_id
       WHERE n.workspace_id = $1 AND n.recipient_customer_id = $2 ORDER BY n.created_at DESC LIMIT 30`,
      [workspaceId, customerId],
    );
  }
}
