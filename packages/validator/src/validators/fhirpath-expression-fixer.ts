/**
 * Corrections the HL7 reference validator applies to invariant expressions
 * that were published wrongly in the core specifications
 * (org.hl7.fhir.validation FHIRPathExpressionFixer, validator 6.10.0).
 *
 * Evaluating the published text instead diverges from the reference
 * validator in both directions: `ras-2` fails every prediction without a
 * probability, while the published `que-12` misses two enableWhen conditions
 * without enableBehavior. The reference validator's rewrites for dom-6, txt-2
 * and con-3 are left out: specialised Records validators own those keys and
 * they never reach the generic evaluator.
 */

type FixerFhirVersion = 'R4' | 'R4B' | 'R5' | 'R6' | string | undefined;

const R4_REF_1 = "reference.startsWith('#').not() or (reference.substring(1).trace('url') in %rootResource.contained.id.trace('ids'))";
const R5_REF_1 = `${R4_REF_1} or (reference='#' and %rootResource!=%resource)`;

const EXPRESSION_FIXES = new Map<string, string>([
  [
    'probability is decimal implies (probability as decimal) <= 100',
    '(probability.exists() and (probability is decimal)) implies ((probability as decimal) <= 100)',
  ],
  [
    'enableWhen.count() > 2 implies enableBehavior.exists()',
    'enableWhen.count() >= 2 implies enableBehavior.exists()',
  ],
  [
    "generated='generated' implies source.empty()",
    "generation='generated' implies source.empty()",
  ],
  [
    "name.matches('[A-Z]([A-Za-z0-9_]){0,254}')",
    "name.exists() implies name.matches('^[A-Z]([A-Za-z0-9_]){0,254}$')",
  ],
  [
    "url.matches('([^|#])*')",
    "$this.matches('([^|#])*')",
  ],
  [
    "((kind in 'resource' | 'complex-type') and (specialization = 'derivation')) implies differential.element.where((min != 0 and min != 1) or (max != '1' and max != '*')).empty()",
    "((kind in 'resource' | 'complex-type') and (derivation = 'specialization')) implies differential.element.where((min.exists() and min != 0 and min != 1) or (max.exists() and max != '1' and max != '*')).empty()",
  ],
  [
    '(component.empty() and hasMember.empty()) implies (dataAbsentReason or value)',
    '(component.empty() and hasMember.empty()) implies (dataAbsentReason.exists() or value.exists())',
  ],
  [
    'isModifier implies isModifierReason.exists()',
    '(isModifier.exists() and isModifier) implies isModifierReason.exists()',
  ],
  [
    String.raw`(%resource.kind = 'logical' or element.first().path.startsWith(%resource.type)) and (element.tail().not() or  element.tail().all(path.startsWith(%resource.differential.element.first().path.replaceMatches('\\..*','')&'.')))`,
    String.raw`(%resource.kind = 'logical' or element.first().path.startsWith(%resource.type)) and (element.tail().empty() or  element.tail().all(path.startsWith(%resource.differential.element.first().path.replaceMatches('\\..*','')&'.')))`,
  ],
  [
    "differential.element.all(id) and differential.element.id.trace('ids').isDistinct()",
    "differential.element.all(id.exists()) and differential.element.id.trace('ids').isDistinct()",
  ],
  [
    "snapshot.element.all(id) and snapshot.element.id.trace('ids').isDistinct()",
    "snapshot.element.all(id.exists()) and snapshot.element.id.trace('ids').isDistinct()",
  ],
  [
    "(code or value.empty()) and (system.empty() or system = 'urn:iso:std:iso:4217')",
    "(code.exists() or value.empty()) and (system.empty() or system = 'urn:iso:std:iso:4217')",
  ],
  [
    'value.empty() or code!=component.code',
    'value.empty() or (code in component.code).not()',
  ],
  [
    '(code or value.empty()) and (system.empty() or system = %ucum) and (value.empty() or value > 0)',
    '(code.exists() or value.empty()) and (system.empty() or system = %ucum) and (value.empty() or value > 0)',
  ],
  [
    'element.all(definition and min and max)',
    'element.all(definition.exists() and min.exists() and max.exists())',
  ],
  ['telecom or endpoint', 'telecom.exists() or endpoint.exists()'],
  [
    "fullUrl.contains('/_history/').not()",
    "fullUrl.exists() implies fullUrl.contains('/_history/').not()",
  ],
  // ref-1 is empty — and so fails — for a Reference without `reference`.
  [R5_REF_1, `reference.exists() implies (${R5_REF_1})`],
  [R4_REF_1, `reference.exists() implies (reference = '#' or (${R4_REF_1}))`],
  [
    "reference.startsWith('#').not() or (reference.substring(1).trace('url') in %resource.contained.id.trace('ids'))",
    `reference.exists() implies (reference = '#' or (${R4_REF_1}))`,
  ],
  ["searchType implies type = 'string'", "searchType.exists() implies type = 'string'"],
  [
    "abatement.empty() or (abatement as boolean).not()  or clinicalStatus='resolved' or clinicalStatus='remission' or clinicalStatus='inactive'",
    "abatement.empty() or (abatement is boolean).not() or (abatement as boolean).not() or (clinicalStatus = 'resolved') or (clinicalStatus = 'remission') or (clinicalStatus = 'inactive')",
  ],
  [
    '(component.empty() and related.empty()) implies (dataAbsentReason or value)',
    '(component.empty() and related.empty()) implies (dataAbsentReason.exists() or value.exists())',
  ],
]);

