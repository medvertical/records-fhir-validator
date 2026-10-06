import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateLocalCodeSystemCoding } from './terminology-external-code-system-rules.js';
import type { ProfileSourceContext } from '../../persistence/index.js';
import { isKnownCodeSystemConcept } from './terminology-display-rules.js';
import { metaCodingSystemIssues, relativeCodingSystemIssue } from './terminology-core-code-system-rules.js';
import type { TerminologyLocalCodeSystemValidationPort } from './terminology-validation-port.js';

/**
 * Coding-typed children of complex datatypes whose element names do not say
 * "coding": UsageContext.code, Signature.type, DataRequirement.codeFilter.code
 * and ElementDefinition.code. Meta.tag and Meta.security are Codings too but
 * stay out: tags are application namespaces, not terminology lookups.
 */
const DATATYPE_CODING_PATHS = [
  /(?:^|\.)useContext\[\d+\]\.code$/,
  /(?:^|\.)signature(?:\[\d+\])?\.type\[\d+\]$/,
  /\.codeFilter\[\d+\]\.code\[\d+\]$/,
  /\.element\[\d+\]\.code\[\d+\]$/,
];

function isCodingPath(path: string): boolean {
  return /\.coding\[\d+\]$/.test(path)
    || /\.(?:value|answer|pattern|fixed)Coding$/.test(path)
    || DATATYPE_CODING_PATHS.some(pattern => pattern.test(path));
}

/**
 * The reference validator checks a Quantity's system and code as it checks a
 * Coding, without its unit as display. A Coding never carries a value, unit
 * or comparator, so those tell the two apart wherever the Quantity sits.
 * UCUM has its own rules.
 */
function quantityCoding(value: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof value.system !== 'string' || typeof value.code !== 'string') return null;
  if (value.system === 'http://unitsofmeasure.org') return null;
  const isQuantity = typeof value.value === 'number' || typeof value.unit === 'string' || 'comparator' in value;
  return isQuantity ? { system: value.system, code: value.code } : null;
}

/**
 * Validate Coding instances below complex datatypes (for example
 * Identifier.type.coding). Core resource snapshots often stop at the
 * datatype boundary, so the StructureDefinition-driven terminology pass
 * cannot see these children.
 */
export async function validateDeepLocalCodings(
  resource: unknown,
  existingIssues: ValidationIssue[],
  valuesetValidator: TerminologyLocalCodeSystemValidationPort,
  fhirVersion: 'R4' | 'R5' | 'R6',
  sourceContext?: ProfileSourceContext,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const seen = new Set(existingIssues.map((issue) => `${issue.code}|${issue.path}`));
  const root = resourceTypeOf(resource);
  const visited = new WeakSet<object>();

  const visit = async (value: unknown, path: string, rootOwned: boolean, displayLanguage?: string): Promise<void> => {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        await visit(value[index], `${path}[${index}]`, rootOwned, displayLanguage);
      }
      return;
    }
    if (!isRecord(value)) return;
    // Embedded resources have their own profile/source scope even with the same language.
    const ownsEvidence = rootOwned && (value === resource || typeof value.resourceType !== 'string');
    if (typeof value.resourceType === 'string') {
      displayLanguage = typeof value.language === 'string' && value.language ? value.language : undefined;
    }

    // Codings below nested items and datatypes escape the definition-driven
    // pass; their system syntax is checked here.
    const systemIssues = /(?:^|\.)meta\.(?:tag|security)\[\d+\]$/.test(path)
      ? await metaCodingSystemIssues(value, path, fhirVersion, valuesetValidator.getDefinitionLookup?.())
      : isCodingPath(path) ? [relativeCodingSystemIssue(value, path)].filter(issue => issue !== null) : [];
    for (const issue of systemIssues) {
      const key = `${issue.code}|${issue.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ ...issue, resourceType: root });
    }
    const coding = isCodingPath(path) ? value : quantityCoding(value);
    if (coding) {
      let localIssues = await validateLocalCodeSystemCoding(coding, path, valuesetValidator, fhirVersion, sourceContext, { displayLanguage, rootOwned: ownsEvidence });
      if (isKnownCodeSystemConcept(value.system, value.code)) {
        localIssues = localIssues.filter((issue) => issue.code !== 'terminology-codesystem-unresolvable');
      }
      for (const issue of localIssues) {
        const key = `${issue.code}|${issue.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ ...issue, resourceType: root });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      // Bundle entries are validated as their own resources by the recursive
      // batch path; do not duplicate their terminology findings on Bundle.
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) continue;
      await visit(child, `${path}.${key}`, ownsEvidence, displayLanguage);
    }
  };

  await visit(resource, root, true);
  return issues;
}

function resourceTypeOf(value: unknown): string {
  return isRecord(value) && typeof value.resourceType === 'string' ? value.resourceType : 'Resource';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
