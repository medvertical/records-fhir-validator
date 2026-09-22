/**
 * Slice type profiles must resolve within the validated release. Resolving
 * them as R4 regardless of the run silently applied R4 cardinalities and
 * constraints to R5/R6 resources.
 */
import { describe, expect, it, vi } from 'vitest';
import { createValidatorCoreRuntime } from '../../core/validator-core-components';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { SlicingValidator } from '../slicing-validator';

const extensionUrl = 'http://example.test/StructureDefinition/therapy-position';

const procedureProfile: StructureDefinition = {
  resourceType: 'StructureDefinition',
  url: 'http://example.test/StructureDefinition/ProcedureWithPosition',
  name: 'ProcedureWithPosition',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Procedure',
  snapshot: {
    element: [
      { id: 'Procedure', path: 'Procedure', min: 0, max: '*' },
      {
        id: 'Procedure.extension',
        path: 'Procedure.extension',
        min: 0,
        max: '*',
        slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
      },
      {
        id: 'Procedure.extension:therapyPosition',
        path: 'Procedure.extension',
        sliceName: 'therapyPosition',
        min: 0,
        max: '*',
        type: [{ code: 'Extension', profile: [extensionUrl] }],
      },
    ] as never,
  },
} as StructureDefinition;

describe('slice type profile resolution release', () => {
  it('asks the type profile resolver for the release of the validated resource', async () => {
    const resolver = vi.fn(async () => null);
    const validator = new SlicingValidator();
    validator.setTypeProfileResolver(resolver);

    await validator.validateSlicing([{ url: extensionUrl }], 'Procedure.extension', procedureProfile, null, undefined, 'R5');

    expect(resolver).toHaveBeenCalledWith(extensionUrl, 'R5');
    expect(resolver.mock.calls.every(call => call[1] === 'R5')).toBe(true);
  });

  it('defaults to R4 when the caller names no release', async () => {
    const resolver = vi.fn(async () => null);
    const validator = new SlicingValidator();
    validator.setTypeProfileResolver(resolver);

    await validator.validateSlicing([{ url: extensionUrl }], 'Procedure.extension', procedureProfile);

    expect(resolver).toHaveBeenCalledWith(extensionUrl, 'R4');
  });

  it('loads and snapshots the type profile for that release in the engine wiring', async () => {
    const runtime = createValidatorCoreRuntime({ enableCaching: false, autoDownload: false });
    const loadProfile = vi.spyOn(runtime.components.sdLoader, 'loadProfile').mockResolvedValue({
      resourceType: 'StructureDefinition',
      url: extensionUrl,
      name: 'TherapyPosition',
      status: 'active',
      kind: 'complex-type',
      abstract: false,
      type: 'Extension',
      differential: { element: [] },
    } as StructureDefinition);
    const generateSnapshot = vi.spyOn(runtime.components.snapshotGenerator, 'generateSnapshot').mockResolvedValue([]);
    const resolver = (runtime.components.slicingValidator as unknown as {
      typeProfileResolver: (url: string, fhirVersion?: 'R4' | 'R5' | 'R6') => Promise<unknown>;
    }).typeProfileResolver;

    await resolver(extensionUrl, 'R6');

    expect(loadProfile).toHaveBeenCalledWith(extensionUrl, 'R6');
    expect(generateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ url: extensionUrl }), { fhirVersion: 'R6' });
  });
});
