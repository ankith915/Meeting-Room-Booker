# Contract: `cancelBooking`

**Type**: Next.js Server Action | **File**: `app/actions/cancel-booking.ts`

**Implements**: FR-016 … FR-020 | **Covers**: EC-015, EC-016, EC-017

## Input / Output

```ts
type CancelBookingInput = {
  bookingId: string;   // uuid
  organiser: string;   // must match the booking's organiser (A-001)
};

type CancelBookingResult =
  | { ok: true;  booking: Booking }          // status now 'cancelled'
  | { ok: false; error: BookingError };
```

## Error codes

| Code | HTTP | Cause | Edge case |
|---|---|---|---|
| `BOOKING_NOT_FOUND` | 404 | No booking with that id | — |
| `NOT_ORGANISER` | 403 | `organiser` does not match | EC-015 |
| `ALREADY_ENDED` | 409 | `ends_at <= now` | EC-016 |

## Execution order

1. Load booking → `BOOKING_NOT_FOUND`
2. **If already `cancelled` → return `{ ok: true }` immediately.** No further checks. (EC-017)
3. Check organiser → `NOT_ORGANISER`
4. Check `ends_at > now` → `ALREADY_ENDED`
5. `UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'`

**Step 2 comes before steps 3 and 4 deliberately.** Idempotency must not be defeated by a later
check: a booking cancelled yesterday has now ended, so checking `ALREADY_ENDED` first would make a
retried cancellation fail — turning a harmless duplicate click into an error the user cannot act on.

## Guarantees

- **Idempotent** (FR-019, EC-017): cancelling an already-cancelled booking succeeds, changes
  nothing, and returns the same shape. Safe to retry.
- **Releases the slot immediately** (FR-020): the exclusion constraint is partial on
  `status = 'confirmed'`, so the cancelled row leaves the index the moment the `UPDATE` commits. No
  cleanup job, no cache to invalidate.
- **Non-destructive** (FR-022): the row is retained, never deleted, so room history stays
  inspectable.
- The `AND status = 'confirmed'` guard in step 5 makes the update a no-op under a concurrent
  double-cancel rather than a lost update.

## Test obligations

| Test | Asserts |
|---|---|
| `EC-015 cancel by non-organiser` | → `NOT_ORGANISER`, status unchanged |
| `EC-016 cancel after end` | → `ALREADY_ENDED`, status unchanged |
| `EC-017 cancel twice` | second call → `ok: true`, no error, no change |
| `EC-005 rebook after cancel` | cancel then book same range → `ok` |
| `FR-022 retention` | cancelled row still present after cancellation |
