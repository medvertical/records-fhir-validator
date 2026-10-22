import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { ConstraintValidator } from '../constraint-validator.js';
import { validateSliceTypeProfileConstraints } from '../slicing-type-profile-constraints.js';

const profile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: 'https://example.org/benefit', name: 'Benefit',
  status: 'active', kind: 'complex-type', abstract: false, type: 'Extension',
  snapshot: { element: [
    { id: 'Extension', path: 'Extension' },
    { id: 'Extension.extension', path: 'Extension.extension', slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' } },
    { id: 'Extension.extension:quote', path: 'Extension.extension', sliceName: 'quote', type: [{ code: 'Extension' }] },
    { id: 'Extension.extension:quote.url', path: 'Extension.extension.url', fixedUri: 'quote' },
    { id: 'Extension.extension:quote.value[x]', path: 'Extension.extension.value[x]', type: [{ code: 'unsignedInt' }], constraint: [{
      key: 'unsignedInt-percentage-1', severity: 'error', human: 'Percentage must be between 0 and 100',
      expression: '($this >= 0) and ($this <= 100)',
    }] },
    { id: 'Extension.extension:eligible', path: 'Extension.extension', sliceName: 'eligible', type: [{ code: 'Extension' }] },
    { id: 'Extension.extension:eligible.url', path: 'Extension.extension.url', fixedUri: 'eligible' },
    { id: 'Extension.extension:eligible.value[x]', path: 'Extension.extension.value[x]', type: [{ code: 'boolean' }] },
  ] },
};

describe('invariants in a profiled extension slice', () => {
  it.each([50, 101])('applies percentage constraints only to the quote slice (%s)', async percentage => {
    const issues = await validateSliceTypeProfileConstraints({ url: profile.url, extension: [
      { url: 'eligible', valueBoolean: false }, { url: 'quote', valueUnsignedInt: percentage },
    ] }, {
      sliceName: 'benefit', path: 'Coverage.extension', min: 0, max: '1',
      type: [{ code: 'Extension', profile: [profile.url] }],
    }, 'Coverage.extension[0]', 'R4', async () => profile, new ConstraintValidator());
    expect(issues).toHaveLength(percentage <= 100 ? 0 : 1);
    if (percentage > 100) expect(issues[0]).toMatchObject({ severity: 'error', path: 'Coverage.extension[0].extension[1].valueUnsignedInt' });
  });
});
