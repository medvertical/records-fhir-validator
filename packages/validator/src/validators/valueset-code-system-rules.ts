import { isHl7CoreNamespaceUrl } from '../core/executors/terminology-hl7-namespace-rules.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { CodeSystemValidationResult } from './terminology-api-client.js';
import type {
  CodeSystem,
  CodeSystemConcept,
  TerminologyResolutionConfig,
} from './valueset-types.js';
import {
  extractSnomedEditionIdentifier,
  isTerminologyServerEligible,
} from './valueset-server-routing.js';

export function fhirVersionToPackageMajor(fhirVersion?: FhirVersion): string | undefined {
  if (fhirVersion === 'R4') return '4';
  if (fhirVersion === 'R5') return '5';
  if (fhirVersion === 'R6') return '6';
  return undefined;
}

export function isAssertableCodeSystem(codeSystem: CodeSystem): boolean {
  return codeSystem.content !== 'not-present' && codeSystem.content !== 'supplement';
}

export function findCodeSystemConcept(
  concepts: CodeSystemConcept[] | undefined,
  code: string,
): CodeSystemConcept | null {
  if (!concepts) return null;
  for (const concept of concepts) {
    if (concept.code === code) return concept;
    const nested = findCodeSystemConcept(concept.concept, code);
    if (nested) return nested;
  }
  return null;
}

/**
 * The reference validator's test, without its clock: a `deprecationDate`
 * alone turns deprecated as time passes, which a stored result cannot follow.
 */
export function isDeprecatedConcept(concept: CodeSystemConcept): boolean {
  return (concept.property ?? []).some(property =>
    (property.code === 'status' && property.valueCode === 'deprecated')
    || (property.code === 'deprecated' && property.valueBoolean === true));
}

export function buildUnverifiableCodeSystemResult(
  code: string,
  system: string,
  result: CodeSystemValidationResult,
  config: TerminologyResolutionConfig,
  codeSystemVersion?: string,
  fhirVersion?: FhirVersion,
): CodeSystemValidationResult | null {
  if (result.reason !== 'code-unknown') return null;
  const requestedEdition = system === 'http://snomed.info/sct'
    ? extractSnomedEditionIdentifier(codeSystemVersion)
    : undefined;
  const authoritativeServerEnabled = (config.servers ?? []).some(server =>
    isTerminologyServerEligible(server, fhirVersion)
    && (requestedEdition
      ? server.snomedEditions?.some(edition =>
        extractSnomedEditionIdentifier(edition) === requestedEdition)
      : server.preferredSystems?.includes(system))
  );
  const isUnverifiable =
    (system === 'http://loinc.org' && /^LA\d+-\d$/.test(code)) ||
    (system === 'http://www.genenames.org/geneId' &&
      code.split('::').length >= 2 &&
      code.split('::').every(component => /^HGNC:\d+$/.test(component))) ||
    (system === 'http://snomed.info/sct' && !authoritativeServerEnabled);
  if (!isUnverifiable) return null;

  if (system === 'http://loinc.org') {
    return {
      valid: false,
      reason: 'system-unresolvable',
      message: `Could not verify LOINC answer-list code '${code}'. The configured terminology source ` +
        'does not expose a complete LOINC answer-list CodeSystem.',
    };
  }
  if (system === 'http://www.genenames.org/geneId') {
    return {
      valid: false,
      reason: 'system-unresolvable',
      message: `Could not verify composite HGNC fusion code '${code}' as a single terminology concept. ` +
      'Validate its individual HGNC components instead.',
    };
  }
  if (requestedEdition) {
    return {
      valid: false,
      reason: 'system-unresolvable',
      message: `Could not verify SNOMED CT code '${code}' against requested edition '${requestedEdition}'. ` +
        'Configure an enabled terminology server whose snomedEditions includes this module identifier.',
    };
  }
  return {
    valid: false,
    reason: 'system-unresolvable',
    message: `Could not verify SNOMED CT code '${code}' against an authoritative unversioned SNOMED edition. ` +
      'Configure a SNOMED-preferred terminology server or provide a versioned Coding.version to enforce code membership.',
  };
}

/**
 * A CodeSystem in the core namespace (`http://hl7.org/fhir/resource-types`)
 * belongs to one release of the specification, and later releases rename or
 * retire some (R5 has `fhir-types`). Another release's copy does not define
 * it for the one being validated, as in the reference validator, which loads
 * only that release's core package.
 */
export function isCodeSystemForRequestedRelease(
    canonical: string,
    codeSystem: CodeSystem,
    preferredFhirMajor?: string,
    requestedVersion?: string,
): boolean {
    if (requestedVersion || !preferredFhirMajor || !isHl7CoreNamespaceUrl(canonical)) return true;
    const releaseMajor = typeof codeSystem.version === 'string'
        ? codeSystem.version.match(/^(\d+)\.\d+\.\d+/)?.[1]
        : undefined;
    return !releaseMajor || releaseMajor === preferredFhirMajor;
}

export function majorFhirVersion(major?: string): FhirVersion | undefined {
    return major === '4' ? 'R4' : major === '5' ? 'R5' : major === '6' ? 'R6' : undefined;
}
