---
description: "Task list for Meeting Room Booker implementation"
---

# Tasks: Meeting Room Booker

**Input**: Design documents from `/specs/001-meeting-room-booker/`

**Prerequisites**: [plan.md](./plan.md) ✅, [spec.md](./spec.md) ✅, [data-model.md](./data-model.md) ✅, [research.md](./research.md) ✅, [contracts/](./contracts/) ✅

**Tests**: REQUIRED. Constitution Principle III mandates a named test per edge case, and SC-002
measures it. Test tasks below are not optional.

**Organization**: Grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 — maps the task to a user story for traceability
- Every task cites the FR or EC identifier it satisfies

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization

- [x] T001 Scaffold Next.js 16.3.6 + TypeScript + Tailwind 4 at repository root
- [x] T002 Install dependencies: `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `zod`, `date-fns`, `date-fns-tz`, `vitest`
- [x] T003 [P] Configure ESLint, `vitest.config.ts`, `tests/setup.ts`, `drizzle.config.ts`, `.gitignore` (`.env.local` still pending — needs the Neon string)
- [ ] T003a [P] Add `DESIGN.md` to repository root (chosen from awesome-design-md) as the design system of record

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The correctness guarantee itself. Nothing else can be trusted until this is in place.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [ ] **T004 Verify `btree_gist` is available on Neon** — run `CREATE EXTENSION IF NOT EXISTS btree_gist;` against the real database and confirm success. **This is the first task in the project.** If it fails, stop: R-001's fallback must be adopted and the spec amended before any code is written (plan.md risk 1)
- [ ] T005 Define Drizzle schema in `db/schema.ts` — `rooms` and `bookings` per data-model.md, with all CHECK constraints
- [ ] T006 Generate baseline migration `drizzle/0000_init.sql` via `drizzle-kit generate`
- [ ] **T007 Hand-write `drizzle/0001_exclusion_constraint.sql`** — `CREATE EXTENSION btree_gist` + `ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING GIST (...) WHERE (status = 'confirmed')`. **This file is the embodiment of Constitution I — the single most important file in the repository** (FR-006, FR-007)
- [ ] T008 Apply migrations; create `db/client.ts` using the Neon serverless driver
- [ ] T009 [P] Seed reference rooms in `db/seed.ts` (A-005) — include one room in `Asia/Kolkata` and one in `America/New_York` so EC-013 and EC-014 are testable
- [ ] T010 [P] Define `BookingError` discriminated union and all 12 reason codes in `lib/domain/errors.ts` (FR-011)
- [ ] T011 [P] Implement UTC ↔ room-local conversion in `lib/time.ts` (FR-021, FR-014, EC-013)

**Checkpoint**: The guarantee exists in the database. User story work may now begin.

---

## Phase 3: User Story 1 — Book a room for a time slot (Priority: P1) 🎯 MVP

**Goal**: A user can book a room, and concurrent conflicting bookings are impossible.

**Independent Test**: Book an empty room; attempt an overlapping booking singly and from 50 parallel
clients; confirm exactly one booking exists in both cases.

### Tests for User Story 1 ⚠️

> **Write these FIRST and confirm they FAIL before implementing.**

- [ ] T012 [P] [US1] Assert constraint exists by name — `tests/integration/constraint-present.test.ts`. Fails loudly if a migration ever drops it (plan.md risk 2)
- [ ] **T013 [US1] EC-001 concurrency test** — `tests/concurrency/ec001-simultaneous.test.ts`. 50 parallel `createBooking` calls for one room and range; assert 1 fulfilled, 49 `SLOT_TAKEN`, **and `SELECT count(*) = 1`** (SC-001). **The centrepiece of the demo**
- [ ] T014 [P] [US1] EC-002 partial overlap, EC-003 adjacent, EC-004 other room, EC-005 cancelled-does-not-block — `tests/integration/overlap.test.ts`
- [ ] T015 [P] [US1] EC-006…EC-012 and EC-018 validation tests, one per reason code — `tests/unit/validation.test.ts`
- [ ] T016 [P] [US1] Pure `overlaps()` property tests: symmetry, adjacency, containment — `tests/unit/interval.test.ts`
- [ ] T017 [US1] SC-003 test — disable app-layer availability checking via test flag; assert overlap still impossible

### Implementation for User Story 1

- [ ] T018 [P] [US1] `lib/domain/interval.ts` — `overlaps()`, half-open semantics (FR-005). Pure
- [ ] T019 [P] [US1] `lib/domain/availability.ts` — `isAvailable()` (FR-002). Pure
- [ ] T020 [P] [US1] `lib/validation.ts` — Zod schemas for every rule in EC-006…EC-011
- [ ] T021 [US1] `lib/domain/suggest.ts` — `suggestAlternatives()` (FR-010). Pure. Depends on T018, T019
- [ ] T022 [US1] **`app/actions/create-booking.ts`** per [contracts/create-booking.md](./contracts/create-booking.md) — validate → load room → time rules → INSERT → catch SQLSTATE `23P01` → `SLOT_TAKEN` (FR-004…FR-011). Depends on T018–T021
- [ ] T023 [US1] Catch **only** `23P01`; re-throw everything else. A bare catch is a constitutional violation (Constitution V)
- [ ] T024 [US1] Enrich `SLOT_TAKEN` with conflicting booking detail and alternatives (FR-009, FR-010)
- [ ] T025 [US1] `app/page.tsx` — room list with date/time picker and live availability (FR-002)
- [ ] T026 [US1] Booking form + confirmation, with the submit button disabled while in flight
- [ ] T027 [US1] `SLOT_TAKEN` UI — show who holds the slot and offer alternatives as one-click rebook

**Checkpoint**: US1 fully functional. **EC-001 is demonstrable — this alone is a viable demo.**

---

## Phase 4: User Story 2 — See what is happening in a room today (Priority: P2)

**Goal**: A room's day, in the room's timezone, with the gaps visible.

**Independent Test**: Seed a room with several bookings; verify chronological order, correct local
times, and correct gaps.

### Tests for User Story 2 ⚠️

- [ ] T028 [P] [US2] `freeGaps()` unit tests incl. empty room → one full-window gap (FR-013, US2-3) — `tests/unit/gaps.test.ts`
- [ ] T029 [P] [US2] EC-014 — same schedule under two `TZ` values yields identical local times
- [ ] T030 [P] [US2] EC-013 — DST transition dates in `America/New_York`; durations reflect elapsed real time
- [ ] T031 [P] [US2] FR-015 — a 23:30 room-local booking appears on that room-local date

### Implementation for User Story 2

- [ ] T032 [P] [US2] `lib/domain/schedule.ts` — `daySchedule()` (FR-012, FR-015). Pure
- [ ] T033 [P] [US2] `lib/domain/availability.ts` — `freeGaps()` (FR-013). Pure
- [ ] T034 [US2] `app/actions/queries.ts` — `listAvailability`, `getDaySchedule` per [contracts/list-availability.md](./contracts/list-availability.md)
- [ ] T035 [US2] `app/rooms/[roomId]/page.tsx` — day timeline, bookings and gaps, timezone labelled (FR-012…FR-015)
- [ ] T036 [US2] Book-this-gap affordance routing into the same `createBooking` path

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Cancel a booking and release the slot (Priority: P3)

**Goal**: Cancelling genuinely frees the slot.

**Independent Test**: Create, cancel, then rebook the identical room and range.

### Tests for User Story 3 ⚠️

- [ ] T037 [P] [US3] EC-015 `NOT_ORGANISER`, EC-016 `ALREADY_ENDED` — `tests/integration/cancel.test.ts`
- [ ] T038 [P] [US3] EC-017 — cancelling twice succeeds, changes nothing
- [ ] T039 [P] [US3] FR-020 — cancel then rebook the same range succeeds
- [ ] T040 [P] [US3] FR-022 — cancelled row is retained, not deleted

### Implementation for User Story 3

- [ ] T041 [US3] `app/actions/cancel-booking.ts` per [contracts/cancel-booking.md](./contracts/cancel-booking.md). **Idempotency check must precede the organiser and ended checks** — see contract
- [ ] T042 [US3] `UPDATE ... WHERE id = ? AND status = 'confirmed'` to make concurrent double-cancel a no-op
- [ ] T043 [US3] Cancel control on the schedule view with confirmation

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Design & Polish

**Purpose**: Cross-cutting quality. Depends on all user stories being complete.

- [ ] T044 Apply `DESIGN.md` tokens across all views; build the UI with the Taste skill to avoid generic defaults
- [ ] T045 Impeccable `audit` pass; fix every finding
- [ ] T046 Impeccable `polish` pass
- [ ] T047 [P] Responsive down to 400px; verify no horizontal scroll
- [ ] T048 [P] Loading, empty, and error states for every view (Constitution V)
- [ ] T049 [P] Re-render all four D2 diagrams; confirm none has drifted from the spec
- [ ] T050 Write root `README.md` — the course hand-in document
- [ ] T051 Deploy to Vercel; set `DATABASE_URL`; run T013 against production
- [ ] T052 **Verify SC-002**: every one of EC-001…EC-018 has a passing named test. Any gap is an unmet requirement

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories**
- **T004 blocks T007 blocks everything else.** If `btree_gist` is unavailable the design changes
- **User Stories (Phases 3–5)**: all depend on Phase 2; may then proceed in parallel
- **Polish (Phase 6)**: depends on Phases 3–5

### Within Each User Story

- Tests written and failing before implementation
- Pure domain functions before Server Actions before UI
- Story complete and independently verified before moving to the next priority

### Parallel Opportunities

- T003, T003a together
- T009, T010, T011 together (after T008)
- T014, T015, T016 together; T018, T019, T020 together
- T028–T031 together; T032, T033 together
- T037–T040 together
- Once Phase 2 is done, US1 / US2 / US3 can be staffed in parallel

---

## Implementation Strategy

### MVP First

1. Phase 1 → Phase 2 (**T004 first — verify the extension before anything else**)
2. Phase 3 (US1)
3. **STOP and VALIDATE**: run T013. If 50 parallel requests yield exactly one booking, the core claim
   of this project is proven
4. Demo-ready at this point

### Incremental Delivery

Phase 2 → US1 (MVP, demo) → US2 (demo) → US3 (demo) → Polish. Each story adds value without
breaking the previous ones.

---

## Traceability

| Edge case | Test task | Implementation task |
|---|---|---|
| EC-001 | **T013** | T007, T022 |
| EC-002 | T014 | T007 |
| EC-003 | T014, T016 | T007, T018 |
| EC-004 | T014 | T007 |
| EC-005 | T014 | T007 |
| EC-006…EC-011 | T015 | T020, T022 |
| EC-012 | T015 | T020 |
| EC-013 | T030 | T011 |
| EC-014 | T029 | T011, T035 |
| EC-015, EC-016 | T037 | T041 |
| EC-017 | T038 | T041 |
| EC-018 | T015 | T020, T022 |
| SC-001 | T013 | T007 |
| SC-002 | T052 | all |
| SC-003 | T017 | T007 |

**18 edge cases, 18 covered.** Any row without a passing test is an unmet requirement (Constitution III).

---

## Notes

- `[P]` = different files, no dependencies
- Verify each test fails before implementing against it
- Commit after each task or logical group
- **Do not start Phase 3 until T004 and T007 are done and verified** — every other task assumes the
  guarantee is already in place
