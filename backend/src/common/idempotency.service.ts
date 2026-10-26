import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { AuthUser } from './auth/auth.types';

/**
 * Duplicate-request protection. If a client retries a state-changing request with the same
 * `Idempotency-Key`, the stored response is returned instead of executing the action twice.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: DatabaseService) {}

  async run<T>(user: AuthUser, key: string | undefined, endpoint: string, fn: () => Promise<T>): Promise<T> {
    const k = key?.trim();
    if (!k) return fn();
    if (k.length > 200) return fn();
    const existing = await this.db.one<{ response: T; endpoint: string }>(
      'SELECT response, endpoint FROM idempotency_keys WHERE workspace_id = $1 AND key = $2',
      [user.workspaceId, k],
    );
    if (existing && existing.endpoint === endpoint) return existing.response;
    const result = await fn();
    await this.db
      .query(
        `INSERT INTO idempotency_keys (workspace_id, key, user_id, endpoint, response) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, key) DO NOTHING`,
        [user.workspaceId, k, user.id, endpoint, JSON.stringify(result ?? null)],
      )
      .catch(() => undefined);
    return result;
  }
}
