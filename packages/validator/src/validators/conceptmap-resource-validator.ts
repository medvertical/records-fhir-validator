import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  codeSystemDisplayFor,
  codeSystemHasCode,
  getCachedCodeSystem,
  isTxOnlySystem,
} from './terminology-resource-utils';

/**
 * Validate ConceptMap target displays against the target CodeSystem,
 * matching the diagnostics Java emits in `R5.cs-val-cm-base`.
 */
export function validateConceptMapResource(cm: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groups: any[] = Array.isArray(cm?.group) ? cm.group : [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
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

    const targetCs = getCachedCodeSystem(targetSystem);
    if (!targetCs) continue;

    const elements: any[] = Array.isArray(group?.element) ? group.element : [];
    for (let ei = 0; ei < elements.length; ei++) {
      const targets: any[] = Array.isArray(elements[ei]?.target) ? elements[ei].target : [];
      for (let ti = 0; ti < targets.length; ti++) {
        const target = targets[ti];
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
