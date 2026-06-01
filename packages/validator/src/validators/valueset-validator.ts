import type { ValidationIssue } from '../types';
import type { Binding } from '../core/structure-definition-types';
import { createBindingViolation, createBindingUnverified } from '../issues';
import { logger } from '../logger';

import type {
  TerminologyResolutionConfig,
  CodeBindingOutcome
} from './valueset-types';
import {
  DEFAULT_RESOLUTION_CONFIG,
  isExternalCodeSystem,
  EXTERNAL_CODE_SYSTEMS
} from './valueset-types';
import { extractCodeInfo, extractCodeInfos } from './valueset-code-info';
import {
  displaysEquivalentForCodeInfo,
  resourceTypeFromElementPath,
  type BindingStrength,
  type CodeInfo,
} from './valueset-display-utils';
import { type FhirVersion } from './valueset-expansion-cache-key';
import { validateDisplayMatchesCodeSystem } from './valueset-display-validator';
import { KNOWN_VALUE_SET_EXPANSIONS } from './valueset-known-expansions';
import { isLanguageBinding, validateBCP47 } from './valueset-language-utils';
import { ValueSetCache, valueSetCache } from './valueset-cache';
import {
  TerminologyApiClient,
  clearCodeSystemValidateCodeCache,
  clearSubsumesCache,
  clearValidateCodeCache,
  getSubsumesCacheSize,
  getValidateCodeCacheSize,
  isSnomedNationalExtensionCode,
  type CodeSystemValidationResult
} from './terminology-api-client';
import { ValueSetPackageLoader } from './valueset-package-loader';
import {
  getScopedExpansionCacheKey,
  hasTerminologyServer,
  resolveTerminologyServerForSystem,
} from './valueset-server-routing';
import {
  TwoPhaseTerminologyExpansion,
  type TwoPhaseLookupResult,
} from './terminology-two-phase-expansion';

export type { TerminologyResolutionStrategy, TerminologyResolutionConfig, ValueSet, CodeSystem } from './valueset-types';

type ValidateBindingOptions = {
  valueSetUrl?: string;
  profileUrl?: string;
  fhirVersion?: FhirVersion;
};

export class ValueSetValidator {
  private resolutionConfig: TerminologyResolutionConfig;
  private cache: ValueSetCache;
  private apiClient: TerminologyApiClient;
  private packageLoader: ValueSetPackageLoader;
  private twoPhaseExpansion: TwoPhaseTerminologyExpansion;
  private twoPhaseStats = {
    lookups: 0,
    hits: 0,
    misses: 0,
    unknown: 0,
    mismatches: 0,
    enforced: 0,
  };
  private twoPhaseMismatchLogs = 0;

  static readonly EXTERNAL_CODE_SYSTEMS = EXTERNAL_CODE_SYSTEMS;
  private static readonly TWO_PHASE_MISMATCH_LOG_LIMIT = 20;

  constructor() {
    this.resolutionConfig = { ...DEFAULT_RESOLUTION_CONFIG };
    this.cache = valueSetCache;
    this.apiClient = new TerminologyApiClient(this.resolutionConfig, this.cache);
    this.packageLoader = new ValueSetPackageLoader(this.cache);
    this.twoPhaseExpansion = new TwoPhaseTerminologyExpansion(this.packageLoader);
  }

  /**
   * Configure the terminology resolution strategy
   */
  setResolutionConfig(config: Partial<TerminologyResolutionConfig>): void {
    this.resolutionConfig = { ...this.resolutionConfig, ...config };
    this.apiClient.setConfig(this.resolutionConfig);
    const twoPhase = this.resolutionConfig.twoPhaseExpansion?.enabled
      ? this.resolutionConfig.twoPhaseExpansion.mode
      : 'off';
    logger.info(`[ValueSetValidator] Resolution config updated: strategy=${this.resolutionConfig.strategy}, twoPhase=${twoPhase}`);
  }

