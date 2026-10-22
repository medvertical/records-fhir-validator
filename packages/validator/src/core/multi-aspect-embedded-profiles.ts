import { BatchValidationAbortedError } from './batch-validator.js';
import { getDeclaredProfiles } from './declared-profile-utils.js';
import { patientNarrativeDedupeKey } from './patient-narrative-issue-reconciliation.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { AspectResult, MultiAspectValidateResult, ValidateOneFn } from './multi-aspect-types.js';

function issueIdentity(issue: ValidationIssue): string {
  return issue.code === 'dom-6'
    ? patientNarrativeDedupeKey(issue, issue.path ?? '')
    : [issue.code, issue.path, issue.message].join('\u0000');
}

const SEVERITY_RANK: Record<string, number> = { information: 0, info: 0, warning: 1, error: 2, fatal: 3 };

/**
 * Profile-independent findings (narrative, a wrong display) come back from
 * every profile pass, each at the severity its profile's binding gives it;
 * report each once, at the strictest severity. Distinct dom-6 constraint
 * identities remain separate across declared profiles.
 */
function mergeRepeats(existing: ValidationIssue[], incoming: ValidationIssue[]): void {
  const positions = new Map(existing.map((issue, index) => [issueIdentity(issue), index]));
  for (const issue of incoming) {
    const identity = issueIdentity(issue);
    const position = positions.get(identity);
    if (position === undefined) {
      positions.set(identity, existing.length);
      existing.push(issue);
    } else if ((SEVERITY_RANK[issue.severity] ?? 0) > (SEVERITY_RANK[existing[position].severity] ?? 0)) {
      existing[position] = issue;
    }
  }
}

/** Every declared profile constrains the same resource; descendants are counted only once. */
export async function validateDeclaredProfiles(
  validateOne: ValidateOneFn,
  shouldStop: (() => boolean) | undefined,
  ...args: Parameters<ValidateOneFn>
): Promise<MultiAspectValidateResult> {
  const primary = await validateOne(...args);
  // Different versions are separate claims; an unversioned URL may resolve
  // to another installed release and cannot be assumed to be an alias.
  const covered = new Set([args[1]]);
  const additional = getDeclaredProfiles(args[0]).filter(profile => {
    if (covered.has(profile)) return false;
    covered.add(profile);
    return true;
  });
  if (additional.length === 0) return primary;
  const aspects: AspectResult[] = primary.aspects.map(aspect => ({
    ...aspect, issues: [...aspect.issues], evidenceIssues: [...(aspect.evidenceIssues ?? aspect.issues)],
  }));
  let isValid = primary.isValid;
  for (const profile of additional) {
    if (shouldStop?.()) throw new BatchValidationAbortedError();
    const result = await validateOne(args[0], profile, args[2], args[3], args[4], args[5], args[6], true);
    isValid &&= result.isValid;
    for (const aspect of result.aspects) {
      const existing = aspects.find(candidate => candidate.aspect === aspect.aspect);
      if (existing) {
        mergeRepeats(existing.issues, aspect.issues);
        mergeRepeats(existing.evidenceIssues!, aspect.evidenceIssues ?? aspect.issues);
        existing.validationTime += aspect.validationTime;
        existing.isValid &&= aspect.isValid;
      } else {
        aspects.push({ ...aspect, issues: [...aspect.issues], evidenceIssues: [...(aspect.evidenceIssues ?? aspect.issues)] });
      }
    }
  }
  return { ...primary, isValid, aspects };
}
