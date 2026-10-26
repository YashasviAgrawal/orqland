import { Injectable } from '@nestjs/common';
import { Db } from './database.service';
import type { AuthUser } from '../common/auth/auth.types';

export interface AuditEntry {
  workspaceId: string;
  entityType: 'ORDER' | 'SLOT' | 'HANDOVER' | 'ASSIGNMENT' | 'PAYMENT' | 'WORKSPACE';
  entityId: string;
  orderId?: string | null;
  action: string;
  message: string;
  actor: Pick<AuthUser, 'id' | 'role' | 'name'>;
  reason?: string | null;
  fromState?: Record<string, unknown> | null;
  toState?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
}

/**
 * Audit log (§9 "Record important status changes with timestamps, user details and reasons").
 * Always written inside the same transaction as the change it describes.
 */
@Injectable()
export class AuditService {
  async log(db: Db, e: AuditEntry): Promise<void> {
    await db.query(
      `INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_id, actor_role, actor_name, reason, from_state, to_state, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        e.workspaceId,
        e.entityType,
        e.entityId,
        e.orderId ?? null,
        e.action,
        e.message,
        e.actor.id,
        e.actor.role,
        e.actor.name ?? null,
        e.reason ?? null,
        e.fromState ? JSON.stringify(e.fromState) : null,
        e.toState ? JSON.stringify(e.toState) : null,
        e.data ? JSON.stringify(e.data) : null,
      ],
    );
  }
}
