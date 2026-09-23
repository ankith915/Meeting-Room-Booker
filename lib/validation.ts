/**
 * Input validation for booking requests.
 *
 * Constitution V: every refusal carries a typed code AND a message naming the
 * specific limit that was exceeded — never a generic "invalid input".
 *
 * IMPORTANT — these checks are USER EXPERIENCE, not safety. They exist so the
 * user gets fast, specific feedback. The correctness guarantee lives in
 * bookings_no_overlap. Deleting this entire file must not make EC-001..EC-005
 * possible; SC-003 is the test that proves it.
 *
 * Spec: FR-008 | Edge cases: EC-006..EC-012, EC-018
 */

import { z } from 'zod';
import { contains, durationMinutes, isPositiveDuration, type Interval } from './domain/interval';
import { businessHoursOn, formatLocalDate, formatLocalTime } from './time';
import { err, ok, type Result } from './domain/errors';

/** Booking policy limits. Defaults trace to the spec's stated assumptions. */
export const POLICY = {
  minimumMinutes: 15,   // A-003
  maximumMinutes: 480,  // A-003 — 8 hours
  horizonDays: 90,      // A-009
  titleMaxLength: 200,  // EC-011
} as const;

/**
 * Shape-level validation (EC-006, EC-011).
 *
 * Only what can be judged from the request alone. Anything needing the room
 * (its timezone, its hours, whether it exists) is checked later, because this
 * layer has no room to consult.
 */
export const createBookingSchema = z
  .object({
    roomId: z.string().uuid({ message: 'Room id must be a UUID.' }),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    title: z
      .string()
      .trim()
      .min(1, { message: 'A meeting title is required.' })
      .max(POLICY.titleMaxLength, {
        message: `A meeting title may be at most ${POLICY.titleMaxLength} characters.`,
      }),
    organiser: z.string().trim().min(1, { message: 'An organiser name is required.' }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    // EC-006. Strict >, so a zero-length booking is rejected here rather than
    // reaching the database, where it would overlap nothing and reserve a slot
    // nobody could see.
    message: 'The end time must be after the start time.',
    path: ['endsAt'],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/** What the time-rule checks need to know about the room. */
export type RoomPolicy = {
  timezone: string;
  opensAt: string;
  closesAt: string;
};

/**
 * Time rules that need the room's timezone and hours.
 *
 * Order is part of the contract (contracts/create-booking.md): a request
 * failing several checks reports the FIRST below, so the same input always
 * produces the same error rather than one that depends on evaluation order.
 */
export function checkTimeRules(
  interval: Interval,
  room: RoomPolicy,
  now: Date = new Date(),
): Result<Interval> {
  // EC-006 again — defensive. checkTimeRules is exported and could be called
  // from a path that did not run the Zod schema first.
  if (!isPositiveDuration(interval)) {
    return err('INVALID_RANGE', 'The end time must be after the start time.');
  }

  // EC-007
  if (interval.startsAt < now) {
    return err(
      'PAST_BOOKING',
      `That start time has already passed. It is currently ${formatLocalTime(now, room.timezone)}.`,
    );
  }

  // EC-018 — A-009's horizon, enforced rather than merely assumed.
  const horizon = new Date(now.getTime() + POLICY.horizonDays * 24 * 60 * 60 * 1000);
  if (interval.startsAt > horizon) {
    return err(
      'TOO_FAR_AHEAD',
      `Bookings can be made at most ${POLICY.horizonDays} days ahead.`,
    );
  }

  // EC-010 — message names the actual limit, per Constitution V.
  const minutes = durationMinutes(interval);
  if (minutes < POLICY.minimumMinutes) {
    return err('DURATION_EXCEEDED', `The shortest booking is ${POLICY.minimumMinutes} minutes.`);
  }
  if (minutes > POLICY.maximumMinutes) {
    return err(
      'DURATION_EXCEEDED',
      `The longest booking is ${POLICY.maximumMinutes / 60} hours; this one is ` +
        `${(minutes / 60).toFixed(1)} hours.`,
    );
  }

  // EC-009 and EC-012. The window is resolved on the START's local date, and
  // rooms_hours_ordered guarantees it cannot cross local midnight — so a range
  // spanning midnight fails containment here rather than needing its own rule.
  const localDate = formatLocalDate(interval.startsAt, room.timezone);
  const window = businessHoursOn(localDate, room.timezone, room.opensAt, room.closesAt);
  if (!contains(window, interval)) {
    return err(
      'OUTSIDE_BUSINESS_HOURS',
      `This room can be booked between ${room.opensAt.slice(0, 5)} and ` +
        `${room.closesAt.slice(0, 5)} (${room.timezone}).`,
    );
  }

  return ok(interval);
}

/** Turn a Zod failure into a typed BookingError (EC-006, EC-011). */
export function toBookingError(issues: z.ZodIssue[]): Result<never> {
  const first = issues[0];
  const path = first?.path.join('.') ?? '';
  const message = first?.message ?? 'The booking request was not valid.';

  // endsAt failures are range problems; everything else on title is a title
  // problem. Mapping explicitly keeps codes stable as the schema evolves.
  if (path === 'endsAt' || path === 'startsAt') return err('INVALID_RANGE', message);
  if (path === 'title') return err('INVALID_TITLE', message);
  return err('INVALID_TITLE', message);
}
