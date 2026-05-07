import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { StructureDefinition } from '../structure-definition-types';
import { checkDatabaseCache } from '../sd-loader-db-cache';
import { setProfileSource } from '../../persistence';

const CORE_URL = 'http://hl7.org/fhir/StructureDefinition/MedicationRequest';

function makeSd(id: string, fhirVersion: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id,
    url: CORE_URL,
    name: id,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'MedicationRequest',
    fhirVersion,
    snapshot: {
      element: [{ id: 'MedicationRequest', path: 'MedicationRequest' }],
    },
  } as unknown as StructureDefinition;
}

async function makeLoader(): Promise<{ loader: StructureDefinitionLoader; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'records-sd-loader-'));
  const loader = new StructureDefinitionLoader(dir, null, { autoDownload: false });
  await loader.waitForInitialization();
  return { loader, dir };
}

beforeEach(() => {
  setProfileSource({});
});

afterEach(() => {
  setProfileSource({});
});

describe('StructureDefinitionLoader versioned cache', () => {
  it('does not return bare or R5 cached profiles for R4 batch loading', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const r4 = makeSd('medicationrequest-r4', '4.0.1');
      const r5 = makeSd('medicationrequest-r5', '5.0.0');

      (loader as any).cache.set(CORE_URL, r5);
      (loader as any).cache.set(`${CORE_URL}:R5`, r5);

      const r4Result = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect((r4Result.get(CORE_URL) as any)?.fhirVersion).toMatch(/^4\./);

      (loader as any).cache.set(`${CORE_URL}:R4`, r4);
      const r4Hit = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect(r4Hit.get(CORE_URL)?.id).toBe('medicationrequest-r4');

      const r5Hit = await loader.loadProfilesBatch([CORE_URL], 'R5');
      expect(r5Hit.get(CORE_URL)?.id).toBe('medicationrequest-r5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stores ProfileSource warmup entries under their FHIR version family', async () => {
    const r5 = makeSd('medicationrequest-r5', '5.0.0');
    setProfileSource({
      async loadAllForWarmup() {
        return new Map([
          [CORE_URL, { canonicalUrl: CORE_URL, profile: r5 }],
        ]);
      },
    });

    const { loader, dir } = await makeLoader();
    try {
      const r4Result = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect((r4Result.get(CORE_URL) as any)?.fhirVersion).toMatch(/^4\./);

      const r5Hit = await loader.loadProfilesBatch([CORE_URL], 'R5');
      expect(r5Hit.get(CORE_URL)?.id).toBe('medicationrequest-r5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('checkDatabaseCache', () => {
  it('rejects ProfileSource entries from the wrong FHIR version', async () => {
    const r5 = makeSd('medicationrequest-r5', '5.0.0');
    setProfileSource({
      async findByUrl() {
        return r5;
      },
    });

    await expect(checkDatabaseCache(CORE_URL, new Set(), 'R4')).resolves.toBeNull();
    await expect(checkDatabaseCache(CORE_URL, new Set(), 'R5')).resolves.toBe(r5);
  });
});
