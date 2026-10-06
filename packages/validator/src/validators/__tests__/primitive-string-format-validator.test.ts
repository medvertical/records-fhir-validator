import { describe, expect, it } from 'vitest';
import { validatePrimitiveStringFormat } from '../primitive-string-format-validator';

describe('validatePrimitiveStringFormat string whitespace lint', () => {
  it('warns when a string value has leading or trailing whitespace', () => {
    const issue = validatePrimitiveStringFormat(' padded ', 'string', 'Patient.name[0].family');

    expect(issue).toMatchObject({
      code: 'string-whitespace-padding',
      severity: 'warning',
      path: 'Patient.name[0].family',
      details: expect.objectContaining({
        leadingWhitespace: 1,
        trailingWhitespace: 1,
        valueLength: 8,
      }),
    });
    // A padded name is well-formed clinical content and both message and
    // details are persisted, so the value must never appear in either.
    expect(issue?.message).not.toContain('padded');
    expect(JSON.stringify(issue?.details ?? {})).not.toContain('padded');
  });

  it('accepts a clean string value', () => {
    expect(validatePrimitiveStringFormat('clean', 'string', 'Patient.name[0].family')).toBeNull();
  });

  it('accepts internal whitespace', () => {
    expect(validatePrimitiveStringFormat('two words', 'string', 'Patient.name[0].text')).toBeNull();
  });

  it('leaves whitespace-only strings to the whitespace-only primitive rule', () => {
    expect(validatePrimitiveStringFormat('   ', 'string', 'Patient.name[0].family')).toBeNull();
  });

  it('treats exotic Unicode whitespace incl. U+0085 NEL as whitespace-only, not padding', () => {
    expect(validatePrimitiveStringFormat('\t\n\u000b\u000c\r \u0085\u00a0\u2000\u3000', 'string', 'Parameters.parameter[0].value[x]')).toBeNull();
  });

  it('does not lint markdown, and leaves code values to the code whitespace rule', () => {
    expect(validatePrimitiveStringFormat('trailing space ', 'markdown', 'Composition.section[0].text')).toBeNull();
    expect(validatePrimitiveStringFormat(' active', 'code', 'Patient.gender'))
      .toMatchObject({ code: 'structural-invalid-format', severity: 'error' });
  });
});

describe('validatePrimitiveStringFormat code whitespace', () => {
  it('rejects a code with leading or irregular whitespace outside Codings', () => {
    expect(validatePrimitiveStringFormat('\u00a0"GEPR"', 'code', 'CodeSystem.concept[0].code')).toMatchObject({
      code: 'structural-invalid-format',
      message: expect.stringContaining('is not valid (whitespace rules)'),
    });
    expect(validatePrimitiveStringFormat('a  b', 'code', 'Patient.gender')).not.toBeNull();
    expect(validatePrimitiveStringFormat('two words', 'code', 'CodeSystem.concept[0].code')).toBeNull();
    // A Coding's code answers to the terminology hygiene rule.
    expect(validatePrimitiveStringFormat(' x', 'code', 'Observation.code.coding[0].code')).toBeNull();
  });
});


describe('validatePrimitiveStringFormat dates', () => {
  it.each([
    ['1990-13-01', 'date'],
    ['1990-00', 'date'],
    ['0000-01-01', 'date'],
    ['0000-01-01', 'dateTime'],
    ['2020-01-01', 'instant'],
    ['2020-01-01T10:00:00', 'instant'],
  ])('rejects %s as a %s', (value, type) => {
    expect(validatePrimitiveStringFormat(value, type, 'Observation.x')).toMatchObject({ severity: 'error' });
  });

  it.each([
    ['1990', 'date'],
    ['1990-12', 'date'],
    ['1990-12-31', 'date'],
    ['2020-01-01T10:00:00.123+01:00', 'dateTime'],
    ['2020-01-01T10:00:00Z', 'instant'],
  ])('accepts %s as a %s', (value, type) => {
    expect(validatePrimitiveStringFormat(value, type, 'Observation.x')).toBeNull();
  });
});
