import { assessImportedTerminologyDisplay } from './imported-terminology-display.js';
import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';
import { parseLanguageTag } from './language-code-validator.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../terminology/terminology-issue.js';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';
import { displaysEquivalentForCodeInfo, type CodeInfo } from './valueset-display-utils.js';

export interface LocalDisplayAssessment {
  outcome: 'accepted' | 'mismatch' | 'unverified';
  displays: string[];
  defaultMatch?: boolean;
  inactiveMatch?: boolean;
}

function isLanguage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const canonical = value.split('-').map((part, index) => index === 0 ? part.toLowerCase()
    : /^[a-z]{2}$/i.test(part) ? part.toUpperCase()
    : /^[a-z]{4}$/i.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase()).join('-');
  return parseLanguageTag(canonical) === null;
}

function languageMatches(requested: string, available: unknown): boolean {
  if (!isLanguage(available) || !isLanguage(requested)) return false;
  const source = available.toLowerCase();
  const target = requested.toLowerCase();
  return target === source || target.startsWith(`${source}-`);
}

export function assessLocalDisplay(
  codeSystem: CodeSystem,
  concept: CodeSystemConcept,
  display: string,
  displayLanguage?: string,
): LocalDisplayAssessment {
  if (hasUnknownTerminologyModifiers(codeSystem) || hasUnknownTerminologyModifiers(concept))
    return { outcome: 'unverified', displays: [] };
  const imported = assessImportedTerminologyDisplay(codeSystem, concept, display, displayLanguage);
  if (imported) return imported;
  const designations = concept.designation ?? [];
  const labels = [
    { value: concept.display, language: codeSystem.language },
    ...designations.filter(label => !hasUnknownTerminologyModifiers(label)).map(label => ({ value: label.value, language: label.language ?? codeSystem.language })),
  ].filter((label): label is { value: string; language: string | undefined } =>
    typeof label.value === 'string' && Boolean(label.value.trim()));
  const assessment = assessTerminologyLabels({ code: concept.code, system: codeSystem.url }, labels, display,
    displayLanguage, concept.display);
  return assessment.outcome !== 'accepted' && designations.some(hasUnknownTerminologyModifiers)
    ? { ...assessment, outcome: 'unverified' } : assessment;
}

export function assessTerminologyLabels(
  coding: Pick<CodeInfo, 'code' | 'system'>,
  labels: ReadonlyArray<{ value: string; language?: string }>,
  display: string,
  displayLanguage?: string,
  defaultDisplay?: string,
): LocalDisplayAssessment {
  const matches = (expected: string) => displaysEquivalentForCodeInfo(expected, display, coding);
  const legacy = displayLanguage === undefined || displayLanguage === '';
  const selected = labels.filter(label => legacy || languageMatches(displayLanguage, label.language));
  const displays = [...new Set(selected.map(label => label.value))];
  if (displays.some(matches)) return { outcome: 'accepted', displays };
  // A known label with no declared language cannot prove a language mismatch.
  const unknownMatch = labels.some(label => !isLanguage(label.language) && matches(label.value));
  if (unknownMatch || displays.length === 0) return {
    outcome: 'unverified', displays,
    defaultMatch: Boolean(defaultDisplay && matches(defaultDisplay)),
  };
  return { outcome: 'mismatch', displays };
}

export function displayUnverifiedMessage(coding: CodeInfo, language?: string): string {
  return `Display '${coding.display}' for ${coding.system}#${coding.code}`
    + (coding.version ? ` version '${coding.version}'` : '')
    + (language ? ` in language '${language}'` : '')
    + ' could not be verified against the selected local CodeSystem labels; code membership is a separate check.';
}

export function displayUnverifiedIssue(
  coding: CodeInfo,
  path: string,
  message: string,
  severity: 'information' | 'warning',
  displayLanguage?: string,
  profile?: string,
  additionalDetails?: Record<string, unknown>,
): ValidationIssue {
  return createTerminologyIssue({ code: 'terminology-display-unverified', path, message, severity, profile,
    details: { code: coding.code, system: coding.system, display: coding.display,
      ...(coding.version ? { codeSystemVersion: coding.version } : {}),
      ...(displayLanguage ? { displayLanguage } : {}),
      ...additionalDetails, reason: 'local-display-unverified', validationComplete: false, validationStatus: 'incomplete' } });
}
