/**
 * One-off migration: collapse lead_steward + anonymous_steward conversation types
 * into the unified 'steward' type. Idempotent.
 *
 * Usage: tsx --env-file=.env scripts/migrate-steward-type.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';

async function main() {
  const res = await db.execute(
    sql`UPDATE conversations SET type = 'steward'
        WHERE type IN ('lead_steward', 'anonymous_steward')`
  );
  // postgres-js RowList exposes affected count via `.count`
  const count = (res as unknown as { count?: number }).count ?? 0;
  console.log(`Migrated ${count} conversation(s) to type='steward'`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
