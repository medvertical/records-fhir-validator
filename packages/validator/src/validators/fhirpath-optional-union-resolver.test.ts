import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import { ConstraintValidator } from './constraint-validator.js';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor.js';
import { evaluateAsyncFHIRPathTerminology } from './fhirpath-async-terminology.js';
import { ValueSetCache } from './valueset-cache.js';
import type { FHIRPathTerminologyResolver } from './fhirpath-terminology-types.js';

const canonical = 'https://records.test/ValueSet/union';
const system = 'https://records.test/CodeSystem/union';
const urls = [`${canonical}-first|1.0.0`, `${canonical}-second|2.0.0`];
type Outcome = 'valid' | 'invalid' | 'unverified';
const decisions: [Outcome, Outcome, boolean | null][] = [
  ['valid', 'unverified', true], ['unverified', 'valid', true],
  ['invalid', 'invalid', false], ['invalid', 'unverified', null],
  ['unverified', 'invalid', null], ['unverified', 'unverified', null],
];

function definition(): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://records.test/Profile/union',
    name: 'UnionResolver', status: 'active', kind: 'resource', abstract: false, type: 'Observation',
    snapshot: { element: [{ id: 'Observation', path: 'Observation', constraint: [{
      key: 'union-rule', severity: 'error', human: 'Membership required',
      expression: `code.empty() or (code.memberOf('${urls[0]}') or code.memberOf('${urls[1]}'))`,
    }] }] } };
}

function evidence(warm: boolean) {
  const cache = new ValueSetCache();
  for (const url of urls) {
    cache.setValueSetFile(url, warm ? { resourceType: 'ValueSet', url: url.split('|')[0],
      version: url.split('|')[1], status: 'active', expansion: { total: 1, contains: [{ system, code: 'accepted' }] } } : null);
    if (warm) cache.setExpandedCodes(url, new Set([`${system}|accepted`, 'accepted']));
  }
  return cache;
}

function run(implementation: 'general' | 'SD', cache: ValueSetCache,
  resolver: FHIRPathTerminologyResolver, code: unknown = { system, code: 'accepted' }) {
  const profile = definition();
  const resource = { resourceType: 'Observation', ...(code === undefined ? {} : { code }) };
  return implementation === 'general'
    ? new ConstraintValidator(resolver, undefined, cache).validate(resource, profile.snapshot!.element, profile.url!)
    : new SDFHIRPathExecutor(cache).execute({ resource, resourceType: 'Observation', structureDef: profile, terminologyResolver: resolver });
}

function expected(decision: boolean | null) {
  return decision === true ? [] : [expect.objectContaining(decision === false
    ? { severity: 'error', ruleId: 'union-rule' }
    : { severity: 'information', ruleId: 'union-rule', details: expect.objectContaining({ validationComplete: false }) })];
}

function resolver(first: Outcome, second: Outcome): FHIRPathTerminologyResolver {
  return { resolveCodeMembership: vi.fn(async (code, codingSystem, url) =>
    code === 'accepted' && codingSystem === system ? url === urls[0] ? first : second : 'invalid'),
  resolveSubsumption: vi.fn().mockResolvedValue('unknown') };
}

describe.each(['general', 'SD'] as const)('%s optional OR resolver truth', implementation => {
  for (const warm of [false, true]) {
    it.each(decisions)(`keeps %s OR %s as %s with local cache warm=${warm}`, async (first, second, decision) => {
      const scoped = resolver(first, second);
      await expect(run(implementation, evidence(warm), scoped)).resolves.toEqual(expected(decision));
      expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, urls[0], 'R4');
      if (first !== 'valid') expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, urls[1], 'R4');
    });
  }

  it('does not substitute a warm bare code for a wrong supplied system', async () => {
    const scoped = resolver('valid', 'valid');
    const issues = await run(implementation, evidence(true), scoped, { system: `${system}-other`, code: 'accepted' });
    expect(issues).toEqual(expected(false));
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', `${system}-other`, urls[1], 'R4');
  });

  it('preserves string input and exact canonical versions', async () => {
    const scoped = resolver('unverified', 'valid');
    vi.mocked(scoped.resolveCodeMembership).mockImplementation(async (code, codingSystem, url) =>
      code === 'DE' && codingSystem === undefined && url === urls[1] ? 'valid' : 'unverified');
    await expect(run(implementation, evidence(true), scoped, 'DE')).resolves.toEqual([]);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('DE', undefined, urls[1], 'R4');
  });

  it('accepts an absent optional element without a terminology call', async () => {
    const scoped = resolver('unverified', 'unverified');
    await expect(run(implementation, evidence(false), scoped, null)).resolves.toEqual([]);
    expect(scoped.resolveCodeMembership).not.toHaveBeenCalled();
  });

  it('does not swallow unexpected resolver failures as an invalid OR alternative', async () => {
    const scoped = resolver('invalid', 'valid');
    vi.mocked(scoped.resolveCodeMembership).mockRejectedValue(new Error('Controlled resolver failure'));
    const issues = await run(implementation, evidence(false), scoped);
    expect(issues).toEqual([expect.objectContaining({ severity: 'information',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });
});

describe('optional OR canonical/input guards', () => {
  it('preserves true OR empty without resolving an oversized canonical', async () => {
    const scoped = resolver('invalid', 'valid');
    expect(await evaluateAsyncFHIRPathTerminology({
      expression: `code.empty() or (code.memberOf('${'x'.repeat(2049)}') or code.memberOf('${urls[1]}'))`,
      context: { resourceType: 'Observation', code: { system, code: 'accepted' } },
      rootResource: {}, fhirVersion: 'R4', resolver: scoped,
    })).toEqual([true]);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledTimes(1);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, urls[1], 'R4');
  });
  it('retains the existing compiled path for multiple input values', async () => {
    const scoped = resolver('valid', 'valid');
    expect(await evaluateAsyncFHIRPathTerminology({
      expression: `code.empty() or (code.memberOf('${urls[0]}') or code.memberOf('${urls[1]}'))`,
      context: { resourceType: 'Observation', code: [{ system, code: 'accepted' }, { system, code: 'rejected' }] },
      rootResource: {}, fhirVersion: 'R4', resolver: scoped,
    })).toEqual([false]);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('rejected', system, urls[0], 'R4');
  });
});

function addressProfile(expression: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://records.test/Profile/address-union', name: 'AddressUnion',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient', snapshot: { element: [
      { id: 'Patient', path: 'Patient' }, { id: 'Patient.address', path: 'Patient.address', type: [{ code: 'Address' }],
        constraint: [{ key: 'indexed-union', severity: 'warning', human: 'Country membership', expression }] },
    ] } };
}

