import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

// Gap P-4: `as` on a non-singleton collection (e.g. `component.value` across
// repeating components) threw "Expected singleton on left side of 'as'" in
// fhirpath.js, landing in the catch block — the constraint was silently
// skipped as an informational evaluation-error. The `as` → `ofType` rewrite
// makes the narrowing collection-safe so the constraint actually evaluates.

const profileUrl = 'http://example.org/StructureDefinition/obs-collection-cast';

const observationWithComponents = (components: any[]) => ({
  resourceType: 'Observation',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
  component: components,
});

const collectionCastElement = (expression: string) => ([
  {
    id: 'Observation',
    path: 'Observation',
    min: 0,
    constraint: [{
      key: 'obs-collection-cast',
      severity: 'error' as const,
      human: 'Every quantity component value must carry a code',
      expression,
    }],
  },
]);

describe('ConstraintValidator collection-cast handling (P-4)', () => {
  it('evaluates an `as`-on-collection constraint instead of skipping it', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      observationWithComponents([
        { valueQuantity: { value: 5, code: 'mg' } },
        { valueQuantity: { value: 7 } }, // missing code -> should fail
      ]),
      collectionCastElement('(component.value as Quantity).all(code.exists())'),
      profileUrl,
    );

    // The constraint now produces a real violation rather than an
    // informational evaluation-error (the old fail-open path).
    expect(issues.some(i => i.code === 'profile-constraint-evaluation-error')).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'obs-collection-cast',
    }));
  });

  it('evaluates an `is`-on-collection constraint instead of skipping it', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      observationWithComponents([
        { valueQuantity: { value: 5, code: 'mg' } },
        { valueString: 'x' }, // not a Quantity -> `every value is Quantity` fails
      ]),
      collectionCastElement('component.value is Quantity'),
      profileUrl,
    );

    expect(issues.some(i => i.code === 'profile-constraint-evaluation-error')).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'obs-collection-cast',
    }));
  });

  it('passes when every collection item satisfies the narrowed constraint', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      observationWithComponents([
        { valueQuantity: { value: 5, code: 'mg' } },
        { valueQuantity: { value: 7, code: 'mg' } },
      ]),
      collectionCastElement('(component.value as Quantity).all(code.exists())'),
      profileUrl,
    );

    expect(issues.filter(i => i.ruleId === 'obs-collection-cast')).toHaveLength(0);
    expect(issues.some(i => i.code === 'profile-constraint-evaluation-error')).toBe(false);
  });
});
