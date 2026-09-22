import type { ElementDefinition } from '../core/structure-definition-types.js';

/**
 * FHIR serializes fixed[x]/pattern[x] constraints with the datatype in the
 * property name. A malformed snapshot occasionally carries a constraint for
 * a datatype that the element cannot hold (for example patternCodeableConcept
 * on a code element). The Java validator ignores that unusable constraint, so
 * runtime validation must not compare the differently shaped values either.
 */
export function constraintTypeMatchesElement(
  elementDef: ElementDefinition,
  constraintKey: string,
): boolean {
  const prefix = constraintKey.startsWith('fixed')
    ? 'fixed'
    : constraintKey.startsWith('pattern')
      ? 'pattern'
      : null;
  if (!prefix || constraintKey === prefix) return true;

  const constrainedType = constraintKey.slice(prefix.length).toLowerCase();
  if (!constrainedType) return true;

  const declaredTypes = elementDef.type
    ?.map(type => normalizeTypeCode(type.code))
    .filter(Boolean) ?? [];
  if (declaredTypes.length === 0) return true;

  return declaredTypes.includes(constrainedType);
}

function normalizeTypeCode(typeCode: string): string {
  const fhirPathPrefix = 'http://hl7.org/fhirpath/System.';
  const normalized = typeCode.startsWith(fhirPathPrefix)
    ? typeCode.slice(fhirPathPrefix.length)
    : typeCode;
  return normalized.toLowerCase();
}