  /**
   * Get current resolution config
   */
  getResolutionConfig(): TerminologyResolutionConfig {
    return { ...this.resolutionConfig };
  }

  /**
   * Check if a CodeSystem requires external validation
   */
  isExternalCodeSystem(system: string): boolean {
    return isExternalCodeSystem(system);
  }

  private resolveServerForSystem(system?: string): { url: string; auth?: any } | undefined {
    return resolveTerminologyServerForSystem(this.resolutionConfig, system);
  }

  private hasTerminologyServer(override?: { url: string }): boolean {
    return hasTerminologyServer(this.resolutionConfig, override);
  }

  private getExpansionCacheKey(valueSetUrl: string, fhirVersion?: FhirVersion): string {
    return getScopedExpansionCacheKey(valueSetUrl, this.resolutionConfig, fhirVersion);
  }

  private async lookupTwoPhaseExpansion(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<TwoPhaseLookupResult | undefined> {
    if (!this.resolutionConfig.twoPhaseExpansion?.enabled) return undefined;

    const result = await this.twoPhaseExpansion.lookup(code, system, valueSetUrl, fhirVersion);
    this.twoPhaseStats.lookups++;
    if (result.status === 'hit') this.twoPhaseStats.hits++;
    if (result.status === 'miss') this.twoPhaseStats.misses++;
    if (result.status === 'unknown') this.twoPhaseStats.unknown++;
    return result;
  }

  private getEnforcedTwoPhaseResult(result: TwoPhaseLookupResult | undefined): boolean | undefined {
    if (!result) return undefined;
    if (this.resolutionConfig.twoPhaseExpansion?.mode !== 'enforce') return undefined;
    if (result.coverage !== 'complete') return undefined;

    this.twoPhaseStats.enforced++;
    return result.status === 'hit';
  }

  private finishTwoPhaseLookup(
    result: TwoPhaseLookupResult | undefined,
    finalResult: boolean,
    context: { code: string; system?: string; valueSetUrl: string },
  ): boolean {
    if (!result || result.status === 'unknown') return finalResult;
    const twoPhaseResult = result.status === 'hit';
    if (twoPhaseResult !== finalResult) {
      this.twoPhaseStats.mismatches++;
      if (this.resolutionConfig.twoPhaseExpansion?.logMismatches !== false) {
        if (this.twoPhaseMismatchLogs < ValueSetValidator.TWO_PHASE_MISMATCH_LOG_LIMIT) {
          logger.warn(
            `[TwoPhaseTerminology] Shadow mismatch for ` +
            `${context.system ? `${context.system}|` : ''}${context.code} in ${context.valueSetUrl}: ` +
            `twoPhase=${twoPhaseResult}, validator=${finalResult}, coverage=${result.coverage}, source=${result.source}`,
          );
        } else if (this.twoPhaseMismatchLogs === ValueSetValidator.TWO_PHASE_MISMATCH_LOG_LIMIT) {
          logger.warn(
            `[TwoPhaseTerminology] Further shadow mismatches suppressed; ` +
            `current mismatch count=${this.twoPhaseStats.mismatches}`,
          );
        }
        this.twoPhaseMismatchLogs++;
      }
    }
    return finalResult;
  }

  private async validateCodeViaTerminologyServer(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: 'required' | 'extensible' | 'preferred' | 'example' | undefined,
    override: { url: string; auth?: any } | undefined,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    const isValidOnServer = await this.apiClient.validateCode(code, system, valueSetUrl, bindingStrength, override);
    if (isValidOnServer) {
      return true;
    }

    return this.validateCodeAgainstConceptFilters(code, system, valueSetUrl, override, fhirVersion);
  }

  private async validateCodeAgainstConceptFilters(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    override: { url: string; auth?: any } | undefined,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    if (!system || !this.hasTerminologyServer(override)) return false;

    const filters = await this.packageLoader.getIncludeConceptFilters(valueSetUrl, fhirVersion);
    for (const filter of filters) {
      if (filter.system !== system || filter.property !== 'concept') continue;

      if (filter.op === '=' && filter.value === code) {
        return true;
      }

      if (filter.op === 'is-a' || filter.op === 'descendent-of') {
        const outcome = await this.apiClient.subsumes(system, filter.value, code, override);
        if (outcome === 'subsumes') {
          return true;
        }
        if (filter.op === 'is-a' && outcome === 'equivalent') {
          return true;
        }
      }
    }

    return false;
  }

  private hasUnsupportedFilterForSystem(
    filters: Array<{ system: string; property: string; op: string }>,
    system: string | undefined,
  ): boolean {
    return filters.some(filter => {
      if (system && filter.system !== system) return false;
      if (filter.property !== 'concept') return true;
      return filter.op !== '=' && filter.op !== 'is-a' && filter.op !== 'descendent-of';
    });
  }

  private isUnresolvableSnomedExtensionFilterCode(
    system: string | undefined,
    code: string,
    filters: Array<{ system: string; property: string; op: string }>,
  ): boolean {
    if (system !== 'http://snomed.info/sct') return false;
    if (!isSnomedNationalExtensionCode(code)) return false;
    return filters.some(filter =>
      filter.system === system
      && filter.property === 'concept'
      && (filter.op === 'is-a' || filter.op === 'descendent-of')
    );
  }

  /**
   * Validate a coded element against its binding
   */
  async validateBinding(
    code: any,
    binding: Binding | undefined,
    elementPath: string,
    options?: ValidateBindingOptions,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!binding || !binding.valueSet) {
      return issues;
    }

    if (binding.strength === 'example') {
      return issues;
    }

    try {
      const codeInfos = extractCodeInfos(code);
      if (codeInfos.length === 0) {
        return issues;
      }

      issues.push(...await this.validateExtractedCodeBindings(
        code,
        codeInfos,
        binding,
        elementPath,
        options,
      ));

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (binding.strength === 'required') {
        const codeInfo = extractCodeInfo(code);
        if (codeInfo) {
          logger.warn(`[ValueSetValidator] Required binding validation failed, treating as invalid: ${err.message}`);
          issues.push(createBindingViolation({
            strength: 'required',
            code: codeInfo.code,
            system: codeInfo.system,
            valueSet: binding.valueSet,
            path: elementPath,
            resourceType: resourceTypeFromElementPath(elementPath),
            profile: options?.profileUrl,
          }));
        }
      } else {
        logger.warn('[ValueSetValidator] Error validating binding:', error);
      }
    }

    return issues;
  }

