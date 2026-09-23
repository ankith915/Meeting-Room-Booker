import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
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
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-canvas text-body">{children}</body>
    </html>
  );
}
