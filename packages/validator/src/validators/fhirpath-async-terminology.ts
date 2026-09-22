import fhirpath from 'fhirpath';

import { getFhirPathModel } from './fhirpath-model-resolver.js';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { buildAsyncTerminologyInvocationTable } from './fhirpath-terminology-invocations.js';
import { rewriteFHIRPathTerminologyFunctions } from './fhirpath-terminology-rewrite.js';
import type {
  FHIRPathInvocationTable as InvocationTable,
  FHIRPathTerminologyResolver,
  FHIRPathTerminologyVersion as FhirVersion,
} from './fhirpath-terminology-types.js';

export {
  FHIRPathTerminologyUnverifiedError,
  type FHIRPathTerminologyResolver,
} from './fhirpath-terminology-types.js';
export { rewriteFHIRPathTerminologyFunctions } from './fhirpath-terminology-rewrite.js';

type CompiledExpression = ReturnType<typeof fhirpath.compile>;
const MAX_CACHE_ENTRIES_PER_RESOLVER = 500;

export interface AsyncFHIRPathTerminologyEvaluation {
  expression: string;
  context: unknown;
  rootResource: unknown;
  fhirVersion: FhirVersion;
  resolver: FHIRPathTerminologyResolver;
  userInvocationTable?: unknown;
  expressionCache?: AsyncFHIRPathTerminologyCache;
}

export class AsyncFHIRPathTerminologyCache {
  private readonly resolverCaches = new WeakMap<
    FHIRPathTerminologyResolver,
    BoundedLruCache<string, CompiledExpression>
  >();

  getOrCompile(
    resolver: FHIRPathTerminologyResolver,
    expression: string,
    fhirVersion: FhirVersion,
  ): CompiledExpression {
    let cache = this.resolverCaches.get(resolver);
    if (!cache) {
      cache = new BoundedLruCache(MAX_CACHE_ENTRIES_PER_RESOLVER);
      this.resolverCaches.set(resolver, cache);
    }

    const key = `${fhirVersion}|${expression}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const compiled = compileAsyncTerminologyExpression(expression, fhirVersion, resolver);
    cache.set(key, compiled);
    return compiled;
  }
}

/**
 * FHIRPath.js implements terminology functions asynchronously, but its built-in
 * HTTP client cannot use Records' scoped routing, auth, circuit breakers, or
 * request budgets. Rewriting only the terminology function identifiers keeps
 * the expression semantics in FHIRPath.js while delegating I/O to the
 * configured Records resolver.
 */
export async function evaluateAsyncFHIRPathTerminology(
  input: AsyncFHIRPathTerminologyEvaluation,
): Promise<unknown> {
  const rewritten = rewriteFHIRPathTerminologyFunctions(input.expression);
  if (!rewritten.hasTerminologyFunction) {
    throw new Error('FHIRPath expression does not contain an asynchronous terminology function');
  }

  const compiled = getOrCompile(
    input.resolver,
    rewritten.expression,
    input.fhirVersion,
    input.userInvocationTable,
    input.expressionCache,
  );
  return compiled(
    input.context,
    {
      resource: input.rootResource,
      rootResource: input.rootResource,
    },
    { traceFn: () => {} },
  );
}

export function hasAsyncFHIRPathTerminology(expression: string): boolean {
  return rewriteFHIRPathTerminologyFunctions(expression).hasTerminologyFunction;
}

function getOrCompile(
  resolver: FHIRPathTerminologyResolver,
  expression: string,
  fhirVersion: FhirVersion,
  userInvocationTable?: unknown,
  expressionCache: AsyncFHIRPathTerminologyCache = new AsyncFHIRPathTerminologyCache(),
): CompiledExpression {
  if (isRecord(userInvocationTable)) {
    return compileAsyncTerminologyExpression(
      expression,
      fhirVersion,
      resolver,
      userInvocationTable as InvocationTable,
    );
  }

  return expressionCache.getOrCompile(resolver, expression, fhirVersion);
}

function compileAsyncTerminologyExpression(
  expression: string,
  fhirVersion: FhirVersion,
  resolver: FHIRPathTerminologyResolver,
  userInvocationTable: InvocationTable = {},
): CompiledExpression {
  return fhirpath.compile(
    rewriteCollectionTypeOperators(expression),
    getFhirPathModel(fhirVersion),
    {
      async: 'always',
      userInvocationTable: {
        ...userInvocationTable,
        ...buildAsyncTerminologyInvocationTable(resolver, fhirVersion),
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
