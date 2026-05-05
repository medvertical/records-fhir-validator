/**
 * ValueSet Validator
 * 
 * Validates coded elements against FHIR ValueSets:
 * - Required bindings (ERROR if code not in value set)
 * - Extensible bindings (WARNING if code not in value set)
 * - Preferred bindings (INFORMATION if code not in value set)
 * - Example bindings (no validation)
 * 
 * Refactored for modularity - delegates to:
 * - ValueSetCache: Caching layer
 * - TerminologyApiClient: Remote terminology server operations
 * - ValueSetPackageLoader: Local package loading
 */

import type { ValidationIssue } from '../types';
import type { Binding } from '../core/structure-definition-types';
import { createBindingViolation, createValidationIssue } from '../issues';
import { logger } from '../logger';

// Import modular components
import type {
  CodeSystemConcept,
  TerminologyResolutionConfig
} from './valueset-types';
import {
  DEFAULT_RESOLUTION_CONFIG,
  isExternalCodeSystem,
  EXTERNAL_CODE_SYSTEMS
} from './valueset-types';
import { ValueSetCache, valueSetCache } from './valueset-cache';
import { TerminologyApiClient } from './terminology-api-client';
import { ValueSetPackageLoader } from './valueset-package-loader';

// Re-export types for backwards compatibility
export type { TerminologyResolutionStrategy, TerminologyResolutionConfig, ValueSet, CodeSystem } from './valueset-types';

// ============================================================================
// Known ValueSet Expansions (Common FHIR R4 ValueSets)
// ============================================================================

const KNOWN_VALUE_SET_EXPANSIONS: Record<string, string[]> = {
  // Administrative Gender
  'http://hl7.org/fhir/ValueSet/administrative-gender': [
    'http://hl7.org/fhir/administrative-gender|male',
    'http://hl7.org/fhir/administrative-gender|female',
    'http://hl7.org/fhir/administrative-gender|other',
    'http://hl7.org/fhir/administrative-gender|unknown',
    'male', 'female', 'other', 'unknown'
  ],

  // Name Use
  'http://hl7.org/fhir/ValueSet/name-use': [
    'http://hl7.org/fhir/name-use|usual',
    'http://hl7.org/fhir/name-use|official',
    'http://hl7.org/fhir/name-use|temp',
    'http://hl7.org/fhir/name-use|nickname',
    'http://hl7.org/fhir/name-use|anonymous',
    'http://hl7.org/fhir/name-use|old',
    'http://hl7.org/fhir/name-use|maiden',
    'usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden'
  ],

  // Identifier Use
  'http://hl7.org/fhir/ValueSet/identifier-use': [
    'http://hl7.org/fhir/identifier-use|usual',
    'http://hl7.org/fhir/identifier-use|official',
    'http://hl7.org/fhir/identifier-use|temp',
    'http://hl7.org/fhir/identifier-use|secondary',
    'http://hl7.org/fhir/identifier-use|old',
    'usual', 'official', 'temp', 'secondary', 'old'
  ],

  // Contact Point System
  'http://hl7.org/fhir/ValueSet/contact-point-system': [
    'http://hl7.org/fhir/contact-point-system|phone',
    'http://hl7.org/fhir/contact-point-system|fax',
    'http://hl7.org/fhir/contact-point-system|email',
    'http://hl7.org/fhir/contact-point-system|pager',
    'http://hl7.org/fhir/contact-point-system|url',
    'http://hl7.org/fhir/contact-point-system|sms',
    'http://hl7.org/fhir/contact-point-system|other',
    'phone', 'fax', 'email', 'pager', 'url', 'sms', 'other'
  ],

  // Contact Point Use
  'http://hl7.org/fhir/ValueSet/contact-point-use': [
    'http://hl7.org/fhir/contact-point-use|home',
    'http://hl7.org/fhir/contact-point-use|work',
    'http://hl7.org/fhir/contact-point-use|temp',
    'http://hl7.org/fhir/contact-point-use|old',
    'http://hl7.org/fhir/contact-point-use|mobile',
    'home', 'work', 'temp', 'old', 'mobile'
  ],

  // Device Name Type
  'http://hl7.org/fhir/ValueSet/device-nametype': [
    'http://hl7.org/fhir/device-nametype|udi-label-name',
    'http://hl7.org/fhir/device-nametype|user-friendly-name',
    'http://hl7.org/fhir/device-nametype|patient-reported-name',
    'http://hl7.org/fhir/device-nametype|manufacturer-name',
    'http://hl7.org/fhir/device-nametype|model-name',
    'http://hl7.org/fhir/device-nametype|other',
    'udi-label-name', 'user-friendly-name', 'patient-reported-name',
    'manufacturer-name', 'model-name', 'other'
  ],

  // Observation Status
  'http://hl7.org/fhir/ValueSet/observation-status': [
    'http://hl7.org/fhir/observation-status|registered',
    'http://hl7.org/fhir/observation-status|preliminary',
    'http://hl7.org/fhir/observation-status|final',
    'http://hl7.org/fhir/observation-status|amended',
    'http://hl7.org/fhir/observation-status|corrected',
    'http://hl7.org/fhir/observation-status|cancelled',
    'http://hl7.org/fhir/observation-status|entered-in-error',
    'http://hl7.org/fhir/observation-status|unknown',
    'registered', 'preliminary', 'final', 'amended', 'corrected',
    'cancelled', 'entered-in-error', 'unknown'
  ],

  // Address Use
  'http://hl7.org/fhir/ValueSet/address-use': [
    'http://hl7.org/fhir/address-use|home',
    'http://hl7.org/fhir/address-use|work',
    'http://hl7.org/fhir/address-use|temp',
    'http://hl7.org/fhir/address-use|old',
    'http://hl7.org/fhir/address-use|billing',
    'home', 'work', 'temp', 'old', 'billing'
  ],

  // Address Type
  'http://hl7.org/fhir/ValueSet/address-type': [
    'http://hl7.org/fhir/address-type|postal',
    'http://hl7.org/fhir/address-type|physical',
    'http://hl7.org/fhir/address-type|both',
    'postal', 'physical', 'both'
  ]
};

