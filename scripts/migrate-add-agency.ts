/**
 * Idempotent backfill script for adding agency_id to existing rows.
 *
 * USAGE (existing DB without agencies):
 *   1. npm run db:push   (pushes schema with nullable agency_id — temp)
 *   2. npx tsx --env-file=.env scripts/migrate-add-agency.ts
 *   3. Edit schema: change agency_id .notNull() (remove nullable wrapper)
 *   4. npm run db:push   (enforces NOT NULL)
 *
 * For fresh DBs: npm run db:push + npm run db:seed is sufficient.
 *
 * This script is safe to run multiple times — it skips rows that already
 * have agency_id set.
 */
import { isNull } from 'drizzle-orm';
import {
  db,
  agencies,
  admins,
  leads,
  conversations,
  listings,
  handoff_rules,
  agency_config,
  viewing_slots
} from '../lib/db/client';

async function ensureDefaultAgency(): Promise<string> {
  const existing = await db.select().from(agencies).limit(1);
  if (existing[0]) {
    console.log(`• Using existing agency: ${existing[0].name} (${existing[0].id})`);
    return existing[0].id;
  }

  let primaryHost: string | null = null;
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    try { primaryHost = new URL(baseUrl).hostname; } catch { /* ignore */ }
  }

  const [agency] = await db
    .insert(agencies)
    .values({ name: 'Default Agency', slug: 'default', primary_host: primaryHost })
    .returning();
  console.log(`✓ Created default agency (id: ${agency.id}, host: ${primaryHost ?? 'unset'})`);
  return agency.id;
}

async function backfillTable(
  table: typeof admins | typeof leads | typeof conversations | typeof listings |
         typeof handoff_rules | typeof agency_config | typeof viewing_slots,
  tableName: string,
  agencyId: string
): Promise<void> {
  // Use a raw update to backfill rows with NULL agency_id.
  // Cast needed because drizzle's isNull works on any nullable column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const col = (table as any).agency_id;
  if (!col) {
    console.log(`  ⚠ ${tableName}: no agency_id column found, skipping`);
    return;
  }
  const result = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(table as any)
    .set({ agency_id: agencyId })
    .where(isNull(col))
    .returning({ id: col });
  console.log(`  ✓ ${tableName}: ${result.length} rows backfilled`);
}

async function main() {
  console.log('\n=== migrate-add-agency: idempotent backfill ===\n');

  const agencyId = await ensureDefaultAgency();

  console.log('\nBackfilling tables...');
  await backfillTable(admins,        'admins',        agencyId);
  await backfillTable(leads,         'leads',         agencyId);
  await backfillTable(conversations, 'conversations', agencyId);
  await backfillTable(listings,      'listings',      agencyId);
  await backfillTable(handoff_rules, 'handoff_rules', agencyId);
  await backfillTable(agency_config, 'agency_config', agencyId);
  await backfillTable(viewing_slots, 'viewing_slots', agencyId);

  console.log('\n✓ Backfill complete. Now:');
  console.log('  1. Remove nullable() from agency_id columns in lib/db/schema.ts');
  console.log('  2. Run: npm run db:push\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
