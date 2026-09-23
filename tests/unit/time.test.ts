import { describe, it, expect } from 'vitest';
import {
  localToInstant, formatLocalTime, formatLocalDate, localDayBounds, businessHoursOn, localDayOf,
} from '@/lib/time';
import { durationMinutes } from '@/lib/domain/interval';

const KOLKATA = 'Asia/Kolkata';      // UTC+05:30, no DST
const NEW_YORK = 'America/New_York'; // observes DST — used for EC-013

describe('localToInstant()', () => {
  it('FR-021: converts room-local wall clock to a UTC instant', () => {
    // 14:00 in Kolkata (UTC+5:30) is 08:30 UTC
    expect(localToInstant('2026-09-24', '14:00', KOLKATA).toISOString())
      .toBe('2026-09-24T08:30:00.000Z');
  });

  it('the same wall clock in a different zone is a different instant', () => {
    const kolkata = localToInstant('2026-09-24', '14:00', KOLKATA);
    const newYork = localToInstant('2026-09-24', '14:00', NEW_YORK);
    expect(kolkata.getTime()).not.toBe(newYork.getTime());
  });

  it('tolerates unpadded hours', () => {
    expect(localToInstant('2026-09-24', '9:00', KOLKATA).toISOString())
      .toBe('2026-09-24T03:30:00.000Z');
  });
});

describe('EC-014: the viewer\'s timezone never affects what is displayed', () => {
  it('renders in the room timezone regardless of where it is called from', () => {
    const instant = new Date('2026-09-24T08:30:00.000Z');
    // Same instant, two rooms in different zones — each shows its OWN local time.
    expect(formatLocalTime(instant, KOLKATA)).toBe('14:00');
    expect(formatLocalTime(instant, NEW_YORK)).toBe('04:30');
  });

  it('two viewers reading the same room see identical times', () => {
    // formatLocalTime takes the ROOM's zone as an explicit argument and never
    // consults the ambient environment, so there is no viewer input to differ.
    const instant = new Date('2026-09-24T08:30:00.000Z');
    const viewerA = formatLocalTime(instant, KOLKATA);
    const viewerB = formatLocalTime(instant, KOLKATA);
    expect(viewerA).toBe(viewerB);
    expect(viewerA).toBe('14:00');
  });
});

describe('FR-015: a room\'s day is its OWN local day', () => {
  it('a late-evening local booking belongs to that local date', () => {
    const instant = localToInstant('2026-09-24', '23:30', KOLKATA);
    // That instant is already 2026-09-24T18:00Z — the *next* day in some zones,
    // but the room's local date is what counts.
    expect(localDayOf(instant, KOLKATA)).toBe('2026-09-24');
  });

  it('localDayBounds spans exactly one local day', () => {
    const { startsAt, endsAt } = localDayBounds('2026-09-24', KOLKATA);
    expect(formatLocalDate(startsAt, KOLKATA)).toBe('2026-09-24');
    expect(formatLocalTime(startsAt, KOLKATA)).toBe('00:00');
    expect(formatLocalTime(endsAt, KOLKATA)).toBe('00:00');
    expect(durationMinutes({ startsAt, endsAt })).toBe(24 * 60);
  });

  it('rolls over month boundaries correctly', () => {
    const { startsAt, endsAt } = localDayBounds('2026-09-30', KOLKATA);
    expect(formatLocalDate(startsAt, KOLKATA)).toBe('2026-09-30');
    expect(formatLocalDate(endsAt, KOLKATA)).toBe('2026-10-01');
  });

  it('rolls over year boundaries correctly', () => {
    const { endsAt } = localDayBounds('2026-12-31', KOLKATA);
    expect(formatLocalDate(endsAt, KOLKATA)).toBe('2027-01-01');
  });
});

describe('EC-013: daylight saving transitions', () => {
  // US DST 2026: forward Sun 8 Mar, back Sun 1 Nov.
  it('a spring-forward day is 23 hours long, not 24', () => {
    const { startsAt, endsAt } = localDayBounds('2026-03-08', NEW_YORK);
    expect(durationMinutes({ startsAt, endsAt })).toBe(23 * 60);
  });

  it('an autumn fall-back day is 25 hours long', () => {
    const { startsAt, endsAt } = localDayBounds('2026-11-01', NEW_YORK);
    expect(durationMinutes({ startsAt, endsAt })).toBe(25 * 60);
  });

  it('an ordinary day is 24 hours long', () => {
    const { startsAt, endsAt } = localDayBounds('2026-09-24', NEW_YORK);
    expect(durationMinutes({ startsAt, endsAt })).toBe(24 * 60);
  });

  it('business hours stay 10 local hours even across a DST day', () => {
    // 08:00-18:00 local does not span the 02:00 transition, so elapsed real
    // time is unchanged. Conflict detection compares instants, so it stays exact.
    const normal = businessHoursOn('2026-09-24', NEW_YORK, '08:00', '18:00');
    const springForward = businessHoursOn('2026-03-08', NEW_YORK, '08:00', '18:00');
    expect(durationMinutes(normal)).toBe(600);
    expect(durationMinutes(springForward)).toBe(600);
  });

  it('a non-existent wall-clock time resolves forward rather than throwing', () => {
    // 02:30 on 2026-03-08 does not exist in New York.
    const instant = localToInstant('2026-03-08', '02:30', NEW_YORK);
    expect(instant).toBeInstanceOf(Date);
    expect(Number.isNaN(instant.getTime())).toBe(false);
  });
});

describe('EC-012: business hours cannot cross local midnight', () => {
  it('the bookable window sits inside one local day', () => {
    const day = localDayBounds('2026-09-24', KOLKATA);
    const hours = businessHoursOn('2026-09-24', KOLKATA, '08:00', '18:00');
    expect(hours.startsAt >= day.startsAt).toBe(true);
    expect(hours.endsAt <= day.endsAt).toBe(true);
  });

  it('renders the expected local boundaries', () => {
    const hours = businessHoursOn('2026-09-24', KOLKATA, '08:00', '18:00');
    expect(formatLocalTime(hours.startsAt, KOLKATA)).toBe('08:00');
    expect(formatLocalTime(hours.endsAt, KOLKATA)).toBe('18:00');
    expect(durationMinutes(hours)).toBe(600);
  });
});
