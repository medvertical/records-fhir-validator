import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../../issues/index.js';
import {
  findIllegalXmlCharacters,
  formatIllegalXmlCharacterMessage,
  isWhitespaceOnlyString,
} from '../../validators/string-character-rules.js';

type ObjectRecord = Record<string, unknown>;

export function validateNoEmptyArrays(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  findEmptyArrays(resource, resourceType, issues, new WeakSet());
  return issues;
}

export function validateWhitespaceOnlyPrimitives(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  walkStringPrimitives(resource, resourceType, (value, path) => {
    if (isWhitespaceOnlyString(value)) issues.push(whitespaceIssue(path, resourceType));
  });
  return issues;
}

export function validateIllegalXmlCharacterPrimitives(
  resource: unknown,
  resourceType: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  walkStringPrimitives(resource, resourceType, (value, path) => {
    const hexes = findIllegalXmlCharacters(value);
    if (hexes.length === 0) return;
    issues.push(createValidationIssue({
      code: 'string-illegal-xml-chars',
      path,
      resourceType,
      customMessage: formatIllegalXmlCharacterMessage(hexes),
      severityOverride: 'warning',
      details: { illegalCharacterHexValues: hexes },
    }));
  });
  return issues;
}

function walkStringPrimitives(
  resource: unknown,
  resourceType: string,
  onString: (value: string, path: string) => void,
): void {
  const visited = new WeakSet<object>();
  const walk = (obj: unknown, path: string) => {
    if (typeof obj !== 'object' || obj === null || visited.has(obj)) return;
    visited.add(obj);
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'resourceType' || key === 'div' || key.startsWith('_')) continue;
      const childPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string' && value.length > 0) {
        onString(value, childPath);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'string' && item.length > 0) {
            onString(item, `${childPath}[${index}]`);
          } else if (item && typeof item === 'object') {
            walk(item, `${childPath}[${index}]`);
          }
        });
      } else if (typeof value === 'object') {
        walk(value, childPath);
      }
    }
  };
  walk(resource, resourceType);
}

export function validateOrphanPrimitiveSidecars(resource: unknown, resourceType: string): ValidationIssue[] {
  if (!isObjectRecord(resource)) return [];
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(resource)) {
    if (!key.startsWith('_') || key.length < 2) continue;
    const primitiveKey = key.slice(1);
    if (primitiveKey in resource) continue;
    // FHIR JSON allows a primitive with no value to be represented by the
    // `_element` sidecar alone as long as it carries an id or extensions —
    // any extension, not just data-absent-reason (e.g. US Core's
    // questionnaire-uri extension on a QuestionnaireResponse without a
    // resolvable canonical). Only a sidecar with nothing to represent is broken.
    if (sidecarCarriesContent(resource[key])) continue;
    issues.push(createValidationIssue({
      code: 'structural-orphan-primitive-extension',
      path: `${resourceType}.${primitiveKey}`,
      resourceType,
      customMessage:
        `The property '${primitiveKey}' is invalid: primitive-extension sidecar '${key}' is present without a matching '${primitiveKey}' value. ` +
        'Sidecar-only form is valid only when it carries an id or at least one extension.',
      severityOverride: 'error',
      details: { orphanKey: key, expectedKey: primitiveKey },
    }));
  }
  return issues;
}

function sidecarCarriesContent(sidecar: unknown): boolean {
  if (Array.isArray(sidecar)) return sidecar.some(entry => sidecarCarriesContent(entry));
  if (!isObjectRecord(sidecar)) return false;
  if (typeof sidecar.id === 'string' && sidecar.id.length > 0) return true;
  return Array.isArray(sidecar.extension) && sidecar.extension.length > 0;
}

export function validatePrimitiveSidecarArrayAlignment(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visited = new WeakSet<object>();
  const walk = (node: unknown, path: string): void => {
    if (!isObjectRecord(node) || visited.has(node)) return;
    visited.add(node);
    for (const [key, sidecar] of Object.entries(node)) {
      if (!key.startsWith('_') || !Array.isArray(sidecar)) continue;
      const primitiveKey = key.slice(1);
      const values = node[primitiveKey];
      if (!Array.isArray(values) || sidecar.length <= values.length) continue;
      issues.push(createValidationIssue({
        code: 'structural-primitive-array-alignment',
        path: `${path}.${primitiveKey}`,
        resourceType,
        customMessage: `The primitive extension array '${key}' has entries beyond the '${primitiveKey}' value array`,
        severityOverride: 'error',
      }));
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('_')) continue;
      const childPath = `${path}.${key}`;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') walk(item, `${childPath}[${index}]`);
        });
      } else if (value && typeof value === 'object') {
        walk(value, childPath);
      }
    }
  };
  walk(resource, resourceType);
  return issues;
}

function whitespaceIssue(path: string, resourceType: string): ValidationIssue {
  return createValidationIssue({
    code: 'string-whitespace-only',
    path,
    resourceType,
    customMessage: 'Primitive types should not only be whitespace',
    severityOverride: 'warning',
  });
}

function findEmptyArrays(
  obj: unknown,
  path: string,
  issues: ValidationIssue[],
  visited: WeakSet<object>,
): void {
  if (!isObjectRecord(obj) || visited.has(obj)) return;
  visited.add(obj);
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const currentPath = `${path}.${key}`;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        issues.push(createValidationIssue({
          code: 'structural-empty-array',
          path: currentPath,
          resourceType: path.split('.')[0],
          customMessage: 'Array cannot be empty - omit the property instead',
          severityOverride: 'error',
        }));
      } else {
        value.forEach((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return;
          if (Object.keys(item).length === 0) {
            issues.push(createValidationIssue({
              code: 'structural-empty-object',
              path: `${currentPath}[${index}]`,
              resourceType: path.split('.')[0],
              customMessage: 'Element must have some content',
              severityOverride: 'error',
            }));
          } else {
            findEmptyArrays(item, `${currentPath}[${index}]`, issues, visited);
          }
        });
      }
    } else if (value && typeof value === 'object') {
      findEmptyArrays(value, currentPath, issues, visited);
    }
  }
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
