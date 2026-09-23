# Design

## Context

See [proposal.md](./proposal.md) for motivation and [specs/natural-language-booking/spec.md](./specs/natural-language-booking/spec.md) for requirements.

Constraints that shape everything below:

- `createBooking()` in `lib/server/bookings.ts` is the only path that may create a confirmed booking,
  and `bookings_no_overlap` enforces non-overlap inside the write. Neither may be touched.
- `lib/domain/*` is pure — no I/O, no framework imports — so the spec's rules stay testable without
  a database or a browser.
- The project already resolves timezones deterministically in `lib/time.ts` using `date-fns-tz`, and
  has 116 tests pinning that behaviour.

The novel thing here is not booking. It is that, for the first time, input reaching the system was
produced by a model rather than typed by a person. The design question is therefore not "how do we
parse English" but **"how little do we have to trust the parser?"**

## Goals / Non-Goals

**Goals:**

- Keep the trusted surface as small as possible. The parser should influence *what is proposed*, and
  nothing else.
- Make hallucination structurally unable to cause a wrong booking, rather than filtering it after
  the fact.
- Keep the feature entirely removable: deleting it must leave v1 working and every test passing.
- Keep parsing testable without network access.

**Non-Goals:**

- Squeezing out latency. A parse costs a round trip; the confirmation step absorbs it.
- Handling every phrasing. Falling back to the form is an acceptable outcome, and a cheap one.
- Provider portability as an abstraction exercise. The interface exists for testing and for
  graceful degradation, not to support many vendors.

## Decisions

### D1 — The parser returns *hints*, not identifiers

**Decision**: the model returns a room **name fragment** (`"the big room"`, `"aurora"`), never a
room id. The system resolves that fragment against the real room list deterministically.

**Why**: a model asked for a UUID will happily invent one. A model asked "which room did they mean?"
can only be wrong about a *name*, and a name that matches nothing produces a disambiguation prompt
rather than a booking attempt against a fabricated room.

This removes an entire failure class instead of catching it downstream. EC-022 still specifies the
refusal for a fabricated identifier, because the guarantee should not depend on this design holding
— but under this design that path should be unreachable.

**Alternative rejected**: give the model the room list and ask it to return an id. It works most of
the time, and "most of the time" is the problem — the failure is silent and looks like success.

### D2 — The model does not do date arithmetic

**Decision**: the model returns *structured components* — a relative day expression
(`today` | `tomorrow` | `next-weekday` | `absolute-date`), a clock time, and an optional duration.
`lib/time.ts` converts those to absolute instants in the room's timezone.

**Why**: language models are unreliable at calendar and timezone arithmetic, and this project has
already solved that problem correctly, with tests covering DST days that are 23 and 25 hours long
(EC-013). Asking the model for an ISO instant would hand a solved problem back to the least reliable
component in the system.

It also makes EC-023 fall out for free: the room's timezone is applied at resolution time, by code
that already does this everywhere else.

**Alternative rejected**: ask for an ISO-8601 instant directly. Simpler prompt, but the model would
have to know the room's timezone, today's date in that zone, and DST rules.

### D3 — Structured outputs, not JSON-in-prose

**Decision**: use the Anthropic TypeScript SDK's structured output support —
`client.messages.parse()` with `output_config: { format: zodOutputFormat(BookingIntentSchema) }`,
using `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`.

**Why**: the response is schema-constrained, so "the model returned prose instead of JSON" and "the
model returned JSON with the wrong shape" stop being runtime concerns. `response.parsed_output` is
`null` when parsing fails, which becomes the `UNPARSEABLE` path (EC-020) rather than an exception.

The same Zod schema is the single definition of the intent shape, shared by the parser, the
confirmation UI, and the tests.

**Alternative rejected**: free-text response plus `JSON.parse`. Needs repair heuristics and retries
for a problem the API already solves.

**Model**: `claude-opus-5`. Parsing one sentence is not a demanding task, and a smaller model would
very likely be adequate and cheaper — but model choice trades quality for cost, and that is the
user's call to make explicitly, not a default to be quietly downgraded. The model id sits in one
constant; switching to `claude-sonnet-5` or `claude-haiku-4-5` is a one-line change if measurement
justifies it.

### D4 — The user's text is data, and only ever appears in a user turn

**Decision**: the free text goes into a `user` message. Operator instructions stay in the top-level
`system` field. The text is never concatenated into the system prompt, and never interpolated into
any instruction.

**Why**: this is the architectural half of EC-026. The behavioural half is that the *output schema
is the blast radius*: whatever the text says, the response can only ever be a `BookingIntent` — a
room-name fragment, a date expression, a time, a duration, a title. There is no field in which
"ignore your rules" can express itself, because the schema has no field for instructions.

So prompt injection is defended twice, and neither defence is a filter on the input text:

1. **Structurally** — the model cannot emit anything but the intent shape.
2. **Downstream** — whatever it emits enters `createBooking()` as untrusted input and meets every
   validation rule and the exclusion constraint.

