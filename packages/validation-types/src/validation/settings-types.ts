/**
 * Validation Settings Types and Constants
 * 
 * Shared types, constants, and enums for validation settings.
 */

import type { ValidationAspect } from './enums';

// ============================================================================
// Conformance/Infrastructure Resource Types (excluded from bulk validation)
// These are definitional/infrastructure resources, not clinical data.
// ============================================================================

export const CONFORMANCE_RESOURCE_TYPES = [
  'CapabilityStatement', 'CodeSystem', 'CompartmentDefinition', 'ConceptMap',
  'GraphDefinition', 'ImplementationGuide', 'MessageDefinition', 'NamingSystem',
  'OperationDefinition', 'SearchParameter', 'StructureDefinition', 'StructureMap',
  'TerminologyCapabilities', 'ValueSet',
  // Infrastructure resource types
  'Binary', 'Bundle', 'OperationOutcome', 'Parameters',
] as const;

// ============================================================================
// Common FHIR Resource Types
// ============================================================================

export const COMMON_FHIR_RESOURCE_TYPES = [
  'Patient',
  'Observation',
  'Condition',
  'Medication',
  'MedicationRequest',
  'Encounter',
  'DiagnosticReport',
  'Procedure',
  'AllergyIntolerance',
  'Immunization',
  'Organization',
  'Practitioner',
  'PractitionerRole',
  'Location',
  'Device',
  'Specimen',
  'DocumentReference',
  'ImagingStudy',
  'CarePlan',
  'Goal',
  'ServiceRequest',
  'Task',
  'Questionnaire',
  'QuestionnaireResponse',
  'Appointment',
  'Schedule',
  'Slot',
  'Account',
  'ChargeItem',
  'Invoice',
  'PaymentNotice',
  'PaymentReconciliation',
  'Coverage',
  'CoverageEligibilityRequest',
  'CoverageEligibilityResponse',
  'EnrollmentRequest',
  'EnrollmentResponse',
  'Claim',
  'ClaimResponse',
  'ExplanationOfBenefit',
  'InsurancePlan',
  'MedicinalProduct',
  'MedicinalProductAuthorization',
  'MedicinalProductContraindication',
  'MedicinalProductIndication',
  'MedicinalProductIngredient',
  'MedicinalProductInteraction',
  'MedicinalProductManufactured',
  'MedicinalProductPackaged',
  'MedicinalProductPharmaceutical',
  'MedicinalProductUndesirableEffect',
  'Substance',
  'SubstanceNucleicAcid',
  'SubstancePolymer',
  'SubstanceProtein',
  'SubstanceReferenceInformation',
  'SubstanceSourceMaterial',
  'SubstanceSpecification',
  'ActivityDefinition',
  'PlanDefinition',
  'ResearchDefinition',
  'ResearchElementDefinition',
  'ResearchStudy',
  'ResearchSubject',
  'CatalogEntry',
  'EventDefinition',
  'Evidence',
  'EvidenceVariable',
  'ExampleScenario',
  'GuidanceResponse',
  'Library',
  'Measure',
  'MeasureReport',
  'MessageDefinition',
  'MessageHeader',
  'NamingSystem',
  'OperationDefinition',
  'OperationOutcome',
  'Parameters',
  'SearchParameter',
  'StructureDefinition',
  'StructureMap',
  'TerminologyCapabilities',
  'TestScript',
  'ValueSet',
  'ConceptMap',
  'CodeSystem',
  'CompartmentDefinition',
  'GraphDefinition',
  'ImplementationGuide',
  'CapabilityStatement',
  'AuditEvent',
  'Provenance',
  'Consent',
  'Contract',
  'Composition',
  'List',
  'Bundle',
  'Binary',
  'DomainResource',
  'Resource'
] as const;

export type CommonFhirResourceType = typeof COMMON_FHIR_RESOURCE_TYPES[number];

// ============================================================================
// FHIR Version-Aware Resource Type Constants
// ============================================================================

