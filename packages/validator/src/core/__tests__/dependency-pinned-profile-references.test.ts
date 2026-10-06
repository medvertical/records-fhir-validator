/**
 * Canonicals a profile references resolve at the releases its package's
 * dependencies declare, as the HL7 reference validator resolves them. The
 * store mirrors ISiP 1.0.2: its patient profile derives from ISiK Basismodul
 * 2.0.4 (only 2.0.0 installed), whose identifier slice names a KVID profile
 * that Basisprofil DE 1.4.0 constrains to type GKV and 1.5.4 to type KVZ10.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';

const TYPE_SYSTEM = 'http://example.org/CodeSystem/identifier-type';
const KVID = 'http://example.org/basis/StructureDefinition/identifier-kvid-10';
const ISIK_V2_PATIENT = 'http://example.org/isik/v2/StructureDefinition/Patient';
const ISIP_PATIENT = 'http://example.org/isip/StructureDefinition/Pflegeempfaenger';

const patient = {
  resourceType: 'Patient',
  id: 'pflegeempfaenger',
  meta: { profile: [ISIP_PATIENT] },
  identifier: [{
    type: { coding: [{ system: TYPE_SYSTEM, code: 'GKV' }] },
    system: 'http://example.org/sid/kvid-10',
    value: 'A123456789',
  }],
};

describe('dependency-pinned profile references', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearCanonicalPinCaches();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function validateAgainstStore(basisReleases: string[]): Promise<ValidationIssue[]> {
    const store = await mkdtemp(path.join(tmpdir(), 'records-dependency-pins-'));
    tempDirs.push(store);
    await writeIsipChain(store, basisReleases);
    const validator = new RecordsValidator({ packageCachePath: store, autoDownload: false });
    await validator.waitForInitialization();
    const result = await validator.validate(patient, undefined, 'R4');
    const issues = Array.isArray(result) ? result : (result as { issues?: Array<{ code?: string }> }).issues ?? [];
    return issues as ValidationIssue[];
  }

  it('keeps the unavailable original literal visible with both Basis releases installed', async () => {
    const issues = await validateAgainstStore(['1.4.0', '1.5.4']);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'profile-reference-unavailable',
      details: expect.objectContaining({ validationComplete: false, dependency: { name: 'example.isik', version: '2.0.4' } }) })]));
    expect(issues.map(issue => issue.code)).not.toContain('profile-slice-pattern-mismatch');
  }, 60_000);

  it('keeps the unavailable original literal visible without inventing a newest-release violation', async () => {
    const issues = await validateAgainstStore(['1.5.4']);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'profile-reference-unavailable',
      details: expect.objectContaining({ validationComplete: false, dependency: { name: 'example.isik', version: '2.0.4' } }) })]));
    expect(issues.map(issue => issue.code)).not.toContain('profile-slice-pattern-mismatch');
  }, 60_000);
});

async function writeIsipChain(store: string, basisReleases: string[]): Promise<void> {
  await writePackage(store, 'example.isip', '1.0.2', { 'example.isik': '2.0.4' }, [profile({
    url: ISIP_PATIENT,
    version: '1.0.2',
    type: 'Patient',
    baseDefinition: ISIK_V2_PATIENT,
    elements: [
      { id: 'Patient', path: 'Patient' },
      { id: 'Patient.identifier:VersichertenId-GKV.value', path: 'Patient.identifier.value', min: 1 },
    ],
  })]);
  await writePackage(store, 'example.isik', '2.0.0', { 'example.basis': '1.4.0' }, [profile({
    url: ISIK_V2_PATIENT,
    version: '2.0.0',
    type: 'Patient',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    elements: [
      { id: 'Patient', path: 'Patient' },
      {
        id: 'Patient.identifier',
        path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
        min: 1,
      },
      {
        id: 'Patient.identifier:VersichertenId-GKV',
        path: 'Patient.identifier',
        sliceName: 'VersichertenId-GKV',
        min: 0,
        max: '1',
        type: [{ code: 'Identifier', profile: [KVID] }],
        patternIdentifier: { type: { coding: [{ system: TYPE_SYSTEM, code: 'GKV' }] } },
      },
    ],
  })]);
  for (const release of basisReleases) {
    await writePackage(store, 'example.basis', release, {}, [profile({
      url: KVID,
      version: release,
      type: 'Identifier',
      kind: 'complex-type',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Identifier',
      elements: [
        { id: 'Identifier', path: 'Identifier' },
        {
          id: 'Identifier.type',
          path: 'Identifier.type',
          min: 1,
          patternCodeableConcept: {
            coding: [{ system: TYPE_SYSTEM, code: release.startsWith('1.4.') ? 'GKV' : 'KVZ10' }],
          },
        },
      ],
    })]);
  }
}

function profile(input: {
  url: string;
  version: string;
  type: string;
  kind?: string;
  baseDefinition: string;
  elements: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    resourceType: 'StructureDefinition',
    id: input.url.split('/').pop(),
    url: input.url,
    version: input.version,
    name: input.url.split('/').pop()!.replace(/[^A-Za-z0-9]/g, ''),
    status: 'active',
    kind: input.kind ?? 'resource',
    abstract: false,
    type: input.type,
    baseDefinition: input.baseDefinition,
    derivation: 'constraint',
    fhirVersion: '4.0.1',
    differential: { element: input.elements },
  };
}

async function writePackage(
  store: string,
  name: string,
  version: string,
  dependencies: Record<string, string>,
  resources: Array<Record<string, unknown>>,
): Promise<void> {
  const packageDir = path.join(store, `${name}#${version}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name,
    version,
    fhirVersions: ['4.0.1'],
    dependencies: { 'hl7.fhir.r4.core': '4.0.1', ...dependencies },
  }));
  for (const resource of resources) {
    await writeFile(
      path.join(packageDir, `StructureDefinition-${String(resource.id)}.json`),
      JSON.stringify(resource),
    );
  }
}
