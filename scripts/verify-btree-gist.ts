/**
 * T004 — verify btree_gist is available on this Neon database.
 *
 * This is the first task in the project. The entire design rests on being
 * able to create an EXCLUDE USING GIST constraint that mixes uuid equality
 * with tstzrange overlap, and btree_gist is what makes that legal.
 *
 * If this fails, research.md R-001's fallback must be adopted and the spec
 * amended BEFORE any code depends on the guarantee.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const version = (await sql`SELECT version()`) as { version: string }[];
  console.log('Connected:', version[0].version.split(',')[0]);

  const available = (await sql`
    SELECT name, default_version, installed_version
    FROM pg_available_extensions WHERE name = 'btree_gist'
  `) as { name: string; default_version: string; installed_version: string | null }[];

  if (available.length === 0) {
    console.error('\nFAIL: btree_gist is NOT available on this database.');
    console.error('Stop. See research.md R-001 — the design must change.');
    process.exit(1);
  }
  console.log(`btree_gist available: v${available[0].default_version}`);

  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;

  const installed = (await sql`
    SELECT extversion FROM pg_extension WHERE extname = 'btree_gist'
  `) as { extversion: string }[];

  if (installed.length === 0) {
    console.error('\nFAIL: CREATE EXTENSION reported success but the extension is absent.');
    process.exit(1);
  }
  console.log(`btree_gist INSTALLED: v${installed[0].extversion}`);

  // Prove the actual constraint shape works, on a throwaway table, before
  // committing the real migration to it.
  await sql`DROP TABLE IF EXISTS _t004_probe`;
  await sql`CREATE TABLE _t004_probe (
    room_id uuid NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'confirmed'
  )`;
  await sql`ALTER TABLE _t004_probe ADD CONSTRAINT _probe_no_overlap
    EXCLUDE USING GIST (
      room_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'confirmed')`;
  console.log('EXCLUDE USING GIST constraint created successfully.');

  const room = '11111111-1111-4111-8111-111111111111';
  await sql`INSERT INTO _t004_probe VALUES (${room}, '2026-09-24T14:00:00Z', '2026-09-24T15:00:00Z', 'confirmed')`;
  console.log('  baseline booking 14:00-15:00 inserted');

  // EC-003 — adjacent must be allowed.
  await sql`INSERT INTO _t004_probe VALUES (${room}, '2026-09-24T15:00:00Z', '2026-09-24T16:00:00Z', 'confirmed')`;
  console.log('  EC-003 adjacent 15:00-16:00 ACCEPTED (correct)');

  // EC-002 — partial overlap must be refused.
  try {
    await sql`INSERT INTO _t004_probe VALUES (${room}, '2026-09-24T14:30:00Z', '2026-09-24T15:30:00Z', 'confirmed')`;
    console.error('  EC-002 FAIL: partial overlap was accepted!');
    process.exit(1);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    console.log(`  EC-002 partial overlap REFUSED with SQLSTATE ${code ?? '(none)'}`);
    if (code !== '23P01') {
      console.error(`  WARNING: expected 23P01, got ${code}. createBooking maps 23P01 only.`);
    }
  }

  // EC-005 — a cancelled row must not reserve.
  await sql`INSERT INTO _t004_probe VALUES (${room}, '2026-09-24T20:00:00Z', '2026-09-24T21:00:00Z', 'cancelled')`;
  await sql`INSERT INTO _t004_probe VALUES (${room}, '2026-09-24T20:00:00Z', '2026-09-24T21:00:00Z', 'confirmed')`;
  console.log('  EC-005 cancelled row did not block rebooking (correct)');

  await sql`DROP TABLE _t004_probe`;
  console.log('\nT004 PASS — the design holds on this database.');
}

main().catch((e) => { console.error('T004 ERROR:', e); process.exit(1); });
