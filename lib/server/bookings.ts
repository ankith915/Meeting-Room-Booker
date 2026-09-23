/**
 * Booking service — the ONLY path that may create a confirmed booking.
 *
 * Any future feature that reserves a room (natural-language booking, bulk
 * import, an external API) calls createBooking rather than writing its own
 * INSERT. That is the "untrusted-input parity" rule in the constitution, and
 * it keeps one guarded path instead of several unguarded ones.
 *
 * Lives in lib/server rather than app/actions so tests can import it without a
 * Next.js runtime. app/actions/* are thin 'use server' wrappers over these
 * functions. (Deviation from plan.md's structure; recorded there.)
 *
 * Spec: FR-004..FR-011, FR-016..FR-020
 * Contract: specs/001-meeting-room-booker/contracts/create-booking.md
 */

import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { bookings, rooms, type Booking, type Room } from '@/db/schema';
import {
  err, ok, isExclusionViolation,
  type Result, type ConflictDetail, type Alternative,
} from '@/lib/domain/errors';
import { createBookingSchema, checkTimeRules, toBookingError } from '@/lib/validation';
import { durationMinutes } from '@/lib/domain/interval';
import { freeGaps } from '@/lib/domain/availability';
import { businessHoursOn, formatLocalDate } from '@/lib/time';

export type CreateBookingInput = {
  roomId: string;
  startsAt: string;
  endsAt: string;
  title: string;
  organiser: string;
};

export type CreateBookingOptions = {
  /** Injected clock, so no test depends on the wall clock. */
  now?: Date;
  /**
   * SC-003 ONLY. Skips every application-layer check and goes straight to the
   * INSERT, to demonstrate the guarantee does not rest on this code.
   * Overlapping bookings must STILL be impossible when this is set.
   */
  skipApplicationChecks?: boolean;
};

/**
 * Create a confirmed booking, or refuse with a typed reason.
 *
 * Steps 1-3 are user experience. Step 4 is where correctness is enforced.
 */
export async function createBooking(
  input: CreateBookingInput,
  options: CreateBookingOptions = {},
): Promise<Result<Booking>> {
  const now = options.now ?? new Date();

  let room: Room | undefined;
  let startsAt: Date;
  let endsAt: Date;

  if (options.skipApplicationChecks) {
    startsAt = new Date(input.startsAt);
    endsAt = new Date(input.endsAt);
  } else {
    // 1. Shape — EC-006, EC-011
    const parsed = createBookingSchema.safeParse(input);
    if (!parsed.success) return toBookingError(parsed.error.issues);

    startsAt = new Date(parsed.data.startsAt);
    endsAt = new Date(parsed.data.endsAt);

    // 2. Room — EC-008
    room = await findRoom(parsed.data.roomId);
    if (!room) return err('ROOM_NOT_FOUND', 'That room does not exist.');
    if (!room.isActive) {
      return err('ROOM_INACTIVE', `${room.name} is not currently available for booking.`);
    }

    // 3. Time rules — EC-007, EC-009, EC-010, EC-012, EC-018
    const timing = checkTimeRules({ startsAt, endsAt }, room, now);
    if (!timing.ok) return timing;
  }

  // 4. The guarded write. bookings_no_overlap decides, not us.
  try {
    const [created] = await db
      .insert(bookings)
      .values({
        roomId: input.roomId,
        title: input.title.trim(),
        organiser: input.organiser.trim(),
        startsAt,
        endsAt,
        status: 'confirmed',
      })
      .returning();
    return ok(created);
  } catch (e: unknown) {
    // ONLY 23P01 becomes SLOT_TAKEN. A bare catch would report a connection
    // failure as a booking conflict and hide real faults (Constitution V).
    if (!isExclusionViolation(e)) throw e;

    const conflict = await findConflict(input.roomId, startsAt, endsAt);
    const alternatives = await suggestAlternatives(input.roomId, startsAt, endsAt, room);
    const who = conflict ? `${conflict.title} (${conflict.organiser})` : 'another booking';

    return err('SLOT_TAKEN', `That slot was just taken by ${who}.`, {
      conflict: conflict ?? undefined,
      alternatives,
    });
  }
}

