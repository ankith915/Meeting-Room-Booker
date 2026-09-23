# Proposal

## Why

Booking a room currently takes four interactions: pick a date, pick a start time, pick an end time,
then pick a room. People do not think in those terms — they think *"the big room tomorrow 3 to 4"*.
The gap between how someone states an intention and how the form demands it is the main friction
left in the product.

This is also the first change to go through OpenSpec rather than Spec Kit, and it is deliberately
chosen to test the hardest property the system claims: that **every** route to reserving a room is
guarded, including one whose input comes from a language model rather than a validated form.

## What Changes

- **New**: a free-text booking box. The user types one sentence; the system proposes a concrete
  booking (room, start instant, end instant, title) and shows it for confirmation.
- **New**: a `BookingIntent` — a *parsed candidate*, never a reservation. It holds what the parser
  believes the user meant, plus a confidence signal and any ambiguity it could not resolve.
- **New**: a confirmation step. A parsed intent is always shown to the user before anything is
  written. Nothing is booked directly from free text.
- **New**: ambiguity handling. A room name matching several rooms, or a phrase the parser cannot
  resolve, produces a disambiguation prompt or a fall-back to the existing form — never a guess
  silently acted upon.
- **Unchanged**: the manual booking form. It remains the primary path and the fallback.
- **Unchanged**: every validation rule, every reason code, and the exclusion constraint.

Not a breaking change. No existing behaviour is removed or altered.

### Does this touch the booking write path?

**No — and that is the central design decision.**

The parser produces a `BookingIntent`, which is *inert*. Converting an intent into a booking calls
the existing `createBooking()` in `lib/server/bookings.ts`, unchanged, with the same arguments the
form would have supplied. No second insert path is added.

The guarantee is preserved because it never depended on the caller in the first place:

- **EC-001…EC-005** are enforced by `bookings_no_overlap` inside the write. The constraint does not
  know or care whether the row came from a form, a model, or `psql`.
- **EC-006…EC-018** are enforced by `createBookingSchema` and `checkTimeRules`, which the intent
  path re-enters from the top.
- A model that hallucinates a room id, a start in the past, a nine-hour meeting, or a slot someone
  else holds is refused by exactly the same code and the same reason codes as a person typing the
  same thing into the form.

This is the constitution's untrusted-input parity rule made concrete: **model output is treated as
untrusted user input, because that is what it is.**

## Capabilities

### New Capabilities

- `natural-language-booking`: turning one free-text sentence into a reviewable booking candidate —
  parsing, ambiguity resolution, confirmation, and the guarantee that a candidate is never a
  reservation until it has traversed the existing guarded write path.

### Modified Capabilities

None. No existing requirement changes.

> Note for reviewers: `openspec/specs/` is currently empty because v1 was specified with Spec Kit,
> whose artifacts live in `specs/001-meeting-room-booker/`. OpenSpec tracks behaviour from the point
> it was adopted, so this change's archive will create the first entry there. The v1 requirements
> remain authoritative in their Spec Kit location; this proposal does not restate them.

## Impact

**New code**
- `lib/domain/intent.ts` — pure. Intent shape, confidence banding, ambiguity classification.
- `lib/server/parse-intent.ts` — the parser boundary, behind an interface so the provider is swappable.
- `app/actions/parse-intent.ts` — thin `'use server'` wrapper.
- `components/NaturalLanguageBooking.tsx` — input, parsed-candidate preview, confirm/edit controls.

**Modified**
- `app/page.tsx` — adds the free-text box above the existing search controls.
- `.env.local` / Vercel env — one new API key.

**Untouched, deliberately**
- `lib/server/bookings.ts`, `lib/validation.ts`, `db/schema.ts`, and
  `drizzle/0001_exclusion_constraint.sql`. If this change required editing any of them to work, that
  would be evidence the guarantee was weaker than claimed.

**Dependencies**: one SDK for the model provider. **Cost**: one model call per parse, on user
action only. **Latency**: parsing is user-visible; the confirmation step absorbs it, and the manual
form stays available and instant.

**Risk**: a parser that is wrong in a *plausible* way — a correctly-formed booking that is not what
the user meant. Mitigated by mandatory confirmation showing the fully resolved room, date and local
times before anything is written, never a paraphrase of the input.

## Non-goals

- **Conversational booking.** One sentence in, one candidate out. No dialogue state, no memory
  across turns beyond a single disambiguation prompt.
- **Cancelling or rescheduling by text.** Reservation is the only verb.
- **Natural-language queries** ("when is Aurora free?"). Reading is not booking.
- **Voice input.**
- **Removing or de-emphasising the manual form.** It stays the primary path.
- **Multi-room or recurring bookings.** Recurrence is out of scope project-wide (A-006).
- **Attendees or invitations.** Out of scope project-wide (A-007).
- **Any change to authentication.** There is still none (A-001).
