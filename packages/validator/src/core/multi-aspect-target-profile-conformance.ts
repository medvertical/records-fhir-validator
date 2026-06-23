import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';
import type { ReferenceResolver, ReferenceTargetValidator } from '../validators/reference-target-validator';
import { createValidationIssue } from '../issues';

/**
 * Opt-in target-profile-conformance pass (gap P-2): for each reference whose
 * element declares a *profiled* targetProfile (e.g. `us-core-patient`), resolve
 * the target (contained / bundle entry) and validate it against that profile.
 * Non-conformance is surfaced as a single `warning` per (reference, profile).
 *
 * Runs one level deep only — the recursive `validateProfile` call is made with
 * conformance checking suppressed, so a cycle (A→B→A) cannot loop. Fails open:
 * an unresolvable target, a profile that cannot be loaded, or an engine error
 * never produces a warning.
 */
export async function validateReferenceTargetProfileConformance(params: {
  resource: any;
  structureDef: StructureDefinition;
  referenceTargetValidator: ReferenceTargetValidator;
  resolveReference?: ReferenceResolver;
  /** Validate `target` against `profile`; returns the target's own issues. */
  validateProfile: (target: any, profile: string) => Promise<ValidationIssue[]>;
}): Promise<ValidationIssue[]> {
  const { resource, structureDef, referenceTargetValidator, resolveReference, validateProfile } = params;
  if (!resolveReference) return [];

  const hits = referenceTargetValidator.collectProfiledTargetHits(resource, structureDef);
  if (hits.length === 0) return [];

  const issues: ValidationIssue[] = [];
  const resourceType = resource?.resourceType || 'Unknown';

  for (const hit of hits) {
    const target = resolveReference(hit.reference);
    if (!target || typeof target.resourceType !== 'string') continue; // unresolvable — fail open

    const failures: Array<{ profile: string; errorCount: number }> = [];

    for (const profile of hit.profiles) {
      let targetIssues: ValidationIssue[];
      try {
        targetIssues = await validateProfile(target, profile);
      } catch {
        continue; // engine error — fail open
      }

      // A profile that could not be loaded is not "non-conformance".
      if (targetIssues.some(isProfileUnavailable)) continue;

      const errors = targetIssues.filter(i => i.severity === 'error' || i.severity === 'fatal');
      if (errors.length === 0) {
        failures.length = 0;
        break;
      }

      failures.push({ profile, errorCount: errors.length });
    }

    for (const failure of failures) {
      const { profile, errorCount } = failure;

      const targetLabel = target.id ? `${target.resourceType}/${target.id}` : target.resourceType;
      issues.push(createValidationIssue({
        code: 'reference-target-profile-noncompliant',
        path: hit.path,
        resourceType,
        severityOverride: 'warning',
        customMessage:
          `Reference target ${targetLabel} at ${hit.path} does not conform to the ` +
          `required profile ${profile} (${errorCount} error${errorCount === 1 ? '' : 's'}).`,
        details: {
          reference: hit.reference,
          requiredProfile: profile,
          targetResourceType: target.resourceType,
          errorCount,
        },
      }));
    }
  }

  return issues;
}

function isProfileUnavailable(issue: ValidationIssue): boolean {
  const code = issue.code ?? '';
  return code.includes('profile-not-found') || code === 'internal-error' || code.includes('unsupported');
}
