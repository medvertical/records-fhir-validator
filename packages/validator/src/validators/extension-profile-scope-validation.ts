import type { ValidationIssue } from '@records-fhir/validation-types';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import type { ExtensionDefinitionContext } from './extension-definition-extractor.js';
import { normalizeExtensionUrlForMatching } from './extension-definition-extractor.js';
import { checkExtensionPathCardinality } from './extension-cardinality-rules.js';
import { selectDefinitionsForResourceContext } from './extension-context-selection.js';
import { getExtensionGroupsByParent } from './extension-group-resolver.js';
import {
  checkSliceScopedExtensionCardinality,
  getParentSliceAncestors,
} from './extension-sliced-cardinality.js';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';

type ExtensionType = 'extension' | 'modifierExtension';

interface ProfileScopedExtensionValidationInput {
  resource: unknown;
  definitionContext: ExtensionDefinitionContext;
  context: ExtensionValidationContext;
  validateInstance: (
    extension: Record<string, unknown>,
    definition: ExtensionDefinition | undefined,
    extensionType: ExtensionType,
    elementPath: string,
  ) => Promise<ValidationIssue[]>;
}

export async function validateProfileScopedExtensionInstances({
  resource,
  definitionContext,
  context,
  validateInstance,
}: ProfileScopedExtensionValidationInput): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const [elementPath, candidatesByUrl] of definitionContext.byPath.entries()) {
    const definitionsByUrl = selectDefinitionsForResourceContext(
      candidatesByUrl,
      definitionContext.elements,
      resource,
    );
    if (definitionsByUrl.size === 0) continue;

    // A definition under a parent slice binds only that slice's repeats, so
    // its cardinality is enforced per matching parent — never per raw group.
    const unslicedDefinitions = new Map<string, ExtensionDefinition>();
    for (const [url, definition] of definitionsByUrl.entries()) {
      if (getParentSliceAncestors(definition, definitionContext.elements).length === 0) {
        unslicedDefinitions.set(url, definition);
      }
    }

    const parentGroups = getExtensionGroupsByParent(resource, elementPath, context.getValueAtPath);
    for (const extensions of parentGroups) {
      const counts = new Map<string, number>();
      for (const extensionValue of extensions) {
        if (!isRecord(extensionValue)) continue;
        const normalizedUrl = typeof extensionValue.url === 'string'
          ? normalizeExtensionUrlForMatching(extensionValue.url)
          : undefined;
        const extensionType = elementPath.endsWith('modifierExtension')
          ? 'modifierExtension'
          : 'extension';
        const definition = normalizedUrl ? definitionsByUrl.get(normalizedUrl) : undefined;
        issues.push(...await validateInstance(extensionValue, definition, extensionType, elementPath));
        if (normalizedUrl) counts.set(normalizedUrl, (counts.get(normalizedUrl) || 0) + 1);
      }

      issues.push(...checkExtensionPathCardinality(
        elementPath,
        unslicedDefinitions,
        counts,
        context.profileUrl,
        resourceTypeOf(context.resource, 'Unknown'),
      ));
    }

    issues.push(...checkSliceScopedExtensionCardinality({
      elementPath,
      definitions: collectSliceScopedCandidates(candidatesByUrl, definitionContext.elements),
      elements: definitionContext.elements,
      resource,
      profileUrl: context.profileUrl,
    }));
  }
  return issues;
}

function collectSliceScopedCandidates(
  candidatesByUrl: Map<string, ExtensionDefinition[]>,
  elements: ExtensionDefinitionContext['elements'],
): Array<[string, ExtensionDefinition]> {
  const scoped: Array<[string, ExtensionDefinition]> = [];
  for (const [url, candidates] of candidatesByUrl.entries()) {
    for (const candidate of candidates) {
      if (getParentSliceAncestors(candidate, elements).length > 0) {
        scoped.push([url, candidate]);
      }
    }
  }
  return scoped;
}
