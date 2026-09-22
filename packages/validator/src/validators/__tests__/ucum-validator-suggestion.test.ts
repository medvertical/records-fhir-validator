import { describe, expect, it, vi } from 'vitest';
import { UcumCodeValidator } from '../ucum-validator';

const ucumValidator = new UcumCodeValidator();
import {
  buildInvalidUcumIssueDetails,
  buildInvalidUcumMessage,
} from '../../core/executors/terminology-ucum-rules';

describe('ucum-lhc suggestion engine (gap P-5)', () => {
  it.each([
    ['/HPF', '/[HPF]'],
    ['iU/L', '[iU]/L'],
    ['mIU/L', 'm[IU]/L'],
    ['/mcg', '/ug'],
    ['mcg/L', 'ug/L'],
    ['mIU/L/h', 'm[IU]/L/h'],
    ['mIU/dL', 'm[IU]/dL'],
    ['mmHg/s', 'mm[Hg]/s'],
    ['HPF/HPF', '[HPF]/[HPF]'],
  ])('preserves the entire unit expression when correcting %s', (code, expected) => {
    const result = ucumValidator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.suggestion?.code).toBe(expected);
    expect(ucumValidator.validate(expected).valid).toBe(true);
    expect(buildInvalidUcumIssueDetails(code, 'Observation.valueQuantity.code', result.message, result.suggestion))
      .toMatchObject({ suggestedCode: expected });
  });

  it('keeps the denominator when a caller only has the parser diagnostic', () => {
    const message = 'iU is not a valid unit expression, but [iU] is.\nDid you mean [iU] (international unit - arbitrary)?';
    expect(buildInvalidUcumIssueDetails('iU/L', 'Observation.valueQuantity.code', message))
      .toMatchObject({ suggestedCode: '[iU]/L' });
  });

  it('does not offer a partial correction that leaves another invalid unit', () => {
    const result = ucumValidator.validate('iU/foo');
    expect(result.valid).toBe(false);
    expect(result.suggestion).toBeUndefined();
    expect(buildInvalidUcumIssueDetails('iU/foo', 'Observation.valueQuantity.code', result.message))
      .not.toHaveProperty('suggestedCode');
  });

  it('keeps human-readable annotations unchanged when correcting the unit', () => {
    expect(ucumValidator.validate('iU/L{assay unit}').suggestion?.code)
      .toBe('[iU]/L{assay unit}');
  });

  it('keeps the original error when the parser throws while checking a correction', () => {
    const validator = new UcumCodeValidator();
    Object.assign(validator, { ucumUtils: { validateUnitString: vi.fn()
      .mockReturnValueOnce({ status: 'invalid', ucumCode: '[HPF]', msg: ['Invalid unit'] })
      .mockImplementation(() => { throw new Error('correction parser failure'); }) } });
    expect(validator.validate('HPF')).toMatchObject({ valid: false, message: 'Invalid unit' });
  });

  it('valid codes carry no suggestion', () => {
    expect(ucumValidator.validate('mg/dL')).toEqual({ valid: true });
  });

  it('suggests a correction for a code absent from the static table', () => {
    // `mmHg` is NOT in COMMON_UCUM_CORRECTIONS — only the ucum-lhc engine
    // can propose `mm[Hg]` here.
    const result = ucumValidator.validate('mmHg');
    expect(result.valid).toBe(false);
    expect(result.suggestion?.code).toBe('mm[Hg]');
  });

  it('threads the parser suggestion into issue details and message', () => {
    const result = ucumValidator.validate('mmHg');
    const path = 'Observation.valueQuantity.code';

    expect(buildInvalidUcumIssueDetails('mmHg', path, result.message, result.suggestion))
      .toEqual(expect.objectContaining({
        suggestedCode: 'mm[Hg]',
        fixHint: expect.stringContaining("'mm[Hg]'"),
      }));

    expect(buildInvalidUcumMessage('mmHg', path, result.message, result.suggestion))
      .toContain("Use 'mm[Hg]' in Quantity.code.");
  });

  it('still flags an unfixable invalid code without a suggestion', () => {
    const result = ucumValidator.validate('foobar');
    expect(result.valid).toBe(false);
    expect(result.suggestion).toBeUndefined();
  });
});

describe('annotations with spaces', () => {
  // The HL7 reference validator accepts spaces inside `{...}` and official
  // IG examples rely on it (hl7.fhir.eu.hdr `{keer per dag inhaleren}`);
  // ucum-lhc alone would reject them per the strict UCUM grammar.
  it('accepts a standalone annotation containing spaces', () => {
    expect(ucumValidator.validate('{keer per dag inhaleren}')).toEqual({ valid: true });
  });

  it('accepts a unit with a spaced annotation suffix', () => {
    expect(ucumValidator.validate('mL/{per dag}')).toEqual({ valid: true });
  });

  it('still rejects non-ASCII characters inside annotations', () => {
    expect(ucumValidator.validate('{häufigkeit}').valid).toBe(false);
  });
});
