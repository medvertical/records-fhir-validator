import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findInputFiles } from '../cli-runner';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'records-cli-runner-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(root: string, relativePath: string, contents = '{}'): Promise<string> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
  return file;
}

describe('CLI runner input discovery', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('excludes the output report when it is inside a validated directory', async () => {
    const root = await createTempDir();
    await writeFixture(root, 'patient.json');
    await writeFixture(root, 'validation-report.json', 'Validated 1 file(s): 0 error(s), 0 warning(s), 0 issue(s).');

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const files = findInputFiles({
        paths: ['.'],
        include: [],
        exclude: [],
        output: 'validation-report.json',
      });

      expect(files).toHaveLength(1);
      expect(files[0].endsWith('/patient.json')).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('excludes an absolute output report path from recursive input discovery', async () => {
    const root = await createTempDir();
    await writeFixture(root, 'fixtures/patient.json');
    const report = await writeFixture(root, 'fixtures/report.json', '{}');

    const files = findInputFiles({
      paths: [join(root, 'fixtures')],
      include: [],
      exclude: [],
      output: report,
    });

    expect(files).toHaveLength(1);
    expect(files[0].endsWith('/fixtures/patient.json')).toBe(true);
  });
});
