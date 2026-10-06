import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types';
import { ConstraintValidator } from './constraint-validator';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import { ValueSetCache } from './valueset-cache';
import { createMemberOfFunction } from './fhirpath-custom-functions';
import { evaluateOptionalMemberOfUnion } from './fhirpath-memberof-precheck';
import type { FHIRPathTerminologyResolver } from './fhirpath-terminology-types';

const known = 'https://example.test/ValueSet/memberof-complete';
const partial = 'https://example.test/ValueSet/memberof-partial';
const cold = 'https://example.test/ValueSet/memberof-cold';
const system = 'https://example.test/CodeSystem/memberof';
const implementations = ['general', 'StructureDefinition'] as const;
const shapes = ['simple', 'trailing', 'optional'] as const;

function evidence() {
  const cache = new ValueSetCache();
  for (const url of [known, partial]) {
    cache.setValueSetFile(`${url}|R4`, { resourceType: 'ValueSet', url, status: 'active',
      expansion: { total: url === partial ? 2 : 1, contains: [{ system, code: 'accepted' }] } });
    cache.setExpandedCodes(url, new Set([`${system}|accepted`, 'accepted']));
  }
  cache.setValueSetFile(`${cold}|R4`, null);
  return cache;
}

function profile(expression: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://example.test/Profile/memberof-evidence',
    name: 'MembershipEvidence', status: 'active', kind: 'resource', abstract: false, type: 'Observation',
    snapshot: { element: [{ id: 'Observation', path: 'Observation', constraint: [{
      key: 'membership-evidence', severity: 'error', human: 'Membership is required', expression,
    }] }] } };
}

function expression(shape: typeof shapes[number], url: string) {
  if (shape === 'simple') return `where(code.memberOf('${url}')).exists()`;
  if (shape === 'trailing') return `code.memberOf('${url}')`;
  return `code.empty() or (code.memberOf('${url}'))`;
}

function run(implementation: typeof implementations[number], cache: ValueSetCache, definition: StructureDefinition,
  coding: { system: string; code: string }, resolver?: FHIRPathTerminologyResolver) {
  const resource = { resourceType: 'Observation', code: coding };
  return implementation === 'general'
    ? new ConstraintValidator(resolver, undefined, cache).validate(resource, definition.snapshot!.element, definition.url!)
    : new SDFHIRPathExecutor(cache).execute({ resource, resourceType: 'Observation', structureDef: definition, terminologyResolver: resolver });
}

function resolver(outcome: 'valid' | 'invalid' | 'unverified'): FHIRPathTerminologyResolver {
  return { resolveCodeMembership: vi.fn().mockImplementation(async (code: string, codingSystem: string | undefined) =>
    code === 'accepted' && codingSystem === system ? 'valid' : outcome),
  resolveSubsumption: vi.fn().mockResolvedValue('unknown') };
}

