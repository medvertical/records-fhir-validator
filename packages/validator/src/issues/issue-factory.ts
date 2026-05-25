/**
 * Validation Issue Factory
 *
 * Factory function to standardize the creation of ValidationIssue objects.
 * Replaces inline object literals across validators with a single,
 * consistent creation pattern.
 *
 * Benefits:
 * - Consistent field population (id, timestamp, schemaVersion)
 * - Automatic code resolution via aliases
 * - Template-based message formatting
 * - Type safety for code values
 */

import type { ValidationIssue, ValidationAspect, ValidationSeverity } from '@records-fhir/validation-types';
import { ValidationCodes as _ValidationCodes, getCodeMetadata, resolveCode, type ValidationCode } from './message-catalog';
import { formatMessage, getHumanReadableMessage } from './message-templates';

// ============================================================================
// Factory Parameters
// ============================================================================

export interface CreateIssueParams {
    /**
     * The validation code. Can be a canonical code or a legacy alias.
     */
    code: ValidationCode | string;

    /**
     * FHIRPath to the element with the issue.
     */
    path: string;

    /**
     * Resource type being validated.
     */
    resourceType: string;

    /**
     * Parameters for message template interpolation.
     * These will be substituted into the message template.
     */
    messageParams?: Record<string, unknown>;

    /**
     * Optional custom message to override the template.
     */
    customMessage?: string;

    /**
     * Profile URL if this issue is related to profile validation.
     */
    profile?: string;

    /**
     * Additional details to include in the issue.
     */
    details?: Record<string, unknown>;

    /**
     * Override the default severity for this code.
     */
    severityOverride?: ValidationSeverity;

    /**
     * Override the default aspect for this code.
     */
    aspectOverride?: ValidationAspect;

    /**
     * Rule identifier for signature grouping (e.g., constraint key like 'ext-1', 'enc-1').
     * This is used to distinguish between different rules that share the same code.
     */
    ruleId?: string;
}

// ============================================================================
// ID Generation
// ============================================================================

let issueCounter = 0;

/**
 * Generate a unique issue ID.
 * Format: {aspect}-{code}-{timestamp}-{counter}
 */
function generateIssueId(aspect: string, code: string): string {
    issueCounter++;
    return `${aspect}-${code}-${Date.now()}-${issueCounter}`;
}

