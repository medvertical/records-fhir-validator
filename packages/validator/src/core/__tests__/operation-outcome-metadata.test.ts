import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { toOperationOutcome, fromOperationOutcome, detailedResultToOperationOutcome } from '../operation-outcome-converter.js';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../semantic-aspect-plan.js';

const metadataUrl = 'https://records.medvertical.com/fhir/StructureDefinition/validation-issue-metadata';
const base: ValidationIssue = { aspect: 'terminology', severity: 'information', code: 'terminology-codesystem-unverified',
  message: 'Synthetic unknown diagnostic', path: 'Observation.code.coding[0].code',
  details: { validationComplete: false, validationStatus: 'incomplete' } };
const details = (issue: ValidationIssue | undefined) => issue?.details && typeof issue.details === 'object' ? issue.details : {};
const projection = (issues: ValidationIssue[], aspect = 'terminology') => {
  const accepted = !issues.some(issue => ['error', 'fatal'].includes(issue.severity));
  return projectSemanticAspectResult({ isValid: accepted, structureDef: { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/synthetic',
      name: 'Synthetic', status: 'active', kind: 'resource', abstract: false, type: 'Observation' },
    aspects: [{ aspect, isValid: accepted, issues, validationTime: 0 }] }, resolveSemanticAspectPlan([aspect])).isValid;
};
const capsule = (extension: unknown[]) => ({ url: metadataUrl, extension });
const external = (extension: unknown, severity = 'information') => ({ resourceType: 'OperationOutcome', issue: [
  { severity, code: 'processing', diagnostics: 'Synthetic external diagnostic', extension },
] });

