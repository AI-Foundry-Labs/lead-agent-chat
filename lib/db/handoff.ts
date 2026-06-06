import { desc, eq } from 'drizzle-orm';
import { db, handoff_rules } from './client';
import type { HandoffRule } from '@/lib/types';

function rowToRule(r: typeof handoff_rules.$inferSelect): HandoffRule {
  return {
    id: r.id,
    description: r.description,
    trigger_keywords: r.trigger_keywords,
    active: r.active,
    created_at: r.created_at
  };
}

export async function listHandoffRules(): Promise<HandoffRule[]> {
  const rows = await db
    .select()
    .from(handoff_rules)
    .orderBy(desc(handoff_rules.created_at));
  return rows.map(rowToRule);
}

export async function listActiveHandoffRules(): Promise<HandoffRule[]> {
  const rows = await db
    .select()
    .from(handoff_rules)
    .where(eq(handoff_rules.active, true))
    .orderBy(desc(handoff_rules.created_at));
  return rows.map(rowToRule);
}

export async function createHandoffRule(input: {
  description: string;
  trigger_keywords: string[];
}): Promise<HandoffRule> {
  const [r] = await db
    .insert(handoff_rules)
    .values({
      description: input.description,
      trigger_keywords: input.trigger_keywords
    })
    .returning();
  return rowToRule(r);
}

export async function toggleHandoffRule(
  id: string,
  active: boolean
): Promise<HandoffRule> {
  const [r] = await db
    .update(handoff_rules)
    .set({ active })
    .where(eq(handoff_rules.id, id))
    .returning();
  return rowToRule(r);
}

export async function deleteHandoffRule(id: string): Promise<void> {
  await db.delete(handoff_rules).where(eq(handoff_rules.id, id));
}
