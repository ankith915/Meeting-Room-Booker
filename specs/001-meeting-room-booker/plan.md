# Implementation Plan: Meeting Room Booker

**Branch**: `001-meeting-room-booker` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-meeting-room-booker/spec.md`

## Summary

Deliver a room booking application whose defining property is that concurrent conflicting bookings
are impossible, not merely unlikely.

The whole design turns on one decision: the non-overlap invariant is enforced by a PostgreSQL
`EXCLUDE USING GIST` constraint rather than by an application-layer check. A check-then-write in
application code has a gap between the read and the write in which a competing request can slip
through; the constraint has no such gap, because the check happens inside the write while holding an
index lock. Everything else — the framework, the ORM, the UI — is ordinary, and is chosen mainly to
stay out of the way of that one guarantee.

Delivered as a single Next.js application with Server Actions talking to Neon Postgres via Drizzle.
Domain computation (overlap, gaps, availability) lives in pure functions with no I/O so the rules
from the spec can be tested without a database.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24.19.0 (installed and verified)

**Primary Dependencies**: Next.js 15 (App Router, Server Actions), Drizzle ORM, `@neondatabase/serverless`, Zod, Tailwind CSS, `date-fns` + `date-fns-tz`

**Storage**: Neon serverless PostgreSQL. Requires the `btree_gist` extension — confirmed supported by Neon

**Testing**: Vitest. Pure-domain unit tests plus integration tests against a real Neon branch database

**Target Platform**: Web, deployed to Vercel; modern evergreen browsers down to 400px viewport width

**Project Type**: Web application, single deployable (no separate backend service)

**Performance Goals**: Day schedule renders < 2s for a room with 50 bookings (SC-006); booking round trip < 1s at p95

**Constraints**: Correctness under concurrency is absolute (SC-001 admits zero duplicates). Domain logic must be I/O-free and framework-free. All instants stored UTC (FR-021)

**Scale/Scope**: Tens of rooms, hundreds of bookings/day (A-010). 3 user stories, 17 edge cases, 23 functional requirements, 4 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status | Evidence |
|---|---|---|---|
| **I. Integrity at the lowest layer** (NON-NEGOTIABLE) | Is the non-overlap invariant enforced in the schema, with application checks demoted to UX only? | ✅ PASS | `EXCLUDE USING GIST` in [data-model.md](./data-model.md). SC-003 verifies the guarantee survives with app checks disabled |
| **II. Specification before implementation** | Does every planned behaviour trace to a numbered requirement? | ✅ PASS | Every task in tasks.md cites an FR or EC identifier. No planned behaviour lacks a spec line |
| **III. Every edge case has a named test** | Does each of EC-001…EC-017 have a test task? | ✅ PASS | tasks.md contains a test task per identifier; SC-002 is the acceptance measure |
| **IV. UTC storage, local rendering; half-open intervals** | Is `[start, end)` expressed identically in schema, domain, and UI? | ✅ PASS | `tstzrange(..., '[)')` in schema; `overlaps()` uses strict `<` in domain; UI renders end-exclusive. All columns `timestamptz` |
| **V. No silent failures** | Does every refusal carry a typed code and a specific message? | ✅ PASS | 9 reason codes defined in FR-008/FR-011; `BookingError` discriminated union; SC-005 measures 100% coverage |

**Technology constraints check**: PostgreSQL retained (required by Principle I). Domain purity
satisfied by `lib/domain/` having no imports from `db/`, `next/`, or `react`. Untrusted-input parity
is not yet exercised in this feature — it becomes live when natural-language booking is added as a
follow-up change, and that change must route model output through this same `createBooking` path.

**Post-Phase-1 re-check**: ✅ PASS — no design decision taken during Phase 1 weakened any principle.
The one genuine tension (whether to drop `btree_gist` for a simpler unique constraint) was resolved
*in favour of* the principle, with the simpler option recorded as a rejected alternative.

**Result: PASS — no violations. Complexity Tracking below is empty, as required.**

## Project Structure

### Documentation (this feature)

```text
specs/001-meeting-room-booker/
├── spec.md              # Feature specification (input)
├── plan.md              # This file
├── data-model.md        # Phase 1 output — entities, invariant, constraint
├── research.md          # Phase 0 output — decisions and rejected alternatives
├── quickstart.md        # Phase 1 output — how to run and verify locally
├── diagrams/            # Phase 1 output — D2 architecture diagrams
│   ├── system-architecture.d2
│   ├── domain-model.d2
│   ├── booking-flow.d2
│   ├── race-condition.d2
│   └── out/             # Rendered SVGs
├── contracts/           # Phase 1 output — Server Action contracts
│   ├── create-booking.md
│   ├── cancel-booking.md
│   └── list-availability.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── layout.tsx
├── page.tsx                      # Room list + availability picker (US1, FR-002)
├── rooms/[roomId]/page.tsx       # Day schedule with gaps (US2, FR-012..FR-015)
└── actions/
    ├── create-booking.ts         # Guarded insert; maps 23P01 → SLOT_TAKEN (FR-006..FR-011)
    └── cancel-booking.ts         # Organiser + ended checks (FR-016..FR-020)