// Complete R4 Resource Types (143 total in R4)
export const R4_ALL_RESOURCE_TYPES = [
  'Account', 'ActivityDefinition', 'AdverseEvent', 'AllergyIntolerance', 'Appointment',
  'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary', 'BiologicallyDerivedProduct',
  'BodyStructure', 'Bundle', 'CapabilityStatement', 'CarePlan', 'CareTeam',
  'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition', 'Claim', 'ClaimResponse',
  'ClinicalImpression', 'CodeSystem', 'Communication', 'CommunicationRequest',
  'CompartmentDefinition', 'Composition', 'ConceptMap', 'Condition', 'Consent',
  'Contract', 'Coverage', 'CoverageEligibilityRequest', 'CoverageEligibilityResponse',
  'DetectedIssue', 'Device', 'DeviceDefinition', 'DeviceMetric', 'DeviceRequest',
  'DeviceUseStatement', 'DiagnosticReport', 'DocumentManifest', 'DocumentReference',
  'EffectEvidenceSynthesis', 'Encounter', 'Endpoint', 'EnrollmentRequest',
  'EnrollmentResponse', 'EpisodeOfCare', 'EventDefinition', 'Evidence',
  'EvidenceVariable', 'ExampleScenario', 'ExplanationOfBenefit', 'FamilyMemberHistory',
  'Flag', 'Goal', 'GraphDefinition', 'Group', 'GuidanceResponse', 'HealthcareService',
  'ImagingStudy', 'Immunization', 'ImmunizationEvaluation', 'ImmunizationRecommendation',
  'ImplementationGuide', 'InsurancePlan', 'Invoice', 'Library', 'Linkage', 'List',
  'Location', 'Measure', 'MeasureReport', 'Media', 'Medication', 'MedicationAdministration',
  'MedicationDispense', 'MedicationKnowledge', 'MedicationRequest', 'MedicationStatement',
  'MedicinalProduct', 'MedicinalProductAuthorization', 'MedicinalProductContraindication',
  'MedicinalProductIndication', 'MedicinalProductIngredient', 'MedicinalProductInteraction',
  'MedicinalProductManufactured', 'MedicinalProductPackaged', 'MedicinalProductPharmaceutical',
  'MedicinalProductUndesirableEffect', 'MessageDefinition', 'MessageHeader',
  'MolecularSequence', 'NamingSystem', 'NutritionOrder', 'Observation', 'ObservationDefinition',
  'OperationDefinition', 'OperationOutcome', 'Organization', 'OrganizationAffiliation',
  'Parameters', 'Patient', 'PaymentNotice', 'PaymentReconciliation', 'Person',
  'PlanDefinition', 'Practitioner', 'PractitionerRole', 'Procedure', 'Provenance',
  'Questionnaire', 'QuestionnaireResponse', 'RelatedPerson', 'RequestGroup',
  'ResearchDefinition', 'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject',
  'RiskAssessment', 'RiskEvidenceSynthesis', 'Schedule', 'SearchParameter',
  'ServiceRequest', 'Slot', 'Specimen', 'SpecimenDefinition', 'StructureDefinition',
  'StructureMap', 'Subscription', 'Substance', 'SubstanceNucleicAcid', 'SubstancePolymer',
  'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
  'SubstanceSpecification', 'SupplyDelivery', 'SupplyRequest', 'Task', 'TerminologyCapabilities',
  'TestReport', 'TestScript', 'ValueSet', 'VerificationResult', 'VisionPrescription'
] as const;

// Complete R5 Resource Types (154 total in R5)
export const R5_ALL_RESOURCE_TYPES = [
  ...R4_ALL_RESOURCE_TYPES,
  // R5-specific new resource types
  'Citation', 'EvidenceReport', 'InventoryReport', 'RegulatedAuthorization',
  'SubstanceDefinition', 'Transport'
] as const;

// R4 Default included resource types (most important for validation)
export const R4_DEFAULT_INCLUDED_RESOURCE_TYPES = [
  // Core Clinical Resources (R4)
  'Bundle', 'Patient', 'Observation', 'Condition', 'Encounter', 'Procedure',
  'Medication', 'MedicationRequest', 'DiagnosticReport', 'AllergyIntolerance',
  'Immunization', 'CarePlan', 'Goal', 'ServiceRequest',

  // Administrative Resources (R4)
  'Organization', 'Practitioner', 'PractitionerRole', 'Location',
  'DocumentReference', 'Composition', 'List', 'Appointment', 'Schedule', 'Slot'
];

// R5 Default included resource types (most important for validation)
export const R5_DEFAULT_INCLUDED_RESOURCE_TYPES = [
  // Core Clinical Resources (R5 - includes new types)
  'Bundle', 'Patient', 'Observation', 'Condition', 'Encounter', 'Procedure',
  'Medication', 'MedicationRequest', 'DiagnosticReport', 'AllergyIntolerance',
  'Immunization', 'CarePlan', 'Goal', 'ServiceRequest',

  // Administrative Resources (R5)
  'Organization', 'Practitioner', 'PractitionerRole', 'Location',
  'DocumentReference', 'Composition', 'List', 'Appointment', 'Schedule', 'Slot',

  // R5-specific new resource types
  'Evidence', 'EvidenceReport', 'EvidenceVariable', 'Citation'
];

// ============================================================================
// Validation Aspect Constants
// ============================================================================

export const VALIDATION_ASPECTS: ValidationAspect[] = [
  'structural',
  'profile',
  'terminology',
  'reference',
  'invariant',
  'customRule',
  'metadata',
  'anomaly'
];

export const VALIDATION_ASPECT_LABELS: Record<ValidationAspect, string> = {
  structural: 'Structural Validation',
  profile: 'Profile Validation',
  terminology: 'Terminology Validation',
  reference: 'Reference Validation',
  invariant: 'Invariants',
  customRule: 'Custom Rules',
  metadata: 'Metadata Validation',
  anomaly: 'Anomaly Detection'
};

export const VALIDATION_ASPECT_DESCRIPTIONS: Record<ValidationAspect, string> = {
  structural: 'Validates basic structure, required fields, data types, and cardinality constraints',
  profile: 'Validates conformance to declared FHIR profiles and their constraints',
  terminology: 'Validates codes against code systems, value sets, and terminology bindings',
  reference: 'Verifies that references to other resources are valid and resolvable',
  invariant: 'Validates standard FHIR invariants and profile constraints (e.g. ele-1)',
  customRule: 'Validates user-defined business logic and custom constraints',
  metadata: 'Validates resource metadata and provenance',
  anomaly: 'Cross-resource batch analysis: duplicates, orphan references, value-range outliers, temporal gaps'
};
