/**
 * Resource-specific invariant implementations that are safer to evaluate
 * directly than through generic FHIRPath.
 */

import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateCompositionConstraints } from './resource-specific-composition-constraints.js';
import { validateGermanMedicationDosage } from './resource-specific-medication-dosage.js';
import { validateObservationConstraints } from './resource-specific-observation-constraints.js';

type FhirResource = Record<string, unknown> & { resourceType: string };

const CONDITION_ABATEMENT_KEYS = [
  'abatementDateTime',
  'abatementAge',
  'abatementPeriod',
  'abatementRange',
  'abatementString',
] as const;

const CONDITION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-category';
const CONDITION_CLINICAL_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-clinical';
const CONDITION_VERIFICATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const ALLERGY_CLINICAL_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
const ALLERGY_VERIFICATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';

const BUNDLE_ENTRY_RULES = [
  {
    field: 'search',
    allowedTypes: new Set(['searchset']),
    code: 'bdl-2-violation',
    message: 'bdl-2: entry.search only when type is searchset',
  },
  {
    field: 'request',
    allowedTypes: new Set(['batch', 'transaction', 'history']),
    code: 'bdl-3-violation',
    message: 'bdl-3: entry.request only when type is batch/transaction/history',
  },
  {
    field: 'response',
    allowedTypes: new Set(['batch-response', 'transaction-response', 'history']),
    code: 'bdl-4-violation',
    message: 'bdl-4: entry.response only when type is batch-response/transaction-response/history',
  },
] as const;

export class ResourceSpecificConstraintsValidator {
  validate(
    value: unknown,
    existingIssues: ValidationIssue[] = [],
    profileUrl?: string,
  ): ValidationIssue[] {
    if (!isFhirResource(value)) return [];
    const resource = value;

    switch (resource.resourceType) {
      case 'Condition':
        return this.validateCondition(resource);
      case 'Patient':
        return this.validatePatient(
          resource,
          Array.isArray(existingIssues) ? existingIssues : [],
        );
      case 'Bundle':
        return this.validateBundle(resource);
      case 'AllergyIntolerance':
        return this.validateAllergyIntolerance(resource);
      case 'Composition':
        logger.debug('[ResourceConstraints] Validating Composition constraints');
        return validateCompositionConstraints(resource);
      case 'Observation':
        return validateObservationConstraints(resource);
      case 'MedicationRequest':
      case 'MedicationDispense':
      case 'MedicationStatement':
        return validateGermanMedicationDosage(resource, profileUrl);
      default:
        return [];
    }
  }

  private validateCondition(resource: FhirResource): ValidationIssue[] {
    logger.debug('[ResourceConstraints] Validating Condition constraints');
    const issues: ValidationIssue[] = [];
    const clinicalStatus = getCodeableConceptCode(
      resource.clinicalStatus,
      CONDITION_CLINICAL_SYSTEM,
    );
    const verificationStatus = getCodeableConceptCode(
      resource.verificationStatus,
      CONDITION_VERIFICATION_SYSTEM,
    );

    if (
      hasCode(resource.category, 'problem-list-item', CONDITION_CATEGORY_SYSTEM) &&
      verificationStatus !== 'entered-in-error' &&
      !clinicalStatus
    ) {
      issues.push(createValidationIssue({
        code: 'profile-constraint-warning',
        path: 'Condition.clinicalStatus',
        resourceType: 'Condition',
        customMessage: 'Constraint \'con-3\' failed: Condition.clinicalStatus SHALL be present if verificationStatus is not entered-in-error and category is problem-list-item',
        ruleId: 'con-3',
        severityOverride: 'warning',
        aspectOverride: 'profile',
        details: {
          constraintKey: 'con-3',
          originalSeverity: 'warning',
        },
      }));
    }

    const hasAbatement = CONDITION_ABATEMENT_KEYS.some(key =>
      isPresent(resource[key])
    );
    if (
      hasAbatement &&
      clinicalStatus &&
      !['inactive', 'remission', 'resolved'].includes(clinicalStatus)
    ) {
      issues.push(createValidationIssue({
        code: 'con-4-violation',
        path: 'Condition.abatement[x]',
        resourceType: 'Condition',
        customMessage: 'con-4: If abatement is present, clinicalStatus SHALL be inactive/remission/resolved',
        severityOverride: 'error',
      }));
    }

    if (verificationStatus === 'entered-in-error' && clinicalStatus) {
      issues.push(createValidationIssue({
        code: 'con-5-violation',
        path: 'Condition.clinicalStatus',
        resourceType: 'Condition',
        customMessage: 'con-5: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error',
        severityOverride: 'error',
      }));
    }

    return issues;
  }

