/**
 * Profile Executor
 *
 * Validates FHIR profile conformance:
 * - StructureDefinition conformance
 * - Extension validation
 * - Slicing validation
 * - Profile constraint validation
 * - Deep element conformance (fixed/pattern/cardinality against the snapshot)
 * - StructureDefinition FHIRPath constraints
 *
 * Every profile-aspect validator is wired here rather than at a fan-out call
 * site, so each fan-out path inherits the same rule set from one place.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../structure-definition-types.js';
import type { ExtensionValidator } from '../../validators/extension-validator.js';
import type { SlicingValidator, ReferenceResolver } from '../../validators/slicing-validator.js';
import type { ConstraintValidator } from '../../validators/constraint-validator.js';
import { GermanIdentifierValidator } from '../../validators/german-identifier-validator.js';
import { GermanExtensionValidator } from '../../validators/german-extension-validator.js';
import { deepProfileValidator } from '../../validators/deep-profile-validator.js';
import { SDFHIRPathExecutor } from '../../validators/sd-fhirpath-executor.js';
import type { FHIRPathTerminologyResolver } from '../../validators/fhirpath-async-terminology.js';
import {
  precomputeProfileConformance,
  type ProfileConformanceCheck,
  type ProfileConformanceLookup,
} from '../../validators/sd-fhirpath-profile-conformance.js';
import { logger } from '../../logger.js';
import { createExecutorFailureIssue } from './executor-failure-issue.js';
import { ProfileSlicingValidation } from './profile-slicing-validation.js';
import { profileCanonicalAliasIssue } from '../profile-canonical-alias.js';
import { profileForConcreteResource } from '../profile-resource-type.js';
import { profileCanonicalMetadata } from '../../utils/sensitive-logging-metadata.js';

// ============================================================================
// Types
// ============================================================================

export interface ProfileValidationContext {
  resource: unknown;
  resourceType: string;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  getValueAtPath: (resource: unknown, path: string) => unknown;
  referenceResolver?: ReferenceResolver | null;
  enclosingBundle?: Record<string, unknown>;
  /**
   * Callers that own a warmed executor pass it in so its expression and
   * terminology caches stay shared; otherwise the executor's own is used.
   */
  sdFHIRPathExecutor?: SDFHIRPathExecutor;
  terminologyResolver?: FHIRPathTerminologyResolver;
  profileConformance?: ProfileConformanceCheck;
}

// ============================================================================
// Profile Executor
// ============================================================================

export class ProfileExecutor {
  private extensionValidator: ExtensionValidator;
  private profileSlicingValidation: ProfileSlicingValidation;
  private constraintValidator: ConstraintValidator;
  private germanIdentifierValidator: GermanIdentifierValidator;
  private germanExtensionValidator: GermanExtensionValidator;
  private readonly ownSDFHIRPathExecutor = new SDFHIRPathExecutor();

  constructor(
    extensionValidator: ExtensionValidator,
    slicingValidator: SlicingValidator,
    constraintValidator: ConstraintValidator
  ) {
    this.extensionValidator = extensionValidator;
    this.profileSlicingValidation = new ProfileSlicingValidation(slicingValidator);
    this.constraintValidator = constraintValidator;
    this.germanIdentifierValidator = new GermanIdentifierValidator();
    this.germanExtensionValidator = new GermanExtensionValidator();
  }

