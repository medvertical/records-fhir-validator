import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';
import type { SnapshotGenerator } from '../snapshot-generator';
import { validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import type { ValidateOneFn } from '../multi-aspect-types';

// CH EPR asks every Organization to conform to IHE mCSD's Organization.
const MCSD_ORGANIZATION = 'https://profiles.ihe.net/ITI/mCSD/StructureDefinition/IHE.mCSD.Organization';
const sdLoader = {
  loadProfile: vi.fn(async (url: string) => (url === MCSD_ORGANIZATION ? { url, type: 'Organization' } : null)),
} as unknown as MultiAspectDeps['sdLoader'];
const issue = (severity: ValidationIssue['severity']) => ({ severity, code: 'x', message: 'x' }) as ValidationIssue;
const validateOneReporting = (...issues: ValidationIssue[]) =>
  vi.fn<ValidateOneFn>(async () => ({ isValid: true, aspects: [{ aspect: 'profile', issues, validationTime: 0, isValid: true }] }));
const scope = (validateOne: ValidateOneFn, recursionDepth = 0) =>
  ({ sdLoader, validateOne, fhirVersion: 'R4' as const, recursionDepth });

describe('conformsTo() by validation against the profile', () => {
  it('holds a resource the profile raises no error for to conform', async () => {
    const validateOne = validateOneReporting(issue('warning'));
    const check = createProfileConformanceCheck(scope(validateOne))!;

    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledWith(
      { resourceType: 'Organization' }, MCSD_ORGANIZATION, 'R4', 1, undefined, false, undefined, true,
    );
  });

  it('holds a resource with an error not to conform, and rechecks it in the same session', async () => {
    const validateOne = validateOneReporting(issue('error'));
    const check = createProfileConformanceCheck(scope(validateOne))!;
    const organization = { resourceType: 'Organization' };

    await expect(check(organization, MCSD_ORGANIZATION)).resolves.toBe(false);
    await expect(createProfileConformanceCheck(scope(validateOne))!(organization, MCSD_ORGANIZATION)).resolves.toBe(false);
    expect(validateOne).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an inapplicable profile from one it cannot read', async () => {
    const validateOne = validateOneReporting();
    const check = createProfileConformanceCheck(scope(validateOne))!;

    await expect(check({ resourceType: 'Practitioner' }, MCSD_ORGANIZATION)).resolves.toBe('not-applicable');
    await expect(check({ resourceType: 'Organization' }, 'http://example.org/unknown')).resolves.toBeUndefined();
    expect(validateOne).not.toHaveBeenCalled();
  });

  // A Bundle entry is validated one level down; its target's target is reached still.
  it('stops where profiles that require each other would recurse', async () => {
    const validateOne = validateOneReporting();
    expect(createProfileConformanceCheck(scope(validateOne, 4))).toBeDefined();
    const check = createProfileConformanceCheck(scope(validateOne, 5))!;
    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBeUndefined();
    expect(validateOne).not.toHaveBeenCalled();
  });

  it.each([5, 6])('reports a requested profile as unknown at depth %s without recursive work', async recursionDepth => {
    const onIncomplete = vi.fn();
    const loadProfile = vi.fn();
    const referencedProfileUrl = vi.fn();
    const validateOne = validateOneReporting(issue('error'));
    const check = createProfileConformanceCheck({
      ...scope(validateOne, recursionDepth), onIncomplete,
      sdLoader: { loadProfile, referencedProfileUrl } as unknown as MultiAspectDeps['sdLoader'],
      referencingProfile: { url: 'http://example.test/StructureDefinition/declaring' } as StructureDefinition,
    })!;
    expect(onIncomplete).not.toHaveBeenCalled();
    const resource = { resourceType: 'Organization' };
    for (const profile of [MCSD_ORGANIZATION, MCSD_ORGANIZATION, MCSD_ORGANIZATION + '|2']) {
      await expect(check(resource, profile)).resolves.toBeUndefined();
      expect(onIncomplete).toHaveBeenLastCalledWith(expect.objectContaining({
        severity: 'info', code: 'profile-conformance-incomplete',
        details: { validationComplete: false, profile, causes: ['profile-conformance-depth-limit'] },
      }));
    }
    expect(onIncomplete).toHaveBeenCalledTimes(3);
    expect(loadProfile).not.toHaveBeenCalled();
    expect(referencedProfileUrl).not.toHaveBeenCalled();
    expect(validateOne).not.toHaveBeenCalled();
  });

  it('leaves an unused depth-limited callback silent', () => {
    const onIncomplete = vi.fn();
    const validateOne = validateOneReporting();
    expect(createProfileConformanceCheck({ ...scope(validateOne, 6), onIncomplete })).toBeTypeOf('function');
    expect(onIncomplete).not.toHaveBeenCalled();
    expect(validateOne).not.toHaveBeenCalled();
  });

  it('keeps a depth-limited check unknown without an observer', async () => {
    const validateOne = validateOneReporting();
    const loadProfile = vi.fn();
    const check = createProfileConformanceCheck({ ...scope(validateOne, 5),
      sdLoader: { loadProfile } as unknown as MultiAspectDeps['sdLoader'] })!;
    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBeUndefined();
    expect(validateOne).not.toHaveBeenCalled();
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it('does not reuse depth-limited unknown as a completed verdict below the limit', async () => {
    const validateOne = validateOneReporting();
    const resource = { resourceType: 'Organization' };
    const loadProfile = vi.fn(async () => ({ url: MCSD_ORGANIZATION, type: 'Organization' }));
    const sdLoader = { loadProfile } as unknown as MultiAspectDeps['sdLoader'];
    await expect(createProfileConformanceCheck({ ...scope(validateOne, 5), sdLoader })!(resource, MCSD_ORGANIZATION))
      .resolves.toBeUndefined();
    const check = createProfileConformanceCheck({ ...scope(validateOne, 4), sdLoader })!;
    await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBe(true);
    await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledTimes(2);
    expect(loadProfile).toHaveBeenCalledTimes(2);
  });

  // A verdict reached deeper saw fewer of the resource's own targets.
  it('keeps verdicts apart by depth', async () => {
    const validateOne = validateOneReporting(issue('error'));
    const organization = { resourceType: 'Organization' };

    await createProfileConformanceCheck(scope(validateOne, 2))!(organization, MCSD_ORGANIZATION);
    await createProfileConformanceCheck(scope(validateOne, 1))!(organization, MCSD_ORGANIZATION);
    expect(validateOne).toHaveBeenCalledTimes(2);
  });
  it.each(['internal-error', 'validation-error', 'profile-not-found', 'profile-not-resolved'])(
    'rechecks incomplete %s evidence before the next verdict', async code => {
      const validateOne = validateOneReporting({ ...issue('error'), code });
      const check = createProfileConformanceCheck(scope(validateOne))!;
      const resource = { resourceType: 'Organization' };
      await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBeUndefined();
      validateOne.mockImplementation(validateOneReporting());
      await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBe(true);
      expect(validateOne).toHaveBeenCalledTimes(2);
    },
  );

  it('preserves operational failure evidence for the enclosing validation', async () => {
    const onIncomplete = vi.fn();
    const validateOne = validateOneReporting({ ...issue('error'), code: 'internal-error' });
    const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete })!;
    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBeUndefined();
    expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
      code: 'validation-error', details: { validationComplete: false, profile: MCSD_ORGANIZATION, causes: ['internal-error'] },
    }));
  });

  it.each(['preferred', 'example', 'required', 'extensible'])(
    'distinguishes incomplete %s terminology from a blocking conformance check', async strength => {
      const onIncomplete = vi.fn();
      const validateOne = validateOneReporting({
        ...issue('information'), code: 'terminology-binding-unverified',
        details: { validationStatus: 'incomplete', strength },
      });
      const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete })!;
      const verdict = await check({ resourceType: 'Organization' }, MCSD_ORGANIZATION);
      expect(verdict).toBe(['preferred', 'example'].includes(strength) ? true : undefined);
      expect(onIncomplete).toHaveBeenCalledTimes(['preferred', 'example'].includes(strength) ? 0 : 1);
    },
  );

  it('does not turn incomplete warning evidence into successful conformance', async () => {
    const validateOne = validateOneReporting({ ...issue('warning'), details: { validationComplete: false } });
    const check = createProfileConformanceCheck(scope(validateOne))!;
    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBeUndefined();
  });

  it.each(['structural-cardinality-min', 'reference-target-profile-noncompliant'])(
    'retains independently proved %s failure while reporting incomplete terminology', async code => {
      const onIncomplete = vi.fn();
      const validateOne = validateOneReporting(
        { ...issue('error'), code },
        { ...issue('information'), code: 'terminology-codesystem-unverified', details: { validationComplete: false } },
      );
      const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete })!;
      const resource = { resourceType: 'Organization' };
      await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBe(false);
      expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
        code: 'profile-conformance-incomplete', severity: 'info',
        details: expect.objectContaining({ validationComplete: false }),
      }));
      validateOne.mockImplementation(validateOneReporting());
      await expect(check(resource, MCSD_ORGANIZATION)).resolves.toBe(true);
      expect(validateOne).toHaveBeenCalledTimes(2);
    },
  );

  it('does not use the incomplete error itself to disprove conformance', async () => {
    const validateOne = validateOneReporting({ ...issue('error'), details: { validationStatus: 'incomplete' } });
    await expect(createProfileConformanceCheck(scope(validateOne))!({ resourceType: 'Organization' }, MCSD_ORGANIZATION))
      .resolves.toBeUndefined();
  });

  it('keeps governed warning findings from disproving conformance', async () => {
    const validateOne = vi.fn<ValidateOneFn>(async () => ({ isValid: true, aspects: [{
      aspect: 'profile', validationTime: 0, isValid: true,
      issues: [issue('warning')],
      evidenceIssues: [issue('error'), { ...issue('information'), details: { validationComplete: false } }],
    }] }));
    await expect(createProfileConformanceCheck(scope(validateOne))!({ resourceType: 'Organization' }, MCSD_ORGANIZATION))
      .resolves.toBeUndefined();
  });

  it('retains a definite fatal failure beside an operational failure', async () => {
    const validateOne = validateOneReporting(issue('fatal'), { ...issue('error'), code: 'internal-error' });
    await expect(createProfileConformanceCheck(scope(validateOne))!({ resourceType: 'Organization' }, MCSD_ORGANIZATION))
      .resolves.toBe(false);
  });

  it('preserves ordered incomplete causes and independent definitive failure evidence', async () => {
    const onIncomplete = vi.fn();
    const sourceUnavailable = { ...issue('information'), code: 'profile-reference-unavailable',
      details: { validationComplete: false } };
    const validateOne = vi.fn<ValidateOneFn>(async () => ({ isValid: false, aspects: [{
      aspect: 'profile', validationTime: 0, isValid: false,
      issues: [{ ...issue('error'), code: 'structural-cardinality-min' }],
      evidenceIssues: [sourceUnavailable,
        { ...issue('information'), code: 'terminology-binding-unverified', details: { validationComplete: false } },
        { ...issue('error'), code: 'internal-error' }, sourceUnavailable],
    }] }));
    const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete })!;
    await expect(check({ resourceType: 'Organization' }, MCSD_ORGANIZATION)).resolves.toBe(false);
    expect(onIncomplete.mock.calls.map(([reported]) => reported.code)).toEqual([
      'profile-reference-unavailable', 'profile-reference-unavailable', 'validation-error',
    ]);
    expect(onIncomplete).toHaveBeenLastCalledWith(expect.objectContaining({ details: {
      validationComplete: false, profile: MCSD_ORGANIZATION,
      causes: ['profile-reference-unavailable', 'terminology-binding-unverified', 'internal-error'],
    } }));
  });


});

