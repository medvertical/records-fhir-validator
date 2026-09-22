import { describe, expect, it, vi } from 'vitest';
import { validateCodeInCodeSystemWithFallbacks } from '../valueset-code-system-validator';
import type { CodeSystemValidationResult } from '../terminology-api-types';

const mismatch: CodeSystemValidationResult = {
  valid: false, reason: 'display-mismatch',
  issues: [{ severity: 'error', code: 'invalid-display', message: 'Wrong display' }],
};

function validate(validateCodeInCodeSystem: ReturnType<typeof vi.fn>, fallbackCount = 1) {
  return validateCodeInCodeSystemWithFallbacks({
    apiClient: { validateCodeInCodeSystem } as never,
    code: '322236009', system: 'http://snomed.info/sct', display: 'Unrelated medicine',
    fhirVersion: 'R4', resolutionConfig: {
      strategy: 'server-first', serverUrl: 'https://primary.example/fhir',
      servers: [
        { id: 'primary', url: 'https://primary.example/fhir', enabled: true, fhirVersions: ['R4'] },
        ...Array.from({ length: fallbackCount }, (_, index) => ({
          id: `fallback-${index}`, url: `https://fallback-${index}.example/fhir`,
          enabled: true, fhirVersions: ['R4' as const],
        })),
      ],
    },
  });
}

describe('display validation after a CodeSystem coverage fallback', () => {
  it.each(['code-unknown', 'system-unresolvable'] as const)(
    'does not lose the submitted display when the primary returns %s', async reason => {
      const call = vi.fn().mockResolvedValueOnce({ valid: false, reason })
        .mockImplementation(async (_code, _system, display) => display ? mismatch : { valid: true });
      expect(await validate(call)).toMatchObject(mismatch);
      expect(call).toHaveBeenLastCalledWith(
        '322236009', 'http://snomed.info/sct', 'Unrelated medicine',
        { url: 'https://fallback-0.example/fhir', auth: undefined },
      );
    },
  );

  it('allows a later eligible server to confirm the submitted designation', async () => {
    const call = vi.fn().mockResolvedValueOnce({ valid: false, reason: 'code-unknown' })
      .mockResolvedValueOnce(mismatch).mockResolvedValueOnce({ valid: true });
    expect(await validate(call, 2)).toEqual({ valid: true });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('keeps the display finding when no remaining server confirms it', async () => {
    const call = vi.fn().mockResolvedValueOnce({ valid: false, reason: 'code-unknown' })
      .mockResolvedValueOnce(mismatch).mockResolvedValueOnce({ valid: false, reason: 'system-unresolvable' });
    expect(await validate(call, 2)).toMatchObject(mismatch);
  });
});
