# Feature Specification: Meeting Room Booker

**Feature Branch**: `001-meeting-room-booker`

**Created**: 2026-09-23

**Status**: Draft — awaiting review

**Input**: User description: "Meeting room booking system. List available rooms, book a time slot, prevent double-booking, show today's schedule per room. Edge case: what happens when two people try to book the same slot at the same moment?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Book a room for a time slot (Priority: P1)

An employee needs a room for a meeting. They pick a date and a time range, see which rooms are
genuinely free for that entire range, choose one, give the meeting a title, and confirm. The booking
either succeeds and is immediately visible to everyone, or is refused with a reason they can act on.

The refusal path matters as much as the success path: two colleagues may be looking at the same
free slot at the same instant, and both may click Confirm. The system must ensure that this results
in exactly one meeting, not two, and that the person who lost is told clearly and offered somewhere
else to go.

**Why this priority**: This is the entire product. A room booker that can hand the same room to two
people at once has failed at the only job that distinguishes it from a shared spreadsheet. Every
other story is a convenience layered on top of this guarantee.

**Independent Test**: Can be fully tested by booking a slot on an empty room, confirming it appears,
then attempting a second booking that overlaps it — from a single client, and again from two clients
firing simultaneously — and confirming exactly one booking exists in both cases.

**Acceptance Scenarios**:

1. **Given** room "Aurora" has no bookings on 2026-09-24, **When** a user books 14:00–15:00, **Then** the booking is confirmed and appears on Aurora's schedule for that date
2. **Given** a confirmed booking on "Aurora" 14:00–15:00, **When** a user attempts to book 14:00–15:00 on Aurora, **Then** the request is refused with reason `SLOT_TAKEN` and the existing booking's title and time are shown
3. **Given** a confirmed booking on "Aurora" 14:00–15:00, **When** a user attempts to book 14:30–15:30 on Aurora, **Then** the request is refused with reason `SLOT_TAKEN` because the ranges partially overlap
4. **Given** a confirmed booking on "Aurora" 14:00–15:00, **When** a user books 15:00–16:00 on Aurora, **Then** the booking is confirmed, because a booking's end instant is not part of the booking
5. **Given** room "Aurora" is free for 2026-09-24 14:00–15:00, **When** two booking requests for that exact room and range are submitted so close together that neither has completed when the other begins, **Then** exactly one is confirmed, the other is refused with reason `SLOT_TAKEN`, and exactly one confirmed booking exists for that room and range afterwards
6. **Given** a user has been refused with `SLOT_TAKEN`, **When** the refusal is displayed, **Then** it offers at least one alternative — another room free for the same range, or the same room's nearest free range of equal duration — whenever such an alternative exists

---

### User Story 2 - See what is happening in a room today (Priority: P2)

Someone walking toward a room, or planning their afternoon, wants to see that room's day at a glance:
what is booked, by whom, and — critically — where the gaps are, so they can judge whether there is
room for their 30-minute call before the next meeting starts.

**Why this priority**: Booking is the transaction; the schedule is how people trust the system. It is
required by the brief but is read-only, so it cannot compromise the P1 guarantee. It is second
because a correct booker with no schedule view is still usable; a schedule view over a broken booker
is not.

**Independent Test**: Can be fully tested by seeding a room with several bookings and verifying the
day view lists them in chronological order with correct local times and correctly identifies the
free gaps between them.

**Acceptance Scenarios**:

1. **Given** room "Aurora" has bookings 09:00–10:00 and 14:00–15:00 today, **When** a user opens Aurora's schedule, **Then** both appear in chronological order with their titles and organisers
2. **Given** the same room and bookings, **When** the schedule is displayed, **Then** the free periods within business hours are shown, including the gap 10:00–14:00
3. **Given** a room with no bookings today, **When** a user opens its schedule, **Then** the room is shown as free for the whole of business hours rather than showing an empty list with no explanation
4. **Given** a room whose timezone differs from the viewer's, **When** the schedule is displayed, **Then** all times are shown in the room's local timezone and the timezone is labelled

---

### User Story 3 - Cancel a booking and release the slot (Priority: P3)

