/**
 * Early Termination Validator
 * 
 * Pre-flight checks for validation that can fail fast:
 * - JSON structure validation
 * - ResourceType presence and validity
 * - Critical required fields
 * - Meta requirements
 * 
 * Returns immediately on critical errors without running full validation.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface EarlyTerminationResult {
    /** Should validation continue? */
    shouldContinue: boolean;
    /** Critical issues that caused termination */
    issues: ValidationIssue[];
    /** Reason for termination */
    reason?: string;
}

export interface EarlyTerminationConfig {
    /** Stop on missing resourceType */
    requireResourceType: boolean;
    /** Stop on missing id */
    requireId: boolean;
    /** Stop on empty resource */
    rejectEmpty: boolean;
    /** Maximum resource size in bytes */
    maxResourceSize?: number;
    /** Required top-level fields */
    requiredFields?: string[];
}

// ============================================================================
// Valid FHIR Resource Types (R4)
// ============================================================================

const FHIR_R4_RESOURCE_TYPES = new Set([
    'Account', 'ActivityDefinition', 'AdverseEvent', 'AllergyIntolerance',
    'Appointment', 'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary',
    'BiologicallyDerivedProduct', 'BodyStructure', 'Bundle', 'CapabilityStatement',
    'CarePlan', 'CareTeam', 'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition',
    'Claim', 'ClaimResponse', 'ClinicalImpression', 'CodeSystem', 'Communication',
    'CommunicationRequest', 'CompartmentDefinition', 'Composition', 'ConceptMap',
    'Condition', 'Consent', 'Contract', 'Coverage', 'CoverageEligibilityRequest',
    'CoverageEligibilityResponse', 'DetectedIssue', 'Device', 'DeviceDefinition',
    'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement', 'DiagnosticReport',
    'DocumentManifest', 'DocumentReference', 'EffectEvidenceSynthesis', 'Encounter',
    'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare',
    'EventDefinition', 'Evidence', 'EvidenceVariable', 'ExampleScenario',
    'ExplanationOfBenefit', 'FamilyMemberHistory', 'Flag', 'Goal', 'GraphDefinition',
    'Group', 'GuidanceResponse', 'HealthcareService', 'ImagingStudy', 'Immunization',
    'ImmunizationEvaluation', 'ImmunizationRecommendation', 'ImplementationGuide',
    'InsurancePlan', 'Invoice', 'Library', 'Linkage', 'List', 'Location',
    'Measure', 'MeasureReport', 'Media', 'Medication', 'MedicationAdministration',
    'MedicationDispense', 'MedicationKnowledge', 'MedicationRequest',
    'MedicationStatement', 'MedicinalProduct', 'MedicinalProductAuthorization',
    'MedicinalProductContraindication', 'MedicinalProductIndication',
    'MedicinalProductIngredient', 'MedicinalProductInteraction',
    'MedicinalProductManufactured', 'MedicinalProductPackaged',
    'MedicinalProductPharmaceutical', 'MedicinalProductUndesirableEffect',
    'MessageDefinition', 'MessageHeader', 'MolecularSequence', 'NamingSystem',
    'NutritionOrder', 'Observation', 'ObservationDefinition', 'OperationDefinition',
    'OperationOutcome', 'Organization', 'OrganizationAffiliation', 'Parameters',
    'Patient', 'PaymentNotice', 'PaymentReconciliation', 'Person', 'PlanDefinition',
    'Practitioner', 'PractitionerRole', 'Procedure', 'Provenance', 'Questionnaire',
    'QuestionnaireResponse', 'RelatedPerson', 'RequestGroup', 'ResearchDefinition',
    'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject', 'RiskAssessment',
    'RiskEvidenceSynthesis', 'Schedule', 'SearchParameter', 'ServiceRequest',
    'Slot', 'Specimen', 'SpecimenDefinition', 'StructureDefinition', 'StructureMap',
    'Subscription', 'Substance', 'SubstanceNucleicAcid', 'SubstancePolymer',
    'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
    'SubstanceSpecification', 'SupplyDelivery', 'SupplyRequest', 'Task',
    'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet',
    'VerificationResult', 'VisionPrescription'
]);

// ============================================================================
// Early Termination Validator
// ============================================================================

export class EarlyTerminationValidator {
    private config: EarlyTerminationConfig;

