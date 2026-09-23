import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import {
  StubIntentParser, GroqIntentParser, resolveIntent, describeParserFailure,
  type ParseContext,
} from '@/lib/server/parse-intent';
import { PARSER, type BookingIntent, type RoomLike } from '@/lib/domain/intent';

const KOLKATA = 'Asia/Kolkata';

const rooms: RoomLike[] = [
  { id: 'a', name: 'Aurora', timezone: KOLKATA, opensAt: '08:00', closesAt: '18:00', isActive: true },
  { id: 'b', name: 'Borealis', timezone: KOLKATA, opensAt: '08:00', closesAt: '18:00', isActive: true },
  { id: 'c', name: 'Boardroom', timezone: KOLKATA, opensAt: '08:00', closesAt: '18:00', isActive: true },
];

const ctx: ParseContext = { rooms, now: new Date('2026-09-24T03:00:00.000Z') };

const intent = (over: Partial<BookingIntent> = {}): BookingIntent => ({
  roomHint: 'Aurora',
  dayExpression: 'tomorrow',
  weekday: 'none',
  absoluteDate: '',
  startTime: '14:00',
  endTime: '15:00',
  title: 'Design review',
  confidence: 0.9,
  ...over,
});

describe('resolveIntent() — the deterministic half', () => {
  it('produces a fully resolved candidate', async () => {
    const outcome = await new StubIntentParser(intent()).parse('anything', ctx);
    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') return;

    const c = outcome.candidate;
    expect(c.room.name).toBe('Aurora');
    expect(c.date).toBe('2026-09-25');
    expect(c.localStart).toBe('14:00');
    expect(c.localEnd).toBe('15:00');
    expect(c.timezone).toBe(KOLKATA);
    expect(c.title).toBe('Design review');
    expect(c.confidence).toBe('confident');
  });

  it('D5: the candidate is inert — it carries no booking id and reserves nothing', () => {
    const outcome = resolveIntent(intent(), ctx);
    if (outcome.kind !== 'candidate') throw new Error('expected candidate');
    expect(outcome.candidate).not.toHaveProperty('id');
    expect(outcome.candidate).not.toHaveProperty('status');
  });

  it('EC-019: an ambiguous room hint asks instead of guessing', () => {
    const outcome = resolveIntent(intent({ roomHint: 'Bo' }), ctx);
    expect(outcome.kind).toBe('ambiguous-room');
    if (outcome.kind !== 'ambiguous-room') return;
    expect(outcome.candidates.map((r) => r.name).sort()).toEqual(['Boardroom', 'Borealis']);
    // The rest of the intent survives, so the user only has to answer the room.
    expect(outcome.intent.startTime).toBe('14:00');
  });

  it('EC-024: a missing end time is flagged as assumed, not silently filled', () => {
    const outcome = resolveIntent(intent({ endTime: '' }), ctx);
    if (outcome.kind !== 'candidate') throw new Error('expected candidate');
    expect(outcome.candidate.durationAssumed).toBe(true);
    expect(outcome.candidate.localStart).toBe('14:00');
    expect(outcome.candidate.localEnd).toBe('15:00'); // 60-minute default
  });

  it('EC-020: an unresolvable date yields unparseable, never a guessed booking', () => {
    const outcome = resolveIntent(intent({ dayExpression: 'unknown' }), ctx);
    expect(outcome.kind).toBe('unparseable');
  });

  it('EC-020: a missing start time yields unparseable', () => {
    const outcome = resolveIntent(intent({ startTime: '' }), ctx);
    expect(outcome.kind).toBe('unparseable');
  });

  it('EC-026: confidence 0 — the model saying "not a booking" — is unparseable', () => {
    // This is what the live model returns for a prompt-injection attempt; the
    // schema forces the refusal into a normal field rather than free text.
    const outcome = resolveIntent(
      intent({ confidence: 0, roomHint: '', dayExpression: 'unknown', startTime: '' }),
      ctx,
    );
    expect(outcome.kind).toBe('unparseable');
  });

  it('a below-threshold parse is still surfaced, but banded uncertain', () => {
    const outcome = resolveIntent(intent({ confidence: 0.2 }), ctx);
    if (outcome.kind !== 'candidate') throw new Error('expected candidate');
    expect(outcome.candidate.confidence).toBe('uncertain');
    expect(PARSER.confidenceThreshold).toBeGreaterThan(0.2);
  });

  it('defaults an empty title rather than booking an untitled meeting', () => {
    const outcome = resolveIntent(intent({ title: '  ' }), ctx);
    if (outcome.kind !== 'candidate') throw new Error('expected candidate');
    expect(outcome.candidate.title).toBe('Meeting');
  });

  it('a range outside business hours still resolves — createBooking owns the refusal', () => {
    const outcome = resolveIntent(intent({ startTime: '06:00', endTime: '07:00' }), ctx);
    // Reporting it here and refusing it there keeps ONE source of truth for the
    // rule (EC-009), rather than two that could disagree.
    expect(outcome.kind).toBe('candidate');
  });
});

describe('StubIntentParser — offline behaviour (D6)', () => {
  it('EC-020: scripted unparseable', async () => {
    const outcome = await new StubIntentParser({ fail: 'unparseable' }).parse('x', ctx);
    expect(outcome.kind).toBe('unparseable');
  });

  it('EC-025: scripted unavailable', async () => {
    const outcome = await new StubIntentParser({ fail: 'unavailable' }).parse('x', ctx);
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('GroqIntentParser — configuration and failure mapping', () => {
  it('EC-025: no API key reports unavailable rather than throwing', async () => {
    const outcome = await new GroqIntentParser('').parse('book aurora at 3', ctx);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toMatch(/not configured/i);
  });

  it('empty input is rejected without calling the model', async () => {
    const outcome = await new GroqIntentParser('fake-key').parse('   ', ctx);
    expect(outcome.kind).toBe('unparseable');
  });
});

describe('describeParserFailure() — EC-025, caught by type not by string', () => {
  it('maps an authentication error', () => {
    const e = new OpenAI.AuthenticationError(401, undefined, 'bad key', new Headers());
    expect(describeParserFailure(e)).toMatch(/misconfigured/i);
  });

  it('maps a rate limit', () => {
    const e = new OpenAI.RateLimitError(429, undefined, 'slow down', new Headers());
    expect(describeParserFailure(e)).toMatch(/busy/i);
  });

  it('maps a connection error', () => {
    const e = new OpenAI.APIConnectionError({ message: 'offline' });
    expect(describeParserFailure(e)).toMatch(/could not reach/i);
  });

  it('maps an unknown throw to a safe message rather than leaking it', () => {
    expect(describeParserFailure(new Error('ECONNRESET at 10.0.0.1:443')))
      .toMatch(/temporarily unavailable/i);
    expect(describeParserFailure(new Error('ECONNRESET at 10.0.0.1:443')))
      .not.toMatch(/10\.0\.0\.1/);
  });

  it('every mapped failure names the manual form as the way forward', () => {
    const failures = [
      new OpenAI.RateLimitError(429, undefined, 'x', new Headers()),
      new OpenAI.APIConnectionError({ message: 'x' }),
      new Error('boom'),
    ];
    for (const f of failures) {
      expect(describeParserFailure(f)).toMatch(/form below/i);
    }
  });
});
