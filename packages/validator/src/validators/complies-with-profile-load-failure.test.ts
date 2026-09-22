import { describe, expect, it } from 'vitest';
import { CompliesWithValidator } from './complies-with-validator';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader';

const COMPLIES_WITH_EXT = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-compliesWithProfile';
const CLAIMED = 'http://example.org/StructureDefinition/Parent';

const derived = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/Derived',
  extension: [{ url: COMPLIES_WITH_EXT, valueCanonical: CLAIMED }],
  differential: { element: [{ path: 'Patient.name', min: 0 }] },
};

function validatorWith(loadProfile: () => Promise<unknown>): CompliesWithValidator {
  return new CompliesWithValidator({ loadProfile } as unknown as StructureDefinitionLoader);
}

describe('compliesWithProfile when the claimed profile cannot be loaded', () => {
  it('reports the load failure instead of dropping the compliance check', async () => {
    const validator = validatorWith(() => Promise.reject(new Error('store unreadable')));

    const issues = await validator.validate(derived, 'R4');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'profile-unreadable',
      severity: 'warning',
      details: { validationStatus: 'incomplete', reason: 'claimed-profile' },
    });
  });

  it('stays silent when the claimed profile is merely absent', async () => {
    const validator = validatorWith(() => Promise.resolve(null));
    expect(await validator.validate(derived, 'R4')).toEqual([]);
  });

  it('keeps the profile canonical out of the details as a raw value', async () => {
    const validator = validatorWith(() => Promise.reject(new Error('boom')));

    const [issue] = await validator.validate(derived, 'R4');

    expect(JSON.stringify(issue.details)).not.toContain(CLAIMED);
    expect(issue.details).toMatchObject({ profileRef: expect.any(String) });
  });

  it('does not fire for a profile that has no claim at all', async () => {
    const validator = validatorWith(() => Promise.reject(new Error('boom')));
    const noClaim = { ...derived, extension: [] };
    expect(await validator.validate(noClaim, 'R4')).toEqual([]);
  });
});
