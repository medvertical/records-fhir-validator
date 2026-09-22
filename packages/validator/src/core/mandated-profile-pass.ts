import type { ValidationIssue } from '@records-fhir/validation-types';
import { matchCodeInferredProfile } from './code-inferred-profiles.js';
import { dedupeExactIssues } from './validation-issue-dedupe.js';

/**
 * R4 mandates a core Observation profile whenever a vital-sign code is
 * present, and the reference validator applies it *beside* whatever the
 * resource declares rather than instead of it — its expected outcome for
 * `obs-vs-1` carries the `bp` error although the resource declares
 * `average-smbp`. Applying only the declared profile hid every mandated
 * constraint behind one `meta.profile` line: an Observation carrying LOINC
 * 8480-6 and declaring `vitalsigns` never had `bp`'s required components
 * checked and reported nothing at all.
 *
 * The extra pass cannot recurse. Its own applied profile is the mandated one,
 * so the lookup below returns null the second time round.
 */
export function mandatedProfileBeside(
  resource: unknown,
  appliedProfileUrl: string | undefined,
): string | null {
  const mandated = matchCodeInferredProfile(resource);
  if (!mandated) return null;
  if (!appliedProfileUrl) return null;
  return canonicalWithoutVersion(appliedProfileUrl) === canonicalWithoutVersion(mandated.profileUrl)
    ? null
    : mandated.profileUrl;
}

/**
 * What the mandated pass contributes: the conformance failures against the
 * mandated profile that the applied profile did not already report.
 *
 * Only structure and profile conformance that originally failed. Both
 * passes walk the whole resource, so the second one also re-reports every
 * code, reference and metadata observation — under a different profile, whose
 * bindings carry different strengths, so the repeat arrives at a different
 * severity and the two then compete in the resource-tree deduplication. What
 * the mandated profile adds over the declared one is its structure.
 */
export function mandatedProfileAdditions(
  alreadyReported: readonly ValidationIssue[],
  mandatedIssues: readonly ValidationIssue[],
  mandatedProfileUrl: string,
): ValidationIssue[] {
  const reported = new Set(alreadyReported);
  const byDisposition = new Map<string, ValidationIssue[]>();
  for (const issue of [...alreadyReported, ...mandatedIssues.filter(isProfileConformanceFailure)]) {
    const disposition = issue.disposition ?? 'active';
    const group = byDisposition.get(disposition) ?? [];
    group.push(issue);
    byDisposition.set(disposition, group);
  }
  return [...byDisposition.values()].flatMap(dedupeExactIssues)
    .filter(issue => !reported.has(issue))
    .map(issue => issue.profile ? issue : { ...issue, profile: mandatedProfileUrl });
}

function isProfileConformanceFailure(issue: ValidationIssue): boolean {
  // Strictness and advisor policy have already run in a multi-aspect session.
  const severity = issue.rawSeverity ?? issue.severity;
  if (severity !== 'error' && severity !== 'fatal') return false;
  return issue.aspect === 'structural' || issue.aspect === 'profile';
}

function canonicalWithoutVersion(url: string): string {
  return url.split('|')[0];
}
