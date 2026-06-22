import { eq } from 'drizzle-orm';
import {
  createHandoffRule,
  createListing,
  listHandoffRules,
  listListings,
  getAgencyConfig,
  upsertAgencyConfig,
  db,
  admins,
  agencies
} from '../lib/db';
import { getLeadByEmail, createLead } from '../lib/db/leads';
import { hashPassword } from '../lib/auth';
import type { Criterion } from '../lib/types';

// The predecessor's fixed five fields, now expressed as an admin-owned criteria
// set. New criteria can be added live by the admin via update_criteria.
const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'budget', label: 'Budget range', hint: 'Approx. € the buyer can spend' },
  {
    key: 'financing',
    label: 'Financing status',
    hint: 'cash / mortgage approved / mortgage pending'
  },
  {
    key: 'timeline',
    label: 'Purchase timeline',
    hint: 'When they want to buy (weeks / months)'
  },
  {
    key: 'intended_use',
    label: 'Intended use',
    hint: 'primary residence / investment / secondary'
  },
  {
    key: 'decision_maker',
    label: 'Decision maker',
    hint: 'Whether the lead is the sole decision maker'
  }
];

/**
 * Ensure a default agency row exists. Returns its id.
 * This is the single tenant used in dev / single-agency deployments.
 */
async function seedDefaultAgency(): Promise<string> {
  const existing = await db.select().from(agencies).limit(1);
  if (existing[0]) {
    console.log('• Default agency already present');
    return existing[0].id;
  }

  // Derive primary_host from APP_BASE_URL env (e.g. "https://myapp.com" → "myapp.com").
  let primaryHost: string | null = null;
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    try {
      primaryHost = new URL(baseUrl).hostname;
    } catch {
      // ignore malformed URL
    }
  }

  const [agency] = await db
    .insert(agencies)
    .values({
      name: 'Default Agency',
      slug: 'default',
      primary_host: primaryHost
    })
    .returning();
  console.log(`✓ Default agency created (id: ${agency.id}, host: ${primaryHost ?? 'unset'})`);
  return agency.id;
}

async function seedConfig(agencyId: string) {
  if (await getAgencyConfig(agencyId)) {
    console.log('• Agency config already present');
    return;
  }
  await upsertAgencyConfig({
    agency_id: agencyId,
    name: 'Agence Lumière',
    tone:
      'Professional and warm. Parisian agency style. Never overly formal, never casual. Always reply in French only — this is a France-exclusive agency.',
    qualification_criteria: DEFAULT_CRITERIA,
    calendar_id: process.env.GOOGLE_CALENDAR_ID ?? 'primary'
  });
  console.log('✓ Agency config created (5 default criteria)');
}

async function seedRules(agencyId: string) {
  const rules = await listHandoffRules(agencyId);
  const has = (txt: string) =>
    rules.some((r) => r.description.toLowerCase().includes(txt.toLowerCase()));

  if (!has('negotiation')) {
    await createHandoffRule({
      agency_id: agencyId,
      description:
        'Escalate when the lead asks for a price reduction or mentions negotiation.',
      trigger_keywords: [
        'price reduction',
        'negotiate',
        'discount',
        'cheaper',
        'négocier',
        'baisser le prix',
        'moins cher',
        'rabais'
      ]
    });
    console.log('✓ Rule: price negotiation');
  }

  if (!has('vincennes')) {
    await createHandoffRule({
      agency_id: agencyId,
      description: 'Always escalate for the Vincennes house (>1M€).',
      trigger_keywords: [
        'vincennes',
        'house with garden',
        'maison avec jardin',
        'maison vincennes'
      ]
    });
    console.log('✓ Rule: always-escalate Vincennes');
  }
}

