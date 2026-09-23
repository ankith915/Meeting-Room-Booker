# Data Model: Meeting Room Booker

**Feature**: `001-meeting-room-booker` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Phase**: 1 (design). Derived from the Key Entities section of the specification. This document is
where the specification's central invariant becomes a concrete schema decision.

## Entities

### Room

| Attribute | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default generated | |
| `name` | text | NOT NULL, unique among active rooms | FR-001 |
| `capacity` | integer | NOT NULL, `CHECK (capacity > 0)` | FR-001 |
| `location` | text | NOT NULL | Floor / building description |
| `timezone` | text | NOT NULL, IANA identifier | e.g. `Asia/Kolkata`. FR-014 |
| `opens_at` | time | NOT NULL, default `08:00` | Local wall-clock. A-002 |
| `closes_at` | time | NOT NULL, `CHECK (closes_at > opens_at)` | Local wall-clock. A-002 |
| `is_active` | boolean | NOT NULL, default `true` | FR-003 |

`opens_at`/`closes_at` are `time`, not `timestamptz`: they are recurring wall-clock boundaries, not
instants. Their `CHECK` enforces EC-012 structurally — a window that cannot cross midnight cannot
admit a booking that does.

### Booking

| Attribute | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default generated | |
| `room_id` | uuid | NOT NULL, FK → `rooms.id`, ON DELETE RESTRICT | FR-004 |
| `title` | text | NOT NULL, `CHECK (length(btrim(title)) BETWEEN 1 AND 200)` | EC-011 |
| `organiser` | text | NOT NULL, `CHECK (length(btrim(organiser)) > 0)` | A-001 |
| `starts_at` | timestamptz | NOT NULL | UTC. FR-021 |
| `ends_at` | timestamptz | NOT NULL, `CHECK (ends_at > starts_at)` | EC-006 |
| `status` | enum | NOT NULL, `('confirmed','cancelled')`, default `confirmed` | FR-022 |
| `created_at` | timestamptz | NOT NULL, default `now()` | FR-023 |

`ON DELETE RESTRICT` rather than `CASCADE`: rooms are deactivated (`is_active = false`), never
deleted, so that historical bookings remain inspectable per FR-022. Cascade would silently destroy
that history.

`CHECK (ends_at > starts_at)` is strict, not `>=`, which forbids zero-length bookings. This is load-
bearing, not cosmetic: a zero-length interval overlaps nothing, so without this check EC-006 would
let a booking slip past conflict detection entirely.

## Relationship

```
Room  1 ─────────────< Booking
```

One Room has many Bookings; each Booking belongs to exactly one Room.

The relationship carries the system's central invariant, restated from the spec:

> **Within a single room, the intervals of all *confirmed* bookings are mutually non-overlapping.**

Three qualifiers in that sentence each map to one clause of the constraint below, and each is a
distinct edge case:

| Qualifier | Why it is there | Edge case |
|---|---|---|
| *within a single room* | Two rooms may hold identical intervals | EC-004 |
| *confirmed* | Cancelled bookings must not reserve time | EC-005 |
| *non-overlapping* (not *non-identical*) | Partial overlaps conflict too | EC-002 |

## The invariant as a constraint

Per Constitution Principle I, this invariant is enforced by the database, not by application code.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING GIST (
    room_id                              WITH =,
    tstzrange(starts_at, ends_at, '[)')  WITH &&
  )
  WHERE (status = 'confirmed');
