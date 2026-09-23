'use server';

/**
 * Server Action wrappers.
 *
 * Thin by design: all logic lives in lib/server/bookings.ts so it can be
 * tested without a Next.js runtime. These add exactly two things — cache
 * revalidation, and serialisation of Date objects into strings that can cross
 * the server/client boundary.
 */

import { revalidatePath } from 'next/cache';
import {
  createBooking as createBookingService,
  cancelBooking as cancelBookingService,
  type CreateBookingInput,
} from '@/lib/server/bookings';
import type { BookingError } from '@/lib/domain/errors';

/** A booking as the client sees it — dates as ISO strings. */
export type BookingView = {
  id: string;
  roomId: string;
  title: string;
  organiser: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
};

export type ActionResult =
  | { ok: true; booking: BookingView }
  | { ok: false; error: BookingError };

export async function createBookingAction(input: CreateBookingInput): Promise<ActionResult> {
  const result = await createBookingService(input);

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/');
  revalidatePath(`/rooms/${input.roomId}`);

  const b = result.value;
  return {
    ok: true,
    booking: {
      id: b.id,
      roomId: b.roomId,
      title: b.title,
      organiser: b.organiser,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
    },
  };
}

export async function cancelBookingAction(
  bookingId: string,
  organiser: string,
  roomId: string,
): Promise<ActionResult> {
  const result = await cancelBookingService(bookingId, organiser);

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/');
  revalidatePath(`/rooms/${roomId}`);

  const b = result.value;
  return {
    ok: true,
    booking: {
      id: b.id,
      roomId: b.roomId,
      title: b.title,
      organiser: b.organiser,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
    },
  };
}
