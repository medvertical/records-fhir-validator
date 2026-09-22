import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
  HL7_CONCEPT_PROPERTY_NAMESPACE,
  HL7_KNOWN_CONCEPT_PROPERTIES,
  codeSystemHasCode,
  countCodeSystemConcepts,
  getCachedCodeSystem,
  isAbsoluteUri,
  isHl7Url,
  validateUrnUuid,
} from './terminology-resource-utils.js';
import { ValueSetCache } from './valueset-cache.js';

type FhirRecord = Record<string, unknown>;

interface ConceptNode {
  concept: FhirRecord;
  path: string;
}

export function validateCodeSystemResource(
  value: unknown,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  cache: ValueSetCache = new ValueSetCache(),
): ValidationIssue[] {
  const codeSystem = toRecord(value);
  if (!codeSystem) return [];

  const url = getString(codeSystem.url) ?? '';
  const hl7 = isHl7Url(url);
  return [
    ...validateCodeSystemUuid(url, 'CodeSystem.url', 'CodeSystem'),
    ...validateCodeSystemCaseSensitive(codeSystem, 'CodeSystem', 'CodeSystem', hl7),
    ...validateCodeSystemSupplementContent(codeSystem),
    ...validateCompleteCodeSystem(codeSystem),
    ...validateHl7ConceptDefinitions(
      codeSystem,
      'CodeSystem.concept',
      'CodeSystem',
      hl7,
    ),
    ...validateCodeSystemPropertyDeclarations(codeSystem, fhirVersion),
    ...validateConceptPropertyValueCodes(codeSystem, 'CodeSystem.concept', cache),
  ];
}

export function validateContainedCodeSystemResource(
  value: unknown,
  index: number,
): ValidationIssue[] {
  const codeSystem = toRecord(value);
  if (!codeSystem) return [];

  const url = getString(codeSystem.url) ?? '';
  const pathPrefix = `ValueSet.contained[${index}]`;
  const hl7 = isHl7Url(url);
  const issues: ValidationIssue[] = [];

  if (url && !isAbsoluteUri(url)) {
    issues.push(createValidationIssue({
      code: 'tx-codesystem-url-not-absolute',
      path: `${pathPrefix}.url`,
      resourceType: 'ValueSet',
      customMessage:
        `Canonical URLs in contained resources must be absolute URLs if present (${url})`,
      severityOverride: 'error',
    }));
  }

  issues.push(
    ...validateCodeSystemUuid(url, `${pathPrefix}.url`, 'ValueSet'),
    ...validateCodeSystemCaseSensitive(codeSystem, pathPrefix, 'ValueSet', hl7),
    ...validateHl7ConceptDefinitions(
      codeSystem,
      `${pathPrefix}.concept`,
      'ValueSet',
      hl7,
    ),
  );
  return issues;
}

function validateCodeSystemUuid(
  url: string,
  path: string,
  resourceType: string,
): ValidationIssue[] {
  if (!url.startsWith('urn:uuid:')) return [];
  const { valid, uuid } = validateUrnUuid(url);
  if (valid) return [];

  return [createValidationIssue({
    code: 'tx-codesystem-url-invalid-uuid',
    path,
    resourceType,
    customMessage: `UUIDs must be valid and lowercase (${uuid})`,
    severityOverride: 'error',
  })];
}

function validateCodeSystemCaseSensitive(
  codeSystem: FhirRecord,
  path: string,
  resourceType: string,
  hl7: boolean,
): ValidationIssue[] {
  const contentDefinesCodes =
    codeSystem.content === 'complete'
    || codeSystem.content === 'example'
    || codeSystem.content === 'supplement';
  const caseSensitivePresent =
    codeSystem.caseSensitive !== undefined
    && codeSystem.caseSensitive !== null;
  if (caseSensitivePresent || (!hl7 && !contentDefinesCodes)) return [];

  return [createValidationIssue({
    code: 'tx-codesystem-missing-casesensitive',
    path,
    resourceType,
    customMessage:
      `${hl7 ? 'HL7 Defined ' : ''}CodeSystems SHOULD have a stated value ` +
      'for the caseSensitive element so that users know the status and meaning ' +
      'of the code system clearly',
    severityOverride: hl7 ? 'warning' : 'information',
  })];
}

function validateCodeSystemSupplementContent(
  codeSystem: FhirRecord,
): ValidationIssue[] {
  if (!getString(codeSystem.supplements) || codeSystem.content === 'supplement') {
    return [];
  }
  return [createValidationIssue({
    code: 'tx-codesystem-supplement-content',
    path: 'CodeSystem.content',
    resourceType: 'CodeSystem',
    customMessage: `CodeSystem Supplements SHALL have a content value of 'supplement'`,
    severityOverride: 'error',
  })];
}

function validateCompleteCodeSystem(
  codeSystem: FhirRecord,
): ValidationIssue[] {
  if (codeSystem.content !== 'complete') return [];

  const concepts = Array.isArray(codeSystem.concept) ? codeSystem.concept : [];
  const actualCount = countCodeSystemConcepts(concepts);
  const issues: ValidationIssue[] = [];
  if (actualCount === 0) {
    issues.push(createValidationIssue({
      code: 'tx-codesystem-complete-no-concepts',
      path: 'CodeSystem',
      resourceType: 'CodeSystem',
      customMessage:
        `When a CodeSystem has content = 'complete', it doesnt make sense ` +
        'for there to be no concepts defined',
      severityOverride: 'warning',
    }));
  }

  if (
    typeof codeSystem.count === 'number'
    && Number.isFinite(codeSystem.count)
    && actualCount > 0
    && codeSystem.count !== actualCount
  ) {
    issues.push(createValidationIssue({
      code: 'tx-codesystem-count-mismatch',
      path: 'CodeSystem.count',
      resourceType: 'CodeSystem',
      customMessage:
        `The code system is complete, but the number of concepts (${actualCount}) ` +
        `does not match the stated total number (${codeSystem.count})`,
      severityOverride: 'error',
    }));
  }
  return issues;
}

