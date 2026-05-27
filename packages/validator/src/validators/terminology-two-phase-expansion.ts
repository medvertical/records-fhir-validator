import { logger } from '../logger';
import type { FhirVersion } from './valueset-expansion-cache-key';
import type {
  CodeSystem,
  ValueSet,
  ValueSetComposeExclude,
  ValueSetComposeInclude,
} from './valueset-types';
import type { ValueSetPackageLoader } from './valueset-package-loader';

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
  coverage: TwoPhaseExpansionCoverage;
  source: 'expansion' | 'compose' | 'none';
}

interface CachedExpansion {
  codes: Set<string>;
  coverage: TwoPhaseExpansionCoverage;
  source: 'expansion' | 'compose' | 'none';
}

export class TwoPhaseTerminologyExpansion {
  private cache = new Map<string, CachedExpansion>();
  private static readonly MAX_COMPOSITION_DEPTH = 20;

  constructor(private packageLoader: ValueSetPackageLoader) {}

  clear(): void {
    this.cache.clear();
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

    const fullCode = system ? `${system}|${code}` : code;
    const hit = expansion.codes.has(fullCode) || expansion.codes.has(code);
    return {
      status: hit ? 'hit' : 'miss',
      coverage: expansion.coverage,
      source: expansion.source,
      codeCount: expansion.codes.size,
      durationMs,
    };
  }

  private async getExpansion(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<CachedExpansion> {
    const cacheKey = `${fhirVersion ?? 'any'}|${valueSetUrl}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const valueSet = await this.packageLoader.loadValueSetResource(valueSetUrl, fhirVersion);
    const built = valueSet
      ? await this.buildExpansion(valueSet, new Set(), 0, fhirVersion)
      : { codes: new Set<string>(), coverage: 'none' as const, source: 'none' as const };

    this.cache.set(cacheKey, built);
    if (built.coverage !== 'none') {
      logger.debug(
        `[TwoPhaseTerminology] Built ${built.coverage} local expansion for ${valueSetUrl} ` +
        `(${built.codes.size} codes, source=${built.source})`,
      );
    }
    return built;
  }

  private async buildExpansion(
    valueSet: ValueSet,
    visited: Set<string>,
    depth: number,
    fhirVersion?: FhirVersion,
  ): Promise<ExpansionBuildResult> {
    if (depth >= TwoPhaseTerminologyExpansion.MAX_COMPOSITION_DEPTH) {
      return { codes: new Set(), coverage: 'partial', source: 'compose' };
    }
    if (valueSet.url && visited.has(valueSet.url)) {
      return { codes: new Set(), coverage: 'partial', source: 'compose' };
    }
    if (valueSet.url) visited.add(valueSet.url);

    const expansionCodes = this.collectExpansionCodes(valueSet);
    if (expansionCodes.size > 0) {
      return { codes: expansionCodes, coverage: 'complete', source: 'expansion' };
    }

    const codes = new Set<string>();
    let coverage: TwoPhaseExpansionCoverage = 'complete';

    for (const include of valueSet.compose?.include ?? []) {
      const included = await this.collectComposeEntry(include, visited, depth, fhirVersion);
      included.codes.forEach(code => codes.add(code));
      coverage = combineCoverage(coverage, included.coverage);
    }

    for (const exclude of valueSet.compose?.exclude ?? []) {
      const excluded = await this.collectComposeEntry(exclude, visited, depth, fhirVersion);
      excluded.codes.forEach(code => codes.delete(code));
      coverage = combineCoverage(coverage, excluded.coverage);
    }

    if (codes.size === 0 && coverage === 'complete') {
      coverage = 'none';
    }

    return { codes, coverage, source: codes.size > 0 ? 'compose' : 'none' };
  }

  private collectExpansionCodes(valueSet: ValueSet): Set<string> {
    const codes = new Set<string>();
    const visit = (entries: Array<{ system?: string; code?: string; contains?: any[] }>): void => {
      for (const entry of entries) {
        if (entry.code) {
          if (entry.system) codes.add(`${entry.system}|${entry.code}`);
          codes.add(entry.code);
        }
        if (Array.isArray(entry.contains)) visit(entry.contains);
      }
    };

    if (valueSet.expansion?.contains) {
      visit(valueSet.expansion.contains);
    }
    return codes;
  }

  private async collectComposeEntry(
    entry: ValueSetComposeInclude | ValueSetComposeExclude,
    visited: Set<string>,
    depth: number,
    fhirVersion?: FhirVersion,
  ): Promise<ExpansionBuildResult> {
    const codes = new Set<string>();
    const system = entry.system;
    let coverage: TwoPhaseExpansionCoverage = 'complete';

    for (const concept of entry.concept ?? []) {
      if (!concept.code) continue;
      if (system) codes.add(`${system}|${concept.code}`);
      codes.add(concept.code);
    }

    for (const nestedUrl of entry.valueSet ?? []) {
      const nested = await this.packageLoader.loadValueSetResource(nestedUrl, fhirVersion);
      if (!nested) {
        coverage = combineCoverage(coverage, 'partial');
        continue;
      }
      const nestedExpansion = await this.buildExpansion(nested, new Set(visited), depth + 1, fhirVersion);
      nestedExpansion.codes.forEach(code => codes.add(code));
      coverage = combineCoverage(coverage, nestedExpansion.coverage);
    }

    const filters = 'filter' in entry && Array.isArray(entry.filter) ? entry.filter : [];
    if (filters.length > 0) {
      coverage = combineCoverage(coverage, 'partial');
    }

    const hasConcepts = Boolean(entry.concept?.length);
    const hasNestedValueSets = Boolean(entry.valueSet?.length);
    if (system && !hasConcepts && !hasNestedValueSets && filters.length === 0) {
      const codeSystem = await this.packageLoader.loadCodeSystem(system, fhirVersionToMajor(fhirVersion), entry.version);
      if (isCompleteCodeSystem(codeSystem)) {
        for (const code of this.packageLoader.extractCodesFromCodeSystem(codeSystem)) {
          codes.add(`${system}|${code}`);
          codes.add(code);
        }
      } else {
        coverage = combineCoverage(coverage, 'partial');
      }
    }

    if (codes.size === 0 && coverage === 'complete') {
      coverage = 'none';
    }

    return { codes, coverage, source: codes.size > 0 ? 'compose' : 'none' };
  }
}

function combineCoverage(
  current: TwoPhaseExpansionCoverage,
  next: TwoPhaseExpansionCoverage,
): TwoPhaseExpansionCoverage {
  if (current === 'none') return next;
  if (next === 'none') return current;
  if (current === 'partial' || next === 'partial') return 'partial';
  return 'complete';
}

function fhirVersionToMajor(fhirVersion?: FhirVersion): string | undefined {
  if (fhirVersion === 'R4') return '4';
  if (fhirVersion === 'R5') return '5';
  if (fhirVersion === 'R6') return '6';
  return undefined;
}

function isCompleteCodeSystem(codeSystem: CodeSystem | null): codeSystem is CodeSystem {
  if (!codeSystem) return false;
  return codeSystem.content === undefined || codeSystem.content === 'complete';
}
