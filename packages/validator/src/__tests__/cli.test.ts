import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const tsxBin = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const cliEntry = join(repoRoot, 'packages/validator/src/cli.ts');
const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'records-validator-cli-'));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[], cwd = repoRoot): Promise<CliRun> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsxBin, cliEntry, ...args], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function writeJsonFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}

describe('records-fhir-validator CLI', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('prints documented production options in help output', async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('--output <file>');
    expect(result.stdout).toContain('--summary-only');
    expect(result.stdout).toContain('--include <glob>');
    expect(result.stdout).toContain('--exclude <glob>');
    expect(result.stdout).toContain('Exit codes:');
  });

  it('writes summary-only JSON output after applying include and exclude filters', async () => {
    const root = await createTempDir();
    await writeJsonFixture(root, 'fixtures/selected/patient.fhir.json', '{');
    await writeJsonFixture(root, 'fixtures/drafts/skipped.fhir.json', '{');
    await writeJsonFixture(root, 'fixtures/selected/ignored.txt', '{');

    const result = await runCli([
      'fixtures',
      '--include',
      '**/*.fhir.json',
      '--exclude',
      '**/drafts/**',
      '--format=json',
      '--summary-only',
      '--output',
      'reports/validation.json',
      '--fail-on=none',
    ], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');

    const report = JSON.parse(await readFile(join(root, 'reports/validation.json'), 'utf8'));
    expect(report).toEqual({
      summary: {
        files: 1,
        errors: 1,
        warnings: 0,
        issues: 0,
      },
    });
  });

  it('does not validate a previous output report when the report lives in the input folder', async () => {
    const root = await createTempDir();
    await writeJsonFixture(root, 'fixtures/patient.json', JSON.stringify({
      resourceType: 'Patient',
      id: 'example',
    }));
    await writeJsonFixture(
      root,
      'fixtures/validation-report.json',
      'Validated 1 file(s): 0 error(s), 0 warning(s), 0 issue(s).',
    );

    const result = await runCli([
      'fixtures',
      '--summary-only',
      '--output',
      'fixtures/validation-report.json',
      '--fail-on=none',
    ], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    const report = await readFile(join(root, 'fixtures/validation-report.json'), 'utf8');
    expect(report).toContain('Validated 1 file(s):');
  });

  it('exits with code 2 when include and exclude filters leave no JSON files', async () => {
    const root = await createTempDir();
    await writeJsonFixture(root, 'fixtures/drafts/skipped.json', '{}');

    const result = await runCli([
      'fixtures',
      '--include',
      '**/*.json',
      '--exclude',
      '**/drafts/**',
    ], root);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No JSON files matched the include/exclude filters.');
  });

  it('exits with code 2 for invalid CLI options before validation starts', async () => {
    const result = await runCli(['--fail-on=critical', 'fixtures']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--fail-on must be one of: error, warning, none');
    expect(result.stderr).toContain('Usage:');
  });

  it('exits with code 2 when the output target cannot be written', async () => {
    const root = await createTempDir();
    await writeJsonFixture(root, 'fixtures/bad.json', '{');
    await mkdir(join(root, 'reports'), { recursive: true });

    const result = await runCli([
      'fixtures',
      '--format=json',
      '--output',
      'reports',
      '--fail-on=none',
    ], root);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Could not write output file:');
  });
});
