/**
 * Booking intents — the parsed candidate produced from one free-text sentence.
 *
 * PURE: no I/O, no framework imports (Constitution: domain purity). Everything
 * here is testable without a network, a database, or an API key.
 *
 * A BookingIntent is INERT. It reserves nothing and grants no claim on a room.
 * Converting one into a booking goes through createBooking() like any other
 * input (design.md D5).
 *
 * Spec: openspec/changes/natural-language-booking/specs/.../spec.md
 * Edge cases: EC-019, EC-020, EC-023, EC-024, EC-026
 */

import { z } from 'zod';
import { businessHoursOn, formatLocalDate, localToInstant } from '../time';
import { contains, type Interval } from './interval';

/* ------------------------------------------------------------------ Schema */

/**
 * What the model is allowed to say.
 *
 * This schema IS the blast radius for prompt injection (design.md D4): there is
 * no field in which "ignore your rules" can express itself. Verified against the
 * live model in scripts/probe-groq.ts.
 *
 * Note two deliberate omissions:
 *   - no room ID     — the model reports a NAME FRAGMENT; we resolve it (D1)
 *   - no ISO instant — the model reports date COMPONENTS; we resolve them (D2)
 */
export const BookingIntentSchema = z.object({
  roomHint: z
    .string()
    .describe('Room name exactly as the user referred to it. Empty string if they did not say.'),
  dayExpression: z
    .enum(['today', 'tomorrow', 'weekday', 'absolute', 'unknown'])
    .describe('How the user expressed the day. Do not compute a date.'),
  weekday: z
    .enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'none'])
    .describe('The weekday named, when dayExpression is "weekday". Otherwise "none".'),
  absoluteDate: z
    .string()
    .describe('YYYY-MM-DD when dayExpression is "absolute". Otherwise an empty string.'),
  startTime: z.string().describe('Start as 24-hour HH:MM. Empty string if not stated.'),
  endTime: z.string().describe('End as 24-hour HH:MM. Empty string if not stated.'),
  title: z.string().describe('Meeting title or purpose. Empty string if not stated.'),
  confidence: z.number().describe('0 to 1. How confident you are this is a booking request.'),
});

export type BookingIntent = z.infer<typeof BookingIntentSchema>;

/** JSON Schema for the provider, DERIVED from the Zod schema so the two cannot drift (D3). */
export function intentJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(BookingIntentSchema) as Record<string, unknown>;
  // Groq's strict mode rejects the $schema annotation.
  delete schema.$schema;
  return schema;
}

/* ------------------------------------------------------------- Parser tuning */

export const PARSER = {
  /** Applied when a start is given but no end (EC-024). */
  defaultDurationMinutes: 60,
  /** Below this, a parse is treated as uncertain rather than acted upon. */
  confidenceThreshold: 0.5,
} as const;

/* --------------------------------------------------------------- Room match */

/** The room fields this module needs. Structural, so db/schema is not imported. */
export type RoomLike = {
  id: string;
  name: string;
  timezone: string;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
};

export type RoomMatch =
  | { kind: 'exact'; room: RoomLike }
  | { kind: 'ambiguous'; candidates: RoomLike[] };

/**
 * Resolve a room-name fragment against the real room list (D1).
 *
 * Never invents a room. An unmatched or absent hint yields `ambiguous` with the
 * bookable rooms to choose from, because the spec requires ambiguity to be
 * SURFACED rather than guessed — offering a choice is more useful than refusing,
 * and both are honest.
 */
export function resolveRoomHint(fragment: string, rooms: RoomLike[]): RoomMatch {
  const bookable = rooms.filter((r) => r.isActive);
  const needle = fragment.trim().toLowerCase();

  if (needle.length > 0) {
    const exact = bookable.filter((r) => r.name.toLowerCase() === needle);
    if (exact.length === 1) return { kind: 'exact', room: exact[0] };

    const partial = bookable.filter(
      (r) => r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase()),
    );
    if (partial.length === 1) return { kind: 'exact', room: partial[0] };
    // EC-019 — several plausible matches, so ask.
    if (partial.length > 1) return { kind: 'ambiguous', candidates: partial };
  }

  // No hint, or a hint matching nothing: offer everything bookable.
  return { kind: 'ambiguous', candidates: bookable };
}

