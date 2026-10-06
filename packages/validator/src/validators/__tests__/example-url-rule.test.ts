import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isReferenceValidatorExampleUrl,
  isSpecificationPageUrl,
  unlessPackageDefined,
  validateExampleUrl,
  validateSpecificationPageUrl,
  withoutExemptExtensionExampleUrls,
} from '../example-url-rule';

describe('example URL rule', () => {
  it('matches only the hosts the reference validator treats as unresolvable', () => {
    expect(isReferenceValidatorExampleUrl('http://example.org/ids')).toBe(true);
    expect(isReferenceValidatorExampleUrl('https://example.org/fhir/hc-028-demo/directory-row')).toBe(true);
    expect(isReferenceValidatorExampleUrl('http://acme.com/ids')).toBe(true);
    expect(isReferenceValidatorExampleUrl('http://www.acme.org/practitioners')).toBe(true);
    expect(isReferenceValidatorExampleUrl('http://riverside-medical.example.com/mrn')).toBe(true);
    expect(isReferenceValidatorExampleUrl('http://example.net')).toBe(true);
    // A host that merely starts like one, and the example OIDs, which the
    // reference validator accepts before it asks.
    expect(isReferenceValidatorExampleUrl('http://example.organization.test/ids')).toBe(false);
    expect(isReferenceValidatorExampleUrl('urn:oid:2.999.1')).toBe(false);
    expect(isReferenceValidatorExampleUrl('www.example.com')).toBe(false);
  });

  it('reports uri, url and canonical values that point at an example host', () => {
    for (const [type, path] of [
      ['uri', 'Patient.identifier[0].system'],
      ['url', 'Communication.payload[0].contentAttachment.url'],
      ['canonical', 'Questionnaire.derivedFrom[0]'],
    ] as const) {
      expect(validateExampleUrl('http://example.org/x', type, path, 'Patient')).toEqual(
        expect.objectContaining({
          code: 'structural-example-url',
          severity: 'error',
          message: 'Example URLs are not allowed in this context (http://example.org/x)',
        }),
      );
    }
  });

  it('reports the other example hosts only where a canonical names them', () => {
    // The reference validator accepts any external uri or url except those
    // naming example.org or acme.com, but never resolves such a canonical.
    expect(validateExampleUrl('http://riverside.example.com/mrn', 'uri', 'Patient.identifier[0].system', 'Patient'))
      .toBeNull();
    expect(validateExampleUrl('https://p2p.example.com/endpoint', 'url', 'Endpoint.address', 'Endpoint')).toBeNull();
    expect(validateExampleUrl('http://example.net/ValueSet/x', 'canonical', 'Questionnaire.item[0].answerValueSet',
      'Questionnaire')).toEqual(expect.objectContaining({ code: 'structural-example-url' }));
  });

  it('exempts the values of textLink, web-source and ig-page-name extensions', () => {
    const issue = validateExampleUrl('http://example.org/Condition/1', 'uri',
      'Composition.section[0].extension[0].extension[1].value[x]', 'Composition')!;
    const textLink = { url: 'http://hl7.org/fhir/StructureDefinition/textLink' };
    expect(withoutExemptExtensionExampleUrls(textLink, [issue])).toEqual([]);
    expect(withoutExemptExtensionExampleUrls({ url: 'http://example.org/ext' }, [issue])).toEqual([issue]);
  });

  it('recognises only specification pages the reference validator cannot resolve', () => {
    for (const page of [
      'http://hl7.org/fhir/observation.html',
      'http://hl7.org/fhir/R4/observation.html#resource',
      'http://hl7.org/fhir/us/core/StructureDefinition-us-core-patient.html',
      'http://hl7.org/fhir/uv/ips/',
      'http://hl7.org/fhir',
    ]) expect(isSpecificationPageUrl(page)).toBe(true);
    for (const other of [
      'https://hl7.org/fhir/observation.html',
      'http://terminology.hl7.org/CodeSystem-v2-0203.html',
      'http://build.fhir.org/observation.html',
      'http://hl7.org/fhir/StructureDefinition/Patient',
      'http://hl7.org/fhir/administrative-gender',
      'http://hl7.org/fhirpath/System.String',
    ]) expect(isSpecificationPageUrl(other)).toBe(false);
  });

  it('reports a specification page linked from instance data but not systems or extensions', () => {
    const page = 'http://hl7.org/fhir/observation.html';
    expect(validateSpecificationPageUrl(page, 'url', 'Library.relatedArtifact[0].url', 'Library')).toEqual(
      expect.objectContaining({
        code: 'structural-url-unresolved',
        severity: 'error',
        message: `No definition could be found for URL value '${page}'`,
      }),
    );
    expect(validateSpecificationPageUrl(page, 'uri', 'Observation.code.coding[0].system', 'Observation')).toBeNull();
    expect(validateSpecificationPageUrl(page, 'uri', 'Observation.extension[0].url', 'Observation')).toBeNull();
    expect(validateSpecificationPageUrl(page, 'url', 'Observation.extension[0].valueUrl', 'Observation')).toBeNull();
    expect(validateSpecificationPageUrl(page, 'canonical', 'Library.relatedArtifact[0].resource', 'Library')).toBeNull();
    expect(validateSpecificationPageUrl(page, 'uri', 'ImplementationGuide.url', 'ImplementationGuide')).toBeNull();
  });

  it('leaves URLs that define rather than reference alone', () => {
    expect(validateExampleUrl('http://example.org/Questionnaire/q', 'uri', 'Questionnaire.url', 'Questionnaire')).toBeNull();
    expect(validateExampleUrl('http://example.org/Patient/1', 'uri', 'Bundle.entry[0].fullUrl', 'Bundle')).toBeNull();
    expect(validateExampleUrl('http://example.org/vs', 'uri', 'Library.contained[0].url', 'Library')).toBeNull();
    expect(validateExampleUrl('http://example.org/x', 'string', 'Patient.name[0].text', 'Patient')).toBeNull();
  });

  // eCR's Device/device-ecr-software-ymca is reached at http://acme.com/ymca/software/.
  it('checks the url a Device is reached at, which defines nothing', () => {
    expect(validateExampleUrl('http://acme.com/ymca/software/', 'uri', 'Device.url', 'Device'))
      .toMatchObject({ code: 'structural-example-url', path: 'Device.url' });
  });
});

