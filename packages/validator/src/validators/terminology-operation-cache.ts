import { TerminologySourceContexts } from './terminology-source-context.js';
import type {
  RemoteValueSetValidationResult,
  SubsumptionOutcome,
} from './terminology-api-types.js';
import { TerminologyTimedLruCache } from './terminology-timed-lru-cache.js';

type CachedSubsumption = Exclude<SubsumptionOutcome, 'unknown'>;

/** Mutable remote-operation cache owned by one terminology client graph. */
export class TerminologyOperationCache {
  private sourceContexts: TerminologySourceContexts | undefined;
  bindSourceContexts(contexts: TerminologySourceContexts): void { this.sourceContexts = contexts; }
  contextKey(key: string): string { return this.key(key); }
  private key(key: string): string { return this.sourceContexts?.key(key) ?? key; }
  private readonly codeSystemValidateCode = new TerminologyTimedLruCache<unknown>();
  private readonly subsumes = new TerminologyTimedLruCache<{ outcome: CachedSubsumption; scope: string }>();
  private readonly validateCode = new TerminologyTimedLruCache<RemoteValueSetValidationResult>();
  private readonly valueSetNotResolvable = new TerminologyTimedLruCache<boolean>();

  getCodeSystemValidateCode<T>(key: string): T | undefined {
    return this.codeSystemValidateCode.get(this.key(key)) as T | undefined;
  }

  storeCodeSystemValidateCode(key: string, result: unknown): void {
    this.codeSystemValidateCode.set(this.key(key), result);
  }

  getSubsumes(key: string): SubsumptionOutcome | undefined {
    return this.subsumes.get(this.key(key))?.outcome;
  }

  storeSubsumes(key: string, result: SubsumptionOutcome): void {
    if (result !== 'unknown') this.subsumes.set(this.key(key), { outcome: result, scope: this.key('') });
  }

  findSubsumesBySuffix(suffix: string): SubsumptionOutcome | undefined {
    for (const key of this.subsumes.keys()) {
      if (!key.startsWith(this.key('')) || !key.endsWith(suffix)) continue;
      const cached = this.subsumes.get(key);
      if (cached?.scope === this.key('')) return cached.outcome;
    }
    return undefined;
  }

  getValidateCode(key: string): RemoteValueSetValidationResult | undefined {
    return this.validateCode.get(this.key(key));
  }

  storeValidateCode(key: string, result: RemoteValueSetValidationResult | boolean): void {
    this.validateCode.set(this.key(key), typeof result === 'boolean'
      ? { accepted: result, outcome: result ? 'valid' : 'invalid' }
      : result);
  }

  getValueSetNotResolvable(key: string): boolean | undefined {
    return this.valueSetNotResolvable.get(this.key(key));
  }

  storeValueSetNotResolvable(key: string): void {
    this.valueSetNotResolvable.set(this.key(key), true);
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
