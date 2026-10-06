/** Lookup tables for the StructureDefinition business rules. */

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

export const R4_ELEMENT_DEFINITION_NESTED_CONTEXT_ELEMENTS = new Set([
  'type.code',
  'type.profile',
]);

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
