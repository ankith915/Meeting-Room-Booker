# Research: Meeting Room Booker

**Feature**: `001-meeting-room-booker` | **Date**: 2026-09-23 | **Phase**: 0

Every decision below was forced by a specific requirement. Rejected options are recorded with the
reason, so that review can challenge the reasoning rather than just the outcome.

---

## R-001 — How do we make EC-001 impossible rather than unlikely?

**Requirement**: FR-007 — concurrent conflicting requests MUST produce exactly one confirmed
booking, and the guarantee MUST NOT depend on application-layer checking or on request ordering.

### The problem

The obvious implementation is:

```ts
const clash = await db.select()...where(overlaps(...));   // (1) read
if (clash.length) return { error: 'SLOT_TAKEN' };
await db.insert(bookings).values(...);                     // (2) write
```

Between (1) and (2) there is a window. Two requests can both execute (1), both see zero rows, and
both proceed to (2). Neither is buggy in isolation; the bug is the window. It cannot be closed by
being more careful inside application code, because the window *is* the gap between two separate
round trips to the database.

### Options considered

| Option | Closes EC-001? | Handles EC-002 partial overlap? | Cost |
|---|---|---|---|
| **A. `EXCLUDE USING GIST` + `btree_gist`** ✅ **chosen** | Yes — check happens inside the write | Yes — `&&` is true range overlap | Requires an extension |
| B. `UNIQUE (room_id, starts_at)` partial index | Yes | **No** — only catches identical start instants | None |
| C. `SERIALIZABLE` isolation + retry loop | Yes | Yes | Retry logic, serialization failures, harder to reason about |
| D. `SELECT ... FOR UPDATE` on the room row | Yes | Yes | Serialises all bookings per room; lock held across app logic |
| E. Advisory lock keyed on room | Yes | Yes | Integrity lives in app code — violates Constitution I |
| F. Application mutex / queue | No | No | Fails entirely across serverless instances |

### Decision: A

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

**Why A over the others:**

- It is **declarative**. The invariant is stated once, in the schema, in a form that reads almost
  exactly like the sentence in the spec. Options C, D and E all express the invariant as a
  *procedure* that must be correctly repeated at every call site.
- It **cannot be bypassed**. Options C, D and E protect only the code paths that remember to use
  them. A future contributor adding a second insert path silently loses the guarantee. With A, the
  database refuses regardless of who is asking or how. This is Constitution Principle I, and it is
  what SC-003 tests.
- It covers **five edge cases in one declaration** — EC-001, EC-002, EC-003, EC-004, EC-005 — with
  no additional code.
- No retry loop. Option C's serialization failures must be caught and retried, which is a new
  failure mode to test and a new way to violate Principle V by swallowing errors.

**Why B is rejected despite being simpler**: it only detects bookings sharing an exact start
instant. An existing 14:00–15:00 would not block a new 14:30–15:30, failing EC-002. Detecting half
the conflicts is arguably worse than detecting none, because it produces false confidence.

B is retained as a documented fallback **only** if `btree_gist` proves unavailable. Adopting it
would be a constitutional amendment, and EC-002's expected behaviour would have to be rewritten
honestly rather than left silently failing.

**Verification that A is available**: Neon documents `btree_gist` as a supported extension. This is
confirmed as the very first implementation task (T004), before any code depends on it.

### Consequence

Violations raise PostgreSQL SQLSTATE **`23P01`** (`exclusion_violation`). `createBooking` catches
exactly that code — not a bare `catch` — and maps it to `SLOT_TAKEN`.

---

## R-002 — How should time intervals be represented?

**Requirement**: FR-005 (half-open intervals), EC-003 (adjacent bookings allowed), FR-021 (UTC).

**Decision**: `tstzrange(starts_at, ends_at, '[)')` — start inclusive, end exclusive — with both
columns `timestamptz`.

**Why**: the `'[)'` bound argument puts the spec's half-open rule *in the schema*. EC-003 then falls
out of the constraint rather than depending on an application rule that could drift. `timestamptz`
stores an absolute instant, so conflict detection stays exact across DST transitions (EC-013) — the
database compares instants, never wall-clock strings.

**Rejected**: storing `start` + `duration`. Overlap then requires arithmetic at query time and
cannot participate in a GiST exclusion constraint.

**Rejected**: `'[]'` (fully closed). Adjacent bookings would conflict, contradicting EC-003, and a
booking would paradoxically own an instant that the next one also owns.

---

## R-003 — ORM choice

