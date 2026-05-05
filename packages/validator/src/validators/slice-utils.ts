/**
 * Slice Utilities — Pure Functions
 *
 * Extracted from SlicingValidator to reduce its size from 1179 to ~600 LoC.
 * These functions have zero state dependencies and can be tested in isolation.
 */

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
        const v = item[part];
        if (v !== undefined) return v;
      }
      return null;
    }

    let value = current[part];

    if (value === undefined && part.endsWith('[x]')) {
      const prefix = part.slice(0, -3);
      const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== part);
      if (actualKey) value = current[actualKey];
    }

    current = value;
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

export function extractPatternFromElement(element: any): any | undefined {
  if (!element) return undefined;
  if (element.pattern !== undefined) return element.pattern;
  for (const key of Object.keys(element)) {
    if (key.startsWith('pattern') && key !== 'pattern') return element[key];
  }
  return undefined;
}

export function extractFixedFromElement(element: any): any | undefined {
  if (!element) return undefined;
  if (element.fixed !== undefined) return element.fixed;
  for (const key of Object.keys(element)) {
    if (key.startsWith('fixed') && key !== 'fixed') {
      return element[key];
    }
  }
  return undefined;
}

// ============================================================================
// ElementDefinition fixed[X] / pattern[X] extractors — used by slice
// discriminator matching. Kept as plain functions so they can be tested in
// isolation and don't bloat SlicingValidator past its line budget.
// ============================================================================

export function extractFixedValue(elementDef: any): any {
  if (elementDef.fixed !== undefined) return elementDef.fixed;
  if (elementDef.fixedString !== undefined) return elementDef.fixedString;
  if (elementDef.fixedUri !== undefined) return elementDef.fixedUri;
  if (elementDef.fixedCode !== undefined) return elementDef.fixedCode;
  if (elementDef.fixedBoolean !== undefined) return elementDef.fixedBoolean;
  if (elementDef.fixedInteger !== undefined) return elementDef.fixedInteger;
  if (elementDef.fixedDecimal !== undefined) return elementDef.fixedDecimal;
  if (elementDef.fixedIdentifier !== undefined) return elementDef.fixedIdentifier;
  if (elementDef.fixedCoding !== undefined) return elementDef.fixedCoding;
  if (elementDef.fixedCodeableConcept !== undefined) return elementDef.fixedCodeableConcept;
  return undefined;
}

export function extractPatternValue(elementDef: any): any {
  if (elementDef.pattern !== undefined) return elementDef.pattern;
  if (elementDef.patternString !== undefined) return elementDef.patternString;
  if (elementDef.patternUri !== undefined) return elementDef.patternUri;
  if (elementDef.patternCode !== undefined) return elementDef.patternCode;
  if (elementDef.patternIdentifier !== undefined) return elementDef.patternIdentifier;
  if (elementDef.patternCoding !== undefined) return elementDef.patternCoding;
  if (elementDef.patternCodeableConcept !== undefined) return elementDef.patternCodeableConcept;
  return undefined;
}

export function codingMatchesBindingCodes(element: any, bindingCodes: Set<string>): boolean {
  if (!element) return false;
  if (Array.isArray(element.coding)) {
    return element.coding.some((coding: any) => codingMatchesBindingCodes(coding, bindingCodes));
  }
  const { system, code } = element;
  if (system && code) {
    return bindingCodes.has(`${system}|${code}`) || bindingCodes.has(code);
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
