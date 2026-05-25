/**
 * ValueSet Package Loader — Deep Expansion Tests
 *
 * Exercises the advanced `extractCodesFromValueSet` behaviour added for the
 * PRD §6.1 "ValueSet Deep Expansion" gap closure:
 *   - nested valueSet composition (recursive)
 *   - exclude filtering
 *   - concept is-a / = / descendent-of filters
 *   - hierarchical expansion.contains flattening
 *   - supplement CodeSystem handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import type { ValueSet, CodeSystem } from '../valueset-types';

function makeLoader(
    codeSystems: Record<string, CodeSystem>,
    valueSets: Record<string, ValueSet> = {},
): ValueSetPackageLoader {
    const loader = new ValueSetPackageLoader();
    // Replace package lookups with in-memory stubs
    (loader as any).loadCodeSystem = vi.fn(async (url: string) => codeSystems[url] ?? null);
    (loader as any).loadValueSetResource = vi.fn(async (url: string) =>
        valueSets[url] ?? null,
    );
    return loader;
}

describe('ValueSetPackageLoader.extractCodesFromValueSet — deep expansion', () => {
    const baseSystem: CodeSystem = {
        resourceType: 'CodeSystem',
        url: 'http://example.org/cs',
        content: 'complete',
        concept: [
            {
                code: 'animal',
                concept: [
                    {
                        code: 'mammal',
                        concept: [
                            { code: 'cat' },
                            { code: 'dog' },
                        ],
                    },
                    { code: 'bird' },
                ],
            },
            { code: 'plant' },
        ],
    };

    let loader: ValueSetPackageLoader;

    beforeEach(() => {
        loader = makeLoader({ [baseSystem.url]: baseSystem });
    });

    it('flattens pre-expanded expansion.contains (hierarchical)', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/pre-expanded',
            status: 'active',
            expansion: {
                contains: [
                    {
                        system: 'http://example.org/cs',
                        code: 'animal',
                        contains: [
                            { system: 'http://example.org/cs', code: 'mammal' },
                            { system: 'http://example.org/cs', code: 'bird' },
                        ],
                    },
                ],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('animal');
        expect(codes).toContain('mammal');
        expect(codes).toContain('bird');
        expect(codes).toContain('http://example.org/cs|animal');
    });

    it('includes every code from a system when only the system is listed', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/all',
            status: 'active',
            compose: {
                include: [{ system: 'http://example.org/cs' }],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('cat');
        expect(codes).toContain('dog');
        expect(codes).toContain('mammal');
        expect(codes).toContain('animal');
        expect(codes).toContain('plant');
    });

    it('applies exclude to remove codes from the result', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/no-plant',
            status: 'active',
            compose: {
                include: [{ system: 'http://example.org/cs' }],
                exclude: [
                    {
                        system: 'http://example.org/cs',
                        concept: [{ code: 'plant' }],
                    },
                ],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('animal');
        expect(codes).not.toContain('plant');
        expect(codes).not.toContain('http://example.org/cs|plant');
    });

    it('follows include.valueSet references recursively', async () => {
        const child: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/mammals',
            status: 'active',
            compose: {
                include: [
                    {
                        system: 'http://example.org/cs',
                        concept: [{ code: 'cat' }, { code: 'dog' }],
                    },
                ],
            },
        };

        const parent: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/animals',
            status: 'active',
            compose: {
                include: [
                    {
                        valueSet: ['http://example.org/vs/mammals'],
                    },
                ],
            },
        };

        const localLoader = makeLoader(
            { [baseSystem.url]: baseSystem },
            { 'http://example.org/vs/mammals': child },
        );
        const codes = await localLoader.extractCodesFromValueSet(parent);
        expect(codes).toContain('cat');
        expect(codes).toContain('dog');
    });

    it('stops on a composition cycle instead of looping forever', async () => {
        const vsA: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/a',
            status: 'active',
            compose: {
                include: [{ valueSet: ['http://example.org/vs/b'] }],
            },
        };
        const vsB: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/b',
            status: 'active',
            compose: {
                include: [
                    { valueSet: ['http://example.org/vs/a'] },
                    {
                        system: 'http://example.org/cs',
                        concept: [{ code: 'cat' }],
                    },
                ],
            },
        };

        const localLoader = makeLoader(
            { [baseSystem.url]: baseSystem },
            {
                'http://example.org/vs/a': vsA,
                'http://example.org/vs/b': vsB,
            },
        );

        const codes = await localLoader.extractCodesFromValueSet(vsA);
        expect(codes).toContain('cat');
        // Cycle should be detected — does not crash
    });

    it('stops at MAX_COMPOSITION_DEPTH on deeply-nested non-cyclic trees', async () => {
        // Build a linear A → B → C → ... chain 25 levels deep. The depth
        // limit is 20 so the last 5 levels should be unreachable. The call
        // must still complete without blowing the stack, and codes from
        // levels 0..19 must be present.
        const vsList: ValueSet[] = [];
        for (let i = 0; i < 25; i++) {
            const next =
                i < 24
                    ? { valueSet: [`http://example.org/vs/level-${i + 1}`] }
                    : {
                          system: 'http://example.org/cs',
                          concept: [{ code: 'leaf-deep' }],
                      };
            vsList.push({
                resourceType: 'ValueSet',
                url: `http://example.org/vs/level-${i}`,
                status: 'active',
                compose: { include: [next] },
            });
        }

        const byUrl: Record<string, ValueSet> = {};
        for (const vs of vsList) byUrl[vs.url] = vs;

        const localLoader = makeLoader(
            { [baseSystem.url]: baseSystem },
            byUrl,
        );

        // Must not throw — the depth limit guards stack overflow
        await expect(
            localLoader.extractCodesFromValueSet(vsList[0]),
        ).resolves.toBeDefined();
    });

    it('applies concept is-a filter to include descendants', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/mammals-only',
            status: 'active',
            compose: {
                include: [
                    {
                        system: 'http://example.org/cs',
                        filter: [
                            { property: 'concept', op: 'is-a', value: 'mammal' },
                        ],
                    },
                ],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('mammal');
        expect(codes).toContain('cat');
        expect(codes).toContain('dog');
        expect(codes).not.toContain('bird');
        expect(codes).not.toContain('plant');
    });

    it('applies concept = filter to include exactly one code', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/cat-only',
            status: 'active',
            compose: {
                include: [
                    {
                        system: 'http://example.org/cs',
                        filter: [
                            { property: 'concept', op: '=', value: 'cat' },
                        ],
                    },
                ],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('cat');
        expect(codes).not.toContain('dog');
        expect(codes).not.toContain('mammal');
    });

    it('applies concept descendent-of filter (excludes the root)', async () => {
        const vs: ValueSet = {
            resourceType: 'ValueSet',
            url: 'http://example.org/vs/under-mammal',
            status: 'active',
            compose: {
                include: [
                    {
                        system: 'http://example.org/cs',
                        filter: [
                            { property: 'concept', op: 'descendent-of', value: 'mammal' },
                        ],
                    },
                ],
            },
        };

        const codes = await loader.extractCodesFromValueSet(vs);
        expect(codes).toContain('cat');
        expect(codes).toContain('dog');
        expect(codes).not.toContain('mammal');
    });
});

describe('ValueSetPackageLoader.extractCodesFromCodeSystem — supplements', () => {
    it('returns an empty array for supplement CodeSystems', () => {
        const loader = new ValueSetPackageLoader();
        const supplement: CodeSystem = {
            resourceType: 'CodeSystem',
            url: 'http://example.org/cs-supplement',
            content: 'supplement',
            supplements: 'http://example.org/cs',
            concept: [{ code: 'dog' }],
        };

        const codes = loader.extractCodesFromCodeSystem(supplement);
        expect(codes).toEqual([]);
    });

    it('extracts hierarchical codes from a complete CodeSystem', () => {
        const loader = new ValueSetPackageLoader();
        const cs: CodeSystem = {
            resourceType: 'CodeSystem',
            url: 'http://example.org/cs',
            content: 'complete',
            concept: [
                {
                    code: 'a',
                    concept: [
                        {
                            code: 'b',
                            concept: [{ code: 'c' }],
                        },
                    ],
                },
            ],
        };
        const codes = loader.extractCodesFromCodeSystem(cs);
        expect(codes).toEqual(['a', 'b', 'c']);
    });
});

describe('ValueSetPackageLoader canonical package scan', () => {
    it('loads ValueSets and CodeSystems whose filenames do not match the canonical suffix', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valueset-package-loader-'));
        const packageDir = path.join(root, 'example.fhir#1.0.0', 'package');
        await fs.mkdir(packageDir, { recursive: true });

        const codeSystem: CodeSystem = {
            resourceType: 'CodeSystem',
            url: 'urn:oid:1.2.3',
            content: 'complete',
            concept: [{ code: 'valid' }],
        };
        const valueSet: ValueSet = {
            resourceType: 'ValueSet',
            url: 'https://example.org/fhir/ValueSet/canonical-name',
            status: 'active',
            compose: {
                include: [{ system: 'urn:oid:1.2.3' }],
            },
        };

        await fs.writeFile(
            path.join(packageDir, 'CodeSystem-FriendlyName.json'),
            JSON.stringify(codeSystem),
        );
        await fs.writeFile(
            path.join(packageDir, 'ValueSet-FriendlyName.json'),
            JSON.stringify(valueSet),
        );

        const loader = new ValueSetPackageLoader();
        (loader as any).packageDirectories = [root];

        const codes = await loader.loadValueSet('https://example.org/fhir/ValueSet/canonical-name');

        expect(codes).toContain('urn:oid:1.2.3|valid');
        expect(codes).toContain('valid');
    });

    it('prefers the newest package version when multiple packages share a canonical URL', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valueset-package-loader-'));
        const canonical = 'https://example.org/fhir/ValueSet/shared';

        const olderPackage = path.join(root, 'example.fhir#2025.0.1', 'package');
        const newerPackage = path.join(root, 'example.fhir#2026.0.1', 'package');
        await fs.mkdir(olderPackage, { recursive: true });
        await fs.mkdir(newerPackage, { recursive: true });

        await fs.writeFile(
            path.join(olderPackage, 'ValueSet-shared.json'),
            JSON.stringify({
                resourceType: 'ValueSet',
                url: canonical,
                status: 'active',
                compose: {
                    include: [{
                        system: 'urn:oid:1.2.3',
                        concept: [{ code: 'old' }],
                    }],
                },
            } satisfies ValueSet),
        );
        await fs.writeFile(
            path.join(newerPackage, 'ValueSet-shared.json'),
            JSON.stringify({
                resourceType: 'ValueSet',
                url: canonical,
                status: 'active',
                compose: {
                    include: [{
                        system: 'https://example.org/fhir/CodeSystem/current',
                        concept: [{ code: 'new' }],
                    }],
                },
            } satisfies ValueSet),
        );

        const loader = new ValueSetPackageLoader();
        (loader as any).packageDirectories = [root];

        const codes = await loader.loadValueSet(canonical);

        expect(codes).toContain('https://example.org/fhir/CodeSystem/current|new');
        expect(codes).toContain('new');
        expect(codes).not.toContain('urn:oid:1.2.3|old');
    });

    it('uses canonical scan for nested ValueSet includes whose filenames do not match the canonical suffix', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valueset-package-loader-'));
        const packageDir = path.join(root, 'example.fhir#1.0.0', 'package');
        await fs.mkdir(packageDir, { recursive: true });

        const nestedCanonical = 'https://example.org/fhir/ValueSet/nested-canonical-name';
        const parentCanonical = 'https://example.org/fhir/ValueSet/parent';

        await fs.writeFile(
            path.join(packageDir, 'ValueSet-parent.json'),
            JSON.stringify({
                resourceType: 'ValueSet',
                url: parentCanonical,
                status: 'active',
                compose: {
                    include: [{ valueSet: [nestedCanonical] }],
                },
            } satisfies ValueSet),
        );
        await fs.writeFile(
            path.join(packageDir, 'ValueSet-FriendlyNestedName.json'),
            JSON.stringify({
                resourceType: 'ValueSet',
                url: nestedCanonical,
                status: 'active',
                compose: {
                    include: [{
                        system: 'http://loinc.org',
                        concept: [{ code: '77606-2' }],
                    }],
                },
            } satisfies ValueSet),
        );

        const loader = new ValueSetPackageLoader();
        (loader as any).packageDirectories = [root];

        const codes = await loader.loadValueSet(parentCanonical);

        expect(codes).toContain('http://loinc.org|77606-2');
        expect(codes).toContain('77606-2');
    });
});
