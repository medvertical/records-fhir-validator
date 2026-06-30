import { getOrCompileFHIRPathExpression } from './constraint-expression-cache';
import { createFHIRPathContext, resolveFunction } from './fhirpath-functions';

type FhirVersion = 'R4' | 'R5' | 'R6';

type BundleResourceInput =
  | Map<string, any>
  | any[]
  | { entry?: any[] }
  | undefined;

export type ResolvePrecheckResult = boolean | null;

const RESOLVE_EXISTS_PATTERN =
  /^\s*(?:(\$this|[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]+\])?)*)\.)?resolve\(\)(?:\.ofType\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\))?(?:\.where\((.*)\))?\.exists\(\)\s*$/s;

export interface ResolvePrecheckOptions {
  expression: string;
  context: any;
  rootResource: any;
  fhirVersion?: FhirVersion;
  bundle?: BundleResourceInput;
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
  const referenceValues = referencePath === '$this'
    ? [options.context]
    : getValuesAtPath(
      options.context,
      stripResourcePrefix(referencePath, options.rootResource?.resourceType),
    );

  if (referenceValues.length === 0) return false;

  let unresolvedNeedsExternalResolution = false;
  const resolvedTargets: any[] = [];
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
    ? resolvedTargets.filter(target => target?.resourceType === expectedType)
    : resolvedTargets;

  if (predicate) {
    const matchingTargets = typedTargets.filter(target =>
      evaluatePredicate(target, predicate, options.rootResource, fhirVersion),
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

function evaluatePredicate(
  target: any,
  predicate: string,
  rootResource: any,
  fhirVersion: FhirVersion,
): boolean {
  try {
    const compiled = getOrCompileFHIRPathExpression(predicate, fhirVersion);
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

function fhirPathTruthy(result: any): boolean {
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

function isDeterministicallyUnresolvable(value: any, bundle: BundleResourceInput): boolean {
  const reference = extractReferenceString(value);
  if (!reference) return true;
  if (reference.startsWith('#')) return true;
  return hasBundleResolutionContext(bundle);
}

function extractReferenceString(value: any): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return typeof value.reference === 'string' ? value.reference : null;
}

function hasBundleResolutionContext(bundle: BundleResourceInput): boolean {
  if (!bundle) return false;
  if (bundle instanceof Map) return bundle.size > 0;
  if (Array.isArray(bundle)) return bundle.length > 0;
  return Array.isArray(bundle.entry) && bundle.entry.length > 0;
}
