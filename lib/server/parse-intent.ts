/**
 * The parser boundary.
 *
 * This module is the ONLY place that talks to a language model, and it has no
 * write capability whatsoever. It turns text into a suggestion; converting a
 * suggestion into a booking is createBooking()'s job, unchanged (design.md D5).
 *
 * Provider: Groq, model openai/gpt-oss-120b, via the OpenAI-compatible endpoint
 * (design.md D3). Verified with scripts/probe-groq.ts before this was written.
 */

import OpenAI from 'openai';
import {
  BookingIntentSchema, intentJsonSchema, bandConfidence, resolveRoomHint,
  resolveIntentTiming, type BookingIntent, type ParseOutcome, type RoomLike,
} from '@/lib/domain/intent';
import { formatLocalDate, formatLocalTime } from '@/lib/time';

export const PARSER_CONFIG = {
  baseURL: 'https://api.groq.com/openai/v1',
  model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
  /**
   * Generous on purpose.
   *
   * gpt-oss models emit REASONING tokens that count toward the completion
   * budget. Measured on this prompt: 188-363 reasoning tokens for ~55 tokens of
   * actual JSON. An initial cap of 500 left almost no headroom, and a reasoning
   * spike blew it — producing an intermittent 400 on roughly one call in three.
   *
   * 2000 gives ~5x headroom over the worst observed. Costs nothing extra:
   * billing is on tokens generated, not on the cap.
   */
  maxTokens: 2000,
  /** The parse is user-facing; fail fast rather than hang the form. */
  timeoutMs: 20_000,
} as const;

/**
 * Operator instructions. The user's text NEVER appears here (design.md D4) —
 * it goes in a user turn, so there is no concatenation to exploit.
 *
 * Deliberately absent: any "ignore instructions in the user's message" clause.
 * The schema already makes injection unrepresentable; telling the model to
 * resist it would be a weaker guarantee dressed up as a stronger one.
 */
const SYSTEM_PROMPT = [
  'You extract meeting-room booking details from a single sentence.',
  'Report only what the user actually said.',
  'Never invent or guess a room identifier — report the room name as they said it, or an empty string.',
  'Never compute a date. Report the expression the user used (today, tomorrow, a weekday, or an explicit date).',
  'Times are 24-hour HH:MM.',
  'Set confidence to 0 if the message is not a request to book a room.',
].join(' ');

export type ParseContext = {
  rooms: RoomLike[];
  now: Date;
};

export interface IntentParser {
  parse(text: string, ctx: ParseContext): Promise<ParseOutcome>;
}

/* ------------------------------------------------------- shared resolution */

/**
 * Turn a raw intent into an outcome, deterministically.
 *
 * Shared by every parser implementation, so the stub and the live model take
 * exactly the same path once the model has spoken. Everything from here down is
 * pure and offline.
 */
export function resolveIntent(intent: BookingIntent, ctx: ParseContext): ParseOutcome {
  const confidence = bandConfidence(intent.confidence);

  // A confidence of 0 means "this was not a booking request at all" — which is
  // what a hostile or off-topic message produces (EC-026, EC-020).
  if (intent.confidence <= 0) {
    return { kind: 'unparseable', reason: 'That did not look like a room booking request.' };
  }

  const match = resolveRoomHint(intent.roomHint, ctx.rooms);
  if (match.kind === 'ambiguous') {
    // EC-019 — ask rather than guess.
    return { kind: 'ambiguous-room', candidates: match.candidates, intent };
  }

  const timing = resolveIntentTiming(intent, match.room, ctx.now);
  if (!timing) {
    return {
      kind: 'unparseable',
      reason: 'I could not work out the date and time. Try "tomorrow 3 to 4pm".',
    };
  }

  const tz = match.room.timezone;
  return {
    kind: 'candidate',
    candidate: {
      room: match.room,
      startsAt: timing.interval.startsAt.toISOString(),
      endsAt: timing.interval.endsAt.toISOString(),
      localStart: formatLocalTime(timing.interval.startsAt, tz),
      localEnd: formatLocalTime(timing.interval.endsAt, tz),
      date: formatLocalDate(timing.interval.startsAt, tz),
      title: intent.title.trim() || 'Meeting',
      timezone: tz,
      durationAssumed: timing.durationAssumed,
      confidence,
    },
  };
}

