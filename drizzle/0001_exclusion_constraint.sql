-- =============================================================================
-- THE GUARANTEE
--
-- This is the single most important file in the repository.
--
-- It is the literal embodiment of Constitution Principle I: booking integrity
-- is enforced by the database, never by application code alone.
--
-- Spec:    FR-006, FR-007
-- Design:  specs/001-meeting-room-booker/data-model.md
-- Why:     specs/001-meeting-room-booker/research.md  R-001
-- Proof:   SC-001 (tests/concurrency), SC-003 (app checks disabled)
--
-- HAND-WRITTEN. drizzle-kit cannot express EXCLUDE constraints or
-- CREATE EXTENSION, so it will never regenerate this. Never run
-- `drizzle-kit push` against this database: it diffs against db/schema.ts,
-- does not know this constraint exists, and will offer to drop it. Dropping it
-- silently deletes the project's entire correctness guarantee while leaving
-- every test that does not specifically look for it still passing.
-- =============================================================================

-- btree_gist lets a B-tree operator (= on uuid) share a GiST index with a
-- range operator (&& on tstzrange). Without it the constraint below cannot be
-- created. Supported by Neon.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- The spec states the invariant in English:
--
--   "Within a single room, the intervals of all confirmed bookings are
--    mutually non-overlapping."
--
-- Each qualifier in that sentence maps to exactly one clause below.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING GIST (
    -- "within a single room" -> bookings in different rooms never conflict.
    -- EC-004.
    "room_id" WITH =,

    -- "non-overlapping" -> && is true range overlap, so a PARTIAL overlap
    -- conflicts too, not just an identical range. EC-002.
    --
    -- The '[)' bound argument is FR-005's half-open interval written directly
    -- into the schema: start inclusive, end exclusive. That is what makes
    -- 09:00-10:00 and 10:00-11:00 legal. EC-003 therefore falls out of the
    -- schema rather than depending on application code that could drift.
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  -- "confirmed" -> a PARTIAL constraint. Cancelled rows are not indexed at all,
  -- so they cannot conflict with anything and their slot is free the instant
  -- the cancellation commits. No cleanup job, no cache to invalidate. EC-005.
  WHERE ("status" = 'confirmed');
--> statement-breakpoint

COMMENT ON CONSTRAINT "bookings_no_overlap" ON "bookings" IS
  'Constitution I. Makes EC-001 (simultaneous booking) impossible rather than unlikely: PostgreSQL evaluates this inside the write under an index lock, so there is no check-then-write gap to exploit. Violations raise SQLSTATE 23P01, which createBooking maps to SLOT_TAKEN. Also covers EC-002 (partial overlap), EC-003 (adjacent allowed, via the [) bounds), EC-004 (per room) and EC-005 (cancelled frees the slot). DO NOT DROP.';
