import type { ProfileConformanceCheck } from '../../validators/sd-fhirpath-profile-conformance';
import { describe, expect, it } from 'vitest';
import { collectExtensionTargetHits, targetProfileResolver, validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import type { StructureDefinition } from '../structure-definition-types';

const SPECIAL_PATIENT = 'http://example.org/StructureDefinition/special-patient|1.0.0';
const OTHER_PATIENT = 'http://example.org/StructureDefinition/not-this-patient';
const CORE_PATIENT = 'http://hl7.org/fhir/StructureDefinition/Patient';

const profileWithSubject = (targetProfile: string[]): StructureDefinition => ({
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/obs-profiled-subject',
  name: 'ObsProfiledSubject',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation' },
      { id: 'Observation.subject', path: 'Observation.subject', type: [{ code: 'Reference', targetProfile }] } as any,
      { id: 'Observation.performer', path: 'Observation.performer', type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Practitioner'] }] } as any,
    ],
  },
});

const validator = new ReferenceTargetValidator();
const observation = { resourceType: 'Observation', subject: { reference: 'urn:uuid:p1' }, performer: [{ reference: 'urn:uuid:pr1' }] };
const patient = { resourceType: 'Patient', id: 'p1' };

describe('ReferenceTargetValidator.collectProfiledTargetHits', () => {
  it('enumerates references with profiled targetProfiles, keeping versions and every choice', () => {
    const hits = validator.collectProfiledTargetHits(observation, profileWithSubject([SPECIAL_PATIENT, CORE_PATIENT]));
    expect(hits).toEqual([{
      path: 'Observation.subject',
      reference: 'urn:uuid:p1',
      profiles: [SPECIAL_PATIENT],
      choices: [SPECIAL_PATIENT, CORE_PATIENT].sort(),
    }]);
  });
});

describe('profiled target canonicals', () => {
  // KBV names its profiles with underscores.
  it('include names with underscores and dots', () => {
    const kbvPatient = 'https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_Vaccination_Patient|1.1.0';
    const hits = validator.collectProfiledTargetHits(observation, profileWithSubject([kbvPatient]));
    expect(hits.map(hit => hit.profiles)).toEqual([[kbvPatient]]);
  });
});

describe('validateReferenceTargetProfileConformance', () => {
  const run = (
    targetProfile: string[],
    conformsTo: ProfileConformanceCheck | undefined,
    resolve: ((reference: string) => unknown) | null = () => patient,
  ) => validateReferenceTargetProfileConformance({
    resource: observation,
    structureDef: profileWithSubject(targetProfile),
    referenceTargetValidator: validator,
    resolveReference: resolve as any,
    conformsTo,
  });

  it('reports one error naming every choice when the target conforms to none', async () => {
    const issues = await run([SPECIAL_PATIENT, OTHER_PATIENT], async () => false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'reference-target-profile-noncompliant',
      severity: 'error',
      aspect: 'reference',
      path: 'Observation.subject',
      message: `Unable to find a profile match for urn:uuid:p1 among choices: ${OTHER_PATIENT}, ${SPECIAL_PATIENT}`,
    });
  });

  it('treats the choices as alternatives', async () => {
    const issues = await run([OTHER_PATIENT, SPECIAL_PATIENT], async (_target, profile) => profile === SPECIAL_PATIENT);
    expect(issues).toEqual([]);
  });

  // The reference validator holds the target to the core definition too when
  // it is a choice beside a profile (EU Lab's Composition|4.0.1).
  it('accepts a target the core definition among the choices accepts', async () => {
    expect(await run([SPECIAL_PATIENT, CORE_PATIENT], async (_target, profile) => profile === CORE_PATIENT)).toEqual([]);
    expect(await run([SPECIAL_PATIENT, CORE_PATIENT], async () => false)).toHaveLength(1);
  });

  it('leaves a target to its own validation when no profiled choice is made for its type', async () => {
    expect(await run([SPECIAL_PATIENT], async () => undefined)).toEqual([]);
    expect(await run([SPECIAL_PATIENT, 'http://hl7.org/fhir/StructureDefinition/Resource'], async () => false)).toEqual([]);
  });

  it.each([undefined, 'throw'] as const)('keeps an unavailable OR alternative undecided (%s)', async unknown => {
    expect(await run([SPECIAL_PATIENT, OTHER_PATIENT], async (_target, profile) => {
      if (profile === SPECIAL_PATIENT) return false;
      if (unknown === 'throw') throw new Error('unavailable');
      return undefined;
    })).toEqual([]);
  });

  it('can reject applicable profiles while ignoring profiles for another resource type', async () => {
    expect(await run([SPECIAL_PATIENT, OTHER_PATIENT], async (_target, profile) =>
      profile === SPECIAL_PATIENT ? false : 'not-applicable')).toHaveLength(1);
  });

  it('fails open on an unresolvable target, a missing resolver or check, and errors', async () => {
    expect(await run([SPECIAL_PATIENT], async () => false, () => null)).toEqual([]);
    expect(await run([SPECIAL_PATIENT], async () => false, null)).toEqual([]);
    expect(await run([SPECIAL_PATIENT], undefined)).toEqual([]);
    expect(await run([SPECIAL_PATIENT], async () => false, () => { throw new Error('resolver unavailable'); })).toEqual([]);
    expect(await run([SPECIAL_PATIENT], async () => { throw new Error('engine'); })).toEqual([]);
  });
});