  private async validateExtractedCodeBindings(
    rawCode: any,
    codeInfos: CodeInfo[],
    binding: Binding,
    elementPath: string,
    options?: ValidateBindingOptions,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const valueSetUrl = options?.valueSetUrl || binding.valueSet;
    if (!valueSetUrl) return issues;

    const validCodeInfos: CodeInfo[] = [];
    const unverifiedCodeInfos: CodeInfo[] = [];
    const firstCodeInfo = codeInfos[0];

    for (const codeInfo of codeInfos) {
      const outcome = await this.resolveCodeBindingForBinding(
        codeInfo.code,
        codeInfo.system,
        valueSetUrl,
        binding.strength as BindingStrength,
        options?.fhirVersion,
      );

      if (outcome === 'valid') {
        validCodeInfos.push(codeInfo);
      } else if (outcome === 'unverified') {
        // Fail open (count as valid for the violation decision below) but
        // keep a record so the skip can be surfaced as informational.
        validCodeInfos.push(codeInfo);
        unverifiedCodeInfos.push(codeInfo);
      }
    }

    const strictRequired = this.resolutionConfig.strictUnverifiedRequiredBindings;
    if (
      (this.resolutionConfig.reportUnverifiedBindings || strictRequired)
      && binding.strength !== 'example'
    ) {
      // Strict policy raises only unverifiable *required* bindings to warning;
      // extensible/preferred stay informational (gap P-3 step c).
      const severityOverride =
        strictRequired && binding.strength === 'required' ? 'warning' as const : undefined;
      for (const codeInfo of unverifiedCodeInfos) {
        issues.push(createBindingUnverified({
          strength: binding.strength as 'required' | 'extensible' | 'preferred',
          code: codeInfo.code,
          system: codeInfo.system,
          valueSet: valueSetUrl,
          path: elementPath,
          resourceType: resourceTypeFromElementPath(elementPath),
          profile: options?.profileUrl,
          severityOverride,
        }));
      }
    }

    issues.push(...await this.validateDisplaysForCodeInfos(
      rawCode,
      validCodeInfos,
      valueSetUrl,
      binding,
      elementPath,
      options,
    ));

    if (
      validCodeInfos.length === 0
      && firstCodeInfo
      && (binding.strength === 'required' || binding.strength === 'extensible' || binding.strength === 'preferred')
    ) {
      issues.push(createBindingViolation({
        strength: binding.strength as 'required' | 'extensible' | 'preferred' | 'example',
        code: firstCodeInfo.code,
        system: firstCodeInfo.system,
        valueSet: valueSetUrl,
        path: elementPath,
        resourceType: resourceTypeFromElementPath(elementPath),
        profile: options?.profileUrl,
      }));
    }

    return issues;
  }

