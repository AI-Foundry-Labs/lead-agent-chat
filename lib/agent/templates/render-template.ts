/**
 * Pure template renderer (F4b). Fills `{{placeholder}}` tokens from a whitelist
 * map — no arbitrary expression eval (security + KISS). Unknown or empty tokens
 * are left literal and reported in `unresolved` (never blocks the send).
 */

// Whitelisted placeholder keys. Adding a key here is the ONLY way to expose new
// lead/listing/agency data to templates.
export const TEMPLATE_PLACEHOLDERS = [
  'name',
  'email',
  'listing_title',
  'agency_name'
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export interface RenderResult {
  rendered: string;
  unresolved: string[];
}

/**
 * Replace every `{{key}}` whose key is whitelisted AND has a non-empty value.
 * Any token left in place (unknown key or empty value) is collected in
 * `unresolved` so the caller/agent can warn.
 */
export function renderTemplate(
  body: string,
  tokens: Partial<Record<TemplatePlaceholder, string | null | undefined>>
): RenderResult {
  const unresolved = new Set<string>();
  const rendered = body.replace(TOKEN_RE, (match, rawKey: string) => {
    const key = rawKey.toLowerCase() as TemplatePlaceholder;
    const isWhitelisted = (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key);
    const value = isWhitelisted ? tokens[key] : undefined;
    if (value === undefined || value === null || value === '') {
      unresolved.add(rawKey);
      return match; // leave the literal token in place
    }
    return value;
  });
  return { rendered, unresolved: [...unresolved] };
}
