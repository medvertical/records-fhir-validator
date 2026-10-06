import { reconcileInvocationDisplayUnknowns } from './terminology-validation-evidence-port.js';
import { computeValidationIssueId } from '@records-fhir/validation-types';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules/index.js';
import type { ProfileSourceContext } from '../../persistence/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ValueSetCache } from '../../validators/valueset-cache.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { additionalBindingsForElement } from './terminology-additional-bindings.js';
import { pinBindingToDependencyPins } from './terminology-binding-dependency-pins.js';
import {
  applyValueSetSliceMembershipPolicy,
  selectSliceScopedValues,
  selectValuesForBinding,
  shouldSuppressNonRequiredBindingForOwnFixedPattern,
  shouldSuppressValueSetSliceMembershipIssue,
  shouldValidateBindingForValue,
} from './terminology-binding-selection.js';
import {
  getElementTypeCodes,
  getResourceType,
  isDirectResourceElementPath,
} from './terminology-executor-helpers.js';
import { validateExternalCodeSystems } from './terminology-external-code-system-rules.js';
import { UCUM_BEARING_TYPES, validateUcumAtPath } from './terminology-ucum-rules.js';
import type { TerminologySlicePlanCache } from './terminology-slice-plan-cache.js';
import type { CodeSystemReferenceLookupCache } from './terminology-code-system-reference-rules.js';
import type { UcumCodeValidator } from '../../validators/ucum-validator.js';
import type { TerminologyBindingValidationPort, TerminologyValidationPort } from './terminology-validation-port.js';

export interface TerminologyElementValidationParams {
  resource: unknown;
  elementDef: ElementDefinition;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: unknown, path: string) => unknown;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  sourceContext?: ProfileSourceContext;
}

interface TerminologyElementValidationDeps {
  valueSetCache: ValueSetCache;
  valueSetValidator: TerminologyValidationPort;
  slicePlanCache: TerminologySlicePlanCache;
  codeSystemReferenceLookupCache: CodeSystemReferenceLookupCache;
  ucumValidator: UcumCodeValidator;
}

export async function validateTerminologyElement(
  params: TerminologyElementValidationParams,
  deps: TerminologyElementValidationDeps,
): Promise<ValidationIssue[]> {
  const { resource, elementDef, fhirVersion, sourceContext } = params;
  const issues = elementDef.binding
    ? await validateElementBinding(params, deps.valueSetValidator, deps.slicePlanCache)
    : [];
  const path = elementDef.path;
  const language = asRecord(resource)?.language;
  const displayLanguage = typeof language === 'string' && language ? language : undefined;
  const elementTypes = getElementTypeCodes(elementDef);

  if (elementTypes.includes('CodeableConcept')) {
    const targets = getValidationTargets(resource, path).filter(
      (target) => target.value !== null && target.value !== undefined,
    );
    for (const target of targets) {
      const concept = asRecord(target.value);
      if (!Array.isArray(concept?.coding)) continue;
      issues.push(
        ...(await validateExternalCodeSystems(
          concept.coding,
          `${target.fullPath}.coding`,
          deps.valueSetValidator,
          fhirVersion,
          sourceContext,
          deps.valueSetCache,
          deps.codeSystemReferenceLookupCache,
          deps.ucumValidator,
          displayLanguage,
        )),
      );
    }
  } else if (elementTypes.includes('Coding')) {
    const targets = getValidationTargets(resource, path).filter(
      (target) => target.value !== null && target.value !== undefined,
    );
    for (const target of targets) {
      issues.push(
        ...(await validateExternalCodeSystems(
          target.value,
          target.fullPath,
          deps.valueSetValidator,
          fhirVersion,
          sourceContext,
          deps.valueSetCache,
          deps.codeSystemReferenceLookupCache,
          deps.ucumValidator,
          displayLanguage,
        )),
      );
    }
  }

  if (elementTypes.some((type) => UCUM_BEARING_TYPES.has(type))) {
    issues.push(...validateUcumAtPath(resource, elementDef, path, deps.ucumValidator));
  }
  return reconcileInvocationDisplayUnknowns(deps.valueSetValidator, issues, fhirVersion, displayLanguage);
}

async function validateElementBinding(
  params: TerminologyElementValidationParams,
  valueSetValidator: TerminologyBindingValidationPort,
  slicePlanCache: TerminologySlicePlanCache,
): Promise<ValidationIssue[]> {
  const { resource, elementDef, structureDef, getValueAtPath } = params;
  const path = elementDef.path;
  if (discriminatesItsSliceByBinding(elementDef, structureDef)) return [];
  const sliceSelection = selectSliceScopedValues(resource, elementDef, structureDef, getValueAtPath, slicePlanCache);
  if (sliceSelection && !sliceSelection.hasMatchingSliceElements) return [];
  const targets = sliceSelection
    ? []
    : getValidationTargets(resource, path)
      .filter((target) => target.value !== null && target.value !== undefined)
      .filter((target) => shouldValidateBindingForValue(elementDef, target.value));
  const value = sliceSelection
    ? sliceSelection.values.length === 0
      ? undefined
      : sliceSelection.values.length === 1
        ? sliceSelection.values[0]
        : sliceSelection.values
    : getValueAtPath(resource, path);

  if (elementDef.binding?.strength === 'required' && (elementDef.min ?? 0) > 0) {
    const missing =
      targets.length === 0 &&
      (value === null || value === undefined) &&
      shouldValidateRequired(resource, path) &&
      (sliceSelection ? isChildOfSlice(elementDef.id) : isDirectResourceElementPath(path, getResourceType(resource, structureDef)));
    if (missing) return [createMissingRequiredBindingIssue(params)];
  }

  if (
    targets.length === 0
    && (value === null || value === undefined || !shouldValidateBindingForValue(elementDef, value))
  ) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const validateCandidate = await createCandidateBindingValidator(params, valueSetValidator, slicePlanCache);
  if (targets.length > 0) {
    for (const target of targets) {
      for (const candidate of selectValuesForBinding(elementDef, target.value, structureDef, slicePlanCache)) {
        if (shouldSuppressNonRequiredBindingForOwnFixedPattern(elementDef, candidate)) continue;
        issues.push(...(await validateCandidate(candidate, target.fullPath)));
      }
    }
    return issues;
  }
  if (value === null || value === undefined || !shouldValidateBindingForValue(elementDef, value)) return [];

  const perCandidateIssues: ValidationIssue[][] = [];
  const located = sliceSelection
    ? sliceSelection.values.map((sliceValue, index) => ({ value: sliceValue, path: sliceSelection.paths[index] ?? path }))
    : [{ value, path }];
  for (const target of located) {
    if (!shouldValidateBindingForValue(elementDef, target.value)) continue;
    for (const candidate of selectValuesForBinding(elementDef, target.value, structureDef, slicePlanCache)) {
      if (shouldSuppressNonRequiredBindingForOwnFixedPattern(elementDef, candidate)) continue;
      perCandidateIssues.push(await validateCandidate(candidate, target.path));
    }
  }
  issues.push(
    ...applyValueSetSliceMembershipPolicy(elementDef, structureDef, perCandidateIssues, slicePlanCache),
  );
  return issues;
}

