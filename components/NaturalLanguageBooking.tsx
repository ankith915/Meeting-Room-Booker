'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseIntentAction, type ParseIntentResult } from '@/app/actions/parse-intent';
import { createBookingAction } from '@/app/actions/bookings';
import { Button, Card, inputClass } from './ui';
import type { BookingError } from '@/lib/domain/errors';

const EXAMPLES = [
  'book Aurora tomorrow 3 to 4pm for the design review',
  'Borealis next Tuesday at 10',
  'Meridian tomorrow 9 to 10am',
];

type Stage =
  | { at: 'idle' }
  | { at: 'parsed'; result: ParseIntentResult }
  | { at: 'booked'; summary: string }
  | { at: 'refused'; error: BookingError };

/**
 * Free-text booking (US1 extension).
 *
 * The candidate shown here is INERT — nothing is reserved until Confirm is
 * pressed, and Confirm calls the same createBookingAction the form uses. This
 * component has no privileged path to the database.
 */
export function NaturalLanguageBooking() {
  const router = useRouter();
  const [text, setText] = useState('');
  // No authentication in this version (A-001) — cancellation authority is
  // checked against this name, so it is collected before confirming.
  const [organiser, setOrganiser] = useState('');
  const [stage, setStage] = useState<Stage>({ at: 'idle' });
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length === 0) return;
    setStage({ at: 'idle' });
    startTransition(async () => {
      setStage({ at: 'parsed', result: await parseIntentAction(text) });
    });
  }

  function confirm(roomId: string, startsAt: string, endsAt: string, title: string, when: string) {
    startTransition(async () => {
      const who = organiser.trim() || 'guest';
      const result = await createBookingAction({ roomId, startsAt, endsAt, title, organiser: who });
      if (result.ok) {
        setStage({ at: 'booked', summary: when });
        setText('');
        router.refresh();
      } else {
        setStage({ at: 'refused', error: result.error });
      }
    });
  }

  return (
    <Card className="p-md">
      <form onSubmit={submit} className="flex flex-col gap-xs sm:flex-row">
        <input
          className={`${inputClass} flex-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="book Aurora tomorrow 3 to 4pm for the design review"
          aria-label="Describe the booking you want"
        />
        <Button type="submit" disabled={pending || text.trim().length === 0}>
          {pending ? 'Reading…' : 'Find it'}
        </Button>
      </form>

      {stage.at === 'idle' && !pending && (
        <div className="mt-xs flex flex-wrap items-center gap-xs">
          <span className="text-xs text-muted">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="tap-safe max-w-full rounded-pill bg-surface-soft px-2.5 py-1 text-left text-xs text-body transition-colors hover:bg-surface-strong"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {stage.at === 'parsed' && (
        <Parsed
          result={stage.result}
          pending={pending}
          organiser={organiser}
          onOrganiserChange={setOrganiser}
          onConfirm={confirm}
          onPickRoom={(name) => setText(`${name} ${text}`)}
          onDismiss={() => setStage({ at: 'idle' })}
        />
      )}

      {stage.at === 'booked' && (
        <div className="mt-sm rounded-card border border-success/30 bg-success/5 p-md">
          <p className="text-sm font-medium text-ink">Booked — {stage.summary}</p>
          <button
            type="button"
            onClick={() => setStage({ at: 'idle' })}
            className="tap-safe mt-xs text-[13px] font-medium text-ink underline underline-offset-2"
          >
            Book another
          </button>
        </div>
      )}

      {stage.at === 'refused' && (
        <div className="mt-sm rounded-card border border-warning/40 bg-warning/5 p-md">
          <p className="text-sm font-medium text-ink">{stage.error.message}</p>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
            {stage.error.code}
          </p>
          {stage.error.conflict && (
            <p className="mt-xs text-sm text-body">
              Held by{' '}
              <strong className="font-medium text-ink">{stage.error.conflict.organiser}</strong>.
            </p>
          )}
          <button
            type="button"
            onClick={() => setStage({ at: 'idle' })}
            className="tap-safe mt-sm text-[13px] font-medium text-ink underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      )}
    </Card>
  );
}

function Parsed({
  result,
  pending,
  organiser,
  onOrganiserChange,
  onConfirm,
  onPickRoom,
  onDismiss,
}: {
  result: ParseIntentResult;
  pending: boolean;
  organiser: string;
  onOrganiserChange: (value: string) => void;
  onConfirm: (roomId: string, startsAt: string, endsAt: string, title: string, when: string) => void;
  onPickRoom: (roomName: string) => void;
  onDismiss: () => void;
}) {
  /* EC-020 / EC-025 — say what went wrong, and point at the form below. */
  if (result.kind === 'unparseable' || result.kind === 'unavailable') {
    return (
      <div className="mt-sm rounded-card border border-hairline bg-surface-soft p-md">
        <p className="text-sm text-ink">{result.reason}</p>
        <p className="mt-xxs text-sm text-muted">
          The form below always works — pick a time and a room directly.
        </p>
      </div>
    );
  }

  /* EC-019 — ask which room, never guess. */
  if (result.kind === 'ambiguous-room') {
    return (
      <div className="mt-sm rounded-card border border-hairline bg-surface-soft p-md">
        <p className="text-sm font-medium text-ink">Which room did you mean?</p>
        {result.retryHint && (
          <p className="tabular mt-xxs text-sm text-muted">Keeping {result.retryHint}.</p>
        )}
        <div className="mt-sm flex flex-wrap gap-xs">
          {result.candidates.map((room) => (
            <Button key={room.id} size="sm" variant="secondary" onClick={() => onPickRoom(room.name)}>
              {room.name}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  /* D5 — the resolved candidate, shown in full. Never a paraphrase of the input. */
  const c = result.candidate;
  const when = `${c.room.name}, ${c.date} ${c.localStart}–${c.localEnd}`;

  return (
    <div className="mt-sm rounded-card border border-hairline bg-canvas p-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <p className="text-sm text-muted">Book this?</p>
          <p className="mt-xxs text-base font-semibold text-ink">{c.room.name}</p>
          <p className="tabular mt-xxs text-sm text-body">
            {c.date} · {c.localStart} – {c.localEnd}{' '}
            <span className="text-muted">({c.timezone})</span>
          </p>
          <p className="mt-xxs text-sm text-body">{c.title}</p>

          {c.durationAssumed && (
            /* EC-024 — the default is stated, not slipped in. */
            <p className="mt-xs text-xs text-muted">
              You did not give an end time, so I assumed one hour.
            </p>
          )}
          {c.confidence === 'uncertain' && (
            <p className="mt-xs text-xs text-warning-text">
              I am not confident I read that correctly — please check each value.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-xs">
          <input
            className={`${inputClass} h-8 w-40 text-[13px]`}
            value={organiser}
            onChange={(e) => onOrganiserChange(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
          />
          <div className="flex gap-xs">
            <Button
              size="sm"
              disabled={pending || organiser.trim().length === 0}
              onClick={() => onConfirm(c.room.id, c.startsAt, c.endsAt, c.title, when)}
            >
              {pending ? 'Booking…' : 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={pending}>
              No
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