/* ------------------------------------------------------------- Confidence */

export type ConfidenceBand = 'confident' | 'uncertain';

export function bandConfidence(confidence: number): ConfidenceBand {
  return confidence >= PARSER.confidenceThreshold ? 'confident' : 'uncertain';
}

/* ------------------------------------------------------------------ Timing */

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Resolve the intent's day expression to a calendar date in the ROOM's timezone (D2, EC-023).
 *
 * The model never computes this. It reports what the user said; the same code
 * that already handles DST everywhere else turns it into a date.
 */
export function resolveIntentDate(
  intent: BookingIntent,
  timeZone: string,
  now: Date,
): string | null {
  const todayLocal = formatLocalDate(now, timeZone);

  switch (intent.dayExpression) {
    case 'today':
      return todayLocal;

    case 'tomorrow':
      return addLocalDays(todayLocal, 1);

    case 'absolute':
      return /^\d{4}-\d{2}-\d{2}$/.test(intent.absoluteDate) ? intent.absoluteDate : null;

    case 'weekday': {
      const target = WEEKDAY_INDEX[intent.weekday];
      if (target === undefined) return null;
      // Walk forward from today to the next occurrence, 1..7 days out, so
      // "Tuesday" said on a Tuesday means next Tuesday rather than today.
      for (let offset = 1; offset <= 7; offset += 1) {
        const candidate = addLocalDays(todayLocal, offset);
        if (localDayOfWeek(candidate) === target) return candidate;
      }
      return null;
    }

    default:
      return null;
  }
}

/** Add whole days to a YYYY-MM-DD string via UTC arithmetic — no timezone involved. */
function addLocalDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function localDayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type ResolvedTiming = {
  interval: Interval;
  /** True when no end time was stated and the default duration was applied (EC-024). */
  durationAssumed: boolean;
  withinBusinessHours: boolean;
};

/**
 * Turn an intent's date and clock times into absolute instants in the room's zone.
 *
 * Returns null when there is not enough to work with — a missing START is fatal;
 * a missing END is not (EC-024).
 */
export function resolveIntentTiming(
  intent: BookingIntent,
  room: RoomLike,
  now: Date,
): ResolvedTiming | null {
  const date = resolveIntentDate(intent, room.timezone, now);
  if (!date) return null;
  if (!isClock(intent.startTime)) return null;

  const startsAt = localToInstant(date, intent.startTime, room.timezone);

  let endsAt: Date;
  let durationAssumed = false;
  if (isClock(intent.endTime)) {
    endsAt = localToInstant(date, intent.endTime, room.timezone);
  } else {
    // EC-024 — assumed, and the caller must say so.
    endsAt = new Date(startsAt.getTime() + PARSER.defaultDurationMinutes * 60_000);
    durationAssumed = true;
  }

  const window = businessHoursOn(date, room.timezone, room.opensAt, room.closesAt);
  return {
    interval: { startsAt, endsAt },
    durationAssumed,
    withinBusinessHours: contains(window, { startsAt, endsAt }),
  };
}

function isClock(value: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(value.trim());
}

/* ------------------------------------------------------------ Parse result */

/** A candidate the user can review. Still inert — nothing is reserved (D5). */
export type BookingCandidate = {
  room: RoomLike;
  startsAt: string;
  endsAt: string;
  localStart: string;
  localEnd: string;
  date: string;
  title: string;
  timezone: string;
  durationAssumed: boolean;
  confidence: ConfidenceBand;
};

export type ParseOutcome =
  | { kind: 'candidate'; candidate: BookingCandidate }
  | { kind: 'ambiguous-room'; candidates: RoomLike[]; intent: BookingIntent }
  | { kind: 'unparseable'; reason: string }
  | { kind: 'unavailable'; reason: string };
