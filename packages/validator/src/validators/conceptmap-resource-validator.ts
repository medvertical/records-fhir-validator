import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
  codeSystemDisplayFor,
  codeSystemHasCode,
  getCachedCodeSystem,
  isTxOnlySystem,
  stripVersion,
} from './terminology-resource-utils.js';
import { ValueSetCache } from './valueset-cache.js';

/**
 * Validate ConceptMap target displays against the target CodeSystem,
 * matching the diagnostics Java emits in `R5.cs-val-cm-base`.
 */
export function validateConceptMapResource(
  cm: unknown,
  cache: ValueSetCache = new ValueSetCache(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const conceptMap = asRecord(cm);
  const groups = Array.isArray(conceptMap?.group) ? conceptMap.group : [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = asRecord(groups[gi]);
    const sourceSystem = typeof group?.source === 'string' ? group.source : undefined;
    const targetSystem = typeof group?.target === 'string' ? group.target : undefined;

    if (sourceSystem && isTxOnlySystem(sourceSystem)) {
      issues.push(createValidationIssue({
        code: 'tx-conceptmap-source-tx-only',
        path: `ConceptMap.group[${gi}].source`,
        resourceType: 'ConceptMap',
        customMessage:
          `Source Code System ${sourceSystem} is only supported on the terminology server, ` +
          `so the source codes are not validated for performance reasons`,
        severityOverride: 'information',
      }));
    }

    const targetCs = getCachedCodeSystem(targetSystem, cache)
      ?? getCachedCodeSystem(targetSystem && stripVersion(targetSystem), cache);
    if (!targetCs) continue;

    const elements = Array.isArray(group?.element) ? group.element : [];
    for (let ei = 0; ei < elements.length; ei++) {
      const element = asRecord(elements[ei]);
      const targets = Array.isArray(element?.target) ? element.target : [];
      for (let ti = 0; ti < targets.length; ti++) {
        const target = asRecord(targets[ti]);
        if (typeof target?.code !== 'string' || typeof target.display !== 'string') continue;
        if (!codeSystemHasCode(targetCs, target.code)) continue;
        const expected = codeSystemDisplayFor(targetCs, target.code);
        if (!expected) continue;
        if (expected.toLowerCase() === target.display.toLowerCase()) continue;
        issues.push(createValidationIssue({
          code: 'tx-conceptmap-target-display-invalid',
          path: `ConceptMap.group[${gi}].element[${ei}].target[${ti}].code`,
          resourceType: 'ConceptMap',
          customMessage:
            `The target display '${target.display}' for the code '${targetSystem}#${target.code}' ` +
            `is not valid. Possible displays: '${expected}'`,
          severityOverride: 'warning',
        }));
      }
    }
  }

  return issues;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
