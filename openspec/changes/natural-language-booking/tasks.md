# Tasks

Each task cites the requirement or edge case it satisfies, and states how completion is verified.

> **Revised**: provider changed from Anthropic to Groq (`openai/gpt-oss-120b`) after the user
> supplied Groq credentials. `scripts/probe-groq.ts` verified the extraction mechanism against the
> live API before these tasks were rewritten. See design.md D3.

Ordering follows the migration plan in [design.md](./design.md): pure domain first, then the parser
behind its interface, then the UI. Nothing user-visible ships until the guarantees are tested.

## 1. Dependency and configuration

- [ ] 1.1 Add `openai` to `package.json` (used against Groq's OpenAI-compatible endpoint, D3); verify `npx tsc --noEmit` still passes and the existing 116 tests are unaffected by running `npm test`
- [x] 1.2 Add `GROQ_API_KEY` and `GROQ_MODEL` to `.env.local` (gitignored); verify `git check-ignore .env.local` reports it ignored and `git grep gsk_` finds nothing tracked. Document both in `specs/001-meeting-room-booker/quickstart.md`
- [ ] 1.3 Add `PARSER` constants — base URL, model id from `GROQ_MODEL`, default duration 60 minutes, confidence threshold — in one place next to `POLICY`; verify by grepping that no model id, base URL or magic duration appears anywhere else

## 2. Pure domain — intent types and room matching

These require no database, no network, and no API key.

- [ ] 2.1 Define `BookingIntent`, `ParseContext` and `ParseResult` in `lib/domain/intent.ts`, with the Zod schema as the single source of the intent shape (D3); verify `npx tsc --noEmit` passes and the file imports nothing from `db/`, `next/` or `react`
- [ ] 2.2 Implement `resolveRoomHint(fragment, rooms)` returning exact match, ambiguous candidates, or no match (D1); verify with unit tests in `tests/unit/intent.test.ts` covering an exact name, a case-insensitive match, a fragment matching several rooms, and a fragment matching none
- [ ] 2.3 Implement confidence banding and `classifyAmbiguity()` (D8); verify a unit test asserts a below-threshold parse is classified `LOW_CONFIDENCE`
- [ ] 2.4 **EC-019** — a room fragment matching more than one room yields `AMBIGUOUS_ROOM` carrying every candidate; verify by a unit test named for EC-019
- [ ] 2.5 **EC-024** — an intent with a start but no end applies the default duration and flags that it was assumed; verify by a unit test named for EC-024 asserting both the computed end and the flag
- [ ] 2.6 Add the new reason codes to `lib/domain/errors.ts` — `UNPARSEABLE`, `AMBIGUOUS_ROOM`, `MISSING_END_TIME`, `PARSER_UNAVAILABLE`, `LOW_CONFIDENCE`; verify the existing exhaustiveness tests still pass

## 3. Date and time resolution

- [ ] 3.1 Implement `resolveIntentTiming(components, room)` mapping relative day expressions plus a clock time to absolute instants using the existing `lib/time.ts` helpers (D2); verify unit tests cover `today`, `tomorrow`, a named weekday, and an absolute date
- [ ] 3.2 **EC-023** — a relative date resolves against the ROOM's local calendar, not the viewer's; verify by a unit test named for EC-023 using `Asia/Kolkata` and `America/New_York` with an injected clock
- [ ] 3.3 Verify a resolved range crossing a DST transition still produces exact instants, by a unit test using a known `America/New_York` transition date

## 4. Parser behind an interface

- [ ] 4.1 Define the `IntentParser` interface and `StubIntentParser` in `lib/server/parse-intent.ts` (D6); verify a unit test drives a full parse-to-intent flow through the stub with no network access
- [ ] 4.2 Implement `GroqIntentParser` using the `openai` SDK with `baseURL` set to Groq and `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`, the schema DERIVED from the Zod schema rather than hand-maintained (D3); verify `npx tsc --noEmit` passes and a live parse returns a valid intent
- [ ] 4.3 Put the user's text in a `user` message and operator instructions in the top-level `system` field, never concatenated (D4); verify by a unit test asserting the request body places the raw text in a user turn
- [ ] 4.4 **EC-020** — a response that is not valid JSON, or is valid JSON failing the Zod schema, becomes `UNPARSEABLE`; verify by a unit test named for EC-020 covering both cases via the stub
- [ ] 4.5 **EC-025** — a missing API key, `OpenAI.RateLimitError`, `OpenAI.AuthenticationError` or `OpenAI.APIConnectionError` becomes `PARSER_UNAVAILABLE`; verify by a unit test named for EC-025 for each case, asserting errors are caught by SDK type most-specific-first and never by a bare catch
- [ ] 4.6 Add a small live-parser test suite skipped when `GROQ_API_KEY` is absent; verify the full suite passes with the variable unset

## 5. Server action and the guarded path

- [ ] 5.1 Add `app/actions/parse-intent.ts` as a thin `'use server'` wrapper returning a serialisable result; verify no client component imports the parser or the SDK, by grep
- [ ] 5.2 Confirmed intents call the existing `createBookingAction` unchanged; verify by grepping that `lib/server/bookings.ts`, `lib/validation.ts`, `db/schema.ts` and `drizzle/0001_exclusion_constraint.sql` have no diff in this change
- [ ] 5.3 **EC-022** — an intent naming a non-existent room is refused `ROOM_NOT_FOUND` by the existing path; verify by an integration test named for EC-022 that bypasses `resolveRoomHint` and feeds a fabricated id straight to the booking path
- [ ] 5.4 Verify every v1 rule still applies to intent-originated bookings, by an integration test asserting `PAST_BOOKING`, `DURATION_EXCEEDED`, `OUTSIDE_BUSINESS_HOURS` and `ROOM_INACTIVE` for intent input
- [ ] 5.5 **EC-026** — text containing embedded instructions produces an ordinary intent and changes nothing about validation; verify by a test named for EC-026 asserting the resulting booking is still subject to every rule and still requires confirmation

## 6. The guarantee still holds

- [ ] 6.1 **EC-021** — an intent-originated booking racing a manual booking for the same room and range yields exactly one confirmed booking; verify by a test in `tests/concurrency/` named for EC-021 asserting a stored count of exactly 1
- [ ] 6.2 Re-run the whole concurrency suite and verify SC-001 and SC-003 still pass unchanged by running `npm run test:concurrency`

## 7. Interface

- [ ] 7.1 Add `components/NaturalLanguageBooking.tsx` with a free-text input above the existing search controls; verify the page builds with `npm run build` and the manual form is unchanged
- [ ] 7.2 Render the resolved candidate — room name, date, local start and end, timezone, title — never a paraphrase of the input (D5); verify by inspecting the rendered page that the confirmation shows resolved values
- [ ] 7.3 Wire confirm and reject; verify nothing is written until confirm is pressed, by checking the stored row count after a reject
- [ ] 7.4 Allow editing any field before confirming, routing edits through the same validation; verify an edited candidate outside business hours is still refused
- [ ] 7.5 Render the ambiguity prompt for `AMBIGUOUS_ROOM` with the candidate rooms selectable; verify by driving the stub parser to return an ambiguous result
- [ ] 7.6 Render `UNPARSEABLE` and `PARSER_UNAVAILABLE` as a plain message plus a link to the manual form, pre-filled with whatever was understood; verify the manual form still books successfully with the API key unset

## 8. Close out

- [ ] 8.1 Verify every new edge case EC-019 through EC-026 has a passing test naming it, by running `npm test -- --reporter=verbose` and grepping for each identifier
- [ ] 8.2 Run the full suite and `npx tsc --noEmit`; verify 0 failures and no type errors
- [ ] 8.3 Update `README.md` with the new capability and the required environment variables (`GROQ_API_KEY`, `GROQ_MODEL`); verify the documented setup steps work from a clean clone
- [ ] 8.4 Run `openspec validate natural-language-booking --strict` and verify it reports no issues
- [ ] 8.5 Archive the change with `openspec archive natural-language-booking` and verify the requirements now appear under `openspec/specs/natural-language-booking/`
