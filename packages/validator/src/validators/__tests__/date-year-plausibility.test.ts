import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateDateYearPlausibility } from '../primitive-string-format-validator';
import { TypeValidator } from '../type-validator';

const MAX_PLAUSIBLE_YEAR = 2106;

describe('validateDateYearPlausibility', () => {
  afterEach(() => vi.useRealTimers());
  it('warns for a dateTime far in the future (year 2140, seen in lforms R5 data)', () => {
    const issue = validateDateYearPlausibility(
      '2140-03-26T13:57:27.779Z',
      'dateTime',
      'Observation.effectiveDateTime',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'date-year-implausible',
      severity: 'warning',
      message:
        'The year 2140 is outside the range of reasonable years '
        + '(1800-2106) - check for data entry error',
    }));
    // The finding must not carry the date itself: message and details are
    // persisted, and a full date (a birthDate above all) is identifying.
    expect(issue?.message).not.toContain('2140-03-26');
    expect(JSON.stringify(issue?.details ?? {})).not.toContain('2140-03-26');
  });

  it('accepts a contemporary date (2020-01-01)', () => {
    expect(validateDateYearPlausibility('2020-01-01', 'date', 'Patient.birthDate')).toBeNull();
  });

  it('accepts 1800, the inclusive minimum plausible year (boundary)', () => {
    expect(validateDateYearPlausibility('1800-01-01', 'date', 'Patient.birthDate')).toBeNull();
  });

  it('warns for 1799, one year below the 1800 minimum (boundary)', () => {
    expect(validateDateYearPlausibility('1799-12-31', 'date', 'Patient.birthDate'))
      .toEqual(expect.objectContaining({ code: 'date-year-implausible', severity: 'warning' }));
  });

  it('accepts 2106, the inclusive maximum plausible year', () => {
    expect(validateDateYearPlausibility(String(MAX_PLAUSIBLE_YEAR), 'dateTime', 'Observation.effectiveDateTime'))
      .toBeNull();
  });

  it('warns for 2107, one year above the maximum', () => {
    expect(validateDateYearPlausibility(String(MAX_PLAUSIBLE_YEAR + 1), 'instant', 'Observation.issued'))
      .toEqual(expect.objectContaining({ code: 'date-year-implausible', severity: 'warning' }));
  });

  it('preserves the recorded ruleset bounds across calendar years', () => {
    vi.useFakeTimers();
    for (const year of [2026, 2027, 2030]) {
      vi.setSystemTime(new Date(`${year}-01-01T00:00:00Z`));
      expect(validateDateYearPlausibility('2107', 'date', 'Patient.birthDate'))
        .toMatchObject({ code: 'date-year-implausible', details: { maxPlausibleYear: 2106 } });
    }
  });

  it('ignores non-date primitive types', () => {
    expect(validateDateYearPlausibility('2140', 'string', 'Patient.name[0].text')).toBeNull();
  });
});

describe('TypeValidator date year plausibility integration', () => {
  it('emits only the plausibility warning for a well-formed but implausible dateTime', async () => {
    const validator = new TypeValidator();

    const issues = await validator.validate(
      '2140-03-26T13:57:27.779Z',
      [{ code: 'dateTime' }],
      'Observation.effectiveDateTime',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      code: 'date-year-implausible',
      severity: 'warning',
      path: 'Observation.effectiveDateTime',
    }));
  });

  it('emits no issues for a plausible dateTime', async () => {
    const validator = new TypeValidator();

    const issues = await validator.validate(
      '2020-01-01T12:00:00Z',
      [{ code: 'dateTime' }],
      'Observation.effectiveDateTime',
    );

    expect(issues).toHaveLength(0);
  });

  it('emits an implausible-year warning for instants too', async () => {
    const validator = new TypeValidator();

    const issues = await validator.validate(
      '2140-03-26T13:57:27.779Z',
      [{ code: 'instant' }],
      'Observation.issued',
    );

    expect(issues.map(issue => issue.code)).toEqual(['date-year-implausible']);
  });

  it('keeps format errors exclusive: a malformed implausible date gets no plausibility warning', async () => {
    const validator = new TypeValidator();

    const issues = await validator.validate(
      '2140-02-31',
      [{ code: 'date' }],
      'Patient.birthDate',
    );

    expect(issues.map(issue => issue.code)).toEqual(['structural-invalid-format']);
  });
});
