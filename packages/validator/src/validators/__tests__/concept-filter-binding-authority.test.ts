import { afterEach, describe, expect, it, vi } from 'vitest';
import published from './fixtures/ips-contact-codesystem.json';
import publishedValueSet from './fixtures/ips-contact-valueset.json';
import core from './fixtures/core-contact-codesystem.json';
import { resolveVersionedLocalBinding } from '../valueset-versioned-local-binding.js';
import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver.js';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { TerminologyApiClient } from '../terminology-api-client.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import type { CodeBindingOutcome, CodeSystem, ValueSet, ValueSetComposeInclude } from '../valueset-types.js';

const system = published.url;
const url = publishedValueSet.url;
const filter = { property: 'concept', op: 'is-not-a', value: 'O' };
const unknown = { property: 'opaque', op: '=', value: 'x' };
function harness(cs: CodeSystem = published as CodeSystem, entries: ValueSetComposeInclude[] = [{ system, filter: [filter] }], excludes?: ValueSetComposeInclude[]) {
  const vs: ValueSet = { ...publishedValueSet, compose: { include: entries, exclude: excludes } };
  const loader = { loadCodeSystem: vi.fn(async (): Promise<CodeSystem | null> => cs),
    loadCodeSystemForValueSet: vi.fn(async (_vs?: ValueSet, _system?: string, _fhir?: string, _version?: string): Promise<CodeSystem | null> => cs),
    loadValueSetResource: vi.fn(async (): Promise<ValueSet | null> => vs),
    getIncludeConceptFilters: vi.fn(async () => [{ system, filter: [filter] }]),
    getUnenumerableSystemIncludes: vi.fn(async () => []), hasIncompleteExpansion: vi.fn(async () => false),
    getComposeSystems: vi.fn(async () => [system]), hasHostPackageScope: () => false };
  const finish = vi.fn((_lookup: unknown, result: boolean) => result);
  const deps: Parameters<typeof resolveValueSetCodeBinding>[0] = {
    packageLoader: loader as never, resolutionConfig: { strategy: 'local-only', serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0 } },
    getExpandedValueSet: vi.fn(async () => new Set<string>()), hasTerminologyServer: () => false,
    resolveServerForSystem: () => undefined, terminologyDiagnostics: createEmptyTerminologyDiagnostics(),
    twoPhaseShadow: { lookup: vi.fn(async () => undefined), getEnforcedResult: () => undefined, finish } as never,
    validateViaServer: vi.fn(async (): Promise<CodeBindingOutcome> => 'unverified'), recordUnverifiedBinding: vi.fn(),
  };
  return { cs, vs, loader, deps, finish, exact: (code = 'N', version = cs.version ?? 'missing') =>
    resolveVersionedLocalBinding(loader, code, system, version, url, 'R4'),
    unversioned: (code = 'N') => resolveValueSetCodeBinding(deps, code, system, url, 'required', 'R4') };
}
function graph(overrides: Record<string, unknown> = {}): CodeSystem {
  return { ...published, concept: [{ code: 'O', concept: [{ code: 'child' }] }, { code: 'N' }, { code: 'C' }], ...overrides } as CodeSystem;
}
afterEach(() => vi.restoreAllMocks());
describe('selected genuine concept-filter membership', () => {
  it.each([['N', 'valid', 'exact'], ['C', 'valid', 'exact'], ['O', 'invalid', 'exact'], ['N', 'valid', 'unversioned'], ['C', 'valid', 'unversioned'], ['O', 'invalid', 'unversioned']] as const)('%s -> %s in %s cold/warm calls', async (code, outcome, owner) => {
    const check = harness();
    for (let round = 0; round < 2; round++) {
      await expect(owner === 'exact' ? check.exact(code) : check.unversioned(code)).resolves.toBe(outcome);
    }
    expect(check.deps.getExpandedValueSet).not.toHaveBeenCalled();
    if (owner === 'unversioned') expect(check.loader.loadCodeSystemForValueSet).toHaveBeenCalledWith(check.vs, system, 'R4', undefined);
  });
  it('does not borrow explicit hierarchy authority from THO for core2.9', async () => {
    const check = harness(core as CodeSystem);
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it.each(['not-present', 'supplement', 'example', undefined] as const)('cannot close a %s complement', async content => {
    await expect(harness(graph({ content })).exact()).resolves.toBe('unverified');
  });
  it.each(['part-of', 'grouped-by', undefined])('cannot close %s hierarchy', async hierarchyMeaning => {
    await expect(harness(graph({ hierarchyMeaning })).exact()).resolves.toBe('unverified');
  });
  it.each(['missing-root', 'missing-code'])('keeps %s unknown', async cause => {
    const check = harness(graph(), [{ system, filter: [{ ...filter, value: cause === 'missing-root' ? 'absent' : 'O' }] }]);
    await expect(check.exact(cause === 'missing-code' ? 'absent' : 'N')).resolves.toBe('unverified');
  });
  it.each(['complete', 'fragment'] as const)('observed descendant N survives %s content; missing path only closes complete', async content => {
    const check = harness(graph({ content }));
    await expect(check.exact('child')).resolves.toBe('invalid');
    await expect(check.exact('N')).resolves.toBe(content === 'complete' ? 'valid' : 'unverified');
  });
  it.each(['=', 'is-a', 'descendent-of', 'is-not-a'])('known identity has normative %s semantics without inferred edges', async op => {
    const check = harness(graph({ content: 'fragment', hierarchyMeaning: undefined }), [{ system, filter: [{ ...filter, op }] }]);
    await expect(check.exact('O')).resolves.toBe(op === '=' || op === 'is-a' ? 'valid' : 'invalid');
  });
});
describe('filter and compose authority owners', () => {
  it.each([true, false])('unknown entry modifier blocks authoritative %s include/exclude decisions', async excluding => {
    const altered = { system, version: 'other', concept: [{ code: 'O' }], modifierExtension: [{ url: 'https://unknown.test', valueBoolean: true }] };
    const check = harness(graph(), excluding ? [{ system, filter: [filter] }] : [altered], excluding ? [altered] : undefined);
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it('conflicting literal and piped edition pins stay unknown', async () => {
    const check = harness(graph(), [{ system: `${system}|other`, version: published.version, filter: [filter] }]);
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it('whole-system alternatives cannot use a CodeSystem with unknown modifiers', async () => {
    const check = harness(graph({ modifierExtension: [{ url: 'https://unknown.test', valueBoolean: true }] }), [{ system }, { system, filter: [filter] }]);
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it('system-less concept filter cannot borrow Coding.system', async () => {
    const check = harness(graph(), [{ filter: [filter] }]);
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it.each(['filter', 'entry', 'compose', 'valueset'])('%s unknown modifier cannot fabricate P', async owner => {
    const modifierExtension = [{ url: 'https://unknown.test/meaning', valueBoolean: true }];
    const altered = owner === 'filter' ? { ...filter, modifierExtension } : filter;
    const check = harness(graph(), [{ system, filter: [altered], ...(owner === 'entry' ? { modifierExtension } : {}) }]);
    if (owner === 'compose') Object.assign(check.vs.compose!, { modifierExtension });
    if (owner === 'valueset') Object.assign(check.vs, { modifierExtension });
    await expect(check.exact()).resolves.toBe('unverified');
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
});
describe('relationship representation guards', () => {
  const parentUri = 'http://hl7.org/fhir/concept-properties#parent';
  const mutations: Array<[string, Record<string, unknown>]> = [
    ['foreign parent', { property: [{ code: 'parent', uri: parentUri, type: 'Coding' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCoding: { system: 'https://other.test', code: 'O' } }] }] }],
    ['wrong parent edition', { property: [{ code: 'parent', uri: parentUri, type: 'Coding' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCoding: { system, version: 'other', code: 'O' } }] }] }],
    ['conflicting parent URI', { property: [{ code: 'parent', uri: 'https://other.test/relation', type: 'code' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCode: 'O' }] }] }],
    ['dangling parent', { property: [{ code: 'parent', uri: parentUri, type: 'code' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCode: 'absent' }] }] }],
    ['ambiguous value', { property: [{ code: 'parent', uri: parentUri, type: 'code' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCode: 'O', valueString: 'O' }] }] }],
    ['duplicate concept', { concept: [{ code: 'O' }, { code: 'N' }, { code: 'N' }] }],
    ['unknown hierarchy extension', { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/codesystem-subsumes', valueCode: 'O' }] }],
    ['modifier', { modifierExtension: [{ url: 'https://unknown.test', valueBoolean: true }] }],
    ['cycle', { property: [{ code: 'parent', uri: parentUri, type: 'code' }], concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'parent', valueCode: 'C' }] }, { code: 'C', property: [{ code: 'parent', valueCode: 'N' }] }] }],
  ];
  it.each(mutations)('%s prevents absence-based P', async (_name, mutation) => {
    await expect(harness(graph(mutation)).exact()).resolves.toBe('unverified');
  });
  it('unknown relation-definition modifiers cannot create an observed edge', async () => {
    const check = harness(graph({ property: [{ code: 'p', uri: parentUri, type: 'code', modifierExtension: [{ url: 'https://unknown.test', valueBoolean: true }] }],
      concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'p', valueCode: 'O' }] }] }));
    await expect(check.exact()).resolves.toBe('unverified');
  });
  it('an undeclared relationship representation blocks a complement without guessing an edge', async () => {
    const check = harness(graph({ concept: [{ code: 'O' }, { code: 'N', property: [{ code: 'subsumedBy', valueCode: 'O' }] }] }));
    await expect(check.exact()).resolves.toBe('unverified');
  });
  it.each(['code', 'Coding'] as const)('recognizes a declared %s parent in the actual edition', async type => {
    const property = type === 'code' ? { code: 'p', valueCode: 'O' } : { code: 'p', valueCoding: { system, version: published.version, code: 'O' } };
    const check = harness(graph({ property: [{ code: 'p', uri: parentUri, type }], concept: [{ code: 'O' }, { code: 'N', property: [property] }] }));
    await expect(check.exact()).resolves.toBe('invalid');
  });
  it('recognizes declared child edges, without making fragment absence authoritative', async () => {
    const check = harness(graph({ content: 'fragment', property: [{ code: 'c', uri: 'http://hl7.org/fhir/concept-properties#child', type: 'code' }],
      concept: [{ code: 'O', property: [{ code: 'c', valueCode: 'N' }] }, { code: 'N' }, { code: 'C' }] }));
    await expect(check.exact('N')).resolves.toBe('invalid');
    await expect(check.exact('C')).resolves.toBe('unverified');
  });
});
describe('compose algebra, actual editions and provider ordering', () => {
  it('a complete descendent-of leaf has known empty selection N', async () => {
    const check = harness(graph(), [{ system, filter: [{ ...filter, op: 'descendent-of', value: 'N' }] }]);
    await expect(check.unversioned('C')).resolves.toBe('invalid');
  });
  it.each([['false AND U', [{ system, concept: [{ code: 'O' }], filter: [unknown] }], 'invalid'],
    ['P OR U', [{ system, filter: [filter] }, { system, filter: [unknown] }], 'valid'],
    ['N OR U', [{ system, concept: [{ code: 'O' }], filter: [filter] }, { system, filter: [unknown] }], 'unverified']] as const)('%s', async (_name, entries, outcome) => {
    const check = harness(published as CodeSystem, structuredClone(entries) as ValueSetComposeInclude[]);
    await expect(check.exact()).resolves.toBe(outcome);
    await expect(check.unversioned()).resolves.toBe(outcome);
  });
  it.each([true, false])('exclusion known=%s is not ignored by a legacy expansion hit', async known => {
    const check = harness(published as CodeSystem, [{ system, filter: [filter] }], [{ system, filter: known ? [{ ...filter, op: '=', value: 'N' }] : [unknown] }]);
    vi.mocked(check.deps.getExpandedValueSet).mockResolvedValue(new Set([`${system}|N`]));
    await expect(check.unversioned()).resolves.toBe(known ? 'invalid' : 'unverified');
  });
  it('does not erase included edition A with an exclusion pinned to edition B', async () => {
    const a = graph({ version: 'A' }); const b = graph({ version: 'B' });
    const check = harness(a, [{ system, version: 'A', filter: [filter] }], [{ system, version: 'B', concept: [{ code: 'N' }] }]);
    check.loader.loadCodeSystemForValueSet.mockImplementation(async (_vs?: ValueSet, _system?: string, _fhir?: string, version?: string) => version === 'B' ? b : a);
    await expect(check.unversioned()).resolves.toBe('valid');
    check.vs.compose!.exclude = [{ system, filter: [{ ...filter, op: '=', value: 'N' }] }];
    await expect(check.unversioned()).resolves.toBe('invalid');
  });
  it('does not borrow an alternative edition, or reuse a warmed graph after the selected source changes', async () => {
    const a = graph({ version: 'A' }); const b = graph({ version: 'B', concept: [{ code: 'O', concept: [{ code: 'N' }] }] });
    const check = harness(a, [{ system, version: 'A', filter: [filter] }, { system, version: 'B', filter: [filter] }]);
    check.loader.loadCodeSystemForValueSet.mockImplementation(async (_vs?: ValueSet, _system?: string, _fhir?: string, version?: string) => version === 'A' ? a : b);
    await expect(check.unversioned()).resolves.toBe('valid');
    check.vs.compose!.include = [{ system, version: 'B', filter: [filter] }, { system, version: 'missing', filter: [filter] }];
    check.loader.loadCodeSystemForValueSet.mockImplementation(async (_vs?: ValueSet, _system?: string, _fhir?: string, version?: string) => version === 'B' ? b : null);
    await expect(check.unversioned()).resolves.toBe('unverified');
    check.vs.compose!.include = [{ system, version: '*', filter: [filter] }];
    check.loader.loadCodeSystemForValueSet.mockResolvedValue(a);
    await expect(check.unversioned()).resolves.toBe('valid');
    check.loader.loadCodeSystemForValueSet.mockResolvedValue({ ...a, concept: b.concept });
    await expect(check.unversioned()).resolves.toBe('invalid');
  });
  it.each(['local-first', 'local-only', 'server-first'] as const)('known N under %s with remote U', async strategy => {
    const check = harness(); check.deps.resolutionConfig = { strategy, serverDelegation: { expandValueSets: false, validateCodes: true, cacheResults: false, cacheTTLSeconds: 0 } };
    check.deps.hasTerminologyServer = () => true;
    await expect(check.unversioned('O')).resolves.toBe('invalid');
    expect(check.deps.validateViaServer).toHaveBeenCalledTimes(strategy === 'server-first' ? 1 : 0);
    expect(check.finish).toHaveBeenCalledTimes(1);
  });
  it.each(['valid', 'invalid'] as const)('genuine server-first %s precedes local opposite evidence', async remote => {
    const check = harness(); check.deps.resolutionConfig = { strategy: 'server-first', serverDelegation: { expandValueSets: false, validateCodes: true, cacheResults: false, cacheTTLSeconds: 0 } };
    check.deps.hasTerminologyServer = () => true;
    vi.mocked(check.deps.validateViaServer).mockResolvedValue(remote);
    await expect(check.unversioned(remote === 'valid' ? 'O' : 'N')).resolves.toBe(remote);
    expect(check.finish).toHaveBeenCalledTimes(1);
  });
  it('unfiltered literal expansion P requires no new CodeSystem lookup', async () => {
    const check = harness(published as CodeSystem, [{ system, concept: [{ code: 'N' }] }]);
    check.loader.loadCodeSystemForValueSet.mockRejectedValue(new Error('must not load'));
    vi.mocked(check.deps.getExpandedValueSet).mockResolvedValue(new Set([`${system}|N`]));
    await expect(check.unversioned()).resolves.toBe('valid');
    expect(check.loader.loadCodeSystemForValueSet).not.toHaveBeenCalled();
  });
  it.each(['valid', 'invalid', 'unverified'] as const)('local definition failure preserves remote %s', async remote => {
    const check = harness(); check.loader.loadCodeSystemForValueSet.mockRejectedValue(new Error('definition unavailable'));
    check.deps.resolutionConfig = { strategy: 'server-first', serverDelegation: { expandValueSets: false, validateCodes: true, cacheResults: false, cacheTTLSeconds: 0 } };
    check.deps.hasTerminologyServer = () => true;
    vi.mocked(check.deps.validateViaServer).mockResolvedValue(remote);
    await expect(check.unversioned()).resolves.toBe(remote);
    expect(check.deps.validateViaServer).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 'other'])('unqualified literal membership with exclusion edition=%s is coherent', async version => {
    const check = harness(published as CodeSystem, [{ system, concept: [{ code: 'N' }] }], [{ system, version, concept: [{ code: 'N' }], filter: [{ property: 'concept', op: '=', value: 'N' }] }]);
    check.loader.loadCodeSystemForValueSet.mockResolvedValue(null);
    await expect(check.unversioned()).resolves.toBe('unverified');
  });
  it('unpinned explicit exclusion can reject an unqualified literal without a CS', async () => {
    const check = harness(published as CodeSystem, [{ system, concept: [{ code: 'N' }] }, { system, concept: [{ code: 'O' }], filter: [filter] }], [{ system, concept: [{ code: 'N' }] }]);
    check.loader.loadCodeSystemForValueSet.mockResolvedValue(null);
    await expect(check.unversioned()).resolves.toBe('invalid');
  });
  it('known unpinned exclusion survives a missing imported include', async () => {
    const check = harness(published as CodeSystem, [{ valueSet: ['https://missing.test/vs'] }, { system, concept: [{ code: 'O' }], filter: [filter] }], [{ system, concept: [{ code: 'N' }] }]);
    check.loader.loadValueSetResource.mockImplementation(async () => check.vs);
    await expect(check.unversioned()).resolves.toBe('invalid');
  });
  it('retains complete explicit two-phase enforcement precedence', async () => {
    const check = harness(); check.deps.twoPhaseShadow.getEnforcedResult = () => true;
    await expect(check.unversioned('O')).resolves.toBe('valid');
    expect(check.loader.loadValueSetResource).not.toHaveBeenCalled();
    expect(check.finish).toHaveBeenCalledTimes(1);
  });
});
describe('public direct membership and binding ownership', () => {
  it.each(['valid', 'invalid', 'unverified'] as const)('boolean membership preserves genuine remote %s before local N', async remote => {
    vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
    const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
    const attempt = vi.spyOn(TerminologyApiClient.prototype, 'validateCodeAttempt').mockResolvedValue({ outcome: remote, accepted: remote !== 'invalid' });
    values.setResolutionConfig({ strategy: 'server-first', serverUrl: 'https://terminology.test/fhir', serverDelegation: { validateCodes: true, expandValueSets: false, cacheResults: false } });
    values.registerExternalTerminologyResource(published, 'R4'); values.registerExternalTerminologyResource(publishedValueSet, 'R4');
    await expect(values.isCodeInValueSet('O', system, url, 'R4')).resolves.toBe(remote === 'valid');
    expect(attempt).toHaveBeenCalled();
  });
  it('display selection respects a piped edition despite warmer bare labels', async () => {
    vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
    const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
    values.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false } });
    values.registerExternalTerminologyResource(graph({ version: 'A', concept: [{ code: 'O' }, { code: 'N', display: 'Label A' }] }), 'R4');
    values.registerExternalTerminologyResource(graph({ version: 'B', concept: [{ code: 'O' }, { code: 'N', display: 'Label B' }] }), 'R4');
    values.registerExternalTerminologyResource({ ...publishedValueSet, compose: { include: [{ system: `${system}|A`, filter: [filter] }] } }, 'R4');
    for (let round = 0; round < 2; round++) for (const display of ['Label A', 'Label B']) {
      const issues = await values.validateBinding({ system, code: 'N', display }, { strength: 'required', valueSet: url }, 'Patient.contact.relationship', { fhirVersion: 'R4', displayLanguage: 'en' });
      expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(display === 'Label B' ? 1 : 0);
      expect(issues.some(issue => issue.code === 'terminology-binding-unverified' || issue.code === 'terminology-display-unverified')).toBe(false);
    }
  });
  it('both owners retain N and expose U instead of accepting an unsupported exclusion silently', async () => {
    vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
    const cache = new ValueSetCache();
    const values = new ValueSetValidator(cache, undefined, []);
    values.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false }, reportUnverifiedBindings: true });
    values.registerExternalTerminologyResource(published, 'R4'); values.registerExternalTerminologyResource(publishedValueSet, 'R4');
    await expect(values.isCodeInValueSet('N', system, url, 'R4')).resolves.toBe(true);
    await expect(values.isCodeInValueSet('O', system, url, 'R4')).resolves.toBe(false);
    const issues = await values.validateBinding({ system, code: 'O', display: 'Other' }, { strength: 'required', valueSet: url }, 'Patient.contact.relationship', { fhirVersion: 'R4' });
    expect(issues.some(issue => issue.severity === 'error')).toBe(true);
    values.registerExternalTerminologyResource({ ...publishedValueSet, compose: { include: [{ system, filter: [filter] }], exclude: [{ system, filter: [unknown] }] } }, 'R4');
    await expect(values.isCodeInValueSet('N', system, url, 'R4')).resolves.toBe(true);
    const stats = values.getCacheStats();
    expect(stats.terminologyDiagnostics.failOpenMembershipChecks.total).toBeGreaterThan(0);
    expect(stats.codeSystemCount).toBe(1);
    expect(cache.getStats().fileCount).toBe(2);
  });
});

