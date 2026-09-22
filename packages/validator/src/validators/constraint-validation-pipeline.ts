import { getValidationTargets } from '../business-rules/index.js';
import { logger } from '../logger.js';
import type { ElementDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { expressionStartsAtResourceRoot } from './constraint-choice-context.js';
import type { ConstraintEvaluationEngine } from './constraint-evaluation-engine.js';
import { buildUserInvocationTable } from './fhirpath-custom-functions.js';
import { elementExistsInResource, hasEmptyBackboneElement } from './constraint-path-utils.js';
import { createSliceDefinitionMatcher } from './constraint-slice-targets.js';
import {
  isConstraint,
  isElementWithConstraints,
  isFhirResource,
  isRecord,
  type ConstraintValidationOptions,
  type ConstraintValidationState,
  type FhirResource,
} from './constraint-validation-input.js';
import { resolveElementType } from './fhirpath-type-preprocessor.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { ValueSetCache } from './valueset-cache.js';

/** Owns constraint input state, target planning, and element traversal. */
export class ConstraintValidationPipeline {
  constructor(
    private readonly evaluationEngine: ConstraintEvaluationEngine,
    private readonly valueSetCache: ValueSetCache,
    private readonly operationCache?: TerminologyOperationCache,
  ) {}

  async validate(
    input: unknown,
    elements: ElementDefinition[],
    profileUrl: string,
    options?: ConstraintValidationOptions,
  ): Promise<ValidationIssue[]> {
    if (!isFhirResource(input) || !Array.isArray(elements)) return [];
    const resource = input;
    const rootResource = options?.rootResource ?? resource;
    const state: ConstraintValidationState = {
      strictnessMode: options?.strictMode ? 'strict' : 'standard',
      fhirVersion: options?.fhirVersion || 'R4',
      userInvocationTable: buildUserInvocationTable(
        rootResource,
        options?.bundle,
        this.valueSetCache,
        this.operationCache,
      ),
      bundle: options?.bundle,
      rootResource,
    };
    const issues: ValidationIssue[] = [];
    const matchesSlice = createSliceDefinitionMatcher(elements);
    this.logRootCoreConstraints(resource, elements);

    for (const element of elements) {
      if (!isElementWithConstraints(element)) continue;
      const isRootElement = element.path === resource.resourceType;
      const elementExists = isRootElement || this.shouldValidatePresentElement(resource, element);
      if (!isRootElement && !elementExists) continue;

      const elementType = resolveElementType(element);
      let validationTargets: ReturnType<typeof getValidationTargets> | null = null;
      const getElementValidationTargets = () => {
        validationTargets ??= getValidationTargets(resource, element.path);
        return validationTargets;
      };

      for (const candidate of element.constraint) {
        if (!isConstraint(candidate) || shouldSkipGenericConstraint(candidate.key)) continue;
        if (expressionStartsAtResourceRoot(candidate.expression, resource.resourceType)) {
          issues.push(...await this.evaluationEngine.evaluate(
            resource,
            element.path,
            candidate,
            profileUrl,
            elementType,
            state,
          ));
          continue;
        }

        const targets = getElementValidationTargets();
        if (targets.length === 0) {
          issues.push(...await this.evaluationEngine.evaluate(
            resource,
            element.path,
            candidate,
            profileUrl,
            elementType,
            state,
          ));
          continue;
        }
        for (const target of targets) {
          // A repeating parent can produce a positional target for an optional
          // child that is absent on one of its items. Element constraints apply
          // only when that child exists; cardinality validation owns absence.
          if (target.value === undefined || target.value === null) continue;
          if (!matchesSlice(
            target.value,
            element,
            { resource, target },
          )) continue;
          issues.push(...await this.evaluationEngine.evaluate(
            resource,
            target.fullPath,
            candidate,
            profileUrl,
            elementType,
            state,
          ));
        }
      }
    }
    return issues;
  }

  private shouldValidatePresentElement(
    resource: FhirResource,
    element: ElementDefinition,
  ): boolean {
    if (elementExistsInResource(resource, element.path)) return true;
    const isOptional = element.min === undefined || element.min === 0;
    const isBackbone = element.type?.some(
      type => type.code === 'BackboneElement' || type.code === 'Element',
    );
    if (isOptional && !isBackbone) return false;
    return Boolean(isBackbone && hasEmptyBackboneElement(resource, element.path));
  }

  private logRootCoreConstraints(
    resource: FhirResource,
    elements: ElementDefinition[],
  ): void {
    const rootElement = elements.find(
      element => isRecord(element) && element.path === resource.resourceType,
    );
    if (!rootElement?.constraint) return;
    const coreConstraints = ['dom-2', 'dom-3', 'dom-4', 'dom-5', 'dom-6'];
    const found = rootElement.constraint
      .filter(isConstraint)
      .filter(item => coreConstraints.includes(item.key));
    logger.debug(
      `[ConstraintValidator] Found ${found.length} core constraints on ${resource.resourceType}: ${found.map(item => item.key).join(', ')}`,
    );
  }
}

function shouldSkipGenericConstraint(constraintKey: string): boolean {
  return constraintKey === 'con-3' || constraintKey === 'ext-1' || constraintKey === 'ele-1';
}
