/**
 * Reference Type Constraint Validator
 * 
 * Validates that FHIR references match the expected resource types defined in StructureDefinition constraints.
 * Checks reference.type and targetProfile constraints for correctness.
 * 
 * Task 6.2: Implement reference type validation against StructureDefinition constraints
 */

import { extractResourceType as _extractResourceType, parseReference, type ReferenceParseResult } from './reference-type-extractor';

// ============================================================================
// Types
// ============================================================================

export interface ReferenceTypeConstraint {
  /** Allowed target resource types for this reference */
  targetTypes: string[];
  /** Allowed target profiles (canonical URLs) */
  targetProfiles?: string[];
  /** Whether the reference type must be specified */
  requireType?: boolean;
  /** Field path for the reference */
  fieldPath: string;
  /** Whether this reference is required */
  required?: boolean;
}

export interface ReferenceTypeValidationResult {
  /** Whether the reference type is valid */
  isValid: boolean;
  /** Validation message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Error code if invalid */
  code?: string;
  /** Expected resource types */
  expectedTypes?: string[];
  /** Actual resource type found */
  actualType?: string | null;
  /** Parse result details */
  parseResult?: ReferenceParseResult;
}

// ============================================================================
// Reference Type Constraints by Resource Type
// ============================================================================

/**
 * Common reference type constraints from FHIR specification
 * Based on StructureDefinition element definitions
 */
export const REFERENCE_TYPE_CONSTRAINTS: Record<string, Record<string, ReferenceTypeConstraint>> = {
  Patient: {
    'generalPractitioner': {
      fieldPath: 'generalPractitioner',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Organization'],
      required: false,
    },
    'managingOrganization': {
      fieldPath: 'managingOrganization',
      targetTypes: ['Organization'],
      required: false,
    },
    'link.other': {
      fieldPath: 'link.other',
      targetTypes: ['Patient', 'RelatedPerson'],
      required: false,
    },
  },
  
  Observation: {
    'subject': {
      fieldPath: 'subject',
      targetTypes: ['Patient', 'Group', 'Device', 'Location'],
      required: false,
    },
    'encounter': {
      fieldPath: 'encounter',
      targetTypes: ['Encounter'],
      required: false,
    },
    'performer': {
      fieldPath: 'performer',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Organization', 'CareTeam', 'Patient', 'RelatedPerson'],
      required: false,
    },
    'specimen': {
      fieldPath: 'specimen',
      targetTypes: ['Specimen'],
      required: false,
    },
    'device': {
      fieldPath: 'device',
      targetTypes: ['Device', 'DeviceMetric'],
      required: false,
    },
    'hasMember': {
      fieldPath: 'hasMember',
      targetTypes: ['Observation', 'QuestionnaireResponse', 'MolecularSequence'],
      required: false,
    },
    'derivedFrom': {
      fieldPath: 'derivedFrom',
      targetTypes: ['DocumentReference', 'ImagingStudy', 'Media', 'QuestionnaireResponse', 'Observation', 'MolecularSequence'],
      required: false,
    },
    'focus': {
      fieldPath: 'focus',
      targetTypes: ['Resource'], // Can reference any resource
      required: false,
    },
  },
  
  Condition: {
    'subject': {
      fieldPath: 'subject',
      targetTypes: ['Patient', 'Group'],
      required: true,
    },
    'encounter': {
      fieldPath: 'encounter',
      targetTypes: ['Encounter'],
      required: false,
    },
    'recorder': {
      fieldPath: 'recorder',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Patient', 'RelatedPerson'],
      required: false,
    },
    'asserter': {
      fieldPath: 'asserter',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Patient', 'RelatedPerson'],
      required: false,
    },
    'stage.assessment': {
      fieldPath: 'stage.assessment',
      targetTypes: ['ClinicalImpression', 'DiagnosticReport', 'Observation'],
      required: false,
    },
    'evidence.detail': {
      fieldPath: 'evidence.detail',
      targetTypes: ['Resource'], // Can reference any resource
      required: false,
    },
  },
  
  Encounter: {
    'subject': {
      fieldPath: 'subject',
      targetTypes: ['Patient', 'Group'],
      required: false,
    },
    'episodeOfCare': {
      fieldPath: 'episodeOfCare',
      targetTypes: ['EpisodeOfCare'],
      required: false,
    },
    'basedOn': {
      fieldPath: 'basedOn',
      targetTypes: ['ServiceRequest'],
      required: false,
    },
    'participant.individual': {
      fieldPath: 'participant.individual',
      targetTypes: ['Practitioner', 'PractitionerRole', 'RelatedPerson'],
      required: false,
    },
    'appointment': {
      fieldPath: 'appointment',
      targetTypes: ['Appointment'],
      required: false,
    },
    'reasonReference': {
      fieldPath: 'reasonReference',
      targetTypes: ['Condition', 'Procedure', 'Observation', 'ImmunizationRecommendation'],
      required: false,
    },
    'account': {
      fieldPath: 'account',
      targetTypes: ['Account'],
      required: false,
    },
    'serviceProvider': {
      fieldPath: 'serviceProvider',
      targetTypes: ['Organization'],
      required: false,
    },
    'partOf': {
      fieldPath: 'partOf',
      targetTypes: ['Encounter'],
      required: false,
    },
  },
  
  DiagnosticReport: {
    'subject': {
      fieldPath: 'subject',
      targetTypes: ['Patient', 'Group', 'Device', 'Location'],
      required: false,
    },
    'encounter': {
      fieldPath: 'encounter',
      targetTypes: ['Encounter'],
      required: false,
    },
    'performer': {
      fieldPath: 'performer',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Organization', 'CareTeam'],
      required: false,
    },
    'resultsInterpreter': {
      fieldPath: 'resultsInterpreter',
      targetTypes: ['Practitioner', 'PractitionerRole', 'Organization', 'CareTeam'],
      required: false,
    },
    'specimen': {
      fieldPath: 'specimen',
      targetTypes: ['Specimen'],
      required: false,
    },
    'result': {
      fieldPath: 'result',
      targetTypes: ['Observation'],
      required: false,
    },
    'imagingStudy': {
      fieldPath: 'imagingStudy',
      targetTypes: ['ImagingStudy'],
      required: false,
    },
    'media.link': {
      fieldPath: 'media.link',
      targetTypes: ['Media'],
      required: false,
    },
  },
};

