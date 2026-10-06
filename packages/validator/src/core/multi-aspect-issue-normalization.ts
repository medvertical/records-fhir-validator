import { carryPatientNarrativeOrigins, reconcilePatientNarrativeIssues } from './patient-narrative-issue-reconciliation.js';
import type { StructureDefinition } from './structure-definition-types.js';
import type { AspectResult } from './multi-aspect-types.js';
import {
  aggregateRemoteCodeSystemBudgetIssues,
  dedupeIssues,
  suppressRedundantBindingWarnings,
} from './validation-utils.js';

export function normalizeIssuesByAspect(
  aspects: AspectResult[], definition?: StructureDefinition, fhirVersion?: 'R4' | 'R5' | 'R6',
): AspectResult[] {
  const combined = carryPatientNarrativeOrigins(aspects.map(aspect => aspect.issues), aspects.flatMap(aspect => aspect.issues));
  const suppressedIssues = suppressRedundantBindingWarnings(
    dedupeIssues(reconcilePatientNarrativeIssues(combined, definition, fhirVersion)),
  );
  const keepIssues = new Set(suppressedIssues);

  const normalizedByAspect = new Map<string, AspectResult>();
  const ensureAspect = (aspect: AspectResult): AspectResult => {
    const existing = normalizedByAspect.get(aspect.aspect);
    if (existing) return existing;
    const next = { ...aspect, issues: [], evidenceIssues: [], isValid: true };
    normalizedByAspect.set(aspect.aspect, next);
    return next;
  };

  for (const aspect of aspects) {
    ensureAspect(aspect);
  }

  for (const aspect of aspects) {
    for (const issue of aspect.evidenceIssues ?? aspect.issues) {
      const name = issue.aspect || aspect.aspect;
      const target = ensureAspect({ ...aspect, aspect: name });
      target.evidenceIssues?.push(issue);
    }
  }

  for (const aspect of aspects) {
    for (const issue of aspect.issues) {
      if (!keepIssues.has(issue)) continue;
      const targetAspectName = typeof issue.aspect === 'string' && issue.aspect.length > 0
        ? issue.aspect
        : aspect.aspect;
      const targetAspect = normalizedByAspect.get(targetAspectName)
        ?? ensureAspect({
          aspect: targetAspectName,
          issues: [],
          validationTime: 0,
          isValid: true,
        });
      targetAspect.issues.push(issue);
    }
  }

  return Array.from(normalizedByAspect.values()).map(aspect => {
    const issues = aggregateRemoteCodeSystemBudgetIssues(aspect.issues);
    return {
      ...aspect,
      issues,
      isValid: issues.every(issue => issue.severity !== 'error' && issue.severity !== 'fatal'),
    };
  });
}
