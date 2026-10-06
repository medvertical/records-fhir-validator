import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { registeredHl7Sids, validateHl7IdentifierSystem, validateHl7SidUri } from '../hl7-sid-registry';

describe('HL7 identifier system registry', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function store(packages: Record<string, Array<Record<string, unknown>>>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'sid-registry-'));
    roots.push(root);
    for (const [name, resources] of Object.entries(packages)) {
      const packageDir = path.join(root, name, 'package');
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name }));
      const files = resources.map((resource, index) => ({
        filename: `${resource.resourceType}-${index}.json`,
        resourceType: resource.resourceType,
        ...(resource.url ? { url: resource.url } : {}),
      }));
      await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({ files }));
      await Promise.all(resources.map((resource, index) =>
        writeFile(path.join(packageDir, files[index].filename), JSON.stringify(resource))));
    }
    return root;
  }

  const namingSystem = (...values: string[]) => ({
    resourceType: 'NamingSystem',
    uniqueId: values.map(value => ({ type: 'uri', value })),
  });

  it('reports an HL7 identifier system that no registrar defines', async () => {
    const root = await store({
      'hl7.terminology.r4#6.5.0': [
        namingSystem('http://hl7.org/fhir/sid/eui-48/bluetooth', 'urn:oid:1.2.3'),
        namingSystem('http://hl7.org/fhir/sid/us-npi'),
      ],
      'hl7.fhir.r4.core#4.0.1': [{ resourceType: 'CodeSystem', url: 'http://hl7.org/fhir/sid/ex-icd-10-procedures' }],
    });

    const check = (value: string) => validateHl7IdentifierSystem(value, 'Device.identifier[1].system', undefined, [root]);
    expect(await check('http://hl7.org/fhir/sid/eui-48')).toMatchObject({
      code: 'structural-url-unresolved',
      severity: 'error',
      message: "No definition could be found for URL value 'http://hl7.org/fhir/sid/eui-48'",
    });
    expect(await check('http://hl7.org/fhir/sid/eui-48/bluetooth')).toBeNull();
    expect(await check('http://hl7.org/fhir/sid/us-npi')).toBeNull();
    expect(await check('http://hl7.org/fhir/sid/ex-icd-10-procedures')).toBeNull();
    expect(await check('http://example.test/sid/eui-48')).toBeNull();
  });

  // Core ConceptMap/103 maps to 'sid/icd-10-us', which HL7 never registered.
  it('holds any other uri naming an HL7 identifier system to the registry', async () => {
    const root = await store({ 'hl7.terminology.r4#6.5.0': [namingSystem('http://hl7.org/fhir/sid/icd-10-cm')] });
    const check = (value: string, type: string, at: string) => validateHl7SidUri(value, type, at, undefined, [root]);

    expect(await check('http://hl7.org/fhir/sid/icd-10-us', 'uri', 'ConceptMap.group[0].target')).toMatchObject({
      code: 'structural-url-unresolved',
      path: 'ConceptMap.group[0].target',
    });
    expect(await check('http://hl7.org/fhir/sid/icd-10-cm', 'uri', 'ConceptMap.group[0].target')).toBeNull();
    expect(await check('http://hl7.org/fhir/sid/icd-10-us', 'uri', 'Condition.code.coding[0].system')).toBeNull();
    expect(await check('http://hl7.org/fhir/sid/icd-10-us', 'string', 'Condition.note[0].text')).toBeNull();
  });

  it('reads only the newest release of each registrar', async () => {
    const root = await store({
      'hl7.terminology.r4#6.5.0': [namingSystem('http://hl7.org/fhir/sid/old-only')],
      'hl7.terminology.r4#7.2.0': [namingSystem('http://hl7.org/fhir/sid/us-npi')],
    });

    expect([...await registeredHl7Sids([root]) ?? []]).toEqual(['http://hl7.org/fhir/sid/us-npi']);
  });

  // Without HL7 Terminology nothing is known about which systems exist.
  it('says nothing when no registrar is installed', async () => {
    const root = await store({ 'some.ig#1.0.0': [namingSystem('http://hl7.org/fhir/sid/us-npi')] });

    expect(await registeredHl7Sids([root])).toBeNull();
    expect(await validateHl7IdentifierSystem('http://hl7.org/fhir/sid/eui-48', 'Device.identifier[0].system', undefined, [root]))
      .toBeNull();
  });
});