const operationalProfileUrl = 'http://example.test/StructureDefinition/conformance-load-patient';
const operationalProfile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: operationalProfileUrl, name: 'Patient', status: 'active',
  kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1',
  snapshot: { element: [{ path: 'Patient' }, { path: 'Patient.identifier', min: 1, max: '*', type: [{ code: 'Identifier' }] }] },
};

async function withActualProfileLoader(
  run: (loader: MultiAspectDeps['sdLoader'], validateOne: ReturnType<typeof vi.fn<ValidateOneFn>>,
    snapshotGenerator: SnapshotGenerator) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'profile-conformance-load-'));
  const validator = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: null,
    terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false });
  try {
    await validator.waitForInitialization();
    const loader = validator.getSdLoader();
    loader.registerExternalProfile(structuredClone(operationalProfile), 'R4');
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    settings.profileSources = { simplifier: false, packageRegistry: false };
    settings.terminologyServers = [];
    settings.imposedProfiles = { enabled: false, policies: [] };
    const validateOne = vi.fn<ValidateOneFn>((resource, profileUrl, fhirVersion) => validator.validateAspects(
      resource, { profileUrl, fhirVersion, settings, aspects: ['structural', 'profile'] },
    ));
    const components = Reflect.get(validator, 'components') as { snapshotGenerator: SnapshotGenerator };
    await run(loader, validateOne, components.snapshotGenerator);
  } finally {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('conformsTo() with the actual profile loader and aspect API', () => {
  it('keeps an absent definition unknown without inventing an operational error', async () => withActualProfileLoader(async (loader, validateOne) => {
    const onIncomplete = vi.fn();
    const reads = vi.spyOn(loader, 'loadProfile');
    const check = createProfileConformanceCheck({ ...scope(validateOne), sdLoader: loader, onIncomplete })!;
    const resource = { resourceType: 'Patient' };
    const missing = 'http://example.test/StructureDefinition/absent';
    await expect(check(resource, missing)).resolves.toBeUndefined();
    await expect(check(resource, missing)).resolves.toBeUndefined();
    expect(reads).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'info', code: 'profile-conformance-incomplete',
      details: { validationComplete: false, profile: missing, causes: ['profile-not-found'] },
    }));
    expect(validateOne).not.toHaveBeenCalled();
  }));

  it.each(['promise rejection', 'synchronous throw'])(
    'retains a safe diagnosis for a loader %s and rechecks after recovery', async failure => withActualProfileLoader(async (loader, validateOne) => {
      const sensitiveException = 'Patient/clinical-marker <Patient><name>PHI</name></Patient> https://host.invalid?token=secret';
      const error = new TypeError(sensitiveException);
      const reads = vi.spyOn(loader, 'loadProfile');
      if (failure === 'promise rejection') reads.mockRejectedValue(error);
      else reads.mockImplementation(() => { throw error; });
      const onIncomplete = vi.fn();
      const check = createProfileConformanceCheck({ ...scope(validateOne), sdLoader: loader, onIncomplete })!;
      const resource = { resourceType: 'Patient', identifier: [{ value: 'fixture' }] };
      await expect(check(resource, operationalProfileUrl)).resolves.toBeUndefined();
      await expect(check(resource, operationalProfileUrl)).resolves.toBeUndefined();
      expect(reads).toHaveBeenCalledTimes(2);
      expect(validateOne).not.toHaveBeenCalled();
      expect(onIncomplete).toHaveBeenCalledTimes(2);
      expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
        aspect: 'profile', severity: 'error', code: 'validation-error',
        message: 'Profile conformance validation could not be completed because the validator encountered an operational error.',
        details: expect.objectContaining({ validationComplete: false, causes: ['profile-load-error'],
          failureKind: 'type', profileRef: expect.any(String) }),
      }));
      const published = JSON.stringify(onIncomplete.mock.calls);
      expect(published).not.toContain(sensitiveException);
      expect(published).not.toContain('clinical-marker');
      expect(published).not.toContain('token=secret');
      expect(published).not.toContain(operationalProfileUrl);
      reads.mockRestore();
      const recoveredReads = vi.spyOn(loader, 'loadProfile');
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(true);
      const readCount = recoveredReads.mock.calls.length;
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(true);
      expect(recoveredReads.mock.calls.slice(readCount)).toContainEqual([operationalProfileUrl, 'R4']);
      expect(validateOne).toHaveBeenCalledTimes(2);
      expect(onIncomplete).toHaveBeenCalledTimes(2);
    }),
  );

  it.each([{ identifier: true, verdict: true }, { identifier: false, verdict: false }])(
    'keeps the actual completed verdict $verdict while rechecking dependencies', async ({ identifier, verdict }) => withActualProfileLoader(async (loader, validateOne) => {
      const onIncomplete = vi.fn();
      const check = createProfileConformanceCheck({ ...scope(validateOne), sdLoader: loader, onIncomplete })!;
      const resource = { resourceType: 'Patient', ...(identifier ? { identifier: [{ value: 'fixture' }] } : {}) };
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(verdict);
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(verdict);
      expect(validateOne).toHaveBeenCalledTimes(2);
      expect(onIncomplete).not.toHaveBeenCalled();
    }),
  );

  it('does not turn a definition available only for R5 into a loaded R4 profile or a loader fault', async () => withActualProfileLoader(async (loader, validateOne) => {
    loader.clearExternalProfiles();
    loader.registerExternalProfile({ ...operationalProfile, fhirVersion: '5.0.0' }, 'R5');
    const onIncomplete = vi.fn();
    const reads = vi.spyOn(loader, 'loadProfile');
    const check = createProfileConformanceCheck({ ...scope(validateOne), sdLoader: loader, onIncomplete })!;
    await expect(check({ resourceType: 'Patient' }, operationalProfileUrl)).resolves.toBeUndefined();
    expect(reads).toHaveBeenCalledWith(operationalProfileUrl, 'R4');
    expect(onIncomplete).toHaveBeenCalledTimes(1);
    expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'info', code: 'profile-conformance-incomplete',
      details: { validationComplete: false, profile: operationalProfileUrl, causes: ['profile-not-found'] },
    }));
    expect(validateOne).not.toHaveBeenCalled();
  }));
});

