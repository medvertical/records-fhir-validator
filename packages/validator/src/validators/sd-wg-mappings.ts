/**
 * HL7 Work Group → expected publisher + committee URL mappings.
 *
 * Used by `structure-definition-validator.ts` to check that a canonical
 * resource's `publisher` and `contact[].telecom` entries are consistent
 * with the `structuredefinition-wg` extension value.
 */

export const WG_PUBLISHER: Record<string, string> = {
  fhir: 'HL7 International / FHIR Infrastructure',
  oo: 'HL7 International / Orders and Observations',
  pa: 'HL7 International / Patient Administration',
  sd: 'HL7 International / Structured Documents',
  fm: 'HL7 International / Financial Management',
  cds: 'HL7 International / Clinical Decision Support',
  cqi: 'HL7 International / Clinical Quality Information',
  phx: 'HL7 International / Pharmacy',
  brr: 'HL7 International / Biomedical Research and Regulation',
  pher: 'HL7 International / Public Health',
  sec: 'HL7 International / Security',
  us: 'HL7 International / US Realm Steering Committee',
  ii: 'HL7 International / Imaging Integration',
  dev: 'HL7 International / Health Care Devices',
  mnm: 'HL7 International / Modeling and Methodology',
  aid: 'HL7 International / Application Implementation and Design',
  cgp: 'HL7 International / Clinical Genomics',
  pc: 'HL7 International / Patient Care',
  vocab: 'HL7 International / Terminology Infrastructure',
  ehr: 'HL7 International / EHR',
  ec: 'HL7 International / Emergency Care',
  inm: 'HL7 International / Infrastructure and Messaging',
};

export const WG_CONTACT_URL: Record<string, string> = {
  fhir: 'http://www.hl7.org/Special/committees/fiwg',
  oo: 'http://www.hl7.org/Special/committees/orders',
  pa: 'http://www.hl7.org/Special/committees/pafm',
  sd: 'http://www.hl7.org/Special/committees/structure',
  fm: 'http://www.hl7.org/Special/committees/fm',
  cds: 'http://www.hl7.org/Special/committees/dss',
  cqi: 'http://www.hl7.org/Special/committees/cqi',
  phx: 'http://www.hl7.org/Special/committees/medication',
  brr: 'http://www.hl7.org/Special/committees/rcrim',
  pher: 'http://www.hl7.org/Special/committees/pher',
  sec: 'http://www.hl7.org/Special/committees/secure',
  ii: 'http://www.hl7.org/Special/committees/imagemgt',
  dev: 'http://www.hl7.org/Special/committees/healthcaredevices',
  mnm: 'http://www.hl7.org/Special/committees/mnm',
  aid: 'http://www.hl7.org/Special/committees/java',
  cgp: 'http://www.hl7.org/Special/committees/clingenomics',
  pc: 'http://www.hl7.org/Special/committees/patientcare',
  vocab: 'http://www.hl7.org/Special/committees/Vocab',
  ehr: 'http://www.hl7.org/Special/committees/ehr',
  inm: 'http://www.hl7.org/Special/committees/inm',
};

/** Known valid FHIR choice-type suffixes. */
export const VALID_CHOICE_TYPE_SUFFIXES = new Set([
  'String', 'Boolean', 'Integer', 'Decimal', 'DateTime', 'Date', 'Time',
  'Instant', 'Uri', 'Url', 'Canonical', 'Base64Binary', 'Code', 'Oid', 'Id',
  'Markdown', 'UnsignedInt', 'PositiveInt', 'Uuid', 'Quantity', 'Range',
  'Ratio', 'Period', 'Coding', 'CodeableConcept', 'Reference',
  'Attachment', 'Address', 'Age', 'Annotation', 'ContactPoint',
  'Duration', 'HumanName', 'Money', 'SampledData', 'Signature',
  'Timing', 'CodeableReference',
]);

/** Valid element names for context expressions in R4. */
export const R4_ELEMENT_DEFINITION_ELEMENTS = new Set([
  'id', 'extension', 'path', 'representation', 'sliceName', 'sliceIsConstraining',
  'label', 'code', 'slicing', 'short', 'definition', 'comment', 'requirements',
  'alias', 'min', 'max', 'base', 'contentReference', 'type', 'defaultValue',
  'meaningWhenMissing', 'orderMeaning', 'fixed', 'pattern', 'example',
  'minValue', 'maxValue', 'maxLength', 'condition', 'constraint', 'mustSupport',
  'isModifier', 'isModifierReason', 'isSummary', 'binding', 'mapping',
]);

/** Standards-status codes → allowed publication status values. */
export const STATUS_CONSISTENCY: Record<string, string[]> = {
  normative: ['active'],
  'trial-use': ['active', 'draft'],
  informative: ['active', 'draft'],
  draft: ['draft'],
  deprecated: ['retired'],
  external: ['active', 'draft'],
};

/** Choice-type base names used in differential path validation. */
export const CHOICE_TYPE_BASES = [
  'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
  'medication', 'reported', 'serviced', 'location', 'product', 'timing', 'item',
];

/** Canonical resource types that can carry the WG extension. */
export const CANONICAL_RESOURCE_TYPES = new Set([
  'StructureDefinition', 'ValueSet', 'CodeSystem',
  'OperationDefinition', 'SearchParameter',
  'CapabilityStatement', 'ConceptMap',
  'NamingSystem', 'ImplementationGuide',
  'Questionnaire', 'Measure',
  'Library', 'ActivityDefinition',
  'PlanDefinition', 'GraphDefinition',
  'CompartmentDefinition', 'StructureMap',
  'ExampleScenario', 'MessageDefinition',
  'TerminologyCapabilities', 'EventDefinition',
  'ChargeItemDefinition',
]);
