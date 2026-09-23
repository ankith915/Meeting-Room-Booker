'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBookingAction, type ActionResult } from '@/app/actions/bookings';
import { Button, Field, inputClass, Card } from './ui';
import type { BookingError } from '@/lib/domain/errors';

type Props = {
  roomId: string;
  roomName: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  /** Local wall-clock label, for the confirmation copy. */
  when: string;
  onBooked?: () => void;
};

export function BookRoomForm({ roomId, roomName, timezone, startsAt, endsAt, when }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [organiser, setOrganiser] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const r = await createBookingAction({ roomId, startsAt, endsAt, title, organiser });
      setResult(r);
      if (r.ok) {
        setTitle('');
        router.refresh();
      }
    });
  }

  if (result?.ok) {
    return (
      <Card tone="soft" className="mt-sm border-success/30 bg-success/5 p-md">
        <p className="text-sm font-medium text-ink">Booked — {roomName}</p>
        <p className="mt-xxs text-sm text-muted">
          {result.booking.title} · {when} ({timezone})
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="tap-safe mt-sm text-[13px] font-medium text-ink underline underline-offset-2"
        >
          Book another
        </button>
      </Card>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Book this room
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-sm flex flex-col gap-sm">
      <Field label="Meeting title">
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sprint review"
          maxLength={200}
          required
          autoFocus
        />
      </Field>

      <Field label="Your name" hint="Used to check who may cancel this booking.">
        <input
          className={inputClass}
          value={organiser}
          onChange={(e) => setOrganiser(e.target.value)}
          placeholder="ankith"
          required
        />
      </Field>

      <div className="flex items-center gap-xs">
        {/* Disabled while in flight so a double-click cannot fire twice (T026). */}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Booking…' : 'Confirm booking'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {result && !result.ok && <Refusal error={result.error} timezone={timezone} />}
    </form>
  );
}

/**
 * A refusal the user can act on (Constitution V, FR-009, FR-010).
 *
 * SLOT_TAKEN gets special treatment because it is the interesting one: it
 * names who holds the slot and offers somewhere else to go.
 */
function Refusal({ error, timezone }: { error: BookingError; timezone: string }) {
  const taken = error.code === 'SLOT_TAKEN';

  return (
    <Card
      tone="plain"
      className={taken ? 'border-warning/40 bg-warning/5 p-md' : 'border-error/30 bg-error/5 p-md'}
    >
      <div className="flex items-start gap-xs">
        <span
          aria-hidden
          className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-pill ${
            taken ? 'bg-warning' : 'bg-error'
          }`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{error.message}</p>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
            {error.code}
          </p>

          {error.conflict && (
            <p className="mt-xs text-sm text-body">
              Held by <strong className="font-medium text-ink">{error.conflict.organiser}</strong>{' '}
              for “{error.conflict.title}”.
            </p>
          )}

          {error.alternatives && error.alternatives.length > 0 && (
            <div className="mt-sm">
              <p className="text-[13px] font-medium text-ink">Try instead</p>
              <ul className="mt-xxs flex flex-col gap-xxs">
                {error.alternatives.map((alt, i) => (
                  <li key={i} className="text-sm text-body">
                    {alt.kind === 'other-room' ? (
                      <>
                        <span className="font-medium text-ink">{alt.roomName}</span> — free at the
                        same time
                      </>
                    ) : (
                      <>
                        Same room at{' '}
                        <span className="tabular font-medium text-ink">
                          {new Date(alt.startsAt).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: timezone,
                          })}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
