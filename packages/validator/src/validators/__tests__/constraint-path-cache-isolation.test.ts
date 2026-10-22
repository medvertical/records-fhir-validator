import { describe, expect, it } from 'vitest';
import type { ElementDefinition } from '../../core/structure-definition-types.js';
import { ConstraintValidator } from '../constraint-validator.js';

const elements: ElementDefinition[] = [{
  path: 'Observation.component.valueQuantity.value',
  type: [{ code: 'decimal' }],
  constraint: [
    { key: 'minimum', severity: 'error', human: 'Minimum', expression: '$this >= 2' },
    { key: 'maximum', severity: 'error', human: 'Maximum', expression: '$this <= 5' },
  ],
}];
const profile = 'http://example.test/StructureDefinition/path-cache';
const observation = (value: number) => ({ resourceType: 'Observation', component: [{ valueQuantity: { value } }] });

describe('constraint path cache lifetime', () => {
  it('reads current values when the same resource is validated again', async () => {
    const validator = new ConstraintValidator();
    const resource = observation(1);
    const input = structuredClone(resource);
    const first = await validator.validate(resource, elements, profile);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ ruleId: 'minimum', path: 'Observation.component[0].valueQuantity.value' });
    expect(resource).toEqual(input);
    resource.component[0].valueQuantity.value = 7;
    const second = await validator.validate(resource, elements, profile);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ ruleId: 'maximum', path: 'Observation.component[0].valueQuantity.value' });
    resource.component[0].valueQuantity.value = 4;
    expect(await validator.validate(resource, elements, profile)).toEqual([]);
  });

  it('keeps overlapping validations of the same paths isolated', async () => {
    const validator = new ConstraintValidator();
    const [lower, upper, valid] = await Promise.all([1, 7, 4].map(value =>
      validator.validate(observation(value), elements, profile)));
    expect(lower.map(issue => issue.ruleId)).toEqual(['minimum']);
    expect(upper.map(issue => issue.ruleId)).toEqual(['maximum']);
    expect(valid).toEqual([]);
  });

  it('does not retain an absent optional path when a subsequent validation supplies it', async () => {
    const validator = new ConstraintValidator();
    const resource: { resourceType: string; component: Array<{ valueQuantity?: { value: number } }> } = {
      resourceType: 'Observation', component: [{}],
    };
    expect(await validator.validate(resource, elements, profile)).toEqual([]);
    resource.component[0].valueQuantity = { value: 7 };
    expect((await validator.validate(resource, elements, profile)).map(issue => issue.ruleId)).toEqual(['maximum']);
  });
});
