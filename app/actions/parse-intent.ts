'use server';

/**
 * Server Action wrapper for free-text parsing.
 *
 * Thin by design. It has NO write capability: it returns a suggestion and
 * nothing else. Turning a suggestion into a booking is a separate, explicit
 * user action that calls createBookingAction (design.md D5).
 *
 * The API key is read here, server-side. No client component imports the
 * parser or the SDK.
 */

import { defaultParser, type ParseContext } from '@/lib/server/parse-intent';
import { listRooms } from '@/lib/server/queries';
import type { BookingCandidate, RoomLike } from '@/lib/domain/intent';

export type ParseIntentResult =
  | { kind: 'candidate'; candidate: BookingCandidate }
  | { kind: 'ambiguous-room'; candidates: RoomLike[]; retryHint: string }
  | { kind: 'unparseable'; reason: string }
  | { kind: 'unavailable'; reason: string };

export async function parseIntentAction(text: string): Promise<ParseIntentResult> {
  const rooms = await listRooms();

  const ctx: ParseContext = {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      timezone: r.timezone,
      opensAt: r.opensAt,
      closesAt: r.closesAt,
      isActive: r.isActive,
    })),
    now: new Date(),
  };

  const outcome = await defaultParser().parse(text, ctx);

  if (outcome.kind === 'ambiguous-room') {
    return {
      kind: 'ambiguous-room',
      candidates: outcome.candidates,
      // Carrying the rest of the parse forward means choosing a room is one
      // click, not a re-type (EC-019).
      retryHint: [outcome.intent.startTime, outcome.intent.endTime].filter(Boolean).join('–'),
    };
  }

  return outcome;
}
