import { describe, expect, it } from 'vitest';
import { preprocessTypeLiterals } from '../fhirpath-type-preprocessor';

const ctx = (elementType: string | null) => ({
  elementType,
  resourceType: 'Observation',
  rootResourceType: 'Observation',
});

// au-core-obs-02 shape: a falsely-false `$this is dateTime` flips the xor
// into a spurious violation, so the known element type must decide the test.
describe('preprocessTypeLiterals $this-is substitution', () => {
  it('substitutes true when the element type matches', () => {
    expect(preprocessTypeLiterals('$this is dateTime implies $this.toString().length() >= 10', ctx('dateTime')))
      .toBe('true implies $this.toString().length() >= 10');
  });

  it('substitutes false for a known unrelated element type', () => {
    expect(preprocessTypeLiterals('$this is dateTime', ctx('Period'))).toBe('false');
  });

  it('honours FHIR primitive specialization chains', () => {
    expect(preprocessTypeLiterals('$this is string', ctx('code'))).toBe('true');
    expect(preprocessTypeLiterals('$this is Quantity', ctx('Age'))).toBe('true');
    expect(preprocessTypeLiterals('$this is uri', ctx('canonical'))).toBe('true');
  });

  it('leaves the expression alone without a known element type', () => {
    expect(preprocessTypeLiterals('$this is dateTime', ctx(null))).toBe('$this is dateTime');
  });

  it('leaves types outside the decidable tables alone', () => {
    expect(preprocessTypeLiterals('$this is Patient', ctx('Period'))).toBe('$this is Patient');
  });

  it('does not substitute when an iterator function rebinds $this', () => {
    const expression = "coding.where($this is Coding).exists() and $this is dateTime";
    expect(preprocessTypeLiterals(expression, ctx('dateTime'))).toBe(expression);
  });

  it('treats zero-argument exists() as non-rebinding', () => {
    // On a primitive `value` is the element's own value, which is `$this`.
    expect(preprocessTypeLiterals('value.exists() and $this is dateTime', ctx('dateTime')))
      .toBe('$this.exists() and true');
  });

  // Da Vinci RA's ra-3 constrains a valueString by `value.startsWith(…)`.
  it('reads value on a primitive element as the element itself', () => {
    expect(preprocessTypeLiterals("value.startsWith('MeasureReport.group') and code.value = 'value'", ctx('string')))
      .toBe("$this.startsWith('MeasureReport.group') and code.value = 'value'");
    expect(preprocessTypeLiterals('value.exists()', ctx('Identifier'))).toBe('value.exists()');
  });
});
