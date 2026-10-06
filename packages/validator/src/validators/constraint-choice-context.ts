import { splitConcreteChoiceProperty } from '../core/fhir-choice-property.js';

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
