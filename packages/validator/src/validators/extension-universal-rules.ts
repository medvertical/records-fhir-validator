import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  isAbsoluteExtensionUrl,
  shouldReportUnresolvableExtensionUrl,
  validateExtensionStructure,
  validateKnownHl7ExtensionValueType,
} from './extension-structure-rules';
import type { ExtensionValidationContext } from './extension-types';

interface ValidateUniversalExtensionRulesParams {
  extension: any;
  extensionType: 'extension' | 'modifierExtension';
  path: string;
  knownUrls: Set<string>;
  context: ExtensionValidationContext;
  visited: Set<string>;
  depth: number;
  maxNestedExtensionDepth: number;
  isNested?: boolean;
  isExtensionUrlResolvable: (
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ) => Promise<boolean>;
}

export async function validateUniversalExtensionRules({
  extension,
  extensionType,
  path,
  knownUrls,
  context,
  visited,
  depth,
  maxNestedExtensionDepth,
  isNested = false,
  isExtensionUrlResolvable,
}: ValidateUniversalExtensionRulesParams): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!extension || typeof extension !== 'object') return issues;

  const url: string | undefined = extension.url;
  issues.push(...await validateExtensionUrlRules({
    url,
    extensionType,
    path,
    knownUrls,
    context,
    isNested,
    isExtensionUrlResolvable,
  }));

  if (url) {
    issues.push(...validateExtensionStructure(
      extension,
      extensionType,
      path,
      context.resource?.resourceType || 'Unknown',
    ));
  }

  issues.push(...validateKnownHl7ExtensionValueType(
    extension,
    path,
    context.resource?.resourceType || 'Unknown',
  ));

  if (Array.isArray(extension.extension) && depth < maxNestedExtensionDepth) {
    for (let i = 0; i < extension.extension.length; i++) {
      const nested = extension.extension[i];
      const nestedPath = `${path}.extension[${i}]`;
      visited.add(nestedPath);
      const nestedIssues = await validateUniversalExtensionRules({
        extension: nested,
        extensionType: 'extension',
        path: nestedPath,
        knownUrls,
        context,
        visited,
        depth: depth + 1,
        maxNestedExtensionDepth,
        isNested: true,
        isExtensionUrlResolvable,
      });
      issues.push(...nestedIssues);
    }
  }

  return issues;
}

async function validateExtensionUrlRules({
  url,
  extensionType,
  path,
  knownUrls,
  context,
  isNested,
  isExtensionUrlResolvable,
}: Pick<ValidateUniversalExtensionRulesParams,
  'extensionType' | 'path' | 'knownUrls' | 'context' | 'isExtensionUrlResolvable'
> & {
  url: string | undefined;
  isNested: boolean;
}): Promise<ValidationIssue[]> {
  const resourceType = context.resource?.resourceType || 'Unknown';
  const issues: ValidationIssue[] = [];

  if (!url || url === '') {
    issues.push(createValidationIssue({
      code: 'profile-extension-url-missing',
      path,
      resourceType,
      messageParams: { extensionType },
    }));
  } else if (!isNested && !isAbsoluteExtensionUrl(url)) {
    issues.push(createValidationIssue({
      code: 'profile-extension-url-not-absolute',
      path,
      resourceType,
      messageParams: { url, extensionType },
    }));
  } else if (!isNested && url.includes('|')) {
    issues.push(...createVersionedUrlIssues(url, path, resourceType));
  } else if (!isNested && !knownUrls.has(url) && shouldReportUnresolvableExtensionUrl(url)) {
    const resolvable = await isExtensionUrlResolvable(url, context.fhirVersion);
    if (!resolvable) {
      issues.push(createValidationIssue({
        code: 'profile-extension-not-found',
        path,
        resourceType,
        messageParams: { url },
        severityOverride: 'warning',
      }));
    }
  }

  return issues;
}

function createVersionedUrlIssues(
  url: string,
  path: string,
  resourceType: string,
): ValidationIssue[] {
  return [
    createValidationIssue({
      code: 'profile-extension-url-versioned',
      path,
      resourceType,
      customMessage: `The extension URL must not contain a version. The versioned URL '${url}' is not a valid extension identifier — strip the '|<version>' suffix.`,
      severityOverride: 'error',
      details: { url },
    }),
    createValidationIssue({
      code: 'profile-extension-url-fixed-mismatch',
      path: `${path}.url`,
      resourceType,
      customMessage: `Extension.url value '${url}' must be the unversioned canonical URL (the version pipe '|<version>' is not permitted here).`,
      severityOverride: 'error',
      details: { url },
    }),
  ];
}
