export function interpolateMessageTemplate(
  template: string,
  params: Record<string, unknown>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.split(`{${key}}`).join(String(value ?? ''));
  }
  return stripUnfilledPlaceholders(result);
}

/**
 * Drop placeholders no caller supplied.
 *
 * A template renders with whatever the call site passed; anything it did not
 * pass stayed in the output verbatim, so readers saw "Structural validation
 * failed: {error}" and "Element {element} has too few values". That is never a
 * useful message, and it hides the finding behind template syntax — twice
 * during the XML parity work it disguised the actual defect.
 *
 * A missing detail should shorten the message, not corrupt it. The detail
 * clause that carried the placeholder is dropped whole, because half a clause
 * ("expected at least , found") reads worse than none.
 */
function stripUnfilledPlaceholders(message: string): string {
  if (!PLACEHOLDER.test(message)) return message;

  const withoutDetailClause = message.replace(DETAIL_CLAUSE_WITH_PLACEHOLDER, '');
  const cleaned = withoutDetailClause
    .replace(PLACEHOLDER_GLOBAL, '')
    .replace(/\s{2,}/gu, ' ')
    .replace(/\s+([,.;:])/gu, '$1')
    .replace(/[\s,;:-]+$/u, '')
    .trim();

  return cleaned.length > 0 ? cleaned : message;
}

/** A trailing detail clause, introduced by ":" or " - ", that still holds a placeholder. */
const DETAIL_CLAUSE_WITH_PLACEHOLDER = /(?::|\s-)\s[^:]*\{[A-Za-z_]\w*\}.*$/u;
const PLACEHOLDER = /\{[A-Za-z_]\w*\}/u;
const PLACEHOLDER_GLOBAL = /\{[A-Za-z_]\w*\}/gu;
