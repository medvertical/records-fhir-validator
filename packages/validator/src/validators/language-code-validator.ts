import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  EXTLANG_SUBTAGS,
  LANGUAGE_SUBTAGS,
  REGION_SUBTAGS,
  SCRIPT_SUBTAGS,
  VARIANT_SUBTAGS,
} from './language-subtag-registry-data.js';

/**
 * Resource.language validation mirroring the HL7 Java validator
 * (org.hl7.fhir.utilities.i18n.LanguageTag, core 6.10.0).
 *
 * The Java parser consumes, in order: one language subtag (must exist in the
 * IANA registry, case-sensitively), up to three extlangs, one script, one
 * region, ONE variant, then any parts that start with "x" as private use.
 * Anything left over makes the tag invalid. This deliberately keeps the Java
 * quirks — a single variant only, no singleton extensions (`en-u-...`), and
 * `x` handled as a bare prefix — because HAPI parity, not full BCP-47, is the
 * contract. HAPI reports this as an error, but only as a side effect of the
 * displayLanguage plumbing; Records keeps it a warning-level data lint.
 */
export function validateResourceLanguage(
  resource: unknown,
  resourceType: string,
): ValidationIssue[] {
  if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) return [];
  const language = (resource as Record<string, unknown>).language;
  if (typeof language !== 'string' || language.length === 0) return [];

  const failure = parseLanguageTag(language);
  if (!failure) return [];

  return [createValidationIssue({
    code: 'language-code-invalid',
    path: `${resourceType}.language`,
    resourceType,
    customMessage: `The language code '${language}' is not valid: ${failure}`,
    severityOverride: 'warning',
    details: {
      value: language,
      fixHint: 'Use a BCP-47 language tag built from IANA-registered subtags, e.g. "en", "de-CH" or "en-US".',
    },
  })];
}

let registry: {
  languages: Set<string>;
  extLangs: Set<string>;
  scripts: Set<string>;
  regions: Set<string>;
  variants: Set<string>;
} | null = null;

function getRegistry(): NonNullable<typeof registry> {
  registry ??= {
    languages: new Set(LANGUAGE_SUBTAGS.split(' ')),
    extLangs: new Set(EXTLANG_SUBTAGS.split(' ')),
    scripts: new Set(SCRIPT_SUBTAGS.split(' ')),
    regions: new Set(REGION_SUBTAGS.split(' ')),
    variants: new Set(VARIANT_SUBTAGS.split(' ')),
  };
  return registry;
}

/** Returns a human-readable failure reason, or null when the tag parses. */
export function parseLanguageTag(code: string): string | null {
  const { languages, extLangs, scripts, regions, variants } = getRegistry();
  const parts = code.split('-');
  if (!languages.has(parts[0])) {
    return `'${parts[0]}' is not a valid primary language subtag in the IANA language subtag registry`;
  }
  let cursor = 1;
  for (let i = 0; i < 3 && cursor < parts.length && extLangs.has(parts[cursor]); i++) {
    cursor++;
  }
  if (cursor < parts.length && scripts.has(parts[cursor])) cursor++;
  if (cursor < parts.length && regions.has(parts[cursor])) cursor++;
  if (cursor < parts.length && variants.has(parts[cursor])) cursor++;
  while (cursor < parts.length && parts[cursor].startsWith('x')) cursor++;
  if (cursor < parts.length) {
    return `unable to recognise part ${cursor + 1} ('${parts[cursor]}') as a valid language part`;
  }
  return null;
}