describe('targetProfileResolver', () => {
  const local = () => patient;
  const all = () => patient;
  const recursive = (overrides: Record<string, unknown>) => ({
    recursiveReferenceValidation: { enabled: true, maxDepth: 3, validateExternal: false, validateContained: true, validateBundleEntries: true, ...overrides },
  });

  it('checks the targets the content holds by default, and fetched ones only on request', () => {
    expect(targetProfileResolver(undefined, { local, all })).toBe(local);
    expect(targetProfileResolver(recursive({}), { local, all })).toBe(local);
    expect(targetProfileResolver(recursive({ validateTargetProfiles: true }), { local, all })).toBe(all);
    expect(targetProfileResolver(recursive({ validateTargetProfiles: false }), { local, all })).toBeUndefined();
    expect(targetProfileResolver(recursive({ enabled: false }), { local, all })).toBeUndefined();
  });
});

describe('collectExtensionTargetHits', () => {
  // VhDir's usage-restriction extension points at a contained vhdir-restriction Consent.
  const RESTRICTION = 'http://hl7.org/fhir/uv/vhdir/StructureDefinition/vhdir-restriction';
  const USAGE_RESTRICTION = 'http://hl7.org/fhir/uv/vhdir/StructureDefinition/usage-restriction';
  const definition = {
    resourceType: 'StructureDefinition',
    url: USAGE_RESTRICTION,
    type: 'Extension',
    snapshot: { element: [{ id: 'Extension.value[x]', path: 'Extension.value[x]', type: [{ code: 'Reference', targetProfile: [RESTRICTION] }] }] },
  } as unknown as StructureDefinition;
  const restricted = { url: USAGE_RESTRICTION, valueReference: { reference: '#restrict' } };

  it('holds a reference in an extension value to the targetProfiles its definition names', async () => {
    const location = {
      resourceType: 'Location',
      telecom: [{ system: 'url' }, { system: 'phone', extension: [restricted] }],
      _status: { extension: [restricted] },
      contained: [{ resourceType: 'Consent', id: 'restrict', extension: [restricted] }],
    };
    const hits = await collectExtensionTargetHits(location, async url => (url === USAGE_RESTRICTION ? definition : null));

    expect(hits).toEqual([
      { path: 'Location.telecom[1].extension[0].valueReference', reference: '#restrict', profiles: [RESTRICTION], choices: [RESTRICTION], referencingProfile: definition },
      { path: 'Location.status.extension[0].valueReference', reference: '#restrict', profiles: [RESTRICTION], choices: [RESTRICTION], referencingProfile: definition },
    ]);
  });
});
