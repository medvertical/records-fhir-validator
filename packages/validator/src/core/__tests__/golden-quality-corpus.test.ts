import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueMatchesAnchor, stableIssues, summarizeIssueAnchors, type ExpectedIssueAnchor } from '../../issues/issue-contract';
import { setEngineLogger } from '../../logger';
import { RecordsValidator } from '../validator-engine';

type FhirVersion = 'R4' | 'R4B' | 'R5' | 'R6';

interface ExpectedFixture {
  fixture: string;
  fhirVersion: FhirVersion;
  profile?: string;
  expectedToCatch?: boolean;
  expectedIssues: ExpectedIssueAnchor[];
}

interface GoldenCase {
  name: string;
  folder: string;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');

const goldenCases: GoldenCase[] = [
  { name: 'patient-invalid-gender', folder: 'quality-corpus/r4/generated' },
  { name: 'observation-bad-status', folder: 'quality-corpus/r4/generated' },
  { name: 'encounter-subject-wrong-type', folder: 'quality-corpus/r4/generated' },
  { name: 'organization-partof-wrong-type', folder: 'quality-corpus/r4/generated' },
  { name: 'observation-obs6-value-and-dar', folder: 'quality-corpus/r4/generated' },
  { name: 'patient-future-birthdate', folder: 'quality-corpus/r4/generated' },
];

function structureDefinition(
  type: string,
  elements: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    resourceType: 'StructureDefinition',
    url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    version: '4.0.1',
    fhirVersion: '4.0.1',
    name: type,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type,
    snapshot: {
      element: [
        { id: type, path: type, min: 0, max: '*' },
        ...elements,
      ],
    },
  };
}

function requiredCodeValueSet(url: string, codes: string[]): Record<string, unknown> {
  return {
    resourceType: 'ValueSet',
    url,
    version: '4.0.1',
    status: 'active',
    expansion: {
      contains: codes.map(code => ({ system: url.replace('/ValueSet/', '/CodeSystem/'), code })),
    },
  };
}

async function writePackageResource(packageDir: string, filename: string, resource: Record<string, unknown>): Promise<void> {
  await writeFile(join(packageDir, filename), `${JSON.stringify(resource, null, 2)}\n`, 'utf8');
}

async function writeMinimalR4CorePackage(cacheRoot: string): Promise<void> {
  const packageDir = join(cacheRoot, 'hl7.fhir.r4.core#4.0.1', 'package');
  await mkdir(packageDir, { recursive: true });
  await writePackageResource(packageDir, 'package.json', {
    name: 'hl7.fhir.r4.core',
    version: '4.0.1',
    fhirVersions: ['4.0.1'],
  });
  await writePackageResource(packageDir, 'StructureDefinition-Patient.json', structureDefinition('Patient', [
    {
      id: 'Patient.gender',
      path: 'Patient.gender',
      min: 0,
      max: '1',
      type: [{ code: 'code' }],
      binding: {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
      },
    },
    {
      id: 'Patient.birthDate',
      path: 'Patient.birthDate',
      min: 0,
      max: '1',
      type: [{ code: 'date' }],
    },
  ]));
  await writePackageResource(packageDir, 'StructureDefinition-Observation.json', structureDefinition('Observation', [
    {
      id: 'Observation',
      path: 'Observation',
      min: 0,
      max: '*',
      constraint: [{
        key: 'obs-6',
        severity: 'error',
        human: 'dataAbsentReason SHALL only be present if value[x] is not present',
        expression: 'dataAbsentReason.empty() or value.empty()',
      }],
    },
    {
      id: 'Observation.status',
      path: 'Observation.status',
      min: 1,
      max: '1',
      type: [{ code: 'code' }],
      binding: {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/observation-status',
      },
    },
    {
      id: 'Observation.value[x]',
      path: 'Observation.value[x]',
      min: 0,
      max: '1',
      type: [{ code: 'Quantity' }],
    },
    {
      id: 'Observation.dataAbsentReason',
      path: 'Observation.dataAbsentReason',
      min: 0,
      max: '1',
      type: [{ code: 'CodeableConcept' }],
    },
  ]));
  await writePackageResource(packageDir, 'StructureDefinition-Encounter.json', structureDefinition('Encounter', [
    {
      id: 'Encounter.status',
      path: 'Encounter.status',
      min: 1,
      max: '1',
      type: [{ code: 'code' }],
      binding: {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/encounter-status',
      },
    },
    {
      id: 'Encounter.subject',
      path: 'Encounter.subject',
      min: 0,
      max: '1',
      type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Patient'] }],
    },
  ]));
  await writePackageResource(packageDir, 'StructureDefinition-Organization.json', structureDefinition('Organization', [
    {
      id: 'Organization.partOf',
      path: 'Organization.partOf',
      min: 0,
      max: '1',
      type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Organization'] }],
    },
  ]));
  await writePackageResource(
    packageDir,
    'ValueSet-administrative-gender.json',
    requiredCodeValueSet('http://hl7.org/fhir/ValueSet/administrative-gender', ['male', 'female', 'other', 'unknown']),
  );
  await writePackageResource(
    packageDir,
    'ValueSet-observation-status.json',
    requiredCodeValueSet('http://hl7.org/fhir/ValueSet/observation-status', ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']),
  );
  await writePackageResource(
    packageDir,
    'ValueSet-encounter-status.json',
    requiredCodeValueSet('http://hl7.org/fhir/ValueSet/encounter-status', ['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown']),
  );
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('Golden quality corpus matrix', () => {
  let validator: RecordsValidator;
  let packageCachePath: string;

  beforeAll(async () => {
    setEngineLogger({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });

    packageCachePath = await mkdtemp(join(tmpdir(), 'records-golden-fhir-cache-'));
    await writeMinimalR4CorePackage(packageCachePath);

    validator = new RecordsValidator({
      packageCachePath,
      bundledProfilesPath: packageCachePath,
      enableCaching: true,
      strictMode: false,
      timeout: 30000,
      autoDownload: false,
    });
    validator.configureTerminologyResolution({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });
    await validator.waitForInitialization();
  }, 120_000);

  afterAll(async () => {
    if (packageCachePath) {
      await rm(packageCachePath, { recursive: true, force: true });
    }
  });

  it.each(goldenCases)('matches expected issue anchors for $name', async ({ name, folder }) => {
    const fixturePath = join(repoRoot, folder, `${name}.json`);
    const expectedPath = join(repoRoot, folder, `${name}.expected.json`);
    const resource = loadJson<Record<string, unknown>>(fixturePath);
    const expected = loadJson<ExpectedFixture>(expectedPath);

    expect(expected.expectedToCatch, `${name} is marked aspirational`).not.toBe(false);

    const resourceType = String(resource.resourceType);
    const profileUrl = expected.profile ?? `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
    const issues = await validator.validate(resource, profileUrl, expected.fhirVersion === 'R4B' ? 'R4' : expected.fhirVersion);
    const contractIssues = stableIssues(issues);

    for (const expectedIssue of expected.expectedIssues) {
      expect(
        contractIssues.some(issue => issueMatchesAnchor(issue, expectedIssue)),
        `${name} did not produce expected ${expectedIssue.severity} ${expectedIssue.kind} at ${expectedIssue.pathPattern}.\nActual issues:\n${summarizeIssueAnchors(contractIssues)}`,
      ).toBe(true);
    }
  }, 120_000);
});