async function findRoom(roomId: string): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  return room;
}

/** The confirmed booking that holds the requested range (FR-009). */
async function findConflict(
  roomId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<ConflictDetail | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.roomId, roomId),
        eq(bookings.status, 'confirmed'),
        lt(bookings.startsAt, endsAt), // half-open overlap, mirroring FR-005
        gt(bookings.endsAt, startsAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    bookingId: row.id,
    title: row.title,
    organiser: row.organiser,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

/**
 * Somewhere else to go (FR-010): other rooms free for the same range, then the
 * nearest free ranges of equal duration on the room that was asked for.
 */
export async function suggestAlternatives(
  roomId: string,
  startsAt: Date,
  endsAt: Date,
  room?: Room,
): Promise<Alternative[]> {
  const wanted = durationMinutes({ startsAt, endsAt });
  const out: Alternative[] = [];

  const candidates = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.isActive, true), ne(rooms.id, roomId)));

  for (const candidate of candidates) {
    const [clash] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.roomId, candidate.id),
          eq(bookings.status, 'confirmed'),
          lt(bookings.startsAt, endsAt),
          gt(bookings.endsAt, startsAt),
        ),
      )
      .limit(1);

    if (!clash) {
      out.push({
        kind: 'other-room',
        roomId: candidate.id,
        roomName: candidate.name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
    }
    if (out.length >= 2) break;
  }

  const theRoom = room ?? (await findRoom(roomId));
  if (theRoom) {
    const localDate = formatLocalDate(startsAt, theRoom.timezone);
    const window = businessHoursOn(localDate, theRoom.timezone, theRoom.opensAt, theRoom.closesAt);
    const dayBookings = await db
      .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.roomId, roomId),
          lt(bookings.startsAt, window.endsAt),
          gt(bookings.endsAt, window.startsAt),
        ),
      );

    const gaps = freeGaps(window, dayBookings)
      .filter((g) => g.minutes >= wanted)
      // Nearest to what was actually asked for, first.
      .sort(
        (a, b) =>
          Math.abs(a.startsAt.getTime() - startsAt.getTime()) -
          Math.abs(b.startsAt.getTime() - startsAt.getTime()),
      );

    for (const gap of gaps.slice(0, 2)) {
      out.push({
        kind: 'other-time',
        roomId,
        startsAt: gap.startsAt.toISOString(),
        endsAt: new Date(gap.startsAt.getTime() + wanted * 60_000).toISOString(),
      });
    }
  }

  return out.slice(0, 3);
}

/**
 * Cancel a booking (FR-016..FR-020).
 *
 * Check order is part of the contract: the already-cancelled shortcut comes
 * BEFORE the organiser and ended checks, so a retried or double-clicked
 * cancellation cannot be turned into an error by a booking that has since
 * ended (EC-017).
 */
export async function cancelBooking(
  bookingId: string,
  organiser: string,
  options: { now?: Date } = {},
): Promise<Result<Booking>> {
  const now = options.now ?? new Date();

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return err('BOOKING_NOT_FOUND', 'That booking no longer exists.');

  // EC-017 — idempotent. Must precede the checks below.
  if (booking.status === 'cancelled') return ok(booking);

  // EC-015
  if (booking.organiser.trim() !== organiser.trim()) {
    return err('NOT_ORGANISER', `Only ${booking.organiser} can cancel this booking.`);
  }

  // EC-016 — history is not rewritten.
  if (booking.endsAt <= now) {
    return err('ALREADY_ENDED', 'That meeting has already finished and cannot be cancelled.');
  }

  // The status guard makes a concurrent double-cancel a no-op, not a lost update.
  const [updated] = await db
    .update(bookings)
    .set({ status: 'cancelled' })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'confirmed')))
    .returning();

  return ok(updated ?? booking);
}

/** Does bookings_no_overlap exist? Used by T012 and by the migration runner. */
export async function guaranteeDefinition(): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = 'bookings_no_overlap'
  `);
  const rows = (Array.isArray(result) ? result : result.rows) as { def: string }[];
  return rows.length > 0 ? rows[0].def : null;
}
