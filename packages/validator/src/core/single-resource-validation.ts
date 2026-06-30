import type { ValidationIssue, ValidationSettings } from '../types';
import { BestPracticeValidator } from '../validators/best-practice-validator';
import {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors';
import type { StructureDefinition } from './structure-definition-types';
import { runAllAspectValidations } from './validation-orchestrator';
import { dedupeIssues, suppressRedundantBindingWarnings } from './validation-utils';

export interface SingleResourceValidationInput {
  resource: any;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  settings?: ValidationSettings;
  profileFallbackIssue?: ValidationIssue | null;
  contextQuestionnaire?: any;
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
  validateBundleEntriesIfNeeded(resource: any, fhirVersion: 'R4' | 'R5' | 'R6'): Promise<ValidationIssue[]>;
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
    },
    deps.structuralExecutor,
    deps.profileExecutor,
    deps.terminologyExecutor,
    deps.invariantExecutor,
    deps.customRuleExecutor,
    deps.metadataExecutor,
    deps.referenceExecutor,
  );

  const bestPracticeIssues = deps.bestPracticeValidator.validate({
    resource: input.resource,
    resourceType: input.resource.resourceType,
    profileUrl: input.profileUrl,
  });

  return suppressRedundantBindingWarnings(dedupeIssues([
    ...(input.profileFallbackIssue ? [input.profileFallbackIssue] : []),
    ...aspectIssues,
    ...bestPracticeIssues,
    ...(await deps.validateBundleEntriesIfNeeded(input.resource, input.fhirVersion)),
  ]));
}
