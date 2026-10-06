import type { ValidationIssue } from '@records-fhir/validation-types';
import { isRecord } from '../core/fhir-resource.js';
import { createValidationIssue } from '../issues/index.js';
import { normalizeExtensionUrlForMatching } from './extension-definition-extractor.js';
import { isAbsoluteExtensionUrl } from './extension-structure-rules.js';

/**
 * A relative url inside an extension can only name one of that extension's
 * own sub-extensions; the reference validator rejects any other, also under
 * an extension that defines none. Absolute urls name extensions of their own
 * and are checked as such.
 */
export function undefinedSubExtensionIssues(
  extension: Record<string, unknown>,
  definedUrls: ReadonlySet<string>,
  profileUrl: string,
  extensionPath: string,
  resourceType: string,
): ValidationIssue[] {
  if (!Array.isArray(extension.extension)) return [];
  return extension.extension.flatMap(nested => {
    const url = isRecord(nested) && typeof nested.url === 'string' ? nested.url : undefined;
    if (!url || isAbsoluteExtensionUrl(url) || definedUrls.has(normalizeExtensionUrlForMatching(url))) return [];
    return [createValidationIssue({
      code: 'profile-extension-subextension-invalid',
      path: `${extensionPath}.extension[url='${url}']`,
      resourceType,
      profile: profileUrl,
      customMessage: `Sub-extension url '${url}' is not defined by the Extension ${profileUrl}`,
      details: { url, extension: profileUrl, definedSubExtensions: [...definedUrls] },
    })];
  });
}
