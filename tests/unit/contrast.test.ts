/**
 * WCAG contrast regression tests.
 *
 * The Impeccable audit found four failures, all on text whose colour carries
 * meaning: the "Free" and "Busy" badges, the low-confidence warning, and the
 * timezone label. A user who cannot read "Free" cannot use the room list.
 *
 * These tests parse the ACTUAL token values out of app/globals.css rather than
 * restating them, so a future edit that reintroduces a failing colour fails
 * here instead of shipping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

/** Read a --color-* token straight from the stylesheet. */
function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found in app/globals.css`);
  return match[1];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** What Tailwind's `bg-success/10` actually paints over a background. */
function blend(fg: string, bg: string, alpha: number): string {
  const f = fg.replace('#', '');
  const b = bg.replace('#', '');
  const mix = [0, 2, 4].map((i) => {
    const fc = parseInt(f.slice(i, i + 2), 16);
    const bc = parseInt(b.slice(i, i + 2), 16);
    return Math.round(fc * alpha + bc * (1 - alpha));
  });
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const AA = 4.5;

describe('WCAG AA — body text on the canvas', () => {
  const canvas = token('canvas');

  it.each([
    ['body', 'paragraph text'],
    ['ink', 'headings'],
    ['muted', 'secondary text'],
    ['muted-soft', 'timezone and placeholder text'],
  ])('%s clears 4.5:1 (%s)', (name) => {
    expect(contrast(token(name), canvas)).toBeGreaterThanOrEqual(AA);
  });
});

describe('WCAG AA — semantic text, which carries booking state', () => {
  const canvas = token('canvas');

  it('success-text clears AA on the canvas AND on its own 10% tint', () => {
    const fg = token('success-text');
    expect(contrast(fg, canvas)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fg, blend(token('success'), canvas, 0.1))).toBeGreaterThanOrEqual(AA);
  });

  it('error-text clears AA on the canvas AND on its own 10% tint', () => {
    const fg = token('error-text');
    expect(contrast(fg, canvas)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fg, blend(token('error'), canvas, 0.1))).toBeGreaterThanOrEqual(AA);
  });

  it('warning-text clears AA on the canvas AND on its own 5% tint', () => {
    const fg = token('warning-text');
    expect(contrast(fg, canvas)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fg, blend(token('warning'), canvas, 0.05))).toBeGreaterThanOrEqual(AA);
  });
});

describe('WCAG AA — the dark card', () => {
  it('on-dark-soft clears AA on surface-dark', () => {
    expect(contrast(token('on-dark-soft'), token('surface-dark'))).toBeGreaterThanOrEqual(AA);
  });

  it('on-dark clears AA on surface-dark', () => {
    expect(contrast(token('on-dark'), token('surface-dark'))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the bright semantic colours are for FILLS, not text', () => {
  // Documents why two variants exist. These deliberately FAIL as text, which
  // is exactly why -text variants were introduced; if one of these ever starts
  // passing, someone has changed a fill colour and the pair should be revisited.
  it('the bright variants would not pass as small text', () => {
    const canvas = token('canvas');
    expect(contrast(token('success'), canvas)).toBeLessThan(AA);
    expect(contrast(token('warning'), canvas)).toBeLessThan(AA);
  });

  it('but they are only ever used as fills', () => {
    const componentSources = [
      'components/ui.tsx',
      'components/NaturalLanguageBooking.tsx',
      'components/BookRoomForm.tsx',
      'components/CancelBookingButton.tsx',
    ].map((f) => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n');

    // `text-success`/`text-warning`/`text-error` without the -text suffix.
    const bareTextUse = /\btext-(success|warning|error)(?!-text)\b/.exec(componentSources);
    expect(bareTextUse?.[0] ?? null).toBeNull();
  });
});
