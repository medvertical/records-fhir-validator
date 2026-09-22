/**
 * XML attribute text to FHIR JSON value coercion. The definitions win when
 * they describe the element; the name heuristics run only where they do not --
 * unknown resources and logical models.
 */

const BOOLEAN_ELEMENTS = new Set([
  'abstract', 'active', 'caseSensitive', 'compositional', 'experimental',
  'immutable', 'isModifier', 'isSummary', 'mustSupport', 'preferred',
  'readOnly', 'required', 'userSelected', 'versionNeeded',
]);
const NUMERIC_ELEMENTS = new Set([
  'count', 'denominator', 'factor', 'min', 'numerator', 'offset', 'rank',
  'score', 'sequence', 'total',
]);
const NUMERIC_VALUE_PARENTS = new Set([
  'Age', 'Count', 'Distance', 'Duration', 'Money', 'Quantity', 'SimpleQuantity',
]);
const DECIMAL_ELEMENTS = new Set(['factor', 'offset', 'score']);


const JSON_NUMERIC_TYPES = new Set(['decimal', 'integer', 'positiveInt', 'unsignedInt']);
/** FHIR decimal, which permits an exponent. */
const FHIR_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
/** FHIR integer, positiveInt and unsignedInt, which do not. */
const FHIR_INTEGER = /^-?(?:0|[1-9]\d*)$/u;

export function primitiveValue(
  parent: string | undefined,
  name: string,
  value: string,
  declaredType?: string,
): string | number | boolean {
  // The definitions win when they describe this element. The name heuristics
  // below only run where they do not — unknown resources and logical models.
  if (declaredType) {
    if (declaredType === 'boolean') {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }
    if (declaredType === 'integer64') return value;
    if (JSON_NUMERIC_TYPES.has(declaredType)) {
      // FHIR `decimal` admits an exponent; the integer types do not. Without
      // the exponent branch, `1e1` and `0.1e11` stayed strings and the
      // validator then reported a type mismatch against the element's own
      // declared decimal type.
      const pattern = declaredType === 'decimal' ? FHIR_DECIMAL : FHIR_INTEGER;
      if (pattern.test(value)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
    }
    return value;
  }
  const booleanElement = BOOLEAN_ELEMENTS.has(name) || name.endsWith('Boolean');
  if (booleanElement && value === 'true') return true;
  if (booleanElement && value === 'false') return false;
  if (name.endsWith('Integer64')) return value;
  const numericElement = NUMERIC_ELEMENTS.has(name)
    || /(?:Decimal|Integer|PositiveInt|UnsignedInt)$/.test(name)
    || (name === 'value' && parent !== undefined && NUMERIC_VALUE_PARENTS.has(parent));
  const exponentAllowed = name.endsWith('Decimal')
    || DECIMAL_ELEMENTS.has(name)
    || (name === 'value' && parent !== undefined && NUMERIC_VALUE_PARENTS.has(parent));
  if (numericElement && FHIR_DECIMAL.test(value) && (exponentAllowed || !/[eE]/.test(value))) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
}
