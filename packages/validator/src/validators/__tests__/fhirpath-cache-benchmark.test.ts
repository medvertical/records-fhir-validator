/**
 * FHIRPath Expression Cache Benchmark
 *
 * Validates the profiled corpus (179 fixtures) and measures compiled
 * FHIRPath expression cache hit rates across both caches:
 *   - ConstraintValidator cache (max 500)
 *   - SDFHIRPathExecutor cache (max 1000)
 *
 * This is a performance characterisation test — it asserts minimum hit
 * rates so regressions are caught, but the primary value is the console
 * output showing actual hit/miss/size metrics.
 *
 * Usage: npx vitest run server/services/validation/engine/records-validator/validators/__tests__/fhirpath-cache-benchmark.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RecordsValidator } from '../../core/validator-engine';
import { getCombinedFHIRPathCacheStats, clearFHIRPathCache } from '../constraint-validator';
import { clearSDFHIRPathCache } from '../sd-fhirpath-executor';

// The corpus lives in the commercial Records monorepo, outside this OSS
// package. When the package is extracted on its own (e.g. inside the
// published tarball), the corpus is absent and this benchmark is skipped.
const CORPUS_DIR = join(__dirname, '../../../../../../..', 'quality-corpus/r4/profiled');
const HAS_CORPUS = existsSync(CORPUS_DIR);

interface CorpusFixture {
    name: string;
    resource: any;
    profileUrl: string;
}

function loadCorpus(): CorpusFixture[] {
    const files = readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
        const resource = JSON.parse(readFileSync(join(CORPUS_DIR, f), 'utf8'));
        const profileUrl = resource.meta?.profile?.[0]
            ?? `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
        return { name: f.replace('.json', ''), resource, profileUrl };
    });
}

describe.skipIf(!HAS_CORPUS)('FHIRPath Cache Benchmark', () => {
    let validator: RecordsValidator;
    let fixtures: CorpusFixture[];

    beforeAll(async () => {
        validator = new RecordsValidator({
            enableCaching: true,
            strictMode: false,
            timeout: 30000,
            autoDownload: false,
        });
        await validator.waitForInitialization();
        fixtures = loadCorpus();
    }, 120_000);

    it('should load profiled corpus', () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(170);
        console.log(`[Benchmark] Loaded ${fixtures.length} profiled corpus fixtures`);
    });

    it('should measure cache hit rates on first pass (cold start)', async () => {
        // Clear both caches for a clean baseline
        clearFHIRPathCache();
        clearSDFHIRPathCache();

        const start = performance.now();
        let validated = 0;

        for (const fixture of fixtures) {
            await validator.validate(fixture.resource, fixture.profileUrl, 'R4');
            validated++;
        }

        const elapsed = performance.now() - start;
        const stats = getCombinedFHIRPathCacheStats();

        console.log('\n=== FHIRPath Cache — First Pass (Cold) ===');
        console.log(`Fixtures validated: ${validated}`);
        console.log(`Time: ${(elapsed / 1000).toFixed(1)}s (${(elapsed / validated).toFixed(0)}ms avg)`);
        console.log(`Constraint cache: ${stats.constraint.hits} hits / ${stats.constraint.misses} misses (${stats.constraint.hitRate}) — ${stats.constraint.size} entries`);
        console.log(`SD Executor cache: ${stats.sdExecutor.hits} hits / ${stats.sdExecutor.misses} misses (${stats.sdExecutor.hitRate}) — ${stats.sdExecutor.size} entries`);
        console.log(`Combined: ${stats.combined.hits} hits / ${stats.combined.misses} misses (${stats.combined.hitRate}) — ${stats.combined.size} entries`);

        // Even on the first pass, many expressions repeat across resources
        // of the same type, so we expect a meaningful hit rate
        expect(validated).toBe(fixtures.length);
        expect(stats.combined.size).toBeGreaterThan(0);
    }, 300_000);

    it('should measure cache hit rates on second pass (warm)', async () => {
        // Do NOT clear caches — measure benefit of warm cache
        const statsBefore = getCombinedFHIRPathCacheStats();

        const start = performance.now();

        for (const fixture of fixtures) {
            await validator.validate(fixture.resource, fixture.profileUrl, 'R4');
        }

        const elapsed = performance.now() - start;
        const statsAfter = getCombinedFHIRPathCacheStats();

        // Compute delta (hits/misses added in this pass only)
        const deltaHits = statsAfter.combined.hits - statsBefore.combined.hits;
        const deltaMisses = statsAfter.combined.misses - statsBefore.combined.misses;
        const deltaTotal = deltaHits + deltaMisses;
        const deltaHitRate = deltaTotal > 0
            ? ((deltaHits / deltaTotal) * 100).toFixed(1) + '%'
            : '0%';

        console.log('\n=== FHIRPath Cache — Second Pass (Warm) ===');
        console.log(`Time: ${(elapsed / 1000).toFixed(1)}s (${(elapsed / fixtures.length).toFixed(0)}ms avg)`);
        console.log(`Delta hits: ${deltaHits}, delta misses: ${deltaMisses}, delta hit rate: ${deltaHitRate}`);
        console.log(`Constraint cache size: ${statsAfter.constraint.size}, SD Executor cache size: ${statsAfter.sdExecutor.size}`);
        console.log(`Cumulative combined: ${statsAfter.combined.hitRate}`);

        // On a warm pass, nearly all expressions should be cache hits
        // (only novel profiles or edge-case expressions would miss)
        const numericHitRate = deltaTotal > 0 ? (deltaHits / deltaTotal) * 100 : 100;
        expect(numericHitRate).toBeGreaterThan(90);
    }, 300_000);

    it('should measure per-resource-type breakdown', async () => {
        // Clear and run one more pass, grouping by resourceType
        clearFHIRPathCache();
        clearSDFHIRPathCache();

        const byType = new Map<string, { count: number; timeMs: number }>();

        for (const fixture of fixtures) {
            const rt = fixture.resource.resourceType;
            const start = performance.now();
            await validator.validate(fixture.resource, fixture.profileUrl, 'R4');
            const elapsed = performance.now() - start;

            const entry = byType.get(rt) ?? { count: 0, timeMs: 0 };
            entry.count++;
            entry.timeMs += elapsed;
            byType.set(rt, entry);
        }

        const stats = getCombinedFHIRPathCacheStats();

        console.log('\n=== Per-ResourceType Validation Timing ===');
        const sorted = [...byType.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [rt, data] of sorted) {
            console.log(`  ${rt}: ${data.count} fixtures, ${(data.timeMs / 1000).toFixed(1)}s total, ${(data.timeMs / data.count).toFixed(0)}ms avg`);
        }
        console.log(`\nFinal cache: ${stats.combined.size} expressions, ${stats.combined.hitRate} hit rate`);

        // Sanity: cache should not exceed configured max sizes
        expect(stats.constraint.size).toBeLessThanOrEqual(500);
        expect(stats.sdExecutor.size).toBeLessThanOrEqual(1000);
    }, 300_000);
});
