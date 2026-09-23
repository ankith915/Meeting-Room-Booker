# Meeting Room Booker Constitution

## Core Principles

### I. Integrity At The Lowest Layer (NON-NEGOTIABLE)

Booking integrity MUST be enforced by the database, never by application code alone.

Any rule that protects data correctness under concurrency — no double-booking above all — MUST be
expressed as a schema-level constraint. Application-layer checks are permitted only as a
user-experience courtesy (fast feedback, friendly messages); they are NEVER the mechanism of record.

Rationale: a check-then-write sequence in application code has a gap between the read and the write.
Two concurrent requests both pass the check, then both write. No amount of careful application code
closes that gap. The database can close it, so the database MUST own it.

Consequence: if a reviewer deletes every line of validation in the application layer, it MUST still
be impossible to create two overlapping confirmed bookings for the same room.

### II. Specification Before Implementation

The specification is the source of truth. Code is a build artifact derived from it.

Every behaviour MUST appear in `spec.md` before it is implemented. When code and spec disagree, the
code is wrong by definition — either fix the code, or amend the spec first and then fix the code.
Amendments are made through the documented change workflow, never by editing code and backfilling.

### III. Every Edge Case Has A Named Test

Each edge case enumerated in `spec.md` MUST carry a stable identifier (EC-001, EC-002, …) and MUST
have at least one automated test that references that identifier in its test name.

A spec that describes an edge case with no corresponding test is an unmet requirement, not a
completed one. Coverage is measured against the edge-case list, not against lines of code.

### IV. Time Is Stored In UTC, Rendered In Local

All instants MUST be persisted as UTC (`timestamptz`). Timezone conversion happens only at the
presentation boundary, using the timezone of the room being displayed — never the server's timezone
and never the browser's, unless the browser's is explicitly the thing being asked for.

Booking intervals are half-open: `[starts_at, ends_at)`. This MUST hold identically in the schema,
in the domain logic, and in the user interface. A booking ending at 10:00 and one starting at 10:00
do not conflict.

### V. No Silent Failures

Every rejected operation MUST return a typed, machine-readable error code AND a human-readable
message naming the specific limit or conflict that caused it.

Forbidden: swallowing an exception, returning a generic 500 for a known business rule, returning
success with no effect, or telling the user "something went wrong". A user who is refused MUST be
able to tell from the response what to do differently.

## Technology Constraints

- **Data store**: PostgreSQL. Constraints under Principle I depend on PostgreSQL exclusion
  constraints and the `btree_gist` extension. Substituting a store that cannot express those
  constraints is a constitutional amendment, not an implementation detail.
- **Untrusted input parity**: any input that did not come from a validated form — including output
  from a language model — MUST traverse the exact same validation and persistence path as form
  input. No input source gets a privileged shortcut.
- **Domain purity**: availability, overlap, and schedule computation MUST live in pure functions
  with no I/O and no framework imports, so they are testable without a database or a browser.

## Development Workflow

1. `spec.md` is written and reviewed by a human before any implementation task begins.
2. The specification is committed **on its own**, with zero source files in the commit. This commit
   is the auditable proof that the spec preceded the code.
3. Plan and tasks are derived from the approved spec.
4. Implementation proceeds task by task; each edge case's test is written before its fix.
5. Subsequent behaviour changes go through the change-proposal workflow, which updates the living
   specification on archive.

### Quality Gates

- No implementation may begin while any `[NEEDS CLARIFICATION]` marker remains in `spec.md`.
- No task is complete while its referenced edge-case test is absent or failing.
- No change is archived while the specification still describes the pre-change behaviour.

## Governance

This constitution supersedes all other development practices for this project. Where a convenience,
a framework default, or a library's recommended pattern conflicts with a principle here, the
principle wins.

Amendments MUST be recorded as a version bump below, with the rationale written down. Principles
marked NON-NEGOTIABLE may not be amended to weaken them; they may only be strengthened or replaced
by a stricter rule.

All reviews MUST verify compliance with Principles I–V explicitly. Added complexity MUST be
justified against a named principle; complexity that serves no principle is removed.

**Version**: 1.0.0 | **Ratified**: 2026-09-23 | **Last Amended**: 2026-09-23
