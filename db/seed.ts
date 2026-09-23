/**
 * Reference rooms (A-005 — room administration is out of scope for v1).
 *
 * The set is chosen so every timezone-dependent edge case is reachable:
 *   - two rooms in Asia/Kolkata  -> EC-004 (same range, different room)
 *   - one in America/New_York    -> EC-013 (DST), EC-014 (viewer timezone)
 *   - one inactive               -> EC-008 (ROOM_INACTIVE)
 *   - one with narrow hours      -> EC-009 (OUTSIDE_BUSINESS_HOURS)
 *
 * Idempotent: re-running replaces the room set without touching bookings,
 * so `npm run seed` is safe to repeat during a demo.
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { inArray, notInArray } from 'drizzle-orm';
import { rooms, type NewRoom } from './schema';

const SEED_ROOMS: NewRoom[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aurora',
    capacity: 12,
    location: 'Level 3, North Wing',
    timezone: 'Asia/Kolkata',
    opensAt: '08:00',
    closesAt: '18:00',
    isActive: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Borealis',
    capacity: 6,
    location: 'Level 3, South Wing',
    timezone: 'Asia/Kolkata',
    opensAt: '08:00',
    closesAt: '18:00',
    isActive: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Meridian',
    capacity: 20,
    location: 'New York Office, Level 11',
    // Observes DST — the only way to exercise EC-013 honestly.
    timezone: 'America/New_York',
    opensAt: '08:00',
    closesAt: '18:00',
    isActive: true,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Cinder',
    capacity: 4,
    location: 'Level 1, Annexe',
    timezone: 'Asia/Kolkata',
    // Deliberately narrow, so EC-009 is demonstrable without contriving a time.
    opensAt: '09:30',
    closesAt: '12:30',
    isActive: true,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Halcyon (under refurbishment)',
    capacity: 8,
    location: 'Level 2, East Wing',
    timezone: 'Asia/Kolkata',
    opensAt: '08:00',
    closesAt: '18:00',
    // EC-008 — exists, but cannot be booked.
    isActive: false,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Create .env.local first.');

  const db = drizzle(neon(url));
  const ids = SEED_ROOMS.map((r) => r.id!);

  // Upsert rather than delete-and-recreate: bookings reference rooms with
  // ON DELETE RESTRICT (FR-022), so deleting a seeded room would either fail
  // or destroy history.
  for (const room of SEED_ROOMS) {
    await db
      .insert(rooms)
      .values(room)
      .onConflictDoUpdate({ target: rooms.id, set: { ...room } });
  }

  // Remove any room NOT in the seed set, but only if nothing references it.
  // RESTRICT will refuse otherwise, which is the correct outcome.
  const strays = await db.select({ id: rooms.id, name: rooms.name })
    .from(rooms).where(notInArray(rooms.id, ids));
  for (const stray of strays) {
    try {
      await db.delete(rooms).where(inArray(rooms.id, [stray.id]));
      console.log(`  removed stray room: ${stray.name}`);
    } catch {
      console.log(`  kept stray room "${stray.name}" — it still has bookings`);
    }
  }

  const all = await db.select().from(rooms);
  console.log(`Seeded ${SEED_ROOMS.length} rooms; ${all.length} total.`);
  for (const r of all.sort((a, b) => a.name.localeCompare(b.name))) {
    const state = r.isActive ? 'active  ' : 'INACTIVE';
    console.log(`  ${state}  ${r.name.padEnd(30)} cap ${String(r.capacity).padStart(2)}  ` +
      `${r.opensAt.slice(0, 5)}-${r.closesAt.slice(0, 5)}  ${r.timezone}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
