import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inInstalledHl7CodeSystemSpace } from '../../../validators/hl7-registrar-packages';
import { clearPackageCanonicalIndex } from '../../../validators/valueset-package-search';
import { isHl7CoreNamespaceUrl } from '../terminology-hl7-namespace-rules';
import { validateCodeSystemReference } from '../terminology-code-system-reference-rules';

describe('isHl7CoreNamespaceUrl', () => {
  it('covers URLs only the core specification can define', () => {
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/security-source-type')).toBe(true);
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/v3/ParticipationMode')).toBe(true);
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/CodeSystem/unknown')).toBe(true);
  });

  it('leaves IG canonicals, identifier namespaces and version-specific URLs out', () => {
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/us/core/CodeSystem/careplan-category')).toBe(false);
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/sid/icd-10')).toBe(false);
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/5.0/StructureDefinition/extension-x')).toBe(false);
    expect(isHl7CoreNamespaceUrl('http://hl7.org/fhir/w5')).toBe(false);
    expect(isHl7CoreNamespaceUrl('http://loinc.org')).toBe(false);
    // Retired between HL7 Terminology releases that older IGs still pin.
    expect(isHl7CoreNamespaceUrl('http://terminology.hl7.org/CodeSystem/v2-0360/2.7')).toBe(false);
  });
});

describe('undefined HL7 core-namespace code systems', () => {
  const check = (system: string, code = 'x') => validateCodeSystemReference(
    { system, code },
    'AuditEvent.source.type',
    0,
    true,
    'not-found',
    'R4',
  );

  it('rejects a retired core URL no HL7 package defines', async () => {
    expect(await check('http://hl7.org/fhir/security-source-type', '4')).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'terminology-codesystem-undefined',
        message: "No definition could be found for URL value 'http://hl7.org/fhir/security-source-type'",
        path: 'AuditEvent.source.type[0].system',
      }),
      expect.objectContaining({ severity: 'warning', code: 'terminology-codesystem-unresolvable' }),
    ]);
  });

  it('accepts core and HL7 Terminology code systems that exist', async () => {
    expect(await check('http://hl7.org/fhir/administrative-gender', 'male')).toEqual([]);
    expect(await check('http://terminology.hl7.org/CodeSystem/security-source-type', '4')).toEqual([]);
  });

  it('does not judge IG code systems whose package may simply not be installed', async () => {
    expect(await check('http://hl7.org/fhir/us/example-ig/CodeSystem/not-installed')).toEqual([]);
  });
});

