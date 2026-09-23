/**
 * Booking error taxonomy.
 *
 * Constitution Principle V (No silent failures): every rejected operation
 * returns a typed, machine-readable code AND a human-readable message naming
 * the specific limit or conflict that caused it.
 *
 * This file is PURE: no I/O, no framework imports (Constitution: domain purity).
 *
 * Spec: FR-008, FR-011 | Contracts: contracts/create-booking.md, contracts/cancel-booking.md
 */

/** Refusals from createBooking. */
export const BOOKING_ERROR_CODES = [
  'INVALID_TITLE',           // EC-011
  'INVALID_RANGE',           // EC-006 — ends_at <= starts_at
  'PAST_BOOKING',            // EC-007
  'ROOM_NOT_FOUND',          // EC-008
  'ROOM_INACTIVE',           // EC-008
  'OUTSIDE_BUSINESS_HOURS',  // EC-009, EC-012
  'DURATION_EXCEEDED',       // EC-010
  'TOO_FAR_AHEAD',           // EC-018 (A-009, 90-day horizon)
  'SLOT_TAKEN',              // EC-001, EC-002 — the one the database decides
] as const;

/** Refusals from cancelBooking. */
export const CANCEL_ERROR_CODES = [
  'BOOKING_NOT_FOUND',
  'NOT_ORGANISER',           // EC-015
  'ALREADY_ENDED',           // EC-016
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];
export type CancelErrorCode = (typeof CANCEL_ERROR_CODES)[number];
export type ErrorCode = BookingErrorCode | CancelErrorCode;

/** The booking that already holds the requested slot (FR-009). */
export type ConflictDetail = {
  bookingId: string;
  title: string;
  organiser: string;
  startsAt: string;
  endsAt: string;
};

/** Somewhere else the user could go (FR-010). */
export type Alternative =
  | { kind: 'other-room'; roomId: string; roomName: string; startsAt: string; endsAt: string }
  | { kind: 'other-time'; roomId: string; startsAt: string; endsAt: string };

export type BookingError = {
  code: ErrorCode;
  message: string;
  /** Present only for SLOT_TAKEN. */
  conflict?: ConflictDetail;
  /** Present only for SLOT_TAKEN, and only when an alternative exists. */
  alternatives?: Alternative[];
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: BookingError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: ErrorCode,
  message: string,
  extra?: Pick<BookingError, 'conflict' | 'alternatives'>,
): Result<never> => ({ ok: false, error: { code, message, ...extra } });

/**
 * PostgreSQL SQLSTATE for exclusion_violation.
 *
 * This is the code `bookings_no_overlap` raises, and the ONLY code that may be
 * translated into SLOT_TAKEN. Catching more broadly would report a connection
 * failure as a booking conflict and hide real faults — a Principle V violation.
 *
 * See contracts/create-booking.md § Error handling requirements.
 */
export const EXCLUSION_VIOLATION = '23P01';

/** Narrow an unknown thrown value to something carrying a SQLSTATE. */
export function isPostgresError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e
    && typeof (e as { code: unknown }).code === 'string';
}

/** True only for the exclusion-constraint violation raised by bookings_no_overlap. */
export function isExclusionViolation(e: unknown): boolean {
  return isPostgresError(e) && e.code === EXCLUSION_VIOLATION;
}
