import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  checkExtensionContextUsage,
  type ExtensionUsageSite,
  type NormalizedExtensionContext,
} from './extension-context-matching.js';
import { isAbsoluteExtensionUrl } from './extension-structure-rules.js';

export interface ExtensionContextCheckInput {
  url: string;
  path: string;
  site: ExtensionUsageSite;
  resourceType: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  getDeclaredContexts: (
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ) => Promise<NormalizedExtensionContext[] | null>;
  /** Names of the element the extension sits on; null when they cannot be resolved. */
  resolveLogicalPaths?: (site: ExtensionUsageSite) => Promise<readonly string[] | null>;
}

/**
 * Checks a resolved extension against the usage contexts its own
 * StructureDefinition declares. Unresolvable extensions and contexts the
 * matcher cannot evaluate produce no issue — the open-world severity rules
 * for unknown extensions already cover the former, and guessing on the
 * latter would fabricate violations.
 */
export async function validateExtensionContextUsage(
  input: ExtensionContextCheckInput,
): Promise<ValidationIssue[]> {
  if (!isAbsoluteExtensionUrl(input.url) || input.url.includes('|')) return [];

  const declared = await input.getDeclaredContexts(input.url, input.fhirVersion);
  const crossVersion = declared ? null : crossVersionElementContext(input.url);
  const contexts = declared ?? (crossVersion ? [crossVersion.context] : null);
  if (!contexts || contexts.length === 0) return [];

  const logicalPaths = input.site.attachment === 'element' && contexts.some(context => context.type === 'element')
    ? await input.resolveLogicalPaths?.(input.site) ?? null
    : null;
  const site = logicalPaths ? { ...input.site, logicalPaths } : input.site;
  const verdict = checkExtensionContextUsage(contexts, site);
  if (verdict !== 'violation') return [];

  return [createValidationIssue({
    code: 'profile-extension-context-wrong',
    path: input.path,
    resourceType: input.resourceType,
    customMessage: crossVersion
      ? `The extension ${input.url} from FHIR version ${crossVersion.release} is not allowed to be used at this point `
        + `(this element is [${input.site.elementPath}]; allowed for this version = ${formatDeclaredContexts(contexts)}; `
        + 'this is a warning since contexts may be renamed between FHIR versions)'
      : `The extension ${input.url} is not allowed to be used at this point `
        + `(this element is [${input.site.elementPath}]; `
        + `allowed = ${formatDeclaredContexts(contexts)})`,
    ...(crossVersion ? { severityOverride: 'warning' as const } : {}),
    details: {
      url: input.url,
      elementPath: input.site.elementPath,
      declaredContexts: formatDeclaredContexts(contexts),
    },
  })];
}

const CROSS_VERSION_ELEMENT = /^http:\/\/hl7\.org\/fhir\/(\d\.\d)\/StructureDefinition\/extension-([A-Z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+)$/;

/**
 * A cross-version extension stands for an element of another FHIR release
 * and belongs on that element's parent. Without a definition to say so, the
 * reference validator derives the context from the url, and only warns on a
 * mismatch since contexts may be renamed between releases.
 */
function crossVersionElementContext(url: string): { release: string; context: NormalizedExtensionContext } | null {
  const match = url.match(CROSS_VERSION_ELEMENT);
  if (!match) return null;
  const parent = match[2].slice(0, match[2].lastIndexOf('.'));
  return { release: match[1], context: { type: 'element', expression: parent } };
}

const CONTEXT_TYPE_PREFIX: Record<NormalizedExtensionContext['type'], string> = {
  element: 'e',
  extension: 'x',
  fhirpath: 'p',
  unknown: '?',
};

function formatDeclaredContexts(contexts: NormalizedExtensionContext[]): string {
  return contexts
    .map(context => `${CONTEXT_TYPE_PREFIX[context.type]}:${context.expression}`)
    .join(', ');
}
