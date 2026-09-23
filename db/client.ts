/**
 * Neon database client.
 *
 * Uses the HTTP driver: every query is an independent request, so concurrent
 * calls really do race at the database. That is exactly the condition EC-001
 * describes, and it is what makes tests/concurrency a genuine test rather than
 * a simulation (research.md R-005).
 *
 * The connection is resolved LAZILY, on first query. It used to be built at
 * module load, which meant merely importing this file without DATABASE_URL
 * threw — and `next build` imports every route module to analyse it. So a
 * deployment whose database variable was not visible at BUILD time failed the
 * build outright, with an error pointing at a local .env.local file that has
 * nothing to do with the deployment.
 *
 * Failing on first query instead means a misconfigured deployment builds,
 * starts, and reports a clear runtime error — and routes that never touch the
 * database keep working.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Locally, create .env.local with your Neon pooled ' +
      'connection string (see specs/001-meeting-room-booker/quickstart.md § Setup). ' +
      'On a hosted deployment, set it as an environment variable for this environment.',
    );
  }
  return url;
}

let instance: Db | null = null;

function connect(): Db {
  if (!instance) instance = drizzle(neon(connectionString()), { schema });
  return instance;
}

/**
 * The Drizzle client.
 *
 * A proxy so every call site keeps using `db.select(...)` unchanged, while the
 * underlying connection is not built until the first property access.
 */
export const db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    const real = connect();
    const value = Reflect.get(real as object, property, receiver);
    // Methods must keep their original `this`, or Drizzle's builders break.
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

/** Raw SQL escape hatch — used by migrations and by constraint-presence tests. */
export const sqlClient = () => neon(connectionString());

export { schema };
