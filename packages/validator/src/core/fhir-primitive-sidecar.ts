/**
 * FHIR JSON represents primitive element metadata in underscore sibling
 * properties (for example `value` + `_value`). A primitive element can be
 * clinically present through the sidecar alone when it carries an extension
 * such as data-absent-reason.
 */

const PRIMITIVE_SIDECAR_VALUE = Symbol.for('records.fhirPrimitiveSidecarValue');
const primitiveSidecarValues = new WeakSet<object>();

export function isResolvedPrimitiveSidecarValue(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (
      primitiveSidecarValues.has(value) ||
      (value as Record<PropertyKey, unknown>)[PRIMITIVE_SIDECAR_VALUE] === true
    ),
  );
}

export function getPrimitiveSidecar(container: any, key: string): any | undefined {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return undefined;
  if (!key || key.startsWith('_')) return undefined;

  const sidecar = container[`_${key}`];
  return isMeaningfulPrimitiveSidecar(sidecar) ? markPrimitiveSidecarValue(sidecar) : undefined;
}

export function resolveFhirSegmentValue(container: any, segment: string): any {
  if (!container || typeof container !== 'object') return undefined;

  const direct = container[segment];
  if (direct !== undefined) return direct;

  if (segment.endsWith('[x]')) {
    return resolveChoiceSegmentValue(container, segment.slice(0, -3));
  }

  return getPrimitiveSidecar(container, segment);
}

function resolveChoiceSegmentValue(container: any, baseName: string): any {
  const directChoiceKey = Object.keys(container).find(
    key => key.startsWith(baseName) && key !== baseName && !key.startsWith('_'),
  );
  if (directChoiceKey) return container[directChoiceKey];

  const sidecarChoiceKey = Object.keys(container).find(
    key => key.startsWith(`_${baseName}`) && key.length > baseName.length + 1,
  );
  if (!sidecarChoiceKey) return undefined;

  const sidecar = container[sidecarChoiceKey];
  return isMeaningfulPrimitiveSidecar(sidecar) ? markPrimitiveSidecarValue(sidecar) : undefined;
}

function isMeaningfulPrimitiveSidecar(sidecar: any): boolean {
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return false;
  if (typeof sidecar.id === 'string' && sidecar.id.length > 0) return true;
  return Array.isArray(sidecar.extension) && sidecar.extension.length > 0;
}

function markPrimitiveSidecarValue(sidecar: any): any {
  if (!sidecar || typeof sidecar !== 'object') return sidecar;
  if (isResolvedPrimitiveSidecarValue(sidecar)) return sidecar;
  primitiveSidecarValues.add(sidecar);
  if (!Object.isExtensible(sidecar)) return sidecar;

  Object.defineProperty(sidecar, PRIMITIVE_SIDECAR_VALUE, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return sidecar;
}