describe('undefined HL7 Terminology code systems', () => {
  const originalCache = process.env.FHIR_PACKAGE_CACHE_PATH;
  let root = '';
  const defined = 'http://terminology.hl7.org/CodeSystem/records-test-defined';

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tho-undefined-'));
    const packageDir = path.join(root, 'hl7.terminology.r4#99.0.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'hl7.terminology.r4', version: '99.0.0', canonical: 'http://terminology.hl7.org',
    }));
    const igDir = path.join(root, 'hl7.fhir.us.records-test#1.0.0', 'package');
    await mkdir(igDir, { recursive: true });
    await writeFile(path.join(igDir, 'package.json'), JSON.stringify({
      name: 'hl7.fhir.us.records-test', version: '1.0.0', canonical: 'http://hl7.org/fhir/us/records-test',
    }));
    await writeFile(path.join(igDir, '.index.json'), JSON.stringify({ files: [] }));
    // MedMorph publishes its usage-context code systems only among its examples.
    const exampleDir = path.join(igDir, 'example');
    await mkdir(exampleDir, { recursive: true });
    await writeFile(path.join(exampleDir, '.index.json'), JSON.stringify({ files: [{
      filename: 'CodeSystem-example-only.json', resourceType: 'CodeSystem', url: 'http://hl7.org/fhir/us/records-test/CodeSystem/example-only',
    }] }));
    // R5's version-algorithm, shipped for R4 use by the extensions pack, and
    // a code system only an R5 core package defines.
    for (const [name, url] of [
      ['hl7.fhir.uv.extensions.r4#5.3.0', 'http://hl7.org/fhir/records-test-version-algorithm'],
      ['hl7.fhir.r5.core#99.0.0', 'http://hl7.org/fhir/records-test-version-algorithm'],
      ['hl7.fhir.r5.core#99.0.0', 'http://hl7.org/fhir/records-test-r5-only'],
    ] as const) {
      const dir = path.join(root, name, 'package');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: name.split('#')[0], version: name.split('#')[1] }));
      const filename = `CodeSystem-${url.split('/').pop()}.json`;
      const indexPath = path.join(dir, '.index.json');
      const index = await readFile(indexPath, 'utf8').then(text => JSON.parse(text) as { files: unknown[] }, () => ({ files: [] }));
      index.files.push({ filename, resourceType: 'CodeSystem', url, version: '5.0.0' });
      await writeFile(indexPath, JSON.stringify(index));
      await writeFile(path.join(dir, filename), JSON.stringify({
        resourceType: 'CodeSystem', url, version: '5.0.0', content: 'complete', concept: [{ code: 'x' }],
      }));
    }
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      files: [{ filename: 'CodeSystem-records-test-defined.json', resourceType: 'CodeSystem', url: defined }],
    }));
    await writeFile(path.join(packageDir, 'CodeSystem-records-test-defined.json'), JSON.stringify({
      resourceType: 'CodeSystem', url: defined, content: 'complete', concept: [{ code: 'x' }],
    }));
    process.env.FHIR_PACKAGE_CACHE_PATH = root;
    clearPackageCanonicalIndex();
  });

  afterAll(async () => {
    if (originalCache === undefined) delete process.env.FHIR_PACKAGE_CACHE_PATH;
    else process.env.FHIR_PACKAGE_CACHE_PATH = originalCache;
    clearPackageCanonicalIndex();
    await rm(root, { recursive: true, force: true });
  });

  const check = (system: string) => validateCodeSystemReference(
    { system, code: 'x' }, 'Practitioner.qualification[0].code.coding', 1, true, 'not-found', 'R4',
  );

  it('rejects a URL no installed release defines', async () => {
    for (const system of [
      'http://terminology.hl7.org/CodeSystem/records-test-never-defined',
      `${defined}%7C2.7`,
      'http://hl7.org/fhir/us/records-test/CodeSystem/misspelt-CSS',
    ]) {
      expect((await check(system)).map(issue => [issue.code, issue.severity])).toEqual([
        ['terminology-codesystem-undefined', 'error'],
        ['terminology-codesystem-unresolvable', 'warning'],
      ]);
    }
  });

  it('accepts a URL some installed release defines, among its examples too', async () => {
    expect(await check(defined)).toEqual([]);
    expect((await check('http://hl7.org/fhir/us/records-test/CodeSystem/example-only')).map(issue => issue.code))
      .not.toContain('terminology-codesystem-undefined');
  });

  it('accepts a core code system a package for this release carries, whatever version it names', async () => {
    expect(await check('http://hl7.org/fhir/records-test-version-algorithm')).toEqual([]);
    expect((await check('http://hl7.org/fhir/records-test-r5-only')).map(issue => issue.code))
      .toContain('terminology-codesystem-undefined');
  });

  it('judges only the CodeSystem space of an installed HL7 package', async () => {
    expect(await inInstalledHl7CodeSystemSpace('http://terminology.hl7.org/CodeSystem/x', [root])).toBe(true);
    expect(await inInstalledHl7CodeSystemSpace('http://terminology.hl7.org/codesystem/consentscope', [root])).toBe(true);
    expect(await inInstalledHl7CodeSystemSpace('http://hl7.org/fhir/us/records-test/CodeSystem/x', [root])).toBe(true);
    // An IG that is not installed may simply define it.
    expect(await inInstalledHl7CodeSystemSpace('http://hl7.org/fhir/us/other-ig/CodeSystem/x', [root])).toBe(false);
    expect(await inInstalledHl7CodeSystemSpace('http://terminology.hl7.org/CodeSystem/x', [path.join(root, 'absent')]))
      .toBe(false);
    expect(await check('http://hl7.org/fhir/us/other-ig/CodeSystem/x')).toEqual([]);
  });
});
