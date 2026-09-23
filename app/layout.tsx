import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Body and UI text. DESIGN.md specifies Inter for every title/body/caption
// role, so it stays despite the Taste skill's blanket ban — see
// .claude/skills/taste/SOURCE.md for the recorded override.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// Display face. DESIGN.md asks for Cal Sans — "a custom geometric face" — on
// the four display sizes, but nothing ever loaded it, so headings silently fell
// back to Inter. Cal Sans is not on Google Fonts; Outfit is the closest
// geometric match, and using it here satisfies both the brief's intent and the
// Taste skill's rule against Inter for display type.
const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  display: 'swap',
});

// DESIGN.md pins JetBrains Mono for the `code` role. `--font-mono` referenced an
// undefined `--font-mono-stack`, so times fell through to the generic
// ui-monospace. Loading it properly makes the token real.
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Meeting Room Booker',
  description:
    'Book a meeting room. Double-booking is made impossible at the database layer, not merely checked for.',
};

// Typed explicitly rather than with Next's generated `LayoutProps` global,
// which only exists after a build has written .next/types — so `tsc --noEmit`
// fails on a clean checkout and in CI.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-body">{children}</body>
    </html>
  );
}
