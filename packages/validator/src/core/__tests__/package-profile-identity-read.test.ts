import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPackageProfileIdentityCache, readProfileFileIdentityResult } from '../sd-loader-package-profile-reader';
import { StructureDefinitionLoader } from '../structure-definition-loader';

const roots: string[] = [];
const canonical = 'https://identity.test/StructureDefinition/Patient';
const definition = (url = canonical, min = 0) => ({ resourceType: 'StructureDefinition', url,
  version: '1.0.0', fhirVersion: '4.0.1', snapshot: { element: [{ path: 'Patient.active', min }] } });
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'records-profile-identity-')));
  roots.push(root);
  const file = join(root, 'Profile.json');
  const raw = JSON.stringify(definition());
  await fs.writeFile(file, raw);
  return { root, file, raw, read: () => readProfileFileIdentityResult(root, 'Profile.json') };
}
afterEach(async () => {
  vi.restoreAllMocks(); clearPackageProfileIdentityCache();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('content-addressed profile identity projection', () => {
  it('reuses parsing only, returning detached metadata after each fresh physical read', async () => {
    const f = await fixture(); const parse = vi.spyOn(JSON, 'parse'); const open = vi.spyOn(fs, 'open');
    const first = await f.read();
    expect(first).toEqual({ status: 'read', sha256: createHash('sha256').update(f.raw).digest('hex'),
      profile: { resourceType: 'StructureDefinition', url: canonical, version: '1.0.0', fhirVersion: '4.0.1' } });
    if (first.status === 'read') first.profile.url = 'mutated-by-caller';
    expect(await f.read()).toMatchObject({ status: 'read', profile: { url: canonical } });
    expect(parse.mock.calls.filter(([raw]) => raw === f.raw)).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
    await fs.rm(f.file);
    expect(await f.read()).toMatchObject({ status: 'unavailable' });
  });

  it('hashes changed body bytes even when URL and business version stay equal', async () => {
    const f = await fixture(); const before = await f.read();
    await fs.writeFile(f.file, JSON.stringify(definition(canonical, 1)));
    const after = await f.read();
    expect(after).toMatchObject({ status: 'read', profile: { url: canonical, version: '1.0.0' } });
    if (before.status !== 'read' || after.status !== 'read') throw new Error('Expected readable identities');
    expect(after.sha256).not.toBe(before.sha256);
    await fs.writeFile(f.file, '{broken');
    expect(await f.read()).toEqual({ status: 'unavailable', cause: 'resource-unreadable' });
    await fs.writeFile(f.file, JSON.stringify({ ...definition(), version: 7 }));
    expect(await f.read()).toEqual({ status: 'unavailable', cause: 'identity-mismatch' });
  });

  it('never interprets a cached non-profile as evidence about new file content', async () => {
    const f = await fixture(); const raw = JSON.stringify({ resourceType: 'CodeSystem', concept: [{ code: 'synthetic' }] });
    await fs.writeFile(f.file, raw); const parse = vi.spyOn(JSON, 'parse');
    expect(await f.read()).toEqual({ status: 'not-profile' });
    expect(await f.read()).toEqual({ status: 'not-profile' });
    expect(parse.mock.calls.filter(([body]) => body === raw)).toHaveLength(1);
    await fs.writeFile(f.file, f.raw);
    expect(await f.read()).toMatchObject({ status: 'read', profile: { url: canonical } });
  });

  it('keeps warm metadata subordinate to physical ownership and mid-read checks', async () => {
    const f = await fixture(); await f.read();
    const stat = fs.stat; let changed = false;
    vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
      const result = await stat(...args);
      if (!changed && String(args[0]) === f.file) {
        changed = true;
        await fs.writeFile(f.file, JSON.stringify(definition(canonical, 1)));
      }
      return result;
    });
    expect(await f.read()).toEqual({ status: 'unavailable', cause: 'source-changed' });
    expect(changed).toBe(true); vi.restoreAllMocks();
    await fs.writeFile(f.file, f.raw); await f.read();
    const foreign = await fs.mkdtemp(join(tmpdir(), 'records-foreign-profile-')); roots.push(foreign);
    await fs.writeFile(join(foreign, 'Profile.json'), f.raw);
    await fs.rm(f.file); await fs.symlink(join(foreign, 'Profile.json'), f.file);
    expect(await f.read()).toEqual({ status: 'unavailable', cause: 'unsafe-file' });
  });

  it('clears retained syntax projections through the loader profile-cache lifecycle', async () => {
    const f = await fixture();
    const loader = new StructureDefinitionLoader(f.root, f.root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization(); await f.read(); const parse = vi.spyOn(JSON, 'parse');
    await f.read(); expect(parse.mock.calls.filter(([raw]) => raw === f.raw)).toHaveLength(0);
    loader.clearCache(); await f.read();
    expect(parse.mock.calls.filter(([raw]) => raw === f.raw)).toHaveLength(1);
  });

  it('does not retain oversized canonical metadata', async () => {
    const f = await fixture(); const raw = JSON.stringify(definition(`${canonical}/${'x'.repeat(3_000)}`));
    await fs.writeFile(f.file, raw); const parse = vi.spyOn(JSON, 'parse');
    expect((await f.read()).status).toBe('read'); expect((await f.read()).status).toBe('read');
    expect(parse.mock.calls.filter(([body]) => body === raw)).toHaveLength(2);
  });
});
