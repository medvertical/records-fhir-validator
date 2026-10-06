import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateUnresolvedHl7Url } from '../hl7-url-resolution';

let store: string;

type Definition = { resourceType: string; url?: string; version?: string; body?: Record<string, unknown> };

async function writePackage(folder: string, canonical: string, definitions: Definition[], examples: Definition[] = []): Promise<void> {
  const packageRoot = path.join(store, folder, 'package');
  for (const [directory, entries] of [[packageRoot, definitions], [path.join(packageRoot, 'example'), examples]] as const) {
    await mkdir(directory, { recursive: true });
    const files = entries.map((definition, index) => ({ filename: `${definition.resourceType}-${index}.json`, ...definition }));
    for (const { filename, body, ...entry } of files) {
      await writeFile(path.join(directory, filename), JSON.stringify({ ...entry, ...body }));
    }
    await writeFile(path.join(directory, '.index.json'), JSON.stringify({ 'index-version': 2, files: files.map(({ body: _body, ...entry }) => entry) }));
  }
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: folder.split('#')[0], version: folder.split('#')[1], canonical }));
}

beforeAll(async () => {
  store = await mkdtemp(path.join(tmpdir(), 'hl7-url-resolution-'));
  await writePackage('hl7.fhir.r4.core#4.0.1', 'http://hl7.org/fhir', [
    { resourceType: 'CodeSystem', url: 'http://hl7.org/fhir/address-use', version: '4.0.1' },
    { resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/StructureDefinition/Patient', version: '4.0.1' },
  ]);
  await writePackage('hl7.fhir.uv.crmi#2.0.0', 'http://hl7.org/fhir/uv/crmi', [
    { resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/uv/crmi/StructureDefinition/crmi-shareablevalueset', version: '2.0.0' },
  ], [
    { resourceType: 'CodeSystem', url: 'http://hl7.org/fhir/uv/crmi/CodeSystem/publishable-example', version: '2.0.0' },
    { resourceType: 'Library', url: 'http://hl7.org/fhir/uv/crmi/Library/publishable-example', version: '2.0.0' },
    { resourceType: 'NamingSystem', body: {
      extension: [{ url: 'http://hl7.org/fhir/5.0/StructureDefinition/extension-NamingSystem.url', valueUri: 'http://hl7.org/fhir/uv/crmi/NamingSystem/shareable-example' }],
      uniqueId: [{ type: 'uri', value: 'http://hl7.org/fhir/uv/crmi/sid/shareable' }, { type: 'oid', value: '2.16.840.1.113883.6.96' }],
    } },
  ]);
  await writePackage('hl7.terminology.r4#6.0.0', 'http://terminology.hl7.org', [
    { resourceType: 'CodeSystem', url: 'http://terminology.hl7.org/CodeSystem/v2-0203', version: '3.0.0' },
  ]);
});

afterAll(async () => {
  await rm(store, { recursive: true, force: true });
});

const check = (value: string, path = 'Basic.implicitRules', type = 'uri') =>
  validateUnresolvedHl7Url(value, type, path, 'Basic', undefined, [store]);

describe('URLs in HL7 space that no installed definition carries', () => {
  // US Core's example map names the IG itself as its mapping target.
  it('reports a URL the owning IG, the core specification or HL7 Terminology does not define', async () => {
    await expect(check('http://hl7.org/fhir/uv/crmi', 'StructureDefinition.mapping[3].uri')).resolves.toMatchObject({
      code: 'structural-url-unresolved',
      message: "No definition could be found for URL value 'http://hl7.org/fhir/uv/crmi'",
    });
    for (const url of [
      'http://hl7.org/fhir/uv/crmi/ValueSet/missing', 'http://hl7.org/fhir/no-such-system', 'http://terminology.hl7.org/nope',
      'http://hl7.org/fhir/R4/StructureDefinition/Patient', 'http://hl7.org/fhir/v3/ActCode',
      'http://hl7.org/fhir/StructureDefinition/Patient?x=1', 'http://hl7.org/fhirpath/nope',
    ]) {
      await expect(check(url)).resolves.toMatchObject({ code: 'structural-url-unresolved' });
    }
  });

  it('accepts definitions and examples of the loaded types, their releases and the reference validator\'s own names', async () => {
    for (const url of [
      'http://hl7.org/fhir/StructureDefinition/Patient', 'http://hl7.org/fhir/StructureDefinition/Patient#Patient.name',
      'http://hl7.org/fhir/StructureDefinition/Patient|4.0.1', 'http://hl7.org/fhir/StructureDefinition/Patient|4.0',
      'http://hl7.org/fhir/address-use', 'http://terminology.hl7.org/CodeSystem/v2-0203',
      'http://hl7.org/fhir/uv/crmi/CodeSystem/publishable-example|2.0.0',
      'http://hl7.org/fhir/uv/crmi/NamingSystem/shareable-example', 'http://hl7.org/fhir/uv/crmi/sid/shareable',
      'http://hl7.org/fhir/workflow', 'http://hl7.org/fhir/ConsentPolicy/opt-in', 'http://hl7.org/fhirpath/System.String',
      'http://hl7.org/fhir/5.0/StructureDefinition/extension-Patient.name',
    ]) {
      await expect(check(url)).resolves.toBeNull();
    }
  });

  // The reference validator loads a package's conformance resources, not its knowledge artifacts.
  it('holds releases and artifacts it does not load against the URL', async () => {
    for (const url of [
      'http://hl7.org/fhir/StructureDefinition/Patient|3.0.2', 'http://hl7.org/fhir/uv/crmi/CodeSystem/publishable-example|2',
      'http://hl7.org/fhir/uv/crmi/Library/publishable-example',
    ]) {
      await expect(check(url)).resolves.toMatchObject({ code: 'structural-url-unresolved' });
    }
  });

  it('checks references wherever they occur, but not defining URLs, systems or linking extensions', async () => {
    await expect(check('http://hl7.org/fhir/nope', 'DocumentReference.content[0].attachment.url', 'url')).resolves.not.toBeNull();
    await expect(check('http://hl7.org/fhir/nope', "Basic.extension[url='http://hl7.org/fhir/StructureDefinition/artifact-url'].valueUri"))
      .resolves.not.toBeNull();
    for (const [path, type] of [
      ['CodeSystem.url', 'uri'], ['Bundle.entry[0].fullUrl', 'uri'], ['Observation.code.coding[0].system', 'uri'],
      ["Basic.extension[url='http://hl7.org/fhir/StructureDefinition/web-source'].valueUrl", 'url'],
      ["Basic.extension[url='http://hl7.org/fhir/StructureDefinition/textLink'].extension[url='uri'].valueUri", 'uri'],
      ["NamingSystem.extension[url='http://hl7.org/fhir/5.0/StructureDefinition/extension-NamingSystem.url'].valueUri", 'uri'],
      ['Basic.extension[0].valueUri', 'uri'], ['Measure.library[0]', 'canonical'],
    ]) {
      await expect(check('http://hl7.org/fhir/nope', path, type)).resolves.toBeNull();
    }
  });

  it('leaves URLs whose owner is not installed to the reference validator\'s download', async () => {
    await expect(check('http://hl7.org/fhir/uv/other/StructureDefinition/x')).resolves.toBeNull();
    await expect(check('http://hl7.org/fhir/sid/nope')).resolves.toBeNull();
  });
});
