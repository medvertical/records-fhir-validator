import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateStructureProfile } from '../structure-profile-validation';

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

  it('stops before structural execution for an incompatible profile type', async () => {
    const deps = createDeps({
      resourceType: 'StructureDefinition',
      type: 'Observation',
      snapshot: { element: [{ id: 'Observation', path: 'Observation' }] },
    });

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
      },
    }));
    expect(deps.structuralExecutor.validateRequiredFields).not.toHaveBeenCalled();
  });

  it('combines required-field and choice-property issues for a compatible profile', async () => {
    const requiredIssue = {
      id: 'required-issue',
      severity: 'error',
      category: 'structural',
      code: 'required-field',
      message: 'Required field is missing',
    } as ValidationIssue;
    const resource = {
      resourceType: 'Group',
      characteristic: [{ value: true }],
    };
    const structureDef = {
      resourceType: 'StructureDefinition',
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
