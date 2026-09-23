/**
 * UTC <-> room-local time conversion.
 *
 * Constitution Principle IV: all instants are stored UTC and converted only at
 * the presentation boundary, using the ROOM's timezone — never the server's and
 * never the viewer's.
 *
 * Why the room's zone (EC-014): two people in different offices reading the same
 * schedule must see identical numbers. If rendering followed the viewer, a
 * meeting would appear at different times to different people and "today" would
 * mean different days, making FR-015 ill-defined.
 *
 * Spec: FR-014, FR-015, FR-021 | Edge cases: EC-012, EC-013, EC-014
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Interval } from './domain/interval';

/** "HH:MM" wall-clock time, e.g. the room's opening hour. */
export type WallClock = `${number}:${number}` | string;

/**
 * Resolve a room-local wall-clock date and time to an absolute instant.
 *
 * EC-013 (DST): date-fns-tz resolves a wall-clock time that does not exist
 * (the spring-forward gap) forward to the next valid instant, and a time that
 * occurs twice (the autumn repeat) to its first occurrence. Both behaviours are
 * specified in spec.md rather than left incidental.
 *
 * @param date "YYYY-MM-DD" in the room's local calendar
 * @param time "HH:MM" local wall clock
 * @param timeZone IANA identifier, e.g. "Asia/Kolkata"
 */
export function localToInstant(date: string, time: WallClock, timeZone: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return fromZonedTime(`${date}T${hh}:${mm}:00`, timeZone);
}

/** Render an instant as "HH:mm" in the room's timezone (FR-014). */
export function formatLocalTime(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'HH:mm');
}

/** Render an instant as "YYYY-MM-DD" in the room's timezone. */
export function formatLocalDate(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** Human-readable local date and time with zone abbreviation, for confirmations. */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, "EEE d MMM yyyy 'at' HH:mm (zzz)");
}

/** Which local calendar day does this instant fall on, in the room's zone? (FR-015) */
export function localDayOf(instant: Date, timeZone: string): string {
  return formatLocalDate(instant, timeZone);
}

/**
 * The instant range covering one room-local calendar day: [00:00, next 00:00).
 *
 * Computed by taking the *next* local date rather than adding 24 hours, so DST
 * days that are 23 or 25 hours long are still exactly one day (EC-013).
 */
export function localDayBounds(date: string, timeZone: string): Interval {
  const startsAt = localToInstant(date, '00:00', timeZone);
  const [y, m, d] = date.split('-').map(Number);
  // Date.UTC normalises month/day rollover (e.g. 2026-12-31 -> 2027-01-01).
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDate = next.toISOString().slice(0, 10);
  return { startsAt, endsAt: localToInstant(nextDate, '00:00', timeZone) };
}

/**
 * The bookable window for one room on one local date, as absolute instants.
 *
 * Because opens_at/closes_at are local wall-clock times and closes_at > opens_at
 * is enforced by a CHECK, this window can never cross local midnight — which is
 * what makes EC-012 structurally impossible rather than a runtime check.
 */
export function businessHoursOn(
  date: string,
  timeZone: string,
  opensAt: WallClock,
  closesAt: WallClock,
): Interval {
  return {
    startsAt: localToInstant(date, opensAt, timeZone),
    endsAt: localToInstant(date, closesAt, timeZone),
  };
}

/** The room-local wall clock as a Date whose *fields* read local. Display only. */
export function asZonedDate(instant: Date, timeZone: string): Date {
  return toZonedTime(instant, timeZone);
}
