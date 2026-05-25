import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subsumesFunction } from '../fhirpath-custom-functions';
import {
  clearSubsumesCache,
} from '../terminology-api-client';

const SNOMED = 'http://snomed.info/sct';

describe('FHIRPath subsumes cache integration', () => {
  beforeEach(() => {
    clearSubsumesCache();
    vi.resetModules();
    vi.doUnmock('axios');
  });

  it('returns undetermined when no $subsumes result has been warmed', () => {
    const result = subsumesFunction.fn(
      [{ system: SNOMED, code: '404684003' }],
      [{ system: SNOMED, code: '22298006' }],
    );

    expect(result).toEqual([]);
  });

  it('uses cached $subsumes outcomes warmed by the terminology client', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'outcome', valueCode: 'subsumes' }],
      },
    });

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient, clearSubsumesCache: clear, getSubsumesCacheSize: size } =
      await import('../terminology-api-client');
    const { subsumesFunction: warmedSubsumesFunction } =
      await import('../fhirpath-custom-functions');

    clear();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example/fhir',
      strategy: 'server-first',
    });

    await expect(client.subsumes(SNOMED, '404684003', '22298006')).resolves.toBe('subsumes');
    expect(size()).toBe(1);

    const result = warmedSubsumesFunction.fn(
      [{ system: SNOMED, code: '404684003' }],
      [{ system: SNOMED, code: '22298006' }],
    );

    expect(result).toEqual([true]);
  });

  it('exposes non-subsumed outcomes without failing open', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'outcome', valueCode: 'not-subsumed' }],
      },
    });

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient, clearSubsumesCache: clear, getCachedSubsumesOutcome, getSubsumesCacheSize } =
      await import('../terminology-api-client');
    const { subsumesFunction: warmedSubsumesFunction } =
      await import('../fhirpath-custom-functions');

    clear();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example/fhir',
      strategy: 'server-first',
    });

    await client.subsumes(SNOMED, '404684003', '22298006');

    expect(getCachedSubsumesOutcome(SNOMED, '404684003', '22298006')).toBe('not-subsumed');
    expect(warmedSubsumesFunction.fn(
      [{ system: SNOMED, code: '404684003' }],
      [{ system: SNOMED, code: '22298006' }],
    )).toEqual([false]);
    expect(getSubsumesCacheSize()).toBe(1);
  });
});