async function seedListings(agencyId: string) {
  if ((await listListings(agencyId)).length > 0) {
    console.log('• listings already present');
    return;
  }
  await createListing({
    id: 'marais-3p',
    agency_id: agencyId,
    title: 'Appartement 3 pièces — Le Marais',
    title_en: '3-room Apartment — Le Marais',
    address: '14 rue de Bretagne, 75004 Paris',
    price: 850000,
    surface_m2: 68,
    rooms: 3,
    floor: '3e étage avec ascenseur',
    floor_en: '3rd floor with lift',
    description:
      "Charmant 3 pièces au cœur du Marais, entièrement rénové en 2023. Parquet d'origine, hauteur sous plafond 3m, double exposition est-ouest. Cuisine équipée ouverte sur séjour lumineux, deux chambres calmes sur cour.",
    description_en:
      'Charming 3-room apartment in the heart of Le Marais, fully renovated in 2023. Original parquet floors, 3m ceiling height, east-west double aspect. Open fitted kitchen, two quiet bedrooms overlooking the courtyard.',
    key_features: [
      'Rénové 2023',
      'Double exposition',
      "Parquet d'origine",
      'Cuisine équipée',
      'Cave',
      'Calme sur cour'
    ],
    key_features_en: [
      'Renovated 2023',
      'Double aspect',
      'Original parquet',
      'Fitted kitchen',
      'Cellar',
      'Quiet courtyard'
    ],
    image_url:
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    agent_name: 'Camille Laurent',
    agent_email: 'camille@agence-lumiere.fr',
    agent_calendar_id: 'primary'
  });
  await createListing({
    id: 'montmartre-studio',
    agency_id: agencyId,
    title: 'Studio meublé — Montmartre',
    title_en: 'Furnished Studio — Montmartre',
    address: '8 rue des Abbesses, 75018 Paris',
    price: 320000,
    surface_m2: 24,
    rooms: 1,
    floor: '5e étage sans ascenseur',
    floor_en: '5th floor, no lift',
    description:
      "Studio meublé idéal investissement locatif ou pied-à-terre, à deux pas du Sacré-Cœur. Très bonne rentabilité. Vendu meublé, occupé jusqu'en juin 2026 (bail mobilité).",
    description_en:
      'Furnished studio ideal for rental investment or a pied-à-terre, steps from Sacré-Cœur. Excellent yield. Sold furnished, tenanted until June 2026 (mobility lease).',
    key_features: [
      'Meublé',
      'Vue dégagée',
      'Quartier touristique',
      'Investissement locatif',
      'Loué 1 350 €/mois'
    ],
    key_features_en: [
      'Furnished',
      'Open view',
      'Tourist area',
      'Rental investment',
      'Rented at €1,350/month'
    ],
    image_url:
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
    agent_name: 'Camille Laurent',
    agent_email: 'camille@agence-lumiere.fr',
    agent_calendar_id: 'primary'
  });
  await createListing({
    id: 'vincennes-maison',
    agency_id: agencyId,
    title: 'Maison avec jardin — Vincennes',
    title_en: 'House with Garden — Vincennes',
    address: '32 avenue de Paris, 94300 Vincennes',
    price: 1150000,
    surface_m2: 142,
    rooms: 6,
    floor: 'Maison sur 2 niveaux',
    floor_en: '2-storey house',
    description:
      'Belle maison familiale 5 chambres avec jardin privatif de 80m². Proche RER A et Bois de Vincennes. Cheminée, cave, garage. Quartier résidentiel calme et recherché.',
    description_en:
      'Lovely 5-bedroom family house with a private 80m² garden. Close to RER A and Bois de Vincennes. Fireplace, cellar, garage. Quiet and sought-after residential area.',
    key_features: [
      'Jardin 80m²',
      '5 chambres',
      'Garage',
      'Cheminée',
      'Cave',
      'Proche RER A',
      'Proche écoles'
    ],
    key_features_en: [
      'Garden 80m²',
      '5 bedrooms',
      'Garage',
      'Fireplace',
      'Cellar',
      'Near RER A',
      'Near schools'
    ],
    image_url:
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
    agent_name: 'Camille Laurent',
    agent_email: 'camille@agence-lumiere.fr',
    agent_calendar_id: 'primary'
  });
  console.log('✓ 3 default listings created');
}

async function ensureAdmin(input: {
  agencyId: string;
  email: string;
  password: string;
  name: string;
  preferredLang?: string;
}) {
  const existing = await db
    .select()
    .from(admins)
    .where(eq(admins.email, input.email))
    .limit(1);
  if (existing[0]) {
    console.log(`• Admin already present: ${input.email}`);
    return;
  }
  await db.insert(admins).values({
    agency_id: input.agencyId,
    email: input.email,
    password_hash: await hashPassword(input.password),
    name: input.name,
    preferred_lang: input.preferredLang ?? 'fr'
  });
  console.log(`✓ Admin created: ${input.email}`);
}

async function seedAdmins(agencyId: string) {
  // Defaults for easy local login; override primary admin via env in production.
  await ensureAdmin({
    agencyId,
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@gmail.com',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
    name: process.env.SEED_ADMIN_NAME ?? 'Admin',
    preferredLang: 'fr'
  });

  await ensureAdmin({
    agencyId,
    email: process.env.SEED_ADMIN_FR_EMAIL ?? 'admin_fr@gmail.com',
    password: process.env.SEED_ADMIN_FR_PASSWORD ?? 'admin123',
    name: process.env.SEED_ADMIN_FR_NAME ?? 'Admin FR',
    preferredLang: 'fr'
  });

  // Test accounts for QA / demo purposes.
  await ensureAdmin({ agencyId, email: 'test1@test.com', password: 'test123', name: 'Test User 1', preferredLang: 'fr' });
  await ensureAdmin({ agencyId, email: 'test2@test.com', password: 'test123', name: 'Test User 2', preferredLang: 'en' });
  await ensureAdmin({ agencyId, email: 'demo@agence-lumiere.fr', password: 'demo123', name: 'Demo Camille', preferredLang: 'fr' });
}

async function seedLeads(agencyId: string) {
  const testLeads = [
    { email: 'lead1@test.com', name: 'Test Lead 1' },
    { email: 'lead2@test.com', name: 'Test Lead 2' },
    { email: 'buyer@test.com', name: 'Demo Buyer' }
  ];
  for (const l of testLeads) {
    const existing = await getLeadByEmail(l.email, agencyId);
    if (existing) {
      console.log(`• Lead already present: ${l.email}`);
      continue;
    }
    await createLead({ agency_id: agencyId, channel: 'web', email: l.email, name: l.name });
    console.log(`✓ Lead created: ${l.email}`);
  }
}

async function main() {
  const agencyId = await seedDefaultAgency();
  await seedConfig(agencyId);
  await seedRules(agencyId);
  await seedListings(agencyId);
  await seedAdmins(agencyId);
  await seedLeads(agencyId);
  console.log('Seed complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
