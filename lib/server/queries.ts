/**
 * Read-only queries backing the room list and the day schedule.
 *
 * Neither function creates, modifies, or reserves anything. Availability
 * reported here is ADVISORY: it can go stale between the read and the user's
 * click, and that is expected. bookings_no_overlap settles the outcome.
 *
 * Spec: FR-002, FR-003, FR-012..FR-015
 * Contract: specs/001-meeting-room-booker/contracts/list-availability.md
 */

import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { bookings, rooms, type Room } from '@/db/schema';
import { confirmedInOrder, freeGaps, type FreePeriod } from '@/lib/domain/availability';
import { businessHoursOn, formatLocalDate, formatLocalTime, localDayBounds } from '@/lib/time';
import { contains, isPositiveDuration } from '@/lib/domain/interval';

export type RoomAvailability = {
  room: Room;
  /** Bookable: no conflicting booking AND inside this room's own hours. */
  isFree: boolean;
  conflictCount: number;
  /**
   * Why it is not free, when it is not.
   *
   * 'closed' matters: a room with no bookings at 04:30 local has no conflicts,
   * but is still not bookable. Reporting it as free would contradict what
   * createBooking does (OUTSIDE_BUSINESS_HOURS) — the list would invite a
   * click that always fails.
   */
  reason: 'available' | 'booked' | 'closed';
};

/** Active rooms, each flagged free or busy for the requested range (FR-002). */
export async function listAvailability(
  startsAt: Date,
  endsAt: Date,
  minCapacity = 0,
): Promise<RoomAvailability[]> {
  // FR-003 — inactive rooms are never offered for booking.
  const active = await db.select().from(rooms).where(eq(rooms.isActive, true));

  // An invalid range is not an error here; it simply matches nothing. Refusing
  // the BOOKING is createBooking's job (EC-006).
  const valid = isPositiveDuration({ startsAt, endsAt });

  const result: RoomAvailability[] = [];
  for (const room of active) {
    if (room.capacity < minCapacity) continue;

    const clashes = valid
      ? await db
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.roomId, room.id),
              eq(bookings.status, 'confirmed'),
              lt(bookings.startsAt, endsAt),
              gt(bookings.endsAt, startsAt),
            ),
          )
      : [{ id: 'invalid-range' }];

    // Judged in THIS room's timezone, so a room in another office is measured
    // against its own working day (FR-014). This mirrors checkTimeRules, so
    // the list and the booking action always agree.
    const localDate = formatLocalDate(startsAt, room.timezone);
    const window = businessHoursOn(localDate, room.timezone, room.opensAt, room.closesAt);
    const withinHours = valid && contains(window, { startsAt, endsAt });

    const reason = !withinHours ? 'closed' : clashes.length > 0 ? 'booked' : 'available';

    result.push({
      room,
      isFree: reason === 'available',
      conflictCount: clashes.length,
      reason,
    });
  }

  // Free rooms first, then smallest that fits — so an oversized room is not
  // offered ahead of an appropriate one.
  return result.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    return a.room.capacity - b.room.capacity;
  });
}

export type ScheduledBooking = {
  id: string;
  title: string;
  organiser: string;
  startsAt: Date;
  endsAt: Date;
  localStart: string;
  localEnd: string;
};

export type DaySchedule = {
  room: Room;
  timezone: string;
  date: string;
  bookings: ScheduledBooking[];
  gaps: (FreePeriod & { localStart: string; localEnd: string })[];
  businessHours: { localStart: string; localEnd: string };
};

/**
 * One room's day (FR-012..FR-015).
 *
 * `date` is interpreted in the ROOM's timezone, not the viewer's, so two
 * people in different offices see the same day's contents (EC-014, FR-015).
 */
export async function getDaySchedule(roomId: string, date: string): Promise<DaySchedule | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  if (!room) return null;

  const day = localDayBounds(date, room.timezone);

  // Inactive rooms still return their history (FR-003).
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.roomId, roomId),
        lt(bookings.startsAt, day.endsAt),
        gt(bookings.endsAt, day.startsAt),
      ),
    )
    .orderBy(asc(bookings.startsAt));

  const confirmed = confirmedInOrder(rows);
  const window = businessHoursOn(date, room.timezone, room.opensAt, room.closesAt);

  return {
    room,
    timezone: room.timezone,
    date,
    bookings: confirmed.map((b) => ({
      id: b.id,
      title: b.title,
      organiser: b.organiser,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      localStart: formatLocalTime(b.startsAt, room.timezone),
      localEnd: formatLocalTime(b.endsAt, room.timezone),
    })),
    // freeGaps returns one full-window gap for an empty room rather than an
    // empty list, so the UI can distinguish "free all day" from "no data".
    gaps: freeGaps(window, rows).map((g) => ({
      ...g,
      localStart: formatLocalTime(g.startsAt, room.timezone),
      localEnd: formatLocalTime(g.endsAt, room.timezone),
    })),
    businessHours: {
      localStart: room.opensAt.slice(0, 5),
      localEnd: room.closesAt.slice(0, 5),
    },
  };
}

/** Every active room, for pickers. */
export async function listRooms(): Promise<Room[]> {
  return db.select().from(rooms).where(eq(rooms.isActive, true)).orderBy(asc(rooms.name));
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  return room ?? null;
}
