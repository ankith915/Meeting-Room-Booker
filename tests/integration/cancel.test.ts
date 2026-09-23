/**
 * Cancellation rules — EC-015, EC-016, EC-017 and FR-016..FR-022.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { bookings } from '@/db/schema';
import { createBooking, cancelBooking } from '@/lib/server/bookings';
import { ROOM, at, futureDate, clearAllTestBookings } from '../helpers';

const DATE = futureDate(9);

const make = (organiser = 'ankith') =>
  createBooking({
    roomId: ROOM.aurora,
    startsAt: at(DATE, '14:00'),
    endsAt: at(DATE, '15:00'),
    title: 'Retro',
    organiser,
  });

beforeEach(async () => {
  await clearAllTestBookings();
});

afterAll(async () => {
  await clearAllTestBookings();
});

describe('cancelBooking', () => {
  it('FR-016: the organiser can cancel their own booking', async () => {
    const created = await make();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await cancelBooking(created.value.id, 'ankith');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('cancelled');
  });

  it('EC-015: someone else cannot cancel it', async () => {
    const created = await make();
    if (!created.ok) return;

    const result = await cancelBooking(created.value.id, 'mallory');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_ORGANISER');
      expect(result.error.message).toContain('ankith');
    }

    // And the booking is untouched.
    const [row] = await db.select().from(bookings).where(eq(bookings.id, created.value.id));
    expect(row.status).toBe('confirmed');
  });

  it('EC-016: a booking that has already ended cannot be cancelled', async () => {
    const created = await make();
    if (!created.ok) return;

    // A clock well after the booking ends. History is not rewritten.
    const later = new Date(created.value.endsAt.getTime() + 60 * 60 * 1000);
    const result = await cancelBooking(created.value.id, 'ankith', { now: later });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_ENDED');
  });

  it('EC-017: cancelling twice succeeds and changes nothing', async () => {
    const created = await make();
    if (!created.ok) return;

    const first = await cancelBooking(created.value.id, 'ankith');
    expect(first.ok).toBe(true);

    const second = await cancelBooking(created.value.id, 'ankith');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe('cancelled');
  });

  it('EC-017: the idempotent path wins over ALREADY_ENDED', async () => {
    // This is why the already-cancelled shortcut must come FIRST. A booking
    // cancelled last week has also ended; checking ALREADY_ENDED first would
    // turn a harmless retry into an error the user cannot act on.
    const created = await make();
    if (!created.ok) return;

    expect((await cancelBooking(created.value.id, 'ankith')).ok).toBe(true);

    const later = new Date(created.value.endsAt.getTime() + 60 * 60 * 1000);
    const retry = await cancelBooking(created.value.id, 'ankith', { now: later });
    expect(retry.ok).toBe(true);
  });

  it('EC-017: the idempotent path wins over NOT_ORGANISER too', async () => {
    const created = await make();
    if (!created.ok) return;

    expect((await cancelBooking(created.value.id, 'ankith')).ok).toBe(true);
    // Already cancelled, so there is nothing left to protect.
    expect((await cancelBooking(created.value.id, 'anyone')).ok).toBe(true);
  });

  it('concurrent double-cancel is a no-op, not a lost update', async () => {
    const created = await make();
    if (!created.ok) return;

    const [a, b] = await Promise.all([
      cancelBooking(created.value.id, 'ankith'),
      cancelBooking(created.value.id, 'ankith'),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, created.value.id));
    expect(row.status).toBe('cancelled');
  });

  it('FR-022: a cancelled booking is retained, not deleted', async () => {
    const created = await make();
    if (!created.ok) return;

    await cancelBooking(created.value.id, 'ankith');

    const rows = await db.select().from(bookings).where(eq(bookings.id, created.value.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
  });

  it('BOOKING_NOT_FOUND for an unknown id', async () => {
    const result = await cancelBooking('99999999-9999-4999-8999-999999999999', 'ankith');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BOOKING_NOT_FOUND');
  });
});
