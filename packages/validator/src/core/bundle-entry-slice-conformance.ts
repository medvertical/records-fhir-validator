import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  childMatchesBundleEntrySliceCandidate,
  getBundleEntrySliceDefinitions,
} from './bundle-entry-slice-definitions.js';
import type { BundleDocumentContextChildResult } from './bundle-document-context-types.js';
import type { StructureDefinition } from './structure-definition-types.js';

export function buildBundleEntrySliceConformanceIssues(
  bundle: Record<string, unknown>,
  childResults: BundleDocumentContextChildResult[],
  bundleStructureDef: StructureDefinition | undefined,
): ValidationIssue[] {
  const slices = getBundleEntrySliceDefinitions(bundleStructureDef)
    .filter(slice => slice.min > 0);
  if (slices.length === 0) return [];

  const issues: ValidationIssue[] = [];
  const bundleProfile = getDeclaredProfiles(bundle)[0];
  const unresolvedRequiredProfiles = collectUnresolvedRequiredProfiles(slices, childResults);

  for (const { child, profile, sliceName } of unresolvedRequiredProfiles.values()) {
    issues.push(createValidationIssue({
      code: 'profile-not-found',
      path: bundleEntryResourcePrefix(child.index, child.entryResource, child.resourceType),
      resourceType: 'Bundle',
      profile: bundleProfile,
      customMessage:
        `Required profile ${profile} could not be resolved for Bundle.entry:${sliceName}; ` +
        'entry conformance cannot be established.',
      ruleId: 'bundle-entry-required-profile-not-resolved',
      severityOverride: 'error',
      aspectOverride: 'profile',
      details: {
        sliceName,
        requiredProfile: profile,
        candidateEntryIndex: child.index,
        candidateResourceType: child.resourceType,
      },
    }));
  }

  for (const slice of slices) {
    const candidates = childResults.filter(child => childMatchesBundleEntrySliceCandidate(child, slice));
    if (candidates.length === 0) continue;

    const blockedCandidates = candidates
      .map(child => ({ child, blockingIssues: getTargetProfileBlockingIssues(child.issues) }))
      .filter(candidate => candidate.blockingIssues.length > 0);
    if (candidates.length - blockedCandidates.length >= slice.min) continue;

    for (const { child, blockingIssues } of blockedCandidates) {
      issues.push(createValidationIssue({
        code: 'profile-constraint-violation',
        path: bundleEntryResourcePrefix(child.index, child.entryResource, child.resourceType),
        resourceType: 'Bundle',
        profile: bundleProfile,
        customMessage: `Bundle.entry:${slice.sliceName} candidate ${child.resourceType}/${String(child.entryResource.id ?? '?')} failed conformance to ${slice.profiles.join(', ') || slice.resourceTypes.join(', ')}`,
        ruleId: 'bundle-entry-slice-profile-match-failed',
        severityOverride: 'error',
        aspectOverride: 'profile',
        details: {
          sliceName: slice.sliceName,
          targetProfiles: slice.profiles,
          targetResourceTypes: slice.resourceTypes,
          candidateEntryIndex: child.index,
          candidateResourceType: child.resourceType,
          candidateResourceId: child.entryResource.id,
          causeIssueCodes: [...new Set(blockingIssues.map(issue => issue.code))],
        },
      }));
    }
  }

  return issues;
}

function collectUnresolvedRequiredProfiles(
  slices: ReturnType<typeof getBundleEntrySliceDefinitions>,
  childResults: BundleDocumentContextChildResult[],
): Map<string, { child: BundleDocumentContextChildResult; profile: string; sliceName: string }> {
  const unresolved = new Map<string, {
    child: BundleDocumentContextChildResult;
    profile: string;
    sliceName: string;
  }>();
  for (const slice of slices) {
    for (const child of childResults.filter(candidate => childMatchesBundleEntrySliceCandidate(candidate, slice))) {
      for (const profile of slice.profiles) {
        if (!child.issues.some(issue => isUnresolvedProfileIssue(issue, profile))) continue;
        unresolved.set(`${child.index}|${canonicalBase(profile)}`, {
          child,
          profile,
          sliceName: slice.sliceName,
        });
      }
    }
  }
  return unresolved;
}

function isUnresolvedProfileIssue(issue: ValidationIssue, profile: string): boolean {
  if (issue.code !== 'profile-not-resolved' && issue.code !== 'profile-not-found') return false;
  const issueProfile = typeof issue.profile === 'string'
    ? issue.profile
    : isRecord(issue.details) && typeof issue.details.profile === 'string'
      ? issue.details.profile
      : undefined;
  return issueProfile !== undefined && canonicalBase(issueProfile) === canonicalBase(profile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalBase(canonical: string): string {
  return canonical.split('|')[0];
}

function getDeclaredProfiles(resource: Record<string, unknown>): string[] {
  const profiles = isRecord(resource.meta) ? resource.meta.profile : undefined;
  return Array.isArray(profiles)
    ? profiles.filter((profile: unknown): profile is string => typeof profile === 'string')
    : [];
}

function getTargetProfileBlockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(issue => {
    if (issue.severity !== 'error' && issue.severity !== 'fatal') return false;
    if (issue.ruleId === 'profile-targetprofile-match-failed') return false;
    if (issue.aspect === 'structural' || issue.aspect === 'profile' || issue.aspect === 'invariant') {
      return true;
    }
    return issue.aspect === 'terminology' &&
      (issue.code === 'terminology-binding-required' || issue.code === 'terminology-binding-required-code');
  });
}

export function bundleEntryResourcePrefix(
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): string {
  const rtId = typeof entryResource.id === 'string'
    ? `${resourceType}/${entryResource.id}`
    : resourceType;
  return `Bundle.entry[${entryIndex}].resource/*${rtId}*/`;
}
