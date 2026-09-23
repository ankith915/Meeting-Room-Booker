import { describe, it, expect } from 'vitest';
import {
  overlaps, isPositiveDuration, durationMinutes, contains, subtractIntervals, byStart,
  type Interval,
} from '@/lib/domain/interval';

/** Terse UTC interval builder: iv('09:00', '10:00') on a fixed reference date. */
const iv = (start: string, end: string): Interval => ({
  startsAt: new Date(`2026-09-24T${start}:00.000Z`),
  endsAt: new Date(`2026-09-24T${end}:00.000Z`),
});

describe('overlaps()', () => {
  it('EC-002: partial overlap at the tail conflicts', () => {
    expect(overlaps(iv('14:00', '15:00'), iv('14:30', '15:30'))).toBe(true);
  });

  it('EC-002: partial overlap at the head conflicts', () => {
    expect(overlaps(iv('14:00', '15:00'), iv('13:30', '14:30'))).toBe(true);
  });

  it('EC-002: an interval wholly containing another conflicts', () => {
    expect(overlaps(iv('13:00', '16:00'), iv('14:00', '15:00'))).toBe(true);
  });

  it('EC-002: an interval wholly inside another conflicts', () => {
    expect(overlaps(iv('14:15', '14:45'), iv('14:00', '15:00'))).toBe(true);
  });

  it('EC-002: identical intervals conflict', () => {
    expect(overlaps(iv('14:00', '15:00'), iv('14:00', '15:00'))).toBe(true);
  });

  it('EC-003: adjacent intervals do NOT conflict (end is exclusive)', () => {
    expect(overlaps(iv('09:00', '10:00'), iv('10:00', '11:00'))).toBe(false);
  });

  it('EC-003: adjacent in the other direction does NOT conflict', () => {
    expect(overlaps(iv('10:00', '11:00'), iv('09:00', '10:00'))).toBe(false);
  });

  it('EC-003: fully disjoint intervals do not conflict', () => {
    expect(overlaps(iv('09:00', '10:00'), iv('14:00', '15:00'))).toBe(false);
  });

  it('is symmetric — overlap is a mutual property, never order-dependent', () => {
    const pairs: [Interval, Interval][] = [
      [iv('14:00', '15:00'), iv('14:30', '15:30')],
      [iv('09:00', '10:00'), iv('10:00', '11:00')],
      [iv('13:00', '16:00'), iv('14:00', '15:00')],
      [iv('09:00', '10:00'), iv('14:00', '15:00')],
    ];
    for (const [a, b] of pairs) {
      expect(overlaps(a, b)).toBe(overlaps(b, a));
    }
  });
});

describe('isPositiveDuration()', () => {
  it('EC-006: a zero-length interval is rejected', () => {
    expect(isPositiveDuration(iv('14:00', '14:00'))).toBe(false);
  });

  it('EC-006: an inverted interval is rejected', () => {
    expect(isPositiveDuration(iv('15:00', '14:00'))).toBe(false);
  });

  it('accepts a normal interval', () => {
    expect(isPositiveDuration(iv('14:00', '15:00'))).toBe(true);
  });

  it('EC-006: a zero-length interval overlaps nothing — why it must be rejected upstream', () => {
    // This is the reason the CHECK is strict. A zero-length range would slip
    // past conflict detection entirely and reserve a slot nobody can see.
    expect(overlaps(iv('14:00', '14:00'), iv('14:00', '15:00'))).toBe(false);
  });
});

describe('durationMinutes()', () => {
  it('measures a one-hour interval', () => {
    expect(durationMinutes(iv('14:00', '15:00'))).toBe(60);
  });
  it('measures a fifteen-minute interval', () => {
    expect(durationMinutes(iv('14:00', '14:15'))).toBe(15);
  });
});

describe('contains()', () => {
  it('EC-009: a range inside business hours is contained', () => {
    expect(contains(iv('08:00', '18:00'), iv('14:00', '15:00'))).toBe(true);
  });
  it('EC-009: a range ending after closing is not contained', () => {
    expect(contains(iv('08:00', '18:00'), iv('17:00', '19:00'))).toBe(false);
  });
  it('EC-009: a range starting before opening is not contained', () => {
    expect(contains(iv('08:00', '18:00'), iv('07:00', '09:00'))).toBe(false);
  });
  it('a range exactly filling the window is contained', () => {
    expect(contains(iv('08:00', '18:00'), iv('08:00', '18:00'))).toBe(true);
  });
});

describe('subtractIntervals() — the engine behind freeGaps (FR-013)', () => {
  const day = iv('08:00', '18:00');

  it('US2-3: an empty busy list yields ONE gap covering the whole window', () => {
    const gaps = subtractIntervals(day, []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual(day);
  });

  it('FR-013: finds the gap between two bookings', () => {
    const gaps = subtractIntervals(day, [iv('09:00', '10:00'), iv('14:00', '15:00')]);
    expect(gaps).toEqual([iv('08:00', '09:00'), iv('10:00', '14:00'), iv('15:00', '18:00')]);
  });

  it('produces no gap between adjacent bookings', () => {
    const gaps = subtractIntervals(day, [iv('09:00', '10:00'), iv('10:00', '11:00')]);
    expect(gaps).toEqual([iv('08:00', '09:00'), iv('11:00', '18:00')]);
  });

  it('merges overlapping busy blocks rather than reporting a phantom gap', () => {
    const gaps = subtractIntervals(day, [iv('09:00', '11:00'), iv('10:00', '12:00')]);
    expect(gaps).toEqual([iv('08:00', '09:00'), iv('12:00', '18:00')]);
  });

  it('handles unsorted input', () => {
    const gaps = subtractIntervals(day, [iv('14:00', '15:00'), iv('09:00', '10:00')]);
    expect(gaps).toEqual([iv('08:00', '09:00'), iv('10:00', '14:00'), iv('15:00', '18:00')]);
  });

  it('clips busy blocks that extend beyond the window', () => {
    const gaps = subtractIntervals(day, [iv('07:00', '09:00'), iv('17:00', '19:00')]);
    expect(gaps).toEqual([iv('09:00', '17:00')]);
  });

  it('ignores busy blocks entirely outside the window', () => {
    const gaps = subtractIntervals(day, [iv('05:00', '06:00'), iv('20:00', '21:00')]);
    expect(gaps).toEqual([day]);
  });

  it('returns no gaps when the window is fully booked', () => {
    expect(subtractIntervals(day, [iv('08:00', '18:00')])).toEqual([]);
  });

  it('returns no gaps for a non-positive window', () => {
    expect(subtractIntervals(iv('18:00', '08:00'), [])).toEqual([]);
  });
});

describe('byStart()', () => {
  it('FR-012: sorts bookings chronologically', () => {
    const sorted = [iv('14:00', '15:00'), iv('09:00', '10:00'), iv('11:00', '12:00')].sort(byStart);
    expect(sorted.map((i) => i.startsAt.toISOString())).toEqual([
      '2026-09-24T09:00:00.000Z',
      '2026-09-24T11:00:00.000Z',
      '2026-09-24T14:00:00.000Z',
    ]);
  });
});
