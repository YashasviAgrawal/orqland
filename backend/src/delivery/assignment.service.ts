import { Injectable } from '@nestjs/common';
import type { Db } from '../database/database.service';
import { badRequest, conflict } from '../common/errors';
import type { AuthUser } from '../common/auth/auth.types';

export interface WorkspaceSettings {
  assignmentExpirySeconds: number;
  autoReassignOnReject: boolean;
  autoAssignStrategy: 'LEAST_ACTIVE';
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  assignmentExpirySeconds: 180,
  autoReassignOnReject: true,
  autoAssignStrategy: 'LEAST_ACTIVE',
};

export async function loadSettings(db: Db, workspaceId: string): Promise<WorkspaceSettings> {
  const r = await db.query<{ settings: Partial<WorkspaceSettings> | null }>('SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
  return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.settings ?? {}) };
}

/**
 * Delivery agent assignment (§2A, §7):
 *  • manual assignment to any active agent
 *  • automatic assignment — picks the available agent with the fewest active deliveries,
 *    skipping agents who already rejected / let this order expire
 *  • every offer expires after `assignmentExpirySeconds` if not accepted
 * The strategy is isolated here so a distance-based strategy can replace it once live GPS
 * tracking is agreed (see integration guide).
 */
@Injectable()
export class AssignmentService {
  async offer(
    db: Db,
    order: { id: string; workspace_id: string },
    actor: AuthUser,
    opts: { agentId: string | null; auto: boolean; excludeAgentIds: string[] },
  ): Promise<{ assignmentId: string; agentId: string; agentName: string; method: 'MANUAL' | 'AUTO'; expiresAt: string }> {
    const settings = await loadSettings(db, order.workspace_id);
    let agent: { id: string; name: string } | undefined;

    if (!opts.auto) {
      const r = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM users WHERE id = $1 AND workspace_id = $2 AND role = 'DELIVERY_AGENT' AND is_active`,
        [opts.agentId, order.workspace_id],
      );
      agent = r.rows[0];
      if (!agent) throw badRequest('Choose an active delivery agent.');
    } else {
      const previous = await db.query<{ agent_id: string }>(
        `SELECT DISTINCT agent_id FROM delivery_assignments WHERE order_id = $1 AND status IN ('REJECTED','EXPIRED')`,
        [order.id],
      );
      const exclude = [...new Set([...opts.excludeAgentIds, ...previous.rows.map((p) => p.agent_id)])];
      const r = await db.query<{ id: string; name: string }>(
        `SELECT u.id, u.name
         FROM users u
         LEFT JOIN delivery_assignments a ON a.agent_id = u.id AND a.status IN ('OFFERED','ACCEPTED')
         WHERE u.workspace_id = $1 AND u.role = 'DELIVERY_AGENT' AND u.is_active AND u.is_available
           AND NOT (u.id = ANY($2::uuid[]))
         GROUP BY u.id, u.name
         ORDER BY count(a.id) ASC,
                  (SELECT max(x.offered_at) FROM delivery_assignments x WHERE x.agent_id = u.id) ASC NULLS FIRST,
                  u.name
         LIMIT 1`,
        [order.workspace_id, exclude],
      );
      agent = r.rows[0];
      if (!agent) throw conflict('NO_AGENT_AVAILABLE', 'No delivery agent is available right now. Try again shortly or assign one manually.');
    }

    const ins = await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO delivery_assignments (order_id, agent_id, status, method, assigned_by, expires_at)
       VALUES ($1, $2, 'OFFERED', $3, $4, now() + make_interval(secs => $5))
       RETURNING id, expires_at`,
      [order.id, agent.id, opts.auto ? 'AUTO' : 'MANUAL', actor.role === 'SYSTEM' ? null : actor.id, settings.assignmentExpirySeconds],
    );
    return {
      assignmentId: ins.rows[0].id,
      agentId: agent.id,
      agentName: agent.name,
      method: opts.auto ? 'AUTO' : 'MANUAL',
      expiresAt: new Date(ins.rows[0].expires_at).toISOString(),
    };
  }
}
