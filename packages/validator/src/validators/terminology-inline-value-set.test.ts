import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from './terminology-api-client';
import { loadInlineValueSet } from './valueset-inline-definition';
import { validateCodeViaTerminologyServerWithFilters } from './valueset-terminology-server-validation';
import type { ValueSet, TerminologyResolutionConfig } from './valueset-types';

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return { ...actual, default: { ...actual.default, ...transport } };
});
const canonical = 'https://example.org/ValueSet/audit';
const system = 'https://example.org/CodeSystem/audit';
const response = (valid: boolean) => ({ data: {
  resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: valid }],
} });
const definition = (code: string): ValueSet => ({
  resourceType: 'ValueSet', url: canonical, version: '1.0.0', status: 'active',
  compose: { include: [{ system, concept: [{ code }] }] },
});
const config: TerminologyResolutionConfig = {
  strategy: 'server-first', serverUrl: 'https://inline-terminology.example/fhir',
  auth: { type: 'bearer', token: 'fixture-token' },
};

describe('remote validation with a package ValueSet definition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transport.get.mockResolvedValue(response(true));
    transport.post.mockResolvedValue(response(true));
  });

  it('sends the ValueSet version separately from its canonical URL and CodeSystem version', async () => {
    const client = new TerminologyApiClient(config);
    await client.validateCodeOutcome('alpha', system, `${canonical}|1.0.0`, 'required', undefined, '2026');
    expect(transport.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ params: {
      url: canonical, valueSetVersion: '1.0.0', code: 'alpha', system, systemVersion: '2026', _format: 'json',
    } }));
  });

  it('asks the server to infer the code system for a binding without one', async () => {
    const client = new TerminologyApiClient(config);
    await client.validateCodeOutcome('MA', undefined, canonical, 'extensible');
    expect(transport.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ params: {
      url: canonical, code: 'MA', inferSystem: 'true', _format: 'json',
    } }));

    transport.get.mockResolvedValue({ data: { resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }] } });
    const states: ValueSet = {
      resourceType: 'ValueSet', url: canonical, status: 'active',
      compose: { include: [{ system: 'https://www.usps.com/' }] },
    };
    expect(await client.validateCodeOutcome('MA', undefined, canonical, 'extensible', undefined, undefined, states)).toBe('valid');
    expect(transport.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      parameter: expect.arrayContaining([{ name: 'inferSystem', valueBoolean: true }]),
    }), expect.anything());
    const posted = transport.post.mock.calls[0][1] as { parameter: Array<{ name: string }> };
    expect(posted.parameter.map(entry => entry.name)).not.toContain('system');
  });

  it('isolates inline definitions from unresolved canonical lookups and from other definition contents', async () => {
    transport.get.mockResolvedValue({ data: { resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }] } });
    const client = new TerminologyApiClient(config);
    expect(await client.validateCodeOutcome('alpha', system, canonical, 'required')).toBe('unverified');
    expect(await client.validateCodeOutcome('alpha', system, canonical, 'required', undefined, '2026', definition('alpha'))).toBe('valid');
    transport.post.mockResolvedValue(response(false));
    expect(await client.validateCodeOutcome('alpha', system, canonical, 'required', undefined, '2026', definition('beta'))).toBe('invalid');
    expect(transport.post).toHaveBeenCalledTimes(2);
    expect(transport.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      resourceType: 'Parameters', parameter: expect.arrayContaining([
        { name: 'valueSet', resource: definition('alpha') },
        { name: 'systemVersion', valueString: '2026' },
      ]),
    }), expect.objectContaining({ headers: expect.objectContaining({
      Authorization: 'Bearer fixture-token', 'Content-Type': 'application/fhir+json',
    }) }));
  });

  it('preserves exclusions when a code is subsumed by an include ancestor', async () => {
    transport.get.mockResolvedValue(response(false));
    const client = new TerminologyApiClient(config);
    const subsumes = vi.spyOn(client, 'subsumes').mockResolvedValue('subsumes');
    const local = { ...definition('alpha'), compose: {
      include: [{ system, filter: [{ property: 'concept', op: 'is-a', value: 'parent' }] }],
      exclude: [{ system, concept: [{ code: 'alpha' }] }],
    } };
    const packageLoader = { loadValueSetResource: vi.fn().mockResolvedValue(local) };
    const result = await validateCodeViaTerminologyServerWithFilters({
      apiClient: client, packageLoader: packageLoader as never, hasTerminologyServer: () => true,
      code: 'alpha', system, valueSetUrl: canonical, bindingStrength: 'required', override: undefined,
    });
    expect(result).toBe('invalid');
    expect(subsumes).not.toHaveBeenCalled();
  });

  it('carries nested definitions without mutating the loaded package or dropping intersections', async () => {
    const root = { ...definition('alpha'), compose: {
      include: [{ system, filter: [{ property: 'concept', op: 'is-a', value: 'parent' }], valueSet: ['https://example.org/nested'] }],
      exclude: [{ valueSet: ['https://example.org/nested'] }],
    } };
    const nested = { ...definition('beta'), url: 'https://example.org/nested' };
    const before = structuredClone(root);
    const loader = { loadValueSetResource: vi.fn(async (url: string) => url === `${canonical}|1.0.0` ? root : nested) };
    const inline = await loadInlineValueSet(loader, `${canonical}|1.0.0`, 'R4');
    expect(inline?.compose?.include?.[0]).toEqual({ ...root.compose.include[0], valueSet: ['#vs-1'] });
    expect(inline?.compose?.exclude?.[0].valueSet).toEqual(['#vs-1']);
    expect(inline?.contained).toEqual([{ ...nested, id: 'vs-1' }]);
    expect(root).toEqual(before);
  });

  it('does not substitute a different package ValueSet version for an explicit binding', async () => {
    const loader = { loadValueSetResource: vi.fn().mockResolvedValue(definition('alpha')) };
    expect(await loadInlineValueSet(loader, `${canonical}|1.1.0`, 'R4')).toBeUndefined();
  });

  it('omits unrelated CodeSystems from a lookup without broadening its intersection', async () => {
    const root: ValueSet = { ...definition('alpha'), compose: { include: [
      { system, concept: [{ code: 'alpha' }] },
      { system: 'https://unavailable.example/system' },
      { system, valueSet: ['https://example.org/unrelated'] },
    ] } };
    const nested: ValueSet = { ...definition('beta'), compose: { include: [{ system: 'https://unrelated.example/system' }] } };
    const loader = { loadValueSetResource: vi.fn(async (url: string) => url === canonical ? root : nested) };
    const inline = await loadInlineValueSet(loader, canonical, 'R4', system);
    expect(inline?.compose?.include).toEqual([{ system, concept: [{ code: 'alpha' }] }]);
    expect(root.compose?.include).toHaveLength(3);
  });
});
