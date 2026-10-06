import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateValueSetIncludeSystemOids } from '../valueset-include-oid-rule';

const NULL_FLAVOR_OID = 'urn:oid:2.16.840.1.113883.5.1008';
const CDCREC = 'urn:oid:2.16.840.1.113883.6.238';

describe('ValueSet include systems named by OID', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function store(packages: Record<string, Array<Record<string, unknown>>>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'oid-include-'));
    roots.push(root);
    for (const [name, codeSystems] of Object.entries(packages)) {
      const packageDir = path.join(root, name, 'package');
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name }));
      const files = codeSystems.map((_, index) => ({ filename: `CodeSystem-${index}.json`, resourceType: 'CodeSystem' }));
      await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({ files }));
      await Promise.all(codeSystems.map((codeSystem, index) =>
        writeFile(path.join(packageDir, files[index].filename), JSON.stringify({ resourceType: 'CodeSystem', ...codeSystem }))));
    }
    return root;
  }

  const valueSet = (...systems: string[]) => ({
    resourceType: 'ValueSet',
    compose: { include: systems.map(system => ({ system })), exclude: [{ system: NULL_FLAVOR_OID }] },
  });

  it('asks for the canonical URL of a code system HL7 registered under that OID', async () => {
    const root = await store({
      'hl7.terminology.r4#7.2.0': [
        { url: 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor', identifier: [{ value: NULL_FLAVOR_OID }] },
        { url: CDCREC, identifier: [{ value: CDCREC }] },
      ],
    });

    const issues = await validateValueSetIncludeSystemOids(
      valueSet('http://loinc.org', NULL_FLAVOR_OID, CDCREC, 'urn:oid:1.2.3'),
      [root],
    );

    expect(issues.map(issue => [issue.path, issue.severity])).toEqual([
      ['ValueSet.compose.include[1]', 'error'],
      ['ValueSet.compose.exclude[0]', 'error'],
    ]);
    expect(issues[0].message).toBe(
      `It is not valid to refer to a CodeSystem by an identifier like this '${NULL_FLAVOR_OID}'`
      + " - use 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor'",
    );
  });

  it('lists every canonical when one OID names several code systems', async () => {
    const root = await store({
      'hl7.terminology.r4#7.2.0': [{ url: 'http://example.test/a', identifier: [{ value: NULL_FLAVOR_OID }] }],
      'hl7.fhir.r4.core#4.0.1': [{ url: 'http://example.test/b', identifier: [{ value: NULL_FLAVOR_OID }] }],
    });

    const [issue] = await validateValueSetIncludeSystemOids(valueSet(), [root]);

    expect(issue.message).toContain('matches to multiple CodeSystem resources (http://example.test/a,http://example.test/b)');
  });

  it('says nothing without HL7 Terminology or core to know the OIDs from', async () => {
    const root = await store({ 'some.ig#1.0.0': [{ url: 'http://example.test/a', identifier: [{ value: NULL_FLAVOR_OID }] }] });

    expect(await validateValueSetIncludeSystemOids(valueSet(NULL_FLAVOR_OID), [root])).toEqual([]);
  });
});
