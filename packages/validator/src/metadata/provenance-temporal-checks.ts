import { isValid, parseISO } from 'date-fns';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createProvenanceIssue } from './provenance-chain-issue.js';
import { asRecord, type ProvenanceResource } from './provenance-chain-types.js';

const FHIR_INSTANT_RE =
  /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(?:\.[0-9]+)?(?:Z|[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/;

export function validateProvenanceRecorded(
  resource: ProvenanceResource,
  issues: ValidationIssue[],
): void {
  if (resource.recorded === undefined || resource.recorded === null || resource.recorded === '') {
    issues.push(createProvenanceIssue({
      resource,
      severity: 'error',
      code: 'provenance-missing-recorded',
      path: 'Provenance.recorded',
      message: 'Provenance.recorded is required.',
      humanReadable: 'Provenance records must capture when the authoring activity was recorded.',
    }));
    return;
  }
  if (parseFhirInstant(resource.recorded) === undefined) {
    issues.push(createProvenanceIssue({
      resource,
      severity: 'error',
      code: 'provenance-invalid-recorded',
      path: 'Provenance.recorded',
      message: 'Provenance.recorded is not a valid FHIR instant.',
      humanReadable: 'Use an ISO 8601 instant with timezone, e.g. 2026-04-08T10:15:30Z',
    }));
  }
}

export function validateProvenanceOccurredOrder(
  resource: ProvenanceResource,
  issues: ValidationIssue[],
): void {
  const recordedTimestamp = parseFhirInstant(resource.recorded);
  if (recordedTimestamp === undefined) return;
  const eventTimestamp = getOccurredTimestamp(resource);
  if (eventTimestamp === undefined || eventTimestamp <= recordedTimestamp) return;
  issues.push(createProvenanceIssue({
    resource,
    severity: 'warning',
    code: 'provenance-recorded-before-event',
    path: 'Provenance.recorded',
    message: 'Provenance.recorded precedes the occurred date/time of the described activity.',
    humanReadable: 'The recording timestamp should be at or after the described event.',
  }));
}

function getOccurredTimestamp(resource: ProvenanceResource): number | undefined {
  if (typeof resource.occurredDateTime === 'string') {
    return parseDateTime(resource.occurredDateTime);
  }
  const period = asRecord(resource.occurredPeriod);
  if (!period) return undefined;
  if (typeof period.end === 'string') return parseDateTime(period.end);
  return typeof period.start === 'string' ? parseDateTime(period.start) : undefined;
}

function parseFhirInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !FHIR_INSTANT_RE.test(value)) return undefined;
  return parseDateTime(value);
}

function parseDateTime(value: string): number | undefined {
  const hasLeapSecond = /T\d{2}:\d{2}:60(?:\.|Z|[+-])/.test(value);
  const normalized = hasLeapSecond ? value.replace(/:60(?=\.|Z|[+-])/, ':59') : value;
  const parsed = parseISO(normalized);
  if (!isValid(parsed)) return undefined;
  return parsed.getTime() + (hasLeapSecond ? 1_000 : 0);
}