Plans change. The organiser cancels, and the slot must become genuinely available to everyone else
immediately — not merely hidden from the schedule while still blocking new bookings.

**Why this priority**: Without cancellation the system silently degrades as mistaken bookings
accumulate and permanently sterilise slots. It is P3 because the system delivers value for a full
day of use before this becomes painful, so it can ship after P1 and P2.

**Independent Test**: Can be fully tested by creating a booking, cancelling it, then successfully
creating a new booking for the identical room and range.

**Acceptance Scenarios**:

1. **Given** a confirmed booking on "Aurora" 14:00–15:00, **When** its organiser cancels it, **Then** its status becomes cancelled and it no longer appears in the room's schedule
2. **Given** a cancelled booking on "Aurora" 14:00–15:00, **When** any user books Aurora 14:00–15:00, **Then** the booking is confirmed, because cancelled bookings do not reserve time
3. **Given** a confirmed booking, **When** a user who is not its organiser attempts to cancel it, **Then** the request is refused with reason `NOT_ORGANISER`
4. **Given** a booking whose end time has already passed, **When** anyone attempts to cancel it, **Then** the request is refused with reason `ALREADY_ENDED`

---

### Edge Cases

Each case carries a stable identifier. Per Constitution Principle III, every identifier below MUST
have at least one automated test naming it.

#### Concurrency and conflict

- **EC-001 — Simultaneous identical booking.** Two requests for the same room and the same range are
  in flight at once, neither having completed when the other started. **Expected**: exactly one is
  confirmed; the other is refused `SLOT_TAKEN`; exactly one confirmed booking exists afterwards. The
  guarantee holds regardless of how many requests race, and holds even if all application-layer
  availability checking is removed.
- **EC-002 — Partial overlap.** A requested range overlaps an existing confirmed booking on the same
  room without being identical to it (starts inside it, ends inside it, or wholly contains it).
  **Expected**: refused `SLOT_TAKEN`. Overlap, not equality, is the test.
- **EC-003 — Adjacent bookings.** A requested range begins exactly when an existing booking ends, or
  ends exactly when an existing booking begins. **Expected**: confirmed. Intervals are half-open;
  the end instant belongs to no one.
- **EC-004 — Same range, different room.** A requested range is identical to an existing booking's
  but on a different room. **Expected**: confirmed. The conflict rule is scoped per room.
- **EC-005 — Cancelled booking does not reserve.** A cancelled booking occupies the requested range.
  **Expected**: confirmed. Only confirmed bookings reserve time.

#### Input validity

- **EC-006 — Non-positive duration.** The requested end is earlier than, or equal to, the requested
  start. **Expected**: refused `INVALID_RANGE`. Zero-length bookings are not permitted; a
  zero-length range overlaps nothing and would otherwise bypass conflict detection entirely.
- **EC-007 — Booking in the past.** The requested start is earlier than the current instant.
  **Expected**: refused `PAST_BOOKING`.
- **EC-008 — Unknown or inactive room.** The requested room does not exist, or exists but is marked
  inactive. **Expected**: refused `ROOM_NOT_FOUND` and `ROOM_INACTIVE` respectively. These are
  distinguished because they need different user guidance.
- **EC-009 — Outside business hours.** The requested range begins before, or ends after, the room's
  bookable hours in the room's local timezone. **Expected**: refused `OUTSIDE_BUSINESS_HOURS`, and
  the message names the actual permitted window.
- **EC-010 — Excessive duration.** The requested range is longer than the maximum permitted booking
  length. **Expected**: refused `DURATION_EXCEEDED`, and the message names the maximum.
- **EC-011 — Empty or over-long title.** The meeting title is blank, whitespace-only, or exceeds the
  permitted length. **Expected**: refused `INVALID_TITLE`.
- **EC-018 — Booked too far ahead.** The requested start is more than the booking horizon into the
  future. **Expected**: refused `TOO_FAR_AHEAD`, and the message names the horizon. Without this,
  A-009's 90-day limit would be an assumption that no code enforced.

#### Time handling

- **EC-012 — Range crossing local midnight.** A requested range would span the room's local midnight.
  **Expected**: refused `OUTSIDE_BUSINESS_HOURS`, since business hours end before midnight. A day's
  schedule is bounded by the room's local day, not the viewer's.
