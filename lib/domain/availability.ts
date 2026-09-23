/**
 * Availability and free-gap computation.
 *
 * PURE: no I/O, no framework imports (Constitution: domain purity). Callers
 * fetch rows; this module only decides what they mean.
 *
 * NOTE ON AUTHORITY: isAvailable() is ADVISORY ONLY. It can go stale between
 * the read and the user's click, and that is expected and acceptable. The
 * bookings_no_overlap constraint is what actually settles whether a booking
 * happens (Constitution I). Never treat a true result here as permission.
 *
 * Spec: FR-002, FR-013 | Edge cases: EC-002, EC-003, EC-005
 */

import { overlaps, subtractIntervals, byStart, durationMinutes, type Interval } from './interval';

/** The subset of a booking this module needs. Deliberately not the DB row type. */
export type BusyBooking = Interval & { status: 'confirmed' | 'cancelled' };

/** A free period, with its length precomputed for the UI. */
export type FreePeriod = Interval & { minutes: number };

/**
 * Only confirmed bookings reserve time (EC-005).
 *
 * Mirrors the constraint's `WHERE (status = 'confirmed')` clause. If this
 * filter and that clause ever disagree, the UI will show a slot as busy that
 * the database will happily let someone book, or vice versa.
 */
export function reservesTime(booking: BusyBooking): boolean {
  return booking.status === 'confirmed';
}

/**
 * Is `candidate` free of confirmed conflicts on this room? (FR-002)
 *
 * `bookings` must already be scoped to ONE room — the conflict rule is per
 * room (EC-004), and this function has no room identity to check with.
 */
export function isAvailable(candidate: Interval, bookings: BusyBooking[]): boolean {
  return !bookings.filter(reservesTime).some((b) => overlaps(b, candidate));
}

/** Every confirmed booking on this room that overlaps the candidate range. */
export function conflictsWith(candidate: Interval, bookings: BusyBooking[]): BusyBooking[] {
  return bookings.filter(reservesTime).filter((b) => overlaps(b, candidate));
}

/**
 * The free periods within a bookable window (FR-013).
 *
 * An unbooked room yields ONE gap spanning the whole window, never an empty
 * list — so the UI can tell "free all day" apart from "no data"
 * (US2 acceptance scenario 3).
 */
export function freeGaps(window: Interval, bookings: BusyBooking[]): FreePeriod[] {
  return subtractIntervals(window, bookings.filter(reservesTime)).map((gap) => ({
    ...gap,
    minutes: durationMinutes(gap),
  }));
}

/**
 * Free periods long enough to actually book.
 *
 * Shorter gaps are still returned by freeGaps() so the UI can show them greyed
 * rather than pretending they do not exist; this is the filter for "where
 * could this meeting go".
 */
export function bookableGaps(
  window: Interval,
  bookings: BusyBooking[],
  minimumMinutes: number,
): FreePeriod[] {
  return freeGaps(window, bookings).filter((gap) => gap.minutes >= minimumMinutes);
}

/** Confirmed bookings in chronological order (FR-012). */
export function confirmedInOrder<T extends BusyBooking>(bookings: T[]): T[] {
  return bookings.filter(reservesTime).slice().sort(byStart);
}