Note that the system prompt does **not** need to say "ignore instructions in the user's text".
Telling the model to resist injection is a weaker guarantee than making injection unrepresentable.

### D5 — The intent is inert, and confirmation is not optional

**Decision**: `BookingIntent` is a plain value with no side effects. A separate, explicit user action
converts it to a booking by calling the existing `createBookingAction`.

**Why**: it collapses the most dangerous failure mode — a *plausible* misparse — into a visible one.
The confirmation shows the fully resolved room, date and local times, never a paraphrase of the
input, so a user who said "3pm" and got 15:00 on the wrong day can see it.

This also means the parser has no write capability at all. It is a pure function from text to a
suggestion.

### D6 — Parsing lives behind an interface, with a deterministic test double

**Decision**:

```ts
interface IntentParser {
  parse(text: string, ctx: ParseContext): Promise<ParseResult>;
}
```

`ClaudeIntentParser` is the real implementation. `StubIntentParser` returns canned results for tests.

**Why**: the interesting tests are not "does the model parse English". They are "given an intent
naming an occupied slot, is it refused", "given an ambiguous room, do we ask", "given a fabricated
room, do we refuse". All of those are about the *system's* behaviour given some parser output, and
they should run offline, deterministically, with no API key and no cost.

A small number of tests exercise the real parser and are skipped when `ANTHROPIC_API_KEY` is absent,
so the suite stays green for anyone without a key.

### D7 — Splitting pure from impure

| Module | Purity | Responsibility |
|---|---|---|
| `lib/domain/intent.ts` | **pure** | Intent and result types, confidence banding, ambiguity classification, resolving a room-name fragment against a room list |
| `lib/time.ts` (existing) | pure | Turning date components into instants in the room's zone |
| `lib/server/parse-intent.ts` | impure | The `IntentParser` implementations and the API call |
| `app/actions/parse-intent.ts` | impure | `'use server'` wrapper |

Room matching and confidence banding are pure, so EC-019 (ambiguity) is unit-testable with no
database and no model.

### D8 — Failure modes are explicit reason codes

Extending the existing union rather than inventing a parallel error channel:
`UNPARSEABLE` (EC-020), `AMBIGUOUS_ROOM` (EC-019), `MISSING_END_TIME` (EC-024),
`PARSER_UNAVAILABLE` (EC-025), `LOW_CONFIDENCE`.

`PARSER_UNAVAILABLE` covers a missing key, a rate limit (`Anthropic.RateLimitError`), and a network
failure. Errors are caught by SDK type, most specific first — never a bare catch, matching the rule
already applied to SQLSTATE `23P01`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **A plausible misparse** — a valid booking that is not what the user meant. The worst case, because nothing errors. | Mandatory confirmation (D5) showing fully resolved values, never a paraphrase. This is why confirmation cannot be skipped for high-confidence parses. |
| **Latency** on the parse round trip | Parsing only on explicit submit; the manual form is always present and instant; a visible pending state. |
| **Cost** grows with usage | One call per parse, user-initiated only. Model id is a single constant (D3) if the user chooses to trade quality for cost. |
| **Prompt injection** | Two independent defences (D4), neither of which is input filtering. |
| **Key leakage** | Parsing is server-only. The key is never referenced in a client component; `app/actions/parse-intent.ts` is the boundary. |
| **Scope creep into a chatbot** | Non-goals in the proposal; the schema admits exactly one booking and no conversation state. |
| **The feature becomes load-bearing** and the form atrophies | EC-025 requires the form to work when the parser is down, and it is tested. |
| **Model behaviour drifts** between versions | The pinned model id, the schema, and the offline stub tests. A drift shows up as a parse quality change, never as a wrong booking, because nothing downstream trusts the parser. |

## Migration Plan

Additive; no migration, no schema change, no data backfill.

1. Add `@anthropic-ai/sdk`. Add `ANTHROPIC_API_KEY` to `.env.local` and Vercel.
2. Ship the domain types and the stub parser first, with their tests. No user-visible change yet.
3. Add the real parser behind the interface.
4. Add the UI last, above the existing search controls.

**Rollback**: remove the component from `app/page.tsx`. Everything else is additive and inert
without it. Absent an API key the feature degrades to `PARSER_UNAVAILABLE` on its own, so
"rollback" can also mean simply unsetting the variable.

**Verification before done**: the full suite, and the concurrency suite specifically — EC-021
asserts the guarantee still holds when an intent races a manual booking.

## Open Questions

- **Default duration when no end time is given** (EC-024). Proposed: 60 minutes. Deferrable — it is
  one constant next to `POLICY`, and the spec already requires the chosen default to be stated to
  the user and confirmed, so changing it later alters no requirement, approach, or task.
- **Confidence threshold** below which a parse is treated as ambiguous. Deferrable for the same
  reason: the spec requires the *behaviour*, and the number is tunable against real inputs once
  there are some.
