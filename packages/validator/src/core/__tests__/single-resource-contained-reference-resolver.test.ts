import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import type { ReferenceResolver } from '../../validators/slicing-validator.js';
import {
  executeRecordsResourceValidation,
  type RecordsSingleResourceValidationContext,
} from '../validator-single-resource-pipeline.js';

const LIST_PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/List';

function listProfile(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: LIST_PROFILE_URL,
    name: 'List',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'List',
    snapshot: { element: [{ path: 'List' }] },
  };
}

function pipelineContext(profileValidate: ReturnType<typeof vi.fn>): RecordsSingleResourceValidationContext {
  const sdLoader = {
    loadProfile: vi.fn(async (url: string) => (url === LIST_PROFILE_URL ? listProfile() : null)),
    setProfileResolutionContext: vi.fn(),
    getAvailableProfiles: () => [LIST_PROFILE_URL],
  } as unknown as StructureDefinitionLoader;
  return {
    sdLoader,
    profileCache: undefined as never,
    snapshotGenerator: {} as never,
    structuralExecutor: { validate: vi.fn(async () => []) } as never,
    profileExecutor: { validate: profileValidate } as never,
    terminologyExecutor: { validate: vi.fn(async () => []) } as never,
    invariantExecutor: { validate: vi.fn(async () => []) } as never,
    customRuleExecutor: { validate: vi.fn(async () => []) } as never,
    metadataExecutor: { validate: vi.fn(async () => []) } as never,
    referenceExecutor: { validate: vi.fn(async () => []) } as never,
    bestPracticeValidator: { validate: vi.fn(() => []) } as never,
    terminologyResourceValidator: { validate: vi.fn(() => []) } as never,
    strictMode: false,
    validateBundleEntriesIfNeeded: vi.fn(async () => []),
    validateContainedResourcesIfNeeded: vi.fn(async () => []),
    validateParametersResourcesIfNeeded: vi.fn(async () => []),
  };
}

const listWithContained = {
  resourceType: 'List',
  status: 'current',
  mode: 'working',
  contained: [{ resourceType: 'Condition', id: 'i1', subject: { reference: 'Patient/example' } }],
  entry: [{ item: { reference: '#i1' } }],
};

async function resolverSeenByProfileExecutor(
  externalResolver?: ReferenceResolver,
): Promise<ReferenceResolver | null | undefined> {
  const profileValidate = vi.fn(async () => []);
  await executeRecordsResourceValidation(
    { resource: listWithContained, fhirVersion: 'R4', referenceResolver: externalResolver },
    pipelineContext(profileValidate),
    Date.now(),
  );
  expect(profileValidate).toHaveBeenCalledOnce();
  const [context] = profileValidate.mock.calls[0] as [{ referenceResolver?: ReferenceResolver | null }];
  return context.referenceResolver;
}

describe('single-resource pipeline reference resolver', () => {
  it('resolves contained resources of a top-level resource without a caller-supplied resolver', async () => {
    // The batch path and bundle-entry recursion already do this; a resolve()
    // discriminator on a plain resource must not see its own contained targets
    // as unresolvable.
    const resolver = await resolverSeenByProfileExecutor();

    expect(resolver?.('#i1')).toMatchObject({ resourceType: 'Condition', id: 'i1' });
    expect(resolver?.('#missing')).toBeNull();
  });

  it('keeps a caller-supplied resolver as the fallback for everything not contained', async () => {
    const remoteCondition = { resourceType: 'Condition', id: 'remote' };
    const external = vi.fn((reference: string) => (reference === 'Condition/remote' ? remoteCondition : null));

    const resolver = await resolverSeenByProfileExecutor(external);

    expect(resolver?.('#i1')).toMatchObject({ id: 'i1' });
    expect(resolver?.('Condition/remote')).toBe(remoteCondition);
    expect(external).not.toHaveBeenCalledWith('#i1');
  });
});
