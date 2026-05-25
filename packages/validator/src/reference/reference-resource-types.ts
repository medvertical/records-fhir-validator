/**
 * Known FHIR R4/R5 resource types for reference parsing and validation.
 */
export const KNOWN_FHIR_RESOURCE_TYPES = new Set([
  // Foundation
  'Resource', 'DomainResource', 'Element', 'BackboneElement', 'Narrative',

  // Clinical
  'Patient', 'Practitioner', 'PractitionerRole', 'RelatedPerson', 'Person', 'Group',
  'Organization', 'OrganizationAffiliation', 'Location', 'HealthcareService', 'Endpoint',
  'Device', 'DeviceDefinition', 'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement',
  'Substance', 'SubstanceDefinition', 'SubstanceNucleicAcid', 'SubstancePolymer',
  'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
  'SubstanceSpecification', 'Medication', 'MedicationAdministration', 'MedicationDispense',
  'MedicationKnowledge', 'MedicationRequest', 'MedicationStatement', 'MedicationUsage',
  'Immunization', 'ImmunizationEvaluation', 'ImmunizationRecommendation',

  // Diagnostics
  'Observation', 'DiagnosticReport', 'ServiceRequest', 'Specimen', 'SpecimenDefinition',
  'BodyStructure', 'ImagingStudy', 'Media', 'QuestionnaireResponse',

  // Care Management
  'Condition', 'Procedure', 'AllergyIntolerance', 'AdverseEvent', 'DetectedIssue',
  'ClinicalImpression', 'RiskAssessment', 'FamilyMemberHistory', 'Goal', 'CarePlan',
  'CareTeam', 'ServiceRequest', 'NutritionOrder', 'VisionPrescription',

  // Request & Response
  'Task', 'Appointment', 'AppointmentResponse', 'Schedule', 'Slot', 'Encounter',
  'EpisodeOfCare', 'Flag', 'List', 'Library', 'Measure', 'MeasureReport',

  // Foundation
  'Composition', 'DocumentManifest', 'DocumentReference', 'CatalogEntry',
  'Basic', 'Binary', 'Bundle', 'Linkage', 'MessageDefinition', 'MessageHeader',
  'OperationDefinition', 'OperationOutcome', 'Parameters', 'Subscription',
  'SubscriptionStatus', 'SubscriptionTopic',

  // Conformance
  'CapabilityStatement', 'StructureDefinition', 'StructureMap', 'ImplementationGuide',
  'SearchParameter', 'CompartmentDefinition', 'ExampleScenario', 'GraphDefinition',
  'TestReport', 'TestScript',

  // Terminology
  'CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem', 'TerminologyCapabilities',

  // Security
  'AuditEvent', 'Consent', 'Provenance', 'Signature',

  // Financial
  'Account', 'ChargeItem', 'ChargeItemDefinition', 'Contract', 'Coverage',
  'CoverageEligibilityRequest', 'CoverageEligibilityResponse', 'EnrollmentRequest',
  'EnrollmentResponse', 'Claim', 'ClaimResponse', 'Invoice', 'PaymentNotice',
  'PaymentReconciliation', 'ExplanationOfBenefit', 'InsurancePlan',

  // Specialized
  'Citation', 'Evidence', 'EvidenceReport', 'EvidenceVariable', 'ResearchDefinition',
  'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject', 'ActivityDefinition',
  'PlanDefinition', 'Questionnaire', 'Requirements', 'ActorDefinition',
]);

export const KNOWN_FHIR_RESOURCE_TYPES_BY_LOWERCASE = new Map(
  Array.from(KNOWN_FHIR_RESOURCE_TYPES, resourceType => [resourceType.toLowerCase(), resourceType]),
);

/**
 * Common FHIR canonical URL patterns for conformance resources.
 * These are not regular resource instance URLs.
 */
export const CANONICAL_PATTERNS = [
  /^https?:\/\/hl7\.org\/fhir\/StructureDefinition\//,
  /^https?:\/\/hl7\.org\/fhir\/ValueSet\//,
  /^https?:\/\/hl7\.org\/fhir\/CodeSystem\//,
  /^https?:\/\/hl7\.org\/fhir\/ConceptMap\//,
  /^https?:\/\/hl7\.org\/fhir\/ImplementationGuide\//,
  /^https?:\/\/fhir\.kbv\.de\/StructureDefinition\//,
  /^https?:\/\/fhir\.de\/StructureDefinition\//,
  /^https?:\/\/.*\.medizininformatik-initiative\.de\/fhir\//,
  /^https?:\/\/build\.fhir\.org\/ig\//,
  /^https?:\/\/simplifier\.net\/.*\/StructureDefinition\//,
];

const FHIR_VERSION_PATH_SEGMENTS = new Set(['r2', 'r3', 'r4', 'r4b', 'r5', 'dstu2', 'stu3']);

export function isFhirVersionPathSegment(segment: string | undefined): boolean {
  return !!segment && FHIR_VERSION_PATH_SEGMENTS.has(segment.toLowerCase());
}

export function getKnownFhirResourceTypes(): string[] {
  return Array.from(KNOWN_FHIR_RESOURCE_TYPES);
}
