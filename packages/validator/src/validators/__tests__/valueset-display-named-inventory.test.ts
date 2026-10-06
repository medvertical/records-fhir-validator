import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';

const system = 'http://snomed.info/sct';
const edition = `${system}/900000000000207008/version/20250201`;
const absentCode = '429740004';
const namedCode = '386661006';
const detailCode = '271649006';
const valueSetUrl = 'https://example.test/ValueSet/named-code-display';
const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const scalar = (url: string, value: unknown, key = 'valueString') => ({ url, [key]: value });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// These synthetic metadata fixtures exercise ownership, not primary terminology dataset acceptance.
function projection(format: 'snomed' | 'loinc' = 'snomed') {
  const canonical = format === 'snomed' ? system : 'http://loinc.org';
  const version = format === 'snomed' ? edition : '2.82';
  return { resourceType: 'CodeSystem', url: canonical, version, content: 'fragment', count: 2,
    caseSensitive: true, language: format === 'loinc' ? 'en-US' : 'en', concept: [
      { code: namedCode },
      { code: detailCode, extension: [{ url: prefix + 'label-coverage', extension: [
        scalar('completeSourceDescriptions', true, 'valueBoolean'), scalar('sourceDescriptionCount', 0, 'valueInteger'),
      ] }] },
    ], extension: [{ url: prefix + 'source', extension: [
      scalar('contract', 'records.fhirsmith.terminology-projection.v2', 'valueCode'), scalar('format', format, 'valueCode'),
      scalar('displayLanguageMatch', 'base-language', 'valueCode'), scalar('sha256', hash('synthetic-metadata-only')),
      scalar('businessVersion', version), scalar('selection', 'all-named-codes', 'valueCode'),
      scalar('completeNamedCodeInventory', true, 'valueBoolean'), scalar('datasetNamedCodeCount', 2, 'valueInteger'),
      scalar('projectedNamedCodeCount', 2, 'valueInteger'), scalar('descriptionsCompleteForIncludedCodes', false, 'valueBoolean'),
      scalar('propertiesCompleteForIncludedCodes', false, 'valueBoolean'), scalar('relationshipsCompleteForIncludedCodes', false, 'valueBoolean'),
      scalar('detailSelection', 'code-list', 'valueCode'), scalar('detailCodeCount', 1, 'valueInteger'),
      scalar('detailCodesSha256', hash(JSON.stringify([detailCode]))), scalar('detailDescriptionsComplete', true, 'valueBoolean'),
      scalar('detailPropertiesComplete', format === 'loinc', 'valueBoolean'),
      scalar('detailRelationshipsComplete', format === 'loinc', 'valueBoolean'),
    ] }] };
}

afterEach(() => vi.restoreAllMocks());

function validator(resource: ReturnType<typeof projection> = projection(), defaultVersion?: string, includeVersion?: string) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: false,
    serverDelegation: { validateCodes: false, expandValueSets: false },
    ...(defaultVersion ? { defaultCodeSystemVersions: { [resource.url]: defaultVersion } } : {}),
  });
  expect(values.registerExternalTerminologyResource(resource, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl,
    compose: { include: [{ system: resource.url, ...(includeVersion ? { version: includeVersion } : {}) }] } }, 'R4')).toBe(true);
  return values;
}

async function displayIssues(values: ValueSetValidator, code = absentCode, version?: string,
  canonical = system, family: 'R4' | 'R5' = 'R4') {
  const issues = await values.validateBinding({ system: canonical, code, display: 'Unowned display',
    ...(version !== undefined ? { version } : {}) }, { strength: 'required', valueSet: valueSetUrl },
  'Observation.code', { fhirVersion: family });
  return issues.filter(issue => issue.code === 'terminology-display-unverified' || issue.code === 'terminology-display-mismatch');
}

describe('display checks after exact imported named-code rejection', () => {
  it.each(['explicit', 'default'] as const)('does not add display U to own-edition named-code N (%s)', async mode => {
    const values = validator(projection(), mode === 'default' ? edition : undefined);
    const requestedVersion = mode === 'explicit' ? edition : undefined;
    const result = await values.validateCodeInCodeSystem(absentCode, system, 'Unowned display', 'R4', requestedVersion);
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(await displayIssues(values, absentCode, requestedVersion)).toEqual([]);
  });

  it('retains U for unversioned SNOMED absence with no configured edition', async () => {
    expect(await displayIssues(validator())).toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('does not borrow default-edition rejection for an unavailable Coding.version', async () => {
    expect(await displayIssues(validator(projection(), edition), absentCode, `${system}/999000041000000102/version/20250701`))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('respects the independently explicit compose edition over the default display edition', async () => {
    expect(await displayIssues(validator(projection(), edition, `${system}/999000041000000102/version/20250701`)))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('retains display U for a present named code whose labels are not projected', async () => {
    const values = validator(projection(), edition);
    expect(await values.validateCodeInCodeSystem(namedCode, system, undefined, 'R4')).toMatchObject({ valid: true });
    expect(await displayIssues(values, namedCode)).toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('retains U for absent postcoordination expressions', async () => {
    expect(await displayIssues(validator(projection(), edition), '22298006:363698007=56459004'))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('retains U for LOINC answer-list codes outside named-inventory authority', async () => {
    expect(await displayIssues(validator(projection('loinc'), '2.82'), 'LA6751-7', undefined, 'http://loinc.org'))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('does not turn absence in an ordinary fragment into display rejection', async () => {
    expect(await displayIssues(validator({ ...projection(), extension: [] }, edition)))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('does not use contradictory inventory declarations to suppress display U', async () => {
    expect(await displayIssues(validator({ ...projection(), count: 3 }, edition)))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });

  it('does not transfer an R4 inventory rejection to an R5 request', async () => {
    expect(await displayIssues(validator(projection(), edition), absentCode, undefined, system, 'R5'))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });
});
