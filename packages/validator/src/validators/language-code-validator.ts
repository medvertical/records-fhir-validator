import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  EXTLANG_SUBTAGS,
  EXTLANG_PREFIXES,
  GRANDFATHERED_TAGS,
  LANGUAGE_SUBTAGS,
  REGION_SUBTAGS,
  SCRIPT_SUBTAGS,
  VARIANT_SUBTAGS,
} from './language-subtag-registry-data.js';

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
  grandfathered: Set<string>;
  extLangPrefixes: Map<string, string>;
} | null = null;

function getRegistry(): NonNullable<typeof registry> {
  registry ??= {
    languages: new Set(LANGUAGE_SUBTAGS.split(' ')),
    extLangs: new Set(EXTLANG_SUBTAGS.split(' ')),
    scripts: new Set(SCRIPT_SUBTAGS.split(' ')),
    regions: new Set(REGION_SUBTAGS.split(' ')),
    variants: new Set(VARIANT_SUBTAGS.split(' ')),
    grandfathered: new Set(GRANDFATHERED_TAGS.split(' ')),
    extLangPrefixes: new Map(EXTLANG_PREFIXES.split(' ').map(entry => {
      const [subtag, prefix] = entry.split('=');
      return [subtag, prefix];
    })),
  };
  return registry;
}

/** RFC 5646 tag validity at the bundled registry date; extension-specific semantics are separate. */
export function parseLanguageTag(code: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(code)) return 'language tags must contain only ASCII letters, digits and hyphens';
  const { languages, extLangs, scripts, regions, variants, grandfathered, extLangPrefixes } = getRegistry();
  const tag = code.toLowerCase();
  if (grandfathered.has(tag)) return null;
  const parts = tag.split('-');
  if (parts.some(part => !/^[a-z0-9]{1,8}$/.test(part))) return 'subtags must contain one to eight ASCII letters or digits';
  if (parts[0] === 'x') return parts.length > 1 ? null : 'private use requires a subtag after x';
  if (!languages.has(parts[0])) {
    return `'${parts[0]}' is not a valid primary language subtag in the IANA language subtag registry`;
  }
  let cursor = 1;
  if (parts[0].length <= 3) {
    for (let i = 0; i < 3 && cursor < parts.length && /^[a-z]{3}$/.test(parts[cursor]); i++) {
      const subtag = parts[cursor];
      if (!extLangs.has(subtag) || extLangPrefixes.get(subtag) !== parts.slice(0, cursor).join('-'))
        return `'${subtag}' is not a registered extended language subtag for this prefix`;
      cursor++;
    }
  }
  if (cursor < parts.length && /^[a-z]{4}$/.test(parts[cursor])) {
    if (!scripts.has(parts[cursor])) return `'${parts[cursor]}' is not a registered script subtag`;
    cursor++;
  }
  if (cursor < parts.length && /^(?:[a-z]{2}|[0-9]{3})$/.test(parts[cursor])) {
    if (!regions.has(parts[cursor])) return `'${parts[cursor]}' is not a registered region subtag`;
    cursor++;
  }
  const seenVariants = new Set<string>();
  while (cursor < parts.length && /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(parts[cursor])) {
    const variant = parts[cursor++];
    if (!variants.has(variant)) return `'${variant}' is not a registered variant subtag`;
    if (seenVariants.has(variant)) return `duplicate variant '${variant}'`;
    seenVariants.add(variant);
  }
  return parseExtensions(parts, cursor);
}

function parseExtensions(parts: string[], start: number): string | null {
  const singletons = new Set<string>();
  let cursor = start;
  while (cursor < parts.length) {
    const singleton = parts[cursor++];
    if (singleton === 'x') return cursor < parts.length ? null : 'private use requires a subtag after x';
    if (singleton.length !== 1) return `unable to recognise part ${cursor} ('${singleton}') as a valid language part`;
    if (singletons.has(singleton)) return `duplicate extension singleton '${singleton}'`;
    singletons.add(singleton);
    const contentStart = cursor;
    while (cursor < parts.length && parts[cursor].length >= 2) cursor++;
    if (cursor === contentStart) return `extension '${singleton}' requires a subtag of two to eight characters`;
  }
  return null;
}
