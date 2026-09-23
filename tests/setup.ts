import { config } from 'dotenv';

// Integration and concurrency tests run against a real Neon database.
// Per research.md R-006 the guarantee lives in PostgreSQL, so mocking the
// database would test our belief about PostgreSQL rather than PostgreSQL.
config({ path: '.env.local', quiet: true });

export const hasDatabase = Boolean(process.env.DATABASE_URL);