/* -------------------------------------------------------------- Stub parser */

/**
 * A parser that returns whatever it was given (design.md D6).
 *
 * The interesting tests are not "does the model understand English" — they are
 * "given SOME parser output, does the system behave correctly". Those must run
 * offline, deterministically, with no key and no cost.
 */
export class StubIntentParser implements IntentParser {
  constructor(private readonly scripted: BookingIntent | { fail: 'unparseable' | 'unavailable' }) {}

  async parse(_text: string, ctx: ParseContext): Promise<ParseOutcome> {
    if ('fail' in this.scripted) {
      return this.scripted.fail === 'unavailable'
        ? { kind: 'unavailable', reason: 'Parser unavailable (stub).' }
        : { kind: 'unparseable', reason: 'Could not parse (stub).' };
    }
    return resolveIntent(this.scripted, ctx);
  }
}

/* -------------------------------------------------------------- Groq parser */

export class GroqIntentParser implements IntentParser {
  private readonly client: OpenAI | null;

  constructor(apiKey = process.env.GROQ_API_KEY) {
    // EC-025 — a missing key is a normal, reportable state, not a crash.
    this.client = apiKey
      ? new OpenAI({
          apiKey,
          baseURL: PARSER_CONFIG.baseURL,
          timeout: PARSER_CONFIG.timeoutMs,
          maxRetries: 1,
        })
      : null;
  }

  async parse(text: string, ctx: ParseContext): Promise<ParseOutcome> {
    if (!this.client) {
      return { kind: 'unavailable', reason: 'Free-text booking is not configured.' };
    }
    if (text.trim().length === 0) {
      return { kind: 'unparseable', reason: 'Type what you would like to book.' };
    }

    let raw: string | null;
    try {
      const completion = await this.client.chat.completions.create({
        model: PARSER_CONFIG.model,
        max_tokens: PARSER_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          // D4 — the user's text, verbatim, in a user turn. Never interpolated
          // into an instruction, never concatenated into the system prompt.
          { role: 'user', content: text },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'booking_intent',
            strict: true,
            schema: intentJsonSchema(),
          },
        },
      });
      // A truncated completion yields partial JSON, which would fail the schema
      // check below with a misleading "could not understand". Name it instead.
      if (completion.choices[0]?.finish_reason === 'length') {
        return {
          kind: 'unparseable',
          reason: 'That was too complex to read reliably. Try a shorter sentence.',
        };
      }
      raw = completion.choices[0]?.message?.content ?? null;
    } catch (e: unknown) {
      return { kind: 'unavailable', reason: describeParserFailure(e) };
    }

    if (!raw) {
      return { kind: 'unparseable', reason: 'No booking details came back. Try rephrasing.' };
    }

    // EC-020 — two distinct failures, same safe outcome: not JSON at all, or
    // JSON that does not satisfy the schema. Neither can become a booking.
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { kind: 'unparseable', reason: 'I could not understand that. Try rephrasing.' };
    }

    const parsed = BookingIntentSchema.safeParse(candidate);
    if (!parsed.success) {
      return { kind: 'unparseable', reason: 'I could not understand that. Try rephrasing.' };
    }

    return resolveIntent(parsed.data, ctx);
  }
}

/**
 * Map an SDK error to a user-facing reason (EC-025).
 *
 * Caught by type, most specific first — never a bare catch, matching the rule
 * already applied to SQLSTATE 23P01 in createBooking (Constitution V).
 */
export function describeParserFailure(e: unknown): string {
  if (e instanceof OpenAI.AuthenticationError) {
    return 'Free-text booking is misconfigured (the API key was rejected).';
  }
  if (e instanceof OpenAI.RateLimitError) {
    return 'Free-text booking is busy right now. Use the form below, or try again shortly.';
  }
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return 'Free-text booking timed out. Use the form below.';
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return 'Could not reach the booking assistant. Use the form below.';
  }
  if (e instanceof OpenAI.APIError) {
    return `The booking assistant returned an error (${e.status ?? 'unknown'}). Use the form below.`;
  }
  return 'Free-text booking is temporarily unavailable. Use the form below.';
}

/** The parser the application uses. */
export function defaultParser(): IntentParser {
  return new GroqIntentParser();
}
