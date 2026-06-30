/**
 * Slice Utilities — Pure Functions
 *
 * Extracted from SlicingValidator to reduce its size from 1179 to ~600 LoC.
 * These functions have zero state dependencies and can be tested in isolation.
 */

import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar';

export function getValueAtPath(obj: any, path: string): any {
  if (!path || path === '$this') return obj;

  const normalizedPath = path.startsWith('$this.')
    ? path.slice('$this.'.length)
    : path;
  const parts = normalizedPath.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return null;

    if (Array.isArray(current)) {
      for (const item of current) {
        if (item == null) continue;
        const v = resolveFhirSegmentValue(item, part);
        if (v !== undefined) return v;
      }
      return null;
    }

    current = resolveFhirSegmentValue(current, part);
  }

  return current ?? null;
}

export function valuesMatch(value1: any, value2: any): boolean {
  if (value1 === null || value1 === undefined || value2 === null || value2 === undefined) {
    return value1 === value2;
  }

  if (typeof value1 !== 'object' || typeof value2 !== 'object') {
    return value1 === value2;
  }

  if (Array.isArray(value1) && Array.isArray(value2)) {
    if (value1.length !== value2.length) return false;
    return value1.every((v, i) => valuesMatch(v, value2[i]));
  }

  const keys1 = Object.keys(value1);
  const keys2 = Object.keys(value2);
  if (keys1.length !== keys2.length) return false;
  return keys1.every(key => valuesMatch(value1[key], value2[key]));
}

export function splitCanonicalReference(value: unknown): { url: string; version?: string } | null {
  if (typeof value !== 'string') return null;

  const [url, version] = value.split('|');
  if (!url || !/^https?:\/\//.test(url)) return null;

  return version ? { url, version } : { url };
}

export function canonicalBasesMatch(value1: unknown, value2: unknown): boolean {
  const first = splitCanonicalReference(value1);
  const second = splitCanonicalReference(value2);
  return Boolean(first && second && first.url === second.url);
}

export function canonicalValuesMatch(actualValue: unknown, expectedValue: unknown): boolean {
  const actual = splitCanonicalReference(actualValue);
  const expected = splitCanonicalReference(expectedValue);
  if (!actual || !expected || actual.url !== expected.url) return false;

  // An unversioned fixedCanonical accepts any declaration of the same
  // canonical. A versioned fixedCanonical still requires that version.
  return !expected.version || actual.version === expected.version;
}

export function inferType(value: any): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) {
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

export function extractPatternEntry(element: any): { key: string; value: any } | undefined {
  if (!element) return undefined;
  if (element.pattern !== undefined) return { key: 'pattern', value: element.pattern };
  const key = Object.keys(element).find(k => k.startsWith('pattern') && k !== 'pattern');
  return key ? { key, value: element[key] } : undefined;
}

export function extractFixedEntry(element: any): { key: string; value: any } | undefined {
  if (!element) return undefined;
  if (element.fixed !== undefined) return { key: 'fixed', value: element.fixed };
  const key = Object.keys(element).find(k => k.startsWith('fixed') && k !== 'fixed');
  return key ? { key, value: element[key] } : undefined;
}

export function extractFixedFromElement(element: any): any | undefined {
  const entry = extractFixedEntry(element);
  return entry?.value;
}

export function extractPatternFromElement(element: any): any | undefined {
  const entry = extractPatternEntry(element);
  return entry?.value;
}

export function valueMatchesFixedConstraint(actualValue: any, fixedValue: any, fixedKind?: string): boolean {
  if (fixedKind === 'fixedCanonical') {
    return canonicalValuesMatch(actualValue, fixedValue);
  }

  return valuesMatch(actualValue, fixedValue);
}

export function valueCanIdentifyFixedSlice(actualValue: any, fixedValue: any, fixedKind?: string): boolean {
  if (fixedKind === 'fixedCanonical') {
    return canonicalValuesMatch(actualValue, fixedValue) || canonicalBasesMatch(actualValue, fixedValue);
  }

  return valuesMatch(actualValue, fixedValue);
}

export function extractFixedValue(elementDef: any): any {
  return extractFixedFromElement(elementDef);
}

export function extractPatternValue(elementDef: any): any {
  return extractPatternFromElement(elementDef);
}

export function codingMatchesBindingCodes(element: any, bindingCodes: Set<string>): boolean {
  if (!element) return false;
  if (Array.isArray(element.coding)) {
    return element.coding.some((coding: any) => codingMatchesBindingCodes(coding, bindingCodes));
  }
  const { system, code } = element;
  if (system && code) {
    if (bindingCodes.has(`${system}|${code}`)) return true;

    // ValueSet expansions in package files historically carried both
    // `system|code` and bare `code` entries. For a system-qualified Coding,
    // never let a bare duplicate from another CodeSystem select the slice.
    for (const bindingCode of bindingCodes) {
      if (bindingCode.includes('|')) return false;
    }

    return bindingCodes.has(code);
  }
  if (code) return bindingCodes.has(code);
  return false;
}

export function matchesPattern(actualValue: any, patternValue: any): boolean {
  if (patternValue === null || patternValue === undefined) return true;
  if (actualValue === null || actualValue === undefined) return false;
  if (typeof patternValue !== 'object') return actualValue === patternValue;

  if (Array.isArray(patternValue)) {
    const actualList = Array.isArray(actualValue) ? actualValue : [actualValue];
    return patternValue.every(pv => actualList.some(av => matchesPattern(av, pv)));
  }

  // When pattern is a single object against an array, the object must match
  // *some* array element — otherwise sliced 0..* elements would always drop.
  if (Array.isArray(actualValue)) {
    return actualValue.some(av => matchesPattern(av, patternValue));
  }

  if (typeof actualValue !== 'object') return false;
  for (const key of Object.keys(patternValue)) {
    if (!matchesPattern(actualValue[key], patternValue[key])) return false;
  }
  return true;
}
