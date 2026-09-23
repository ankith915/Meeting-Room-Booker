/**
 * Integration tests against real Neon: the rules that need a database.
 *
 * Covers EC-004, EC-005, EC-008 and the sequential (non-racing) forms of
 * EC-002 and EC-003.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createBooking, cancelBooking } from '@/lib/server/bookings';
import { listAvailability } from '@/lib/server/queries';
import { ROOM, at, futureDate, clearAllTestBookings, countConfirmed } from '../helpers';

const DATE = futureDate(8);

const booking = (over: Partial<Parameters<typeof createBooking>[0]> = {}) => ({
  roomId: ROOM.aurora,
  startsAt: at(DATE, '14:00'),
  endsAt: at(DATE, '15:00'),
  title: 'Planning',
  organiser: 'ankith',
  ...over,
});

beforeEach(async () => {
  await clearAllTestBookings();
});

afterAll(async () => {
  await clearAllTestBookings();
});

describe('EC-008: unknown and inactive rooms', () => {
  it('EC-008: an unknown room id is refused ROOM_NOT_FOUND', async () => {
    const r = await createBooking(booking({ roomId: '99999999-9999-4999-8999-999999999999' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('EC-008: an inactive room is refused ROOM_INACTIVE, distinctly', async () => {
    const r = await createBooking(booking({ roomId: ROOM.halcyon }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Distinct from ROOM_NOT_FOUND because it needs different user guidance:
      // the room exists, so suggesting a different id would be wrong.
      expect(r.error.code).toBe('ROOM_INACTIVE');
      expect(r.error.message).toContain('Halcyon');
    }
  });
});

describe('EC-009: business hours are per room', () => {
  it('Cinder closes at 12:30, so an afternoon booking is refused', async () => {
    const r = await createBooking(booking({ roomId: ROOM.cinder }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(r.error.message).toContain('12:30');
    }
  });

  it('Cinder accepts a late-morning booking inside its window', async () => {
    const r = await createBooking(
      booking({ roomId: ROOM.cinder, startsAt: at(DATE, '10:00'), endsAt: at(DATE, '11:00') }),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Sequential conflict rules', () => {
  it('EC-002: a partial overlap is refused', async () => {
    expect((await createBooking(booking())).ok).toBe(true);
    const r = await createBooking(
      booking({ startsAt: at(DATE, '14:30'), endsAt: at(DATE, '15:30'), organiser: 'other' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SLOT_TAKEN');
  });

  it('EC-002: a booking wholly containing an existing one is refused', async () => {
    expect((await createBooking(booking())).ok).toBe(true);
    const r = await createBooking(
      booking({ startsAt: at(DATE, '13:00'), endsAt: at(DATE, '16:00'), organiser: 'other' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SLOT_TAKEN');
  });

  it('EC-003: an adjacent booking is accepted', async () => {
    expect((await createBooking(booking())).ok).toBe(true);
    const r = await createBooking(
      booking({ startsAt: at(DATE, '15:00'), endsAt: at(DATE, '16:00'), organiser: 'other' }),
    );
    expect(r.ok).toBe(true);
  });

  it('EC-004: the same range on a different room is accepted', async () => {
    expect((await createBooking(booking())).ok).toBe(true);
    const r = await createBooking(booking({ roomId: ROOM.borealis, organiser: 'other' }));
    expect(r.ok).toBe(true);
  });
});

describe('EC-005: cancelled bookings do not reserve time', () => {
  it('cancelling frees the slot for anyone else', async () => {
    const first = await createBooking(booking());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Blocked while confirmed.
    const blocked = await createBooking(booking({ organiser: 'other' }));
    expect(blocked.ok).toBe(false);

    const cancelled = await cancelBooking(first.value.id, 'ankith');
    expect(cancelled.ok).toBe(true);

    // FR-020: free immediately, with no cleanup step.
    const rebooked = await createBooking(booking({ organiser: 'other' }));
    expect(rebooked.ok).toBe(true);

    // The cancelled row is retained (FR-022) but only one CONFIRMED booking exists.
    expect(await countConfirmed(ROOM.aurora, at(DATE, '14:00'), at(DATE, '15:00'))).toBe(1);
  });
});

describe('FR-002: the availability list agrees with the booking action', () => {
  it('never reports a room as free when booking it would be refused', async () => {
    // Found by eye during the UI build: Meridian (America/New_York) showed
    // "Free" at 14:00 Kolkata, which is 04:30 in New York — before it opens.
    // The list only checked for CONFLICTS, not the room's own hours, so it
    // invited a click that always failed. This pins the two together.
    const startsAt = new Date(at(DATE, '14:00'));
    const endsAt = new Date(at(DATE, '15:00'));

    const rows = await listAvailability(startsAt, endsAt);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const attempt = await createBooking(
        booking({
          roomId: row.room.id,
          organiser: 'agreement-check',
          title: `Agreement check ${row.room.name}`,
        }),
      );

      if (row.isFree) {
        expect(attempt.ok, `${row.room.name} was listed free but booking failed`).toBe(true);
      } else {
        expect(attempt.ok, `${row.room.name} was listed unavailable but booking succeeded`)
          .toBe(false);
      }
    }
  });

  it('a room outside its own hours is reported closed, not busy', async () => {
    const rows = await listAvailability(new Date(at(DATE, '14:00')), new Date(at(DATE, '15:00')));
    const meridian = rows.find((r) => r.room.id === ROOM.meridian);

    expect(meridian).toBeDefined();
    expect(meridian?.isFree).toBe(false);
    // 'closed' rather than 'booked': nothing conflicts, the room is just shut.
    expect(meridian?.reason).toBe('closed');
    expect(meridian?.conflictCount).toBe(0);
  });
});

describe('FR-009/FR-010: refusals are actionable', () => {
  it('SLOT_TAKEN names the holder and offers alternatives', async () => {
    expect((await createBooking(booking({ title: 'Board meeting' }))).ok).toBe(true);

    const r = await createBooking(booking({ organiser: 'someone-else' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.error.conflict?.title).toBe('Board meeting');
    expect(r.error.conflict?.organiser).toBe('ankith');
    expect(r.error.alternatives?.length ?? 0).toBeGreaterThan(0);

    // At least one alternative should be a genuinely different room.
    const rooms = r.error.alternatives?.filter((a) => a.kind === 'other-room') ?? [];
    expect(rooms.length).toBeGreaterThan(0);
  });
});
