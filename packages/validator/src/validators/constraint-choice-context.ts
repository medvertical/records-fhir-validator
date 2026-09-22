import {
  isConcreteChoiceProperty,
  splitConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';

export function expressionStartsAtResourceRoot(expression: string | undefined, resourceType: string): boolean {
  if (!expression || !resourceType) return false;
  const escapedResourceType = resourceType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:\\(\\s*)*${escapedResourceType}(?=\\.|\\b)`).test(expression);
}

export function getThisCastType(expression: string): string | null {
  const match = expression.match(/\$this\s+as\s+([A-Za-z][A-Za-z0-9]*)/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function choiceContextHasOnlyOtherTypes(
  ctx: unknown,
  choiceElementName: string,
  castType: string,
): boolean {
  const choiceTypes = getChoiceTypesInContext(ctx, choiceElementName);
  return choiceTypes.length > 0 && choiceTypes.every(choiceType => choiceType !== castType.toLowerCase());
}

export function hasUnresolvableChoiceTypes(ctx: unknown, expression: string): boolean {
  if (!isObjectRecord(ctx)) return false;
  const keys = Object.keys(ctx);
  const choiceBases = new Set(
    keys
      .map(choiceBaseNameForContextKey)
      .filter((base): base is string => base !== undefined),
  );
  for (const base of choiceBases) {
    if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
    if (ctx[base] !== undefined) continue;
    return true;
  }
  return false;
}

/**
 * A choice element can be present through its underscore sidecar alone
 * (`_valueBoolean` carrying a data-absent-reason extension), so sidecar keys
 * must feed choice-base detection just like concrete keys — otherwise
 * `value.exists()` is evaluated against a context fhirpath.js cannot type.
 */
function choiceBaseNameForContextKey(key: string): string | undefined {
  const concreteKey = key.startsWith('_') ? key.slice(1) : key;
  return splitConcreteChoiceProperty(concreteKey)?.baseName;
}

function getChoiceTypesInContext(ctx: unknown, choiceElementName: string): string[] {
  if (Array.isArray(ctx)) {
    return ctx.flatMap(item => getChoiceTypesInContext(item, choiceElementName));
  }

  if (!isObjectRecord(ctx)) return [];

  return Object.keys(ctx)
    .filter(key => isConcreteChoiceProperty(key, choiceElementName))
    .map(key => key.slice(choiceElementName.length).toLowerCase());
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