async function createCandidateBindingValidator(
  params: TerminologyElementValidationParams,
  valueSetValidator: TerminologyBindingValidationPort,
  slicePlanCache: TerminologySlicePlanCache,
): Promise<(candidate: unknown, path: string) => Promise<ValidationIssue[]>> {
  const { elementDef, structureDef, profileUrl, fhirVersion } = params;
  const language = asRecord(params.resource)?.language;
  const displayLanguage = typeof language === 'string' && language ? language : undefined;
  // The owning package and its dependencies pin actual ValueSet resource versions.
  const pinBinding = valueSetValidator.pinBindingToProfile?.bind(valueSetValidator) ?? pinBindingToDependencyPins;
  const effectiveBinding = await pinBinding(
    elementDef.binding,
    structureDef,
    fhirVersion,
  );
  const additionalBindings = await Promise.all(
    additionalBindingsForElement(elementDef)
      .map(binding => pinBinding(
        binding,
        structureDef,
        fhirVersion,
      )),
  );
  return async (candidate, path) => {
    const issues: ValidationIssue[] = [];
    const primary = await valueSetValidator.validateBinding(candidate, effectiveBinding, path, {
      profileUrl,
      fhirVersion,
      displayLanguage,
    });
    if (!shouldSuppressValueSetSliceMembershipIssue(elementDef, structureDef, primary, slicePlanCache)) {
      issues.push(...primary);
    }
    for (const binding of additionalBindings) {
      issues.push(
        ...(await valueSetValidator.validateBinding(candidate, binding, path, {
          profileUrl,
          fhirVersion,
          unverifiedSeverity: 'warning',
          displayLanguage,
        })),
      );
    }
    return issues;
  };
}

/**
 * An optional slice told apart by this element's own required binding
 * (BALP's agent:user by its type) holds exactly the instances whose code is
 * in the value set, so the binding cannot fail inside the slice, and the
 * reference validator never applies it to the instances outside. A required
 * slice keeps the binding check, which stands in for the missing slice.
 */
function discriminatesItsSliceByBinding(elementDef: ElementDefinition, structureDef: StructureDefinition): boolean {
  if (elementDef.binding?.strength !== 'required') return false;
  if (Object.keys(elementDef).some(key => key.startsWith('fixed') || key.startsWith('pattern'))) return false;
  const segments = elementDef.id?.split('.') ?? [];
  const sliceIndex = segments.findLastIndex(segment => segment.includes(':'));
  if (sliceIndex < 1) return false;
  const sliceId = segments.slice(0, sliceIndex + 1).join('.');
  const elements = structureDef.snapshot?.element ?? [];
  if ((elements.find(element => element.id === sliceId)?.min ?? 0) > 0) return false;
  const baseId = sliceId.slice(0, sliceId.lastIndexOf(':'));
  const relative = segments.slice(sliceIndex + 1).map(segment => segment.split(':')[0]).join('.') || '$this';
  const discriminators = elements.find(element => element.id === baseId)?.slicing?.discriminator ?? [];
  return discriminators.some(({ type, path }) => (type === 'value' || type === 'pattern') && (path || '$this') === relative);
}

/**
 * Inside a slice the element is missing only where its parent is the slice
 * itself: a deeper parent (CCRR's nested action's condition, for `kind`) may
 * be absent from every instance of the slice, and then nothing is missing.
 */
function isChildOfSlice(id: string | undefined): boolean {
  const segments = id?.split('.') ?? [];
  return segments.length >= 2 && segments[segments.length - 2].includes(':');
}

function createMissingRequiredBindingIssue(params: TerminologyElementValidationParams): ValidationIssue {
  const { resource, elementDef, structureDef, profileUrl } = params;
  const path = elementDef.path;
  const resourceType = getResourceType(resource, structureDef);
  const message = `Required binding for '${path}' is missing (binding strength: required)`;
  const details = { bindingStrength: 'required', fieldPath: path };
  return {
    id: computeValidationIssueId({
      aspect: 'terminology',
      severity: 'error',
      code: 'binding-required-missing',
      path,
      resourceType,
      message,
      profile: profileUrl,
      details,
    }),
    aspect: 'terminology',
    severity: 'error',
    code: 'binding-required-missing',
    message,
    path,
    timestamp: new Date(),
    profile: profileUrl,
    details,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
