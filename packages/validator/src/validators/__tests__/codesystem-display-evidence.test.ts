import { describe, expect, it, vi } from 'vitest';
import { validateCodeInCodeSystemWithFallbacks } from '../valueset-code-system-validator.js';
import { operationOutcomeToCodeSystemResult, parseCodeSystemValidationParameters } from '../terminology-code-system-result.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import type { CodeSystemValidationResult } from '../terminology-api-types.js';

const system = 'http://loinc.org';
const code = '11369-6';
const choices = "Valid display is one of 3 choices: 'History of Immunization note' (en-US), "
  + "'History of Immunization note' (en-US) or 'Hx of Immunization note' (en-US) (for the language(s) 'en-NZ')";
function response(valid: boolean, message?: string, extras: {
  inactive?: boolean;
  display?: string;
  issues?: { severity: string; code: string; message: string }[];
} = {}, target = { code, system }): CodeSystemValidationResult {
  return parseCodeSystemValidationParameters({ resourceType: 'Parameters', parameter: [
    { name: 'result', valueBoolean: valid },
    ...(message ? [{ name: 'message', valueString: message }] : []),
    ...(extras.display ? [{ name: 'display', valueString: extras.display }] : []),
    ...(extras.inactive !== undefined ? [{ name: 'inactive', valueBoolean: extras.inactive }] : []),
    { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: (extras.issues ?? (message ? [{
      severity: 'error', code: 'invalid-display', message,
    }] : [])).map(issue => ({ severity: issue.severity, code: 'invalid', details: {
      coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: issue.code }], text: issue.message,
    } })) } },
  ] }, target.code, target.system);
}
function validate(primary: CodeSystemValidationResult, display: string, fallbacks: CodeSystemValidationResult[] = [], actualSystem = system, actualCode = code) {
  const call = vi.fn().mockResolvedValueOnce(primary);
  for (const result of fallbacks) call.mockResolvedValueOnce(result);
  return { call, result: validateCodeInCodeSystemWithFallbacks({
    apiClient: { validateCodeInCodeSystem: call } as never, code: actualCode, system: actualSystem, display,
    fhirVersion: 'R4', codeSystemVersion: '2.82', displayLanguage: 'en-NZ', resolutionConfig: {
      strategy: 'server-first', serverUrl: 'https://primary.example/fhir', servers: [
        { id: 'primary', url: 'https://primary.example/fhir', enabled: true, fhirVersions: ['R4'] },
        ...fallbacks.map((_, index) => ({ id: `fallback-${index}`, url: `https://fallback-${index}.example/fhir`,
          enabled: true, fhirVersions: ['R4' as const] })),
      ],
    },
  }) };
}
function published(result: CodeSystemValidationResult, display: string, actualSystem = system, actualCode = code) {
  return buildCodeSystemResultIssues({ code: actualCode, system: actualSystem, display, version: '2.82' },
    result, 'Observation.code.coding', 0, true);
}

const rejectedProse = [
  ["Valid display is 'Deutsch' (de-DE) (for the language(s) 'en-NZ')", 'en-NZ'],
  [choices, 'History of Immunization note describing unrelated findings'],
  [choices, "History of Immunization note' (en-US), 'History of Immunization note"],
  ["Valid display is one of 2 choices: 'Alpha' (en-US)", 'Alpha'],
  ["Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta", 'Alpha'],
  ["Valid display is one of 2 choices: 'Alpha' (en-US); 'Beta' (en-US)", 'Beta'],
  ["Valid display is 'Alpha' (en-US) unexpected", 'Alpha'],
  ["Valid display is 'Patient's history, narrative (reported)' (en-US)", 's history, narrative (reported)'],
  ["Valid display is 'Same spelling' (de-DE) (for the language(s) 'en-NZ')", 'Same spelling'],
  [choices, 'Hx of Immunization note'],
] as const;

