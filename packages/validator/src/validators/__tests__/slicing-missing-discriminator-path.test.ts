import { describe, expect, it } from 'vitest';
import { hasDirectDiscriminatorEvidence } from '../slice-discriminator-constraints';
import { matchPatternDiscriminator } from '../slice-discriminator-value-matchers';
import { assessSlicingVerifiability } from '../slicing-verifiability';
import type { SliceDefinition } from '../slice-types';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const slice = (constraint: Partial<SliceDefinition>): SliceDefinition => ({
  sliceName: 'loinc', path: 'Observation.code.coding', min: 1, max: '1', ...constraint,
});

describe('missing pattern discriminator paths', () => {
  it.each(['pattern', 'fixed'] as const)('does not treat an absent child of %s as discriminator evidence', kind => {
    const definition = slice({ [kind]: { system: 'http://loinc.org', code: '96825-5' } });
    expect(hasDirectDiscriminatorEvidence(definition, 'coding')).toBe(false);
    expect(hasDirectDiscriminatorEvidence(definition, 'system')).toBe(true);
  });

  it('does not assign a Coding to every slice when the discriminator names a missing coding child', () => {
    const definition = slice({ pattern: { system: 'http://loinc.org', code: '96825-5' } });
    expect(matchPatternDiscriminator({ system: 'http://loinc.org', code: '96825-5' },
      definition, 'coding', same, () => false)).toBe(false);
    expect(matchPatternDiscriminator({ system: 'http://loinc.org', code: '96825-5' },
      definition, '$this', same, () => false)).toBe(true);
  });

  it('keeps missing child metadata incomplete instead of proving ambiguous matches or cardinality failures', () => {
    const assessment = assessSlicingVerifiability({
      slices: [slice({ pattern: { system: 'http://loinc.org' } }),
        { ...slice({ pattern: { system: 'http://snomed.info/sct' } }), sliceName: 'sct' }],
      slicing: { rules: 'closed', discriminator: [{ type: 'pattern', path: 'coding' }] },
      elementPath: 'Observation.code.coding',
    });
    expect(assessment.blockingIssues).toEqual([expect.objectContaining({
      code: 'profile-slice-validation-incomplete', severity: 'information',
      details: expect.objectContaining({ validationComplete: false }),
    })]);
  });

  it.each([false, 0] as const)('retains the valid primitive constraint %s without matching other values', value => {
    const definition = slice({ pattern: value });
    expect(hasDirectDiscriminatorEvidence(definition, '$this')).toBe(true);
    expect(matchPatternDiscriminator(value, definition, '$this', same, () => false)).toBe(true);
    expect(matchPatternDiscriminator('different', definition, '$this', same, () => false)).toBe(false);
    expect(hasDirectDiscriminatorEvidence(slice({ fixed: value }), '$this')).toBe(true);
  });
});
