import { ValueSetPackageLoader } from './valueset-package-loader';
import { getOrCompileFHIRPathExpression } from './constraint-expression-cache';
import { memberOfFunction } from './fhirpath-custom-functions';

type FhirVersion = 'R4' | 'R5' | 'R6';

export type MemberOfPrecheckResult = boolean | null;

const MEMBER_OF_EXISTS_PATTERN =
  /^\s*where\s*\(\s*([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\.memberOf\(\s*'([^']+)'\s*\)\s*\)\.exists\(\)\s*$/;
const VALUE_SET_IN_EXISTS_PATTERN =
  /^\s*where\s*\(\s*([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\s+in\s+'([^']*\/ValueSet\/[^']+)'\s*\)\.exists\(\)\s*$/;
const OPTIONAL_MEMBER_OF_UNION_PATTERN =
  /^\s*([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\.empty\(\)\s+or\s+\((.*)\)\s*$/s;

// Matches an expression ending in `<prefix>.memberOf('<url>')` (not wrapped in
// `.exists()`), capturing the prefix and the ValueSet URL. The prefix may
// itself contain `.where(...)`, `.first()`, etc. — anything fhirpath.js can
// evaluate synchronously.
const TRAILING_MEMBER_OF_PATTERN = /^(.*)\.memberOf\(\s*'([^']+)'\s*\)\s*$/s;

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

/**
 * Evaluates a boolean constraint ending in `<prefix>.memberOf('<ValueSet>')`,
 * e.g. `address.where(country = 'XX').country.memberOf('.../iso3166-1-2')`.
 *
 * fhirpath.js only exposes `memberOf` as an async function, which our
 * synchronous compiled-expression path rejects ("asynchronous function is not
 * allowed"). So we split off the trailing `.memberOf(url)`, evaluate the prefix
 * synchronously via fhirpath.js (everything before `.memberOf` is ordinary
 * FHIRPath), and apply the shared synchronous `memberOfFunction` (ISO-3166
 * hardcoded sets + expanded-ValueSet cache) to each resulting value.
 *
 * Returns:
 *   - `true`  — every selected value is a member (or no values were selected,
 *               which FHIRPath treats as vacuously satisfied)
 *   - `false` — at least one selected value is a determinate non-member
 *   - `null`  — not a trailing-memberOf expression, or membership is
 *               undeterminable (no ISO match, no cached expansion) — caller
 *               falls back to its normal evaluation/skip path
 */
export function evaluateTrailingMemberOf(
  expression: string,
  resource: any,
  fhirVersion: FhirVersion = 'R4',
): MemberOfPrecheckResult {
  const match = expression.match(TRAILING_MEMBER_OF_PATTERN);
  if (!match) return null;

  const prefixExpression = match[1].trim();
  const valueSetUrl = match[2];
  if (!prefixExpression) return null;

  let selectedValues: any[];
  try {
    const compiled = getOrCompileFHIRPathExpression(prefixExpression, fhirVersion);
    const result = compiled(resource, { resource, rootResource: resource }, { traceFn: () => {} });
    selectedValues = Array.isArray(result) ? result : result == null ? [] : [result];
  } catch {
    // Prefix itself uses something we can't evaluate synchronously — let the
    // caller handle the full expression (and its eventual skip).
    return null;
  }

  // No values selected → FHIRPath constraints are vacuously satisfied.
  if (selectedValues.length === 0) return true;

  let sawDeterminate = false;
  for (const value of selectedValues) {
    const outcome = memberOfFunction.fn([value], [valueSetUrl]);
    // memberOfFunction returns [] when membership is undeterminable.
    if (!Array.isArray(outcome) || outcome.length === 0) continue;
    sawDeterminate = true;
    if (outcome[0] === false) return false;
  }

  // If nothing was determinable, defer to the caller rather than asserting pass.
  return sawDeterminate ? true : null;
}

/**
 * Evaluates optional element membership constraints of the form:
 *
 *   country.empty() or (
 *     country.memberOf('...iso3166-1-2') or
 *     country.memberOf('...iso3166-1-3')
 *   )
 *
 * These constraints are often attached to a complex element such as
 * `Patient.address`, so the caller must pass the already-resolved element
 * context, not the resource root.
 */
export function evaluateOptionalMemberOfUnion(
  expression: string,
  context: any,
): MemberOfPrecheckResult {
  const parsed = parseOptionalMemberOfUnion(expression);
  if (!parsed) return null;

  const values = getValuesAtPath(context, parsed.path);
  if (values.length === 0) return true;

  for (const value of values) {
    let sawDeterminateMembership = false;
    let matchedAnyValueSet = false;

    for (const valueSetUrl of parsed.valueSetUrls) {
      const outcome = memberOfFunction.fn([value], [valueSetUrl]);
      if (!Array.isArray(outcome) || outcome.length === 0) continue;
      sawDeterminateMembership = true;
      if (outcome[0] === true) {
        matchedAnyValueSet = true;
        break;
      }
    }

    if (!sawDeterminateMembership) return null;
    if (!matchedAnyValueSet) return false;
  }

  return true;
}

function parseOptionalMemberOfUnion(
  expression: string,
): { path: string; valueSetUrls: string[] } | null {
  const match = expression.match(OPTIONAL_MEMBER_OF_UNION_PATTERN);
  if (!match) return null;

  const path = match[1];
  const body = match[2].trim();
  const valueSetUrls: string[] = [];
  const memberOfParts = body.split(/\s+or\s+/);
  const pathPattern = escapeRegExp(path);
  const memberOfPattern = new RegExp(`^${pathPattern}\\.memberOf\\(\\s*'([^']+)'\\s*\\)$`);

  for (const part of memberOfParts) {
    const partMatch = part.trim().match(memberOfPattern);
    if (!partMatch) return null;
    valueSetUrls.push(partMatch[1]);
  }

  return valueSetUrls.length > 0 ? { path, valueSetUrls } : null;
}

function stripResourcePrefix(path: string, resourceType: string): string {
  return path === resourceType
    ? ''
    : path.startsWith(`${resourceType}.`)
      ? path.slice(resourceType.length + 1)
      : path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
