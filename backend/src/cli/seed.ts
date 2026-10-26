/** Loads the sample workspace, people, listings, availability and orders. Safe to re-run. */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orqland_om' });
  await client.connect();
  try {
    await client.query(readFileSync(join(__dirname, '..', '..', 'seeds', 'sample_data.sql'), 'utf8'));
    const r = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM orders');
    console.log(`Sample data loaded: ${r.rows[0].n} orders/bookings.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
