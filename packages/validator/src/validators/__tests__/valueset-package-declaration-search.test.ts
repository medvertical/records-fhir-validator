import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  rankedDeclarationsForCanonical,
  readDeclaredResource,
} from '../valueset-package-declaration-search';
import { clearPackageCanonicalIndex } from '../valueset-package-search';

const CANONICAL = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

describe('resolving a canonical from what packages declare', () => {
  const roots: string[] = [];

  beforeEach(() => clearPackageCanonicalIndex());

  afterEach(async () => {
    clearPackageCanonicalIndex();
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function store(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'declaration-search-'));
    roots.push(root);
    return root;
  }

  async function packageHolding(
    root: string,
    name: string,
    resource: { filename: string; version?: string; url?: string; content?: string },
  ): Promise<void> {
    const packageDir = path.join(root, name, 'package');
    await mkdir(packageDir, { recursive: true });
    const url = resource.url ?? CANONICAL;
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      files: [{
        filename: resource.filename,
        resourceType: 'CodeSystem',
        url,
        ...(resource.version ? { version: resource.version } : {}),
      }],
    }));
    await writeFile(path.join(packageDir, resource.filename), JSON.stringify({
      resourceType: 'CodeSystem',
      url,
      ...(resource.version ? { version: resource.version } : {}),
      ...(resource.content ? { content: resource.content } : {}),
    }));
  }

  it('names the declaring file so only that one is opened', async () => {
    const root = await store();
    await packageHolding(root, 'hl7.terminology.r4#6.5.0', {
      filename: 'CodeSystem-v3-ActCode.json', version: '6.5.0',
    });
    await packageHolding(root, 'bystander#1.0.0', {
      filename: 'CodeSystem-other.json', url: 'http://example.test/other',
    });

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', CANONICAL, '4', undefined);
    expect(ranked!.map(entry => entry.declaration.filename)).toEqual(['CodeSystem-v3-ActCode.json']);
    expect(await readDeclaredResource(ranked!, CANONICAL)).toMatchObject({ version: '6.5.0' });
  });

  it('puts the requested version first', async () => {
    const root = await store();
    await packageHolding(root, 'terminology.old#1.0.0', { filename: 'CodeSystem-a.json', version: '5.0.0' });
    await packageHolding(root, 'terminology.new#1.0.0', { filename: 'CodeSystem-b.json', version: '5.1.0' });

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', CANONICAL, undefined, '5.1.0');
    expect(ranked![0].declaration.version).toBe('5.1.0');
    expect(await readDeclaredResource(ranked!, CANONICAL, '5.1.0')).toMatchObject({ version: '5.1.0' });
  });

  // A cross-major stand-in turns valid codes into errors; the index rules it
  // out before the file is opened rather than after.
  it('drops a version the request cannot accept', async () => {
    const root = await store();
    await packageHolding(root, 'terminology.r5#1.0.0', { filename: 'CodeSystem-a.json', version: '6.0.0' });

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', CANONICAL, undefined, '5.0.0');
    expect(ranked).toEqual([]);
  });

  it('reports no answer when a store has no index to read', async () => {
    const absent = path.join(tmpdir(), 'declaration-search-absent');
    expect(await rankedDeclarationsForCanonical([absent], 'CodeSystem', CANONICAL, undefined, undefined)).toBeNull();
  });

  it('passes over a content stub for a newer copy that carries the content', async () => {
    const cdcrec = 'urn:oid:2.16.840.1.113883.6.238';
    const root = await store();
    await packageHolding(root, 'hl7.terminology.r4#6.5.0', {
      filename: 'CodeSystem-CDCREC.json', url: cdcrec, version: '3.0.2', content: 'not-present',
    });
    await packageHolding(root, 'hl7.fhir.us.core#3.1.1', {
      filename: 'CodeSystem-cdcrec.json', url: cdcrec, version: '3.1.1', content: 'complete',
    });
    await packageHolding(root, 'old.copy#1.0.0', {
      filename: 'CodeSystem-cdcrec.json', url: cdcrec, version: '1.2', content: 'complete',
    });

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', cdcrec, '4', undefined);
    expect(ranked![0].declaration.packageName).toBe('hl7.terminology.r4#6.5.0');
    expect(await readDeclaredResource(ranked!, cdcrec)).toMatchObject({ version: '3.1.1', content: 'complete' });
  });

  it('keeps a stub from the canonical authority over an older complete copy elsewhere', async () => {
    const v2 = 'http://terminology.hl7.org/CodeSystem/v2-0350';
    const root = await store();
    await packageHolding(root, 'hl7.terminology.r4#6.5.0', {
      filename: 'CodeSystem-v2-0350.json', url: v2, version: '2.2.0', content: 'not-present',
    });
    await packageHolding(root, 'hl7.fhir.r4.core#4.0.1', {
      filename: 'CodeSystem-v2-0350.json', url: v2, version: '2.9', content: 'complete',
    });

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', v2, '4', undefined);
    expect(await readDeclaredResource(ranked!, v2)).toMatchObject({ content: 'not-present' });
  });

  it('skips a declaration whose file no longer parses', async () => {
    const root = await store();
    await packageHolding(root, 'broken#1.0.0', { filename: 'CodeSystem-a.json' });
    await packageHolding(root, 'intact#1.0.0', { filename: 'CodeSystem-b.json', version: '2.0.0' });
    await writeFile(path.join(root, 'broken#1.0.0', 'package', 'CodeSystem-a.json'), '{ not json');

    const ranked = await rankedDeclarationsForCanonical([root], 'CodeSystem', CANONICAL, undefined, undefined);
    expect(await readDeclaredResource(ranked!, CANONICAL)).toMatchObject({ version: '2.0.0' });
  });
});
