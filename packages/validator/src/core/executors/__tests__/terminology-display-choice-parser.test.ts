import { describe, expect, it } from 'vitest';
import { extractAcceptedDisplays, uniqueAcceptedDisplays } from '../terminology-display-rules.js';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues.js';
import { parseCodeSystemValidationParameters } from '../../../validators/terminology-code-system-result.js';
import { isVerifiedCodeSystemResult } from '../../../validators/code-system-validation-evidence.js';

const system = 'http://loinc.org';
const code = '11369-6';
const originalChoices = "Valid display is one of 3 choices: 'History of Immunization note' (en-US), "
  + "'History of Immunization note' (en-US) or 'Hx of Immunization note' (en-US) (for the language(s) 'en-NZ')";
function response(message: string, display?: string) {
  return parseCodeSystemValidationParameters({
    resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false },
      ...(display ? [{ name: 'display', valueString: display }] : []),
      { name: 'message', valueString: message },
      { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{
        severity: 'error', code: 'invalid', details: {
          coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' }],
          text: message,
        },
      }] } },
    ],
  }, code, system);
}
function issues(message: string, display: string, preferred?: string) {
  return buildCodeSystemResultIssues({ system, code, display }, response(message, preferred), 'Observation.code.coding', 0, true);
}

describe('complete terminology display choice messages', () => {
  it('preserves each comma-separated original choice before deduplication', () => {
    expect(extractAcceptedDisplays(originalChoices)).toEqual([
      'History of Immunization note', 'History of Immunization note', 'Hx of Immunization note',
    ]);
    expect(uniqueAcceptedDisplays(extractAcceptedDisplays(originalChoices))).toEqual([
      'History of Immunization note', 'Hx of Immunization note',
    ]);
  });
  it('publishes only real source designations beside the original display negative', () => {
    expect(issues(originalChoices, 'History of Immunization Narrative')).toEqual([expect.objectContaining({
      code: 'terminology-display-mismatch', severity: 'error',
      details: expect.objectContaining({ acceptedDisplays: ['History of Immunization note', 'Hx of Immunization note'] }),
    })]);
  });
  it('does not accept the former fabricated concatenation as a designation', () => {
    expect(issues(originalChoices, "History of Immunization note' (en-US), 'History of Immunization note"))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it.each(['History of Immunization note', 'Hx of Immunization note'])(
    'retains a typed rejection even for a listed designation: %s', display => expect(issues(originalChoices, display))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' })),
  );
  it.each([', ', ' or ', ', or '])('keeps inner punctuation with outer separator %s', separator => {
    const choices = ["Patient's history, narrative (reported)", 'History (for the language(s) recorded)'];
    const message = "Valid display is one of 2 choices: '" + choices[0] + "' (en-NZ)" + separator
      + "'" + choices[1] + "' (en-US) (for the language(s) 'en-NZ')";
    expect(extractAcceptedDisplays(message)).toEqual(choices);
  });
  it.each([
    "Valid display is one of 2 choices: 'Alpha' (en-US)",
    "Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta",
    "Valid display is one of 2 choices: 'Alpha' (en-US); 'Beta' (en-US)",
    "Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta' or 'Gamma' (en-US)",
    "Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta', 'Gamma' (en-US)",
    "Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta'; 'Gamma' (en-US)",
    "Valid display is one of 2 choices: 'Alpha' (en-US) or 'Beta' (en-US) unexpected",
  ])('never lets malformed prose suppress a typed display error: %s', message => {
    expect(extractAcceptedDisplays(message)).toEqual([]);
    expect(issues(message, 'Alpha')).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it('does not replace explicit source rejection with overlapping LOINC vocabulary', () => {
    expect(issues(originalChoices, 'History of Immunization note describing unrelated findings'))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it('keeps typed display authority when quoted language text is ambiguous in prose', () => {
    const preferred = "Label 'quoted' (en-US) note";
    const message = "Valid display is one of 1 choices: '" + preferred + "' (en-US)";
    expect(extractAcceptedDisplays(message)).toEqual([]);
    expect(issues(message, preferred, preferred)).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
    expect(issues(message, 'quoted', preferred)).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it('retains a single designation containing an apostrophe and internal punctuation', () => {
    const display = "Patient's history, narrative (reported)";
    expect(extractAcceptedDisplays("Valid display is '" + display + "' (en-NZ) (for the language(s) 'en-NZ')"))
      .toEqual([display]);
  });
  it('retains typed preferred display authority when the prose is incomplete', () => {
    const message = "Valid display is one of 3 choices: 'Alpha' (en-US)";
    expect(issues(message, 'Typed preferred', 'Typed preferred')).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
    expect(issues(message, 'Wrong', 'Typed preferred')).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ expectedDisplay: 'Typed preferred', acceptedDisplays: ['Typed preferred'] }),
    }));
  });
  it('does not change the typed response or its membership evidence marker', () => {
    const result = response(originalChoices);
    const before = structuredClone(result);
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    buildCodeSystemResultIssues({ system, code, display: 'History of Immunization Narrative' }, result, 'Observation.code.coding', 0, true);
    expect(result).toEqual(before);
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
  });
  it('preserves a separate code-invalid finding even when prose lists the display', () => {
    const result = { valid: false, reason: 'code-unknown', message: originalChoices };
    expect(buildCodeSystemResultIssues({ system, code, display: 'History of Immunization note' }, result, 'Observation.code.coding', 0, true))
      .toContainEqual(expect.objectContaining({ code: 'terminology-code-invalid' }));
  });
  it('keeps an unavailable source incomplete without inventing a display error', () => {
    const result = { valid: true, reason: 'no-server', message: originalChoices };
    expect(buildCodeSystemResultIssues({ system, code, display: 'Wrong' }, result, 'Observation.code.coding', 0, true))
      .toEqual([expect.objectContaining({ code: 'terminology-codesystem-unverified', details: expect.objectContaining({ validationComplete: false }) })]);
    expect(isVerifiedCodeSystemResult(result)).toBe(false);
  });
});
