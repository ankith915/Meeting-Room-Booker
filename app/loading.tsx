/**
 * Route-level loading UI for the room list.
 *
 * The page is `force-dynamic` and queries availability on every render, so a
 * time-range change is a real server round trip. Without this the user watched
 * a frozen page; now the list is replaced by placeholders of the same shape.
 *
 * Taste Rule 5: skeletal loaders matching layout sizes, never a spinner.
 */

import { RoomRowSkeleton, Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-md py-xl sm:px-lg" aria-busy="true">
      <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-lg">
        <div className="min-w-0">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-xs h-4 w-72 max-w-full" />
        </div>
      </header>

      <div className="mt-xl animate-pulse">
        <div className="flex items-baseline justify-between gap-md">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>

        <ul className="mt-md flex flex-col gap-sm">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <RoomRowSkeleton />
            </li>
          ))}
        </ul>
      </div>

      <span className="sr-only" role="status">
        Checking room availability
      </span>
    </main>
  );
}
