import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import { ValueSetCache } from './valueset-cache';
import type { FHIRPathTerminologyResolver } from './fhirpath-terminology-types';

const canonical = 'https://example.test/ValueSet/optional-resolver';
const system = 'https://example.test/CodeSystem/optional-resolver';
type Outcome = 'valid' | 'invalid' | 'unverified';
type Coding = { system: string; code: string; version?: string };

function seed(cache: ValueSetCache, url: string, code: string, version?: string, codingVersion?: string) {
  cache.setExpandedCodes(url, new Set([`${system}|${code}`, code]));
  cache.setValueSetFile(url.includes('|') ? url : `${url}|R4`, {
    resourceType: 'ValueSet', url: url.split('|')[0], status: 'active', version,
    expansion: { total: 1, contains: [{ system, code, version: codingVersion }] },
  });
}

function scopedResolver(outcome: Outcome, requested: string): FHIRPathTerminologyResolver {
  return { resolveCodeMembership: vi.fn().mockImplementation(async (code, codingSystem, url) =>
    code === 'accepted' && codingSystem === system && url === requested ? outcome : 'invalid'),
  resolveSubsumption: vi.fn().mockResolvedValue('unknown') };
}

async function execute(cache: ValueSetCache, codings: Coding[], requested: string,
  resolver?: FHIRPathTerminologyResolver, path = 'code', property = 'code') {
  const expression = `${path}.empty() or (${path}.memberOf('${requested}'))`;
  const definition: StructureDefinition = {
    resourceType: 'StructureDefinition', url: 'https://example.test/Profile/optional-resolver',
    name: 'OptionalResolver', status: 'active', kind: 'resource', abstract: false, type: 'Observation',
    snapshot: { element: [{ id: 'Observation', path: 'Observation', constraint: [{
      key: 'optional-resolver', severity: 'error', human: 'Membership required', expression,
    }] }] },
  };
  return new SDFHIRPathExecutor(cache).execute({
    resource: { resourceType: 'Observation', [property]: { coding: codings } },
    resourceType: 'Observation', structureDef: definition, terminologyResolver: resolver,
  });
}

function expectedIssues(outcome: Outcome) {
  if (outcome === 'valid') return [];
  return [expect.objectContaining(outcome === 'invalid'
    ? { severity: 'error', ruleId: 'optional-resolver' }
    : { severity: 'information', ruleId: 'optional-resolver', details: expect.objectContaining({ validationComplete: false }) })];
}

describe('SD optional membership preserves configured resolver ownership', () => {
  it.each(['valid', 'invalid', 'unverified'] as const)('decides all Codings with resolver result %s in either order', async outcome => {
    for (const codes of [['outside', 'accepted'], ['accepted', 'outside']]) {
      const cache = new ValueSetCache();
      seed(cache, canonical, 'accepted');
      const resolver = scopedResolver(outcome, canonical);
      await expect(execute(cache, codes.map(code => ({ system, code })), canonical, resolver)).resolves.toEqual(expectedIssues(outcome));
      expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, canonical, 'R4');
      if (codes[0] === 'outside' || outcome !== 'valid') {
        expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('outside', system, canonical, 'R4');
      }
    }
  });

  it('rejects a collection with no accepted Coding through the resolver', async () => {
    const cache = new ValueSetCache();
    seed(cache, canonical, 'accepted');
    const resolver = scopedResolver('valid', canonical);
    await expect(execute(cache, [{ system, code: 'outside' }, { system, code: 'other' }], canonical, resolver))
      .resolves.toEqual(expectedIssues('invalid'));
    expect(resolver.resolveCodeMembership).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['accepted', 'requested-only', 'invalid'],
    ['old-only', 'accepted', 'valid'],
    ['accepted', 'accepted', 'unverified'],
  ] as const)('keeps requested ValueSet version with base=%s and requested=%s', async (baseCode, requestedCode, outcome) => {
    const requested = `${canonical}|2.0.0`;
    const cache = new ValueSetCache();
    seed(cache, canonical, baseCode, '1.0.0');
    seed(cache, requested, requestedCode, '2.0.0');
    const resolver = scopedResolver(outcome, requested);
    await expect(execute(cache, [{ system, code: 'accepted' }], requested, resolver)).resolves.toEqual(expectedIssues(outcome));
    expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, requested, 'R4');
  });

  it.each(['valid', 'invalid', 'unverified'] as const)('defers input Coding version to resolver result %s', async outcome => {
    const cache = new ValueSetCache();
    seed(cache, canonical, 'accepted', undefined, '1.0.0');
    const resolver = scopedResolver(outcome, canonical);
    await expect(execute(cache, [{ system, version: '2.0.0', code: 'accepted' }], canonical, resolver))
      .resolves.toEqual(expectedIssues(outcome));
    // The existing resolver API does not carry Coding.version; local evidence cannot suppress its outcome.
    expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, canonical, 'R4');
  });

  it.each([false, true])('evaluates resource-type-prefixed paths with warm cache=%s', async warm => {
    for (const outcome of ['valid', 'invalid', 'unverified'] as const) {
      const cache = new ValueSetCache();
      if (warm) seed(cache, canonical, 'accepted');
      else cache.setValueSetFile(`${canonical}|R4`, null);
      const resolver = scopedResolver(outcome, canonical);
      await expect(execute(cache, [{ system, code: 'accepted' }], canonical, resolver, 'Observation.code'))
        .resolves.toEqual(expectedIssues(outcome));
      expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, canonical, 'R4');
    }
  });

  it.each([false, true])('evaluates model choice paths with warm cache=%s', async warm => {
    for (const outcome of ['valid', 'invalid', 'unverified'] as const) {
      const cache = new ValueSetCache();
      if (warm) seed(cache, canonical, 'accepted');
      else cache.setValueSetFile(`${canonical}|R4`, null);
      const resolver = scopedResolver(outcome, canonical);
      await expect(execute(cache, [{ system, code: 'accepted' }], canonical, resolver, 'value', 'valueCodeableConcept'))
        .resolves.toEqual(expectedIssues(outcome));
      expect(resolver.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, canonical, 'R4');
    }
  });

  it.each([['Observation.code', 'code'], ['value', 'valueCodeableConcept']] as const)(
    'uses model path %s without a resolver', async (path, property) => {
      for (const [warm, code, outcome] of [[true, 'accepted', 'valid'], [true, 'outside', 'invalid'],
        [false, 'outside', 'unverified']] as const) {
        const cache = new ValueSetCache();
        if (warm) seed(cache, canonical, 'accepted');
        else cache.setValueSetFile(`${canonical}|R4`, null);
        await expect(execute(cache, [{ system, code }], canonical, undefined, path, property)).resolves.toEqual(expectedIssues(outcome));
      }
    });
});
