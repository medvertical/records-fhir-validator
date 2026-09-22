import { getValidationTargets } from '../../business-rules/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { getDirectValue, isValueEmpty } from './structural-executor-helpers.js';

type FhirResource = Record<string, unknown>;
type ValidationTarget = ReturnType<typeof getValidationTargets>[number];
type ValueAtPath = (resource: FhirResource, path: string) => unknown;

export function groupTargetsByContext(
  validationTargets: ValidationTarget[],
): Map<string, ValidationTarget[]> {
  const targetsByContext = new Map<string, ValidationTarget[]>();
  for (const target of validationTargets) {
    const key = target.contextPath || '';
    const group = targetsByContext.get(key) || [];
    group.push(target);
    targetsByContext.set(key, group);
  }
  return targetsByContext;
}

export function retargetIssuePath(
  issue: ValidationIssue,
  sourcePath: string,
  targetPath: string,
): ValidationIssue {
  const replacePath = (value: unknown): unknown => (
    typeof value === 'string' ? value.split(sourcePath).join(targetPath) : value
  );
  const details = issue.details && typeof issue.details === 'object'
    ? Object.fromEntries(
      Object.entries(issue.details).map(([key, value]) => [key, replacePath(value)]),
    )
    : issue.details;
  return {
    ...issue,
    path: targetPath,
    message: replacePath(issue.message) as string,
    humanReadable: replacePath(issue.humanReadable) as string | undefined,
    details,
  };
}

export function elementActuallyExists(
  resource: FhirResource,
  path: string,
  getValueAtPath: ValueAtPath,
): boolean {
  const validationTargets = getValidationTargets(resource, path);
  if (validationTargets.some(target => !isValueEmpty(target.value))) return true;

  const directValue = getDirectValue(resource, path);
  if (!isValueEmpty(directValue)) return true;

  try {
    return !isValueEmpty(getValueAtPath(resource, path));
  } catch {
    return false;
  }
}
