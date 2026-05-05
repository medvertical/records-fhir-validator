/**
 * Reference Field Definitions
 * 
 * Defines which fields contain references for each FHIR resource type.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ReferenceFieldDefinition, ReferenceFieldMap } from './reference-types';

// ============================================================================
// Reference Field Initialization
// ============================================================================

export function initializeReferenceFields(): ReferenceFieldMap {
  const fields: ReferenceFieldMap = new Map();

  // Patient references
  fields.set('Patient', [
    { path: 'generalPractitioner', type: 'Reference', required: false },
    { path: 'managingOrganization', type: 'Reference', required: false },
    { path: 'link.other', type: 'Reference', required: false },
  ]);

  // Observation references
  fields.set('Observation', [
    { path: 'subject', type: 'Reference', required: true, targetTypes: ['Patient', 'Group', 'Device', 'Location'] },
    { path: 'encounter', type: 'Reference', required: false, targetTypes: ['Encounter'] },
    { path: 'performer', type: 'Reference', required: false },
    { path: 'basedOn', type: 'Reference', required: false },
    { path: 'partOf', type: 'Reference', required: false },
    { path: 'focus', type: 'Reference', required: false },
    { path: 'hasMember', type: 'Reference', required: false },
    { path: 'derivedFrom', type: 'Reference', required: false },
  ]);

  // Condition references
  fields.set('Condition', [
    { path: 'subject', type: 'Reference', required: true, targetTypes: ['Patient', 'Group'] },
    { path: 'encounter', type: 'Reference', required: false, targetTypes: ['Encounter'] },
    { path: 'recorder', type: 'Reference', required: false },
    { path: 'asserter', type: 'Reference', required: false },
    { path: 'stage.assessment', type: 'Reference', required: false },
    { path: 'evidence.detail', type: 'Reference', required: false },
  ]);

  // Encounter references
  fields.set('Encounter', [
    { path: 'subject', type: 'Reference', required: true, targetTypes: ['Patient', 'Group'] },
    { path: 'episodeOfCare', type: 'Reference', required: false },
    { path: 'basedOn', type: 'Reference', required: false },
    { path: 'participant.individual', type: 'Reference', required: false },
    { path: 'appointment', type: 'Reference', required: false },
    { path: 'reasonReference', type: 'Reference', required: false },
    { path: 'diagnosis.condition', type: 'Reference', required: false },
    { path: 'account', type: 'Reference', required: false },
    { path: 'hospitalization.origin', type: 'Reference', required: false },
    { path: 'hospitalization.destination', type: 'Reference', required: false },
    { path: 'location.location', type: 'Reference', required: false },
    { path: 'serviceProvider', type: 'Reference', required: false },
    { path: 'partOf', type: 'Reference', required: false },
  ]);

  // MedicationRequest references
  fields.set('MedicationRequest', [
    { path: 'subject', type: 'Reference', required: true, targetTypes: ['Patient', 'Group'] },
    { path: 'encounter', type: 'Reference', required: false },
    { path: 'medication', type: 'Reference', required: false, targetTypes: ['Medication'] },
    { path: 'requester', type: 'Reference', required: false },
    { path: 'performer', type: 'Reference', required: false },
    { path: 'recorder', type: 'Reference', required: false },
    { path: 'reasonReference', type: 'Reference', required: false },
    { path: 'basedOn', type: 'Reference', required: false },
    { path: 'insurance', type: 'Reference', required: false },
    { path: 'dispenseRequest.performer', type: 'Reference', required: false },
    { path: 'priorPrescription', type: 'Reference', required: false },
    { path: 'detectedIssue', type: 'Reference', required: false },
    { path: 'eventHistory', type: 'Reference', required: false },
  ]);

  // Procedure references
  fields.set('Procedure', [
    { path: 'subject', type: 'Reference', required: true, targetTypes: ['Patient', 'Group'] },
    { path: 'encounter', type: 'Reference', required: false },
    { path: 'recorder', type: 'Reference', required: false },
    { path: 'asserter', type: 'Reference', required: false },
    { path: 'performer.actor', type: 'Reference', required: false },
    { path: 'performer.onBehalfOf', type: 'Reference', required: false },
    { path: 'location', type: 'Reference', required: false },
    { path: 'reasonReference', type: 'Reference', required: false },
    { path: 'basedOn', type: 'Reference', required: false },
    { path: 'partOf', type: 'Reference', required: false },
    { path: 'complicationDetail', type: 'Reference', required: false },
    { path: 'report', type: 'Reference', required: false },
    { path: 'usedReference', type: 'Reference', required: false },
  ]);

  // DiagnosticReport references
  fields.set('DiagnosticReport', [
    { path: 'subject', type: 'Reference', required: true },
    { path: 'encounter', type: 'Reference', required: false },
    { path: 'performer', type: 'Reference', required: false },
    { path: 'resultsInterpreter', type: 'Reference', required: false },
    { path: 'specimen', type: 'Reference', required: false },
    { path: 'result', type: 'Reference', required: false },
    { path: 'imagingStudy', type: 'Reference', required: false },
    { path: 'media.link', type: 'Reference', required: false },
    { path: 'basedOn', type: 'Reference', required: false },
  ]);

  // Organization references
  fields.set('Organization', [
    { path: 'partOf', type: 'Reference', required: false, targetTypes: ['Organization'] },
    { path: 'endpoint', type: 'Reference', required: false },
  ]);

  // Practitioner references
  fields.set('Practitioner', [
    { path: 'qualification.issuer', type: 'Reference', required: false, targetTypes: ['Organization'] },
  ]);

  // ServiceRequest references
  fields.set('ServiceRequest', [
    { path: 'subject', type: 'Reference', required: true },
    { path: 'encounter', type: 'Reference', required: false },
    { path: 'requester', type: 'Reference', required: false },
    { path: 'performer', type: 'Reference', required: false },
    { path: 'locationReference', type: 'Reference', required: false },
    { path: 'reasonReference', type: 'Reference', required: false },
    { path: 'insurance', type: 'Reference', required: false },
    { path: 'supportingInfo', type: 'Reference', required: false },
    { path: 'specimen', type: 'Reference', required: false },
    { path: 'relevantHistory', type: 'Reference', required: false },
  ]);

  return fields;
}

/**
 * Get reference fields for a resource type
 */
export function getReferenceFields(resourceType: string): ReferenceFieldDefinition[] {
  const fields = initializeReferenceFields();
  return fields.get(resourceType) || [];
}

/**
 * Check if a field is a reference field for a given resource type
 */
export function isReferenceField(resourceType: string, fieldPath: string): boolean {
  const fields = getReferenceFields(resourceType);
  return fields.some(f => f.path === fieldPath);
}

/**
 * Get target types for a reference field
 */
export function getTargetTypes(resourceType: string, fieldPath: string): string[] | undefined {
  const fields = getReferenceFields(resourceType);
  const field = fields.find(f => f.path === fieldPath);
  return field?.targetTypes;
}

/**
 * Check if a reference field is required
 */
export function isRequiredReference(resourceType: string, fieldPath: string): boolean {
  const fields = getReferenceFields(resourceType);
  const field = fields.find(f => f.path === fieldPath);
  return field?.required || false;
}