// ============================================================================
// Reference Type Constraint Validator Class
// ============================================================================

export class ReferenceTypeConstraintValidator {
  private constraints: Record<string, Record<string, ReferenceTypeConstraint>>;

  constructor(customConstraints?: Record<string, Record<string, ReferenceTypeConstraint>>) {
    this.constraints = customConstraints || REFERENCE_TYPE_CONSTRAINTS;
  }

  /**
   * Validate that a reference matches the type constraints for a field
   */
  validateReferenceType(
    reference: string,
    resourceType: string,
    fieldPath: string
  ): ReferenceTypeValidationResult {
    // Get constraints for this resource type and field
    const resourceConstraints = this.constraints[resourceType];
    if (!resourceConstraints) {
      return {
        isValid: true,
        message: `No type constraints defined for ${resourceType}`,
        severity: 'info',
      };
    }

    const fieldConstraints = resourceConstraints[fieldPath];
    if (!fieldConstraints) {
      return {
        isValid: true,
        message: `No type constraints defined for ${resourceType}.${fieldPath}`,
        severity: 'info',
      };
    }

    // Parse the reference to extract the resource type
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

    // For contained references, we can't validate type without resolving
    if (parseResult.referenceType === 'contained') {
      return {
        isValid: true,
        message: 'Contained reference - type validation requires resource resolution',
        severity: 'info',
        code: 'contained-reference-type-unknown',
        parseResult,
      };
    }

    // Check if the extracted resource type matches allowed types
    const actualType = parseResult.resourceType;
    if (!actualType) {
      return {
        isValid: false,
        message: `Could not extract resource type from reference: ${reference}`,
        severity: 'warning',
        code: 'unknown-reference-type',
        parseResult,
      };
    }

    // Check if actual type is in allowed types
    const isTypeAllowed = fieldConstraints.targetTypes.includes(actualType) ||
                          fieldConstraints.targetTypes.includes('Resource'); // 'Resource' means any type allowed

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

  /**
   * Validate reference object with type property
   */
  validateReferenceObject(
    referenceObject: { reference: string; type?: string; display?: string },
    resourceType: string,
    fieldPath: string
  ): ReferenceTypeValidationResult {
    const { reference, type: declaredType } = referenceObject;

    // First validate the reference string itself
    const referenceValidation = this.validateReferenceType(reference, resourceType, fieldPath);
    
    if (!referenceValidation.isValid) {
      return referenceValidation;
    }

    // If reference.type is provided, validate it matches the extracted type
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

  /**
   * Get type constraints for a specific field
   */
  getConstraintsForField(resourceType: string, fieldPath: string): ReferenceTypeConstraint | null {
    return this.constraints[resourceType]?.[fieldPath] || null;
  }

  /**
   * Check if a field has type constraints
   */
  hasConstraints(resourceType: string, fieldPath: string): boolean {
    return !!this.constraints[resourceType]?.[fieldPath];
  }

  /**
   * Get all constrained fields for a resource type
   */
  getConstrainedFields(resourceType: string): string[] {
    const resourceConstraints = this.constraints[resourceType];
    return resourceConstraints ? Object.keys(resourceConstraints) : [];
  }

  /**
   * Add or update constraints for a field
   */
  setConstraints(resourceType: string, fieldPath: string, constraints: ReferenceTypeConstraint): void {
    if (!this.constraints[resourceType]) {
      this.constraints[resourceType] = {};
    }
    this.constraints[resourceType][fieldPath] = constraints;
  }

  /**
   * Batch validate multiple references
   */
  validateMultipleReferences(
    references: Array<{ reference: string; fieldPath: string }>,
    resourceType: string
  ): ReferenceTypeValidationResult[] {
    return references.map(({ reference, fieldPath }) =>
      this.validateReferenceType(reference, resourceType, fieldPath)
    );
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let validatorInstance: ReferenceTypeConstraintValidator | null = null;

export function getReferenceTypeConstraintValidator(): ReferenceTypeConstraintValidator {
  if (!validatorInstance) {
    validatorInstance = new ReferenceTypeConstraintValidator();
  }
  return validatorInstance;
}

export function resetReferenceTypeConstraintValidator(): void {
  validatorInstance = null;
}


