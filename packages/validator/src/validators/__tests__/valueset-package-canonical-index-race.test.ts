import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackageCanonicalIndex } from '../valueset-package-canonical-index';
import * as indexStore from '../valueset-canonical-index-store';

const roots: string[] = [], system = 'http://ihe-d.de/CodeSystems/IHEXDStypeCode';
afterEach(async () => {
  vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
const barrier = () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); return { pending, release };
};
async function store(name: string, canonical: string) {
  const root = await fs.mkdtemp(join(tmpdir(), 'records-index-owner-')); roots.push(root);
  const folder = join(root, `${name}#1.0.0`, 'package'); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await fs.writeFile(join(folder, 'CodeSystem-path.json'), JSON.stringify({ resourceType: 'CodeSystem', url: canonical,
    version: '1.0.0', status: 'active', content: 'complete', concept: [{ code: 'PATH' }] }));
  await fs.writeFile(join(folder, '.index.json'), JSON.stringify({ files: [{ resourceType: 'CodeSystem', url: canonical,
    version: '1.0.0', filename: 'CodeSystem-path.json' }] }));
  return root;
}

describe('terminology index build ownership', () => {
  it.each(['packages', 'declarations'] as const)('%s does not publish a warm foreign index under a pending new signature', async api => {
    const a = await store('a', 'https://example.test/other'), b = await store('b', system);
    const index = new PackageCanonicalIndex(), entered = barrier(), gate = barrier(), secondSignature = barrier();
    const stat = fs.stat; let completed = 0;
    vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
      const result = await stat(...args);
      if (String(args[0]) === join(b, 'b#1.0.0') && ++completed === 2) secondSignature.release();
      return result;
    });
    const fingerprint = indexStore.canonicalIndexFingerprint;
    vi.spyOn(indexStore, 'canonicalIndexFingerprint').mockImplementation(async roots => {
      if (roots[0] === b) { entered.release(); await gate.pending; }
      return fingerprint(roots);
    });
    const read = (root: string) => api === 'packages'
      ? index.packagesFor([root], 'CodeSystem', system).then(result => result && [...result])
      : index.declarationsFor([root], 'CodeSystem', system).then(result => result?.map(item => item.packageName));
    expect(await read(a)).toEqual([]);
    const first = read(b); await entered.pending;
    const second = read(b);
    await secondSignature.pending;
    await new Promise<void>(resolve => setImmediate(resolve));
    gate.release();
    expect(await first).toEqual(['b#1.0.0']);
    expect(await second).toEqual(['b#1.0.0']);
  });

  it('orders an alias clear after an already submitted rename to the same physical index', async () => {
    const root = await store('a', system), index = new PackageCanonicalIndex();
    const aliasParent = await fs.mkdtemp(join(tmpdir(), 'records-index-alias-')); roots.push(aliasParent);
    const alias = join(aliasParent, 'mirror'); await fs.symlink(root, alias, 'dir');
    const entered = barrier(), gate = barrier(), rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination) === join(root, '.terminology-canonical-index.json')) { entered.release(); await gate.pending; }
      return rename(source, destination);
    });
    const old = index.packagesFor([root], 'CodeSystem', system); await entered.pending;
    const cleared = index.clearPersisted([alias]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const state = await Promise.race([cleared.then(() => 'early'), new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('pending'), 50);
      })]);
      gate.release(); await Promise.all([old, cleared]);
      expect(state).toBe('pending');
      await expect(fs.access(join(root, '.terminology-canonical-index.json'))).rejects.toThrow();
    } finally { if (timer) clearTimeout(timer); gate.release(); }
  });

  it('keeps clear authoritative when an earlier build finishes after a new same-signature generation', async () => {
    const root = await store('a', system), index = new PackageCanonicalIndex();
    const entered = barrier(), gate = barrier(), write = indexStore.writeCanonicalIndex;
    let calls = 0;
    vi.spyOn(indexStore, 'writeCanonicalIndex').mockImplementation(async (...args) => {
      if (++calls === 1) { entered.release(); await gate.pending; }
      return write(...args);
    });
    const old = index.packagesFor([root], 'CodeSystem', system); await entered.pending;
    index.clear();
    const folder = join(root, 'a#1.0.0', 'package');
    const other = 'https://example.test/other';
    await fs.writeFile(join(folder, 'CodeSystem-path.json'), JSON.stringify({ resourceType: 'CodeSystem', url: other,
      version: '1.0.0', content: 'complete', concept: [{ code: 'PATH' }] }));
    await fs.writeFile(join(folder, '.index.json'), JSON.stringify({ files: [{ resourceType: 'CodeSystem', url: other,
      version: '1.0.0', filename: 'CodeSystem-path.json' }] }));
    expect([...(await index.packagesFor([root], 'CodeSystem', system))!]).toEqual([]);
    gate.release(); expect([...(await old)!]).toEqual(['a#1.0.0']);
    expect([...(await index.packagesFor([root], 'CodeSystem', system))!]).toEqual([]);
    expect([...(await new PackageCanonicalIndex().packagesFor([root], 'CodeSystem', system))!]).toEqual([]);
  });
});
