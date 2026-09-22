import type {
  RemoteValueSetValidationResult,
  SubsumptionOutcome,
} from './terminology-api-types.js';
import { TerminologyTimedLruCache } from './terminology-timed-lru-cache.js';

type CachedSubsumption = Exclude<SubsumptionOutcome, 'unknown'>;

/** Mutable remote-operation cache owned by one terminology client graph. */
export class TerminologyOperationCache {
  private readonly codeSystemValidateCode = new TerminologyTimedLruCache<unknown>();
  private readonly subsumes = new TerminologyTimedLruCache<CachedSubsumption>();
  private readonly validateCode = new TerminologyTimedLruCache<RemoteValueSetValidationResult>();
  private readonly valueSetNotResolvable = new TerminologyTimedLruCache<boolean>();

  getCodeSystemValidateCode<T>(key: string): T | undefined {
    return this.codeSystemValidateCode.get(key) as T | undefined;
  }

  storeCodeSystemValidateCode(key: string, result: unknown): void {
    this.codeSystemValidateCode.set(key, result);
  }

  getSubsumes(key: string): SubsumptionOutcome | undefined {
    return this.subsumes.get(key);
  }

  storeSubsumes(key: string, result: SubsumptionOutcome): void {
    if (result !== 'unknown') this.subsumes.set(key, result);
  }

  findSubsumesBySuffix(suffix: string): SubsumptionOutcome | undefined {
    for (const key of this.subsumes.keys()) {
      if (!key.endsWith(suffix)) continue;
      const cached = this.subsumes.get(key);
      if (cached !== undefined) return cached;
    }
    return undefined;
  }

  getValidateCode(key: string): RemoteValueSetValidationResult | undefined {
    return this.validateCode.get(key);
  }

  storeValidateCode(key: string, result: RemoteValueSetValidationResult | boolean): void {
    this.validateCode.set(key, typeof result === 'boolean'
      ? { accepted: result, outcome: result ? 'valid' : 'invalid' }
      : result);
  }

  getValueSetNotResolvable(key: string): boolean | undefined {
    return this.valueSetNotResolvable.get(key);
  }

  storeValueSetNotResolvable(key: string): void {
    this.valueSetNotResolvable.set(key, true);
  }

  clearCodeSystemValidateCode(): void {
    this.codeSystemValidateCode.clear();
  }

  clearSubsumes(): void {
    this.subsumes.clear();
  }

  clearValidateCode(): void {
    this.validateCode.clear();
    this.valueSetNotResolvable.clear();
  }

  clear(): void {
    this.clearCodeSystemValidateCode();
    this.clearSubsumes();
    this.clearValidateCode();
  }

  getStats(): { subsumesResultCount: number; validateCodeResultCount: number } {
    return {
      subsumesResultCount: this.subsumes.size,
      validateCodeResultCount: this.validateCode.size,
    };
  }
}
