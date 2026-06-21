// Shared types for main-assistant tool modules.
// RunAgentTurn is passed as a parameter to avoid circular imports
// (run.ts defines runAgentTurn and also imports buildMainAssistantTools).
export type RunAgentTurn = (
  conversationId: string,
  message: string,
  actor:
    | { type: 'operator'; leadId: string | null; adminId: string; adminName: string | null }
    | { type: 'lead' },
  lang?: string,
  messageRole?: 'user' | 'system'
) => Promise<{ reply: string }>;