describe('example URLs a loaded package defines', () => {
  // CDex publishes the Questionnaire its example responses answer at an example host.
  it('resolve like any other definition the package carries among its examples', async () => {
    const store = await mkdtemp(path.join(tmpdir(), 'example-url-package-'));
    try {
      const exampleDir = path.join(store, 'hl7.fhir.us.davinci-cdex#2.1.0', 'package', 'example');
      await mkdir(exampleDir, { recursive: true });
      await writeFile(path.join(exampleDir, '.index.json'), JSON.stringify({ files: [
        { filename: 'Questionnaire-q.json', resourceType: 'Questionnaire', url: 'http://example.org/cdex-questionnaire-example2', version: '2.1.0' },
        { filename: 'Library-l.json', resourceType: 'Library', url: 'http://example.org/fhir/Library/quick' },
      ] }));
      const check = (value: string) => unlessPackageDefined(validateExampleUrl(value, 'canonical', 'Task.input[0].valueCanonical', 'Task'), value, [store]);
      await expect(check('http://example.org/cdex-questionnaire-example2')).resolves.toBeNull();
      await expect(check('http://example.org/cdex-questionnaire-example2|2.1')).resolves.toBeNull();
      // The reference validator does not load knowledge artifacts, nor another release.
      await expect(check('http://example.org/fhir/Library/quick')).resolves.toMatchObject({ code: 'structural-example-url' });
      await expect(check('http://example.org/cdex-questionnaire-example2|1.0.0')).resolves.toMatchObject({ code: 'structural-example-url' });
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  });
});
