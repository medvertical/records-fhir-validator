import { isRejectedCodeSystemDisplayResult, isVerifiedCodeSystemResult } from './code-system-validation-evidence.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import { displaysEquivalent, displaysEquivalentForCodeInfo, type CodeInfo } from './valueset-display-utils.js';

export function hasAuthoritativeDisplayMismatch(result: CodeSystemValidationResult): boolean {
  return !result.valid && (isVerifiedCodeSystemResult(result) || isRejectedCodeSystemDisplayResult(result))
    && (result.reason === 'display-mismatch' || Boolean(result.issues?.some(issue => issue.code === 'invalid-display')));
}

export function sourceDisplaysEquivalent(
  expected: string,
  actual: string,
  coding: Pick<CodeInfo, 'system' | 'code'>,
): boolean {
  // Token overlap cannot overrule the selected source's rejection of a LOINC display.
  return coding.system === 'http://loinc.org'
    ? displaysEquivalent(expected, actual)
    : displaysEquivalentForCodeInfo(expected, actual, coding);
}

export function extractAcceptedDisplays(message: string | undefined): string[] {
  if (!message) return [];
  const choices = message.match(/Valid display is one of (\d+) choices:\s*([\s\S]*)$/);
  if (choices) return parseDisplayChoices(choices[2] ?? '', Number(choices[1]), true);
  const single = message.match(/Valid display is\s+([\s\S]*)$/);
  return single ? parseDisplayChoices(single[1] ?? '', 1, false) : [];
}

function parseDisplayChoices(text: string, count: number, requireLanguage: boolean): string[] {
  const displays: string[] = [];
  let remaining = text.trim();
  while (remaining.startsWith("'")) {
    // Only word apostrophes are unambiguous inside unescaped quoted prose.
    // Other quote boundaries leave the typed result in charge.
    const choice = remaining.match(/^'((?:[^']|(?<=\p{L})'(?=\p{L}))+)'\s*(\([A-Za-z0-9-]+\))?/u);
    if (!choice?.[1] || (requireLanguage && !choice[2])) return [];
    displays.push(choice[1]);
    remaining = remaining.slice(choice[0].length).trim();
    if (!remaining || remaining === '.' || /^\(for the language\(s\) '[^']*'\)\.?$/.test(remaining)) {
      return displays.length === count ? displays : [];
    }
    const separator = remaining.match(/^(?:,\s*(?:or\s+)?|or\s+)/);
    if (!separator || displays.length >= count) return [];
    remaining = remaining.slice(separator[0].length).trimStart();
  }
  return [];
}
