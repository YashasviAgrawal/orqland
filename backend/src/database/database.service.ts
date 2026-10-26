import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { config } from '../config';

// Return BIGINT/COUNT as JS numbers (values stay well below 2^53 in this module).
types.setTypeParser(20, (v: string) => Number(v));
// NUMERIC → number (distance, coordinates).
types.setTypeParser(1700, (v: string) => Number(v));

/** Anything that can run a query: the pool or a transaction client. */
export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  constructor() {
    this.pool.on('error', (err: Error) => this.logger.error(`Idle client error: ${err.message}`));
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /** Run `fn` inside a transaction. Rolls back on any error. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Helper for single-row queries on a transaction client. */
export async function q1<T extends QueryResultRow = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const res = await db.query<T>(sql, params);
  return res.rows[0] ?? null;
}

export async function qa<T extends QueryResultRow = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}
