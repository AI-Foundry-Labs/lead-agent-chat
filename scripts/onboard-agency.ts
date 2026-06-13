/**
 * Onboard a NEW agency (multi-tenant setup).
 *
 * Creates an agency tenant + its default qualification config + a first admin,
 * all scoped by the new agency_id. This is the supported way to add an agency
 * beyond the demo seed (Model A: one deployment, many agencies by subdomain).
 *
 * Usage (env-driven, KISS — no arg parsing):
 *   AGENCY_NAME="Foncia Paris" \
 *   AGENCY_SLUG="foncia" \
 *   AGENCY_HOST="foncia.yourproduct.com" \
 *   ADMIN_EMAIL="boss@foncia.fr" \
 *   ADMIN_PASSWORD="change-me" \
 *   ADMIN_NAME="Jean Dupont" \
 *   npm run agency:onboard
 *
 * AGENCY_HOST is the subdomain/custom domain that proxy.ts resolves to this
 * agency (primary_host, unique). Visitors on that host get this tenant.
 * Telegram is linked separately by the admin via /admin → "Lier Telegram".
 */
import { db, admins, getAgencyByHost } from '../lib/db';
import { createAgency } from '../lib/db/agencies';
import { upsertAgencyConfig, getAgencyConfig } from '../lib/db/config';
import { hashPassword } from '../lib/auth';
import { eq } from 'drizzle-orm';
import type { Criterion } from '../lib/db/schema';

const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'budget', label: 'Budget', hint: 'Purchase budget range' },
  { key: 'financing', label: 'Financing', hint: 'Cash, mortgage pre-approval, etc.' },
  { key: 'timeline', label: 'Timeline', hint: 'When they want to buy' },
  { key: 'property_type', label: 'Property type', hint: 'Apartment, house, etc.' },
  { key: 'location', label: 'Preferred location', hint: 'Neighborhoods / areas' }
];

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[onboard] missing required env: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

async function main() {
  const name = required('AGENCY_NAME');
  const slug = required('AGENCY_SLUG');
  const host = process.env.AGENCY_HOST?.trim() || null;
  const adminEmail = required('ADMIN_EMAIL');
  const adminPassword = required('ADMIN_PASSWORD');
  const adminName = process.env.ADMIN_NAME?.trim() ?? 'Admin';

  // Guard: host must be unique (proxy.ts resolves by it).
  if (host && (await getAgencyByHost(host))) {
    console.error(`[onboard] an agency already uses host "${host}" — aborting.`);
    process.exit(1);
  }
  // Guard: admin email is globally unique (admins.email unique).
  const existingAdmin = await db.select().from(admins).where(eq(admins.email, adminEmail)).limit(1);
  if (existingAdmin[0]) {
    console.error(`[onboard] admin email "${adminEmail}" already exists — aborting.`);
    process.exit(1);
  }

  const agency = await createAgency({ name, slug, primary_host: host });
  console.log(`✓ Agency: ${agency.name} (id=${agency.id}, host=${host ?? '—'})`);

  if (!(await getAgencyConfig(agency.id))) {
    await upsertAgencyConfig({
      agency_id: agency.id,
      name,
      tone:
        'Professional and warm. Always reply in the same language the lead writes in.',
      qualification_criteria: DEFAULT_CRITERIA,
      calendar_id: process.env.GOOGLE_CALENDAR_ID ?? 'primary'
    });
    console.log('✓ Agency config created (5 default criteria)');
  }

  await db.insert(admins).values({
    agency_id: agency.id,
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    name: adminName
  });
  console.log(`✓ Admin created: ${adminEmail}`);
  console.log('\nNext steps for this agency:');
  console.log(`  1. Point ${host ?? '<host>'} at this deployment.`);
  console.log(`  2. Admin logs in at /admin/login and adds listings.`);
  console.log(`  3. Admin links Telegram: /admin → "Lier Telegram" → /link <token> in the agency group.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[onboard] failed:', e);
  process.exit(1);
});