describe('conformsTo() pinning and preparation execution faults', () => {
  it.each([
    { phase: 'pin', identifier: true, verdict: true },
    { phase: 'pin', identifier: false, verdict: false },
    { phase: 'prepare', identifier: true, verdict: true },
    { phase: 'prepare', identifier: false, verdict: false },
  ])('retains $phase operational evidence and recovers to $verdict', async ({ phase, identifier, verdict }) =>
    withActualProfileLoader(async (loader, validateOne, snapshotGenerator) => {
      const differentialProfile: StructureDefinition = {
        ...operationalProfile, snapshot: undefined,
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
        differential: { element: [{ path: 'Patient.identifier', min: 1 }] },
      };
      if (phase === 'prepare') loader.registerExternalProfile(differentialProfile, 'R4');
      const error = new TypeError('SYNTHETIC_SECRET <Patient><name>FAKE</name></Patient> https://example.invalid?token=synthetic');
      const failingOperation = phase === 'pin'
        ? vi.spyOn(loader, 'loadReferencedProfile').mockRejectedValue(error)
        : vi.spyOn(snapshotGenerator, 'generateSnapshot').mockRejectedValue(error);
      const onIncomplete = vi.fn();
      const check = createProfileConformanceCheck({
        ...scope(validateOne), sdLoader: loader, referencingProfile: operationalProfile, onIncomplete,
      })!;
      const resource = { resourceType: 'Patient', id: 'fixture',
        ...(identifier ? { identifier: [{ value: 'fixture' }] } : {}) };
      await expect(check(resource, operationalProfileUrl)).resolves.toBeUndefined();
      await expect(check(resource, operationalProfileUrl)).resolves.toBeUndefined();
      expect(onIncomplete).toHaveBeenCalledTimes(2);
      const declaringProfile: StructureDefinition = {
        ...operationalProfile, type: 'Composition',
        snapshot: { element: [{ path: 'Composition' }, { path: 'Composition.subject',
          type: [{ code: 'Reference', targetProfile: [operationalProfileUrl] }] }] },
      };
      const targetIssues = await validateReferenceTargetProfileConformance({
        resource: { resourceType: 'Composition', subject: { reference: 'Patient/fixture' } },
        structureDef: declaringProfile, referenceTargetValidator: new ReferenceTargetValidator(),
        resolveReference: () => resource, conformsTo: check,
      });
      expect(targetIssues).toEqual([]);
      expect(onIncomplete).toHaveBeenCalledTimes(3);
      expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
        aspect: 'profile', severity: 'error', code: 'validation-error',
        details: expect.objectContaining({ validationComplete: false,
          causes: [phase === 'pin' ? 'profile-load-error' : 'profile-evaluation-error'],
          failureKind: 'type', profileRef: expect.any(String) }),
      }));
      const diagnosis = JSON.stringify(onIncomplete.mock.calls);
      expect(diagnosis).not.toContain('SYNTHETIC_SECRET');
      expect(diagnosis).not.toContain('<Patient');
      expect(diagnosis).not.toContain('token=synthetic');
      expect(diagnosis).not.toContain(operationalProfileUrl);
      failingOperation.mockRestore();
      loader.registerExternalProfile(structuredClone(operationalProfile), 'R4');
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(verdict);
      const callsAfterRecovery = validateOne.mock.calls.length;
      await expect(check(resource, operationalProfileUrl)).resolves.toBe(verdict);
      expect(validateOne).toHaveBeenCalledTimes(callsAfterRecovery + 1);
      expect(onIncomplete).toHaveBeenCalledTimes(3);
    }));
});