const KNOWN_RESOURCE_TYPE_BY_LOWERCASE: Record<string, string> = {
    account: 'Account',
    activitydefinition: 'ActivityDefinition',
    adverseevent: 'AdverseEvent',
    allergyintolerance: 'AllergyIntolerance',
    appointment: 'Appointment',
    appointmentresponse: 'AppointmentResponse',
    auditevent: 'AuditEvent',
    basic: 'Basic',
    binary: 'Binary',
    biologicallyderivedproduct: 'BiologicallyDerivedProduct',
    bodystructure: 'BodyStructure',
    bundle: 'Bundle',
    capabilitystatement: 'CapabilityStatement',
    careplan: 'CarePlan',
    careteam: 'CareTeam',
    catalogentry: 'CatalogEntry',
    chargeitem: 'ChargeItem',
    chargeitemdefinition: 'ChargeItemDefinition',
    claim: 'Claim',
    claimresponse: 'ClaimResponse',
    clinicalimpression: 'ClinicalImpression',
    codesystem: 'CodeSystem',
    communication: 'Communication',
    communicationrequest: 'CommunicationRequest',
    compartmentdefinition: 'CompartmentDefinition',
    composition: 'Composition',
    conceptmap: 'ConceptMap',
    condition: 'Condition',
    consent: 'Consent',
    contract: 'Contract',
    coverage: 'Coverage',
    coverageeligibilityrequest: 'CoverageEligibilityRequest',
    coverageeligibilityresponse: 'CoverageEligibilityResponse',
    detectedissue: 'DetectedIssue',
    device: 'Device',
    devicedefinition: 'DeviceDefinition',
    devicemetric: 'DeviceMetric',
    devicerequest: 'DeviceRequest',
    deviceusestatement: 'DeviceUseStatement',
    diagnosticreport: 'DiagnosticReport',
    documentmanifest: 'DocumentManifest',
    documentreference: 'DocumentReference',
    effectevidencesynthesis: 'EffectEvidenceSynthesis',
    encounter: 'Encounter',
    endpoint: 'Endpoint',
    enrollmentrequest: 'EnrollmentRequest',
    enrollmentresponse: 'EnrollmentResponse',
    episodeofcare: 'EpisodeOfCare',
    eventdefinition: 'EventDefinition',
    evidence: 'Evidence',
    evidencevariable: 'EvidenceVariable',
    examplescenario: 'ExampleScenario',
    explanationofbenefit: 'ExplanationOfBenefit',
    familymemberhistory: 'FamilyMemberHistory',
    flag: 'Flag',
    goal: 'Goal',
    graphdefinition: 'GraphDefinition',
    group: 'Group',
    guidanceresponse: 'GuidanceResponse',
    healthcareservice: 'HealthcareService',
    imagingstudy: 'ImagingStudy',
    immunization: 'Immunization',
    immunizationevaluation: 'ImmunizationEvaluation',
    immunizationrecommendation: 'ImmunizationRecommendation',
    implementationguide: 'ImplementationGuide',
    insuranceplan: 'InsurancePlan',
    invoice: 'Invoice',
    library: 'Library',
    linkage: 'Linkage',
    list: 'List',
    location: 'Location',
    measure: 'Measure',
    measurereport: 'MeasureReport',
    media: 'Media',
    medication: 'Medication',
    medicationadministration: 'MedicationAdministration',
    medicationdispense: 'MedicationDispense',
    medicationknowledge: 'MedicationKnowledge',
    medicationrequest: 'MedicationRequest',
    medicationstatement: 'MedicationStatement',
    medicinalproduct: 'MedicinalProduct',
    medicinalproductauthorization: 'MedicinalProductAuthorization',
    medicinalproductcontraindication: 'MedicinalProductContraindication',
    medicinalproductindication: 'MedicinalProductIndication',
    medicinalproductingredient: 'MedicinalProductIngredient',
    medicinalproductinteraction: 'MedicinalProductInteraction',
    medicinalproductmanufactured: 'MedicinalProductManufactured',
    medicinalproductpackaged: 'MedicinalProductPackaged',
    medicinalproductpharmaceutical: 'MedicinalProductPharmaceutical',
    medicinalproductundesirableeffect: 'MedicinalProductUndesirableEffect',
    messageheader: 'MessageHeader',
    namingsystem: 'NamingSystem',
    nutritionorder: 'NutritionOrder',
    observation: 'Observation',
    observationdefinition: 'ObservationDefinition',
    operationdefinition: 'OperationDefinition',
    operationoutcome: 'OperationOutcome',
    organization: 'Organization',
    organizationaffiliation: 'OrganizationAffiliation',
    parameters: 'Parameters',
    patient: 'Patient',
    paymentnotice: 'PaymentNotice',
    paymentreconciliation: 'PaymentReconciliation',
    person: 'Person',
    plandefinition: 'PlanDefinition',
    practitioner: 'Practitioner',
    practitionerrole: 'PractitionerRole',
    procedure: 'Procedure',
    provenance: 'Provenance',
    questionnaire: 'Questionnaire',
    questionnaireresponse: 'QuestionnaireResponse',
    relatedperson: 'RelatedPerson',
    requestgroup: 'RequestGroup',
    researchdefinition: 'ResearchDefinition',
    researchelementdefinition: 'ResearchElementDefinition',
    researchstudy: 'ResearchStudy',
    researchsubject: 'ResearchSubject',
    riskassessment: 'RiskAssessment',
    riskevidencesynthesis: 'RiskEvidenceSynthesis',
    schedule: 'Schedule',
    searchparameter: 'SearchParameter',
    servicerequest: 'ServiceRequest',
    slot: 'Slot',
    specimen: 'Specimen',
    specimendefinition: 'SpecimenDefinition',
    structuredefinition: 'StructureDefinition',
    structuremap: 'StructureMap',
    subscription: 'Subscription',
    substance: 'Substance',
    substancenucleicacid: 'SubstanceNucleicAcid',
    substancepolymer: 'SubstancePolymer',
    substanceprotein: 'SubstanceProtein',
    substancereferenceinformation: 'SubstanceReferenceInformation',
    substancesourcematerial: 'SubstanceSourceMaterial',
    substancespecification: 'SubstanceSpecification',
    supplydelivery: 'SupplyDelivery',
    supplyrequest: 'SupplyRequest',
    task: 'Task',
    terminologycapabilities: 'TerminologyCapabilities',
    testreport: 'TestReport',
    testscript: 'TestScript',
    valueset: 'ValueSet',
    verificationresult: 'VerificationResult',
    visionprescription: 'VisionPrescription',
};

