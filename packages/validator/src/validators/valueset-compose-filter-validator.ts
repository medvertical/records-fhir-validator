import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  ALLOWED_FILTER_OPS,
  codeSystemHasCode,
  getCachedCodeSystem,
  parseSystemVersionCode,
} from './terminology-resource-utils';

/**
 * Validate the `filter[]` array on a compose.include or compose.exclude entry.
 */
export function validateValueSetComposeFilters(
  entry: any,
  pathPrefix: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!entry || !Array.isArray(entry.filter)) return issues;

  const systemUrl: string | undefined = typeof entry.system === 'string' ? entry.system : undefined;
  const targetCs = getCachedCodeSystem(systemUrl);

  for (let f = 0; f < entry.filter.length; f++) {
    const filter = entry.filter[f];
    if (!filter || typeof filter !== 'object') continue;

    const filterPath = `${pathPrefix}.filter[${f}]`;
    const op = typeof filter.op === 'string' ? filter.op : '';
    const property = typeof filter.property === 'string' ? filter.property : '';
    const value = typeof filter.value === 'string' ? filter.value : '';

    issues.push(...validateFilterOperator(op, filterPath));

    const { propDef, filterDef, hasKnownDefs } = resolveCodeSystemFilterDefinitions(targetCs, property);
    if (targetCs && property && hasKnownDefs && !propDef && !filterDef) {
      issues.push(createValidationIssue({
        code: 'tx-valueset-filter-property-unknown',
        path: filterPath,
        resourceType: 'ValueSet',
        customMessage:
          `The property '${property}' is not defined on the CodeSystem '${systemUrl}'`,
        severityOverride: 'error',
      }));
    }

    issues.push(...validateFilterValue(op, property, value, propDef, filterPath));
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
  targetCs: any,
  property: string,
): { propDef: any; filterDef: any; hasKnownDefs: boolean } {
  const csProperties: any[] = Array.isArray(targetCs?.property) ? targetCs.property : [];
  const csFilters: any[] = Array.isArray(targetCs?.filter) ? targetCs.filter : [];
  return {
    propDef: property ? csProperties.find((p: any) => p?.code === property) : undefined,
    filterDef: property ? csFilters.find((f: any) => f?.code === property) : undefined,
    hasKnownDefs: csProperties.length > 0 || csFilters.length > 0,
  };
}

function validateFilterValue(
  op: string,
  property: string,
  value: string,
  propDef: any,
  filterPath: string,
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
    issues.push(...validateCodingFilterValue(property, value, filterPath));
  }

  return issues;
}

function validateCodingFilterValue(
  property: string,
  value: string,
  filterPath: string,
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

  const subCs = getCachedCodeSystem(parsed.system);
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
