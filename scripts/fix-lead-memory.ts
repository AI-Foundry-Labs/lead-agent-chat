import { appendLeadLongTermFacts } from '../lib/agent/append-lead-long-term-facts';
import { updateLead } from '../lib/db';

const LEAD_ID = '7dcd684c-abc1-4919-b841-a691ad657f3e';

async function main() {
  await appendLeadLongTermFacts(LEAD_ID, [
    'PURCHASE STATUS — Viewing CANCELLED: Studio meublé — Montmartre (8 rue des Abbesses, 75018 Paris) at mercredi 10 juin à 17:00 — reason: listing no longer available',
    'ADMIN ACTION — Admin cancelled viewing on 2026-06-09 and sent apology message to lead',
    'Lead is still actively looking — status reverted to active'
  ]);
  // Revert status from booked → active since viewing was cancelled
  await updateLead(LEAD_ID, { status: 'active' });
  console.log('Done: memory updated + status reverted to active');
}

main().catch(console.error);
