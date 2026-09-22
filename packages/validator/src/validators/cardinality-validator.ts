import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { ElementDefinition } from '../core/structure-definition-types.js';
import { shouldValidateRequired, getValidationTargets } from '../business-rules/index.js';
import { logger } from '../logger.js';
import { shouldSkipMustSupportForResource } from './must-support-applicability.js';

interface CardinalityValidationOptions {
  parentExists?: boolean;
}

function resourceTypeFromPath(path: string): string {
  const firstSegment = path.split('.')[0]?.replace(/\[[^\]]+\]/g, '');
  return firstSegment || 'Unknown';
}

function buildMinCardinalityFixHint(path: string, min: number, resource?: unknown): string {
  const contextualHint = buildPlanDefinitionRelatedActionTargetIdFixHint(path, resource);
  if (contextualHint) return contextualHint;

  return `Add '${path}' with at least ${min} value${min === 1 ? '' : 's'}.`;
}

function buildPlanDefinitionRelatedActionTargetIdFixHint(path: string, resource?: unknown): string | undefined {
  if (!isRecord(resource) || resource.resourceType !== 'PlanDefinition') return undefined;
  if (!path.endsWith('.targetId') || !path.includes('.relatedAction[')) return undefined;

  const relatedAction = resolveIndexedPathParent(resource, path);
  if (!isRecord(relatedAction)) return undefined;
  const misplacedId = relatedAction.id;
  if (typeof misplacedId !== 'string' || misplacedId.trim().length === 0 || relatedAction.targetId !== undefined) {
    return undefined;
  }

  return `Add '${path}'. This relatedAction has element id '${misplacedId}' but no targetId; in FHIR R5, relatedAction.targetId is the required link to the related action. Move the workflow reference from id to targetId when '${misplacedId}' is meant to identify the target action.`;
}

function resolveIndexedPathParent(resource: unknown, path: string): unknown {
  const segments = path.split('.').slice(1, -1);
  let current: unknown = resource;

  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;

    if (!isRecord(current)) return undefined;
    const indexed = /^([A-Za-z][A-Za-z0-9]*)\[(\d+)\]$/.exec(segment);
    if (indexed) {
      const [, key, rawIndex] = indexed;
      const value = current[key];
      if (!Array.isArray(value)) return undefined;
      current = value[Number(rawIndex)];
      continue;
    }

    current = current[segment];
  }

  return current;
}

export class CardinalityValidator {
  private mustSupportSeverity: 'error' | 'warning' | 'information' = 'warning';

  setMustSupportSeverity(severity: 'error' | 'warning' | 'information'): void {
    this.mustSupportSeverity = severity;
  }

