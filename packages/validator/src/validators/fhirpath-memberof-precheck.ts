import { ValueSetPackageLoader } from './valueset-package-loader.js';
import {
  ConstraintExpressionCache,
  type SynchronousFHIRPathExpressionCache,
} from './constraint-expression-cache.js';
import { createMemberOfFunction } from './fhirpath-custom-functions.js';
import { ValueSetCache } from './valueset-cache.js';
import { FHIRPathTerminologyUnverifiedError } from './fhirpath-terminology-types.js';

type FhirVersion = 'R4' | 'R5' | 'R6';
type ObjectRecord = Record<string, unknown>;
type ValueSetLoader = Pick<ValueSetPackageLoader, 'loadValueSet' | 'hasIncompleteExpansion'>;

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
  const values = getValuesAtPath(resource, rawPath);
  if (values.length === 0) return false;

  const codes = await loader.loadValueSet(valueSetUrl, fhirVersion);
  if (!codes || codes.length === 0) {
    if (deferUnavailableTerminology) return null;
    throw new FHIRPathTerminologyUnverifiedError(`ValueSet '${valueSetUrl}' membership could not be verified from local evidence`);
  }

  const acceptedCodes = new Set(codes);
  if (values.some(value => valueMatchesAcceptedCode(value, acceptedCodes))) return true;
  return verifyLocalMembershipMiss(false, [valueSetUrl], loader, fhirVersion, deferUnavailableTerminology);
}

/** Declared expansion totals must not turn a partial local miss into a clinical failure. */
export async function evaluateCachedMemberOf(
  expression: string,
  context: unknown,
  cache: ValueSetCache,
  loader: ValueSetLoader,
  fhirVersion: FhirVersion,
  deferUnavailableTerminology: boolean,
  expressionCache?: SynchronousFHIRPathExpressionCache,
): Promise<MemberOfPrecheckResult> {
  const result = evaluateTrailingMemberOf(expression, context, fhirVersion, cache, expressionCache)
    ?? evaluateOptionalMemberOfUnion(expression, context, cache, fhirVersion, expressionCache);
  const trailing = expression.match(TRAILING_MEMBER_OF_PATTERN);
  const optional = parseOptionalMemberOfUnion(expression);
  const valueSetUrls = trailing ? [trailing[2]] : optional?.valueSetUrls ?? [];
  if (result === null && !deferUnavailableTerminology
    && (trailing || optional)) {
    throw new FHIRPathTerminologyUnverifiedError(
      `ValueSet membership could not be verified from local evidence for ${valueSetUrls.join(', ')}`,
    );
  }
  return verifyLocalMembershipMiss(result, valueSetUrls, loader, fhirVersion, deferUnavailableTerminology);
}

async function verifyLocalMembershipMiss(
  result: MemberOfPrecheckResult,
  valueSetUrls: string[],
  loader: ValueSetLoader,
  fhirVersion: FhirVersion,
  deferUnavailableTerminology: boolean,
): Promise<MemberOfPrecheckResult> {
  if (result !== false) return result;
  for (const valueSetUrl of valueSetUrls) {
    if (!await loader.hasIncompleteExpansion(valueSetUrl, fhirVersion)) continue;
    if (deferUnavailableTerminology) return null;
    throw new FHIRPathTerminologyUnverifiedError(
      `ValueSet '${valueSetUrl}' membership could not be verified from an incomplete local expansion`,
    );
  }
  return false;
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
 * The synchronous expression cache cannot invoke fhirpath.js's async memberOf.
 * Splitting its trailing call lets the FHIRPath model select the prefix values
 * before local membership evaluation. Empty selections satisfy constraints;
 * unknown membership remains null for the caller to defer or mark incomplete.
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
  let sawUndetermined = false;
  for (const value of selectedValues) {
    const outcome = createMemberOfFunction(cache).fn([value], [valueSetUrl]);
    if (!Array.isArray(outcome) || outcome.length === 0) {
      sawUndetermined = true;
      continue;
    }
    sawDeterminate = true;
    if (outcome[0] === false) return false;
  }

  return sawDeterminate && !sawUndetermined ? true : null;
}

/** Evaluate optional membership on the already resolved element context. */
export function evaluateOptionalMemberOfUnion(
  expression: string,
  context: unknown,
  cache: ValueSetCache = new ValueSetCache(),
  fhirVersion: FhirVersion = 'R4',
  expressionCache: SynchronousFHIRPathExpressionCache = new ConstraintExpressionCache(),
): MemberOfPrecheckResult {
  const selected = selectOptionalMemberOfUnion(expression, context, fhirVersion, expressionCache);
  if (!selected) return null;
  const { values, valueSetUrls } = selected;
  if (values.length === 0) return true;

  let sawUndetermined = false;
  for (const value of values) {
    let unknownAlternative = false;
    let matchedAnyValueSet = false;

    for (const valueSetUrl of valueSetUrls) {
      const outcome = createMemberOfFunction(cache).fn([value], [valueSetUrl]);
      if (!Array.isArray(outcome) || outcome.length === 0) {
        unknownAlternative = true;
        continue;
      }
      if (outcome[0] === true) {
        matchedAnyValueSet = true;
        break;
      }
    }

    if (matchedAnyValueSet) continue;
    if (!unknownAlternative) return false;
    sawUndetermined = true;
  }

  return sawUndetermined ? null : true;
}

export function isOptionalMemberOfUnion(expression: string): boolean {
  return parseOptionalMemberOfUnion(expression) !== null;
}

export function selectOptionalMemberOfUnion(
  expression: string,
  context: unknown,
  fhirVersion: FhirVersion,
  expressionCache: SynchronousFHIRPathExpressionCache = new ConstraintExpressionCache(),
): { values: unknown[]; valueSetUrls: string[] } | null {
  const parsed = parseOptionalMemberOfUnion(expression);
  if (!parsed) return null;
  // Indexers select FHIRPath collections, including singleton primitive values.
  try {
    const compiled = expressionCache.getOrCompile(parsed.path, fhirVersion);
    if (!compiled) return null;
    const selected = compiled(context, { resource: context, rootResource: context }, { traceFn: () => {} });
    const values = Array.isArray(selected) ? selected : selected == null ? [] : [selected];
    // The compiler's output drops primitive nodes without values. Defer to the
    // whole expression when that would hide present metadata-only elements.
    const count = expressionCache.getOrCompile(`(${parsed.path}).count()`, fhirVersion);
    if (!count || count(context, { resource: context, rootResource: context }, { traceFn: () => {} })[0] !== values.length) {
      return null;
    }
    return { values, valueSetUrls: parsed.valueSetUrls };
  } catch {
    return null;
  }
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
  return systemCode !== null ? acceptedCodes.has(systemCode) : acceptedCodes.has(bareCode);
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
