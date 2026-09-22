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

  const contexts = await input.getDeclaredContexts(input.url, input.fhirVersion);
  if (!contexts || contexts.length === 0) return [];

  const verdict = checkExtensionContextUsage(contexts, input.site);
  if (verdict !== 'violation') return [];

  return [createValidationIssue({
    code: 'profile-extension-context-wrong',
    path: input.path,
    resourceType: input.resourceType,
    customMessage:
      `The extension ${input.url} is not allowed to be used at this point `
      + `(this element is [${input.site.elementPath}]; `
      + `allowed = ${formatDeclaredContexts(contexts)})`,
    details: {
      url: input.url,
      elementPath: input.site.elementPath,
      declaredContexts: formatDeclaredContexts(contexts),
    },
  })];
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
