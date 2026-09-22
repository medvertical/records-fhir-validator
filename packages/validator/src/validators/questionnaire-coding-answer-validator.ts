import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { QuestionnaireItem, QuestionnaireResponseAnswer } from './questionnaire-types.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';

export function validateQuestionnaireCodingAnswer(
  answer: QuestionnaireResponseAnswer,
  question: QuestionnaireItem,
  answerPath: string,
  cache: ValueSetCache,
  hasOptions: boolean,
): ValidationIssue[] {
  if (!answer.valueCoding) return [];
  const issues = validateCodingDisplayMatch(answer, question, answerPath, cache);
  if (!hasOptions && question.answerValueSet) {
    issues.push(...validateCodingInAnswerValueSet(answer, question, answerPath, cache));
  }
  return issues;
}

function validateCodingDisplayMatch(
  answer: QuestionnaireResponseAnswer,
  question: QuestionnaireItem,
  answerPath: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const coding = answer.valueCoding;
  if (!coding?.code || !coding.display) return [];

  const expectedDisplay = resolveExpectedCodingDisplay(coding, question, cache);
  if (expectedDisplay === null || expectedDisplay === coding.display) return [];

  const systemRef = coding.system ? `${coding.system}#${coding.code}` : coding.code;
  return [createValidationIssue({
    code: 'qr-display-mismatch',
    path: `${answerPath}.value.ofType(Coding).display`,
    resourceType: 'QuestionnaireResponse',
    customMessage:
      `Wrong Display Name '${coding.display}' for ${systemRef}. ` +
      `Valid display is '${expectedDisplay}'`,
    severityOverride: 'error',
  })];
}

function validateCodingInAnswerValueSet(
  answer: QuestionnaireResponseAnswer,
  question: QuestionnaireItem,
  answerPath: string,
  cache: ValueSetCache,
): ValidationIssue[] {
  const coding = answer.valueCoding;
  if (!coding?.code || !question.answerValueSet) return [];

  const valueSetUrl = question.answerValueSet;
  const expanded = cache.getExpandedCodes(valueSetUrl)
    ?? cache.getExpandedCodes(valueSetUrl.split('|')[0]);
  const fullCode = coding.system ? `${coding.system}|${coding.code}` : coding.code;
  const notInSet = Boolean(
    expanded?.size
    && !expanded.has(fullCode)
    && !expanded.has(coding.code),
  );

  let wrongDisplay = false;
  if (!notInSet && typeof coding.display === 'string') {
    const expected = resolveExpectedCodingDisplay(coding, question, cache);
    wrongDisplay = expected !== null && expected !== coding.display;
  }
  if (!notInSet && !wrongDisplay) return [];

  const valueSetName = valueSetUrl.split('/').pop()?.replace(/[-_]/g, ' ') ?? valueSetUrl;
  return [createValidationIssue({
    code: 'qr-code-not-in-valueset',
    path: answerPath,
    resourceType: 'QuestionnaireResponse',
    customMessage:
      `The code '${coding.code}' in the system '${coding.system ?? ''}' is not in ` +
      `the options value set (${valueSetName}) specified by the questionnaire`,
    severityOverride: 'error',
  })];
}

function resolveExpectedCodingDisplay(
  coding: { system?: string; code: string; display?: string },
  question: QuestionnaireItem,
  cache: ValueSetCache,
): string | null {
  for (const option of question.answerOption ?? []) {
    const candidate = option.valueCoding;
    if (!candidate) continue;
    const systemsMatch = candidate.system === coding.system || candidate.system === undefined;
    if (systemsMatch && candidate.code === coding.code && typeof candidate.display === 'string') {
      return candidate.display;
    }
  }

  if (!coding.system) return null;
  const codeSystem = resolveCachedCodeSystem(coding.system, cache);
  return codeSystem ? findCodeSystemConceptDisplay(codeSystem.concept, coding.code) : null;
}

function resolveCachedCodeSystem(systemUrl: string, cache: ValueSetCache): CodeSystem | null {
  const direct = cache.getCodeSystem(systemUrl) ?? cache.getCodeSystemFile(systemUrl);
  if (direct) return direct;
  for (const major of ['4', '5', '6']) {
    const suffixed = `${systemUrl}|fhir${major}`;
    const hit = cache.getCodeSystem(suffixed) ?? cache.getCodeSystemFile(suffixed);
    if (hit) return hit;
  }
  return null;
}

function findCodeSystemConceptDisplay(
  concepts: CodeSystemConcept[] | undefined,
  code: string,
): string | null {
  const pending = concepts ? [...concepts].reverse() : [];
  while (pending.length > 0) {
    const concept = pending.pop()!;
    if (concept.code === code) return concept.display ?? null;
    if (concept.concept) pending.push(...[...concept.concept].reverse());
  }
  return null;
}
