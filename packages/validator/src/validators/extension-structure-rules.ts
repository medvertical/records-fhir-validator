import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';

/**
 * HL7-defined extensions that aren't shipped in the R4 core SD bundle but
 * are universally recognised by the Java reference validator (it auto-loads
 * the FHIR extensions IG). Treating them as "known" suppresses the
 * `profile-extension-not-found` false positive that doesn't appear in Java
 * baselines for fixtures like ips-link. Cross-version URLs
 * (`http://hl7.org/fhir/<release>/StructureDefinition/extension-...`) are
 * deliberately absent — `isKnownCrossVersionExtensionUrl` recognises the
 * whole family generically, so listing individual ones here would shadow
 * its modifier-extension safety check.
 */
const KNOWN_HL7_EXTENSION_URLS = new Set<string>([
  'http://hl7.org/fhir/StructureDefinition/textLink',
  'http://hl7.org/fhir/StructureDefinition/narrativeLink',
  'http://hl7.org/fhir/StructureDefinition/extension-quantity-translation',
  'http://hl7.org/fhir/StructureDefinition/individual-genderIdentity',
  'http://hl7.org/fhir/StructureDefinition/individual-pronouns',
  'http://hl7.org/fhir/StructureDefinition/instance-name',
  'http://hl7.org/fhir/StructureDefinition/patient-occupation',
  'http://hl7.org/fhir/StructureDefinition/NarrativeLink',
]);

/**
 * Allowed FHIR value-type suffixes for known HL7 narrative extensions.
 * The key matches the Extension.url; the value lists the FHIR type names
 * that the spec permits.
 */
const KNOWN_HL7_EXTENSION_ALLOWED_TYPES: Record<string, string[]> = {
  'http://hl7.org/fhir/StructureDefinition/narrativeLink': ['url'],
};

export function isAbsoluteExtensionUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (/^urn:[a-z0-9][a-z0-9-]+:/i.test(url)) return true;
  return /^[a-z][a-z0-9+.-]*:\/\/.+/i.test(url);
}

export function shouldReportUnresolvableExtensionUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  if (KNOWN_HL7_EXTENSION_URLS.has(url)) return false;
  if (/^https?:\/\/([^/]+\.)?hl7\.org\/fhir\/(test|tools)\//i.test(url)) return false;
  if (url.includes('/matchetype')) return false;
  if (/^https?:\/\/(www\.)?example\.(org|net)\//i.test(url)) return false;
  return true;
}

export function validateExtensionStructure(
  extension: Record<string, unknown>,
  extensionType: string,
  path: string,
  resourceType = 'Unknown',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasValue = Object.keys(extension).some(key => key.startsWith('value')) ||
    resolveFhirSegmentValue(extension, 'value[x]') !== undefined;
  const hasNestedExtension = Array.isArray(extension.extension) && extension.extension.length > 0;

  if (!hasValue && !hasNestedExtension) {
    issues.push(createValidationIssue({
      code: 'profile-extension-no-value',
      path,
      resourceType,
      messageParams: { url: extension.url },
    }));
  }

  if (hasValue && hasNestedExtension) {
    issues.push(createValidationIssue({
      code: 'profile-extension-value-and-nested',
      path,
      resourceType,
      messageParams: { url: extension.url },
    }));
  }

  return issues;
}

export function validateExtensionValueType(
  extension: Record<string, unknown>,
  allowedTypes: string[],
  path: string,
  resourceType = 'Unknown',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const valueKey = Object.keys(extension).find(key => key.startsWith('value'));
  if (!valueKey || allowedTypes.length === 0) return issues;

  const valueType = valueKey.replace('value', '');
  const capitalizedType = valueType.charAt(0).toUpperCase() + valueType.slice(1);
  const isValidType = allowedTypes.some(allowedType =>
    allowedType === capitalizedType || allowedType === valueType
  );

  if (!isValidType) {
    issues.push(createValidationIssue({
      code: 'profile-extension-invalid-value-type',
      path: `${path}.${valueKey}`,
      resourceType,
      messageParams: { url: extension.url, valueType: capitalizedType, allowedTypes: allowedTypes.join(', ') },
    }));
  }

  return issues;
}

export function validateKnownHl7ExtensionValueType(
  extension: Record<string, unknown>,
  path: string,
  resourceType = 'Unknown',
): ValidationIssue[] {
  const url = typeof extension.url === 'string' ? extension.url : undefined;
  if (!url || !KNOWN_HL7_EXTENSION_ALLOWED_TYPES[url]) return [];

  const allowed = KNOWN_HL7_EXTENSION_ALLOWED_TYPES[url];
  const found = Object.keys(extension)
    .filter(k => k.startsWith('value') && k.length > 'value'.length)
    .map(k => k.slice('value'.length));
  const foundLc = found.map(t => t.charAt(0).toLowerCase() + t.slice(1));
  const wrong = foundLc.find(t => !allowed.includes(t));

  if (!wrong) return [];

  return [createValidationIssue({
    code: 'profile-extension-wrong-value-type',
    path,
    resourceType,
    customMessage:
      `The Extension '${url}' definition allows for the types [${allowed.join(', ')}] but found type ${wrong}`,
    severityOverride: 'error',
    details: { url, allowed, found: wrong },
  })];
}
