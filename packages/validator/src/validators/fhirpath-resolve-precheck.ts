import {
  ConstraintExpressionCache,
  type SynchronousFHIRPathExpressionCache,
} from './constraint-expression-cache.js';
import { createFHIRPathContext, resolveFunction } from './fhirpath-functions.js';

type FhirVersion = 'R4' | 'R5' | 'R6';
type ObjectRecord = Record<string, unknown>;

export type BundleResourceInput =
  | Map<string, unknown>
  | unknown[]
  | { entry?: unknown[] }
  | undefined;

export type ResolvePrecheckResult = boolean | null;

const RESOLVE_EXISTS_PATTERN =
  /^\s*(?:(\$this|[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\.)?resolve\(\)(?:\.ofType\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\))?(?:\.where\((.*)\))?\.exists\(\)\s*$/s;

export interface ResolvePrecheckOptions {
  expression: string;
  context: unknown;
  rootResource: unknown;
  fhirVersion?: FhirVersion;
  bundle?: BundleResourceInput;
  expressionCache?: SynchronousFHIRPathExpressionCache;
}

/**
 * Deterministically evaluates common sync-safe resolve() constraints:
 *
 *   reference.resolve().exists()
 *   reference.resolve().where(active = true).exists()
 *   reference.resolve().ofType(Patient).exists()
 *
 * Returns null when the expression shape is unsupported or when an unresolved
 * external reference would require I/O. That keeps the existing fail-open
 * behaviour for non-deterministic references while closing Bundle/contained
 * false negatives.
 */
export function evaluateResolveExistsConstraint(
  options: ResolvePrecheckOptions,
): ResolvePrecheckResult {
  const match = options.expression.match(RESOLVE_EXISTS_PATTERN);
  if (!match) return null;

  const referencePath = match[1] ?? '$this';
  const expectedType = match[2];
  const predicate = match[3]?.trim();
  const fhirVersion = options.fhirVersion ?? 'R4';
  const fhirPathContext = createFHIRPathContext(options.rootResource, options.bundle);
  const rootResourceType = isObjectRecord(options.rootResource) &&
    typeof options.rootResource.resourceType === 'string'
    ? options.rootResource.resourceType
    : undefined;
  const referenceValues = referencePath === '$this'
    ? [options.context]
    : getValuesAtPath(
      options.context,
      stripResourcePrefix(referencePath, rootResourceType),
    );

  if (referenceValues.length === 0) return false;

  let unresolvedNeedsExternalResolution = false;
  const resolvedTargets: unknown[] = [];
  for (const value of referenceValues) {
    const resolved = resolveFunction([value], fhirPathContext);
    if (resolved.length > 0) {
      resolvedTargets.push(...resolved);
      continue;
    }

    if (!isDeterministicallyUnresolvable(value, options.bundle)) {
      unresolvedNeedsExternalResolution = true;
    }
  }

  const typedTargets = expectedType
    ? resolvedTargets.filter(target =>
      isObjectRecord(target) && target.resourceType === expectedType
    )
    : resolvedTargets;

  if (predicate) {
    const matchingTargets = typedTargets.filter(target =>
      evaluatePredicate(
        target,
        predicate,
        options.rootResource,
        fhirVersion,
        options.expressionCache,
      ),
    );
    if (matchingTargets.length > 0) return true;
    return unresolvedNeedsExternalResolution ? null : false;
  }

  if (typedTargets.length > 0) return true;
  return unresolvedNeedsExternalResolution ? null : false;
}

function stripResourcePrefix(path: string, resourceType: string | undefined): string {
  if (!resourceType) return path;
  return path === resourceType
    ? ''
    : path.startsWith(`${resourceType}.`)
      ? path.slice(resourceType.length + 1)
      : path;
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
  const containers: unknown[] = [];
  const stack: unknown[] = [value];
  const visitedArrays = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      if (visitedArrays.has(current)) continue;
      visitedArrays.add(current);
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push(current[index]);
      }
      continue;
    }
    containers.push(current);
  }

  const indexMatch = segment.match(/^(.+)\[(\d+)\]$/);
  const out: unknown[] = [];
  for (const container of containers) {
    if (!isObjectRecord(container)) continue;
    if (indexMatch) {
      const child = container[indexMatch[1]];
      const index = Number(indexMatch[2]);
      if (Array.isArray(child) && child[index] !== undefined) out.push(child[index]);
      continue;
    }

    const child = container[segment];
    if (child === undefined || child === null) continue;
    if (Array.isArray(child)) out.push(...child);
    else out.push(child);
  }
  return out;
}

function evaluatePredicate(
  target: unknown,
  predicate: string,
  rootResource: unknown,
  fhirVersion: FhirVersion,
  expressionCache: SynchronousFHIRPathExpressionCache = new ConstraintExpressionCache(),
): boolean {
  try {
    const compiled = expressionCache.getOrCompile(predicate, fhirVersion);
    if (!compiled) return false;
    const result = compiled(
      target,
      { resource: rootResource, rootResource },
      { traceFn: () => {} },
    );
    return fhirPathTruthy(result);
  } catch {
    return false;
  }
}

function fhirPathTruthy(result: unknown): boolean {
  if (result === true) return true;
  if (result === false || result === null || result === undefined) return false;
  if (Array.isArray(result)) {
    if (result.length === 0) return false;
    if (result.every(item => typeof item === 'boolean')) {
      return result.every(Boolean);
    }
    return result.some(item => item === true || (item !== false && item != null));
  }
  if (typeof result === 'number') return result !== 0;
  if (typeof result === 'string') return result.length > 0;
  return true;
}

function isDeterministicallyUnresolvable(value: unknown, bundle: BundleResourceInput): boolean {
  const reference = extractReferenceString(value);
  if (!reference) return true;
  if (reference.startsWith('#')) return true;
  return hasBundleResolutionContext(bundle);
}

function extractReferenceString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isObjectRecord(value)) return null;
  return typeof value.reference === 'string' ? value.reference : null;
}

function hasBundleResolutionContext(bundle: BundleResourceInput): boolean {
  if (!bundle) return false;
  if (bundle instanceof Map) return bundle.size > 0;
  if (Array.isArray(bundle)) return bundle.length > 0;
  return isObjectRecord(bundle) && Array.isArray(bundle.entry) && bundle.entry.length > 0;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