describe('unavailable profile definition evidence', () => {
  it.each(['warning', 'error'] as const)('reevaluates missing definitions and a later known %s verdict', async severity => {
    let available = false;
    const loadProfile = vi.fn(async () => available ? operationalProfile : null);
    const validateOne = validateOneReporting(issue(severity));
    const onIncomplete = vi.fn();
    const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete,
      sdLoader: { loadProfile } as unknown as MultiAspectDeps['sdLoader'] })!;
    const resource = { resourceType: 'Patient' };
    await expect(check(resource, operationalProfileUrl)).resolves.toBeUndefined();
    expect(validateOne).not.toHaveBeenCalled();
    expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'info', code: 'profile-conformance-incomplete',
      details: { validationComplete: false, profile: operationalProfileUrl, causes: ['profile-not-found'] },
    }));
    available = true;
    await expect(check(resource, operationalProfileUrl)).resolves.toBe(severity === 'warning');
    await expect(check(resource, operationalProfileUrl)).resolves.toBe(severity === 'warning');
    expect(loadProfile).toHaveBeenCalledTimes(3);
    expect(validateOne).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenCalledTimes(1);
  });

  it('keeps a loaded inapplicable resource type distinct from a missing definition', async () => {
    const loadProfile = vi.fn(async () => operationalProfile);
    const validateOne = validateOneReporting();
    const onIncomplete = vi.fn();
    const check = createProfileConformanceCheck({ ...scope(validateOne), onIncomplete,
      sdLoader: { loadProfile } as unknown as MultiAspectDeps['sdLoader'] })!;
    await expect(check({ resourceType: 'Organization' }, operationalProfileUrl)).resolves.toBe('not-applicable');
    expect(validateOne).not.toHaveBeenCalled();
    expect(onIncomplete).not.toHaveBeenCalled();
  });
});