```

Reading it clause by clause against the invariant:

- **`EXCLUDE USING GIST`** — PostgreSQL refuses any row whose listed expressions all match an
  existing row's under the given operators. The check happens inside the write, holding an index
  lock, so there is no window between checking and writing. **This is what makes EC-001 impossible
  rather than merely unlikely.**
- **`room_id WITH =`** — scopes the rule to one room, satisfying *within a single room* (EC-004).
  Equality on a `uuid` is a B-tree operator and cannot normally live in a GiST index; the
  `btree_gist` extension is what allows it to sit alongside a range in the same index.
- **`tstzrange(starts_at, ends_at, '[)') WITH &&`** — `&&` is range overlap, satisfying
  *non-overlapping* (EC-002). The `'[)'` bound argument is the half-open interval from FR-005
  written directly into the schema, which is what makes adjacent bookings legal (EC-003) — not an
  application rule that could drift from the spec.
- **`WHERE (status = 'confirmed')`** — a *partial* constraint, satisfying *confirmed* (EC-005).
  Cancelled rows are simply not indexed, so they cannot conflict with anything.

A single declaration covers EC-001, EC-002, EC-003, EC-004 and EC-005. That density is the point:
the invariant is stated once, in the one place that can actually enforce it.

### Consequences for the application layer

- A violation surfaces as PostgreSQL SQLSTATE **`23P01`** (`exclusion_violation`). The booking
  service catches exactly that code and maps it to the `SLOT_TAKEN` refusal (FR-009), then queries
  for the conflicting row to populate the message and alternatives (FR-010).
- Application-layer availability checking still exists, but purely for responsiveness — greying out
  unavailable rooms before the user clicks. It is never the mechanism of record. SC-003 verifies
  this by disabling it and confirming the guarantee survives.
- No `SERIALIZABLE` transaction, no advisory lock, and no retry loop is required. The constraint is
  sufficient on its own.

### Rejected alternative

`UNIQUE (room_id, starts_at) WHERE status = 'confirmed'` would also make EC-001 impossible, needs no
extension, and is simpler. It is rejected because it only detects bookings that start at the same
instant: it admits 14:30–15:30 against an existing 14:00–15:00, failing EC-002. Correctness on
partial overlap outweighs the simplicity.

Retained as a documented fallback should `btree_gist` prove unavailable. If that fallback is ever
adopted it is a constitutional amendment, not an implementation detail, and EC-002's expected
behaviour must be rewritten to match — not quietly left failing.

## Indexes

| Index | Purpose |
|---|---|
| `bookings_no_overlap` (GiST, from the constraint) | Serves conflict detection; also accelerates overlap queries |
| `bookings_room_starts_idx` on `(room_id, starts_at) WHERE status = 'confirmed'` | Day-schedule retrieval, FR-012 |
| `rooms_active_idx` on `(is_active) WHERE is_active` | Room listing, FR-002 |

## Derived values — never stored

Per Constitution Principle V's companion rule on domain purity, these are computed by pure functions
with no I/O:

| Value | Definition | Requirement |
|---|---|---|
| `overlaps(a, b)` | `a.starts_at < b.ends_at AND a.ends_at > b.starts_at` | FR-005, FR-006 |
| `isAvailable(room, range)` | No confirmed booking on `room` overlaps `range` | FR-002 |
| `daySchedule(room, date)` | Confirmed bookings whose `starts_at` falls in the room's local `date`, ordered by `starts_at` | FR-012, FR-015 |
| `freeGaps(room, date)` | Complement of the day's bookings within `[opens_at, closes_at)` | FR-013 |
| `suggestAlternatives(range)` | Other rooms free for `range`; nearest free ranges of equal duration on the requested room | FR-010 |

Storing any of these would create a second source of truth that could drift from the bookings table.
They are cheap to compute at the stated scale (A-010).

## State transitions

```
                cancel (organiser, before end)
   confirmed ─────────────────────────────────> cancelled
       │                                            │
       │ cancel by non-organiser → NOT_ORGANISER    │ cancel → no-op, success (EC-017)
       │ cancel after end        → ALREADY_ENDED    │
       └────────────────────────────────────────────┘
```

`confirmed → cancelled` is the only transition. There is no path back: reinstating a cancelled
booking would have to re-acquire the slot, which may since have been taken, so it is expressed as a
new booking that goes through the same guarded insert. Cancellation is idempotent (EC-017), so a
double-click or a retried request cannot manufacture a failure.
