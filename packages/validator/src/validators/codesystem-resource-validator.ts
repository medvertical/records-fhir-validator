import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  HL7_CONCEPT_PROPERTY_NAMESPACE,
  HL7_KNOWN_CONCEPT_PROPERTIES,
  codeSystemHasCode,
  countCodeSystemConcepts,
  getCachedCodeSystem,
  isAbsoluteUri,
  isHl7Url,
  validateUrnUuid,
} from './terminology-resource-utils';

export function validateCodeSystemResource(cs: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const url = typeof cs.url === 'string' ? cs.url : '';
  const hl7 = isHl7Url(url);

  issues.push(...validateCodeSystemUuid(url, 'CodeSystem.url', 'CodeSystem'));
  issues.push(...validateCodeSystemCaseSensitive(cs, 'CodeSystem', 'CodeSystem', hl7));
  issues.push(...validateCodeSystemSupplementContent(cs));
  issues.push(...validateCompleteCodeSystem(cs));
  issues.push(...validateHl7ConceptDefinitions(cs, 'CodeSystem.concept', 'CodeSystem', hl7));
  issues.push(...validateCodeSystemPropertyDeclarations(cs));

  if (Array.isArray(cs.concept)) {
    for (let i = 0; i < cs.concept.length; i++) {
      issues.push(...validateConceptPropertyValueCodes(cs.concept[i], i, 'CodeSystem'));
    }
  }

  return issues;
}

export function validateContainedCodeSystemResource(cs: any, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const url = typeof cs.url === 'string' ? cs.url : '';
  const pathPrefix = `ValueSet.contained[${index}]`;
  const hl7 = isHl7Url(url);

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

  issues.push(...validateCodeSystemUuid(url, `${pathPrefix}.url`, 'ValueSet'));
  issues.push(...validateCodeSystemCaseSensitive(cs, pathPrefix, 'ValueSet', hl7));
  issues.push(...validateHl7ConceptDefinitions(cs, `${pathPrefix}.concept`, 'ValueSet', hl7));

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
  cs: any,
  path: string,
  resourceType: string,
  hl7: boolean,
): ValidationIssue[] {
  const contentDefinesCodes = cs.content === 'complete' || cs.content === 'example' || cs.content === 'supplement';
  if (!contentDefinesCodes || cs.caseSensitive !== undefined && cs.caseSensitive !== null) return [];

  const severity = hl7 ? 'warning' : 'information';
  const prefix = hl7 ? 'HL7 Defined ' : '';
  return [createValidationIssue({
    code: 'tx-codesystem-missing-casesensitive',
    path,
    resourceType,
    customMessage:
      `${prefix}CodeSystems SHOULD have a stated value for the caseSensitive element ` +
      `so that users know the status and meaning of the code system clearly`,
    severityOverride: severity,
  })];
}

function validateCodeSystemSupplementContent(cs: any): ValidationIssue[] {
  if (!cs.supplements || cs.content === 'supplement') return [];

  return [createValidationIssue({
    code: 'tx-codesystem-supplement-content',
    path: 'CodeSystem.content',
    resourceType: 'CodeSystem',
    customMessage:
      `CodeSystem Supplements SHALL have a content value of 'supplement'`,
    severityOverride: 'error',
  })];
}

function validateCompleteCodeSystem(cs: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (cs.content !== 'complete') return issues;

  const concepts = cs.concept;
  const hasConcepts = Array.isArray(concepts) && concepts.length > 0;
  if (!hasConcepts) {
    issues.push(createValidationIssue({
      code: 'tx-codesystem-complete-no-concepts',
      path: 'CodeSystem',
      resourceType: 'CodeSystem',
      customMessage:
        `When a CodeSystem has content = 'complete', it doesnt make sense for there to be no concepts defined`,
      severityOverride: 'warning',
    }));
  }

  if (typeof cs.count === 'number' && hasConcepts) {
    const actualCount = countCodeSystemConcepts(concepts);
    if (cs.count !== actualCount) {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-count-mismatch',
        path: 'CodeSystem.count',
        resourceType: 'CodeSystem',
        customMessage:
          `The code system is complete, but the number of concepts (${actualCount}) ` +
          `does not match the stated total number (${cs.count})`,
        severityOverride: 'error',
      }));
    }
  }

  return issues;
}

