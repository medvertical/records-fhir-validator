import type { ValidationIssue } from '../../types';
import type { StructureDefinition, ElementDefinition } from '../structure-definition-types';
import type { CardinalityValidator } from '../../validators/cardinality-validator';
import type { TypeValidator } from '../../validators/type-validator';
import type { ElementRulesValidator } from '../../validators/element-rules-validator';
import type { ComplexTypeValidator } from '../../validators/complex-type-validator';
import type { MustSupportValidator } from '../../validators/must-support-validator';
import type { ReferenceFormatValidator } from '../../validators/reference-format-validator';
import type { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import type { BundleValidator } from '../../validators/bundle-validator';
import type { QuestionnaireValidator } from '../../validators/questionnaire-validator';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules';
import { logger } from '../../logger';
import { getDirectValue, isValueEmpty } from './structural-executor-helpers';
import {
  hasElementDefinitionRules,
  shouldSkipRulesForSiblingSliceTarget,
  shouldSkipSnapshotElement,
} from './structural-element-rules';

type FhirVersion = 'R4' | 'R5' | 'R6';
type ValidationTarget = ReturnType<typeof getValidationTargets>[number];

interface StructuralSnapshotDeps {
  cardinalityValidator: CardinalityValidator;
  typeValidator: TypeValidator;
  elementRulesValidator: ElementRulesValidator;
  complexTypeValidator: ComplexTypeValidator;
  mustSupportValidator: MustSupportValidator;
  referenceFormatValidator: ReferenceFormatValidator;
  referenceTargetValidator: ReferenceTargetValidator;
  bundleValidator: BundleValidator;
  questionnaireValidator: QuestionnaireValidator;
  detectUnknownElements(
    resource: any,
    structureDef: StructureDefinition,
    resourceType: string,
    fhirVersion: FhirVersion,
  ): Promise<ValidationIssue[]>;
}

interface StructuralSnapshotParams {
  resource: any;
  structureDef: StructureDefinition;
  effectiveProfileUrl?: string;
  getValueAtPath: (resource: any, path: string) => any;
  fhirVersion: FhirVersion;
  deps: StructuralSnapshotDeps;
}

interface SnapshotElementParams extends StructuralSnapshotParams {
  elementDef: ElementDefinition;
}

export async function validateStructuralSnapshot(params: StructuralSnapshotParams): Promise<ValidationIssue[]> {
  const { resource, structureDef, effectiveProfileUrl, getValueAtPath, fhirVersion, deps } = params;
  const issues: ValidationIssue[] = [];

  for (const elementDef of structureDef.snapshot?.element ?? []) {
    if (elementDef.path === resource.resourceType) continue;
    if (shouldSkipSnapshotElement(elementDef, resource.resourceType)) continue;

    issues.push(...await validateSnapshotElement({
      resource,
      structureDef,
      effectiveProfileUrl,
      getValueAtPath,
      fhirVersion,
      deps,
      elementDef,
    }));
  }

  issues.push(...await validateMissedMustSupportElements(resource, structureDef, effectiveProfileUrl, getValueAtPath, deps, issues));
  issues.push(...await deps.detectUnknownElements(resource, structureDef, resource.resourceType, fhirVersion));
  issues.push(...deps.referenceFormatValidator.validateAllReferences(resource, resource.resourceType));
  issues.push(...deps.referenceTargetValidator.validate(resource, structureDef));

  if (resource.resourceType === 'Bundle') {
    issues.push(...await deps.bundleValidator.validateBundle(resource));
  }

  if (resource.resourceType === 'Questionnaire') {
    issues.push(...deps.questionnaireValidator.validateQuestionnaire(resource));
  } else if (resource.resourceType === 'QuestionnaireResponse') {
    issues.push(...deps.questionnaireValidator.validateQuestionnaireResponse(resource));
  }

  return issues;
}

async function validateSnapshotElement(params: SnapshotElementParams): Promise<ValidationIssue[]> {
  const { resource, elementDef } = params;
  const validationTargets = getValidationTargets(resource, elementDef.path);

  if (elementDef.path.includes('name')) {
    logger.debug(`[StructuralExecutor] Processing ${elementDef.path}, targets: ${validationTargets.length}`);
    validationTargets.forEach(target => {
      logger.debug(`[StructuralExecutor]   Target: ${target.fullPath}, value exists: ${target.value !== undefined && target.value !== null}`);
    });
  }

  if (validationTargets.length === 0) {
    return validateElementWithoutTargets(params);
  }

  return validateElementTargets(params, validationTargets);
}

async function validateElementWithoutTargets(params: SnapshotElementParams): Promise<ValidationIssue[]> {
  const { resource, elementDef, effectiveProfileUrl, getValueAtPath, structureDef, fhirVersion, deps } = params;
  const path = elementDef.path;
  const value = getValueAtPath(resource, path);

  if (!shouldValidateRequired(resource, path)) {
    return [];
  }

  const issues = deps.cardinalityValidator.validate(value, elementDef, path, effectiveProfileUrl, resource);

  if (value !== undefined && value !== null) {
    issues.push(...await validateExistingValue({
      value,
      elementDef,
      path,
      effectiveProfileUrl,
      structureDef,
      fhirVersion,
      deps,
      skipSiblingSliceRules: false,
    }));
    return issues;
  }

  if (elementDef.mustSupport === true && !elementActuallyExists(resource, path, getValueAtPath)) {
    issues.push(...deps.mustSupportValidator.validateMustSupportElement(
      path,
      effectiveProfileUrl || '',
      resource,
      elementDef,
    ));
  }

  return issues;
}

async function validateElementTargets(
  params: SnapshotElementParams,
  validationTargets: ValidationTarget[],
): Promise<ValidationIssue[]> {
  const { resource, elementDef, effectiveProfileUrl, deps } = params;
  const issues: ValidationIssue[] = [];

  for (const group of groupTargetsByContext(validationTargets).values()) {
    const first = group[0];
    if (!shouldValidateRequired(resource, first.contextPath || first.fullPath)) continue;

    const count = group.filter(t => t.value !== undefined && t.value !== null).length;
    issues.push(...deps.cardinalityValidator.validate(
      new Array(count).fill(null),
      elementDef,
      elementDef.path,
      effectiveProfileUrl,
      resource,
    ));
  }

  for (const target of validationTargets) {
    issues.push(...await validateSingleTarget(params, target));
  }

  return issues;
}

async function validateSingleTarget(params: SnapshotElementParams, target: ValidationTarget): Promise<ValidationIssue[]> {
  const { resource, elementDef, effectiveProfileUrl, structureDef, fhirVersion, deps } = params;
  const targetHasValue = target.value !== undefined && target.value !== null;
  const shouldValidate = shouldValidateRequired(resource, target.fullPath);
  const shouldApplyChoiceElementRules =
    !shouldValidate &&
    targetHasValue &&
    target.fullPath.includes('[x]') &&
    hasElementDefinitionRules(elementDef as unknown as Record<string, unknown>);

  if (shouldApplyChoiceElementRules) {
    if (shouldSkipRulesForSiblingSliceTarget(elementDef, target.value, structureDef)) return [];
    return deps.elementRulesValidator.validate(target.value, elementDef, target.fullPath, effectiveProfileUrl);
  }

  if (!shouldValidate || !targetHasValue) {
    return [];
  }

  if (target.fullPath.includes('coding') && target.fullPath.includes('system')) {
    logger.debug(`[StructuralExecutor Debug] Validating type for ${target.fullPath}, value: ${target.value}`);
  }

  const skipSiblingSliceRules = shouldSkipRulesForSiblingSliceTarget(elementDef, target.value, structureDef);
  return validateExistingValue({
    value: target.value,
    elementDef,
    path: target.fullPath,
    effectiveProfileUrl,
    structureDef,
    fhirVersion,
    deps,
    skipSiblingSliceRules,
  });
}

async function validateExistingValue(params: {
  value: any;
  elementDef: ElementDefinition;
  path: string;
  effectiveProfileUrl?: string;
  structureDef: StructureDefinition;
  fhirVersion: FhirVersion;
  deps: StructuralSnapshotDeps;
  skipSiblingSliceRules: boolean;
}): Promise<ValidationIssue[]> {
  const { value, elementDef, path, effectiveProfileUrl, structureDef, fhirVersion, deps, skipSiblingSliceRules } = params;
  const profileUrl = effectiveProfileUrl || '';
  const issues = await deps.typeValidator.validate(value, elementDef.type || [], path, profileUrl);

  if (!skipSiblingSliceRules) {
    issues.push(...deps.elementRulesValidator.validate(value, elementDef, path, profileUrl));
  }

  issues.push(...await deps.complexTypeValidator.validateComplexTypeSubElements(
    value,
    elementDef,
    path,
    profileUrl,
    structureDef,
    fhirVersion,
  ));

  return issues;
}

function groupTargetsByContext(validationTargets: ValidationTarget[]): Map<string, ValidationTarget[]> {
  const targetsByContext = new Map<string, ValidationTarget[]>();
  for (const target of validationTargets) {
    const key = target.contextPath || '';
    const group = targetsByContext.get(key) || [];
    group.push(target);
    targetsByContext.set(key, group);
  }
  return targetsByContext;
}

function elementActuallyExists(
  resource: any,
  path: string,
  getValueAtPath: (resource: any, path: string) => any,
): boolean {
  const validationTargets = getValidationTargets(resource, path);
  if (validationTargets.some(target => !isValueEmpty(target.value))) {
    return true;
  }

  const directValue = getDirectValue(resource, path);
  if (!isValueEmpty(directValue)) {
    return true;
  }

  try {
    return !isValueEmpty(getValueAtPath(resource, path));
  } catch {
    return false;
  }
}

async function validateMissedMustSupportElements(
  resource: any,
  structureDef: StructureDefinition,
  effectiveProfileUrl: string | undefined,
  getValueAtPath: (resource: any, path: string) => any,
  deps: StructuralSnapshotDeps,
  existingIssues: ValidationIssue[],
): Promise<ValidationIssue[]> {
  const checkedPaths = new Set<string>();
  for (const issue of existingIssues) {
    if (issue.code === 'mustsupport-missing' && issue.path) {
      checkedPaths.add(issue.path);
    }
  }

  return deps.mustSupportValidator.validateAllMustSupportElements(
    resource,
    structureDef,
    effectiveProfileUrl || '',
    getValueAtPath,
    checkedPaths,
  );
}
