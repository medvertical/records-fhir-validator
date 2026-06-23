import { logger } from '../logger';
import type { ValueSetPackageLoader } from './valueset-package-loader';
import { type FhirVersion } from './valueset-expansion-cache-key';
import type { TerminologyResolutionConfig } from './valueset-types';
import {
  TwoPhaseTerminologyExpansion,
  type TwoPhaseLookupResult,
} from './terminology-two-phase-expansion';

/**
 * Shadow/enforce evaluator for two-phase terminology expansion.
 *
 * Extracted from valueset-validator.ts. Owns the install-time expansion
 * instance plus the shadow-comparison statistics and mismatch logging, so the
 * validator can run two-phase lookups alongside its authoritative resolution
 * and (in `enforce` mode) substitute the install-time result.
 */

export interface TwoPhaseShadowStats {
  lookups: number;
  hits: number;
  misses: number;
  unknown: number;
  mismatches: number;
  enforced: number;
}

type TwoPhaseConfig = TerminologyResolutionConfig['twoPhaseExpansion'];

export class TwoPhaseShadowEvaluator {
  private expansion: TwoPhaseTerminologyExpansion;
  private config: TwoPhaseConfig;
  private stats: TwoPhaseShadowStats = {
    lookups: 0,
    hits: 0,
    misses: 0,
    unknown: 0,
    mismatches: 0,
    enforced: 0,
  };
  private mismatchLogs = 0;
  private static readonly MISMATCH_LOG_LIMIT = 20;

  constructor(packageLoader: ValueSetPackageLoader, config: TwoPhaseConfig) {
    this.expansion = new TwoPhaseTerminologyExpansion(packageLoader);
    this.config = config;
  }

  setConfig(config: TwoPhaseConfig): void {
    this.config = config;
  }

  getStats(): TwoPhaseShadowStats {
    return { ...this.stats };
  }

  clearExpansion(): void {
    this.expansion.clear();
  }

  async lookup(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<TwoPhaseLookupResult | undefined> {
    if (!this.config?.enabled) return undefined;

    const result = await this.expansion.lookup(code, system, valueSetUrl, fhirVersion);
    this.stats.lookups++;
    if (result.status === 'hit') this.stats.hits++;
    if (result.status === 'miss') this.stats.misses++;
    if (result.status === 'unknown') this.stats.unknown++;
    return result;
  }

  /**
   * In `enforce` mode with complete coverage, the install-time result is
   * authoritative; returns the boolean to use, or undefined to defer to the
   * validator's own resolution.
   */
  getEnforcedResult(result: TwoPhaseLookupResult | undefined): boolean | undefined {
    if (!result) return undefined;
    if (this.config?.mode !== 'enforce') return undefined;
    if (result.coverage !== 'complete') return undefined;

    this.stats.enforced++;
    return result.status === 'hit';
  }

  /**
   * Records (and rate-limit-logs) a shadow mismatch between the two-phase
   * result and the validator's authoritative result, then returns the
   * authoritative result unchanged.
   */
  finish(
    result: TwoPhaseLookupResult | undefined,
    finalResult: boolean,
    context: { code: string; system?: string; valueSetUrl: string },
  ): boolean {
    if (!result || result.status === 'unknown') return finalResult;
    const twoPhaseResult = result.status === 'hit';
    if (twoPhaseResult !== finalResult) {
      this.stats.mismatches++;
      if (this.config?.logMismatches !== false) {
        if (this.mismatchLogs < TwoPhaseShadowEvaluator.MISMATCH_LOG_LIMIT) {
          logger.warn(
            `[TwoPhaseTerminology] Shadow mismatch for ` +
            `${context.system ? `${context.system}|` : ''}${context.code} in ${context.valueSetUrl}: ` +
            `twoPhase=${twoPhaseResult}, validator=${finalResult}, coverage=${result.coverage}, source=${result.source}`,
          );
        } else if (this.mismatchLogs === TwoPhaseShadowEvaluator.MISMATCH_LOG_LIMIT) {
          logger.warn(
            `[TwoPhaseTerminology] Further shadow mismatches suppressed; ` +
            `current mismatch count=${this.stats.mismatches}`,
          );
        }
        this.mismatchLogs++;
      }
    }
    return finalResult;
  }
}
