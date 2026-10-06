import type { ValidationIssue } from '@records-fhir/validation-types';

/** Metadata format only; these extensions do not authenticate a validator or its evidence. */
const METADATA_URL = 'https://records.medvertical.com/fhir/StructureDefinition/validation-issue-metadata';
const TEXT_FIELDS = ['id', 'aspect', 'profile', 'definitionProfile', 'ruleId', 'rawSeverity', 'disposition'] as const;
const DETAIL_FIELDS = ['constraintKey', 'profileUrl', 'targetProfile', 'validationStatus'] as const;
const RAW_SEVERITIES = new Set(['fatal', 'error', 'warning', 'information', 'info', 'inherit']);

export type FhirIssueMetadataValue = { url: string } & (
  { valueString: string } | { valueBoolean: boolean }
);
export interface FhirIssueMetadataExtension {
  url: string;
  extension: FhirIssueMetadataValue[];
}

export interface OperationOutcomeIssueMetadata {
  id?: string;
  aspect?: string;
  profile?: string;
  definitionProfile?: string;
  ruleId?: string;
  rawSeverity?: ValidationIssue['rawSeverity'];
  disposition?: ValidationIssue['disposition'];
  details?: Record<string, unknown>;
}

/** Only bounded identity/completeness fields cross this boundary, never arbitrary details. */
export function selectIssueMetadata(value: Record<string, unknown>): OperationOutcomeIssueMetadata {
  const selected: OperationOutcomeIssueMetadata = {};
  for (const field of TEXT_FIELDS) {
    const text = metadataText(value[field]);
    if (text && validTextField(field, text)) Object.assign(selected, { [field]: text });
  }
  const details = record(value.details);
  const selectedDetails: Record<string, unknown> = {};
  for (const field of DETAIL_FIELDS) {
    const text = metadataText(details?.[field]);
    if (text && validTextField(field, text)) selectedDetails[field] = text;
  }
  if (typeof details?.validationComplete === 'boolean') selectedDetails.validationComplete = details.validationComplete;
  else if (details && Object.hasOwn(details, 'validationComplete')) {
    selectedDetails.validationComplete = false;
    selectedDetails.validationStatus = 'incomplete';
  }
  if (details && Object.hasOwn(details, 'validationStatus')
    && details.validationStatus !== 'complete' && details.validationStatus !== 'incomplete') {
    selectedDetails.validationComplete = false;
    selectedDetails.validationStatus = 'incomplete';
  }
  if (selectedDetails.validationStatus === 'incomplete') selectedDetails.validationComplete = false;
  if (Object.keys(selectedDetails).length) selected.details = selectedDetails;
  return selected;
}

export function encodeIssueMetadata(issue: ValidationIssue): FhirIssueMetadataExtension[] | undefined {
  const metadata = selectIssueMetadata(issue as unknown as Record<string, unknown>);
  const values: FhirIssueMetadataValue[] = [];
  for (const field of TEXT_FIELDS) {
    const text = metadata[field];
    if (typeof text === 'string') values.push({ url: field, valueString: text });
  }
  for (const field of DETAIL_FIELDS) {
    const text = metadata.details?.[field];
    if (typeof text === 'string') values.push({ url: field, valueString: text });
  }
  const complete = metadata.details?.validationComplete;
  if (typeof complete === 'boolean') values.push({ url: 'validationComplete', valueBoolean: complete });
  return values.length ? [{ url: METADATA_URL, extension: values }] : undefined;
}

/** Malformed recognized metadata stays unverified; no annotation can replace FHIR severity. */
export function decodeIssueMetadata(value: unknown, recordsCode?: string): OperationOutcomeIssueMetadata {
  if (!Array.isArray(value)) return record(value)?.url === METADATA_URL ? incompleteMetadata() : {};
  const containers = value.filter(candidate => record(candidate)?.url === METADATA_URL);
  if (!containers.length) return {};
  const container = record(containers[0]);
  if (containers.length !== 1 || !container || !Array.isArray(container.extension)
    || Object.keys(container).some(key => key.startsWith('value')) || !container.extension.length || container.extension.length > 32) return incompleteMetadata();
  const fields: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const candidate of container.extension) {
    const entry = record(candidate);
    const field = metadataText(entry?.url);
    if (!entry || !field || seen.has(field)) return incompleteMetadata();
    seen.add(field);
    if (!recognizedField(field)) return incompleteMetadata();
    if (Object.hasOwn(entry, 'extension')) return incompleteMetadata();
    const valueKeys = Object.keys(entry).filter(key => key.startsWith('value'));
    const expected = field === 'validationComplete' ? 'valueBoolean' : 'valueString';
    if (valueKeys.length !== 1 || valueKeys[0] !== expected) return incompleteMetadata();
    if (field === 'validationComplete') {
      if (typeof entry.valueBoolean !== 'boolean') return incompleteMetadata();
      details.validationComplete = entry.valueBoolean;
    } else {
      const text = metadataText(entry.valueString);
      if (!text || !validTextField(field, text)) return incompleteMetadata();
      if (DETAIL_FIELDS.some(candidate => candidate === field)) details[field] = text;
      else fields[field] = text;
    }
  }
  if (details.validationStatus === 'incomplete') details.validationComplete = false;
  if (details.validationComplete === true && (!fields.aspect || !recordsCode)) return incompleteMetadata();
  if (!Object.keys(fields).length && !Object.keys(details).length) return incompleteMetadata();
  return selectIssueMetadata({ ...fields, details });
}

export function createUnknownOutcomeIssue(message: string): ValidationIssue {
  return { aspect: 'structural', severity: 'information', code: 'informational', message,
    details: { validationComplete: false, validationStatus: 'incomplete' } };
}

function incompleteMetadata(): OperationOutcomeIssueMetadata {
  return { details: { validationComplete: false, validationStatus: 'incomplete' } };
}

function recognizedField(field: string): boolean {
  return field === 'validationComplete' || [...TEXT_FIELDS, ...DETAIL_FIELDS].some(candidate => candidate === field);
}

function validTextField(field: string, text: string): boolean {
  if (field === 'rawSeverity') return RAW_SEVERITIES.has(text);
  if (field === 'disposition') return text === 'active' || text === 'suppressed';
  if (field === 'validationStatus') return text === 'complete' || text === 'incomplete';
  if (field === 'aspect') return /^[a-z][a-z0-9_-]{0,63}$/.test(text);
  return true;
}

function metadataText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
    && !Array.from(value).some(character => {
      const code = character.charCodeAt(0);
      return code < 32 && ![9, 10, 13].includes(code);
    }) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
