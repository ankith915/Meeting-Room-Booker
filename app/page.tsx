/**
 * Room list with live availability for a chosen range (US1, FR-002, FR-003).
 *
 * Server component: reads the range from searchParams, asks the database, and
 * renders. The availability shown is ADVISORY — it can go stale between this
 * render and the user's click, and bookings_no_overlap is what settles it.
 */

import Link from 'next/link';
import { listAvailability } from '@/lib/server/queries';
import { localToInstant, formatLocalDate, formatLocalTime } from '@/lib/time';
import { Badge, Card, Dot, EmptyState, PageHeader } from '@/components/ui';
import { AvailabilitySearch } from '@/components/AvailabilitySearch';
import { BookRoomForm } from '@/components/BookRoomForm';

// Availability changes on every booking, so never serve this from a cache.
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'Asia/Kolkata';

type SearchParams = Promise<{
  date?: string;
  start?: string;
  end?: string;
  capacity?: string;
}>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const date = sp.date || formatLocalDate(new Date(), DEFAULT_TZ);
  const start = sp.start || '14:00';
  const end = sp.end || '15:00';
  const capacity = Number(sp.capacity ?? 0) || 0;

  // NOTE: the range is resolved against each room's own timezone inside
  // createBooking. Here we resolve it once in the default zone purely to get
  // absolute instants to query with — the rooms themselves may sit in other
  // zones, which is exactly why Meridian shows as busy outside its own hours.
  const startsAt = localToInstant(date, start, DEFAULT_TZ);
  const endsAt = localToInstant(date, end, DEFAULT_TZ);

  const rows = endsAt > startsAt ? await listAvailability(startsAt, endsAt, capacity) : [];
  const free = rows.filter((r) => r.isFree);

  return (
    <main className="mx-auto w-full max-w-5xl px-md py-xl sm:px-lg">
      <PageHeader
        title="Meeting rooms"
        subtitle="Pick a time, see what is genuinely free, and book it."
      />

      <section className="mt-lg">
        <AvailabilitySearch date={date} start={start} end={end} capacity={capacity} />
      </section>

      {endsAt <= startsAt ? (
        <section className="mt-xl">
          <EmptyState
            title="That time range is not valid"
            body="The end time must be after the start time."
          />
        </section>
      ) : (
        <section className="mt-xl">
          <div className="flex items-baseline justify-between gap-md">
            <h2 className="text-sm font-medium text-ink">
              {free.length} of {rows.length} rooms free
            </h2>
            <p className="tabular text-sm text-muted">
              {start}–{end} · {date}
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="mt-md">
              <EmptyState
                title="No rooms match"
                body="Try reducing the minimum number of seats."
              />
            </div>
          ) : (
            <ul className="mt-md flex flex-col gap-sm">
              {rows.map(({ room, isFree, conflictCount, reason }) => {
                // Each room renders the requested wall clock in ITS OWN zone,
                // so a room in another office shows the real local time (FR-014).
                const localStart = formatLocalTime(startsAt, room.timezone);
                const localEnd = formatLocalTime(endsAt, room.timezone);
                const elsewhere = room.timezone !== DEFAULT_TZ;

                return (
                  <li key={room.id}>
                    <Card className="p-md">
                      <div className="flex flex-wrap items-start justify-between gap-md">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-xs">
                            <Link
                              href={`/rooms/${room.id}?date=${date}`}
                              className="text-base font-semibold text-ink underline-offset-4 hover:underline"
                            >
                              {room.name}
                            </Link>
                            {reason === 'available' && (
                              <Badge tone="free">
                                <Dot tone="free" />
                                Free
                              </Badge>
                            )}
                            {reason === 'booked' && (
                              <Badge tone="busy">
                                <Dot tone="busy" />
                                Busy · {conflictCount}
                              </Badge>
                            )}
                            {/* Not a conflict — the room is simply shut then. */}
                            {reason === 'closed' && (
                              <Badge tone="muted">
                                Closed · opens {room.opensAt.slice(0, 5)}
                              </Badge>
                            )}
                          </div>

                          <p className="mt-xxs text-sm text-muted">
                            {room.capacity} seats · {room.location}
                          </p>

                          <p className="tabular mt-xxs text-sm text-body">
                            {localStart}–{localEnd}
                            {elsewhere && (
                              <span className="text-muted"> local to {room.timezone}</span>
                            )}
                          </p>
                        </div>

                        <div className="shrink-0">
                          {isFree ? (
                            <BookRoomForm
                              roomId={room.id}
                              roomName={room.name}
                              timezone={room.timezone}
                              startsAt={startsAt.toISOString()}
                              endsAt={endsAt.toISOString()}
                              when={`${localStart}–${localEnd} on ${date}`}
                            />
                          ) : (
                            <div className="text-right">
                              <Link
                                href={`/rooms/${room.id}?date=${date}`}
                                className="text-[13px] font-medium text-ink underline underline-offset-2"
                              >
                                See the day
                              </Link>
                              {reason === 'closed' && (
                                <p className="mt-xxs max-w-48 text-xs text-muted">
                                  Open {room.opensAt.slice(0, 5)}–{room.closesAt.slice(0, 5)} in{' '}
                                  {room.timezone}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <Card tone="dark" className="mt-xxl p-lg">
        <p className="text-sm font-medium text-on-dark">
          Two people can click Book at the same instant. Only one booking will exist.
        </p>
        <p className="mt-xs text-sm text-on-dark-soft">
          That is not enforced by this page, or by the server action behind it. It is enforced by a
          PostgreSQL exclusion constraint evaluated inside the write, under an index lock — so
          there is no gap between checking and writing for a second request to slip through.
        </p>
      </Card>
    </main>
  );
}
