/**
 * Half-open time intervals.
 *
 * A booking covers [startsAt, endsAt) — start INCLUSIVE, end EXCLUSIVE.
 * So 09:00-10:00 and 10:00-11:00 do NOT conflict (EC-003).
 *
 * This rule is stated in three places and must agree in all three:
 *   1. the schema  — tstzrange(starts_at, ends_at, '[)')
 *   2. here        — strict < comparisons below
 *   3. the UI      — end rendered as exclusive
 *
 * PURE: no I/O, no framework imports (Constitution: domain purity).
 *
 * Spec: FR-005 | Edge cases: EC-002, EC-003, EC-006
 */

export type Interval = { startsAt: Date; endsAt: Date };

/** Milliseconds in a minute — used to keep duration arithmetic readable. */
const MS_PER_MINUTE = 60_000;

/**
 * Do two intervals overlap?
 *
 *   a: |-------|
 *   b:     |-------|     -> true  (partial overlap, EC-002)
 *
 *   a: |-------|
 *   b:         |-----|   -> false (adjacent, EC-003)
 *
 * Both comparisons are STRICT. Using <= on either side would make adjacent
 * bookings conflict, contradicting EC-003 and the schema's '[)' bounds.
 *
 * Mirrors the SQL `&&` operator on tstzrange with '[)' bounds exactly.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

/** Is this a well-formed, non-empty interval? A zero-length range is not (EC-006). */
export function isPositiveDuration(interval: Interval): boolean {
  return interval.endsAt > interval.startsAt;
}

/** Length in whole minutes. Assumes a positive duration. */
export function durationMinutes(interval: Interval): number {
  return Math.round((interval.endsAt.getTime() - interval.startsAt.getTime()) / MS_PER_MINUTE);
}

/** Does `inner` fall entirely within `outer`? Used for business-hours checks (EC-009). */
export function contains(outer: Interval, inner: Interval): boolean {
  return inner.startsAt >= outer.startsAt && inner.endsAt <= outer.endsAt;
}

/** Chronological comparator, for sorting a day's bookings (FR-012). */
export function byStart(a: Interval, b: Interval): number {
  return a.startsAt.getTime() - b.startsAt.getTime();
}

/**
 * Subtract a set of busy intervals from one window, returning what is left.
 *
 * This is the engine behind freeGaps() (FR-013). `busy` need not be sorted and
 * may contain overlaps; both are normalised here so callers cannot get it wrong.
 *
 * An empty `busy` yields the whole window — never an empty list, so the UI can
 * tell "free all day" apart from "no data" (US2 acceptance scenario 3).
 */
export function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  if (!isPositiveDuration(window)) return [];

  // Clip to the window, drop anything that misses it, then sort.
  const clipped = busy
    .filter((b) => overlaps(b, window))
    .map((b) => ({
      startsAt: b.startsAt < window.startsAt ? window.startsAt : b.startsAt,
      endsAt: b.endsAt > window.endsAt ? window.endsAt : b.endsAt,
    }))
    .sort(byStart);

  // Merge touching or overlapping busy blocks so gaps between them are real.
  const merged: Interval[] = [];
  for (const block of clipped) {
    const last = merged[merged.length - 1];
    if (last && block.startsAt <= last.endsAt) {
      if (block.endsAt > last.endsAt) last.endsAt = block.endsAt;
    } else {
      merged.push({ ...block });
    }
  }

  // Whatever the merged blocks do not cover is free.
  const gaps: Interval[] = [];
  let cursor = window.startsAt;
  for (const block of merged) {
    if (block.startsAt > cursor) gaps.push({ startsAt: cursor, endsAt: block.startsAt });
    if (block.endsAt > cursor) cursor = block.endsAt;
  }
  if (cursor < window.endsAt) gaps.push({ startsAt: cursor, endsAt: window.endsAt });

  return gaps;
}
