import { isConcreteChoiceProperty } from '../fhir-choice-property.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { matchesPattern } from '../../validators/slice-utils.js';
import { getPatternOrFixedValue } from './terminology-binding-pattern-matching.js';

/**
 * The instances a slice element ranges over when it sits inside other slices:
 * `extension:ethnicity.extension:ombCategory` is the ombCategory of the
 * ethnicity extension only, not of the race extension beside it, and
 * `…ombCategory.value[x]:valueCoding` the Coding in it, not the text string.
 * The owning slice's own filter is the caller's; for a type slice on a choice
 * the JSON key already decides it. Null for a slice no other slice encloses.
 */
export function valuesWithinEnclosingSlices(
  resource: unknown,
  sliceElement: ElementDefinition,
  structureDef: StructureDefinition,
): unknown[] | null {
  const segments = sliceElement.id?.split('.') ?? [];
  if (segments.length < 3 || !segments.slice(1, -1).some(segment => segment.includes(':'))) return null;
  const elements = structureDef.snapshot?.element ?? [];
  let values: unknown[] = [resource];
  let id = segments[0];
  for (const [index, segment] of segments.slice(1).entries()) {
    id = `${id}.${segment}`;
    const [name, sliceName] = segment.split(':');
    const owning = index === segments.length - 2;
    if (name.endsWith('[x]')) {
      const base = name.slice(0, -'[x]'.length);
      values = values.flatMap(value => (isRecord(value)
        ? Object.entries(value)
          .filter(([key]) => (owning && sliceName ? key === sliceName : isConcreteChoiceProperty(key, base)))
          .flatMap(([, child]) => [child].flat())
        : []));
      continue;
    }
    // A primitive carries its extensions in its sidecar (`_value`).
    values = values.flatMap(value => (isRecord(value) ? [value[name] ?? [], value[`_${name}`] ?? []].flat() : []));
    const enclosing = sliceName && !owning ? elements.find(element => element.id === id) : undefined;
    // An enclosing slice its discriminator cannot tell keeps every instance.
    if (enclosing) values = values.filter(value => matchesByDiscriminator(value, enclosing, elements) ?? true);
  }
  return values;
}

/**
 * An enclosing slice is recognised by its own discriminator values (an
 * extension slice by its url): the fixed values of the slices nested in it
 * say nothing about which instance it is. Undefined for a discriminator other
 * than value or pattern.
 */
function matchesByDiscriminator(value: unknown, slice: ElementDefinition, elements: ElementDefinition[]): boolean | undefined {
  const sliceId = slice.id ?? '';
  const baseId = sliceId.slice(0, sliceId.lastIndexOf(':'));
  const discriminators = elements.find(element => element.id === baseId)?.slicing?.discriminator ?? [];
  if (discriminators.length === 0 || discriminators.some(({ type }) => type !== 'value' && type !== 'pattern')) return undefined;
  return discriminators.every(({ path }) => {
    const definition = !path || path === '$this' ? slice : elements.find(element => element.id === `${sliceId}.${path}`);
    const expected = definition ? getPatternOrFixedValue(definition) : undefined;
    return expected !== undefined && matchesPattern(valueAt(value, path), expected);
  });
}

function valueAt(value: unknown, path: string | undefined): unknown {
  if (!path || path === '$this') return value;
  return path.split('.').reduce<unknown>((current, part) => (isRecord(current) ? current[part] : undefined), value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
