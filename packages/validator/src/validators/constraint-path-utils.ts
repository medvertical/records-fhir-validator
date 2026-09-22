import { getValidationTargets } from '../business-rules/element-validation-targets.js';

export function getEvaluationContext(
  resource: unknown,
  elementPath: string,
): unknown {
  const values = getValidationTargets(resource, elementPath)
    .map(target => target.value)
    .filter(isPresent);

  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export function elementExistsInResource(
  resource: unknown,
  elementPath: string,
): boolean {
  if (!elementPath) return false;
  return getValidationTargets(resource, elementPath)
    .some(target => isPresent(target.value));
}

export function hasEmptyBackboneElement(
  resource: unknown,
  elementPath: string,
): boolean {
  if (!elementPath) return false;
  return getValidationTargets(resource, elementPath)
    .some(target => isEmptyBackboneValue(target.value));
}

function isEmptyBackboneValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 0 || keys.every(key => isEmptyChildValue(value[key]));
}

function isEmptyChildValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
