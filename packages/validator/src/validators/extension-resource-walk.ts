import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ExtensionUsageSite, NormalizedExtensionContext } from './extension-context-matching.js';
import type { ExtensionValidationContext } from './extension-types.js';
import { validateUniversalExtensionRules } from './extension-universal-rules.js';

interface ExtensionResourceWalkOptions {
  maxNestedExtensionDepth: number;
  resolveExtensionUrl(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<'resolvable' | 'unresolvable' | 'undetermined'>;
  getDeclaredContexts(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<NormalizedExtensionContext[] | null>;
}

interface WalkSite {
  resourceType: string;
  elementPath: string;
}

export async function walkResourceExtensions(
  value: unknown,
  basePath: string,
  context: ExtensionValidationContext,
  knownUrls: Set<string>,
  visited: Set<string>,
  issues: ValidationIssue[],
  options: ExtensionResourceWalkOptions,
): Promise<void> {
  const rootSite: WalkSite = { resourceType: basePath, elementPath: basePath };
  const pending: Array<{ value: unknown; path: string; site: WalkSite }> =
    [{ value, path: basePath, site: rootSite }];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          site: current.site,
        });
      }
      continue;
    }

    const record = current.value as Record<string, unknown>;
    // Contained and Bundle-entry resources start a new context root.
    const site = typeof record.resourceType === 'string'
      ? { resourceType: record.resourceType, elementPath: record.resourceType }
      : current.site;
    const keys = Object.keys(record);
    for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex--) {
      const key = keys[keyIndex];
      if (key === 'resourceType') continue;
      const child = record[key];
      const isExtensionArray = (key === 'extension' || key === 'modifierExtension')
        && Array.isArray(child);
      if (!isExtensionArray) {
        pending.push({
          value: child,
          path: `${current.path}.${key}`,
          // Primitive-extension sidecars (`_birthDate`) attach to the
          // primitive element itself, so the underscore is not a segment.
          site: { ...site, elementPath: `${site.elementPath}.${key.replace(/^_/, '')}` },
        });
        continue;
      }

      const attachmentSite: ExtensionUsageSite = {
        ...site,
        attachment: site.elementPath === site.resourceType ? 'resource-root' : 'element',
      };
      for (let index = 0; index < child.length; index++) {
        const extensionPath = `${current.path}.${key}[${index}]`;
        visited.add(extensionPath);
        issues.push(...await validateUniversalExtensionRules({
          extension: child[index],
          extensionType: key === 'modifierExtension' ? 'modifierExtension' : 'extension',
          path: extensionPath,
          knownUrls,
          context,
          visited,
          depth: 0,
          maxNestedExtensionDepth: options.maxNestedExtensionDepth,
          resolveExtensionUrl: options.resolveExtensionUrl,
          getDeclaredContexts: options.getDeclaredContexts,
          site: attachmentSite,
        }));
      }
    }
  }
}