    constructor(config?: Partial<EarlyTerminationConfig>) {
        this.config = {
            requireResourceType: true,
            requireId: false,
            rejectEmpty: true,
            maxResourceSize: 10 * 1024 * 1024, // 10MB default
            ...config
        };
    }

    /**
     * Configure early termination
     */
    setConfig(config: Partial<EarlyTerminationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Check if validation should continue
     * Returns immediately on critical failures
     */
    check(resource: any): EarlyTerminationResult {
        const issues: ValidationIssue[] = [];

        logger.debug('[EarlyTermination] Running pre-flight checks');

        // 1. Check if resource is null/undefined
        if (resource === null || resource === undefined) {
            return this.fatalResult('early-termination-null-resource', '', 'Unknown', 'Resource is null or undefined', 'null-resource');
        }

        // 2. Check if resource is an object
        if (typeof resource !== 'object' || Array.isArray(resource)) {
            return this.fatalResult('early-termination-not-object', '', 'Unknown', 'Resource must be a JSON object, not an array or primitive', 'not-object');
        }

        // 3. Check for empty object
        if (this.config.rejectEmpty && Object.keys(resource).length === 0) {
            return this.fatalResult('early-termination-empty-resource', '', 'Unknown', 'Resource is an empty object', 'empty-object');
        }

        // 4. Check resourceType presence
        if (this.config.requireResourceType && !resource.resourceType) {
            return this.fatalResult('early-termination-missing-resourcetype', 'resourceType', 'Unknown', 'Missing required field: resourceType', 'missing-resourceType');
        }

        // 5. Check resourceType validity
        if (resource.resourceType && !FHIR_R4_RESOURCE_TYPES.has(resource.resourceType)) {
            issues.push(createValidationIssue({
                code: 'early-termination-unknown-resourcetype',
                path: 'resourceType',
                resourceType: resource.resourceType,
                customMessage: `Unknown resource type: '${resource.resourceType}'`,
                severityOverride: 'error',
            }));
            // Don't terminate on unknown type - might be R5/R6 or custom
        }

        // 6. Check ID if required
        if (this.config.requireId && !resource.id) {
            issues.push(createValidationIssue({
                code: 'early-termination-missing-id',
                path: 'id',
                resourceType: resource.resourceType || 'Unknown',
                customMessage: 'Missing required field: id',
                severityOverride: 'error',
            }));
        }

        // 7. Check size limit
        if (this.config.maxResourceSize) {
            const size = JSON.stringify(resource).length;
            if (size > this.config.maxResourceSize) {
                const actualSize = (size / 1024 / 1024).toFixed(2);
                const maxSize = (this.config.maxResourceSize / 1024 / 1024).toFixed(2);
                return this.fatalResult(
                    'early-termination-resource-too-large',
                    '',
                    resource.resourceType || 'Unknown',
                    `Resource exceeds maximum size (${actualSize}MB > ${maxSize}MB)`,
                    'size-exceeded'
                );
            }
        }

        // 8. Check required fields
        issues.push(...this.checkRequiredFields(resource));

        // All checks passed
        return {
            shouldContinue: true,
            issues
        };
    }

    private fatalResult(
        code: string,
        path: string,
        resourceType: string,
        customMessage: string,
        reason: string,
    ): EarlyTerminationResult {
        return {
            shouldContinue: false,
            issues: [createValidationIssue({
                code,
                path,
                resourceType,
                customMessage,
                severityOverride: 'fatal',
            })],
            reason
        };
    }

    private checkRequiredFields(resource: any): ValidationIssue[] {
        return (this.config.requiredFields ?? []).flatMap(field => {
            if (resource[field] !== undefined && resource[field] !== null) return [];
            return [createValidationIssue({
                code: 'early-termination-missing-required',
                path: field,
                resourceType: resource.resourceType || 'Unknown',
                customMessage: `Missing required field: ${field}`,
                severityOverride: 'error',
            })];
        });
    }

    /**
     * Quick check for minimal validity (fastest possible)
     */
    isMinimallyValid(resource: any): boolean {
        return (
            resource !== null &&
            resource !== undefined &&
            typeof resource === 'object' &&
            !Array.isArray(resource) &&
            typeof resource.resourceType === 'string' &&
            resource.resourceType.length > 0
        );
    }

    /**
     * Get list of valid FHIR R4 resource types
     */
    getValidResourceTypes(): string[] {
        return Array.from(FHIR_R4_RESOURCE_TYPES);
    }
}

// Singleton
export const earlyTerminationValidator = new EarlyTerminationValidator();
