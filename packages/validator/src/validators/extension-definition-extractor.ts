import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types';
import { logger } from '../logger';
import type { ExtensionDefinition } from './extension-types';

export interface ExtensionDefinitionContext {
  byUrl: Map<string, ExtensionDefinition>;
  byPath: Map<string, Map<string, ExtensionDefinition>>;
}

export function extractExtensionDefinitions(
  profileSD: StructureDefinition
): ExtensionDefinitionContext {
  const byUrl = new Map<string, ExtensionDefinition>();
  const byPath = new Map<string, Map<string, ExtensionDefinition>>();
  const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];

  for (const element of elements) {
    if (!element.path || !element.path.endsWith('.extension')) {
      continue;
    }

    const normalizedPath = normalizeElementPath(element.path);

    if (!byPath.has(normalizedPath)) {
      byPath.set(normalizedPath, new Map<string, ExtensionDefinition>());
    }

    const extensionUrl = identifyExtensionUrl(element);
    if (!extensionUrl) {
      continue;
    }

    const extDef: ExtensionDefinition = {
      url: extensionUrl,
      path: normalizedPath,
      min: element.min ?? 0,
      max: element.max || '*',
      isModifier: element.isModifier || false,
      typeCodes: element.type?.map((t) => t.code) ?? [],
      profileUrl: extractExtensionProfileUrl(element),
      sliceName: element.sliceName
    };

    byUrl.set(extensionUrl, extDef);
    byPath.get(normalizedPath)!.set(extensionUrl, extDef);
  }

  logger.debug(`[ExtensionValidator] Found ${byUrl.size} extension definitions across ${byPath.size} element paths`);
  return { byUrl, byPath };
}

export function extractSubExtensionDefinitions(
  parentSD: StructureDefinition
): Map<string, ExtensionDefinition> {
  const result = new Map<string, ExtensionDefinition>();
  const elements = parentSD.snapshot?.element || parentSD.differential?.element || [];

  for (const element of elements) {
    if (!element.path?.endsWith('Extension.extension')) continue;
    if (!element.sliceName && !identifyExtensionUrl(element)) continue;

    const url = identifyExtensionUrl(element);
    if (!url) continue;

    result.set(url, {
      url,
      path: element.path,
      min: element.min ?? 0,
      max: element.max || '*',
      isModifier: element.isModifier || false,
      typeCodes: element.type?.map(t => t.code) ?? [],
      profileUrl: extractExtensionProfileUrl(element),
      sliceName: element.sliceName,
    });
  }

  return result;
}

export function normalizeElementPath(path: string): string {
  return path
    .split('.')
    .map(segment => segment.split(':')[0])
    .join('.');
}

export function identifyExtensionUrl(element: ElementDefinition): string | undefined {
  const elementAny = element as ElementDefinition & { fixedUri?: string; patternUri?: string };

  if (elementAny.fixedUri) {
    return normalizeExtensionUrlForMatching(elementAny.fixedUri);
  }
  if (elementAny.patternUri) {
    return normalizeExtensionUrlForMatching(elementAny.patternUri);
  }

  const extensionType = elementAny.type?.find((t: any) => t.code === 'Extension');
  if (extensionType?.profile && extensionType.profile.length > 0) {
    return normalizeExtensionUrlForMatching(extensionType.profile[0]);
  }

  return undefined;
}

export function normalizeExtensionUrlForMatching(url: string): string {
  return url.split('|')[0] || url;
}

export function extractExtensionProfileUrl(element: ElementDefinition): string | undefined {
  const elementAny = element as ElementDefinition & { type?: Array<{ code: string; profile?: string[] }> };
  const extensionType = elementAny.type?.find((t: any) => t.code === 'Extension');
  if (extensionType?.profile && extensionType.profile.length > 0) {
    return extensionType.profile[0];
  }
  return undefined;
}