const R4_TIMING_OFFSET = "offset.empty() or (when.exists() and ((when in ('C' | 'CM' | 'CD' | 'CV')).not()))";
const R4_RAS_2_FUNCTION_FORM = 'probability is decimal implies probability.as(decimal) <= 100';

function isR4Family(fhirVersion: FixerFhirVersion): boolean {
  return fhirVersion === 'R4' || fhirVersion === 'R4B';
}

export function fixKnownInvariantExpression(
  expression: string,
  key: string | undefined,
  fhirVersion: FixerFhirVersion,
): string {
  if (key === 'opd-3') {
    if (fhirVersion === 'R5') {
      return "targetProfile.exists() implies (type = 'Reference' or type = 'canonical' or type.memberOf('http://hl7.org/fhir/ValueSet/all-resource-types'))";
    }
    if (isR4Family(fhirVersion)) {
      return "targetProfile.exists() implies (type = 'Reference' or type = 'canonical' or type.memberOf('http://hl7.org/fhir/ValueSet/resource-types'))";
    }
  }
  if (key === 'que-7') {
    return "operator = 'exists' implies (answer is boolean)";
  }
  if (isR4Family(fhirVersion) && expression === R4_TIMING_OFFSET) {
    return "offset.empty() or (when.exists() and when.select($this in ('C' | 'CM' | 'CD' | 'CV')).allFalse())";
  }
  if (fhirVersion !== 'R5' && key === 'eld-19') {
    return String.raw`path.matches('^[^\\s\\.,:;\\\'"\\/|?!@#$%&*()\\[\\]{}]{1,64}(\\.[^\\s\\.,:;\\\'"\\/|?!@#$%&*()\\[\\]{}]{1,64}(\\[x\\])?(\\:[^\\s\\.]+)?)*$')`;
  }
  if (fhirVersion !== 'R5' && key === 'eld-20') {
    return String.raw`path.matches('^[A-Za-z][A-Za-z0-9]*(\\.[a-z][A-Za-z0-9]*(\\[x])?)*$')`;
  }
  if (key === 'ras-2' && expression === R4_RAS_2_FUNCTION_FORM) {
    return `probability.empty() or (${R4_RAS_2_FUNCTION_FORM})`;
  }
  return EXPRESSION_FIXES.get(expression) ?? expression;
}
