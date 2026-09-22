import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

export function validateCompositionConstraints(
  resource: Record<string, unknown>,
): ValidationIssue[] {
  const sections = Array.isArray(resource.section) ? resource.section : [];
  const issues: ValidationIssue[] = [];
  const ancestors = new WeakSet<object>();

  sections.forEach((section, index) => {
    issues.push(...validateCompositionSection(
      section,
      `Composition.section[${index}]`,
      ancestors,
    ));
  });
  return issues;
}

function validateCompositionSection(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): ValidationIssue[] {
  if (!isRecord(value) || ancestors.has(value)) return [];
  ancestors.add(value);
  const issues: ValidationIssue[] = [];

  try {
    const hasText = isRecord(value.text) &&
      typeof value.text.div === 'string' &&
      value.text.div.length > 0;
    const entries = Array.isArray(value.entry)
      ? value.entry.filter(isRecord)
      : [];
    const subSections = Array.isArray(value.section)
      ? value.section.filter(isRecord)
      : [];

    if (!hasText && entries.length === 0 && subSections.length === 0) {
      issues.push(createValidationIssue({
        code: 'cmp-1-violation',
        path,
        resourceType: 'Composition',
        customMessage: 'cmp-1: A section must contain at least one of text, entry, or sub-section',
        severityOverride: 'error',
      }));
    }

    if (value.emptyReason !== undefined && value.emptyReason !== null && entries.length > 0) {
      issues.push(createValidationIssue({
        code: 'cmp-2-violation',
        path,
        resourceType: 'Composition',
        customMessage: 'cmp-2: A section can only have an emptyReason if it has no entries',
        severityOverride: 'error',
      }));
    }

    subSections.forEach((section, index) => {
      issues.push(...validateCompositionSection(
        section,
        `${path}.section[${index}]`,
        ancestors,
      ));
    });
    return issues;
  } finally {
    ancestors.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
