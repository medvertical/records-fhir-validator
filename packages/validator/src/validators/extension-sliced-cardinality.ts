import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition } from '../core/structure-definition-types.js';
import { getValidationTargets, type ValidationTarget } from '../business-rules/element-validation-targets.js';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';
import { targetMatchesSliceDefinition } from './constraint-slice-targets.js';
import { checkExtensionPathCardinality } from './extension-cardinality-rules.js';
import { normalizeExtensionUrlForMatching } from './extension-definition-extractor.js';
import type { ExtensionDefinition } from './extension-types.js';

/**
 * Slice ancestors ABOVE the extension element itself. A definition whose id
 * is `Task.input:AttachmentsNeeded.extension:paLineNumber` is only binding
 * for `Task.input` repeats that belong to the AttachmentsNeeded slice, so
 * its min/max must never be enforced against sibling slices' repeats.
 */
export function getParentSliceAncestors(
  definition: ExtensionDefinition,
  elements: ElementDefinition[],
): ElementDefinition[] {
  const elementId = definition.elementId;
  if (!elementId) return [];
  return elements.filter(candidate =>
    Boolean(candidate.sliceName) &&
    typeof candidate.id === 'string' &&
    candidate.id !== elementId &&
    elementId.startsWith(`${candidate.id}.`),
  );
}

interface SliceScopedCardinalityInput {
  elementPath: string;
  definitions: Array<[string, ExtensionDefinition]>;
  elements: ElementDefinition[];
  resource: unknown;
  profileUrl: string;
}

/**
 * Enforce extension cardinality for definitions that live under a parent
 * slice, counting only within parent repeats that match every ancestor
 * slice's discriminators.
 */
export function checkSliceScopedExtensionCardinality(
  input: SliceScopedCardinalityInput,
): ValidationIssue[] {
  const { elementPath, definitions, elements, resource, profileUrl } = input;
  const lastDot = elementPath.lastIndexOf('.');
  if (definitions.length === 0 || lastDot <= 0) return [];

  const parentPath = elementPath.slice(0, lastDot);
  const leafKey = elementPath.slice(lastDot + 1);
  const parentTargets = getValidationTargets(resource, parentPath);
  const issues: ValidationIssue[] = [];

  for (const [url, definition] of definitions) {
    const ancestors = getParentSliceAncestors(definition, elements);
    for (const parentTarget of parentTargets) {
      if (!isRecord(parentTarget.value)) continue;
      if (!parentTargetMatchesAncestors(parentTarget, ancestors, elements, resource)) continue;

      const count = countExtensionsWithUrl(parentTarget.value, leafKey, url);
      issues.push(...checkExtensionPathCardinality(
        elementPath,
        new Map([[url, definition]]),
        new Map([[url, count]]),
        profileUrl,
        resourceTypeOf(resource, 'Unknown'),
      ));
    }
  }

  return issues;
}

function countExtensionsWithUrl(parentValue: Record<string, unknown>, leafKey: string, url: string): number {
  const extensions = coerceToArray(resolveFhirSegmentValue(parentValue, leafKey));
  return extensions.filter(extension =>
    isRecord(extension) &&
    typeof extension.url === 'string' &&
    normalizeExtensionUrlForMatching(extension.url) === url,
  ).length;
}

function parentTargetMatchesAncestors(
  parentTarget: ValidationTarget,
  ancestors: ElementDefinition[],
  elements: ElementDefinition[],
  resource: unknown,
): boolean {
  return ancestors.every(slice => {
    const ancestorTargets = getValidationTargets(resource, slice.path).filter(candidate =>
      parentTarget.fullPath === candidate.fullPath ||
      parentTarget.fullPath.startsWith(`${candidate.fullPath}.`),
    );
    return ancestorTargets.some(target =>
      targetMatchesSliceDefinition(target.value, slice, elements, { resource, target }),
    );
  });
}

function coerceToArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
