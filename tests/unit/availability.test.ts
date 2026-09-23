import { describe, it, expect } from 'vitest';
import {
  isAvailable, conflictsWith, freeGaps, bookableGaps, confirmedInOrder, reservesTime,
  type BusyBooking,
} from '@/lib/domain/availability';
import type { Interval } from '@/lib/domain/interval';

const iv = (start: string, end: string): Interval => ({
  startsAt: new Date(`2026-09-24T${start}:00.000Z`),
  endsAt: new Date(`2026-09-24T${end}:00.000Z`),
});

const confirmed = (start: string, end: string): BusyBooking =>
  ({ ...iv(start, end), status: 'confirmed' });
const cancelled = (start: string, end: string): BusyBooking =>
  ({ ...iv(start, end), status: 'cancelled' });

const businessHours = iv('08:00', '18:00');

describe('reservesTime() — mirrors the constraint\'s WHERE clause', () => {
  it('EC-005: only confirmed bookings reserve time', () => {
    expect(reservesTime(confirmed('14:00', '15:00'))).toBe(true);
    expect(reservesTime(cancelled('14:00', '15:00'))).toBe(false);
  });
});

describe('isAvailable() (FR-002)', () => {
  it('an empty room is available', () => {
    expect(isAvailable(iv('14:00', '15:00'), [])).toBe(true);
  });

  it('EC-002: a partial overlap makes it unavailable', () => {
    expect(isAvailable(iv('14:30', '15:30'), [confirmed('14:00', '15:00')])).toBe(false);
  });

  it('EC-003: an adjacent booking leaves it available', () => {
    expect(isAvailable(iv('15:00', '16:00'), [confirmed('14:00', '15:00')])).toBe(true);
  });

  it('EC-005: a cancelled booking does NOT make it unavailable', () => {
    expect(isAvailable(iv('14:00', '15:00'), [cancelled('14:00', '15:00')])).toBe(true);
  });

  it('EC-005: a cancelled booking alongside a confirmed one is still ignored', () => {
    const bookings = [cancelled('14:00', '15:00'), confirmed('09:00', '10:00')];
    expect(isAvailable(iv('14:00', '15:00'), bookings)).toBe(true);
    expect(isAvailable(iv('09:00', '10:00'), bookings)).toBe(false);
  });
});

describe('conflictsWith()', () => {
  it('FR-009: returns the confirmed booking that holds the slot', () => {
    const holder = confirmed('14:00', '15:00');
    const found = conflictsWith(iv('14:30', '15:30'), [holder, cancelled('14:00', '15:00')]);
    expect(found).toEqual([holder]);
  });

  it('returns nothing when the range is free', () => {
    expect(conflictsWith(iv('16:00', '17:00'), [confirmed('14:00', '15:00')])).toEqual([]);
  });
});

describe('freeGaps() (FR-013)', () => {
  it('US2-3: an unbooked room yields one gap covering business hours', () => {
    const gaps = freeGaps(businessHours, []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].minutes).toBe(600);
  });

  it('FR-013: finds the 10:00-14:00 gap between two bookings', () => {
    const gaps = freeGaps(businessHours, [confirmed('09:00', '10:00'), confirmed('14:00', '15:00')]);
    expect(gaps.map((g) => [g.startsAt.toISOString(), g.endsAt.toISOString()])).toEqual([
      ['2026-09-24T08:00:00.000Z', '2026-09-24T09:00:00.000Z'],
      ['2026-09-24T10:00:00.000Z', '2026-09-24T14:00:00.000Z'],
      ['2026-09-24T15:00:00.000Z', '2026-09-24T18:00:00.000Z'],
    ]);
    expect(gaps[1].minutes).toBe(240);
  });

  it('EC-005: a cancelled booking leaves its time in the gaps', () => {
    const gaps = freeGaps(businessHours, [cancelled('14:00', '15:00')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].minutes).toBe(600);
  });

  it('returns no gaps when the day is fully booked', () => {
    expect(freeGaps(businessHours, [confirmed('08:00', '18:00')])).toEqual([]);
  });
});

describe('bookableGaps()', () => {
  it('keeps short gaps out of the bookable list but freeGaps still reports them', () => {
    const bookings = [confirmed('08:00', '12:00'), confirmed('12:10', '18:00')];
    expect(freeGaps(businessHours, bookings).map((g) => g.minutes)).toEqual([10]);
    expect(bookableGaps(businessHours, bookings, 15)).toEqual([]);
  });

  it('keeps gaps at exactly the minimum', () => {
    const bookings = [confirmed('08:00', '12:00'), confirmed('12:15', '18:00')];
    expect(bookableGaps(businessHours, bookings, 15)).toHaveLength(1);
  });
});

describe('confirmedInOrder() (FR-012)', () => {
  it('sorts chronologically and drops cancelled bookings', () => {
    const ordered = confirmedInOrder([
      confirmed('14:00', '15:00'),
      cancelled('10:00', '11:00'),
      confirmed('09:00', '10:00'),
    ]);
    expect(ordered).toHaveLength(2);
    expect(ordered[0].startsAt.toISOString()).toBe('2026-09-24T09:00:00.000Z');
    expect(ordered[1].startsAt.toISOString()).toBe('2026-09-24T14:00:00.000Z');
  });

  it('does not mutate its input', () => {
    const input = [confirmed('14:00', '15:00'), confirmed('09:00', '10:00')];
    const first = input[0];
    confirmedInOrder(input);
    expect(input[0]).toBe(first);
  });
});