function validateHl7ConceptDefinitions(
  cs: any,
  conceptPathPrefix: string,
  resourceType: string,
  hl7: boolean,
): ValidationIssue[] {
  if (!hl7 || !Array.isArray(cs.concept)) return [];

  for (let i = 0; i < cs.concept.length; i++) {
    const concept = cs.concept[i];
    if (concept && !concept.definition) {
      return [createValidationIssue({
        code: 'tx-codesystem-concept-no-definition',
        path: `${conceptPathPrefix}[${i}]`,
        resourceType,
        customMessage:
          `HL7 Defined CodeSystems should ensure that every concept has a definition`,
        severityOverride: 'warning',
      })];
    }
  }

  return [];
}

function validateCodeSystemPropertyDeclarations(cs: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(cs.property)) return issues;

  for (let i = 0; i < cs.property.length; i++) {
    const prop = cs.property[i];
    if (prop?.code && !prop.uri) {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-property-no-uri',
        path: `CodeSystem.property[${i}]`,
        resourceType: 'CodeSystem',
        customMessage:
          `This property has only a code ('${prop.code}') and not a URI, ` +
          `so it has no clearly defined meaning in the terminology ecosystem`,
        severityOverride: 'information',
      }));
    }

    if (typeof prop?.uri === 'string' && prop.uri.startsWith(HL7_CONCEPT_PROPERTY_NAMESPACE)) {
      const suffix = prop.uri.slice(HL7_CONCEPT_PROPERTY_NAMESPACE.length);
      if (!HL7_KNOWN_CONCEPT_PROPERTIES.has(suffix)) {
        issues.push(createValidationIssue({
          code: 'business-rule-cs-unknown-hl7-property',
          path: `CodeSystem.property[${i}]`,
          resourceType: 'CodeSystem',
          customMessage:
            `Unknown CodeSystem Property '${prop.uri}'. ` +
            `If you are creating your own property, do not create it in the HL7 namespace`,
          severityOverride: 'error',
        }));
      }
    }
  }

  return issues;
}

function validateConceptPropertyValueCodes(
  concept: any,
  index: number,
  pathPrefix: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!concept || typeof concept !== 'object') return issues;

  const conceptPath = `${pathPrefix}.concept[${index}]`;

  if (Array.isArray(concept.property)) {
    for (let p = 0; p < concept.property.length; p++) {
      const prop = concept.property[p];
      const coding = prop?.valueCoding;
      if (!coding || typeof coding !== 'object') continue;
      const system = typeof coding.system === 'string' ? coding.system : undefined;
      const code = typeof coding.code === 'string' ? coding.code : undefined;
      if (!system || !code) continue;

      const targetCs = getCachedCodeSystem(system);
      if (!targetCs || codeSystemHasCode(targetCs, code)) continue;

      const version = typeof targetCs.version === 'string' ? targetCs.version : 'null';
      issues.push(createValidationIssue({
        code: 'tx-codesystem-concept-property-code-invalid',
        path: `${conceptPath}.property[${p}].value.ofType(Coding).code`,
        resourceType: 'CodeSystem',
        customMessage:
          `Unknown code '${code}' in the CodeSystem '${system}' version '${version}'`,
        severityOverride: 'error',
      }));
    }
  }

  if (Array.isArray(concept.concept)) {
    for (let j = 0; j < concept.concept.length; j++) {
      issues.push(...validateConceptPropertyValueCodes(
        concept.concept[j],
        j,
        conceptPath,
      ));
    }
  }

  return issues;
}
