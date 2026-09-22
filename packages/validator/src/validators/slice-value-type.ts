import { getResolvedPrimitiveSidecarType } from '../core/fhir-primitive-sidecar.js';

export function inferType(value: unknown): string {
  const sidecarType = getResolvedPrimitiveSidecarType(value);
  if (sidecarType) return sidecarType;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (isObjectRecord(value)) {
    if (typeof value.resourceType === 'string') return value.resourceType;
    if (value.coding !== undefined) return 'CodeableConcept';
    if (value.value !== undefined && value.unit !== undefined) return 'Quantity';
    if (value.system !== undefined && value.code !== undefined) return 'Coding';
    if (value.reference !== undefined) return 'Reference';
    if (value.system !== undefined && value.value !== undefined) return 'Identifier';
    if (value.start !== undefined || value.end !== undefined) return 'Period';
    return 'object';
  }
  return 'unknown';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
