import { describe, expect, it, vi } from 'vitest';
import { InvariantExecutor } from './executors';
import { TerminologyResourceValidator } from '../validators/terminology-resource-validator';
import { runAllAspectValidations } from './validation-orchestrator';

const disabledAspects = {
  structural: { enabled: false },
  profile: { enabled: false },
  terminology: { enabled: false },
  reference: { enabled: false },
  invariant: { enabled: false },
  metadata: { enabled: false },
  custom_rule: { enabled: true },
};

function dependencies(customValidate: ReturnType<typeof vi.fn>) {
  const noop = { validate: vi.fn().mockResolvedValue([]) };
  return {
    structural: noop,
    profile: noop,
    terminology: noop,
    invariant: noop,
    custom: { validate: customValidate },
    metadata: noop,
    reference: noop,
  };
}

describe('custom-rule tenant scope', () => {
  it('passes organizationId to the custom-rule executor', async () => {
    const customValidate = vi.fn().mockResolvedValue([]);
    const deps = dependencies(customValidate);

    await runAllAspectValidations({
      resource: { resourceType: 'Patient', id: 'p1' },
      resourceType: 'Patient',
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
      fhirVersion: 'R4',
      structureDef: {} as never,
      strictMode: false,
      settings: { autoApplyCustomRules: true, aspects: disabledAspects },
      organizationId: 42,
    }, deps.structural as never, deps.profile as never, deps.terminology as never,
    deps.invariant as never, deps.custom as never, deps.metadata as never, deps.reference as never,
    new TerminologyResourceValidator());

    expect(customValidate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 42 }));
  });

  it('does not imply tenant custom rules for standalone validation without settings', async () => {
    const customValidate = vi.fn().mockResolvedValue([]);
    const deps = dependencies(customValidate);

    await runAllAspectValidations({
      resource: { resourceType: 'Patient', id: 'p1' },
      resourceType: 'Patient',
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
      fhirVersion: 'R4',
      structureDef: {} as never,
      strictMode: false,
    }, deps.structural as never, deps.profile as never, deps.terminology as never,
    deps.invariant as never, deps.custom as never, deps.metadata as never, deps.reference as never,
    new TerminologyResourceValidator());

    expect(customValidate).not.toHaveBeenCalled();
  });
});

describe('validation issue profile attribution', () => {
  it('adds the applied profile to issues which do not carry a more specific profile', async () => {
    const profileUrl = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|7.0.0';
    const issue = {
      id: 'unscoped-id',
      aspect: 'terminology',
      severity: 'warning',
      code: 'terminology-display-mismatch',
      message: 'Wrong display',
      path: 'Patient.maritalStatus',
      resourceType: 'Patient',
    };
    const structural = { validate: vi.fn().mockResolvedValue([issue]) };
    const noop = { validate: vi.fn().mockResolvedValue([]) };

    const result = await runAllAspectValidations({
      resource: { resourceType: 'Patient', id: 'p1' },
      resourceType: 'Patient',
      profileUrl,
      fhirVersion: 'R4',
      structureDef: {} as never,
      strictMode: false,
      settings: {
        aspects: {
          structural: { enabled: true },
          profile: { enabled: false },
          terminology: { enabled: false },
          reference: { enabled: false },
          invariant: { enabled: false },
          metadata: { enabled: false },
          custom_rule: { enabled: false },
        },
      },
    }, structural as never, noop as never, noop as never, noop as never,
    noop as never, noop as never, noop as never, new TerminologyResourceValidator());

    expect(result[0]).toMatchObject({ profile: profileUrl });
    expect(result[0].id).not.toBe('unscoped-id');
  });

  it('preserves an extension-specific issue profile', async () => {
    const parentProfile = 'http://example.org/StructureDefinition/Parent';
    const extensionProfile = 'http://example.org/StructureDefinition/Extension';
    const structural = { validate: vi.fn().mockResolvedValue([{
      aspect: 'profile',
      severity: 'error',
      code: 'profile-extension-missing-value',
      message: 'Missing value',
      profile: extensionProfile,
    }]) };
    const noop = { validate: vi.fn().mockResolvedValue([]) };

    const result = await runAllAspectValidations({
      resource: { resourceType: 'Patient' },
      resourceType: 'Patient',
      profileUrl: parentProfile,
      fhirVersion: 'R4',
      structureDef: {} as never,
      strictMode: false,
      settings: { aspects: { structural: { enabled: true } } },
    }, structural as never, noop as never, noop as never, noop as never,
    noop as never, noop as never, noop as never, new TerminologyResourceValidator());

    expect(result[0].profile).toBe(extensionProfile);
  });
});

describe('single-resource universal constraints', () => {
  // ele-1 and its siblings report as `structural`, and the batch path runs them
  // whenever structural is requested. The single-resource path used to gate them
  // on the retired `invariant` switch instead, so the same resource validated
  // differently depending on which path saw it.
  it('inherits ele-1 from the shared invariant executor under the structural switch', async () => {
    const noop = { validate: vi.fn().mockResolvedValue([]) };
    const result = await runAllAspectValidations({
      resource: {
        resourceType: 'Patient',
        id: 'patient-id-only',
        _implicitRules: { id: 'metadata-only' },
      },
      resourceType: 'Patient',
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
      fhirVersion: 'R4',
      structureDef: {} as never,
      strictMode: false,
      settings: { aspects: {
        structural: { enabled: true }, profile: { enabled: false },
        terminology: { enabled: false }, reference: { enabled: false },
        invariant: { enabled: false }, metadata: { enabled: false },
      } },
    }, noop as never, noop as never, noop as never, new InvariantExecutor(),
    noop as never, noop as never, noop as never, new TerminologyResourceValidator());

    expect(result).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'Patient.implicitRules',
    }));
  });
});
