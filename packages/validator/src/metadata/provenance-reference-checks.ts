import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateReferenceFormat } from '../reference/reference-format-validator.js';
import { createProvenanceIssue } from './provenance-chain-issue.js';
import { asRecord, type ProvenanceResource } from './provenance-chain-types.js';

export function validateProvenanceTargets(
  resource: ProvenanceResource,
  issues: ValidationIssue[],
): void {
  const targets = resource.target;
  if (!Array.isArray(targets) || targets.length === 0) {
    issues.push(createProvenanceIssue({
      resource,
      severity: 'error',
      code: 'provenance-missing-target',
      path: 'Provenance.target',
      message: 'Provenance.target is required and must reference at least one resource.',
      humanReadable: 'Every Provenance resource must point to the resource(s) it describes.',
    }));
    return;
  }

  targets.forEach((target, index) => {
    const path = `Provenance.target[${index}]`;
    const targetRecord = asRecord(target);
    if (!targetRecord) {
      issues.push(createProvenanceIssue({
        resource,
        severity: 'error',
        code: 'provenance-target-invalid',
        path,
        message: `Provenance.target[${index}] must be an object with a reference.`,
      }));
      return;
    }

    const reference = typeof targetRecord.reference === 'string'
      ? targetRecord.reference.trim()
      : '';
    if (!reference) {
      if (!isMeaningfulIdentifier(targetRecord.identifier)) {
        issues.push(createProvenanceIssue({
          resource,
          severity: 'error',
          code: 'provenance-target-missing-reference',
          path: `${path}.reference`,
          message: `Provenance.target[${index}] must have a reference or identifier.`,
        }));
      }
      return;
    }

    if (!isWellFormedReference(reference, `${path}.reference`)) {
      issues.push(createProvenanceIssue({
        resource,
        severity: 'error',
        code: 'provenance-target-malformed-reference',
        path: `${path}.reference`,
        message: `Provenance.target[${index}].reference "${reference}" is not a well-formed FHIR reference.`,
        humanReadable: 'References must be of the form ResourceType/id, an absolute URL, or a urn:uuid: placeholder.',
      }));
    }
  });
}

export function validateProvenanceAgents(
  resource: ProvenanceResource,
  issues: ValidationIssue[],
): void {
  const agents = resource.agent;
  if (!Array.isArray(agents) || agents.length === 0) {
    issues.push(createProvenanceIssue({
      resource,
      severity: 'error',
      code: 'provenance-missing-agent',
      path: 'Provenance.agent',
      message: 'Provenance.agent requires at least one entry.',
      humanReadable: 'Every Provenance resource must record who performed the activity.',
    }));
    return;
  }

  agents.forEach((agent, index) => {
    const path = `Provenance.agent[${index}]`;
    const who = asRecord(asRecord(agent)?.who);
    const reference = typeof who?.reference === 'string' && who.reference.trim()
      ? who.reference.trim()
      : undefined;
    if (!who || (!reference && !isMeaningfulIdentifier(who.identifier))) {
      issues.push(createProvenanceIssue({
        resource,
        severity: 'warning',
        code: 'provenance-agent-missing-who',
        path: `${path}.who`,
        message: `Provenance.agent[${index}].who should have a reference or identifier.`,
        humanReadable: 'Agents should identify a specific actor (via reference or identifier) rather than a free-text display.',
      }));
      return;
    }
    if (reference && !isWellFormedReference(reference, `${path}.who.reference`)) {
      issues.push(createProvenanceIssue({
        resource,
        severity: 'error',
        code: 'provenance-agent-malformed-reference',
        path: `${path}.who.reference`,
        message: `Provenance.agent[${index}].who.reference "${reference}" is not a well-formed FHIR reference.`,
      }));
    }
  });
}

function isMeaningfulIdentifier(value: unknown): boolean {
  const identifier = asRecord(value);
  return identifier !== null && Object.keys(identifier).length > 0;
}

function isWellFormedReference(reference: string, path: string): boolean {
  const result = validateReferenceFormat(reference, { path, resourceType: 'Provenance' });
  return result.isValid && (result.referenceType !== 'relative' || Boolean(result.resourceType));
}
