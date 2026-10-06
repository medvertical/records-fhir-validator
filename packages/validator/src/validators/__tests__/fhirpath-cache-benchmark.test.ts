import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordsValidator } from '../../core/validator-engine';
import { writeMinimalR4CorePackage } from '../../core/__tests__/golden-quality-contracts';
import { issueFingerprint } from '../../issues/issue-contract';

// Cache deltas prove expression execution independently of resource identities.
const controls = Array.from({ length: 24 }, (_, index) => ({
  resourceType: 'Observation', id: `synthetic-cache-${index}`, status: 'final',
  valueQuantity: { value: index + 1 },
}));

describe('Portable FHIRPath expression cache contract', () => {
  let validator: RecordsValidator;
  let packageCachePath: string;
  let coldResults: string[][];
  beforeAll(async () => {
    packageCachePath = await mkdtemp(join(tmpdir(), 'records-synthetic-cache-contract-'));
    await writeMinimalR4CorePackage(packageCachePath);
    validator = new RecordsValidator({
      packageCachePath, bundledProfilesPath: packageCachePath,
      enableCaching: false, strictMode: false, timeout: 30_000, autoDownload: false,
    });
    await validator.waitForInitialization();
  }, 120_000);
  afterAll(async () => { if (packageCachePath) await rm(packageCachePath, { recursive: true, force: true }); });

  async function validateControls(): Promise<string[][]> {
    const results: string[][] = [];
    for (const resource of controls) {
      const issues = await validator.validate(resource, 'http://hl7.org/fhir/StructureDefinition/Observation', 'R4');
      results.push(issues.map(issueFingerprint).sort());
    }
    return results;
  }
  it('uses independently generated controls', () => {
    expect(controls).toHaveLength(24);
    expect(new Set(controls.map(resource => resource.id)).size).toBe(24);
  });
  it('executes expressions and fills caches on the cold pass', async () => {
    validator.clearFHIRPathCaches();
    coldResults = await validateControls();
    const stats = validator.getFHIRPathCacheStats();
    expect(coldResults).toHaveLength(controls.length);
    expect(stats.combined.size).toBeGreaterThan(0);
    expect(stats.combined.misses).toBeGreaterThan(0);
  }, 120_000);
  it('keeps the same issues and exceeds 90 percent expression hits on the warm pass', async () => {
    const before = validator.getFHIRPathCacheStats();
    const warmResults = await validateControls();
    const after = validator.getFHIRPathCacheStats();
    const hits = after.combined.hits - before.combined.hits;
    const misses = after.combined.misses - before.combined.misses;
    expect(warmResults).toEqual(coldResults);
    expect(hits + misses).toBeGreaterThan(0);
    expect(hits / (hits + misses) * 100).toBeGreaterThan(90);
  }, 120_000);
  it('retains both configured cache bounds', () => {
    const stats = validator.getFHIRPathCacheStats();
    expect(stats.constraint.size).toBeLessThanOrEqual(500);
    expect(stats.sdExecutor.size).toBeLessThanOrEqual(1000);
  });
});
