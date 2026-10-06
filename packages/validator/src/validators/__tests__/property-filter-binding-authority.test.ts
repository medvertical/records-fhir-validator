import { afterEach, describe, expect, it, vi } from 'vitest';
import ihe from './fixtures/ihe-property-codesystem.json';
import hl7 from './fixtures/hl7-format-valueset.json';
import participation from './fixtures/participation-property-codesystem.json';
import collision from './fixtures/uk-property-filter-collision.json';
import { conceptFilterMembership } from '../valueset-concept-filter-membership.js';
import { resolveVersionedLocalBinding } from '../valueset-versioned-local-binding.js';
import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver.js';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics.js';
import type { CodeBindingOutcome, CodeSystem, ValueSet, ValueSetComposeInclude } from '../valueset-types.js';

type Filter = NonNullable<ValueSetComposeInclude['filter']>[number];
const system = ihe.url;
const active = 'urn:ihe:pcc:xphr:2007';
const status: Filter = { property: 'status', op: '=', value: 'active' };
const opaque: Filter = { property: 'opaque', op: '=', value: 'x' };
const modifierExtension = [{ url: 'https://example.test/unknown-meaning', valueBoolean: true }];
function changed(overrides: Record<string, unknown> = {}): CodeSystem {
  return { ...structuredClone(ihe), ...overrides } as CodeSystem;
}
function factSystem(facts: unknown[], definitions: unknown[] = [{ code: 'status', type: 'code' }]): CodeSystem {
  return changed({ property: definitions, concept: [{ code: active, property: facts }] });
}
function harness(cs: CodeSystem = changed(), include?: ValueSetComposeInclude[], exclude?: ValueSetComposeInclude[]) {
  const vs: ValueSet = include ? { ...hl7, compose: { include, exclude } } : structuredClone(hl7);
  const loader = {
    loadCodeSystem: vi.fn(async (): Promise<CodeSystem | null> => cs),
    loadCodeSystemForValueSet: vi.fn(async (_vs?: ValueSet, _system?: string, _fhir?: string, _version?: string): Promise<CodeSystem | null> => cs),
    loadValueSetResource: vi.fn(async (): Promise<ValueSet | null> => vs),
    getIncludeConceptFilters: vi.fn(async () => [{ system, filter: [status] }]),
    getUnenumerableSystemIncludes: vi.fn(async () => []), hasIncompleteExpansion: vi.fn(async () => false),
    getComposeSystems: vi.fn(async () => [system]), hasHostPackageScope: () => false,
  };
  const deps: Parameters<typeof resolveValueSetCodeBinding>[0] = {
    packageLoader: loader as never,
    resolutionConfig: { strategy: 'local-only', serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0 } },
    getExpandedValueSet: vi.fn(async () => new Set<string>()), hasTerminologyServer: () => false,
    resolveServerForSystem: () => undefined, terminologyDiagnostics: createEmptyTerminologyDiagnostics(),
    twoPhaseShadow: { lookup: vi.fn(async () => undefined), getEnforcedResult: () => undefined, finish: (_lookup: unknown, result: boolean) => result } as never,
    validateViaServer: vi.fn(async (): Promise<CodeBindingOutcome> => 'unverified'), recordUnverifiedBinding: vi.fn(),
  };
  return { cs, vs, loader, deps, exact: (code = active, version = cs.version!) => resolveVersionedLocalBinding(loader, code, system, version, hl7.url, 'R4'),
    unversioned: (code = active) => resolveValueSetCodeBinding(deps, code, system, hl7.url, 'required', 'R4') };
}
afterEach(() => vi.restoreAllMocks());
describe('genuine selected scalar property facts', () => {
  it('IHE status=active is witnessed without an is-a hierarchy or an active concept', () => {
    expect(ihe.hierarchyMeaning).toBe('grouped-by');
    expect(conceptFilterMembership(changed(), active, status)).toBe(true);
  });
  it.each(['1.3.6.1.4.1.19376.1.5.3.1.1.5', '1.3.6.1.4.1.19376.1.5.3.1.1.6'])('repeated genuine comment %s is existential', value => {
    for (const reverse of [false, true]) {
      const cs = changed();
      const concept = cs.concept?.find(entry => entry.code === active);
      if (reverse) concept?.property?.reverse();
      expect(conceptFilterMembership(cs, active, { property: 'comment', op: '=', value })).toBe(true);
    }
  });
  it('genuine explicit Boolean false is not a string truthiness test', () => {
    expect(conceptFilterMembership(participation as CodeSystem, 'ADM', { property: 'conductible', op: '=', value: 'false' })).toBe(true);
    expect(conceptFilterMembership(participation as CodeSystem, 'ADM', { property: 'conductible', op: '=', value: 'true' })).toBeNull();
  });
  it.each(['exact', 'unversioned'] as const)('%s owner selects genuine HL7/IHE cold/warm without expansion', async owner => {
    const check = harness();
    for (let round = 0; round < 2; round++) await expect(owner === 'exact' ? check.exact() : check.unversioned()).resolves.toBe('valid');
    expect(check.deps.getExpandedValueSet).not.toHaveBeenCalled();
    if (owner === 'unversioned') expect(check.loader.loadCodeSystemForValueSet).toHaveBeenCalledWith(check.vs, system, 'R4', undefined);
  });
});
describe('property authority guards', () => {
  it.each(['complete', 'fragment'] as const)('%s does not certify absence or all repeated values', content => {
    const cs = factSystem([{ code: 'status', valueCode: 'deprecated' }]); cs.content = content;
    expect(conceptFilterMembership(cs, active, status)).toBeNull();
    expect(conceptFilterMembership(cs, 'missing', status)).toBeNull();
    Object.assign(cs, { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/codesystem-properties-mode', valueCode: 'complete' }] });
    expect(conceptFilterMembership(cs, active, status)).toBeNull();
  });
  const cases: Array<[string, CodeSystem, Filter?]> = [
    ['missing property', factSystem([])],
    ['undeclared property', factSystem([{ code: 'status', valueCode: 'active' }], [])],
    ['duplicate definition', factSystem([{ code: 'status', valueCode: 'active' }], [{ code: 'status', type: 'code' }, { code: 'status', type: 'code' }])],
    ['definition modifier', factSystem([{ code: 'status', valueCode: 'active' }], [{ code: 'status', type: 'code', modifierExtension }])],
    ['object type cannot coerce', factSystem([{ code: 'status', valueCode: 'active' }], [{ code: 'status', type: { toString: 'code' } }])],
    ['empty URI', factSystem([{ code: 'status', valueCode: 'active' }], [{ code: 'status', type: 'code', uri: '' }])],
    ['ambiguous value[x]', factSystem([{ code: 'status', valueCode: 'active', valueString: 'active' }])],
    ['wrong typed value', factSystem([{ code: 'status', valueString: 'active' }])],
    ['CodeSystem modifier', changed({ modifierExtension })],
    ['concept modifier', changed({ concept: [{ code: active, modifierExtension, property: [{ code: 'status', valueCode: 'active' }] }] })],
    ['fact modifier', factSystem([{ code: 'status', valueCode: 'active', modifierExtension }])],
    ['duplicate concept', changed({ concept: [{ code: active, property: [{ code: 'status', valueCode: 'active' }] }, { code: active }] })],
    ['case collision', changed({ caseSensitive: false, concept: [{ code: active, property: [{ code: 'status', valueCode: 'active' }] }, { code: active.toUpperCase() }] })],
    ['not-present', changed({ content: 'not-present' })], ['supplement', changed({ content: 'supplement' })], ['example', changed({ content: 'example' })],
    ['malformed filter container', changed({ filter: {} })], ['malformed custom filter', changed({ filter: [null] })],
    ['same-code custom filter', changed({ filter: [{ code: 'status', operator: ['='], value: 'Custom semantics' }] })],
    ['unsupported operator', changed(), { ...status, op: 'in' }],
    ['filter modifier', changed(), { ...status, modifierExtension } as Filter],
  ];
  it.each(cases)('%s remains U', (_name, cs, filter) => expect(conceptFilterMembership(cs, active, filter ?? status)).toBeNull());
  it.each([false, true])('duplicate concept stays U with shared-reference=%s', shared => {
    const concept = { code: active, property: [{ code: 'status', valueCode: 'active' }] };
    expect(conceptFilterMembership(changed({ concept: [concept, shared ? concept : structuredClone(concept)] }), active, status)).toBeNull();
  });
  it('a repeated shared subtree cannot hide duplicate child concepts', () => {
    const parent = { code: 'parent', concept: [{ code: active, property: [{ code: 'status', valueCode: 'active' }] }] };
    expect(conceptFilterMembership(changed({ concept: [parent, parent] }), active, status)).toBeNull();
  });
  it.each([false, true])('a shared child under a modified parent remains U with modified-first=%s', modifiedFirst => {
    const concept = { code: active, property: [{ code: 'status', valueCode: 'active' }] };
    const modifiedParent = { code: 'parent', modifierExtension, concept: [concept] };
    expect(conceptFilterMembership(changed({ concept: modifiedFirst ? [modifiedParent, concept] : [concept, modifiedParent] }), active, status)).toBeNull();
  });
  it.each([false, true])('a parent modifier taints its descendants with sibling-first=%s', siblingFirst => {
    const target = { code: active, property: [{ code: 'status', valueCode: 'active' }] };
    const parent = { code: 'parent', modifierExtension, concept: [{ code: 'middle', concept: [target] }] };
    const sibling = { code: 'sibling', property: [{ code: 'status', valueCode: 'active' }] };
    const cs = changed({ concept: siblingFirst ? [sibling, parent] : [parent, sibling] });
    expect(conceptFilterMembership(cs, active, status)).toBeNull();
    expect(conceptFilterMembership(cs, 'sibling', status)).toBe(true);
  });
  it('genuine UK custom filter collision remains U', () => {
    expect(conceptFilterMembership(collision as CodeSystem, 'married-or-civil-partner', { property: 'ApplicableCountry', op: '=', value: 'England' })).toBeNull();
  });
  it('an unrelated declared custom filter does not erase a trusted fact', () => {
    expect(conceptFilterMembership(changed({ filter: [{ code: 'unrelated', operator: ['='], value: 'Other semantics' }] }), active, status)).toBe(true);
  });
  it.each([null, { code: 'status', valueString: 'active' }, { code: 'status', valueCode: 'active', modifierExtension }])('trusted matching sibling survives an unknown row %j in both orders', unknown => {
    const trusted = { code: 'status', valueCode: 'active' };
    for (const facts of [[unknown, trusted], [trusted, unknown]]) expect(conceptFilterMembership(factSystem(facts), active, status)).toBe(true);
  });
  it.each(['code', 'string'] as const)('%s equality keeps case and whitespace', type => {
    const cs = factSystem([{ code: 'status', [type === 'code' ? 'valueCode' : 'valueString']: 'active' }], [{ code: 'status', type }]);
    expect(conceptFilterMembership(cs, active, status)).toBe(true);
    for (const value of ['Active', ' active', 'active ']) expect(conceptFilterMembership(cs, active, { ...status, value })).toBeNull();
  });
  it.each(['false', 'true'])('Boolean literal %s needs the actual Boolean type', value => {
    const cs = factSystem([{ code: 'status', valueBoolean: value === 'true' }], [{ code: 'status', type: 'boolean' }]);
    expect(conceptFilterMembership(cs, active, { ...status, value })).toBe(true);
    cs.concept![0].property = [{ code: 'status', valueBoolean: value } as never];
    expect(conceptFilterMembership(cs, active, { ...status, value })).toBeNull();
  });
  it.each(['FALSE', '0', ' true ', ''])('invalid Boolean literal %j stays U', value => {
    expect(conceptFilterMembership(factSystem([{ code: 'status', valueBoolean: false }], [{ code: 'status', type: 'boolean' }]), active, { ...status, value })).toBeNull();
  });
  it.each([
    ['Coding', { valueCoding: { system: 'https://foreign.test', version: 'other', code: 'active' } }, 'active'],
    ['integer', { valueInteger: 1 }, '1'], ['decimal', { valueDecimal: 1.5 }, '1.5'],
    ['dateTime', { valueDateTime: '2020-01-01' }, '2020-01-01'],
  ])('%s is not coerced to a code-only fact', (type, fact, value) => {
    expect(conceptFilterMembership(factSystem([{ code: 'status', ...fact as object }], [{ code: 'status', type }]), active, { ...status, value: value as string })).toBeNull();
  });
});
describe('property compose algebra and selected editions', () => {
  it.each([
    ['P AND known concept N', [{ system, filter: [status, { property: 'concept', op: '=', value: 'urn:ihe:qrph:mch:2009' }] }], 'invalid'],
    ['P AND U', [{ system, filter: [status, opaque] }], 'unverified'],
    ['false AND U', [{ system, concept: [{ code: 'other' }], filter: [opaque] }], 'invalid'],
    ['P OR U', [{ system, filter: [status] }, { system, filter: [opaque] }], 'valid'],
    ['N OR U', [{ system, concept: [{ code: 'other' }], filter: [status] }, { system, filter: [opaque] }], 'unverified'],
    ['systemless property', [{ filter: [status] }], 'unverified'],
  ] as const)('%s under exact/unversioned', async (_name, entries, outcome) => {
    const check = harness(changed(), structuredClone(entries) as ValueSetComposeInclude[]);
    await expect(check.exact()).resolves.toBe(outcome); await expect(check.unversioned()).resolves.toBe(outcome);
  });
  it.each([true, false])('known exclusion=%s cannot be bypassed by a legacy expansion hit', async known => {
    const check = harness(changed(), [{ system, filter: [status] }], [{ system, ...(known ? { concept: [{ code: active }] } : { filter: [opaque] }) }]);
    vi.mocked(check.deps.getExpandedValueSet).mockResolvedValue(new Set([`${system}|${active}`]));
    await expect(check.exact()).resolves.toBe(known ? 'invalid' : 'unverified');
    await expect(check.unversioned()).resolves.toBe(known ? 'invalid' : 'unverified');
  });
  it('a foreign-edition exclusion cannot erase included edition A', async () => {
    const a = changed({ version: 'A' }); const b = changed({ version: 'B' });
    const check = harness(a, [{ system, version: 'A', filter: [status] }], [{ system, version: 'B', concept: [{ code: active }] }]);
    check.loader.loadCodeSystemForValueSet.mockImplementation(async (_vs, _system, _fhir, version) => version === 'B' ? b : a);
    await expect(check.unversioned()).resolves.toBe('valid');
  });
  it('missing exact edition cannot borrow a bare selected source', async () => {
    await expect(harness().exact(active, 'missing')).resolves.toBe('unverified');
  });
  it('a new unversioned invocation cannot reuse an earlier source fact', async () => {
    const check = harness(); await expect(check.unversioned()).resolves.toBe('valid');
    check.loader.loadCodeSystemForValueSet.mockResolvedValue(factSystem([{ code: 'status', valueCode: 'deprecated' }]));
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
});
