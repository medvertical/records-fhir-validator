import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { ReferenceTargetValidator } from '../validators/reference-target-validator.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { ProfileConformanceCheck } from '../validators/sd-fhirpath-profile-conformance.js';
import type { FhirResource } from './fhir-resource.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import { MultiAspectValidationSession } from './multi-aspect-validation-session.js';
import { loadExtensionTargetDefinition, targetProfileResolver, validateReferenceTargetProfileConformance } from './multi-aspect-target-profile-conformance.js';
import type { StructureDefinition } from './structure-definition-types.js';

export interface SingleResourceConformanceInput {
  resource: FhirResource;
  structureDef: StructureDefinition;
  fhirVersion: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
  organizationId?: number;
  serverId?: number;
  referenceResolver?: ReferenceResolver | null;
  localReferenceResolver?: ReferenceResolver | null;
  enclosingBundle?: Record<string, unknown>;
  containingResource?: Record<string, unknown>;
}

export interface SingleResourceProfileConformance {
  profileConformance?: ProfileConformanceCheck;
  validateReferenceTargets(): Promise<ValidationIssue[]>;
  takeIncompleteIssues(): ValidationIssue[];
}

/** Recursive conformance needs raw and governed receipts from the same session policy as batch validation. */
export type SingleResourceConformanceFactory = (
  input: SingleResourceConformanceInput, recursionDepth: number,
) => SingleResourceProfileConformance;

export function createSingleResourceConformanceSession(
  deps: MultiAspectDeps,
  input: Pick<SingleResourceConformanceInput, 'settings' | 'organizationId' | 'serverId' | 'referenceResolver'>,
): SingleResourceConformanceFactory {
  const aspects = (['structural', 'profile', 'terminology', 'invariant', 'reference', 'custom_rule', 'metadata'] as const)
    .filter(aspect => input.settings?.aspects?.[aspect]?.enabled !== false);
  const session = new MultiAspectValidationSession({
    deps, aspects, settings: input.settings, organizationId: input.organizationId,
    serverId: input.serverId, externalReferenceResolver: input.referenceResolver ?? undefined,
  });
  const referenceTargetValidator = new ReferenceTargetValidator();
  return (scope, recursionDepth) => {
    const incompleteIssues: ValidationIssue[] = [];
    const profileConformance = session.createProfileConformanceCheck({
      referencingProfile: scope.structureDef, fhirVersion: scope.fhirVersion, recursionDepth,
      enclosingBundle: scope.enclosingBundle, containingResource: scope.containingResource ?? scope.resource,
      onIncomplete: issue => incompleteIssues.push(issue),
    });
    return {
      profileConformance,
      takeIncompleteIssues: () => incompleteIssues.splice(0),
      validateReferenceTargets: () => validateReferenceTargetProfileConformance({
        resource: scope.resource, structureDef: scope.structureDef, referenceTargetValidator,
        resolveReference: targetProfileResolver(input.settings, {
          local: scope.localReferenceResolver, all: scope.referenceResolver,
        }),
        conformsTo: profileConformance,
        onIncomplete: issue => incompleteIssues.push(issue),
        loadReferenceTargetDefinition: (url, source) => deps.sdLoader.loadReferencedProfile(url, source, scope.fhirVersion),
        loadExtensionDefinition: url => loadExtensionTargetDefinition(deps.sdLoader, deps.snapshotGenerator, url, scope.structureDef, scope.fhirVersion),
        pinExtensionProfile: (url, definition) => deps.sdLoader.referencedProfileUrl(url, definition, scope.fhirVersion),
      }),
    };
  };
}
