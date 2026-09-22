import type { ValidationIssue } from '@records-fhir/validation-types';
import { isObjectRecord } from './metadata-boundary-utils.js';
import { createMetadataIssue } from './metadata-issue.js';

export interface MetaFieldValidationOptions {
  missingSeverity: 'warning' | 'info';
  schemaVersion?: 'R4' | 'R5' | 'R6';
}

export function validateMetaField(
  resource: unknown,
  resourceType: string,
  options: MetaFieldValidationOptions,
): ValidationIssue[] {
  const record = isObjectRecord(resource) ? resource : null;
  const meta = record?.meta;
  if (meta === undefined || meta === null) {
    return [createMetadataIssue({
      code: 'missing-meta',
      severity: options.missingSeverity,
      message: 'Resource should have a meta field',
      path: 'meta',
      humanReadable: 'The resource should include metadata information',
      resourceType,
      validationMethod: 'metadata-field-validation',
      schemaVersion: options.schemaVersion,
    })];
  }

  if (!isObjectRecord(meta)) {
    return [createMetadataIssue({
      code: 'invalid-meta-type',
      severity: 'error',
      message: 'Meta field must be an object',
      path: 'meta',
      humanReadable: 'The meta field must be an object containing metadata information',
      resourceType,
      validationMethod: 'metadata-field-validation',
      schemaVersion: options.schemaVersion,
      details: {
        actualValue: meta,
        expectedType: 'object',
      },
    })];
  }
  return [];
}
