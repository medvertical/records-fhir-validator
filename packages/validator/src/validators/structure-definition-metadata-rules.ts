import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { STATUS_CONSISTENCY, WG_CONTACT_URL, WG_PUBLISHER } from './sd-wg-mappings.js';

export function validateStructureDefinitionWgConsistency(resource: unknown): ValidationIssue[] {
  if (!isRecord(resource)) return [];
  const issues: ValidationIssue[] = [];
  const resourceType = typeof resource.resourceType === 'string'
    ? resource.resourceType
    : 'StructureDefinition';

  const wgExt = getRecordArray(resource.extension).find(
    extension => extension.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg'
  );
  if (typeof wgExt?.valueCode !== 'string') return issues;

  const wg = wgExt.valueCode;
  const expectedPublisher = WG_PUBLISHER[wg];

  if (
    expectedPublisher &&
    typeof resource.publisher === 'string' &&
    !publisherMatchesWg(resource.publisher, expectedPublisher)
  ) {
    issues.push(createValidationIssue({
      code: 'business-rule-wg-publisher',
      path: resourceType,
      resourceType,
      customMessage:
        `The nominated WG '${wg}' means that the publisher should be ` +
        `'${expectedPublisher}' but '${resource.publisher}' was found`,
      severityOverride: 'warning',
    }));
  }

  const expectedUrl = WG_CONTACT_URL[wg];
  if (expectedUrl) {
    const allContactUrls = extractContactUrls(resource.contact);
    if (!allContactUrls.some(url => contactUrlMatchesWg(url, expectedUrl))) {
      issues.push(createValidationIssue({
        code: 'business-rule-wg-contact',
        path: resourceType,
        resourceType,
        customMessage:
          `The nominated WG '${wg}' means that the contact url should be ` +
          `'${expectedUrl}' but it was not found`,
        severityOverride: 'warning',
      }));
    }
  }

  return issues;
}

export function validateStructureDefinitionStatusConsistency(sd: unknown): ValidationIssue[] {
  if (!isRecord(sd)) return [];
  const stdStatusExt = getRecordArray(sd.extension).find(
    extension => extension.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status'
  );
  if (typeof stdStatusExt?.valueCode !== 'string' || typeof sd.status !== 'string') return [];

  const allowed = STATUS_CONSISTENCY[stdStatusExt.valueCode];
  if (allowed && !allowed.includes(sd.status)) {
    return [createValidationIssue({
      code: 'business-rule-sd-status-consistency',
      path: 'StructureDefinition',
      resourceType: 'StructureDefinition',
      customMessage:
        `The resource status '${sd.status}' and the standards status '${stdStatusExt.valueCode}' are not consistent`,
      severityOverride: 'warning',
    })];
  }
  return [];
}

function extractContactUrls(contacts: unknown): string[] {
  if (!Array.isArray(contacts)) return [];
  const urls: string[] = [];
  for (const contact of contacts) {
    if (!isRecord(contact) || !Array.isArray(contact.telecom)) continue;
    for (const telecom of contact.telecom) {
      if (
        isRecord(telecom) &&
        telecom.system === 'url' &&
        typeof telecom.value === 'string'
      ) {
        urls.push(telecom.value);
      }
    }
  }
  return urls;
}

function publisherMatchesWg(actual: string, expected: string): boolean {
  return normalizeWgPublisher(actual) === normalizeWgPublisher(expected);
}

function normalizeWgPublisher(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bhealth\s+level\s+seven\b/g, 'hl7')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function contactUrlMatchesWg(actual: string, expected: string): boolean {
  const normalizedActual = normalizeWgContactUrl(actual);
  const normalizedExpected = normalizeWgContactUrl(expected);
  return normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(`${normalizedExpected}/`);
}

function normalizeWgContactUrl(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/index\.(cfm|html?)$/, '')
    .replace(/\/$/, '');
}

function getRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
