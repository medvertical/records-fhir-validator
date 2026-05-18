/**
 * Validation Orchestrator
 * 
 * Orchestrates validation across all aspect executors.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';
import {
  StructuralExecutor,
  ProfileExecutor,
  TerminologyExecutor,
  ReferenceExecutor,
  InvariantExecutor,
  CustomRuleExecutor,
  MetadataExecutor
} from './executors';
import { getValueAtPath } from './validation-utils';
import { terminologyResourceValidator } from '../validators/terminology-resource-validator';
import type { ReferenceResolver } from '../validators/slicing-validator';

export interface ValidationOrchestratorContext {
  resource: any;
  resourceType: string;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  settings?: any;
  referenceResolver?: ReferenceResolver | null;
}

/**
 * Run all aspect validations and collect issues
 */
export async function runAllAspectValidations(
  context: ValidationOrchestratorContext,
  structuralExecutor: StructuralExecutor,
  profileExecutor: ProfileExecutor,
  terminologyExecutor: TerminologyExecutor,
  invariantExecutor: InvariantExecutor,
  customRuleExecutor: CustomRuleExecutor,
  metadataExecutor: MetadataExecutor,
  referenceExecutor?: ReferenceExecutor
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Structural validation (cardinality, types, element rules)
  const structuralIssues = await structuralExecutor.validate(
    context.resource,
    {
      resource: context.resource,
      resourceType: context.resourceType,
      profileUrl: context.profileUrl,
      fhirVersion: context.fhirVersion,
      structureDef: context.structureDef,
      getValueAtPath,
      settings: context.settings
    }
  );
  issues.push(...structuralIssues);

  // Profile validation (extensions, slicing)
  const profileIssues = await profileExecutor.validate({
    resource: context.resource,
    resourceType: context.resourceType,
    profileUrl: context.profileUrl,
    fhirVersion: context.fhirVersion,
    structureDef: context.structureDef,
    strictMode: context.strictMode,
    getValueAtPath,
    referenceResolver: context.referenceResolver,
  });
  issues.push(...profileIssues);

  // Terminology validation (value set bindings)
  const terminologyIssues = await terminologyExecutor.validate({
    resource: context.resource,
    structureDef: context.structureDef,
    getValueAtPath,
    fhirVersion: context.fhirVersion
  });
  issues.push(...terminologyIssues);

  // Invariant validation (FHIRPath constraints)
  const invariantIssues = await invariantExecutor.validate({
    resource: context.resource,
    structureDef: context.structureDef,
    profileUrl: context.profileUrl,
    existingIssues: issues
  });
  issues.push(...invariantIssues);

  // Terminology resource business rules (CodeSystem/ValueSet canonical URLs,
  // caseSensitive, concept definitions, compose.include validation)
  const terminologyResourceIssues = terminologyResourceValidator.validate(
    context.resource,
  );
  issues.push(...terminologyResourceIssues);

  // Custom Rule validation (User-defined business rules)
  const customRuleIssues = await customRuleExecutor.validate({
    resource: context.resource,
    structureDef: context.structureDef
  });
  issues.push(...customRuleIssues);

  // Reference validation (contained references, type constraints)
  // Only runs if a referenceExecutor was provided (the single-resource
  // validate() path wires it in; the multi-aspect batch path runs its
  // own reference pass via the callback).
  if (referenceExecutor) {
    const referenceIssues = await referenceExecutor.validate({
      resource: context.resource,
      fhirVersion: context.fhirVersion,
      settings: context.settings
    });
    issues.push(...referenceIssues);
  }

  // Metadata validation
  const metadataIssues = await metadataExecutor.validate({
    resource: context.resource
  }, context.profileUrl);
  issues.push(...metadataIssues);

  return issues;
}
