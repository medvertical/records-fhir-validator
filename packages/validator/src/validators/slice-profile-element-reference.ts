import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { getNonEmptyString } from './slice-info-input.js';

/**
 * A slice may delegate its definition to a named slice inside another profile:
 * `type.profile` carries the canonical, and this extension names which element
 * within it applies. Without it the referenced profile is read from its own
 * root, so `Composition.section.code` resolves to `section.code` where the
 * slice needs `code`, and the discriminator evidence is never found.
 */
const PROFILE_ELEMENT_EXTENSION =
  'http://hl7.org/fhir/StructureDefinition/elementdefinition-profile-element';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function profileElementReference(sidecar: unknown): string | undefined {
  const extensions = asRecord(sidecar)?.extension;
  if (!Array.isArray(extensions)) return undefined;
  for (const candidate of extensions) {
    const extension = asRecord(candidate);
    if (extension?.url === PROFILE_ELEMENT_EXTENSION) {
      return getNonEmptyString(extension.valueString);
    }
  }
  return undefined;
}

/**
 * Resolve `Composition.section:codeA` inside a referenced profile.
 *
 * Element ids would make this a prefix match, but differentials are not
 * required to carry them — the upstream section-library fixtures carry none —
 * so the slice is delimited the way a differential delimits it: the named
 * element, then every following element beneath it, up to the next element
 * that is not one of its descendants.
 */
export function differentialElements(profile: StructureDefinition): ElementDefinition[] | undefined {
  const differential = asRecord(asRecord(profile)?.differential);
  const elements = differential?.element;
  if (!Array.isArray(elements) || elements.length === 0) return undefined;
  return elements.filter((element): element is ElementDefinition => {
    const record = asRecord(element);
    return typeof record?.path === 'string';
  });
}

export function collectReferencedSliceChildren(
  elements: ElementDefinition[],
  reference: string,
): Array<[string, ElementDefinition]> | undefined {
  const separator = reference.lastIndexOf(':');
  const basePath = separator === -1 ? reference : reference.slice(0, separator);
  const sliceName = separator === -1 ? undefined : reference.slice(separator + 1);

  const startIndex = elements.findIndex((element) => {
    if (typeof element.id === 'string' && element.id === reference) return true;
    if (element.path !== basePath) return false;
    return sliceName === undefined
      ? !getNonEmptyString(element.sliceName)
      : getNonEmptyString(element.sliceName) === sliceName;
  });
  if (startIndex === -1) return undefined;

  const childPrefix = `${basePath}.`;
  const collected: Array<[string, ElementDefinition]> = [];
  for (let index = startIndex + 1; index < elements.length; index += 1) {
    const candidate = elements[index];
    if (!candidate.path.startsWith(childPrefix)) break;
    collected.push([candidate.path.slice(childPrefix.length), candidate]);
  }
  return collected;
}
