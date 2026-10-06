import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

// US Core / Da Vinci provenance-1: `resolve() is <Type>` over an agent
// reference. Stateless validation cannot dereference external references, so
// resolve() yields empty and the constraint must stay vacuously satisfied
// (the HL7 validator behaves the same). When the target IS locally
// resolvable (bundle / contained), the type test must actually decide.

const profileUrl = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-provenance';

const provenanceAgentElements = [{
  path: 'Provenance.agent',
  constraint: [{
    key: 'provenance-1',
    severity: 'error' as const,
    human: 'onBehalfOf SHALL be present when Provenance.agent.who is a Practitioner or Device',
    expression: 'who.exists((resolve() is Practitioner) or (resolve() is Device)) implies onBehalfOf.exists()',
  }],
}];

const provenance = (agent: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  resourceType: 'Provenance',
  id: 'prov-1',
  target: [{ reference: 'Patient/p1' }],
  recorded: '2023-02-28T15:26:23.217+00:00',
  agent: [agent],
  ...extra,
});

const provenance1Issue = expect.objectContaining({
  ruleId: 'provenance-1',
  code: 'profile-constraint-violation',
});

describe('resolve() with type operators (provenance-1)', () => {
  it('passes vacuously when the reference cannot be resolved locally', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      provenance({ who: { reference: 'Patient/external-not-here' } }),
      provenanceAgentElements as any,
      profileUrl,
    );

    expect(issues.find(issue => issue.ruleId === 'provenance-1')).toBeUndefined();
    expect(issues.some(issue => issue.code === 'profile-constraint-evaluation-error')).toBe(false);
  });

  it('fails when who resolves in-bundle to a Practitioner and onBehalfOf is missing', async () => {
    const validator = new ConstraintValidator();
    const bundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'https://example.org/fhir/Practitioner/pr1',
        resource: { resourceType: 'Practitioner', id: 'pr1' },
      }],
    };

    const issues = await validator.validate(
      provenance({ who: { reference: 'Practitioner/pr1' } }),
      provenanceAgentElements as any,
      profileUrl,
      { bundle },
    );

    expect(issues).toContainEqual(provenance1Issue);
  });

  it('passes when who resolves to a Practitioner and onBehalfOf is present', async () => {
    const validator = new ConstraintValidator();
    const bundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'https://example.org/fhir/Practitioner/pr1',
        resource: { resourceType: 'Practitioner', id: 'pr1' },
      }],
    };

    const issues = await validator.validate(
      provenance({
        who: { reference: 'Practitioner/pr1' },
        onBehalfOf: { reference: 'Organization/org1' },
      }),
      provenanceAgentElements as any,
      profileUrl,
      { bundle },
    );

    expect(issues.find(issue => issue.ruleId === 'provenance-1')).toBeUndefined();
  });

  it('passes when who resolves in-bundle to an Organization', async () => {
    const validator = new ConstraintValidator();
    const bundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'https://example.org/fhir/Organization/org1',
        resource: { resourceType: 'Organization', id: 'org1' },
      }],
    };

    const issues = await validator.validate(
      provenance({ who: { reference: 'Organization/org1' } }),
      provenanceAgentElements as any,
      profileUrl,
      { bundle },
    );

    expect(issues.find(issue => issue.ruleId === 'provenance-1')).toBeUndefined();
  });

  it('fails when who resolves to a contained Device and onBehalfOf is missing', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      provenance(
        { who: { reference: '#dev1' } },
        { contained: [{ resourceType: 'Device', id: 'dev1' }] },
      ),
      provenanceAgentElements as any,
      profileUrl,
    );

    expect(issues).toContainEqual(provenance1Issue);
  });
});

describe('resolve() on absolute references outside the bundle', () => {
  // The reference validator fetches absolute references, so the target's type
  // decides the invariant; the URL names that type.
  it('types an absolute Practitioner reference from its URL', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      provenance({ who: { reference: 'https://server.example.test/fhir/Practitioner/pr1' } }),
      provenanceAgentElements as any,
      profileUrl,
    );

    expect(issues).toContainEqual(provenance1Issue);
  });

  it('stays satisfied when the absolute reference names another type', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      provenance({ who: { reference: 'https://server.example.test/fhir/Patient/p1' } }),
      provenanceAgentElements as any,
      profileUrl,
    );

    expect(issues.find(issue => issue.ruleId === 'provenance-1')).toBeUndefined();
  });
});
