import { findConcreteChoiceProperty } from '../core/fhir-choice-property.js';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import {
  getNestedValue,
  isPrimitiveType,
} from '../core/executors/structural-executor-helpers.js';
import {
  getValidationTargets,
  type ValidationTarget,
} from '../business-rules/element-validation-targets.js';
import { pinBindingToDependencyPins } from '../core/executors/terminology-binding-dependency-pins.js';
import type { Binding, ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import {
  narrowChoiceTypeElement,
  narrowChoiceTypeForConcreteSegment,
  parentComplexElementAbsent,
} from './complex-type-path-rules.js';
import { validateHl7IdentifierSystem } from './hl7-sid-registry.js';
import type { TypeValidator } from './type-validator.js';
import type { ValueSetValidator } from './valueset-validator.js';

interface ComplexTypeSubElementInput {
  value: unknown;
  elementPath: string;
  subElementDef: ElementDefinition;
  typeCode: string;
  basePath: string;
  profileUrl: string;
  parentStructureDef?: StructureDefinition;
  fhirVersion: 'R4' | 'R5' | 'R6';
}

interface ComplexTypeSubElementDependencies {
  selectBinding?: (binding: Binding | undefined, path: string) => Promise<{ binding: Binding | undefined; issues: ValidationIssue[] }>;
  typeValidator?: TypeValidator;
  valueSetValidator: ValueSetValidator;
  validateNested: (
    value: unknown,
    elementDef: ElementDefinition,
    basePath: string,
    profileUrl: string,
    parentStructureDef: StructureDefinition | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ) => Promise<ValidationIssue[]>;
}

/** Validate one effective complex-type child and recurse when it is structured. */
export async function validateComplexTypeSubElement(
  input: ComplexTypeSubElementInput,
  dependencies: ComplexTypeSubElementDependencies,
): Promise<ValidationIssue[]> {
  const subPath = resolveSubPath(input);
  const fullPath = `${input.basePath}.${concreteChoiceSegment(subPath, input.value)}`;
  const effectiveElementDef = narrowChoiceTypeElement(
    subPath,
    input.value,
    input.subElementDef,
  );
  let subValue = getNestedValue(input.value, subPath);
  if (subValue === undefined && !subPath.includes('.') && isRecord(input.value) && subPath in input.value) {
    subValue = input.value[subPath];
  }

  if (subValue === undefined && subPath.includes('.')) {
    const repeatingTargets = resolveRepeatingComponentTargets(input.value, subPath);
    if (repeatingTargets) {
      return validateRepeatingComponentTargets(repeatingTargets, subPath, input, dependencies);
    }
  }

  return validateSubValue({ subValue, fullPath, effectiveElementDef, missingCheckSubPath: subPath }, input, dependencies);
}

const CODED_TYPES = new Set(['CodeableConcept', 'Coding']);

/**
 * A datatype's own binding on a coded child — `Identifier.type` is bound
 * extensibly to IdentifierType — applies wherever the datatype is used, as
 * in the reference validator, which warns when no coding comes from an
 * extensible value set. Resource snapshots stop at the datatype, so only
 * this pass sees it.
 */
async function validateCodedSubElementBinding(
  subValue: object,
  elementDef: ElementDefinition,
  fullPath: string,
  input: ComplexTypeSubElementInput,
  dependencies: ComplexTypeSubElementDependencies,
): Promise<ValidationIssue[]> {
  if (!(elementDef.type ?? []).some(type => CODED_TYPES.has(type.code))) return [];
  const items = Array.isArray(subValue)
    ? subValue.map((item, index) => [item, `${fullPath}[${index}]`] as const)
    : [[subValue, fullPath] as const];
  const issues: ValidationIssue[] = [];
  for (const [item, itemPath] of items) {
    const selection = await selectedBinding(elementDef.binding, itemPath, input, dependencies);
    issues.push(...selection.issues);
    if (selection.binding?.strength !== 'required' && selection.binding?.strength !== 'extensible') continue;
    try {
      issues.push(...await dependencies.valueSetValidator.validateBinding(
        item,
        selection.binding,
        itemPath,
        { profileUrl: input.profileUrl, fhirVersion: input.fhirVersion },
      ));
    } catch (error) {
      issues.push(bindingFailure(itemPath, input, selection.binding));
      logger.debug(
        `[ComplexTypeValidator] binding check failed for ${itemPath}`,
        validationFailureMetadata(error),
      );
    }
  }
  return issues;
}

async function selectedBinding(binding: Binding | undefined, path: string, input: ComplexTypeSubElementInput,
  dependencies: ComplexTypeSubElementDependencies) {
  try {
    const selection = dependencies.selectBinding ? await dependencies.selectBinding(binding, path) : { binding, issues: [] };
    return { ...selection, binding: selection.binding
      ? await pinnedBinding(selection.binding, input, dependencies.valueSetValidator) : undefined };
  } catch {
    return { binding: undefined, issues: [bindingFailure(path, input, binding)] };
  }
}

function bindingFailure(path: string, input: ComplexTypeSubElementInput, binding: Binding | undefined): ValidationIssue {
  return createValidationIssue({ code: 'terminology-binding-unverified', path, resourceType: path.split('.')[0], profile: input.profileUrl,
    customMessage: 'The effective binding could not be checked because its selection or resolution failed.',
    severityOverride: 'information', details: { validationComplete: false, validationStatus: 'incomplete',
      reason: 'binding-resolution-failure', valueSet: binding?.valueSet },
  });
}

/**
 * A binding is read in the release of the package that owns its definition,
 * as the terminology aspect reads it: an unversioned CARIN BB 2.0.0 value set
 * is the 2.0.0 one, not the newest release on disk.
 */
async function pinnedBinding<T extends Binding | undefined>(binding: T, input: ComplexTypeSubElementInput, valueSetValidator: ValueSetValidator): Promise<T> {
  if (!input.parentStructureDef) return binding;
  const pinBinding = valueSetValidator.pinBindingToProfile?.bind(valueSetValidator) ?? pinBindingToDependencyPins;
  return pinBinding(binding, input.parentStructureDef, input.fhirVersion);
}

/**
 * `diagnosis[x]` names the element; the instance names the choice it made
 * (`diagnosisCodeableConcept`), which is where its findings belong and where
 * the terminology aspect reports the same binding.
 */
function concreteChoiceSegment(subPath: string, value: unknown): string {
  if (!subPath.endsWith('[x]') || subPath.includes('.') || !isRecord(value)) return subPath;
  return findConcreteChoiceProperty(value, subPath.slice(0, -'[x]'.length)) ?? subPath;
}

function resolveSubPath(input: ComplexTypeSubElementInput): string {
  if (input.elementPath.startsWith(`${input.typeCode}.`)) {
    return input.elementPath.substring(input.typeCode.length + 1);
  }
  let subPath = input.subElementDef.path.replace(`${input.typeCode}.`, '');
  if (subPath.includes('.')) {
    const prefix = input.basePath.replace(/\[\d+\]/g, '');
    if (subPath.startsWith(prefix + '.')) {
      subPath = subPath.substring(prefix.length + 1);
    }
  }
  return subPath;
}

/**
 * getNestedValue cannot see through a repeating inline component (e.g.
 * Dosage.doseAndRate is 0..*): an array intermediate makes it return
 * undefined, so descendants like doseAndRate.dose[x] would silently skip
 * primitive validation. Fan out per array item instead — but only when an
 * intermediate actually resolved through an array (an indexed target path);
 * genuinely missing values keep the aggregate handling in validateSubValue.
 */
function resolveRepeatingComponentTargets(
  value: unknown,
  subPath: string,
): ValidationTarget[] | null {
  if (!isRecord(value)) return null;
  const fannedOut = getValidationTargets(value, subPath)
    .filter(target => target.fullPath.includes('['));
  return fannedOut.length > 0 ? fannedOut : null;
}

async function validateRepeatingComponentTargets(
  targets: ValidationTarget[],
  subPath: string,
  input: ComplexTypeSubElementInput,
  dependencies: ComplexTypeSubElementDependencies,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const choiceSegment = subPath.split('.').pop() ?? '';
  for (const target of targets) {
    const concreteSegment = (target.fullPath.split('.').pop() ?? '').replace(/\[\d+\]$/, '');
    const targetElementDef = narrowChoiceTypeForConcreteSegment(
      input.subElementDef,
      choiceSegment,
      concreteSegment,
    );
    issues.push(...await validateSubValue({
      subValue: target.value,
      fullPath: `${input.basePath}.${target.fullPath}`,
      effectiveElementDef: targetElementDef,
      // The fan-out only yields targets whose parent item exists, so the
      // absent-parent guard must not swallow per-item required checks.
      missingCheckSubPath: null,
    }, input, dependencies));
  }
  return issues;
}

async function validateSubValue(
  resolved: {
    subValue: unknown;
    fullPath: string;
    effectiveElementDef: ElementDefinition;
    /** Sub-path for the absent-parent guard; null when the parent is known present. */
    missingCheckSubPath: string | null;
  },
  input: ComplexTypeSubElementInput,
  dependencies: ComplexTypeSubElementDependencies,
): Promise<ValidationIssue[]> {
  const { subValue, fullPath, effectiveElementDef, missingCheckSubPath } = resolved;
  const isValueMissing = subValue === undefined || subValue === null
    || (Array.isArray(subValue) && subValue.length === 0)
    || (typeof subValue === 'string' && subValue.trim().length === 0);
  const minCardinality = input.subElementDef.min ?? 0;

  if (isValueMissing && minCardinality > 0) {
    if (missingCheckSubPath !== null && parentComplexElementAbsent(input.value, missingCheckSubPath)) {
      return [];
    }
    return [createValidationIssue({
      code: 'structural-required-element-missing',
      path: fullPath,
      resourceType: resourceTypeOf(input.value, 'Unknown'),
      profile: input.profileUrl,
      messageParams: { element: fullPath },
    })];
  }

  if (typeof subValue === 'object' && subValue !== null) {
    const declaredTypes = effectiveElementDef.type?.map(type => type.code) || [];
    const allPrimitive = declaredTypes.length > 0
      && declaredTypes.every(type => isPrimitiveType(type));
    if (allPrimitive && dependencies.typeValidator) {
      return dependencies.typeValidator.validate(
        subValue,
        effectiveElementDef.type || [],
        fullPath,
        input.profileUrl,
        input.fhirVersion,
      );
    }
    return [
      ...await validateCodedSubElementBinding(subValue, effectiveElementDef, fullPath, input, dependencies),
      ...await dependencies.validateNested(
        subValue, effectiveElementDef, fullPath, input.profileUrl, input.parentStructureDef, input.fhirVersion,
      ),
    ];
  }

  if (subValue === undefined || subValue === null) return [];

  const issues: ValidationIssue[] = [];
  const selection = await selectedBinding(effectiveElementDef.binding, fullPath, input, dependencies);
  issues.push(...selection.issues);
  if (selection.binding?.strength === 'required') {
    try {
      issues.push(...await dependencies.valueSetValidator.validateBinding(
        subValue,
        selection.binding,
        fullPath,
        { profileUrl: input.profileUrl, fhirVersion: input.fhirVersion },
      ));
    } catch (error) {
      issues.push(bindingFailure(fullPath, input, selection.binding));
      logger.debug(
        `[ComplexTypeValidator] binding check failed for ${fullPath}`,
        validationFailureMetadata(error),
      );
    }
  }

  if (dependencies.typeValidator) {
    issues.push(...await dependencies.typeValidator.validate(
      subValue,
      effectiveElementDef.type || [],
      fullPath,
      input.profileUrl,
      input.fhirVersion,
    ));
  }
  if (input.subElementDef.path === 'Identifier.system') {
    const sidIssue = await validateHl7IdentifierSystem(subValue, fullPath, input.profileUrl);
    if (sidIssue) issues.push(sidIssue);
  }
  return issues;
}