describe('remote CodeSystem display evidence survives reconciliation', () => {
  it.each(rejectedProse)('retains typed rejection for %s and %s', async (message, display) => {
    const primary = response(false, message);
    const original = structuredClone(primary);
    const { call, result } = validate(primary, display);
    const actual = await result;
    expect(actual).toBe(primary);
    expect(actual).toEqual(original);
    expect(isVerifiedCodeSystemResult(actual)).toBe(true);
    expect(published(actual, display)).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch', severity: 'error', path: 'Observation.code.coding[0].display',
    }));
    expect(call).toHaveBeenCalledExactlyOnceWith(code, system, display, undefined, '2.82', 'en-NZ');
  });
  it.each(['error', 'warning', 'fatal'])('keeps typed %s OperationOutcome display N without inventing membership completion', async severity => {
    const message = "Valid display is 'Current label' (en-US) (for the language(s) 'en-NZ')";
    const primary = operationOutcomeToCodeSystemResult({ resourceType: 'OperationOutcome', issue: [{
      severity, code: 'invalid', details: { text: message, coding: [
        { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' },
      ] },
    }] }, code, system);
    const original = structuredClone(primary);
    expect(await validate(primary, 'Current label').result).toBe(primary);
    expect(published(primary, 'Current label')).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch', severity: severity === 'fatal' ? 'error' : severity,
    }));
    expect(isVerifiedCodeSystemResult(primary)).toBe(false);
    expect(primary).toEqual(original);
  });
  it.each(['error', 'warning', 'fatal'])('preserves Outcome %s display authority through a status-only copy', async severity => {
    const message = "Wrong Display Name 'Inactive finding'. Valid display is 'Inactive finding'";
    const primary = operationOutcomeToCodeSystemResult({ resourceType: 'OperationOutcome', issue: [
      { severity, code: 'invalid', details: { text: message, coding: [
        { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' },
      ] } },
      { severity: 'warning', code: 'business-rule', details: { text: 'Concept is inactive', coding: [
        { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'code-comment' },
      ] } },
    ] }, code, system);
    const mismatch = response(false, "Valid display is 'Other label'");
    const active = response(true);
    const { call, result } = validate(primary, 'Inactive finding', [mismatch]);
    call.mockImplementation(async (_code, _system, display) => display === undefined ? active : mismatch);
    const actual = await result;
    expect(actual).toMatchObject({ valid: false, reason: 'display-mismatch', inactive: false, message: primary.message });
    expect(isVerifiedCodeSystemResult(actual)).toBe(false);
    expect(published(actual, 'Inactive finding')).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch', severity: severity === 'fatal' ? 'error' : severity }));
    expect(published(actual, 'Inactive finding').some(issue => issue.code === 'terminology-code-inactive')).toBe(false);
  });
  it.each([null, {}, { resourceType: 'OperationOutcome', issue: [] },
    { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', details: { text: 'Unable to resolve CodeSystem' } }] },
  ])('does not invent display or membership authority from incomplete Outcome %j', async outcome => {
    const primary = operationOutcomeToCodeSystemResult(outcome, code, system);
    expect(await validate(primary, 'Current label').result).toBe(primary);
    expect(isVerifiedCodeSystemResult(primary)).toBe(false);
    expect(published(primary, 'Current label').some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
  });
  it.each(['parameters-warning-first', 'parameters-error-first', 'outcome-warning-first', 'outcome-error-first'])(
    'keeps dominant display error independent of order: %s', async mode => {
      const severities = mode.endsWith('warning-first') ? ['warning', 'error'] : ['error', 'warning'];
      const message = "Valid display is 'Current label'";
      const issues = severities.map(severity => ({ severity, code: 'invalid-display', message: severity + ': ' + message }));
      const primary = mode.startsWith('parameters') ? response(false, message, { issues })
        : operationOutcomeToCodeSystemResult({ resourceType: 'OperationOutcome', issue: issues.map(issue => ({
          severity: issue.severity, code: 'invalid', details: { text: issue.message, coding: [
            { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: issue.code },
          ] },
        })) }, code, system);
      expect(await validate(primary, 'Unrelated label').result).toBe(primary);
      expect(published(primary, 'Unrelated label')).toContainEqual(expect.objectContaining({
        code: 'terminology-display-mismatch', severity: 'error', message: 'error: ' + message,
      }));
      expect(primary.issues?.map(issue => issue.severity)).toEqual(severities);
    },
  );
  it('retains an authentic SNOMED negative despite a legacy severity synonym', async () => {
    const actualSystem = 'http://snomed.info/sct';
    const actualCode = '6736007';
    const primary = response(false, "Valid display is 'Moderate severity'", {}, { code: actualCode, system: actualSystem });
    const { result } = validate(primary, 'Midgrade', [], actualSystem, actualCode);
    expect(await result).toBe(primary);
    expect(published(primary, 'Midgrade', actualSystem, actualCode)).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it.each(['History of Immunization Narrative', 'HISTORY OF IMMUNIZATION NOTE', "Patient's history, narrative (reported)"])(
    'preserves genuine positive acceptance for %s', async display => {
      const primary = response(true, undefined, { display: 'History of Immunization note' });
      const { result } = validate(primary, display);
      expect(await result).toBe(primary);
      expect(published(primary, display)).toEqual([]);
      expect(isVerifiedCodeSystemResult(primary)).toBe(true);
    },
  );
  it('preserves legacy unmarked case normalization with all independent lifecycle fields', async () => {
    const primary: CodeSystemValidationResult = { valid: false, reason: 'display-mismatch', inactive: true,
      display: 'History of Immunization note', message: "Valid display is 'History of Immunization note'", issues: [
        { severity: 'error', code: 'invalid-display', message: "Valid display is 'History of Immunization note'" },
        { severity: 'warning', code: 'code-comment', message: 'Concept is inactive' },
        { severity: 'warning', code: 'code-retired', message: 'Retired concept' },
      ] };
    const original = structuredClone(primary);
    const { result } = validate(primary, 'HISTORY OF IMMUNIZATION NOTE');
    const actual = await result;
    expect(actual).toMatchObject({ valid: true, inactive: true, display: primary.display, issues: primary.issues!.slice(1) });
    expect(isVerifiedCodeSystemResult(actual)).toBe(false);
    expect(primary).toEqual(original);
    expect(published(actual, 'HISTORY OF IMMUNIZATION NOTE').map(issue => issue.code))
      .toEqual(['terminology-code-inactive', 'terminology-code-retired']);
  });
  it('does not overrule an independent code-invalid response with quoted display text', async () => {
    const primary: CodeSystemValidationResult = { valid: false, reason: 'code-unknown',
      message: "Valid display is 'Alpha'", issues: [{ severity: 'error', code: 'invalid-display', message: "Valid display is 'Alpha'" }] };
    expect(await validate(primary, 'Alpha').result).toBe(primary);
    expect(published(primary, 'Alpha')).toContainEqual(expect.objectContaining({ code: 'terminology-code-invalid' }));
  });
  it('does not overrule an independent error beside legacy display compatibility', async () => {
    const primary: CodeSystemValidationResult = { valid: false, reason: 'display-mismatch', message: "Valid display is 'Alpha'", issues: [
      { severity: 'error', code: 'invalid-display', message: "Valid display is 'Alpha'" },
      { severity: 'error', code: 'code-invalid', message: 'Code is invalid in this edition' },
    ] };
    expect(await validate(primary, 'Alpha').result).toBe(primary);
  });
  const unverified: CodeSystemValidationResult[] = [
    { valid: true },
    { valid: true, reason: 'no-server' },
    { valid: true, reason: 'circuit-open' },
    { valid: true, reason: 'remote-budget-exhausted' },
    { valid: true, reason: 'national-extension-unverified' },
    parseCodeSystemValidationParameters({ resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: true }, { name: 'result', valueBoolean: true },
    ] }, code, system),
  ];
  it.each(unverified)('cannot replace a confirmed display negative with fallback U %j', async fallback => {
    const primary = response(false, "Valid display is 'Current label'");
    const { result } = validate(primary, 'Unrelated label', [fallback]);
    expect(await result).toBe(primary);
    expect(published(primary, 'Unrelated label')).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it.each(unverified)('cannot remove confirmed inactive evidence with fallback U %j', async fallback => {
    const primary = response(true, undefined, { inactive: true, issues: [
      { severity: 'warning', code: 'code-comment', message: 'Concept is inactive' },
    ] });
    expect(await validate(primary, 'Current label', [fallback]).result).toBe(primary);
    expect(published(primary, 'Current label')).toContainEqual(expect.objectContaining({ code: 'terminology-code-inactive' }));
  });
  it.each(unverified)('cannot replace confirmed code membership N with fallback U %j', async fallback => {
    const primary = response(false);
    expect(await validate(primary, 'Current label', [fallback]).result).toBe(primary);
    expect(published(primary, 'Current label')).toContainEqual(expect.objectContaining({ code: 'terminology-code-invalid' }));
  });
  it('continues after a fallback U until an actual positive response', async () => {
    const primary = response(false, "Valid display is 'Current label'");
    const positive = response(true, undefined, { display: 'Unrelated label' });
    const { call, result } = validate(primary, 'Unrelated label', [{ valid: true }, positive]);
    const actual = await result;
    expect(actual).toMatchObject({ valid: true, display: 'Unrelated label' });
    expect(isVerifiedCodeSystemResult(actual)).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenLastCalledWith(code, system, 'Unrelated label',
      { url: 'https://fallback-1.example/fhir', auth: undefined }, '2.82', 'en-NZ');
  });
  it.each([false, true])('preserves independent lifecycle and code evidence when display fallback is P; code-error=%s', async codeError => {
    const message = "Valid display is 'Current label'";
    const primary = response(false, message, { issues: [
      { severity: 'error', code: 'invalid-display', message },
      { severity: 'warning', code: 'code-retired', message: 'Retired concept' },
      { severity: 'warning', code: 'code-deprecated', message: 'Deprecated concept' },
      ...(codeError ? [{ severity: 'error', code: 'code-invalid', message: 'Independent invalid code' }] : []),
    ] });
    const original = structuredClone(primary);
    const positive = response(true, undefined, { display: 'Unrelated label' });
    const actual = await validate(primary, 'Unrelated label', [positive]).result;
    expect(actual.valid).toBe(!codeError);
    if (codeError) expect(actual.reason).toBe('code-unknown');
    expect(actual.issues?.map(issue => issue.code))
      .toEqual(['code-retired', 'code-deprecated', ...(codeError ? ['code-invalid'] : [])]);
    expect(isVerifiedCodeSystemResult(actual)).toBe(true);
    expect(primary).toEqual(original);
    expect(published(actual, 'Unrelated label').map(issue => issue.code))
      .toEqual(['terminology-code-retired', 'terminology-code-deprecated', ...(codeError ? ['terminology-code-invalid'] : [])]);
  });
  it('keeps a display negative containing inactive when code-only fallback reports active', async () => {
    const message = "Wrong Display Name 'Inactive finding'. Valid display is 'Current label'";
    const primary = response(false, message, { inactive: true, issues: [
      { severity: 'error', code: 'invalid-display', message },
      { severity: 'warning', code: 'code-comment', message: 'Concept is inactive' },
      { severity: 'warning', code: 'code-retired', message: 'Inactive concept has retired status' },
    ] });
    const mismatch = response(false, "Valid display is 'Other label'");
    const active = response(true);
    const { call, result } = validate(primary, 'Inactive finding', [mismatch]);
    call.mockImplementation(async (_code, _system, display) => display === undefined ? active : mismatch);
    const actual = await result;
    expect(actual).toMatchObject({ valid: false, reason: 'display-mismatch', inactive: false, message: primary.message, display: primary.display });
    expect(actual.issues?.map(issue => issue.code)).toEqual(['invalid-display', 'code-retired']);
    expect(published(actual, 'Inactive finding').map(issue => issue.code))
      .toEqual(['terminology-display-mismatch', 'terminology-code-retired']);
    expect(isVerifiedCodeSystemResult(actual)).toBe(true);
    expect(primary.inactive).toBe(true);
    expect(primary.issues).toHaveLength(3);
    expect(call).toHaveBeenLastCalledWith(code, system, undefined,
      { url: 'https://fallback-0.example/fhir', auth: undefined }, '2.82', 'en-NZ');
  });
});
