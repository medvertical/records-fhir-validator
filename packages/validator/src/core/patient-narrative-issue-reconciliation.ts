import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from './structure-definition-types.js';

const EXPRESSION = 'text.`div`.exists()';
const MESSAGE = 'A resource should have narrative for robust management';
const DOMAIN = 'http://hl7.org/fhir/StructureDefinition/DomainResource';
interface NarrativeOrigins { generated: Set<string>; canonical: Set<string> }
// Array-scoped ownership survives policy copies without changing public issues.
const origins = new WeakMap<ValidationIssue[], NarrativeOrigins>();

export function recordPatientNarrativeOrigins(
  issues: ValidationIssue[],
  selected: { generated?: ValidationIssue[]; canonical?: ValidationIssue[] },
): ValidationIssue[] {
  const known = origins.get(issues) ?? { generated: new Set<string>(), canonical: new Set<string>() };
  for (const kind of ['generated', 'canonical'] as const) {
    for (const issue of selected[kind] ?? []) {
      if (issue.code === 'dom-6' && typeof issue.id === 'string') known[kind].add(issue.id);
    }
  }
  origins.set(issues, known);
  return issues;
}

export function carryPatientNarrativeOrigins(
  sources: ValidationIssue[][],
  target: ValidationIssue[],
): ValidationIssue[] {
  const retainedIds = new Set(target.map(issue => issue.id));
  const known: NarrativeOrigins = { generated: new Set(), canonical: new Set() };
  for (const source of sources) {
    const previous = origins.get(source);
    if (!previous) continue;
    for (const kind of ['generated', 'canonical'] as const) {
      for (const id of previous[kind]) if (retainedIds.has(id)) known[kind].add(id);
    }
  }
  origins.set(target, known);
  return target;
}

export function reconcilePatientNarrativeIssues(
  issues: ValidationIssue[],
  definition: StructureDefinition | undefined,
  release?: 'R4' | 'R5' | 'R6',
): ValidationIssue[] {
  const known = origins.get(issues);
  if (!known || !isCanonicalRootNarrative(definition, release)) return issues;
  const canonical = issues.filter(issue => known.canonical.has(issue.id ?? '')
    && isCanonicalFailure(issue));
  const reconciled = issues.filter(issue => !known.generated.has(issue.id ?? '')
    || !isGeneratedAdvice(issue)
    || !canonical.some(failure => sameOccurrenceAfterPolicy(failure, issue)));
  return carryPatientNarrativeOrigins([issues], reconciled);
}

/** Missing XHTML can replace only an advisory row recorded by its generator. */
export function redundantGeneratedPatientNarrativeAdvice(
  issues: ValidationIssue[],
): Set<ValidationIssue> {
  const redundant = new Set<ValidationIssue>();
  const known = origins.get(issues);
  if (!known) return redundant;
  const missingDiv = issues.filter(issue => issue.code === 'narrative-missing-div'
    && issue.aspect === 'structural' && issue.resourceType === 'Patient'
    && hasLiteralPatientNarrativePath(issue));
  for (const issue of issues) {
    const severity = advisorySeverity(issue.severity);
    const details = issueDetails(issue);
    if (!known.generated.has(issue.id ?? '') || known.canonical.has(issue.id ?? '')
      || !isGeneratedAdvice(issue) || !hasLiteralPatientNarrativePath(issue)
      || (severity !== 'information' && severity !== 'warning')
      || ['error', 'fatal'].includes(issue.rawSeverity ?? '')
      || ['error', 'fatal'].includes(String(details?.originalSeverity ?? ''))
      || issue.message !== MESSAGE || typeof issue.profile !== 'string' || !issue.profile
      || !missingDiv.some(missing => missing.profile === issue.profile)) continue;
    redundant.add(issue);
  }
  return redundant;
}

function hasLiteralPatientNarrativePath(issue: ValidationIssue): boolean {
  const details = issueDetails(issue);
  return issue.path === 'Patient.text'
    && ['fieldPath', 'element'].every(key => details?.[key] === undefined
      || details[key] === issue.path);
}

/** dom-6's historical code/path key erased custom expressions and profiles. */
export function patientNarrativeDedupeKey(issue: ValidationIssue, path: string): string {
  return JSON.stringify([
    issue.code, path, advisorySeverity(issue.severity), issue.resourceType, issue.profile,
    issue.aspect, issue.ruleId, issue.details, issue.message,
  ]);
}

function isCanonicalRootNarrative(
  definition: StructureDefinition | undefined,
  release: 'R4' | 'R5' | 'R6' | undefined,
): boolean {
  if (!definition || !['Patient', 'DomainResource'].includes(definition.type)) return false;
  const version = definition.fhirVersion;
  if (typeof version !== 'string' || !/^[45]\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return false;
  if ((release !== 'R4' && release !== 'R5')
    || (release === 'R4' && !version.startsWith('4.'))
    || (release === 'R5' && !version.startsWith('5.'))) return false;
  const roots = definition.snapshot?.element.filter(element => element.path === definition.type) ?? [];
  if (roots.length !== 1) return false;
  const constraints = roots[0].constraint?.filter(constraint => constraint.key === 'dom-6') ?? [];
  if (constraints.length !== 1) return false;
  const constraint = constraints[0];
  return constraint.expression === EXPRESSION && constraint.human === MESSAGE
    && constraint.severity === 'warning'
    && (constraint.source === DOMAIN
      || (constraint.source === undefined && definition.url === DOMAIN));
}

function isCanonicalFailure(issue: ValidationIssue): boolean {
  const details = issueDetails(issue);
  return issue.code === 'dom-6' && issue.ruleId === 'dom-6'
    && issue.resourceType === 'Patient' && issue.path === 'Patient.text'
    && details?.constraintKey === 'dom-6' && details.expression === EXPRESSION
    && details.originalSeverity === 'warning' && details.escalated !== true
    && ['source', 'sourceProfile', 'constraintSource', 'definedIn', 'sourceCanonical']
      .every(key => details[key] === undefined || details[key] === DOMAIN);
}

function isGeneratedAdvice(issue: ValidationIssue): boolean {
  const details = issueDetails(issue);
  return issue.code === 'dom-6' && issue.resourceType === 'Patient'
    && issue.path === 'Patient.text' && issue.ruleId === undefined
    && details?.bestPractice === true && details.constraintKey === undefined
    && details.expression === undefined
    && issue.tags?.includes('best-practice') === true && issue.tags.includes('narrative');
}

function sameOccurrenceAfterPolicy(canonical: ValidationIssue, generated: ValidationIssue): boolean {
  const severity = advisorySeverity(canonical.severity);
  return (severity === 'information' || severity === 'warning')
    && severity === advisorySeverity(generated.severity)
    && typeof canonical.profile === 'string' && canonical.profile.length > 0
    && canonical.profile === generated.profile && canonical.message === generated.message
    && canonical.path === generated.path && canonical.resourceType === generated.resourceType;
}

function advisorySeverity(severity: ValidationIssue['severity']): ValidationIssue['severity'] {
  return severity === 'info' ? 'information' : severity;
}

function issueDetails(issue: ValidationIssue): Record<string, unknown> | undefined {
  return issue.details !== null && typeof issue.details === 'object' && !Array.isArray(issue.details)
    ? issue.details as Record<string, unknown>
    : undefined;
}
