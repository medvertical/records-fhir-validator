import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ExtensionDefinition } from './extension-types';

export function checkExtensionPathCardinality(
  elementPath: string,
  definitionsByUrl: Map<string, ExtensionDefinition>,
  counts: Map<string, number>,
  profileUrl: string,
  resourceType = 'Unknown',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [url, def] of definitionsByUrl.entries()) {
    const count = counts.get(url) ?? 0;

    if (def.min > 0 && count < def.min) {
      issues.push(createValidationIssue({
        code: 'profile-extension-min-cardinality',
        path: elementPath,
        resourceType,
        profile: profileUrl,
        messageParams: { url, found: count, min: def.min },
      }));
    }

    if (def.max !== '*') {
      const maxNum = parseInt(def.max, 10);
      if (!Number.isNaN(maxNum) && count > maxNum) {
        issues.push(createValidationIssue({
          code: 'profile-extension-max-cardinality',
          path: elementPath,
          resourceType,
          profile: profileUrl,
          messageParams: { url, found: count, max: def.max },
        }));
      }
    }
  }

  return issues;
}
