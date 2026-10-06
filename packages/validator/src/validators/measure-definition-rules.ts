/**
 * Resource-only Measure checks. R4 text/cql can be inline or named, so only
 * the explicit CQL identifier language has a declared-context prerequisite.
 * Library availability and expression evaluation are outside this owner.
 */

import type { ValidationIssue, ValidationSeverity } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

type FhirRecord = Record<string, unknown>;

const CQL_IDENTIFIER_LANGUAGE = 'text/cql.identifier';
const CQF_LIBRARY = 'http://hl7.org/fhir/StructureDefinition/cqf-library';

export function validateMeasureDefinition(measure: FhirRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string, severity: ValidationSeverity = 'warning') => {
    issues.push(createValidationIssue({ code, path, resourceType: 'Measure', customMessage: message, severityOverride: severity }));
  };

  const groups = records(measure.group);
  if (groups.length === 0) {
    report('measure-groups-missing', 'Measure', 'A measure should contain at least one group');
    return issues;
  }
  const namesLibrary = (Array.isArray(measure.library)
    && measure.library.some(library => typeof library === 'string' && library.length > 0))
    || records(measure.extension).some(extension => extension.url === CQF_LIBRARY
      && typeof extension.valueCanonical === 'string' && extension.valueCanonical.length > 0);

  groups.forEach((group, groupIndex) => {
    const groupPath = `Measure.group[${groupIndex}]`;
    if (groups.length > 1 && group.code === undefined) {
      report('measure-group-code-missing', groupPath, 'Groups should have codes when there is more than one group');
    }
    const populations = records(group.population);
    if (populations.length === 0) {
      report('measure-group-population-missing', groupPath, 'Measure Groups should have at least one population');
    }
    populations.forEach((population, index) => {
      if (populations.length > 1 && population.code === undefined) {
        report('measure-population-code-missing', `${groupPath}.population[${index}]`,
          'A measure group population should have a code when there is more than one population');
      }
    });
    const stratifiers = records(group.stratifier);
    stratifiers.forEach((stratifier, index) => {
      const stratifierPath = `${groupPath}.stratifier[${index}]`;
      if (stratifiers.length > 1 && stratifier.code === undefined) {
        report('measure-stratifier-code-missing', stratifierPath,
          'A measure group stratifier should have a code when there is more than one population');
      }
      const criteria = isRecord(stratifier.criteria) ? stratifier.criteria : undefined;
      if (criteria && typeof criteria.language === 'string' && criteria.language === CQL_IDENTIFIER_LANGUAGE && !namesLibrary
        && !(typeof criteria.reference === 'string' && criteria.reference.length > 0)) {
        report('measure-criteria-cql-library-missing', `${stratifierPath}.criteria`,
          'No Library or expression reference is declared for this CQL identifier criterion', 'error');
      }
    });
  });
  return issues;
}

function records(value: unknown): FhirRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is FhirRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
