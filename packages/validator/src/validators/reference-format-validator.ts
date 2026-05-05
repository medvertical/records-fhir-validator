/**
 * Reference Format Validator
 * 
 * Validates FHIR Reference.reference string format:
 * - Relative: ResourceType/id
 * - Absolute: http(s)://server/ResourceType/id
 * - Contained: #localId
 * - URN: urn:uuid:xxxx or urn:oid:xxxx
 * 
 * This validator ensures reference strings are well-formed according to FHIR specification.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Known FHIR Resource Types
// ============================================================================

const FHIR_RESOURCE_TYPES = new Set([
    // Administrative
    'Patient', 'Practitioner', 'PractitionerRole', 'Organization', 'Location',
    'HealthcareService', 'Endpoint', 'RelatedPerson', 'Person', 'Group',

    // Clinical
    'Condition', 'Observation', 'Procedure', 'DiagnosticReport', 'Specimen',
    'ImagingStudy', 'AllergyIntolerance', 'CarePlan', 'CareTeam', 'Goal',
    'NutritionOrder', 'RiskAssessment', 'DetectedIssue', 'ClinicalImpression',
    'FamilyMemberHistory', 'Immunization', 'ImmunizationRecommendation',

    // Medications
    'Medication', 'MedicationRequest', 'MedicationAdministration',
    'MedicationDispense', 'MedicationStatement', 'MedicationKnowledge',

    // Encounters
    'Encounter', 'Appointment', 'AppointmentResponse', 'Schedule', 'Slot',
    'EpisodeOfCare', 'Flag', 'Account', 'ChargeItem', 'ChargeItemDefinition',

    // Documents
    'DocumentReference', 'DocumentManifest', 'Composition', 'Binary',
    'QuestionnaireResponse', 'Questionnaire', 'Communication',
    'CommunicationRequest', 'Task', 'ServiceRequest',

    // Financial
    'Claim', 'ClaimResponse', 'Coverage', 'CoverageEligibilityRequest',
    'CoverageEligibilityResponse', 'EnrollmentRequest', 'EnrollmentResponse',
    'ExplanationOfBenefit', 'Invoice', 'PaymentNotice', 'PaymentReconciliation',

    // Bundles
    'Bundle', 'List', 'Basic', 'Linkage', 'MessageHeader', 'OperationOutcome',
    'Parameters', 'Subscription', 'SubscriptionStatus', 'SubscriptionTopic',

    // Conformance
    'CapabilityStatement', 'StructureDefinition', 'ImplementationGuide',
    'SearchParameter', 'OperationDefinition', 'CompartmentDefinition',
    'GraphDefinition', 'CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem',
    'TerminologyCapabilities', 'StructureMap', 'ExampleScenario',

    // Security
    'AuditEvent', 'Provenance', 'Consent', 'BiologicallyDerivedProduct',

    // Devices
    'Device', 'DeviceDefinition', 'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement',

    // Research
    'ResearchStudy', 'ResearchSubject', 'Evidence', 'EvidenceVariable',

    // Other
    'Media', 'BodyStructure', 'MolecularSequence', 'Substance', 'SubstanceSpecification',
    'Contract', 'InsurancePlan', 'MedicinalProduct', 'OrganizationAffiliation',
    'VerificationResult', 'SupplyRequest', 'SupplyDelivery', 'VisionPrescription',
]);

// ============================================================================
// Reference Format Patterns
// ============================================================================

const REFERENCE_PATTERNS = {
    // Relative reference: ResourceType/id with optional /_history/version
    // FHIR id allows [A-Za-z0-9\-._] up to 64 chars
    relative: /^([A-Z][a-zA-Z]+)\/[A-Za-z0-9\-._]+(\/_history\/[A-Za-z0-9\-._]+)?$/,

    // Absolute reference: any http(s) URL. FHIR allows both literal
    // references (http://server/Patient/123) and opaque endpoint URLs
    // (http://example.org/endpoint). We only validate that it's a
    // well-formed URL, not that it resolves to a FHIR resource.
    absolute: /^https?:\/\/[^\s]+$/,

    // Contained reference: #localId or bare `#` (self-reference to the
    // resource that contains this one — valid FHIR). Accepts empty token
    // after '#' so self-references don't fail format validation; structural-
    // id validation handles truly invalid characters separately.
    contained: /^#.*$/,

    // URN UUID: urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    urnUuid: /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,

    // URN OID: urn:oid:x.x.x.x
    urnOid: /^urn:oid:[0-9]+(\.[0-9]+)*$/,

    // General URN: urn:<nid>:<nss> — matches any well-formed URN (RFC 8141)
    // so that near-valid uuid URNs (with trailing chars) are treated as
    // "reference not found" instead of "invalid format".
    urnGeneral: /^urn:[a-z0-9][a-z0-9-]{0,31}:.+$/i,

    // Conditional reference: ResourceType?search-params (used in transaction bundles)
    conditional: /^([A-Z][a-zA-Z]+)\?.+$/,
};

// ============================================================================
// Reference Format Validator
// ============================================================================

export class ReferenceFormatValidator {
    /**
     * Validate a reference string format
     */
    validateReferenceString(
        reference: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!reference || typeof reference !== 'string') {
            return issues;
        }

        // Trim whitespace
        const ref = reference.trim();

        // Check against all valid patterns
        const isRelative = REFERENCE_PATTERNS.relative.test(ref);
        const isAbsolute = REFERENCE_PATTERNS.absolute.test(ref);
        const isContained = REFERENCE_PATTERNS.contained.test(ref);
        const isUrnUuid = REFERENCE_PATTERNS.urnUuid.test(ref);
        const isUrnOid = REFERENCE_PATTERNS.urnOid.test(ref);
        const isUrnGeneral = REFERENCE_PATTERNS.urnGeneral.test(ref) &&
            !ref.toLowerCase().startsWith('urn:uuid:');
        const isConditional = REFERENCE_PATTERNS.conditional.test(ref);

        const isValid = isRelative || isAbsolute || isContained || isUrnUuid || isUrnOid || isUrnGeneral || isConditional;

        if (!isValid) {
            // Bare logical ID (e.g. "example-resource-name") — technically
            // non-conformant (FHIR expects ResourceType/id) but commonly
            // used in IG example resources. Downgrade to warning.
            const isBareId = /^[A-Za-z0-9\-.]+$/.test(ref);
            const severity = isBareId ? 'warning' : 'error';
            logger.debug(`[ReferenceFormatValidator] Invalid reference format: ${ref}`);
            issues.push(createValidationIssue({
                code: 'reference-invalid-format',
                severityOverride: severity,
                path: `${path}.reference`,
                resourceType,
                customMessage: `Invalid reference format: '${ref}'. Expected ResourceType/id, absolute URL, #containedId, or urn:uuid/oid.`,
                details: {
                    reference: ref,
                    testedPatterns: ['relative', 'absolute', 'contained', 'urnUuid', 'urnOid']
                }
            }));
        }

        // Additional validation: check if resource type is valid (for relative references)
        if (isRelative) {
            const match = ref.match(REFERENCE_PATTERNS.relative);
            if (match && match[1]) {
                const refResourceType = match[1];
                if (!FHIR_RESOURCE_TYPES.has(refResourceType)) {
                    logger.debug(`[ReferenceFormatValidator] Unknown resource type in reference: ${refResourceType}`);
                    issues.push(createValidationIssue({
                        code: 'reference-type-unknown',
                        path: `${path}.reference`,
                        resourceType,
                        customMessage: `Unknown resource type in reference: '${refResourceType}'`,
                        details: {
                            reference: ref,
                            referencedResourceType: refResourceType
                        }
                    }));
                }
            }
        }

        return issues;
    }

    /**
     * Validate all Reference elements in a resource
     */
    validateAllReferences(
        resource: any,
        path: string = ''
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceType = resource.resourceType || 'Unknown';

        this.traverseAndValidate(resource, path || resourceType, resourceType, issues);

        return issues;
    }

    /**
     * Recursively traverse resource and validate reference fields
     */
    private traverseAndValidate(
        obj: any,
        path: string,
        resourceType: string,
        issues: ValidationIssue[]
    ): void {
        if (obj === null || obj === undefined) {
            return;
        }

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                this.traverseAndValidate(item, `${path}[${index}]`, resourceType, issues);
            });
            return;
        }

        if (typeof obj === 'object') {
            // Check if this is a Reference object
            if (obj.reference !== undefined) {
                const refIssues = this.validateReferenceString(
                    obj.reference,
                    path,
                    resourceType
                );
                issues.push(...refIssues);
            }

            // Recurse into child properties
            for (const key of Object.keys(obj)) {
                // Skip certain fields that can't contain references
                if (key === 'resourceType' || key === 'id' || key === 'meta') {
                    continue;
                }
                this.traverseAndValidate(obj[key], `${path}.${key}`, resourceType, issues);
            }
        }
    }
}

// Export singleton instance
export const referenceFormatValidator = new ReferenceFormatValidator();