  validate(
    value: unknown,
    elementDef: ElementDefinition,
    path: string,
    profileUrl?: string,
    resource?: unknown,
    options: CardinalityValidationOptions = {},
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const min = elementDef.min ?? 0;
    const max = elementDef.max ?? '*';

    const count = this.getCount(value);

    if (value !== undefined && value !== null && !Array.isArray(value) && this.isRepeating(elementDef) && !path.match(/\[\d+\]$/)) {
      const elementName = path.split('.').pop() || path;
      issues.push(createValidationIssue({
        code: 'structural-validation-error',
        path,
        resourceType: getResourceType(resource, path),
        profile: profileUrl,
        customMessage: `Element '${elementName}' must be an array (max cardinality is ${max})`,
        messageParams: { element: elementName, max },
        severityOverride: 'error',
      }));
    }

    if (count < min) {
      const shouldValidate = options.parentExists ??
        (resource !== undefined ? shouldValidateRequired(resource, path) : true);

      if (shouldValidate) {
        issues.push(createValidationIssue({
          code: 'structural-cardinality-min',
          path,
          resourceType: getResourceType(resource, path),
          profile: profileUrl,
          messageParams: { element: path, actual: count, min },
          details: {
            fixHint: buildMinCardinalityFixHint(path, min, resource),
          },
        }));
      } else {
        logger.debug(
          `[CardinalityValidator] Skipping min cardinality check for '${path}' ` +
          `(parent doesn't exist - conditional cardinality)`
        );
      }
    }

    if (max !== '*') {
      const maxNum = parseInt(max, 10);
      if (!isNaN(maxNum) && count > maxNum) {
        issues.push(createValidationIssue({
          code: 'structural-cardinality-max',
          path,
          resourceType: getResourceType(resource, path),
          profile: profileUrl,
          messageParams: { element: path, actual: count, max },
        }));
      }
    }

    if (elementDef.mustSupport === true) {
      const shouldValidateMustSupport = options.parentExists ??
        (resource !== undefined ? shouldValidateRequired(resource, path) : true);
      const shouldSkipMustSupport = shouldSkipMustSupportForResource(resource, path);

      if (
        shouldValidateMustSupport &&
        !shouldSkipMustSupport
      ) {
        let elementActuallyExists = count > 0;

        if (!elementActuallyExists && resource !== undefined) {
          const validationTargets = getValidationTargets(resource, path);
          if (validationTargets.length > 0) {
            const hasNonEmptyValue = validationTargets.some(target => {
              const targetValue = target.value;
              if (targetValue === undefined || targetValue === null) {
                return false;
              }
              if (Array.isArray(targetValue)) {
                return targetValue.length > 0;
              }
              if (isRecord(targetValue)) {
                return Object.keys(targetValue).length > 0;
              }
              if (typeof targetValue === 'string') {
                return targetValue.trim().length > 0;
              }
              return true;
            });
            elementActuallyExists = hasNonEmptyValue;
          }
        }

        const mustSupportIssues = this.validateMustSupport(
          count,
          path,
          profileUrl,
          elementActuallyExists,
          getResourceType(resource, path)
        );
        issues.push(...mustSupportIssues);
      } else if (!shouldValidateMustSupport) {
        logger.debug(
          `[CardinalityValidator] Skipping mustSupport check for '${path}' ` +
          `(parent doesn't exist - conditional mustSupport)`
        );
      } else {
        logger.debug(
          `[CardinalityValidator] Skipping mustSupport check for '${path}' ` +
          `(contextual applicability rule matched)`
        );
      }
    }

    return issues;
  }

  private validateMustSupport(
    count: number,
    path: string,
    profileUrl?: string,
    elementActuallyExists?: boolean,
    resourceType?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (count === 0 && elementActuallyExists !== true) {
      issues.push(createValidationIssue({
        code: 'profile-mustsupport-missing',
        path,
        resourceType: resourceType || resourceTypeFromPath(path),
        profile: profileUrl,
        messageParams: { element: path },
        severityOverride: this.mustSupportSeverity === 'information'
          ? 'info'
          : this.mustSupportSeverity,
      }));
    }

    return issues;
  }

  private getCount(value: unknown): number {
    if (value === undefined || value === null) {
      return 0;
    }

    if (Array.isArray(value)) {
      return value.length;
    }

    return 1;
  }

  isRequired(elementDef: ElementDefinition): boolean {
    return (elementDef.min ?? 0) > 0;
  }

  isRepeating(elementDef: ElementDefinition): boolean {
    const max = elementDef.max;
    if (max === undefined || max === null) {
      return false;
    }
    if (max === '*') {
      return true;
    }

    const maxNum = parseInt(max, 10);
    return !isNaN(maxNum) && maxNum > 1;
  }

  getCardinalityString(elementDef: ElementDefinition): string {
    const min = elementDef.min ?? 0;
    const max = elementDef.max ?? '*';
    return `${min}..${max}`;
  }
}

function getResourceType(resource: unknown, path: string): string {
  return isRecord(resource) && typeof resource.resourceType === 'string'
    ? resource.resourceType
    : resourceTypeFromPath(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
