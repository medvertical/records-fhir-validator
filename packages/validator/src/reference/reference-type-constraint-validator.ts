import { extractResourceType as _extractResourceType, parseReference, type ReferenceParseResult } from './reference-type-extractor.js';
import {
  REFERENCE_TYPE_CONSTRAINTS,
  type ReferenceTypeConstraint,
} from './reference-type-constraints.js';

export { REFERENCE_TYPE_CONSTRAINTS } from './reference-type-constraints.js';
export type { ReferenceTypeConstraint } from './reference-type-constraints.js';

export interface ReferenceTypeValidationResult {
  isValid: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
  expectedTypes?: string[];
  actualType?: string | null;
  parseResult?: ReferenceParseResult;
}

const UNSAFE_CONSTRAINT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeConstraintKey(key: string): boolean {
  return key.length > 0 && !UNSAFE_CONSTRAINT_KEYS.has(key);
}

function getOwnConstraintMap(constraints: Record<string, Record<string, ReferenceTypeConstraint>>, resourceType: string): Record<string, ReferenceTypeConstraint> | undefined {
  if (!isSafeConstraintKey(resourceType)) return undefined;
  return Object.prototype.hasOwnProperty.call(constraints, resourceType) ? constraints[resourceType] : undefined;
}

export class ReferenceTypeConstraintValidator {
  private constraints: Record<string, Record<string, ReferenceTypeConstraint>>;

  constructor(customConstraints?: Record<string, Record<string, ReferenceTypeConstraint>>) {
    this.constraints = customConstraints || REFERENCE_TYPE_CONSTRAINTS;
  }

  validateReferenceType(
    reference: string,
    resourceType: string,
    fieldPath: string
  ): ReferenceTypeValidationResult {
    const resourceConstraints = getOwnConstraintMap(this.constraints, resourceType);
    if (!resourceConstraints) {
      return {
        isValid: true,
        message: `No type constraints defined for ${resourceType}`,
        severity: 'info',
      };
    }

    const fieldConstraints = isSafeConstraintKey(fieldPath)
      && Object.prototype.hasOwnProperty.call(resourceConstraints, fieldPath)
      ? resourceConstraints[fieldPath]
      : undefined;
    if (!fieldConstraints) {
      return {
        isValid: true,
        message: `No type constraints defined for ${resourceType}.${fieldPath}`,
        severity: 'info',
      };
    }

    const parseResult = parseReference(reference);
    
    if (!parseResult.isValid) {
      return {
        isValid: false,
        message: `Invalid reference format: ${reference}`,
        severity: 'error',
        code: 'invalid-reference-format',
        parseResult,
      };
    }

    if (parseResult.referenceType === 'contained') {
      return {
        isValid: true,
        message: 'Contained reference - type validation requires resource resolution',
        severity: 'info',
        code: 'contained-reference-type-unknown',
        parseResult,
      };
    }

    const actualType = parseResult.resourceType;
    if (!actualType) {
      if (parseResult.referenceType === 'absolute') {
        return {
          isValid: true,
          message: `Absolute reference target type cannot be inferred for ${resourceType}.${fieldPath}`,
          severity: 'info',
          code: 'absolute-reference-type-unknown',
          parseResult,
        };
      }

      return {
        isValid: false,
        message: `Could not extract resource type from reference: ${reference}`,
        severity: 'warning',
        code: 'unknown-reference-type',
        parseResult,
      };
    }

    const isTypeAllowed = fieldConstraints.targetTypes.includes(actualType) ||
                          fieldConstraints.targetTypes.includes('Resource');

    if (!isTypeAllowed) {
      return {
        isValid: false,
        message: `Reference type '${actualType}' not allowed for ${resourceType}.${fieldPath}. Expected: ${fieldConstraints.targetTypes.join(', ')}`,
        severity: 'error',
        code: 'reference-type-mismatch',
        expectedTypes: fieldConstraints.targetTypes,
        actualType,
        parseResult,
      };
    }

    return {
      isValid: true,
      message: `Reference type '${actualType}' is valid for ${resourceType}.${fieldPath}`,
      severity: 'info',
      expectedTypes: fieldConstraints.targetTypes,
      actualType,
      parseResult,
    };
  }

  validateReferenceObject(
    referenceObject: { reference: string; type?: string; display?: string },
    resourceType: string,
    fieldPath: string
  ): ReferenceTypeValidationResult {
    const { reference, type: declaredType } = referenceObject;

    const referenceValidation = this.validateReferenceType(reference, resourceType, fieldPath);
    
    if (!referenceValidation.isValid) {
      return referenceValidation;
    }

    if (declaredType && referenceValidation.actualType) {
      if (declaredType !== referenceValidation.actualType) {
        return {
          isValid: false,
          message: `Reference.type '${declaredType}' does not match extracted type '${referenceValidation.actualType}' from reference '${reference}'`,
          severity: 'error',
          code: 'reference-type-mismatch',
          expectedTypes: [declaredType],
          actualType: referenceValidation.actualType,
          parseResult: referenceValidation.parseResult,
        };
      }
    }

    return referenceValidation;
  }

  getConstraintsForField(resourceType: string, fieldPath: string): ReferenceTypeConstraint | null {
    if (!isSafeConstraintKey(fieldPath)) return null;
    const resourceConstraints = getOwnConstraintMap(this.constraints, resourceType);
    return resourceConstraints && Object.prototype.hasOwnProperty.call(resourceConstraints, fieldPath)
      ? resourceConstraints[fieldPath]
      : null;
  }

  hasConstraints(resourceType: string, fieldPath: string): boolean {
    return this.getConstraintsForField(resourceType, fieldPath) !== null;
  }

  getConstrainedFields(resourceType: string): string[] {
    const resourceConstraints = getOwnConstraintMap(this.constraints, resourceType);
    return resourceConstraints ? Object.keys(resourceConstraints) : [];
  }

  setConstraints(resourceType: string, fieldPath: string, constraints: ReferenceTypeConstraint): void {
    if (!isSafeConstraintKey(resourceType) || !isSafeConstraintKey(fieldPath)) {
      throw new TypeError('Constraint keys must not modify object prototypes');
    }
    if (!Object.prototype.hasOwnProperty.call(this.constraints, resourceType)) {
      this.constraints[resourceType] = {};
    }
    this.constraints[resourceType][fieldPath] = constraints;
  }

  validateMultipleReferences(
    references: Array<{ reference: string; fieldPath: string }>,
    resourceType: string
  ): ReferenceTypeValidationResult[] {
    return references.map(({ reference, fieldPath }) =>
      this.validateReferenceType(reference, resourceType, fieldPath)
    );
  }
}

export function getReferenceTypeConstraintValidator(): ReferenceTypeConstraintValidator {
  return new ReferenceTypeConstraintValidator();
}

export function resetReferenceTypeConstraintValidator(): void {
  // Retained as a compatibility no-op now that validators are request-local.
}
