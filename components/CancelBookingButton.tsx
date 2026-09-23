'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelBookingAction } from '@/app/actions/bookings';
import { Button, inputClass } from './ui';

/**
 * Cancel a booking (US3, FR-016..FR-018).
 *
 * Asks for the organiser's name because authority is checked against it
 * (A-001 — there is no authentication in this version, and the spec says so
 * explicitly rather than pretending otherwise).
 */
export function CancelBookingButton({
  bookingId,
  roomId,
  organiser,
}: {
  bookingId: string;
  roomId: string;
  organiser: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId, name, roomId);
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Cancel
      </Button>
    );
  }

  return (
    <form onSubmit={cancel} className="flex flex-col items-end gap-xs">
      <input
        className={`${inputClass} h-8 w-44 text-[13px]`}
        placeholder={`Type “${organiser}”`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name, to confirm cancellation"
        autoFocus
        required
      />
      <div className="flex gap-xs">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? 'Cancelling…' : 'Confirm cancel'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
      {error && <p className="max-w-56 text-right text-xs text-error">{error}</p>}
    </form>
  );
}
