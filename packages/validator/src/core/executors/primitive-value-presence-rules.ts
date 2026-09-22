import { isResolvedPrimitiveSidecarValue } from '../fhir-primitive-sidecar.js';
import { createValidationIssue } from '../../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition } from '../structure-definition-types.js';

const MUST_HAVE_VALUE_EXTENSION =
  'http://hl7.org/fhir/5.0/StructureDefinition/extension-ElementDefinition.mustHaveValue';
const VALUE_ALTERNATIVES_EXTENSION =
  'http://hl7.org/fhir/5.0/StructureDefinition/extension-ElementDefinition.valueAlternatives';

export function validatePrimitiveValuePresence(
  value: unknown,
  elementDef: ElementDefinition,
  path: string,
  profileUrl: string,
): ValidationIssue[] {
  if (!isResolvedPrimitiveSidecarValue(value)) return [];
  const alternatives = allowedValueAlternatives(elementDef);
  if (alternatives.length > 0 && hasAllowedAlternative(value, alternatives)) return [];
  if (requiresPrimitiveValue(elementDef)) {
    return [createValidationIssue({
      code: 'profile-primitive-value-required',
      path,
      resourceType: 'Unknown',
      profile: profileUrl,
      messageParams: { path },
    })];
  }

  if (alternatives.length === 0) return [];
  return [createValidationIssue({
    code: 'profile-primitive-value-alternative-required',
    path,
    resourceType: 'Unknown',
    profile: profileUrl,
    messageParams: { path, alternatives: alternatives.join(', ') },
    details: { allowedExtensions: alternatives },
  })];
}

function requiresPrimitiveValue(elementDef: ElementDefinition): boolean {
  if (typeof elementDef.mustHaveValue === 'boolean') return elementDef.mustHaveValue;
  return elementExtensions(elementDef).some(extension =>
    extension.url === MUST_HAVE_VALUE_EXTENSION && extension.valueBoolean === true,
  );
}

function allowedValueAlternatives(elementDef: ElementDefinition): string[] {
  const native = Array.isArray(elementDef.valueAlternatives)
    ? elementDef.valueAlternatives.filter(value => typeof value === 'string')
    : [];
  const backported = elementExtensions(elementDef).flatMap(extension =>
    extension.url === VALUE_ALTERNATIVES_EXTENSION && typeof extension.valueCanonical === 'string'
      ? [extension.valueCanonical]
      : [],
  );
  return [...new Set([...native, ...backported])];
}

function hasAllowedAlternative(value: unknown, alternatives: string[]): boolean {
  if (!isRecord(value) || !Array.isArray(value.extension)) return false;
  return value.extension.some(extension =>
    isRecord(extension)
    && typeof extension.url === 'string'
    && alternatives.includes(extension.url),
  );
}

function elementExtensions(elementDef: ElementDefinition): Array<Record<string, unknown>> {
  return Array.isArray(elementDef.extension)
    ? elementDef.extension.filter(isRecord)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
