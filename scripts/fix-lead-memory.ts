import { appendLeadLongTermFacts } from '../lib/agent/append-lead-long-term-facts';
import { updateLead } from '../lib/db';

const LEAD_ID = '7dcd684c-abc1-4919-b841-a691ad657f3e';

async function main() {
  await appendLeadLongTermFacts(LEAD_ID, [
    'PURCHASE STATUS — 2026-06-10: status→abandoned, potential→cold. Lead confirmed they will not purchase — no longer interested in buying.'
  ]);
  console.log('Done: memory updated with abandoned status');
}

main().catch(console.error);
