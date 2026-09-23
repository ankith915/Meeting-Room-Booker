import { describe, it, expect } from 'vitest';
import {
  BookingIntentSchema, intentJsonSchema, resolveRoomHint, bandConfidence,
  resolveIntentDate, resolveIntentTiming, PARSER,
  type BookingIntent, type RoomLike,
} from '@/lib/domain/intent';
import { formatLocalTime, formatLocalDate } from '@/lib/time';
import { durationMinutes } from '@/lib/domain/interval';

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

const room = (over: Partial<RoomLike> = {}): RoomLike => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Aurora',
  timezone: KOLKATA,
  opensAt: '08:00',
  closesAt: '18:00',
  isActive: true,
  ...over,
});

const ROOMS: RoomLike[] = [
  room(),
  room({ id: '2', name: 'Borealis' }),
  room({ id: '3', name: 'Meridian', timezone: NEW_YORK }),
  room({ id: '4', name: 'Boardroom' }),
  room({ id: '5', name: 'Halcyon', isActive: false }),
];

const intent = (over: Partial<BookingIntent> = {}): BookingIntent => ({
  roomHint: 'Aurora',
  dayExpression: 'tomorrow',
  weekday: 'none',
  absoluteDate: '',
  startTime: '14:00',
  endTime: '15:00',
  title: 'Design review',
  confidence: 0.9,
  ...over,
});

describe('BookingIntentSchema — the blast radius (D4)', () => {
  it('accepts a well-formed intent', () => {
    expect(BookingIntentSchema.safeParse(intent()).success).toBe(true);
  });

  it('has no field in which an instruction could be expressed', () => {
    // EC-026 is defended structurally: the schema admits only booking details.
    const keys = Object.keys(BookingIntentSchema.shape).sort();
    expect(keys).toEqual([
      'absoluteDate', 'confidence', 'dayExpression', 'endTime',
      'roomHint', 'startTime', 'title', 'weekday',
    ]);
  });

  it('exposes no room identifier field (D1)', () => {
    expect(Object.keys(BookingIntentSchema.shape)).not.toContain('roomId');
  });

  it('exposes no computed-instant field (D2)', () => {
    const keys = Object.keys(BookingIntentSchema.shape);
    expect(keys).not.toContain('startsAt');
    expect(keys).not.toContain('endsAt');
  });

  it('rejects a response with the wrong shape', () => {
    expect(BookingIntentSchema.safeParse({ roomHint: 'Aurora' }).success).toBe(false);
  });
});

describe('intentJsonSchema() — derived, not duplicated (D3)', () => {
  it('emits strict-mode-compatible JSON Schema', () => {
    const schema = intentJsonSchema();
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$schema).toBeUndefined();
  });

  it('requires every field the Zod schema requires', () => {
    const schema = intentJsonSchema();
    expect((schema.required as string[]).sort()).toEqual(
      Object.keys(BookingIntentSchema.shape).sort(),
    );
  });
});

describe('resolveRoomHint() (D1)', () => {
  it('matches an exact name', () => {
    const match = resolveRoomHint('Aurora', ROOMS);
    expect(match.kind).toBe('exact');
    if (match.kind === 'exact') expect(match.room.name).toBe('Aurora');
  });

  it('matches case-insensitively', () => {
    const match = resolveRoomHint('aURORa', ROOMS);
    expect(match.kind).toBe('exact');
  });

  it('matches a unique partial fragment', () => {
    const match = resolveRoomHint('merid', ROOMS);
    expect(match.kind).toBe('exact');
    if (match.kind === 'exact') expect(match.room.name).toBe('Meridian');
  });

  it('EC-019: a fragment matching several rooms is ambiguous, not a guess', () => {
    // "Bo" matches both Borealis and Boardroom.
    const match = resolveRoomHint('Bo', ROOMS);
    expect(match.kind).toBe('ambiguous');
    if (match.kind === 'ambiguous') {
      expect(match.candidates.map((r) => r.name).sort()).toEqual(['Boardroom', 'Borealis']);
    }
  });

  it('EC-019: an unmatched fragment offers the bookable rooms rather than refusing', () => {
    const match = resolveRoomHint('the big room', ROOMS);
    expect(match.kind).toBe('ambiguous');
    if (match.kind === 'ambiguous') expect(match.candidates.length).toBeGreaterThan(1);
  });

  it('EC-019: an empty hint offers the bookable rooms', () => {
    const match = resolveRoomHint('', ROOMS);
    expect(match.kind).toBe('ambiguous');
  });

  it('never offers an inactive room (EC-008)', () => {
    const match = resolveRoomHint('', ROOMS);
    if (match.kind === 'ambiguous') {
      expect(match.candidates.map((r) => r.name)).not.toContain('Halcyon');
    }
  });

  it('never resolves to an inactive room even on an exact name', () => {
    const match = resolveRoomHint('Halcyon', ROOMS);
    expect(match.kind).toBe('ambiguous');
  });
});

describe('bandConfidence()', () => {
  it('bands a high-confidence parse as confident', () => {
    expect(bandConfidence(0.9)).toBe('confident');
  });
  it('bands a low-confidence parse as uncertain', () => {
    expect(bandConfidence(0.1)).toBe('uncertain');
  });
  it('treats the threshold itself as confident', () => {
    expect(bandConfidence(PARSER.confidenceThreshold)).toBe('confident');
  });
});

