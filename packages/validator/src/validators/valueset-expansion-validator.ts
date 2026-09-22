import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { stripVersion } from './terminology-resource-utils.js';

type ObjectRecord = Record<string, unknown>;

/**
 * Apply the best-practice rules Java raises against `ValueSet.expansion`.
 */
export function validateValueSetExpansion(expansion: unknown, compose?: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expansionRecord = isObjectRecord(expansion) ? expansion : {};
  const params: unknown[] = Array.isArray(expansionRecord.parameter)
    ? expansionRecord.parameter
    : [];

  if (params.length === 0) {
    issues.push(createValidationIssue({
      code: 'tx-valueset-expansion-no-parameters',
      path: 'ValueSet.expansion',
      resourceType: 'ValueSet',
      customMessage:
        `This expansion has no parameters; in the absence of the parameters that ` +
        `controlled the expansion, systems may not be able to determine whether ` +
        `it is safe to use this expansion`,
      severityOverride: 'warning',
    }));
  }

  if (
    typeof expansionRecord.identifier !== 'string' ||
    expansionRecord.identifier.length === 0
  ) {
    issues.push(createValidationIssue({
      code: 'tx-valueset-expansion-no-identifier',
      path: 'ValueSet.expansion',
      resourceType: 'ValueSet',
      customMessage:
        `This expansion has no identifier. Identifiers are recommended to help ` +
        `with audit and traceability`,
      severityOverride: 'information',
    }));
  }

  const declaredUsedCodesystems = collectDeclaredUsedCodesystems(params);
  const contains = flattenContains(expansionRecord.contains);
  issues.push(...validateUnversionedExpansionSystems(contains, declaredUsedCodesystems));
  issues.push(...validateHierarchicalFilterExpansionConsistency(contains, compose));

  return issues;
}

/**
 * A `parent = X` include selects concepts whose parent is X; it does not
 * select X itself. This consistency check catches an expansion that includes
 * the filter anchor as an extra code without requiring a terminology server.
 */
function validateHierarchicalFilterExpansionConsistency(
  contains: ObjectRecord[],
  compose: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const composeRecord = isObjectRecord(compose) ? compose : {};
  const includes = Array.isArray(composeRecord.include) ? composeRecord.include : [];

  for (const include of includes) {
    if (!isObjectRecord(include) || typeof include.system !== 'string' || !Array.isArray(include.filter)) continue;
    for (const filter of include.filter) {
      if (
        !isObjectRecord(filter) ||
        filter.property !== 'parent' ||
        filter.op !== '=' ||
        typeof filter.value !== 'string'
      ) continue;
      const extra = contains.find(item =>
        item.system === include.system && item.code === filter.value
      );
      if (!extra) continue;

      const key = `${include.system}|${filter.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(createValidationIssue({
        code: 'tx-valueset-expansion-extra-code',
        path: 'ValueSet.expansion',
        resourceType: 'ValueSet',
        customMessage:
          `The expansion provided has an extra code ${filter.value} that is not ` +
          'selected by the compose parent filter',
        severityOverride: 'warning',
        details: {
          system: include.system,
          code: filter.value,
          filterProperty: filter.property,
          filterOperator: filter.op,
        },
      }));
    }
  }

  return issues;
}

function flattenContains(value: unknown): ObjectRecord[] {
  if (!Array.isArray(value)) return [];
  const out: ObjectRecord[] = [];
  const stack: unknown[] = [...value].reverse();
  const visited = new WeakSet<object>();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!isObjectRecord(item) || visited.has(item)) continue;
    visited.add(item);
    out.push(item);
    if (Array.isArray(item.contains)) {
      for (let index = item.contains.length - 1; index >= 0; index--) {
        stack.push(item.contains[index]);
      }
    }
  }
  return out;
}

function collectDeclaredUsedCodesystems(params: unknown[]): Set<string> {
  const declaredUsedCodesystems = new Set<string>();
  for (const p of params) {
    if (
      isObjectRecord(p) &&
      p.name === 'used-codesystem' &&
      typeof p.valueUri === 'string'
    ) {
      declaredUsedCodesystems.add(stripVersion(p.valueUri));
    }
  }
  return declaredUsedCodesystems;
}

function validateUnversionedExpansionSystems(
  containsEntries: ObjectRecord[],
  declaredUsedCodesystems: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const seen = new Set<string>();
  for (const contains of containsEntries) {
    const system = typeof contains.system === 'string' ? contains.system : undefined;
    if (!system) continue;
    if (system.includes('|') || (typeof contains.version === 'string' && contains.version.length > 0)) continue;
    if (declaredUsedCodesystems.has(system)) continue;
    if (seen.has(system)) continue;
    seen.add(system);
    issues.push(createValidationIssue({
      code: 'tx-valueset-expansion-system-no-version',
      path: 'ValueSet.expansion',
      resourceType: 'ValueSet',
      customMessage:
        `Because the expansion uses system '${system}' without a version, ` +
        `it should list the system using the expansion parameter 'used-codesystem'`,
      severityOverride: 'warning',
    }));
  }

  return issues;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
