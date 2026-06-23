import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { globToRegExp, shouldIncludeFile, splitPatterns, walkJson } from '../cli-file-matching';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'records-cli-files-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(root: string, relativePath: string): Promise<string> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, '{}', 'utf8');
  return file;
}

describe('CLI file matching helpers', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('splits comma-separated include and exclude patterns', () => {
    expect(splitPatterns('**/*.json, fixtures/*.fhir.json, ,')).toEqual([
      '**/*.json',
      'fixtures/*.fhir.json',
    ]);
  });

  it('supports ** globs across zero or more directories', () => {
    const pattern = globToRegExp('fixtures/**/*.json');

    expect(pattern.test('fixtures/patient.json')).toBe(true);
    expect(pattern.test('fixtures/nested/patient.json')).toBe(true);
    expect(pattern.test('fixtures/nested/patient.xml')).toBe(false);
  });

  it('walks only JSON files from nested folders', async () => {
    const root = await createTempDir();
    const patient = await writeFixture(root, 'fixtures/patient.json');
    const observation = await writeFixture(root, 'fixtures/nested/observation.json');
    await writeFixture(root, 'fixtures/notes.txt');

    expect(Array.from(walkJson(join(root, 'fixtures'))).sort()).toEqual([
      observation,
      patient,
    ].sort());
  });

  it('applies include defaults and explicit excludes', async () => {
    const root = await createTempDir();
    const selected = await writeFixture(root, 'fixtures/patient.json');
    const draft = await writeFixture(root, 'fixtures/drafts/patient.json');

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      expect(shouldIncludeFile(selected, { include: [], exclude: ['**/drafts/**'] })).toBe(true);
      expect(shouldIncludeFile(draft, { include: [], exclude: ['**/drafts/**'] })).toBe(false);
      expect(shouldIncludeFile(selected, { include: ['**/*.fhir.json'], exclude: [] })).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