// ============================================================================
// ValueSet Validator
// ============================================================================

export class ValueSetValidator {
  private resolutionConfig: TerminologyResolutionConfig;
  private cache: ValueSetCache;
  private apiClient: TerminologyApiClient;
  private packageLoader: ValueSetPackageLoader;

  // Expose static for backwards compatibility
  static readonly EXTERNAL_CODE_SYSTEMS = EXTERNAL_CODE_SYSTEMS;

  constructor() {
    this.resolutionConfig = { ...DEFAULT_RESOLUTION_CONFIG };
    this.cache = valueSetCache;
    this.apiClient = new TerminologyApiClient(this.resolutionConfig, this.cache);
    this.packageLoader = new ValueSetPackageLoader(this.cache);
  }

  /**
   * Configure the terminology resolution strategy
   */
  setResolutionConfig(config: Partial<TerminologyResolutionConfig>): void {
    this.resolutionConfig = { ...this.resolutionConfig, ...config };
    this.apiClient.setConfig(this.resolutionConfig);
    logger.info(`[ValueSetValidator] Resolution config updated: strategy=${this.resolutionConfig.strategy}`);
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

  /**
   * Scope-based routing: pick the best server for a given code system.
   *
   * If the active config has a server list (from settings), look for one
   * whose `preferredSystems` contains the queried system URL. If found,
   * return a per-call override with that server's URL + auth. Falls back
   * to `undefined` meaning "use the configured default serverUrl".
   *
   * This is the runtime half of the preferredSystems feature — the UI
   * configures it, the router accepts it, and this resolver ensures
   * every code lookup actually consults it.
   */
  private resolveServerForSystem(system?: string): { url: string; auth?: any } | undefined {
    if (!system) return undefined;
    const servers = this.resolutionConfig.servers;
    if (!servers || servers.length === 0) return undefined;

    const match = servers.find(s =>
      s.enabled
      && !s.circuitOpen
      && s.preferredSystems
      && s.preferredSystems.includes(system),
    );
    if (!match) return undefined;

    logger.debug(`[ValueSetValidator] Scope-routed ${system} → ${match.id} (${match.url})`);
    return {
      url: match.url,
      auth: match.authConfig,
    };
  }

  private hasTerminologyServer(override?: { url: string }): boolean {
    return Boolean(override?.url || this.resolutionConfig.serverUrl);
  }

  private async validateCodeViaTerminologyServer(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: 'required' | 'extensible' | 'preferred' | 'example' | undefined,
    override: { url: string; auth?: any } | undefined,
  ): Promise<boolean> {
    const isValidOnServer = await this.apiClient.validateCode(code, system, valueSetUrl, bindingStrength, override);
    if (isValidOnServer) {
      return true;
    }

    return this.validateCodeAgainstConceptFilters(code, system, valueSetUrl, override);
  }

  private async validateCodeAgainstConceptFilters(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    override: { url: string; auth?: any } | undefined,
  ): Promise<boolean> {
    if (!system || !this.hasTerminologyServer(override)) return false;

    const filters = await this.packageLoader.getIncludeConceptFilters(valueSetUrl);
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

  /**
   * Validate a coded element against its binding
   */
  async validateBinding(
    code: any,
    binding: Binding | undefined,
    elementPath: string,
    options?: {
      valueSetUrl?: string;
      profileUrl?: string;
    }
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!binding || !binding.valueSet) {
      return issues;
    }

    if (binding.strength === 'example') {
      return issues;
    }

    try {
      const codeInfo = this.extractCodeInfo(code);
      if (!codeInfo) {
        return issues;
      }

      const isValid = await this.isCodeValidForBinding(
        codeInfo.code,
        codeInfo.system,
        options?.valueSetUrl || binding.valueSet,
        binding.strength as 'required' | 'extensible' | 'preferred' | 'example'
      );

      const displayIssue = await this.validateDisplayMatchesCodeSystem(
        code,
        codeInfo,
        options?.valueSetUrl || binding.valueSet,
        elementPath,
        options?.profileUrl,
      );
      if (displayIssue) {
        issues.push(displayIssue);
      }

      if (!isValid && (binding.strength === 'required' || binding.strength === 'extensible' || binding.strength === 'preferred')) {
        issues.push(createBindingViolation({
          strength: binding.strength as 'required' | 'extensible' | 'preferred' | 'example',
          code: codeInfo.code,
          system: codeInfo.system,
          valueSet: binding.valueSet,
          path: elementPath,
          resourceType: 'Unknown',
          profile: options?.profileUrl,
        }));
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (binding.strength === 'required') {
        const codeInfo = this.extractCodeInfo(code);
        if (codeInfo) {
          logger.warn(`[ValueSetValidator] Required binding validation failed, treating as invalid: ${err.message}`);
          issues.push(createBindingViolation({
            strength: 'required',
            code: codeInfo.code,
            system: codeInfo.system,
            valueSet: binding.valueSet,
            path: elementPath,
            resourceType: 'Unknown',
            profile: options?.profileUrl,
          }));
        }
      } else {
        logger.warn('[ValueSetValidator] Error validating binding:', error);
      }
    }

    return issues;
  }

  private async validateDisplayMatchesCodeSystem(
    rawCode: any,
    codeInfo: { code: string; system?: string; display?: string },
    valueSetUrl: string,
    elementPath: string,
    profileUrl?: string,
  ): Promise<ValidationIssue | null> {
    if (!codeInfo.system || !codeInfo.display) return null;

    const expectedDisplay = await this.resolveExpectedDisplay(codeInfo, valueSetUrl);
    if (!expectedDisplay || expectedDisplay === codeInfo.display) return null;

    const displayPath = this.resolveDisplayPath(rawCode, elementPath);
    return createValidationIssue({
      code: 'terminology-display-mismatch',
      path: displayPath,
      resourceType: elementPath.split('.')[0] || 'Unknown',
      profile: profileUrl,
      customMessage:
        `Wrong Display Name '${codeInfo.display}' for ${codeInfo.system}#${codeInfo.code}. ` +
        `Valid display is '${expectedDisplay}'`,
      severityOverride: 'warning',
      aspectOverride: 'terminology',
    });
  }

  private async resolveExpectedDisplay(
    codeInfo: { code: string; system?: string; display?: string },
    valueSetUrl: string,
  ): Promise<string | null> {
    if (!codeInfo.system) return null;

    const valueSet = this.cache.getValueSetFile(valueSetUrl)
      ?? this.cache.getValueSetFile(valueSetUrl.split('|')[0]);
    const include = valueSet?.compose?.include?.find(entry =>
      entry.system === codeInfo.system
    );
    const cacheKey = include?.version ? `${codeInfo.system}|${include.version}` : codeInfo.system;
    let codeSystem = this.cache.getCodeSystem(cacheKey)
      ?? this.cache.getCodeSystemFile(cacheKey)
      ?? this.cache.getCodeSystem(codeInfo.system)
      ?? this.cache.getCodeSystemFile(codeInfo.system);
    if (!codeSystem) {
      codeSystem = await this.packageLoader.loadCodeSystem(
        codeInfo.system,
        undefined,
        include?.version,
      );
    }
    if (!codeSystem) return null;

    const concept = this.findCodeSystemConcept(codeSystem.concept, codeInfo.code);
    return concept?.display ?? null;
  }

  private findCodeSystemConcept(
    concepts: CodeSystemConcept[] | undefined,
    code: string,
  ): CodeSystemConcept | null {
    if (!concepts) return null;
    for (const concept of concepts) {
      if (concept.code === code) return concept;
      const nested = this.findCodeSystemConcept(concept.concept, code);
      if (nested) return nested;
    }
    return null;
  }

  private resolveDisplayPath(rawCode: any, elementPath: string): string {
    if (rawCode?.coding && Array.isArray(rawCode.coding)) {
      return `${elementPath}.coding[0].display`;
    }
    return `${elementPath}.display`;
  }

  /**
   * Validate code with binding-strength awareness
   */
  async isCodeValidForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: 'required' | 'extensible' | 'preferred' | 'example'
  ): Promise<boolean> {
    try {
      return await this.isCodeInValueSetStrict(code, system, valueSetUrl, bindingStrength);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (bindingStrength === 'required') {
        logger.warn(`[ValueSetValidator] Required binding validation failed, treating as invalid: ${err.message}`);
        return false;
      }
      return true;
    }
  }

  /**
   * Validate a code directly against a CodeSystem using tx.fhir.org
   */
  async validateCodeInCodeSystem(
    code: string,
    system: string
  ): Promise<{ valid: boolean; message?: string }> {
    if (!this.isExternalCodeSystem(system)) {
      return { valid: true };
    }
    // Scope-based routing: if settings configure a server preferred for
    // this system, call THAT server instead of the default. Otherwise
    // pass undefined and the api client uses its default serverUrl.
    const override = this.resolveServerForSystem(system);
    return this.apiClient.validateCodeInCodeSystem(code, system, override);
  }

  /**
   * Check if a code is in a value set
   */
  async isCodeInValueSet(
    code: string,
    system: string | undefined,
    valueSetUrl: string
  ): Promise<boolean> {
    try {
      // BCP-47 Handling
      const isAllLanguages = valueSetUrl.includes('all-languages') || valueSetUrl === 'http://hl7.org/fhir/ValueSet/languages';
      const isBCP47System = system === 'urn:ietf:bcp:47';

      if (isAllLanguages || isBCP47System) {
        return this.validateBCP47(code);
      }

      const expandedCodes = await this.getExpandedValueSet(valueSetUrl);

      const fullCode = system ? `${system}|${code}` : code;
      const isInExpansion = expandedCodes.has(fullCode) || expandedCodes.has(code);

      if (isInExpansion) {
        return true;
      }

      // Try server validation as fallback
      const override = this.resolveServerForSystem(system);
      if (this.hasTerminologyServer(override) && (expandedCodes.size === 0 || this.resolutionConfig.serverDelegation?.validateCodes)) {
        logger.debug(`[ValueSetValidator] Code not found in local expansion for ${valueSetUrl}. Attempting server $validate-code...`);
        const isValidOnServer = await this.validateCodeViaTerminologyServer(code, system, valueSetUrl, undefined, override);
        if (isValidOnServer) {
          return true;
        }
      }

      return false;

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
    logger.debug('[ValueSetValidator] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { valueSetCount: number; codeSystemCount: number } {
    const stats = this.cache.getStats();
    return {
      valueSetCount: stats.valueSetCount,
      codeSystemCount: stats.codeSystemCount
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

  private async isCodeInValueSetStrict(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: 'required' | 'extensible' | 'preferred' | 'example'
  ): Promise<boolean> {
    // BCP-47 Handling
    const isAllLanguages = valueSetUrl.includes('all-languages') || valueSetUrl === 'http://hl7.org/fhir/ValueSet/languages';
    const isBCP47System = system === 'urn:ietf:bcp:47';

    if (isAllLanguages || isBCP47System) {
      return this.validateBCP47(code);
    }

    const expandedCodes = await this.getExpandedValueSet(valueSetUrl);

    const fullCode = system ? `${system}|${code}` : code;

    // Strict matching for required bindings when system is provided
    if (bindingStrength === 'required' && system) {
      if (expandedCodes.has(fullCode)) {
        return true;
      }
      logger.debug(`[ValueSetValidator] Required binding: system|code '${fullCode}' not in expansion.`);
    } else {
      const isInExpansion = expandedCodes.has(fullCode) || expandedCodes.has(code);
      if (isInExpansion) {
        return true;
      }
    }

    // For required bindings, a non-empty local expansion is authoritative.
    // Do not let terminology-server fail-open behavior turn a known invalid
    // primitive/status code back into a valid result.
    const filteredIncludes = await this.packageLoader.getIncludeConceptFilters(valueSetUrl);
    const hasServerEvaluatedFilters = filteredIncludes.length > 0;
    const override = this.resolveServerForSystem(system);
    const shouldDelegateToServer =
      expandedCodes.size === 0 ||
      hasServerEvaluatedFilters ||
      (bindingStrength !== 'required' && this.resolutionConfig.serverDelegation?.validateCodes);

    if (this.hasTerminologyServer(override) && shouldDelegateToServer) {
      logger.debug(`[ValueSetValidator] Code not found in local expansion for ${valueSetUrl}. Attempting server $validate-code...`);
      const isValidOnServer = await this.validateCodeViaTerminologyServer(code, system, valueSetUrl, bindingStrength, override);
      if (isValidOnServer) {
        return true;
      }
    }

    // ValueSet could not be expanded (e.g., German content not available on public servers).
    // Treat as "cannot verify" rather than "definitely invalid" – avoids false positives
    // when terminology servers simply don't carry the relevant content.
    if (expandedCodes.size === 0) {
      logger.debug(`[ValueSetValidator] Empty expansion for ${valueSetUrl} – skipping binding check for '${code}'`);
      return true;
    }

    return false;
  }

  private validateBCP47(code: string): boolean {
    return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(code);
  }

  private async getExpandedValueSet(valueSetUrl: string): Promise<Set<string>> {
    // Check cache first
    const cached = this.cache.getExpandedCodes(valueSetUrl);
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
          this.cache.setExpandedCodes(valueSetUrl, expandedCodes);
          logger.debug(`[ValueSetValidator] Server-First: Expanded ${valueSetUrl} with ${expandedCodes.size} codes from server`);
          return expandedCodes;
        }
        logger.debug(`[ValueSetValidator] Server-First: Server failed, falling back to local for ${valueSetUrl}`);
      }

      // 1. Try known expansions
      const knownExpansion = KNOWN_VALUE_SET_EXPANSIONS[baseUrl];
      if (knownExpansion) {
        knownExpansion.forEach(code => expandedCodes.add(code));
        this.cache.setExpandedCodes(valueSetUrl, expandedCodes);
        return expandedCodes;
      }

      // 2. Try local packages (pass full URL with version for version-aware loading)
      const packageExpansion = await this.packageLoader.loadValueSet(valueSetUrl);
      if (packageExpansion && packageExpansion.length > 0) {
        packageExpansion.forEach(code => expandedCodes.add(code));
        this.cache.setExpandedCodes(valueSetUrl, expandedCodes);
        return expandedCodes;
      }

      // 3. Local-First only: Try server as fallback
      if (strategy === 'local-first') {
        const serverExpansion = await this.apiClient.expandValueSet(baseUrl);
        if (serverExpansion && serverExpansion.size > 0) {
          serverExpansion.forEach(code => expandedCodes.add(code));
          this.cache.setExpandedCodes(valueSetUrl, expandedCodes);
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
    this.cache.setExpandedCodes(valueSetUrl, expandedCodes);
    return expandedCodes;
  }

  private extractCodeInfo(code: any): { code: string; system?: string; display?: string } | null {
    if (!code) return null;

    if (typeof code === 'string') {
      return { code };
    }

    if (code.code) {
      return {
        code: code.code,
        system: code.system,
        display: code.display
      };
    }

    if (code.coding && Array.isArray(code.coding) && code.coding.length > 0) {
      const firstCoding = code.coding[0];
      return {
        code: firstCoding.code,
        system: firstCoding.system,
        display: firstCoding.display
      };
    }

    return null;
  }
}
