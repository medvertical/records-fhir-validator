import type { StructureDefinition, SlicingDefinition } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { SliceDefinition } from './slice-types.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';
import { getValueAtPath } from './slice-utils.js';

export function buildMissingDiscriminatorIssues(
  unmatchedElements: Array<{ element: unknown; index: number }>,
  slices: SliceDefinition[],
  slicingDef: SlicingDefinition,
  elementPath: string,
  profileSD: StructureDefinition,
): ValidationIssue[] {
  if (slices.length !== 1 || slicingDef.discriminator?.length !== 1) return [];
  const discriminator = slicingDef.discriminator[0];
  if (discriminator.type !== 'value' || !discriminator.path || discriminator.path === '$this') {
    return [];
  }

  const slice = slices[0];
  const expectedValue = slice.childFixed?.get(discriminator.path)
    ?? slice.childPatterns?.get(discriminator.path)
    ?? (slice.fixed ? getValueAtPath(slice.fixed, discriminator.path) : undefined)
    ?? (slice.pattern ? getValueAtPath(slice.pattern, discriminator.path) : undefined);
  if (expectedValue === undefined || expectedValue === null) return [];

  const evidencePaths = getRequiredSliceEvidencePaths(slice, discriminator.path, profileSD);
  if (evidencePaths.length === 0) return [];
  const issues: ValidationIssue[] = [];
  for (const { element, index } of unmatchedElements) {
    const discriminatorValue = getValueAtPath(element, discriminator.path);
    if (discriminatorValue !== undefined && discriminatorValue !== null) continue;
    const hasEvidence = evidencePaths.some(path => {
      const value = getValueAtPath(element, path);
      return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
    });
    if (!hasEvidence) continue;
    issues.push(createValidationIssue({
      code: 'profile-constraint-violation',
      path: `${elementPath}[${index}]`,
      resourceType: resourceTypeFromPath(elementPath),
      customMessage: `Slice '${slice.sliceName}' requires discriminator '${discriminator.path}' to be present`,
      severityOverride: 'info',
      ruleId: `slice-${slice.sliceName}-${discriminator.path}`,
      details: { sliceName: slice.sliceName, discriminatorPath: discriminator.path, expectedValue },
    }));
  }
  return issues;
}

function getRequiredSliceEvidencePaths(
  slice: SliceDefinition,
  discriminatorPath: string,
  profileSD: StructureDefinition,
): string[] {
  const snapshot = profileSD.snapshot?.element;
  if (!snapshot?.length) return [];
  const idPrefix = `${slice.path}:${slice.sliceName}.`;
  return snapshot.flatMap(elementDef => {
    const id = elementDef.id;
    if (!id?.startsWith(idPrefix)) return [];
    const relative = id.substring(idPrefix.length);
    if (relative.includes('.') || relative.includes(':')) return [];
    if (relative === discriminatorPath || (elementDef.min ?? 0) < 1) return [];
    return [relative];
  });
}
