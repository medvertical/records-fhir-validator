import { isFhirResource, type FhirResource } from '../core/fhir-resource.js';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { getEvaluationContext } from './constraint-path-utils.js';

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
 *   $this is X   →  true | false   (when the element type is known and no
 *                                   iterator function rebinds `$this`)
 *
 * The `is` substitution matters for choice elements: fhirpath.js types a bare
 * `effectiveDateTime` value as System.String, so `$this is dateTime` yields
 * false even when the instance IS a dateTime — which inverts xor/implies
 * invariants (e.g. au-core-obs-02) into spurious violations.
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

/**
 * Resolve the concrete types behind the FHIRPath environment variables for a
 * particular validation target. `%resource` is the nearest resource that
 * contains the target, while `%rootResource` always remains the outer input.
 */
export function resolveTypeLiteralContext(
  rootResource: FhirResource,
  elementPath: string,
  declaredElementType: string | null,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): PreprocessContext {
  const evaluationContext = getEvaluationContext(rootResource, elementPath);
  let concreteContextType = isFhirResource(evaluationContext)
    ? evaluationContext.resourceType
    : declaredElementType;

  const pathSegments = elementPath.split('.');
  let containingResourceType = rootResource.resourceType;
  let containingResourcePathEnd = 1;
  for (let end = pathSegments.length - 1; end >= 1; end--) {
    const ancestor = getEvaluationContext(rootResource, pathSegments.slice(0, end).join('.'));
    if (isFhirResource(ancestor)) {
      containingResourceType = ancestor.resourceType;
      containingResourcePathEnd = end;
      break;
    }
  }

  if (!concreteContextType) {
    const relativePath = pathSegments
      .slice(containingResourcePathEnd)
      .map(segment => segment.replace(/\[\d+\]$/g, ''))
      .join('.');
    const modelPath = relativePath
      ? `${containingResourceType}.${relativePath}`
      : containingResourceType;
    concreteContextType = (getFhirPathModel(fhirVersion).path2Type as Record<string, string>)[modelPath] ?? null;
  }

  return {
    elementType: concreteContextType,
    resourceType: containingResourceType,
    rootResourceType: rootResource.resourceType,
  };
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
  result = substituteThisTypeTests(result, ctx.elementType);
  return result;
}

/**
 * FHIR type names whose `is` outcome we can decide with confidence, plus
 * the specialization chains FHIRPath's `is` honours (code is-a string, …).
 * Abstract bases (Element, Resource) are deliberately absent — anything
 * outside these tables is left for fhirpath.js.
 */
const DECIDABLE_FHIR_TYPES = new Set([
  'base64Binary', 'boolean', 'canonical', 'code', 'date', 'dateTime',
  'decimal', 'id', 'instant', 'integer', 'markdown', 'oid', 'positiveInt',
  'string', 'time', 'unsignedInt', 'uri', 'url', 'uuid',
  'Address', 'Age', 'Annotation', 'Attachment', 'CodeableConcept', 'Coding',
  'ContactPoint', 'Count', 'Distance', 'Duration', 'HumanName', 'Identifier',
  'Money', 'Period', 'Quantity', 'Range', 'Ratio', 'Reference', 'SampledData',
  'Signature', 'SimpleQuantity', 'Timing',
]);

const FHIR_TYPE_ANCESTORS: Record<string, string[]> = {
  code: ['string'], id: ['string'], markdown: ['string'],
  canonical: ['uri'], oid: ['uri'], url: ['uri'], uuid: ['uri'],
  positiveInt: ['integer'], unsignedInt: ['integer'],
  Age: ['Quantity'], Count: ['Quantity'], Distance: ['Quantity'],
  Duration: ['Quantity'], SimpleQuantity: ['Quantity'],
};

const THIS_IS_TYPE = /\$this\s+is\s+(?:FHIR\.)?([A-Za-z][A-Za-z0-9]*)\b/g;
/** Functions whose criteria argument rebinds `$this` to iteration items. */
const THIS_REBINDING_CALL = /\b(?:where|select|all|exists|repeat|aggregate)\s*\(\s*[^)\s]/;

function substituteThisTypeTests(expression: string, elementType: string | null): string {
  if (elementType === null || THIS_REBINDING_CALL.test(expression)) return expression;
  return expression.replace(THIS_IS_TYPE, (full, testedType: string) => {
    if (testedType === elementType) return 'true';
    if (FHIR_TYPE_ANCESTORS[elementType]?.includes(testedType)) return 'true';
    if (DECIDABLE_FHIR_TYPES.has(testedType) && DECIDABLE_FHIR_TYPES.has(elementType)) {
      return 'false';
    }
    return full;
  });
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
