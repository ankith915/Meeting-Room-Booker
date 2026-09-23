'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Field, inputClass } from './ui';

/**
 * Date and time range picker. Pushes state into the URL so a search is
 * shareable and survives a refresh, and so the page can stay a server
 * component that reads searchParams.
 */
export function AvailabilitySearch({
  date,
  start,
  end,
  capacity,
}: {
  date: string;
  start: string;
  end: string;
  capacity: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({ date, start, end, capacity: String(capacity) });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    next.set('date', form.date);
    next.set('start', form.start);
    next.set('end', form.end);
    if (Number(form.capacity) > 0) next.set('capacity', form.capacity);
    else next.delete('capacity');
    startTransition(() => router.push(`/?${next.toString()}`));
  }

  const invalid = form.end <= form.start;

  return (
    <form
      onSubmit={apply}
      className="grid grid-cols-1 gap-sm sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto] lg:items-end"
    >
      <Field label="Date">
        <input
          type="date"
          className={inputClass}
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </Field>

      <Field label="From">
        <input
          type="time"
          step={900}
          className={inputClass}
          value={form.start}
          onChange={(e) => setForm({ ...form, start: e.target.value })}
        />
      </Field>

      <Field label="To" hint={invalid ? 'Must be after the start time.' : undefined}>
        <input
          type="time"
          step={900}
          className={inputClass}
          value={form.end}
          onChange={(e) => setForm({ ...form, end: e.target.value })}
        />
      </Field>

      <Field label="Min. seats">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
        />
      </Field>

      <Button type="submit" disabled={pending || invalid} className="w-full lg:w-auto">
        {pending ? 'Checking…' : 'Check availability'}
      </Button>
    </form>
  );
}