  private validatePatient(
    resource: FhirResource,
    existingIssues: ValidationIssue[],
  ): ValidationIssue[] {
    logger.debug('[ResourceConstraints] Validating Patient constraints');
    const issues: ValidationIssue[] = [];
    const contacts = Array.isArray(resource.contact) ? resource.contact : [];

    contacts.forEach((contact, index) => {
      if (!isRecord(contact)) return;
      const hasName = isNonEmptyRecord(contact.name);
      const hasTelecom = Array.isArray(contact.telecom) &&
        contact.telecom.some(isNonEmptyRecord);
      const hasAddress = isNonEmptyRecord(contact.address);
      const hasOrganization = isNonEmptyRecord(contact.organization);
      if (hasName || hasTelecom || hasAddress || hasOrganization) return;

      issues.push(createValidationIssue({
        code: 'pat-1-violation',
        path: `Patient.contact[${index}]`,
        resourceType: 'Patient',
        customMessage: 'pat-1: contact SHALL have at least one of name, telecom, address, or organization',
        severityOverride: 'error',
      }));
    });

    if (typeof resource.birthDate !== 'string' || resource.birthDate.length === 0) {
      return issues;
    }

    const birthDate = new Date(resource.birthDate);
    const hasProfileMaxValueIssue = existingIssues.some(issue =>
      isRecord(issue) &&
      issue.code === 'profile-max-value-duration-violation' &&
      issue.path === 'Patient.birthDate'
    );
    if (
      !Number.isNaN(birthDate.getTime()) &&
      birthDate.getTime() > Date.now() &&
      !hasProfileMaxValueIssue
    ) {
      issues.push(createValidationIssue({
        code: 'business-future-birth-date',
        path: 'Patient.birthDate',
        resourceType: 'Patient',
        customMessage:
          `Patient.birthDate is in the future (${resource.birthDate}). ` +
          'This is almost always a data-entry or timezone bug; age-based ' +
          'dosage and cohort queries will mis-classify the patient.',
        severityOverride: 'warning',
        aspectOverride: 'invariant',
      }));
    }

    return issues;
  }

  private validateBundle(resource: FhirResource): ValidationIssue[] {
    logger.debug('[ResourceConstraints] Validating Bundle constraints');
    const issues: ValidationIssue[] = [];
    const bundleType = resource.type;

    if (
      isPresent(resource.total) &&
      bundleType !== 'searchset' &&
      bundleType !== 'history'
    ) {
      issues.push(createValidationIssue({
        code: 'bdl-1-violation',
        path: 'Bundle.total',
        resourceType: 'Bundle',
        customMessage: 'bdl-1: total only when type is searchset or history',
        severityOverride: 'error',
      }));
    }

    const entries = Array.isArray(resource.entry) ? resource.entry : [];
    for (const rule of BUNDLE_ENTRY_RULES) {
      const index = entries.findIndex(entry =>
        isRecord(entry) && isPresent(entry[rule.field])
      );
      if (
        index < 0 ||
        (typeof bundleType === 'string' && rule.allowedTypes.has(bundleType))
      ) {
        continue;
      }

      issues.push(createValidationIssue({
        code: rule.code,
        path: `Bundle.entry[${index}].${rule.field}`,
        resourceType: 'Bundle',
        customMessage: rule.message,
        severityOverride: 'error',
      }));
    }

    return issues;
  }

  private validateAllergyIntolerance(resource: FhirResource): ValidationIssue[] {
    logger.debug('[ResourceConstraints] Validating AllergyIntolerance constraints');
    const issues: ValidationIssue[] = [];
    const clinicalStatus = getCodeableConceptCode(
      resource.clinicalStatus,
      ALLERGY_CLINICAL_SYSTEM,
    );
    const verificationStatus = getCodeableConceptCode(
      resource.verificationStatus,
      ALLERGY_VERIFICATION_SYSTEM,
    );

    if (verificationStatus !== 'entered-in-error' && !clinicalStatus) {
      issues.push(createValidationIssue({
        code: 'ait-1-violation',
        path: 'AllergyIntolerance.clinicalStatus',
        resourceType: 'AllergyIntolerance',
        customMessage: 'ait-1: AllergyIntolerance.clinicalStatus SHALL be present if verificationStatus is not entered-in-error',
        severityOverride: 'error',
      }));
    }

    if (verificationStatus === 'entered-in-error' && clinicalStatus) {
      issues.push(createValidationIssue({
        code: 'ait-2-violation',
        path: 'AllergyIntolerance.clinicalStatus',
        resourceType: 'AllergyIntolerance',
        customMessage: 'ait-2: AllergyIntolerance.clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error',
        severityOverride: 'error',
      }));
    }

    return issues;
  }

}

function getCodeableConceptCode(
  value: unknown,
  preferredSystem: string,
): string | null {
  if (!isRecord(value) || !Array.isArray(value.coding)) return null;
  const codings = value.coding.filter(isCodingWithCode);
  const preferred = codings.find(coding => coding.system === preferredSystem);
  return preferred?.code ?? codings[0]?.code ?? null;
}

function hasCode(value: unknown, code: string, system?: string): boolean {
  const values = Array.isArray(value) ? value : isPresent(value) ? [value] : [];
  return values.some(item => {
    if (!isRecord(item)) return false;
    if (item.code === code && (!system || item.system === system)) return true;
    return Array.isArray(item.coding) && item.coding.some(coding =>
      isRecord(coding) &&
      coding.code === code &&
      (!system || coding.system === system)
    );
  });
}

function isCodingWithCode(
  value: unknown,
): value is Record<string, unknown> & { code: string } {
  return isRecord(value) &&
    typeof value.code === 'string' &&
    value.code.length > 0;
}

function isFhirResource(value: unknown): value is FhirResource {
  return isRecord(value) &&
    typeof value.resourceType === 'string' &&
    value.resourceType.length > 0;
}

function isNonEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const resourceSpecificConstraintsValidator = new ResourceSpecificConstraintsValidator();
