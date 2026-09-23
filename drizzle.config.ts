import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // IMPORTANT (plan.md risk 2): drizzle-kit cannot express the
  // EXCLUDE USING GIST constraint or CREATE EXTENSION. Those live in a
  // hand-written migration, drizzle/0001_exclusion_constraint.sql.
  //
  // Never run `drizzle-kit push` against an existing database: it diffs
  // against schema.ts, does not know about the hand-written constraint, and
  // would offer to drop it. Losing that constraint silently deletes the
  // project's entire correctness guarantee (Constitution I).
  //
  // Use `npm run db:generate` then `npm run db:migrate` instead.
  strict: true,
  verbose: true,
});