describe.each(['general', 'SD'] as const)('%s complex-context singleton index selection', implementation => {
  it.each(['valid', 'invalid', 'unverified'] as const)('selects scalar country[0] before resolver outcome %s', async outcome => {
    const profile = addressProfile(`country[0].empty() or (country[0].memberOf('${urls[0]}') or country[0].memberOf('${urls[1]}'))`);
    const resource = { resourceType: 'Patient', address: [{ country: 'XX' }] };
    const scoped = resolver('invalid', 'invalid');
    vi.mocked(scoped.resolveCodeMembership).mockResolvedValue(outcome);
    const issues = implementation === 'general'
      ? await new ConstraintValidator(scoped).validate(resource, profile.snapshot!.element, profile.url!)
      : await new SDFHIRPathExecutor().execute({ resource, resourceType: 'Patient', structureDef: profile, terminologyResolver: scoped });
    expect(issues).toEqual(outcome === 'valid' ? [] : [expect.objectContaining(outcome === 'invalid'
      ? { severity: 'warning', ruleId: 'indexed-union', path: 'Patient.address[0]' }
      : { severity: 'information', details: expect.objectContaining({ validationComplete: false }) })]);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('XX', undefined, urls[0], 'R4');
    if (outcome !== 'valid') expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('XX', undefined, urls[1], 'R4');
  });
  it('does not treat a metadata-only primitive as an absent optional selection', async () => {
    const profile = addressProfile(`country.empty() or (country.memberOf('${urls[0]}') or country.memberOf('${urls[1]}'))`);
    const resource = { resourceType: 'Patient', address: [{ _country: { extension: [{
      url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'masked',
    }] } }] };
    const scoped = resolver('valid', 'valid');
    const issues = implementation === 'general'
      ? await new ConstraintValidator(scoped).validate(resource, profile.snapshot!.element, profile.url!)
      : await new SDFHIRPathExecutor().execute({ resource, resourceType: 'Patient', structureDef: profile, terminologyResolver: scoped });
    expect(issues).toEqual([expect.objectContaining({ severity: 'information', ruleId: 'indexed-union',
      details: expect.objectContaining({ validationComplete: false }) })]);
    expect(scoped.resolveCodeMembership).not.toHaveBeenCalled();
  });

});

describe.each(['general', 'SD'] as const)('%s optional OR retains mixed primitive presence', implementation => {
  it('does not collapse actual plus metadata-only inputs to a verified singleton', async () => {
    const profile: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://records.test/Profile/mixed-union',
      name: 'MixedUnion', status: 'active', kind: 'resource', abstract: false, type: 'Patient', snapshot: { element: [
        { id: 'Patient', path: 'Patient', constraint: [{ key: 'mixed-union', severity: 'warning', human: 'Country membership',
          expression: `address.country.empty() or (address.country.memberOf('${urls[0]}') or address.country.memberOf('${urls[1]}'))` }] },
      ] } };
    const resource = { resourceType: 'Patient', address: [{ country: 'DE' }, { _country: { extension: [{
      url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'masked',
    }] } }] };
    const scoped = resolver('valid', 'valid');
    vi.mocked(scoped.resolveCodeMembership).mockResolvedValue('valid');
    const issues = implementation === 'general'
      ? await new ConstraintValidator(scoped).validate(resource, profile.snapshot!.element, profile.url!)
      : await new SDFHIRPathExecutor().execute({ resource, resourceType: 'Patient', structureDef: profile, terminologyResolver: scoped });
    expect(issues).toEqual([expect.objectContaining({ severity: 'information', ruleId: 'mixed-union',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });
});
