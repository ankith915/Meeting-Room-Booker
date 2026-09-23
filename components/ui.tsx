/**
 * UI primitives built from DESIGN.md tokens.
 *
 * Every colour, radius and spacing value here comes from app/globals.css.
 * Components must not hard-code hex values — a design change should be one
 * edit in the token block, not a sweep through the tree.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        'tap-safe inline-flex items-center justify-center gap-2 rounded-control font-medium',
        'transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        'disabled:cursor-not-allowed',
        // Tactile feedback (Taste Rule 5): a press should feel like a physical
        // push. Uses `transform` so it is GPU-composited, never layout. It is
        // deliberately not transitioned — the displacement should land on the
        // same frame as the finger. Suppressed when disabled, and under
        // prefers-reduced-motion, which this project honours by policy.
        'active:translate-y-px disabled:active:translate-y-0 motion-reduce:active:translate-y-0',
        size === 'md' ? 'h-10 px-5 text-sm' : 'h-8 px-3 text-[13px]',
        variant === 'primary' &&
          'bg-primary text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted',
        variant === 'secondary' &&
          'bg-canvas text-ink border border-hairline hover:bg-surface-soft disabled:text-muted',
        variant === 'ghost' && 'bg-transparent text-ink hover:bg-surface-soft',
        variant === 'danger' &&
          'bg-canvas text-error-text border border-error/30 hover:bg-error/5 disabled:text-muted disabled:border-hairline',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className,
  tone = 'plain',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'plain' | 'soft' | 'dark';
}) {
  return (
    <div
      className={cx(
        'rounded-card',
        tone === 'plain' && 'bg-canvas border border-hairline',
        tone === 'soft' && 'bg-surface-soft border border-hairline-soft',
        tone === 'dark' && 'bg-surface-dark text-on-dark',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-xxs">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-control border border-hairline bg-canvas px-3 text-sm text-ink ' +
  'outline-none transition-colors placeholder:text-muted-soft ' +
  'focus:border-ink focus:ring-1 focus:ring-ink';

/* ----------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'free' | 'busy' | 'muted';
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium',
        tone === 'neutral' && 'bg-surface-soft text-body',
        tone === 'free' && 'bg-success/10 text-success-text',
        tone === 'busy' && 'bg-error/10 text-error-text',
        tone === 'muted' && 'bg-surface-card text-muted',
      )}
    >
      {children}
    </span>
  );
}

/** Small status dot — reads faster than a word in a dense list. */
export function Dot({ tone }: { tone: 'free' | 'busy' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-1.5 rounded-pill',
        tone === 'free' ? 'bg-success' : 'bg-error',
      )}
    />
  );
}

/* ------------------------------------------------------------ Page shell */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-lg">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.5px] text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-xxs text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/* -------------------------------------------------------------- Skeleton */

/**
 * A single placeholder block.
 *
 * Taste Rule 5 asks for skeletal loaders sized to the layout they stand in for,
 * rather than a generic spinner — the page should not reflow when real content
 * lands. Animation is `opacity` only (via animate-pulse), so it composites on
 * the GPU and is already neutralised by the reduced-motion block in globals.css.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('block rounded bg-surface-strong', className)} />;
}

/** Mirrors the room row in app/page.tsx so the swap to real data is silent. */
export function RoomRowSkeleton() {
  return (
    <Card className="p-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-xs">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-16 rounded-pill" />
          </div>
          <Skeleton className="mt-xs h-4 w-56 max-w-full" />
          <Skeleton className="mt-xxs h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-28 shrink-0 rounded-control" />
      </div>
    </Card>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <Card tone="soft" className="p-xl text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="mt-xxs text-sm text-muted">{body}</p>}
    </Card>
  );
}
