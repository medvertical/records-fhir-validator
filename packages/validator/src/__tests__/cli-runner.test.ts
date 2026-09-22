import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findInputFiles, runValidation } from '../cli-runner';
import type { CliOptions } from '../cli-types';

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

  it.each([
    { declared: undefined, requested: undefined, reported: 'http://hl7.org/fhir/StructureDefinition/heartrate' },
    { declared: 'https://example.org/declared', requested: undefined, reported: 'https://example.org/declared' },
    { declared: 'https://example.org/declared', requested: 'https://example.org/explicit', reported: 'https://example.org/explicit' },
  ])('lets the engine select a profile unless the caller explicitly requests $requested', async ({ declared, requested, reported }) => {
    const root = await createTempDir();
    const resource = { resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
      ...(declared ? { meta: { profile: [declared] } } : {}) };
    const file = await writeFixture(root, 'observation.json', JSON.stringify(resource));
    const validateRequest = vi.fn(async () => []);
    const result = await runValidation([file], {
      paths: [root], fhirVersion: 'R4', failOn: 'none', format: 'json',
      summaryOnly: false, include: [], exclude: [], profileUrl: requested,
    }, validateRequest);

    expect(validateRequest).toHaveBeenCalledWith({ resource, fhirVersion: 'R4',
      ...(requested ? { profileUrl: requested } : {}) });
    expect(result.results[0].profileUrl).toBe(reported);
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

  it('discovers XML and NDJSON inputs with the default filter', async () => {
    const root = await createTempDir();
    await writeFixture(root, 'patient.xml', '<Patient xmlns="http://hl7.org/fhir"/>');
    await writeFixture(root, 'bulk.ndjson', '{"resourceType":"Observation"}');
    await writeFixture(root, 'notes.txt', 'not FHIR');

    expect(findInputFiles({
      paths: [root],
      include: [],
      exclude: [],
    }).map(file => file.slice(root.length + 1))).toEqual([
      'bulk.ndjson',
      'patient.xml',
    ]);
  });

  it('normalizes XML and every NDJSON record before validation', async () => {
    const root = await createTempDir();
    const patientXml = await writeFixture(
      root,
      'patient.xml',
      '<Patient xmlns="http://hl7.org/fhir"><id value="xml-1"/></Patient>',
    );
    const bulk = await writeFixture(root, 'bulk.ndjson', [
      '{"resourceType":"Patient","id":"ndjson-1"}',
      '{"resourceType":"Observation","id":"ndjson-2","status":"final","code":{"text":"demo"}}',
    ].join('\n'));
    const validateRequest = vi.fn(async () => []);
    const options: CliOptions = {
      paths: [root],
      fhirVersion: 'R4',
      failOn: 'none',
      format: 'json',
      summaryOnly: true,
      include: [],
      exclude: [],
    };

    const result = await runValidation([patientXml, bulk], options, validateRequest);

    expect(validateRequest).toHaveBeenCalledTimes(3);
    expect(validateRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      resource: { resourceType: 'Patient', id: 'xml-1' },
    }));
    expect(validateRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      resource: { resourceType: 'Patient', id: 'ndjson-1' },
    }));
    expect(validateRequest).toHaveBeenNthCalledWith(3, expect.objectContaining({
      resource: expect.objectContaining({ resourceType: 'Observation', id: 'ndjson-2' }),
    }));
    expect(result.summary).toEqual({ files: 3, errors: 0, warnings: 0, issues: 0 });
  });
});
