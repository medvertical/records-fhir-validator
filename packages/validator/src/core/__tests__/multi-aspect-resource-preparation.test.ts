import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import { MultiAspectResourcePreparation } from '../multi-aspect-resource-preparation';
import { resolveContextQuestionnaire } from '../context-questionnaire-resolution';
import { loadProfileOrBase } from '../profile-loader-utils';

vi.mock('../context-questionnaire-resolution', () => ({
  resolveContextQuestionnaire: vi.fn(),
}));
vi.mock('../profile-loader-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../profile-loader-utils')>();
  return { ...actual, loadProfileOrBase: vi.fn() };
});

const structureDef = {
  resourceType: 'StructureDefinition',
  id: 'questionnaire-response',
  type: 'QuestionnaireResponse',
  url: 'http://hl7.org/fhir/StructureDefinition/QuestionnaireResponse',
  status: 'active',
  kind: 'resource',
  abstract: false,
  derivation: 'specialization',
} as const;

function makeDeps() {
  return {
    fhirClient: undefined,
    profileCache: undefined,
    questionnaireRegistry: {} as MultiAspectDeps['questionnaireRegistry'],
    sdLoader: { getAvailableProfiles: () => [] } as unknown as MultiAspectDeps['sdLoader'],
    snapshotGenerator: {} as MultiAspectDeps['snapshotGenerator'],
    strictMode: false,
  };
}

describe('MultiAspectResourcePreparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContextQuestionnaire).mockResolvedValue(undefined);
    vi.mocked(loadProfileOrBase).mockResolvedValue({
      structureDef,
      declaredProfileUrl: structureDef.url,
      usedBaseFallback: false,
    });
  });

  it('caches profile preparation within one validation session', async () => {
    const preparation = new MultiAspectResourcePreparation({
      deps: makeDeps(),
      settings: {},
      organizationId: 7,
      serverId: 314,
    });
    const resource = { resourceType: 'QuestionnaireResponse' };

    const first = await preparation.prepare(resource, structureDef.url, 'R4');
    const second = await preparation.prepare(resource, structureDef.url, 'R4');

    expect(first.kind).toBe('ready');
    expect(second.kind).toBe('ready');
    expect(loadProfileOrBase).toHaveBeenCalledTimes(1);
    expect(resolveContextQuestionnaire).toHaveBeenCalledWith(
      resource,
      expect.anything(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      null,
    );
  });

  it('hands questionnaire resolution a resolver over the enclosing Bundle entries', async () => {
    const questionnaireUrn = 'urn:uuid:bc52dbf4-fd67-52e3-ba75-731a76805872';
    const bundledQuestionnaire = { resourceType: 'Questionnaire', status: 'active' };
    const response = { resourceType: 'QuestionnaireResponse', questionnaire: questionnaireUrn };
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { fullUrl: questionnaireUrn, resource: bundledQuestionnaire },
        { fullUrl: 'urn:uuid:response', resource: response },
      ],
    };
    const preparation = new MultiAspectResourcePreparation({ deps: makeDeps(), settings: {} });

    await preparation.prepare(response, structureDef.url, 'R4', bundle);

    const resolveBundleCanonical = vi.mocked(resolveContextQuestionnaire).mock.calls[0]?.[3];
    expect(resolveBundleCanonical?.(questionnaireUrn, 'Questionnaire')).toBe(bundledQuestionnaire);
  });

  it('combines bundle-local and host reference resolution with local precedence', async () => {
    const bundledPatient = { resourceType: 'Patient', id: 'bundled' };
    const hostPatient = { resourceType: 'Patient', id: 'host' };
    const bundle = {
      resourceType: 'Bundle',
      entry: [{ fullUrl: 'urn:uuid:bundled', resource: bundledPatient }],
    };
    const hostResolver = vi.fn((reference: string) => (
      reference === 'Patient/host' ? hostPatient : null
    ));
    const preparation = new MultiAspectResourcePreparation({
      deps: makeDeps(),
      settings: {},
      externalReferenceResolver: hostResolver,
    });

    const prepared = await preparation.prepare(
      { resourceType: 'QuestionnaireResponse' },
      structureDef.url,
      'R4',
      bundle,
    );

    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') return;
    expect(prepared.context.referenceResolver?.('urn:uuid:bundled')).toBe(bundledPatient);
    expect(hostResolver).not.toHaveBeenCalledWith('urn:uuid:bundled');
    expect(prepared.context.referenceResolver?.('Patient/host')).toBe(hostPatient);
  });

  it('returns a versioned profile issue when neither declared nor base profile loads', async () => {
    vi.mocked(loadProfileOrBase).mockResolvedValue({
      structureDef: null,
      declaredProfileUrl: 'https://example.org/StructureDefinition/missing',
      usedBaseFallback: false,
    });
    const preparation = new MultiAspectResourcePreparation({
      deps: makeDeps(),
      settings: {},
    });

    const prepared = await preparation.prepare(
      { resourceType: 'Observation' },
      'https://example.org/StructureDefinition/missing',
      'R5',
    );

    expect(prepared.kind).toBe('missing-profile');
    if (prepared.kind !== 'missing-profile') return;
    expect(prepared.result.isValid).toBe(false);
    expect(prepared.result.aspects[0]?.issues[0]).toMatchObject({
      aspect: 'profile',
      code: 'profile-not-found',
      schemaVersion: 'R5',
    });
  });

  it('checks cancellation after profile loading and before contextual lookups', async () => {
    const aborted = new Error('validation-aborted');
    const preparation = new MultiAspectResourcePreparation({
      deps: makeDeps(),
      settings: {},
      throwIfStopped: () => { throw aborted; },
    });

    await expect(preparation.prepare(
      { resourceType: 'QuestionnaireResponse' },
      structureDef.url,
      'R4',
    )).rejects.toBe(aborted);
    expect(loadProfileOrBase).toHaveBeenCalledTimes(1);
    expect(resolveContextQuestionnaire).not.toHaveBeenCalled();
  });
});