/**
 * The message is about the code system, not about the one concept it points
 * at — "should ensure that *every* concept has a definition" — so it is stated
 * once, against the first concept that lacks one. Repeating it per concept
 * turned a single remark into 1 300 of them on a code system the size of
 * v3-ActCode, and the reference validator reports it once.
 */
function validateHl7ConceptDefinitions(
  codeSystem: FhirRecord,
  conceptPathPrefix: string,
  resourceType: string,
  hl7: boolean,
): ValidationIssue[] {
  if (!hl7) return [];
  const undefinedConcept = walkConcepts(codeSystem.concept, conceptPathPrefix)
    .find(node => !getString(node.concept.definition));
  if (!undefinedConcept) return [];

  return [createValidationIssue({
    code: 'tx-codesystem-concept-no-definition',
    path: undefinedConcept.path,
    resourceType,
    customMessage:
      `HL7 Defined CodeSystems should ensure that every concept has a definition`,
    severityOverride: 'warning',
  })];
}

function validateCodeSystemPropertyDeclarations(
  codeSystem: FhirRecord,
  fhirVersion: 'R4' | 'R5' | 'R6',
): ValidationIssue[] {
  if (!Array.isArray(codeSystem.property)) return [];
  const issues: ValidationIssue[] = [];

  for (let index = 0; index < codeSystem.property.length; index++) {
    const property = toRecord(codeSystem.property[index]);
    if (!property) continue;
    const code = getString(property.code);
    const uri = getString(property.uri);
    const path = `CodeSystem.property[${index}]`;

    if (code && !uri) {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-property-no-uri',
        path,
        resourceType: 'CodeSystem',
        customMessage:
          `This property has only a code ('${code}') and not a URI, ` +
          `so it has no clearly defined meaning in the terminology ecosystem`,
        severityOverride: 'information',
      }));
    }

    if (!uri?.startsWith(HL7_CONCEPT_PROPERTY_NAMESPACE)) continue;
    const suffix = uri.slice(HL7_CONCEPT_PROPERTY_NAMESPACE.length);
    if (HL7_KNOWN_CONCEPT_PROPERTIES.has(suffix)) continue;

    if (fhirVersion !== 'R4') {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-property-uri-unresolvable',
        path,
        resourceType: 'CodeSystem',
        customMessage:
          `The uri '${uri}' for the property '${code ?? suffix}' implies ` +
          'a property exists in the referenced HL7 CodeSystem, but none was found',
        severityOverride: 'warning',
      }));
    }
    issues.push(createValidationIssue({
      code: 'business-rule-cs-unknown-hl7-property',
      path,
      resourceType: 'CodeSystem',
      customMessage:
        `Unknown CodeSystem Property '${uri}'. ` +
        `If you are creating your own property, do not create it in the HL7 namespace`,
      severityOverride: 'error',
    }));
  }
  return issues;
}

function validateConceptPropertyValueCodes(
  codeSystem: FhirRecord,
  conceptPathPrefix: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of walkConcepts(codeSystem.concept, conceptPathPrefix)) {
    const properties = Array.isArray(node.concept.property)
      ? node.concept.property
      : [];
    for (let index = 0; index < properties.length; index++) {
      const property = toRecord(properties[index]);
      const coding = toRecord(property?.valueCoding);
      const system = getString(coding?.system);
      const code = getString(coding?.code);
      if (!system || !code) continue;

      const targetCodeSystem = getCachedCodeSystem(system, cache);
      if (!targetCodeSystem || codeSystemHasCode(targetCodeSystem, code)) continue;

      const version = getString(targetCodeSystem.version) ?? 'null';
      const path = `${node.path}.property[${index}].value.ofType(Coding).code`;
      issues.push(createValidationIssue({
        code: 'tx-codesystem-concept-property-code-invalid',
        path,
        resourceType: 'CodeSystem',
        customMessage:
          `Unknown code '${code}' in the CodeSystem '${system}' version '${version}'`,
        severityOverride: 'error',
        details: { code, system },
      }));
    }
  }
  return issues;
}

function walkConcepts(
  value: unknown,
  pathPrefix: string,
): ConceptNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: ConceptNode[] = [];
  const pending: Array<{ value: unknown; path: string }> = [];
  for (let index = value.length - 1; index >= 0; index--) {
    pending.push({ value: value[index], path: `${pathPrefix}[${index}]` });
  }
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    const concept = toRecord(current?.value);
    if (!current || !concept || visited.has(concept)) continue;
    visited.add(concept);
    nodes.push({ concept, path: current.path });

    const children = Array.isArray(concept.concept) ? concept.concept : [];
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({
        value: children[index],
        path: `${current.path}.concept[${index}]`,
      });
    }
  }
  return nodes;
}

function toRecord(value: unknown): FhirRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as FhirRecord
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
