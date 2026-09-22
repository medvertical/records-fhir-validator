import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { ExtensionDefinition } from './extension-types.js';

export interface ExtensionDefinitionContext {
  byUrl: Map<string, ExtensionDefinition>;
  byPath: Map<string, Map<string, ExtensionDefinition[]>>;
  elements: ElementDefinition[];
}

export function extractExtensionDefinitions(
  profileSD: StructureDefinition
): ExtensionDefinitionContext {
  const byUrl = new Map<string, ExtensionDefinition>();
  const byPath = new Map<string, Map<string, ExtensionDefinition[]>>();
  const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];

  for (const element of elements) {
    if (!element.path || !element.path.endsWith('.extension')) {
      continue;
    }

    const normalizedPath = normalizeElementPath(element.path);

    const extensionUrl = identifyExtensionUrl(element);
    if (!extensionUrl) {
      continue;
    }

    if (!byPath.has(normalizedPath)) {
      byPath.set(normalizedPath, new Map<string, ExtensionDefinition[]>());
    }

    const extDef: ExtensionDefinition = {
      url: extensionUrl,
      path: normalizedPath,
      ...(element.id ? { elementId: element.id } : {}),
      min: element.min ?? 0,
      max: element.max || '*',
      isModifier: element.isModifier || false,
      typeCodes: element.type?.map((t) => t.code) ?? [],
      profileUrl: extractExtensionProfileUrl(element),
      sliceName: element.sliceName
    };

    byUrl.set(extensionUrl, extDef);
    const definitionsForUrl = byPath.get(normalizedPath)!.get(extensionUrl) ?? [];
    definitionsForUrl.push(extDef);
    byPath.get(normalizedPath)!.set(extensionUrl, definitionsForUrl);
  }

  logger.debug(`[ExtensionValidator] Found ${byUrl.size} extension definitions across ${byPath.size} element paths`);
  return { byUrl, byPath, elements };
}

export function extractSubExtensionDefinitions(
  parentSD: StructureDefinition
): Map<string, ExtensionDefinition> {
  const result = new Map<string, ExtensionDefinition>();
  const elements = parentSD.snapshot?.element || parentSD.differential?.element || [];

  for (const element of elements) {
    if (!element.path?.endsWith('Extension.extension')) continue;
    const url = identifySubExtensionUrl(element, elements);
    if (!element.sliceName && !url) continue;

    if (!url) continue;

    const inlineValueElement = element.id
      ? elements.find(candidate => candidate.id === `${element.id}.value[x]`)
      : undefined;

    result.set(url, {
      url,
      path: element.path,
      ...(element.id ? { elementId: element.id } : {}),
      min: element.min ?? 0,
      max: element.max || '*',
      isModifier: element.isModifier || false,
      typeCodes: element.type?.map(t => t.code) ?? [],
      profileUrl: extractExtensionProfileUrl(element),
      ...(inlineValueElement ? { inlineValueElement } : {}),
      ...(parentSD.url ? { ownerProfileUrl: parentSD.url } : {}),
      sliceName: element.sliceName,
    });
  }

  return result;
}

function identifySubExtensionUrl(
  element: ElementDefinition,
  elements: ElementDefinition[],
): string | undefined {
  const directUrl = identifyExtensionUrl(element);
  if (directUrl) return directUrl;
  if (!element.id) return undefined;

  const urlElement = elements.find(candidate =>
    candidate.id === `${element.id}.url` && candidate.path === 'Extension.extension.url'
  );
  return urlElement ? identifyExtensionUrl(urlElement) : undefined;
}

export function normalizeElementPath(path: string): string {
  return path
    .split('.')
    .map(segment => segment.split(':')[0])
    .join('.');
}

export function identifyExtensionUrl(element: ElementDefinition): string | undefined {
  if (typeof element.fixedUri === 'string' && element.fixedUri.length > 0) {
    return normalizeExtensionUrlForMatching(element.fixedUri);
  }
  if (typeof element.patternUri === 'string' && element.patternUri.length > 0) {
    return normalizeExtensionUrlForMatching(element.patternUri);
  }

  const extensionType = element.type?.find(type => type.code === 'Extension');
  if (extensionType?.profile && extensionType.profile.length > 0) {
    return normalizeExtensionUrlForMatching(extensionType.profile[0]);
  }

  return undefined;
}

export function normalizeExtensionUrlForMatching(url: string): string {
  return url.split('|')[0] || url;
}

export function extractExtensionProfileUrl(element: ElementDefinition): string | undefined {
  const extensionType = element.type?.find(type => type.code === 'Extension');
  if (extensionType?.profile && extensionType.profile.length > 0) {
    return extensionType.profile[0];
  }
  return undefined;
}
