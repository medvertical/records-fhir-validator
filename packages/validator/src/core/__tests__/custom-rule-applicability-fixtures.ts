import { vi } from 'vitest';
import { CustomRuleExecutor } from '../executors/custom-rule-executor.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import type { ValidationSettings } from '@records-fhir/validation-types';

export const base = 'http://hl7.org/fhir/StructureDefinition/';
export const custom = 'https://profiles.example.test/Patient';
export const settings = {
  autoApplyCustomRules: true, enableBestPracticeChecks: false,
  aspects: Object.fromEntries(['structural', 'profile', 'terminology', 'reference', 'invariant', 'metadata', 'custom_rule']
    .map(aspect => [aspect, { enabled: aspect === 'custom_rule', severity: 'inherit' }])),
} as ValidationSettings;

export function definition(url: string, type = 'Patient', version: string | undefined = '1.0'): StructureDefinition {
  return { resourceType: 'StructureDefinition', name: type, status: 'active', kind: 'resource',
    type, url, version, abstract: false, snapshot: { element: [{ id: type, path: type, min: 0, max: '*' }] } } as StructureDefinition;
}

export function fixture(profile: StructureDefinition | null = definition(custom)) {
  const cache = new Map<string, unknown>();
  let resolutionContext: { organizationId?: number; serverId?: number } | undefined = { organizationId: 7 };
  const load = (url: string) => url === custom ? profile
    : url.startsWith(base) ? definition(url, url.slice(base.length)) : null;
  return {
    sdLoader: {
      loadProfile: vi.fn(async (url: string) => load(url)),
      loadProfilesBatch: vi.fn(async (urls: string[]) => new Map(urls.flatMap(url => {
        const loaded = load(url); return loaded ? [[url, loaded] as const] : [];
      }))),
      setProfileResolutionContext: vi.fn(context => { resolutionContext = context; }),
      getProfileResolutionContext: () => resolutionContext,
      setSelectedCorePackage: vi.fn(),
      getPackageVersionPins: () => ({}),
      setPackageVersionPins: vi.fn(),
      getAllowedPackages: () => [] as string[],
      setAllowedPackages: vi.fn(),
    },
    snapshotGenerator: { generateSnapshot: vi.fn() },
    valuesetValidator: { withSourceContext: async <T>(_context: unknown, execute: () => Promise<T>) => execute() },
    profileCache: { get: (key: string) => cache.get(key), set: (key: string, value: unknown) => cache.set(key, value) },
    structuralExecutor: { validate: vi.fn().mockResolvedValue([]), validateResourceIdAndArrays: vi.fn().mockReturnValue([]) },
    profileExecutor: { validate: vi.fn().mockResolvedValue([]) },
    terminologyExecutor: { validate: vi.fn().mockResolvedValue([]) },
    referenceExecutor: { validate: vi.fn().mockResolvedValue([]) },
    invariantExecutor: { validate: vi.fn().mockResolvedValue([]) },
    customRuleExecutor: new CustomRuleExecutor(),
    metadataExecutor: { validate: vi.fn().mockResolvedValue([]) },
    bestPracticeValidator: { validate: vi.fn().mockReturnValue([]) },
    terminologyResourceValidator: { validate: vi.fn().mockReturnValue([]) },
    strictMode: false,
    validateBundleEntriesIfNeeded: vi.fn().mockResolvedValue([]),
    validateContainedResourcesIfNeeded: vi.fn().mockResolvedValue([]),
    validateParametersResourcesIfNeeded: vi.fn().mockResolvedValue([]),
    validateAgainstProfile: vi.fn().mockResolvedValue([]),
  };
}
