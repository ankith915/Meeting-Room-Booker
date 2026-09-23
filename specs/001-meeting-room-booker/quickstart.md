# Quickstart: Meeting Room Booker

**Feature**: `001-meeting-room-booker` | **Phase**: 1

How to run the app and verify each specified behaviour by hand. Written before implementation, so it
doubles as an acceptance script — if a step here cannot be performed, a requirement is unmet.

> **Status: not yet implemented.** Nothing in "Run it" works until Phase 3 of [tasks.md](./tasks.md)
> is complete. The verification steps are the target.

## Prerequisites

Already installed and verified on this machine:

| Tool | Version |
|---|---|
| Node.js | 24.19.0 |
| npm | 11.17.0 |
| Python | 3.11.9 |
| Git | 2.55.0 |
| `specify` (Spec Kit) | 1.0.10 |
| `openspec` | 1.13.1 |
| `d2` | 0.9.0 |

Still needed: a **Neon** project and its connection string.

## Setup

```powershell
npm install

# .env.local  (gitignored — never commit)
# DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

npm run db:migrate          # applies 0000_init.sql and 0001_exclusion_constraint.sql
                            # NEVER `drizzle-kit push` — it does not know about the
                            # hand-written constraint and will offer to drop it
npm run seed                # reference rooms (A-005)
npm run dev                 # http://localhost:3000
```

### Verify the guarantee exists — do this first

Before trusting anything else:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'bookings_no_overlap';
```

One row, containing `EXCLUDE USING gist` and `WHERE (status = 'confirmed')`. **No row means the
project's central claim is false**, whatever the UI appears to do. T012 automates this check.

## Verify each edge case by hand

Rooms seeded: **Aurora** (`Asia/Kolkata`), **Borealis** (`Asia/Kolkata`), **Meridian**
(`America/New_York`, for DST).

### The headline case — EC-001

**Automated (authoritative):**

```powershell
npm run test:concurrency
```

Passes only when 50 parallel requests yield 1 confirmed, 49 `SLOT_TAKEN`, and a stored count of
exactly 1.

**By hand (the demo):**

1. Open the booking form for Aurora, tomorrow 14:00–15:00, in **two browser windows** side by side
2. Fill both in identically
3. Click Confirm in both as close to simultaneously as you can manage
4. **Expected**: one shows a confirmation; the other shows `SLOT_TAKEN`, names who took it, and
   offers alternatives
5. Reload Aurora's schedule — **exactly one** booking at 14:00–15:00

**Prove it is the database, not the UI — EC-001 / SC-003:**

```sql
-- against a slot that already has a confirmed booking
INSERT INTO bookings (room_id, title, organiser, starts_at, ends_at, status)
VALUES ('<aurora-id>', 'Direct insert', 'tester',
        '2026-09-24T08:30:00Z', '2026-09-24T09:30:00Z', 'confirmed');
```

**Expected**: `ERROR: conflicting key value violates exclusion constraint "bookings_no_overlap"`
(SQLSTATE `23P01`). This bypasses every line of application code and is still refused. **This is the
most convincing thing to show a reviewer.**

### Conflict and overlap

| Case | Steps | Expected |
|---|---|---|
| EC-002 partial overlap | Book Aurora 14:00–15:00, then try 14:30–15:30 | `SLOT_TAKEN` |
| EC-003 adjacent | With 14:00–15:00 booked, book 15:00–16:00 | **Confirmed** |
| EC-004 other room | With Aurora 14:00–15:00 booked, book Borealis 14:00–15:00 | Confirmed |
| EC-005 cancelled | Book, cancel, rebook the same range | Confirmed |

### Input validity

| Case | Steps | Expected |
|---|---|---|
| EC-006 | end ≤ start | `INVALID_RANGE` |
| EC-007 | a start in the past | `PAST_BOOKING` |
| EC-008 | unknown / inactive room id | `ROOM_NOT_FOUND` / `ROOM_INACTIVE` |
| EC-009 | 07:00–08:00 (before opening) | `OUTSIDE_BUSINESS_HOURS`, message names 08:00–18:00 |
| EC-010 | a 9-hour range | `DURATION_EXCEEDED`, message names 8h |
| EC-011 | blank title | `INVALID_TITLE` |
| EC-012 | 23:00–01:00 | `OUTSIDE_BUSINESS_HOURS` |
| EC-018 | a start more than 90 days ahead | `TOO_FAR_AHEAD`, message names the horizon |

### Time handling

- **EC-013 (DST)** — book **Meridian** across a US DST transition. Conflict detection stays exact;
  displayed duration reflects elapsed real time, which may differ from the apparent clock difference.
- **EC-014 (viewer timezone)** — open Aurora's schedule, change your OS timezone, reload. Times are
  **unchanged** and labelled `Asia/Kolkata`.

### Cancellation

| Case | Steps | Expected |
|---|---|---|
| EC-015 | Cancel as a different organiser | `NOT_ORGANISER` |
| EC-016 | Cancel a booking that already ended | `ALREADY_ENDED` |
| EC-017 | Cancel the same booking twice | Both succeed; nothing changes |

### Schedule

- **FR-013** — with 09:00–10:00 and 14:00–15:00 booked, the gap **10:00–14:00** is shown
- **US2-3** — an unbooked room shows one gap covering 08:00–18:00, not an empty list

## Full test suite

```powershell
npm test                  # all
npm run test:unit         # pure domain — no database
npm run test:integration  # constraint behaviour — needs DATABASE_URL
npm run test:concurrency  # EC-001 / SC-001
```

**SC-002 requires every one of EC-001…EC-018 to have a passing named test.** Confirm with:

```powershell
npm test -- --reporter=verbose | Select-String "EC-0"
```

Eighteen distinct identifiers must appear. A missing one is an unmet requirement, not a missing
test.

## Regenerate diagrams

```powershell
cd specs/001-meeting-room-booker/diagrams
d2 system-architecture.d2 out/system-architecture.svg
d2 domain-model.d2        out/domain-model.svg
d2 booking-flow.d2        out/booking-flow.svg
d2 race-condition.d2      out/race-condition.svg
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `type "tstzrange" does not exist` | Not PostgreSQL | The design requires Postgres (Constitution, Technology Constraints) |
| `could not access file "btree_gist"` | Extension unavailable | Stop. See plan.md risk 1 and research.md R-001 — this changes the design |
| Concurrency test passes with count > 1 | Constraint missing | Run the `pg_constraint` query above; re-apply `0001` |
| Two bookings created by hand | Constraint missing | Same — the UI cannot cause this if the constraint exists |
| Schedule times look shifted | Viewer timezone leaking in | `lib/time.ts` must use the **room's** timezone (FR-014) |
