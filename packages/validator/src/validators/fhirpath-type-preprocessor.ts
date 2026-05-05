/**
 * FHIRPath Type-Literal Preprocessor
 * ----------------------------------
 *
 * fhirpath.js evaluates expressions against raw JavaScript values. Raw objects
 * have no FHIR TypeInfo, so queries like `%context.type().name = 'Reference'`
 * resolve the `.type()` call to `{name: 'Object', namespace: 'System'}`,
 * regardless of the actual FHIR element type — and the constraint
 * silently fails.
 *
 * This preprocessor runs before `fhirpath.compile` / `fhirpath.evaluate` and
 * substitutes the three common type-literal patterns with boolean constants,
 * using the FHIR element type information that we already have from the
 * owning StructureDefinition:
 *
 *   %context.type().name       = 'X'  →  true | false
 *   %resource.type().name      = 'X'  →  true | false
 *   %rootResource.type().name  = 'X'  →  true | false
 *
 *   %context.type().name       in (...)  →  true | false
 *   %resource.type().name      in (...)  →  true | false
 *   %rootResource.type().name  in (...)  →  true | false
 *
 * Anything we can't resolve is left untouched so fhirpath.js can keep
 * evaluating. The substitution is **lossless for correct expressions** —
 * the same boolean is what fhirpath.js would compute if it had TypeInfo.
 */

export interface PreprocessContext {
  /** The FHIR element's declared type (e.g. 'Reference', 'HumanName',
   *  'Practitioner' when typed by a profile). `null` when the element has
   *  no declared type or a polymorphic/abstract type. */
  elementType: string | null;
  /** The containing resource's type — `%resource`. */
  resourceType: string;
  /** The outermost (non-contained) resource's type — `%rootResource`. */
  rootResourceType: string;
}

const CONTEXT_TYPE = /%context\s*\.\s*type\s*\(\s*\)\s*\.\s*name/g;
const RESOURCE_TYPE = /%resource\s*\.\s*type\s*\(\s*\)\s*\.\s*name/g;
const ROOT_RESOURCE_TYPE = /%rootResource\s*\.\s*type\s*\(\s*\)\s*\.\s*name/g;

/**
 * Preprocess a FHIRPath expression, substituting the three supported
 * type-literal patterns with boolean constants derived from `ctx`.
 */
export function preprocessTypeLiterals(
  expression: string,
  ctx: PreprocessContext,
): string {
  if (!expression) return expression;

  let result = expression;
  result = substituteEquality(result, CONTEXT_TYPE, ctx.elementType);
  result = substituteEquality(result, RESOURCE_TYPE, ctx.resourceType);
  result = substituteEquality(result, ROOT_RESOURCE_TYPE, ctx.rootResourceType);
  result = substituteMembership(result, CONTEXT_TYPE, ctx.elementType);
  result = substituteMembership(result, RESOURCE_TYPE, ctx.resourceType);
  result = substituteMembership(result, ROOT_RESOURCE_TYPE, ctx.rootResourceType);
  return result;
}

function substituteEquality(
  expression: string,
  lhsRegex: RegExp,
  typeValue: string | null,
): string {
  if (typeValue === null) return expression;
  const pattern = new RegExp(
    `${lhsRegex.source}\\s*(=|!=)\\s*'([^']+)'`,
    'g',
  );
  return expression.replace(pattern, (_full, op: string, literal: string) => {
    const equals = literal === typeValue;
    const truth = op === '=' ? equals : !equals;
    return truth ? 'true' : 'false';
  });
}

function substituteMembership(
  expression: string,
  lhsRegex: RegExp,
  typeValue: string | null,
): string {
  if (typeValue === null) return expression;
  const pattern = new RegExp(
    `${lhsRegex.source}\\s+in\\s*\\(([^)]+)\\)`,
    'g',
  );
  return expression.replace(pattern, (_full, list: string) => {
    const names = Array.from(list.matchAll(/'([^']+)'/g)).map(m => m[1]);
    const truth = names.includes(typeValue);
    return truth ? 'true' : 'false';
  });
}

/**
 * Resolve an element's declared FHIR type from a single ElementDefinition.
 * Returns `null` for polymorphic (`[x]`) paths or elements without `type[]`.
 */
export function resolveElementType(
  element: { type?: Array<{ code?: string }>; path?: string } | undefined,
): string | null {
  if (!element?.type || element.type.length === 0) return null;
  if (element.type.length > 1) return null;
  const code = element.type[0].code;
  return code ?? null;
}
