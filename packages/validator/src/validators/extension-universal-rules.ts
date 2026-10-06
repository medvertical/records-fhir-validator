import { ProfileReferenceUnavailableError, profileReferenceUnavailableIssue } from '../core/profile-reference-authority.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import type { ExtensionUsageSite, NormalizedExtensionContext } from './extension-context-matching.js';
import { validateExtensionContextUsage } from './extension-context-usage.js';
import {
  isAbsoluteExtensionUrl,
  shouldReportUnresolvableExtensionUrl,
  validateExtensionStructure,
  validateKnownHl7ExtensionValueType,
} from './extension-structure-rules.js';
import { validateExampleUrl } from './example-url-rule.js';
import type { ExtensionValidationContext } from './extension-types.js';
import { isKnownCrossVersionExtensionUrl, unsupportedCrossVersionRelease } from './extension-xver-urls.js';

interface ValidateUniversalExtensionRulesParams {
  extension: unknown;
  extensionType: 'extension' | 'modifierExtension';
  path: string;
  knownUrls: Set<string>;
  context: ExtensionValidationContext;
  visited: Set<string>;
  depth: number;
  maxNestedExtensionDepth: number;
  isNested?: boolean;
  resolveExtensionUrl: (
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ) => Promise<'resolvable' | 'unresolvable' | 'undetermined'>;
  getDeclaredContexts: (
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ) => Promise<NormalizedExtensionContext[] | null>;
  resolveLogicalPaths?: (site: ExtensionUsageSite) => Promise<readonly string[] | null>;
  /**
   * Checks an extension the profile does not slice against its own
   * definition (value, bindings, invariants), as the reference validator does.
   */
  validateAgainstDefinition?: (
    extension: Record<string, unknown>,
    url: string,
    path: string,
  ) => Promise<ValidationIssue[]>;
  site: ExtensionUsageSite;
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
  resolveExtensionUrl,
  getDeclaredContexts,
  resolveLogicalPaths,
  validateAgainstDefinition,
  site,
}: ValidateUniversalExtensionRulesParams): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(extension)) return issues;

  const url = typeof extension.url === 'string' ? extension.url : undefined;
  issues.push(...await retainUnavailableExtensionIssues(() => validateExtensionUrlRules({
    url,
    extensionType,
    path,
    knownUrls,
    context,
    isNested,
    resolveExtensionUrl,
  }), path));

  if (url) {
    issues.push(...validateExtensionStructure(
      extension,
      extensionType,
      path,
      resourceTypeOf(context.resource, 'Unknown'),
    ));
    issues.push(...await retainUnavailableExtensionIssues(() => validateExtensionContextUsage({
      url,
      path,
      site,
      resourceType: resourceTypeOf(context.resource, 'Unknown'),
      fhirVersion: context.fhirVersion,
      getDeclaredContexts,
      resolveLogicalPaths,
    }), path));
    if (validateAgainstDefinition && !isNested && !knownUrls.has(url) && isAbsoluteExtensionUrl(url) && !url.includes('|')) {
      issues.push(...await retainUnavailableExtensionIssues(() => validateAgainstDefinition(extension, url, path), path));
    }
  }

  issues.push(...validateKnownHl7ExtensionValueType(
    extension,
    path,
    resourceTypeOf(context.resource, 'Unknown'),
  ));

  if (Array.isArray(extension.extension) && depth < maxNestedExtensionDepth) {
    const nestedSite: ExtensionUsageSite = {
      resourceType: site.resourceType,
      elementPath: `${site.elementPath}.extension`,
      attachment: 'nested-extension',
      parentExtensionUrl: url,
    };
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
        resolveExtensionUrl,
        getDeclaredContexts,
        site: nestedSite,
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
  resolveExtensionUrl,
}: Pick<ValidateUniversalExtensionRulesParams,
  'extensionType' | 'path' | 'knownUrls' | 'context' | 'resolveExtensionUrl'
> & {
  url: string | undefined;
  isNested: boolean;
}): Promise<ValidationIssue[]> {
  const resourceType = resourceTypeOf(context.resource, 'Unknown');
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
    // `undetermined` means the loader failed, which says nothing about whether
    // the extension exists. Reporting it here would accuse a valid extension —
    // an error for a modifierExtension — on the strength of an outage.
    const resolution = await resolveExtensionUrl(url, context.fhirVersion);
    const unsupportedRelease = resolution === 'unresolvable' ? unsupportedCrossVersionRelease(url) : undefined;
    const resolvable = resolution === 'resolvable'
      || isKnownCrossVersionExtensionUrl(url, extensionType);
    if (unsupportedRelease) {
      issues.push(createValidationIssue({
        code: 'profile-extension-url-version-invalid',
        path,
        resourceType,
        messageParams: { url, version: unsupportedRelease },
      }));
    } else if (!resolvable && resolution !== 'undetermined') {
      issues.push(createUnresolvedExtensionIssue(url, extensionType, path, resourceType));
    }
  }
  if (url && !isNested) {
    const exampleUrlIssue = validateExampleUrl(url, 'uri', `${path}.url`, resourceType, context.profileUrl);
    if (exampleUrlIssue) issues.push(exampleUrlIssue);
  }

  return issues;
}

/**
 * The HL7 reference validator rejects any extension it cannot resolve ("could
 * not be found so is not allowed here"), whatever its domain, unless the
 * caller explicitly allows unknown extensions. A modifierExtension carries its
 * own message because it can never be safely ignored.
 */
function createUnresolvedExtensionIssue(
  url: string,
  extensionType: 'extension' | 'modifierExtension',
  path: string,
  resourceType: string,
): ValidationIssue {
  const isModifier = extensionType === 'modifierExtension';
  return createValidationIssue({
    code: 'profile-extension-not-found',
    path,
    resourceType,
    messageParams: { url },
    severityOverride: 'error',
    ...(isModifier && {
      customMessage: `The modifier extension ${url} could not be resolved; unrecognised modifier extensions cannot be safely ignored — verify its StructureDefinition or package availability`,
    }),
  });
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

async function retainUnavailableExtensionIssues(run: () => Promise<ValidationIssue[]>, path: string): Promise<ValidationIssue[]> {
  try { return await run(); }
  catch (error: unknown) {
    if (!(error instanceof ProfileReferenceUnavailableError)) throw error;
    return [profileReferenceUnavailableIssue(error, path)];
  }
}