- **EC-013 — Daylight-saving transition.** A requested range falls in a period where the room's local
  clock skips forward or repeats an hour. **Expected**: the booking is stored and compared as an
  absolute instant, so conflict detection remains exact. A wall-clock time that does not exist
  resolves forward to the next valid instant; a wall-clock time that occurs twice resolves to its
  first occurrence. Displayed durations reflect elapsed real time, which may differ from the
  apparent clock difference.
- **EC-014 — Viewer in a different timezone.** The person reading a schedule is in a different
  timezone from the room. **Expected**: times display in the room's timezone with the zone labelled,
  so two people in different offices reading the same screen see identical numbers.

#### Cancellation

- **EC-015 — Cancelling someone else's booking.** **Expected**: refused `NOT_ORGANISER`.
- **EC-016 — Cancelling a booking that already ended.** **Expected**: refused `ALREADY_ENDED`.
  History is not rewritten.
- **EC-017 — Cancelling an already-cancelled booking.** **Expected**: succeeds without error and
  without changing anything. Cancellation is idempotent, so a duplicate click or a retried request
  cannot produce a spurious failure.

## Requirements *(mandatory)*

### Functional Requirements

#### Rooms

- **FR-001**: System MUST maintain a set of rooms, each with a name, a capacity, a location, a
  timezone, and an active/inactive flag.
- **FR-002**: System MUST list rooms and, for a user-supplied date and time range, indicate for each
  room whether it is free for that entire range.
- **FR-003**: System MUST exclude inactive rooms from booking, while continuing to display their
  existing bookings in historical schedules.

#### Booking

- **FR-004**: Users MUST be able to request a booking by specifying a room, a start instant, an end
  instant, a title, and an organiser identity.
- **FR-005**: System MUST treat a booking as occupying the half-open interval from its start
  inclusive to its end exclusive.
- **FR-006**: System MUST refuse any booking whose interval overlaps an existing confirmed booking
  on the same room.
- **FR-007**: System MUST guarantee that concurrent conflicting booking requests result in exactly
  one confirmed booking. This guarantee MUST NOT depend on application-layer checking, on request
  ordering, or on the absence of simultaneity.
- **FR-008**: System MUST validate, and refuse with the specified distinct reason codes: non-positive
  duration (`INVALID_RANGE`), start in the past (`PAST_BOOKING`), unknown room (`ROOM_NOT_FOUND`),
  inactive room (`ROOM_INACTIVE`), range outside bookable hours (`OUTSIDE_BUSINESS_HOURS`), duration
  above maximum (`DURATION_EXCEEDED`), invalid title (`INVALID_TITLE`), and start beyond the
  booking horizon (`TOO_FAR_AHEAD`).
- **FR-009**: System MUST, on refusing with `SLOT_TAKEN`, include the conflicting booking's title,
  organiser, and time range in the response.
- **FR-010**: System MUST, on refusing with `SLOT_TAKEN`, suggest alternatives where any exist:
  other rooms free for the requested range, and the nearest free ranges of equal duration on the
  requested room.
- **FR-011**: System MUST return a typed reason code and a human-readable message for every refusal,
  and MUST NOT return a generic failure for any condition enumerated in this specification.

#### Schedule

- **FR-012**: System MUST display, for a given room and date, all confirmed bookings in chronological
  order with title, organiser, and local start and end times.
- **FR-013**: System MUST compute and display the free periods between bookings within bookable
  hours.
- **FR-014**: System MUST render all times in the room's timezone and label that timezone.
- **FR-015**: System MUST determine a room's "today" using the room's local date, not the viewer's.

#### Cancellation

- **FR-016**: Organisers MUST be able to cancel their own confirmed bookings.
- **FR-017**: System MUST refuse cancellation by anyone other than the organiser (`NOT_ORGANISER`).
- **FR-018**: System MUST refuse cancellation of a booking whose end instant has passed
  (`ALREADY_ENDED`).
- **FR-019**: System MUST treat cancellation of an already-cancelled booking as a success with no
  effect.
