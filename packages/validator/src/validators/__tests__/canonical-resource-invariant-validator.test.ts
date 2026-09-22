import { describe, expect, it } from 'vitest';
import { CanonicalResourceInvariantValidator } from '../canonical-resource-invariant-validator';

describe('CanonicalResourceInvariantValidator', () => {
  const validator = new CanonicalResourceInvariantValidator();

  it('reports invalid canonical resource names', () => {
    expect(validator.validate({
      resourceType: 'ValueSet',
      name: 'invalid-name',
    })).toContainEqual(expect.objectContaining({
      code: 'canonical-resource-invariant-vsd-0',
      severity: 'warning',
    }));
  });

  it('does not require the optional name field', () => {
    expect(validator.validate({ resourceType: 'CodeSystem' })).toEqual([]);
    expect(validator.validate({ resourceType: 'ValueSet' })).toEqual([]);
  });

  it('enforces at least two components on composite SearchParameters', () => {
    expect(validator.validate({
      resourceType: 'SearchParameter',
      type: 'composite',
      component: [{}],
    })).toContainEqual(expect.objectContaining({
      code: 'business-rule-sp-composite',
      severity: 'error',
    }));
  });

  it('ignores malformed non-resource values safely', () => {
    expect(validator.validate(null)).toEqual([]);
    expect(validator.validate({ resourceType: 42, name: {} })).toEqual([]);
  });
});

describe('constraint key reuse', () => {
  it('reports a key redefined with a different expression', () => {
    const validator = new CanonicalResourceInvariantValidator();
    const issues = validator.validate({
      resourceType: 'StructureDefinition',
      name: 'Example',
      differential: {
        element: [
          { path: 'Patient.name', constraint: [{ key: 'e-1', expression: 'a.exists()' }] },
          { path: 'Patient.address', constraint: [{ key: 'e-1', expression: 'b.exists()' }] },
        ],
      },
    });
    const reuse = issues.filter((issue) => issue.code === 'canonical-resource-constraint-key-reused');
    expect(reuse).toHaveLength(1);
    expect(reuse[0].message).toContain("'e-1'");
  });

  it('allows a key restated with the same expression', () => {
    // Restating an inherited invariant verbatim is how a profile carries it
    // forward, and is not a redefinition.
    const validator = new CanonicalResourceInvariantValidator();
    const issues = validator.validate({
      resourceType: 'StructureDefinition',
      name: 'Example',
      differential: {
        element: [
          { path: 'Patient.name', constraint: [{ key: 'e-1', expression: 'a.exists()' }] },
          { path: 'Patient.address', constraint: [{ key: 'e-1', expression: 'a.exists()' }] },
        ],
      },
    });
    expect(issues.filter((i) => i.code === 'canonical-resource-constraint-key-reused')).toHaveLength(0);
  });
});
