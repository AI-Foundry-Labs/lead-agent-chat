import { generateText } from 'ai';
import { FAST_MODEL } from '@/lib/llm';
import type { Language } from '@/lib/types';

/**
 * Detect whether a message is French or English using the fast model.
 * Defaults to 'fr' on failure or ambiguity (agency is based in France).
 */
export async function detectMessageLang(text: string): Promise<Language> {
  if (!text.trim()) return 'fr';
  try {
    const { text: result } = await generateText({
      model: FAST_MODEL,
      system: 'Identify the language of this message. Reply with ONLY "en" if the message is written in English, or "fr" if it is written in French or is ambiguous. No other output.',
      messages: [{ role: 'user', content: text.slice(0, 300) }]
    });
    return result.trim().toLowerCase() === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}
