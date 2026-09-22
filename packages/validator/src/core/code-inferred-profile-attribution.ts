import type { ProfileApplicationSource, ValidationIssue } from '@records-fhir/validation-types';
import { matchCodeInferredProfile, type CodeInferredProfileMatch } from './code-inferred-profiles.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import { withIssueSchemaVersion, type EngineFhirVersion } from './issue-schema-version.js';
import type { AspectResult } from './multi-aspect-types.js';
import {
  computeIssueIdentity,
  isBestPracticeIssue,
  relabelProfileImposedIssue,
  withProfileProvenanceDetails,
} from './profile-attribution-relabel.js';

export const CODE_INFERRED_SIGNPOST_CODE = 'profile-code-inferred-signpost';

const CODE_SYSTEM_DISPLAY_NAMES: Record<string, string> = {
  'http://loinc.org': 'LOINC',
  'http://snomed.info/sct': 'SNOMED CT',
};

/**
 * Display names mirror the HL7 reference validator's signpost wording; the
 * fhir-test-cases java outcomes are the source of truth for the observed set
 * (vitalspanel and headcircum have no upstream fixture and follow the pattern).
 */
const INFERRED_PROFILE_DISPLAY_NAMES: Record<string, string> = {
  'http://hl7.org/fhir/StructureDefinition/vitalspanel': 'Vital Signs Panel',
  'http://hl7.org/fhir/StructureDefinition/resprate': 'Respiratory Rate',
  'http://hl7.org/fhir/StructureDefinition/heartrate': 'Heart rate',
  'http://hl7.org/fhir/StructureDefinition/oxygensat': 'Oxygen saturation',
  'http://hl7.org/fhir/StructureDefinition/bodytemp': 'Body temperature',
  'http://hl7.org/fhir/StructureDefinition/bodyheight': 'Body height',
  'http://hl7.org/fhir/StructureDefinition/headcircum': 'Head circumference',
  'http://hl7.org/fhir/StructureDefinition/bodyweight': 'Body weight',
  'http://hl7.org/fhir/StructureDefinition/bmi': 'Body mass index',
  'http://hl7.org/fhir/StructureDefinition/bp': 'Blood pressure systolic and diastolic',
};

/**
 * The applied profile counts as code-inferred only when nothing else selected
 * it: a declared meta.profile (or an explicit run profile, which callers must
 * exclude before the profile URL reaches this check) takes precedence.
 */
export function resolveCodeInferredProfileMatch(
  resource: unknown,
  appliedProfileUrl: string,
  profileSource?: ProfileApplicationSource,
): CodeInferredProfileMatch | null {
  if (profileSource !== undefined && profileSource !== 'code-inferred') return null;
  const match = matchCodeInferredProfile(resource);
  if (!match || match.profileUrl !== appliedProfileUrl.split('|')[0]) return null;
  if (profileSource === undefined && getPrimaryDeclaredProfile(resource)) return null;
  return { ...match, profileUrl: appliedProfileUrl };
}

export function createCodeInferredProfileSignpostIssue(
  match: CodeInferredProfileMatch,
): ValidationIssue {
  const profileName = INFERRED_PROFILE_DISPLAY_NAMES[match.profileUrl] ?? match.profileUrl;
  const systemName = CODE_SYSTEM_DISPLAY_NAMES[match.system] ?? match.system;
  const issue: ValidationIssue = {
    aspect: 'profile',
    severity: 'info',
    code: CODE_INFERRED_SIGNPOST_CODE,
    message: `Validate Observation against the ${profileName} profile (${match.profileUrl}) `
      + `which is required by the FHIR specification because the ${systemName} code ${match.code} was found`,
    path: 'Observation',
    profile: match.profileUrl,
    details: withProfileProvenanceDetails(undefined, codeInferredProvenance(match)),
    timestamp: new Date(),
  };
  return { ...issue, id: computeIssueIdentity(issue) };
}

/**
 * Re-home findings produced by validating against a code-inferred profile.
 * The base-SD substitution otherwise surfaces profile-imposed minimums as
 * "structural" claims that read as base-spec statements. Only the aspect
 * label and the attribution metadata change — never the finding or severity.
 */
export function applyCodeInferredProfileAttribution(
  issues: ValidationIssue[],
  match: CodeInferredProfileMatch,
): ValidationIssue[] {
  return issues.map(issue => attributeIssue(issue, match));
}

/**
 * Multi-aspect variant: relabels issues in place across the collected aspect
 * buckets and appends the signpost to the profile bucket. Result assembly
 * re-buckets by each issue's own aspect field, so no manual moves are needed.
 */
export function applyCodeInferredAttributionToAspectResults(
  collectedAspects: AspectResult[],
  match: CodeInferredProfileMatch,
  fhirVersion: EngineFhirVersion,
): void {
  const profileResult = collectedAspects.find(result => result.aspect === 'profile');
  if (!profileResult) return;
  for (const result of collectedAspects) {
    result.issues = applyCodeInferredProfileAttribution(result.issues, match);
    if (result.evidenceIssues) {
      result.evidenceIssues = applyCodeInferredProfileAttribution(result.evidenceIssues, match);
    }
  }
  const signpost = withIssueSchemaVersion(createCodeInferredProfileSignpostIssue(match), fhirVersion);
  profileResult.issues = [...profileResult.issues, signpost];
  if (profileResult.evidenceIssues) {
    profileResult.evidenceIssues = [...profileResult.evidenceIssues, signpost];
  }
}

function attributeIssue(issue: ValidationIssue, match: CodeInferredProfileMatch): ValidationIssue {
  if (issue.profile && issue.profile !== match.profileUrl) return issue;
  if (isBestPracticeIssue(issue)) return issue;
  return relabelProfileImposedIssue(issue, match.profileUrl, codeInferredProvenance(match));
}

function codeInferredProvenance(match: CodeInferredProfileMatch): Record<string, unknown> {
  return {
    profileSource: 'code-inferred',
    inferredProfileUrl: match.profileUrl,
    inferredFromSystem: match.system,
    inferredFromCode: match.code,
  };
}
