import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateStructureProfile } from '../structure-profile-validation';
import { StructuralExecutor } from '../executors/structural-executor';
import type { StructureDefinition } from '../structure-definition-types';

const PROFILE_URL = 'http://example.org/StructureDefinition/test-patient';

function createDeps(structureDef: unknown, requiredFieldIssues: ValidationIssue[] = []) {
  return {
    sdLoader: {
      loadProfile: vi.fn().mockResolvedValue(structureDef),
    },
    profileCache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    },
    snapshotGenerator: {
      generateSnapshot: vi.fn(),
    },
    structuralExecutor: {
      validateRequiredFields: vi.fn().mockResolvedValue(requiredFieldIssues),
    },
  };
}

describe('structure profile validation', () => {
  it('returns no issues when the profile cannot be loaded', async () => {
    const deps = createDeps(null);

    await expect(validateStructureProfile(
      { resourceType: 'Patient' },
      PROFILE_URL,
      'R4',
      deps as never,
    )).resolves.toEqual([]);
    expect(deps.structuralExecutor.validateRequiredFields).not.toHaveBeenCalled();
  });

  it('retains the mismatch without claiming base validation when the base is unavailable', async () => {
    const deps = createDeps({
      resourceType: 'StructureDefinition',
      url: PROFILE_URL,
      type: 'Observation',
      snapshot: { element: [{ id: 'Observation', path: 'Observation' }] },
    });
    deps.sdLoader.loadProfile.mockResolvedValueOnce({
      resourceType: 'StructureDefinition',
      url: PROFILE_URL,
      type: 'Observation',
      snapshot: { element: [{ id: 'Observation', path: 'Observation' }] },
    }).mockResolvedValue(null);

    const issues = await validateStructureProfile(
      { resourceType: 'Patient' },
      PROFILE_URL,
      'R4',
      deps as never,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-resource-type-mismatch',
      path: 'meta.profile',
      details: {
        profile: PROFILE_URL,
        profileResourceType: 'Observation',
        resourceType: 'Patient',
        validatedAgainstBase: false,
        validationComplete: false,
      },
    }));
    expect(deps.structuralExecutor.validateRequiredFields).not.toHaveBeenCalled();
    expect(issues[0].message).not.toContain('validated against base Patient instead');
  });

  it('combines required-field and choice-property issues for a compatible profile', async () => {
    const requiredIssue = {
      id: 'required-issue',
      severity: 'error',
      category: 'structural',
        aspect: 'structural',
      code: 'required-field',
      message: 'Required field is missing',
    } as ValidationIssue;
    const resource = {
      resourceType: 'Group',
      characteristic: [{ value: true }],
    };
    const structureDef = {
      resourceType: 'StructureDefinition',
      url: PROFILE_URL,
      type: 'Group',
      snapshot: {
        element: [{
          id: 'Group.characteristic.value[x]',
          path: 'Group.characteristic.value[x]',
          type: [{ code: 'boolean' }],
        }],
      },
    };
    const deps = createDeps(structureDef, [requiredIssue]);

    const issues = await validateStructureProfile(
      resource,
      PROFILE_URL,
      'R5',
      deps as never,
    );

    expect(issues[0]).toBe(requiredIssue);
    expect(issues[1]).toMatchObject({
      code: 'structural-unknown-element',
      path: 'Group.characteristic[0].value',
    });
    expect(deps.structuralExecutor.validateRequiredFields).toHaveBeenCalledWith(
      resource,
      structureDef,
      PROFILE_URL,
      expect.any(Function),
      'R5',
    );
  });
});

const coreDefinition = (type: string): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/StructureDefinition/' + type,
  name: type, status: 'active', kind: 'resource', type, abstract: type === 'DomainResource',
  fhirVersion: '4.0.1', snapshot: { element: [{ id: type, path: type }] },
});

describe('declared abstract profile in the targeted structure path', () => {
  it('runs the actual Bundle base required-field rule after the mismatch', async () => {
    const domain = coreDefinition('DomainResource');
    const bundle = coreDefinition('Bundle');
    bundle.snapshot!.element.push({ id: 'Bundle.type', path: 'Bundle.type', min: 1, max: '1', type: [{ code: 'code' }] });
    const sdLoader = { loadProfile: vi.fn(async (url: string) => url === domain.url ? domain : bundle),
      getBaseResourceType: (url: string) => url.split('/').at(-1) };
    const executor = new StructuralExecutor(sdLoader as never);
    const executed = vi.spyOn(executor, 'validateRequiredFields');
    const resource = { resourceType: 'Bundle', meta: { profile: [domain.url] } };
    const issues = await validateStructureProfile(resource, domain.url, 'R4', {
      sdLoader: sdLoader as never, profileCache: { get: () => null, set: () => {} } as never,
      snapshotGenerator: {} as never, structuralExecutor: executor,
    });
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-resource-type-mismatch', path: 'meta.profile', severity: 'error',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'required-element-missing', path: 'Bundle.type', profile: bundle.url,
    }));
    expect(executed).toHaveBeenCalledExactlyOnceWith(resource, bundle, bundle.url, expect.any(Function), 'R4');
    expect(sdLoader.loadProfile.mock.calls.map(([url]) => url)).toEqual([domain.url, bundle.url]);
  });

  it('keeps the established mismatch when loading the base throws', async () => {
    const domain = coreDefinition('DomainResource');
    const deps = createDeps(domain);
    deps.sdLoader.loadProfile.mockResolvedValueOnce(domain).mockRejectedValue(new Error('Synthetic base store failure'));
    const issues = await validateStructureProfile({ resourceType: 'Bundle' }, domain.url, 'R4', deps as never);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'structural-resource-type-mismatch',
      details: expect.objectContaining({ validatedAgainstBase: false, validationComplete: false }) }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-unreadable',
      details: expect.objectContaining({ validationStatus: 'incomplete' }) }));
    expect(deps.structuralExecutor.validateRequiredFields).not.toHaveBeenCalled();
  });

  it.each(['wrong-type', 'wrong-canonical', 'empty', 'abstract', 'wrong-kind', 'wrong-family'] as const)(
    'does not execute an unusable %s returned base', async reason => {
      const domain = coreDefinition('DomainResource');
      const base = coreDefinition('Bundle');
      if (reason === 'wrong-type') base.type = 'DomainResource';
      if (reason === 'wrong-canonical') base.url = 'https://example.test/OtherBundle';
      if (reason === 'empty') base.snapshot = { element: [] };
      if (reason === 'abstract') base.abstract = true;
      if (reason === 'wrong-kind') base.kind = 'complex-type';
      if (reason === 'wrong-family') base.fhirVersion = '5.0.0';
      const deps = createDeps(domain);
      deps.sdLoader.loadProfile.mockResolvedValueOnce(domain).mockResolvedValue(base);
      const issues = await validateStructureProfile({ resourceType: 'Bundle' }, domain.url, 'R4', deps as never);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'structural-resource-type-mismatch',
        details: { validatedAgainstBase: false, validationComplete: false } });
      expect(deps.structuralExecutor.validateRequiredFields).not.toHaveBeenCalled();
    },
  );
});
