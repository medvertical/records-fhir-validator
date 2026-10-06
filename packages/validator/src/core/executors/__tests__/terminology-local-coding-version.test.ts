import { describe, expect, it, vi } from 'vitest';

import { validateDeepLocalCodings } from '../terminology-local-coding-rules';

describe('deep local Coding validation', () => {
  it('forwards Coding.version below complex datatype boundaries', async () => {
    const validateCodeInLocalCodeSystemOnly = vi.fn().mockResolvedValue(null);
    const version = 'http://snomed.info/sct/999000041000000102/version/20250701';
    const resource = {
      resourceType: 'Practitioner',
      identifier: [{
        type: {
          coding: [{
            system: 'http://snomed.info/sct',
            version,
            code: '35901911000001104',
          }],
        },
        value: 'example',
      }],
    };

    await expect(validateDeepLocalCodings(
      resource,
      [],
      { validateCodeInLocalCodeSystemOnly },
      'R4',
    )).resolves.toEqual([expect.objectContaining({
      code: 'terminology-codesystem-unverified',
      severity: 'information',
      details: expect.objectContaining({ validationComplete: false, validationStatus: 'incomplete' }),
    })]);

    expect(validateCodeInLocalCodeSystemOnly).toHaveBeenCalledWith(
      '35901911000001104',
      'http://snomed.info/sct',
      undefined,
      'R4',
      version,
    );
  });
});
