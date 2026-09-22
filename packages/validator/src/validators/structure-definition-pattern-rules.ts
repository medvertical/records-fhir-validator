import type {
  ElementDefinition,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

export function validateStructureDefinitionPatterns(
  sd: StructureDefinition,
): ValidationIssue[] {
  return [
    ...validatePatternIdentifierUtility(sd),
    ...validatePatternCodingCompleteness(sd),
  ];
}

function validatePatternIdentifierUtility(sd: StructureDefinition): ValidationIssue[] {
  const elements = getElements(sd.differential);
  const issues: ValidationIssue[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const ident = element.patternIdentifier ?? element.fixedIdentifier;
    if (!isRecord(ident)) continue;
    const hasValue = typeof ident.value === 'string' && ident.value.length > 0;
    const hasExtension = Array.isArray(ident.extension) && ident.extension.length > 0;
    if (hasValue || hasExtension) continue;
    const field = element.patternIdentifier ? 'patternIdentifier' : 'fixedIdentifier';
    issues.push(createValidationIssue({
      code: 'sd-pattern-ident-1',
      path: `StructureDefinition.differential.element[${index}].${field}`,
      resourceType: 'StructureDefinition',
      customMessage:
        `Constraint failed: ident-1: 'Identifier with no value has limited utility.  ` +
        `If communicating that an identifier value has been suppressed or missing, ` +
        `the value element SHOULD be present with an extension indicating the missing ` +
        `semantic - e.g. data-absent-reason' (defined in http://hl7.org/fhir/StructureDefinition/Identifier)`,
      severityOverride: 'warning',
    }));
  }
  return issues;
}

function validatePatternCodingCompleteness(sd: StructureDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const [section, elements] of [
    ['differential', getElements(sd.differential)],
    ['snapshot', getElements(sd.snapshot)],
  ] as const) {
    elements.forEach((element, elementIndex) => {
      const field = isRecord(element.patternCodeableConcept)
        ? 'patternCodeableConcept'
        : isRecord(element.fixedCodeableConcept) ? 'fixedCodeableConcept' : null;
      if (!field) return;
      const concept = element[field];
      if (!isRecord(concept) || !Array.isArray(concept.coding)) return;

      concept.coding.forEach((coding, codingIndex) => {
        if (!isRecord(coding) || typeof coding.system !== 'string' || coding.system.length === 0) return;
        if (typeof coding.code === 'string' && coding.code.trim().length > 0) return;
        const identity = `${element.id ?? element.path}:${field}:${codingIndex}:${coding.system}`;
        if (seen.has(identity)) return;
        seen.add(identity);
        issues.push(createValidationIssue({
          code: 'sd-pattern-coding-missing-code',
          path: `StructureDefinition.${section}.element[${elementIndex}].${field}.coding[${codingIndex}].code`,
          resourceType: 'StructureDefinition',
          customMessage: `No code provided for CodeSystem '${coding.system}'`,
          severityOverride: 'warning',
        }));
      });
    });
  }
  return issues;
}

function getElements(section: unknown): ElementDefinition[] {
  if (!isRecord(section) || !Array.isArray(section.element)) return [];
  return section.element.filter(isRecord) as ElementDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
