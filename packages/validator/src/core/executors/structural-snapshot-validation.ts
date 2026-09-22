import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition, ElementDefinition } from '../structure-definition-types.js';
import type { CardinalityValidator } from '../../validators/cardinality-validator.js';
import type { TypeValidator } from '../../validators/type-validator.js';
import type { ElementRulesValidator } from '../../validators/element-rules-validator.js';
import type { ComplexTypeValidator } from '../../validators/complex-type-validator.js';
import type { MustSupportValidator } from '../../validators/must-support-validator.js';
import type { ReferenceFormatValidator } from '../../validators/reference-format-validator.js';
import type { ReferenceTargetValidator } from '../../validators/reference-target-validator.js';
import type { BundleValidator } from '../../validators/bundle-validator.js';
import type { QuestionnaireValidator } from '../../validators/questionnaire-validator.js';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules/index.js';
import {
  ContentReferenceElementsCache,
  expandContentReferenceElements,
} from '../content-reference-elements.js';
import {
  hasElementDefinitionRules,
  shouldSkipRulesForSiblingSliceTarget,
  shouldSkipSnapshotElement,
} from './structural-element-rules.js';
import { shouldSuppressServerManagedMetadataIssue } from '../server-managed-metadata-issue-filter.js';
import {
  elementActuallyExists,
  groupTargetsByContext,
  retargetIssuePath,
} from './structural-snapshot-targets.js';
import { validatePrimitiveValuePresence } from './primitive-value-presence-rules.js';

type FhirVersion = 'R4' | 'R5' | 'R6';
type ValidationTarget = ReturnType<typeof getValidationTargets>[number];
type FhirResource = Record<string, unknown>;
type ValueAtPath = (resource: FhirResource, path: string) => unknown;

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
  contentReferenceElementsCache?: ContentReferenceElementsCache;
  detectUnknownElements(
    resource: FhirResource,
    structureDef: StructureDefinition,
    resourceType: string,
    fhirVersion: FhirVersion,
  ): Promise<ValidationIssue[]>;
}

interface StructuralSnapshotParams {
  resource: FhirResource;
  structureDef: StructureDefinition;
  effectiveProfileUrl?: string;
  getValueAtPath: ValueAtPath;
  fhirVersion: FhirVersion;
  deps: StructuralSnapshotDeps;
  /** Resolves contained / bundle-entry references for reference-target typing. */
  resolveReference?: (reference: string) => unknown;
}

interface SnapshotElementParams extends StructuralSnapshotParams {
  elementDef: ElementDefinition;
}

export async function validateStructuralSnapshot(params: StructuralSnapshotParams): Promise<ValidationIssue[]> {
  const { resource, structureDef, effectiveProfileUrl, getValueAtPath, fhirVersion, deps, resolveReference } = params;
  const issues: ValidationIssue[] = [];
  const snapshotElements = expandContentReferenceElements(
    structureDef.snapshot?.element ?? [],
    deps.contentReferenceElementsCache,
  );
  const resourceType = typeof resource.resourceType === 'string'
    ? resource.resourceType
    : 'Unknown';

  for (const elementDef of snapshotElements) {
    if (elementDef.path === resourceType) continue;
    if (shouldSkipSnapshotElement(elementDef, resourceType)) continue;

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
  issues.push(...await deps.detectUnknownElements(resource, structureDef, resourceType, fhirVersion));
  issues.push(...deps.referenceFormatValidator.validateAllReferences(resource, resourceType));
  issues.push(...deps.referenceTargetValidator.validate(resource, structureDef, resolveReference));

  if (resourceType === 'Bundle') {
    issues.push(...await deps.bundleValidator.validateBundle(resource));
  }

  if (resourceType === 'Questionnaire') {
    issues.push(...deps.questionnaireValidator.validateQuestionnaire(resource, 'Questionnaire', fhirVersion));
  } else if (resourceType === 'QuestionnaireResponse') {
    issues.push(...deps.questionnaireValidator.validateQuestionnaireResponse(resource));
  }

  return issues.filter(issue => !shouldSuppressServerManagedMetadataIssue(issue));
}

async function validateSnapshotElement(params: SnapshotElementParams): Promise<ValidationIssue[]> {
  const { resource, elementDef } = params;
  const validationTargets = getValidationTargets(resource, elementDef.path);

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
    if (!shouldValidateResolvedTarget(resource, first)) continue;

    const count = group.filter(t => t.value !== undefined && t.value !== null).length;
    const validationPath = first.fullPath || elementDef.path;
    const cardinalityIssues = deps.cardinalityValidator.validate(
      // CardinalityValidator only observes Array.length here. Keep the array
      // sparse so large repeating elements do not allocate a second payload.
      new Array(count),
      elementDef,
      validationPath,
      effectiveProfileUrl,
      resource,
      { parentExists: true },
    );
    issues.push(...cardinalityIssues.map(issue =>
      first.fullPath && first.fullPath !== elementDef.path && issue.path === elementDef.path
        ? retargetIssuePath(issue, elementDef.path, first.fullPath)
        : issue
    ));

    // getValidationTargets expands a proper repeating array into indexed
    // targets. An object supplied where max > 1 yields a non-indexed target;
    // retain that original shape long enough for CardinalityValidator to
    // report the JSON array violation.
    if (group.length === 1 && !/\[\d+\]$/.test(first.fullPath || '')) {
      issues.push(...deps.cardinalityValidator.validate(
        first.value,
        elementDef,
        validationPath,
        effectiveProfileUrl,
        resource,
        { parentExists: true },
      ).filter(issue => issue.code === 'structural-validation-error'));
    }
  }

  for (const target of validationTargets) {
    issues.push(...await validateSingleTarget(params, target));
  }

  return issues;
}

async function validateSingleTarget(params: SnapshotElementParams, target: ValidationTarget): Promise<ValidationIssue[]> {
  const { resource, elementDef, effectiveProfileUrl, structureDef, fhirVersion, deps } = params;
  const targetHasValue = target.value !== undefined && target.value !== null;
  const shouldValidate = shouldValidateResolvedTarget(resource, target);
  const shouldApplyChoiceElementRules =
    !shouldValidate &&
    targetHasValue &&
    elementDef.path.includes('[x]') &&
    hasElementDefinitionRules(elementDef);

  if (shouldApplyChoiceElementRules) {
    if (shouldSkipRulesForSiblingSliceTarget(elementDef, target.value, structureDef)) return [];
    return deps.elementRulesValidator.validate(target.value, elementDef, target.fullPath, effectiveProfileUrl);
  }

  if (!shouldValidate || !targetHasValue) {
    return [];
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
  value: unknown;
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
  const issues = validatePrimitiveValuePresence(value, elementDef, path, profileUrl);
  issues.push(...await deps.typeValidator.validate(value, elementDef.type || [], path, profileUrl));

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

function shouldValidateResolvedTarget(resource: FhirResource, target: ValidationTarget): boolean {
  if (target.contextPath && target.contextPath !== resource.resourceType) {
    return true;
  }

  return shouldValidateRequired(resource, target.fullPath);
}

async function validateMissedMustSupportElements(
  resource: FhirResource,
  structureDef: StructureDefinition,
  effectiveProfileUrl: string | undefined,
  getValueAtPath: ValueAtPath,
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
