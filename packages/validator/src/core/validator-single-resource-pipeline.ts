import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { BestPracticeValidator } from '../validators/best-practice-validator.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { TerminologyResourceValidator } from '../validators/terminology-resource-validator.js';
import type {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors/index.js';
import { isFhirResource, type FhirResource } from './fhir-resource.js';
import { mandatedProfileAdditions, mandatedProfileBeside } from './mandated-profile-pass.js';
import { combineReferenceResolvers, createBundleReferenceResolver,
  type BundleCanonicalResolver } from './multi-aspect-bundle-reference-resolver.js';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';
import {
  prepareSingleResourceProfile,
  type FhirClientLike,
} from './single-resource-profile-preparation.js';
import { collectSingleResourceValidationIssues } from './single-resource-validation.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import { createValidationErrorIssue, dedupeResourceTreeIssues } from './validation-utils.js';

export interface RecordsSingleResourceValidationInput {
  resource: unknown;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
  referenceResolver?: ReferenceResolver | null;
  bundleCanonicalResolver?: BundleCanonicalResolver | null;
  organizationId?: number;
  serverId?: number;
}

export interface RecordsSingleResourceValidationContext {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  referenceExecutor: ReferenceExecutor;
  bestPracticeValidator: BestPracticeValidator;
  terminologyResourceValidator: TerminologyResourceValidator;
  questionnaireRegistry?: QuestionnaireContextRegistry;
  strictMode: boolean;
  validateBundleEntriesIfNeeded(
    resource: FhirResource,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]>;
  validateContainedResourcesIfNeeded(resource: FhirResource): Promise<ValidationIssue[]>;
  validateParametersResourcesIfNeeded(resource: FhirResource): Promise<ValidationIssue[]>;
  validateAgainstProfile(
    resource: FhirResource,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]>;
}

export async function executeRecordsResourceValidation(
  input: RecordsSingleResourceValidationInput,
  context: RecordsSingleResourceValidationContext,
  startedAt: number,
): Promise<ValidationIssue[]> {
  const {
    resource,
    profileUrl,
    fhirVersion,
    settings,
    fhirClient,
    referenceResolver,
    bundleCanonicalResolver,
    organizationId,
    serverId,
  } = input;
  if (!isFhirResource(resource)) {
    return [createValidationErrorIssue(
      'structural',
      'missing-resourcetype',
      'Resource is missing resourceType field',
    )];
  }
  const profileSourceContext = { organizationId, serverId, fhirVersion };
  // Batch validation and bundle-entry recursion already resolve `#id` and
  // bundle-local references. A top-level single resource must not be the one
  // path where a resolve() discriminator counts its own contained targets as
  // unresolvable and the slicing goes unverified.
  const effectiveReferenceResolver = combineReferenceResolvers(
    createBundleReferenceResolver(
      resource.resourceType === 'Bundle' ? resource : undefined,
      resource,
    ),
    referenceResolver,
  );
  const {
    declaredProfileUrl,
    structureDef,
    profileFallbackIssue,
    codeInferredProfile,
    contextQuestionnaire,
  } = await prepareSingleResourceProfile(
    {
      resource,
      explicitProfileUrl: profileUrl,
      fhirVersion,
      settings,
      fhirClient,
      profileSourceContext,
      bundleCanonicalResolver,
    },
    {
      sdLoader: context.sdLoader,
      profileCache: context.profileCache,
      snapshotGenerator: context.snapshotGenerator,
      questionnaireRegistry: context.questionnaireRegistry,
    },
  );

  if (!structureDef) {
    return [createValidationErrorIssue(
      'profile',
      'profile-not-found',
      `Profile ${declaredProfileUrl} not found and base StructureDefinition for ${resource.resourceType} could not be loaded`,
      { profile: declaredProfileUrl },
      'meta.profile',
    )];
  }

  let issues = await collectSingleResourceValidationIssues(
    {
      resource,
      profileUrl: declaredProfileUrl,
      fhirVersion,
      structureDef,
      strictMode: context.strictMode,
      settings,
      profileFallbackIssue,
      codeInferredProfile,
      contextQuestionnaire,
      referenceResolver: effectiveReferenceResolver,
      organizationId,
      serverId,
    },
    {
      structuralExecutor: context.structuralExecutor,
      profileExecutor: context.profileExecutor,
      terminologyExecutor: context.terminologyExecutor,
      invariantExecutor: context.invariantExecutor,
      customRuleExecutor: context.customRuleExecutor,
      metadataExecutor: context.metadataExecutor,
      referenceExecutor: context.referenceExecutor,
      bestPracticeValidator: context.bestPracticeValidator,
      terminologyResourceValidator: context.terminologyResourceValidator,
      validateBundleEntriesIfNeeded: context.validateBundleEntriesIfNeeded,
    },
  );
  issues.push(...await context.validateContainedResourcesIfNeeded(resource));
  issues.push(...await context.validateParametersResourcesIfNeeded(resource));
  issues.push(...await collectMandatedProfileIssues(resource, declaredProfileUrl, fhirVersion, issues, context));
  // Contained resources are validated recursively after the parent issue
  // collection has already been deduplicated. Run the same canonical
  // deduplication once more at the complete-resource boundary so an issue
  // reported through both paths is returned exactly once.
  issues = dedupeResourceTreeIssues(issues);

  const validationTime = Date.now() - startedAt;
  logger.debug(
    `[RecordsValidator] Validated ${resource.resourceType} in ${validationTime}ms `
    + `(${issues.length} issues - extensions, slicing, bindings, constraints checked)`,
  );

  return issues;
}

async function collectMandatedProfileIssues(
  resource: FhirResource,
  declaredProfileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  alreadyReported: ValidationIssue[],
  context: RecordsSingleResourceValidationContext,
): Promise<ValidationIssue[]> {
  const mandatedProfileUrl = mandatedProfileBeside(resource, declaredProfileUrl);
  if (!mandatedProfileUrl) return [];
  const mandatedIssues = await context.validateAgainstProfile(
    resource,
    mandatedProfileUrl,
    fhirVersion,
  );
  return mandatedProfileAdditions(alreadyReported, mandatedIssues, mandatedProfileUrl);
}