function inferResourceTypeFromPath(path: string): string | undefined {
    const firstPathSegment = path.split(/[.[/:]/)[0]?.toLowerCase();
    if (!firstPathSegment) return undefined;
    return KNOWN_RESOURCE_TYPE_BY_LOWERCASE[firstPathSegment];
}

function normalizeResourceType(resourceType: string, path: string): string {
    if (resourceType && resourceType !== 'Unknown') return resourceType;
    return inferResourceTypeFromPath(path) ?? resourceType;
}

/**
 * Reset the issue counter (useful for testing).
 */
export function resetIssueCounter(): void {
    issueCounter = 0;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a standardized ValidationIssue object.
 *
 * @example
 * ```typescript
 * const issue = createValidationIssue({
 *   code: 'terminology-binding-required',
 *   path: 'Patient.gender',
 *   resourceType: 'Patient',
 *   messageParams: {
 *     code: 'invalid-code',
 *     system: 'http://example.org',
 *     valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
 *   },
 * });
 * ```
 */
export function createValidationIssue(params: CreateIssueParams): ValidationIssue {
    const {
        code,
        path,
        resourceType: rawResourceType,
        messageParams = {},
        customMessage,
        profile,
        details,
        severityOverride,
        aspectOverride,
        ruleId,
    } = params;
    const resourceType = normalizeResourceType(rawResourceType, path);

    // Resolve any aliases to canonical codes
    const resolvedCode = resolveCode(code);
    const metadata = getCodeMetadata(code);

    // Determine aspect and severity (with overrides)
    const aspect: ValidationAspect = aspectOverride || metadata?.aspect || 'structural';
    const severity: ValidationSeverity = severityOverride || metadata?.severity || 'warning';

    // Generate message
    const message = customMessage || formatMessage(resolvedCode, messageParams);
    const humanReadable = getHumanReadableMessage(resolvedCode, messageParams);

    // Build details object
    const issueDetails: Record<string, unknown> = {
        ...details,
        fieldPath: path,
        resourceType,
        validationType: `${aspect}-validation`,
    };

    // Add message params to details for potential hydration
    for (const [key, value] of Object.entries(messageParams)) {
        if (!(key in issueDetails)) {
            issueDetails[key] = value;
        }
    }

    return {
        id: generateIssueId(aspect, resolvedCode),
        aspect,
        severity,
        code: resolvedCode,
        message,
        humanReadable,
        path,
        details: issueDetails,
        validationMethod: `${aspect}-validation`,
        timestamp: new Date().toISOString(),
        resourceType,
        schemaVersion: 'R4',
        profile,
        ruleId,
    };
}

// ============================================================================
// Convenience Factories
// ============================================================================

/**
 * Create a terminology binding violation issue.
 * Uses different message templates for primitive codes (no system) vs Coding types (with system).
 */
export function createBindingViolation(params: {
    strength: 'required' | 'extensible' | 'preferred' | 'example';
    code: string;
    system?: string;
    valueSet: string;
    path: string;
    resourceType: string;
    profile?: string;
}): ValidationIssue {
    // Detect if this is a primitive code type (no system) or a Coding type (with system)
    const hasSystem = params.system !== undefined && params.system !== '';

    // Use -code variants for primitive code types (without system)
    const codeMap = hasSystem ? {
        required: 'terminology-binding-required',
        extensible: 'terminology-binding-extensible',
        preferred: 'terminology-binding-preferred',
        example: 'terminology-binding-example',
    } as const : {
        required: 'terminology-binding-required-code',
        extensible: 'terminology-binding-extensible-code',
        preferred: 'terminology-binding-preferred-code',
        example: 'terminology-binding-example-code',
    } as const;

    return createValidationIssue({
        code: codeMap[params.strength],
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        messageParams: hasSystem ? {
            code: params.code,
            system: params.system,
            valueSet: params.valueSet,
        } : {
            code: params.code,
            valueSet: params.valueSet,
        },
    });
}

/**
 * Create a required element missing issue.
 */
export function createRequiredElementMissing(params: {
    element: string;
    path: string;
    resourceType: string;
    profile?: string;
}): ValidationIssue {
    return createValidationIssue({
        code: 'structural-required-element-missing',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        messageParams: {
            element: params.element,
        },
    });
}

/**
 * Create a reference type mismatch issue.
 */
export function createReferenceTypeMismatch(params: {
    actual: string;
    allowed: string[];
    path: string;
    resourceType: string;
}): ValidationIssue {
    return createValidationIssue({
        code: 'reference-type-mismatch',
        path: params.path,
        resourceType: params.resourceType,
        messageParams: {
            actual: params.actual,
            allowed: params.allowed.join(', '),
        },
    });
}

/**
 * Create a constraint violation issue.
 */
export function createConstraintViolation(params: {
    key: string;
    message: string;
    path: string;
    resourceType: string;
    profile?: string;
    severity?: ValidationSeverity;
}): ValidationIssue {
    return createValidationIssue({
        code: 'profile-constraint-violation',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        severityOverride: params.severity,
        messageParams: {
            key: params.key,
            message: params.message,
        },
    });
}

/**
 * Create a generic validation error issue.
 */
export function createValidationError(params: {
    message: string;
    path: string;
    resourceType: string;
    aspect?: ValidationAspect;
}): ValidationIssue {
    return createValidationIssue({
        code: 'validation-error',
        path: params.path,
        resourceType: params.resourceType,
        aspectOverride: params.aspect,
        customMessage: params.message,
    });
}
