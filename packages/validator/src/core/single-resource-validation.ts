import { universalConstraintsValidator } from '../validators/universal-constraints-validator.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { BestPracticeValidator, validateBestPractices } from '../validators/best-practice-validator.js';
import {
  applyCodeInferredProfileAttribution,
  createCodeInferredProfileSignpostIssue,
} from './code-inferred-profile-attribution.js';
import type { CodeInferredProfileMatch } from './code-inferred-profiles.js';
import {
  applyDeclaredProfileAttribution,
  resolveDeclaredProfileSubstitution,
} from './declared-profile-attribution.js';
import {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors/index.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { runAllAspectValidations } from './validation-orchestrator.js';
import { aggregateRemoteCodeSystemBudgetIssues, dedupeIssues, suppressRedundantBindingWarnings } from './validation-utils.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { TerminologyResourceValidator } from '../validators/terminology-resource-validator.js';
import type { FhirResource } from './fhir-resource.js';
import {
  shouldRunCustomRules,
  shouldValidateBestPractices,
  shouldValidateBundleEntryResources,
} from './validation-settings-predicates.js';

export interface SingleResourceValidationInput {
  resource: FhirResource;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  settings?: ValidationSettings;
  profileFallbackIssue?: ValidationIssue | null;
  codeInferredProfile?: CodeInferredProfileMatch | null;
  contextQuestionnaire?: unknown;
  referenceResolver?: ReferenceResolver | null;
  organizationId?: number;
  serverId?: number;
}

export interface SingleResourceValidationDeps {
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  referenceExecutor: ReferenceExecutor;
  bestPracticeValidator: BestPracticeValidator;
  terminologyResourceValidator: TerminologyResourceValidator;
  validateBundleEntriesIfNeeded(resource: FhirResource, fhirVersion: 'R4' | 'R5' | 'R6'): Promise<ValidationIssue[]>;
}

export async function collectSingleResourceValidationIssues(
  input: SingleResourceValidationInput,
  deps: SingleResourceValidationDeps,
): Promise<ValidationIssue[]> {
  const aspectIssues = await runAllAspectValidations(
    {
      resource: input.resource,
      resourceType: input.resource.resourceType,
      profileUrl: input.profileUrl,
      fhirVersion: input.fhirVersion,
      structureDef: input.structureDef,
      strictMode: input.strictMode,
      settings: input.settings,
      contextQuestionnaire: input.contextQuestionnaire,
      referenceResolver: input.referenceResolver,
      organizationId: input.organizationId,
      serverId: input.serverId,
    },
    deps.structuralExecutor,
    deps.profileExecutor,
    deps.terminologyExecutor,
    deps.invariantExecutor,
    deps.customRuleExecutor,
    deps.metadataExecutor,
    deps.referenceExecutor,
    deps.terminologyResourceValidator,
  );
  const attributedAspectIssues = attributeSubstitutedProfileIssues(aspectIssues, input);

  // ele-1 is registered in invariant-registry.ts as owned by
  // universal-constraints-validator.ts, and the FHIRPath plan builders skip it
  // on that basis. The owner was only wired into the multi-aspect path, so on
  // this path — the one validate() takes — nobody evaluated ele-1 at all.
  // Only the element half is wired in: the reference aspect above already
  // reports ref-1 and the reference-format rules, so the ref-1 half of
  // universalConstraintsValidator.validate() would double-report them.
  const universalConstraintIssues = universalConstraintsValidator.validateElementConstraints(
    input.resource,
  );

  const bestPracticeIssues = validateBestPractices(deps.bestPracticeValidator, {
    resource: input.resource,
    resourceType: input.resource.resourceType,
    profileUrl: input.profileUrl,
  }, input.settings);

  const bundleEntryIssues = shouldValidateBundleEntryResources(input.settings)
    ? await deps.validateBundleEntriesIfNeeded(input.resource, input.fhirVersion)
    : [];

  return aggregateRemoteCodeSystemBudgetIssues(suppressRedundantBindingWarnings(dedupeIssues([
    ...(input.profileFallbackIssue ? [input.profileFallbackIssue] : []),
    ...attributedAspectIssues,
    ...universalConstraintIssues,
    ...bestPracticeIssues,
    ...bundleEntryIssues,
  ])));
}

/**
 * Constraint failures produced by a silently substituted profile SD must not
 * read as base-spec claims. Code-inferred substitutions relabel to the profile
 * aspect and lead with the HL7-style signpost naming the profile and the
 * triggering code; declared meta.profile substitutions relabel only the
 * provably profile-tightened findings and need no signpost — the user declared
 * the profile. A fallback issue means the base SD validated after all, so the
 * declared profile must not claim those findings.
 */
function attributeSubstitutedProfileIssues(
  aspectIssues: ValidationIssue[],
  input: SingleResourceValidationInput,
): ValidationIssue[] {
  const profileAspectEnabled = input.settings?.aspects?.profile?.enabled !== false;
  if (!profileAspectEnabled) return aspectIssues;
  if (input.codeInferredProfile) {
    return [
      createCodeInferredProfileSignpostIssue(input.codeInferredProfile),
      ...applyCodeInferredProfileAttribution(aspectIssues, input.codeInferredProfile),
    ];
  }
  if (input.profileFallbackIssue) return aspectIssues;
  const declaredProfileUrl = resolveDeclaredProfileSubstitution(input.resource, input.profileUrl);
  return declaredProfileUrl
    ? applyDeclaredProfileAttribution(aspectIssues, declaredProfileUrl, input.structureDef)
    : aspectIssues;
}

export {
  shouldRunCustomRules,
  shouldValidateBestPractices,
  shouldValidateBundleEntryResources,
};
