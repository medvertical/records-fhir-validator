import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ExtensionUsageSite, NormalizedExtensionContext } from './extension-context-matching.js';
import type { ExtensionValidationContext } from './extension-types.js';
import { ProfileReferenceUnavailableError, profileReferenceUnavailableIssue } from '../core/profile-reference-authority.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import { isFhirResource } from '../core/fhir-resource.js';
import { unprofiledResourceDefinition } from './extension-embedded-resource-scope.js';
import { validateUniversalExtensionRules } from './extension-universal-rules.js';

export interface ExtensionResourceWalkOptions {
  resolveResourceScope?(resource: Record<string, unknown> & { resourceType: string }, path: string): Promise<ExtensionResourceWalkScope>;
  maxNestedExtensionDepth: number;
  resolveExtensionUrl(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<'resolvable' | 'unresolvable' | 'undetermined'>;
  getDeclaredContexts(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<NormalizedExtensionContext[] | null>;
  resolveLogicalPaths?(site: ExtensionUsageSite): Promise<readonly string[] | null>;
  validateAgainstDefinition?(
    extension: Record<string, unknown>,
    url: string,
    path: string,
  ): Promise<ValidationIssue[]>;
}

export interface ExtensionResourceWalkScope {
  context: ExtensionValidationContext;
  knownUrls: Set<string>;
  options: ExtensionResourceWalkOptions;
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
  const rootScope = { context, knownUrls, options };
  const pending: Array<{ value: unknown; path: string; site: WalkSite; scope: ExtensionResourceWalkScope }> =
    [{ value, path: basePath, site: rootSite, scope: rootScope }];
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
          scope: current.scope,
        });
      }
      continue;
    }

    const record = current.value as Record<string, unknown>;
    let scope = current.scope;
    const slot = record !== value && isFhirResource(record)
      ? resourceSlot(current.site.elementPath, scope.context.profileSD) : false;
    const embeddedResource = slot !== false;
    if (embeddedResource && isFhirResource(record)) {
      if (!containsExtensionWork(record)) continue;
      scope = slot === true && scope.options.resolveResourceScope
        ? await scope.options.resolveResourceScope(record, current.path)
        : undeterminedEmbeddedScope(record, current.path, scope, issues);
    }
    // Contained and Bundle-entry resources start a new context root.
    const site = (record === value || embeddedResource) && typeof record.resourceType === 'string'
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
        // Primitive-extension sidecars (`_birthDate`) attach to the primitive
        // element itself: FHIRPath and the reference validator address them
        // as `Patient.birthDate.extension[0]`, so the underscore is no segment.
        const segment = key.replace(/^_/, '');
        pending.push({
          value: child,
          path: `${current.path}.${segment}`,
          site: { ...site, elementPath: `${site.elementPath}.${segment}` },
          scope,
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
          knownUrls: scope.knownUrls,
          context: scope.context,
          visited,
          depth: 0,
          maxNestedExtensionDepth: scope.options.maxNestedExtensionDepth,
          resolveExtensionUrl: scope.options.resolveExtensionUrl,
          getDeclaredContexts: scope.options.getDeclaredContexts,
          resolveLogicalPaths: scope.options.resolveLogicalPaths,
          validateAgainstDefinition: scope.options.validateAgainstDefinition,
          site: attachmentSite,
        }));
      }
    }
  }
}

function containsExtensionWork(root: object): boolean {
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const child of current) pending.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if ((key === 'extension' || key === 'modifierExtension') && Array.isArray(child) && child.length) return true;
      pending.push(child);
    }
  }
  return false;
}

function resourceSlot(path: string, profile: StructureDefinition): boolean | undefined {
  const elements = (profile.snapshot?.element ?? profile.differential?.element ?? []).filter(element => element.path === path);
  const types = elements.flatMap(element => element.type ?? []);
  if (!types.length) return undefined;
  // The reference parser's index also accepts datatype names; they do not introduce resource ownership.
  const nonResources = new Set(['Element', 'BackboneElement', 'Narrative', 'Signature']);
  const resources = types.filter(type => KNOWN_FHIR_RESOURCE_TYPES.has(type.code) && !nonResources.has(type.code));
  return resources.length === types.length ? true : resources.length ? undefined : false;
}

function undeterminedEmbeddedScope(
  resource: Record<string, unknown> & { resourceType: string }, path: string,
  parent: ExtensionResourceWalkScope, issues: ValidationIssue[],
): ExtensionResourceWalkScope {
  const profileSD = unprofiledResourceDefinition(resource.resourceType);
  issues.push(profileReferenceUnavailableIssue(new ProfileReferenceUnavailableError({
    canonical: profileSD.url, cause: 'embedded-extension-owner-undetermined',
  }), path));
  return { knownUrls: new Set(), context: { ...parent.context, resource, profileSD,
    rootResource: parent.context.rootResource ?? parent.context.resource, profileUrl: profileSD.url },
    options: { maxNestedExtensionDepth: parent.options.maxNestedExtensionDepth,
      resolveExtensionUrl: async () => 'undetermined', getDeclaredContexts: async () => null } };
}
