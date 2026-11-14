import { visitJsonNumberTokens } from '../core/json-source-map.js';
import type { FhirInputLimits, ParsedFhirInput } from './fhir-input-types.js';
import { recordNumberSource } from './number-source.js';

type JsonReviverContext = { source?: string };
const hasJsonReviverSource = JSON.parse('0', (_key, _value, context?: JsonReviverContext) => context?.source) === '0';

export function parseJsonWithNumberSources(source: string): unknown {
  if (!hasJsonReviverSource) {
    // Node 20 does not pass source text to the reviver.
    const parsed: unknown = JSON.parse(source);
    visitJsonNumberTokens(source, parsed, recordNumberSource);
    return parsed;
  }
  return JSON.parse(source, function (
    this: object, key: string, value: unknown, context?: JsonReviverContext,
  ): unknown {
    if (typeof value === 'number' && typeof context?.source === 'string') {
      recordNumberSource(this, key, context.source, value);
    }
    return value;
  });
}

/** Keep raw JSON number tokens while exposing ordinary FHIR JSON numbers. */
export function parseFhirJson(source: string, limits: FhirInputLimits = {}): ParsedFhirInput {
  const maxBytes = limits.maxBytes ?? 20 * 1024 * 1024;
  if (typeof source !== 'string') throw new Error('FHIR JSON input must be a string');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new Error('FHIR JSON input exceeded byte limit');
  }
  const resource = parseJsonWithNumberSources(source.replace(/^\uFEFF/, ''));
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
    || !('resourceType' in resource) || typeof resource.resourceType !== 'string' || !resource.resourceType.trim()) {
    throw new Error('FHIR JSON input must contain one resource object with resourceType');
  }
  checkStructureLimits(resource, limits);
  return { format: 'json', resources: [resource as Record<string, unknown>],
    sourceMap: { 'resources[0]': { line: 1, column: 1 } } };
}

function checkStructureLimits(resource: object, limits: FhirInputLimits): void {
  const maxDepth = limits.maxDepth ?? 200;
  const maxNodes = limits.maxNodes ?? 1_000_000;
  if (![maxDepth, maxNodes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('FHIR JSON input limits must be positive integers');
  }
  const pending = [{ value: resource, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > maxNodes) throw new Error('FHIR JSON input exceeded node limit');
    if (current.depth >= maxDepth) throw new Error('FHIR JSON input exceeded depth limit');
    for (const value of Object.values(current.value)) {
      if (value && typeof value === 'object') pending.push({ value, depth: current.depth + 1 });
    }
  }
}
