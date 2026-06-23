import type { ValidationIssue } from '../types';
import type { Binding } from '../core/structure-definition-types';
import { createBindingViolation, createBindingUnverified } from '../issues';
import { logger } from '../logger';

import type { TerminologyResolutionConfig, CodeBindingOutcome } from './valueset-types';
import { extractCodeInfo, extractCodeInfos } from './valueset-code-info';
import {
  resourceTypeFromElementPath,
  type BindingStrength,
  type CodeInfo,
} from './valueset-display-utils';
import { type FhirVersion } from './valueset-expansion-cache-key';
import { validateDisplayMatchesCodeSystem } from './valueset-display-validator';
import type { ValueSetCache } from './valueset-cache';
import type { ValueSetPackageLoader } from './valueset-package-loader';

export type ValidateBindingOptions = {
  valueSetUrl?: string;
  profileUrl?: string;
  fhirVersion?: FhirVersion;
};

/**
 * Collaborators the binding-validation flow needs from ValueSetValidator,
 * passed explicitly so this module stays free of the validator's other state.
 */
export interface BindingValidationDeps {
  resolutionConfig: TerminologyResolutionConfig;
  cache: ValueSetCache;
  packageLoader: ValueSetPackageLoader;
  resolveCodeBindingForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<CodeBindingOutcome>;
}

/**
 * Validate a coded element against its binding.
 */
export async function validateBinding(
  deps: BindingValidationDeps,
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

    issues.push(...await validateExtractedCodeBindings(
      deps,
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

async function validateExtractedCodeBindings(
  deps: BindingValidationDeps,
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
    const outcome = await deps.resolveCodeBindingForBinding(
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

  const strictRequired = deps.resolutionConfig.strictUnverifiedRequiredBindings;
  if (
    (deps.resolutionConfig.reportUnverifiedBindings || strictRequired)
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

  issues.push(...await validateDisplaysForCodeInfos(
    deps,
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

async function validateDisplaysForCodeInfos(
  deps: BindingValidationDeps,
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
        cache: deps.cache,
        packageLoader: deps.packageLoader,
      },
    );
    if (displayIssue) {
      issues.push(displayIssue);
    }
  }
  return issues;
}
