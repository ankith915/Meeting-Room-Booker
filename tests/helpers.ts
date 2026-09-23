/**
 * Shared helpers for integration and concurrency tests.
 *
 * These run against a REAL Neon database. Per research.md R-006 the guarantee
 * lives in PostgreSQL, so mocking it would test our belief about PostgreSQL
 * rather than PostgreSQL itself.
 */

import { and, eq, gte } from 'drizzle-orm';
import { db } from '@/db/client';
import { bookings } from '@/db/schema';
import { localToInstant, formatLocalDate } from '@/lib/time';

/** Seeded rooms — ids are fixed in db/seed.ts so tests can rely on them. */
export const ROOM = {
  aurora: '11111111-1111-4111-8111-111111111111',
  borealis: '22222222-2222-4222-8222-222222222222',
  meridian: '33333333-3333-4333-8333-333333333333',
  cinder: '44444444-4444-4444-8444-444444444444',
  halcyon: '55555555-5555-4555-8555-555555555555', // inactive — EC-008
} as const;

export const KOLKATA = 'Asia/Kolkata';

/**
 * A local date a given number of days ahead, inside the 90-day horizon (A-009).
 * Computed relative to now so these tests never expire.
 */
export function futureDate(daysAhead: number, timeZone = KOLKATA): string {
  const when = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return formatLocalDate(when, timeZone);
}

/** An ISO instant for a room-local wall-clock time on a future date. */
export function at(date: string, time: string, timeZone = KOLKATA): string {
  return localToInstant(date, time, timeZone).toISOString();
}

/** Remove every booking for a room from a given instant onward. */
export async function clearBookings(roomId: string, from: Date): Promise<void> {
  await db.delete(bookings).where(and(eq(bookings.roomId, roomId), gte(bookings.startsAt, from)));
}

/** Remove all bookings created by tests, across every seeded room. */
export async function clearAllTestBookings(): Promise<void> {
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  for (const roomId of Object.values(ROOM)) {
    await clearBookings(roomId, from);
  }
}

/**
 * How many CONFIRMED bookings exist for exactly this room and range?
 *
 * This is the assertion that actually matters in the concurrency test.
 * Response codes can lie; the stored row count cannot.
 */
export async function countConfirmed(
  roomId: string,
  startsAt: string,
  endsAt: string,
): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.roomId, roomId),
        eq(bookings.status, 'confirmed'),
        eq(bookings.startsAt, new Date(startsAt)),
        eq(bookings.endsAt, new Date(endsAt)),
      ),
    );
  return rows.length;
}
