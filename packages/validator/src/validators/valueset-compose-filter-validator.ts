import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
  ALLOWED_FILTER_OPS,
  codeSystemHasCode,
  getCachedCodeSystem,
  isTxOnlySystem,
  parseSystemVersionCode,
} from './terminology-resource-utils.js';
import type {
  CodeSystem,
  CodeSystemFilterDefinition,
  CodeSystemPropertyDefinition,
} from './valueset-types.js';
import { ValueSetCache } from './valueset-cache.js';

type ObjectRecord = Record<string, unknown>;

/**
 * Validate the `filter[]` array on a compose.include or compose.exclude entry.
 */
export function validateValueSetComposeFilters(
  entry: unknown,
  pathPrefix: string,
  cache: ValueSetCache = new ValueSetCache(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObjectRecord(entry) || !Array.isArray(entry.filter)) return issues;

  const systemUrl: string | undefined = typeof entry.system === 'string' ? entry.system : undefined;
  const targetCs = getCachedCodeSystem(systemUrl, cache);

  for (let f = 0; f < entry.filter.length; f++) {
    const filter = entry.filter[f];
    if (!isObjectRecord(filter)) continue;

    const filterPath = `${pathPrefix}.filter[${f}]`;
    const op = typeof filter.op === 'string' ? filter.op : '';
    const property = typeof filter.property === 'string' ? filter.property : '';
    const value = typeof filter.value === 'string' ? filter.value : '';

    issues.push(...validateFilterOperator(op, filterPath));

    const { propDef, filterDef, hasKnownDefs } = resolveCodeSystemFilterDefinitions(targetCs, property);
    if (
      targetCs &&
      property &&
      property !== 'concept' &&
      hasKnownDefs &&
      !propDef &&
      !filterDef &&
      !isTxOnlySystem(systemUrl ?? '')
    ) {
      issues.push(createValidationIssue({
        code: 'tx-valueset-filter-property-unknown',
        path: filterPath,
        resourceType: 'ValueSet',
        customMessage:
          `The property '${property}' is not defined on the CodeSystem '${systemUrl}'`,
        severityOverride: 'error',
      }));
    }

    issues.push(...validateFilterValue(op, property, value, propDef, filterPath, cache));
  }

  return issues;
}

function validateFilterOperator(op: string, filterPath: string): ValidationIssue[] {
  if (!op || ALLOWED_FILTER_OPS.has(op)) return [];

  return [createValidationIssue({
    code: 'tx-valueset-filter-op-invalid',
    path: filterPath,
    resourceType: 'ValueSet',
    customMessage:
      `The filter operation '${op}' is not a valid operation ` +
      `(must be one of: ${Array.from(ALLOWED_FILTER_OPS).join(', ')})`,
    severityOverride: 'error',
  })];
}

function resolveCodeSystemFilterDefinitions(
  targetCs: CodeSystem | undefined,
  property: string,
): {
  propDef: CodeSystemPropertyDefinition | undefined;
  filterDef: CodeSystemFilterDefinition | undefined;
  hasKnownDefs: boolean;
} {
  const csProperties = Array.isArray(targetCs?.property) ? targetCs.property : [];
  const csFilters = Array.isArray(targetCs?.filter) ? targetCs.filter : [];
  return {
    propDef: property ? csProperties.find(definition => definition?.code === property) : undefined,
    filterDef: property ? csFilters.find(definition => definition?.code === property) : undefined,
    hasKnownDefs: csProperties.length > 0 || csFilters.length > 0,
  };
}

function validateFilterValue(
  op: string,
  property: string,
  value: string,
  propDef: CodeSystemPropertyDefinition | undefined,
  filterPath: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (op === 'regex' && value) {
    try {
      void new RegExp(value);
    } catch {
      issues.push(createValidationIssue({
        code: 'tx-valueset-filter-value-invalid-regex',
        path: filterPath,
        resourceType: 'ValueSet',
        customMessage:
          `The filter value '${value}' is not a valid regular expression`,
        severityOverride: 'error',
      }));
    }
  }

  if (op === '=' && propDef?.type === 'Coding' && value) {
    issues.push(...validateCodingFilterValue(property, value, filterPath, cache));
  }

  return issues;
}

function validateCodingFilterValue(
  property: string,
  value: string,
  filterPath: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const parsed = parseSystemVersionCode(value);
  if (!parsed) {
    return [createValidationIssue({
      code: 'tx-valueset-filter-value-format',
      path: filterPath,
      resourceType: 'ValueSet',
      customMessage:
        `The value for a filter based on property '${property}' must be ` +
        `in the format system(|version)#code, not '${value}'`,
      severityOverride: 'error',
    })];
  }

  const subCs = getCachedCodeSystem(parsed.system, cache);
  if (!subCs || codeSystemHasCode(subCs, parsed.code)) return [];

  const subVersion = typeof subCs.version === 'string' ? subCs.version : 'null';
  return [createValidationIssue({
    code: 'tx-valueset-filter-value-unknown-code',
    path: filterPath,
    resourceType: 'ValueSet',
    customMessage:
      `The value for a filter based on property '${property}' is '${value}' ` +
      `which is not a valid code (Unknown code '${parsed.code}' in the CodeSystem ` +
      `'${parsed.system}' version '${subVersion}')`,
    severityOverride: 'error',
  })];
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