- **FR-020**: System MUST ensure cancelled bookings never prevent a new booking of the same range.

#### Data handling

- **FR-021**: System MUST persist all instants in UTC and convert only for display.
- **FR-022**: System MUST retain cancelled bookings rather than deleting them, so that the history of
  a room remains inspectable.
- **FR-023**: System MUST record the instant at which each booking was created.

### Key Entities *(include if feature involves data)*

- **Room**: A bookable physical space. Attributes: display name (unique among active rooms),
  capacity as a positive integer, location description, IANA timezone identifier, bookable-hours
  window expressed in local time, active flag. A room exists independently of any booking.

- **Booking**: A claim on one room for one half-open time interval. Attributes: the room it belongs
  to, start instant, end instant, title, organiser identity, status (confirmed or cancelled),
  creation instant. A booking cannot exist without a room.

- **Relationship**: One Room has many Bookings; each Booking belongs to exactly one Room. The
  relationship carries the system's central invariant: **within a single room, the intervals of all
  confirmed bookings are mutually non-overlapping.** Bookings in different rooms are wholly
  independent and may overlap freely.

- **Derived — Availability**: Not stored. A room is available for a candidate interval when no
  confirmed booking on that room overlaps it. Two intervals overlap when each starts strictly before
  the other ends.

- **Derived — Day schedule**: Not stored. The confirmed bookings of one room whose start instants
  fall within one local day, ordered by start instant, together with the complementary free periods
  within bookable hours.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Under 50 concurrent requests for one identical room and time range, exactly 1 is
  confirmed and 49 are refused with `SLOT_TAKEN`; the stored count of confirmed bookings for that
  room and range is exactly 1. Zero tolerance — a single duplicate is a total failure.
- **SC-002**: Every edge case EC-001 through EC-018 has at least one automated test that names its
  identifier, and all such tests pass.
- **SC-003**: With all application-layer availability checks disabled, attempting to create an
  overlapping confirmed booking still fails. This demonstrates the guarantee does not rest on
  application code.
- **SC-004**: A user can complete a booking — from opening the app to seeing confirmation — in under
  60 seconds and no more than 4 interactions.
- **SC-005**: 100% of refusals carry a typed reason code and a message naming the specific conflict
  or limit; 0% return a generic failure message.
- **SC-006**: A room's schedule for a given day renders in under 2 seconds for a room holding up to
  50 bookings that day.
- **SC-007**: Two viewers in different timezones reading the same room's schedule see identical
  displayed times.

## Assumptions

Reasonable defaults chosen where the source description was silent. Each is a candidate for
challenge during review.

- **A-001**: Identity is lightweight. An organiser is identified by a name or email captured at
  booking time; there is no authentication system, no accounts, and no password. Cancellation
  authority is checked against that captured identifier. A real deployment would require
  authentication, and that is explicitly out of scope for this version.
- **A-002**: Bookable hours are 08:00–18:00 in the room's local time, every day including weekends.
  Weekend and holiday closure is out of scope.
- **A-003**: Maximum booking duration is 8 hours. Minimum is 15 minutes.
- **A-004**: Booking times are entered on 15-minute boundaries.
- **A-005**: Rooms are seeded as reference data. Creating, editing, and deleting rooms through the
  interface is out of scope for this version.
- **A-006**: Bookings are single occurrences. Recurring bookings are out of scope.
- **A-007**: There are no attendees, invitations, notifications, or calendar integrations. A booking
  reserves a room; it does not invite anyone.
- **A-008**: Editing a booking's time is out of scope. To move a meeting, cancel and rebook — which
  keeps every path to reserving time flowing through the same single guarded operation.
- **A-009**: Bookings may be made at most 90 days ahead.
- **A-010**: Expected scale is tens of rooms and hundreds of bookings per day — enough to require
  correctness under concurrency, not enough to require sharding or caching.

## Out of Scope

Stated explicitly so that review can confirm these were decided rather than forgotten:
authentication and user accounts; recurring bookings; attendee invitations and notifications;
external calendar synchronisation; room creation and administration; approval workflows for
restricted rooms; equipment and catering requests; check-in and no-show release; analytics and
utilisation reporting.