describe('OperationOutcome completeness and identity metadata', () => {
  for (const severity of ['information', 'warning', 'error'] as const) it(`explicit unknown ${severity} roundtrip stays incomplete`, () => {
    const original = { ...base, severity }; const recovered = fromOperationOutcome(toOperationOutcome([original]));
    expect(details(recovered[0])).toMatchObject({ validationComplete: false, validationStatus: 'incomplete' });
    expect(projection(recovered)).toBe(projection([original])); expect(projection(recovered)).toBe(false);
  });
  it('preserves known positive typed evidence without inferring it from severity', () => {
    const original: ValidationIssue = { ...base, code: 'terminology-known-local-member', details: { validationComplete: true } };
    const recovered = fromOperationOutcome(toOperationOutcome([original]));
    expect(details(recovered[0]).validationComplete).toBe(true); expect(projection(recovered)).toBe(true);
  });
  it('known invalid stays invalid even with explicit complete evidence', () => {
    const original: ValidationIssue = { ...base, severity: 'error', code: 'terminology-code-invalid', details: { validationComplete: true } };
    const recovered = fromOperationOutcome(toOperationOutcome([original]));
    expect(recovered[0].severity).toBe('error'); expect(projection(recovered)).toBe(false);
  });
  it('preserves original identity/aspect/profile and both path representations', () => {
    const original: ValidationIssue = { ...base, id: 'original-issue-identity', aspect: 'structural', ruleId: 'synthetic-constraint',
      profile: 'https://example.test/StructureDefinition/source|1', path: 'Observation.code', expression: 'Observation.code.coding',
      details: { validationComplete: false, validationStatus: 'incomplete', constraintKey: 'dom-3',
        profileUrl: 'https://example.test/StructureDefinition/source|1', targetProfile: 'https://example.test/StructureDefinition/target|2' } };
    const recovered = fromOperationOutcome(toOperationOutcome([original]))[0];
    expect(recovered).toMatchObject({ id: original.id, aspect: original.aspect, ruleId: original.ruleId, profile: original.profile,
      path: original.path, expression: original.expression, details: original.details });
    expect(toOperationOutcome([recovered]).issue[0].code).toBe('invalid');
  });
  it('keeps distinct identical-text finding IDs and multiplicities', () => {
    const originals = [{ ...base, id: 'first', profile: 'https://example.test/StructureDefinition/first' },
      { ...base, id: 'second', profile: 'https://example.test/StructureDefinition/second' }];
    expect(fromOperationOutcome(toOperationOutcome(originals)).map(issue => issue.id)).toEqual(['first', 'second']);
  });
  it('detailed host export selects the same bounded fields', () => {
    const original: ValidationIssue = { ...base, id: 'host-identity', rawSeverity: 'warning', disposition: 'suppressed',
      details: { validationComplete: false, validationStatus: 'incomplete', patient: { resourceType: 'Patient', syntheticPayload: true }, arbitrary: 'do not export' } };
    const outcome = detailedResultToOperationOutcome({ isValid: true, issues: [original], clinicalPayload: { synthetic: true } });
    const recovered = fromOperationOutcome(outcome)[0];
    expect(recovered).toMatchObject({ id: 'host-identity', rawSeverity: 'warning', disposition: 'suppressed' });
    expect(details(recovered)).toEqual({ validationComplete: false, validationStatus: 'incomplete' });
    expect(JSON.stringify(outcome)).not.toContain('syntheticPayload'); expect(JSON.stringify(outcome)).not.toContain('arbitrary');
  });
  it('suppressed unknown evidence remains incomplete', () => {
    const original: ValidationIssue = { ...base, rawSeverity: 'information', disposition: 'suppressed' };
    const recovered = fromOperationOutcome(toOperationOutcome([original]));
    expect(recovered[0]).toMatchObject({ rawSeverity: 'information', disposition: 'suppressed' }); expect(projection(recovered)).toBe(false);
  });
  it('raw-severity and disposition annotations cannot remove an actual error', () => {
    const recovered = fromOperationOutcome(external([capsule([
      { url: 'aspect', valueString: 'terminology' }, { url: 'rawSeverity', valueString: 'information' },
      { url: 'disposition', valueString: 'suppressed' }, { url: 'validationComplete', valueBoolean: true },
    ])], 'error'));
    expect(recovered[0].severity).toBe('error'); expect(projection(recovered)).toBe(false);
  });
  it('explicit incomplete status dominates contradictory complete true', () => {
    const recovered = fromOperationOutcome(external([capsule([
      { url: 'aspect', valueString: 'terminology' }, { url: 'validationComplete', valueBoolean: true },
      { url: 'validationStatus', valueString: 'incomplete' },
    ])]));
    expect(details(recovered[0]).validationComplete).toBe(false); expect(projection(recovered)).toBe(false);
  });
  const malformed = [
    ['wrong boolean type', [capsule([{ url: 'validationComplete', valueBoolean: 'false' }])]],
    ['wrong value choice', [capsule([{ url: 'validationComplete', valueString: 'false' }])]],
    ['both value choices', [capsule([{ url: 'validationComplete', valueBoolean: false, valueString: 'false' }])]],
    ['nested and primitive value', [capsule([{ url: 'validationComplete', valueBoolean: false, extension: [] }])]],
    ['duplicate fields', [capsule([{ url: 'validationComplete', valueBoolean: false }, { url: 'validationComplete', valueBoolean: true }])]],
    ['duplicate containers', [capsule([{ url: 'validationComplete', valueBoolean: false }]), capsule([{ url: 'validationComplete', valueBoolean: true }])]],
    ['nonarray children', [{ url: metadataUrl, extension: {} }]],
    ['container primitive plus children', [{ url: metadataUrl, valueBoolean: true, extension: [{ url: 'validationComplete', valueBoolean: false }] }]],
    ['empty container', [capsule([])]],
    ['invalid raw severity', [capsule([{ url: 'rawSeverity', valueString: 'not-a-severity' }])]],
    ['invalid disposition', [capsule([{ url: 'disposition', valueString: 'discard-error' }])]],
    ['object payload in identity', [capsule([{ url: 'id', valueString: { resourceType: 'Patient' } }])]],
    ['complete boolean alone', [capsule([{ url: 'validationComplete', valueBoolean: true }])]],
    ['nonarray recognized container', capsule([{ url: 'validationComplete', valueBoolean: false }])],
  ] as const;
  it.each(malformed)('malformed recognized %s becomes unverified metadata', (_name, extension) => {
    const recovered = fromOperationOutcome(external(extension));
    expect(details(recovered[0])).toMatchObject({ validationComplete: false, validationStatus: 'incomplete' });
    expect(recovered[0].severity).toBe('info'); expect(projection(recovered)).toBe(false);
  });
  it('malformed FHIR severity cannot become complete-valid through metadata', () => {
    const recovered = fromOperationOutcome(external([capsule([
      { url: 'aspect', valueString: 'terminology' }, { url: 'validationComplete', valueBoolean: true },
    ])], 'unexpected'));
    expect(details(recovered[0]).validationComplete).toBe(false); expect(projection(recovered)).toBe(false);
  });
  it('ordinary external HAPI/MII issue semantics remain severity-compatible', () => {
    for (const severity of ['fatal', 'error', 'warning', 'information']) {
      const recovered = fromOperationOutcome(external([{ url: 'https://other.test/extension', valueBoolean: false }], severity));
      expect(recovered[0].severity).toBe(severity === 'information' ? 'info' : severity);
      expect(recovered[0].details).toBeUndefined();
    }
  });
});