  private async validateDisplaysForCodeInfos(
    rawCode: any,
    codeInfos: CodeInfo[],
    valueSetUrl: string,
    binding: Binding,
    elementPath: string,
    options?: ValidateBindingOptions,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const codeInfo of codeInfos) {
      const displayIssue = await validateDisplayMatchesCodeSystem(
        rawCode,
        codeInfo,
        valueSetUrl,
        elementPath,
        {
          bindingStrength: binding.strength as BindingStrength | undefined,
          profileUrl: options?.profileUrl,
          fhirVersion: options?.fhirVersion,
          cache: this.cache,
          packageLoader: this.packageLoader,
        },
      );
      if (displayIssue) {
        issues.push(displayIssue);
      }
    }
    return issues;
  }

  /**
   * Validate code with binding-strength awareness
   */
  async isCodeValidForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return (await this.resolveCodeBindingForBinding(code, system, valueSetUrl, bindingStrength, fhirVersion)) !== 'invalid';
  }

  /**
   * Tri-state variant of {@link isCodeValidForBinding}. Distinguishes
   * `unverified` (could not confirm) from `valid`, so callers can surface a
   * visible informational issue instead of silently failing open (gap P-3).
   */
  async resolveCodeBindingForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<CodeBindingOutcome> {
    try {
      return await this.resolveCodeBinding(code, system, valueSetUrl, bindingStrength, fhirVersion);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (bindingStrength === 'required') {
        logger.warn(`[ValueSetValidator] Required binding validation failed, treating as invalid: ${err.message}`);
        return 'invalid';
      }
      return 'unverified';
    }
  }

  /**
   * Validate a code directly against a CodeSystem using tx.fhir.org
   */
  async validateCodeInCodeSystem(
    code: string,
    system: string,
    display?: string,
  ): Promise<CodeSystemValidationResult> {
    if (!this.isExternalCodeSystem(system)) {
      return { valid: true };
    }
    // Scope-based routing: if settings configure a server preferred for
    // this system, call THAT server instead of the default. Otherwise
    // pass undefined and the api client uses its default serverUrl.
    const override = this.resolveServerForSystem(system);
    const result = await this.apiClient.validateCodeInCodeSystem(code, system, display, override);
    if (!display || !isDisplayMismatchResult(result)) {
      return this.validateInactiveCodeWithFallbackServers(code, system, result, override);
    }
    if (this.isEquivalentDisplayMismatch(code, system, display, result)) {
      return { valid: true };
    }

    const displayResult = await this.validateDisplayMismatchWithFallbackServers(code, system, display, result, override);
    return this.validateInactiveCodeWithFallbackServers(code, system, displayResult, override);
  }

  private isEquivalentDisplayMismatch(
    code: string,
    system: string,
    actualDisplay: string,
    result: CodeSystemValidationResult,
  ): boolean {
    const expectedDisplays = [
      ...extractExpectedDisplaysFromMessage(result.message),
      ...(result.issues ?? []).flatMap(issue => extractExpectedDisplaysFromMessage(issue.message)),
    ];

    return expectedDisplays.some(expected =>
      displaysEquivalentForCodeInfo(expected, actualDisplay, { code, system }),
    );
  }

  private async validateDisplayMismatchWithFallbackServers(
    code: string,
    system: string,
    display: string,
    primaryResult: CodeSystemValidationResult,
    primaryOverride: { url: string; auth?: any } | undefined,
  ): Promise<CodeSystemValidationResult> {
    const fallbackServers = this.getFallbackTerminologyServers(primaryOverride);
    if (fallbackServers.length === 0) return primaryResult;

    for (const server of fallbackServers) {
      const fallbackResult = await this.apiClient.validateCodeInCodeSystem(code, system, display, server);
      if (fallbackResult.valid) {
        return {
          ...fallbackResult,
          inactive: primaryResult.inactive || fallbackResult.inactive,
        };
      }
    }

    return primaryResult;
  }

  private async validateInactiveCodeWithFallbackServers(
    code: string,
    system: string,
    primaryResult: CodeSystemValidationResult,
    primaryOverride: { url: string; auth?: any } | undefined,
  ): Promise<CodeSystemValidationResult> {
    if (!isInactiveResult(primaryResult)) return primaryResult;

    const fallbackServers = this.getFallbackTerminologyServers(primaryOverride);
    if (fallbackServers.length === 0) return primaryResult;

    for (const server of fallbackServers) {
      // Validate the code status only. Passing the original display here can
      // turn an otherwise active code into a display-mismatch result.
      const fallbackResult = await this.apiClient.validateCodeInCodeSystem(code, system, undefined, server);
      if (fallbackResult.valid && !isInactiveResult(fallbackResult)) {
        const filteredIssues = primaryResult.issues?.filter(issue => !isInactiveIssue(issue)) ?? [];
        const { message: _message, issues: _issues, ...activeResult } = primaryResult;
        return {
          ...activeResult,
          inactive: false,
          ...(filteredIssues.length > 0 ? { issues: filteredIssues } : {}),
        };
      }
    }

    return primaryResult;
  }

  private getFallbackTerminologyServers(primaryOverride: { url: string } | undefined): Array<{ url: string; auth?: any }> {
    const skippedUrls = new Set<string>();
    if (primaryOverride?.url) {
      skippedUrls.add(primaryOverride.url);
    } else if (this.resolutionConfig.serverUrl) {
      skippedUrls.add(this.resolutionConfig.serverUrl);
    }

    return (this.resolutionConfig.servers || [])
      .filter(server => server.enabled && !server.circuitOpen && Boolean(server.url))
      .filter(server => !skippedUrls.has(server.url))
      .map(server => ({ url: server.url, auth: server.authConfig }));
  }

  /**
   * Check if a code is in a value set
   */
  async isCodeInValueSet(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    try {
      if (isLanguageBinding(valueSetUrl, system)) {
        return validateBCP47(code);
      }

      const twoPhaseLookup = await this.lookupTwoPhaseExpansion(code, system, valueSetUrl, fhirVersion);
      const enforcedTwoPhaseResult = this.getEnforcedTwoPhaseResult(twoPhaseLookup);
      if (enforcedTwoPhaseResult !== undefined) {
        return this.finishTwoPhaseLookup(twoPhaseLookup, enforcedTwoPhaseResult, { code, system, valueSetUrl });
      }

      const expandedCodes = await this.getExpandedValueSet(valueSetUrl, fhirVersion);

      const fullCode = system ? `${system}|${code}` : code;
      const isInExpansion = expandedCodes.has(fullCode) || expandedCodes.has(code);

      if (isInExpansion) {
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      }

      // Try server validation as fallback
      const override = this.resolveServerForSystem(system);
      if (this.hasTerminologyServer(override) && (expandedCodes.size === 0 || this.resolutionConfig.serverDelegation?.validateCodes)) {
        logger.debug(`[ValueSetValidator] Code not found in local expansion for ${valueSetUrl}. Attempting server $validate-code...`);
        const isValidOnServer = await this.validateCodeViaTerminologyServer(
          code,
          system,
          valueSetUrl,
          undefined,
          override,
          fhirVersion,
        );
        if (isValidOnServer) {
          return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
        }
      }

      const filteredIncludes = await this.packageLoader.getIncludeConceptFilters(valueSetUrl, fhirVersion);
      if (this.hasUnsupportedFilterForSystem(filteredIncludes, system)) {
        logger.debug(
          `[ValueSetValidator] Unsupported include filter in ${valueSetUrl} ` +
          `for '${system ? `${system}|` : ''}${code}' – direct ValueSet membership cannot be verified locally`,
        );
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      }
      if (this.isUnresolvableSnomedExtensionFilterCode(system, code, filteredIncludes)) {
        logger.debug(
          `[ValueSetValidator] SNOMED national-extension code '${code}' in filtered ` +
          `${valueSetUrl} cannot be subsumed by an International Edition terminology server – failing open`,
        );
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      }

      return this.finishTwoPhaseLookup(twoPhaseLookup, false, { code, system, valueSetUrl });

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[ValueSetValidator] Could not validate code against ${valueSetUrl}:`, err.message);
      return true; // Fail open
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    clearValidateCodeCache();
    clearCodeSystemValidateCodeCache();
    clearSubsumesCache();
    this.twoPhaseExpansion.clear();
    logger.debug('[ValueSetValidator] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    valueSetCount: number;
    codeSystemCount: number;
    validateCodeResultCount: number;
    subsumesResultCount: number;
    twoPhaseExpansion?: {
      lookups: number;
      hits: number;
      misses: number;
      unknown: number;
      mismatches: number;
      enforced: number;
    };
  } {
    const stats = this.cache.getStats();
    return {
      valueSetCount: stats.valueSetCount,
      codeSystemCount: stats.codeSystemCount,
      validateCodeResultCount: getValidateCodeCacheSize(),
      subsumesResultCount: getSubsumesCacheSize(),
      twoPhaseExpansion: { ...this.twoPhaseStats },
    };
  }

  /**
   * Preload common value sets
   */
  async preloadCommonValueSets(): Promise<void> {
    logger.info('[ValueSetValidator] Preloading common value sets...');

    const commonValueSets = Object.keys(KNOWN_VALUE_SET_EXPANSIONS);

    for (const vsUrl of commonValueSets) {
      await this.getExpandedValueSet(vsUrl);
    }

    logger.info(`[ValueSetValidator] Preloaded ${commonValueSets.length} common value sets`);
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Tri-state code-vs-binding check. `valid`/`invalid` are authoritative;
   * `unverified` means the code is not known to be wrong but could not be
   * confirmed (no local expansion, terminology-server-only filters, or empty
   * expansion). Callers fail open on `unverified` but may surface it as an
   * informational issue (gap P-3).
   */
  private async resolveCodeBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<CodeBindingOutcome> {
    if (isLanguageBinding(valueSetUrl, system)) {
      return validateBCP47(code) ? 'valid' : 'invalid';
    }

    const twoPhaseLookup = await this.lookupTwoPhaseExpansion(code, system, valueSetUrl, fhirVersion);
    const enforcedTwoPhaseResult = this.getEnforcedTwoPhaseResult(twoPhaseLookup);
    if (enforcedTwoPhaseResult !== undefined) {
      return this.finishTwoPhaseLookup(twoPhaseLookup, enforcedTwoPhaseResult, { code, system, valueSetUrl })
        ? 'valid' : 'invalid';
    }

    const expandedCodes = await this.getExpandedValueSet(valueSetUrl, fhirVersion);

    const fullCode = system ? `${system}|${code}` : code;

    // Strict matching for required bindings when system is provided
    if (bindingStrength === 'required' && system) {
      if (expandedCodes.has(fullCode)) {
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl }) ? 'valid' : 'invalid';
      }
      logger.debug(`[ValueSetValidator] Required binding: system|code '${fullCode}' not in expansion.`);
    } else {
      const isInExpansion = expandedCodes.has(fullCode) || expandedCodes.has(code);
      if (isInExpansion) {
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl }) ? 'valid' : 'invalid';
      }
    }

    // For required bindings, a non-empty local expansion is authoritative.
    // Do not let terminology-server fail-open behavior turn a known invalid
    // primitive/status code back into a valid result.
    const filteredIncludes = await this.packageLoader.getIncludeConceptFilters(valueSetUrl, fhirVersion);
    const hasServerEvaluatedFilters = filteredIncludes.length > 0;
    const override = this.resolveServerForSystem(system);
    const shouldDelegateToServer =
      expandedCodes.size === 0 ||
      hasServerEvaluatedFilters ||
      (bindingStrength !== 'required' && this.resolutionConfig.serverDelegation?.validateCodes);

    if (this.hasTerminologyServer(override) && shouldDelegateToServer) {
      logger.debug(`[ValueSetValidator] Code not found in local expansion for ${valueSetUrl}. Attempting server $validate-code...`);
      const isValidOnServer = await this.validateCodeViaTerminologyServer(
        code,
        system,
        valueSetUrl,
        bindingStrength,
        override,
        fhirVersion,
      );
      if (isValidOnServer) {
        return this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl }) ? 'valid' : 'invalid';
      }
    }

    // Some IG ValueSets include terminology-server-only filters such as
    // LOINC CLASSTYPE. Without the CodeSystem's filter metadata, a local
    // package expansion is necessarily incomplete. If the remote server also
    // cannot confirm a non-required binding, report "not verified" rather
    // than a false-positive binding warning.
    if (
      bindingStrength !== 'required'
      && this.hasUnsupportedFilterForSystem(filteredIncludes, system)
    ) {
      logger.debug(
        `[ValueSetValidator] Unsupported include filter in ${valueSetUrl} ` +
        `for '${system ? `${system}|` : ''}${code}' – skipping non-required binding check`,
      );
      this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      return 'unverified';
    }
    if (
      bindingStrength !== 'required'
      && this.isUnresolvableSnomedExtensionFilterCode(system, code, filteredIncludes)
    ) {
      logger.debug(
        `[ValueSetValidator] SNOMED national-extension code '${code}' in filtered ` +
        `${valueSetUrl} cannot be subsumed by an International Edition terminology server – skipping non-required binding check`,
      );
      this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      return 'unverified';
    }

    // ValueSet could not be expanded (e.g., German content not available on public servers).
    // Treat as "cannot verify" rather than "definitely invalid" – avoids false positives
    // when terminology servers simply don't carry the relevant content.
    if (expandedCodes.size === 0) {
      logger.debug(`[ValueSetValidator] Empty expansion for ${valueSetUrl} – skipping binding check for '${code}'`);
      this.finishTwoPhaseLookup(twoPhaseLookup, true, { code, system, valueSetUrl });
      return 'unverified';
    }

    return this.finishTwoPhaseLookup(twoPhaseLookup, false, { code, system, valueSetUrl }) ? 'valid' : 'invalid';
  }

  private async isCodeInValueSetStrict(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    // Fail open on `unverified` to preserve the established precision contract.
    return (await this.resolveCodeBinding(code, system, valueSetUrl, bindingStrength, fhirVersion)) !== 'invalid';
  }

  private async getExpandedValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<Set<string>> {
    // Check cache first
    const cacheKey = this.getExpansionCacheKey(valueSetUrl, fhirVersion);
    const cached = this.cache.getExpandedCodes(cacheKey);
    if (cached) {
      return cached;
    }

    const baseUrl = valueSetUrl.split('|')[0];
    const expandedCodes = new Set<string>();
    const strategy = this.resolutionConfig.strategy;

    try {
      if (strategy === 'server-first') {
        const serverExpansion = await this.apiClient.expandValueSet(baseUrl);
        if (serverExpansion && serverExpansion.size > 0) {
          serverExpansion.forEach(code => expandedCodes.add(code));
          this.cache.setExpandedCodes(cacheKey, expandedCodes);
          logger.debug(`[ValueSetValidator] Server-First: Expanded ${valueSetUrl} with ${expandedCodes.size} codes from server`);
          return expandedCodes;
        }
        logger.debug(`[ValueSetValidator] Server-First: Server failed, falling back to local for ${valueSetUrl}`);
      }

      // 1. Try known expansions
      const knownExpansion = KNOWN_VALUE_SET_EXPANSIONS[baseUrl];
      if (knownExpansion) {
        knownExpansion.forEach(code => expandedCodes.add(code));
        this.cache.setExpandedCodes(cacheKey, expandedCodes);
        return expandedCodes;
      }

      // 2. Try local packages (pass full URL with version for version-aware loading)
      const packageExpansion = await this.packageLoader.loadValueSet(valueSetUrl, fhirVersion);
      if (packageExpansion && packageExpansion.length > 0) {
        packageExpansion.forEach(code => expandedCodes.add(code));
        this.cache.setExpandedCodes(cacheKey, expandedCodes);
        return expandedCodes;
      }

      // 3. Local-First only: Try server as fallback
      if (strategy === 'local-first') {
        const serverExpansion = await this.apiClient.expandValueSet(baseUrl);
        if (serverExpansion && serverExpansion.size > 0) {
          serverExpansion.forEach(code => expandedCodes.add(code));
          this.cache.setExpandedCodes(cacheKey, expandedCodes);
          logger.debug(`[ValueSetValidator] Local-First: Used server fallback for ${valueSetUrl}, got ${expandedCodes.size} codes`);
          return expandedCodes;
        }
      }

      logger.debug(`[ValueSetValidator] ValueSet ${valueSetUrl} not found (strategy: ${strategy})`);

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[ValueSetValidator] Failed to expand ${valueSetUrl}:`, err.message);
    }

    // Cache even if empty
    this.cache.setExpandedCodes(cacheKey, expandedCodes);
    return expandedCodes;
  }

}

function isDisplayMismatchResult(result: CodeSystemValidationResult): boolean {
  return result.reason === 'display-mismatch'
    || Boolean(result.issues?.some(issue => issue.code === 'invalid-display'));
}

function extractExpectedDisplaysFromMessage(message: string | undefined): string[] {
  if (!message) return [];

  const validDisplayIndex = message.toLocaleLowerCase().indexOf('valid display');
  if (validDisplayIndex < 0) return [];

  const validDisplayClause = message.slice(validDisplayIndex);
  return [...validDisplayClause.matchAll(/'([^']+)'/g)]
    .map(match => match[1])
    .filter((display): display is string => Boolean(display?.trim()));
}

function isInactiveResult(result: CodeSystemValidationResult): boolean {
  return result.inactive === true
    || Boolean(result.issues?.some(isInactiveIssue));
}

function isInactiveIssue(issue: { message?: string }): boolean {
  return /inactive/i.test(issue.message ?? '');
}
