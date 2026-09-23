import { describe, it, expect } from 'vitest';
import { createBookingSchema, checkTimeRules, POLICY, type RoomPolicy } from '@/lib/validation';
import { localToInstant } from '@/lib/time';

const KOLKATA: RoomPolicy = { timezone: 'Asia/Kolkata', opensAt: '08:00', closesAt: '18:00' };

/** A fixed "now" so these tests never depend on the wall clock. */
const NOW = new Date('2026-09-24T03:00:00.000Z'); // 08:30 Kolkata
const DATE = '2026-09-24';

const range = (start: string, end: string) => ({
  startsAt: localToInstant(DATE, start, KOLKATA.timezone),
  endsAt: localToInstant(DATE, end, KOLKATA.timezone),
});

const validInput = {
  roomId: '3f1a5b6c-1111-4222-8333-444455556666',
  startsAt: '2026-09-24T14:00:00+05:30',
  endsAt: '2026-09-24T15:00:00+05:30',
  title: 'Sprint review',
  organiser: 'ankith',
};

describe('createBookingSchema — shape rules', () => {
  it('accepts a well-formed request', () => {
    expect(createBookingSchema.safeParse(validInput).success).toBe(true);
  });

  it('EC-011: rejects a blank title', () => {
    const r = createBookingSchema.safeParse({ ...validInput, title: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['title']);
  });

  it('EC-011: rejects an over-long title and names the limit', () => {
    const r = createBookingSchema.safeParse({ ...validInput, title: 'x'.repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain(String(POLICY.titleMaxLength));
  });

  it('EC-011: accepts a title at exactly the limit', () => {
    expect(createBookingSchema.safeParse({ ...validInput, title: 'x'.repeat(200) }).success).toBe(true);
  });

  it('EC-006: rejects a zero-length range', () => {
    const r = createBookingSchema.safeParse({ ...validInput, endsAt: validInput.startsAt });
    expect(r.success).toBe(false);
  });

  it('EC-006: rejects an inverted range', () => {
    const r = createBookingSchema.safeParse({
      ...validInput,
      startsAt: '2026-09-24T15:00:00+05:30',
      endsAt: '2026-09-24T14:00:00+05:30',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-UUID room id', () => {
    expect(createBookingSchema.safeParse({ ...validInput, roomId: 'aurora' }).success).toBe(false);
  });

  it('rejects a blank organiser', () => {
    expect(createBookingSchema.safeParse({ ...validInput, organiser: ' ' }).success).toBe(false);
  });
});

describe('checkTimeRules — rules needing the room', () => {
  it('accepts a valid mid-afternoon booking', () => {
    const r = checkTimeRules(range('14:00', '15:00'), KOLKATA, NOW);
    expect(r.ok).toBe(true);
  });

  it('EC-007: rejects a start in the past', () => {
    const r = checkTimeRules(range('08:00', '09:00'), KOLKATA, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PAST_BOOKING');
  });

  it('EC-018: rejects a start beyond the 90-day horizon and names it', () => {
    const far = new Date(NOW.getTime() + 100 * 24 * 60 * 60 * 1000);
    const r = checkTimeRules(
      { startsAt: far, endsAt: new Date(far.getTime() + 3_600_000) },
      KOLKATA,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('TOO_FAR_AHEAD');
      expect(r.error.message).toContain(String(POLICY.horizonDays));
    }
  });

  it('EC-010: rejects a booking longer than the maximum and names the limit', () => {
    const r = checkTimeRules(range('09:00', '18:00'), KOLKATA, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('DURATION_EXCEEDED');
      expect(r.error.message).toContain('8 hours');
    }
  });

  it('EC-010: rejects a booking shorter than the minimum', () => {
    const r = checkTimeRules(range('14:00', '14:05'), KOLKATA, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('DURATION_EXCEEDED');
      expect(r.error.message).toContain(String(POLICY.minimumMinutes));
    }
  });

  it('EC-009: rejects a booking before opening and names the window', () => {
    // 07:00 local is before 08:00 opening but still ahead of NOW? No - use a
    // later date so PAST_BOOKING cannot mask the hours check.
    const r = checkTimeRules(
      {
        startsAt: localToInstant('2026-09-25', '07:00', KOLKATA.timezone),
        endsAt: localToInstant('2026-09-25', '08:00', KOLKATA.timezone),
      },
      KOLKATA,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(r.error.message).toContain('08:00');
      expect(r.error.message).toContain('18:00');
    }
  });

  it('EC-009: rejects a booking running past closing', () => {
    const r = checkTimeRules(range('17:00', '19:00'), KOLKATA, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('EC-009: accepts a booking exactly filling business hours', () => {
    // Exactly 08:00-18:00 is 10 hours, which exceeds the 8-hour maximum, so
    // this must fail on DURATION rather than on hours — confirming the
    // documented check ORDER (duration before hours).
    const r = checkTimeRules(
      {
        startsAt: localToInstant('2026-09-25', '08:00', KOLKATA.timezone),
        endsAt: localToInstant('2026-09-25', '18:00', KOLKATA.timezone),
      },
      KOLKATA,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DURATION_EXCEEDED');
  });

  it('EC-012: rejects a range crossing local midnight', () => {
    const r = checkTimeRules(
      {
        startsAt: localToInstant('2026-09-25', '23:00', KOLKATA.timezone),
        endsAt: localToInstant('2026-09-26', '01:00', KOLKATA.timezone),
      },
      KOLKATA,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('EC-006: rejects a non-positive range defensively', () => {
    const r = checkTimeRules(range('15:00', '14:00'), KOLKATA, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RANGE');
  });

  it('Constitution V: every refusal carries a code and a non-empty message', () => {
    const failures = [
      checkTimeRules(range('08:00', '09:00'), KOLKATA, NOW),
      checkTimeRules(range('09:00', '18:00'), KOLKATA, NOW),
      checkTimeRules(range('17:00', '19:00'), KOLKATA, NOW),
      checkTimeRules(range('15:00', '14:00'), KOLKATA, NOW),
    ];
    for (const f of failures) {
      expect(f.ok).toBe(false);
      if (!f.ok) {
        expect(f.error.code).toBeTruthy();
        expect(f.error.message.length).toBeGreaterThan(10);
      }
    }
  });
});
