import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCapabilityStatementSearchParams } from '../capability-statement-rules';

// Core example CapabilityStatement/measure-processor declares Measure's
// version search parameter as a string; the core definition makes it a token.
const statement = (searchParam: Array<Record<string, unknown>>) => ({
  resourceType: 'CapabilityStatement',
  rest: [{ mode: 'server', resource: [{ type: 'Measure', searchParam }] }],
});
const MEASURE_VERSION = 'http://hl7.org/fhir/SearchParameter/Measure-version';
const definitions: Record<string, Record<string, unknown>> = {
  [MEASURE_VERSION]: { resourceType: 'SearchParameter', url: MEASURE_VERSION, version: '4.0.1', type: 'token' },
};

describe('CapabilityStatement search parameters', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('holds a search parameter to the type of the SearchParameter it names', async () => {
    const lookup = vi.fn(async (canonical: string) => definitions[canonical] ?? null);

    const issues = await validateCapabilityStatementSearchParams(statement([
      { name: 'title', definition: 'http://hl7.org/fhir/SearchParameter/Measure-title', type: 'string' },
      { name: 'version', definition: MEASURE_VERSION, type: 'string' },
      { name: 'version-again', definition: MEASURE_VERSION, type: 'token' },
      { name: 'no-definition', type: 'string' },
    ]), 'R4', lookup);

    expect(issues).toEqual([expect.objectContaining({
      severity: 'error',
      code: 'capabilitystatement-searchparam-type-mismatch',
      path: 'CapabilityStatement.rest[0].resource[0].searchParam[1]',
      message: `Type mismatch - SearchParameter '${MEASURE_VERSION}|4.0.1' type is token, but type here is string`,
    })]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('reads definitions from the local packages by the file their id names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capability-statement-'));
    roots.push(root);
    const packageDir = join(root, 'hl7.fhir.r4.core#4.0.1', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1' }));
    await writeFile(join(packageDir, 'SearchParameter-Measure-version.json'), JSON.stringify(definitions[MEASURE_VERSION]));
    vi.stubEnv('FHIR_PACKAGE_CACHE_PATH', root);

    const issues = await validateCapabilityStatementSearchParams(
      statement([{ name: 'version', definition: MEASURE_VERSION, type: 'string' }]),
      'R4',
    );

    expect(issues.map(issue => issue.code)).toEqual(['capabilitystatement-searchparam-type-mismatch']);
  });
});
