import type { Binding, ElementDefinition } from '../structure-definition-types.js';

const ADDITIONAL_BINDING_URL =
  'http://hl7.org/fhir/tools/StructureDefinition/additional-binding';

const PURPOSE_TO_STRENGTH: Record<string, Binding['strength'] | undefined> = {
  required: 'required',
  extensible: 'extensible',
  preferred: 'preferred',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childValue(
  extensions: unknown,
  url: string,
  valueKey: 'valueCode' | 'valueCanonical',
): string | undefined {
  if (!Array.isArray(extensions)) return undefined;
  for (const extension of extensions) {
    if (!isRecord(extension) || extension.url !== url) continue;
    const value = extension[valueKey];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Extract executable additional conformance bindings from ElementDefinition.
 * Purposes without membership semantics (for example `ui`, `starter`, or
 * `candidate`) remain descriptive and are intentionally not validated.
 */
export function additionalBindingsForElement(
  elementDef: ElementDefinition,
): Binding[] {
  const extensions = elementDef.binding?.extension;
  if (!Array.isArray(extensions)) return [];

  const seen = new Set<string>();
  const bindings: Binding[] = [];
  for (const extension of extensions) {
    if (!isRecord(extension) || extension.url !== ADDITIONAL_BINDING_URL) continue;
    const purpose = childValue(extension.extension, 'purpose', 'valueCode');
    const valueSet = childValue(extension.extension, 'valueSet', 'valueCanonical');
    const strength = purpose ? PURPOSE_TO_STRENGTH[purpose] : undefined;
    if (!strength || !valueSet) continue;

    const key = `${strength}|${valueSet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bindings.push({ strength, valueSet });
  }

  return bindings;
}