describe.each(implementations)('%s local memberOf evidence', implementation => {
  it.each(shapes)('preserves accepted and wrong-system Coding identities through %s', async shape => {
    const cache = evidence();
    const definition = profile(expression(shape, known));
    await expect(run(implementation, cache, definition, { system, code: 'accepted' })).resolves.toEqual([]);
    const rejected = await run(implementation, cache, definition, { system: `${system}-other`, code: 'accepted' });
    expect(rejected).toEqual([expect.objectContaining({ severity: 'error', ruleId: 'membership-evidence' })]);
    expect(rejected[0].details?.validationComplete).not.toBe(false);
  });

  it.each(shapes)('keeps an unavailable partial-expansion miss incomplete through %s', async shape => {
    const rejected = await run(implementation, evidence(), profile(expression(shape, partial)), { system, code: 'missing' });
    expect(rejected).toEqual([expect.objectContaining({ severity: 'information', ruleId: 'membership-evidence',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });

  it.each(shapes)('uses the resolver to decide a partial-expansion miss through %s', async shape => {
    for (const outcome of ['valid', 'invalid', 'unverified'] as const) {
      const scoped = resolver(outcome);
      const issues = await run(implementation, evidence(), profile(expression(shape, partial)), { system, code: 'missing' }, scoped);
      if (outcome === 'valid') expect(issues).toEqual([]);
      else if (outcome === 'invalid') expect(issues).toEqual([expect.objectContaining({ severity: 'error', ruleId: 'membership-evidence' })]);
      else expect(issues).toEqual([expect.objectContaining({ severity: 'information', details: expect.objectContaining({ validationComplete: false }) })]);
      expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('missing', system, partial, 'R4');
    }
  });

  it.each(['valid', 'invalid', 'unverified'] as const)('does not decide an unknown OR branch before its %s resolver result', async outcome => {
    const scoped = resolver('invalid');
    vi.mocked(scoped.resolveCodeMembership).mockImplementation(async (_code, _system, url) => url === cold ? outcome : 'invalid');
    const definition = profile(`code.empty() or (code.memberOf('${known}') or code.memberOf('${cold}'))`);
    const issues = await run(implementation, evidence(), definition, { system, code: 'missing' }, scoped);
    if (outcome === 'valid') expect(issues).toEqual([]);
    else if (outcome === 'invalid') expect(issues).toEqual([expect.objectContaining({ severity: 'error' })]);
    else expect(issues).toEqual([expect.objectContaining({ severity: 'information', details: expect.objectContaining({ validationComplete: false }) })]);
    expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('missing', system, cold, 'R4');
  });

  it.each([false, true])('keeps a partial OR alternative incomplete with resolver=%s', async configured => {
    const scoped = configured ? resolver('unverified') : undefined;
    const definition = profile(`code.empty() or (code.memberOf('${partial}') or code.memberOf('${known}'))`);
    const issues = await run(implementation, evidence(), definition, { system, code: 'missing' }, scoped);
    expect(issues).toEqual([expect.objectContaining({ severity: 'information',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });

  it.each(['optional', 'trailing'] as const)('keeps cold %s membership incomplete without a resolver', async shape => {
    const constraintExpression = shape === 'trailing' ? expression(shape, cold)
      : `code.empty() or (code.memberOf('${known}') or code.memberOf('${cold}'))`;
    const issues = await run(implementation, evidence(), profile(constraintExpression), { system, code: 'missing' });
    expect(issues).toEqual([expect.objectContaining({ severity: 'information',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });

  it.each([false, true])('preserves proved OR membership with resolver=%s', async configured => {
    const cache = evidence();
    cache.setValueSetFile(`${partial}|R4`, { resourceType: 'ValueSet', url: partial, status: 'active',
      expansion: { total: 2, contains: [{ system, code: 'partial-only' }] } });
    cache.setExpandedCodes(partial, new Set([`${system}|partial-only`, 'partial-only']));
    const scoped = configured ? resolver('unverified') : undefined;
    if (scoped) vi.mocked(scoped.resolveCodeMembership).mockImplementation(async (_code, _system, url) =>
      url === known ? 'valid' : 'unverified');
    const definition = profile(`code.empty() or (code.memberOf('${partial}') or code.memberOf('${known}'))`);
    await expect(run(implementation, cache, definition, { system, code: 'accepted' }, scoped)).resolves.toEqual([]);
    if (scoped) {
      expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, partial, 'R4');
      expect(scoped.resolveCodeMembership).toHaveBeenCalledWith('accepted', system, known, 'R4');
    }
  });

  it.each([['code.exists()', true], ['code.empty()', false]] as const)(
    'evaluates non-membership constraint %s through the existing entry point', async (constraintExpression, expected) => {
      const issues = await run(implementation, evidence(), profile(constraintExpression), { system, code: 'accepted' });
      expect(issues).toEqual(expected ? [] : [expect.objectContaining({ severity: 'error', ruleId: 'membership-evidence' })]);
    });

  it('does not treat a commented memberOf as an expansion dependency', async () => {
    const constraintExpression = `code /* .memberOf('${partial}') */.memberOf('${known}')`;
    await expect(run(implementation, evidence(), profile(constraintExpression), { system, code: 'missing' }))
      .resolves.toEqual([expect.objectContaining({ severity: 'error', ruleId: 'membership-evidence' })]);
  });
});

describe('synchronous membership identities and OR truth table', () => {
  it('does not infer a supplied Coding system from a matching bare code', () => {
    expect(createMemberOfFunction(evidence()).fn([{ system: `${system}-other`, code: 'accepted' }], [known])).toEqual([false]);
  });
  it.each(['http://hl7.org/fhir/ValueSet/iso3166-1-2', 'http://hl7.org/fhir/ValueSet/iso3166-1-3'])('preserves Coding.system for %s', url => {
    const code = url.endsWith('-2') ? 'DE' : 'DEU';
    const fn = createMemberOfFunction(evidence()).fn;
    expect(fn([{ system: 'urn:iso:std:iso:3166', code }], [url])).toEqual([true]);
    expect(fn([{ system, code }], [url])).toEqual([false]);
  });
  it.each([['accepted', true], ['missing', null]] as const)('returns %s with a cold alternative', (code, expected) => {
    expect(evaluateOptionalMemberOfUnion(`code.empty() or (code.memberOf('${known}') or code.memberOf('${cold}'))`,
      { code: { system, code } }, evidence())).toBe(expected);
  });
});
