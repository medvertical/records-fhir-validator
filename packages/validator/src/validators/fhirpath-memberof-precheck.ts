import { ValueSetPackageLoader } from './valueset-package-loader';

type FhirVersion = 'R4' | 'R5' | 'R6';

export type MemberOfPrecheckResult = boolean | null;

const MEMBER_OF_EXISTS_PATTERN =
  /^\s*where\s*\(\s*([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\.memberOf\(\s*'([^']+)'\s*\)\s*\)\.exists\(\)\s*$/;
const VALUE_SET_IN_EXISTS_PATTERN =
  /^\s*where\s*\(\s*([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\s+in\s+'([^']*\/ValueSet\/[^']+)'\s*\)\.exists\(\)\s*$/;

/**
 * Evaluates the common invariant shape:
 *   where(path.memberOf('ValueSet')).exists()
 *
 * fhirpath.js exposes memberOf as an async function, which cannot run in our
 * synchronous compiled-expression path. For this simple shape, evaluate the
 * ValueSet membership directly against local package ValueSets instead of
 * skipping the constraint or producing false positives.
 */
export async function evaluateSimpleMemberOfExists(
  expression: string,
  resource: any,
  resourceType: string,
  loader: ValueSetPackageLoader,
  fhirVersion: FhirVersion = 'R4',
): Promise<MemberOfPrecheckResult> {
  const match = expression.match(MEMBER_OF_EXISTS_PATTERN) ?? expression.match(VALUE_SET_IN_EXISTS_PATTERN);
  if (!match) return null;

  const rawPath = stripResourcePrefix(match[1], resourceType);
  const valueSetUrl = match[2];
  const codes = await loader.loadValueSet(valueSetUrl, fhirVersion);
  if (!codes || codes.length === 0) return true;

  const acceptedCodes = new Set(codes);
  const values = getValuesAtPath(resource, rawPath);
  if (values.length === 0) return false;

  return values.some(value => valueMatchesAcceptedCode(value, acceptedCodes));
}

function stripResourcePrefix(path: string, resourceType: string): string {
  return path === resourceType
    ? ''
    : path.startsWith(`${resourceType}.`)
      ? path.slice(resourceType.length + 1)
      : path;
}

function getValuesAtPath(resource: any, path: string): any[] {
  if (!path) return [resource];

  let values: any[] = [resource];
  for (const segment of path.split('.')) {
    values = values.flatMap(value => getChildValues(value, segment));
    if (values.length === 0) break;
  }
  return values;
}

function getChildValues(value: any, segment: string): any[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => getChildValues(item, segment));
  }
  if (!value || typeof value !== 'object') return [];

  const indexMatch = segment.match(/^(.+)\[(\d+)\]$/);
  if (indexMatch) {
    const child = value[indexMatch[1]];
    const index = Number(indexMatch[2]);
    return Array.isArray(child) && child[index] !== undefined ? [child[index]] : [];
  }

  const child = value[segment];
  if (child === undefined || child === null) return [];
  return Array.isArray(child) ? child : [child];
}

function valueMatchesAcceptedCode(value: any, acceptedCodes: Set<string>): boolean {
  if (typeof value === 'string') return acceptedCodes.has(value);
  if (!value || typeof value !== 'object') return false;

  if (typeof value.code === 'string') {
    return codingMatchesAcceptedCode(value, acceptedCodes);
  }

  if (Array.isArray(value.coding)) {
    return value.coding.some((coding: any) => codingMatchesAcceptedCode(coding, acceptedCodes));
  }

  return false;
}

function codingMatchesAcceptedCode(coding: any, acceptedCodes: Set<string>): boolean {
  if (!coding || typeof coding.code !== 'string') return false;
  const bareCode = coding.code;
  const systemCode = typeof coding.system === 'string'
    ? `${coding.system}|${coding.code}`
    : null;
  return acceptedCodes.has(bareCode) || (systemCode !== null && acceptedCodes.has(systemCode));
}