describe('OperationOutcome neutral empty/unavailable output', () => {
  for (const input of [[], { isValid: true, issues: [] }, { isValid: false, issues: [] }, null, { isValid: true }]) {
    it(`empty detailed/issue input ${JSON.stringify(input)} makes no complete-valid claim`, () => {
      const outcome = Array.isArray(input) ? toOperationOutcome(input) : detailedResultToOperationOutcome(input);
      expect(outcome.issue).toHaveLength(1); expect(outcome.issue[0]).toMatchObject({ severity: 'information', code: 'informational' });
      const recovered = fromOperationOutcome(outcome); expect(details(recovered[0]).validationComplete).toBe(false);
      expect(projection(recovered, 'structural')).toBe(false);
    });
  }
  for (const input of [null, undefined, 42, { issue: 'invalid' }, { resourceType: 'OperationOutcome', issue: [] }]) {
    it(`unavailable inverse input ${JSON.stringify(input)} remains unverified`, () => {
      const recovered = fromOperationOutcome(input); expect(recovered).toHaveLength(1);
      expect(details(recovered[0]).validationComplete).toBe(false); expect(recovered[0].severity).toBe('information');
    });
  }
  it('discarded malformed entries cannot upgrade explicit complete evidence', () => {
    const outcome = toOperationOutcome([{ ...base, details: { validationComplete: true } }]);
    const recovered = fromOperationOutcome({ ...outcome, issue: [...outcome.issue, null] });
    expect(recovered).toHaveLength(1); expect(details(recovered[0]).validationComplete).toBe(false);
  });
});


describe('OperationOutcome malformed evidence boundaries', () => {
  it.each([
    { issues: [{}], isValid: true },
    { issues: [{ aspect: 'structural', severity: 'unexpected', message: 'Synthetic diagnostic' }], isValid: true },
    { issues: [{ aspect: 'structural', severity: 'information', details: { validationComplete: 'true' } }], isValid: true },
    { issues: [{ aspect: 'structural', severity: 'information', details: { validationStatus: 'not-a-status' } }], isValid: true },
    { issues: [{ ...base, details: { validationComplete: true } }, null], isValid: true },
  ])('malformed host evidence remains unverified: %j', input => {
    const recovered = fromOperationOutcome(detailedResultToOperationOutcome(input));
    expect(recovered).toHaveLength(1);
    expect(details(recovered[0]).validationComplete).toBe(false);
  });
  it('missing mandatory FHIR issue code does not claim completeness', () => {
    const recovered = fromOperationOutcome({ resourceType: 'OperationOutcome', issue: [{ severity: 'information' }] });
    expect(details(recovered[0]).validationComplete).toBe(false);
  });
  it('unknown metadata field does not silently vouch for a recognized capsule', () => {
    const recovered = fromOperationOutcome(external([capsule([
      { url: 'aspect', valueString: 'terminology' }, { url: 'validationComplete', valueBoolean: true },
      { url: 'unexpected', valueString: 'unchecked evidence' },
    ])]));
    expect(details(recovered[0]).validationComplete).toBe(false);
  });
});


it('complete true plus an aspect does not vouch for absent executed Records issue evidence', () => {
  const recovered = fromOperationOutcome(external([capsule([
    { url: 'aspect', valueString: 'terminology' }, { url: 'validationComplete', valueBoolean: true },
  ])]));
  expect(details(recovered[0]).validationComplete).toBe(false); expect(projection(recovered)).toBe(false);
});


it('internal info alias is not a valid complete FHIR issue severity', () => {
  const outcome = toOperationOutcome([{ ...base, code: 'terminology-known-local-member', details: { validationComplete: true } }]);
  const recovered = fromOperationOutcome({ ...outcome, issue: [{ ...outcome.issue[0], severity: 'info' }] });
  expect(recovered[0].severity).toBe('info'); expect(details(recovered[0]).validationComplete).toBe(false);
});
