/**
 * Built-in Advisor Rules — Canonical URL Sanity
 *
 * Pre-configured rules that catch known-bad canonical URLs in the FHIR
 * ecosystem. Based on Health Samurai's 2024 terminology data analysis:
 * four of the five most-referenced CodeSystems have documented typos.
 *
 * These rules ship as defaults — users can disable them individually.
 */

import type { AdvisorRule } from './advisor-rules';

export const CANONICAL_URL_SANITY_RULES: AdvisorRule[] = [
  // SNOMED typo: srt instead of sct
  {
    id: 'builtin-snomed-srt-typo',
    action: 'override-message',
    match: { message: 'http://snomed.info/srt' },
    transform: { message: 'Likely typo: http://snomed.info/srt should be http://snomed.info/sct (SNOMED CT)' },
    reason: 'Known ecosystem typo — srt vs sct',
    enabled: true,
  },
  // SNOMED trailing space
  {
    id: 'builtin-snomed-trailing-space',
    action: 'override-message',
    match: { message: 'http://snomed.info/sct ' },
    transform: { message: 'Trailing space in SNOMED CT system URL: "http://snomed.info/sct " — remove whitespace' },
    reason: 'Known ecosystem typo — trailing space',
    enabled: true,
  },
  // LOINC https instead of http
  {
    id: 'builtin-loinc-https',
    action: 'override-message',
    match: { message: 'https://loinc.org' },
    transform: { message: 'Wrong protocol: https://loinc.org should be http://loinc.org (LOINC uses http)' },
    reason: 'Known ecosystem typo — https vs http for LOINC',
    enabled: true,
  },
  // LOINC trailing slash
  {
    id: 'builtin-loinc-trailing-slash',
    action: 'override-message',
    match: { message: 'http://loinc.org/' },
    transform: { message: 'Trailing slash in LOINC system URL: "http://loinc.org/" — use "http://loinc.org" without slash' },
    reason: 'Known ecosystem typo — trailing slash',
    enabled: true,
  },
  // HL7 FHIR canonical trailing slash
  {
    id: 'builtin-hl7-trailing-slash',
    action: 'override-message',
    match: { message: 'http://hl7.org/fhir/' },
    transform: { message: 'Trailing slash on HL7 FHIR canonical URL — may cause resolution failures' },
    reason: 'Trailing slash breaks canonical resolution',
    enabled: true,
  },
];

/**
 * Known canonical URL normalization mappings.
 * Left = what appears in resources, Right = correct canonical.
 */
export const CANONICAL_URL_NORMALIZATIONS: Array<{
  pattern: string | RegExp;
  canonical: string;
  description: string;
}> = [
  {
    pattern: 'http://snomed.info/srt',
    canonical: 'http://snomed.info/sct',
    description: 'SNOMED CT typo: srt → sct',
  },
  {
    pattern: /^http:\/\/snomed\.info\/sct\s+$/,
    canonical: 'http://snomed.info/sct',
    description: 'SNOMED CT trailing whitespace',
  },
  {
    pattern: 'https://loinc.org',
    canonical: 'http://loinc.org',
    description: 'LOINC uses http, not https',
  },
  {
    pattern: 'http://loinc.org/',
    canonical: 'http://loinc.org',
    description: 'LOINC trailing slash',
  },
  {
    pattern: /^(http:\/\/hl7\.org\/fhir\/.+)\/$/,
    canonical: '$1',
    description: 'HL7 FHIR canonical trailing slash',
  },
  {
    pattern: 'http://unitsofmeasure.org/',
    canonical: 'http://unitsofmeasure.org',
    description: 'UCUM trailing slash',
  },
  {
    pattern: 'https://unitsofmeasure.org',
    canonical: 'http://unitsofmeasure.org',
    description: 'UCUM uses http, not https',
  },
  {
    pattern: 'http://www.nlm.nih.gov/research/umls/rxnorm/',
    canonical: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    description: 'RxNorm trailing slash',
  },
  {
    pattern: 'https://www.nlm.nih.gov/research/umls/rxnorm',
    canonical: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    description: 'RxNorm uses http, not https',
  },
  {
    pattern: 'http://hl7.org/fhir/sid/icd-10/',
    canonical: 'http://hl7.org/fhir/sid/icd-10',
    description: 'ICD-10 trailing slash',
  },
  {
    pattern: 'http://fhir.de/CodeSystem/bfarm/icd-10-gm/',
    canonical: 'http://fhir.de/CodeSystem/bfarm/icd-10-gm',
    description: 'ICD-10-GM (DE) trailing slash',
  },
  {
    pattern: 'http://fhir.de/CodeSystem/bfarm/ops/',
    canonical: 'http://fhir.de/CodeSystem/bfarm/ops',
    description: 'OPS (DE) trailing slash',
  },
  {
    pattern: 'http://fhir.de/CodeSystem/bfarm/atc/',
    canonical: 'http://fhir.de/CodeSystem/bfarm/atc',
    description: 'ATC-DE trailing slash',
  },
  {
    pattern: /^urn:oid:2\.16\.840\.1\.113883\.6\.(\d+)\s*$/,
    canonical: 'urn:oid:2.16.840.1.113883.6.$1',
    description: 'OID trailing whitespace',
  },
  {
    pattern: 'http://terminology.hl7.org/CodeSystem/v3-ActCode/',
    canonical: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    description: 'v3-ActCode trailing slash',
  },
];

/**
 * Normalize a canonical URL using the known mappings.
 * Returns the corrected URL if a match is found, or the original.
 */
export function normalizeCanonicalUrl(url: string): { normalized: string; wasNormalized: boolean; description?: string } {
  for (const mapping of CANONICAL_URL_NORMALIZATIONS) {
    if (typeof mapping.pattern === 'string') {
      if (url === mapping.pattern) {
        const normalized = mapping.canonical;
        return { normalized, wasNormalized: true, description: mapping.description };
      }
    } else {
      const match = url.match(mapping.pattern);
      if (match) {
        let normalized = mapping.canonical;
        for (let i = 1; i < match.length; i++) {
          normalized = normalized.replace(`$${i}`, match[i]);
        }
        return { normalized, wasNormalized: true, description: mapping.description };
      }
    }
  }
  return { normalized: url, wasNormalized: false };
}
