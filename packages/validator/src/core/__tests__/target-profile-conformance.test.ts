import { describe, expect, it } from 'vitest';
import { validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import type { StructureDefinition } from '../structure-definition-types';
import type { ValidationIssue } from '../../types';

const SPECIAL_PATIENT = 'http://example.org/StructureDefinition/special-patient';

// Observation.subject references a *profiled* Patient; Observation.performer
// references a bare Practitioner (base type only — must NOT be enumerated).
const profile: StructureDefinition = {
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
      { id: 'Observation.subject', path: 'Observation.subject', type: [{ code: 'Reference', targetProfile: [SPECIAL_PATIENT] }] } as any,
      { id: 'Observation.performer', path: 'Observation.performer', type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Practitioner'] }] } as any,
    ],
  },
};

const validator = new ReferenceTargetValidator();
const baseResource = (ref: string) => ({ resourceType: 'Observation', subject: { reference: ref } });
const err = (): ValidationIssue[] => ([{ id: '1', aspect: 'profile', severity: 'error', code: 'profile-constraint-violation', message: 'x', path: 'Patient', timestamp: new Date() }]);

describe('ReferenceTargetValidator.collectProfiledTargetHits', () => {
  it('enumerates only profiled targetProfiles, not bare base types', () => {
    const hits = validator.collectProfiledTargetHits(
      { resourceType: 'Observation', subject: { reference: 'urn:uuid:p1' }, performer: [{ reference: 'urn:uuid:pr1' }] },
      profile,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'Observation.subject', reference: 'urn:uuid:p1', profiles: [SPECIAL_PATIENT] });
  });
});

describe('validateReferenceTargetProfileConformance (gap P-2)', () => {
  const run = (opts: {
    resolve?: (r: string) => any;
    validateProfile: (target: any, profile: string) => Promise<ValidationIssue[]>;
  }) => validateReferenceTargetProfileConformance({
    resource: baseResource('urn:uuid:p1'),
    structureDef: profile,
    referenceTargetValidator: validator,
    resolveReference: opts.resolve,
    validateProfile: opts.validateProfile,
  });

  it('warns when a resolvable target does not conform to the required profile', async () => {
    const issues = await run({
      resolve: () => ({ resourceType: 'Patient', id: 'p1' }),
      validateProfile: async () => err(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'reference-target-profile-noncompliant',
      severity: 'warning',
      path: 'Observation.subject',
    });
  });

  it('stays silent when the target conforms', async () => {
    const issues = await run({
      resolve: () => ({ resourceType: 'Patient', id: 'p1' }),
      validateProfile: async () => [],
    });
    expect(issues).toHaveLength(0);
  });

  it('fails open when the required profile cannot be loaded', async () => {
    const issues = await run({
      resolve: () => ({ resourceType: 'Patient', id: 'p1' }),
      validateProfile: async () => ([{ id: '1', aspect: 'profile', severity: 'error', code: 'profile-not-found', message: 'x', path: 'Patient', timestamp: new Date() }]),
    });
    expect(issues).toHaveLength(0);
  });

  it('fails open when the target cannot be resolved', async () => {
    const issues = await run({ resolve: () => null, validateProfile: async () => err() });
    expect(issues).toHaveLength(0);
  });

  it('does nothing without a resolver', async () => {
    const issues = await run({ resolve: undefined, validateProfile: async () => err() });
    expect(issues).toHaveLength(0);
  });
});
