import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { resolveVersionedLocalBinding } from '../valueset-versioned-local-binding.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import type { CodeSystem, ValueSetComposeInclude } from '../valueset-types.js';

const system = 'http://snomed.info/sct';
const edition = `${system}/900000000000207008/version/20250201`;
const otherEdition = `${system}/999000041000000102/version/20250701`;
const absentCodes = ['8921000202108', '8941000202104', '8951000202101', '8981000202109'];
const namedCode = '386661006';
const detailCode = '271649006';
const valueSetUrl = 'https://example.test/ValueSet/named-code-binding';
const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const scalar = (url: string, value: unknown, key = 'valueString') => ({ url, [key]: value });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Synthetic inventory controls using the four own NO performer ValueSet IDs; no clinical resource fixture.
function projection(version = edition) {
  return { resourceType: 'CodeSystem', url: system, version, content: 'fragment', count: 2,
    caseSensitive: true, language: 'en', concept: [{ code: namedCode },
      { code: detailCode, extension: [{ url: prefix + 'label-coverage', extension: [
        scalar('completeSourceDescriptions', true, 'valueBoolean'), scalar('sourceDescriptionCount', 0, 'valueInteger'),
      ] }] },
    ], extension: [{ url: prefix + 'source', extension: [
      scalar('contract', 'records.fhirsmith.terminology-projection.v2', 'valueCode'), scalar('format', 'snomed', 'valueCode'),
      scalar('displayLanguageMatch', 'base-language', 'valueCode'), scalar('sha256', hash('synthetic-metadata-only')),
      scalar('businessVersion', version), scalar('selection', 'all-named-codes', 'valueCode'),
      scalar('completeNamedCodeInventory', true, 'valueBoolean'), scalar('datasetNamedCodeCount', 2, 'valueInteger'),
      scalar('projectedNamedCodeCount', 2, 'valueInteger'), scalar('descriptionsCompleteForIncludedCodes', false, 'valueBoolean'),
      scalar('propertiesCompleteForIncludedCodes', false, 'valueBoolean'), scalar('relationshipsCompleteForIncludedCodes', false, 'valueBoolean'),
      scalar('detailSelection', 'code-list', 'valueCode'), scalar('detailCodeCount', 1, 'valueInteger'),
      scalar('detailCodesSha256', hash(JSON.stringify([detailCode]))), scalar('detailDescriptionsComplete', true, 'valueBoolean'),
      scalar('detailPropertiesComplete', false, 'valueBoolean'), scalar('detailRelationshipsComplete', false, 'valueBoolean'),
    ] }] };
}
const listed = (version?: string): ValueSetComposeInclude => ({ system,
  ...(version ? { version } : {}), concept: absentCodes.map(code => ({ code })) });
afterEach(() => vi.restoreAllMocks());

function validator(include: ValueSetComposeInclude[] = [listed()], defaultVersion: string | undefined = edition,
  resource: unknown = projection(), exclude?: ValueSetComposeInclude[]) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
    serverDelegation: { validateCodes: false, expandValueSets: false },
    ...(defaultVersion ? { defaultCodeSystemVersions: { [system]: defaultVersion } } : {}),
  });
  expect(values.registerExternalTerminologyResource(resource, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl,
    compose: { include, ...(exclude ? { exclude } : {}) } }, 'R4')).toBe(true);
  return values;
}
const resolve = (values: ValueSetValidator, code = absentCodes[0], version?: string, family: 'R4' | 'R5' = 'R4') =>
  values.resolveCodeBindingForBinding(code, system, valueSetUrl, 'required', family, 'Procedure.performer.function', version);

