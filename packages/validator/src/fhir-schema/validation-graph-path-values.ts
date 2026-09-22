import { getPrimitiveSidecar } from '../core/fhir-primitive-sidecar.js';
import type { ValidationGraphNode } from './validation-graph-types.js';

export function getParentValues(resource: Record<string, unknown>, node: ValidationGraphNode): unknown[] {
  const parts = node.path.split('.');
  if (parts.length <= 2) {
    return [resource];
  }
  return getValuesByPath(resource, parts.slice(0, -1).join('.'));
}

export function getDirectValues(parent: unknown, property: string): unknown[] {
  if (!isRecord(parent) || !(property in parent)) {
    return getPrimitiveSidecarValues(parent, property);
  }
  const value = parent[property];
  return Array.isArray(value) ? value : [value];
}

export function isChoiceProperty(key: string, base: string): boolean {
  return key.length > base.length
    && key.startsWith(base)
    && key[base.length] === key[base.length].toUpperCase();
}

function getValuesByPath(resource: Record<string, unknown>, path: string): unknown[] {
  const parts = path.split('.').slice(1);
  let current: unknown[] = [resource];

  for (const part of parts) {
    const next: unknown[] = [];
    for (const value of current) {
      if (Array.isArray(value)) {
        for (const item of value) {
          collectProperty(item, part, next);
        }
      } else {
        collectProperty(value, part, next);
      }
    }
    current = next;
  }

  return current.flatMap(value => Array.isArray(value) ? value : [value]);
}

function collectProperty(value: unknown, part: string, out: unknown[]): void {
  if (!isRecord(value)) {
    return;
  }

  if (part in value) {
    const child = value[part];
    if (Array.isArray(child)) out.push(...child);
    else out.push(child);
    return;
  }

  const primitiveSidecarKey = `_${part}`;
  if (primitiveSidecarKey in value) {
    out.push(...getPrimitiveSidecarValues(value, part));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (!isChoiceProperty(key, part)) continue;
    if (Array.isArray(child)) out.push(...child);
    else out.push(child);
  }
}

function getPrimitiveSidecarValues(parent: unknown, property: string): unknown[] {
  const primitiveSidecar = getPrimitiveSidecar(parent, property);
  if (primitiveSidecar === undefined) return [];
  return Array.isArray(primitiveSidecar) ? primitiveSidecar : [primitiveSidecar];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