describe('resolveIntentDate() (D2)', () => {
  // 2026-09-24T03:00Z is 08:30 in Kolkata, 23:00 on the 23rd in New York.
  const NOW = new Date('2026-09-24T03:00:00.000Z');

  it('resolves "today" in the room timezone', () => {
    expect(resolveIntentDate(intent({ dayExpression: 'today' }), KOLKATA, NOW)).toBe('2026-09-24');
  });

  it('resolves "tomorrow" in the room timezone', () => {
    expect(resolveIntentDate(intent({ dayExpression: 'tomorrow' }), KOLKATA, NOW))
      .toBe('2026-09-25');
  });

  it('EC-023: the SAME instant yields a different date for a room in another zone', () => {
    // It is already the 24th in Kolkata but still the 23rd in New York.
    expect(resolveIntentDate(intent({ dayExpression: 'today' }), KOLKATA, NOW)).toBe('2026-09-24');
    expect(resolveIntentDate(intent({ dayExpression: 'today' }), NEW_YORK, NOW)).toBe('2026-09-23');
  });

  it('EC-023: "tomorrow" likewise follows the room, not the viewer', () => {
    expect(resolveIntentDate(intent({ dayExpression: 'tomorrow' }), NEW_YORK, NOW))
      .toBe('2026-09-24');
  });

  it('resolves an absolute date', () => {
    const i = intent({ dayExpression: 'absolute', absoluteDate: '2026-10-05' });
    expect(resolveIntentDate(i, KOLKATA, NOW)).toBe('2026-10-05');
  });

  it('rejects a malformed absolute date rather than guessing', () => {
    const i = intent({ dayExpression: 'absolute', absoluteDate: 'next October' });
    expect(resolveIntentDate(i, KOLKATA, NOW)).toBeNull();
  });

  it('resolves a named weekday to the NEXT such day', () => {
    // 2026-09-24 is a Thursday, so "friday" is the 25th.
    const i = intent({ dayExpression: 'weekday', weekday: 'friday' });
    expect(resolveIntentDate(i, KOLKATA, NOW)).toBe('2026-09-25');
  });

  it('a weekday naming today resolves to next week, not today', () => {
    const i = intent({ dayExpression: 'weekday', weekday: 'thursday' });
    expect(resolveIntentDate(i, KOLKATA, NOW)).toBe('2026-10-01');
  });

  it('returns null for an unknown day expression', () => {
    expect(resolveIntentDate(intent({ dayExpression: 'unknown' }), KOLKATA, NOW)).toBeNull();
  });

  it('crosses a month boundary correctly', () => {
    const endOfMonth = new Date('2026-09-30T06:00:00.000Z');
    expect(resolveIntentDate(intent({ dayExpression: 'tomorrow' }), KOLKATA, endOfMonth))
      .toBe('2026-10-01');
  });
});

describe('resolveIntentTiming()', () => {
  const NOW = new Date('2026-09-24T03:00:00.000Z');

  it('resolves a complete intent to instants in the room zone', () => {
    const timing = resolveIntentTiming(intent(), room(), NOW);
    expect(timing).not.toBeNull();
    if (!timing) return;
    expect(formatLocalTime(timing.interval.startsAt, KOLKATA)).toBe('14:00');
    expect(formatLocalTime(timing.interval.endsAt, KOLKATA)).toBe('15:00');
    expect(formatLocalDate(timing.interval.startsAt, KOLKATA)).toBe('2026-09-25');
    expect(timing.withinBusinessHours).toBe(true);
  });

  it('EC-024: a missing end time applies the default and flags it', () => {
    const timing = resolveIntentTiming(intent({ endTime: '' }), room(), NOW);
    expect(timing).not.toBeNull();
    if (!timing) return;
    expect(timing.durationAssumed).toBe(true);
    expect(durationMinutes(timing.interval)).toBe(PARSER.defaultDurationMinutes);
  });

  it('EC-024: a stated end time is not flagged as assumed', () => {
    const timing = resolveIntentTiming(intent(), room(), NOW);
    expect(timing?.durationAssumed).toBe(false);
  });

  it('returns null when no start time was stated', () => {
    expect(resolveIntentTiming(intent({ startTime: '' }), room(), NOW)).toBeNull();
  });

  it('returns null when the day could not be resolved', () => {
    expect(resolveIntentTiming(intent({ dayExpression: 'unknown' }), room(), NOW)).toBeNull();
  });

  it('flags a range outside the room business hours without rejecting it', () => {
    // Reporting rather than refusing: createBooking owns the refusal (EC-009).
    const timing = resolveIntentTiming(
      intent({ startTime: '06:00', endTime: '07:00' }), room(), NOW,
    );
    expect(timing?.withinBusinessHours).toBe(false);
  });

  it('EC-023: the same clock time resolves to different instants per room zone', () => {
    const inKolkata = resolveIntentTiming(intent(), room(), NOW);
    const inNewYork = resolveIntentTiming(intent(), room({ timezone: NEW_YORK }), NOW);
    expect(inKolkata!.interval.startsAt.getTime())
      .not.toBe(inNewYork!.interval.startsAt.getTime());
    // Each still reads 14:00 in its OWN zone.
    expect(formatLocalTime(inKolkata!.interval.startsAt, KOLKATA)).toBe('14:00');
    expect(formatLocalTime(inNewYork!.interval.startsAt, NEW_YORK)).toBe('14:00');
  });

  it('stays exact across a DST transition', () => {
    // 2026-03-08 is the US spring-forward date; 14:00-15:00 does not span it,
    // so elapsed real time is still 60 minutes.
    const beforeDst = new Date('2026-03-07T12:00:00.000Z');
    const timing = resolveIntentTiming(
      intent({ dayExpression: 'tomorrow' }), room({ timezone: NEW_YORK }), beforeDst,
    );
    expect(timing).not.toBeNull();
    expect(formatLocalDate(timing!.interval.startsAt, NEW_YORK)).toBe('2026-03-08');
    expect(durationMinutes(timing!.interval)).toBe(60);
  });
});
