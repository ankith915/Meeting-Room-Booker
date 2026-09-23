/**
 * One room's day: bookings in chronological order and the gaps between them
 * (US2, FR-012..FR-015).
 *
 * Every time on this page is rendered in the ROOM's timezone, labelled, so two
 * viewers in different offices see identical numbers (EC-014).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDaySchedule } from '@/lib/server/queries';
import { formatLocalDate } from '@/lib/time';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { CancelBookingButton } from '@/components/CancelBookingButton';

export const dynamic = 'force-dynamic';

type Params = Promise<{ roomId: string }>;
type SearchParams = Promise<{ date?: string }>;

/** Minutes since local midnight, used to place blocks on the timeline. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export default async function RoomSchedulePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { roomId } = await params;
  const { date: dateParam } = await searchParams;

  // Resolve "today" provisionally, then re-resolve in the room's own zone —
  // the room's local date is what defines its day (FR-015).
  const provisional = dateParam || formatLocalDate(new Date(), 'UTC');
  const first = await getDaySchedule(roomId, provisional);
  if (!first) notFound();

  const date = dateParam || formatLocalDate(new Date(), first.room.timezone);
  const schedule = dateParam ? first : ((await getDaySchedule(roomId, date)) ?? first);

  const { room, bookings, gaps, businessHours, timezone } = schedule;

  const dayStart = minutesOfDay(businessHours.localStart);
  const dayEnd = minutesOfDay(businessHours.localEnd);
  const span = Math.max(dayEnd - dayStart, 1);
  const pct = (from: string, to: string) => ({
    left: `${((minutesOfDay(from) - dayStart) / span) * 100}%`,
    width: `${((minutesOfDay(to) - minutesOfDay(from)) / span) * 100}%`,
  });

  const bookedMinutes = bookings.reduce(
    (sum, b) => sum + (minutesOfDay(b.localEnd) - minutesOfDay(b.localStart)),
    0,
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-md py-xl sm:px-lg">
      <Link
        href="/"
        className="text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← All rooms
      </Link>

      <div className="mt-md">
        <PageHeader
          title={room.name}
          subtitle={
            <>
              {room.capacity} seats · {room.location} · open {businessHours.localStart}–
              {businessHours.localEnd}
              <span className="ml-1 text-muted-soft">({timezone})</span>
            </>
          }
          action={
            <Badge tone={room.isActive ? 'neutral' : 'muted'}>
              {room.isActive ? date : 'Out of service'}
            </Badge>
          }
        />
      </div>

      {/* Timeline — the shape of the day in one glance. */}
      <section className="mt-lg" aria-label="Day timeline">
        <div className="relative h-10 overflow-hidden rounded-control bg-success/10">
          {bookings.map((b) => (
            <div
              key={b.id}
              style={pct(b.localStart, b.localEnd)}
              title={`${b.localStart}–${b.localEnd} · ${b.title}`}
              className="absolute top-0 h-full border-l border-canvas bg-ink/85"
            />
          ))}
        </div>
        <div className="tabular mt-xxs flex justify-between text-xs text-muted">
          <span>{businessHours.localStart}</span>
          <span>
            {bookedMinutes === 0
              ? 'Free all day'
              : `${Math.round((bookedMinutes / span) * 100)}% booked`}
          </span>
          <span>{businessHours.localEnd}</span>
        </div>
      </section>

      <section className="mt-xl">
        <h2 className="text-sm font-medium text-ink">
          Bookings{bookings.length > 0 && ` (${bookings.length})`}
        </h2>

        {bookings.length === 0 ? (
          <div className="mt-md">
            <EmptyState
              title="Nothing booked"
              body={`This room is free for the whole of ${businessHours.localStart}–${businessHours.localEnd}.`}
            />
          </div>
        ) : (
          <ul className="mt-md flex flex-col gap-xs">
            {bookings.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-wrap items-center justify-between gap-md p-md">
                  <div className="min-w-0">
                    <p className="tabular text-sm font-semibold text-ink">
                      {b.localStart} – {b.localEnd}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-body">{b.title}</p>
                    <p className="text-sm text-muted">{b.organiser}</p>
                  </div>
                  <CancelBookingButton
                    bookingId={b.id}
                    roomId={room.id}
                    organiser={b.organiser}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FR-013 — the gaps are the point: they are where a meeting could go. */}
      <section className="mt-xl">
        <h2 className="text-sm font-medium text-ink">Free periods</h2>
        <ul className="mt-md flex flex-wrap gap-xs">
          {gaps.map((g, i) => (
            <li key={i}>
              <Link
                href={`/?date=${date}&start=${g.localStart}&end=${g.localEnd}`}
                className="tabular inline-flex items-center gap-xs rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-soft"
              >
                {g.localStart} – {g.localEnd}
                <span className="text-xs text-muted">
                  {g.minutes < 60 ? `${g.minutes}m` : `${(g.minutes / 60).toFixed(1)}h`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-sm text-xs text-muted">
          A booking ends exactly when the next may begin — 09:00–10:00 and 10:00–11:00 do not
          clash.
        </p>
      </section>
    </main>
  );
}
