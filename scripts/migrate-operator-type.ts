/**
 * One-off migration: collapse the old steward conversation types
 * (lead_steward / anonymous_steward / steward) into the unified 'operator' type. Idempotent.
 *
 * Usage: tsx --env-file=.env scripts/migrate-operator-type.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';

async function main() {
  const res = await db.execute(
    sql`UPDATE conversations SET type = 'operator'
        WHERE type IN ('steward', 'lead_steward', 'anonymous_steward')`
  );
  // postgres-js RowList exposes affected count via `.count`
  const count = (res as unknown as { count?: number }).count ?? 0;
  console.log(`Migrated ${count} conversation(s) to type='operator'`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
