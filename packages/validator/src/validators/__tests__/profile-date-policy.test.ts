import { describe, expect, it } from 'vitest';
import { ProfileDatePolicyValidator, type ProfileDatePolicy } from '../profile-date-policy.js';
import { isCalendarDate, profileBusinessDate } from '../profile-business-date.js';

const canonical = 'https://gematik.de/fhir/erp/StructureDefinition/GEM_ERP_PR_Bundle';
const composition = 'https://gematik.de/fhir/erp/StructureDefinition/GEM_ERP_PR_Composition|1.6';
const pins = { 'de.gematik.erezept-workflow.r4': '1.6.4' };

function policy(selectedContext = 'july'): ProfileDatePolicy {
  return {
    id: 'gematik-erp', version: '2.22', sourceSha256: 'a'.repeat(64), fhirVersion: 'R4',
    timeZone: 'Europe/Berlin', selectedContext,
    contexts: {
      july: { packages: ['de.gematik.erezept-workflow.r4#1.6.4'], validFrom: '2026-07-01', validTill: '2026-09-30' },
      october: { packages: ['de.gematik.erezept-workflow.r4#1.6.4'], validFrom: '2026-10-01' },
    },
    rules: [{ profile: `${canonical}|1.6`,
      dateExpression: "Bundle.entry.resource.where(meta.profile.contains('GEM_ERP_PR_Composition')).date",
      contexts: ['july', 'october'] }],
  };
}

function resource(date?: string) {
  return { resourceType: 'Bundle', meta: { profile: [`${canonical}|1.6`] }, entry: [{ resource: {
    resourceType: 'Composition', meta: { profile: [composition] }, ...(date === undefined ? {} : { date }),
  } }] };
}

