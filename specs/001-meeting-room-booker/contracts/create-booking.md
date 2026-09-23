# Contract: `createBooking`

**Type**: Next.js Server Action | **File**: `app/actions/create-booking.ts`

**Implements**: FR-004 … FR-011 | **Covers**: EC-001 … EC-012

This is the **only** path by which a row with `status = 'confirmed'` may be created. Any future
feature that reserves a room — natural-language booking, bulk import, an API — routes through this
function rather than writing its own insert (Constitution: untrusted-input parity).

## Input

```ts
type CreateBookingInput = {
  roomId:    string;   // uuid
  startsAt:  string;   // ISO 8601 with offset, e.g. "2026-09-24T14:00:00+05:30"
  endsAt:    string;   // ISO 8601 with offset — EXCLUSIVE (FR-005)
  title:     string;   // 1–200 chars after trim
  organiser: string;   // non-empty after trim
};
```

## Output

```ts
type CreateBookingResult =
  | { ok: true;  booking: Booking }
  | { ok: false; error: BookingError };

type BookingError = {
  code:    BookingErrorCode;
  message: string;                 // names the specific limit or conflict (FR-011)
  conflict?:     ConflictDetail;   // present only for SLOT_TAKEN (FR-009)
  alternatives?: Alternative[];    // present only for SLOT_TAKEN (FR-010)
};

type ConflictDetail = {
  bookingId: string;
  title:     string;
  organiser: string;
  startsAt:  string;
  endsAt:    string;
};

type Alternative =
  | { kind: 'other-room'; roomId: string; roomName: string; startsAt: string; endsAt: string }
  | { kind: 'other-time'; roomId: string; startsAt: string; endsAt: string };
```

## Error codes

Exhaustive. Constitution V forbids any refusal outside this table.

| Code | HTTP | Cause | Edge case | Message must name |
|---|---|---|---|---|
| `INVALID_TITLE` | 422 | Title blank, whitespace-only, or > 200 chars | EC-011 | the length limit |
| `INVALID_RANGE` | 422 | `endsAt <= startsAt` | EC-006 | that end must be after start |
| `PAST_BOOKING` | 422 | `startsAt` < now | EC-007 | the current time |
| `ROOM_NOT_FOUND` | 404 | No room with that id | EC-008 | the unknown id |
| `ROOM_INACTIVE` | 409 | Room exists, `is_active = false` | EC-008 | that the room is out of service |
| `OUTSIDE_BUSINESS_HOURS` | 422 | Range outside `[opens_at, closes_at)` room-local | EC-009, EC-012 | the room's actual window |
| `DURATION_EXCEEDED` | 422 | Duration > 8h or < 15min | EC-010 | the permitted min/max |
| `TOO_FAR_AHEAD` | 422 | `startsAt` more than 90 days out | A-009 | the horizon |
| `SLOT_TAKEN` | 409 | Exclusion constraint violated | **EC-001, EC-002** | who holds it, and when |

## Execution order

Order is part of the contract: a request failing several checks reports the **first** in this list,
so the same input always yields the same error.

1. Parse and validate shape (Zod) → `INVALID_TITLE`, `INVALID_RANGE`
2. Load room → `ROOM_NOT_FOUND`, `ROOM_INACTIVE`
3. Time rules, in the room's timezone → `PAST_BOOKING`, `OUTSIDE_BUSINESS_HOURS`, `DURATION_EXCEEDED`, `TOO_FAR_AHEAD`
4. `INSERT` with `status = 'confirmed'`
5. On SQLSTATE `23P01` → fetch conflicting row, compute alternatives → `SLOT_TAKEN`
6. Otherwise → `{ ok: true }`

**Steps 1–3 are user-experience only.** They exist for fast, specific feedback. Step 4 is where
correctness is enforced. Deleting steps 1–3 must not make EC-001…EC-005 possible — that is SC-003.

## Error handling requirements

```ts
// REQUIRED — catch the specific code
catch (e) {
  if (isPostgresError(e) && e.code === '23P01') { /* → SLOT_TAKEN */ }
  throw e;   // anything else propagates; never swallowed (Constitution V)
}
```

A bare `catch` that maps every failure to `SLOT_TAKEN` is a constitutional violation: it would
report a connection failure as a booking conflict and hide real faults.

## Guarantees

- **Atomic**: a single `INSERT`. No partial state is observable.
- **Idempotency**: none. Submitting twice creates two bookings *if they do not overlap*; if they do,
  the second is refused `SLOT_TAKEN`. Double-submission protection is a UI concern (disable the
  button), not a correctness one.
- **Concurrency**: under any number of simultaneous conflicting requests, exactly one succeeds
  (FR-007).

## Test obligations

| Test | Asserts |
|---|---|
| `EC-001 simultaneous booking` | 50 parallel → 1 ok, 49 `SLOT_TAKEN`, **stored count = 1** |
| `EC-002 partial overlap` | 14:30–15:30 against 14:00–15:00 → `SLOT_TAKEN` |
| `EC-003 adjacent booking` | 15:00–16:00 against 14:00–15:00 → `ok` |
| `EC-004 same range other room` | → `ok` |
| `EC-005 cancelled does not block` | → `ok` |
| `EC-006 … EC-012` | one test per code above |
| `SC-003 app checks disabled` | overlap still impossible |
| `FR-009/FR-010` | `SLOT_TAKEN` carries conflict detail and ≥1 alternative when one exists |
