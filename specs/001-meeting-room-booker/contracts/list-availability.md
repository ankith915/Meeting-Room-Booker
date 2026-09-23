# Contract: `listAvailability` and `getDaySchedule`

**Type**: Server-side read functions | **File**: `app/actions/queries.ts`

**Implements**: FR-002, FR-003, FR-012 … FR-015 | **Covers**: EC-014

Both are **read-only**. Neither may create, modify, or reserve anything. Availability reported here
is advisory: it can go stale between the read and the user's click, and that is expected — the
exclusion constraint in `createBooking` is what settles the outcome.

## `listAvailability`

```ts
type ListAvailabilityInput = {
  startsAt: string;   // ISO 8601
  endsAt:   string;   // ISO 8601, exclusive
  minCapacity?: number;
};

type RoomAvailability = {
  room: Room;
  isFree: boolean;
  conflictCount: number;   // confirmed bookings overlapping the range
};
```

- Returns **only** rooms with `is_active = true` (FR-003).
- `isFree` is true when no confirmed booking on the room overlaps the range (FR-002).
- Sorted: free rooms first, then by capacity ascending — so the smallest room that fits is offered
  before an oversized one.
- An invalid range (`endsAt <= startsAt`) returns every active room with `isFree: false` rather than
  throwing. This is a read; refusing the *booking* is `createBooking`'s job (EC-006).

## `getDaySchedule`

```ts
type GetDayScheduleInput = {
  roomId: string;
  date:   string;   // "YYYY-MM-DD", interpreted in the ROOM's timezone (FR-015)
};

type DaySchedule = {
  room:     Room;
  timezone: string;        // echoed back so the UI can label it (FR-014, EC-014)
  date:     string;
  bookings: ScheduledBooking[];   // confirmed only, ascending by start
  gaps:     FreePeriod[];         // complement within [opens_at, closes_at)
};

type ScheduledBooking = {
  id: string; title: string; organiser: string;
  startsAt: string; endsAt: string;
  localStart: string;   // "14:00" in the room's timezone
  localEnd:   string;   // "15:00"
};

type FreePeriod = { startsAt: string; endsAt: string; minutes: number };
```

### Rules

- **Confirmed only.** Cancelled bookings never appear (FR-012, EC-005).
- **The room's day, not the viewer's** (FR-015). `date` is resolved to the instant range
  `[local 00:00, next local 00:00)` using the room's timezone. A viewer in another timezone sees the
  same day's contents (EC-014).
- **Gaps are the complement** of the day's bookings within `[opens_at, closes_at)` (FR-013). A room
  with no bookings returns exactly one gap spanning the whole window — never an empty list, which
  would leave the UI unable to distinguish "free all day" from "no data" (US2 scenario 3).
- Gaps shorter than the 15-minute minimum booking length are still returned, flagged by `minutes`,
  so the UI can show them greyed rather than pretending they do not exist.
- Inactive rooms still return their historical schedule (FR-003).

## Purity boundary

Both functions do exactly one thing beyond I/O: fetch rows, then hand them to pure functions in
`lib/domain/` — `daySchedule()`, `freeGaps()`, `isAvailable()`. No overlap arithmetic or gap
computation may be written inline here or inside a React component (Constitution: domain purity).
That is what lets EC-002, EC-003 and FR-013 be tested without a database.

## Test obligations

| Test | Asserts |
|---|---|
| `FR-013 gaps` | room with 09:00–10:00 and 14:00–15:00 → gap 10:00–14:00 present |
| `US2-3 empty room` | no bookings → exactly one gap covering business hours |
| `EC-014 viewer timezone` | same schedule rendered under two `TZ` values → identical local times |
| `FR-015 room-local day` | booking at 23:30 room-local appears on that room-local date |
| `EC-005 cancelled hidden` | cancelled booking absent from `bookings`, its time present in `gaps` |
| `FR-003 inactive room` | excluded from `listAvailability`, still served by `getDaySchedule` |
