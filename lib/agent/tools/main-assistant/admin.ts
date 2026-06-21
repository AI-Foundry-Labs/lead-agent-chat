// Admin self-management tools: update persona so the bot knows how to interact with this admin.
import { tool } from 'ai';
import { z } from 'zod';
import { updateAdminPersona } from '@/lib/db/admins';

export function buildAdminTools(adminId: string) {
  return {
    update_admin_persona: tool({
      description:
        'Update the persona/style description that guides how the bot interacts with this admin. ' +
        'Use this when the admin wants to change how the assistant addresses them, their preferred communication style, role context, or any relevant background. ' +
        'Pass null to clear the persona.',
      inputSchema: z.object({
        persona: z
          .string()
          .nullable()
          .describe(
            'Freeform description: preferred tone, role, communication style, context. ' +
            'Example: "Senior broker, prefers bullet-point summaries, dislikes excessive pleasantries, responds late evenings." ' +
            'Pass null to clear.'
          ),
      }),
      execute: async ({ persona }) => {
        await updateAdminPersona(adminId, persona);
        return persona
          ? { ok: true, message: 'Admin persona updated.' }
          : { ok: true, message: 'Admin persona cleared.' };
      },
    }),
  };
}