describe('versioned bindings preserve owned named-code rejection', () => {
  it.each(absentCodes)('rejects listed %s under the explicitly selected default edition', async code => {
    const values = validator();
    const result = await values.validateCodeInCodeSystem(code, system, undefined, 'R4');
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    await expect(resolve(values, code)).resolves.toBe('invalid');
    const issues = await values.validateBinding({ system, code }, { strength: 'required', valueSet: valueSetUrl },
      'Procedure.performer.function', { fhirVersion: 'R4' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-required', severity: 'error' }));
    expect(issues.some(issue => issue.code === 'terminology-binding-unverified')).toBe(false);
  });

  it('uses explicit Coding.version ahead of a different default edition', async () => {
    await expect(resolve(validator([listed()], otherEdition), absentCodes[0], edition)).resolves.toBe('invalid');
    await expect(resolve(validator(), absentCodes[0], otherEdition)).resolves.toBe('unverified');
  });

  it('uses an explicit compose edition ahead of the default and retains its listed concept authority', async () => {
    await expect(resolve(validator([listed(edition)], otherEdition))).resolves.toBe('invalid');
    await expect(resolve(validator([listed(otherEdition)]))).resolves.toBe('valid');
    await expect(resolve(validator([listed(otherEdition)]), detailCode)).resolves.toBe('unverified');
  });

  it('accepts own named membership in a matching explicit alternative edition', async () => {
    const source = { ...projection(otherEdition), concept: projection(otherEdition).concept.map(concept =>
      concept.code === namedCode ? { ...concept, code: absentCodes[0] } : concept) };
    await expect(resolve(validator([listed(otherEdition)], edition, source))).resolves.toBe('valid');
  });

  it('does not turn presence of the system or an ordinary fragment into a named-code N', async () => {
    await expect(resolve(validator([listed()], edition, { ...projection(), extension: [] }))).resolves.toBe('unverified');
  });

  it('does not treat unversioned named-inventory absence as an explicit rejection', async () => {
    const values = validator();
    values.setResolutionConfig({ strategy: 'local-only', servers: [],
      serverDelegation: { validateCodes: false, expandValueSets: false } });
    const result = await values.validateCodeInCodeSystem(absentCodes[0], system, undefined, 'R4');
    expect(result.reason).not.toBe('code-unknown');
    expect(isVerifiedCodeSystemResult(result)).toBe(false);
    await expect(resolve(values)).resolves.not.toBe('invalid');
  });

  it.each([
    { include: [listed(), { system, version: otherEdition }] }, { include: [listed(), { system, version: '*' }] },
    { include: [listed(), { system, valueSet: [valueSetUrl + '/unknown'] }] },
    { include: [{ ...listed(), filter: [{ property: 'opaque', op: '=', value: 'unknown' }] }] },
  ])('retains U for unresolved filters, imports and open edition alternatives: %j', async ({ include }) => {
    await expect(resolve(validator(include))).resolves.toBe('unverified');
  });

  it('does not erase unresolved exclusions or unknown compose modifiers with code-negative evidence', async () => {
    await expect(resolve(validator([listed()], edition, projection(), [{ valueSet: [valueSetUrl + '/unknown'] }])))
      .resolves.toBe('unverified');
    const modified = { ...listed(), modifierExtension: [{ url: 'https://example.test/unknown', valueBoolean: true }] };
    await expect(resolve(validator([modified]))).resolves.toBe('unverified');
  });

  it.each([
    { modifierExtension: [{ url: 'https://example.test/unknown', valueBoolean: true }] },
    { implicitRules: 'https://example.test/unknown-rules' },
  ])('retains U for exclusion modifiers before a named-code include rejection: %j', async modifier => {
    const exclude = [{ ...listed(), ...modifier }];
    await expect(resolve(validator([listed()], edition, projection(), exclude))).resolves.toBe('unverified');
    await expect(resolve(validator([listed()], edition, projection(), [{ ...listed(), modifierExtension: [] }])))
      .resolves.toBe('invalid');
  });

  it('does not use code-negative evidence to resolve a different explicit compose edition', async () => {
    await expect(resolve(validator([listed(otherEdition)]), absentCodes[0], edition)).resolves.toBe('unverified');
  });

  it('leaves unknown property filters U for a present named concept', async () => {
    await expect(resolve(validator([{ system, filter: [{ property: 'opaque', op: '=', value: 'unknown' }] }]), namedCode))
      .resolves.toBe('unverified');
  });

  it('does not transfer a registered R4 rejection to an R5 binding', async () => {
    await expect(resolve(validator(), absentCodes[0], undefined, 'R5')).resolves.toBe('unverified');
  });

  it('does not accept a copied or fabricated negative result as an owner witness', async () => {
    const values = validator();
    const result = await values.validateCodeInCodeSystem(absentCodes[0], system, undefined, 'R4');
    const loader = { loadCodeSystem: async () => projection() as CodeSystem,
      loadValueSetResource: async () => ({ resourceType: 'ValueSet' as const, status: 'active', url: valueSetUrl, compose: { include: [listed()] } }) };
    await expect(resolveVersionedLocalBinding(loader, absentCodes[0], system, edition, valueSetUrl, 'R4', async () => ({ ...result })))
      .resolves.toBe('unverified');
  });
});
