import { describe, expect, it } from 'vitest';
import { systemlessCodingSatisfiesBinding } from '../valueset-systemless-coding';
import type { ValueSet } from '../valueset-types';

const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';

function loader(valueSet: Partial<ValueSet> | null) {
  return {
    loadValueSetResource: async () => (valueSet ? { resourceType: 'ValueSet', url: 'u', status: 'active', ...valueSet } as ValueSet : null),
  };
}

describe('systemlessCodingSatisfiesBinding', () => {
  const listed = loader({ compose: { include: [{ system: V2_0203, concept: [{ code: 'PRN' }, { code: 'MR' }] }] } });

  it('takes a code listed by a single-include value set at face value inside a CodeableConcept', async () => {
    await expect(systemlessCodingSatisfiesBinding(listed, { coding: [{ code: 'PRN' }] }, 'PRN', 'vs', 'extensible'))
      .resolves.toBe(true);
    await expect(systemlessCodingSatisfiesBinding(listed, { coding: [{ code: 'XX' }] }, 'XX', 'vs', 'extensible'))
      .resolves.toBe(false);
  });

  it('finds no bare code in a value set of several includes, a whole code system or an expansion', async () => {
    const several = loader({ compose: { include: [
      { system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus' },
      { system: 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor', concept: [{ code: 'UNK' }] },
    ] } });
    const whole = loader({ compose: { include: [{ system: V2_0203 }] } });
    const expanded = loader({
      compose: { include: [{ system: V2_0203, concept: [{ code: 'PRN' }] }] },
      expansion: { contains: [{ system: V2_0203, code: 'PRN' }] },
    });

    for (const [source, code] of [[several, 'UNK'], [whole, 'PRN'], [expanded, 'PRN']] as const) {
      await expect(systemlessCodingSatisfiesBinding(source, { coding: [{ code }] }, code, 'vs', 'extensible'))
        .resolves.toBe(false);
    }
  });

  it('leaves a lone Coding to its binding only when the binding is required', async () => {
    await expect(systemlessCodingSatisfiesBinding(listed, { code: 'EMER' }, 'EMER', 'vs', 'extensible')).resolves.toBe(true);
    await expect(systemlessCodingSatisfiesBinding(listed, { code: 'EMER' }, 'EMER', 'vs', 'required')).resolves.toBe(false);
  });
});
