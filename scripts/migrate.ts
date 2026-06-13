/**
 * Apply pending Drizzle SQL migrations from ./drizzle to the database.
 * Migration-based workflow: change schema.ts → `npm run db:generate` → `npm run db:migrate`.
 * Replaces direct `db:push` mutation for reproducible, ordered schema changes.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

async function main() {
  // max:1 — migrations must run on a single connection, sequentially.
  const client = postgres(url as string, { max: 1 });
  const db = drizzle(client);
  console.log('[migrate] applying migrations from ./drizzle ...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate] done');
  await client.end();
}

main().catch((e) => {
  console.error('[migrate] failed:', e);
  process.exit(1);
});