describe('filtered compose unknown diagnostics', () => {
  it.each([
    ['missing definition', null, filter, 'unenumerable-system-include', 'none'],
    ['partial hierarchy', graph({ content: 'fragment' }), filter, 'unenumerable-system-include', 'incomplete'],
    ['unsupported filter', published, unknown, 'unsupported-filter', 'incomplete'],
  ] as const)('%s describes compose authority rather than a stored expansion', async (_name, cs, selectedFilter, cause, localExpansion) => {
    const check = harness(published as CodeSystem, [{ system, filter: [selectedFilter] }]);
    check.loader.loadCodeSystemForValueSet.mockResolvedValue(cs as CodeSystem | null);
    await expect(check.unversioned()).resolves.toBe('unverified');
    expect(check.deps.recordUnverifiedBinding).toHaveBeenCalledWith(expect.objectContaining({ cause, localExpansion }));
    expect(check.deps.getExpandedValueSet).not.toHaveBeenCalled();
  });
  it('records a failed definition lookup separately from unavailable authority', async () => {
    const check = harness();
    check.loader.loadCodeSystemForValueSet.mockRejectedValue(new Error('definition lookup failed'));
    await expect(check.unversioned()).resolves.toBe('unverified');
    expect(check.deps.recordUnverifiedBinding).toHaveBeenCalledWith(expect.objectContaining({ cause: 'validation-error', localExpansion: 'none' }));
  });
});