describe('explicit native profile date policy', () => {
  it.each(['2026-06-30', '2026-07-01', '2026-07-02', '2026-09-30', '2026-10-01', '2026-10-02'])(
    'checks the named boundary %s', date => {
      const validator = new ProfileDatePolicyValidator(policy(date >= '2026-10-01' ? 'october' : 'july'), pins);
      const input = resource(`${date}T11:40:00Z`);
      const before = JSON.stringify(input);
      const issues = validator.validate(input, `${canonical}|1.6`, 'R4');
      expect(issues).toHaveLength(date === '2026-06-30' ? 1 : 0);
      if (issues.length) expect(issues[0]).toMatchObject({ code: 'profile-date-outside-validity', severity: 'error' });
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it.each([
    ['2026-06-30T22:30:00Z', true],
    ['2026-07-01T00:30:00+03:00', false],
    ['2026-07-01', true],
  ])('uses Berlin calendar date for %s', (timestamp, valid) => {
    const issues = new ProfileDatePolicyValidator(policy(), pins).validate(resource(timestamp), canonical, 'R4');
    expect(issues).toHaveLength(valid ? 0 : 1);
  });

  it('does not validate against the wrong dependency set after a boundary', () => {
    const issues = new ProfileDatePolicyValidator(policy(), pins).validate(resource('2026-10-01T11:40:00Z'), canonical, 'R4');
    expect(issues[0]).toMatchObject({ code: 'profile-date-policy-incomplete', details: {
      reason: 'selected-context-not-applicable', validationComplete: false,
    } });
  });

  it('makes an absent or ambiguous business date incomplete, with no current-date fallback', () => {
    const validator = new ProfileDatePolicyValidator(policy(), pins);
    expect(validator.validate(resource(), canonical, 'R4')[0]).toMatchObject({
      code: 'profile-date-policy-incomplete', details: { reason: 'date-missing' },
    });
    const multiple = resource('2026-07-01'); multiple.entry.push(multiple.entry[0]);
    expect(validator.validate(multiple, canonical, 'R4')[0]).toMatchObject({
      code: 'profile-date-policy-incomplete', details: { reason: 'date-ambiguous' },
    });
  });

  it.each(['2026-02-29', '2026-07', '2026-07-01T00:00:00', '2026-07-01T25:00:00Z'])(
    'does not invent a full business date for %s', date => {
      expect(new ProfileDatePolicyValidator(policy(), pins).validate(resource(date), canonical, 'R4')[0])
        .toMatchObject({ code: 'profile-date-policy-incomplete', details: { reason: 'date-uninterpretable' } });
    },
  );

  it('does not infer profile version aliases or cross-release validity', () => {
    const validator = new ProfileDatePolicyValidator(policy(), pins);
    const input = resource('2026-06-30'); input.meta.profile = [`${canonical}|1.60`];
    expect(validator.validate(input, canonical, 'R4')).toEqual([]);
    expect(validator.validate(resource('2026-07-01'), canonical, 'R5')[0]).toMatchObject({
      code: 'profile-date-policy-incomplete', details: { reason: 'model-mismatch' },
    });
  });

  it('retains explicit context selection when valid dependency periods overlap', () => {
    const configured = policy(); configured.contexts.october.validFrom = '2026-09-01';
    expect(new ProfileDatePolicyValidator(configured, pins).validate(resource('2026-09-15'), canonical, 'R4')).toEqual([]);
  });

  it('evaluates an explicitly bundle-scoped selector in the enclosing bundle', () => {
    const configured = policy();
    configured.rules[0] = { ...configured.rules[0], profile: composition, dateScope: 'enclosing-bundle' };
    const bundle = resource('2026-07-01T11:40:00Z');
    const child = bundle.entry[0].resource;
    const validator = new ProfileDatePolicyValidator(configured, pins);
    expect(validator.validate(child, composition, 'R4', bundle)).toEqual([]);
    expect(validator.validate(child, composition, 'R4')[0]).toMatchObject({
      code: 'profile-date-policy-incomplete', details: { reason: 'context-resource-unavailable' },
    });
  });

  it('binds the immutable policy to the actual package pins', () => {
    expect(() => new ProfileDatePolicyValidator(policy(), {})).toThrow('pinned packages');
    const configured = policy();
    const validator = new ProfileDatePolicyValidator(configured, pins);
    configured.contexts.july.validFrom = '2025-01-01';
    expect(validator.validate(resource('2026-06-30'), canonical, 'R4')[0].code).toBe('profile-date-outside-validity');
  });

  it('checks a dependency profile in a parent package context with the same pinned closure', () => {
    const configured = policy('parent');
    configured.contexts.parent = { ...configured.contexts.july,
      packages: [...configured.contexts.july.packages, 'example.parent#1.0.0'] };
    expect(new ProfileDatePolicyValidator(configured, { ...pins, 'example.parent': '1.0.0' })
      .validate(resource('2026-07-01'), canonical, 'R4')).toEqual([]);
  });

  it('rejects inconsistent context configuration before evaluation', () => {
    const configured = policy(); configured.rules[0].contexts.push('unknown');
    expect(() => new ProfileDatePolicyValidator(configured, pins)).toThrow('unknown context');
    const duplicate = policy(); duplicate.rules.push(duplicate.rules[0]);
    expect(() => new ProfileDatePolicyValidator(duplicate, pins)).toThrow('Duplicate');
    const inverted = policy(); inverted.contexts.july.validTill = '2026-06-01';
    expect(() => new ProfileDatePolicyValidator(inverted, pins)).toThrow('inverted');
  });

  it('uses an explicit aggregate to choose the latest handover date', () => {
    const configured = policy(); configured.rules[0] = { ...configured.rules[0], profile: 'https://example.org/Parameters|1',
      dateExpression: 'parameter.part.resource.whenHandedOver.aggregate(iif($total > $this, $total, $this))' };
    const input = { resourceType: 'Parameters', meta: { profile: ['https://example.org/Parameters|1'] }, parameter: [
      { part: ['2026-06-30T12:00:00Z', '2026-07-01T12:00:00Z'].map(whenHandedOver => ({ resource: {
        resourceType: 'MedicationDispense', whenHandedOver,
      } })) },
    ] };
    expect(new ProfileDatePolicyValidator(configured, pins).validate(input, 'https://example.org/Parameters|1', 'R4')).toEqual([]);
  });
});

it('validates calendar days independently of JavaScript date normalization', () => {
  expect(isCalendarDate('2000-02-29')).toBe(true);
  expect(isCalendarDate('1900-02-29')).toBe(false);
  expect(isCalendarDate('2026-04-31')).toBe(false);
  expect(profileBusinessDate('2026-09-30T22:30:00Z', 'Europe/Berlin')).toBe('2026-10-01');
});
