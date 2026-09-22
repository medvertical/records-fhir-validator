/**
 * FHIR JSON represents primitive element metadata in underscore sibling
 * properties (for example `value` + `_value`). A primitive element can be
 * clinically present through the sidecar alone when it carries an extension
 * such as data-absent-reason.
 */

import {
  findChoiceSidecarProperty,
  findConcreteChoiceProperty,
} from './fhir-choice-property.js';

const PRIMITIVE_SIDECAR_VALUE = Symbol.for('records.fhirPrimitiveSidecarValue');
const PRIMITIVE_SIDECAR_TYPE = Symbol.for('records.fhirPrimitiveSidecarType');

export function isResolvedPrimitiveSidecarValue(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Record<PropertyKey, unknown>)[PRIMITIVE_SIDECAR_VALUE] === true,
  );
}

export function getResolvedPrimitiveSidecarType(value: unknown): string | undefined {
  if (!isResolvedPrimitiveSidecarValue(value)) return undefined;
  if (!value || typeof value !== 'object') return undefined;
  const markedType = (value as Record<PropertyKey, unknown>)[PRIMITIVE_SIDECAR_TYPE];
  return typeof markedType === 'string' ? markedType : undefined;
}

export function getPrimitiveSidecar(container: unknown, key: string): unknown {
  if (!isObjectRecord(container)) return undefined;
  if (!key || key.startsWith('_')) return undefined;

  const sidecar = container[`_${key}`];
  return buildMeaningfulPrimitiveSidecarValue(sidecar);
}

export function resolveFhirSegmentValue(container: unknown, segment: string): unknown {
  if (!isObjectRecord(container)) return undefined;

  const direct = container[segment];
  if (Array.isArray(direct)) return mergePrimitiveArraySidecars(container, segment, direct);
  if (direct !== undefined) return direct;

  if (segment.endsWith('[x]')) {
    return resolveChoiceSegmentValue(container, segment.slice(0, -3));
  }

  return getPrimitiveSidecar(container, segment);
}

function mergePrimitiveArraySidecars(
  container: Record<string, unknown>,
  segment: string,
  direct: unknown[],
): unknown[] {
  const sidecars = container[`_${segment}`];
  if (!Array.isArray(sidecars)) return direct;
  let changed = false;
  const resolved = direct.map((value, index) => {
    const sidecar = sidecars[index];
    if (value != null || !isMeaningfulPrimitiveSidecar(sidecar)) return value;
    changed = true;
    return markPrimitiveSidecarValue(sidecar);
  });
  return changed ? resolved : direct;
}

function resolveChoiceSegmentValue(container: Record<string, unknown>, baseName: string): unknown {
  const directChoiceKey = findConcreteChoiceProperty(container, baseName);
  if (directChoiceKey) return container[directChoiceKey];

  const sidecarChoiceKey = findChoiceSidecarProperty(container, baseName);
  if (!sidecarChoiceKey) return undefined;

  const sidecar = container[sidecarChoiceKey];
  const concreteKey = sidecarChoiceKey.slice(1);
  const primitiveType = primitiveTypeFromChoiceKey(concreteKey, baseName);
  return isMeaningfulPrimitiveSidecar(sidecar) ? markPrimitiveSidecarValue(sidecar, primitiveType) : undefined;
}

function isMeaningfulPrimitiveSidecar(sidecar: unknown): boolean {
  if (!isObjectRecord(sidecar)) return false;
  if (typeof sidecar.id === 'string' && sidecar.id.length > 0) return true;
  return Array.isArray(sidecar.extension) && sidecar.extension.length > 0;
}

function buildMeaningfulPrimitiveSidecarValue(sidecar: unknown): unknown {
  if (Array.isArray(sidecar)) {
    const meaningfulItems = sidecar
      .filter(isMeaningfulPrimitiveSidecar)
      .map(item => markPrimitiveSidecarValue(item));
    return meaningfulItems.length > 0 ? markPrimitiveSidecarValue(meaningfulItems) : undefined;
  }

  return isMeaningfulPrimitiveSidecar(sidecar) ? markPrimitiveSidecarValue(sidecar) : undefined;
}

function primitiveTypeFromChoiceKey(concreteKey: string, baseName: string): string | undefined {
  const suffix = concreteKey.slice(baseName.length);
  if (!suffix) return undefined;
  return suffix.charAt(0).toLowerCase() + suffix.slice(1);
}

function markPrimitiveSidecarValue(sidecar: unknown, primitiveType?: string): unknown {
  if (!sidecar || typeof sidecar !== 'object') return sidecar;
  if (
    isResolvedPrimitiveSidecarValue(sidecar) &&
    (!primitiveType || getResolvedPrimitiveSidecarType(sidecar) === primitiveType)
  ) return sidecar;

  // Never mutate the caller's FHIR resource just to carry traversal metadata.
  // A shallow representation is sufficient: consumers need the sidecar's
  // `id`/`extension` values and the non-enumerable marker, not object identity.
  const marked = Array.isArray(sidecar) ? [...sidecar] : { ...sidecar };

  Object.defineProperty(marked, PRIMITIVE_SIDECAR_VALUE, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  if (primitiveType) {
    Object.defineProperty(marked, PRIMITIVE_SIDECAR_TYPE, {
      value: primitiveType,
      enumerable: false,
      configurable: false,
    });
  }
  return marked;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
