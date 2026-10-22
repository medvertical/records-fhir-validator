import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../../logger.js';
import { ProfileExecutor, type ProfileValidationContext } from '../profile-executor.js';
import type { ExtensionValidator } from '../../../validators/extension-validator.js';
import type { SlicingValidator } from '../../../validators/slicing-validator.js';
import type { ConstraintValidator } from '../../../validators/constraint-validator.js';

vi.mock('../../../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function fixture(fail = false) {
  const extension = { validateExtensions: fail ? vi.fn().mockRejectedValue(new Error('private failure')) : vi.fn().mockResolvedValue([]) };
  const executor = new ProfileExecutor(extension as unknown as ExtensionValidator,
    { setMustSupportSeverity: vi.fn(), validateSlicing: vi.fn().mockResolvedValue([]) } as unknown as SlicingValidator,
    { validate: vi.fn().mockResolvedValue([]) } as unknown as ConstraintValidator);
  const context: ProfileValidationContext = {
    resource: { resourceType: 'Patient', id: 'private-id', name: [{ text: 'private-name' }] },
    resourceType: 'Patient', profileUrl: 'http://private.test/StructureDefinition/Patient',
    structureDef: { url: 'http://private.test/StructureDefinition/Patient', type: 'Patient', snapshot: { element: [{ path: 'Patient' }] } },
    fhirVersion: 'R4', strictMode: false, getValueAtPath: () => undefined,
  };
  return { executor, context };
}

describe('profile phase diagnostics', () => {
  it('records all subphases without including payloads or raw canonical URLs', async () => {
    const { executor, context } = fixture();
    expect(await executor.validate(context)).toEqual([]);
    const call = vi.mocked(logger.debug).mock.calls.find(([message]) => message === '[ProfileExecutor] Phase timings');
    expect(call?.[1]).toMatchObject({ outcome: 'completed', totalMs: expect.any(Number), profileRef: expect.any(String), phases: {
      extensions: expect.any(Number), slicing: expect.any(Number), conformance: expect.any(Number),
      constraints: expect.any(Number), identifiers: expect.any(Number), deepConformance: expect.any(Number),
      snapshotFHIRPath: expect.any(Number),
    } });
    expect(JSON.stringify(call)).not.toContain('private');
  });

  it('records the failed phase while retaining the existing failure finding', async () => {
    vi.clearAllMocks();
    const { executor, context } = fixture(true);
    const issues = await executor.validate(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    const call = vi.mocked(logger.debug).mock.calls.find(([message]) => message === '[ProfileExecutor] Phase timings');
    expect(call?.[1]).toMatchObject({ outcome: 'failed', phases: { extensions: expect.any(Number) } });
    expect(JSON.stringify(call)).not.toContain('private');
  });
});
