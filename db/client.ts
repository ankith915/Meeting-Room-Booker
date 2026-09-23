/**
 * Neon database client.
 *
 * Uses the HTTP driver: every query is an independent request, so concurrent
 * calls really do race at the database. That is exactly the condition EC-001
 * describes, and it is what makes tests/concurrency a genuine test rather than
 * a simulation (research.md R-005).
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Create .env.local with your Neon pooled connection string. ' +
      'See specs/001-meeting-room-booker/quickstart.md § Setup.',
    );
  }
  return url;
}

export const db = drizzle(neon(connectionString()), { schema });

/** Raw SQL escape hatch — used by migrations and by constraint-presence tests. */
export const sqlClient = () => neon(connectionString());

export { schema };
