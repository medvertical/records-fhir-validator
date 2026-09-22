import { ValueSetPackageLoader } from './valueset-package-loader.js';
import {
  ConstraintExpressionCache,
  type SynchronousFHIRPathExpressionCache,
} from './constraint-expression-cache.js';
import { createMemberOfFunction } from './fhirpath-custom-functions.js';
import { ValueSetCache } from './valueset-cache.js';

type FhirVersion = 'R4' | 'R5' | 'R6';
type ObjectRecord = Record<string, unknown>;
type ValueSetLoader = Pick<ValueSetPackageLoader, 'loadValueSet'>;

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
  resource: unknown,
  resourceType: string,
  loader: ValueSetLoader,
  fhirVersion: FhirVersion = 'R4',
  deferUnavailableTerminology = false,
): Promise<MemberOfPrecheckResult> {
  const match = expression.match(MEMBER_OF_EXISTS_PATTERN) ?? expression.match(VALUE_SET_IN_EXISTS_PATTERN);
  if (!match) return null;

  const rawPath = stripResourcePrefix(match[1], resourceType);
  const valueSetUrl = match[2];
  const codes = await loader.loadValueSet(valueSetUrl, fhirVersion);
  if (!codes || codes.length === 0) return deferUnavailableTerminology ? null : true;

  const acceptedCodes = new Set(codes);
  const values = getValuesAtPath(resource, rawPath);
  if (values.length === 0) return false;

  return values.some(value => valueMatchesAcceptedCode(value, acceptedCodes));
}

/**
 * Some published IGs use `code in '.../ValueSet/...'` as shorthand even
 * though standard FHIRPath `in` is collection membership, not terminology
 * membership. Preserve that established compatibility shape while routing it
 * through the same scoped async memberOf resolver on a cold cache.
 */
export function rewriteLegacyValueSetInExists(expression: string): string {
  const match = expression.match(VALUE_SET_IN_EXISTS_PATTERN);
  return match
    ? `where(${match[1]}.memberOf('${match[2]}')).exists()`
    : expression;
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
  resource: unknown,
  fhirVersion: FhirVersion = 'R4',
  cache: ValueSetCache = new ValueSetCache(),
  expressionCache: SynchronousFHIRPathExpressionCache = new ConstraintExpressionCache(),
): MemberOfPrecheckResult {
  const match = expression.match(TRAILING_MEMBER_OF_PATTERN);
  if (!match) return null;

  const prefixExpression = match[1].trim();
  const valueSetUrl = match[2];
  if (!prefixExpression) return null;

  let selectedValues: unknown[];
  try {
    const compiled = expressionCache.getOrCompile(prefixExpression, fhirVersion);
    if (!compiled) return null;
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
    const outcome = createMemberOfFunction(cache).fn([value], [valueSetUrl]);
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
  context: unknown,
  cache: ValueSetCache = new ValueSetCache(),
): MemberOfPrecheckResult {
  const parsed = parseOptionalMemberOfUnion(expression);
  if (!parsed) return null;

  const values = getValuesAtPath(context, parsed.path);
  if (values.length === 0) return true;

  for (const value of values) {
    let sawDeterminateMembership = false;
    let matchedAnyValueSet = false;

    for (const valueSetUrl of parsed.valueSetUrls) {
      const outcome = createMemberOfFunction(cache).fn([value], [valueSetUrl]);
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

function getValuesAtPath(resource: unknown, path: string): unknown[] {
  if (!path) return [resource];

  let values: unknown[] = [resource];
  for (const segment of path.split('.')) {
    values = values.flatMap(value => getChildValues(value, segment));
    if (values.length === 0) break;
  }
  return values;
}

function getChildValues(value: unknown, segment: string): unknown[] {
  const indexMatch = segment.match(/^(.+)\[(\d+)\]$/);
  const children: unknown[] = [];
  const pending: unknown[] = [value];
  const visitedArrays = new WeakSet<unknown[]>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      if (visitedArrays.has(current)) continue;
      visitedArrays.add(current);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (!isObjectRecord(current)) continue;

    if (indexMatch) {
      const child = current[indexMatch[1]];
      const index = Number(indexMatch[2]);
      if (Array.isArray(child) && child[index] !== undefined) children.push(child[index]);
      continue;
    }

    const child = current[segment];
    if (child === undefined || child === null) continue;
    if (Array.isArray(child)) children.push(...child);
    else children.push(child);
  }

  return children;
}

function valueMatchesAcceptedCode(value: unknown, acceptedCodes: Set<string>): boolean {
  if (typeof value === 'string') return acceptedCodes.has(value);
  if (!isObjectRecord(value)) return false;

  if (typeof value.code === 'string') {
    return codingMatchesAcceptedCode(value, acceptedCodes);
  }

  if (Array.isArray(value.coding)) {
    return value.coding.some(coding => codingMatchesAcceptedCode(coding, acceptedCodes));
  }

  return false;
}

function codingMatchesAcceptedCode(coding: unknown, acceptedCodes: Set<string>): boolean {
  if (!isObjectRecord(coding) || typeof coding.code !== 'string') return false;
  const bareCode = coding.code;
  const systemCode = typeof coding.system === 'string'
    ? `${coding.system}|${coding.code}`
    : null;
  return acceptedCodes.has(bareCode) || (systemCode !== null && acceptedCodes.has(systemCode));
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
