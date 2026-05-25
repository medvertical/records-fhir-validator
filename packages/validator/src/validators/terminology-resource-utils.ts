import { valueSetCache } from './valueset-cache';
import type { CodeSystem, CodeSystemConcept } from './valueset-types';

const HL7_URL_PATTERNS = [
  /^http:\/\/hl7\.org\/fhir\//,
  /^http:\/\/terminology\.hl7\.org\//,
  /^https?:\/\/.*\.hl7\.org\//,
];

export const HL7_CONCEPT_PROPERTY_NAMESPACE = 'http://hl7.org/fhir/concept-properties#';

export const HL7_KNOWN_CONCEPT_PROPERTIES = new Set<string>([
  'status',
  'inactive',
  'effectiveDate',
  'deprecationDate',
  'deprecated',
  'notSelectable',
  'parent',
  'child',
  'partOf',
  'synonym',
  'comment',
  'comments',
  'itemWeight',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ALLOWED_FILTER_OPS = new Set([
  '=',
  'is-a',
  'descendent-of',
  'is-not-a',
  'regex',
  'in',
  'not-in',
  'generalizes',
  'exists',
]);

const TX_ONLY_CODE_SYSTEMS = new Set<string>([
  'http://loinc.org',
  'http://snomed.info/sct',
  'http://www.nlm.nih.gov/research/umls/rxnorm',
  'http://hl7.org/fhir/sid/icd-10',
  'http://hl7.org/fhir/sid/icd-10-cm',
  'http://hl7.org/fhir/sid/icd-9-cm',
  'http://hl7.org/fhir/sid/icd-11',
  'http://hl7.org/fhir/sid/cvx',
  'http://www.ama-assn.org/go/cpt',
  'http://unitsofmeasure.org',
  'http://www.whocc.no/atc',
]);

export function parseSystemVersionCode(
  value: string,
): { system: string; version?: string; code: string } | null {
  const hashIdx = value.lastIndexOf('#');
  if (hashIdx <= 0) return null;
  const left = value.slice(0, hashIdx);
  const code = value.slice(hashIdx + 1);
  if (!code) return null;
  if (!/^https?:\/\//.test(left) && !/^urn:/.test(left)) return null;
  const pipeIdx = left.indexOf('|');
  if (pipeIdx >= 0) {
    return { system: left.slice(0, pipeIdx), version: left.slice(pipeIdx + 1), code };
  }
  return { system: left, code };
}

export function codeSystemHasCode(cs: CodeSystem | undefined, code: string): boolean {
  return findCodeSystemConcept(cs, code) !== undefined;
}

export function codeSystemDisplayFor(cs: CodeSystem | undefined, code: string): string | undefined {
  const concept = findCodeSystemConcept(cs, code);
  return typeof concept?.display === 'string' ? concept.display : undefined;
}

export function countCodeSystemConcepts(concepts: CodeSystemConcept[] | undefined): number {
  if (!Array.isArray(concepts)) return 0;
  let count = 0;
  const stack: CodeSystemConcept[] = [...concepts];
  while (stack.length > 0) {
    const concept = stack.pop()!;
    count++;
    if (Array.isArray(concept?.concept)) stack.push(...concept.concept);
  }
  return count;
}

export function getCachedCodeSystem(systemUrl: string | undefined): CodeSystem | undefined {
  if (!systemUrl) return undefined;
  return (
    valueSetCache.getCodeSystem(systemUrl) ??
    valueSetCache.getCodeSystemFile(systemUrl) ??
    undefined
  );
}

export function stripVersion(url: string): string {
  const idx = url.indexOf('|');
  return idx >= 0 ? url.slice(0, idx) : url;
}

export function isTxOnlySystem(url: string): boolean {
  return TX_ONLY_CODE_SYSTEMS.has(stripVersion(url));
}

export function isHl7Url(url: string): boolean {
  return HL7_URL_PATTERNS.some(p => p.test(url));
}

export function isAbsoluteUri(uri: string): boolean {
  return /^https?:\/\//.test(uri) || /^urn:/.test(uri);
}

export function validateUrnUuid(urn: string): { valid: boolean; uuid: string } {
  const uuid = urn.replace(/^urn:uuid:/, '');
  return { valid: UUID_REGEX.test(uuid), uuid };
}

function findCodeSystemConcept(
  cs: CodeSystem | undefined,
  code: string,
): CodeSystemConcept | undefined {
  if (!cs || !Array.isArray(cs.concept)) return undefined;
  const stack: CodeSystemConcept[] = [...cs.concept];
  while (stack.length > 0) {
    const concept = stack.pop()!;
    if (concept?.code === code) return concept;
    if (Array.isArray(concept?.concept)) stack.push(...concept.concept);
  }
  return undefined;
}