lib/
├── domain/                       # PURE. No I/O, no framework imports (Constitution IV)
│   ├── interval.ts               # overlaps(), half-open semantics (FR-005)
│   ├── availability.ts           # isAvailable(), freeGaps() (FR-002, FR-013)
│   ├── schedule.ts               # daySchedule() in room-local time (FR-015)
│   ├── suggest.ts                # suggestAlternatives() (FR-010)
│   └── errors.ts                 # BookingError union, 9 reason codes (FR-011)
├── validation.ts                 # Zod schemas (EC-006..EC-011)
└── time.ts                       # UTC ↔ room-local conversion (FR-021, EC-013)

db/
├── schema.ts                     # Drizzle table definitions
├── client.ts                     # Neon connection
└── seed.ts                       # Reference rooms (A-005)

drizzle/
├── 0000_init.sql                 # Generated by drizzle-kit
└── 0001_exclusion_constraint.sql # HAND-WRITTEN — btree_gist + EXCLUDE

components/                       # UI, styled per DESIGN.md

tests/
├── unit/                         # EC-002..EC-017 against pure domain
├── integration/                  # Constraint behaviour against real Neon
└── concurrency/
    └── ec001-simultaneous.test.ts # EC-001 / SC-001 — the centrepiece
```

**Structure Decision**: Single Next.js application, not a split frontend/backend. Server Actions put
the guarded write on the server without a separate API service to deploy, and the spec describes no
external API consumer. The one structural rule that matters is the `lib/domain/` boundary: it may
not import from `db/`, `next/`, or `react`, which is what makes the spec's rules testable in
isolation and keeps them from being quietly reimplemented inside a React component.

`drizzle/0001_exclusion_constraint.sql` is hand-written and must stay that way — `drizzle-kit` does
not generate `EXCLUDE` constraints or `CREATE EXTENSION`. This file is the literal embodiment of
Constitution Principle I and is the single most important file in the repository.

## Phase 0 — Research decisions

Recorded in full in [research.md](./research.md). Summary:

| Question | Decision | Why |
|---|---|---|
| How to make EC-001 impossible? | PostgreSQL `EXCLUDE USING GIST` with `btree_gist` | Closes the check-then-write gap inside the write. Covers EC-001…EC-005 in one declaration |
| Why not `SERIALIZABLE` + retry? | Rejected | Correct, but adds retry logic and a failure mode of its own for a guarantee the constraint already gives declaratively |
| Why not an application mutex / advisory lock? | Rejected | Violates Principle I — integrity would live in application code and vanish if that code is bypassed |
| How to represent intervals? | `tstzrange(starts_at, ends_at, '[)')` | Encodes FR-005's half-open rule in the schema, so EC-003 cannot drift from the spec |
| Drizzle or Prisma? | Drizzle | Plain SQL migrations we fully control, needed for the hand-written constraint |
| Timezone library? | `date-fns-tz` | IANA-aware conversion for FR-014/EC-013 without pulling in a heavy datetime stack |

## Phase 1 — Design outputs

- [data-model.md](./data-model.md) — entities, the invariant, the constraint, rejected alternative
- `contracts/` — one document per Server Action: input shape, success shape, every failure code
- `diagrams/` — D2 source plus rendered SVG (see below)
- [quickstart.md](./quickstart.md) — how to run, seed, and verify each edge case locally

### Diagrams

Authored in **D2** rather than Mermaid. D2 is purpose-built for architecture diagrams, ships the
TALA layout engine, and supports real icons and theming, so the output reads as a designed document
rather than default boxes-and-arrows. Source is plain text, so diagrams live in git, diff in review,
and cannot drift silently from the spec.

```powershell
d2 --theme 4 --layout tala --sketch diagrams/system-architecture.d2 diagrams/out/system-architecture.svg
```

| Diagram | Shows |
|---|---|
| `system-architecture.d2` | Browser → Server Action → Drizzle → Neon, with the constraint as the trust boundary |
| `domain-model.d2` | Room ⟶ Booking, the invariant, derived values |
| `booking-flow.d2` | The full request path including all 9 refusal branches |
| `race-condition.d2` | EC-001 on a timeline: why check-then-write fails and the constraint does not |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Constitution Check passed with no violations. No entries.

*(Note: requiring the `btree_gist` extension might look like added complexity, but it is not a
violation — Principle I mandates schema-level enforcement, and the extension is the mechanism that
delivers it. The genuinely simpler alternative was rejected for being incorrect on EC-002, which is
a correctness decision, not a complexity trade.)*

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `btree_gist` unavailable on the Neon tier in use | Principle I cannot be satisfied as designed | Verified supported in Neon's docs; confirm with `CREATE EXTENSION` as the very first implementation task, before any code depends on it |
| Drizzle regenerates migrations and drops the hand-written constraint | Silent loss of the entire guarantee | Constraint lives in a separately numbered migration; an integration test asserts the constraint exists by name and fails loudly if it does not |
| Serverless connection pooling under the concurrency test | Flaky EC-001 test, or a false pass | Use the Neon serverless driver's pooled connection; assert the final stored row count, not just the response codes — a count of 1 is the real proof |
| DST correctness (EC-013) hard to verify | Latent wrong-hour bugs | Seed one room in a DST-observing zone (`America/New_York`) alongside `Asia/Kolkata`, and pin test clocks to known transition dates |
