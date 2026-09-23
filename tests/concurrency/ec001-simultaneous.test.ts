/**
 * EC-001 / SC-001 — the centrepiece.
 *
 * "What happens when two people try to book the same slot at the same moment?"
 *
 * This is the edge case the whole project exists to answer, and the one that
 * cannot be solved in application code. These tests fire many genuinely
 * concurrent requests at a real Neon database and assert that exactly one
 * booking survives.
 *
 * The assertion that matters is the STORED ROW COUNT, not the response codes.
 * A bug that returned 201 to two callers while writing one row, or 409 to both
 * while writing none, would pass a response-code-only check.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createBooking } from '@/lib/server/bookings';
import { ROOM, at, futureDate, clearAllTestBookings, countConfirmed } from '../helpers';

const DATE = futureDate(7);
const SLOT = { startsAt: at(DATE, '14:00'), endsAt: at(DATE, '15:00') };

const request = (organiser: string) => ({
  roomId: ROOM.aurora,
  startsAt: SLOT.startsAt,
  endsAt: SLOT.endsAt,
  title: 'Contended slot',
  organiser,
});

beforeEach(async () => {
  await clearAllTestBookings();
});

afterAll(async () => {
  await clearAllTestBookings();
});

describe('EC-001: simultaneous booking of the same slot', () => {
  it('two simultaneous requests produce exactly one booking', async () => {
    const [alice, bob] = await Promise.all([
      createBooking(request('alice')),
      createBooking(request('bob')),
    ]);

    const succeeded = [alice, bob].filter((r) => r.ok);
    const refused = [alice, bob].filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);

    const loser = refused[0];
    if (!loser.ok) expect(loser.error.code).toBe('SLOT_TAKEN');

    // The claim that actually matters.
    expect(await countConfirmed(ROOM.aurora, SLOT.startsAt, SLOT.endsAt)).toBe(1);
  });

  it('SC-001: 50 concurrent requests produce exactly one booking', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => createBooking(request(`racer-${i}`))),
    );

    const succeeded = results.filter((r) => r.ok);
    const slotTaken = results.filter((r) => !r.ok && r.error.code === 'SLOT_TAKEN');

    expect(succeeded).toHaveLength(1);
    expect(slotTaken).toHaveLength(49);

    // Zero tolerance: a single duplicate is a total failure.
    expect(await countConfirmed(ROOM.aurora, SLOT.startsAt, SLOT.endsAt)).toBe(1);
  });

  it('every loser is refused SLOT_TAKEN — never a generic failure', async () => {
    // Constitution V: no silent failures, and no misreported ones either.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createBooking(request(`racer-${i}`))),
    );

    for (const result of results) {
      if (result.ok) continue;
      expect(result.error.code).toBe('SLOT_TAKEN');
      expect(result.error.message.length).toBeGreaterThan(10);
    }
  });

  it('FR-009/FR-010: the loser is told who holds the slot and offered alternatives', async () => {
    const winner = await createBooking({ ...request('alice'), title: 'Design review' });
    expect(winner.ok).toBe(true);

    const loser = await createBooking(request('bob'));
    expect(loser.ok).toBe(false);
    if (loser.ok) return;

    expect(loser.error.code).toBe('SLOT_TAKEN');
    expect(loser.error.conflict).toBeDefined();
    expect(loser.error.conflict?.title).toBe('Design review');
    expect(loser.error.conflict?.organiser).toBe('alice');
    // Borealis and Meridian are free for the same range, so alternatives exist.
    expect(loser.error.alternatives?.length ?? 0).toBeGreaterThan(0);
  });

  it('SC-003: the guarantee holds with ALL application checks disabled', async () => {
    // This is the proof that correctness does not rest on application code.
    // skipApplicationChecks bypasses validation, the room lookup, and every
    // time rule, going straight to the INSERT.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createBooking(request(`bypass-${i}`), { skipApplicationChecks: true }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await countConfirmed(ROOM.aurora, SLOT.startsAt, SLOT.endsAt)).toBe(1);
  });

  it('EC-004: concurrent bookings on DIFFERENT rooms all succeed', async () => {
    // The conflict rule is scoped per room, so these must not interfere.
    // Both rooms are in Asia/Kolkata, so the same instant is inside both
    // their business hours.
    const [aurora, borealis] = await Promise.all([
      createBooking({ ...request('alice'), roomId: ROOM.aurora }),
      createBooking({ ...request('bob'), roomId: ROOM.borealis }),
    ]);

    expect(aurora.ok).toBe(true);
    expect(borealis.ok).toBe(true);
  });

  it('FR-014: business hours are judged in the ROOM\'s timezone, not the booker\'s', async () => {
    // The same instant that is 14:00 in Kolkata is 04:30 in New York, which is
    // before Meridian opens. Booking it must be refused on Meridian while
    // succeeding on Aurora — which is only correct if each room's hours are
    // evaluated in its own zone.
    const aurora = await createBooking({ ...request('alice'), roomId: ROOM.aurora });
    const meridian = await createBooking({ ...request('bob'), roomId: ROOM.meridian });

    expect(aurora.ok).toBe(true);
    expect(meridian.ok).toBe(false);
    if (!meridian.ok) {
      expect(meridian.error.code).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(meridian.error.message).toContain('America/New_York');
    }
  });

  it('EC-003: concurrent ADJACENT bookings both succeed', async () => {
    // 14:00-15:00 and 15:00-16:00 do not overlap, so concurrency is irrelevant.
    const [first, second] = await Promise.all([
      createBooking(request('alice')),
      createBooking({
        ...request('bob'),
        startsAt: at(DATE, '15:00'),
        endsAt: at(DATE, '16:00'),
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('EC-002: concurrent PARTIALLY overlapping requests yield exactly one', async () => {
    // 14:00-15:00 vs 14:30-15:30 — overlap, not equality, is the test.
    const [first, second] = await Promise.all([
      createBooking(request('alice')),
      createBooking({
        ...request('bob'),
        startsAt: at(DATE, '14:30'),
        endsAt: at(DATE, '15:30'),
      }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });
});
