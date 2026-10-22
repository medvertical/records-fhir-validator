import { canonicalPinCacheKey } from '../package/canonical-pin-scope.js';
import { logger } from '../logger.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSet } from './valueset-types.js';
import { expandFiniteValueSet } from './finite-valueset-expansion.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { codeSystemCanonicalCandidates } from './code-system-canonical-aliases.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

export type TwoPhaseExpansionCoverage = 'complete' | 'partial' | 'none';

export interface TwoPhaseLookupResult {
  status: 'hit' | 'miss' | 'unknown';
  coverage: TwoPhaseExpansionCoverage;
  source: 'expansion' | 'compose' | 'none';
  codeCount: number;
  durationMs: number;
}

interface ExpansionBuildResult {
  codes: Set<string>;
  conceptCount: number;
  coverage: TwoPhaseExpansionCoverage;
  source: 'expansion' | 'compose' | 'none';
}

interface CachedExpansion {
  codes: Set<string>;
  conceptCount: number;
  coverage: TwoPhaseExpansionCoverage;
  source: 'expansion' | 'compose' | 'none';
}

export class TwoPhaseTerminologyExpansion {
  private readonly cache: BoundedLruCache<string, CachedExpansion>;
  private readonly pending = new Map<string, Promise<CachedExpansion>>();
  private readonly maxCachedCodesPerExpansion: number;
  private cacheRevision = 0;

  constructor(
    private packageLoader: ValueSetPackageLoader,
    maxCacheEntries = 256,
    maxCachedCodesPerExpansion = 100_000,
  ) {
    this.cache = new BoundedLruCache(maxCacheEntries);
    this.maxCachedCodesPerExpansion = normalizePositiveInteger(maxCachedCodesPerExpansion, 100_000);
  }

  clear(): void {
    this.cacheRevision++;
    this.cache.clear();
    this.pending.clear();
  }

  async lookup(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<TwoPhaseLookupResult> {
    const startedAt = Date.now();
    const expansion = await this.getExpansion(valueSetUrl, fhirVersion);
    const durationMs = Date.now() - startedAt;

    if (expansion.coverage === 'none') {
      return {
        status: 'unknown',
        coverage: 'none',
        source: 'none',
        codeCount: 0,
        durationMs,
      };
    }

    const keys = system ? codeSystemCanonicalCandidates(system).map(candidate => JSON.stringify([candidate, code]))
      : [JSON.stringify([null, code])];
    const hit = keys.some(key => expansion.codes.has(key));
    return {
      status: hit ? 'hit' : 'miss',
      coverage: expansion.coverage,
      source: expansion.source,
      codeCount: expansion.conceptCount,
      durationMs,
    };
  }

  private async getExpansion(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<CachedExpansion> {
    const cacheKey = this.packageLoader.contextCacheKey?.(`${fhirVersion ?? 'any'}|${valueSetUrl}`) ?? canonicalPinCacheKey(`${fhirVersion ?? 'any'}|${valueSetUrl}`);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const pending = this.pending.get(cacheKey);
    if (pending) return pending;

    const cacheRevision = this.cacheRevision;
    const request = this.buildAndCacheExpansion(
      cacheKey,
      valueSetUrl,
      fhirVersion,
      cacheRevision,
    ).finally(() => {
      if (this.pending.get(cacheKey) === request) this.pending.delete(cacheKey);
    });
    this.pending.set(cacheKey, request);
    return request;
  }

  private async buildAndCacheExpansion(
    cacheKey: string,
    valueSetUrl: string,
    fhirVersion: FhirVersion | undefined,
    cacheRevision: number,
  ): Promise<CachedExpansion> {
    const valueSet = await this.packageLoader.loadValueSetResource(valueSetUrl, fhirVersion);
    const built = valueSet
      ? await this.buildExpansion(valueSet, new Set(), 0, fhirVersion)
      : { codes: new Set<string>(), conceptCount: 0, coverage: 'none' as const, source: 'none' as const };

    if (
      this.cacheRevision === cacheRevision
      && built.conceptCount <= this.maxCachedCodesPerExpansion
    ) {
      this.cache.set(cacheKey, built);
    }
    if (built.coverage !== 'none') {
      logger.debug(
        '[TwoPhaseTerminology] Built local expansion',
        {
          ...terminologyTargetMetadata(valueSetUrl),
          coverage: built.coverage,
          codeCount: built.conceptCount,
          source: built.source,
        },
      );
    }
    return built;
  }

  private async buildExpansion(
    valueSet: ValueSet,
    visited: Set<string>,
    _depth: number,
    fhirVersion?: FhirVersion,
  ): Promise<ExpansionBuildResult> {
    const result = await expandFiniteValueSet(valueSet, {
      valueSet: reference => this.packageLoader.loadValueSetResource(reference, fhirVersion),
      codeSystem: (system, version) => this.packageLoader.loadCodeSystem(system, fhirVersionToMajor(fhirVersion), version),
    }, this.maxCachedCodesPerExpansion, visited);
    const codes = new Set(result.concepts.flatMap(concept => [JSON.stringify([concept.system ?? null, concept.code]), JSON.stringify([null, concept.code])]));
    return { codes, conceptCount: result.concepts.length, coverage: result.coverage,
      source: result.concepts.length || result.coverage === 'complete' ? result.source : 'none' };
  }
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.trunc(value))
    : fallback;
}

function fhirVersionToMajor(fhirVersion?: FhirVersion): string | undefined {
  if (fhirVersion === 'R4') return '4';
  if (fhirVersion === 'R5') return '5';
  if (fhirVersion === 'R6') return '6';
  return undefined;
}
