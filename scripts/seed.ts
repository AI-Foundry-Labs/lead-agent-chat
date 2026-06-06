import { eq } from 'drizzle-orm';
import {
  createHandoffRule,
  createListing,
  listHandoffRules,
  listListings,
  getAgencyConfig,
  upsertAgencyConfig,
  db,
  admins
} from '../lib/db';
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

async function seedConfig() {
  if (await getAgencyConfig()) {
    console.log('• Agency config already present');
    return;
  }
  await upsertAgencyConfig({
    name: 'Agence Lumière',
    tone:
      'Professional and warm. Parisian agency style. Never overly formal, never casual. Always reply in the same language the lead writes in (French or English).',
    qualification_criteria: DEFAULT_CRITERIA,
    calendar_id: process.env.GOOGLE_CALENDAR_ID ?? 'primary'
  });
  console.log('✓ Agency config created (5 default criteria)');
}

async function seedRules() {
  const rules = await listHandoffRules();
  const has = (txt: string) =>
    rules.some((r) => r.description.toLowerCase().includes(txt.toLowerCase()));

  if (!has('negotiation')) {
    await createHandoffRule({
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

async function seedListings() {
  if ((await listListings()).length > 0) {
    console.log('• listings already present');
    return;
  }
  await createListing({
    id: 'marais-3p',
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

async function seedAdmin() {
  // Defaults for easy local login; override via env in production.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@gmail.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const existing = await db
    .select()
    .from(admins)
    .where(eq(admins.email, adminEmail))
    .limit(1);
  if (existing[0]) {
    console.log(`• Admin already present: ${adminEmail}`);
    return;
  }
  await db.insert(admins).values({
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    name: process.env.SEED_ADMIN_NAME ?? 'Admin'
  });
  console.log(`✓ Admin created: ${adminEmail}`);
}

async function main() {
  await seedConfig();
  await seedRules();
  await seedListings();
  await seedAdmin();
  console.log('Seed complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
