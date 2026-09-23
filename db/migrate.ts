/**
 * Migration runner.
 *
 * Applies drizzle/*.sql in journal order, including the hand-written
 * 0001_exclusion_constraint.sql. Use this instead of `drizzle-kit push`, which
 * cannot see that constraint and would offer to drop it (plan.md risk 2).
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Create .env.local first.');

  const db = drizzle(neon(url));
  console.log('Applying migrations from ./drizzle ...');
  await migrate(db, { migrationsFolder: './drizzle' });

  // T004 / plan.md risk 2: do not report success unless the guarantee is
  // actually present. A migration run that silently skipped 0001 would
  // otherwise look identical to one that worked.
  const sql = neon(url);
  const rows = (await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'bookings_no_overlap'
  `) as { def: string }[];

  if (rows.length === 0) {
    throw new Error(
      'FATAL: bookings_no_overlap is missing after migration. The correctness ' +
      'guarantee does not exist. Do not proceed. See research.md R-001.',
    );
  }

  console.log('Migrations applied.');
  console.log('Guarantee verified:', rows[0].def);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
