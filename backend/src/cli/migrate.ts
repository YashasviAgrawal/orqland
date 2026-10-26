/**
 * Minimal, dependency-free migration runner.
 *   npm run db:migrate            apply pending migrations in /migrations (in order)
 *   npm run db:migrate -- --reset drop & recreate the public schema first (DEV ONLY)
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orqland_om' });
  await client.connect();
  try {
    if (process.argv.includes('--reset')) {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
      console.log('Resetting schema…');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = join(__dirname, '..', '..', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      console.log(`Applying ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