**Requirement**: the hand-written constraint from R-001 must survive migration regeneration.

**Decision**: **Drizzle ORM** with `drizzle-kit` for generated migrations plus hand-written SQL files
for anything it cannot express.

**Why**: Drizzle treats migrations as plain SQL files we own and can edit. `EXCLUDE` constraints and
`CREATE EXTENSION` are not expressible in any TypeScript schema DSL, so the ability to drop to raw
SQL in a numbered migration is a hard requirement, not a preference.

**Rejected**: Prisma. Its migration workflow is more opinionated, and raw-SQL constraints that the
schema file does not know about are more prone to being clobbered on regeneration.

**Risk accepted**: `drizzle-kit generate` could still produce a migration that drops the constraint
if the schema drifts. Mitigated by T012 — an integration test that asserts the constraint exists
*by name* and fails loudly if it does not. A silent loss of the guarantee is the single worst
outcome in this project, so it gets its own test.

---

## R-004 — Timezone handling

**Requirement**: FR-014, FR-015, EC-012, EC-013, EC-014.

**Decision**: store UTC; convert at the presentation boundary with `date-fns-tz`, using the **room's**
IANA timezone.

**Why the room's zone and not the viewer's**: EC-014 requires two people in different offices reading
the same schedule to see identical numbers. If rendering followed the viewer, a meeting would appear
at different times to different people, and "today" would mean different days — making FR-015
ill-defined.

**DST rules** (EC-013): a wall-clock time that does not exist resolves forward to the next valid
instant; a time that occurs twice resolves to its first occurrence. Both are documented in the spec
so the behaviour is specified rather than incidental.

**Rejected**: storing local time plus a zone string. Comparing two local times in different zones
requires conversion at query time, which defeats the index and makes the exclusion constraint
impossible.

---

## R-005 — Application framework and deployment

**Requirement**: A-010 (modest scale), plus a working Vercel deployment for the demo.

**Decision**: Next.js 16 App Router with Server Actions, deployed to Vercel, using the Neon
serverless driver.

**Why**: Server Actions put the guarded write on the server without standing up a separate API
service. The spec describes no external API consumer, so a split frontend/backend would add a
deployment unit and a network hop for no gain.

**Note on serverless and the concurrency test**: serverless functions may run on many instances at
once, which is exactly the condition EC-001 describes — so this deployment model makes the race
*more* likely to occur in reality, not less. That strengthens the argument for R-001: no in-process
lock could ever have worked here.

---

## R-006 — How to prove the guarantee rather than assert it

**Requirement**: SC-001, SC-003.

**Decision**: two tests, both against a real Neon database rather than a mock.

1. **SC-001** — fire 50 concurrent `createBooking` calls for one identical room and range with
   `Promise.all`. Assert exactly 1 fulfilled, 49 refused `SLOT_TAKEN`, **and** `SELECT count(*) = 1`
   afterwards.
2. **SC-003** — repeat with application-layer availability checking disabled via a test flag. The
   result must be unchanged.

**Why the count assertion matters**: response codes alone can lie. A bug that returns 201 to two
callers while writing one row, or returns 409 to both while writing none, would pass a
response-code-only assertion. The stored row count is the only claim that actually matches the
requirement.

**Why not a mock**: the entire guarantee lives in the database. A mocked database would test our
belief about PostgreSQL rather than PostgreSQL, which is precisely the thing under test.

---

## R-007 — Diagramming tool

**Requirement**: the relationship and the race condition must be explainable to a reviewer in
seconds, and diagrams must not drift from the spec.

**Decision**: **D2** (`d2lang.com`), rendered to SVG and PNG, source committed alongside the spec.

**Why D2 over Mermaid**: D2 is built for architecture diagrams specifically — it ships the TALA
layout engine, supports real icons, themes, and `sql_table` and `sequence_diagram` shapes, and
produces output that reads as a designed document rather than default boxes and arrows. Mermaid
renders inline on GitHub, which D2 does not, but that convenience does not outweigh legibility for
the four diagrams that carry this project's central argument.

**Why diagram-as-code at all**: the source is plain text, so diagrams live in git, diff in review,
and are regenerated by a command rather than by someone reopening a drawing tool. A diagram that
cannot be diffed will silently drift from the spec.

**Verified working**: D2 v0.9.0 installed; all four diagrams compile to SVG and PNG. Two practical
gotchas found and worked around — `constraint` is a reserved keyword and cannot be a node id, and
markdown tables need the `|||md ... |||` long block delimiter because `|` otherwise terminates the
block.