  /**
   * Validate profile conformance aspects
   */
  async validate(
    context: ProfileValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    let profileConformance: ProfileConformanceLookup | undefined;
    let conformanceChecks = 0;
    let conformanceCheckMs = 0;
    const underlyingCheck = context.profileConformance;
    const conformanceCheck: ProfileConformanceCheck | undefined = underlyingCheck && (async (...args) => {
      const tick = performance.now();
      conformanceChecks++;
      try { return await underlyingCheck(...args); }
      finally { conformanceCheckMs += performance.now() - tick; }
    });
    const startedAt = performance.now();
    let phaseStartedAt = startedAt;
    let phase = 'extensions';
    const phases: Record<string, number> = {};
    const finishPhase = (nextPhase: string) => {
      const now = performance.now();
      phases[phase] = now - phaseStartedAt;
      phase = nextPhase;
      phaseStartedAt = now;
    };

    try {
      const { resource, profileUrl, fhirVersion, strictMode, getValueAtPath, referenceResolver, enclosingBundle } = context;
      const structureDef = profileForConcreteResource(context.structureDef, context.resourceType, fhirVersion);
      const effectiveContext = structureDef === context.structureDef ? context : { ...context, structureDef };
      this.profileSlicingValidation.setMustSupportSeverity(
        strictMode ? 'warning' : 'information',
      );

      // 1. Validate extensions
      const extensionIssues = await this.extensionValidator.validateExtensions(
        resource,
        structureDef,
        {
          resource,
          profileSD: structureDef,
          strictMode,
          fhirVersion,
          profileUrl,
          getValueAtPath,
          referenceResolver,
          profileConformance: conformanceCheck,
        }
      );
      finishPhase('slicing');

      // 2. Validate slicing (check for sliced elements like Patient.identifier)
      if (structureDef.snapshot?.element) {
        issues.push(...await this.profileSlicingValidation.validate({
          extensionIssues,
          resource,
          structureDef,
          getValueAtPath,
          referenceResolver,
          fhirVersion,
          profileConformance: conformanceCheck,
        }));
        finishPhase('conformance');

        // 3. Validate FHIRPath constraints
        // Using snapshot elements which contain the constraints
        profileConformance = conformanceCheck
          ? await precomputeProfileConformance(structureDef.snapshot.element, resource, conformanceCheck)
          : undefined;
        finishPhase('constraints');
        const constraintIssues = await this.constraintValidator.validate(
          resource,
          structureDef.snapshot.element,
          profileUrl,
          { strictMode, fhirVersion, bundle: enclosingBundle, profileConformance, referenceResolver },
        );
        issues.push(...constraintIssues);
        finishPhase('identifiers');
      } else {
        issues.push(...extensionIssues);
        finishPhase('identifiers');
      }

      // 4. Validate German identifier systems (GKV/PKV assigner validation)
      if (this.germanIdentifierValidator.isGermanProfile(profileUrl)) {
        const germanIdIssues = this.germanIdentifierValidator.validateIdentifiers(
          resource,
          profileUrl
        );
        issues.push(...germanIdIssues);

        // 5. Validate German extension requirements (gender extension for "other")
        const germanExtIssues = this.germanExtensionValidator.validateExtensions(
          resource,
          profileUrl
        );
        issues.push(...germanExtIssues);
      }

      const aliasIssue = profileCanonicalAliasIssue(resource, context.resourceType, profileUrl, structureDef);
      if (aliasIssue) issues.push(aliasIssue);
      finishPhase('deepConformance');

      issues.push(...deepProfileValidator.validate({
        resource,
        resourceType: context.resourceType,
        structureDef,
        profileUrl,
      }));
      finishPhase('snapshotFHIRPath');
      issues.push(...await this.runSnapshotFHIRPathConstraints(effectiveContext, profileConformance));
      finishPhase('completed');

      return issues;

    } catch {
      logger.error('[ProfileExecutor] Validation failed');
      return [createExecutorFailureIssue('profile', 'Profile')];
    } finally {
      const totalMs = performance.now() - startedAt;
      if (phase !== 'completed') phases[phase] = performance.now() - phaseStartedAt;
      const metadata = { ...profileCanonicalMetadata(context.profileUrl), totalMs, phases,
        conformance: { checks: conformanceChecks, elapsedMs: conformanceCheckMs },
        outcome: phase === 'completed' ? 'completed' : 'failed' };
      if (totalMs >= 500) logger.warn('[ProfileExecutor] Phase timings', metadata);
      else logger.debug('[ProfileExecutor] Phase timings', metadata);
    }
  }

  private runSnapshotFHIRPathConstraints(
    context: ProfileValidationContext,
    profileConformance: ProfileConformanceLookup | undefined,
  ): Promise<ValidationIssue[]> {
    const executor = context.sdFHIRPathExecutor ?? this.ownSDFHIRPathExecutor;
    return executor.execute({
      resource: context.resource,
      resourceType: context.resourceType,
      structureDef: context.structureDef,
      bundle: context.enclosingBundle
        ?? (context.resourceType === 'Bundle'
          ? (context.resource as Record<string, unknown>)
          : undefined),
      fhirVersion: context.fhirVersion,
      terminologyResolver: context.terminologyResolver,
      profileConformance,
      referenceResolver: context.referenceResolver,
    });
  }
}
