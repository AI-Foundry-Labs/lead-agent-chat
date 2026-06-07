import { z } from 'zod';

/** Structured output from short-term thread compression. */
export const threadSummaryResultSchema = z.object({
  summary: z
    .string()
    .max(2000)
    .describe(
      '3–8 concise bullet points summarizing the folded turns for in-thread context'
    ),
  need_memorize: z
    .boolean()
    .describe(
      'true ONLY when folded turns add NEW personal identity/contact OR important buy/sell/product/pricing preferences not already captured in the prior summary'
    ),
  memorize_facts: z
    .array(z.string().max(300))
    .max(10)
    .describe(
      'When need_memorize is true: durable facts to store cross-thread (personal + product/pricing). Empty array when need_memorize is false.'
    )
});

export type ThreadSummaryResult = z.infer<typeof threadSummaryResultSchema>;
